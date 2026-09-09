# Contrato · módulo `historial-precios` — Historial de precios

- **Categoría:** COMERCIAL
- **Descripción:** Histórico de precios de productos por banda/cliente.

## Frontend
- `frontend/src/pages/PriceHistory.jsx`

## Backend
- `backend/apps/commercial/`
- `backend/apps/productos/`

## Tools MCP (tool → acción RBAC)
  - (sin tools MCP directas en este módulo)

## Flujos operativos

### Historial de precios
```
    Consultar PriceHistory por producto/banda.
    lineas_actualizar_precios actualiza precios de líneas (expedientes.update).
```
> Anti-patrones:
    - El precio MWT vs precio cliente se leen por separado (unit_price_mwt / unit_price_client).


## Notas / anti-patrones
- lineas_actualizar_precios mapea a expedientes.update (no a este módulo).

## Referencia completa de tools (docstrings)
- (sin tools)
