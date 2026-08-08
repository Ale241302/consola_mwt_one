# Contexto para Fugu — consola_mwt_one

> **Propósito:** paquete de contexto para alimentar a `codex -p fugu` (o equivalente) y que Fugu + Kimi Code co-diseñen el plan de desarrollo para remediar la auditoría `auditoria_mwt_mcp_consola.md`.
> **Última actualización:** 7-ago-2026 · repo `consola_mwt_one` · commit `fef45e8`.

---

## 1. Qué es este proyecto

`consola_mwt_one` es el monorepo de **MWT.ONE**, una plataforma de gestión de comercio internacional (importaciones, expedientes, órdenes de compra, logística, finanzas, nodos de inventario y portal cliente B2B).

**Superficies principales:**

| Superficie | Tecnología | Ubicación en repo | Rol |
|---|---|---|---|
| **Backend API** | Django 4 + DRF, modelos `managed=False`, SQL-first | `backend/` | Fuente de verdad de datos y lógica de negocio |
| **Base de datos** | PostgreSQL 15, sin migraciones Django | `database/`, `backend/sql/` | Esquema y datos controlados por DDL versionado |
| **Frontend** | React 18 + Vite, JavaScript/JSX | `frontend/` | Consola operativa, CEO, portal cliente |
| **MCP server** | FastMCP / Python, 99 `@mcp.tool()` | `mcp_server/` | Interfaz agente → API REST |
| **MCP gateway** | ContextForge + Pocket-ID/Authentik (OAuth 2.1) | `mcp-gateway/` | Auth gateway para Claude/Cowork/etc. |
| **Harness multi-agente** | Propuesta v0 en repo | `harness/` | Bucle REPL agnóstico de CLI (Claude, Gemini, Kimi) |
| **Infra** | Docker Compose, nginx, MinIO, Redis | `infra/`, scripts `scripts/` | Deploy en VPS `187.77.218.102` |

---

