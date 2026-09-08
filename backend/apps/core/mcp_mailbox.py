"""
=====================================================================
MWT.ONE · apps.core.mcp_mailbox
Pipeline de correo del onboarding MCP (Fase 1) — transporte.

  · Lee el INBOX de mcp@mwt.one por IMAP (SSL :993).
  · Para cada correo no visto dirigido a mcp@mwt.one:
      - extrae el email objetivo del cuerpo (regex, con heurística),
      - decide escenario con apps.core.mcp_onboarding,
      - responde al correo objetivo (SMTP :587 STARTTLS autenticando como
        mcp@mwt.one) con el template correspondiente y, en el caso "ok",
        adjuntando el paquete .json + .md.
  · Mueve a la carpeta "Procesados" lo ya respondido (no re-procesa).

Config (env del backend, ya persistida en /opt/consola-mwt-one/.env):
  MCP_MAILBOX_USER / MCP_MAILBOX_PASSWORD / MCP_MAILBOX_IMAP_HOST /
  MCP_MAILBOX_IMAP_PORT / MCP_MAILBOX_IMAP_SSL / MCP_SMTP_HOST /
  MCP_SMTP_PORT / MCP_SMTP_STARTTLS / MCP_MAILBOX_FROM
=====================================================================
"""
from __future__ import annotations

import email
import imaplib
import logging
import re
import smtplib
import ssl
from email.header import decode_header
from email.message import Message
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from html import unescape

from django.conf import settings
from django.template.loader import render_to_string

from . import mcp_onboarding

log = logging.getLogger("mwt_mcp.onboarding.mailbox")

# Carpeta destino tras responder (se crea si no existe).
DONE_FOLDER = "Procesados"

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE)


# ── Config ─────────────────────────────────────────────────────────────

def _cfg(name: str, default: str = "") -> str:
    """Lee de django settings (que a su vez lee env) con fallback directo a env."""
    import os
    val = getattr(settings, name, None)
    if val is None or val == "":
        val = os.environ.get(name, default)
    return str(val or default)


def mailbox_configured() -> bool:
    return bool(_cfg("MCP_MAILBOX_USER")) and bool(_cfg("MCP_MAILBOX_PASSWORD"))


# ── Parseo de mensaje ──────────────────────────────────────────────────

def _decoded(value) -> str:
    """Decodifica un header MIME (RFC 2047) a texto."""
    if not value:
        return ""
    parts = decode_header(value)
    out = []
    for raw, enc in parts:
        if isinstance(raw, bytes):
            try:
                out.append(raw.decode(enc or "utf-8", errors="replace"))
            except LookupError:
                out.append(raw.decode("utf-8", errors="replace"))
        else:
            out.append(raw)
    return "".join(out)


def _first_text(msg: Message) -> str:
    """Extrae el primer text/plain (decodificado) del árbol MIME."""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "text/plain":
                return _part_text(part)
        # fallback: el primer text/* que exista
        for part in msg.walk():
            if part.get_content_type().startswith("text/"):
                return _part_text(part)
    return _part_text(msg)


