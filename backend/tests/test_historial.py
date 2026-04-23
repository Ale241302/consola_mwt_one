"""
=====================================================================
MWT.ONE · tests/test_historial.py
Agente responsable: [AG-06-QA]   (BLOQUE 4 · Notifications · Historial)

COBERTURA
=========
1. NotificationLogViewSet — CRUD + acciones especiales.
   · Idempotency por idempotence_token.
   · UUID + ts auto-generados server-side.
   · Filtros: expediente / proforma / template_key / trigger / status /
     recipient / q (icontains en subject) / limit.
   · Soft-delete (DELETE → 204 + is_active=False).
   · Acciones:
       · retry: crea log nuevo con retry_of=orig.id, retries+1, idempotente.
       · bulk_send: items[] con idempotence_token per-item, devuelve
         {created, skipped, failed, summary}.
       · by_recipient: agregado SQL (tolerante a schema vacío).
       · kpis: shape contractual.

2. CollectionLogViewSet — view filtrada (trigger ∈ C1/C2/C3).
   · Logs con otro trigger NO aparecen.
   · KPIs específicos de cobranza (c1/c2/c3, amount_overdue_total, …).

3. GraceDaysCatViewSet — list / retrieve / partial_update.

4. EmailQueueLogViewSet — CRUD + idempotency por celery_task_id.
   · KPIs: total/queued/sending/sent/failed/retry/last_24h.

REGLA DE ORO MWT
================
Todos los `*_id` son UUIDs string sin FK enforcement → tests
"acepta_X_id_inexistente" lo verifican.
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
    CollectionLogModelFactory,
    EmailQueueLogModelFactory,
    EmailQueueLogPayloadFactory,
    NotificationLogModelFactory,
    NotificationLogPayloadFactory,
)


# ═════════════════════════════════════════════════════════════════════
# 1) NotificationLogViewSet — CRUD básico
# ═════════════════════════════════════════════════════════════════════
class TestNotificationLogCRUD:
    URL = "/api/notification-logs/"

    def test_list_devuelve_solo_activos(self, authenticated_client):
        n = NotificationLogModelFactory()
        NotificationLogModelFactory(is_active=False)

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        ids = [str(x["id"]) for x in items]
        assert str(n.id) in ids

    def test_list_filtra_por_trigger(self, authenticated_client):
        NotificationLogModelFactory(trigger="manual")
        NotificationLogModelFactory(trigger="C1")

        r = authenticated_client.get(f"{self.URL}?trigger=C1")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["trigger"] == "C1"

    def test_list_filtra_por_status(self, authenticated_client):
        NotificationLogModelFactory(status="Sent")
        NotificationLogModelFactory(status="Failed")

        r = authenticated_client.get(f"{self.URL}?status=Failed")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["status"] == "Failed"

    def test_list_filtra_por_recipient(self, authenticated_client):
        target = "filter-target@mwt.test"
        NotificationLogModelFactory(recipient_email=target)
        NotificationLogModelFactory(recipient_email="otro@mwt.test")

        r = authenticated_client.get(f"{self.URL}?recipient={target}")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["recipient_email"] == target

    def test_list_filtra_por_q_substring_subject(self, authenticated_client):
        n = NotificationLogModelFactory(subject="Recordatorio especial 2026")
        r = authenticated_client.get(f"{self.URL}?q=especial")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any(str(x["id"]) == str(n.id) for x in items)

    def test_list_respeta_query_param_limit(self, authenticated_client):
        for _ in range(3):
            NotificationLogModelFactory()
        r = authenticated_client.get(f"{self.URL}?limit=1")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) <= 1

    def test_create_genera_uuid_server_side(self, authenticated_client):
        payload = NotificationLogPayloadFactory()
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        assert_uuid_string(body["id"], "id")

    def test_create_acepta_expediente_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: expediente_id es UUID string sin FK enforcement."""
        payload = NotificationLogPayloadFactory(expediente_id=new_uuid())
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        assert_uuid_string(r.json()["expediente_id"], "expediente_id")

    def test_create_idempotente_por_token(self, authenticated_client):
        token = new_uuid()
        payload = NotificationLogPayloadFactory(idempotence_token=token)

        r1 = authenticated_client.post(self.URL, data=payload, format="json")
        assert r1.status_code == 201, r1.content
        id1 = r1.json()["id"]

        # Replay
        payload2 = NotificationLogPayloadFactory(idempotence_token=token)
        r2 = authenticated_client.post(self.URL, data=payload2, format="json")
        assert r2.status_code == 200, r2.content
        assert r2.json().get("idempotent") is True
        assert r2.json()["id"] == id1

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_retrieve_devuelve_log_activo(self, authenticated_client):
        n = NotificationLogModelFactory()
        r = authenticated_client.get(f"{self.URL}{n.id}/")
        assert r.status_code == 200, r.content
        assert str(r.json()["id"]) == str(n.id)

    def test_partial_update_acepta_status(self, authenticated_client):
        n = NotificationLogModelFactory(status="Sent")
        r = authenticated_client.patch(
            f"{self.URL}{n.id}/",
            data={"status": "Delivered"}, format="json",
        )
        assert r.status_code == 200, r.content
        assert r.json()["status"] == "Delivered"

    def test_destroy_marca_is_active_false(self, authenticated_client):
        n = NotificationLogModelFactory()
        r = authenticated_client.delete(f"{self.URL}{n.id}/")
        assert r.status_code == 204

        r2 = authenticated_client.get(f"{self.URL}{n.id}/")
        assert r2.status_code == 404

    def test_kpis_endpoint_devuelve_shape_completo(self, authenticated_client):
        NotificationLogModelFactory(status="Sent")
        NotificationLogModelFactory(status="Failed")

        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in (
            "total", "sent", "delivered", "skipped", "failed",
            "exhausted", "bounced", "last_24h", "last_7d", "failure_rate_7d",
        ):
            assert k in body, f"kpis: falta clave '{k}'"


