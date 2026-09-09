# Contrato · módulo `roles` — Roles y Permisos

- **Categoría:** ADMINISTRACION
- **Descripción:** Matriz de roles y permisos (RBAC).

## Frontend
- `frontend/src/pages/RolesPermissions.jsx`

## Backend
- `backend/apps/roles/`
- `backend/apps/core/permissions.py`

## Tools MCP (tool → acción RBAC)
  - `mwt_diag_scope` — view

## Flujos operativos

### Roles y permisos (RBAC)
```
    mwt_diag_scope(email) [diagnóstico CEO-only]
    Mantener la matriz core.roles.permissions.
```
> Anti-patrones:
    - El filtrado de tools MCP respeta la matriz REAL (sin wildcard automático).


## Notas / anti-patrones
- mwt_diag_scope mapea a roles.view (diagnóstico de usuarios/permisos).

## Referencia completa de tools (docstrings)

### `mwt_diag_scope` — view
`def mwt_diag_scope(email: str | None = None, user_id: str | None = None) -> Any:`

Dado un `email` (o `user_id`), devuelve qué legal_entities ve, qué rol
tiene, qué tools le están permitidas y cuáles le faltan. Imprescindible
para responder "¿por qué este usuario no ve tal tool?" sin tocar código.

Uso: `mwt_diag_scope(email="alvaro@muitowork.com")`. Solo rol
superadmin/admin/ceo (el gateway propaga el rol; el backend valida que el