def _part_text(part: Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</(p|div|li|tr|h\d)>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    return unescape(text)


def _body_texts(msg: Message) -> tuple[str, str]:
    plain, html = "", ""
    for part in msg.walk():
        ctype = part.get_content_type()
        if part.is_multipart():
            continue
        if ctype == "text/plain" and not plain:
            plain = _part_text(part)
        elif ctype == "text/html" and not html:
            html = _part_text(part)
    if not plain and html:
        plain = _strip_html(html)
    return plain, html


def _extract_target_email(body: str, sender: str, from_name: str = "") -> str:
    """Devuelve el email objetivo del cuerpo; fallback al remitente.

    Prefiere emails que aparezcan en una línea que mencione "correo/email".
    Descarta las direcciones de servicio (mcp@mwt.one, info@…) y, si el
    único candidato del cuerpo coincide con el remitente, lo usa igual.
    """
    lines = [ln.strip() for ln in (body or "").splitlines() if ln.strip()]
    candidates: list[str] = []
    for ln in lines:
        found = _EMAIL_RE.findall(ln)
        if not found:
            continue
        # línea con indicador de credencial
        if re.search(r"(?i)\b(correo|email|mail)\b", ln):
            candidates = found + candidates
        else:
            candidates += found
    seen: set[str] = set()
    clean: list[str] = []
    for c in candidates:
        c_low = c.lower()
        if c_low in seen:
            continue
        seen.add(c_low)
        if c_low not in mcp_onboarding.SERVICE_EMAILS:
            clean.append(c_low)
    if clean:
        return clean[0]
    return (sender or "").strip().lower()


# ── Envío de respuesta (SMTP 587 STARTTLS, From mcp@mwt.one) ──────────

def send_reply(
    to_email: str,
    *,
    subject: str,
    template_key: str,
    context: dict,
    attachments: list[dict] | None = None,
) -> dict:
    """Renderiza emails/<template_key>.{html,txt} y lo envía como mcp@mwt.one."""
    from_email = _cfg("MCP_MAILBOX_FROM", "mcp@mwt.one")
    host = _cfg("MCP_SMTP_HOST", "mail.mwt.one")
    port = int(_cfg("MCP_SMTP_PORT", "587"))
    starttls = _cfg("MCP_SMTP_STARTTLS", "1").lower() in ("1", "true", "yes")
    user = _cfg("MCP_MAILBOX_USER", "")
    password = _cfg("MCP_MAILBOX_PASSWORD", "")

    ctx = {"consola_url": getattr(settings, "CONSOLA_PUBLIC_URL", "https://consola.mwt.one")}
    ctx.update(context or {})

    try:
        html_body = render_to_string(f"emails/{template_key}.html", ctx)
    except Exception as exc:  # noqa: BLE001
        html_body = ""
        log.warning("render html %s falló: %s", template_key, exc)
    try:
        text_body = render_to_string(f"emails/{template_key}.txt", ctx)
    except Exception as exc:  # noqa: BLE001
        text_body = (ctx.get("texto_plano") or "").strip() or f"Revisa el HTML de este correo. ({exc})"

    # multipart/alternative con text/plain + text/html. Con adjuntos se anida
    # DENTRO de un multipart/mixed (así Gmail NO muestra el texto plano y el
    # HTML duplicados; el cliente elige uno).
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body, "plain", "utf-8"))
    if html_body:
        alt.attach(MIMEText(html_body, "html", "utf-8"))

    if attachments:
        root = MIMEMultipart("mixed")
        root.attach(alt)
        for att in attachments:
            part = MIMEApplication(att["data"])
            part.add_header("Content-Disposition", "attachment", filename=att["filename"])
            part.set_type(att.get("mime", "application/octet-stream"))
            root.attach(part)
    else:
        root = alt

    root["From"] = formataddr(("MWT.ONE · MCP", from_email))
    root["To"] = to_email
    root["Subject"] = subject
    root["Reply-To"] = from_email
    # Cabeceras de higiene de correo (faltaban → señales spam MISSING_MID/DATE):
    # Date y Message-ID siempre presentes, como esperan los filtros (Gmail…).
    root["Date"] = formatdate(localtime=True)
    root["Message-ID"] = make_msgid(domain="mwt.one")

    try:
        with smtplib.SMTP(host=host, port=port, timeout=30) as smtp:
            if starttls:
                smtp.starttls(context=ssl.create_default_context())
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_email, [to_email], root.as_string())
        return {"ok": True, "to": to_email}
    except Exception as exc:  # noqa: BLE001
        log.error("send_reply a %s falló: %s", to_email, exc)
        return {"ok": False, "to": to_email, "error": str(exc)}


