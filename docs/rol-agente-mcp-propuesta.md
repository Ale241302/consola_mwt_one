# Rol `agente_mcp` — propuesta para aprobación del CEO

> Estado: **PROPUESTA — no creada en la base de datos.** Se activa solo con la
> aprobación explícita (ver §5). Fecha: 2026-11-03.

## 1. Problema

Hoy el conector MCP entra con el rol del usuario que se autentica. Cuando quien
conecta es `alvaro@muitowork.com` o `alejandro@muitowork.com` (Admin/CEO), el
agente hereda **todo**, incluido:

- `*.delete` (borrar expedientes, documentos, líneas, transferencias, pagos…)
- `usuarios.*` y `roles.*` (administración de usuarios y de la matriz RBAC)
- `finanzas.*` de escritura (saldo inicial, metas, comisiones)

Un error del modelo (o un prompt malicioso dentro de un PDF/OCR) puede llegar a
un borrado o a un cambio de permisos. El objetivo del rol nuevo es **quitar el
poder destructivo y de administración**, no el trabajo diario.

## 2. Diseño

Rol nuevo: `agente_mcp` — nombre visible "Agente MCP (operación)", `is_system=false`.

Regla base: **todo lo de Admin (CEO) MENOS**:

| Se excluye | Motivo |
|---|---|
| `*.delete` en todos los módulos | el agente no borra; si hay que borrar, lo hace una persona |
| `usuarios.*` | administración de usuarios |
| `roles.*` | administración de la matriz RBAC (incluye `mwt_diag_scope`) |
| `builder.delete`, `builder.artefacto_eliminar` | plantillas/artefactos del Builder |
| `expedientes.anular`, `expediente_recrear` vía MCP | requieren `expedientes.update`, se restringen en la tool (ver §4) |

Se conserva (lectura + escritura operativa) en los 21 módulos restantes:

`analytics`, `builder`, `cartera`, `clientes`, `correo`, `dashboard`,
`expedientes`, `finanzas`, `historial-precios`, `inventario`, `marcas`, `nodos`,
`notificaciones`, `pagos`, `portal`, `productos`, `sizing`, `storage`, `tareas`,
`tickets`, `transferencias`.

Acciones por módulo: `view`, `create`, `update`, `upload_doc`, `download_doc`,
`view_doc` (sin `delete`).

## 3. Matriz propuesta (literal para copiar en /roles)

**Regla:** los 21 módulos de abajo, cada uno con las **6 acciones**
`create, update, view, upload_doc, download_doc, view_doc` (sin `delete`).

Módulos (21): `analytics, builder, cartera, clientes, correo, dashboard,
expedientes, finanzas, historial-precios, inventario, marcas, nodos,
notificaciones, pagos, portal, productos, sizing, storage, tareas, tickets,
transferencias`.

Equivale a 21 × 6 = **126 pares** `modulo.accion`. JSON exacto para el campo
`permissions` de `core.roles`:

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

> `analytics` va solo con `view`: son charts/reportes, no se escribe nada.

## 4. Efecto sobre las 182 tools del MCP

- Se mantienen todas las de lectura y las de operación (crear/editar/subir).
- **Desaparecen** del listado (RBAC por matriz):
  `expediente_eliminar`, `documento_eliminar`, `transferencia_cancelar*`,
  `transfer_costo_eliminar`, `builder_artefacto_eliminar`, `mwt_diag_scope`,
  `mwt_audit_write_registry`.
  (`*` cancelar transferencia requiere `update`; se puede excluir además en la
  tool si querés que el agente no cancele nunca sin humano.)
- `mwt_whoami` debe mostrar `rol: agente_mcp`.

## 5. Activación (solo tras aprobación)

1. Crear el rol en `/roles` → "Nuevo rol" con slug `agente_mcp` y la matriz de §3.
2. Asignar `agente_mcp` al usuario/servicio del conector (usuario dedicado
   `agente@muitowork.com`, no la cuenta personal del CEO).
3. Probar: `mwt_whoami` → `agente_mcp`; `documento_eliminar` → rechazado;
   `expediente_obtener` / `documento_listar` → OK.

> Decisión pendiente del CEO: ¿el agente puede **cancelar/anular** operaciones
> (transferencia_cancelar, expediente_anular) o esas también quedan solo para
> humanos? Por defecto la propuesta las deja **fuera**.
