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
# Sprint 2026-05-11 fix · adjust (editar/eliminar) + expedientes-asignados.
adjust_view              = NodoAssignmentViewSet.as_view({"post": "adjust"})
exp_asignados_view       = NodoAssignmentViewSet.as_view({"get":  "expedientes_asignados"})
# Sprint 2026-05-11 fix · filtra expedientes con qty_pendiente > 0 para el wizard.
exp_with_pending_view    = NodoAssignmentViewSet.as_view({"get":  "expedientes_with_pending"})
# Sprint 2026-05-11 fase 6 · vistas para enriquecer las pages OCDetail y
# ExpedienteDetail con la columna "Nodo" y la nueva tab Artefactos.
nodos_por_linea_view     = NodoAssignmentViewSet.as_view({"get":  "nodos_por_linea_expediente"})
artifacts_por_exp_view   = NodoAssignmentViewSet.as_view({"get":  "artifacts_por_expediente"})
# Sprint 2026-05-13 fase 8 · Transfer engine wiring.
lineas_en_nodo_view      = NodoAssignmentViewSet.as_view({"get":  "lineas_en_nodo"})
transfer_view            = NodoAssignmentViewSet.as_view({"post": "transfer"})

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
    # Sprint 2026-05-11 fix · ajuste in-line de qty asignada.
    path("inventario/nodo-assignments/adjust/",
         adjust_view,
         name="ena-adjust"),
    # Sprint 2026-05-11 fix · resumen de expedientes asignados a un nodo.
    path("inventario/nodos/<uuid:nodo_id>/expedientes-asignados/",
         exp_asignados_view,
         name="ena-expedientes-asignados"),
    # Sprint 2026-05-11 fix · set de IDs de expedientes con pendiente > 0
    # (alimenta el filtro de chips del paso 2 del wizard de recepción).
    path("inventario/expedientes-with-pending/",
         exp_with_pending_view,
         name="ena-expedientes-with-pending"),
    # Sprint 2026-05-11 fase 6 · enriquecimiento de OCDetail/ExpedienteDetail.
    path("inventario/expedientes/<uuid:exp_id>/nodos-por-linea/",
         nodos_por_linea_view,
         name="ena-nodos-por-linea"),
    path("inventario/expedientes/<uuid:exp_id>/artifacts/",
         artifacts_por_exp_view,
         name="ena-artifacts-por-expediente"),
    # Sprint 2026-05-13 fase 8 · líneas con stock en un nodo y transfer
    # atómico de asignaciones para el wizard /transferencias/nueva.
    path("inventario/nodos/<uuid:nodo_id>/lineas-en-nodo/",
         lineas_en_nodo_view,
         name="ena-lineas-en-nodo"),
    path("inventario/nodo-assignments/transfer/",
         transfer_view,
         name="ena-transfer"),
]
