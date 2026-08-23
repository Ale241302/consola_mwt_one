# MWT.ONE — Servidor MCP

Servidor **MCP (Model Context Protocol)** que expone la operación completa de la
Consola MWT.ONE como herramientas para que un agente de IA externo (Antigravity,
Kimi CLI, Claude Desktop, Cursor, etc.) opere sobre la plataforma vía su API REST.

Autentica con un **token de servicio** (`manage.py mint_mcp_token`) contra el
backend. No guarda estado local: cada herramienta es una llamada autenticada a
`https://consola.mwt.one/api`.

Cuando el MCP corre detrás del gateway (ContextForge → Authentik en
`mcp.mwt.one`), la identidad del usuario OAuth se propaga (`X-Forwarded-User-*`),
el MCP pide un JWT de ese usuario al backend y **las tools se filtran por su
rol** (ver §1.1). El token de servicio solo se usa si NO hay identidad
propagada (acceso directo / stdio).

## Arquitectura

```
┌──────────────────┐     ┌─────────────────────────────┐     ┌──────────────┐
│  Agente de IA    │     │  Gateway MCP (ContextForge)  │     │  MWT.ONE API │
│  (Claude, Kimi,  │────▶│  · Authentik (OAuth)         │────▶│  (Django DRF)│
│  Cursor…)        │MCP  │  · propaga X-Forwarded-User-*│JWT  │  · JWT + RBAC│
└──────────────────┘     └──────────────┬──────────────┘     └──────┬───────┘
                                        │                            │
                                        ▼                            ▼
                              ┌──────────────────────────────────────────────┐
                              │  Servidor MCP (mwt_mcp/server.py, 137 tools)  │
                              │  · RBAC por rol: tool_rbac.py (list_tools)     │
                              │  · Redacción por rol: redact.py (_safe_role)   │
                              │  · Auditoría durable: core.mcp_audit           │
                              │  · Diagnóstico: mwt_health / mwt_diag_scope    │
                              └──────────────────────────────────────────────┘
```

**Capas de defensa (defensa en profundidad):**
1. **CAPA 1 — Lista de tools:** `tool_rbac.py` filtra las 137 tools por
   `(módulo, acción)` de la matriz `core.roles.permissions`. Fail-closed.
2. **CAPA 2 — Redacción por rol:** `redact.py` oscurece campos CEO_ONLY
   (costos/margen/comisiones/crédito/precio MWT) en la respuesta, aunque la
   tool esté permitida.
3. **CAPA 3 — Backend:** si se fuerza una llamada, Django niega (403).

---

## 1. Qué puede hacer (137 herramientas)

| Dominio      | Herramientas                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Clientes** | `cliente_listar`, `cliente_obtener`, `cliente_crear`, `cliente_editar`, `cliente_subsidiarias`, `cliente_kpis_pool` |

