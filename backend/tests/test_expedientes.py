"""
=====================================================================
MWT.ONE · tests/test_expedientes.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 2 · Expedientes
Endpoints:
  · /api/ocs/          (OcViewSet)
  · /api/expedientes/  (ExpedienteViewSet)

CICLO DE PRUEBAS (5 fases × 2 recursos = 10 tests):
  · LISTAR   — GET /api/<recurso>/
  · DETALLE  — GET /api/<recurso>/<uuid>/
  · CREAR    — POST con UUIDs cruzados (cliente, brand, oc) que NO
               existen en otras tablas porque NO HAY FKs físicas.
  · EDITAR   — PATCH y verificación de updated_at (timestamp avanza).
  · ELIMINAR — DELETE retorna 204 y la fila queda is_active=False.

REGLA DE ORO MWT
================
Ningún test inserta filas en clientes/brands/ocs para "satisfacer" un
FK del recurso bajo prueba — los IDs cruzados se generan con
`str(uuid.uuid4())`. Si esto rompe, el problema no es el test: alguien
agregó un FK físico que viola el contrato de la base.

AISLAMIENTO
===========
Cada test corre en su propia transacción (ver conftest.py:
`pytest_collection_modifyitems` aplica django_db(transaction=True)).
=====================================================================
"""
from __future__ import annotations

import time
from datetime import date

import pytest

from apps.expedientes.models import Expediente, Oc

from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    ExpedienteModelFactory,
    ExpedientePayloadFactory,
    OcModelFactory,
    OcPayloadFactory,
    fake_brand_id,
    fake_cliente_id,
    fake_oc_id,
)

pytestmark = [pytest.mark.expedientes, pytest.mark.crud]


