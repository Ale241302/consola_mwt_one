# Plan de desarrollo — Remediación de auditoría MCP + Consola MWT.ONE

> **Fuente:** `auditoria_mwt_mcp_consola.md` (commit `95e513f`, 6-ago-2026)
> **Autor del plan:** `fugu` (Sakana AI) · 7-ago-2026
> **Estado del código:** este documento NO modifica código. Es un plan de ejecución priorizado y accionable.
> **Verificación:** todos los hallazgos P0 y los principales P1/P2/P3 fueron confirmados leyendo el código real del repo (ver §8).

---

## 0. Cómo leer este plan

El trabajo se organiza en **4 olas**:

| Ola | Objetivo | Ventana | Naturaleza |
|-----|----------|---------|------------|
| **Ola 0** | Cerrar los 3 P0 (auth, secretos, RBAC/tenant) | Esta semana — no negociable | Quick wins + trabajo estructural urgente |
| **Ola 1** | Que el dato sea confiable | 2–4 semanas | Estructural |
| **Ola 2** | Que el MCP sea seguro y barato | 1–2 meses | Estructural |
| **Ola 3** | Experiencia, rendimiento y mantenibilidad | Continuo | Mejora incremental |

**Escala de esfuerzo:** XS (<½ día) · S (½–1 día) · M (2–3 días) · L (1 semana) · XL (2+ semanas).

**Restricciones duras del stack:**
- SQL-first: **sin migraciones Django** (`MIGRATION_MODULES = _DisableMigrations()`). Todo cambio de esquema se hace en `database/*.sql` o `backend/sql/*.sql` y se aplica manualmente/por script.
- Modelos `managed = False`, **sin FKs físicas**, relaciones por UUID.
- RBAC por `required_module`, soft-delete y JWT custom (`core.users` + RBAC).
- Frontend: cero hex hardcodeados, `tabular-nums`, `@media print`, aislamiento `CEO_ONLY` vs `CLIENT_*`, API vía `lib/api.js`.
- Alinear cambios con `harness/canonical/AGENTS.md`; `canonical` continúa como fuente de verdad.

**Aclaración sobre 1.2 y 2.3:** `mcp_server` y `mcp-gateway` ya no usan el token admin de larga vida. El gateway valida por Authentik/OAuth, propaga `X-Forwarded-User-*` y el MCP pide un JWT de usuario a `POST /api/auth/mcp-token/`. Por ello el plan trata el token exchange como **endurecimiento y verificación**, no como construcción desde cero. El modelo `ServiceToken` sigue siendo necesario para otros servicios, scopes, expiración y revocación.

---

## 1. Resumen ejecutivo

```
OLA 0 ─  1 Rotar secretos + purgar git + borrar test_key         [S]
       ─  2 Cerrar /api/storage/download/                        [M]
       ─  3 Rotar MinIO + sacar credenciales + TLS               [S]
       ─  4 Scope tenant en retrieve/update/destroy              [M]
       ─  5 Fail-closed en _resolve_client_ids                   [S]
       ─  6 Gate admin en /api/mwt-users/ y apps/nodos           [S]
       ─  7 Defaults fail-safe                                   [XS]
       ─  8 Throttle login + hashing PBKDF2/Argon2               [M]

OLA 1 ─  9 parseLocaleNumber + rechazo NaN + migración datos     [M]
       ─ 10 Eliminar fallback a mocks en producción              [M]
       ─ 11 ServiceToken + endurecer mcp-token                   [L]
       ─ 12 Poblar required_module + unificar store RBAC         [L]
       ─ 13 Validaciones de coherencia backend                   [M]

OLA 2 ─ 14 Partir en 3 MCPs por dominio                          [L]
       ─ 15 Formalizar token exchange gateway→backend            [M]
       ─ 16 Pydantic para los dict opacos                        [L]
       ─ 17 Paginación + proyección en listados                  [M]
       ─ 18 Tools de descarga con URL firmada                    [S]
       ─ 19 Tools de edición/publicación de artefactos           [S]
       ─ 20 Idempotencia + mcp_audit                             [M]
       ─ 21 Decorador @write_tool                                [S]
       ─ 22 mwt_health                                           [XS]

OLA 3 ─ 23 Limpieza de código muerto y artifacts                 [S]
       ─ 24 React.lazy + xlsx dinámico + sourcemaps              [M]
       ─ 25 Codemod a11y + focus trap                            [M]
       ─ 26 React Query                                          [XL]
       ─ 27 Virtualizar tablas                                   [M]
       ─ 28 Partir monolitos >1500 LOC                           [XL]
       ─ 29 Completar portal cliente                             [M]
```

