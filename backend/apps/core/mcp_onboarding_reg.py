"""
=====================================================================
MWT.ONE · apps.core.mcp_onboarding_reg
Onboarding MCP — registro público pendiente de aprobación (Fase 2).

Servicio de dominio que apoya el formulario público /registro-mcp:

  · search_registrable_clients(q)   → clientes con MCP provisionado +
                                       sus subsidiarias (autocomplete).
  · create_registration(payload, ip) → valida, hashea el password (los DOS
                                       formatos), inserta en
                                       users.registration_request (PENDIENTE),
                                       notifica admins (activity_feed + email)
                                       y avisa al solicitante.
  · aprobar_solicitud(req_id, admin) → crea el usuario ACTIVO (mwtuser +
                                       core.users + Authentik), emite el
                                       grant MCP device-bound y envía el
                                       email de activación con .json/.md.
  · rechazar_solicitud(req_id, motivo)

El password NUNCA se guarda en claro: se persisten password_pbkdf2
(users.mwtuser) y password_core_sha256 (core.users) para que la activación
reconstruya el login sin conocer el raw.
=====================================================================
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone
from email.utils import formatdate, make_msgid
from typing import Any

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from django.template.loader import render_to_string

from . import mcp_onboarding

log = logging.getLogger("mwt_mcp.onboarding.reg")

ADMIN_NOTIFY_ROLES = ("admin", "superadmin", "ceo")
ROLE_CLIENT = "client_b2b"

# Email al que los usuarios contestan (buzón del pipeline Fase 1).
def _reply_to() -> str:
    return getattr(settings, "MCP_MAILBOX_FROM", "mcp@mwt.one")


def _consola_url() -> str:
    return getattr(settings, "CONSOLA_PUBLIC_URL", "https://consola.mwt.one")


# ── Hash (espejo de apps/users/views.py) ───────────────────────────────

def _hash_password(raw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${h.hex()}"


def _core_sha256(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Queries de catálogo / estado ───────────────────────────────────────

def _mcp_cliente_provisionado(cliente_id: str) -> bool:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM core.mcp_app a
            JOIN clientes.cliente c ON c.id = a.cliente_id
            WHERE a.cliente_id = %s AND a.estado = 'PROVISIONED'
              AND a.mcp_url IS NOT NULL AND a.mcp_url <> ''
              AND c.is_active = TRUE AND c.estado = 'ACTIVO'
            """,
            [cliente_id],
        )
        return cur.fetchone() is not None


def search_registrable_clients(q: str = "", limit: int = 20) -> list[dict]:
    """Clientes (MCP provisionado) + sus subsidiarias activas, por texto."""
    with connection.cursor() as cur:
        cur.execute(
            """
            WITH prov AS (
                SELECT c.id::text, c.razon_social, c.nombre_comercial, c.parent_id::text
                  FROM core.mcp_app a
                  JOIN clientes.cliente c ON c.id = a.cliente_id
                 WHERE a.estado = 'PROVISIONED'
                   AND a.mcp_url IS NOT NULL AND a.mcp_url <> ''
                   AND c.is_active = TRUE AND c.estado = 'ACTIVO'
            )
            SELECT p.id, p.razon_social, p.nombre_comercial, p.parent_id
              FROM prov p
             UNION
            SELECT c.id::text, c.razon_social, c.nombre_comercial, c.parent_id::text
              FROM clientes.cliente c
              JOIN prov p ON c.parent_id::text = p.id
             WHERE c.is_active = TRUE AND c.estado = 'ACTIVO'
             ORDER BY 2 ASC
            """,
        )
        cols = ["id", "razon_social", "nombre_comercial", "parent_id"]
        rows = [dict(zip(cols, (r[0], r[1], r[2], r[3]))) for r in cur.fetchall()]
    ql = (q or "").strip().lower()
    out = []
    for r in rows:
        hay = " ".join(x for x in [r.get("razon_social"), r.get("nombre_comercial")] if x).lower()
        if ql and ql not in hay:
            continue
        out.append({
            "id": r["id"],
            "razon_social": r["razon_social"],
            "nombre_comercial": r["nombre_comercial"],
            "parent_id": r["parent_id"],
            "is_subsidiary": bool(r["parent_id"]),
        })
        if len(out) >= limit:
            break
    return out


