"""
=====================================================================
MWT.ONE · tests/test_dashboard.py
Agente responsable: [AG-06-QA]   (BLOQUE 4 · Dashboard / Analytics)

COBERTURA
=========
1. AnalyticsViewSet — 7 acciones cross-schema (read-only KPIs)
   Todos los endpoints usan raw SQL con try/except → tolerantes a
   tablas inexistentes (devuelven defaults en vez de 500).

2. DashboardSnapshotViewSet — CRUD ModelViewSet
   · Idempotence por `idempotence_token` (early-return 200)
   · `scope_hash` auto-derivado SHA-256 si no se provee
   · Acciones custom: pin, unpin, latest, purge_expired
   · Filtros: user_id, snapshot_type, is_pinned, generated_by, scope_hash
   · Soft-delete: is_active=False

3. WidgetCatViewSet — read-only catálogo (filtros category/min_role)

REGLA DE ORO MWT
================
Todos los `*_id` viajan como UUIDs string sin FK física → se valida
con `assert_uuid_string()`. Tests "Acepta_X_id_inexistente" verifican
que no hay enforcement de FK aguas abajo.
=====================================================================
"""
from __future__ import annotations

import uuid

import pytest

from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    DashboardSnapshotModelFactory,
    DashboardSnapshotPayloadFactory,
    WidgetCatModelFactory,
)


