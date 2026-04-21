"""
=====================================================================
MWT.ONE · apps.analytics.urls
Agente responsable: [AG-BACKEND]

Monta:
  · AnalyticsViewSet          → /api/analytics/<action>/ (read-only KPIs)
  · DashboardSnapshotViewSet  → /api/dashboard-snapshots/
  · WidgetCatViewSet          → /api/dashboard-widgets/ (read-only)
=====================================================================
"""
from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import (
    AnalyticsViewSet,
    DashboardSnapshotViewSet,
    WidgetCatViewSet,
)

router = DefaultRouter()
router.register(r"analytics",           AnalyticsViewSet,          basename="analytics")
router.register(r"dashboard-snapshots", DashboardSnapshotViewSet,  basename="dashboard-snapshots")
router.register(r"dashboard-widgets",   WidgetCatViewSet,          basename="dashboard-widgets")

urlpatterns = [
    path("", include(router.urls)),
]