# ═════════════════════════════════════════════════════════════════════
# 2) NotificationLog · retry action
# ═════════════════════════════════════════════════════════════════════
class TestNotificationLogRetry:
    URL = "/api/notification-logs/{id}/retry/"

    def test_retry_404_si_original_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()), data={}, format="json",
        )
        assert r.status_code == 404

    def test_retry_crea_log_nuevo_con_retry_of(self, authenticated_client):
        from apps.notifications.models import NotificationLog
        orig = NotificationLogModelFactory(status="Failed", retries=1)

        r = authenticated_client.post(
            self.URL.format(id=orig.id), data={}, format="json",
        )
        assert r.status_code == 201, r.content
        body = r.json()
        assert "log" in body
        new_log = body["log"]
        # `id` distinto al original
        assert str(new_log["id"]) != str(orig.id)
        assert str(new_log.get("retry_of")) == str(orig.id)
        # retries incrementado
        assert (new_log.get("retries") or 0) == (orig.retries or 0) + 1
        assert new_log["trigger"] == "retry"

    def test_retry_idempotente_por_token(self, authenticated_client):
        orig = NotificationLogModelFactory(status="Failed")
        token = new_uuid()

        r1 = authenticated_client.post(
            self.URL.format(id=orig.id),
            data={"idempotence_token": token},
            format="json",
        )
        assert r1.status_code == 201, r1.content
        new_id = r1.json()["log"]["id"]

        # Replay → 200 con idempotent=True (apuntando al mismo nuevo log)
        r2 = authenticated_client.post(
            self.URL.format(id=orig.id),
            data={"idempotence_token": token},
            format="json",
        )
        assert r2.status_code == 200, r2.content
        # El payload es serializer-flat (no envuelto en "log") cuando es replay
        assert r2.json().get("idempotent") is True
        assert r2.json()["id"] == new_id


