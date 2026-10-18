"""
=====================================================================
MWT.ONE · apps.core.mcp_device_grant_auth
Autenticación server-side de una credencial DeviceToken (Fase 3).

El MCP server recibe `Authorization: DeviceToken <secret>` (o el backend
directamente por body) y llama a McpTokenView con `grant_secret`, `ip` y
`device_id`. Aquí se resuelve el grant en core.mcp_device_grant:

  Con `device_id` (el equipo se identifica a sí mismo):
    ISSUED + device            → se VINCULA el dispositivo (estado ACTIVE).
    ACTIVE + device_id nulo    → se vincula el dispositivo en este uso.
    ACTIVE + mismo device_id   → se renueva el TTL y se registra la IP; un
                                 cambio de red NO invalida la credencial.
    ACTIVE + otro device_id    → DEVICE_MISMATCH (no revoca; el equipo
                                 original sigue funcionando).
  Sin `device_id` (paquete emitido por correo, cliente que no lo envía):
    ISSUED + ip  → se VINCULA la ip (estado ACTIVE, primera/última conexión).
    ACTIVE + ip  → si la ip ≠ vinculada → DEVICE_MISMATCH (no revoca).
    REVOKED / EXPIRED / inexistente → rechazo fail-closed.
  expira_at vencido → se marca EXPIRED y se rechaza.

El scope del JWT queda fijado al cliente_id del grant (único tenant).
=====================================================================
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone

from django.db import connection, transaction

log = logging.getLogger("mwt_mcp.onboarding.grant_auth")

# Longitud máxima del identificador de equipo que acepta la base.
MAX_DEVICE_ID_LENGTH = 128


def hash_secret(secret: str) -> str:
    return hashlib.sha256((secret or "").encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ttl_seconds() -> int:
    """TTL del grant (deslizante). Mismo origen que mcp_onboarding.GRANT_TTL_DAYS."""
    days = int(os.environ.get("MWT_GRANT_TTL_DAYS", "30") or "30")
    return days * 86400


def normalize_device_id(device_id: str | None) -> str | None:
    """Normaliza el identificador de equipo que envía el cliente MCP."""
    value = (device_id or "").strip()
    if not value:
        return None
    return value[:MAX_DEVICE_ID_LENGTH]


def _bind_device(gid: str, user_uuid: str, cliente_id: str, device_id: str, ip: str | None) -> None:
    """Vincula el dispositivo al grant y renueva su TTL.

    Un mismo equipo tiene una sola credencial activa por empresa: si el
    usuario ya tenía otra activa para ese dispositivo, queda revocada.
    """
    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE core.mcp_device_grant
                   SET estado = 'REVOKED', revocado_at = now(),
                       revoke_reason = 'replaced', updated_at = now()
                 WHERE user_uuid = %s AND cliente_id = %s AND device_id = %s
                   AND estado IN ('ISSUED', 'ACTIVE') AND id <> %s
                """,
                [user_uuid, cliente_id, device_id, gid],
            )
            cur.execute(
                """
                UPDATE core.mcp_device_grant
                   SET estado = 'ACTIVE', device_id = %s,
                       ip_vinculada = COALESCE(%s, ip_vinculada),
                       primera_conexion_at = COALESCE(primera_conexion_at, now()),
                       ultima_conexion_at = now(),
                       expira_at = now() + (%s * interval '1 second'),
                       updated_at = now()
                 WHERE id = %s
                """,
                [device_id, ip, _ttl_seconds(), gid],
            )


