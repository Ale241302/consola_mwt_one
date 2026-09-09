---
name: mwt-superadmin-clientes-ver-documento
description: Rol Super Admin · módulo Clientes (clientes) · permiso ver-documento (ver/listar documentos). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/clientes.md antes de actuar.
role: superadmin
module: clientes
action: view_doc
---

# mwt-superadmin-clientes-ver-documento

> Skill MCP enfocado: **Super Admin** · **Clientes** · permiso **ver-documento** (ver/listar documentos).

## Propósito
Operar el módulo **Clientes** (`clientes`) con la acción **ver-documento** (ver/listar documentos) usando SOLO
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

### Alta de cliente
```
     cliente_listar(q=razon_social) → ¿existe? → cliente_obtener(id)
     cliente_crear({razon_social, tax_id, pais_iso2, tipo, …})
     [CEO] agrega credito_limit_usd / comision_pct
     cliente_editar(id, {estado:'ACTIVO'|…}) para ajustes
```
> Anti-patrones:
     - codigo_marluvas: 10 dígitos y único entre ACTIVOS (si no → 400).
     - credito_limit_usd/comision_pct son CEO-only; un operador no los setea.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- codigo_marluvas: exactamente 10 dígitos y único entre clientes ACTIVOS (defecto 3 corregido).
- credito_limit_usd / comision_pct son CEO-only.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **ver-documento** sobre **Clientes**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/clientes.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Clientes.jsx`
  - `frontend/src/pages/ClienteDetail.jsx`
  - `frontend/src/pages/ClienteFormView.jsx`
- Backend:
  - `backend/apps/clientes/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó ver/listar documentos (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