# ═════════════════════════════════════════════════════════════════════
# OC · /api/ocs/
# ═════════════════════════════════════════════════════════════════════
class TestOcCrud:
    """Ciclo CRUD completo para Órdenes de Compra (OcViewSet)."""

    URL_LIST    = "/api/ocs/"
    URL_DETAIL  = "/api/ocs/{pk}/"

    # ─── 1) LISTAR ────────────────────────────────────────────────
    def test_list_ocs_returns_seeded_rows(self, authenticated_client):
        """
        GIVEN: 3 OCs precargadas vía ORM.
        WHEN:  GET /api/ocs/
        THEN:  HTTP 200 + las 3 OCs aparecen en el payload.
        """
        seeded = [OcModelFactory() for _ in range(3)]
        seeded_ids = {str(o.id) for o in seeded}

        response = authenticated_client.get(self.URL_LIST)
        assert response.status_code == 200, response.content

        results = extract_results(response.json())
        returned_ids = {str(item["id"]) for item in results}

        assert seeded_ids.issubset(returned_ids), (
            f"OCs seedeadas no aparecen en el listado.\n"
            f"  esperadas: {seeded_ids}\n"
            f"  recibidas: {returned_ids}"
        )

        # REGLA DE ORO: cada id devuelto es UUID-string
        for item in results:
            assert_uuid_string(item["id"], field_name="oc.id")

    # ─── 2) DETALLE ───────────────────────────────────────────────
    def test_retrieve_oc_returns_full_payload(self, authenticated_client):
        """
        GIVEN: 1 OC en DB.
        WHEN:  GET /api/ocs/<id>/
        THEN:  HTTP 200 + payload con codigo, client_id, brand_id, etc.
        """
        oc = OcModelFactory()
        url = self.URL_DETAIL.format(pk=oc.id)

        response = authenticated_client.get(url)
        assert response.status_code == 200, response.content

        body = response.json()
        assert str(body["id"]) == str(oc.id)
        assert body["codigo"] == oc.codigo
        # Los IDs cruzados son strings, no FKs
        assert_uuid_string(body["client_id"], field_name="oc.client_id")
        assert_uuid_string(body["brand_id"],  field_name="oc.brand_id")

    def test_retrieve_oc_404_when_not_found(self, authenticated_client):
        """OC inexistente → 404."""
        response = authenticated_client.get(self.URL_DETAIL.format(pk=new_uuid()))
        assert response.status_code == 404, response.content

    # ─── 3) CREAR — UUIDs cruzados sin FK física ─────────────────
    def test_create_oc_with_cross_uuids(self, authenticated_client):
        """
        GIVEN: payload con client_id y brand_id generados al vuelo
               (sin filas correspondientes en clientes / brands).
        WHEN:  POST /api/ocs/
        THEN:  HTTP 201 + el id devuelto es UUID-string +
               la fila existe en DB con is_active=True.
        """
        payload = OcPayloadFactory()

        # Sanidad: REGLA DE ORO antes de mandar
        assert_uuid_string(payload["client_id"], field_name="payload.client_id")
        assert_uuid_string(payload["brand_id"],  field_name="payload.brand_id")
        assert "id" not in payload, "El cliente NUNCA manda id — el server lo genera"

        response = authenticated_client.post(self.URL_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        new_id = body["id"]
        assert_uuid_string(new_id, field_name="oc.id")
        assert body["codigo"] == payload["codigo"]
        assert str(body["client_id"]) == str(payload["client_id"])
        assert str(body["brand_id"])  == str(payload["brand_id"])

        # Verificación a nivel DB (no solo lo que la API te devuelve)
        assert Oc.objects.filter(pk=new_id, is_active=True).exists(), (
            f"OC {new_id} no quedó persistida en DB (o quedó is_active=False)"
        )

    # ─── 4) EDITAR — updated_at avanza ───────────────────────────
    def test_update_oc_changes_updated_at(self, authenticated_client):
        """
        GIVEN: OC existente con updated_at = T0.
        WHEN:  PATCH cambiando `notas`.
        THEN:  · HTTP 200
               · response.notas == nuevo valor
               · DB.updated_at > T0 (auto_now actualiza en pre_save)
        """
        oc = OcModelFactory(notas="version inicial")
        original_updated_at = oc.updated_at

        # Forzamos delta temporal mínimo para que updated_at sea distinto
        # incluso en máquinas con resolución alta (algunos drivers redondean).
        time.sleep(0.05)

        url = self.URL_DETAIL.format(pk=oc.id)
        new_notas = f"editada por suite QA · {new_uuid()[:8]}"
        response = authenticated_client.patch(url, {"notas": new_notas})
        assert response.status_code == 200, response.content

        body = response.json()
        assert body["notas"] == new_notas

        # Re-leer desde DB para chequear el timestamp real
        oc.refresh_from_db()
        assert oc.notas == new_notas
        assert oc.updated_at > original_updated_at, (
            f"updated_at no avanzó tras el PATCH.\n"
            f"  original: {original_updated_at!r}\n"
            f"  actual:   {oc.updated_at!r}"
        )

    # ─── 5) ELIMINAR — soft delete (204 + is_active=False) ───────
    def test_soft_delete_oc_returns_204_and_inactive(self, authenticated_client):
        """
        GIVEN: OC activa.
        WHEN:  DELETE /api/ocs/<id>/
        THEN:  · HTTP 204 (sin body)
               · La fila SIGUE existiendo (no es hard delete)
               · is_active = False
               · Subsiguiente GET /api/ocs/<id>/ devuelve 404
                 (porque retrieve filtra is_active=True)
        """
        oc = OcModelFactory()
        url = self.URL_DETAIL.format(pk=oc.id)

        response = authenticated_client.delete(url)
        assert response.status_code == 204, response.content
        # 204 No Content → body vacío
        assert not response.content, f"DELETE devolvió body inesperado: {response.content!r}"

        # La fila persiste (soft delete, no hard delete)
        assert Oc.objects.filter(pk=oc.id).exists(), (
            "La OC fue HARD-DELETED. Esto rompe la auditoría — debe ser soft."
        )

        # …pero is_active = False
        oc.refresh_from_db()
        assert oc.is_active is False, (
            f"Soft delete no cambió is_active a False (actual: {oc.is_active})"
        )

        # Y ya no aparece en retrieve (filtrado por is_active=True)
        followup = authenticated_client.get(url)
        assert followup.status_code == 404, (
            f"OC soft-deleted sigue siendo accesible vía retrieve "
            f"(status={followup.status_code})"
        )


# ═════════════════════════════════════════════════════════════════════
# Expediente · /api/expedientes/
# ═════════════════════════════════════════════════════════════════════
class TestExpedienteCrud:
    """Ciclo CRUD completo para Expedientes (ExpedienteViewSet)."""

    URL_LIST   = "/api/expedientes/"
    URL_DETAIL = "/api/expedientes/{pk}/"

    # ─── 1) LISTAR ────────────────────────────────────────────────
    def test_list_expedientes_returns_seeded_rows(self, authenticated_client):
        """3 expedientes seedeados deben aparecer en el listado."""
        seeded = [ExpedienteModelFactory() for _ in range(3)]
        seeded_ids = {str(e.id) for e in seeded}

        response = authenticated_client.get(self.URL_LIST)
        assert response.status_code == 200, response.content

        results = extract_results(response.json())
        returned_ids = {str(item["id"]) for item in results}

        assert seeded_ids.issubset(returned_ids), (
            f"Expedientes seedeados no aparecen.\n"
            f"  esperados: {seeded_ids}\n"
            f"  recibidos: {returned_ids}"
        )
        for item in results:
            assert_uuid_string(item["id"], field_name="expediente.id")

    # ─── 2) DETALLE ───────────────────────────────────────────────
    def test_retrieve_expediente_returns_full_payload(self, authenticated_client):
        e = ExpedienteModelFactory()
        url = self.URL_DETAIL.format(pk=e.id)

        response = authenticated_client.get(url)
        assert response.status_code == 200, response.content

        body = response.json()
        assert str(body["id"]) == str(e.id)
        assert body["codigo"] == e.codigo
        # IDs cruzados (oc, cliente, brand) — todos UUID-strings, no FKs
        assert_uuid_string(body["oc_id"],     field_name="expediente.oc_id")
        assert_uuid_string(body["client_id"], field_name="expediente.client_id")
        assert_uuid_string(body["brand_id"],  field_name="expediente.brand_id")

    def test_retrieve_expediente_404_when_not_found(self, authenticated_client):
        response = authenticated_client.get(self.URL_DETAIL.format(pk=new_uuid()))
        assert response.status_code == 404, response.content

    # ─── 3) CREAR — UUIDs cruzados ───────────────────────────────
    def test_create_expediente_with_cross_uuids(self, authenticated_client):
        """
        Crea un expediente vinculado a una OC + cliente + brand
        que NO existen en sus respectivas tablas. Debe funcionar
        porque NO HAY FKs físicas.
        """
        payload = ExpedientePayloadFactory()

        # Sanidad: REGLA DE ORO antes de mandar
        for fld in ("oc_id", "client_id", "brand_id"):
            assert_uuid_string(payload[fld], field_name=f"payload.{fld}")
        assert "id" not in payload

        response = authenticated_client.post(self.URL_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        new_id = body["id"]
        assert_uuid_string(new_id, field_name="expediente.id")
        assert body["codigo"] == payload["codigo"]
        assert str(body["oc_id"])     == str(payload["oc_id"])
        assert str(body["client_id"]) == str(payload["client_id"])
        assert str(body["brand_id"])  == str(payload["brand_id"])

        # DB-level
        assert Expediente.objects.filter(pk=new_id, is_active=True).exists()

    # ─── 4) EDITAR — updated_at avanza ───────────────────────────
    def test_update_expediente_changes_updated_at(self, authenticated_client):
        e = ExpedienteModelFactory(notas="inicial")
        original_updated_at = e.updated_at

        time.sleep(0.05)

        url = self.URL_DETAIL.format(pk=e.id)
        new_notas = f"editada · {new_uuid()[:8]}"
        response = authenticated_client.patch(url, {"notas": new_notas})
        assert response.status_code == 200, response.content

        body = response.json()
        assert body["notas"] == new_notas

        e.refresh_from_db()
        assert e.notas == new_notas
        assert e.updated_at > original_updated_at, (
            f"updated_at no avanzó.\n  original: {original_updated_at!r}\n"
            f"  actual:   {e.updated_at!r}"
        )

    # ─── 5) ELIMINAR — soft delete ───────────────────────────────
    def test_soft_delete_expediente_returns_204_and_inactive(self, authenticated_client):
        e = ExpedienteModelFactory()
        url = self.URL_DETAIL.format(pk=e.id)

        response = authenticated_client.delete(url)
        assert response.status_code == 204, response.content
        assert not response.content

        # Fila persiste
        assert Expediente.objects.filter(pk=e.id).exists(), (
            "Expediente HARD-DELETED — debería ser soft delete"
        )
        e.refresh_from_db()
        assert e.is_active is False

        # No aparece en retrieve
        followup = authenticated_client.get(url)
        assert followup.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · cross-module (UUIDs como contrato)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestExpedienteIntegration:
    """
    Tests que cruzan recursos. Validan que los UUIDs son el ÚNICO
    contrato entre módulos — no hay FKs físicas que verificar.
    """

    def test_expediente_referencia_oc_existente_pero_sin_fk(self,
                                                            authenticated_client):
        """
        GIVEN: una OC creada vía API.
        WHEN:  creo un Expediente cuyo oc_id apunta a esa OC.
        THEN:  ambos coexisten — el expediente.oc_id == oc.id, pero a
               nivel SQL NO hay constraint FK (por eso este test
               documenta el contrato lógico, no el físico).
        """
        # 1) Crear OC
        oc_payload = OcPayloadFactory()
        oc_resp = authenticated_client.post("/api/ocs/", oc_payload)
        assert oc_resp.status_code == 201, oc_resp.content
        oc_id = oc_resp.json()["id"]
        assert_uuid_string(oc_id, field_name="oc.id")

        # 2) Crear Expediente referenciando esa OC
        exp_payload = ExpedientePayloadFactory()
        exp_payload["oc_id"]     = oc_id
        exp_payload["client_id"] = oc_payload["client_id"]
        exp_payload["brand_id"]  = oc_payload["brand_id"]

        exp_resp = authenticated_client.post("/api/expedientes/", exp_payload)
        assert exp_resp.status_code == 201, exp_resp.content

        exp_body = exp_resp.json()
        assert str(exp_body["oc_id"])     == str(oc_id)
        assert str(exp_body["client_id"]) == str(oc_payload["client_id"])
        assert str(exp_body["brand_id"])  == str(oc_payload["brand_id"])

    def test_expediente_acepta_oc_id_inexistente(self, authenticated_client):
        """
        Validación explícita de la REGLA DE ORO:
          oc_id puede ser un UUID que no apunta a ninguna OC real
          y la API debe aceptarlo (no hay FK).

        Si este test rompe, alguien agregó un FK físico → revisar
        migración SQL del módulo y revertir.
        """
        payload = ExpedientePayloadFactory()
        payload["oc_id"] = new_uuid()  # UUID al vacío — ninguna OC con ese id

        response = authenticated_client.post("/api/expedientes/", payload)
        assert response.status_code == 201, (
            "El POST con oc_id huérfano falló. ¿Apareció un FK físico?\n"
            f"  status: {response.status_code}\n"
            f"  body:   {response.content[:500]!r}"
        )
