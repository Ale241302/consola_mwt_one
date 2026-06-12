"""
=====================================================================
MWT.ONE · tests/test_transferencias.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 6 · Transferencias
Endpoints:
  · /api/transferencias/         (TransferenciaViewSet)
  · /api/transfer-lineas/        (LineaViewSet)
  · /api/transfer-eventos/       (EventoViewSet)
  · /api/transfer-documentos/    (TransferenciaDocumentoViewSet)

CICLO DE PRUEBAS:
  · LISTAR   — GET /api/transferencias/  + filtros ?estado, ?origen
  · DETALLE  — GET incluye lineas[] + eventos[] + documentos[]
  · CREAR    — POST con origen_id + destino_id como UUIDs cruzados huérfanos.
  · EDITAR   — PATCH y verificación de updated_at.
  · ELIMINAR — DELETE → 204 + soft delete.
  · STATE MACHINE — approve / dispatch / receive / reconcile / close / cancel,
                    con seeding de TransicionCat para que las transiciones sean legales.
  · DISCREPANCIA — receive() recalcula estado_discrepancia por línea según tolerancia.
  · IDEMPOTENCIA — POST /receive/ con mismo idempotence_token no duplica eventos.
  · DOCUMENTOS   — POST /api/transferencias/{id}/documentos/ + DELETE anidado.

REGLA DE ORO MWT
================
origen_id, destino_id, producto_id, actor_id son UUIDField sin FK.
=====================================================================
"""
from __future__ import annotations

import time
import uuid

import pytest

from apps.transfers.models import (
    Evento,
    Linea as TransferLinea,
    TransicionCat,
    Transferencia,
    TransferenciaDocumento,
)

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    TransferDocumentoPayloadFactory,
    TransferenciaModelFactory,
    TransferenciaPayloadFactory,
    TransferEventoPayloadFactory,
    TransferLineaModelFactory,
    TransferLineaPayloadFactory,
    fake_actor_id,
    fake_nodo_id,
)

pytestmark = [pytest.mark.transferencias, pytest.mark.crud]


URL_TR_LIST     = "/api/transferencias/"
URL_TR_DETAIL   = "/api/transferencias/{pk}/"
URL_LIN_LIST    = "/api/transfer-lineas/"
URL_LIN_DETAIL  = "/api/transfer-lineas/{pk}/"
URL_EV_LIST     = "/api/transfer-eventos/"


