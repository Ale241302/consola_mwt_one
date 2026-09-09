# Contrato · módulo `inventario` — Inventario

- **Categoría:** ALMACEN
- **Descripción:** Stock, recepción, saldos por expediente y asignaciones de inventario.

## Frontend
- `frontend/src/pages/Inventario.jsx`
- `frontend/src/pages/InboundReceptionWizard.jsx`
- `frontend/src/components/inventario/`

## Backend
- `backend/apps/inventario/`

## Tools MCP (tool → acción RBAC)
  - `recepcion_crear` — create
  - `inventario_transferir_asignaciones` — update
  - `stock_listar` — view
  - `inventario_saldos_por_expediente` — view
  - `inventario_expedientes_con_pendiente` — view
  - `inventario_lineas_en_nodo` — view
  - `inventario_artefactos_expediente` — view

## Flujos operativos

### Recepción e inventario
```
    nodo_listar → nodo_obtener(id) [destino]
    recepcion_crear(expediente_id, nodo_id, lines=[{producto_id, size, qty, unit_cost_usd}], cost_lines=[{kind, amount, currency, fx_to_usd}])
    stock_listar(nodo, producto) [verificar saldos]
    inventario_saldos_por_expediente(expediente_ids=[...])
    inventario_transferir_asignaciones(...) [reasignar]
```
> Anti-patrones:
    - Recepción con unit_cost_usd=0 en líneas CERRADAS → rechazado.
    - kind de costo DEBE estar en el catálogo válido.
    - El nodo_id vive DENTRO de cada item de lines (no como arg suelto).


## Notas / anti-patrones
- recepcion_crear (inventario.create) confirma líneas con nodo_id dentro de cada item.
- stock_listar / inventario_* son de consulta (inventario.view).

## Referencia completa de tools (docstrings)

### `recepcion_crear` — create
`def recepcion_crear(items: list, cost_lines: list | None = None, recepcion_id: str | None = None) -> Any:`

`items`: [{expediente_id, producto_id, talla, qty_asignada, nodo_id, notas?}].
`cost_lines`: opcional (paso 3 costos): [{kind, label?, amount, currency, fx_to_usd,
  source, scope}] donde scope = {"applies_to_all": true} o {"applies_to_all": false,
  "expediente_ids":[...], "lines":[{expediente_id,producto_id,talla}]}.

### `inventario_transferir_asignaciones` — update
`def inventario_transferir_asignaciones(origin_nodo_id: str, destination_nodo_id: str, items: list, transferencia_id: str | None = None) -> Any:`

(sin docstring)

### `stock_listar` — view
`def stock_listar(nodo: str | None = None, producto: str | None = None, solo_disponible: bool | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None) -> Any:`

`limit`/`offset`: paginación (default limit=50, máx 200).

### `inventario_saldos_por_expediente` — view
`def inventario_saldos_por_expediente(expediente_ids: list, nodo_id: str | None = None) -> Any:`

Saldos pendientes de asignar por expediente. `expediente_ids`: lista de UUIDs (requerido).

### `inventario_expedientes_con_pendiente` — view
`def inventario_expedientes_con_pendiente() -> Any:`

Devuelve los expediente_ids que tienen cantidades pendientes de recibir.

### `inventario_lineas_en_nodo` — view
`def inventario_lineas_en_nodo(nodo_id: str, expediente_ids: list | None = None) -> Any:`

(sin docstring)

### `inventario_artefactos_expediente` — view
`def inventario_artefactos_expediente(expediente_id: str) -> Any:`

embarque), Packing List, Factura Comercial, Certificado de Origen y demás
artefactos del Builder. Úsala cuando el usuario pida 'el BL', 'packing',
'factura', 'certificado' o documentos de embarque/exportación de un
expediente (no confundir con `documento_listar`, que es otra capa).
`expediente_id` acepta el UUID interno, el código EXP-…, o la referencia del
cliente (OC/SAP/proforma) — el MCP resuelve internamente.
Para un client_b2b solo devuelve los que tienen `publicado=True`.
Cada artefacto incluye `archivo_url` (descarga directa del binario adjunto,
ej. el PDF del Packing List) cuando el artefacto tiene un campo file en su

