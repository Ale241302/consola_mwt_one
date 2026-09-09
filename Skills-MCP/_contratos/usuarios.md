# Contrato · módulo `usuarios` — Usuarios

- **Categoría:** ADMINISTRACION
- **Descripción:** Gestión de usuarios, empresas y credenciales MCP.

## Frontend
- `frontend/src/pages/Users.jsx`
- `frontend/src/pages/UserFormView.jsx`
- `frontend/src/pages/RegistroSolicitudes.jsx`

## Backend
- `backend/apps/users/`
- `backend/apps/core/`

## Tools MCP (tool → acción RBAC)
  - (sin tools MCP directas en este módulo)

## Flujos operativos

### Usuarios y onboarding MCP
```
    Registro/reactivación/aprobación de usuarios.
    Emitir credenciales MCP (emit-grant).
```
> Anti-patrones:
    - get_object sin filtro is_active permite gestionar inactivos.


## Notas / anti-patrones
- Onboarding MCP (registro/reactivación/aprobación) vive en core + users.

## Referencia completa de tools (docstrings)
- (sin tools)
