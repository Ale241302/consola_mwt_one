"""
=====================================================================
MWT.ONE · apps.analytics.urls
Agente responsable: [AG-BACKEND]

Monta:
  · AnalyticsViewSet          → /api/analytics/<action>/ (read-only KPIs)
      - dashboard_kpis, cashflow, aging, exposicion_clientes,
        margen_marcas, by_status, urgent
      - credit_clock_avg, r1_correction_ratio, by_status_by_brand,
        inventory_coverage_by_node, top_skus_margen,
        expediente_margin_scatter         (Sprint widgets 2026-05-20)
  · DashboardSnapshotViewSet  → /api/dashboard-snapshots/
  · WidgetCatViewSet          → /api/dashboard-widgets/ (read-only)

Las rutas de los @action de AnalyticsViewSet se exponen
automáticamente vía DefaultRouter — no requiere `path()` extra.
=====================================================================
"""
from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import (
    AnalyticsViewSet,
    DashboardSnapshotViewSet,
    WidgetCatViewSet,
    ChartRenderView,
    PresentationRenderView,
)

router = DefaultRouter()
router.register(r"analytics",           AnalyticsViewSet,          basename="analytics")
router.register(r"dashboard-snapshots", DashboardSnapshotViewSet,  basename="dashboard-snapshots")
router.register(r"dashboard-widgets",   WidgetCatViewSet,          basename="dashboard-widgets")

urlpatterns = [
    path("", include(router.urls)),
    # Ola 3.10 · render de charts server-side (SVG). Vista dedicada con
    # required_action="view" (POST pero conceptualmente solo-lectura).
    path("analytics/chart-render/", ChartRenderView.as_view(),
         name="analytics-chart-render"),
    # Ola 3.10 ampliada · motor de presentación unificado (5 categorías).
    path("presentation/render/", PresentationRenderView.as_view(),
         name="presentation-render"),
]