---

## 2. OLA 0 — Bloqueantes P0

> **Orden recomendado:** 0.1 → 0.3 → 0.7 → (0.2, 0.4, 0.5 y 0.6 en paralelo) → 0.8.
> Ningún cliente externo debe usar MCP o portal antes de cerrar esta ola.

### 0.1 — Rotar secretos filtrados y purgar historial `[S]` `P0`

- **Archivos/artefactos:** `auditor.md`, `solucion_puntos_pendientes.md`, `solucion_puntos_pendientes_costa_rica_muitowork.md`, `solucion_puntos_pendientes_costa_rica_sondel_2019_2025.md`, `test_key`, `test_key.pub`, `.env` de producción e historial git.
- **Cambio concreto:**
  1. Rotar `DJANGO_SECRET_KEY` en producción.
  2. Revocar/rotar el JWT admin con vencimiento en 2126.
  3. Purgar JWT y llaves del historial con `git filter-repo` o BFG; force-push coordinado.
  4. Sustituir los secretos en Markdown por placeholders como `$MWT_MCP_TOKEN`.
  5. Añadir patrones a `.gitignore` y `gitleaks`/`detect-secrets` en pre-commit/CI.
- **Dependencias:** ninguna; ejecutar primero.
- **Riesgos:** rotar `DJANGO_SECRET_KEY` invalida sesiones y JWT. Requiere ventana de mantenimiento y tener probado el flujo OAuth/`mcp-token`. Reescribir git obliga al equipo a re-clonar o realinear ramas.
- **Criterio de salida:** scanner de secretos limpio; `git log -p` sin JWT ni llave privada; producción operativa con el secreto nuevo.

### 0.2 — Cerrar `/api/storage/download/` `[M]` `P0`

- **Archivos:** `backend/apps/storage/views.py:130`, `backend/apps/storage/services.py:311-317`; usos de `storage/download` en `frontend/src`.
- **Cambio concreto:**
  1. Cambiar `AllowAny` por `IsAuthenticated`.
  2. Resolver `key` contra documento, producto o artefacto y aplicar `filter_by_user_clients` y el gate `audience`.
  3. Ignorar `?bucket=` del cliente; fijar el bucket en servidor.
  4. Preferir `302` a una URL S3 firmada de 5 minutos, emitida solo tras autorizar.
  5. En seguimiento, cambiar keys de producto de 8 hex a UUID completo o claves con TTL.
- **Dependencias:** helper de scoping existente y 0.5 para que no pueda evadirse por header.
- **Riesgos:** `<img>`/`<iframe>` no envían `Authorization`; exigir auth puede romper el FE. Migrar esos usos a URL firmada o fetch autenticado + blob antes del corte.
- **Criterio de salida:** sin `Authorization` devuelve 401/403; un usuario de otro cliente recibe 403/404; `bucket` externo se ignora.

### 0.3 — Rotar MinIO, externalizar credenciales y habilitar TLS `[S]` `P0`

- **Archivos:** `backend/config/settings.py` (incluido `MINIO_SECRET_KEY`), `.env` de producción, `infra/nginx/`.
- **Cambio concreto:**
  1. Rotar `admin` / `MuitoWork2026?`.
  2. Eliminar defaults de credenciales y leerlas de entorno/secret manager.
  3. No exponer MinIO por HTTP plano público; usar red interna o TLS delante de `:9000`.
- **Dependencias:** coordinar con 0.2.
- **Riesgos:** actualizar todos los consumidores del storage antes de revocar las credenciales antiguas.
- **Criterio de salida:** no hay secretos literales en settings; MinIO no es accesible por HTTP público; el backend falla al arrancar si faltan credenciales.

