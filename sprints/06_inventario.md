# Sprint 06 · Inventario — Stock, Recepción Inbound y OCR

## 1. Propósito
Control de inventario por nodo: stock por talla, recepción inbound con OCR, asignaciones expediente→nodo (`expediente_nodo_assignment`) y costos operativos que viajan al transferir.

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `inventario` (`60-63`, `62_inventario_inbound.sql`, `63_inventario_stock_by_size.sql`, `65b_expediente_nodo_assignment.sql`, `65c/65d transferencia_id`, `E0_recepcion_costos.sql`).
*   **Backend**: apps `inventario` (inbound + OCR `inbound_ocr.py` — archivo bajo "test ambition check" del CLAUDE.md §11), `ocr`; endpoints `nodoAssignmentsApi` (shipping-summary, transferencia-costos, nodos-por-línea).
*   **Frontend**: `Inventario.jsx`, `InboundReceptionWizard.jsx` (4 pasos con costos operativos), hooks `useInventarioSelects`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `expediente_nodo_assignment`: índices por `expediente_id`, `nodo_id`, `transferencia_id` (lo consultan OCDetail, factura-payload LATERAL, transfers).
- [ ] `stock_by_size`: agregados por nodo/talla — verificar que el listado de Inventario no recalcula por celda.
- [ ] `shippingSummary(expedienteId)`: OCDetail lo llama por CADA expediente único de la OC en paralelo — candidato a endpoint batch.
- [ ] OCR inbound: proceso síncrono en el request — medir y considerar background si excede ~2s.
- [ ] `cost_proration.py`: prorrateo con scope — revisar complejidad con muchas líneas.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `InboundReceptionWizard`: pasos con validación; un fallo del OCR no debe dejar el wizard en blanco (estado de error + reintento).
- [ ] `Inventario.jsx`: filtros por nodo cambiados rápido — última respuesta gana (guardar requestId o abortar).
- [ ] Matrices de tallas grandes: render sin bloquear el hilo (memoización de filas).

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** reporta tiempos del wizard y de la grilla de stock.
2. **Backend** perfila OCR + prorrateo; **SQL** revisa los agregados de stock y propone índices.
3. Validación cruzada con una recepción real de prueba (lote multi-talla).

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (índices)** — `E5`: `expediente_nodo_assignment(expediente_id)` y `(transferencia_id)`.
- 🔴 **PENDIENTE (bloqueo)** — `inventario/inbound_ocr.py:99-139` llamada OpenAI con `timeout=60` SÍNCRONA dentro del request (zona con eval-gate §11: corregir con suite de evals antes de merge).
- 🟡 **PENDIENTE (frontend)** — `Inventario.jsx:109-119` Promise.all sin cancelación + mapper (`:32-52`) accede `.producto_sku`/`.nodo_nombre` sin `?.`.
