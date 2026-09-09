# Contrato · módulo `pagos` — Pagos

- **Categoría:** FINANCIERO
- **Descripción:** Registro y conciliación de pagos, liberación de crédito.

## Frontend
- `frontend/src/pages/Pagos.jsx`

## Backend
- `backend/apps/finanzas/`
- `backend/apps/finance/`

## Tools MCP (tool → acción RBAC)
  - `pago_dry_run` — create
  - `pago_registrar` — create
  - `pago_conciliar` — update
  - `pago_liberar_credito` — update
  - `pago_rechazar` — update
  - `pago_applicables` — view
  - `pago_listar` — view
  - `pago_obtener` — view

## Flujos operativos

### Pagos (entrante/saliente)
```
    pago_applicables(expediente_id|client_id)
    pago_dry_run(...) [simular]
    pago_registrar({direction:'IN'|'OUT', monto, aplicaciones:[{applicable_type, applicable_id, monto_aplicado}]})
    pago_obtener(id) → pago_conciliar(id, bank_reference) [impacta saldo/crédito]
    pago_liberar_credito(id) / pago_rechazar(id, body)
```
> Anti-patrones:
    - Registrar un pago y no conciliarlo → no impacta saldos.
    - applicable_type debe ser COSTO|PRODUCTO|PROFORMA|FACTURA.


## Notas / anti-patrones
- pago_registrar / pago_dry_run = pagos.create; pago_conciliar/rechazar/liberar = pagos.update.

## Referencia completa de tools (docstrings)

### `pago_dry_run` — create
`def pago_dry_run(expediente_id: str, monto: float, direction: str, aplicaciones: list, counterparty_type: str | None = None, counterparty_id: str | None = None) -> Any:`

`direction`: IN (entrante, cliente→MWT) u OUT (saliente, MWT→proveedor).
Aunque no persiste, ejecuta POST, así que en modo readonly queda bloqueada

### `pago_registrar` — create
`def pago_registrar( expediente_id: str, monto: float, moneda: str, fecha: str, metodo: str, tipo_pago: str, referencia: str, aplicaciones: list, notas: str | None = None, file_path: str | None = None, event_id: str | None = None, idempotency_key: str | None = None, ) -> Any:`

NEEDS_REVIEW) y NO afecta saldos ni crédito hasta conciliar (ver pago_conciliar).
`idempotency_key`: token opcional para que reintentos tras timeout NO registren
el mismo pago dos veces (Ola 2 · 2.20); reutilízalo al reintentar el MISMO pago.

- `metodo`: TRANSFERENCIA_BANCARIA o NOTA_CREDITO.
- `tipo_pago`: PARCIAL o COMPLETO. `referencia`: nº de referencia (3-64 chars).
- `aplicaciones`: [{applicable_type: COSTO|PRODUCTO|PROFORMA|FACTURA, applicable_id,
    applicable_code?, cantidad_producto? (solo PRODUCTO), monto_aplicado}].
  Usa pago_applicables para obtener los applicable_id (sku/talla/cantidad para PRODUCTO).
- `file_path`: comprobante opcional (pdf/png/jpg/webp ≤10MB).

### `pago_conciliar` — update
`def pago_conciliar(pago_id: str, bank_reference: str | None = None) -> Any:`

(sin docstring)

### `pago_liberar_credito` — update
`def pago_liberar_credito(pago_id: str) -> Any:`

Libera el crédito de un pago (CEO-only).

### `pago_rechazar` — update
`def pago_rechazar(pago_id: str, rejection_reason: str, rejection_comment: str | None = None) -> Any:`

DUPLICADO, COMPROBANTE_INVALIDO, FUERA_DE_PLAZO, CONTRAPARTE_INCORRECTA, OTRO

### `pago_applicables` — view
`def pago_applicables( type: str, expediente: str | None = None, nodo_id: str | None = None, transferencia_id: str | None = None, oc_id: str | None = None, include_paid: bool | None = None, ) -> Any:`

Para PROFORMA/FACTURA pasa `expediente`. Para COSTO/PRODUCTO acota con nodo_id,

### `pago_listar` — view
`def pago_listar(expediente_id: str | None = None, estado: str | None = None, transferencia_id: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None) -> Any:`

CONFIRMADO_HUMANO/RECHAZADO/REVERTIDO), transferencia_id, q.
`limit`/`offset`: paginación (default limit=50, máx 200).

### `pago_obtener` — view
`def pago_obtener(pago_id: str, campos: str | None = None) -> Any:`

(sin docstring)

