---
name: mwt-compras-usuarios-leer
description: Rol Compras · módulo Usuarios (usuarios) · permiso leer (consultar/listar). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/usuarios.md antes de actuar.
role: compras
module: usuarios
action: view
---

# mwt-compras-usuarios-leer

> Skill MCP enfocado: **Compras** · **Usuarios** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Usuarios** (`usuarios`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Compras** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Compras** → Proveedores + productos + marcas + sizing (create/update). Resto en lectura.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Usuarios y onboarding MCP
```
     Registro/reactivación/aprobación de usuarios.
     Emitir credenciales MCP (emit-grant).
```
> Anti-patrones:
     - get_object sin filtro is_active permite gestionar inactivos.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Onboarding MCP (registro/reactivación/aprobación) vive en core + users.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Usuarios**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/usuarios.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Users.jsx`
  - `frontend/src/pages/UserFormView.jsx`
  - `frontend/src/pages/RegistroSolicitudes.jsx`
- Backend:
  - `backend/apps/users/`
  - `backend/apps/core/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
