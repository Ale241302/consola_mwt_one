---
name: mwt-admin-productos-crear
description: Rol Admin (CEO) · módulo Productos (productos) · permiso crear (crear). Herramientas MCP: producto_crear, producto_alias_crear. Lee el contrato en _contratos/productos.md antes de actuar.
role: admin
module: productos
action: create
---

# mwt-admin-productos-crear

> Skill MCP enfocado: **Admin (CEO)** · **Productos** · permiso **crear** (crear).

## Propósito
Operar el módulo **Productos** (`productos`) con la acción **crear** (crear) usando SOLO
las tools MCP que el rol **Admin (CEO)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Admin (CEO)** → Acceso operativo y comercial total. Ve costos y márgenes (finanzas).

## Herramientas MCP para esta acción
  - `producto_crear` — calzado), costo_estandar, precio_lista, precio_mwt, hs_code, pais_origen_iso2 ("BR"),
  - `producto_alias_crear` — no falle la próxima vez. `alias`: el código base del cliente sin la talla

## Firmas (cómo invocar)
  - `producto_crear` → `def producto_crear(datos: dict) -> Any:`
  - `producto_alias_crear` → `def producto_alias_crear(producto_id: str, cliente_id: str, alias: str, cliente_sku: str | None = None, notas: str | None = None) -> Any:`


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
- El alcance de este skill es **crear** sobre **Productos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/productos.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Productos.jsx`
  - `frontend/src/pages/ProductFormView.jsx`
  - `frontend/src/pages/NcmEngine.jsx`
- Backend:
  - `backend/apps/productos/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó crear (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
