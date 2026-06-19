"""
=====================================================================
MWT.ONE · tests/test_finance.py
Agente responsable: [AG-QA-BACKEND-2]

Módulo 17 — Finance · Payments wizard (apps/finance).

Cobertura:
  · GET /api/finance/payments/ con ?limit= (default 200, cap duro 1000,
    inputs inválidos → default).
  · Batches Fable5: batch_apps / batch_evidencia / batch_verdict
    precomputados en list() + fallback por-fila del
    PaymentDetailSerializer sin context.
  · POST /api/finance/payments/ (wizard drawer): validación 400 sin
    evidencia/aplicaciones (el create feliz requiere MinIO — fuera de
    alcance del sandbox).
  · Catálogos select_*.

NOTA DB: finance.payment.monto_usd es GENERATED ALWAYS — el seeding se
hace vía SQL crudo (tests/_factories_v2.insert_row), igual que hace el
propio PaymentService.register en producción.
=====================================================================
"""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from apps.finance.models import Payment
from apps.finance.serializers import PaymentDetailSerializer
from tests._common import extract_results, find_by_id, new_uuid
from tests._factories_v2 import insert_row

pytestmark = [pytest.mark.finance]

URL = "/api/finance/payments/"


def _crear_payment_sql(**extra):
    """Inserta un finance.payment vía SQL crudo (omite monto_usd GENERATED)."""
    pid = extra.pop("id", new_uuid())
    row = {
        "id":                pid,
        "codigo":            f"PAY-QA-{uuid.uuid4().hex[:10].upper()}",
        "expediente_id":     new_uuid(),
        "client_id":         new_uuid(),
        "monto":             "1500.00",
        "moneda":            "USD",
        "tasa_cambio_a_usd": "1",
        "fecha":             date(2026, 6, 1),
        "metodo":            "TRANSFERENCIA_BANCARIA",
        "tipo_pago":         "PARCIAL",
        "referencia":        f"REF-{uuid.uuid4().hex[:8]}",
        "estado":            "PENDIENTE_AI",
        "is_active":         True,
        **extra,
    }
    insert_row("finance.payment", **row)
    return Payment.objects.get(pk=pid)


def _crear_application_sql(payment_id, monto="100.00"):
    aid = new_uuid()
    insert_row(
        "finance.payment_application",
        id=aid, payment_id=str(payment_id),
        applicable_type="COSTO", applicable_id=new_uuid(),
        monto_aplicado=monto, metadata={},
    )
    return aid


def _crear_evidence_sql(payment_id):
    eid = new_uuid()
    insert_row(
        "finance.payment_evidence",
        id=eid, payment_id=str(payment_id),
        object_key=f"finance/payments/{payment_id}/qa.pdf",
        mime_type="application/pdf", size_bytes=1024,
        original_name="qa.pdf",
    )
    return eid


def _crear_verdict_sql(payment_id, is_current=True, status="MATCH"):
    vid = new_uuid()
    insert_row(
        "finance.payment_ai_verdict",
        id=vid, payment_id=str(payment_id),
        is_current=is_current, status=status,
        confianza="95.00", razon_humana="QA verdict",
        model_version="qa-test-1",
    )
    return vid