# ═════════════════════════════════════════════════════════════════════
# Helpers · seed de TransicionCat (state machine)
# ═════════════════════════════════════════════════════════════════════
def _seed_transitions(*pairs):
    """Crea filas en TransicionCat para que `_validate_transition` permita
    los pasos requeridos por el test."""
    for estado_from, estado_to in pairs:
        TransicionCat.objects.get_or_create(
            estado_from=estado_from,
            estado_to=estado_to,
            defaults={
                "id":             uuid.uuid4(),
                "needs_approval": False,
                "is_active":      True,
            },
        )


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
class TestTransferenciaCrud:
    def test_list_transferencias_returns_seeded_rows(self, authenticated_client):
        seeded = [TransferenciaModelFactory() for _ in range(3)]
        seeded_ids = {str(t.id) for t in seeded}

        response = authenticated_client.get(URL_TR_LIST)
        assert response.status_code == 200, response.content

        results = extract_results(response.json())
        ids = {str(item["id"]) for item in results}
        assert seeded_ids.issubset(ids)
        for item in results:
            assert_uuid_string(item["id"], field_name="transferencia.id")

    def test_list_transferencias_filtra_por_estado(self, authenticated_client):
        plan = TransferenciaModelFactory(estado="PLANNED")
        recv = TransferenciaModelFactory(estado="RECEIVED")

        response = authenticated_client.get(f"{URL_TR_LIST}?estado=PLANNED")
        assert response.status_code == 200, response.content
        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert str(plan.id) in ids
        assert str(recv.id) not in ids, "Filtro ?estado=PLANNED dejó pasar RECEIVED"

    def test_list_transferencias_filtra_por_origen(self, authenticated_client):
        target = new_uuid()
        match  = TransferenciaModelFactory(origen_id=target)
        otro   = TransferenciaModelFactory()

        response = authenticated_client.get(f"{URL_TR_LIST}?origen={target}")
        assert response.status_code == 200, response.content
        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert str(match.id) in ids
        assert str(otro.id) not in ids

    # ─────────────────────────────────────────────────────────────
    # 2) DETALLE
    # ─────────────────────────────────────────────────────────────
    def test_retrieve_transferencia_incluye_lineas_y_eventos(self, authenticated_client):
        t = TransferenciaModelFactory()
        TransferLineaModelFactory(transferencia_id=t.id)
        TransferLineaModelFactory(transferencia_id=t.id)

        url = URL_TR_DETAIL.format(pk=t.id)
        response = authenticated_client.get(url)
        assert response.status_code == 200, response.content

        body = response.json()
        assert str(body["id"]) == str(t.id)
        assert "lineas"     in body and isinstance(body["lineas"], list)
        assert "eventos"    in body and isinstance(body["eventos"], list)
        assert "documentos" in body and isinstance(body["documentos"], list)
        assert len(body["lineas"]) == 2

    def test_retrieve_transferencia_404_when_not_found(self, authenticated_client):
        response = authenticated_client.get(URL_TR_DETAIL.format(pk=new_uuid()))
        assert response.status_code == 404, response.content

    # ─────────────────────────────────────────────────────────────
    # 3) CREAR · UUIDs cruzados sin FK
    # ─────────────────────────────────────────────────────────────
    def test_create_transferencia_with_cross_uuids(self, authenticated_client):
        payload = TransferenciaPayloadFactory()
        assert_uuid_string(payload["origen_id"],  field_name="payload.origen_id")
        assert_uuid_string(payload["destino_id"], field_name="payload.destino_id")
        assert "id" not in payload, "Transferencia NUNCA manda id — el server lo genera"

        response = authenticated_client.post(URL_TR_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        new_id = body["id"]
        assert_uuid_string(new_id, field_name="transferencia.id")
        assert body["codigo"]    == payload["codigo"]
        assert str(body["origen_id"])  == str(payload["origen_id"])
        assert str(body["destino_id"]) == str(payload["destino_id"])

        # DB-level: existe + se creó el primer Evento de "Creación"
        assert Transferencia.objects.filter(pk=new_id, is_active=True).exists()
        eventos = Evento.objects.filter(transferencia_id=new_id)
        assert eventos.count() >= 1, (
            "POST /transferencias/ debería disparar Evento de creación"
        )

    def test_create_transferencia_acepta_origen_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: origen_id huérfano debe aceptarse."""
        payload = TransferenciaPayloadFactory()
        payload["origen_id"] = new_uuid()  # huérfano

        response = authenticated_client.post(URL_TR_LIST, payload)
        assert response.status_code == 201, (
            f"POST con origen_id huérfano falló — ¿FK física en transfers?\n"
            f"  body: {response.content[:300]!r}"
        )

    def test_create_transferencia_codigo_duplicado_devuelve_400(self, authenticated_client):
        """codigo es UNIQUE → segundo POST con el mismo codigo debe ser 400."""
        codigo = f"TR-DUP-{new_uuid()[:8]}"
        TransferenciaModelFactory(codigo=codigo)

        payload = TransferenciaPayloadFactory(codigo=codigo)
        response = authenticated_client.post(URL_TR_LIST, payload)
        assert response.status_code == 400, (
            f"Esperado 400 por codigo duplicado, recibido {response.status_code}.\n"
            f"  body: {response.content[:300]!r}"
        )

    # ─────────────────────────────────────────────────────────────
    # 4) EDITAR · updated_at avanza
    # ─────────────────────────────────────────────────────────────
    def test_update_transferencia_changes_updated_at(self, authenticated_client):
        t = TransferenciaModelFactory(notes="Original")
        # refresh: la columna updated_at es timestamp sin tz en DB — comparar
        # naive vs naive (el valor in-memory de auto_now es aware).
        t.refresh_from_db()
        original_updated_at = t.updated_at

        time.sleep(0.05)

        url = URL_TR_DETAIL.format(pk=t.id)
        response = authenticated_client.patch(url, {"notes": "Editada por QA"})
        assert response.status_code == 200, response.content

        t.refresh_from_db()
        assert t.notes == "Editada por QA"
        assert t.updated_at > original_updated_at

    # ─────────────────────────────────────────────────────────────
    # 5) ELIMINAR · soft delete
    # ─────────────────────────────────────────────────────────────
    def test_soft_delete_transferencia_returns_204_and_inactive(self, authenticated_client):
        t = TransferenciaModelFactory()
        url = URL_TR_DETAIL.format(pk=t.id)

        response = authenticated_client.delete(url)
        assert response.status_code == 204, response.content

        assert Transferencia.objects.filter(pk=t.id).exists(), (
            "Transferencia HARD-DELETED — debería ser soft delete"
        )
        t.refresh_from_db()
        assert t.is_active is False

        followup = authenticated_client.get(url)
        assert followup.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# STATE MACHINE · approve / dispatch / receive / reconcile / cancel
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestTransferenciaStateMachine:
    def test_approve_planned_to_approved(self, authenticated_client):
        _seed_transitions(("PLANNED", "APPROVED"))
        t = TransferenciaModelFactory(estado="PLANNED")

        response = authenticated_client.post(
            f"/api/transferencias/{t.id}/approve/",
            {"actor_id": fake_actor_id(), "actor_name": "QA Approver"},
        )
        assert response.status_code == 200, response.content
        assert response.json()["estado"] == "APPROVED"

        assert Evento.objects.filter(
            transferencia_id=t.id, estado_nuevo="APPROVED",
        ).exists()

    def test_transition_ilegal_devuelve_400(self, authenticated_client):
        """Sin TransicionCat para PLANNED→CLOSED, el endpoint debe rechazar (400)."""
        t = TransferenciaModelFactory(estado="PLANNED")

        response = authenticated_client.post(
            f"/api/transferencias/{t.id}/close/",
            {"actor_id": fake_actor_id()},
        )
        assert response.status_code == 400, (
            f"Transición ilegal debería ser 400, no {response.status_code}.\n"
            f"  body: {response.content[:200]!r}"
        )

    def test_receive_recalcula_discrepancia(self, authenticated_client):
        """receive() con qty_received != qty_transfer marca discrepancia OVER."""
        t = TransferenciaModelFactory(estado="IN_TRANSIT")
        line = TransferLineaModelFactory(
            transferencia_id=t.id,
            qty_transfer=100,
            tolerancia_pct="0.00",
        )

        response = authenticated_client.post(
            f"/api/transferencias/{t.id}/receive/",
            {
                "lineas": [{"id": str(line.id), "qty_received": 120}],
                "received_by_id":   fake_actor_id(),
                "received_by_name": "QA Receiver",
            },
            format="json",
        )
        assert response.status_code == 200, response.content

        line.refresh_from_db()
        assert int(line.qty_received) == 120
        assert line.estado_discrepancia == "OVER", (
            f"Esperaba estado_discrepancia=OVER, got {line.estado_discrepancia}"
        )

        t.refresh_from_db()
        assert t.discrepancy_count >= 1
        # Sin TransicionCat: cae al fallback RECEIVED (no DISCREPANCY)
        assert t.estado in ("RECEIVED", "DISCREPANCY")

    def test_reconcile_requiere_reconciled_by_si_discrepancia(self, authenticated_client):
        """Si has_discrepancy=TRUE el body debe incluir reconciled_by_id, sino 400."""
        _seed_transitions(("DISCREPANCY", "RECONCILED"))

        # Forzamos has_discrepancy=True a nivel ORM (en producción es generated)
        t = TransferenciaModelFactory(
            estado="DISCREPANCY",
            discrepancy_count=2,
            has_discrepancy=True,
        )

        response = authenticated_client.post(
            f"/api/transferencias/{t.id}/reconcile/",
            {"reconciled_note": "Sin firmante"},
            format="json",
        )
        assert response.status_code == 400, (
            f"Esperado 400 por falta de reconciled_by_id, got {response.status_code}.\n"
            f"  body: {response.content[:200]!r}"
        )

    def test_idempotence_token_en_approve(self, authenticated_client):
        """approve() con mismo idempotence_token no duplica eventos."""
        _seed_transitions(("PLANNED", "APPROVED"))
        t = TransferenciaModelFactory(estado="PLANNED")
        token = f"tok-{new_uuid()}"

        body = {
            "actor_id":          fake_actor_id(),
            "idempotence_token": token,
        }
        first = authenticated_client.post(
            f"/api/transferencias/{t.id}/approve/", body, format="json",
        )
        assert first.status_code == 200, first.content

        second = authenticated_client.post(
            f"/api/transferencias/{t.id}/approve/", body, format="json",
        )
        assert second.status_code == 200, second.content

        eventos_token = Evento.objects.filter(
            transferencia_id=t.id, idempotence_token=token,
        ).count()
        assert eventos_token == 1, (
            f"Esperaba 1 evento idempotente, hay {eventos_token}"
        )


# ═════════════════════════════════════════════════════════════════════
# LINEA · CRUD
# ═════════════════════════════════════════════════════════════════════
class TestLineaCrud:
    def test_list_lineas_filtra_por_transferencia(self, authenticated_client):
        t = TransferenciaModelFactory()
        l1 = TransferLineaModelFactory(transferencia_id=t.id)
        l2 = TransferLineaModelFactory(transferencia_id=t.id)
        otro = TransferLineaModelFactory()

        response = authenticated_client.get(f"{URL_LIN_LIST}?transferencia={t.id}")
        assert response.status_code == 200, response.content
        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert {str(l1.id), str(l2.id)}.issubset(ids)
        assert str(otro.id) not in ids

    def test_create_linea_with_cross_uuids(self, authenticated_client):
        payload = TransferLineaPayloadFactory()
        response = authenticated_client.post(URL_LIN_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"], field_name="linea.id")
        assert int(body["qty_transfer"]) == int(payload["qty_transfer"])

    def test_update_linea_qty_received_recalcula_discrepancia(self, authenticated_client):
        line = TransferLineaModelFactory(qty_transfer=100, tolerancia_pct="5.00")

        # 102 dentro de tolerancia (delta = 2%, tolerancia = 5%)
        response = authenticated_client.patch(
            URL_LIN_DETAIL.format(pk=line.id),
            {"qty_received": 102},
            format="json",
        )
        assert response.status_code == 200, response.content

        line.refresh_from_db()
        assert int(line.qty_received) == 102
        assert line.estado_discrepancia == "WITHIN_TOLERANCE", (
            f"Esperaba WITHIN_TOLERANCE, got {line.estado_discrepancia}"
        )

    def test_soft_delete_linea(self, authenticated_client):
        line = TransferLineaModelFactory()
        response = authenticated_client.delete(URL_LIN_DETAIL.format(pk=line.id))
        assert response.status_code == 204

        line.refresh_from_db()
        assert line.is_active is False


# ═════════════════════════════════════════════════════════════════════
# EVENTO · CRUD + idempotencia
# ═════════════════════════════════════════════════════════════════════
class TestEventoCrud:
    def test_list_eventos_filtra_por_transferencia(self, authenticated_client):
        t = TransferenciaModelFactory()
        Evento.objects.create(
            id=uuid.uuid4(),
            transferencia_id=t.id,
            estado_prev=None,
            estado_nuevo="PLANNED",
        )

        response = authenticated_client.get(f"{URL_EV_LIST}?transferencia={t.id}")
        assert response.status_code == 200, response.content
        results = extract_results(response.json())
        assert all(str(e["transferencia_id"]) == str(t.id) for e in results)

    def test_create_evento_idempotente(self, authenticated_client):
        token = f"ev-tok-{new_uuid()}"
        payload = TransferEventoPayloadFactory(idempotence_token=token)

        first = authenticated_client.post(URL_EV_LIST, payload)
        assert first.status_code == 201, first.content
        first_id = first.json()["id"]

        second = authenticated_client.post(URL_EV_LIST, payload)
        assert second.status_code == 200, (
            f"Reintento idempotente debería ser 200, got {second.status_code}"
        )
        assert second.json()["id"] == first_id


# ═════════════════════════════════════════════════════════════════════
# DOCUMENTOS · nested resource
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestTransferenciaDocumentos:
    def _url_docs(self, tr_id):
        return f"/api/transferencias/{tr_id}/documentos/"

    def _url_doc_detail(self, tr_id, doc_id):
        return f"/api/transferencias/{tr_id}/documentos/{doc_id}/"

    def test_list_documentos_inicial_vacia(self, authenticated_client):
        t = TransferenciaModelFactory()
        response = authenticated_client.get(self._url_docs(t.id))
        assert response.status_code == 200, response.content
        assert response.json() == []

    def test_create_documento_201(self, authenticated_client):
        t = TransferenciaModelFactory()
        payload = TransferDocumentoPayloadFactory()
        response = authenticated_client.post(
            self._url_docs(t.id), payload, format="json",
        )
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"], field_name="documento.id")
        assert str(body["transferencia_id"]) == str(t.id), (
            "El viewset debe inyectar transferencia_id desde la URL"
        )

    def test_soft_delete_documento(self, authenticated_client):
        t = TransferenciaModelFactory()
        d = TransferenciaDocumento.objects.create(
            id=uuid.uuid4(),
            transferencia_id=t.id,
            tipo="REMISION",
            titulo="Doc QA",
            is_active=True,
        )

        response = authenticated_client.delete(self._url_doc_detail(t.id, d.id))
        assert response.status_code == 204, response.content

        d.refresh_from_db()
        assert d.is_active is False


# ═════════════════════════════════════════════════════════════════════
# SELECTS + KPIs
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestTransferenciaSelectsAndKpis:
    def test_select_transiciones_responde_lista(self, authenticated_client):
        _seed_transitions(("PLANNED", "APPROVED"), ("APPROVED", "IN_TRANSIT"))
        response = authenticated_client.get("/api/transferencias/select_transiciones/")
        assert response.status_code == 200, response.content

        results = response.json()
        assert isinstance(results, list)
        pares = {(r["estado_from"], r["estado_to"]) for r in results}
        assert ("PLANNED", "APPROVED")    in pares
        assert ("APPROVED", "IN_TRANSIT") in pares

    def test_kpis_endpoint_responde_keys_canonicas(self, authenticated_client):
        TransferenciaModelFactory(estado="PLANNED")
        TransferenciaModelFactory(estado="RECEIVED")
        response = authenticated_client.get("/api/transferencias/kpis/")
        assert response.status_code == 200, response.content

        body = response.json()
        for key in (
            "total", "planned", "approved", "in_transit", "received",
            "reconciled", "cancelled", "closed", "needs_approval",
            "discrepancies_active", "value_usd_active",
        ):
            assert key in body, f"KPI {key!r} ausente en {sorted(body.keys())}"