### 0.4 — Aplicar tenant scope a operaciones por objeto `[M]` `P0`

- **Archivos:** `backend/apps/expedientes/views.py:219-236`, `:458-478`, `:5072-5085`, `:474-476`, `:521-527`; barrido equivalente en OCs y documentos.
- **Cambio concreto:**
  1. Aplicar `filter_by_user_clients` o `get_queryset` scopeado en `retrieve`, `update`, `partial_update` y `destroy`.
  2. Eliminar lookup por código secuencial o mantenerlo únicamente detrás del mismo scope.
  3. Replicar el patrón correcto de `PaymentViewSet.retrieve`.
- **Dependencias:** 0.5.
- **Riesgos:** no bloquear los flujos internos legítimos; probar admin real, operador y cliente. El rol de servicio futuro no debe estar en `BYPASS_ROLES`.
- **Criterio de salida:** un usuario A nunca obtiene/modifica un UUID o código de cliente B.

### 0.5 — Fail-closed en `_resolve_client_ids` `[S]` `P0`

- **Archivos:** `backend/apps/portal/views.py:250-266`, `backend/apps/core/jwt_auth.py:250-262`.
- **Cambio concreto:** si `legal_entity_ids` está vacío, devolver `[]`. `X-Portal-Client` o `?client_id=` solo puede restringir dentro del conjunto del JWT, nunca ampliarlo.
- **Dependencias:** ninguna; desbloquea 0.2 y 0.4.
- **Riesgos:** identificar consumidores internos que hoy dependen del override por header y emitirles identidad con entidades explícitas.
- **Criterio de salida:** JWT sin entidades no obtiene datos aunque falsifique headers.

### 0.6 — Gate administrativo en `/api/mwt-users/` y `apps/nodos` `[S]` `P0`

- **Archivos:** `backend/apps/portal/views.py:1312`, `backend/apps/nodos/views.py:17`.
- **Cambio concreto:** añadir `RoleBasedPermission`, `required_module` y scope de tenant. Restringir create/update/destroy de nodos; limitar gestión de usuarios a rol/módulo administrativo.
- **Dependencias:** solución urgente previa al poblado masivo de 1.12.
- **Riesgos:** el FE administrativo puede recibir 403 si su rol actual carece del permiso; alinear matriz y rol antes del despliegue.
- **Criterio de salida:** usuario no admin recibe 403 en `mwt-users` y escritura de nodos.

### 0.7 — Defaults fail-safe `[XS]` `P0`

- **Archivos:** `backend/config/settings.py:26-27`.
- **Cambio concreto:** `DEBUG` por defecto `"0"`; `DJANGO_SECRET_KEY` sin valor por defecto, usando `os.environ[...]` o `ImproperlyConfigured`.
- **Dependencias:** 0.1 debe proveer el nuevo secreto en todos los entornos.
- **Riesgos:** CI/local sin `.env` dejarán de arrancar; actualizar `.env.example`.
- **Criterio de salida:** sin secreto la app no arranca y DEBUG es falso por defecto.

### 0.8 — Throttle de login + hashing moderno + logout real `[M]` `P0`

- **Archivos:** `backend/apps/core/auth_views.py:47-48`, `:112-115`, `:262-267`; `backend/config/settings.py:158-180`; nuevo SQL de denylist si se elige esa vía.
- **Cambio concreto:**
  1. `ScopedRateThrottle` para login, inicialmente 5/min por IP/identidad.
  2. Migrar a `make_password`/`check_password` con Argon2 o PBKDF2.
  3. Rehash-on-login para contraseñas SHA-256 legado.
  4. Implementar revocación real por `jti` en tabla SQL propia, preferible a depender de migraciones de `token_blacklist`.
- **Dependencias:** diseñar la revocación junto con 1.11.
- **Riesgos:** calibrar throttle para evitar falsos positivos; hashes legado persisten hasta próximo login.
- **Criterio de salida:** intentos excesivos devuelven 429, nuevas contraseñas usan Argon2/PBKDF2 y logout invalida el token.

---

## 3. OLA 1 — Que el dato sea confiable

