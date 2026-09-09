# Contrato · módulo `portal` — Portal

- **Categoría:** CORE
- **Descripción:** Portal B2B: catálogo, precios y documentos visibles al cliente final.

## Frontend
- `frontend/src/pages/Portal.jsx`
- `frontend/src/pages/PortalProductDetail.jsx`

## Backend
- `backend/apps/portal/`

## Tools MCP (tool → acción RBAC)
  - (sin tools MCP directas en este módulo)

## Flujos operativos

### Portal B2B
```
    Listar catálogo/precios con scope a legal_entity_id del cliente.
    Descargar documentos del expediente con audience=CLIENT.
```
> Anti-patrones:
    - client_b2b SOLO ve audience=CLIENT y su tenant (R3).


## Notas / anti-patrones
- client_b2b tiene scope estricto a su legal_entity_id.
- El detalle de producto en portal filtra precios por rol.

## Referencia completa de tools (docstrings)
- (sin tools)