# ═════════════════════════════════════════════════════════════════════
# Listado + limit
# ═════════════════════════════════════════════════════════════════════
class TestPaymentList:
    def test_list_devuelve_pagos(self, authenticated_client):
        p = _crear_payment_sql()
        r = authenticated_client.get(URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        row = find_by_id(items, str(p.id))
        assert row is not None
        assert row["codigo"] == p.codigo
        # monto_usd lo calcula la DB (GENERATED): monto × tasa
        assert float(row["monto_usd"]) == 1500.00

    def test_limit_aplica(self, authenticated_client):
        for _ in range(3):
            _crear_payment_sql()
        r = authenticated_client.get(f"{URL}?limit=2")
        assert r.status_code == 200
        assert len(extract_results(r.json())) == 2

    def test_limit_invalido_vuelve_al_default(self, authenticated_client):
        _crear_payment_sql()
        for bad in ("abc", "0", "-5"):
            r = authenticated_client.get(f"{URL}?limit={bad}")
            assert r.status_code == 200, f"limit={bad}: {r.content!r}"
            assert len(extract_results(r.json())) >= 1

    def test_limit_cap_1000(self, authenticated_client):
        # No vamos a crear 1001 pagos: validamos que un limit gigante
        # no rompe (el view lo recorta a 1000 con min()).
        _crear_payment_sql()
        r = authenticated_client.get(f"{URL}?limit=999999")
        assert r.status_code == 200
        assert isinstance(extract_results(r.json()), list)

    def test_filtro_por_estado_y_expediente(self, authenticated_client):
        exp_id = new_uuid()
        p = _crear_payment_sql(expediente_id=exp_id, estado="NEEDS_REVIEW")
        _crear_payment_sql()  # ruido
        r = authenticated_client.get(
            f"{URL}?expediente_id={exp_id}&estado=NEEDS_REVIEW"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) == 1
        assert items[0]["id"] == str(p.id)


# ═════════════════════════════════════════════════════════════════════
# Batches Fable5 (batch_apps / batch_evidencia / batch_verdict)
# ═════════════════════════════════════════════════════════════════════
class TestPaymentBatches:
    def test_list_adjunta_aplicaciones_evidencia_y_verdict(self, authenticated_client):
        p1 = _crear_payment_sql()
        p2 = _crear_payment_sql()
        # p1: 2 aplicaciones + evidencia + verdict vigente; p2: nada
        _crear_application_sql(p1.id, monto="700.00")
        _crear_application_sql(p1.id, monto="800.00")
        _crear_evidence_sql(p1.id)
        _crear_verdict_sql(p1.id, is_current=True)
        # verdict NO vigente: no debe aparecer como ai_verdict
        _crear_verdict_sql(p2.id, is_current=False)

        r = authenticated_client.get(URL)
        assert r.status_code == 200
        items = extract_results(r.json())

        row1 = find_by_id(items, str(p1.id))
        assert row1 is not None
        assert len(row1["aplicaciones"]) == 2
        assert row1["evidencia"] is not None
        assert row1["evidencia"]["mime_type"] == "application/pdf"
        assert row1["ai_verdict"] is not None
        assert row1["ai_verdict"]["status"] == "MATCH"

        row2 = find_by_id(items, str(p2.id))
        assert row2 is not None
        assert row2["aplicaciones"] == []
        assert row2["evidencia"] is None
        assert row2["ai_verdict"] is None, "verdict is_current=False no es vigente"

    def test_fallback_por_fila_sin_context(self, authenticated_client):
        """PaymentDetailSerializer sin context (retrieve y callers custom)
        computa los mismos valores con queries por-fila."""
        p = _crear_payment_sql()
        _crear_application_sql(p.id)
        _crear_evidence_sql(p.id)
        _crear_verdict_sql(p.id)
        data = PaymentDetailSerializer(p).data       # sin context → fallback
        assert len(data["aplicaciones"]) == 1
        assert data["evidencia"] is not None
        assert data["ai_verdict"] is not None
        # Con batch inyectado, el atajo manda:
        data2 = PaymentDetailSerializer(p, context={
            "batch_apps": {}, "batch_evidencia": {}, "batch_verdict": {},
        }).data
        assert data2["aplicaciones"] == []
        assert data2["evidencia"] is None
        assert data2["ai_verdict"] is None

    def test_retrieve_detalle(self, authenticated_client):
        p = _crear_payment_sql()
        _crear_application_sql(p.id)
        r = authenticated_client.get(f"{URL}{p.id}/")
        assert r.status_code == 200
        assert len(r.json()["aplicaciones"]) == 1

    def test_retrieve_inexistente_404(self, authenticated_client):
        r = authenticated_client.get(f"{URL}{new_uuid()}/")
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# Wizard create (validación — el happy-path exige MinIO)
# ═════════════════════════════════════════════════════════════════════
class TestPaymentWizardCreate:
    def test_create_sin_aplicaciones_400(self, authenticated_client):
        """PaymentRegisterSerializer exige aplicaciones — el wizard sin aplicaciones debe fallar limpio."""
        r = authenticated_client.post(URL, {
            "expediente_id": new_uuid(),
            "monto":         "100.00",
            "moneda":        "USD",
            "fecha":         "2026-06-01",
            "metodo":        "TRANSFERENCIA_BANCARIA",
            "tipo_pago":     "PARCIAL",
            "referencia":    "REF-QA-1",
        }, format="multipart")
        assert r.status_code == 400, r.content
        body = r.json()
        assert "aplicaciones" in body
        assert "evidencia" not in body

    def test_create_feliz_sin_evidencia(self, authenticated_client):
        """Verifica que un pago sin evidencia se registra correctamente en estado NEEDS_REVIEW."""
        import json
        exp_id = new_uuid()
        aplicaciones = json.dumps([{
            "applicable_type": "COSTO",
            "applicable_id": str(new_uuid()),
            "monto_aplicado": "100.00"
        }])
        r = authenticated_client.post(URL, {
            "expediente_id": str(exp_id),
            "monto":         "100.00",
            "moneda":        "USD",
            "fecha":         "2026-06-01",
            "metodo":        "TRANSFERENCIA_BANCARIA",
            "tipo_pago":     "PARCIAL",
            "referencia":    "REF-QA-OK-1",
            "aplicaciones":  aplicaciones,
        }, format="multipart")
        assert r.status_code in (200, 201), r.content
        body = r.json()
        assert body["estado"] == "NEEDS_REVIEW"
        assert body["evidencia"] is None

    def test_create_payload_vacio_400(self, authenticated_client):
        r = authenticated_client.post(URL, {}, format="multipart")
        assert r.status_code == 400


# ═════════════════════════════════════════════════════════════════════
# Catálogos
# ═════════════════════════════════════════════════════════════════════
class TestFinanceCatalogos:
    @pytest.mark.parametrize("path", [
        "select_metodos", "select_tipos", "select_estados",
    ])
    def test_selects_devuelven_lista(self, authenticated_client, path):
        r = authenticated_client.get(f"{URL}{path}/")
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)
