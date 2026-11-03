# Rol `agente_mcp` — ACTIVADO (2026-11-03)

> Estado: **ACTIVO en producción.** Creado desde `/roles` (API de la misma
> consola), matriz guardada y sincronizada a `core.roles`. Usuario del agente
> creado desde `/usuarios`.

## 0. Resumen de lo que quedó activo

| Qué | Valor |
|---|---|
| Rol | `agente_mcp` — "Agente MCP (operación)" · `is_system=false` |
| Matriz | 21 módulos × 6 acciones (sin `delete`) = **121 permisos** |
| Tabla que lee el MCP | `core.roles.permissions` (21 módulos / 121 acciones / 0 `delete`) |
| Usuario | `agente@muitowork.com` — "Agente MCP" · rol `agente_mcp` · activo |
| IdP | existe y está activo en Authentik (username `agente`) |
| Tools visibles en el MCP | **177** de 182 (se ocultan las 4 de borrado + `mwt_diag_scope`) |

La contraseña inicial se entregó por canal directo (no se guarda en este repo).
Recomendación: cambiarla en `/usuarios` → Reset tras el primer uso.

## 1. Problema

Hoy el conector MCP entra con el rol del usuario que se autentica. Cuando quien
conecta es `alvaro@muitowork.com` o `alejandro@muitowork.com` (Admin/CEO), el
agente hereda **todo**, incluido:

- `*.delete` (borrar expedientes, documentos, líneas, transferencias, pagos…)
- `usuarios.*` y `roles.*` (administración de usuarios y de la matriz RBAC)
- `finanzas.*` de escritura (saldo inicial, metas, comisiones)

Un error del modelo (o un prompt malicioso dentro de un PDF/OCR) podía llegar a
un borrado o a un cambio de permisos. El rol nuevo quita el poder destructivo y
de administración, no el trabajo diario.

## 2. Diseño

Rol `agente_mcp` = todo lo de Admin (CEO) **menos**:

| Se excluye | Motivo |
|---|---|
| `*.delete` en todos los módulos | el agente no borra; si hay que borrar, lo hace una persona |
| `usuarios.*` | administración de usuarios |
| `roles.*` | administración de la matriz RBAC (incluye `mwt_diag_scope`) |
| `builder.delete` | plantillas/artefactos del Builder |

Se conserva lectura + escritura operativa en 20 módulos, y solo lectura en
`analytics` (charts/reportes, no se escribe nada).

### Visibilidad de datos (cambio de código necesario)

`agente_mcp` no es `admin`, así que por defecto caía en
`scoped_querysets.BYPASS_ROLES` = sólo `(superadmin, admin)` → un usuario
no-bypass con `legal_entity_ids=[]` recibe `qs.none()` y **no vería ningún
expediente**. Se agregó `agente_mcp` a:

- `backend/apps/core/scoped_querysets.py` · `BYPASS_ROLES` (scope de datos)
- `backend/apps/core/permissions.py` · `CEO_ADMIN_ROLES` (analytics CEO)
- `backend/apps/finanzas/permissions.py` · `_CEO_ROLES` (módulo finanzas)
- `mcp_server/mwt_mcp/redact.py` · `_CEO_ADMIN_ROLES` (sin redacción de costos/márgenes)

La **restricción** sigue viviendo en la matriz RBAC (`core.roles.permissions`):
no hay wildcard para este rol.

## 3. Matriz (literal guardada)

**Regla:** 20 módulos con las 6 acciones `create, update, view, upload_doc,
download_doc, view_doc` (sin `delete`) + `analytics` solo `view`.

Módulos: `analytics, builder, cartera, clientes, correo, dashboard, expedientes,
finanzas, historial-precios, inventario, marcas, nodos, notificaciones, pagos,
portal, productos, sizing, storage, tareas, tickets, transferencias`.

