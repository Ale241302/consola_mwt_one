# Auditoría MCP + Consola MWT.ONE

**Repo:** `Ale241302/consola_mwt_one` · commit `95e513f` (6-ago-2026)
**Alcance:** `mcp_server/` (1 485 LOC), `backend/` (76 998 LOC Django/DRF), `frontend/` (120 043 LOC React), `mcp-gateway/`
**Método:** análisis estático + una verificación en runtime contra producción (descarga del PDF de la factura 2455-2026)
**Fecha:** 6-ago-2026

---

## 0. Veredicto

El MCP está bien construido para lo que es: 99 tools, envoltura HTTP limpia, errores normalizados, docstrings con conocimiento de negocio real (la nota sobre `MontoTotalLinea` de Hacienda vale oro). El problema no es el MCP: es que **está montado sobre una capa de autorización que no existe**.

Tres hechos que definen la prioridad:

1. **Verifiqué en producción que `/api/storage/download/` sirve archivos sin autenticación.** Bajé la factura original de Marluvas — 519 001 bytes — desde internet abierto, sin cabecera `Authorization`. Con el key basta. Los keys aparecen en respuestas de API, y para productos son adivinables (8 hex).
2. **El token del MCP es un JWT admin con vencimiento en el año 2126, sin scope, sin revocación posible salvo rotar `DJANGO_SECRET_KEY`** — y está en claro en 6 archivos markdown versionados del repo.
3. **El RBAC no se aplica.** `required_module` está declarado en 3 de ~80 viewsets. La matriz de permisos del UI escribe en una tabla que el enforcement nunca lee.

Todo lo demás — UX, estructura, performance — es mejorable y vale la pena, pero se hace después de cerrar esos tres. Exponer el MCP o el portal a un cliente externo hoy es filtrar datos cross-tenant.

---

## 1. P0 — Bloqueantes

### 1.1 Storage público (verificado en runtime)

`backend/apps/storage/views.py:130-131` monta el endpoint con `permission_classes=[AllowAny]`. El handler lee `?key=` y `?bucket=` y hace stream desde MinIO. Sin identidad, sin validación de pertenencia.

Agravantes:

| | |
|---|---|
| Keys de producto | `uuid4().hex[:8]` — 8 hex sobre scope y filename predecibles (`services.py:311-317`). Enumerable. |
| Keys de documento | UUID completo, pero **sin TTL ni revocación**: filtrado el key una vez, el acceso es permanente |
| `?bucket=` | Controlable por el cliente → cualquier bucket que alcancen las credenciales de MinIO |
| Credenciales MinIO | Hardcodeadas en `config/settings.py:288-292` — `admin` / `MuitoWork2026?` sobre `http://187.77.218.102:9000` (IP pública, HTTP plano) |

**Fix:** `IsAuthenticated` + resolver el key contra su fila de dominio y aplicar `filter_by_user_clients` y el gate de `audience`. Ignorar `?bucket=` del cliente. Mínimo viable si urge: 302 a una signed URL S3 de 5 minutos emitida solo después del check.

### 1.2 Token de servicio sin scope ni revocación

`backend/apps/core/management/commands/mint_mcp_token.py`:

- `--days` default **36500** (~100 años), línea 38
- Claims: `user_uuid`, `email`, `role`, `mcp:true` — **ningún scope, ningún `client_id`, ningún módulo** (líneas 93-98)
- No existe modelo de token. Es un `AccessToken` de SimpleJWT firmado con `DJANGO_SECRET_KEY`
- `token_blacklist` no está en `INSTALLED_APPS`. `LogoutView` llama `blacklist()` dentro de un `except: pass` → **no-op** (`apps/core/auth_views.py:262-267`)
- `role=admin` bypassea el scoping: `BYPASS_ROLES = ("superadmin","admin")` en `apps/core/scoped_querysets.py:56`

