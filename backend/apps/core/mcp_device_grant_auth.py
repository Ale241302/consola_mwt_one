"""
=====================================================================
MWT.ONE · apps.core.mcp_device_grant_auth
Autenticación server-side de una credencial DeviceToken (Fase 3).

El MCP server recibe `Authorization: DeviceToken <secret>` (o el backend
directamente por body) y llama a McpTokenView con `grant_secret` + `ip`.
Aquí se resuelve el grant en core.mcp_device_grant:

  ISSUED  + ip  → se VINCULA la ip (estado ACTIVE, primera/última conexión).
  ACTIVE  + ip  → si la ip ≠ vinculada → DEVICE_MISMATCH (no revoca; el
                   equipo original sigue funcionando).
  REVOKED / EXPIRED / inexistente → rechazo fail-closed.
  expira_at vencido → se marca EXPIRED y se rechaza.

El scope del JWT queda fijado al cliente_id del grant (único tenant).
=====================================================================
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from django.db import connection, transaction

log = logging.getLogger("mwt_mcp.onboarding.grant_auth")


def hash_secret(secret: str) -> str:
    return hashlib.sha256((secret or "").encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def authenticate_grant(secret: str, ip: str | None = None) -> dict:
    """Valida el DeviceToken y (si aplica) vincula/comprueba el equipo.

    Devuelve {ok: True, user_uuid, email, cliente_id, grant_id} o
    {ok: False, code, detail}.
    """
    if not secret:
        return {"ok": False, "code": "GRANT_REQUIRED",
                "detail": "Falta grant_secret."}
    ip = ((ip or "").strip().split("/")[0] or None) if ip else None

    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, user_uuid::text, email, cliente_id::text,
                   estado, ip_vinculada::text, expira_at, secret_prefix
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
         bound_ip, expira_at, prefix) = row
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
                           ultima_conexion_at = now(), updated_at = now()
                     WHERE id = %s
                    """,
                    [ip, gid],
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
        with connection.cursor() as cur2:
            cur2.execute(
                """
                UPDATE core.mcp_device_grant
                   SET ultima_conexion_at = now(), updated_at = now()
                 WHERE id = %s
                """,
                [gid],
            )
        return {"ok": True, "grant_id": gid, "user_uuid": user_uuid,
                "email": email, "cliente_id": cliente_id}
