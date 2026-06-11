# Sprint 04 · Commercial — Pipeline Comercial y Órdenes de Compra

## 1. Propósito
Flujo comercial: pipeline Kanban de expedientes por fase (drag & drop para avanzar estado), gestión de OCs y reglas de comisión/pricing comercial.

## 2. Mapeo Tecnológico
*   **Base de datos**: schemas `commercial` (`A2_commercial_pricing.sql`, `commission_rule`, early payment `B9`/tiers), `pricing` (`pricelist_version`, `grade_item`, `client_assignment`), `expedientes.oc`; `94_pipeline_financiero_portal.sql`, `96b_pipeline_audit.sql`, `98_drop_commercial_constraint.sql`.
*   **Backend**: app `commercial` (+ acciones de transición en `expedientes` — comando C5 confirm-sap mueve REGISTRO→PRODUCCIÓN).
*   **Frontend**: `Pipeline.jsx` (Kanban, también embebido como vista Kanban de `/expedientes`), `OCDetail.jsx` (gestión de la OC), chips role-aware de proforma/PO.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] Listado del Kanban: usa el MISMO `ExpedienteListSerializer` (hereda el N+1 del sprint 03) — verificar tras el fix.
- [ ] Transiciones de estado: cada drag dispara escritura a `pipeline.event_log` — confirmar índice `(aggregate_id, created_at)` y que la respuesta no re-serialice todo el tablero.
- [ ] Reglas de pricing (`pricing.*`): joins por `client_id`/`producto_id` con índice.
- [ ] Early-payment / pronto pago (apply-pronto-pago): medir el PATCH encadenado al subir proforma.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] Drag & drop: si el POST de transición falla, la card debe volver a su columna (rollback optimista) sin dejar el board inconsistente.
- [ ] `Pipeline.jsx` montado dentro de `/expedientes` (viewMode kanban): cambiar Tabla↔Kanban rápido no debe duplicar fetches ni estados.
- [ ] Cards: títulos role-aware (PO cliente / PF admin) ya implementados — proteger contra arrays vacíos.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** reporta latencia del board y del POST de transición.
2. **Backend** revisa la acción `transition` (gating + event_log) y devuelve payload mínimo (solo el expediente movido).
3. **SQL** confirma índices de event_log y pricing.
4. Prueba conjunta: 10 drags seguidos sin recarga — board consistente y sin queries redundantes.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **HEREDADO** — El Kanban usa el listado de expedientes: se beneficia directo del fix N+1 del sprint 03.
- 🔴 **PENDIENTE (N+1)** — `commercial/serializers.py:51` `get_items_count()` query por PriceList.
- 🟡 **PENDIENTE (frontend)** — `Pipeline.jsx:164-210` Promise.all de enriquecimiento sin cancelación (adoptar `signal`); `Pipeline.jsx:227-236` navegación vía mocks `OCS` con flujo quebrado cuando el array está vacío.