| **Productos** | `producto_listar`, `producto_obtener`, `producto_crear`, `producto_editar`, `producto_alias_crear`, `ncm_listar`, `tallas_listar` |
| **OC / Expedientes** | `oc_listar`, `oc_obtener`, `expediente_listar`, `expediente_obtener`, `expediente_buscar` (anti-duplicados), `expediente_lineas`, `expediente_resolve_oc_preview`, `expediente_crear`, `lineas_actualizar_precios`, `expediente_apply_pronto_pago`, `expediente_edit_full_get/patch` |
| **Documentos** | `documento_subir`, `documento_listar` |
| **SAP** | `sap_analizar`, `sap_confirmar`, `sap_upsert`, `sap_obtener`, `sap_editar`, `sap_sincronizar_discrepancias` |
| **Balanceo IA** | `match_subir`, `match_resolver` |
| **Fusión** | `expediente_fusionar`, `expediente_fusion_label`, `expediente_desfusionar` |
| **Proforma / Factura** | `proforma_generar`, `proforma_html`, `factura_payload` |
| **Estados** | `expediente_avanzar_estado`, `expediente_phase_durations_get/set`, `expediente_eventos` |
| **Nodos** | `nodo_listar`, `nodo_obtener`, `nodo_crear`, `nodo_editar`, `nodo_artefactos_listar`, `nodo_artefacto_crear` |
| **MWT Builder externo** (builder.muito.work) | `builder_structure_construir`, `builder_artefacto_listar`, `builder_artefacto_obtener`, `builder_artefacto_crear`, `builder_artefacto_editar`, `builder_artefacto_eliminar` |
| **Inventario / Recepción** | `stock_listar`, `inventario_saldos_por_expediente`, `inventario_expedientes_con_pendiente`, `inventario_lineas_en_nodo`, `recepcion_crear`, `inventario_transferir_asignaciones`, `inventario_artefactos_expediente` |
| **Movimientos** | `transferencia_listar/obtener/crear`, `transferencia_avanzar/aprobar/despachar/editar/recibir/conciliar/cerrar/cancelar` |
| **Costos / impuestos / gastos** | `transfer_costos_listar`, `transfer_costo_agregar`, `transfer_costo_editar`, `transfer_costo_eliminar`, `transfer_artefacto_crear` |
| **Landed cost / factura** | `transfer_liquidacion_preview`, `transfer_liquidar`, `transfer_factura_payload`, `transfer_notas_listar`, `transfer_nota_crear` |
| **Pagos** | `pago_applicables`, `pago_listar`, `pago_obtener`, `pago_dry_run`, `pago_registrar`, `pago_conciliar`, `pago_liberar_credito`, `pago_rechazar` |
| **Finanzas** (CEO/Admin) | `finanzas_overview`, `finanzas_comisiones`, `finanzas_commission_by_month`, `finanzas_margin_scatter`, `finanzas_cliente` |
| **Salud / diagnóstico** | `mwt_whoami`, `mwt_health`, `mwt_diag_scope` (CEO), `mwt_audit_write_registry`, `tipo_cambio` |

### 1.1 Filtrado de tools por rol (RBAC) y fail-closed

- **1 solo servidor MCP** (`mwt-one`) con las 137 tools. No se parte en 3
  dominios; la reducción de contexto se logra ocultando al agente las tools que
  su rol no puede usar (`mcp_server/mwt_mcp/tool_rbac.py`).
- `list_tools` consulta el perfil del usuario (rol + `permissions` de
  `core.roles.permissions`) vía `POST /api/auth/mcp-token/` y devuelve solo las
  tools del mapa `TOOL_MODULES` cuyo `(módulo, acción)` el rol permite.
  Ejemplo: un usuario sin `clientes.create` no ve `cliente_crear`.
- Sin identidad (ServiceToken puro / stdio / registro del server) → se listan
  las 106. Admin/superadmin o `modules=["*"]` → las 106.
- **Fail-closed:** si hay identidad propagada pero el backend no emite JWT
  (usuario inactivo/borrado), `list_tools` devuelve `[]` y cada llamada a la API
  falla con 401 — **nunca** se cae al token de servicio admin. Esto cierra la
  fuga "borro un usuario de la consola y sigue entrando por el MCP".
- Flag: `MWT_MCP_RBAC=0` desactiva el filtro de listado (el enforcement real
  siempre vive en el backend, no en el MCP).

### 1.2 Tabla de permisos por rol (referencia)

La matriz real vive en `core.roles.permissions` (configurada en `/roles` de la
consola). Como referencia operativa, los roles típicos:

| Rol | Qué ve | Herramientas típicas | Redacción aplicada |
|---|---|---|---|
| **superadmin / admin / ceo** | Todo | Las 137 tools según la matriz configurada | Ninguna (acceso total) |
| **manager** | Operación + finanzas del área | expedientes, transferencias, pagos, clientes, productos | Sí: costos/margen/comisiones/precio MWT → `***` |
| **operator** | Operación día a día (estados, líneas, docs) | expedientes, documentos, SAP, nodos, inventario | Sí: costos/margen/comisiones |
| **finance** | Pagos/crédito | pagos, cobros, transferencias | Sí: comisiones/margen |
| **viewer** | Solo lectura, sin rentabilidad | tools `*_listar`/`*_obtener` de su módulo | Sí: costos/margen/comisiones |
| **client_b2b** | Solo el Portal B2B | expedientes, documentos, pagos (view), pipeline | Sí: + proveedores, PII, operativa interna |

