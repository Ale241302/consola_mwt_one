"""
=====================================================================
MWT.ONE · apps.core.service_tokens — vigencia deslizante de ServiceToken.

Un ServiceToken con `auto_renew = TRUE` no deja al consumidor sin
credencial por olvido:

  · `renew_due()` corre a diario por Celery Beat y corre la vigencia de
    todo token que vence en menos de `RENEW_AHEAD_DAYS` días.
  · `renew_token()` es el camino de auto-curación: el propio MCP llama a
    `POST /api/auth/service-token/renew/` al arrancar y cada 12 h, así que
    un contenedor que estuvo caído semanas se recupera solo.

El apagado real NO es el vencimiento: es `revoked_at` o `is_active = FALSE`.
`GRACE_DAYS` sólo permite revivir un token dentro de esa ventana posterior
al vencimiento; pasado ese plazo hay que emitir uno nuevo.

Contexto: hasta 2026-11 el tope de 90 días de `mint_mcp_token` tumbó el MCP
en silencio (el conector mostraba "no tiene herramientas disponibles"), y
arreglarlo requería acordarse a mano cada trimestre.
=====================================================================
"""
from __future__ import annotations

import logging

from django.db import connection

log = logging.getLogger(__name__)

# Vida que se otorga en cada renovación (días).
DEFAULT_RENEW_DAYS = 90
# El barrido diario renueva cuando faltan menos de estos días.
RENEW_AHEAD_DAYS = 30
# Ventana para revivir un token ya vencido (auto-curación tras una caída).
GRACE_DAYS = 90


def _to_iso(value):
    return value.isoformat() if value is not None else None


def _explain_not_renewable(token_id) -> str:
    """Diagnóstico para el 403 del endpoint (una sola query, sólo al fallar)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT is_active, revoked_at, auto_renew, (expires_at < now())
              FROM core.service_token
             WHERE id = %s
            """,
            [token_id],
        )
        row = cur.fetchone()

    if not row:
        return "UNKNOWN_TOKEN"
    is_active, revoked_at, auto_renew, expired = row
    if revoked_at:
        return "REVOKED"
    if not is_active:
        return "INACTIVE"
    if not auto_renew:
        return "AUTO_RENEW_OFF"
    if expired:
        return "EXPIRED_BEYOND_GRACE"
    return "NOT_RENEWABLE"


def renew_token(
    token_id,
    *,
    days: int = DEFAULT_RENEW_DAYS,
    grace_days: int = GRACE_DAYS,
) -> dict:
    """Corre la vigencia de UN token. Idempotente.

    Devuelve `{"renewed": bool, "expires_at": str|None, "reason": str|None}`.
    """
    if not token_id:
        return {"renewed": False, "expires_at": None, "reason": "UNKNOWN_TOKEN"}

    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE core.service_token
               SET expires_at = now() + make_interval(days => %s)
             WHERE id = %s
               AND is_active = TRUE
               AND revoked_at IS NULL
               AND auto_renew = TRUE
               AND expires_at > now() - make_interval(days => %s)
         RETURNING expires_at
            """,
            [int(days), token_id, int(grace_days)],
        )
        row = cur.fetchone()

    if not row:
        reason = _explain_not_renewable(token_id)
        log.warning("service_token renew rechazado: id=%s motivo=%s", token_id, reason)
        return {"renewed": False, "expires_at": None, "reason": reason}

    log.info(
        "service_token renew OK: id=%s nueva_expiración=%s (auto_renew)",
        token_id, row[0],
    )
    return {"renewed": True, "expires_at": _to_iso(row[0]), "reason": None}


def renew_due(
    *,
    days: int = DEFAULT_RENEW_DAYS,
    ahead_days: int = RENEW_AHEAD_DAYS,
) -> list[dict]:
    """Barrido: renueva todo token auto-renovable VIVO que vence pronto.

    Se ejecuta aunque nadie llame al endpoint (MCP apagado, contenedor sin
    red, etc.). Sólo toca tokens aún vigentes: un token ya vencido no se
    resucita por barrido (eso evitaría que los tokens viejos de pruebas
    volvieran a la vida). Para revivir uno vencido está `renew_token()`, que
    acepta la ventana de gracia cuando el consumidor reaparece.

    Devuelve la lista de tokens efectivamente renovados.
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE core.service_token
               SET expires_at = now() + make_interval(days => %s)
             WHERE is_active = TRUE
               AND revoked_at IS NULL
               AND auto_renew = TRUE
               AND expires_at > now()
               AND expires_at < now() + make_interval(days => %s)
         RETURNING id, name, expires_at
            """,
            [int(days), int(ahead_days)],
        )
        rows = cur.fetchall()

    renewed = [
        {"id": str(r[0]), "name": r[1], "expires_at": _to_iso(r[2])}
        for r in (rows or [])
    ]
    if renewed:
        log.info(
            "service_token renew_due: %d token(s) renovados: %s",
            len(renewed), ", ".join(r["name"] for r in renewed),
        )
    else:
        log.debug("service_token renew_due: nada por renovar")
    return renewed


# Orden de severidad: un token vencido manda sobre uno que solo está por vencer.
_STATUS_ORDER = {"OK": 0, "WARN": 1, "CRITICAL": 2, "EXPIRED": 3}


def _status_for_days(days: float) -> str:
    if days <= 0:
        return "EXPIRED"
    if days <= 7:
        return "CRITICAL"
    if days <= RENEW_AHEAD_DAYS:
        return "WARN"
    return "OK"


def token_health() -> dict:
    """Resumen de vigencia de los ServiceToken vivos (para `system-health`).

    No expone hashes ni secretos: sólo nombre, si se auto-renueva, vencimiento
    y días restantes.

    La severidad global se calcula sobre los tokens VIVOS y la lista sólo los
    incluye: la tabla acumula credenciales históricas ya vencidas y no debe
    teñir el health para siempre. Los vencidos se resumen en `expired`; si no
    queda ninguno vivo, el estado global sí es EXPIRED (no hay credencial que
    sirva).
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT name, auto_renew, expires_at,
                   EXTRACT(EPOCH FROM (expires_at - now())) / 86400.0 AS days
              FROM core.service_token
             WHERE is_active = TRUE AND revoked_at IS NULL
             ORDER BY expires_at
            """
        )
        rows = cur.fetchall() or []

    tokens: list[dict] = []
    expired = 0
    for name, auto_renew, expires_at, days in rows:
        days_f = float(days or 0)
        if days_f <= 0:
            expired += 1
            continue
        tokens.append({
            "name": name,
            "auto_renew": bool(auto_renew),
            "status": _status_for_days(days_f),
            "days_remaining": int(days_f),
            "expires_at": _to_iso(expires_at),
        })

    if tokens:
        worst = max(tokens, key=lambda t: _STATUS_ORDER[t["status"]])["status"]
        min_days = min(t["days_remaining"] for t in tokens)
    elif expired:
        worst = "EXPIRED"
        min_days = None
    else:
        worst = "NONE"
        min_days = None

    return {
        "status": worst,
        "min_days_remaining": min_days,
        "expired": expired,
        "tokens": tokens,
    }
