# Sprint 05 · Cobros y Finanzas — Pagos, Conciliación y Crédito

## 1. Propósito
Gestión financiera: cobros a clientes, pagos de costos logísticos (wizard Registrar Pago), conciliación contra costos de movimientos, reloj de crédito y el módulo Finanzas CEO-ONLY (comisiones, margen, devengo).

## 2. Mapeo Tecnológico
*   **Base de datos**: schemas `cobros` (`80/81`), `finance` (`B6_finance_v2.sql`, `B7_finance_ai_verdict.sql`, `B8_finance_credit_clock.sql`, `D1_finance_payments_wizard.sql`, `D8_payment_uniq_ref_partial.sql`).
*   **Backend**: apps `cobros`, `finance` (`finance/payments` + applicables + register multipart), `finanzas` (CEO-only, 403 server-side).
*   **Frontend**: `Cobros.jsx`, `Pagos.jsx`, `Finanzas.jsx` (ruta AdminOnly), `PaymentDetailDrawer`, wizard Registrar Pago (OCDetail/TransferDetail), `OCPagosCard`/`FusionPagosCard`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `finance.payment`: índices por `oc_id`, `expediente_id`, `transferencia_id`, `nodo_id`, `estado` (filtros del list).
- [ ] `listApplicables`: query de items aplicables por scope — `EXPLAIN` con muchos costos.
- [ ] Conciliación/aplicaciones de pago: ¿agregación en SQL o bucles Python por aplicación?
- [ ] `register` (multipart con evidencia): subida a storage no debe bloquear la transacción de BD.
- [ ] Finanzas CEO: queries de comisiones/margen — revisar ventanas temporales y agregados.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `OCPagosCard`/`FusionPagosCard`: errores de red muestran mensaje, nunca pantalla blanca; `cancel` en efectos.
- [ ] Wizard Registrar Pago: doble submit bloqueado (`disabled`+loading), errores del backend visibles.
- [ ] `Finanzas.jsx`: usuario CLIENT redirigido sin loop (AdminOnlyRoute) incluso navegando rápido.
- [ ] `PaymentDetailDrawer`: abrir/cerrar rápido N veces sin fugas de estado.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** reporta latencias de `/finance/payments/` y applicables al abrir cards/drawers.
2. **Backend** revisa filtros del list + serialización; pide índices a **SQL**.
3. **SQL** entrega índices parciales (`WHERE is_active`) donde aplique.
4. Cierre conjunto con un pago de prueba end-to-end (registrar → aplicar → ver en card combinada de fusión).

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (índices)** — `E5_audit_indexes.sql`: `finance.payment(oc_id)`, `(expediente_id)`, `(transferencia_id)`.
- ✅ **CORREGIDO (WAVE A)** — Los 3 getters (aplicaciones/evidencia/ai_verdict) batcheados con `payment_id__in` en el list (atajos `batch_apps/batch_evidencia/batch_verdict` con fallback) y el slice `[:200]` ahora es `?limit=` (default 200, cap 1000).
- ✅ **CORREGIDO (WAVE B)** — `Pagos.jsx`: guards `Array.isArray` en `expItems`/`ocItems` antes de mapear. El patrón `alive` ya era correcto.
