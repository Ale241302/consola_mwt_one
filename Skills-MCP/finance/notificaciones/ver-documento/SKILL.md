---
name: mwt-finance-notificaciones-ver-documento
description: Rol Finance · módulo Notificaciones (notificaciones) · permiso ver-documento (ver/listar documentos). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/notificaciones.md antes de actuar.
role: finance
module: notificaciones
action: view_doc
---

# mwt-finance-notificaciones-ver-documento

> Skill MCP enfocado: **Finance** · **Notificaciones** · permiso **ver-documento** (ver/listar documentos).

## Propósito
Operar el módulo **Notificaciones** (`notificaciones`) con la acción **ver-documento** (ver/listar documentos) usando SOLO
las tools MCP que el rol **Finance** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Finance** → Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Notificaciones
```
     Gestionar reglas de aviso internas.
```
> Anti-patrones:
     - (sin anti-patrones)


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- (sin notas específicas)

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **ver-documento** sobre **Notificaciones**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/notificaciones.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Notificaciones.jsx`
- Backend:
  - `backend/apps/notifications/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó ver/listar documentos (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
