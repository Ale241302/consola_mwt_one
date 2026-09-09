---
name: mwt-compras-analytics-leer
description: Rol Compras · módulo Analytics (analytics) · permiso leer (consultar/listar). Herramientas MCP: cashflow_chart, margen_marcas_chart, aging_chart, exposicion_chart, reporte_cobranza, reporte_expedientes, dashboard_resumen. Lee el contrato en _contratos/analytics.md antes de actuar.
role: compras
module: analytics
action: view
---

# mwt-compras-analytics-leer

> Skill MCP enfocado: **Compras** · **Analytics** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Analytics** (`analytics`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Compras** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Compras** → Proveedores + productos + marcas + sizing (create/update). Resto en lectura.

## Herramientas MCP para esta acción
  - `cashflow_chart`
  - `margen_marcas_chart`
  - `aging_chart`
  - `exposicion_chart`
  - `reporte_cobranza`
  - `reporte_expedientes`
  - `dashboard_resumen`

## Firmas (cómo invocar)
  - `cashflow_chart` → ``
  - `margen_marcas_chart` → ``
  - `aging_chart` → ``
  - `exposicion_chart` → ``
  - `reporte_cobranza` → ``
  - `reporte_expedientes` → ``
  - `dashboard_resumen` → ``


## Flujos del módulo

### Analytics (KPIs, cashflow, margen, aging, exposición)
```
     cashflow_chart(semanas)
     aging_chart() / exposicion_chart() / reporte_cobranza(mes)
     reporte_expedientes(periodo) / dashboard_resumen(periodo)
     margen_marcas_chart() [CEO-only]
```
> Anti-patrones:
     - margen_marcas_chart → 403 para roles no-CEO.
     - aging/exposicion/cobranza requieren analytics.view; genéricas requieren dashboard.view.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- En su mayoría SOLO LECTURA (analytics.view).
- margen_marcas_chart y finanzas_* son CEO/Admin (módulo finanzas).
- El enforcement del backend valida analytics.view para /api/analytics/*.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Analytics**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/analytics.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Finanzas.jsx`
  - `frontend/src/pages/Pipeline.jsx`
- Backend:
  - `backend/apps/analytics/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
