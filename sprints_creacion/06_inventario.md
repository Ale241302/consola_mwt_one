# Creación 06 · Inventario — Stock, Recepción Inbound y Asignaciones

## Objetivo
Stock por nodo y talla, recepción inbound (wizard con OCR de packing), asignación expediente→nodo con cantidades y costos operativos por unidad que viajan al transferir.

## Base de datos (schema `inventario`)
*   `inventario.stock_by_size`: id, nodo_id (idx), producto_id (idx), talla, qty int, updated_at.
*   `inventario.expediente_nodo_assignment`: id, expediente_id (idx), nodo_id (idx), producto_id, talla, qty int, costo_unitario, transferencia_id (idx), is_active. (Cantidades SIEMPRE `integer` — convención del repo.)
*   `inventario.recepcion`: id, expediente_id, nodo_id, fecha, estado, ocr_payload jsonb, costos jsonb.
*   SQL: `60-63`, `65b/c/d`, `E0_recepcion_costos.sql`, índices E5.

## Backend (apps `inventario`, `ocr`)
*   CRUD de stock (ajustes manuales auditados) y asignaciones.
*   Recepción inbound: endpoint que recibe packing (PDF/XLSX) → OCR (timeout corto; si excede, encolar y devolver estado "procesando") → propuesta de líneas por talla → confirmación escribe stock + assignment + costos (E0).
*   `shipping-summary` y `nodos-por-linea` para hidratar UI; versión batch por lista de expedientes.

## Frontend
*   **Ver registros**: `/inventario` — `Inventario.jsx`: matriz stock por nodo/producto/talla con filtros (nodo, producto, búsqueda); celdas `tabular-nums`.
*   **Crear**: `/inventario/recepcion` — `InboundReceptionWizard.jsx` (4 pasos: expediente → documento+OCR → revisión por talla → costos operativos → confirmar). También alta de ajuste manual de stock con FormView modal.
*   **Editar**: ajuste de cantidades con motivo (auditado); reasignación de nodo de una línea.
*   **Eliminar**: reverso de recepción/ajuste con modal de confirmación (soft + contrapartida de stock).
*   **Ver detalle**: ficha de recepción (documento, líneas, costos, quién recibió).

## Criterios de aceptación
- [ ] Recepción completa actualiza stock por talla y deja los costos prorrateables.
- [ ] OCR fallido NUNCA deja el wizard en blanco: estado de error + reintento + captura manual.
- [ ] Stock cuadra: Σ recepciones − Σ salidas (transfers) = stock actual por nodo/talla.
