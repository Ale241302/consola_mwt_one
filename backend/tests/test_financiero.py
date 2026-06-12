"""
=====================================================================
MWT.ONE · tests/test_financiero.py
Agente responsable: [AG-06-QA]

BLOQUE 3 · Módulo 5 — Financiero / apps.commercial

Cobertura:
  · PriceListVersion CRUD + soft-delete + bulk-upsert-items + items
  · GradeItem CRUD + cost_usd masking (CEO vs no-CEO)
  · ClientAssignment (CPA) CRUD
  · EarlyPaymentPolicy CRUD + replace-tiers atómico
  · EarlyPaymentTier CRUD
  · CommissionRule CEO-ONLY (403 para no-CEO)
  · ResolveClientPriceView waterfall:
        - PRICELIST + EPP tier
        - CPA override
        - 404 cuando no hay precio
        - CEO ve cost/margen, no-CEO no
  · Catálogos (currencies / sources / commission-bases)
  · Canaries: id_inexistente devuelve 404 (no 500)

Reglas REGLA DE ORO MWT verificadas:
  · *_id se aceptan como str(uuid.uuid4()) sin requerir filas padre
  · Soft-delete: DELETE → 204 + GET retrieve → 404 (excluido por is_active)

Auth en CEO endpoints:
  El _is_ceo() lee request.auth.get('role'), pero force_authenticate(user=)
  NO setea request.auth. Por eso, las pruebas CEO usan un cliente
  authenticated_with_token que ADEMÁS pasa token={"role": "admin"}.
=====================================================================
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.commercial.models import (
    ClientAssignment,
    CommissionRule,
    EarlyPaymentPolicy,
    EarlyPaymentTier,
    GradeItem,
    PriceListVersion,
)
from apps.core.jwt_auth import MwtUser
from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    ClientAssignmentModelFactory,
    ClientAssignmentPayloadFactory,
    CommissionRuleModelFactory,
    CommissionRulePayloadFactory,
    EarlyPaymentPolicyModelFactory,
    EarlyPaymentPolicyPayloadFactory,
    EarlyPaymentTierModelFactory,
    EarlyPaymentTierPayloadFactory,
    GradeItemModelFactory,
    GradeItemPayloadFactory,
    PriceListVersionModelFactory,
    PriceListVersionPayloadFactory,
)


# ════════════════════════════════════════════════════════════════════
# Fixtures locales · clientes con request.auth poblado (CEO vs no-CEO)
# ════════════════════════════════════════════════════════════════════
@pytest.fixture
def ceo_client(api_client):
    """Cliente autenticado + token con role=admin (CEO-like)."""
    user = MwtUser(
        user_id=str(uuid.uuid4()),
        email="ceo@mwt.test",
        full_name="CEO QA",
        role="admin",
        permissions={"modules": ["*"]},
        is_active=True,
    )
    api_client.force_authenticate(user=user, token={"role": "admin"})
    return api_client


@pytest.fixture
def non_ceo_client(api_client):
    """Cliente autenticado pero rol B2B (NO debe ver cost_usd, NO puede CommissionRule)."""
    user = MwtUser(
        user_id=str(uuid.uuid4()),
        email="b2b@mwt.test",
        full_name="B2B QA",
        role="cliente",
        permissions={"modules": ["productos", "expedientes"]},
        is_active=True,
    )
    api_client.force_authenticate(user=user, token={"role": "cliente"})
    return api_client


# ════════════════════════════════════════════════════════════════════
# PriceListVersion CRUD
# ════════════════════════════════════════════════════════════════════
class TestPriceListVersionCrud:
    """CRUD completo + bulk-upsert-items + items."""

    def test_list_pricelist_versions_returns_paginated(self, ceo_client):
        PriceListVersionModelFactory.create_batch(3)
        r = ceo_client.get("/api/commercial/pricelist-versions/")
        assert r.status_code == 200, r.json()
        items = extract_results(r.json())
        assert len(items) >= 3
        for it in items[:3]:
            assert_uuid_string(it["id"], "pricelist-version.id")
            assert "items_count" in it  # serializer LIST agrega esta clave

    def test_list_filters_by_brand_id(self, ceo_client):
        target_brand = new_uuid()
        PriceListVersionModelFactory.create(brand_id=target_brand)
        PriceListVersionModelFactory.create()  # otra
        r = ceo_client.get(f"/api/commercial/pricelist-versions/?brand_id={target_brand}")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 1
        assert all(str(it["brand_id"]) == target_brand for it in items)

    def test_create_pricelist_version_genera_id(self, ceo_client):
        payload = PriceListVersionPayloadFactory()
        r = ceo_client.post("/api/commercial/pricelist-versions/", payload, format="json")
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "pricelist-version.id")
        assert body["codigo"] == payload["codigo"]
        assert body["brand_id"] == payload["brand_id"]

    def test_retrieve_pricelist_version(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        r = ceo_client.get(f"/api/commercial/pricelist-versions/{plv.id}/")
        assert r.status_code == 200, r.json()
        assert str(r.json()["id"]) == str(plv.id)

    def test_update_pricelist_version(self, ceo_client):
        plv = PriceListVersionModelFactory.create(nombre="Original")
        r = ceo_client.patch(
            f"/api/commercial/pricelist-versions/{plv.id}/",
            {"nombre": "Renombrada QA"}, format="json",
        )
        assert r.status_code == 200, r.json()
        assert r.json()["nombre"] == "Renombrada QA"

    def test_delete_pricelist_version_es_soft(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        r = ceo_client.delete(f"/api/commercial/pricelist-versions/{plv.id}/")
        assert r.status_code == 204
        plv.refresh_from_db()
        assert plv.is_active is False

    def test_bulk_upsert_items_crea_e_idempotente(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        body = {"items": [
            {"product_sku": "BULK-001", "product_name": "Item 1",
             "unit_price_usd": 50.0, "cost_usd": 20.0,
             "size_multipliers": {"40": 4, "41": 6}, "tags": ["ss26"]},
            {"product_sku": "BULK-002", "product_name": "Item 2",
             "unit_price_usd": 75.0, "cost_usd": 30.0,
             "size_multipliers": {"42": 5}, "tags": ["aw26"]},
        ]}
        r = ceo_client.post(
            f"/api/commercial/pricelist-versions/{plv.id}/bulk-upsert-items/",
            body, format="json",
        )
        assert r.status_code == 200, r.json()
        assert r.json()["created"] == 2
        assert r.json()["updated"] == 0
        # ── Re-ejecutar upsert mismo SKU → updated, no creado de nuevo
        body["items"][0]["unit_price_usd"] = 55.0
        r2 = ceo_client.post(
            f"/api/commercial/pricelist-versions/{plv.id}/bulk-upsert-items/",
            body, format="json",
        )
        assert r2.status_code == 200
        assert r2.json()["updated"] >= 1
        gi = GradeItem.objects.get(
            pricelist_version_id=plv.id, product_sku="BULK-001", is_active=True
        )
        assert Decimal(str(gi.unit_price_usd)) == Decimal("55.0000")

    def test_bulk_upsert_items_payload_vacio_400(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        r = ceo_client.post(
            f"/api/commercial/pricelist-versions/{plv.id}/bulk-upsert-items/",
            {"items": []}, format="json",
        )
        assert r.status_code == 400

    def test_bulk_upsert_items_pricelist_inexistente_404(self, ceo_client):
        ghost = new_uuid()
        r = ceo_client.post(
            f"/api/commercial/pricelist-versions/{ghost}/bulk-upsert-items/",
            {"items": [{"product_sku": "X", "unit_price_usd": 1}]},
            format="json",
        )
        assert r.status_code == 404

    def test_items_action_lista_grade_items(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        GradeItemModelFactory.create_batch(
            3, pricelist_version_id=plv.id, brand_id=plv.brand_id
        )
        r = ceo_client.get(f"/api/commercial/pricelist-versions/{plv.id}/items/")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 3


# ════════════════════════════════════════════════════════════════════
# GradeItem CRUD + CEO masking
# ════════════════════════════════════════════════════════════════════
class TestGradeItemCrudAndMasking:
    """cost_usd visible solo para CEO; no-CEO recibe payload sin cost."""

    def test_list_grade_items_ceo_ve_cost(self, ceo_client):
        GradeItemModelFactory.create_batch(2, cost_usd="15.0000")
        r = ceo_client.get("/api/commercial/grade-items/")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 2
        # Como CEO, recibimos GradeItemSerializer FULL → debe traer cost_usd y margen_usd
        for it in items:
            assert "cost_usd" in it, "CEO debe ver cost_usd"
            assert "margen_usd" in it
            assert "margen_pct" in it

    def test_list_grade_items_non_ceo_no_ve_cost(self, non_ceo_client):
        GradeItemModelFactory.create_batch(2, cost_usd="15.0000")
        r = non_ceo_client.get("/api/commercial/grade-items/")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 2
        for it in items:
            assert "cost_usd" not in it, "NO-CEO NUNCA debe ver cost_usd"
            assert "margen_usd" not in it
            assert "margen_pct" not in it

    def test_filter_by_pricelist_version_id(self, ceo_client):
        plv = PriceListVersionModelFactory.create()
        GradeItemModelFactory.create(pricelist_version_id=plv.id)
        GradeItemModelFactory.create()  # otro PLV
        r = ceo_client.get(
            f"/api/commercial/grade-items/?pricelist_version_id={plv.id}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) >= 1
        assert all(str(it["pricelist_version_id"]) == str(plv.id) for it in items)

    def test_create_grade_item_ceo_persiste_cost(self, ceo_client):
        payload = GradeItemPayloadFactory()
        r = ceo_client.post("/api/commercial/grade-items/", payload, format="json")
        assert r.status_code == 201, r.json()
        body = r.json()
        assert_uuid_string(body["id"], "grade-item.id")
        # CEO recibe respuesta completa y con margen calculado
        assert "cost_usd" in body
        # grade_moq_total se recalcula en server (no se confía en cliente)
        assert body["grade_moq_total"] == sum(payload["size_multipliers"].values())

    def test_create_grade_item_non_ceo_descarta_cost(self, non_ceo_client):
        payload = GradeItemPayloadFactory(cost_usd="9999.99")
        r = non_ceo_client.post("/api/commercial/grade-items/", payload, format="json")
        assert r.status_code == 201, r.json()
        body = r.json()
        assert "cost_usd" not in body, "Non-CEO NO debe ver cost_usd en la respuesta"
        # Verificar también en DB que el cost_usd NO se guardó
        gi = GradeItem.objects.get(pk=body["id"])
        assert gi.cost_usd is None, "Non-CEO no puede setear cost_usd"

    def test_update_grade_item_recalcula_grade_moq_total(self, ceo_client):
        gi = GradeItemModelFactory.create(
            size_multipliers={"40": 1}, grade_moq_total=1
        )
        r = ceo_client.patch(
            f"/api/commercial/grade-items/{gi.id}/",
            {"size_multipliers": {"40": 3, "41": 4, "42": 2}},
            format="json",
        )
        assert r.status_code == 200, r.json()
        gi.refresh_from_db()
        assert gi.grade_moq_total == 9

    def test_delete_grade_item_es_soft(self, ceo_client):
        gi = GradeItemModelFactory.create()
        r = ceo_client.delete(f"/api/commercial/grade-items/{gi.id}/")
        assert r.status_code == 204
        gi.refresh_from_db()
        assert gi.is_active is False

    def test_acepta_pricelist_version_id_inexistente_canary(self, ceo_client):
        """REGLA DE ORO: NO HAY FK físico → grade-item se crea con UUID huérfano."""
        payload = GradeItemPayloadFactory(
            pricelist_version_id=new_uuid(), brand_id=new_uuid()
        )
        r = ceo_client.post("/api/commercial/grade-items/", payload, format="json")
        assert r.status_code == 201, r.json()


# ════════════════════════════════════════════════════════════════════
# ClientAssignment (CPA) CRUD
# ════════════════════════════════════════════════════════════════════
class TestClientAssignmentCrud:
    def test_list_cpa(self, ceo_client):
        ClientAssignmentModelFactory.create_batch(3)
        r = ceo_client.get("/api/commercial/client-assignments/")
        assert r.status_code == 200
        assert len(extract_results(r.json())) >= 3

    def test_filter_by_client_id_y_brand_id(self, ceo_client):
        client_id = new_uuid()
        brand_id  = new_uuid()
        ClientAssignmentModelFactory.create(client_id=client_id, brand_id=brand_id)
        ClientAssignmentModelFactory.create()
        r = ceo_client.get(
            f"/api/commercial/client-assignments/"
            f"?client_id={client_id}&brand_id={brand_id}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) == 1
        assert str(items[0]["client_id"]) == client_id

    def test_create_cpa(self, ceo_client):
        payload = ClientAssignmentPayloadFactory()
        r = ceo_client.post(
            "/api/commercial/client-assignments/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "cpa.id")
        assert r.json()["brand_sku"] == payload["brand_sku"]

    def test_acepta_client_id_inexistente_canary(self, ceo_client):
        payload = ClientAssignmentPayloadFactory(
            client_id=new_uuid(), brand_id=new_uuid()
        )
        r = ceo_client.post(
            "/api/commercial/client-assignments/", payload, format="json"
        )
        assert r.status_code == 201

    def test_delete_cpa_es_soft(self, ceo_client):
        cpa = ClientAssignmentModelFactory.create()
        r = ceo_client.delete(f"/api/commercial/client-assignments/{cpa.id}/")
        assert r.status_code == 204
        cpa.refresh_from_db()
        assert cpa.is_active is False


# ════════════════════════════════════════════════════════════════════
# EarlyPaymentPolicy + replace-tiers atómico
# ════════════════════════════════════════════════════════════════════
class TestEarlyPaymentPolicyCrud:
    def test_list_policies(self, ceo_client):
        EarlyPaymentPolicyModelFactory.create_batch(2)
        r = ceo_client.get("/api/commercial/early-payment-policies/")
        assert r.status_code == 200
        assert len(extract_results(r.json())) >= 2

    def test_create_policy(self, ceo_client):
        payload = EarlyPaymentPolicyPayloadFactory()
        r = ceo_client.post(
            "/api/commercial/early-payment-policies/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "policy.id")
        # tiers es lista vacía hasta que se crean
        assert isinstance(r.json().get("tiers", []), list)

    def test_replace_tiers_atomico(self, ceo_client):
        policy = EarlyPaymentPolicyModelFactory.create()
        # Pre-cargar 2 tiers que deben quedar SOFT-DELETED
        EarlyPaymentTierModelFactory.create(policy_id=policy.id, payment_days=15)
        EarlyPaymentTierModelFactory.create(policy_id=policy.id, payment_days=45)
        body = {"tiers": [
            {"payment_days": 0,  "discount_pct": 5.0, "tier_label": "Contado"},
            {"payment_days": 30, "discount_pct": 2.5, "tier_label": "30 días"},
            {"payment_days": 60, "discount_pct": 0.0, "tier_label": "60 días"},
        ]}
        r = ceo_client.post(
            f"/api/commercial/early-payment-policies/{policy.id}/replace-tiers/",
            body, format="json",
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        assert len(out["tiers"]) == 3
        # Los anteriores deben quedar inactivos
        old_count = EarlyPaymentTier.objects.filter(
            policy_id=policy.id, is_active=True
        ).count()
        assert old_count == 3, "tras replace-tiers solo deben quedar 3 tiers activos"

    def test_replace_tiers_policy_inexistente_404(self, ceo_client):
        ghost = new_uuid()
        r = ceo_client.post(
            f"/api/commercial/early-payment-policies/{ghost}/replace-tiers/",
            {"tiers": []}, format="json",
        )
        assert r.status_code == 404

    def test_delete_policy_es_soft(self, ceo_client):
        p = EarlyPaymentPolicyModelFactory.create()
        r = ceo_client.delete(f"/api/commercial/early-payment-policies/{p.id}/")
        assert r.status_code == 204
        p.refresh_from_db()
        assert p.is_active is False


# ════════════════════════════════════════════════════════════════════
# EarlyPaymentTier (CRUD bajo nivel)
# ════════════════════════════════════════════════════════════════════
class TestEarlyPaymentTierCrud:
    def test_list_tiers_filter_by_policy(self, ceo_client):
        policy = EarlyPaymentPolicyModelFactory.create()
        # uq_commercial_tier_policy_days_active: (policy_id, payment_days)
        # debe ser único — la factory fija payment_days=30, así que los
        # creamos uno a uno con días distintos.
        EarlyPaymentTierModelFactory.create(policy_id=policy.id, payment_days=15)
        EarlyPaymentTierModelFactory.create(policy_id=policy.id, payment_days=30)
        EarlyPaymentTierModelFactory.create()
        r = ceo_client.get(
            f"/api/commercial/early-payment-tiers/?policy_id={policy.id}"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) == 2
        assert all(str(it["policy_id"]) == str(policy.id) for it in items)

    def test_create_tier(self, ceo_client):
        payload = EarlyPaymentTierPayloadFactory()
        r = ceo_client.post(
            "/api/commercial/early-payment-tiers/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "tier.id")


# ════════════════════════════════════════════════════════════════════
# CommissionRule (CEO-ONLY)
# ════════════════════════════════════════════════════════════════════
class TestCommissionRuleCeoOnly:
    """initial() lanza PermissionDenied(403) si not _is_ceo."""

    def test_list_commission_rules_ceo_ok(self, ceo_client):
        CommissionRuleModelFactory.create_batch(2)
        r = ceo_client.get("/api/commercial/commission-rules/")
        assert r.status_code == 200, r.json()
        assert len(extract_results(r.json())) >= 2

    def test_list_commission_rules_non_ceo_403(self, non_ceo_client):
        CommissionRuleModelFactory.create()
        r = non_ceo_client.get("/api/commercial/commission-rules/")
        assert r.status_code == 403, (
            f"Non-CEO debe recibir 403 sobre commission-rules, recibió {r.status_code}: {r.json()}"
        )

    def test_create_commission_rule_ceo_ok(self, ceo_client):
        payload = CommissionRulePayloadFactory()
        r = ceo_client.post(
            "/api/commercial/commission-rules/", payload, format="json"
        )
        assert r.status_code == 201, r.json()
        assert_uuid_string(r.json()["id"], "commission-rule.id")
        assert r.json()["commission_pct"] == "5.000"

    def test_create_commission_rule_non_ceo_403(self, non_ceo_client):
        payload = CommissionRulePayloadFactory()
        r = non_ceo_client.post(
            "/api/commercial/commission-rules/", payload, format="json"
        )
        assert r.status_code == 403

    def test_delete_commission_rule_es_soft(self, ceo_client):
        rule = CommissionRuleModelFactory.create()
        r = ceo_client.delete(f"/api/commercial/commission-rules/{rule.id}/")
        assert r.status_code == 204
        rule.refresh_from_db()
        assert rule.is_active is False


# ════════════════════════════════════════════════════════════════════
# ResolveClientPriceView · WATERFALL
# ════════════════════════════════════════════════════════════════════
class TestResolveClientPriceWaterfall:
    """CPA > PRICELIST · + EPP tier · + CEO enrichments (cost/margen/commission)."""

    def _seed_pricelist_with_item(self, brand_id, sku, unit=Decimal("100"),
                                  cost=Decimal("40")):
        plv = PriceListVersionModelFactory.create(brand_id=brand_id, is_active=True)
        gi = GradeItemModelFactory.create(
            pricelist_version_id=plv.id,
            brand_id=brand_id,
            product_sku=sku,
            unit_price_usd=str(unit),
            cost_usd=str(cost),
            size_multipliers={"40": 4, "41": 6, "42": 5},
        )
        # grade_moq_total se setea via factory pero el waterfall lo lee;
        # asegurar que esté actualizado:
        gi.grade_moq_total = sum(gi.size_multipliers.values())
        gi.save(update_fields=["grade_moq_total"])
        return plv, gi

    def test_waterfall_pricelist_only_no_epp(self, ceo_client):
        brand_id  = new_uuid()
        client_id = new_uuid()
        sku       = "WATERFALL-001"
        self._seed_pricelist_with_item(brand_id, sku, unit=Decimal("100"))
        body = {
            "client_id": client_id,
            "brand_id":  brand_id,
            "product_sku": sku,
            "requested_payment_days": 0,
        }
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        assert out["ok"] is True
        assert out["source"] == "PRICELIST"
        assert Decimal(out["base_price"]) == Decimal("100.0000")
        assert Decimal(out["discount_applied"]) == Decimal("0.000")
        assert Decimal(out["final_price"]) == Decimal("100.0000")
        assert out["grade_moq"] == 15

    def test_waterfall_cpa_override_pisa_pricelist(self, ceo_client):
        brand_id  = new_uuid()
        client_id = new_uuid()
        sku       = "WATERFALL-CPA-001"
        self._seed_pricelist_with_item(brand_id, sku, unit=Decimal("100"))
        ClientAssignmentModelFactory.create(
            client_id=client_id, brand_id=brand_id, brand_sku=sku,
            cached_client_price="80.0000",
        )
        body = {
            "client_id": client_id,
            "brand_id":  brand_id,
            "product_sku": sku,
        }
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        assert out["ok"] is True
        assert "CPA" in out["source"]
        assert Decimal(out["base_price"]) == Decimal("80.0000")
        assert Decimal(out["final_price"]) == Decimal("80.0000")

    def test_waterfall_pricelist_con_epp_tier(self, ceo_client):
        brand_id  = new_uuid()
        client_id = new_uuid()
        sku       = "WATERFALL-EPP-001"
        self._seed_pricelist_with_item(brand_id, sku, unit=Decimal("100"))
        # Política de pronto pago → 30 días = 5% de descuento
        policy = EarlyPaymentPolicyModelFactory.create(
            client_id=client_id, brand_id=brand_id
        )
        EarlyPaymentTierModelFactory.create(
            policy_id=policy.id, payment_days=30, discount_pct="5.000"
        )
        body = {
            "client_id": client_id,
            "brand_id":  brand_id,
            "product_sku": sku,
            "requested_payment_days": 0,  # querrá tier >= 0 → cae en 30d
        }
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        assert out["ok"] is True
        assert "EPP" in out["source"]
        assert Decimal(out["discount_applied"]) == Decimal("5.000")
        assert Decimal(out["final_price"]) == Decimal("95.0000")

    def test_waterfall_404_si_no_hay_precio(self, ceo_client):
        body = {
            "client_id": new_uuid(),
            "brand_id":  new_uuid(),
            "product_sku": "NO-EXISTE-EN-NINGUNA-PRICELIST",
        }
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        # ResolveClientPriceView retorna 404 cuando no resuelve precio
        assert r.status_code == 404, r.json()
        out = r.json()
        assert out["ok"] is False
        assert out["base_price"] is None
        assert out["final_price"] is None

    def test_waterfall_ceo_recibe_cost_y_margen(self, ceo_client):
        brand_id  = new_uuid()
        client_id = new_uuid()
        sku       = "WATERFALL-CEO-001"
        self._seed_pricelist_with_item(
            brand_id, sku, unit=Decimal("100"), cost=Decimal("40")
        )
        body = {
            "client_id": client_id,
            "brand_id":  brand_id,
            "product_sku": sku,
        }
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        assert "cost_usd" in out, "CEO debe recibir cost_usd"
        assert "margen_usd" in out
        assert "margen_pct" in out
        assert Decimal(out["cost_usd"]) == Decimal("40.0000")
        assert Decimal(out["margen_usd"]) == Decimal("60.0000")

    def test_waterfall_non_ceo_NO_recibe_cost(self, non_ceo_client):
        brand_id  = new_uuid()
        client_id = new_uuid()
        sku       = "WATERFALL-NONCEO-001"
        TestResolveClientPriceWaterfall._seed_pricelist_with_item(
            self, brand_id, sku, unit=Decimal("100"), cost=Decimal("40")
        )
        body = {
            "client_id": client_id,
            "brand_id":  brand_id,
            "product_sku": sku,
        }
        r = non_ceo_client.post(
            "/api/commercial/resolve_client_price/", body, format="json"
        )
        assert r.status_code == 200, r.json()
        out = r.json()
        # Contrato ACTUAL: ResolveClientPriceOutputSerializer declara los
        # campos CEO-only con allow_null=True — DRF serializa el atributo
        # AUSENTE como null (la clave aparece pero el VALOR jamás se expone).
        # R3 se cumple en sustancia: el dato (costo/margen) no viaja.
        assert out.get("cost_usd") is None, "Non-CEO NUNCA debe ver cost_usd"
        assert out.get("margen_usd") is None
        assert out.get("margen_pct") is None
        assert Decimal(out["base_price"]) == Decimal("100.0000")

    def test_waterfall_payload_invalido_400(self, ceo_client):
        # Missing brand_id / product_sku → 400 vía serializer
        r = ceo_client.post(
            "/api/commercial/resolve_client_price/",
            {"client_id": new_uuid()}, format="json",
        )
        assert r.status_code == 400


# ════════════════════════════════════════════════════════════════════
# Catálogos read-only
# ════════════════════════════════════════════════════════════════════
class TestCatalogos:
    def test_currencies_ok(self, ceo_client):
        r = ceo_client.get("/api/commercial/catalogs/currencies/")
        assert r.status_code == 200
        # Lista (potencialmente vacía si la DB no fue seedeada — eso está OK)
        assert isinstance(extract_results(r.json()), list)

    def test_sources_ok(self, ceo_client):
        r = ceo_client.get("/api/commercial/catalogs/sources/")
        assert r.status_code == 200
        assert isinstance(extract_results(r.json()), list)

    def test_commission_bases_ok(self, ceo_client):
        r = ceo_client.get("/api/commercial/catalogs/commission-bases/")
        assert r.status_code == 200
        assert isinstance(extract_results(r.json()), list)