> Nota: un `client_b2b` con acceso al MCP ve SOLO las tools del Portal y los
> datos que su `legal_entity_id` le permite; los campos sensibles aparecen como
> `***` (ver §3.5).

---

## 2. Generar el token de servicio

El backend ya incluye el comando `mint_mcp_token`. Córrelo **en el VPS** contra el
contenedor `django`:

```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
docker exec -i consola-mwt-one-django python manage.py mint_mcp_token \
  --name mcp-gateway-prod --scopes mcp:*,mcp:token_exchange --expires-days 30
```

Salida (ejemplo):

```
== MWT.ONE — ServiceToken emitido ==
  id         : <uuid>
  name       : mcp-gateway-prod
  scopes     : mcp:*, mcp:token_exchange
  expires_at : 2026-09-06T...
  TOKEN (guardalo como MWT_MCP_TOKEN en el .env del MCP):

  <token opaco de 64 hex>
```

> Para capturar solo el token: añade `--quiet`. Vida default 30 días, máximo 90.
> Para revocarlo (sin rotar `DJANGO_SECRET_KEY`):
> `python manage.py revoke_service_token <id>`

Copia ese token: es tu `MWT_MCP_TOKEN`.

---

## 3. Instalar y correr el MCP

### Opción A — local (stdio), para Antigravity / Kimi CLI / Claude Desktop

```bash
cd mcp_server
pip install -r requirements.txt
export MWT_MCP_TOKEN="<pega-el-token>"
export MWT_API_BASE="https://consola.mwt.one/api"
python -m mwt_mcp          # arranca en stdio
```

### Opción B — por red (streamable-http / Docker)

```bash
cd mcp_server
docker build -t mwt-mcp .
docker run -d --name mwt-mcp -p 8765:8765 \
  -e MWT_MCP_TOKEN="<pega-el-token>" \
  -e MWT_API_BASE="https://consola.mwt.one/api" \
  -e MWT_MCP_TRANSPORT=http \
  mwt-mcp
# Endpoint MCP: http://<host>:8765/mcp
```

Variables de entorno (ver `.env.example`): `MWT_API_BASE`, `MWT_MCP_TOKEN`,
`MWT_MCP_TRANSPORT` (`stdio`|`http`), `MWT_MCP_HOST`, `MWT_MCP_PORT`,
`MWT_HTTP_TIMEOUT`, `MWT_MCP_READONLY` (`1` = solo lectura),
`MWT_MCP_DOMAIN` (`comercial`|`logistica`|`finanzas`; vacío = monolito),
`MWT_MCP_RBAC` (`1` default = filtra tools por rol; `0` = lista las 105).

---

## 3.5 Redacción de campos sensibles por rol (Ola 3.5 · Eje B)

El MCP aplica una segunda capa de seguridad MÁS ALLÁ del filtrado de tools:
aunque una tool esté permitida para el rol, su respuesta se recorta en la
frontera del servidor para que el agente NUNCA reciba datos que ese rol no
debe ver.

- **Rol CEO/Admin (`superadmin`/`admin`/`ceo`)**: acceso total, sin cambios.
- **Staff (`manager`/`operator`/`finance`/`compras`/`viewer`)**: se oscurecen
  costos internos, márgenes, comisiones, límites de crédito, precio interno
  MWT y notas internas.
- **`client_b2b` (Portal)**: además de lo anterior, nunca ve proveedores,
  PII (contact_email/phone/cedula/tax_id) ni decisiones operativas internas
  (ruteo, bandas de riesgo, bloqueos, semáforos).

Los valores se reemplazan por `***` (la clave se conserva para no romper el
shape que el agente espera). La implementación vive en
`mcp_server/mwt_mcp/redact.py` y el wrapper `_safe_role` en `server.py`
envuelve las ~96 tools de negocio. Sin identidad propagada (ServiceToken
puro / stdio) no se redacta (comportamiento anterior).

