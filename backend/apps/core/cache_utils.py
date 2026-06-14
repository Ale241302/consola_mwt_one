"""
=====================================================================
MWT.ONE · apps.core.cache_utils
Agente responsable: [AG-BACKEND]

Wrappers resilientes sobre el cache framework de Django (Redis nativo,
`django.core.cache.backends.redis.RedisCache`).

Motivo: ese backend NO tiene `IGNORE_EXCEPTIONS` — si Redis está caído o
lento, `cache.get/set` LANZAN (redis.ConnectionError, TimeoutError, …) y
tumbarían el request. El cache es un *sidecar* de rendimiento: nunca debe
romper una respuesta. Por eso estos helpers degradan a "miss" y loggean.

Nota sobre `except Exception` (CLAUDE.md §11.3): aquí el catch amplio es
DELIBERADO y está justificado — la capa de cache puede fallar de muchas
formas (conexión, timeout, (de)serialización) y todas deben degradar igual:
seguir sirviendo desde la BD. Se loggea estructurado (no es swallow silencioso).
=====================================================================
"""
import logging

from django.core.cache import cache

log = logging.getLogger("mwt.cache")


def cache_get(key, default=None):
    """Lee de cache. Devuelve `default` ante miss o fallo de Redis."""
    try:
        value = cache.get(key)
        return default if value is None else value
    except Exception as exc:  # noqa: BLE001 — cache nunca debe romper el request
        log.warning("cache_get degradado key=%s err=%s", key, exc)
        return default


def cache_set(key, value, timeout):
    """Escribe en cache. `timeout` en segundos. No propaga fallos de Redis."""
    try:
        cache.set(key, value, timeout)
        return True
    except Exception as exc:  # noqa: BLE001 — cache nunca debe romper el request
        log.warning("cache_set degradado key=%s err=%s", key, exc)
        return False


def cache_delete(*keys):
    """Invalida una o varias keys. Tolerante a fallos de Redis."""
    for key in keys:
        try:
            cache.delete(key)
        except Exception as exc:  # noqa: BLE001 — invalidación best-effort
            log.warning("cache_delete degradado key=%s err=%s", key, exc)