def _cliente_info(cliente_id: str) -> dict | None:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, razon_social, nombre_comercial, parent_id::text
              FROM clientes.cliente WHERE id = %s AND is_active = TRUE
            """,
            [cliente_id],
        )
        r = cur.fetchone()
        if not r:
            return None
        return {"id": r[0], "razon_social": r[1] or r[2] or "", "parent_id": r[3]}


def _resolve_legal_scope(cliente_id: str) -> tuple[list[str], str]:
    """legal_entity_ids para el nuevo usuario según la empresa elegida.

    Regla: si la empresa elegida tiene app MCP propia → [ella]. Si es una
    subsidiaria sin app propia pero su padre tiene MCP → scope del padre
    (el usuario operará con la app del padre). El nombre a mostrar es el de
    la empresa elegida.
    """
    info = _cliente_info(cliente_id)
    if not info:
        return [], ""
    label = info["razon_social"] or cliente_id
    if _mcp_cliente_provisionado(cliente_id):
        return [cliente_id], label
    parent = info.get("parent_id")
    if parent and _mcp_cliente_provisionado(parent):
        return [parent], label
    return [cliente_id], label


def _email_registrado(email: str) -> bool:
    """¿Existe un usuario ACTIVO con ese email? (para el formulario público).

    Solo cuenta un usuario activo (is_active TRUE y, en core.users, sin
    deleted_at). Un usuario eliminado/inactivo se considera NO registrado,
    para poder volver a pre-registrarse.
    """
    email_low = (email or "").strip().lower()
    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM users.mwtuser WHERE lower(trim(email_plain)) = %s AND is_active = TRUE LIMIT 1",
            [email_low],
        )
        if cur.fetchone():
            return True
        cur.execute(
            "SELECT 1 FROM core.users WHERE lower(email_plain) = %s AND is_active = TRUE AND deleted_at IS NULL LIMIT 1",
            [email_low],
        )
        return cur.fetchone() is not None


def _pending_existe(email: str) -> bool:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM users.registration_request
             WHERE email_low = %s AND estado = 'PENDIENTE' LIMIT 1
            """,
            [(email or "").strip().lower()],
        )
        return cur.fetchone() is not None


# ── Email genérico (Django mail + adjuntos en memoria) ─────────────────

def send_mail_tpl(to: str, subject: str, template_key: str, context: dict,
                  attachments: list[dict] | None = None) -> dict:
    ctx = {"consola_url": _consola_url()}
    ctx.update(context or {})
    try:
        html = render_to_string(f"emails/{template_key}.html", ctx)
    except Exception:  # noqa: BLE001
        html = ""
    try:
        txt = render_to_string(f"emails/{template_key}.txt", ctx)
    except Exception:  # noqa: BLE001
        txt = str(context.get("texto_plano") or "")
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "info@mwt.one")
    try:
        msg = EmailMultiAlternatives(subject, txt, from_email, [to],
                                     headers={
                                         "Date": formatdate(localtime=True),
                                         "Message-ID": make_msgid(domain="mwt.one"),
                                     },
                                     reply_to=[_reply_to()])
        if html:
            msg.attach_alternative(html, "text/html")
        for att in attachments or []:
            msg.attach(att["filename"], att["data"], att.get("mime", "application/octet-stream"))
        msg.send(fail_silently=False)
        return {"ok": True, "to": to}
    except Exception as exc:  # noqa: BLE001
        log.exception("send_mail_tpl %s a %s falló", template_key, to)
        return {"ok": False, "to": to, "error": str(exc)}


# ── Notificación a admins (activity_feed + email) ──────────────────────

def _admin_emails() -> list[dict]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, email_plain, full_name FROM users.mwtuser
             WHERE is_active = TRUE
               AND COALESCE(is_api_user, FALSE) = FALSE
               AND (lower(role_default) = ANY(%s) OR is_superuser = TRUE)
            """,
            [list(ADMIN_NOTIFY_ROLES)],
        )
        cols = ["id", "email", "name"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _push_activity_feed(user_id: str, kind: str, title: str, body: str,
                        deep_link: str, related_id: str) -> None:
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users.activity_feed
                (id, user_id, kind, title, body, icon, severity,
                 deep_link, related_type, related_id, is_active)
            VALUES (%s, %s, %s, %s, %s, 'inbox', 'INFO', %s,
                    'registration_request', %s, TRUE)
            """,
            [str(uuid.uuid4()), user_id, kind, title, body, deep_link, related_id],
        )