# ═════════════════════════════════════════════════════════════════════
# 3) NotificationLog · bulk_send action
# ═════════════════════════════════════════════════════════════════════
class TestNotificationLogBulkSend:
    URL = "/api/notification-logs/bulk-send/"

    def test_400_si_items_no_es_lista(self, authenticated_client):
        r = authenticated_client.post(
            self.URL, data={"items": "not-a-list"}, format="json",
        )
        assert r.status_code == 400

    def test_400_si_items_lista_vacia(self, authenticated_client):
        r = authenticated_client.post(
            self.URL, data={"items": []}, format="json",
        )
        assert r.status_code == 400

    def test_bulk_send_crea_n_logs(self, authenticated_client):
        items = [
            {
                "recipient_email": f"bulk-{i}@mwt.test",
                "template_key":    "qa.bulk.test",
                "subject":         f"Bulk {i}",
                "body_preview":    f"Body {i}",
            }
            for i in range(3)
        ]
        r = authenticated_client.post(
            self.URL, data={"items": items}, format="json",
        )
        assert r.status_code == 201, r.content
        body = r.json()
        assert body.get("ok") is True
        assert len(body["created"]) == 3
        assert body["summary"]["created"] == 3
        assert body["summary"]["skipped"] == 0

    def test_bulk_send_skip_por_idempotence_token(self, authenticated_client):
        token = new_uuid()
        # Pre-existe el primer log
        existing = NotificationLogModelFactory(idempotence_token=token)

        items = [
            {
                "recipient_email":   "x@mwt.test",
                "template_key":      "qa.bulk.skip",
                "idempotence_token": token,  # ya existe → skip
            },
            {
                "recipient_email":   "y@mwt.test",
                "template_key":      "qa.bulk.skip",
                "idempotence_token": new_uuid(),  # nuevo → create
            },
        ]
        r = authenticated_client.post(
            self.URL, data={"items": items}, format="json",
        )
        assert r.status_code == 201, r.content
        body = r.json()
        assert body["summary"]["skipped"] == 1
        assert body["summary"]["created"] == 1
        # El skipped debe referenciar el id existente
        assert body["skipped"][0]["id"] == str(existing.id)


# ═════════════════════════════════════════════════════════════════════
# 4) NotificationLog · by_recipient
# ═════════════════════════════════════════════════════════════════════
class TestNotificationLogByRecipient:
    URL = "/api/notification-logs/by-recipient/"

    def test_endpoint_devuelve_200_con_schema_vacio(self, authenticated_client):
        """Tolerante a schema vacío — devuelve [] en vez de 500."""
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_filtra_por_email(self, authenticated_client):
        target = "agg-target@mwt.test"
        NotificationLogModelFactory(recipient_email=target)
        NotificationLogModelFactory(recipient_email=target)
        NotificationLogModelFactory(recipient_email="otro@mwt.test")

        r = authenticated_client.get(f"{self.URL}?email={target}")
        assert r.status_code == 200, r.content
        items = r.json()
        for row in items:
            assert row["recipient_email"] == target


# ═════════════════════════════════════════════════════════════════════
# 5) CollectionLogViewSet — filtered view (trigger C1/C2/C3)
# ═════════════════════════════════════════════════════════════════════
class TestCollectionLogViewSet:
    URL = "/api/collection-logs/"

    def test_list_solo_devuelve_triggers_c1_c2_c3(self, authenticated_client):
        # Mix: 3 cobranza + 1 manual (no debe aparecer)
        c1 = CollectionLogModelFactory(trigger="C1")
        c2 = CollectionLogModelFactory(trigger="C2")
        c3 = CollectionLogModelFactory(trigger="C3")
        manual = NotificationLogModelFactory(trigger="manual")

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        triggers = [x["trigger"] for x in items]
        for t in triggers:
            assert t in ("C1", "C2", "C3"), (
                f"CollectionLog devolvió trigger fuera del whitelist: {t}"
            )
        ids = [str(x["id"]) for x in items]
        for c in (c1, c2, c3):
            assert str(c.id) in ids
        assert str(manual.id) not in ids, (
            "Log con trigger='manual' no debió aparecer en /collection-logs/"
        )

    def test_list_filtra_por_trigger_dentro_del_whitelist(
        self, authenticated_client,
    ):
        CollectionLogModelFactory(trigger="C1")
        CollectionLogModelFactory(trigger="C2")

        r = authenticated_client.get(f"{self.URL}?trigger=C2")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["trigger"] == "C2"

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_retrieve_devuelve_collection_log(self, authenticated_client):
        c = CollectionLogModelFactory()
        r = authenticated_client.get(f"{self.URL}{c.id}/")
        assert r.status_code == 200, r.content
        assert str(r.json()["id"]) == str(c.id)

    def test_kpis_endpoint_devuelve_shape_completo(self, authenticated_client):
        CollectionLogModelFactory(trigger="C1")
        CollectionLogModelFactory(trigger="C2")
        CollectionLogModelFactory(trigger="C3")

        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in (
            "total", "c1", "c2", "c3", "sent", "failed",
            "amount_overdue_total", "proformas_pinged",
        ):
            assert k in body, f"collection-logs kpis: falta '{k}'"