Revocar hoy exige rotar `DJANGO_SECRET_KEY`, lo que invalida la sesión de todos los usuarios.

**Y el token de producción está en el repo en claro**, en `auditor.md:25`, `:37`, `solucion_puntos_pendientes.md:29`, `:39`, `solucion_puntos_pendientes_costa_rica_muitowork.md:51`, `solucion_puntos_pendientes_costa_rica_sondel_2019_2025.md:38`, `:48`. Payload: `role=admin`, `mcp=true`, `exp=4935435646` → **año 2126**. También hay una llave SSH privada versionada: `test_key`.

**Fix:**

```
ServiceToken(id, token_hash, scopes[], client_ids[], expires_at, revoked_at, last_used_at)
```

con `AuthenticationClass` propia, vida default 30-90 días, y un rol de servicio que **no** esté en `BYPASS_ROLES`. Mientras tanto: rotar `DJANGO_SECRET_KEY` hoy y purgar el historial con `git filter-repo`.

### 1.3 RBAC no aplicado + fugas cross-tenant

| Hallazgo | Evidencia |
|---|---|
| `RoleBasedPermission` devuelve `True` si la vista no declara `required_module` | `apps/core/permissions.py:154-158` |
| `required_module` existe solo en 3 vistas | `apps/finance/views.py:67`, `:1933`, `:2021` |
| La matriz RBAC del UI escribe en `users.role_permission`; el enforcement lee `core.roles.permissions`. **Nada sincroniza las dos** | `apps/roles/models.py:83` vs `apps/core/permissions.py:118-121` |
| `retrieve` de expedientes, OCs y documentos **no** aplica `filter_by_user_clients` (el `list` sí) | `apps/expedientes/views.py:458-478`, `:219-236`, `:5072-5085` |
| El `retrieve` acepta lookup por `codigo`, y los códigos son secuenciales (`EXP-2026-0007`) → enumeración trivial | `views.py:474-476`, `:521-527` |
| Spoofing de tenant: `X-Portal-Client` / `?client_id=` se aceptan si `legal_entity_ids` viene vacío — escenario documentado como frecuente en el propio repo | `apps/portal/views.py:250-266`, `apps/core/jwt_auth.py:250-262` |
| `/api/mwt-users/` (ModelViewSet completo sobre usuarios del portal) sin gate de admin | `apps/portal/views.py:1312` |
| `apps/nodos` sin RBAC ni tenant: cualquier autenticado crea/edita/borra nodos | `apps/nodos/views.py:17` |
| Passwords SHA-256 sin salt por default | `apps/core/auth_views.py:47-48`, `:112-115` |
| Sin rate limiting en login | no hay `DEFAULT_THROTTLE_*` en `config/settings.py:158-180` |
| `DEBUG` default `"1"` y `SECRET_KEY` default `"dev-only-change-me"` — fail-open si falta el `.env` | `config/settings.py:26-27` |

Contra-ejemplo de cómo debería verse: `PaymentViewSet.retrieve` (`apps/finance/views.py:270-274`) sí scopea. El patrón existe; falta aplicarlo.

---

## 2. Auditoría del MCP

### 2.1 Lo que está bien

- `client.py` es correcto: `_clean` quita `None` (la API trata ausente ≠ null), `_handle` normaliza 204 y errores, `_safe` garantiza que ninguna excepción llegue cruda al agente. Frontera bien pensada.
- `MWT_MCP_READONLY` como perilla global es la decisión correcta para dar acceso de auditoría.
- Los docstrings cargan conocimiento de dominio que un agente no puede inferir: el anti-duplicados de `expediente_buscar`, la identidad de Hacienda en el parser FE, el flujo de 4 pasos de `storage_subir_archivo`. Esto es lo que separa un MCP útil de un wrapper de OpenAPI.
- `_norm_num` resuelve bien el problema real de `504983` vs `PO 504983` vs `PO-504983`.

### 2.2 Problemas

