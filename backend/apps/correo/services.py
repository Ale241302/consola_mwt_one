"""
apps.correo · services (Etapa 3)
- Sincronización IMAP (recibidos/enviados) con deduplicación por Message-ID.
- Correlación de mensajes con expediente (proforma / SAP / hilo).
- Importación desde fuentes externas (p. ej. Hostinger Mail MCP).
- Traducción del borrador (ES -> idioma del receptor).
- Envío SMTP explícito.
"""
from __future__ import annotations

import hashlib
import imaplib
import json
import logging
import re
import smtplib
import ssl
import uuid
from datetime import datetime, timezone as _tz
from email import message_from_bytes, utils as email_utils
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from django.conf import settings
from django.db import IntegrityError, connection

from .models import Adjunto, Contacto, Envio, Mensaje

log = logging.getLogger(__name__)

_RE_PROFORMA = re.compile(r"\b(\d{3,4}-\d{4})\b")
_RE_SAP      = re.compile(r"\b(\d{6,10})\b")


# ── Config helpers ──────────────────────────────────────────────────
def _cfg(name, default=None):
    return getattr(settings, name, default)


def _imap_params():
    host = _cfg("CORREO_IMAP_HOST") or _cfg("MCP_MAILBOX_IMAP_HOST") or _cfg("EMAIL_HOST")
    user = _cfg("CORREO_IMAP_USER") or _cfg("MCP_MAILBOX_USER") or _cfg("EMAIL_HOST_USER")
    pwd  = _cfg("CORREO_IMAP_PASSWORD") or _cfg("MCP_MAILBOX_PASSWORD") or _cfg("EMAIL_HOST_PASSWORD")
    port = int(_cfg("CORREO_IMAP_PORT") or _cfg("MCP_MAILBOX_IMAP_PORT") or 993)
    ssl_ = str(_cfg("CORREO_IMAP_SSL", _cfg("MCP_MAILBOX_IMAP_SSL", "1"))).lower() not in ("0", "false", "")
    return {"host": host, "user": user, "password": pwd, "port": port, "ssl": ssl_}


def _smtp_params():
    host = _cfg("CORREO_SMTP_HOST") or _cfg("MCP_SMTP_HOST") or _cfg("EMAIL_HOST")
    user = _cfg("CORREO_SMTP_USER") or _cfg("MCP_MAILBOX_USER") or _cfg("EMAIL_HOST_USER")
    pwd  = _cfg("CORREO_SMTP_PASSWORD") or _cfg("MCP_MAILBOX_PASSWORD") or _cfg("EMAIL_HOST_PASSWORD")
    port = int(_cfg("CORREO_SMTP_PORT") or _cfg("MCP_SMTP_PORT") or 587)
    start = str(_cfg("CORREO_SMTP_STARTTLS", _cfg("MCP_SMTP_STARTTLS", "1"))).lower() not in ("0", "false", "")
    frm  = _cfg("CORREO_FROM") or _cfg("MCP_MAILBOX_FROM") or _cfg("DEFAULT_FROM_EMAIL") or user
    return {"host": host, "user": user, "password": pwd, "port": port, "starttls": start, "from": frm}


# ── Parseo MIME ─────────────────────────────────────────────────────
def _addr_list(msg, field):
    vals = msg.get_all(field) or []
    out = []
    for v in vals:
        for name, addr in email_utils.getaddresses([v]):
            if addr:
                out.append(addr.strip().lower())
    return out


def _body_texts(msg):
    """Devuelve (texto_plano, html) concatenados del mensaje."""
    textos, htmls = [], []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get_content_disposition() == "attachment":
                continue
            try:
                payload = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "utf-8"
                txt = payload.decode(charset, errors="replace")
            except Exception:
                continue
            if ctype == "text/plain":
                textos.append(txt)
            elif ctype == "text/html":
                htmls.append(txt)
    else:
        try:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            txt = payload.decode(charset, errors="replace")
            (htmls if msg.get_content_type() == "text/html" else textos).append(txt)
        except Exception:
            pass
    return "\n".join(textos).strip(), "\n".join(htmls).strip()