Catálogo alineado con `POL_VISIBILIDAD` del portal B2B
(`backend/apps/portal/serializers.py`) y con los serializers de expedientes,
transfers, clientes, commercial e inventario.

---

## 3.6 Auditoría durable y diagnóstico (Ola 3.6 · Ejes A3/D5)

### Auditoría durable (`core.mcp_audit`)

Cada tool-call de escritura (y los reads sensibles) emite un log JSON a
stderr **y además** se persiste de forma durable en la tabla `core.mcp_audit`
del backend vía `POST /api/auth/mcp-audit/` (best-effort, thread daemon,
timeout 3s — nunca retrasa ni rompe la tool).

La persistencia escribe: `event` (`write`/`read`), `tool`, `identity_sub`
(ServiceToken firmante), `args_sanitized` (redacta PII/URLs firmadas), `ok`,
`http_status`, `duration_ms`. El endpoint exige ServiceToken con scope
`mcp:token_exchange` y está throttled (`mcp_audit: 120/min`).

Consulta de auditoría en el VPS:

```bash
docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one -c \
  "SELECT at_created, tool, event, ok, http_status, identity_sub \
     FROM core.mcp_audit ORDER BY at_created DESC LIMIT 20;"
```

### Diagnóstico de scope

- **`mwt_whoami`** (enriquecido): además del perfil, devuelve `mwt_rbac` con
  `tools_permitidas`, `tools_ocultas` y totales — para saber qué puede hacer
  el agente en esta sesión.
- **`mwt_diag_scope(email|user_id)`** (CEO-only): para soporte. Devuelve qué
  legal_entities ve un usuario, su rol, y qué tools le están permitidas/ocultas
  según la matriz `/roles`. Úsala para responder "¿por qué este usuario no ve
  tal tool?" sin tocar código. Backend: `POST /api/auth/mcp-diag/`.

### Rate limit (Eje A4)

Throttle por usuario en el backend (DRF `ScopedRateThrottle`):

| Scope | Rate | Endpoint |
|---|---|---|
| `mcp-token` | 6/min | `POST /api/auth/mcp-token/` (token exchange) |
| `mcp_audit` | 120/min | `POST /api/auth/mcp-audit/` (persistencia) |
| `mcp_diag` | 10/min | `POST /api/auth/mcp-diag/` (diagnóstico) |
| `mcp_health` | 30/min | `GET /api/auth/system-health/` (estado DB/Redis) |

El MCP cachea el JWT de usuario 45 min, así que el token exchange no es un
cuello de botella en sesiones normales.

---

## 3.7 Calidad y contrato (Ola 3.7 · Ejes C1/C2/C5/D1)

### Proyección `campos` (C1)

Todas las tools de detalle soportan `campos` (lista separada por comas) para
proyectar solo los atributos que el agente necesita y ahorrar contexto:
`cliente_obtener`, `producto_obtener`, `oc_obtener`, `expediente_obtener`,
`expediente_lineas`, `expediente_edit_full_get`, `sap_obtener`, `nodo_obtener`,
`transferencia_obtener`, `transfer_costos_listar`, `transfer_liquidacion_preview`,
`pago_obtener`, y los listados (`cliente_listar`, `expediente_listar`, …).

Ejemplo: `expediente_obtener(expediente_id="EXP-1027", campos="id,codigo,estado")`.

La redacción por rol (3.5) se aplica ANTES de proyectar, así que un campo
sensible pedido explícitamente en `campos` se devuelve redactado (`***`).

### Validación de contratos (C2)

`schemas.py` incluye validadores ligeros (no sustituyen al backend) para los
dicts opacos de creación/edición: `validate_cliente_datos/cambios`,
`validate_producto_datos/cambios`, `validate_nodo_datos/cambios`,
`validate_cambios`. Detectan pronto dicts vacíos, campos desconocidos (typos)
y faltas de campos requeridos, con un mensaje que lista los campos permitidos.