**A. Superficie de 99 tools — costo fijo por conversación.**
51 de lectura, 48 de escritura. Solo los docstrings suman ~21 200 caracteres (~5 300 tokens); con los esquemas JSON el costo real ronda 12-18k tokens **antes de la primera pregunta**. En clientes sin carga diferida eso desplaza contexto útil y degrada la selección de tool.

*Recomendación:* partir en 3 servidores por dominio — `mwt-comercial` (clientes, productos, OC, proformas), `mwt-logistica` (expedientes, nodos, inventario, transferencias, artefactos), `mwt-finanzas` (pagos, costos, liquidación, facturas) — y montarlos por separado en ContextForge. Un agente comercial no necesita `transfer_liquidacion_preview`.

**B. Dos tools de escritura sin `_wguard()`.**
`expediente_resolve_oc_preview` y `pago_dry_run` llaman `api.post` sin pasar por el guard: en modo readonly siguen ejecutando POST. Son "preview" por nombre, pero el guard debería ser estructural, no depender de que el endpoint sea idempotente. Inversamente, `expedientes_crear_lote` y `transferencia_recibir` tienen guard sin escribir por HTTP — revisar por qué.

*Fix:* decorador `@write_tool` que aplique el guard automáticamente, en vez de repetir 46 veces `g = _wguard(); if g: return g`.

**C. No hay tool de descarga.** Existe `storage_subir_archivo` pero no su inverso. En esta misma sesión no pude traer la factura por el MCP: tuve que salir a `https://consola.mwt.one/api/storage/download/?key=…` por fuera. Que eso haya funcionado es el hallazgo 1.1; que fuera necesario es un hueco funcional.

*Fix:* `documento_descargar(documento_id)` y `artefacto_archivo_descargar(artefacto_id, field_id)` que devuelvan una signed URL de corta vida **después** del check de autorización.

**D. Artefactos: se pueden crear pero no editar ni publicar.** El backend expone `PATCH` y `DELETE` en `/api/nodos/{pk}/artifacts/{pk}/` (`apps/nodos/urls.py`), pero el MCP solo tiene `nodo_artefacto_crear` y `nodo_artefactos_listar`. Consecuencia concreta: detecté que el campo "Total Vista Cliente" del artefacto de la 2455-2026 tiene el CIF de compra (26 924.66) en vez de la vista cliente, y **no pude corregirlo**. Falta también `artefacto_publicar` — el flujo `publicado: false → true` no es alcanzable desde el agente.

**E. Sin paginación en 98 de 99 tools.** Solo `producto_listar` acepta `limit`/`offset`. `expediente_listar`, `pago_listar`, `transferencia_listar`, `nodo_artefactos_listar` devuelven todo. Hoy con volumen bajo funciona; a 500 expedientes revienta el contexto del agente.

*Fix:* `limit`/`offset` en todas las tools de listado, default 50, y `campos` opcional para proyección — la respuesta de `expediente_obtener` trae 60+ campos cuando el agente normalmente quiere 6.

**F. 15 tools reciben `dict` opaco** (`datos`, `cambios`, `data`, `payload`). El esquema JSON solo dice "object", así que la validación vive en la prosa del docstring y el agente adivina. `producto_crear` necesita 743 caracteres de docstring para explicar que `tallas` y `especificaciones.sizes` deben llevar los mismos UUIDs. Eso es un contrato que debería estar en el tipo, no en el texto.

*Fix:* modelos Pydantic por entidad. FastMCP los convierte a JSON Schema y el agente deja de adivinar; el docstring baja a una línea.

**G. Sin idempotencia ni observabilidad.** No hay claves de idempotencia en `expediente_crear`, `pago_registrar`, `transferencia_crear`: un reintento del agente tras un timeout duplica el registro. `MWT_HTTP_TIMEOUT=60` con `_safe` devolviendo un dict de error hace este escenario probable. Tampoco hay logging estructurado de qué tool se llamó, con qué argumentos y en nombre de quién.

