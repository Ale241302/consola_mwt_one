"""
=====================================================================
MWT.ONE · tests/conftest.py
Agente responsable: [AG-06-QA]   (orquestación pytest, hooks, fixtures)
                    [AG-BACKEND]  (auth bypass — MwtUser + force_authenticate)

OBJETIVO
========
Centralizar TODA la mecánica de la suite QA:

  1. AUTENTICACIÓN
     MWT no usa `auth_user`: el JWT contiene `user_uuid` y la clase
     `MwtJWTAuthentication.get_user()` hace un SELECT raw contra
     `core.users`. En tests no queremos depender de esa fila — usamos
     `APIClient.force_authenticate(user=MwtUser(...))` que setea
     directamente `request.user` SIN pasar por la autenticación.

  2. AUTO-DJANGO_DB
     En lugar de decorar 200 funciones con @pytest.mark.django_db,
     `pytest_collection_modifyitems` aplica el marker a TODOS los tests
     que vivan bajo `tests/`, en modo `transaction=True` para que cada
     test corra dentro de su propia transacción y la tabla quede limpia
     al finalizar (el rollback es automático).

  3. REPORTES DE FALLA RICOS
     `pytest_runtest_makereport` captura el endpoint + payload + status
     code + body devuelto si el test falla en una llamada a la API. Se
     loguea en consola con el formato:

         ========== FALLA EN TEST ==========
         Test:        tests/test_productos.py::test_create_producto_with_marca_proveedor_uuids
         Endpoint:    POST /api/productos/
         Payload:     { ... json indentado ... }
         Status:      400
         Response:    { ... json indentado ... }
         Traceback:   <stack completo>
         ===================================

     Para que esto funcione, los tests guardan el contexto de la última
     request en el atributo `last_request_info` del cliente
     (`AuthenticatedAPIClient` lo hace transparente).

  4. RE-EXPORTS
     Las factories y helpers se importan acá para que los archivos
     `test_*.py` solo necesiten `from conftest import ...` en sus
     fixtures (pero la convención pytest hace que los fixtures
     definidos acá estén disponibles automáticamente sin import).
=====================================================================
"""
from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from typing import Any

import django
import pytest

# ─────────────────────────────────────────────────────────────────────
# Bootstrap Django ANTES de importar nada de apps.*
# pytest-django normalmente lo hace al leer DJANGO_SETTINGS_MODULE de
# pytest.ini, pero forzamos el setup explícito por si algún import
# colateral se evalúa antes que el plugin.
# ─────────────────────────────────────────────────────────────────────
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from rest_framework.test import APIClient  # noqa: E402  (después de django.setup)

from apps.core.jwt_auth import MwtUser     # noqa: E402

# Re-export para que test_*.py puedan hacer `from conftest import ...`
# (pytest no lo necesita para los fixtures, pero sí para las factories).
from tests import factories  # noqa: F401, E402
from tests._common import (  # noqa: F401, E402
    extract_results,
    assert_uuid_string,
    new_uuid,
    pretty_payload,
    find_by_id,
)


# =====================================================================
# 0) DB REAL · sin base test_* — los tests corren sobre la DB configurada
#    (DB_NAME) y CADA test se envuelve en una transaccion con ROLLBACK.
#    Garantia MWT: al finalizar la suite NO queda ningun dato de prueba.
#    Verificacion independiente: tests/db_guard.py (snapshot + diff de PKs).
# =====================================================================
@pytest.fixture(scope="session")
def django_db_setup():
    """No-op: impide que pytest-django cree/use test_<DB_NAME>."""
    yield


# =====================================================================
# 1) HOOK GLOBAL · auto django_db en cualquier test bajo tests/
# =====================================================================
def pytest_collection_modifyitems(config, items):
    """
    Aplica `@pytest.mark.django_db(transaction=True)` a TODOS los tests
    de la carpeta `tests/`. Beneficios:
      · Cada test corre dentro de su propia transacción (rollback al final).
      · No es necesario decorar manualmente cada función.
      · `transaction=True` permite testear vistas que hacen `transaction.atomic()`
        internamente (ej. ExpedienteViewSet.confirm_sap → C5).
    """
    db_marker = pytest.mark.django_db(transaction=False)
    for item in items:
        # Ola 3.10 · los tests puros (chart_svg) no requieren DB: se marcan
        # con @pytest.mark.no_db para que el auto-django_db NO les aplique.
        if "no_db" in item.keywords:
            continue
        item.add_marker(db_marker)


