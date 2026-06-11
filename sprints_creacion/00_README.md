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

## Orden de construcción recomendado
`01_core` → `02_clientes` → `08_brands` (catálogos) → `07_nodos` → `03_expedientes` → `04_commercial` → `06_inventario` → `09_transfers` → `05_cobros` → `12_analytics` → `10_communications` → `11_ai_hub`.
(Core e identidad primero; los catálogos antes que expedientes porque éstos los referencian; analytics al final porque agrega sobre todo lo demás.)
