from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import StockViewSet, MovimientoViewSet, NodoAssignmentViewSet
from .inbound_views import (
    RecepcionViewSet, InboundOCRView, InboundReceiveView,
)

router = DefaultRouter()
router.register(r"stock",                  StockViewSet,       basename="stock")
router.register(r"movimientos",            MovimientoViewSet,  basename="movimientos")
router.register(r"inventario-recepciones", RecepcionViewSet,   basename="recepciones")

# Sprint 2026-05-11 · Fase 3 — Endpoints custom para asignaciones
# expediente→nodo. Se montan via path() manual porque el ViewSet expone
# sólo @action methods (sin list/retrieve estándar) y registrar como
# router causaría rutas inservibles. La firma URL queda:
#
#   GET  /api/inventario/saldos-por-expediente/
#   POST /api/inventario/nodo-assignments/bulk/
#   GET  /api/inventario/nodos/{nodo_id}/inventory-allocated/
saldos_view              = NodoAssignmentViewSet.as_view({"get":  "saldos"})
bulk_create_view         = NodoAssignmentViewSet.as_view({"post": "bulk_create"})
inventory_allocated_view = NodoAssignmentViewSet.as_view({"get":  "inventory_allocated"})
overview_view            = NodoAssignmentViewSet.as_view({"get":  "allocations_overview"})

urlpatterns = router.urls + [
    # Inbound Engine v1 (sprint 2026-04-29)
    path("inventory/ocr-receipt/", InboundOCRView.as_view(),     name="inventory-ocr-receipt"),
    path("inventory/receive/",     InboundReceiveView.as_view(), name="inventory-receive"),
    # Fase 3 (sprint 2026-05-11)
    path("inventario/saldos-por-expediente/", saldos_view,
         name="ena-saldos"),
    path("inventario/nodo-assignments/bulk/", bulk_create_view,
         name="ena-bulk"),
    path("inventario/nodos/<uuid:nodo_id>/inventory-allocated/",
         inventory_allocated_view,
         name="ena-inventory-allocated"),
    # Sprint 2026-05-11 fix · overview global para /inventario page.
    path("inventario/allocations-overview/",
         overview_view,
         name="ena-allocations-overview"),
]