```json
{
  "modules": ["analytics","builder","cartera","clientes","correo","dashboard",
              "expedientes","finanzas","historial-precios","inventario","marcas",
              "nodos","notificaciones","pagos","portal","productos","sizing",
              "storage","tareas","tickets","transferencias"],
  "actions": [
    "analytics.view",
    "builder.create","builder.update","builder.view","builder.upload_doc","builder.download_doc","builder.view_doc",
    "cartera.create","cartera.update","cartera.view","cartera.upload_doc","cartera.download_doc","cartera.view_doc",
    "clientes.create","clientes.update","clientes.view","clientes.upload_doc","clientes.download_doc","clientes.view_doc",
    "correo.create","correo.update","correo.view","correo.upload_doc","correo.download_doc","correo.view_doc",
    "dashboard.create","dashboard.update","dashboard.view","dashboard.upload_doc","dashboard.download_doc","dashboard.view_doc",
    "expedientes.create","expedientes.update","expedientes.view","expedientes.upload_doc","expedientes.download_doc","expedientes.view_doc",
    "finanzas.create","finanzas.update","finanzas.view","finanzas.upload_doc","finanzas.download_doc","finanzas.view_doc",
    "historial-precios.create","historial-precios.update","historial-precios.view","historial-precios.upload_doc","historial-precios.download_doc","historial-precios.view_doc",
    "inventario.create","inventario.update","inventario.view","inventario.upload_doc","inventario.download_doc","inventario.view_doc",
    "marcas.create","marcas.update","marcas.view","marcas.upload_doc","marcas.download_doc","marcas.view_doc",
    "nodos.create","nodos.update","nodos.view","nodos.upload_doc","nodos.download_doc","nodos.view_doc",
    "notificaciones.create","notificaciones.update","notificaciones.view","notificaciones.upload_doc","notificaciones.download_doc","notificaciones.view_doc",
    "pagos.create","pagos.update","pagos.view","pagos.upload_doc","pagos.download_doc","pagos.view_doc",
    "portal.create","portal.update","portal.view","portal.upload_doc","portal.download_doc","portal.view_doc",
    "productos.create","productos.update","productos.view","productos.upload_doc","productos.download_doc","productos.view_doc",
    "sizing.create","sizing.update","sizing.view","sizing.upload_doc","sizing.download_doc","sizing.view_doc",
    "storage.create","storage.update","storage.view","storage.upload_doc","storage.download_doc","storage.view_doc",
    "tareas.create","tareas.update","tareas.view","tareas.upload_doc","tareas.download_doc","tareas.view_doc",
    "tickets.create","tickets.update","tickets.view","tickets.upload_doc","tickets.download_doc","tickets.view_doc",
    "transferencias.create","transferencias.update","transferencias.view","transferencias.upload_doc","transferencias.download_doc","transferencias.view_doc"
  ]
}
```

## 4. Dos bugs de plataforma corregidos en el camino

1. **Guardar la matriz de un rol NUEVO fallaba con 500**
   (`null value in column "id" of relation "role_permission"`): el
   `update_or_create` intentaba INSERTAR con PK NULL. Corregido en
   `backend/apps/roles/views.py` (get/create explícito con `uuid4`).

2. **Un rol nuevo nunca llegaba a `core.roles`**: la función
   `users.sync_role_permissions_to_core()` sólo hacía `UPDATE`, así que el rol
   vivía en `users.role_cat`/`users.role_permission` pero el JWT del MCP, el
   enforcement y el filtrado de tools leían `core.roles` → **fail-closed: 0
   tools**. Corregido en `backend/sql/M5_role_sync_upsert_core.sql` (INSERT si
   falta la fila + backfill de los roles existentes).

## 5. Pruebas de aceptación (2026-11-03)

| Prueba | Resultado |
|---|---|
| Login del agente | ✅ 200 · rol en el JWT = `agente_mcp` |
| `POST /api/auth/mcp-token/` para el agente | ✅ 21 módulos · 121 acciones · **0 con `.delete`** |
| `mwt_whoami` por el MCP | ✅ rol `agente_mcp` |
| Tools visibles en el MCP | ✅ 177 (antes 182); ninguna de borrado ni `mwt_diag_scope` |
| Borrado de prueba por el MCP (`documento_eliminar`) | ✅ `TOOL_NOT_ALLOWED` |
| Borrado por API directa (`DELETE /api/documentos/…`) | ✅ 403 |
| Alta de usuario por API (`POST /api/users/`) | ✅ 403 |
| Roles/matriz por API (`GET/PATCH /api/roles|permissions`) | ✅ 403 |
| Consultas normales (`expediente_listar`, `expediente_obtener`, `finanzas_overview`) | ✅ 200 y datos visibles |

## 6. Decisión pendiente (sin bloquear)

`transferencia_cancelar` y `expediente_anular` requieren `*.update` y hoy
**siguen permitidas** para el agente. Si se quieren reservar solo a humanos hay
que gatearlas en la tool (`TOOL_MODULES` → acción inexistente o un guard
explícito). No se cambió nada acá.