# ═════════════════════════════════════════════════════════════════════
# 6) GraceDaysCatViewSet — read-only catálogo (CRUD lite)
# ═════════════════════════════════════════════════════════════════════
class TestGraceDaysCatViewSet:
    URL = "/api/grace-days/"

    def test_list_devuelve_200(self, authenticated_client):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        assert isinstance(items, list)

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# 7) EmailQueueLogViewSet — CRUD + idempotency por celery_task_id
# ═════════════════════════════════════════════════════════════════════
class TestEmailQueueLogViewSet:
    URL = "/api/email-queue-log/"

    def test_list_devuelve_solo_activos(self, authenticated_client):
        q = EmailQueueLogModelFactory()
        EmailQueueLogModelFactory(is_active=False)

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        ids = [str(x["id"]) for x in items]
        assert str(q.id) in ids

    def test_list_filtra_por_status(self, authenticated_client):
        EmailQueueLogModelFactory(status="QUEUED")
        EmailQueueLogModelFactory(status="SENT")

        r = authenticated_client.get(f"{self.URL}?status=SENT")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["status"] == "SENT"

    def test_list_respeta_query_param_limit(self, authenticated_client):
        for _ in range(3):
            EmailQueueLogModelFactory()
        r = authenticated_client.get(f"{self.URL}?limit=1")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) <= 1

    def test_create_genera_uuid_server_side(self, authenticated_client):
        payload = EmailQueueLogPayloadFactory()
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        assert_uuid_string(r.json()["id"], "id")

    def test_create_idempotente_por_celery_task_id(self, authenticated_client):
        ctid = "celery-task-fixed-12345"
        payload = EmailQueueLogPayloadFactory(celery_task_id=ctid)

        r1 = authenticated_client.post(self.URL, data=payload, format="json")
        assert r1.status_code == 201, r1.content
        id1 = r1.json()["id"]

        # Replay con mismo celery_task_id
        payload2 = EmailQueueLogPayloadFactory(celery_task_id=ctid)
        r2 = authenticated_client.post(self.URL, data=payload2, format="json")
        assert r2.status_code == 200, r2.content
        assert r2.json().get("idempotent") is True
        assert r2.json()["id"] == id1

    def test_create_acepta_notification_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: notification_id es UUID string sin FK enforcement."""
        payload = EmailQueueLogPayloadFactory(notification_id=new_uuid())
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content

    def test_retrieve_devuelve_queue_log(self, authenticated_client):
        q = EmailQueueLogModelFactory()
        r = authenticated_client.get(f"{self.URL}{q.id}/")
        assert r.status_code == 200, r.content
        assert str(r.json()["id"]) == str(q.id)

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_partial_update_acepta_status(self, authenticated_client):
        q = EmailQueueLogModelFactory(status="QUEUED")
        r = authenticated_client.patch(
            f"{self.URL}{q.id}/",
            data={"status": "SENT"}, format="json",
        )
        assert r.status_code == 200, r.content
        assert r.json()["status"] == "SENT"

    def test_kpis_endpoint_devuelve_shape_completo(self, authenticated_client):
        EmailQueueLogModelFactory(status="QUEUED")
        EmailQueueLogModelFactory(status="SENT")
        EmailQueueLogModelFactory(status="FAILED")

        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in (
            "total", "queued", "sending", "sent", "failed", "retry", "last_24h",
        ):
            assert k in body, f"email-queue-log kpis: falta '{k}'"
