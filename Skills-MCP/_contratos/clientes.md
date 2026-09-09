# Contrato · módulo `clientes` — Clientes

- **Categoría:** COMERCIAL
- **Descripción:** Alta/edición de clientes, crédito, subsidiarias y KPIs de pool.

## Frontend
- `frontend/src/pages/Clientes.jsx`
- `frontend/src/pages/ClienteDetail.jsx`
- `frontend/src/pages/ClienteFormView.jsx`

## Backend
- `backend/apps/clientes/`

## Tools MCP (tool → acción RBAC)
  - `cliente_crear` — create
  - `cliente_editar` — update
  - `cliente_listar` — view
  - `cliente_obtener` — view
  - `cliente_subsidiarias` — view
  - `cliente_kpis_pool` — view

## Flujos operativos

### Alta de cliente
```
    cliente_listar(q=razon_social) → ¿existe? → cliente_obtener(id)
    cliente_crear({razon_social, tax_id, pais_iso2, tipo, …})
    [CEO] agrega credito_limit_usd / comision_pct
    cliente_editar(id, {estado:'ACTIVO'|…}) para ajustes
```
> Anti-patrones:
    - codigo_marluvas: 10 dígitos y único entre ACTIVOS (si no → 400).
    - credito_limit_usd/comision_pct son CEO-only; un operador no los setea.


## Notas / anti-patrones
- codigo_marluvas: exactamente 10 dígitos y único entre clientes ACTIVOS (defecto 3 corregido).
- credito_limit_usd / comision_pct son CEO-only.

## Referencia completa de tools (docstrings)

### `cliente_crear` — create
`def cliente_crear(datos: dict) -> Any:`

codigo_marluvas (10 dígitos), cedula_juridica, tipo (B2B/CONSUMIDOR/DISTRIBUIDOR),
segmento, parent_id, pais_iso2, ciudad, direccion_entrega, contacto_nombre,
contacto_email, canal, incoterm, medio_pago, dias_credito (0-180), moneda,
credito_limit_usd*, comision_pct* (*CEO-only), estado (ACTIVO/PAUSADO/BLOQUEADO/INACTIVO),
nodo_asignado_id, responsable_id.

⚠️ Un cliente NUEVO SIEMPRE nace ACTIVO (`is_active=true`, lo fuerza el backend);
NO envíes `is_active` (el campo no se admite) ni uses `estado="INACTIVO"` para
"crear sin exponer". Si quieres desactivar un cliente, créalo ACTIVO y luego

### `cliente_editar` — update
`def cliente_editar(cliente_id: str, cambios: dict) -> Any:`

Edita un cliente (PATCH parcial). `cambios` = subconjunto de los campos de cliente_crear.

### `cliente_listar` — view
`def cliente_listar( q: str | None = None, is_parent: str | None = None, tipo: str | None = None, estado: str | None = None, segmento: str | None = None, pais: str | None = None, canal: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`

(true/false/all), tipo, estado, segmento, pais (ISO-2), canal.
`limit`/`offset`: paginación (default limit=50, máx 200).
`campos`: lista separada por comas (ej. "id,razon_social,estado") para proyectar

### `cliente_obtener` — view
`def cliente_obtener(cliente_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `cliente_subsidiarias` — view
`def cliente_subsidiarias(cliente_id: str) -> Any:`

Lista las subsidiarias de un cliente padre.

### `cliente_kpis_pool` — view
`def cliente_kpis_pool(cliente_id: str) -> Any:`

KPIs consolidados del pool de crédito (padre + subsidiarias).