## 2. Arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTES                                │
│  Consola React (CEO/Admin/Operador)  │  Portal Cliente (B2B)    │
│  https://consola.mwt.one            │  https://consola.mwt.one/portal│
└─────────────┬───────────────────────┬─────────────────────────────┘
              │                       │
              ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  nginx (Cloudflare) → Django DRF  /api/*                        │
│  backend/apps/{core,portal,expedientes,clientes,productos,      │
│               inventario,nodos,finance,storage,roles,ai_hub,...}│
│  JWT custom (core.users) + RBAC por `required_module`           │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL  │  Redis  │  MinIO (object storage)  │  Celery   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MCP gateway (Pocket-ID / Authentik) → ContextForge             │
│  → MCP server (mwt_mcp) → llamadas HTTP a /api/*              │
└─────────────────────────────────────────────────────────────────┘
```

**Reglas duras del stack (de `CLAUDE.md` / `AGENTS.md`):**
- **SQL-first:** no `makemigrations`/`migrate`. Todo cambio de esquema en `database/*.sql` o `backend/sql/*.sql`.
- Modelos `managed=False`, **sin FKs físicas**, relaciones por UUID.
- **RBAC por `required_module`**, soft-delete, JWT custom con `user_uuid` claim.
- Frontend: cero hex hardcodeados, `tabular-nums`, `@media print`, aislamiento `CEO_ONLY` vs `CLIENT_*`.
- API centralizada vía `frontend/src/lib/api.js`.
- El harness define **fuentes canónicas** en `harness/canonical/` y transpila a cada CLI.

---

## 3. Estado actual de la remediación (Ola 0 en progreso)

### 3.1 Fixes de storage ya aplicados y desplegados

| Commit | Qué hace |
|---|---|
| `095fbb2` | Proxy stream por HTTPS para evitar mixed-content `ERR_SSL_PROTOCOL_ERROR` de MinIO |
| `755ff82` | Activos públicos (`producto/`, `cliente/`) sirven sin auth para `<img>`/`<iframe>` |
| `782ed0d` | Exime throttle en download público |
| `b1ff8c1` | Autenticación por `?token=` para previews de archivos privados |
| `3bf8874` | `MwtJWTAuthentication` para `?token=` (claim `user_uuid`) |
| `65e3fd8` | Normaliza URLs firmadas de MinIO a keys relativas + proxy HTTPS universal |
| `3688a18` | Schema correcto para tabla `marca` en normalización de keys |
| `a215811` | Endpoints devuelven proxy URL same-origin en vez de signed MinIO HTTP |
| `fef45e8` | `storageApi.downloadUrl()` añade `?token=` para activos privados (artifact-field, docs) |
| **(en working tree)** | `DynamicField.jsx` ahora normaliza también el fallback `v.url` legacy por `storageUrl()` |

**Cambios técnicos clave:**
- `backend/apps/storage/views.py`: endpoint `download` con `AllowAny`, autentica por `?token=`, distingue `STORAGE_PUBLIC_KEY_PREFIXES`, stremea desde MinIO por HTTPS.
- `backend/apps/storage/helpers.py`: `normalize_storage_key()` y `proxy_download_url()`.
- `backend/apps/storage/serializers.py`: `StorageNormalizeMixin` aplicado a productos, clientes, marcas, documentos.
- `frontend/src/lib/api.js`: `storageUrl()` enruta a `/api/storage/download/` y añade `?token=` para privados.
- `frontend/src/components/expedientes/builderArtifacts/DynamicField.jsx`: file picker usa `storageApi.downloadUrl()` y fallback a `storageUrl(v.url)`.

### 3.2 Problemas aún abiertos (P0/P1/P2/P3 de la auditoría)

Ver **plan detallado** en `auditoria_mwt_mcp_consola_plan_fugu.md`. Resumen:

**P0 — Bloqueantes (esta semana):**
1. `DJANGO_SECRET_KEY` y JWT admin de 2126 en claro en historial git.
2. `/api/storage/download/` sigue `AllowAny` con validación mínima; keys de productos predecibles; credenciales MinIO hardcodeadas.
3. Tenant scope no aplicado en retrieve/update/destroy de expedientes/OCs/documentos/nodos.
4. `_resolve_client_ids` fail-open cuando `legal_entity_ids` viene vacío.
5. `/api/mwt-users/` y `apps/nodos` sin gate administrativo.
6. `DEBUG=1`, `SECRET_KEY` default, sin rate-limit en login, passwords SHA-256 sin salt.

**P1 — Que el dato sea confiable:**
- parseo numérico local (`26.924,66` → `NaN`) en `DynamicField.jsx`.
- fallback silencioso a mocks (`mockData`) en producción.
- `ServiceToken` con scopes, expiración, revocación.
- Poblar `required_module` y unificar store RBAC.
- Validaciones de coherencia backend.

**P2 — MCP seguro y barato:**
- Partir en 3 MCPs por dominio (comercial, logística, finanzas).
- Token exchange gateway→backend con identidad real.
- Pydantic para contratos opacos, paginación, tools de descarga, editar/publicar artefactos, idempotencia, `@write_tool`, `mwt_health`.

**P3 — Experiencia/performance:**
- Limpieza de código muerto, code splitting, a11y, React Query, virtualizar tablas, partir monolitos >1500 LOC, completar portal cliente.

---

## 4. Fuentes de verdad del repo

| Documento | Para qué sirve |
|---|---|
| `auditoria_mwt_mcp_consola.md` | Hallazgos de seguridad, MCP, frontend, backend (6-ago-2026) |
| `auditoria_mwt_mcp_consola_plan_fugu.md` | Plan de ejecución por 4 olas (Fugu, 7-ago-2026) |
| `harness/ARCHITECTURE.md` | Diseño del bucle multi-agente |
| `AGENTS.md` (raíz) | Reglas de proyecto, memoria reciente, contexto de sesión |
| `CLAUDE.md` (si existe) | Reglas duras originales para Claude Code |
| `backend/config/settings.py` | Configuración Django, secretos, MinIO, DB |
| `frontend/src/lib/api.js` | Wrapper universal de API + helper `storageUrl()` |
| `mcp_server/mwt_mcp/server.py` | 99 tools MCP |

---

## 5. Preguntas clave para Fugu

1. **Prioridad de la Ola 0:** ¿Ejecutamos primero la rotación de secretos + `git filter-repo` (0.1) antes de cualquier otro cambio, o es seguro cerrar storage/tenant scoping en paralelo y luego rotar?
2. **Storage P0:** ¿Implementamos `302` a signed URL S3 de 5 minutos (recomendado en auditoría) o mantenemos el proxy stream HTTPS actual? El proxy funciona, pero consume ancho de banda del VPS.
3. **RBAC:** ¿Cuál es la fuente de verdad correcta — `core.roles.permissions` (usada por enforcement) o `users.role_permission` (escrita por UI)? ¿Migrar UI a `core.roles`?
4. **ServiceToken:** ¿Diseñamos tabla `core.service_tokens` con scopes[] y client_ids[] ya en la Ola 1, o un quick-win de denylist `jti` en Ola 0 es suficiente?
5. **MCP split:** ¿Partimos en 3 servidores MCP ahora (Ola 2) o primero endurecemos el gateway/token exchange (Ola 1.11 + 2.15)?
6. **Frontend mocks:** ¿Eliminamos `mockData` fallback en producción de una vez o por dominio? ¿Riesgo de que el CEO vea datos vacíos durante deploys?
7. **Harness:** ¿Cuál es la fase mínima viable del harness que debería existir antes de que Fugu toque código automáticamente? ( sync canónico → `.claude/` )

---

## 6. Cómo invocar Fugu con este contexto

```bash
# 1. Asegurar que Fugu tenga permisos de escritura en el workspace.
codex -p fugu --workspace-write

# 2. Pasarle el contexto (resumen + plan completo + auditoría).
#    Idealmente abrir los 3 documentos como contexto o adjuntarlos al prompt.

# 3. Prompt sugerido:
# "Lee este proyecto (consola_mwt_one). Tu objetivo es revisar y refinar el plan
#  en auditoria_mwt_mcp_consola_plan_fugu.md. Compara cada ítem con el código real
#  de backend/, frontend/, mcp_server/, mcp-gateway/, database/ y harness/.
#  Devuelve un plan ajustado por olas con: archivos exactos, cambios concretos,
#  dependencias, riesgos y criterios de salida. Marca lo que ya está resuelto
#  y lo que necesita trabajo adicional."
```

---

## 7. Notas de Kimi Code (agente actual)

- Se acaba de corregir `frontend/src/components/expedientes/builderArtifacts/DynamicField.jsx` para que el fallback a `value.url` legacy también pase por `storageUrl(v.url, { forceToken: true })`. Esto cubre archivos de artefactos subidos antes del fix `fef45e8` que solo tenían `url` sin `?token=`.
- El deploy más reciente (`bash /opt/consola-mwt-one/scripts/redeploy_vps.sh`) terminó healthy, pero el usuario reporta que aún no ve archivos de artefactos. Posibles causas: (a) build de frontend cacheado / no incluye el último commit, (b) archivos legacy sin `key` en la BD. El fix en working tree ataca (b); para (a) se necesita `git push` + redeploy + hard refresh.
- El plan Fugu existente (`auditoria_mwt_mcp_consola_plan_fugu.md`) ya es sólido. La tarea conjunta es validarlo contra el código actual y priorizar la Ola 0.