def notify_admins(req_id: str, solicitante: dict, empresa: str) -> None:
    admins = _admin_emails()
    if not admins:
        log.info("sin admins para notificar (registro %s)", req_id)
        return
    deep = f"/registro-solicitudes"
    title = "Nueva solicitud de acceso MCP"
    body = (f"{solicitante.get('email')} solicitó acceso MCP de {empresa or '…'} "
            f"para su equipo.")
    for a in admins:
        try:
            _push_activity_feed(a["id"], "registration.pending", title, body, deep, req_id)
        except Exception:  # noqa: BLE001
            log.exception("activity_feed a admin falló")
    ctx = {
        "solicitante_email": solicitante.get("email") or "",
        "nombre": solicitante.get("full_name") or "",
        "phone": solicitante.get("phone") or "",
        "empresa": empresa or "",
        "fecha": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
    # Email: envío simple para la lista completa de admins.
    try:
        html = render_to_string("emails/mcp_admin_notificacion.html", {**ctx, "consola_url": _consola_url()})
    except Exception:  # noqa: BLE001
        html = ""
    try:
        txt = render_to_string("emails/mcp_admin_notificacion.txt", ctx)
    except Exception:  # noqa: BLE001
        txt = f"Nueva solicitud MCP de {ctx['solicitante_email']} ({ctx['empresa']})"
    try:
        msg = EmailMultiAlternatives(
            "Nueva solicitud de acceso MCP",
            txt,
            getattr(settings, "DEFAULT_FROM_EMAIL", "info@mwt.one"),
            [a["email"] for a in admins],
            headers={
                "Date": formatdate(localtime=True),
                "Message-ID": make_msgid(domain="mwt.one"),
            },
        )
        if html:
            msg.attach_alternative(html, "text/html")
        msg.send(fail_silently=True)
    except Exception:  # noqa: BLE001
        log.exception("email a admins falló")


# ── Alta de solicitud (registro público) ───────────────────────────────

def create_registration(payload: dict, ip: str | None = None,
                        user_agent: str | None = None) -> dict:
    email = (payload.get("email") or "").strip().lower()
    raw_pwd = payload.get("password") or ""
    cliente_id = str(payload.get("cliente_id") or "").strip()
    full_name = (payload.get("full_name") or "").strip()

    if not email or "@" not in email:
        return {"ok": False, "detail": "Email inválido."}
    if len(raw_pwd) < 8:
        return {"ok": False, "detail": "La contraseña debe tener al menos 8 caracteres."}
    if _email_registrado(email):
        return {"ok": False, "detail": "Ese correo ya está registrado en la consola.", "code": "EMAIL_EXISTE"}
    if _pending_existe(email):
        return {"ok": False, "detail": "Ya existe una solicitud pendiente para ese correo.", "code": "PENDIENTE_EXISTE"}
    if not cliente_id:
        return {"ok": False, "detail": "Selecciona una empresa."}

    leids, label = _resolve_legal_scope(cliente_id)
    if not _mcp_cliente_provisionado(cliente_id):
        # si resolvimos hacia el padre, validar el padre
        if not leids or not _mcp_cliente_provisionado(leids[0]):
            return {"ok": False, "detail": "La empresa seleccionada no tiene acceso MCP.", "code": "SIN_MCP"}
        label = label or cliente_id

    addresses = payload.get("addresses") or []
    req_id = str(uuid.uuid4())
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users.registration_request
                    (id, email, email_low, full_name, contact_email, phone,
                     password_pbkdf2, password_core_sha256,
                     cliente_id, cliente_razon, legal_entity_ids,
                     role_default, addresses, estado, ip_origen, user_agent)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        'PENDIENTE', %s, %s)
                """,
                [
                    req_id, email, email, full_name,
                    (payload.get("contact_email") or "").strip() or None,
                    (payload.get("phone") or "").strip() or None,
                    _hash_password(raw_pwd), _core_sha256(raw_pwd),
                    cliente_id, label, leids,
                    payload.get("role_default") or ROLE_CLIENT,
                    __import__("json").dumps(addresses),
                    ip, (user_agent or "")[:300],
                ],
            )

    # Notificaciones fuera de la TX (best-effort).
    send_mail_tpl(
        email,
        "Recibimos tu solicitud de acceso MCP",
        "mcp_registro_recibido",
        {"email": email, "nombre": full_name, "empresa": label},
    )
    notify_admins(req_id, {"email": email, "full_name": full_name,
                           "phone": payload.get("phone")}, label)
    return {"ok": True, "id": req_id, "detail": "Solicitud creada, pendiente de aprobación."}


# ── Aprobación (activa usuario + grant + email con credenciales) ───────

def _core_upsert_hashed(*, email: str, full_name: str, role: str,
                        pwd_hash: str, user_uuid: str) -> None:
    """UPSERT en core.users con un hash ya calculado (sin raw)."""
    email_low = (email or "").strip().lower()
    with connection.cursor() as cur:
        cur.execute(
            "SELECT id FROM core.users WHERE lower(email_plain) = %s LIMIT 1",
            [email_low],
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                """
                UPDATE core.users
                   SET password_hash = %s, hash_kind = 'sha256',
                       full_name = %s, role = %s, is_active = TRUE,
                       is_staff = TRUE, deleted_at = NULL, updated_at = NOW()
                 WHERE id = %s
                """,
                [pwd_hash, full_name or "", role, row[0]],
            )
        else:
            cur.execute(
                """
                INSERT INTO core.users
                    (id, email_plain, password_hash, hash_kind, full_name,
                     role, is_active, is_staff, created_at, updated_at)
                VALUES (%s, %s, %s, 'sha256', %s, %s, TRUE, TRUE, NOW(), NOW())
                """,
                [user_uuid, email_low, pwd_hash, full_name or "", role],
            )


def _find_request(req_id: str) -> dict | None:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, email, full_name, contact_email, phone,
                   password_pbkdf2, password_core_sha256,
                   cliente_id::text, cliente_razon, legal_entity_ids,
                   role_default, addresses::text, estado, motivo_rechazo,
                   ip_origen::text, user_agent
              FROM users.registration_request WHERE id = %s
            """,
            [req_id],
        )
        r = cur.fetchone()
        if not r:
            return None
        cols = ["id", "email", "full_name", "contact_email", "phone",
                "password_pbkdf2", "password_core_sha256", "cliente_id",
                "cliente_razon", "legal_entity_ids", "role_default",
                "addresses", "estado", "motivo_rechazo", "ip_origen", "user_agent"]
        d = dict(zip(cols, r))
        import json
        d["legal_entity_ids"] = [str(x) for x in (d["legal_entity_ids"] or [])]
        try:
            d["addresses"] = json.loads(d["addresses"] or "[]")
        except Exception:  # noqa: BLE001
            d["addresses"] = []
        return d


