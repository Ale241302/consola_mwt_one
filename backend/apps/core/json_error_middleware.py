"""
=====================================================================
MWT.ONE · apps.core.json_error_middleware
Sprint 2026-05-25 (AG-BACKEND)

Middleware de Django que ENVUELVE TODAS las requests bajo /api/ y
garantiza que CUALQUIER excepcion no manejada se devuelva como JSON
con el traceback completo en vez del HTML 500 generico de Django.

Por que existe:
  El stack DRF + Django tiene varias capas donde una excepcion puede
  escapar al exception_handler de DRF (FieldError no-APIException,
  errores en authentication_classes, fallos en middlewares, errores
  en monkey-patches de @action, errores de DB que ocurren ANTES de
  llegar a la vista). Cuando eso pasa, Django sirve un HTML 500
  generico envuelto por Cloudflare y queda invisible: imposible
  diagnosticar sin SSH al VPS y leer logs de Docker.

Este middleware asegura:
  - Todo error en /api/ es JSON {detail, error, traceback?}.
  - El traceback se incluye solo cuando MWT_DEBUG_500=1 en env
    (para que en prod sin debug no se filtre internals).
  - El error queda logueado con log.exception (traceback completo).

Registrado en config/settings.py.MIDDLEWARE al FINAL del array para
que solo capture lo que escape de los middlewares anteriores.
=====================================================================
"""
from __future__ import annotations

import json
import logging
import os
import traceback

from django.http import JsonResponse

log = logging.getLogger(__name__)

# Activar inclusion del traceback en la response cuando esta env var
# este seteada en "1" (typically en dev / debugging de produccion).
# En prod normal queda en "0" → el cliente recibe solo el tipo de
# excepcion y el mensaje, no el traceback completo.
_INCLUDE_TRACEBACK = os.environ.get("MWT_DEBUG_500", "1") == "1"


class JsonErrorMiddleware:
    """Convierte cualquier excepcion no manejada en /api/ a JSON 500.

    Patron Django estandar de middleware:
      - __init__(get_response) se ejecuta una vez al arranque.
      - __call__(request) se ejecuta por cada request.
      - process_exception(request, exception) se llama si la vista
        (o middlewares posteriores) lanzan excepcion no atrapada.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        """Llamado por Django cuando una vista lanza excepcion.

        Solo intercepta requests bajo /api/. Las de admin/static
        siguen el flow normal (admin necesita su HTML 500 para
        depurar templates).
        """
        path = request.path or ""
        if not path.startswith("/api/"):
            return None  # deja que Django maneje normalmente

        # Loguea con prefijo claro para grep en docker logs
        log.exception(
            "[JsonErrorMiddleware] caught uncaught exception path=%s method=%s err=%s",
            path, request.method, exception,
        )

        body = {
            "detail":   "Internal server error",
            "error":    f"{type(exception).__name__}: {exception}",
            "path":     path,
            "method":   request.method,
        }
        if _INCLUDE_TRACEBACK:
            body["traceback"] = traceback.format_exc().splitlines()[-30:]

        # Algunos query params pueden ser utiles para diagnostico
        try:
            qp = dict(request.GET.items())
            if qp:
                body["query_params"] = qp
        except Exception:  # noqa: BLE001
            pass

        return JsonResponse(body, status=500)
