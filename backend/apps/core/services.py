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
