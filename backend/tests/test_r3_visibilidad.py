"""
=====================================================================
MWT.ONE · tests/test_r3_visibilidad.py
Agente responsable: [AG-QA-BACKEND-2]

REGLA R3 · POL_VISIBILIDAD (crítica — CLAUDE.md §2 / §11.1):
Los roles CLIENT_* NUNCA deben recibir campos CEO-only del backend:
precio de costo MWT, márgenes, proformas[] y saps[] del listado de
expedientes. "Renderizar y luego ocultar" es violación: el dato no
debe salir del servidor.

Contrato verificado contra el código actual:
  · ExpedienteListSerializer (apps/expedientes/serializers.py):
      - proforma_codigos → [] para CLIENT_* (gate _is_client)
      - sap_codigos      → [] para CLIENT_* (gate _is_client)
      - viewer_is_operator → False salvo admin/CEO/operador real
  · GradeItemViewSet (apps/commercial/views.py):
      - no-CEO → GradeItemPublicSerializer (SIN cost_usd)
      - CEO    → GradeItemSerializer (CON cost_usd)
  · filter_by_user_clients: no-bypass sin legal_entity_ids → qs.none()
  · _deny_client_mutation: rol cliente no muta OCs/expedientes (403)
=====================================================================
"""
from __future__ import annotations

import uuid as _uuid

import pytest
from rest_framework.test import APIClient

from apps.core.jwt_auth import MwtUser
from apps.expedientes.models import Documento
from tests._common import extract_results, find_by_id, new_uuid
from tests.factories import ExpedientePayloadFactory, GradeItemModelFactory

pytestmark = [pytest.mark.r3, pytest.mark.expedientes]


# ─────────────────────────────────────────────────────────────────────
# Fixtures locales (NO tocar conftest: el api_client compartido haría
# que admin y cliente fueran la misma instancia re-autenticada).
# ─────────────────────────────────────────────────────────────────────
@pytest.fixture
def client_company_id() -> str:
    """UUID de la 'empresa' del cliente B2B del escenario."""
    return new_uuid()


@pytest.fixture
def cliente_scoped(client_company_id) -> APIClient:
    """Rol cliente CON empresa asignada (ve sus expedientes, pero capado)."""
    c = APIClient()
    u = MwtUser(
        user_id=new_uuid(),
        email="qa-b2b-scoped@mwt.test",
        full_name="QA B2B Scoped",
        role="cliente",
        permissions={"modules": ["expedientes"]},
        is_active=True,
        legal_entity_ids=[client_company_id],
    )
    c.force_authenticate(user=u, token={"role": "cliente"})
    return c


@pytest.fixture
def expediente_con_refs(authenticated_client, client_company_id):
    """Expediente del cliente con SAP legacy + Documento PROFORMA."""
    payload = ExpedientePayloadFactory(client_id=client_company_id)
    payload["sap"] = "500123"
    r = authenticated_client.post("/api/expedientes/", payload, format="json")
    assert r.status_code == 201, r.content
    eid = r.json()["id"]
    Documento.objects.create(
        id=_uuid.uuid4(), expediente_id=eid, kind="PROFORMA",
        codigo="PRF-QA-0001", audience="MWT_INTERNAL", is_active=True,
    )
    return eid


