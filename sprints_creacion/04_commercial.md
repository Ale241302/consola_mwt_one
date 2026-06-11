# Creación 04 · Commercial — Pipeline y Pricing Comercial

## Objetivo
Flujo comercial sobre los expedientes: tablero Kanban por fase con drag&drop para avanzar estado, reglas de comisión, pronto pago y listas de precios por cliente.

## Base de datos (schemas `commercial` + `pricing`)
*   `pricing.pricelist_version`: id, nombre, vigencia, estado. `pricing.grade_item`: id, pricelist_id (idx), producto_id (idx), grade, precio. `pricing.client_assignment`: id, client_id (idx), pricelist_id (idx).
*   `commercial.commission_rule`: id, scope, pct, vigencia. `commercial.early_payment_policy` + `early_payment_tier` (plazo→descuento).
*   SQL: `A2_commercial_pricing.sql`, `A2b_pricing_waterfall.sql`, `B9_expedientes_forma_pago.sql`.

## Backend (app `commercial`)
*   CRUD de pricelists, grade items (bulk), client assignments, commission rules y tiers de pronto pago (todo soft-delete, ADMIN-only).
*   `apply-pronto-pago` sobre expediente (PATCH plazo + recálculo de descuento en proforma).
*   La transición de fase vive en `expedientes.transition` (escribe event_log y devuelve SOLO el expediente movido).

## Frontend
*   **Ver registros**: `/pipeline` (y vista Kanban de `/expedientes`) — columnas por fase, cards role-aware (PF admin / PO cliente), contadores por columna, filtros marca/urgentes/bloqueado.
*   **Crear**: las cards nacen del wizard de expedientes (sprint 03); reglas de comisión y tiers con FormView propio (`/finanzas` sección reglas o vista dedicada): crear regla con scope+pct+vigencia.
*   **Editar**: drag&drop = editar fase (optimista con rollback si el POST falla); editar regla/tier en FormView precargado.
*   **Eliminar**: regla/tier con modal de confirmación → soft-delete.
*   **Ver detalle**: click en card → detalle de la OC (sprint 03).

## Criterios de aceptación
- [ ] Drag&drop persiste la fase y registra event_log; si falla, la card vuelve a su columna.
- [ ] CLIENT ve el board read-only (sin drag) y sin datos internos.
- [ ] CRUD de reglas de comisión/pronto pago completo y auditado.
