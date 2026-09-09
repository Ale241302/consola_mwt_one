---
name: mwt-superadmin-builder-leer
description: Rol Super Admin · módulo MWT Builder (builder) · permiso leer (consultar/listar). Herramientas MCP: builder_structure_construir, builder_artefacto_listar, builder_artefacto_obtener. Lee el contrato en _contratos/builder.md antes de actuar.
role: superadmin
module: builder
action: view
---

# mwt-superadmin-builder-leer

> Skill MCP enfocado: **Super Admin** · **MWT Builder** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **MWT Builder** (`builder`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Super Admin** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Super Admin** → Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.

## Herramientas MCP para esta acción
  - `builder_structure_construir` — a partir de una especificación declarativa de secciones/columnas/campos.
  - `builder_artefacto_listar`
  - `builder_artefacto_obtener`

## Firmas (cómo invocar)
  - `builder_structure_construir` → `def builder_structure_construir(secciones: list) -> Any:`
  - `builder_artefacto_listar` → `def builder_artefacto_listar(limit: int | None = None, offset: int | None = None) -> Any:`
  - `builder_artefacto_obtener` → `def builder_artefacto_obtener(artefacto_id: int) -> Any:`


## Flujos del módulo

### MWT Builder (externo)
```
     builder_structure_construir(...)
     builder_artefacto_crear/editar/eliminar(...)
```
> Anti-patrones:
     - Habla con builder.muito.work, NO con la BD; solo operadores MWT (admin/superadmin).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Solo admin/superadmin (module builder).
- tools builder_* hablan con el Builder externo, no con la BD.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **MWT Builder**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/builder.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/AIGovernance.jsx`
  - `frontend/src/pages/AIHub.jsx`
- Backend:
  - `backend/apps/ai_hub/`
  - `mcp_server/mwt_mcp/builder_client.py`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
