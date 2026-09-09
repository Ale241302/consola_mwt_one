# Contrato · módulo `dashboard` — Dashboard

- **Categoría:** CORE
- **Descripción:** Vista ejecutiva de rentabilidad, cash flow y logística en vivo.

## Frontend
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/components/dashboard/`

## Backend
- `backend/apps/analytics/`
- `backend/apps/core/`

## Tools MCP (tool → acción RBAC)
  - `generar_grafico` — view
  - `render_tabla` — view
  - `generar_reporte` — view
  - `comparar` — view
  - `exportar_xlsx` — view
  - `exportar_csv` — view

## Flujos operativos

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


## Notas / anti-patrones
- Métricas de resumen vía tools analytics/dashboard (dashboard_resumen, cashflow_chart, etc.).
- Herramientas genéricas de presentación (render_tabla, exportar_csv/xlsx, generar_grafico) caen en módulo dashboard.

## Referencia completa de tools (docstrings)

### `generar_grafico` — view
``

(sin docstring)

### `render_tabla` — view
``

(sin docstring)

### `generar_reporte` — view
``

(sin docstring)

### `comparar` — view
``

(sin docstring)

### `exportar_xlsx` — view
``

(sin docstring)

### `exportar_csv` — view
``

(sin docstring)