def _attachments(msg):
    out = []
    for part in msg.walk():
        if part.get_content_disposition() != "attachment":
            continue
        fn = part.get_filename()
        if not fn:
            continue
        payload = part.get_payload(decode=True) or b""
        out.append({
            "filename": fn,
            "mimetype": part.get_content_type(),
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        })
    return out


def _parse_date(msg):
    raw = msg.get("Date")
    if not raw:
        return None
    try:
        dt = email_utils.parsedate_to_datetime(raw)
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=_tz.utc)
        return dt
    except Exception:
        return None


# ── Correlación ─────────────────────────────────────────────────────
def correlacionar(proforma=None, sap=None, subject=None, body=None, from_email=None):
    """Devuelve (expediente_id, oc_id, proforma, sap, status, reason)."""
    text = " ".join([subject or "", body or ""])
    prof = (proforma or "").strip() or (m.group(1) if (m := _RE_PROFORMA.search(text)) else None)
    sapv = (sap or "").strip() or (m.group(1) if (m := _RE_SAP.search(text)) else None)

    with connection.cursor() as c:
        if prof:
            c.execute("""
                SELECT e.id::text, e.oc_id::text
                  FROM expedientes.documento d
                  JOIN expedientes.expediente e ON e.id = d.expediente_id
                 WHERE d.kind = 'PROFORMA' AND d.is_active AND e.is_active
                   AND replace(d.codigo, 'PF ', '') = %s
                 ORDER BY d.created_at DESC LIMIT 1
            """, [prof])
            row = c.fetchone()
            if row:
                return row[0], row[1], prof, sapv, "AUTO", f"proforma:{prof}"
        if sapv:
            c.execute("""
                SELECT DISTINCT l.expediente_id::text, l.oc_id::text
                  FROM expedientes.linea l
                 WHERE l.is_active AND l.sap = %s AND l.expediente_id IS NOT NULL
                 LIMIT 1
            """, [sapv])
            row = c.fetchone()
            if row:
                return row[0], row[1], prof, sapv, "AUTO", f"sap:{sapv}"
    return None, None, prof, sapv, "POR_VINCULAR", "sin_referencia"


def _notify_tarea_seguimiento(expediente_id, subject, user_id=None):
    """Crea/renueva tarea de seguimiento de correo para el expediente (best-effort)."""
    if not expediente_id:
        return
    try:
        from apps.tareas import services as tserv
        tserv.ensure_auto(
            {"id": expediente_id, "oc_id": None, "client_id": None},
            "SEGUIMIENTO_SIN_RESPUESTA",
            due=tserv.add_business_days(datetime.now(_tz.utc).date(), 3),
            user_id=user_id,
        )
    except Exception as exc:
        log.warning("[correo] no pude crear seguimiento: %s", exc)


