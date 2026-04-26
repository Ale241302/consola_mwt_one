"""
=====================================================================
MWT.ONE · Custom DRF exception handler
Agente responsable: [AG-BACKEND]

Atrapa CUALQUIER excepción levantada en cualquier view DRF y la
escribe a /tmp/mwt_debug.log además de pasarla por la cadena estándar.

Esto existe específicamente para diagnosticar 500 que no logean nada.
Una vez identificado el bug, este handler puede quedarse (es seguro).
=====================================================================
"""
import os
import sys
import traceback
from datetime import datetime
from rest_framework.views import exception_handler as drf_default_handler


def _write(msg: str) -> None:
    try:
        with open("/tmp/mwt_debug.log", "a") as f:
            f.write(f"[{datetime.utcnow().isoformat()}Z] {msg}\n")
    except Exception:
        pass
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def custom_exception_handler(exc, context):
    """Wrapper del handler default de DRF que escribe a /tmp/mwt_debug.log."""
    request = context.get("request")
    view    = context.get("view")
    method  = getattr(request, "method", "?")
    path    = getattr(request, "path", "?")
    view_name = type(view).__name__ if view else "?"

    _write("=" * 70)
    _write(f">>> DRF EXCEPTION on {method} {path} (view={view_name})")
    _write(f">>> Type: {type(exc).__name__}")
    _write(f">>> Msg : {exc!s}")

    # Body si lo hay
    try:
        if request and hasattr(request, "data"):
            _write(f">>> body: {dict(request.data)}")
    except Exception:
        pass

    # Auth context
    try:
        if request:
            _write(f">>> user={request.user!r} authenticated={getattr(request.user, 'is_authenticated', None)}")
            _write(f">>> auth={request.auth!r}")
    except Exception as e:
        _write(f">>> auth inspection crash: {e}")

    # Traceback completo
    try:
        _write(">>> TRACEBACK:")
        _write(traceback.format_exc())
    except Exception:
        pass

    # Pasar al handler default de DRF (mantiene el comportamiento estándar
    # de respuestas 4xx).
    response = drf_default_handler(exc, context)
    _write(f">>> default_handler returned: {response}")
    return response