# =====================================================================
# 2) HOOK · reporte enriquecido en fallas
# =====================================================================
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """
    Wrapper sobre el report estándar: si el test falla y el cliente HTTP
    guardó info de la última request, la imprime de forma legible para
    debugging rápido (sin tener que abrir Postman / curl manualmente).
    """
    outcome = yield
    report = outcome.get_result()

    if report.when != "call" or report.outcome != "failed":
        return

    client = None
    # Buscar el AuthenticatedAPIClient en los fixtures activos del test
    if hasattr(item, "funcargs"):
        for value in item.funcargs.values():
            if isinstance(value, APIClient) and hasattr(value, "last_request_info"):
                client = value
                break

    info: dict[str, Any] | None = getattr(client, "last_request_info", None) if client else None

    sep = "═" * 70
    print(f"\n{sep}", file=sys.stderr)
    print(f"║ ❌  FALLA EN TEST", file=sys.stderr)
    print(f"║ Test:        {item.nodeid}", file=sys.stderr)

    if info:
        print(f"║ Método:      {info.get('method', 'N/A')}", file=sys.stderr)
        print(f"║ Endpoint:    {info.get('path', 'N/A')}", file=sys.stderr)

        payload = info.get("payload")
        if payload is not None:
            print(f"║ Payload enviado:", file=sys.stderr)
            print(_indent_block(pretty_payload(payload), prefix="║   "), file=sys.stderr)

        status = info.get("status_code")
        if status is not None:
            print(f"║ Status:      HTTP {status}", file=sys.stderr)

        response_body = info.get("response_body")
        if response_body is not None:
            print(f"║ Response:    ", file=sys.stderr)
            print(_indent_block(pretty_payload(response_body), prefix="║   "), file=sys.stderr)
    else:
        print(f"║ (No hay info HTTP capturada — probablemente falla en setup o assertion local)",
              file=sys.stderr)

    if call.excinfo is not None:
        print(f"║ Excepción:   {call.excinfo.typename}: {call.excinfo.value}", file=sys.stderr)

    print(f"{sep}\n", file=sys.stderr)


def _indent_block(text: str, prefix: str = "║   ") -> str:
    """Prefija cada línea con `prefix` para encajar en el banner de error."""
    return "\n".join(f"{prefix}{line}" for line in text.splitlines())


# =====================================================================
# 3) CLIENTE HTTP enriquecido
# =====================================================================
class AuthenticatedAPIClient(APIClient):
    """
    APIClient extendido que captura info de cada request para usarla en
    el reporte de fallas. Compatible 100% con APIClient: se usa igual.

    Cada llamada (get/post/put/patch/delete) actualiza
    `self.last_request_info = {method, path, payload, status_code, response_body}`.
    El hook `pytest_runtest_makereport` lo lee si el test falla.
    """

    last_request_info: dict[str, Any] = {}

    def _capture(self, method: str, path: str, payload: Any, response):
        body: Any
        try:
            body = response.json() if hasattr(response, "json") else None
        except Exception:
            body = response.content.decode("utf-8", errors="replace")[:500]
        self.last_request_info = {
            "method":        method.upper(),
            "path":          path,
            "payload":       payload,
            "status_code":   response.status_code,
            "response_body": body,
        }
        return response

    def get(self, path, data=None, follow=False, **extra):
        r = super().get(path, data=data, follow=follow, **extra)
        return self._capture("GET", path, data, r)

    def post(self, path, data=None, format="json", content_type=None, follow=False, **extra):
        r = super().post(path, data=data, format=format, content_type=content_type,
                         follow=follow, **extra)
        return self._capture("POST", path, data, r)

    def put(self, path, data=None, format="json", content_type=None, follow=False, **extra):
        r = super().put(path, data=data, format=format, content_type=content_type,
                        follow=follow, **extra)
        return self._capture("PUT", path, data, r)

    def patch(self, path, data=None, format="json", content_type=None, follow=False, **extra):
        r = super().patch(path, data=data, format=format, content_type=content_type,
                          follow=follow, **extra)
        return self._capture("PATCH", path, data, r)

    def delete(self, path, data=None, format=None, content_type=None, follow=False, **extra):
        r = super().delete(path, data=data, format=format, content_type=content_type,
                           follow=follow, **extra)
        return self._capture("DELETE", path, data, r)


# =====================================================================
# 4) FIXTURES · usuarios + cliente autenticado
# =====================================================================
@pytest.fixture
def mwt_user_admin() -> MwtUser:
    """
    Usuario admin / superuser sintético. NO toca la DB — es un proxy
    in-memory que cumple el contrato que espera DRF.

    role='admin' → has_perm() devuelve True para cualquier módulo.
    """
    return MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-admin@mwt.test",
        full_name="QA Admin",
        role="admin",
        permissions={"modules": ["*"]},
        is_active=True,
    )


@pytest.fixture
def mwt_user_client() -> MwtUser:
    """
    Usuario rol 'cliente' (visibility tier B2B). Útil para tests
    de permisos / scoping.
    """
    return MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-client@mwt.test",
        full_name="QA Client",
        role="cliente",
        permissions={"modules": ["expedientes", "productos", "ocs"]},
        is_active=True,
    )


@pytest.fixture
def api_client() -> AuthenticatedAPIClient:
    """Cliente HTTP plano (sin autenticar). Útil para testear 401."""
    return AuthenticatedAPIClient()


@pytest.fixture
def authenticated_client(api_client: AuthenticatedAPIClient,
                         mwt_user_admin: MwtUser) -> AuthenticatedAPIClient:
    """
    Cliente autenticado como admin vía `force_authenticate`.

    BYPASS de `MwtJWTAuthentication.get_user()`:
      · force_authenticate setea `request.user` directamente, así que
        DRF nunca llama a `authenticate()` y NO hace la query a
        `core.users`. Esto es correcto y deseable: queremos testear las
        vistas, no el mecanismo de autenticación.
    """
    api_client.force_authenticate(user=mwt_user_admin, token={"role": "admin"})
    return api_client


@pytest.fixture
def client_authenticated(api_client: AuthenticatedAPIClient,
                         mwt_user_client: MwtUser) -> AuthenticatedAPIClient:
    """Cliente autenticado con rol 'cliente' (para tests de permisos)."""
    api_client.force_authenticate(user=mwt_user_client, token={"role": "cliente"})
    return api_client
