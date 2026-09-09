# Contrato · módulo `productos` — Productos

- **Categoría:** COMERCIAL
- **Descripción:** Catálogo de productos, SKUs, NCM, precios y fichas técnicas.

## Frontend
- `frontend/src/pages/Productos.jsx`
- `frontend/src/pages/ProductFormView.jsx`
- `frontend/src/pages/NcmEngine.jsx`

## Backend
- `backend/apps/productos/`

## Tools MCP (tool → acción RBAC)
  - `producto_crear` — create
  - `producto_alias_crear` — create
  - `producto_editar` — update
  - `producto_listar` — view
  - `producto_obtener` — view
  - `producto_buscar` — view
  - `producto_precio_cliente` — view
  - `producto_ficha_tecnica` — view
  - `ncm_listar` — view

## Flujos operativos

### Alta de producto (catálogo)
```
    producto_listar(q=sku) → producto_obtener(id)
    producto_crear({sku, nombre, marca_id, tallas:[uuids], especificaciones:{sizes:[uuids], ncm}})
    producto_alias_crear(producto_id, cliente_id, alias='70B22-CPAP')
    ncm_listar() / marca_listar() / tallas_listar() para catálogos
```
> Anti-patrones:
    - NO inventar SKUs ni tallas: los UUIDs salen de producto_*/tallas_listar.
    - Producto sin tallas/especificaciones.sizes → el matching de líneas falla después.
    - producto_crear con 'SIN-SKU'/'PENDING' en tallas → rechazado.


## Notas / anti-patrones
- ncm_listar y tallas_listar caen en productos.view / sizing.view.
- producto_precio_cliente y producto_ficha_tecnica son de consulta.

## Referencia completa de tools (docstrings)

### `producto_crear` — create
`def producto_crear(datos: dict) -> Any:`

calzado), costo_estandar, precio_lista, precio_mwt, hs_code, pais_origen_iso2 ("BR"),
estado ("ACTIVO"), colores (["Negro"]).
TALLAS: pon en **`tallas`** Y en **`especificaciones.sizes`** el MISMO array de **UUIDs**
de talla (de `tallas_listar`) — NUNCA labels ni "UNICA". NCM: `hs_code` + `especificaciones.ncm`
con el mismo código (ej. "6403.99.90"). Ej.:
{sku, nombre, marca_id, unidad:"PAR", precio_lista, precio_mwt, hs_code:"6403.99.90",
 tallas:[<uuid39>,<uuid40>...], especificaciones:{ncm:"6403.99.90", color:"Negro",

### `producto_alias_crear` — create
`def producto_alias_crear(producto_id: str, cliente_id: str, alias: str, cliente_sku: str | None = None, notas: str | None = None) -> Any:`

no falle la próxima vez. `alias`: el código base del cliente sin la talla

### `producto_editar` — update
`def producto_editar(producto_id: str, cambios: dict) -> Any:`

(sin docstring)

### `producto_listar` — view
`def producto_listar( q: str | None = None, marca: str | None = None, categoria: str | None = None, estado: str | None = None, proveedor: str | None = None, limit: int | None = None, offset: int | None = None, ) -> Any:`

marca (UUID), categoria, estado, proveedor (UUID), limit, offset.
Las tallas se devuelven resueltas a su nombre (33, 35, ...) con equivalencias,

### `producto_obtener` — view
`def producto_obtener(producto_id: str, campos: str | None = None) -> Any:`

(tallas resueltas a nombre+equivalencias, client_prices filtrado por rol, ncm)
y precios (precio_lista, precio_distribuidor, costo_estandar).

### `producto_buscar` — view
`def producto_buscar(q: str, limit: int | None = None) -> Any:`

insensible a mayúsculas). Ejemplos: "60b29", "700728", "bota alta",
"suela caucho", "composite", "60B29-CPAP-SRV".

Úsala cuando el usuario pregunte por un producto o un tipo de producto
(por código, nombre, marca o atributo técnico). Busca en el catálogo del
rol (B2B o completo), indexando también las especificaciones
(tipo_calzado, suela, color, riesgo, segmento, cierre, puntera...).
Devuelve `{productos:[{id, sku, nombre, marca, precio_venta, categoria}]}`
(para admin/CEO incluye especificaciones). `limit`: máx de resultados

### `producto_precio_cliente` — view
`def producto_precio_cliente( sku: str, marca_id: str | None = None, plazo_dias: int | None = None, banda_id: int | None = None, usar_tc_actual: bool = True, ) -> Any:`

Fuente: `commercial/marluvas/product-clients-matrix` (matriz precalculada).

Comportamiento:
  · `plazo_dias` (8/15/30/60/90; default 90) → precio de ese plazo.
  · Banda: usa la VIGENTE según el TC USD/BRL actual (ej. TC 5.08 → banda 6,
    rango 5,00–5,20) salvo que pases `banda_id` explícito.
  · `usar_tc_actual=true` (default) consulta el TC en vivo para elegir banda.
  · Rol: CEO/Admin ve TODOS los clientes; client_b2b solo sus empresas;
    staff no-CEO NO ve precios por cliente (solo la banda/plazo).

Devuelve `{sku, banda_vigente, plazo_dias, clientes: [{cliente_id,
razon_social, nombre_comercial, com_pct, banda, plazo_dias, precio,

### `producto_ficha_tecnica` — view
`def producto_ficha_tecnica(producto_id: str) -> Any:`

El PDF se genera desde el backend (`/api/productos/{id}/ficha-tecnica/pdf/`) y se
guarda localmente en el entorno del MCP. Devuelve `{ok, path, filename, size_bytes}`.

### `ncm_listar` — view
`def ncm_listar() -> Any:`

Lista los códigos NCM/arancelarios disponibles (code, descripcion, tarifas).

