# SPRINTS DE CREACIÓN — Construir la Consola MWT.ONE desde cero

Esta carpeta es el plano de construcción del sistema completo, módulo por módulo. Si el proyecto se reconstruyera desde cero, cada `.md` define **qué crear** en Base de Datos, Backend y Frontend, incluidas las 4 vistas CRUD obligatorias de cada entidad: **Crear, Editar, Eliminar y Ver registros**.

## Convenciones globales (aplican a TODOS los módulos)
*   **Stack**: React 18 + Vite (JSX) · Django 4 + DRF + SimpleJWT · PostgreSQL (pgvector) · Docker Compose.
*   **DB**: un schema por dominio; vinculación lógica por UUID **sin FKs físicas**; cada tabla con `id uuid PK`, `is_active boolean default true` (soft-delete), `created_at/updated_at`. Todo cambio de esquema = módulo idempotente en `backend/sql/NN_modulo.sql` (aplicado una vez por el entrypoint vía `public._applied_sql`). Índice en TODA columna UUID de enlace.
*   **Backend**: una app Django por dominio en `backend/apps/`; modelos `managed=False` (db_table schema-qualified `'schema"."tabla'`); ViewSets DRF con `list/retrieve/create/update/destroy` + acciones custom; mutaciones gateadas con `_deny_client_mutation` (R3); `destroy` = soft-delete (`is_active=false`); listados con queries agregadas (nunca N+1) y scope por rol vía `scoped_querysets`.
*   **Frontend**: una página de listado (tabla Zebra de alta densidad, búsqueda, filtros, paginación), un FormView full-page para **Crear** y **Editar** (misma vista, modo por ruta `/nuevo` y `/:id/editar`), **Eliminar** con modal de confirmación (nunca `window.confirm`), y **Detalle** (`/:id`). Botones con `disabled`+spinner; mutación → re-fetch/invalidate; errores con `<ErrorState/>`; textos vía `tr(lang,...)`; `tabular-nums` en números; cero hex (tokens CSS); página envuelta por el ErrorBoundary de ruta.
*   **CRUD estándar por entidad** (plantilla):
    | Vista | Ruta | Endpoint |
    |---|---|---|
    | Ver registros | `/<modulo>` | `GET /api/<recurso>/` |
    | Ver detalle | `/<modulo>/:id` | `GET /api/<recurso>/{id}/` |
    | Crear | `/<modulo>/nuevo` | `POST /api/<recurso>/` (id generado server-side) |
    | Editar | `/<modulo>/:id/editar` | `PATCH /api/<recurso>/{id}/` |
    | Eliminar | modal en listado/detalle | `DELETE /api/<recurso>/{id}/` (soft) |

## Mapa Sidebar → Sprint (los 12 sprints agrupan por DOMINIO, no por ítem de menú)

| Ítem del sidebar / ruta | Sprint que lo cubre |
|---|---|
| Dashboard | `12_analytics` |
| Expedientes · Cronograma · /expedientes/nuevo (wizard) · Tallas (/tallas) | `03_expedientes` |
| Portal (B2B) | `02_clientes` (vista) + `03_expedientes` (datos) |
| Clientes | `02_clientes` |
| Marcas · Productos · Historial de precios · Proveedores | `08_brands` |
| Finanzas · Cartera (/cobros) · Pagos (/financiero) | `05_cobros` |
| Pipeline (Kanban) | `04_commercial` |
| Movimientos (/transferencias) · NCM (/ncm) | `09_transfers` |
| Nodos | `07_nodos` |
| Inventario · Recepción inbound | `06_inventario` |
| Notificaciones · Templates (/templates) · tickets | `10_communications` |
| AI (/ai · /ai/governance) | `11_ai_hub` |
| users · roles · /perfil · Login/Reset | `01_core` |

## Sub-sprints por módulo (granularidad de ejecución)

Cada sprint de dominio NO se ejecuta de un golpe: se divide en **7 sub-sprints verticales**, cada uno entregable y verificable por sí solo. La numeración es `NN.k` (ej. `03.4 = Expedientes · vista Crear`).

| Sub | Entregable | Definición de terminado |
|---|---|---|
| **NN.1** | **Base de datos** — schema, tablas, índices, seeds (`backend/sql/`) | SQL idempotente aplicado; índices en toda columna UUID de enlace |
| **NN.2** | **Backend API** — modelos, serializers, ViewSet CRUD + permisos R3 | `py_compile` OK; list sin N+1; CLIENT_* bloqueado en writes; smoke con curl |
| **NN.3** | **Ver registros** — listado (tabla Zebra, búsqueda, filtros, paginación) | Carga real desde API; loading/empty/error states; `tabular-nums` |
| **NN.4** | **Crear** — FormView/wizard `/nuevo` | Alta persiste (reload la conserva); validaciones server-side visibles; doble submit bloqueado |
| **NN.5** | **Editar + Eliminar** — `/:id/editar` + modal de borrado | PATCH persiste; soft-delete con confirmación; re-fetch tras mutación |
| **NN.6** | **Ver detalle** — `/:id` con secciones del dominio | Navegación listado↔detalle; datos anidados con guards |
| **NN.7** | **Integración + QA** — cruces con otros módulos, rol CLIENT, ErrorBoundary | Criterios de aceptación del módulo en verde; prueba como cliente B2B |

> **Por qué NO un sprint global por operación** (un sprint "crear" para todo el
> sistema, otro "editar", etc.): cada sprint tocaría los 12 dominios a la vez,
> ningún módulo quedaría terminado/usable hasta el final, y se pierde el
> contexto vertical (quien edita productos necesita lo mismo que quien los
> crea). Las rebanadas verticales por dominio + sub-sprints por vista dan la
> misma granularidad SIN esos costos: 12 × 7 = 84 entregas pequeñas, cada una
> con su "terminado" claro.

## Orden de construcción recomendado
`01_core` → `02_clientes` → `08_brands` (catálogos) → `07_nodos` → `03_expedientes` → `04_commercial` → `06_inventario` → `09_transfers` → `05_cobros` → `12_analytics` → `10_communications` → `11_ai_hub`.
(Core e identidad primero; los catálogos antes que expedientes porque éstos los referencian; analytics al final porque agrega sobre todo lo demás.)
