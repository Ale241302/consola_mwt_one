# Contrato · módulo `finanzas` — Finanzas

- **Categoría:** FINANCIERO
- **Descripción:** Rentabilidad interna, comisiones, margen y devengo. SOLO CEO/Admin.

## Frontend
- `frontend/src/pages/Finanzas.jsx`

## Backend
- `backend/apps/finanzas/`
- `backend/apps/finance/`

## Tools MCP (tool → acción RBAC)
  - `finanzas_overview` — view
  - `finanzas_comisiones` — view
  - `finanzas_commission_by_month` — view
  - `finanzas_margin_scatter` — view
  - `finanzas_cliente` — view

## Flujos operativos

### Finanzas (solo lectura, CEO/Admin)
```
    finanzas_overview()
    finanzas_comisiones() / finanzas_commission_by_month()
    finanzas_margin_scatter() / finanzas_cliente(id)
```
> Anti-patrones:
    - Solo admin/superadmin ven finanzas.view (costos y márgenes).


## Notas / anti-patrones
- Solo admin/superadmin tienen finanzas.view (ver costos y márgenes).
- Tools finanzas_* son de solo lectura.

## Referencia completa de tools (docstrings)

### `finanzas_overview` — view
`def finanzas_overview() -> Any:`

Devuelve `kpis` (comision_total_devengable, comision_devengada, comision_pendiente,
comision_proyectada, margen_total_usd, margen_pct_ponderado, expedientes_count,
expedientes_sin_tasa_count) e `items` (por expediente: commission_rate, total_client,
total_mwt, delta_total, commission_amount, margen_pct, forma_pago, credit_days,
shipment_date, eta, fecha_devengo_esperada, devengo_estado, lines_count, total_qty,

### `finanzas_comisiones` — view
`def finanzas_comisiones(client_id: str | None = None, estado_devengo: str | None = None) -> Any:`

`client_id`: UUID del cliente para filtrar (ej. SONEPAR).
`estado_devengo`: DEVENGADA | DEVENGABLE | VENCIDA | PROYECTADA.
Cada item incluye: display_id, codigo, proforma_codigo, commission_rate,
total_client, total_mwt, delta_total, commission_amount, margen_pct, forma_pago,
credit_days, shipment_date, eta, fecha_devengo_esperada, devengo_estado,

### `finanzas_commission_by_month` — view
`def finanzas_commission_by_month() -> Any:`

Devuelve `results`: [{month, month_label, commission_usd, delta_total_usd,

### `finanzas_margin_scatter` — view
`def finanzas_margin_scatter() -> Any:`

Devuelve `points`: [{id, label (PF · Cliente), projected, real, value}].

### `finanzas_cliente` — view
`def finanzas_cliente(client_id: str) -> Any:`

(sin docstring)