> **Orden recomendado:** 1.9 y 1.10 en paralelo → 1.11 → 1.12 → 1.13.

### 1.9 — Parseo numérico local, rechazo de `NaN` y saneamiento histórico `[M]` `P1`

- **Archivos:** `frontend/src/components/expedientes/builderArtifacts/DynamicField.jsx:290-302`, `ArtifactFillModal.jsx:66-77`; script de corrección histórica.
- **Cambio concreto:**
  1. `type="text"` + `inputMode="decimal"`.
  2. `parseLocaleNumber()` para `26.924,66 → 26924.66`.
  3. Valor crudo en foco y formato en `onBlur`.
  4. `Number.isFinite(v)` en validación de requeridos.
  5. Detectar datos sospechosos y generar una propuesta de corrección revisada por humano.
- **Dependencias:** 1.13 ayuda a detectar casos.
- **Riesgos:** `2.994` puede significar 2994 o 2.994; no auto-corregir sin contexto.
- **Criterio de salida:** `NaN` nunca llega al backend y los formatos es-CR se guardan con valor correcto.

### 1.10 — Eliminar fallback silencioso a mocks `[M]` `P1`

- **Archivos:** `frontend/src/pages/Expedientes.jsx:184-187`, ~62 referencias a `mockData` en `frontend/src`, `frontend/src/lib/api.js:156-159`.
- **Cambio concreto:** propagar errores reales; usar mocks solo con `VITE_USE_MOCKS=1`; crear estado de error con reintento y empty state separado.
- **Dependencias:** React Query de 3.26 lo mejora, pero no debe bloquear este fix.
- **Riesgos:** aparecen errores reales donde antes había datos falsos; es el comportamiento deseado.
- **Criterio de salida:** con backend caído la UI muestra error, no expedientes inventados.

### 1.11 — `ServiceToken` con scope, expiración y revocación `[L]` `P1`

- **Archivos:** nuevo `database/*.sql` o `backend/sql/service_tokens.sql`; modelo `managed=False`; `mint_mcp_token.py`; `scoped_querysets.py`; `POST /api/auth/mcp-token/`; AuthenticationClass nueva.
- **Cambio concreto:**
  1. Tabla `core.service_tokens(id, token_hash, scopes[], client_ids[], expires_at, revoked_at, last_used_at)`.
  2. AuthenticationClass que valide hash, expiración y revocación.
  3. Rol de servicio fuera de `BYPASS_ROLES`.
  4. Default de 30–90 días; obligar `scopes` y `client_ids`.
  5. Endurecer el JWT emitido por `mcp-token` para que refleje usuario, módulos y entidades.
- **Dependencias:** comparte denylist/revocación con 0.8; habilita 2.14/2.15.
- **Riesgos:** el MCP puede depender de privilegios admin implícitos. Migrar gradualmente: validar con token scopeado antes de retirar el viejo.
- **Criterio de salida:** revocar no requiere rotar el secreto global; el token nunca ve clientes fuera de scope.

### 1.12 — Poblar `required_module` y unificar RBAC `[L]` `P1`

- **Archivos:** ~80 viewsets en `backend/apps/*/views.py`; `backend/apps/core/permissions.py:154-158`; `apps/roles/models.py:83`; lectura de permisos en `core/permissions.py:118-121`.
- **Cambio concreto:**
  1. Elegir una fuente de verdad para permisos; recomendado: la que lee enforcement (`core.roles.permissions`).
  2. Migrar/sincronizar la matriz UI de `users.role_permission`.
  3. Declarar `required_module`/`required_action` en todos los viewsets.
  4. Tras completar cobertura, cambiar el default sin `required_module` de fail-open a fail-closed.
  5. Añadir fase log-only para medir qué bloquearía antes de activar.
- **Dependencias:** 0.6 es la corrección urgente de dos endpoints; 1.11 hace que servicios también respeten módulos.
- **Riesgos:** alto riesgo de 403 indebidos; necesita matriz de pruebas por rol y módulo.
- **Criterio de salida:** matriz UI y enforcement comparten store; todo viewset declara módulo; ausencia de módulo falla cerrado.

