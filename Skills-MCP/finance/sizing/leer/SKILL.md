---
name: mwt-finance-sizing-leer
description: Rol Finance · módulo Motor de Tallas (sizing) · permiso leer (consultar/listar). Herramientas MCP: tallas_listar. Lee el contrato en _contratos/sizing.md antes de actuar.
role: finance
module: sizing
action: view
---

# mwt-finance-sizing-leer

> Skill MCP enfocado: **Finance** · **Motor de Tallas** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Motor de Tallas** (`sizing`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Finance** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Finance** → Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.

## Herramientas MCP para esta acción
  - `tallas_listar` — `{results:[{id, nombre, talla_base, br, eu, ...}]}`. **El `id` (UUID) es lo que se

## Firmas (cómo invocar)
  - `tallas_listar` → `def tallas_listar(tipo_producto: str = "calzado") -> Any:`


## Flujos del módulo

### Motor de tallas
```
     tallas_listar() → UUIDs de tallas para productos
     sizing.create/update para mantener el catálogo
```
> Anti-patrones:
     - Tallas dobles (33/34, 35/36, 45/46) existen en ops.tallas.
     - No inventes tallas: referenciá por UUID.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- tallas_listar usa sizing.view.
- Soporta tallas dobles (33/34, 35/36, 45/46) en ops.tallas.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Motor de Tallas**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/sizing.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/SizingEngine.jsx`
  - `frontend/src/components/marluvas/`
- Backend:
  - `backend/apps/sizing/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
