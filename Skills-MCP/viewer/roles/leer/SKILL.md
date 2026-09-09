---
name: mwt-viewer-roles-leer
description: Rol Viewer (solo lectura) · módulo Roles y Permisos (roles) · permiso leer (consultar/listar). Herramientas MCP: mwt_diag_scope. Lee el contrato en _contratos/roles.md antes de actuar.
role: viewer
module: roles
action: view
---

# mwt-viewer-roles-leer

> Skill MCP enfocado: **Viewer (solo lectura)** · **Roles y Permisos** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Roles y Permisos** (`roles`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Viewer (solo lectura)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Viewer (solo lectura)** → Solo lectura (view/download_doc/view_doc) en todos sus módulos.

## Herramientas MCP para esta acción
  - `mwt_diag_scope` — Dado un `email` (o `user_id`), devuelve qué legal_entities ve, qué rol

## Firmas (cómo invocar)
  - `mwt_diag_scope` → `def mwt_diag_scope(email: str | None = None, user_id: str | None = None) -> Any:`


## Flujos del módulo

### Roles y permisos (RBAC)
```
     mwt_diag_scope(email) [diagnóstico CEO-only]
     Mantener la matriz core.roles.permissions.
```
> Anti-patrones:
     - El filtrado de tools MCP respeta la matriz REAL (sin wildcard automático).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- mwt_diag_scope mapea a roles.view (diagnóstico de usuarios/permisos).

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Roles y Permisos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/roles.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/RolesPermissions.jsx`
- Backend:
  - `backend/apps/roles/`
  - `backend/apps/core/permissions.py`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