### 1.13 — Validaciones de coherencia backend `[M]` `P1`

- **Archivos:** serializers/services de `backend/apps/expedientes/`, artefactos, pipeline y liquidación.
- **Cambio concreto:** validar al guardar:
  - `total_invoiced` vs suma de líneas.
  - Solapes imposibles de fases.
  - `unit_cost = 0` en expediente cerrado.
  - Campo de vista cliente incoherente con su origen.
  Empezar como warnings auditables y endurecer solo reglas inequívocas.
- **Dependencias:** complementa 1.9 y alimenta alertas del agente.
- **Riesgos:** datos históricos incompletos pueden disparar falsos positivos.
- **Criterio de salida:** los descuadres se detectan antes de afectar margen, liquidación o vista cliente.

---

## 4. OLA 2 — MCP seguro y barato

> **Orden recomendado:** 2.21 y 2.22 → 2.18 y 2.19 → 2.17 → 2.16 → 2.20 → 2.14 y 2.15.

### 2.21 — Decorador estructural `@write_tool` `[S]` `P1`

- **Archivos:** `mcp_server/mwt_mcp/server.py`.
- **Cambio concreto:** centralizar `_wguard()` en un decorador aplicado a toda tool con POST/PATCH/DELETE. Esto cierra `expediente_resolve_oc_preview` y `pago_dry_run`, que hoy hacen POST sin guard, y elimina unas 46 repeticiones. Revisar la inconsistencia inversa de `expedientes_crear_lote` y `transferencia_recibir`.
- **Dependencias:** ninguna.
- **Riesgos:** clasificar incorrectamente una tool de lectura como escritura.
- **Criterio de salida:** en `MWT_MCP_READONLY=1` no sale ningún POST/PATCH/DELETE.

### 2.22 — `mwt_health` `[XS]` `P2`

- **Archivos:** `mcp_server/mwt_mcp/server.py`.
- **Cambio concreto:** health check que valide conectividad y vencimiento/estado de auth sin tocar datos de negocio.
- **Dependencias:** ninguna.
- **Riesgos:** ninguno relevante.
- **Criterio de salida:** diagnóstico de red/auth independiente de `mwt_whoami`.

### 2.18 — Tools de descarga segura `[S]` `P1`

- **Archivos:** `mcp_server/mwt_mcp/server.py`; endpoint seguro de storage.
- **Cambio concreto:** `documento_descargar(documento_id)` y `artefacto_archivo_descargar(artefacto_id, field_id)` que devuelvan URL firmada corta después de autorización.
- **Dependencias:** obligatoriamente 0.2.
- **Riesgos:** implementarlo antes de 0.2 automatizaría la vulnerabilidad.
- **Criterio de salida:** el agente descarga documentos sin salir del MCP y sin URL permanente.

### 2.19 — Editar y publicar artefactos `[S]` `P1`

- **Archivos:** `mcp_server/mwt_mcp/server.py`; backend ya expone PATCH/DELETE en `apps/nodos/urls.py`.
- **Cambio concreto:** `artefacto_editar` y `artefacto_publicar`; toda escritura pasa por 2.21. Considerar confirmación humana para publicar.
- **Dependencias:** 0.6 y 2.21.
- **Riesgos:** el agente no debe publicar automáticamente contenido no revisado.
- **Criterio de salida:** el agente puede corregir el campo equivocado de un artefacto; publicación queda auditada.

### 2.17 — Paginación y proyección en listados `[M]` `P1`

- **Archivos:** `mcp_server/mwt_mcp/server.py`; endpoints DRF de listas.
- **Cambio concreto:** `limit`/`offset` default 50 en toda tool de listado; `campos` opcional para proyección. Mantener compatibilidad de respuesta o versionar.
- **Dependencias:** soporte de paginación consistente en backend.
- **Riesgos:** cambiar shapes rompe consumidores.
- **Criterio de salida:** 500 expedientes no saturan el contexto; `expediente_obtener` puede devolver solo seis campos.

### 2.16 — Modelos Pydantic para contratos opacos `[L]` `P1`