*Fix:* parámetro `idempotency_key` en las tools de creación + tabla de dedup en backend. Log JSON por invocación → tabla `mcp_audit`.

**H. `mwt_whoami` es el único health check** y ya hace una llamada autenticada a producción. Falta un `mwt_health` que verifique conectividad y vencimiento del token sin tocar datos.

### 2.3 Gateway

`mcp-gateway/docker-compose.yml` (pocket-id + ContextForge con OAuth 2.1) es la arquitectura correcta para exponer esto a Claude/Cowork. Dos peros:

- `LOG_LEVEL: DEBUG` y `MCPGATEWAY_ADMIN_API_ENABLED: "true"` en lo que parece producción
- `SECURE_COOKIES: "false"` con `APP_DOMAIN: https://mcp.mwt.one`

Y lo importante: **el OAuth del gateway autentica al usuario contra el gateway, pero el gateway sigue llamando al backend con el único token admin del MCP.** La identidad se pierde en el salto. Mientras eso siga así, el OAuth es teatro: todos los usuarios del gateway operan como Alejandro. La solución es token exchange — el gateway intercambia el token OIDC del usuario por un `ServiceToken` scopeado a ese usuario.

---

## 3. Consola — frontend

### 3.1 Lo que rompe la confianza en el dato

**Fallback silencioso a datos mock.** `pages/Expedientes.jsx:184-187`:

```js
expedientesApi.list(undefined, { signal }).catch(() => []),
ocsApi.list(undefined, { signal }).catch(() => []),
```

Con el backend caído esto devuelve `[]`, y **30 páginas importan `data/mockData.js` como fallback**. El usuario ve expedientes inventados en lugar de un error. Un operador puede decidir sobre datos que no existen. Es el hallazgo más grave del frontend y no es de seguridad, es de confianza.

*Fix:* eliminar el fallback en producción. El flag `VITE_USE_MOCKS=1` ya existe (`lib/api.js:156-159`) — que las demos usen eso.

**El bug del `26.924` — confirmado y localizado.** `components/expedientes/builderArtifacts/DynamicField.jsx:290-302`:

```js
case "number":
  <input type="number" value={value ?? ""}
    onChange={(e) => handle(e.target.value === "" ? null : Number(e.target.value))} />
```

Sin normalización de separadores. En locale es-CR, `Number("26.924")` → `26.924` y eso se guarda; `Number("26.924,66")` → `NaN`. Y `NaN` **pasa la validación de requeridos** (`ArtifactFillModal.jsx:66-77` solo chequea null / "" / array vacío) y se envía al backend.

Esto explica exactamente el `total_invoiced = 26.92` del EXP-2026-0007 contra un CIF real de 26 924.66. En el mismo nodo conviven tres formatos: `39134`, `27040`, `2.994`, `26.924`.

*Fix (~20 líneas, un archivo, cubre todos los formularios dinámicos):* `type="text"` + `inputMode="decimal"` + `parseLocaleNumber()` que quite separadores de miles y normalice la coma; formateo en `onBlur`, crudo en foco; `Number.isFinite(v)` en el chequeo de requeridos. Y una migración de datos para los valores ya guardados mal.

### 3.2 Estructura

