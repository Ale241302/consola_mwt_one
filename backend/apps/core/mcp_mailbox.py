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
from email.utils import formataddr, parseaddr
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

    root = MIMEMultipart("alternative")
    root["From"] = formataddr(("MWT.ONE · MCP", from_email))
    root["To"] = to_email
    root["Subject"] = subject
    root["Reply-To"] = from_email

    root.attach(MIMEText(text_body, "plain", "utf-8"))
    if html_body:
        root.attach(MIMEText(html_body, "html", "utf-8"))

    if attachments:
        mixed = MIMEMultipart("mixed")
        mixed["From"] = root["From"]
        mixed["To"] = root["To"]
        mixed["Subject"] = root["Subject"]
        mixed["Reply-To"] = root["Reply-To"]
        # movemos el cuerpo alternativo dentro del mixto
        for part in list(root.get_payload()):
            mixed.attach(part)
        for att in attachments:
            part = MIMEApplication(att["data"])
            part.add_header("Content-Disposition", "attachment", filename=att["filename"])
            part.set_type(att.get("mime", "application/octet-stream"))
            mixed.attach(part)
        root = mixed

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


# ── Procesamiento de un mensaje ────────────────────────────────────────

_SUBJECTS = {
    "ok": "Tus credenciales MCP · {empresa}",
    "no_registrado": "Regístrate para conectar tu IA a MWT.ONE",
    "inactivo": "Tu cuenta MWT.ONE aún no está activa",
    "sin_mcp": "Tu cuenta no tiene acceso MCP configurado",
    "elegir_empresa": "¿A qué empresa quieres conectar tu MCP?",
}


def process_message(msg: Message, sender: str, from_name: str = "", dry_run: bool = False) -> dict:
    """Ruta un mensaje: decide escenario, emite grant y responde.

    Con dry_run=True NO emite grant, NO envía y NO mueve el mensaje (solo
    clasifica y deja claro qué haría).
    """
    body_plain, body_html = _body_texts(msg)
    body = f"{body_plain}\n{_strip_html(body_html)}"
    target_email = _extract_target_email(body, sender, from_name)
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

    if dry_run:
        return {
            "ok": True, "scenario": scenario, "target": target_email,
            "dry_run": True,
            "clients": decision.get("clients") or [],
        }

    if scenario == "ok":
        client = decision["client"]
        grant = mcp_onboarding.emit_grant(target, client["cliente_id"], creado_via="email")
        package = mcp_onboarding.build_package(client, target, grant)
        ctx = dict(base_ctx, empresa=package["razon_social"], **package)
        ctx["texto_plano"] = (
            f"Tus credenciales MCP de {package['razon_social']} van adjuntas "
            f"({package['fname_json']} y {package['fname_md']}). Un solo uso por equipo."
        )
        subject = _SUBJECTS["ok"].format(empresa=package["razon_social"])
        res = send_reply(
            target_email,
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
    elif scenario == "elegir_empresa":
        clients = decision.get("clients") or []
        ctx = dict(base_ctx, empresas=[{"razon_social": c.get("razon_social") or c.get("nombre"),
                                        "slug": c.get("slug")} for c in clients])
        res = send_reply(target_email, subject=_SUBJECTS["elegir_empresa"],
                         template_key="mcp_elegir_empresa", context=ctx)
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