- **Archivos:** `mcp_server/mwt_mcp/server.py`; nuevo módulo compartido de schemas.
- **Cambio concreto:** reemplazar los 15 `dict` opacos (`datos`, `cambios`, `data`, `payload`) por modelos Pydantic. Expresar invariantes como la relación entre `tallas` y `especificaciones.sizes`.
- **Dependencias:** idealmente antes o durante 2.14, compartiendo schemas.
- **Riesgos:** la validación estricta puede rechazar payloads actuales; respetar la diferencia ausente vs `null` de `_clean`.
- **Criterio de salida:** JSON Schema completo; docstrings de una línea.

### 2.20 — Idempotencia y observabilidad `[M]` `P1`

- **Archivos:** tools de creación, `client.py`, nuevo SQL de deduplicación y `mcp_audit`, modelos `managed=False`.
- **Cambio concreto:**
  1. `idempotency_key` en `expediente_crear`, `pago_registrar`, `transferencia_crear` y otras creaciones.
  2. Dedup backend con TTL.
  3. Log JSON por tool, argumentos saneados, identidad, resultado y duración.
- **Dependencias:** 1.11 y 2.15 para identidad/scopes.
- **Riesgos:** no registrar secretos o documentos sensibles; definir retención de auditoría.
- **Criterio de salida:** reintentar tras timeout no duplica; cada escritura tiene actor trazable.

### 2.14 — Partir en tres MCPs por dominio `[L]` `P2`

- **Archivos:** `mcp_server/mwt_mcp/server.py`, paquete común de cliente/identidad/schemas, configuración ContextForge.
- **Cambio concreto:**
  - `mwt-comercial`: clientes, productos, OCs, proformas.
  - `mwt-logistica`: expedientes, nodos, inventario, transferencias, artefactos.
  - `mwt-finanzas`: pagos, costos, liquidación, facturas.
  Compartir `client.py`, identidad, guard, Pydantic y observabilidad.
- **Dependencias:** 2.16, 2.17 y 2.21 reducen retrabajo; 1.11 permite scopes por dominio.
- **Riesgos:** triplica configuración y monitoreo; migrar consumidores gradualmente.
- **Criterio de salida:** un agente comercial no carga tools financieras/logísticas; baja el costo fijo de contexto.

### 2.15 — Endurecer token exchange y gateway `[M]` `P2`

- **Archivos:** `mcp-gateway/patch/contextforge_patch_v*.py`, `mcp_server/mwt_mcp/asgi_middleware.py`, `identity.py`, `jwt_minter.py`, `infra/nginx/consola.conf`, endpoint `mcp-token`.
- **Cambio concreto:**
  1. Verificar que la identidad OAuth propagada produce JWT del usuario, no un admin compartido.
  2. Atar módulos/clientes al token emitido mediante 1.11.
  3. `LOG_LEVEL` de producción a INFO/WARN.
  4. Deshabilitar `MCPGATEWAY_ADMIN_API_ENABLED` en producción.
  5. `SECURE_COOKIES=true`.
  6. Completar y probar migración Authentik → Pocket-ID.
- **Dependencias:** 1.11.
- **Riesgos:** cookies seguras y cambios OAuth pueden cortar sesiones; validar en staging.
- **Criterio de salida:** `mcp_audit` muestra el usuario real y nunca un admin genérico; gateway sin debug/admin API pública.

---

## 5. OLA 3 — Experiencia, rendimiento y mantenibilidad

> **Orden recomendado:** 3.23 → 3.24 y 3.25 → 3.27 y 3.29 → 3.26 → 3.28.

### 3.23 — Limpiar código muerto y artifacts `[S]` `P3`

- **Archivos:** `frontend/src/00_*.jsx`…`15_app_root.jsx`, `07b_artifacts_board.jsx`, ~104 `vite.config.js.timestamp-*`, `.gitignore`, artefactos temporales de raíz.
- **Cambio concreto:** verificar con `git grep`, borrar los 18 archivos numerados y duplicados no importados, borrar timestamps, añadir patrones de ignore y mover/borrar temporales/binarios de raíz.
- **Dependencias:** después de 0.1 para coordinar limpieza de historia.
- **Riesgos:** evitar borrar un archivo importado; la app viva es `App.jsx → pages/`.
- **Criterio de salida:** no quedan timestamps ni duplicados que induzcan a parchear el archivo equivocado.

