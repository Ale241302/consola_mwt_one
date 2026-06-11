# Creación 09 · Transfers — Movimientos entre Nodos y Landed Cost

## Objetivo
Mover stock entre nodos con liquidación completa: costos (manuales + OCR DUA), prorrateo por scope, landed cost por línea/NCM/SKU con precios duales MWT/cliente, timbres e impuestos, factura interna .html y ciclo de vida.

## Base de datos (schema `transfers` + NCM)
*   `transfers.transferencia`: id, codigo (TRF-...), nodo_origen_id (idx), nodo_destino_id (idx), expediente_ids involucrados vía assignment, estado/lifecycle, fechas, has_discrepancy, context_data jsonb, is_active.
*   `transfers.linea_transferencia`: id, transferencia_id (idx), expediente_id, producto_id, talla, qty int, precios 4dp (`D5`).
*   `transfers.cost_line`: id, transferencia_id (idx), kind (catálogo `D6_cr_dua_cost_kinds`), label, amount, currency, amount_usd, source (MANUAL/OCR_DUA), scope_json jsonb (GIN recomendado), is_active.
*   `transfers.legal_document`, `notes_log`, vista `cost_line_price_view` (91m). NCM engine: `E1_ncm_engine.sql` (tabla NCM con DAI por origen→destino).
*   SQL: `90`, `91a-m`, `D5`, `D9_invoice_pricing_index`, índices E5.

## Backend (app `transfers`)
*   CRUD de transferencias (wizard create: origen/destino + líneas desde assignments disponibles) y de cost_lines (manual + carga OCR DUA con revisión).
*   Landed cost: prorrateo por scope en SQL; `invoice-payload` con `dai_rate` vivo por NCM (nunca hardcodear), IVA sobre CIF+DAI+Ley, custom_taxes (timbres CR sembrados).
*   Lifecycle: borrador → en tránsito → recibido (descuenta/abona stock) → liquidado; `unfreeze` con discrepancias.

## Frontend
*   **Ver registros**: `/transferencias` — tabla (código, ruta origen→destino, unidades, costos USD, estado); fila → detalle.
*   **Ver detalle**: `/transferencias/:transferId` — `TransferDetail.jsx` + `TransferLiquidationPanel` (tabs General / Desglose NCM / Desglose SKU, vistas MWT y Cliente) + generación de factura .html (ambas audiencias).
*   **Crear**: `/transferencias/nueva` — `CreateTransferWizard.jsx` (origen/destino → líneas por talla → revisión).
*   **Editar**: agregar/editar/eliminar cost_lines (con scope), editar timbres/impuestos custom, avanzar lifecycle; “Registrar pago” contra costos (sprint 05).
*   **Eliminar**: anular transferencia en borrador (modal); trash de costos sincroniza la liquidación.
*   `/ncm` — NcmEngine: CRUD de tasas DAI por NCM y ruta.

## Criterios de aceptación
- [ ] General = Σ NCM = Σ SKU en la liquidación (invariante contable) en ambas vistas.
- [ ] Recibir transferencia mueve stock por talla en ambos nodos.
- [ ] Factura .html cliente jamás contiene precios MWT (R3).
