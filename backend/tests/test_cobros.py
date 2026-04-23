"""
=====================================================================
MWT.ONE · tests/test_cobros.py
Agente responsable: [AG-06-QA]

BLOQUE 3 · Módulo 15 — Cobros & Pagos

Cobertura:
  · Cobro CRUD + soft-delete + selects + KPIs + refresh_mora + plan vencimientos
  · Pago CRUD + idempotencia external_id + delta cobro on VERIFICADO
            + reverso al cambiar de VERIFICADO → otro estado
            + retenciones (append-only)
  · Conciliacion CRUD + idempotencia idempotence_token
  · Vencimiento CRUD (T1/T2/T3 plan)
  · WithholdingLog (append-only)
  · FxRateHistory CRUD + idempotencia tupla (fecha, from, to, source)
                       + lookup ≤ fecha
  · CollectionEvent (append-only) + bump last_reminder_at en cobro

REGLA DE ORO MWT:
  · *_id se aceptan como str(uuid.uuid4()) sin requerir filas padre
  · Soft-delete: DELETE → 204; instancia queda con is_active=False
=====================================================================
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.cobros.models import (
    Cobro,
    CollectionEvent,
    Conciliacion,
    FxRateHistory,
    Pago,
    Vencimiento,
    WithholdingLog,
)
from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    CobroModelFactory,
    CobroPayloadFactory,
    ConciliacionModelFactory,
    ConciliacionPayloadFactory,
    PagoModelFactory,
    PagoPayloadFactory,
    VencimientoModelFactory,
    VencimientoPayloadFactory,
)


# ════════════════════════════════════════════════════════════════════
# COBRO · CRUD + KPIs + refresh_mora + plan vencimientos
# ════════════════════════════════════════════════════════════════════
class TestCobroCrud:
    def test_list_cobros(self, authenticated_client):
        CobroModelFactory.create_batch(3)
        r = authenticated_client.get("/api/cobros/")
        assert r.status_code == 200, r.json()
        items = extract_results(r.json())
        assert len(items) >= 3
        for it in items[:3]:
            assert_uuid_string(it["id"], "cobro.id")

    def test_list_filter_by_client(self, authenticated_client):
        client_id = new_uuid()
        CobroModelFactory.create(client_id=client_id)
        CobroModelFactory.create()
        r = authenticated_client.get(f"/api/cobros/?client={client_id}")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 1
        assert all(str(it["client_id"]) == client_id for it in items)

    def test_list_filter_en_mora(self, authenticated_client):
        CobroModelFactory.create(dias_mora=15, bucket_mora="T1",
                                 monto_pendiente="100.00")
        CobroModelFactory.create(dias_mora=0, bucket_mora="T0",
                                 monto_pendiente="100.00")
        r = authenticated_client.get("/api/cobros/?en_mora=1")
        assert r.status_code == 200
        items = extract_results(r.json())
        for it in items:
            assert int(it["dias_mora"]) > 0

    def test_retrieve_cobro_incluye_vencimientos(self, authenticated_client):
        c = CobroModelFactory.create()
        VencimientoModelFactory.create(cobro_id=c.id, tramo="T1")
        VencimientoModelFactory.create(cobro_id=c.id, tramo="T2")
        r = authenticated_client.get(f"/api/cobros/{c.id}/")
        assert r.status_code == 200, r.json()
        body = r.json()
        assert str(body["id"]) == str(c.id)
        assert "vencimientos" in body
        assert len(body["vencimientos"]) == 2

    def test_create_cobro_genera_id(self, authenticated_client):
        payload = CobroPayloadFactory()
        r = authenticated_client.post("/api/cobros/", payload, format="json")
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "cobro.id")
        assert body["codigo"] == payload["codigo"]
        assert body["client_id"] == payload["client_id"]

    def test_acepta_oc_id_inexistente_canary(self, authenticated_client):
        """REGLA DE ORO: cobro.oc_id es UUIDField sin FK → no valida existencia."""
        payload = CobroPayloadFactory(oc_id=new_uuid(), client_id=new_uuid())
        r = authenticated_client.post("/api/cobros/", payload, format="json")
        assert r.status_code == 201, r.json()

    def test_create_codigo_duplicado_400(self, authenticated_client):
        c1 = CobroModelFactory.create(codigo="COB-DUP-001")
        payload = CobroPayloadFactory(codigo="COB-DUP-001")
        r = authenticated_client.post("/api/cobros/", payload, format="json")
        # Unique constraint a nivel DB → 400 desde el serializer (UniqueValidator)
        # Si el serializer no valida, igual debe ser 4xx
        assert 400 <= r.status_code < 500, (
            f"Codigo duplicado debe rechazarse, recibí {r.status_code}: {r.content!r}"
        )

    def test_update_cobro(self, authenticated_client):
        c = CobroModelFactory.create(estado="PENDIENTE")
        r = authenticated_client.patch(
            f"/api/cobros/{c.id}/",
            {"notas": "Updated por test", "dias_credito": 60},
            format="json",
        )
        assert r.status_code == 200, r.json()
        c.refresh_from_db()
        assert c.notas == "Updated por test"
        assert c.dias_credito == 60

    def test_delete_cobro_es_soft(self, authenticated_client):
        c = CobroModelFactory.create()
        r = authenticated_client.delete(f"/api/cobros/{c.id}/")
        assert r.status_code == 204
        c.refresh_from_db()
        assert c.is_active is False

    def test_retrieve_inexistente_404(self, authenticated_client):
        ghost = new_uuid()
        r = authenticated_client.get(f"/api/cobros/{ghost}/")
        assert r.status_code == 404


class TestCobroSelectsAndKpis:
    """Catálogos + KPIs (raw SQL: si la tabla no existe en TEST DB, debe
    devolver 200 con dict default — no 500)."""

    def test_select_estados_es_lista(self, authenticated_client):
        r = authenticated_client.get("/api/cobros/select_estados/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_select_buckets_es_lista(self, authenticated_client):
        r = authenticated_client.get("/api/cobros/select_buckets/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_select_collection_stages_es_lista(self, authenticated_client):
        r = authenticated_client.get("/api/cobros/select_collection_stages/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_kpis_tolerante_si_no_seedeado(self, authenticated_client):
        """KPIs usa raw SQL en cobros.cobro; siempre debe responder 200."""
        r = authenticated_client.get("/api/cobros/kpis/")
        assert r.status_code == 200
        body = r.json()
        # estructura mínima esperada
        for k in ("total", "pendientes", "monto_total", "t1", "t2", "t3", "t4"):
            assert k in body, f"KPI debe incluir {k}: {body}"


class TestCobroRefreshMoraYVencimientos:
    """refresh_mora recalcula bucket / stage; vencimientos POST reemplaza plan."""

    def test_refresh_mora_recalcula_bucket_y_stage(self, authenticated_client):
        # Cobro con monto_pendiente > 0 y vencimiento en el pasado
        cobro = CobroModelFactory.create(
            fecha_vencimiento=(date.today() - timedelta(days=45)),
            monto_pendiente="500.00",
            dias_mora=0,
            bucket_mora="T0",
            collection_stage="NONE",
        )
        r = authenticated_client.post(
            "/api/cobros/refresh_mora/",
            {"cobro_id": str(cobro.id)}, format="json",
        )
        assert r.status_code == 200, r.json()
        assert r.json()["updated"] >= 1
        cobro.refresh_from_db()
        assert cobro.dias_mora >= 40
        # 45 días → bucket T2 (31..60), stage DUNNING (1..60)
        assert cobro.bucket_mora == "T2"
        assert cobro.collection_stage == "DUNNING"

    def test_refresh_mora_sin_vencimiento_o_pendiente_cero(self, authenticated_client):
        cobro = CobroModelFactory.create(
            fecha_vencimiento=None, monto_pendiente="0.00",
            dias_mora=0, bucket_mora="T0", collection_stage="NONE",
        )
        r = authenticated_client.post("/api/cobros/refresh_mora/", {}, format="json")
        assert r.status_code == 200
        cobro.refresh_from_db()
        assert cobro.dias_mora == 0
        assert cobro.bucket_mora == "T0"

    def test_post_vencimientos_reemplaza_plan(self, authenticated_client):
        cobro = CobroModelFactory.create()
        # Pre-cargar 1 vencimiento que debe quedar inactivo tras POST
        VencimientoModelFactory.create(cobro_id=cobro.id, tramo="T1")
        body = {"plan": [
            {"tramo": "T1", "pct_monto": "33.33", "monto_usd": "1000.00",
             "fecha_vencimiento": "2026-05-30"},
            {"tramo": "T2", "pct_monto": "33.33", "monto_usd": "1000.00",
             "fecha_vencimiento": "2026-06-30"},
            {"tramo": "T3", "pct_monto": "33.34", "monto_usd": "1000.00",
             "fecha_vencimiento": "2026-07-30"},
        ]}
        r = authenticated_client.post(
            f"/api/cobros/{cobro.id}/vencimientos/", body, format="json"
        )
        assert r.status_code == 201, r.json()
        assert r.json()["count"] == 3
        # Sólo 3 activos (el viejo quedó soft-deleted)
        active = Vencimiento.objects.filter(
            cobro_id=cobro.id, is_active=True
        ).count()
        assert active == 3

    def test_get_vencimientos_lista(self, authenticated_client):
        cobro = CobroModelFactory.create()
        VencimientoModelFactory.create_batch(2, cobro_id=cobro.id)
        r = authenticated_client.get(f"/api/cobros/{cobro.id}/vencimientos/")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) == 2


# ════════════════════════════════════════════════════════════════════
# PAGO · CRUD + idempotencia external_id + delta cobro
# ════════════════════════════════════════════════════════════════════
class TestPagoCrud:
    def test_list_pagos(self, authenticated_client):
        PagoModelFactory.create_batch(3)
        r = authenticated_client.get("/api/pagos/")
        assert r.status_code == 200
        assert len(extract_results(r.json())) >= 3

    def test_list_filter_by_estado(self, authenticated_client):
        PagoModelFactory.create(estado="VERIFICADO")
        PagoModelFactory.create(estado="PENDIENTE")
        r = authenticated_client.get("/api/pagos/?estado=VERIFICADO")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert all(it["estado"] == "VERIFICADO" for it in items)

    def test_create_pago_genera_id(self, authenticated_client):
        payload = PagoPayloadFactory()
        r = authenticated_client.post("/api/pagos/", payload, format="json")
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "pago.id")
        assert body["codigo"] == payload["codigo"]

    def test_acepta_cobro_id_inexistente_canary(self, authenticated_client):
        payload = PagoPayloadFactory(cobro_id=new_uuid(), client_id=new_uuid())
        r = authenticated_client.post("/api/pagos/", payload, format="json")
        assert r.status_code == 201

    def test_create_pago_idempotente_por_external_id(self, authenticated_client):
        ext_id = f"BANK-EXT-{uuid.uuid4().hex[:12]}"
        payload1 = PagoPayloadFactory(external_id=ext_id)
        r1 = authenticated_client.post("/api/pagos/", payload1, format="json")
        assert r1.status_code == 201, r1.json()
        first_id = r1.json()["id"]
        # Reintento: mismo external_id → 200 + mismo id (idempotencia)
        payload2 = PagoPayloadFactory(external_id=ext_id)
        r2 = authenticated_client.post("/api/pagos/", payload2, format="json")
        assert r2.status_code == 200, (
            f"Idempotencia external_id debe devolver 200 reusando, recibí {r2.status_code}: {r2.json()}"
        )
        assert r2.json()["id"] == first_id, "El pago devuelto debe ser el original"
        # Solo hay UN pago activo con ese external_id
        count = Pago.objects.filter(external_id=ext_id, is_active=True).count()
        assert count == 1

    def test_create_pago_verificado_aplica_delta_cobro(self, authenticated_client):
        cobro = CobroModelFactory.create(
            monto_total="1000.00", monto_pagado="0.00", monto_pendiente="1000.00",
            estado="PENDIENTE",
        )
        payload = PagoPayloadFactory(
            cobro_id=str(cobro.id),
            estado="VERIFICADO",
            monto="400.00",
            monto_usd="400.00",
        )
        r = authenticated_client.post("/api/pagos/", payload, format="json")
        assert r.status_code == 201, r.json()
        cobro.refresh_from_db()
        # _aplicar_delta_cobro hace UPDATE: monto_pagado += 400
        assert Decimal(str(cobro.monto_pagado)) == Decimal("400.00"), (
            f"monto_pagado debe incrementarse a 400.00, está en {cobro.monto_pagado}"
        )

    def test_update_pago_a_verificado_aplica_delta(self, authenticated_client):
        cobro = CobroModelFactory.create(
            monto_total="500.00", monto_pagado="0.00", monto_pendiente="500.00",
        )
        pago = PagoModelFactory.create(
            cobro_id=cobro.id, estado="PENDIENTE", monto="200.00",
        )
        r = authenticated_client.patch(
            f"/api/pagos/{pago.id}/", {"estado": "VERIFICADO"}, format="json"
        )
        assert r.status_code == 200, r.json()
        cobro.refresh_from_db()
        assert Decimal(str(cobro.monto_pagado)) == Decimal("200.00")

    def test_update_pago_de_verificado_a_otro_revierte_delta(self, authenticated_client):
        cobro = CobroModelFactory.create(
            monto_total="500.00", monto_pagado="200.00", monto_pendiente="300.00",
        )
        pago = PagoModelFactory.create(
            cobro_id=cobro.id, estado="VERIFICADO", monto="200.00",
        )
        r = authenticated_client.patch(
            f"/api/pagos/{pago.id}/", {"estado": "RECHAZADO"}, format="json"
        )
        assert r.status_code == 200, r.json()
        cobro.refresh_from_db()
        # Reverso: monto_pagado -= 200 → 0.00
        assert Decimal(str(cobro.monto_pagado)) == Decimal("0.00"), (
            f"reverso debe llevar monto_pagado a 0.00, está en {cobro.monto_pagado}"
        )

    def test_delete_pago_verificado_revierte_delta(self, authenticated_client):
        cobro = CobroModelFactory.create(
            monto_total="500.00", monto_pagado="300.00", monto_pendiente="200.00",
        )
        pago = PagoModelFactory.create(
            cobro_id=cobro.id, estado="VERIFICADO", monto="300.00",
        )
        r = authenticated_client.delete(f"/api/pagos/{pago.id}/")
        assert r.status_code == 204
        pago.refresh_from_db()
        assert pago.is_active is False
        cobro.refresh_from_db()
        assert Decimal(str(cobro.monto_pagado)) == Decimal("0.00")

    def test_delete_pago_pendiente_no_toca_cobro(self, authenticated_client):
        cobro = CobroModelFactory.create(
            monto_total="500.00", monto_pagado="100.00", monto_pendiente="400.00",
        )
        pago = PagoModelFactory.create(
            cobro_id=cobro.id, estado="PENDIENTE", monto="50.00",
        )
        r = authenticated_client.delete(f"/api/pagos/{pago.id}/")
        assert r.status_code == 204
        cobro.refresh_from_db()
        assert Decimal(str(cobro.monto_pagado)) == Decimal("100.00"), (
            "Borrar pago PENDIENTE no debe alterar cobro.monto_pagado"
        )

    def test_retrieve_pago_incluye_retenciones(self, authenticated_client):
        pago = PagoModelFactory.create()
        # POST retenciones
        r1 = authenticated_client.post(
            f"/api/pagos/{pago.id}/retenciones/",
            {"tipo": "IGV", "tasa_pct": "18.00", "base_usd": "100.00",
             "monto_usd": "18.00"}, format="json",
        )
        assert r1.status_code == 201, r1.json()
        # Retrieve
        r2 = authenticated_client.get(f"/api/pagos/{pago.id}/")
        assert r2.status_code == 200
        body = r2.json()
        assert "retenciones" in body
        assert len(body["retenciones"]) == 1
        assert body["retenciones"][0]["tipo"] == "IGV"


class TestPagoSelects:
    def test_select_metodos(self, authenticated_client):
        r = authenticated_client.get("/api/pagos/select_metodos/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_select_estados(self, authenticated_client):
        r = authenticated_client.get("/api/pagos/select_estados/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_select_direcciones(self, authenticated_client):
        r = authenticated_client.get("/api/pagos/select_direcciones/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ════════════════════════════════════════════════════════════════════
# CONCILIACION · CRUD + idempotencia idempotence_token
# ════════════════════════════════════════════════════════════════════
class TestConciliacionCrud:
    def test_list_conciliaciones(self, authenticated_client):
        ConciliacionModelFactory.create_batch(2)
        r = authenticated_client.get("/api/conciliaciones/")
        assert r.status_code == 200
        assert len(extract_results(r.json())) >= 2

    def test_create_conciliacion(self, authenticated_client):
        payload = ConciliacionPayloadFactory()
        r = authenticated_client.post(
            "/api/conciliaciones/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "conciliacion.id")

    def test_create_conciliacion_idempotente_por_token(self, authenticated_client):
        token = f"IDEMP-{uuid.uuid4().hex[:12]}"
        p1 = ConciliacionPayloadFactory(idempotence_token=token)
        r1 = authenticated_client.post("/api/conciliaciones/", p1, format="json")
        assert r1.status_code == 201, r1.json()
        first_id = r1.json()["id"]
        # Reintento mismo token → 200 + mismo id
        p2 = ConciliacionPayloadFactory(idempotence_token=token)
        r2 = authenticated_client.post("/api/conciliaciones/", p2, format="json")
        assert r2.status_code == 200
        assert r2.json()["id"] == first_id
        count = Conciliacion.objects.filter(
            idempotence_token=token, is_active=True
        ).count()
        assert count == 1

    def test_filter_by_external_ref(self, authenticated_client):
        ext = f"REF-{uuid.uuid4().hex[:8]}"
        ConciliacionModelFactory.create(external_ref=ext)
        ConciliacionModelFactory.create()
        r = authenticated_client.get(
            f"/api/conciliaciones/?external_ref={ext}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any(it.get("external_ref") == ext for it in items)

    def test_delete_conciliacion_es_soft(self, authenticated_client):
        c = ConciliacionModelFactory.create()
        r = authenticated_client.delete(f"/api/conciliaciones/{c.id}/")
        assert r.status_code == 204
        c.refresh_from_db()
        assert c.is_active is False


# ════════════════════════════════════════════════════════════════════
# VENCIMIENTO · CRUD bajo nivel
# ════════════════════════════════════════════════════════════════════
class TestVencimientoCrud:
    def test_list_filter_by_cobro(self, authenticated_client):
        cobro = CobroModelFactory.create()
        VencimientoModelFactory.create_batch(3, cobro_id=cobro.id)
        VencimientoModelFactory.create()
        r = authenticated_client.get(f"/api/vencimientos/?cobro={cobro.id}")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) == 3

    def test_create_vencimiento(self, authenticated_client):
        payload = VencimientoPayloadFactory()
        r = authenticated_client.post("/api/vencimientos/", payload, format="json")
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "vencimiento.id")
        assert r.json()["tramo"] == "T1"

    def test_acepta_cobro_id_inexistente_canary(self, authenticated_client):
        payload = VencimientoPayloadFactory(cobro_id=new_uuid())
        r = authenticated_client.post("/api/vencimientos/", payload, format="json")
        assert r.status_code == 201

    def test_update_vencimiento(self, authenticated_client):
        v = VencimientoModelFactory.create(estado="PENDIENTE")
        r = authenticated_client.patch(
            f"/api/vencimientos/{v.id}/", {"estado": "PAGADO"}, format="json"
        )
        assert r.status_code == 200
        v.refresh_from_db()
        assert v.estado == "PAGADO"

    def test_delete_vencimiento_es_soft(self, authenticated_client):
        v = VencimientoModelFactory.create()
        r = authenticated_client.delete(f"/api/vencimientos/{v.id}/")
        assert r.status_code == 204
        v.refresh_from_db()
        assert v.is_active is False


# ════════════════════════════════════════════════════════════════════
# WITHHOLDING LOG · append-only
# ════════════════════════════════════════════════════════════════════
class TestWithholdingLog:
    def test_create_withholding(self, authenticated_client):
        pago = PagoModelFactory.create()
        payload = {
            "pago_id": str(pago.id),
            "cobro_id": str(uuid.uuid4()),
            "tipo": "RENTA",
            "tasa_pct": "8.00",
            "base_usd": "1000.00",
            "monto_usd": "80.00",
            "referencia_certif": "CERT-RENTA-001",
        }
        r = authenticated_client.post(
            "/api/withholding-log/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "withholding.id")
        assert body["tipo"] == "RENTA"

    def test_list_filter_by_pago(self, authenticated_client):
        pago = PagoModelFactory.create()
        # crear 2 retenciones para el mismo pago
        for _ in range(2):
            authenticated_client.post(
                "/api/withholding-log/",
                {"pago_id": str(pago.id), "tipo": "IGV", "monto_usd": "10.00"},
                format="json",
            )
        r = authenticated_client.get(
            f"/api/withholding-log/?pago={pago.id}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 2
        assert all(str(it["pago_id"]) == str(pago.id) for it in items)


# ════════════════════════════════════════════════════════════════════
# FX RATE HISTORY · CRUD + idempotencia + lookup
# ════════════════════════════════════════════════════════════════════
class TestFxRateHistory:
    def test_create_fx_rate(self, authenticated_client):
        payload = {
            "fecha": "2026-04-20",
            "moneda_from": "PEN",
            "moneda_to": "USD",
            "rate": "0.270000",
            "source": "MANUAL",
        }
        r = authenticated_client.post(
            "/api/fx-rate-history/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "fx.id")

    def test_create_fx_rate_idempotente_por_tupla(self, authenticated_client):
        payload = {
            "fecha": "2026-04-21",
            "moneda_from": "EUR",
            "moneda_to": "USD",
            "rate": "1.080000",
            "source": "BCR",
        }
        r1 = authenticated_client.post(
            "/api/fx-rate-history/", payload, format="json"
        )
        assert r1.status_code == 201, r1.json()
        first_id = r1.json()["id"]
        # Reintento mismo (fecha, from, to, source) → 200 + mismo id
        payload2 = dict(payload, rate="1.090000")  # diferente rate, igual tupla
        r2 = authenticated_client.post(
            "/api/fx-rate-history/", payload2, format="json"
        )
        assert r2.status_code == 200, r2.json()
        assert r2.json()["id"] == first_id
        count = FxRateHistory.objects.filter(
            fecha="2026-04-21", moneda_from="EUR", moneda_to="USD",
            source="BCR", is_active=True,
        ).count()
        assert count == 1

    def test_lookup_devuelve_tc_mas_reciente(self, authenticated_client):
        # 2 TC para PEN→USD: viejo y nuevo
        for fecha, rate in (("2026-04-01", "0.260000"),
                            ("2026-04-15", "0.270000")):
            authenticated_client.post(
                "/api/fx-rate-history/",
                {"fecha": fecha, "moneda_from": "PEN", "moneda_to": "USD",
                 "rate": rate, "source": "BCR"},
                format="json",
            )
        # lookup con fecha 2026-04-20 → debe devolver el de 04-15
        r = authenticated_client.get(
            "/api/fx-rate-history/lookup/?moneda_from=PEN&fecha=2026-04-20"
        )
        assert r.status_code == 200, r.json()
        body = r.json()
        assert body["fecha"] == "2026-04-15"
        assert Decimal(str(body["rate"])) == Decimal("0.270000")

    def test_lookup_404_si_no_hay_tc(self, authenticated_client):
        r = authenticated_client.get(
            "/api/fx-rate-history/lookup/?moneda_from=ZZZ&fecha=2026-04-20"
        )
        assert r.status_code == 404

    def test_list_filter_by_source(self, authenticated_client):
        authenticated_client.post(
            "/api/fx-rate-history/",
            {"fecha": "2026-04-22", "moneda_from": "PEN", "moneda_to": "USD",
             "rate": "0.280000", "source": "SBS"},
            format="json",
        )
        r = authenticated_client.get("/api/fx-rate-history/?source=SBS")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert all(it["source"] == "SBS" for it in items)


# ════════════════════════════════════════════════════════════════════
# COLLECTION EVENT · append-only + bump last_reminder_at
# ════════════════════════════════════════════════════════════════════
class TestCollectionEvent:
    def test_create_collection_event_y_bump_last_reminder(self, authenticated_client):
        cobro = CobroModelFactory.create(last_reminder_at=None)
        payload = {
            "cobro_id": str(cobro.id),
            "client_id": str(cobro.client_id),
            "canal": "EMAIL",
            "stage": "REMINDER",
            "outcome": "SENT",
            "dias_mora_at_event": 15,
            "monto_usd_at_event": "1000.00",
            "actor_type": "BOT",
        }
        r = authenticated_client.post(
            "/api/collection-events/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "event.id")
        assert body["canal"] == "EMAIL"
        # El cobro debe tener last_reminder_at != None
        cobro.refresh_from_db()
        assert cobro.last_reminder_at is not None, (
            "last_reminder_at debió actualizarse al crear el CollectionEvent"
        )

    def test_list_filter_by_cobro(self, authenticated_client):
        cobro = CobroModelFactory.create()
        for _ in range(2):
            authenticated_client.post(
                "/api/collection-events/",
                {"cobro_id": str(cobro.id), "canal": "WHATSAPP",
                 "stage": "DUNNING"},
                format="json",
            )
        r = authenticated_client.get(
            f"/api/collection-events/?cobro={cobro.id}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 2
        assert all(str(it["cobro_id"]) == str(cobro.id) for it in items)

    def test_acepta_cobro_id_inexistente_canary(self, authenticated_client):
        payload = {
            "cobro_id": new_uuid(),
            "canal": "SMS",
            "stage": "REMINDER",
        }
        r = authenticated_client.post(
            "/api/collection-events/", payload, format="json"
        )
        assert r.status_code == 201, r.json()


# ════════════════════════════════════════════════════════════════════
# Integración cross-recurso: pago.VERIFICADO conciliado vs cobro
# ════════════════════════════════════════════════════════════════════
class TestPagoConciliacionIntegracion:
    """Flujo end-to-end: cobro → pago VERIFICADO → conciliación → cobro pagado."""

    def test_flujo_cobro_pago_conciliacion(self, authenticated_client):
        # 1) Crear cobro 1000 USD
        cob_payload = CobroPayloadFactory(
            monto_total="1000.00", monto_pagado="0.00", monto_pendiente="1000.00",
        )
        r1 = authenticated_client.post("/api/cobros/", cob_payload, format="json")
        assert r1.status_code == 201, r1.json()
        cobro_id = r1.json()["id"]

        # 2) Crear pago VERIFICADO 1000 USD → cobro.monto_pagado debe llegar a 1000
        pago_payload = PagoPayloadFactory(
            cobro_id=cobro_id, estado="VERIFICADO",
            monto="1000.00", monto_usd="1000.00",
        )
        r2 = authenticated_client.post("/api/pagos/", pago_payload, format="json")
        assert r2.status_code == 201, r2.json()
        pago_id = r2.json()["id"]
        cobro = Cobro.objects.get(pk=cobro_id)
        assert Decimal(str(cobro.monto_pagado)) == Decimal("1000.00")

        # 3) Crear conciliación (pago_ingreso → cobro)
        conc_payload = ConciliacionPayloadFactory(
            pago_ingreso_id=pago_id, cobro_id=cobro_id,
            monto_matched="1000.00",
        )
        r3 = authenticated_client.post(
            "/api/conciliaciones/", conc_payload, format="json"
        )
        assert r3.status_code == 201, r3.json()

        # 4) Listar conciliaciones filtrando por cobro
        r4 = authenticated_client.get(
            f"/api/conciliaciones/?cobro={cobro_id}"
        )
        assert r4.status_code == 200
        items = extract_results(r4.json())
        assert len(items) >= 1
        assert any(str(it["cobro_id"]) == cobro_id for it in items)
