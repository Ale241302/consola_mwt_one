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
    # Sprint COMEX-resolved · resolved-prices por asignación / producto
    ResolvedPricesByAssignmentView, ProductClientsPricingView,
    # Simulador Marluvas v7 · cotización USD/BRL en vivo
    MarluvasExchangeRateView,
    # Liquidación movimientos · cotización USD/CRC (colón) en vivo
    UsdCrcExchangeRateView,
    # Simulador Marluvas v7 · SKUs habilitados por cliente
    MarluvasClientEnabledSkusView,
    # Simulador Marluvas v7 · persistencia de simulaciones (snapshot por reemplazo)
    MarluvasSaveSimulationView, MarluvasLoadSimulationView,
    # Simulador Marluvas v7 · vista inversa (matrices por cliente desde un SKU)
    MarluvasProductClientsMatrixView, MarluvasUpsertSkuView,
)
# F6 · Sprint 2026-05-20 · Bitácora histórica de cambios de precios.
from .views_price_history import (
    PriceHistoryListView, PriceHistoryDetailView,
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
    # COMEX-resolved · tabla post-upload por asignación
    path("commercial/brand-client-pricing/<uuid:pk>/resolved-prices/",
         ResolvedPricesByAssignmentView.as_view(),
         name="commercial-bcpa-resolved-prices"),
    # Override por cliente en detalle del producto
    path("commercial/products/<str:sku>/clients-pricing/",
         ProductClientsPricingView.as_view(),
         name="commercial-product-clients-pricing"),
    # Simulador Marluvas v7 · proxy USD/BRL (AwesomeAPI BR + cache 15min)
    path("commercial/exchange-rate/usd-brl/",
         MarluvasExchangeRateView.as_view(),
         name="commercial-fx-usd-brl"),
    # Liquidación movimientos · proxy USD/CRC (AwesomeAPI + open.er-api + cache)
    path("commercial/exchange-rate/usd-crc/",
         UsdCrcExchangeRateView.as_view(),
         name="commercial-fx-usd-crc"),
    # Simulador Marluvas v7 · SKUs habilitados por cliente (parseo de BCPA.notas)
    path("commercial/clients/<uuid:cliente_id>/enabled-skus/",
         MarluvasClientEnabledSkusView.as_view(),
         name="commercial-client-enabled-skus"),
    # Simulador Marluvas v7 · guardar snapshot de simulación (POST)
    path("commercial/marluvas/save-simulation/",
         MarluvasSaveSimulationView.as_view(),
         name="commercial-marluvas-save-simulation"),
    # Simulador Marluvas v7 · cargar último snapshot vigente (GET)
    path("commercial/marluvas/load-simulation/",
         MarluvasLoadSimulationView.as_view(),
         name="commercial-marluvas-load-simulation"),
    # Simulador Marluvas v7 · matriz por cliente para un SKU (GET, vista del producto)
    path("commercial/marluvas/product-clients-matrix/",
         MarluvasProductClientsMatrixView.as_view(),
         name="commercial-marluvas-product-clients-matrix"),
    # Simulador Marluvas v7 · upsert de UN row (brand, cliente, sku) sin tocar otros
    path("commercial/marluvas/upsert-sku/",
         MarluvasUpsertSkuView.as_view(),
         name="commercial-marluvas-upsert-sku"),
    # F6 · Bitácora histórica (CEO-ONLY)
    path("commercial/marluvas/price-history/",
         PriceHistoryListView.as_view(),
         name="commercial-marluvas-price-history-list"),
    path("commercial/marluvas/price-history/<uuid:event_id>/",
         PriceHistoryDetailView.as_view(),
         name="commercial-marluvas-price-history-detail"),
]
