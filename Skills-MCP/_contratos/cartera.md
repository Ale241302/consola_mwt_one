# Contrato · módulo `cartera` — Cartera

- **Categoría:** COMUNICACIONES
- **Descripción:** Cobranza, saldos por cobrar y deudas por cliente.

## Frontend
- `frontend/src/pages/Cobros.jsx`
- `frontend/src/components/cobros/`

## Backend
- `backend/apps/cobros/`

## Tools MCP (tool → acción RBAC)
  - (sin tools MCP directas en este módulo)

## Flujos operativos

### Cartera / cobranza
```
    reporte_cobranza(mes) [aging]
    exposicion_chart() / aging_chart()
```
> Anti-patrones:
    - cartera.view es de lectura; las mutaciones de cobro viven en pagos/cobros.


## Notas / anti-patrones
- reporte_cobranza lee analytics/aging (analytics.view).

## Referencia completa de tools (docstrings)
- (sin tools)
