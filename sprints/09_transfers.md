# Sprint 09 · Transfers — Transferencias entre Nodos y Landed Cost

## 1. Propósito
Movimientos de stock entre nodos con liquidación completa: costos (manual + OCR DUA), landed cost por línea/NCM/SKU, precios duales MWT/cliente, timbres e impuestos custom, factura interna .html y ciclo de vida del movimiento.

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `transfers` (`90`, `91*`: cost_lines, landed_cost, lifecycle, legal_documents, notes_log, `91l_cost_line_scope.sql`, `91m_cost_line_price_view.sql`, `D5_linea_4dp`, `D9_invoice_pricing_index`, `D6_cr_dua_cost_kinds`); NCM engine (`E1_ncm_engine.sql`).
*   **Backend**: app `transfers` (landed cost, prorrateo por scope, invoice-payload con `dai_rate` vivo por NCM origen→destino).
*   **Frontend**: `Transfers.jsx`, `TransferDetail.jsx`, `CreateTransferWizard.jsx`, `TransferLiquidationPanel.jsx` (~3.2k líneas, tabs General/NCM/SKU), `lib/transferInvoiceHtml.js`, `NcmEngine.jsx`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] Landed cost: prorrateo por (cost × línea × scope) — `EXPLAIN` con transferencias de 100+ líneas; verificar `D9_invoice_pricing_index`.
- [ ] `scope_json` de cost_line: filtros JSONB → candidato a GIN.
- [ ] invoice-payload: cálculo de DAI por NCM en vivo — cachear tabla NCM origen→destino por request.
- [ ] `transferenciaCostosPorOC`: lo llaman OCDetail y FusionDetail (por miembro) — batch por lista de OCs.
- [ ] Vista `cost_line_price_view` (91m): plan de ejecución y materialización si escala.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `TransferLiquidationPanel` (3.2k líneas): ErrorBoundary propio; tabs NCM/SKU con datos parciales sin crash.
- [ ] `CreateTransferWizard`: pasos con validación; navegación atrás sin perder selección de líneas.
- [ ] Generación de factura .html: payloads grandes sin congelar la UI (medir; si excede, generar en chunks).
- [ ] Recordatorio del repo: jsonb crudo del cursor llega como STRING — todo consumidor Python hace `json.loads` defensivo (memoria del proyecto).

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** cronometra apertura de TransferDetail + Liquidación con una transferencia grande.
2. **Backend** perfila landed cost y el payload de factura; **SQL** revisa índices de cost_line/scope.
3. Verificación cruzada: totales por pestaña General = Σ NCM = Σ SKU (invariante contable).

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (índices)** — `E5`: `cost_line(transferencia_id)` + `expediente_nodo_assignment(transferencia_id)`.
- ✅ **CORREGIDO (WAVE A)** — Los 3 getters (lines_count/qty_transfer/qty_received) batcheados: UN query `values().annotate(Count, Sum, Sum)` en el list, atajo `batch_linea_agg` con fallback.
- ✅ **CORREGIDO (WAVE B)** — `Transfers.jsx`: `(tot?.units_total ?? 0)` y `(tot?.has_discrepancy ?? false)` en los KPIs.
- ✅ **CORREGIDO (WAVE D)** — `E6`: GIN en `cost_line(scope_json)`.
