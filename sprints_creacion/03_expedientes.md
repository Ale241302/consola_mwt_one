# Creación 03 · Expedientes — Importación, OCs, Documentos y Fases

## Objetivo
El corazón del negocio: cada pedido vive como expediente (OC/proforma → confirmación SAP → fases REGISTRO→…→CERRADO → entrega), con documentos comerciales, líneas por SKU/talla con precios duales, fusión visual de expedientes y Cronograma proyectado.

## Base de datos (schemas `expedientes` + `pipeline`)
*   `expedientes.oc`: id, codigo (unique), client_id (idx), proforma, sap, estado, moneda, totales, display_label, is_active, timestamps.
*   `expedientes.expediente`: id, codigo unique (EXP-YYYY-NNNN), oc_id (idx), client_id (idx), operating_company_id (idx), brand_id, sap, estado (fase), freight_mode, eta, shipment_date, credit_days(+_mwt/_cliente), forma_pago, phase_durations_json jsonb, fusion_id (idx parcial), fusion_label, totales, is_active, timestamps.
*   `expedientes.linea`: id, oc_id (idx), expediente_id (idx), producto_id (idx), sku, size, qty, unit_price(+_mwt/_client), total_price, sap (idx compuesto exp+sap), estado, deferred_*, is_active.
*   `expedientes.documento`: id, oc_id (idx), expediente_id (idx c/kind), kind, codigo, file_ext, file_size_bytes, storage_url, audience (CLIENT/ADMIN_ONLY), author, fecha, is_active.
*   `pipeline.event_log`: id, aggregate_type, aggregate_id (idx c/created_at), phase_from, phase_to, created_at, is_active.
*   SQL: `70`, `95*` wizard, `96*` audit, `C0`, `E1` (días por fase), `E3` (fusión), `E4` (alias), `E5` (índices).

## Backend (apps `expedientes`, `sizing`, `ocr`)
*   ViewSet CRUD (create autogenera id+codigo; destroy soft) + acciones: `transition` (avanza fase + event_log), `confirm-sap`/`upsert-sap` (C5: líneas confirmadas, ART-04, REGISTRO→PRODUCCIÓN), `phase-durations` (GET/POST rango fechas), `phase-stats` (promedios globales/por cliente), `fusionar/desfusionar/fusion-label`, `edit-full`, `factura-payload`.
*   `LineaViewSet` CRUD (id server-side; PATCH recalcula total y alinea precio legacy con operador) + `bulk-update-prices`.
*   `DocumentoViewSet`: upload multipart → storage + hook que autogenera Proforma HTML; signed-url para Ver.
*   Listado SIEMPRE con `build_expediente_ref_batches` (refs en 3-4 queries totales, no por fila).

## Frontend
*   **Ver registros**: `/expedientes` — tabla Zebra con REF role-aware (PF+chips admin / PO cliente), selección masiva (Eliminar N / Fusionar N), vistas financial/ops/fleet, toggle Tabla/Kanban; fila fusionada agrupada.
*   **Ver detalle**: `/expedientes/:ocId` (OC: KPIs, líneas por SAP, Productos OC editable, Documentos, Costos, Pagos) · `/expedientes/:ocId/exp/:expId` (expediente: stepper de fases + días editables, productos, pagos, artefactos) · `/expedientes/fusion/:fusionId` (combinado).
*   **Crear**: `/expedientes/nuevo` y `/portal/nueva-oc` — wizard Lite (Operador → Cliente → Productos por talla → Revisar y crear). “+ Agregar producto” en el detalle (catálogo con precio por cliente).
*   **Editar**: “Editar general” (wizard `?editExpFull=`), edición in-place de qty/precios (persiste onBlur), lápiz de alias del header, modal de días por fase.
*   **Eliminar**: bulk con modal en el listado; “×” por línea con confirmación (soft-delete real vía API).
*   `/cronograma`: Gantt interactivo + tabs + Exportar HTML.

## Criterios de aceptación
- [ ] Crear→confirmar SAP→avanzar fases→entregar deja traza completa en event_log.
- [ ] CLIENT nunca recibe precio MWT ni proformas/saps en payloads (R3 server-side).
- [ ] Listado ejecuta O(1) queries de refs; reload conserva toda edición (qty/precios/altas).
