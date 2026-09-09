# Contrato · módulo `transferencias` — Transferencias

- **Categoría:** ALMACEN
- **Descripción:** Transferencias entre nodos, costos y liquidación landed cost.

## Frontend
- `frontend/src/pages/Transfers.jsx`
- `frontend/src/pages/TransferDetail.jsx`
- `frontend/src/pages/CreateTransferWizard.jsx`

## Backend
- `backend/apps/transfers/`

## Tools MCP (tool → acción RBAC)
  - `transferencia_crear` — create
  - `transfer_artefacto_crear` — create
  - `transfer_nota_crear` — create
  - `transfer_costo_agregar` — create
  - `transfer_costo_eliminar` — delete
  - `transferencia_avanzar` — update
  - `transferencia_aprobar` — update
  - `transferencia_despachar` — update
  - `transferencia_editar` — update
  - `transferencia_recibir` — update
  - `transferencia_conciliar` — update
  - `transferencia_cerrar` — update
  - `transferencia_cancelar` — update
  - `transfer_costo_editar` — update
  - `transfer_liquidar` — update
  - `transferencia_listar` — view
  - `transferencia_obtener` — view
  - `transfer_notas_listar` — view
  - `transfer_costos_listar` — view
  - `transfer_liquidacion_preview` — view
  - `transfer_factura_payload` — view

## Flujos operativos

### Transferencias entre nodos
```
    transferencia_listar(origen, destino, estado) → transferencia_obtener(id)
    transferencia_crear({origen, destino, lineas:[{producto_id, size, qty}], ...})
    transferencia_aprobar(id) → transferencia_despachar(id) → transferencia_recibir(id, lineas)
    transferencia_conciliar(id) → transferencia_cerrar(id)
    transfer_notas_listar(id) / transfer_nota_crear(id, text)
```
> Anti-patrones:
    - Saltarse aprobar→despachar→recibir → 409 (transición ilegal).

### Costos y liquidación landed
```
    transfer_costos_listar(transferencia_id)
    transfer_costo_agregar(id, kind, amount, currency, fx_to_usd, scope_json={expediente_ids:[...]} o {lines:[...]})
    transfer_artefacto_crear(id, ...) [AWB/BL]
    transfer_liquidacion_preview(id) → transfer_liquidar(id, method='BY_VALUE')
    transfer_factura_payload(id)
```
> Anti-patrones:
    - El motor EXCLUYE el IVA del landed (va en summary.extra_costs_iva_usd).
    - scope_json: usa expediente_ids o lines, NO ambos a la vez.
    - transfer_costo_agregar usa `label` como parámetro nombrado.


## Notas / anti-patrones
- transfer_liquidar EXCLUYE IVA del landed cost (P0 corregido).
- transfer_costo_* gestionan costos extra (DAI por NCM, etc.).

## Referencia completa de tools (docstrings)

### `transferencia_crear` — create
`def transferencia_crear( origen_id: str, destino_id: str, legal_context: str = "INTERNAL", lineas: list | None = None, cost_lines: list | None = None, ref_tracking: str | None = None, context_data: dict | None = None, notes: str | None = None, idempotency_key: str | None = None, ) -> Any:`

`legal_context`: INTERNAL/NATIONALIZATION/EXPORT/DISTRIBUTION/CONSIGNMENT.
`lineas`: [{producto_id, sku, size, qty_transfer, unit_cost, unit_value}].
`cost_lines`: costos DUA iniciales (ver transfer_costo_agregar).
`context_data`: metadata legal (p.ej. bl_awb_number, dua_number, transfer_pricing_amount).
`idempotency_key`: token opcional para que reintentos tras timeout NO dupliquen

### `transfer_artefacto_crear` — create
`def transfer_artefacto_crear(transferencia_id: str, template_id: int, template_title: str, data: dict, structure_snapshot: dict | None = None, lines: list | None = None) -> Any:`

Mismo formato de `data` (indexado por field.id; ver `nodo_artefacto_crear`),

### `transfer_nota_crear` — create
`def transfer_nota_crear(transferencia_id: str, text: str, actor_name: str | None = None) -> Any:`

Agrega una nota al movimiento.

### `transfer_costo_agregar` — create
`def transfer_costo_agregar( transferencia_id: str, kind: str, amount: float, label: str | None = None, currency: str = "USD", fx_to_usd: float = 1.0, price_view: str = "MWT", scope_json: dict | None = None, source: str = "MANUAL", document_id: str | None = None, notes: str | None = None, ) -> Any:`

