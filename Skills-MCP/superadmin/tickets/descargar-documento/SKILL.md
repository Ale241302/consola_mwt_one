---
name: mwt-superadmin-tickets-descargar-documento
description: Rol Super Admin · módulo Tickets (tickets) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/tickets.md antes de actuar.
role: superadmin
module: tickets
action: download_doc
---

# mwt-superadmin-tickets-descargar-documento

> Skill MCP enfocado: **Super Admin** · **Tickets** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Tickets** (`tickets`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
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

### Tickets de soporte
```
     Crear/seguir tickets de soporte.
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
- El alcance de este skill es **descargar-documento** sobre **Tickets**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/tickets.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Tickets.jsx`
  - `frontend/src/pages/TicketDetail.jsx`
- Backend:
  - `backend/apps/tickets/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
