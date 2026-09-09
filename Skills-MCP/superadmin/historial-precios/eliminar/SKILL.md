---
name: mwt-superadmin-historial-precios-eliminar
description: Rol Super Admin · módulo Historial de precios (historial-precios) · permiso eliminar (eliminar/borrar). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/historial-precios.md antes de actuar.
role: superadmin
module: historial-precios
action: delete
---

# mwt-superadmin-historial-precios-eliminar

> Skill MCP enfocado: **Super Admin** · **Historial de precios** · permiso **eliminar** (eliminar/borrar).

## Propósito
Operar el módulo **Historial de precios** (`historial-precios`) con la acción **eliminar** (eliminar/borrar) usando SOLO
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

### Historial de precios
```
     Consultar PriceHistory por producto/banda.
     lineas_actualizar_precios actualiza precios de líneas (expedientes.update).
```
> Anti-patrones:
     - El precio MWT vs precio cliente se leen por separado (unit_price_mwt / unit_price_client).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- lineas_actualizar_precios mapea a expedientes.update (no a este módulo).

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **eliminar** sobre **Historial de precios**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/historial-precios.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/PriceHistory.jsx`
- Backend:
  - `backend/apps/commercial/`
  - `backend/apps/productos/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó eliminar/borrar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