### Errores con `hint` (C5)

Todo error de la frontera (`_safe`/`_safe_role`) devuelve
`{error, status, detail, url, hint}`. El `hint` es una guía accionable según el
código HTTP (400 → revisa tipos/campos; 403 → rol/permisos; 404 → id/UUID;
429 → rate limit; 500 → error interno, revisa logs de django).

### `mwt_health` ampliado (D1)

`mwt_health` ahora devuelve: `token_valid` (GET /auth/me/), `db` y `redis`
(GET /api/auth/system-health/ con SELECT 1 + Redis PING, sin tocar datos de
negocio), latencia, y el `healthz` de storage. Útil para detectar token
expirado, DB caída o Redis lento antes de una sesión larga.

---

## 4. Registrar en clientes de IA

### Antigravity / Claude Desktop / Cursor (config JSON `mcpServers`)

```json
{
  "mcpServers": {
    "mwt-one": {
      "command": "python",
      "args": ["-m", "mwt_mcp"],
      "cwd": "/ruta/a/consola_mwt_one/mcp_server",
      "env": {
        "MWT_MCP_TOKEN": "<pega-el-token>",
        "MWT_API_BASE": "https://consola.mwt.one/api"
      }
    }
  }
}
```

### Kimi CLI

```bash
kimi mcp add mwt-one \
  --command python --args "-m,mwt_mcp" \
  --cwd /ruta/a/consola_mwt_one/mcp_server \
  --env MWT_MCP_TOKEN=<pega-el-token> \
  --env MWT_API_BASE=https://consola.mwt.one/api
```

(Para clientes que solo soportan HTTP, usa la Opción B y apunta a `http://<host>:8765/mcp`.)

---

## 5. Flujo operativo de referencia

1. `cliente_crear` / `producto_crear` → catálogo.
2. `expediente_resolve_oc_preview` → `expediente_crear` (operador, líneas, forma de
   pago, plazos duales) → `expediente_apply_pronto_pago`.
3. `documento_subir` (OC/PO) · `proforma_generar` · `sap_analizar`→`sap_confirmar`
   (o `match_subir`→`match_resolver` para balanceo IA).
4. `expediente_fusionar` para agrupar varios SAP/operadores.
5. `expediente_avanzar_estado` / `expediente_phase_durations_set` en el detalle del SAP.
6. `nodo_crear` · `recepcion_crear` (expediente/SKU/talla/cantidad + costos + artefactos).
7. `transferencia_crear` → `transferencia_aprobar`/`despachar`/`recibir`/`conciliar`;
   `transfer_costo_agregar` (DUA/impuestos/gastos), `transfer_artefacto_crear` (AWB/BL),
   `transfer_liquidar`, `transfer_factura_payload` (factura/remisión).
8. `pago_applicables` → `pago_registrar` (entrante/saliente, productos/costos) →
   `pago_conciliar` (recién aquí impacta saldos y crédito).

Empieza siempre con `mwt_whoami` para confirmar que el token está activo.

---

## 6. Skills y ejemplos (Ola 3.8 · Eje G)

- **Skill `mwt-operations`**: `harness/canonical/skills/mwt-operations/SKILL.md`.
  Manual del operador: qué tool usar en cada flujo, en qué orden, anti-patrones
  y cómo leer los errores. Instalable en clientes que soporten skills.
- **Ejemplos completos**: `mcp_server/examples/README.md` — 8 flujos end-to-end
  (alta de cliente/producto, expediente desde OC, SAP/proformas, recepción,
  transferencias, liquidación landed, pagos y diagnóstico de soporte).
- **Seguridad**: `mcp_server/SECURITY.md` — autenticación, las 3 capas de
  protección, catálogo de campos redactados, y procedimientos ante una fuga.

---

## 7. Tests y CI (Ola 3.9 · Ejes H2/H3)

Suite de tests unitarios del MCP (sin red ni backend, con mocks):

```bash
cd mcp_server
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -q --no-header -p no:cacheprovider
```