- **5 502 líneas muertas**: los 18 archivos numerados (`00_mock_data.jsx` … `15_app_root.jsx`) no los importa nadie. La app viva es `App.jsx` → `pages/`. `07b_artifacts_board.jsx` duplica lógica de `BuilderArtifactsBoard.jsx`: alguien va a parchear el archivo equivocado.
- **~130 archivos** `vite.config.js.timestamp-*.mjs` versionados.
- **9 monolitos >1500 líneas** (~24k LOC): `ProductFormView.jsx` 3568, `ExpedienteDetail.jsx` 3288, `TransferLiquidationPanel.jsx` 3184, `CreateExpedienteWizardLite.jsx` 3182 (con **21 `useEffect`** en un componente).
- **Sin React Query / SWR.** 442 `useEffect`, 266 llamadas de fetch. La caché SWR casera de `lib/swrCache.js` solo se usa en 2 hooks; las ~50 páginas restantes refetchean todo en cada navegación.
- **N+1 confirmado:** `pages/Expedientes.jsx:222` hace un `GET /clientes/{id}` por cada cliente único de la tabla.
- **Cero code splitting.** Ni un `React.lazy` ni un `Suspense` en todo `src/`. El bundle inicial arrastra las ~50 páginas, `xlsx` y `framer-motion`. Y `sourcemap: true` en producción publica el fuente completo.
- **Cero virtualización** en tablas de expedientes, productos y líneas.

Nota positiva: `lib/api.js` está mejor de lo esperado — refresh silencioso de JWT en 401 con reintento único, reintento en 502/503/504 solo para métodos idempotentes, y `abortInflightGets()` al navegar.

### 3.3 Accesibilidad

**442 `<input>` en el código, 2 `htmlFor=`** (ambos en `Login.jsx`). Prácticamente ningún campo está asociado a su etiqueta: los lectores de pantalla no anuncian nada y el click en el label no enfoca. Los modales sí tienen `role="dialog"`/`aria-modal` (~25), pero solo 14 archivos manejan `Escape` y no hay focus trap.

Un codemod de `label htmlFor` / `input id` es el arreglo de mayor retorno por esfuerzo de todo el frontend.

### 3.4 Portal cliente

Es el módulo con mejor disciplina del repo: las reglas de exposición están documentadas en el encabezado (`pages/Portal.jsx:1-11` — nunca costos, márgenes, comisiones, proveedores) y hay un adapter que filtra en el borde (`:37-58`). Usa caché SWR y skeletons.

Huecos: se muestra el **UUID de la marca** al cliente (`:50`, con TODO abierto), las líneas de la OC no viajan en el listado (`:56`), y el catálogo de productos del portal sigue servido por **fixtures mock** interceptados en `lib/api.js:38-55`.

---

## 4. Plan

### Ola 0 — esta semana, no negociable

| # | Acción | Dónde |
|---|---|---|
| 1 | Rotar `DJANGO_SECRET_KEY` y el token admin filtrado; purgar historial de git; borrar `test_key` | repo + prod |
| 2 | Cerrar `/api/storage/download/`: `IsAuthenticated` + check de pertenencia + ignorar `?bucket=` | `apps/storage/views.py:130` |
| 3 | Rotar credenciales MinIO y sacarlas de `settings.py`; TLS en el endpoint | `config/settings.py:288-292` |
| 4 | `filter_by_user_clients` en todos los `retrieve`/`update`/`destroy`; eliminar lookup por `codigo` | `apps/expedientes/views.py` |
| 5 | Fail-closed en `_resolve_client_ids`: sin empresas → `[]`, nunca override por header | `apps/portal/views.py:250` |
| 6 | Gate de admin en `/api/mwt-users/` y en `apps/nodos` | `apps/portal/views.py:1312`, `apps/nodos/views.py:17` |
| 7 | Defaults fail-safe: `DEBUG="0"`, `SECRET_KEY` sin default | `config/settings.py:26-27` |
| 8 | Throttle en login + migrar hashing a PBKDF2/Argon2 | `apps/core/auth_views.py` |

### Ola 1 — 2 a 4 semanas: que el dato sea confiable