# ═════════════════════════════════════════════════════════════════════
# Listado de expedientes — arrays role-aware
# ═════════════════════════════════════════════════════════════════════
class TestListadoExpedientesR3:
    URL = "/api/expedientes/"

    def test_admin_ve_proformas_y_saps(self, authenticated_client,
                                       expediente_con_refs):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200
        row = find_by_id(extract_results(r.json()), expediente_con_refs)
        assert row is not None
        assert row["sap_codigos"] == ["500123"]
        assert "PRF-QA-0001" in row["proforma_codigos"]
        assert row["viewer_is_operator"] is True

    def test_cliente_NO_recibe_proformas_ni_saps(self, cliente_scoped,
                                                 expediente_con_refs):
        """CRÍTICO R3: el cliente ve SU fila, pero proformas[] y saps[]
        llegan vacíos — el dato no sale del servidor."""
        r = cliente_scoped.get(self.URL)
        assert r.status_code == 200, r.content
        row = find_by_id(extract_results(r.json()), expediente_con_refs)
        assert row is not None, "el cliente debe ver su propio expediente"
        assert row["proforma_codigos"] == [], (
            f"R3 VIOLADA: proformas expuestas al cliente: {row['proforma_codigos']}"
        )
        assert row["sap_codigos"] == [], (
            f"R3 VIOLADA: SAPs expuestos al cliente: {row['sap_codigos']}"
        )
        assert row["viewer_is_operator"] is False

    def test_cliente_NO_recibe_proforma_codigo_legacy(self, cliente_scoped,
                                                      expediente_con_refs):
        r = cliente_scoped.get(self.URL)
        assert r.status_code == 200
        row = find_by_id(extract_results(r.json()), expediente_con_refs)
        assert row is not None
        assert not row.get("proforma_codigo"), (
            f"R3 VIOLADA: proforma_codigo legacy expuesto: {row['proforma_codigo']!r}"
        )

    def test_cliente_sin_empresas_lista_vacia(self, expediente_con_refs):
        """Defense-in-depth: no-bypass con legal_entity_ids=[] → qs.none().
        OJO: cliente nuevo e independiente — client_authenticated comparte
        instancia con authenticated_client y quedaría re-autenticado."""
        c = APIClient()
        u = MwtUser(user_id=new_uuid(), email="qa-b2b-sin-scope@mwt.test",
                    full_name="QA B2B Sin Scope", role="cliente",
                    permissions={"modules": ["expedientes"]}, is_active=True)
        c.force_authenticate(user=u, token={"role": "cliente"})
        r = c.get(self.URL)
        assert r.status_code == 200
        assert extract_results(r.json()) == []

    def test_cliente_no_ve_expedientes_ajenos(self, authenticated_client,
                                              cliente_scoped):
        otro = ExpedientePayloadFactory(client_id=new_uuid())  # otra empresa
        r0 = authenticated_client.post("/api/expedientes/", otro, format="json")
        assert r0.status_code == 201
        eid_ajeno = r0.json()["id"]
        r = cliente_scoped.get(self.URL)
        assert r.status_code == 200
        assert find_by_id(extract_results(r.json()), eid_ajeno) is None


# ═════════════════════════════════════════════════════════════════════
# GradeItems — cost_usd jamás viaja a no-CEO
# ═════════════════════════════════════════════════════════════════════
class TestGradeItemsR3:
    URL = "/api/commercial/grade-items/"

    @pytest.fixture
    def grade_item(self):
        return GradeItemModelFactory.create(
            unit_price_usd="100.0000", cost_usd="40.0000",
        )

    def test_admin_ve_cost_usd(self, authenticated_client, grade_item):
        r = authenticated_client.get(f"{self.URL}?pricelist_version_id="
                                     f"{grade_item.pricelist_version_id}")
        assert r.status_code == 200
        items = extract_results(r.json())
        row = find_by_id(items, str(grade_item.id))
        assert row is not None
        assert "cost_usd" in row
        assert float(row["cost_usd"]) == 40.0

    def test_cliente_NO_recibe_cost_usd(self, client_authenticated, grade_item):
        """CRÍTICO R3: GradeItemPublicSerializer no incluye la CLAVE
        cost_usd (ni siquiera en null)."""
        r = client_authenticated.get(f"{self.URL}?pricelist_version_id="
                                     f"{grade_item.pricelist_version_id}")
        assert r.status_code == 200
        items = extract_results(r.json())
        row = find_by_id(items, str(grade_item.id))
        assert row is not None
        assert "cost_usd" not in row, (
            f"R3 VIOLADA: cost_usd llegó al rol cliente: {row.get('cost_usd')!r}"
        )
        assert "unit_price_usd" in row  # el precio de venta sí es visible


# ═════════════════════════════════════════════════════════════════════
# Mutaciones vetadas a CLIENT_* (hard shield server-side)
# ═════════════════════════════════════════════════════════════════════
class TestClientMutationDenyR3:
    def test_cliente_no_crea_ocs(self, client_authenticated):
        r = client_authenticated.post("/api/ocs/", {"codigo": "OC-HACK-1"},
                                      format="json")
        assert r.status_code == 403

    def test_cliente_no_crea_expedientes(self, client_authenticated):
        r = client_authenticated.post("/api/expedientes/",
                                      ExpedientePayloadFactory(), format="json")
        assert r.status_code == 403

    def test_cliente_no_edita_ocs(self, client_authenticated):
        r = client_authenticated.patch(f"/api/ocs/{new_uuid()}/",
                                       {"notas": "hack"}, format="json")
        assert r.status_code == 403
