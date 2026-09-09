# Contrato · módulo `marcas` — Marcas

- **Categoría:** COMERCIAL
- **Descripción:** Marcas, pricing por marca/cliente y bandas de precio.

## Frontend
- `frontend/src/pages/Brands.jsx`
- `frontend/src/pages/BrandDetail.jsx`
- `frontend/src/pages/BrandClientPricingForm.jsx`

## Backend
- `backend/apps/brands/`

## Tools MCP (tool → acción RBAC)
  - `marca_listar` — view

## Flujos operativos

### Marcas
```
    marca_listar() → marca_id para productos/pricing
```
> Anti-patrones:
    - marca_listar es solo lectura (marcas.view).


## Notas / anti-patrones
- Tool marca_listar es de solo lectura (marcas.view).

## Referencia completa de tools (docstrings)

### `marca_listar` — view
`def marca_listar(q: str | None = None) -> Any:`

(sin docstring)