| # | Acción | Impacto |
|---|---|---|
| 9 | `parseLocaleNumber` + rechazo de `NaN` en `DynamicField.jsx` + migración de datos históricos | Arregla la clase de bug del `26.924` en todo el sistema |
| 10 | Eliminar el fallback a `mockData.js`; error real con reintento | Nadie decide sobre datos inventados |
| 11 | `ServiceToken` con scope, expiración y revocación; el MCP deja de correr como admin | Habilita todo lo demás |
| 12 | Poblar `required_module` en los ~80 viewsets; unificar el store de permisos | El RBAC empieza a existir |
| 13 | Validación de coherencia en backend: `total_invoiced` vs suma de líneas, solape de fases, `unit_cost = 0` en expediente cerrado | Los descuadres se detectan al guardar |

### Ola 2 — 1 a 2 meses: que el MCP sea seguro y barato

| # | Acción |
|---|---|
| 14 | Partir en 3 MCPs por dominio; montarlos separados en ContextForge |
| 15 | Token exchange en el gateway: la identidad OIDC del usuario llega al backend |
| 16 | Pydantic en las 15 tools de `dict` opaco; docstrings a una línea |
| 17 | `limit`/`offset` + proyección de campos en todas las tools de listado |
| 18 | `documento_descargar` / `artefacto_archivo_descargar` con signed URL |
| 19 | `artefacto_editar` / `artefacto_publicar` |
| 20 | `idempotency_key` en creaciones + tabla `mcp_audit` |
| 21 | Decorador `@write_tool` (elimina 46 repeticiones del guard y cierra las 2 fugas) |

### Ola 3 — experiencia

| # | Acción |
|---|---|
| 22 | Borrar 5 502 líneas muertas + 130 archivos de build; `.gitignore` |
| 23 | `React.lazy` por ruta (probablemente −60% del bundle inicial); `import()` dinámico de `xlsx`; `sourcemap: "hidden"` |
| 24 | Codemod `label htmlFor` sobre los 442 inputs; focus trap en modales |
| 25 | React Query en lugar de 442 `useEffect`; resuelve caché, N+1, loading y error de una |
| 26 | Virtualizar las tablas largas |
| 27 | Partir los 9 monolitos: extraer los `useEffect` de los wizards a hooks `use<X>Data` |
| 28 | Portal: resolver nombre de marca, traer líneas de OC, reemplazar el catálogo mock |

---

## 5. La pregunta de fondo: agente vs consola

El reparto correcto no es uno u otro:

| Función | Dónde |
|---|---|
| Cliente sube OC (PDF, correo) | Agente → crea borrador `publicado: false` |
| Cliente consulta estado, ETA, documentos | Consola (portal) |
| Cliente pregunta "¿por qué se atrasó?" | Agente, solo lectura, con link a la consola |
| Registro, edición, avance de estado | Consola, humano |
| Validación cruzada factura / BL / SAP / expediente | Agente, batch nocturno, interno |
| Alertas de descuadre | Agente → notificación en consola |

**El agente propone, la consola dispone.**

La evidencia está en esta misma sesión: en cuatro llamadas al MCP encontré el `26.924` mal parseado, DESPACHO y TRÁNSITO solapados 23 días, `unit_cost = 0` matando el cálculo de margen, y el CIF de compra Marluvas cargado en el campo de vista cliente. Ninguno de esos hallazgos es "subir una orden" — todos son **revisar lo que ya se subió**. Ahí es donde el agente gana y la consola no compite.

Y el punto 14 de la Ola 2 no es opcional si esto va a tocar a un cliente: hoy el MCP corre con `role=admin` y `modules: *` sobre tres legal entities. Si Sondel le habla al agente, técnicamente puede leerle el expediente de otro cliente.

---

## 6. Lo que no verifiqué

- No corrí el build del frontend: el tamaño real del bundle y el comportamiento responsive son estimaciones, no mediciones.
- No probé en runtime la explotabilidad de las fugas cross-tenant (retrieve sin scope, spoofing de `X-Portal-Client`) — es análisis de flujo de código sobre la base de datos que no toqué.
- La única verificación en producción fue la descarga del PDF por `/api/storage/download/`, que sí es concluyente.
- No revisé `database/`, `harness/`, `sprints/` ni los tests.