def _touch(gid: str, ip: str | None) -> None:
    """Registra el uso y renueva el TTL deslizante."""
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE core.mcp_device_grant
               SET ultima_conexion_at = now(),
                   ip_vinculada = COALESCE(%s, ip_vinculada),
                   expira_at = now() + (%s * interval '1 second'),
                   updated_at = now()
             WHERE id = %s
            """,
            [ip, _ttl_seconds(), gid],
        )


def authenticate_grant(
    secret: str,
    ip: str | None = None,
    device_id: str | None = None,
) -> dict:
    """Valida el DeviceToken y (si aplica) vincula/comprueba el equipo.

    Devuelve {ok: True, user_uuid, email, cliente_id, grant_id} o
    {ok: False, code, detail}.
    """
    if not secret:
        return {"ok": False, "code": "GRANT_REQUIRED",
                "detail": "Falta grant_secret."}
    ip = ((ip or "").strip().split("/")[0] or None) if ip else None
    device = normalize_device_id(device_id)

    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, user_uuid::text, email, cliente_id::text,
                   estado, ip_vinculada::text, expira_at, secret_prefix,
                   device_id
              FROM core.mcp_device_grant
             WHERE secret_hash = %s LIMIT 1
            """,
            [hash_secret(secret)],
        )
        row = cur.fetchone()
        if not row:
            return {"ok": False, "code": "GRANT_INVALID",
                    "detail": "Credencial MCP inválida. Verifica que copiaste el token completo "
                              "del archivo .json."}
        (gid, user_uuid, email, cliente_id, estado,
         bound_ip, expira_at, prefix, bound_device) = row
        # Postgres inet::text incluye la máscara (ej. 1.2.3.4/32): se normaliza.
        bound_ip = (bound_ip or "").split("/")[0] or None

        if estado in ("REVOKED",):
            return {"ok": False, "code": "GRANT_REVOKED",
                    "detail": "Esta credencial fue revocada (se emitió una nueva para tu cuenta). "
                              "Genera un paquete nuevo escribiendo a mcp@mwt.one."}

        if estado == "EXPIRED":
            return {"ok": False, "code": "GRANT_EXPIRED",
                    "detail": "Esta credencial expiró. Genera un paquete nuevo."}

        if expira_at and expira_at < _now():
            with transaction.atomic():
                cur.execute(
                    """
                    UPDATE core.mcp_device_grant
                       SET estado = 'EXPIRED', revocado_at = now(),
                           revoke_reason = 'expired', updated_at = now()
                     WHERE id = %s
                    """,
                    [gid],
                )
            return {"ok": False, "code": "GRANT_EXPIRED",
                    "detail": "Esta credencial expiró. Genera un paquete nuevo."}

        if device is not None:
            if bound_device is not None and bound_device != device:
                return {"ok": False, "code": "DEVICE_MISMATCH",
                        "detail": "Esta credencial ya está vinculada a otro equipo. "
                                  "Genera una credencial nueva para este equipo."}
            if estado == "ISSUED" or bound_device is None:
                _bind_device(gid, user_uuid, cliente_id, device, ip)
            else:
                _touch(gid, ip)
            log.info("grant %s ok (device=%s, ip=%s, user=%s)", gid, device, ip, user_uuid)
            return {"ok": True, "grant_id": gid, "user_uuid": user_uuid,
                    "email": email, "cliente_id": cliente_id}

        # Sin identificador de equipo: vínculo por IP (paquete emitido por correo).
        if not ip:
            return {"ok": False, "code": "IP_REQUIRED",
                    "detail": "No se pudo determinar el equipo de origen (ip)."}

        if estado == "ISSUED":
            with transaction.atomic():
                cur.execute(
                    """
                    UPDATE core.mcp_device_grant
                       SET estado = 'ACTIVE', ip_vinculada = %s,
                           primera_conexion_at = now(),
                           ultima_conexion_at = now(),
                           expira_at = now() + (%s * interval '1 second'),
                           updated_at = now()
                     WHERE id = %s
                    """,
                    [ip, _ttl_seconds(), gid],
                )
            log.info("grant %s vinculado a ip %s (user=%s)", gid, ip, user_uuid)
            return {"ok": True, "grant_id": gid, "user_uuid": user_uuid,
                    "email": email, "cliente_id": cliente_id}

        # estado == ACTIVE → validar que la ip coincida con la vinculada.
        if bound_ip and ip != bound_ip:
            return {"ok": False, "code": "DEVICE_MISMATCH",
                    "detail": "Esta credencial ya fue usada desde otro equipo "
                              f"(vinculada a {bound_ip}). Genera un paquete nuevo desde tu "
                              "correo registrado (mcp@mwt.one) y el equipo anterior quedará "
                              "revocado."}
        _touch(gid, ip)
        return {"ok": True, "grant_id": gid, "user_uuid": user_uuid,
                "email": email, "cliente_id": cliente_id}
