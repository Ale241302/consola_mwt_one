"""
=====================================================================
MWT.ONE · apps.analytics.urls
Agente responsable: [AG-BACKEND]

Monta AnalyticsViewSet en /api/analytics/<action>/
=====================================================================
"""
from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import AnalyticsViewSet

router = DefaultRouter()
router.register(r"analytics", AnalyticsViewSet, basename="analytics")

urlpatterns = [
    path("", include(router.urls)),
]
