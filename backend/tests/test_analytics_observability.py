"""
=====================================================================
MWT.ONE · tests/test_analytics_observability.py
Agente responsable: [AG-QA-BACKEND-2]

Módulo 18 — Observabilidad self-hosted (apps/analytics · Fable5):
POST/GET /api/analytics/client-errors/ sobre analytics.client_error_log.

Contrato (views.AnalyticsViewSet.client_errors):
  · POST {message, stack?, path?} → 201 {"ok": true} + INSERT en
    analytics.client_error_log (best-effort: si el INSERT falla → 202).
  · POST sin message → 400 {"ok": false}.
  · GET  → staff only (ADMIN/CEO/superuser) → 200 lista; resto → 403.
  · GET ?limit= → min(limit, 500); inválido → 100.
=====================================================================
"""
from __future__ import annotations

import pytest
from django.db import connection

from tests._common import extract_results

pytestmark = [pytest.mark.analytics]

URL = "/api/analytics/client-errors/"


def _count_rows(message):
    with connection.cursor() as c:
        c.execute(
            "SELECT COUNT(*) FROM analytics.client_error_log WHERE message = %s",
            [message],
        )
        return c.fetchone()[0]


class TestClientErrorsPost:
    def test_post_graba_y_devuelve_201_ok(self, authenticated_client, mwt_user_admin):
        msg = "QA: TypeError x is not a function"
        r = authenticated_client.post(URL, {
            "message": msg,
            "stack":   "at render (App.jsx:42)",
            "path":    "/expedientes",
        }, format="json")
        assert r.status_code == 201, r.content
        assert r.json() == {"ok": True}
        assert _count_rows(msg) == 1
        # user_id / path / stack quedan persistidos
        with connection.cursor() as c:
            c.execute("""
                SELECT user_id::text, path, stack
                  FROM analytics.client_error_log WHERE message = %s
            """, [msg])
            uid, path, stack = c.fetchone()
        assert uid == str(mwt_user_admin.id)
        assert path == "/expedientes"
        assert "App.jsx:42" in stack

    def test_post_sin_message_400(self, authenticated_client):
        r = authenticated_client.post(URL, {"stack": "sin mensaje"}, format="json")
        assert r.status_code == 400
        assert r.json().get("ok") is False

    def test_post_rol_cliente_tambien_puede_reportar(self, client_authenticated):
        """El reporter del frontend corre con cualquier sesión — el rol
        cliente puede ESCRIBIR (best-effort), solo la lectura es staff-only."""
        msg = "QA: crash desde portal B2B"
        r = client_authenticated.post(URL, {"message": msg}, format="json")
        assert r.status_code == 201, r.content
        assert _count_rows(msg) == 1

    def test_post_trunca_message_a_2000(self, authenticated_client):
        r = authenticated_client.post(URL, {"message": "X" * 5000}, format="json")
        assert r.status_code == 201
        with connection.cursor() as c:
            c.execute("""
                SELECT length(message) FROM analytics.client_error_log
                 WHERE message LIKE 'XXXX%' ORDER BY created_at DESC LIMIT 1
            """)
            assert c.fetchone()[0] == 2000


class TestClientErrorsGet:
    def test_get_admin_lista_errores(self, authenticated_client):
        msg = "QA: error visible para staff"
        authenticated_client.post(URL, {"message": msg, "path": "/pagos"},
                                  format="json")
        r = authenticated_client.get(URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        assert any(it["message"] == msg for it in items)
        # shape mínimo de cada fila
        row = next(it for it in items if it["message"] == msg)
        for k in ("id", "user_id", "path", "message", "created_at"):
            assert k in row

    def test_get_rol_cliente_403(self, client_authenticated):
        r = client_authenticated.get(URL)
        assert r.status_code == 403
        assert r.json().get("detail") == "forbidden"

    def test_get_respeta_limit(self, authenticated_client):
        for i in range(3):
            authenticated_client.post(URL, {"message": f"QA limit {i}"},
                                      format="json")
        r = authenticated_client.get(f"{URL}?limit=2")
        assert r.status_code == 200
        assert len(extract_results(r.json())) == 2

    def test_get_limit_invalido_usa_default(self, authenticated_client):
        authenticated_client.post(URL, {"message": "QA limit default"},
                                  format="json")
        r = authenticated_client.get(f"{URL}?limit=abc")
        assert r.status_code == 200
        assert isinstance(extract_results(r.json()), list)