# ── Persistencia ────────────────────────────────────────────────────
def upsert_mensaje(data: dict) -> dict | None:
    """Inserta/actualiza un mensaje deduplicando por message_id. Devuelve el dict."""
    mid = (data.get("message_id") or "").strip() or None
    if mid:
        existing = Mensaje.objects.filter(message_id=mid).first()
        if existing:
            return {"id": str(existing.id), "dedup": True}

    exp_id, oc_id, prof, sapv, status, reason = correlacionar(
        proforma=data.get("proforma"), sap=data.get("sap"),
        subject=data.get("subject"), body=data.get("body_text"),
        from_email=data.get("from_email"),
    )
    new_id = str(uuid.uuid4())
    try:
        Mensaje.objects.create(
            id=new_id,
            message_id=mid,
            thread_key=data.get("thread_key"),
            folder=data.get("folder"),
            direction=data.get("direction", "IN"),
            from_email=data.get("from_email"),
            from_name=data.get("from_name"),
            to_emails=data.get("to_emails") or [],
            cc_emails=data.get("cc_emails") or [],
            subject=data.get("subject"),
            sent_at=data.get("sent_at"),
            received_at=data.get("received_at"),
            body_text=data.get("body_text"),
            body_html=data.get("body_html"),
            has_attachments=bool(data.get("adjuntos")),
            expediente_id=exp_id,
            oc_id=oc_id,
            proforma=prof,
            sap=sapv,
            match_status=status,
            match_reason=reason,
            is_read=False,
            is_active=True,
            source=data.get("source", "IMAP"),
            raw_ref=data.get("raw_ref"),
        )
    except IntegrityError:
        return None
    for a in (data.get("adjuntos") or []):
        try:
            Adjunto.objects.create(
                id=uuid.uuid4(), mensaje_id=new_id,
                filename=a.get("filename"), mimetype=a.get("mimetype"),
                size_bytes=a.get("size_bytes"), storage_key=a.get("storage_key"),
                sha256=a.get("sha256"),
            )
        except Exception:
            pass
    return {"id": new_id, "dedup": False, "expediente_id": exp_id, "match_status": status}


def importar_mensaje(payload: dict, user_id=None) -> dict:
    """Importa un mensaje ya parseado (desde MCP/otra fuente)."""
    if payload.get("direction") == "OUT":
        _notify_tarea_seguimiento(payload.get("expediente_id"), payload.get("subject"), user_id)
    res = upsert_mensaje(payload) or {"ok": False, "reason": "duplicado o invalido"}
    return {"ok": True, **res}


# ── IMAP sync ───────────────────────────────────────────────────────
def _imap_connect(p):
    if p["ssl"]:
        M = imaplib.IMAP4_SSL(p["host"], p["port"])
    else:
        M = imaplib.IMAP4(p["host"], p["port"])
        try:
            M.starttls(ssl.create_default_context())
        except Exception:
            pass
    M.login(p["user"], p["password"])
    return M


def _sync_folder(M, folder, direction, limit, search):
    try:
        typ, _ = M.select(folder)
        if typ != "OK":
            return []
    except Exception:
        return []
    try:
        typ, data = M.search(None, search)
        uids = (data[0].split() if data and data[0] else [])[-limit:]
    except Exception:
        return []
    out = []
    for uid in uids:
        try:
            typ, msg_data = M.fetch(uid, "(RFC822)")
            raw = msg_data[0][1]
        except Exception:
            continue
        msg = message_from_bytes(raw)
        text, html = _body_texts(msg)
        dt = _parse_date(msg)
        froms = _addr_list(msg, "From")
        out.append({
            "message_id": (msg.get("Message-ID") or "").strip() or None,
            "thread_key": (msg.get("References") or "").split()[0] if msg.get("References") else (msg.get("In-Reply-To") or "").strip() or None,
            "folder": folder,
            "direction": direction,
            "from_email": froms[0] if froms else None,
            "from_name": email_utils.getaddresses([msg.get("From", "")])[0][0] if msg.get("From") else None,
            "to_emails": _addr_list(msg, "To"),
            "cc_emails": _addr_list(msg, "Cc"),
            "subject": msg.get("Subject"),
            "sent_at": dt,
            "received_at": dt if direction == "IN" else None,
            "body_text": text,
            "body_html": html,
            "adjuntos": _attachments(msg),
            "source": "IMAP",
        })
    return out


