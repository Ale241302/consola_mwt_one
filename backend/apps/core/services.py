"""Servicios transversales de la app `core`.

Ola 2 · 2.20 — Idempotencia del MCP/API.
Estas utilidades dan deduplicación real sobre la tabla `core.idempotency_store`
(DDL versionado: database/mcp_audit.sql → backend/sql/98b_mcp_audit_and_idempotency.sql).
La semántica: un agente que reintenta la misma creación tras un timeout envía el
mismo `idempotency_key`; la primera vez se crea el recurso y se cachea la respuesta;
los reintentos devuelven esa respuesta cacheada sin crear un segundo recurso.

Solo actúan cuando `idempotency_key` está presente. Si no viene la clave, el
comportamiento de los endpoints es idéntico al original (sin dedup).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from django.db import connection

logger = logging.getLogger(__name__)


def _cleanup_expired() -> None:
    """Borra entradas expiradas (TTL). Barrido barato antes de consultar."""
    try:
        with connection.cursor() as cur:
            cur.execute(
                "DELETE FROM core.idempotency_store WHERE expires_at < now()"
            )
    except Exception as exc:  # noqa: BLE001 - nunca romper la request por limpieza
        logger.warning("[idempotency] cleanup falló: %s", exc)


def dedup_get(idempotency_key: str | None) -> dict | None:
    """Devuelve la respuesta cacheada para una clave, o `None` si no existe.

    `None` == no hay registro (el caller debe proceder y luego guardar).
    Un dict de retorno incluye `tool`, `target_id`, `payload` y `status`.
    """
    if not idempotency_key:
        return None
    _cleanup_expired()
    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT tool, target_id, response_payload::text, status "
                "FROM core.idempotency_store WHERE idempotency_key = %s",
                [str(idempotency_key)],
            )
            row = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[idempotency] get %r falló: %s", idempotency_key, exc)
        return None
    if not row:
        return None
    tool, target_id, payload, status = row
    try:
        payload = json.loads(payload)
    except (TypeError, ValueError):
        pass
    return {"tool": tool, "target_id": target_id, "payload": payload, "status": int(status or 200)}


def dedup_put(
    idempotency_key: str | None,
    tool: str,
    target_id: str | None,
    response_payload: Any,
    status: int = 201,
) -> None:
    """Cachea la respuesta de una creación bajo una clave (upsert, TTL 24 h).

    Idempotente: si la clave ya existe se actualiza (no crea duplicados).
    """
    if not idempotency_key:
        return
    try:
        payload = json.dumps(response_payload, ensure_ascii=False, default=str)
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.idempotency_store
                    (idempotency_key, tool, target_id, response_payload, status)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (idempotency_key) DO UPDATE SET
                    response_payload = EXCLUDED.response_payload,
                    status          = EXCLUDED.status,
                    expires_at      = now() + interval '1 day'
                """,
                [str(idempotency_key), tool, target_id, payload, int(status)],
            )
    except Exception as exc:  # noqa: BLE001 - nunca romper la creación por el cache
        logger.warning("[idempotency] put %r falló: %s", idempotency_key, exc)


# --------------------------------------------------------------------------- #
# Ola 3.6 — auditoría durable de llamadas MCP (Eje A3)
#
# Persiste en `core.mcp_audit` (DDL: backend/sql/98b_mcp_audit_and_idempotency.sql).
# El MCP emite un log JSON a stderr por tool-call y además hace un POST
# best-effort a /api/auth/mcp-audit/ para que quede trazable de forma durable
# (quién, qué tool, cuándo, resultado). Este servicio es la única puerta de
# escritura hacia la tabla; nunca se inserta desde el ORM.
# --------------------------------------------------------------------------- #
_AUDIT_PII_KEYS = {
    "password", "token", "secret", "evidencia", "documento_sap",
    "file_path", "filename", "key", "storage_url", "signed_url", "url",
    "tax_id", "contact_email", "phone", "cedula", "correo", "email",
}


def _audit_sanitize(value):
    """Redacta PII/URLs firmadas y trunca strings largos antes de persistir."""
    if isinstance(value, dict):
        return {
            k: "<redactado>" if (k or "").lower() in _AUDIT_PII_KEYS
            else _audit_sanitize(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_audit_sanitize(v) for v in value]
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:500] + "…<truncado>"
    return value


def audit_write(
    event: str,
    tool: str,
    identity_sub: str | None = None,
    identity_roles=None,
    args_sanitized=None,
    ok: bool = True,
    http_status: int | None = None,
    duration_ms: int | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Inserta un registro en core.mcp_audit. Best-effort: nunca rompe la request.

    Devuelve True si la inserción fue exitosa. El caller (el endpoint de
    auditoría del MCP) es el único punto de entrada.
    """
    import json

    try:
        roles_json = json.dumps(identity_roles or [], ensure_ascii=False, default=str)
        args_json = json.dumps(args_sanitized or {}, ensure_ascii=False, default=str)
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.mcp_audit
                    (event, tool, identity_sub, identity_roles, args_sanitized,
                     ok, http_status, duration_ms, idempotency_key)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    str(event)[:32],
                    str(tool)[:64],
                    str(identity_sub)[:255] if identity_sub else None,
                    roles_json,
                    args_json,
                    bool(ok),
                    int(http_status) if http_status is not None else None,
                    int(duration_ms) if duration_ms is not None else None,
                    str(idempotency_key)[:128] if idempotency_key else None,
                ],
            )
        return True
    except Exception as exc:  # noqa: BLE001 - nunca romper la request por auditoría
        logger.warning("[mcp_audit] write falló: %s", exc)
        return False
