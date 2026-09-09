---
name: mwt-superadmin-marcas-eliminar
description: Rol Super Admin · módulo Marcas (marcas) · permiso eliminar (eliminar/borrar). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/marcas.md antes de actuar.
role: superadmin
module: marcas
action: delete
---

# mwt-superadmin-marcas-eliminar

> Skill MCP enfocado: **Super Admin** · **Marcas** · permiso **eliminar** (eliminar/borrar).

## Propósito
Operar el módulo **Marcas** (`marcas`) con la acción **eliminar** (eliminar/borrar) usando SOLO
las tools MCP que el rol **Super Admin** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Super Admin** → Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Marcas
```
     marca_listar() → marca_id para productos/pricing
```
> Anti-patrones:
     - marca_listar es solo lectura (marcas.view).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Tool marca_listar es de solo lectura (marcas.view).

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **eliminar** sobre **Marcas**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/marcas.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Brands.jsx`
  - `frontend/src/pages/BrandDetail.jsx`
  - `frontend/src/pages/BrandClientPricingForm.jsx`
- Backend:
  - `backend/apps/brands/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó eliminar/borrar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