Cubre: `redact.py` (redacción por rol), `_safe_role` (frontera de errores),
`tool_rbac.py` (RBAC + fail-closed), `jwt_minter.py` (token exchange
fail-closed), auditoría durable, contratos (`campos`/hints/schemas) y el
motor de presentación — **79 tests**.

CI en GitHub Actions (`.github/workflows/mcp-ci.yml`): compila el paquete,
corre la suite y verifica el mapeo de tools en cada push/PR que toque
`mcp_server/`. El deploy a producción lo hace `deploy.yml` (solo `main`).

---

## 8. Presentación — motor server-side (Ola 3.10 ampliada · 5 categorías)

El MCP deja de ser solo-datos: las tools de presentación entregan el resultado
en el formato más útil según la pregunta — imagen, tabla renderizada, reporte,
dashboard o exportación (patrón `antvis/mcp-server-chart` ampliado).

### P1 · Gráficos

| Tool | Input | Uso |
|---|---|---|
| `generar_grafico` | `{tipo, data, opciones}` | Genérica: cualquier serie → line/area/bar/pie |
| `cashflow_chart` | `{semanas?}` | Cashflow proyectado vs real (analytics/cashflow) |
| `margen_marcas_chart` | `{}` | Margen por marca (**CEO-only** en backend) |
| `aging_chart` | `{}` | Aging de cuentas por cobrar (analytics/aging) |
| `exposicion_chart` | `{}` | Exposición por cliente (analytics/exposicion_clientes) |

### P2 · Tablas

| Tool | Input | Uso |
|---|---|---|
| `render_tabla` | `{columnas, filas, titulo?}` | Tabla SVG con branding MWT + `tabla_markdown` |

### P3 · Reportes

| Tool | Input | Uso |
|---|---|---|
| `generar_reporte` | `{titulo, secciones, formato}` | Markdown o PDF firmado (TTL 15 min) |
| `reporte_cobranza` | `{mes, formato?}` | Reporte mensual de cobranza |
| `reporte_expedientes` | `{periodo, formato?}` | Resumen de expedientes |

### P4 · Dashboards

| Tool | Input | Uso |
|---|---|---|
| `dashboard_resumen` | `{periodo?, scope?}` | KPIs + 4 charts en un call |
| `comparar` | `{metricas, grupo}` | Comparativa por marca/cliente/nodo/mes |

### P5 · Exportaciones

| Tool | Input | Uso |
|---|---|---|
| `exportar_xlsx` | `{nombre_archivo, hojas}` | Excel firmado (TTL 15 min) |
| `exportar_csv` | `{nombre_archivo, columnas, filas}` | CSV firmado |

**Arquitectura:** el MCP envía datos puros al backend `POST /api/presentation/render/`
(`kind` = chart|tabla|reporte|xlsx|csv; auth + throttle + `required_action=view`).
El backend genera SVG/PDF/XLSX en Python (`apps/analytics/chart_svg.py`,
`presentation.py`, `reporte_pdf.py`), lo sube a MinIO y devuelve **URL firmada
TTL: 5 min imágenes/tablas, 15 min reportes/exportaciones**.

**Seguridad (ampliada):**
- **Sin SSRF:** el motor recibe SOLO datos puros (nunca URLs ni HTML); opciones
  y tamaños en whitelist (chart ≤5000 filas, tabla ≤500, hojas ≤5).
- **Redacción por rol ANTES de renderizar:** `presentation.py` aplica
  `redact_for_user` a los datos antes de cualquier salida — ningún PNG/PDF/
  tabla/xlsx puede filtrar costos/margen/comisiones que el rol no ve.
- **Escape:** todo texto se escapa en SVG/XML/Markdown (previene inyección).
- **CEO-only:** `margen_marcas_chart` hereda el 403 del backend.
- **RBAC:** las tools de datos → `(analytics, view)`; las genéricas →
  `(dashboard, view)` — la CAPA 1 las filtra por rol.

---

## 9. MWT Builder externo (builder.muito.work) — plantillas de artefactos

