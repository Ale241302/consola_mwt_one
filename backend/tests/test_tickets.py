"""
=====================================================================
MWT.ONE · tests/test_tickets.py
Agente responsable: [AG-QA-BACKEND-2]

Módulo 16 — Tickets de soporte (apps/tickets).

Cobertura:
  · CRUD ticket (create con identidad del JWT, update parcial,
    soft-delete, retrieve con hilo).
  · Listado batcheado: TicketListSerializer recibe `batch_msg_count` /
    `batch_reason_labels` / `batch_status_labels` vía context desde
    TicketViewSet.list — message_count debe ser correcto para N tickets.
  · Fallback por-fila: el serializer sin context debe computar el
    mismo message_count con queries individuales.
  · Scope por rol: usuario no-admin solo ve sus propios tickets.
  · Catálogos reasons/statuses.

NOTA: los side-effects de email (enqueue_*) están envueltos en
try/except en la vista — no requieren Celery/SMTP en el sandbox.
=====================================================================
"""
from __future__ import annotations

import pytest

from apps.tickets.models import Ticket, TicketMessage
from apps.tickets.serializers import TicketListSerializer
from tests._common import assert_uuid_string, extract_results, find_by_id, new_uuid

pytestmark = [pytest.mark.tickets]

URL = "/api/tickets/"


def _crear_ticket(client, **extra):
    """Helper local: crea un ticket vía API y devuelve el body."""
    payload = {
        "reason":      "BUG",
        "description": "Ticket generado por la suite QA",
        "context_url": "/expedientes",
        **extra,
    }
    r = client.post(URL, payload, format="json")
    assert r.status_code == 201, r.content
    return r.json()


