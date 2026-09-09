---
name: mwt-admin-roles-subir-documento
description: Rol Admin (CEO) · módulo Roles y Permisos (roles) · permiso subir-documento (subir un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/roles.md antes de actuar.
role: admin
module: roles
action: upload_doc
---

# mwt-admin-roles-subir-documento

> Skill MCP enfocado: **Admin (CEO)** · **Roles y Permisos** · permiso **subir-documento** (subir un archivo/documento).

## Propósito
Operar el módulo **Roles y Permisos** (`roles`) con la acción **subir-documento** (subir un archivo/documento) usando SOLO
las tools MCP que el rol **Admin (CEO)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Admin (CEO)** → Acceso operativo y comercial total. Ve costos y márgenes (finanzas).

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


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
- El alcance de este skill es **subir-documento** sobre **Roles y Permisos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/roles.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/RolesPermissions.jsx`
- Backend:
  - `backend/apps/roles/`
  - `backend/apps/core/permissions.py`

## Entrega
Cuando completes la operación, resume: qué recurso quedó subir un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