def send_raw(to_email: str, *, subject: str, text_body: str, html_body: str | None = None,
             attachments: list[dict] | None = None) -> dict:
    """Envía un correo como mcp@mwt.one (SMTP 587 STARTTLS) con MIME correcto.

    Ruta robusta: a diferencia del EMAIL_BACKEND de Django (info@mwt.one, que
    está fallando auth), el buzón mcp@mwt.one autentica bien. Usado por los
    emails del onboarding (registro recibido, notificación a admins, activación).
    """
    from_email = _cfg("MCP_MAILBOX_FROM", "mcp@mwt.one")
    host = _cfg("MCP_SMTP_HOST", "mail.mwt.one")
    port = int(_cfg("MCP_SMTP_PORT", "587"))
    starttls = _cfg("MCP_SMTP_STARTTLS", "1").lower() in ("1", "true", "yes")
    user = _cfg("MCP_MAILBOX_USER", "")
    password = _cfg("MCP_MAILBOX_PASSWORD", "")

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body or "", "plain", "utf-8"))
    if html_body:
        alt.attach(MIMEText(html_body, "html", "utf-8"))

    if attachments:
        root = MIMEMultipart("mixed")
        root.attach(alt)
        for att in attachments:
            part = MIMEApplication(att["data"])
            part.add_header("Content-Disposition", "attachment", filename=att["filename"])
            part.set_type(att.get("mime", "application/octet-stream"))
            root.attach(part)
    else:
        root = alt

    root["From"] = formataddr(("MWT.ONE · MCP", from_email))
    root["To"] = to_email
    root["Subject"] = subject
    root["Reply-To"] = from_email
    root["Date"] = formatdate(localtime=True)
    root["Message-ID"] = make_msgid(domain="mwt.one")

    try:
        with smtplib.SMTP(host=host, port=port, timeout=30) as smtp:
            if starttls:
                smtp.starttls(context=ssl.create_default_context())
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_email, [to_email], root.as_string())
        return {"ok": True, "to": to_email}
    except Exception as exc:  # noqa: BLE001
        log.error("send_raw a %s falló: %s", to_email, exc)
        return {"ok": False, "to": to_email, "error": str(exc)}


# ── Procesamiento de un mensaje ────────────────────────────────────────

_SUBJECTS = {
    "ok": "Tus credenciales MCP · {empresa}",
    "no_registrado": "Regístrate para conectar tu IA a MWT.ONE",
    "inactivo": "Tu cuenta MWT.ONE aún no está activa",
    "sin_mcp": "Tu cuenta no tiene acceso MCP configurado",
    "elegir_empresa": "¿A qué empresa quieres conectar tu MCP?",
}


def _leading_text(body: str) -> str:
    """Texto 'nuevo' del correo: corta en la primera línea citada/forwarded.

    Evita que al responder (Gmail/Outlook citan el mensaje anterior) el parser
    lea la lista de empresas o la frase 'a más de una empresa' de la cita y
    vuelva a preguntar (loop).
    """
    out: list[str] = []
    for ln in (body or "").splitlines():
        s = ln.strip()
        low = s.lower()
        if s.startswith(">") or s.startswith("|"):
            break
        if re.search(r"(?i)(escribi|wrote:|from:|sent:|de: .*<.*?>|para: .*<.*?>|el d[ií]a .{3,}escrib|enviado (el|desde)|respondiendo a)", low):
            break
        if re.search(r"^[-=_\s]{6,}$", s):
            break
        out.append(s)
    return "\n".join(out)


def _empresa_candidates(lead: str) -> list[str]:
    """Líneas del texto 'nuevo' que podrían ser una empresa.

    Acepta cualquier forma: 'Empresa: X', 'Cliente: X', 'Razón social: X',
    o simplemente el nombre ('Sondel'). Excluye emails sueltos y saludos.
    """
    cands: list[str] = []
    seen: set[str] = set()

    def _add(v: str) -> None:
        v = re.sub(r"\s+", " ", v).strip().rstrip(".:-")
        if not v or v in seen or len(v) <= 2:
            return
        if re.match(r"^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$", v):
            return
        seen.add(v)
        cands.append(v)

    for ln in (lead or "").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        m = re.search(r"(?i)\b(empresa|compania|razon social|cliente)\b\s*[:=]?\s*(.+)", ln)
        if m:
            _add(m.group(2))
            continue
        if re.match(r"(?i)^(hola|buenas|buenos dias|gracias|saludos|por favor|necesito|quisiera|solicito|requiero)[\s,.:!]*$", ln):
            continue
        _add(ln)
    return cands


