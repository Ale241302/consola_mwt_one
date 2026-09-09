---
name: mwt-viewer-productos-leer
description: Rol Viewer (solo lectura) · módulo Productos (productos) · permiso leer (consultar/listar). Herramientas MCP: producto_listar, producto_obtener, producto_buscar, producto_precio_cliente, producto_ficha_tecnica, ncm_listar. Lee el contrato en _contratos/productos.md antes de actuar.
role: viewer
module: productos
action: view
---

# mwt-viewer-productos-leer

> Skill MCP enfocado: **Viewer (solo lectura)** · **Productos** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Productos** (`productos`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Viewer (solo lectura)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Viewer (solo lectura)** → Solo lectura (view/download_doc/view_doc) en todos sus módulos.

## Herramientas MCP para esta acción
  - `producto_listar` — marca (UUID), categoria, estado, proveedor (UUID), limit, offset.
  - `producto_obtener` — (tallas resueltas a nombre+equivalencias, client_prices filtrado por rol, ncm)
  - `producto_buscar` — insensible a mayúsculas). Ejemplos: "60b29", "700728", "bota alta",
  - `producto_precio_cliente` — Fuente: `commercial/marluvas/product-clients-matrix` (matriz precalculada).
  - `producto_ficha_tecnica` — El PDF se genera desde el backend (`/api/productos/{id}/ficha-tecnica/pdf/`) y se
  - `ncm_listar` — Lista los códigos NCM/arancelarios disponibles (code, descripcion, tarifas).

## Firmas (cómo invocar)
  - `producto_listar` → `def producto_listar( q: str | None = None, marca: str | None = None, categoria: str | None = None, estado: str | None = None, proveedor: str | None = None, limit: int | None = None, offset: int | None = None, ) -> Any:`
  - `producto_obtener` → `def producto_obtener(producto_id: str, campos: str | None = None) -> Any:`
  - `producto_buscar` → `def producto_buscar(q: str, limit: int | None = None) -> Any:`
  - `producto_precio_cliente` → `def producto_precio_cliente( sku: str, marca_id: str | None = None, plazo_dias: int | None = None, banda_id: int | None = None, usar_tc_actual: bool = True, ) -> Any:`
  - `producto_ficha_tecnica` → `def producto_ficha_tecnica(producto_id: str) -> Any:`
  - `ncm_listar` → `def ncm_listar() -> Any:`


## Flujos del módulo

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


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- ncm_listar y tallas_listar caen en productos.view / sizing.view.
- producto_precio_cliente y producto_ficha_tecnica son de consulta.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Productos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/productos.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Productos.jsx`
  - `frontend/src/pages/ProductFormView.jsx`
  - `frontend/src/pages/NcmEngine.jsx`
- Backend:
  - `backend/apps/productos/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