### 3.24 — Code splitting y sourcemaps `[M]` `P3`

- **Archivos:** `frontend/src/App.jsx`, `frontend/vite.config.js`, imports de `xlsx`/`framer-motion`.
- **Cambio concreto:** `React.lazy` por ruta, `Suspense`, `import()` dinámico de `xlsx`, `sourcemap: "hidden"` o deshabilitado en producción.
- **Dependencias:** 3.23.
- **Riesgos:** boundaries de carga y errores por ruta; probar navegación completa.
- **Criterio de salida:** bundle inicial medido y menor; fuente no publicada en mapas públicos.

### 3.25 — Accesibilidad sistemática `[M]` `P3`

- **Archivos:** 442 inputs, formularios y ~25 modales.
- **Cambio concreto:** codemod `label htmlFor` + `input id` usando `useId()`; focus trap, restauración de foco y Escape consistente en modales.
- **Dependencias:** ninguna.
- **Riesgos:** IDs duplicados o labels no triviales; revisar resultados del codemod.
- **Criterio de salida:** lectores de pantalla anuncian campos y el foco no escapa de modales.

### 3.26 — Adoptar React Query de forma incremental `[XL]` `P3`

- **Archivos:** ~50 páginas/hooks, `lib/swrCache.js`, `lib/api.js`, `pages/Expedientes.jsx:222`.
- **Cambio concreto:** migrar por dominio empezando por Expedientes; mantener `lib/api.js`; retirar caché SWR casera al finalizar; resolver N+1 de clientes con batch/cache.
- **Dependencias:** 1.10 no espera a esto; se coordina con 3.28.
- **Riesgos:** no hacer big-bang; validar invalidaciones después de mutaciones.
- **Criterio de salida:** navegación reutiliza caché, estados loading/error son consistentes y desaparece el N+1.

### 3.27 — Virtualizar tablas largas `[M]` `P3`

- **Archivos:** tablas de expedientes, productos y líneas.
- **Cambio concreto:** `react-window` o `@tanstack/virtual`; desactivar virtualización durante impresión para preservar `@media print`; conservar `tabular-nums`.
- **Dependencias:** se beneficia de 3.26.
- **Riesgos:** impresión incompleta y alturas variables.
- **Criterio de salida:** 500+ filas fluidas y print completo.

### 3.28 — Partir los monolitos `[XL]` `P3`

- **Archivos:** `ProductFormView.jsx`, `ExpedienteDetail.jsx`, `TransferLiquidationPanel.jsx`, `CreateExpedienteWizardLite.jsx` y otros >1500 LOC.
- **Cambio concreto:** separar presentación/lógica; extraer efectos a hooks `use<X>Data`; un componente por sprint; no mezclar refactor con cambios funcionales.
- **Dependencias:** 3.26 proporciona la capa de hooks de datos.
- **Riesgos:** alto; requiere tests de humo y regresión visual.
- **Criterio de salida:** ningún componente >1500 LOC y wizards con hooks testeables.

### 3.29 — Completar portal cliente `[M]` `P3`

- **Archivos:** `frontend/src/pages/Portal.jsx:1-11`, `:37-58`, `:50`, `:56`; `frontend/src/lib/api.js:38-55`; endpoints portal.
- **Cambio concreto:** mostrar nombre de marca, no UUID; incluir líneas de OC; reemplazar catálogo mock por endpoint real con audience `CLIENT`; mantener filtro de borde que excluye costos, márgenes, comisiones y proveedores.
- **Dependencias:** 1.12 y endpoints backend correctamente scopeados.
- **Riesgos:** fuga de campos internos; añadir tests contractuales de exposición.
- **Criterio de salida:** portal totalmente real y sin datos internos.

---

## 6. Dependencias críticas