def sync_mailbox(direction=None, limit=25) -> dict:
    p = _imap_params()
    if not (p["host"] and p["user"] and p["password"]):
        return {"ok": False, "reason": "no_credentials", "importados": 0}
    try:
        M = _imap_connect(p)
    except Exception as exc:
        log.warning("[correo.sync] IMAP login fallo: %s", exc)
        return {"ok": False, "reason": f"imap_error: {exc}", "importados": 0}

    importados = 0
    try:
        if direction in (None, "IN"):
            inbox = _cfg("CORREO_INBOX_FOLDER", "INBOX")
            for data in _sync_folder(M, inbox, "IN", limit, "UNSEEN"):
                r = upsert_mensaje(data)
                if r and not r.get("dedup"):
                    importados += 1
        if direction in (None, "OUT"):
            sent = _cfg("CORREO_SENT_FOLDER", "INBOX.Sent")
            for data in _sync_folder(M, sent, "OUT", limit, "ALL"):
                r = upsert_mensaje(data)
                if r and not r.get("dedup"):
                    importados += 1
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return {"ok": True, "importados": importados}


# ── Traducción ──────────────────────────────────────────────────────
def traducir(texto: str, idioma_destino: str, idioma_origen: str = "es") -> str | None:
    """Traduce con OpenAI si hay API key; None si no está disponible."""
    if not texto or not idioma_destino:
        return None
    import os
    key = os.environ.get("OPENAI_API_KEY") or (_cfg("AI_HUB", {}) or {}).get("OPENAI_API_KEY")
    if not key:
        return None
    model = os.environ.get("OPENAI_OCR_MODEL") or "gpt-5-nano"
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key, timeout=60, max_retries=1)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content":
                 f"Traduce el correo del {idioma_origen} al {idioma_destino}. "
                 "Conserva el formato, la firma y los datos (precios, fechas, referencias) EXACTOS. "
                 "Devuelve SOLO la traducción, sin comentarios."},
                {"role": "user", "content": texto},
            ],
        )
        return (resp.choices[0].message.content or "").strip() or None
    except Exception as exc:
        log.warning("[correo.traducir] fallo: %s", exc)
        return None


# ── Envío SMTP ──────────────────────────────────────────────────────
def enviar_envio(envio: Envio, user_id=None) -> dict:
    s = _smtp_params()
    if not (s["host"] and s["user"] and s["password"]):
        return {"ok": False, "reason": "no_credentials"}
    dest = envio.destinatarios or []
    if not dest:
        return {"ok": False, "reason": "sin_destinatarios"}
    body = envio.body_traducido or envio.body_es or ""
    msg = MIMEMultipart("mixed")
    msg["Subject"] = envio.subject or ""
    msg["From"] = s["from"]
    msg["To"] = ", ".join(dest)
    if envio.cc:
        msg["Cc"] = ", ".join(envio.cc)
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(body, "plain", "utf-8"))
    msg.attach(alt)
    all_rcpt = list(dest) + list(envio.cc or []) + list(envio.bcc or [])
    try:
        if int(s["port"]) == 465:
            smtp = smtplib.SMTP_SSL(s["host"], int(s["port"]), timeout=30, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(s["host"], int(s["port"]), timeout=30)
            if s["starttls"]:
                smtp.starttls(context=ssl.create_default_context())
        if s["user"]:
            smtp.login(s["user"], s["password"])
        smtp.sendmail(s["from"], all_rcpt, msg.as_string())
        smtp.quit()
    except Exception as exc:
        envio.estado = "ERROR"
        envio.error = str(exc)[:500]
        envio.save(update_fields=["estado", "error", "updated_at"])
        return {"ok": False, "reason": f"smtp_error: {exc}"}

    now = datetime.now(_tz.utc)
    envio.estado = "ENVIADO"
    envio.sent_at = now
    envio.message_id = msg.get("Message-ID") or None
    envio.save(update_fields=["estado", "sent_at", "message_id", "updated_at"])
    # Registrar en el historial como saliente.
    upsert_mensaje({
        "message_id": envio.message_id,
        "direction": "OUT",
        "from_email": s["from"],
        "to_emails": dest, "cc_emails": envio.cc or [],
        "subject": envio.subject, "sent_at": now,
        "body_text": body, "adjuntos": envio.adjuntos or [],
        "source": "ENVIO", "folder": "Enviados",
    })
    return {"ok": True, "message_id": envio.message_id}