`kind`: DAI, IVA, ALMACENAJE, AGENCIAMIENTO, MANIPULEO, FLETE, SEGURO,
  CONSOLIDACION, PROCOMER, LEY_6946, TIMBRE_ARCHIVO, TIMBRE_AGENTES,
  TIMBRE_CONTADORES, OTRO. Para un impuesto custom usa kind=OTRO o el fiscal que aplique.
`amount` + `fx_to_usd`: monto y conversión a USD.
`price_view`: MWT (liquidación interna, CEO) o CLIENT (vista cliente).
`scope_json`: a qué aplica — null/{"applies_to_all":true} = todo el batch, o
  {"applies_to_all":false, "expediente_ids":[...], "lines":[{expediente_id,producto_id,talla}]}.
  `transfer_liquidar` ya HONRA el scope (prorratea solo a esas líneas — DAI por NCM).
`kind="IVA"`: la liquidación lo EXCLUYE del landed (crédito fiscal acreditable); no infla el costo.

### `transfer_costo_eliminar` — delete
`def transfer_costo_eliminar(transferencia_id: str, cost_id: str) -> Any:`

Elimina (soft) una línea de costo del movimiento.

### `transferencia_avanzar` — update
`def transferencia_avanzar(transferencia_id: str, notes: str | None = None) -> Any:`

Avanza el movimiento al siguiente estado legal (advance).

### `transferencia_aprobar` — update
`def transferencia_aprobar(transferencia_id: str, notes: str | None = None) -> Any:`

Aprueba el movimiento (PLANNED→APPROVED).

### `transferencia_despachar` — update
`def transferencia_despachar(transferencia_id: str, notes: str | None = None) -> Any:`

(sin docstring)

### `transferencia_editar` — update
`def transferencia_editar(transferencia_id: str, cambios: dict) -> Any:`

(sin docstring)

### `transferencia_recibir` — update
`def transferencia_recibir(transferencia_id: str, lineas: list, received_at: str | None = None, received_by_name: str | None = None) -> Any:`

(sin docstring)

### `transferencia_conciliar` — update
`def transferencia_conciliar(transferencia_id: str, reconciled_by_id: str | None = None, reconciled_note: str | None = None, exception_document_id: str | None = None, gap_justification: str | None = None) -> Any:`

(sin docstring)

### `transferencia_cerrar` — update
`def transferencia_cerrar(transferencia_id: str) -> Any:`

Cierra el movimiento (→CLOSED).

### `transferencia_cancelar` — update
`def transferencia_cancelar(transferencia_id: str, notes: str | None = None) -> Any:`

Cancela el movimiento (→CANCELLED, revierte efectos de inventario).

### `transfer_costo_editar` — update
`def transfer_costo_editar(transferencia_id: str, cost_id: str, cambios: dict) -> Any:`

Edita una línea de costo del movimiento (PATCH parcial).

### `transfer_liquidar` — update
`def transfer_liquidar(transferencia_id: str, method: str = "BY_VALUE") -> Any:`

El motor **excluye el IVA** del landed (crédito fiscal acreditable; va aparte en
`summary.extra_costs_iva_usd`) y **aplica `scope_json`**: cada costo se prorratea SOLO entre

### `transferencia_listar` — view
`def transferencia_listar(origen: str | None = None, destino: str | None = None, estado: str | None = None, legal_context: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None) -> Any:`

estado (PLANNED/APPROVED/IN_TRANSIT/RECEIVED/RECONCILED/CLOSED/CANCELLED),
legal_context (INTERNAL/NATIONALIZATION/EXPORT/DISTRIBUTION/CONSIGNMENT), q.
`limit`/`offset`: paginación (default limit=50, máx 200).

### `transferencia_obtener` — view
`def transferencia_obtener(transferencia_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `transfer_notas_listar` — view
`def transfer_notas_listar(transferencia_id: str) -> Any:`

Lista las notas del movimiento.

### `transfer_costos_listar` — view
`def transfer_costos_listar(transferencia_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `transfer_liquidacion_preview` — view
`def transfer_liquidacion_preview(transferencia_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `transfer_factura_payload` — view
`def transfer_factura_payload(transferencia_id: str) -> Any:`

(sin docstring)