```
0.1 secretos ──> 0.7 defaults ──> arranque seguro
0.5 fail-closed ──> 0.2 storage ──> 2.18 descargas MCP
0.5 fail-closed ──> 0.4 object scope
0.6 nodos ──> 2.19 edición/publicación
0.8 revocación ──> 1.11 ServiceToken ──> 2.15 identidad gateway ──> 2.20 audit
1.9 parseo ──> 1.13 coherencia ──> saneamiento histórico
2.16 schemas + 2.17 paginación + 2.21 guard ──> 2.14 split MCP
3.23 limpieza ──> 3.24 bundle
3.26 React Query ──> 3.28 monolitos
```

**Ruta crítica de seguridad:** 0.1 → 0.5 → {0.2, 0.4} → 1.11 → 2.15.

---

## 7. Agente vs consola

El plan conserva la regla **“el agente propone, la consola dispone”**:

| Función | Canal |
|---|---|
| Subir OC y crear borrador `publicado:false` | Agente |
| Consultar estado, ETA y documentos | Portal |
| Explicar atrasos con enlace a consola | Agente de solo lectura |
| Registrar, editar y avanzar estado | Consola, humano |
| Validar factura/BL/SAP/expediente | Agente batch interno |
| Alertar descuadres | Agente → notificación en consola |

La corrección histórica de `26.924`, fases solapadas, `unit_cost=0` y campos cliente equivocados debe generar **propuestas revisables**, no escrituras automáticas.

---

## 8. Evidencia verificada contra el repo

| Hallazgo | Verificación |
|---|---|
| Storage público | `storage/views.py`: `permission_classes=[AllowAny]` |
| RBAC fail-open | `core/permissions.py`: `if not required_module: return True` |
| Cobertura RBAC baja | 11 ocurrencias de `required_module` en `backend/apps` |
| Token 100 años | `mint_mcp_token.py`: `default=36500` |
| Settings fail-open | `SECRET_KEY="dev-only-change-me"`, `DEBUG="1"` |
| MinIO hardcodeado | `MINIO_SECRET_KEY="MuitoWork2026?"` |
| Sin throttle/blacklist | settings sin `DEFAULT_THROTTLE_*` ni `token_blacklist` |
| MCP | 99 `@mcp.tool`, 50 usos de `_wguard` |
| Guard incompleto | existen `expediente_resolve_oc_preview` y `pago_dry_run` con POST |
| Huecos MCP | no hay `*_descargar`, `mwt_health` ni `idempotency` |
| Mocks FE | 62 referencias a `mockData` |
| Artifacts de Vite | 104 `vite.config.js.timestamp-*` |
| Accesibilidad | solo 2 `htmlFor` |
| Código muerto | `frontend/src/15_app_root.jsx` presente |

`graphify-out/graph.json` contiene 7.962 nodos, pero 0 aristas; se usó para orientación estructural y la verificación material se hizo leyendo archivos directamente.

---

## 9. Quick wins vs trabajo estructural

**Quick wins (1–2 días):** 0.1, 0.3, 0.5, 0.6, 0.7, 2.21, 2.22, 2.18, 2.19, 3.23.

**Trabajo estructural (semanas):** 1.11, 1.12, 2.14, 2.16, 3.26, 3.28.

**Trabajo medio (2–3 días):** 0.2, 0.4, 0.8, 1.9, 1.10, 1.13, 2.15, 2.17, 2.20, 3.24, 3.25, 3.27, 3.29.

---

## 10. Riesgos transversales

1. **SQL-first:** `ServiceToken`, denylist, idempotencia y `mcp_audit` deben entregarse como DDL versionado + modelos `managed=False`; nunca `makemigrations`.
2. **Rotación de `DJANGO_SECRET_KEY`:** termina sesiones y JWT; necesita ventana y reminteo probado.
3. **RBAC fail-closed:** usar etapa log-only y matriz de pruebas por rol antes del corte.
4. **Contratos MCP:** Pydantic/paginación pueden romper consumidores; versionar o mantener compatibilidad.
5. **Frontend XL:** React Query y refactor de monolitos deben ser incrementales, por dominio.
6. **Reglas de oro:** todos los cambios FE deben mantener cero hex, `tabular-nums`, print y aislamiento `CEO_ONLY`/`CLIENT_*`.

---

*Fin del plan. No se modificó código de producción ni se creó ningún commit.*