def aprobar_solicitud(req_id: str, admin_user_id: str | None = None) -> dict:
    req = _find_request(req_id)
    if not req:
        return {"ok": False, "detail": "Solicitud no encontrada.", "code": "NOT_FOUND"}
    if req["estado"] != "PENDIENTE":
        return {"ok": False, "detail": f"La solicitud ya está {req['estado'].lower()}.",
                "code": "ESTADO"}
    if _email_registrado(req["email"]):
        return {"ok": False, "detail": "El correo ya está registrado.", "code": "EMAIL_EXISTE"}

    user_id = str(uuid.uuid4())
    role = req["role_default"] or ROLE_CLIENT
    leids = req["legal_entity_ids"]
    now = datetime.now(timezone.utc).isoformat()
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users.mwtuser
                        (id, email_plain, contact_email, phone, full_name,
                         password_hash, password_changed_at,
                         legal_entity_id, legal_entity_ids, role_default,
                         preferred_language, timezone, is_superuser, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'es',
                            'America/Lima', FALSE, TRUE)
                    """,
                    [user_id, req["email"], req["contact_email"], req["phone"],
                     req["full_name"], req["password_pbkdf2"], now,
                     (leids[0] if leids else None), leids, role],
                )
                if req["addresses"]:
                    from apps.users.views import _process_addresses_atomic  # noqa: PLC0415
                    _process_addresses_atomic(user_id, req["addresses"])
                _core_upsert_hashed(email=req["email"], full_name=req["full_name"],
                                    role=role, pwd_hash=req["password_core_sha256"],
                                    user_uuid=user_id)
                cur.execute(
                    """
                    UPDATE users.registration_request
                       SET estado = 'APROBADO', aprobado_por = %s,
                           aprobado_at = NOW(), activado_user_uuid = %s,
                           updated_at = NOW()
                     WHERE id = %s
                    """,
                    [admin_user_id, user_id, req_id],
                )
    except Exception as exc:  # noqa: BLE001
        log.exception("aprobar_solicitud falló")
        return {"ok": False, "detail": f"No se pudo activar la cuenta: {exc}"}

    # Authentik (IdP): fail-safe.
    try:
        from apps.users.authentik_sync import ensure_user, sync_groups  # noqa: PLC0415
        ensure_user(req["email"], req["full_name"], is_active=True)
        if leids:
            sync_groups(req["email"], leids)
    except Exception:  # noqa: BLE001
        log.exception("authentik sync en aprobación falló")

    # Grant MCP device-bound + email de activación con adjuntos.
    email_sent = {"ok": False}
    grant_info = {}
    package = None
    try:
        decision = mcp_onboarding.decide_scenario(req["email"])
        if decision.get("scenario") == "ok":
            target = decision["target"]
            client = next((c for c in decision["clients"]
                           if str(c.get("cliente_id")) == str(req["cliente_id"])), None)
            if client is None and len(decision["clients"]) == 1:
                client = decision["clients"][0]
            if client:
                grant_info = mcp_onboarding.emit_grant(target, client["cliente_id"],
                                                       creado_via="registro")
                package = mcp_onboarding.build_package(client, target, grant_info)
    except Exception:  # noqa: BLE001
        log.exception("grant/package en aprobación falló")

    if package:
        email_sent = send_mail_tpl(
            req["email"],
            f"Tu cuenta fue activada · credenciales MCP de {package['razon_social']}",
            "mcp_cuenta_activada",
            {"email": req["email"], "nombre": req["full_name"],
             "empresa": package["razon_social"], "fname_json": package["fname_json"],
             "fname_md": package["fname_md"],
             "texto_plano": (f"Cuenta activada. Credenciales MCP adjuntas: "
                             f"{package['fname_json']} y {package['fname_md']}.")},
            attachments=[
                {"filename": package["fname_json"], "data": package["json_text"].encode("utf-8"),
                 "mime": package["mime_json"]},
                {"filename": package["fname_md"], "data": package["md_text"].encode("utf-8"),
                 "mime": package["mime_md"]},
            ],
        )
    else:
        email_sent = send_mail_tpl(
            req["email"],
            "Tu cuenta MWT.ONE fue activada",
            "mcp_cuenta_activada",
            {"email": req["email"], "nombre": req["full_name"],
             "empresa": req["cliente_razon"],
             "texto_plano": "Tu cuenta fue activada. (Las credenciales MCP se envían cuando la empresa tenga el servicio activo.)"},
        )

    return {
        "ok": True,
        "user_uuid": user_id,
        "email_sent": email_sent,
        "grant": {k: grant_info.get(k) for k in ("grant_id", "secret_prefix", "estado")} if grant_info else None,
    }


def rechazar_solicitud(req_id: str, motivo: str = "") -> dict:
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE users.registration_request
               SET estado = 'RECHAZADO', motivo_rechazo = %s, updated_at = NOW()
             WHERE id = %s AND estado = 'PENDIENTE'
            """,
            [motivo or None, req_id],
        )
        if cur.rowcount == 0:
            return {"ok": False, "detail": "Solicitud no encontrada o ya resuelta."}
    return {"ok": True, "detail": "Solicitud rechazada."}


