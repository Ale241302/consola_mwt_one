"""
=====================================================================
MWT.ONE · apps.commercial.urls
Agente responsable: [AG-BACKEND]

Monta los recursos comerciales bajo /api/commercial/.

Recursos REST (DefaultRouter):
  · pricelist-versions        → /api/commercial/pricelist-versions/
                                    + actions: bulk-upsert-items, items
  · grade-items               → /api/commercial/grade-items/
                                    (cost_usd enmascarado si ≠ CEO)
  · client-assignments        → /api/commercial/client-assignments/  (CPA)
  · early-payment-policies    → /api/commercial/early-payment-policies/
                                    + action: replace-tiers
  · early-payment-tiers       → /api/commercial/early-payment-tiers/
  · commission-rules          → /api/commercial/commission-rules/   [CEO-ONLY]
  · catalogs/currencies       → /api/commercial/catalogs/currencies/
  · catalogs/sources          → /api/commercial/catalogs/sources/
  · catalogs/commission-bases → /api/commercial/catalogs/commission-bases/

Endpoint crítico:
  · POST /api/commercial/resolve_client_price/
=====================================================================
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    PriceListVersionViewSet, GradeItemViewSet, ClientAssignmentViewSet,
    EarlyPaymentPolicyViewSet, EarlyPaymentTierViewSet, CommissionRuleViewSet,
    CurrencyCatViewSet, PriceListSourceCatViewSet, CommissionBaseCatViewSet,
    ResolveClientPriceView,
    # COMEX pricing waterfall (calculadora del Excel v6)
    ResolveComexPriceView, PaymentIndexListView, PricingConstantListView,
    # Sprint M3c · brand↔client pricing assignment
    BrandClientPricingAssignmentViewSet, BrandClientsSummaryView,
)


router = DefaultRouter()
router.register(r"commercial/pricelist-versions",
                PriceListVersionViewSet, basename="commercial-pricelist-versions")
router.register(r"commercial/grade-items",
                GradeItemViewSet, basename="commercial-grade-items")
router.register(r"commercial/client-assignments",
                ClientAssignmentViewSet, basename="commercial-client-assignments")
router.register(r"commercial/early-payment-policies",
                EarlyPaymentPolicyViewSet, basename="commercial-epp")
router.register(r"commercial/early-payment-tiers",
                EarlyPaymentTierViewSet, basename="commercial-epp-tiers")
router.register(r"commercial/commission-rules",
                CommissionRuleViewSet, basename="commercial-commission-rules")
router.register(r"commercial/catalogs/currencies",
                CurrencyCatViewSet, basename="commercial-currencies")
router.register(r"commercial/catalogs/sources",
                PriceListSourceCatViewSet, basename="commercial-sources")
router.register(r"commercial/catalogs/commission-bases",
                CommissionBaseCatViewSet, basename="commercial-commission-bases")
# Sprint M3c · brand↔client pricing (una fila por cliente-marca vigente)
router.register(r"commercial/brand-client-pricing",
                BrandClientPricingAssignmentViewSet,
                basename="commercial-brand-client-pricing")

urlpatterns = [
    path("", include(router.urls)),
    path("commercial/resolve_client_price/",
         ResolveClientPriceView.as_view(),
         name="commercial-resolve-client-price"),
    # COMEX · calculadora del Excel v6 (J18)
    path("commercial/resolve_price/",
         ResolveComexPriceView.as_view(),
         name="commercial-resolve-comex-price"),
    path("commercial/payment_index/",
         PaymentIndexListView.as_view(),
         name="commercial-payment-index"),
    path("commercial/pricing_constants/",
         PricingConstantListView.as_view(),
         name="commercial-pricing-constants"),
    # Sprint M3c · grid de cards del Motor de Precios por marca
    path("commercial/brands/<uuid:brand_id>/clients_summary/",
         BrandClientsSummaryView.as_view(),
         name="commercial-brand-clients-summary"),
]