# ═════════════════════════════════════════════════════════════════════
# CRUD
# ═════════════════════════════════════════════════════════════════════
class TestTicketCrud:
    def test_create_ticket(self, authenticated_client, mwt_user_admin):
        body = _crear_ticket(authenticated_client, description="Bug en wizard")
        assert_uuid_string(body["id"], "ticket.id")
        assert body["status"] == "ABIERTO"
        assert body["reason"] == "BUG"
        assert body["description"] == "Bug en wizard"
        # La identidad viene del JWT, no del payload
        assert str(body["user_id"]) == str(mwt_user_admin.id)
        assert Ticket.objects.filter(pk=body["id"], is_active=True).exists()

    def test_create_sin_description_400(self, authenticated_client):
        r = authenticated_client.post(URL, {"reason": "BUG"}, format="json")
        assert r.status_code == 400

    def test_retrieve_incluye_hilo(self, authenticated_client):
        body = _crear_ticket(authenticated_client)
        tid = body["id"]
        r1 = authenticated_client.post(
            f"{URL}{tid}/messages/", {"content": "primer mensaje"}, format="json"
        )
        assert r1.status_code == 201, r1.content
        r = authenticated_client.get(f"{URL}{tid}/")
        assert r.status_code == 200
        det = r.json()
        assert "messages" in det and len(det["messages"]) == 1
        assert det["messages"][0]["content"] == "primer mensaje"

    def test_update_solo_description_y_reason(self, authenticated_client):
        body = _crear_ticket(authenticated_client)
        tid = body["id"]
        r = authenticated_client.patch(
            f"{URL}{tid}/",
            {"description": "Editada por QA", "reason": "MEJORA",
             "status": "FINALIZADO"},  # status NO es editable por PATCH
            format="json",
        )
        assert r.status_code == 200, r.content
        out = r.json()
        assert out["description"] == "Editada por QA"
        assert out["reason"] == "MEJORA"
        assert out["status"] == "ABIERTO", "status solo muta vía /transition/"

    def test_delete_es_soft(self, authenticated_client):
        body = _crear_ticket(authenticated_client)
        tid = body["id"]
        r = authenticated_client.delete(f"{URL}{tid}/")
        assert r.status_code == 204
        t = Ticket.objects.get(pk=tid)
        assert t.is_active is False

    def test_retrieve_inexistente_404(self, authenticated_client):
        r = authenticated_client.get(f"{URL}{new_uuid()}/")
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# Listado batcheado (Fable5 · batch_msg_count + catálogos)
# ═════════════════════════════════════════════════════════════════════
class TestTicketListadoBatcheado:
    def test_message_count_correcto_para_n_tickets(self, authenticated_client):
        """El list() precarga batch_msg_count con UNA query agregada;
        cada fila del listado debe traer su count exacto."""
        # Arrange: 3 tickets con 2 / 1 / 0 mensajes respectivamente
        t1 = _crear_ticket(authenticated_client, description="QA batch t1")["id"]
        t2 = _crear_ticket(authenticated_client, description="QA batch t2")["id"]
        t3 = _crear_ticket(authenticated_client, description="QA batch t3")["id"]
        for tid, n in ((t1, 2), (t2, 1), (t3, 0)):
            for i in range(n):
                r = authenticated_client.post(
                    f"{URL}{tid}/messages/",
                    {"content": f"msg {i} de {tid[:8]}"}, format="json",
                )
                assert r.status_code == 201, r.content

        # Act
        r = authenticated_client.get(URL)
        assert r.status_code == 200
        items = extract_results(r.json())

        # Assert: counts exactos por ticket
        esperado = {t1: 2, t2: 1, t3: 0}
        for tid, n in esperado.items():
            row = find_by_id(items, tid)
            assert row is not None, f"ticket {tid} no aparece en el listado"
            assert row["message_count"] == n, (
                f"ticket {tid[:8]}: message_count={row['message_count']}, esperado {n}"
            )
            # labels resueltos vía batch de catálogos (string, nunca None)
            assert row["reason_label"]
            assert row["status_label"]

    def test_fallback_por_fila_sin_context(self, authenticated_client):
        """Compat: TicketListSerializer SIN context debe computar el
        mismo message_count con el query por-fila."""
        tid = _crear_ticket(authenticated_client, description="QA fallback")["id"]
        for i in range(3):
            r = authenticated_client.post(
                f"{URL}{tid}/messages/", {"content": f"m{i}"}, format="json"
            )
            assert r.status_code == 201
        t = Ticket.objects.get(pk=tid)
        data = TicketListSerializer(t).data            # sin context → fallback
        assert data["message_count"] == 3
        # Y con un batch inyectado, el atajo manda (aunque mienta):
        data2 = TicketListSerializer(
            t, context={"batch_msg_count": {str(t.id): 99}}
        ).data
        assert data2["message_count"] == 99

    def test_filtro_por_status(self, authenticated_client):
        _crear_ticket(authenticated_client)
        r = authenticated_client.get(f"{URL}?status=ABIERTO")
        assert r.status_code == 200
        for it in extract_results(r.json()):
            assert it["status"] == "ABIERTO"


# ═════════════════════════════════════════════════════════════════════
# Scope por rol (R3-adjacente)
# ═════════════════════════════════════════════════════════════════════
class TestTicketScope:
    def test_no_admin_solo_ve_los_suyos(self, authenticated_client,
                                        mwt_user_client):
        # OJO: authenticated_client y client_authenticated comparten la
        # MISMA instancia de api_client (fixture compartida) — usar un
        # segundo APIClient independiente para el rol cliente.
        from rest_framework.test import APIClient
        tid = _crear_ticket(authenticated_client)["id"]
        cliente = APIClient()
        cliente.force_authenticate(user=mwt_user_client, token={"role": "cliente"})
        r = cliente.get(URL)
        assert r.status_code == 200
        assert find_by_id(extract_results(r.json()), tid) is None
        r2 = cliente.get(f"{URL}{tid}/")
        assert r2.status_code == 403


# ═════════════════════════════════════════════════════════════════════
# Catálogos
# ═════════════════════════════════════════════════════════════════════
class TestTicketCatalogos:
    def test_reasons_es_lista(self, authenticated_client):
        r = authenticated_client.get(f"{URL}reasons/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_statuses_es_lista(self, authenticated_client):
        r = authenticated_client.get(f"{URL}statuses/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