El MCP también gestiona el **Builder de plantillas** (`mwt_builder`, backend
Django independiente en `https://builder.muito.work`). Ahí se diseñan los
formularios/artefactos (OC, Proforma, AWB/BL, Packing List, Certificado, etc.)
con secciones, columnas y campos tipados, y luego el MCP de la consola crea
instancias (artefactos) en los nodos/expedientes con `nodo_artefacto_crear`.

### Config (env del MCP)

| Variable | Default | Uso |
|---|---|---|
| `MWT_BUILDER_BASE` | `https://builder.muito.work` | Base del Builder |
| `MWT_BUILDER_USERNAME` | — | Cuenta del builder (login JWT) |
| `MWT_BUILDER_PASSWORD` | — | Password de la cuenta |

### Tools

| Tool | Uso |
|---|---|
| `builder_structure_construir` | Arma un `structure_json` válido desde spec declarativa de secciones/columnas/campos |
| `builder_artefacto_listar` | Lista plantillas del builder (id, title, status, estructura) |
| `builder_artefacto_obtener` | Obtiene una plantilla por id |
| `builder_artefacto_crear` | Crea plantilla (title + `secciones` declarativa) |
| `builder_artefacto_editar` | Edita title/secciones/status de una plantilla |
| `builder_artefacto_eliminar` | Elimina una plantilla (irreversible) |

**Tipos de campo** (los acepta `secciones[].campos[].type`): `text`, `number`,
`textarea`, `date`, `checkbox`, `file`, `select`, `radio`, `code`. Los campos
`select`/`radio` llevan `options` (lista de strings o `{id, label}`).

**RBAC:** módulo `builder` — solo operadores MWT (admin/superadmin). Un
`client_b2b` **no** ve estas tools (no crea plantillas). Migración de permisos:
`backend/sql/H4_builder_modulo_admin_ceo.sql` (idempotente).

### Ejemplo

```
builder_structure_construir(secciones=[
  {"columnas": 2, "campos": [
    {"type": "select", "label": "Tipo de Documento", "options": ["awb", "bl"]},
    {"type": "number", "label": "Cajas Declaradas"},
    {"type": "number", "label": "Cajas Reales"},
    {"type": "date",   "label": "ETA"},
    {"type": "file",   "label": "Packing List (PDF)"},
  ]},
])
→ {"sections": [...]}   # listo para builder_artefacto_crear
```

---

## 10. Finanzas (KPIs, comisiones, margen, devengo) — CEO/Admin

Lee los endpoints de finanzas del backend (`/api/finanzas/overview|comisiones|
commission-by-month|margin-scatter|cliente/<uuid>`). Cálculo "al vuelo":
`commission_rate` (expediente.commission_pct, si no cliente.comision_pct),
`delta_total` = Σ qty × (precio_cliente − precio_mwt) → margen,
`commission_amount` = base × rate (regla DUAL: MWT → base = delta_total;
cliente → base = total_client), `margen_pct` = delta_unit / precio_cliente.

| Tool | Uso |
|---|---|
| `finanzas_overview` | KPIs hero (comisión total/devengada/pendiente/proyectada, margen, %) + top-20 expedientes |
| `finanzas_comisiones` | Lista de expedientes con cálculos; filtra por `client_id` / `estado_devengo` |
| `finanzas_commission_by_month` | Comisión y delta agrupados por mes de pago aproximado |
| `finanzas_margin_scatter` | Puntos margen proyectado vs real por expediente |
| `finanzas_cliente` | Perfil financiero de un cliente (cartera, comisión, devengo) |

**RBAC:** módulo `finanzas` — solo operadores MWT (admin/superadmin) con
`can_read`. El backend además exige `IsCeoOrAdmin` (doble capa). Un `client_b2b`
no ve estas tools. Migración de permisos:
`backend/sql/H5_finanzas_modulo_admin_ceo.sql` (idempotente).

**Uso con pagos:** combinar con `pago_listar(expediente_id)` /
`pago_obtener(pago_id)` para el detalle de anticipos/saldos por expediente.