def listar_solicitudes(estado: str = "PENDIENTE", limit: int = 100) -> list[dict]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, email, full_name, phone, cliente_id::text,
                   cliente_razon, legal_entity_ids, role_default, estado,
                   motivo_rechazo, aprobado_at, activado_user_uuid::text,
                   created_at, updated_at
              FROM users.registration_request
             WHERE estado = %s
             ORDER BY created_at DESC LIMIT %s
            """,
            [estado, limit],
        )
        cols = ["id", "email", "full_name", "phone", "cliente_id", "cliente_razon",
                "legal_entity_ids", "role_default", "estado", "motivo_rechazo",
                "aprobado_at", "activado_user_uuid", "created_at", "updated_at"]
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r))
            d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
            d["updated_at"] = d["updated_at"].isoformat() if d["updated_at"] else None
            d["aprobado_at"] = d["aprobado_at"].isoformat() if d["aprobado_at"] else None
            d["legal_entity_ids"] = [str(x) for x in (d["legal_entity_ids"] or [])]
            rows.append(d)
    return rows


# ── Envío manual de credenciales MCP (admin, desde /usuarios/<id>) ─────

def _email_by_user_id(user_id: str) -> str | None:
    """Email del usuario por su UUID (users.mwtuser primario, core.users fallback)."""
    with connection.cursor() as cur:
        cur.execute("SELECT email_plain FROM users.mwtuser WHERE id = %s", [user_id])
        r = cur.fetchone()
        if r and r[0]:
            return r[0]
        cur.execute("SELECT email_plain FROM core.users WHERE id = %s", [user_id])
        r = cur.fetchone()
        return r[0] if r else None


def listar_empresas_mcp(user_id: str) -> list[dict]:
    """Empresas asignadas al usuario, con flag de si tienen MCP provisionado.

    El modal de la consola muestra todas las asignadas y habilita solo las
    que se pueden enviar (has_mcp).
    """
    email = _email_by_user_id(user_id)
    if not email:
        return []
    target = mcp_onboarding.fetch_target(email)
    if not target:
        return []
    leids = target.get("legal_entity_ids") or []
    out: list[dict] = []
    if not leids:
        return out
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, razon_social, nombre_comercial
              FROM clientes.cliente
             WHERE id::text = ANY(%s) AND is_active = TRUE
             ORDER BY razon_social ASC
            """,
            [leids],
        )
        for cid, razon, nombre in cur.fetchall():
            out.append({
                "cliente_id": cid,
                "razon_social": razon or nombre or "",
                "has_mcp": _mcp_cliente_provisionado(cid),
            })
    return out


