# Creación 05 · Cobros y Finanzas — Pagos y Conciliación

## Objetivo
Registrar y conciliar dinero: cobros a clientes, pagos de costos logísticos (wizard con evidencia), aplicaciones contra costos/expedientes, reloj de crédito y el panel Finanzas CEO-only (comisiones, margen, devengo).

## Base de datos (schemas `cobros` + `finance`)
*   `cobros.cobro`: id, client_id (idx), expediente_id (idx), monto, moneda, fecha, estado, referencia, is_active.
*   `finance.payment`: id, codigo, expediente_id (idx), oc_id (idx), transferencia_id (idx), nodo_id, direction (IN/OUT), metodo, tipo_pago, monto, moneda, monto_usd, tasa_cambio, fecha, estado, referencia (unique parcial), evidencia_url, counterparty_*, is_active.
*   `finance.payment_application`: id, payment_id (idx), target_type/target_id (costo/expediente), monto_aplicado.
*   SQL: `80/81`, `B6_finance_v2.sql`, `B8_credit_clock`, `D1_payments_wizard`, `D8_uniq_ref`, índices E5.

## Backend (apps `cobros`, `finance`, `finanzas`)
*   `finance/payments`: list con filtros indexados (oc_id/expediente/transferencia/estado) + paginación; `register` (multipart: datos + aplicaciones + evidencia → storage fuera de la transacción); `applicables` (items aplicables por scope); detalle con aplicaciones agregadas EN LOTE.
*   `cobros`: CRUD de cobros del cliente.
*   `finanzas`: agregados CEO-only (403 para CLIENT) de comisión/margen/devengo.

## Frontend
*   **Ver registros**: `/financiero` (`Pagos.jsx`) y `/cobros` — tablas con filtros por estado/scope, montos `tabular-nums`.
*   **Ver detalle**: `PaymentDetailDrawer` (aplicaciones, evidencia, dirección IN/OUT).
*   **Crear**: wizard “+ Registrar pago” (desde OCDetail/TransferDetail/Pagos): monto+moneda+fecha+método → aplicar a costos (applicables) → evidencia → confirmar (doble submit bloqueado).
*   **Editar**: cambio de estado del pago (confirmar/anular) desde el drawer; PATCH de campos no contables.
*   **Eliminar**: anulación lógica con modal (motivo) → soft-delete; las aplicaciones se revierten.
*   `/finanzas`: panel CEO-only (AdminOnlyRoute).

## Criterios de aceptación
- [ ] Registrar pago end-to-end con evidencia y aplicaciones; totales consistentes en OC/transferencia.
- [ ] Referencia única (D8) rechaza duplicados con error claro en el wizard.
- [ ] CLIENT no accede a /finanzas ni ve pagos internos (R3 server-side).