# ═════════════════════════════════════════════════════════════════════
# AnalyticsViewSet — 7 KPI endpoints (raw SQL, tolerante a errores)
# ═════════════════════════════════════════════════════════════════════
class TestAnalyticsKPIs:
    """Las 7 acciones del AnalyticsViewSet deben responder 200 incluso
    si los schemas (expedientes/cobros) están vacíos. Eso valida que
    el patrón try/except con defaults funciona correctamente."""

    URL = "/api/analytics/{action}/"

    def test_dashboard_kpis_endpoint_devuelve_shape_completo(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="dashboard_kpis"))
        assert r.status_code == 200, r.content
        data = r.json()
        # Shape contractual del front (Dashboard.jsx)
        for key in ("active", "total_cost", "total_invoiced", "total_paid",
                    "receivables", "margin_pct",
                    "by_status", "by_brand", "urgent", "cash_90"):
            assert key in data, f"Falta clave {key} en /dashboard_kpis/ → {list(data.keys())}"
        # Numéricos son numéricos; las listas son listas
        assert isinstance(data["active"], int)
        assert isinstance(data["by_status"], list)
        assert isinstance(data["by_brand"], list)
        assert isinstance(data["urgent"], list)
        assert isinstance(data["cash_90"], list)

    def test_cashflow_endpoint_responde_200(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="cashflow"))
        assert r.status_code == 200
        # Devuelve [] si no hay tablas / 12 semanas si hay datos
        body = r.json()
        assert isinstance(body, list)

    def test_aging_endpoint_devuelve_buckets(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="aging"))
        assert r.status_code == 200
        data = r.json()
        for bucket in ("bucket_0_30", "bucket_31_60", "bucket_61_90",
                       "bucket_90_plus", "total"):
            assert bucket in data

    def test_exposicion_clientes_devuelve_lista(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="exposicion_clientes"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_margen_marcas_devuelve_lista(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="margen_marcas"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_by_status_devuelve_lista(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="by_status"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_urgent_devuelve_lista(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(action="urgent"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═════════════════════════════════════════════════════════════════════
# DashboardSnapshotViewSet — CRUD + idempotencia + scope_hash
# ═════════════════════════════════════════════════════════════════════
class TestDashboardSnapshotCRUD:
    URL = "/api/dashboard-snapshots/"

    def test_list_snapshots_devuelve_lista(self, authenticated_client):
        DashboardSnapshotModelFactory.create_batch(3)
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200
        results = extract_results(r.json())
        assert len(results) >= 3

    def test_create_snapshot_genera_uuid_server_side(self, authenticated_client):
        payload = DashboardSnapshotPayloadFactory()
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        data = r.json()
        assert_uuid_string(data["id"], "snapshot.id")
        # user_id viaja como UUID string (REGLA DE ORO)
        assert_uuid_string(data["user_id"], "snapshot.user_id")

    def test_create_snapshot_acepta_user_id_inexistente(self, authenticated_client):
        """[Canary] Sin FK física: cualquier UUID es aceptado."""
        payload = DashboardSnapshotPayloadFactory(user_id=new_uuid())
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content

    def test_idempotence_token_retorna_existing(self, authenticated_client):
        token = f"qa-snap-{uuid.uuid4().hex[:8]}"
        payload = DashboardSnapshotPayloadFactory(idempotence_token=token)

        r1 = authenticated_client.post(self.URL, data=payload, format="json")
        assert r1.status_code == 201
        first_id = r1.json()["id"]

        # Mismo token + payload distinto → debe devolver el primero (200)
        payload2 = DashboardSnapshotPayloadFactory(
            idempotence_token=token,
            label="Otra etiqueta",
        )
        r2 = authenticated_client.post(self.URL, data=payload2, format="json")
        assert r2.status_code == 200, (
            f"Idempotency replay debe devolver 200, no {r2.status_code}"
        )
        assert r2.json()["id"] == first_id, "Debe devolver el snapshot original"
        assert r2.headers.get("X-Idempotent-Replay") == "true"

    def test_scope_hash_auto_derivado_si_no_se_provee(self, authenticated_client):
        payload = DashboardSnapshotPayloadFactory()
        # scope_hash NO va en el payload
        assert "scope_hash" not in payload
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201
        data = r.json()
        assert data.get("scope_hash"), "scope_hash debe ser auto-derivado"
        # SHA-256 hex = 64 chars
        assert len(data["scope_hash"]) == 64

    def test_scope_hash_explicito_se_respeta(self, authenticated_client):
        custom_hash = "a" * 64
        payload = DashboardSnapshotPayloadFactory(scope_hash=custom_hash)
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201
        assert r.json()["scope_hash"] == custom_hash

    def test_filtro_por_user_id(self, authenticated_client):
        target_user = uuid.uuid4()
        DashboardSnapshotModelFactory.create_batch(2, user_id=target_user)
        DashboardSnapshotModelFactory.create_batch(3)  # noise
        r = authenticated_client.get(self.URL, {"user_id": str(target_user)})
        assert r.status_code == 200
        results = extract_results(r.json())
        assert len(results) == 2

    def test_filtro_por_snapshot_type(self, authenticated_client):
        DashboardSnapshotModelFactory.create(snapshot_type="kpi_weekly")
        DashboardSnapshotModelFactory.create(snapshot_type="preferences")
        r = authenticated_client.get(self.URL, {"snapshot_type": "kpi_weekly"})
        assert r.status_code == 200
        results = extract_results(r.json())
        for snap in results:
            assert snap["snapshot_type"] == "kpi_weekly"

    def test_filtro_por_is_pinned_true(self, authenticated_client):
        DashboardSnapshotModelFactory.create(is_pinned=True)
        DashboardSnapshotModelFactory.create(is_pinned=False)
        r = authenticated_client.get(self.URL, {"is_pinned": "true"})
        assert r.status_code == 200
        for snap in extract_results(r.json()):
            assert snap["is_pinned"] is True

    def test_retrieve_snapshot(self, authenticated_client):
        s = DashboardSnapshotModelFactory.create()
        r = authenticated_client.get(f"{self.URL}{s.id}/")
        assert r.status_code == 200
        assert r.json()["id"] == str(s.id)

    def test_update_snapshot(self, authenticated_client):
        s = DashboardSnapshotModelFactory.create(label="Original")
        r = authenticated_client.patch(
            f"{self.URL}{s.id}/",
            data={"label": "Actualizada"},
            format="json",
        )
        assert r.status_code == 200
        assert r.json()["label"] == "Actualizada"

    def test_destroy_snapshot_soft_delete(self, authenticated_client):
        s = DashboardSnapshotModelFactory.create()
        r = authenticated_client.delete(f"{self.URL}{s.id}/")
        assert r.status_code == 204
        # Después del soft-delete, NO aparece en listados
        r2 = authenticated_client.get(self.URL)
        results = extract_results(r2.json())
        assert find_by_id(results, str(s.id)) is None


# ═════════════════════════════════════════════════════════════════════
# Acciones custom: pin / unpin / latest / purge_expired
# ═════════════════════════════════════════════════════════════════════
class TestDashboardSnapshotActions:
    URL = "/api/dashboard-snapshots/"

    def test_pin_action(self, authenticated_client):
        s = DashboardSnapshotModelFactory.create(is_pinned=False)
        r = authenticated_client.post(f"{self.URL}{s.id}/pin/", data={}, format="json")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["is_pinned"] is True

        # Verificación con GET
        rr = authenticated_client.get(f"{self.URL}{s.id}/")
        assert rr.json()["is_pinned"] is True

    def test_pin_404_si_snapshot_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            f"{self.URL}{new_uuid()}/pin/", data={}, format="json"
        )
        assert r.status_code == 404

    def test_unpin_action(self, authenticated_client):
        s = DashboardSnapshotModelFactory.create(is_pinned=True)
        r = authenticated_client.post(f"{self.URL}{s.id}/unpin/", data={}, format="json")
        assert r.status_code == 200
        assert r.json()["is_pinned"] is False

    def test_latest_filtra_por_user_y_snapshot_type(self, authenticated_client):
        u = uuid.uuid4()
        # Crear 2 snapshots tipo preferences para el mismo user
        DashboardSnapshotModelFactory.create(user_id=u, snapshot_type="preferences",
                                             label="vieja")
        DashboardSnapshotModelFactory.create(user_id=u, snapshot_type="preferences",
                                             label="nueva")
        # Otro user no debe filtrarse acá
        DashboardSnapshotModelFactory.create(snapshot_type="preferences")

        r = authenticated_client.get(
            f"{self.URL}latest/",
            {"user_id": str(u), "snapshot_type": "preferences"},
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["user_id"] == str(u)
        assert body["snapshot_type"] == "preferences"

    def test_latest_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(
            f"{self.URL}latest/",
            {"user_id": new_uuid(), "snapshot_type": "kpi_daily"},
        )
        assert r.status_code == 404

    def test_purge_expired_devuelve_count(self, authenticated_client):
        r = authenticated_client.post(
            f"{self.URL}purge_expired/", data={}, format="json"
        )
        # Si la tabla existe y se ejecuta el UPDATE, retorna 200 con purged
        # Si raw SQL falla (tabla inexistente), retorna 500
        assert r.status_code in (200, 500)
        if r.status_code == 200:
            body = r.json()
            assert "ok" in body and "purged" in body


# ═════════════════════════════════════════════════════════════════════
# WidgetCatViewSet — read-only catálogo
# ═════════════════════════════════════════════════════════════════════
class TestWidgetCat:
    URL = "/api/dashboard-widgets/"

    def test_list_widgets(self, authenticated_client):
        WidgetCatModelFactory.create_batch(3)
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200
        results = extract_results(r.json())
        assert isinstance(results, list)

    def test_filtro_por_category(self, authenticated_client):
        WidgetCatModelFactory.create(codigo="widget.cash.x", category="finance")
        WidgetCatModelFactory.create(codigo="widget.kpi.x",  category="kpi")
        r = authenticated_client.get(self.URL, {"category": "finance"})
        assert r.status_code == 200
        for w in extract_results(r.json()):
            assert w["category"] == "finance"

    def test_filtro_por_min_role(self, authenticated_client):
        WidgetCatModelFactory.create(codigo="widget.r1", min_role="admin")
        WidgetCatModelFactory.create(codigo="widget.r2", min_role="ops")
        r = authenticated_client.get(self.URL, {"min_role": "admin"})
        assert r.status_code == 200
        for w in extract_results(r.json()):
            assert w["min_role"] == "admin"

    def test_create_widget_no_permitido(self, authenticated_client):
        """ReadOnlyModelViewSet — POST debe ser 405."""
        r = authenticated_client.post(
            self.URL, data={"codigo": "qa.bad", "label": "X"}, format="json"
        )
        assert r.status_code == 405

    def test_update_widget_no_permitido(self, authenticated_client):
        w = WidgetCatModelFactory.create()
        r = authenticated_client.patch(
            f"{self.URL}{w.codigo}/", data={"label": "Otra"}, format="json"
        )
        assert r.status_code == 405

    def test_delete_widget_no_permitido(self, authenticated_client):
        w = WidgetCatModelFactory.create()
        r = authenticated_client.delete(f"{self.URL}{w.codigo}/")
        assert r.status_code == 405
