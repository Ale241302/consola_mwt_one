---
name: mwt-superadmin-dashboard-descargar-documento
description: Rol Super Admin · módulo Dashboard (dashboard) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/dashboard.md antes de actuar.
role: superadmin
module: dashboard
action: download_doc
---

# mwt-superadmin-dashboard-descargar-documento

> Skill MCP enfocado: **Super Admin** · **Dashboard** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Dashboard** (`dashboard`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
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

### Presentación (gráficos/tablas/reportes/exportación)
```
     dashboard_resumen(periodo) [panorama completo]
     generar_grafico(tipo, data, opciones) / render_tabla(columnas, filas)
     generar_reporte(titulo, secciones, formato) → URL TTL 15min
     exportar_xlsx(nombre, hojas) / exportar_csv(...)
```
> Anti-patrones:
     - Imágenes/tablas: URL firmada TTL 5min; reportes/export: TTL 15min.
     - Los datos se redactan por rol ANTES de renderizar (nada filtra costo/margen no visible).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Métricas de resumen vía tools analytics/dashboard (dashboard_resumen, cashflow_chart, etc.).
- Herramientas genéricas de presentación (render_tabla, exportar_csv/xlsx, generar_grafico) caen en módulo dashboard.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **descargar-documento** sobre **Dashboard**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/dashboard.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Dashboard.jsx`
  - `frontend/src/components/dashboard/`
- Backend:
  - `backend/apps/analytics/`
  - `backend/apps/core/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
