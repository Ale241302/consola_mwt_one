from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import StockViewSet, MovimientoViewSet
from .inbound_views import (
    RecepcionViewSet, InboundOCRView, InboundReceiveView,
)

router = DefaultRouter()
router.register(r"stock",                  StockViewSet,       basename="stock")
router.register(r"movimientos",            MovimientoViewSet,  basename="movimientos")
router.register(r"inventario-recepciones", RecepcionViewSet,   basename="recepciones")

urlpatterns = router.urls + [
    # Inbound Engine v1 (sprint 2026-04-29)
    path("inventory/ocr-receipt/", InboundOCRView.as_view(),     name="inventory-ocr-receipt"),
    path("inventory/receive/",     InboundReceiveView.as_view(), name="inventory-receive"),
]