def _resolve_empresa(clients: list[dict], lead: str) -> dict | None:
    """Resuelve la empresa del texto 'nuevo' (cualquier forma de escribirla).

    Devuelve el cliente si hay exactamente UNA coincidencia entre todas las
    líneas candidatas; None si es ambiguo o no hay coincidencia (se pregunta).
    """
    matched_by_id: dict[str, dict] = {}
    for cand in _empresa_candidates(lead):
        for c in mcp_onboarding.match_clients_by_hint(clients, cand):
            matched_by_id.setdefault(c["cliente_id"], c)
    if len(matched_by_id) == 1:
        return next(iter(matched_by_id.values()))
    return None


def _extract_empresa_hint(body: str) -> str | None:
    """Pista de empresa (para el dry_run). 'ALL' si pide varias/todas,
    o la 1ª línea con 'Empresa:'/'Compania:'/'Cliente:'. El matching real de
    nombres pelados lo hace _empresa_candidates en el flujo de decisión.
    """
    if re.search(r"(?i)\b(todas|varias|todos|ambas|todas las empresas?)\b", body):
        return "ALL"
    for ln in body.splitlines():
        ln = ln.strip()
        m = re.search(r"(?i)\b(empresa|compania|razon social|cliente)\b\s*[:=]?\s*(.+)", ln)
        if m:
            val = m.group(2).strip().rstrip(".:-")
            val = re.sub(r"\s+", " ", val)
            if val:
                return val
    return None


def _send_credenciales(to_email: str, target: dict, client: dict,
                       base_ctx: dict) -> dict:
    """Emite el grant de una empresa y envía el paquete .json/.md."""
    grant = mcp_onboarding.emit_grant(target, client["cliente_id"], creado_via="email")
    package = mcp_onboarding.build_package(client, target, grant)
    ctx = dict(base_ctx, empresa=package["razon_social"], **package)
    ctx["texto_plano"] = (
        f"Tus credenciales MCP de {package['razon_social']} van adjuntas "
        f"({package['fname_json']} y {package['fname_md']}). Un solo uso por equipo."
    )
    subject = _SUBJECTS["ok"].format(empresa=package["razon_social"])
    return send_reply(
        to_email,
        subject=subject,
        template_key="mcp_credenciales",
        context=ctx,
        attachments=[
            {"filename": package["fname_json"], "data": package["json_text"].encode("utf-8"),
             "mime": package["mime_json"]},
            {"filename": package["fname_md"], "data": package["md_text"].encode("utf-8"),
             "mime": package["mime_md"]},
        ],
    )


def process_message(msg: Message, sender: str, from_name: str = "", dry_run: bool = False) -> dict:
    """Ruta un mensaje: decide escenario, emite grant y responde.

    Con dry_run=True NO emite grant, NO envía y NO mueve el mensaje (solo
    clasifica y deja claro qué haría).
    """
    body_plain, body_html = _body_texts(msg)
    body = f"{body_plain}\n{_strip_html(body_html)}"
    lead = _leading_text(body)          # solo texto nuevo (sin citas)
    target_email = _extract_target_email(lead, sender, from_name)
    if not target_email:
        return {"ok": False, "error": "sin email objetivo", "from": sender}

    decision = mcp_onboarding.decide_scenario(target_email)
    scenario = decision.get("scenario", "no_registrado")
    target = decision.get("target") or {}
    base_ctx = {
        "email": target_email,
        "nombre": target.get("full_name") or "",
        "texto_plano": "",
    }
    empresa_hint = _extract_empresa_hint(lead)

    if dry_run:
        return {
            "ok": True, "scenario": scenario, "target": target_email,
            "dry_run": True, "empresa_hint": empresa_hint,
            "clients": decision.get("clients") or [],
        }

    def _elegir_reply():
        clients = decision.get("clients") or []
        ctx = dict(base_ctx, empresas=[{"razon_social": c.get("razon_social") or c.get("nombre"),
                                        "slug": c.get("slug")} for c in clients])
        return send_reply(target_email, subject=_SUBJECTS["elegir_empresa"],
                          template_key="mcp_elegir_empresa", context=ctx)

    if scenario == "ok":
        res = _send_credenciales(target_email, target, decision["client"], base_ctx)
    elif scenario == "elegir_empresa":
        clients = decision.get("clients") or []
        if empresa_hint == "ALL":
            # Pedir varias/todas → un paquete por empresa.
            sent, failed = 0, 0
            for c in clients:
                r = _send_credenciales(target_email, target, c, base_ctx)
                if r.get("ok"):
                    sent += 1
                else:
                    failed += 1
            res = {"ok": sent > 0, "to": target_email,
                   "sent": sent, "failed": failed}
        else:
            # Matchear TODAS las líneas candidatas contra los clientes del
            # usuario (acepta 'Empresa:'/'Cliente:' o el nombre pelado). Si
            # exactamente una empresa coincide → esa; si varias → pedir elegir.
            resolved = _resolve_empresa(clients, lead)
            if resolved:
                res = _send_credenciales(target_email, target, resolved, base_ctx)
                scenario = "ok"
            else:
                res = _elegir_reply()
    else:
        ctx = dict(base_ctx, empresa=(decision.get("client") or {}).get("razon_social") or "")
        res = send_reply(target_email, subject=_SUBJECTS.get(scenario, "Respuesta MWT.ONE"),
                         template_key=f"mcp_{scenario}", context=ctx)

    return {"ok": res.get("ok"), "scenario": scenario, "target": target_email, **res}


