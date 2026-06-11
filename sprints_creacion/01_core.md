# Creación 01 · Core — Usuarios, Roles, Sesión y Permisos

## Objetivo
Identidad y acceso de todo el sistema: login JWT, usuarios con pool de entidades legales, roles RBAC con capabilities, y el aislamiento de visibilidad (R3) que separa ADMIN/CEO de CLIENT_*.

## Base de datos (schema `users` + RBAC)
*   `users.mwtuser`: id uuid, email (unique, index), password_hash, nombre, role_default varchar, `legal_entity_ids uuid[]` (pool de clientes asignados), is_active, timestamps.
*   Tablas RBAC: `roles.role` (id, nombre, descripcion), `roles.capability` (id, code), `roles.role_capability` (role_id, capability_code) — seeds: `register_sap`, `upload_document`, `add_oc_line`, `edit_oc_line_qty`, `edit_oc_line_unit_price`, `delete_oc_line`, etc.
*   SQL: `A4_users_roles.sql`, `A4d_users_legal_entity_ids.sql`, `A5_rbac_redesign.sql` + seed de usuario CEO (`seed_admins`).

## Backend (apps `core`, `users`, `roles`, `storage`)
*   SimpleJWT: `POST /auth/login/`, `/auth/refresh/` (rotación), `GET /auth/me/` (rol + legal_entity_ids FRESCOS), `/auth/logout/`.
*   `MwtJWTAuthentication`: relee el pool por request. Helper `scoped_querysets.filter_by_user_clients(qs, user, client_field, extra_fields)`.
*   `_deny_client_mutation(request, action_label)`: 403 estándar para CLIENT_* en cualquier write.
*   `storage`: signed URLs (PUT/GET, TTL 15 min) contra MinIO.
*   CRUD usuarios: ViewSet completo (list/retrieve/create/update/destroy soft) — ADMIN-only.

## Frontend
*   `Login.jsx` + `PasswordReset.jsx` (públicas) · `AuthContext` (sesión, refresh proactivo cada 25 min, single-flight on-401 en `lib/api.js`) · `RoleContext` (`isAdmin/isClient/can()/user`).
*   **Ver registros**: `/usuarios` — tabla Zebra (nombre, email, rol, entidades, estado) con búsqueda. ADMIN-only.
*   **Crear**: `/usuarios/nuevo` — `UserFormView.jsx`: email, nombre, rol (select), multiselect de entidades legales, password inicial.
*   **Editar**: `/usuarios/:userId` — mismo FormView precargado; cambio de rol/pool.
*   **Eliminar**: modal de confirmación en la fila → `DELETE` (soft) + re-fetch.
*   `/roles` — `RolesPermissions.jsx`: matriz rol × capability con toggles (ADMIN-only). `/perfil` — perfil propio (todos los roles).

## Criterios de aceptación
- [ ] Login/refresh/logout funcionan; 2 fetches simultáneos en 401 producen UN solo refresh.
- [ ] Un CLIENT_* recibe 403 en cualquier mutación y solo ve datos de su pool.
- [ ] CRUD de usuarios completo con soft-delete y validación de email único.
