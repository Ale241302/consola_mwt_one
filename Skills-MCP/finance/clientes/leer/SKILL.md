---
name: mwt-finance-clientes-leer
description: Rol Finance · módulo Clientes (clientes) · permiso leer (consultar/listar). Herramientas MCP: cliente_listar, cliente_obtener, cliente_subsidiarias, cliente_kpis_pool. Lee el contrato en _contratos/clientes.md antes de actuar.
role: finance
module: clientes
action: view
---

# mwt-finance-clientes-leer

> Skill MCP enfocado: **Finance** · **Clientes** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Clientes** (`clientes`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Finance** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Finance** → Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.

## Herramientas MCP para esta acción
  - `cliente_listar` — (true/false/all), tipo, estado, segmento, pais (ISO-2), canal.
  - `cliente_obtener`
  - `cliente_subsidiarias` — Lista las subsidiarias de un cliente padre.
  - `cliente_kpis_pool` — KPIs consolidados del pool de crédito (padre + subsidiarias).

## Firmas (cómo invocar)
  - `cliente_listar` → `def cliente_listar( q: str | None = None, is_parent: str | None = None, tipo: str | None = None, estado: str | None = None, segmento: str | None = None, pais: str | None = None, canal: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`
  - `cliente_obtener` → `def cliente_obtener(cliente_id: str, campos: str | None = None) -> Any:`
  - `cliente_subsidiarias` → `def cliente_subsidiarias(cliente_id: str) -> Any:`
  - `cliente_kpis_pool` → `def cliente_kpis_pool(cliente_id: str) -> Any:`


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
- El alcance de este skill es **leer** sobre **Clientes**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/clientes.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Clientes.jsx`
  - `frontend/src/pages/ClienteDetail.jsx`
  - `frontend/src/pages/ClienteFormView.jsx`
- Backend:
  - `backend/apps/clientes/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