# ── Poller IMAP (una pasada) ───────────────────────────────────────────

def poll_once(max_messages: int = 25, dry_run: bool = False) -> dict:
    """Conecta al INBOX de mcp@mwt.one y procesa hasta N mensajes no vistos."""
    if not mailbox_configured():
        return {"skipped": True, "reason": "MCP_MAILBOX_USER/PASSWORD sin configurar"}

    host = _cfg("MCP_MAILBOX_IMAP_HOST", "mail.mwt.one")
    port = int(_cfg("MCP_MAILBOX_IMAP_PORT", "993"))
    ssl_on = _cfg("MCP_MAILBOX_IMAP_SSL", "1").lower() in ("1", "true", "yes")
    user = _cfg("MCP_MAILBOX_USER", "")
    password = _cfg("MCP_MAILBOX_PASSWORD", "")

    summary: dict = {"fetched": 0, "processed": 0, "scenarios": {}, "errors": []}
    try:
        if ssl_on:
            context = ssl.create_default_context()
            M = imaplib.IMAP4_SSL(host, port, ssl_context=context)
        else:
            M = imaplib.IMAP4(host, port)
        M.login(user, password)
        typ, _ = M.select("INBOX", readonly=False)
        if typ != "OK":
            M.logout()
            return {**summary, "error": f"select INBOX: {typ}"}

        typ, data = M.search(None, "UNSEEN")
        if typ != "OK":
            M.logout()
            return {**summary, "error": "search UNSEEN falló"}
        uids = (data[0] or b"").split()[:max_messages]
        summary["fetched"] = len(uids)

        for raw_uid in uids:
            uid = raw_uid.decode("ascii")
            typ, msgdata = M.fetch(raw_uid, "(RFC822)")
            if typ != "OK" or not msgdata or not isinstance(msgdata[0], tuple):
                summary["errors"].append(f"fetch {uid} falló")
                continue
            try:
                parsed = email.message_from_bytes(msgdata[0][1])
                sender_raw = _decoded(parsed.get("From", ""))
                from_name, sender_addr = parseaddr(sender_raw)
                result = process_message(parsed, sender_addr.lower(), from_name or "",
                                         dry_run=dry_run)
                summary["processed"] += 1
                scenario = result.get("scenario", "?")
                summary["scenarios"][scenario] = summary["scenarios"].get(scenario, 0) + 1
                if result.get("ok") and not dry_run:
                    # mueve a Procesados; si falla, marca como visto igualmente
                    try:
                        M.create(DONE_FOLDER)
                    except Exception:  # noqa: BLE001
                        pass
                    mv_typ, _ = M.copy(raw_uid, DONE_FOLDER)
                    if mv_typ == "OK":
                        M.store(raw_uid, "+FLAGS", "\\Deleted")
                    else:
                        M.store(raw_uid, "+FLAGS", "\\Seen")
            except Exception as exc:  # noqa: BLE001
                log.exception("mensaje %s falló", uid)
                summary["errors"].append(f"{uid}: {exc}")
        M.expunge()
        M.logout()
    except Exception as exc:  # noqa: BLE001
        log.exception("poll_once falló")
        summary["errors"].append(str(exc))
    return summary
