"""Renovación automática de la vigencia del ServiceToken del MCP.

El token con el que el MCP habla con el backend (`MWT_MCP_TOKEN`) vence a los
90 días. Cuando vencía, `list_tools` caía a fail-closed y el conector mostraba
"no tiene herramientas disponibles", sin ninguna pista de la causa.

Este módulo corre la vigencia desde el propio consumidor: al arrancar y cada
12 h llama a `POST /api/auth/service-token/renew/` con su ServiceToken. El
backend sólo mueve `expires_at`; no hay secreto nuevo que redistribuir ni
contenedor que reiniciar.

Es best-effort a propósito: si el backend está caído, se loguea y el MCP
sigue funcionando con el token vigente. La red de seguridad complementaria es
la tarea Celery `core.renew_service_tokens` (diaria).
"""
from __future__ import annotations

import logging
import threading
import time

import httpx

from .config import settings

log = logging.getLogger("mwt_mcp.token_renew")

RENEW_PATH = "/auth/service-token/renew/"
# 12 h: el token vive 90 días, así que sobra margen incluso con caídas largas.
DEFAULT_INTERVAL_SECONDS = 12 * 3600
# Espera inicial para no competir con el arranque del backend/contenedor.
STARTUP_DELAY_SECONDS = 10


def renew_once(
    *,
    api_base: str | None = None,
    token: str | None = None,
    timeout: float = 20.0,
) -> bool:
    """Pide al backend correr la vigencia del token. True si la renovó."""
    base = (api_base or settings.api_base or "").rstrip("/")
    tok = settings.token if token is None else token
    if not base or not tok:
        log.debug("token_renew: sin api_base o sin token; se omite")
        return False

    url = f"{base}{RENEW_PATH}"
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"ServiceToken {tok}"},
            timeout=timeout,
        )
    except Exception as exc:  # noqa: BLE001 - nunca debe tumbar el server
        log.warning("token_renew: no se pudo contactar %s: %s", url, exc)
        return False

    if resp.status_code == 200:
        expires_at = None
        try:
            expires_at = resp.json().get("expires_at")
        except Exception:  # noqa: BLE001
            pass
        log.info("token_renew: ServiceToken renovado hasta %s", expires_at)
        return True

    # 403 con code=AUTO_RENEW_OFF/REVOKED/etc. es diagnóstico útil para ops.
    log.warning(
        "token_renew: %s → HTTP %s %s",
        url, resp.status_code, (resp.text or "")[:200],
    )
    return False


def _loop(interval_seconds: int) -> None:
    time.sleep(STARTUP_DELAY_SECONDS)
    while True:
        renew_once()
        time.sleep(interval_seconds)


def start_renewer(*, interval_seconds: int = DEFAULT_INTERVAL_SECONDS):
    """Arranca el hilo daemon de renovación. Devuelve el hilo o None."""
    if not settings.token:
        log.info("token_renew: MWT_MCP_TOKEN vacío; no se inicia el renovador")
        return None
    thread = threading.Thread(
        target=_loop,
        args=(int(interval_seconds),),
        name="mwt-token-renewer",
        daemon=True,
    )
    thread.start()
    log.info(
        "token_renew: renovador activo (cada %s h)",
        round(interval_seconds / 3600, 1),
    )
    return thread