def emitir_y_enviar_credenciales(user_id: str, cliente_id: str) -> dict:
    """Emite el grant de la empresa elegida y envía el paquete .json/.md al usuario."""
    email = _email_by_user_id(user_id)
    if not email:
        return {"ok": False, "detail": "Usuario no encontrado.", "code": "USUARIO"}
    target = mcp_onboarding.fetch_target(email)
    if not target:
        return {"ok": False, "detail": "Usuario no encontrado.", "code": "USUARIO"}
    clients = mcp_onboarding.mcp_clients_for_target(target)
    client = next((c for c in clients
                   if str(c.get("cliente_id")) == str(cliente_id)), None)
    if not client:
        return {"ok": False,
                "detail": "El usuario no tiene acceso MCP a esa empresa.",
                "code": "SIN_ACCESO"}
    grant = mcp_onboarding.emit_grant(target, str(cliente_id), creado_via="external")
    package = mcp_onboarding.build_package(client, target, grant)
    from .mcp_mailbox import send_reply  # noqa: PLC0415

    res = send_reply(
        email,
        subject=f"Tus credenciales MCP · {package['razon_social']}",
        template_key="mcp_credenciales",
        context={"email": email, "nombre": target.get("full_name") or "",
                 "empresa": package["razon_social"],
                 "fname_json": package["fname_json"],
                 "fname_md": package["fname_md"],
                 "texto_plano": (f"Credenciales MCP de {package['razon_social']} adjuntas.")},
        attachments=[
            {"filename": package["fname_json"], "data": package["json_text"].encode("utf-8"),
             "mime": package["mime_json"]},
            {"filename": package["fname_md"], "data": package["md_text"].encode("utf-8"),
             "mime": package["mime_md"]},
        ],
    )
    return {
        "ok": bool(res.get("ok")),
        "email": email,
        "empresa": package["razon_social"],
        "secret_prefix": grant["secret_prefix"],
        "send": res,
    }
