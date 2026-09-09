# Contrato · módulo `analytics` — Analytics

- **Categoría:** DASHBOARD
- **Descripción:** KPIs, cash flow, margen por marca, aging y exposición de clientes.

## Frontend
- `frontend/src/pages/Finanzas.jsx`
- `frontend/src/pages/Pipeline.jsx`

## Backend
- `backend/apps/analytics/`

## Tools MCP (tool → acción RBAC)
  - `cashflow_chart` — view
  - `margen_marcas_chart` — view
  - `aging_chart` — view
  - `exposicion_chart` — view
  - `reporte_cobranza` — view
  - `reporte_expedientes` — view
  - `dashboard_resumen` — view

## Flujos operativos

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


## Notas / anti-patrones
- En su mayoría SOLO LECTURA (analytics.view).
- margen_marcas_chart y finanzas_* son CEO/Admin (módulo finanzas).
- El enforcement del backend valida analytics.view para /api/analytics/*.

## Referencia completa de tools (docstrings)

### `cashflow_chart` — view
``

(sin docstring)

### `margen_marcas_chart` — view
``

(sin docstring)

### `aging_chart` — view
``

(sin docstring)

### `exposicion_chart` — view
``

(sin docstring)

### `reporte_cobranza` — view
``

(sin docstring)

### `reporte_expedientes` — view
``

(sin docstring)

### `dashboard_resumen` — view
``

(sin docstring)

