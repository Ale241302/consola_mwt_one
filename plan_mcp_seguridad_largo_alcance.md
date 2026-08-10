# Plan de largo alcance — Endurecimiento y evolución del MCP Server MWT.ONE

> **Benchmark de referencia:** [antvis/mcp-server-chart](https://github.com/antvis/mcp-server-chart)
> **Estado base:** MCP monolito 105 tools · RBAC por rol (tool_rbac.py) · token exchange OAuth→JWT (jwt_minter.py) · gateway ContextForge + Authentik · fail-closed identidad · direct_proxy para tools/list en vivo.
> **Fecha:** 2026-08-09

---

## 0. Diagnóstico comparativo (resumen ejecutivo)

| Dimensión | antvis/mcp-server-chart | MWT.ONE MCP | Brecha |
|---|---|---|---|
| Superficie de datos | Charts públicos (sin datos de negocio) | Datos reales: costos, márgenes, comisiones, crédito, precios | **MWT tiene superficie de riesgo mucho mayor** — la seguridad aquí es crítica, no opcional |
| Autenticación | No tiene (público) | OAuth (Authentik) → token exchange → JWT de usuario | MWT **ya supera** a antvis en auth |
| Autorización | N/A | RBAC por rol (matriz `/roles`) + fail-closed | MWT **ya supera** |
| Filtrado de tools | `DISABLED_TOOLS` (env global) | `tool_rbac.py`: **105/105 tools mapeadas** a (módulo, acción) en 10 módulos — filtrado genérico y dinámico por rol | MWT es más granular y completo |
| Proyección de datos sensibles | N/A | `expediente_obtener` trae 60+ campos sin `campos` | **Falta**: campos MWT/CEO no se redactan por defecto |
| Observabilidad/auditoría | N/A | `@write_tool` + log JSON a stderr | Falta: auditoría durable y trazable |
| Rate limiting / abuso | N/A | Ninguno en el gateway | **Falta** |
| Skill de acompañamiento | `chart-visualization-skills` | Ninguno | **Falta** |
| Capacidad de presentación | Genera PNG de charts (URL de imagen) | Solo datos JSON (texto/tablas Markdown) | **Falta**: MCP es de datos, no de presentación |
| README/docs | Excelente | Buena base, incompleta | Mejorable |

**Conclusión:** tu MCP ya tiene la autenticación y el RBAC base correctos. Lo que falta es: **1) no filtrar datos sensibles en la RESPONSIVE de las tools** (hoy `expediente_obtener` puede devolver costos al agente aunque la tool esté permitida), **2) auditoría durable**, **3) protección contra abuso**, y **4) una capa de "saber operar" (skill + documentación)**.

---

## 0b. Evolución: de MCP de DATOS a MCP de PRESENTACIÓN (nuevo)

### 0b.1 La pregunta que motiva esta sección
> "¿En un MCP se puede hacer que ayude a responder a la IA, así como recrear un gráfico cuando le pregunten de tal cosa, o simplemente la IA obtiene la información y ya?"

**Respuesta corta:** ambas cosas son posibles y se complementan. Hoy tu MCP es un MCP **de datos** (la IA obtiene JSON y responde con texto/tablas). Un MCP **de presentación** agrega la capacidad de que la tool devuelva una **URL de imagen/gráfico ya renderizado**, que la IA muestra en su respuesta — exactamente el patrón de `antvis/mcp-server-chart` (tool → servicio de render → PNG → URL → Claude muestra la imagen).

**Las 3 formas en que un MCP puede "ayudar a responder":**
1. **Datos crudos** (lo que tenés hoy): la tool devuelve JSON; la IA formatea texto/tablas.
2. **Imagen renderizada** (lo que agrega esta sección): la tool genera un PNG/SVG y devuelve la URL; la IA la muestra.
3. **Content block de imagen directo** (blob en la respuesta MCP): más frágil; antvis usa URL porque Claude en chat la muestra bien.

### 0b.2 Diseño propuesto — tools de visualización (estilo antvis)

**Nuevo módulo en el MCP:** `mcp_server/mwt_mcp/visualization.py` + 4 tools nuevas en `server.py`.

| Tool | Input | Output | Rol |
|---|---|---|---|
| `generar_grafico` | `{tipo, data, opciones?}` | `{image_url, success, errorMessage}` | Genérica: cualquier serie de datos → PNG/SVG renderizado |
| `dashboard_resumen` | `{periodo, scope?}` | `{kpis, image_urls: {cashflow, margen, aging, exposicion}, resumen}` | Un solo call que trae KPIs + los charts renderizados |
| `cashflow_chart` | `{semanas?}` | `{image_url, data}` | Cashflow de últimas N semanas (usa `analytics/cashflow/`) |
| `margen_marcas_chart` | `{}` | `{image_url, data}` | Margen por marca (usa `analytics/margen_marcas/`) |

**Tipos de gráfico soportados (mapeo a la semántica de antvis):**
```
line, area, bar, column, pie, scatter, radar, funnel, sankey, treemap,
histogram, boxplot, violin, word_cloud, liquid, dual_axes
```

**Contrato de `generar_grafico`:**
```json
{
  "tipo": "line",
  "data": [{"time": "2026-05", "value": 512}, {"time": "2026-06", "value": 1024}],
  "opciones": { "x": "time", "y": "value", "titulo": "Ventas mensuales", "palette": "mwt" }
}
→ { "success": true, "image_url": "https://consola.mwt.one/api/charts/render/<token>.png", "errorMessage": null }
```

### 0b.3 Arquitectura del renderizador server-side

**Problema:** el stack actual no tiene renderizador de charts server-side (el frontend usa SVG manual en `DashboardPrimitives.jsx`/`primitives.jsx`). Para generar PNG hay 2 caminos:

**Opción A (recomendada) — microservicio Node `chart-renderer`:**
```
chart-renderer/            ← NUEVO servicio (Node 20 + express/fastify)
  src/
    index.js               # POST /render -> {type,data,options} -> PNG (blob) o SVG string
    renderers/             # line, bar, pie, radar, sankey... (usa echarts / chart.js SSR)
  package.json
  Dockerfile               # imagen pequeña node:20-alpine
```
- Se agrega al `docker-compose.yml` como servicio `chart-renderer` (red `consola-net`).
- El backend `django` expone `POST /api/charts/render/` que valida auth + rol y reenvía al renderer interno.
- El MCP llama a `POST /api/charts/render/` con su JWT de usuario → recibe `{image_url}` con **URL firmada TTL 5 min** (mismo patrón de storage, nunca una URL pública permanente).

**Opción B (rápida, sin servicio nuevo) — render en Django con SVG:**
- Django genera **SVG** del chart (string) usando un helper puro (sin librería pesada), lo sube a MinIO con key `charts/<uuid>.svg`, y devuelve URL firmada.
- SVG se muestra igual en Claude (lo soporta como imagen), y el render es 100% server-side en Python.
- Menor fidelidad que PNG para charts complejos (radar/sankey), pero cubre line/bar/pie/area.

**Recomendación:** Opción A (microservicio Node con `echarts` o `chart.js` SSR) da la mejor fidelidad y es la misma estrategia de antvis (GPT-Vis-SSR). Si se quiere mínimo esfuerzo, la Opción B (SVG en Django) cubre el 80% de los casos.

### 0b.4 Seguridad específica de la capa de presentación

| Riesgo | Mitigación |
|---|---|
| **SSRF**: el renderizador podría ser abusado para pedir URLs internas | El renderer solo recibe `{type, data, options}` (datos puros), NUNCA URLs. Validación estricta de tipos y tamaño de `data` (max 5000 filas, campos whitelist). |
| **Data leakage en el chart**: el PNG puede mostrar datos que el rol no debería ver | `generar_grafico` aplica `redact_for_role` ANTES de renderizar (Eje B): un manager no puede pedir un chart de márgenes/comisiones con datos que no ve. |
| **URLs firmadas largas/permanentes** | TTL 5 min (mismo patrón que `storage/signed_url`), nunca pública. |
| **Abuso / rate** | Throttle por usuario en `/api/charts/render/` (mismo rate limit del Eje A). |
| **SSRF a través de `options`** | `options` solo acepta keys whitelist (x, y, titulo, palette, width, height). |

### 0b.5 Integración con la IA y el skill

- **Skill `mwt-operations`** (Eje G) se extiende con una sección "Visualización": enseña al agente a elegir el tipo de chart según la pregunta (¿tendencia? → line/area; ¿composición? → pie; ¿distribución? → histogram/boxplot) y a llamar `generar_grafico` con los datos que ya obtuvo de las tools de datos.
- Ejemplo de flujo end-to-end:
```
agente: "mostrame el cashflow de las últimas 12 semanas"
  → tool cashflow_chart({semanas:12})       (usa analytics/cashflow/)
  → devuelve {image_url, data}
  → Claude responde: interpretación en texto + la imagen del chart
```

### 0b.6 Criterios de salida de la capa de presentación

- [ ] `generar_grafico` + `cashflow_chart` + `margen_marcas_chart` + `dashboard_resumen` funcionales y RBAC-scopeados.
- [ ] El renderizador devuelve PNG/SVG en < 2s para ≤ 5000 filas.
- [ ] Los charts respetan `redact_for_role` (un manager NO ve márgenes en el chart).
- [ ] URLs de imagen firmadas con TTL 5 min, sin acceso público permanente.
- [ ] Skill de visualización documentado (tipo de chart ↔ pregunta).

### 0b.7 Herramientas nuevas (resumen)

| # | Tool | Módulo RBAC | Acción |
|---|---|---|---|
| V1 | `generar_grafico` | `dashboard` (o `analytics`) | view |
| V2 | `dashboard_resumen` | `dashboard` | view |
| V3 | `cashflow_chart` | `financiero`/`dashboard` | view |
| V4 | `margen_marcas_chart` | `dashboard` (**CEO-only** vía redacción) | view |

> **Nota:** las tools de visualización son **solo lectura** (`view`). Nunca reciben datos mutables y no crean registros de negocio. Se registran en `TOOL_MODULES` con acción `view` para que el RBAC de la CAPA 1 las filtre igual que al resto.

### 0b.8 Dependencia con el plan actual

- **Depende de la Ola 3.5 (redact.py)**: un chart no puede filtrar datos que el rol no ve, así que la redacción debe estar activa antes de exponer `margen_marcas_chart`/`dashboard_resumen` a roles no-CEO.
- **Depende del Eje A (rate limit)**: `generar_grafico` es un endpoint costoso (render) — debe tener throttle.
- **Depende de storage (URLs firmadas)**: reutiliza `storage/signed_url` + scope de lectura.

---

## 1. Principio rector: "El agente ve y hace solo lo que su rol permite VER y HACER"

Tres capas que se refuerzan (defensa en profundidad):

```
┌─────────────────────────────────────────────────────────────┐
│ CAPA 1 · Lista de tools (tool_rbac.py)                      │
│   El filtrado es GENÉRICO: aplica a las 105 tools por       │
│   (módulo, acción) de la matriz /roles — NO solo a clientes.│
│   Ej: sin expedientes.create → no ve expediente_crear;      │
│       sin transferencias.update → no ve transferencia_editar│  ← ya hecho
├─────────────────────────────────────────────────────────────┤
│ CAPA 2 · Contrato por tool (schemas + redacción de campos)  │
│   Una tool permitida NO puede devolver costos/margen si el   │
│   rol no lo ve. Proyección por rol (campos MWT vs CLIENT).  │  ← GAP PRINCIPAL
├─────────────────────────────────────────────────────────────┤
│ CAPA 3 · Autorización en el backend (403)                   │
│   Si se fuerza una llamada, el backend niega.               │  ← ya hecho (MCP 403)
└─────────────────────────────────────────────────────────────┘
```

> **Aclaración importante (CAPA 1 ya es completa y genérica):**
> El mapeo `TOOL_MODULES` en `tool_rbac.py` cubre **las 105 tools** distribuidas en **10 módulos de negocio** (`expedientes` 39, `transferencias` 21, `nodos` 10, `pagos` 8, `inventario` 7, `clientes` 6, `productos` 6, `storage` 2, `sizing` 1, `marcas` 1), más 4 meta-tools siempre visibles (`mwt_whoami`, `mwt_health`, `mwt_audit_write_registry`, `tipo_cambio`). CERO tools quedan sin mapeo.
>
> **El filtrado funciona igual para todos los módulos y acciones:**
> - Sin `clientes.create` → no ve `cliente_crear`.
> - Sin `expedientes.create` → no ve `expediente_crear`, `expedientes_crear_lote`, `proforma_generar`, `sap_upsert`.
> - Sin `transferencias.update` → no ve `transferencia_editar/aprobar/despachar/recibir/conciliar/cerrar/cancelar`.
> - Sin `pagos.create` → no ve `pago_registrar`, `pago_dry_run`.
> - Sin `inventario.create` → no ve `recepcion_crear`.
> - Sin `nodos.create` → no ve `nodo_crear`, `nodo_artefacto_crear`.
> - Sin `storage.create` → no ve `storage_subir_archivo`.
> - Y así para las 105. Un rol `viewer` (solo lectura) ve únicamente las tools `*.view/*_doc`, un `client_b2b` solo las de los módulos del Portal, etc.
>
> **Lo que el plan agrega (Eje B) NO es el filtrado de tools** (eso ya está y es genérico): es la **redacción de campos CEO_ONLY en la respuesta** de las tools ya permitidas — una capa DISTINTA que resuelve el caso de "manager ve `expediente_obtener` (tool permitida) pero la respuesta trae `unit_cost`/`landed_cost_usd`/`comision_pct` que no debería ver".

---

## 2. Ejes del plan

### Eje A — Seguridad (P0, continuo)

| # | Ítem | Estado | Acción |
|---|---|---|---|
| A1 | Token exchange OAuth→JWT | ✅ | Verificar `identity.py`/`jwt_minter.py` robustos y sin fallback a ServiceToken |
| A2 | **Redacción de campos sensibles por rol en la RESPONSE** | ❌ GAP | **Nuevo módulo `redact.py`** que, según el rol del usuario (`permissions_for_role_exact`), filtra claves sensibles de los dicts que devuelven las tools (ver §3). |
| A3 | Auditoría durable de llamadas MCP | ⚠️ Parcial | Hoy `@write_tool` loguea JSON a stderr. **Elevar a tabla `mcp_audit`** en el backend (DDL versionado) + registro de reads sensibles. |
| A4 | Rate limiting en el gateway | ❌ | Throttle por usuario en ContextForge (si lo soporta) o en el backend `mcp-token`/endpoints. Prevenir abuso del agente. |
| A5 | Rotación de secretos (ServiceToken, DJANGO_SECRET_KEY) | ⚠️ | Alinear con Ola 0 del plan Fugu; el token de servicio debe rotarse y acotarse a scopes. |
| A6 | No exponer URL firmadas sin expiración | ⚠️ | `documento_descargar`/`artefacto_archivo_descargar` ya devuelven TTL — verificar que SIEMPRE sea corto (5 min) y con scope. |
| A7 | Aislamiento de datos entre legal_entities | ⚠️ | `McpTokenView` ya intersecta `legal_entity_ids`. Verificar que NINGUNA tool permita bypassear (¿`?client_id=` spoofing?) — alinear con fix P0 de `_resolve_client_ids` fail-closed. |
| A8 | Hardening del propio server MCP | ⚠️ | Correr como usuario no-root en Docker, sin shell, sin acceso a volúmenes de secretos, `MWT_MCP_READONLY` como kill-switch. |

### Eje B — Información que solo ve Admin/CEO (P0, el corazón de tu pregunta)

**Problema real:** hoy `expediente_obtener` devuelve ~60 campos. Si un rol tiene la tool permitida, el agente ve **todo** lo que devuelve el backend — incluyendo campos que el CEO no querría que un manager/cliente B2B viera (costos, márgenes, comisión, precios MWT, límites de crédito).

**Solución: redacción por rol en la frontera del MCP** (no confiar solo en el backend).

Definir un catálogo de campos **CEO_ONLY / INTERNAL** y una política de redacción:

```python
# redact.py — borrador
CEO_ONLY_KEYS = {
  "unit_price_mwt", "unit_cost", "costo_estandar", "costo_operativo",
  "landed_cost_usd", "cost_share_usd", "margen", "margin", "comision_pct",
  "commission_pct", "credito_limit_usd", "credito_aprobado", "proforma",
  "price_view_mwt", "unit_price",  # en contexto de costo
}
CLIENT_MASK = "***"

def redact_for_role(payload, role_slug, permissions):
    """Recorta/oscurece claves sensibles según el rol."""
    if role_slug in ("superadmin", "admin", "ceo"):
        return payload          # CEO/Admin: acceso total
    if _is_client(role_slug):
        # Cliente B2B: nunca costos/margen/comisiones/precios MWT
        return _strip_keys(payload, CEO_ONLY_KEYS)
    # Manager/operator/finance/viewer: política por módulo (matriz)
    return _strip_keys(payload, _keys_not_in_matrix(payload, permissions))
```

**Regla de negocio (propuesta, alineada con `RoleContext.jsx` del frontend):**
- **superadmin / admin / ceo** → todo.
- **manager** → ve costos del expediente pero NO márgenes/comisiones globales.
- **operator** → ve operación (estados, líneas, documentos) pero NO rentabilidad interna.
- **finance** → ve pagos/crédito pero NO comisiones.
- **compras** → ve catálogos/precios de compra pero NO márgenes de venta.
- **viewer** → read-only, sin rentabilidad.
- **client_b2b** → solo lo que el Portal B2B expone (nunca costos, márgenes, comisiones, proveedores).

**Dónde aplicar:** en un wrapper que envuelve `_safe()` de cada tool, o en `client.py` `_handle()` (frontera central). **Lo más robusto: en `client.py._handle()`**, para que NINGUNA tool pueda devolver campos CEO_ONLY a un rol no permitido.

### Eje C — Calidad de la información (P1)

| # | Ítem | Acción |
|---|---|---|
| C1 | **Paginación/proyección consistente** | Ya hay `limit/offset/campos` en listados (2.17). Extender proyección de `campos` a TODAS las tools de detalle (`expediente_obtener(campos)` ya existe). |
| C2 | **Contratos Pydantic completos** (2.16) | Completar schemas para los `dict` opacos restantes (`datos`, `cambios`, `payload`). Meta: docstrings de 1 línea. |
| C3 | **Respuestas canónicas** | Definir shape estable por entidad (documentar qué devuelve cada tool) para que el agente no "adivine". |
| C4 | **Validación de coherencia** (1.13) | Que el MCP advierta descuadres (total vs líneas, unit_cost=0 en cerrado) — alinear con backend. |
| C5 | **Errores estructurados** | Normalizar el shape de error `{error, status, detail, url}` ya existente + añadir `hint` de cómo arreglarlo. |

### Eje D — Herramientas: usos, tokens, comandos especiales (P1)

| # | Ítem | Estado | Acción |
|---|---|---|---|
| D1 | `mwt_health` | ✅ | Ya existe (2.22). Ampliar: verificar expiración del token, latencia, y estado de Redis/DB sin tocar datos. |
| D2 | `mwt_whoami` | ✅ | Ya existe. **Mejorar**: devolver qué tools le están PERMITIDAS y cuáles ocultas (diagnóstico útil). |
| D3 | **Idempotencia real** (2.20) | ⚠️ | `expediente_crear`, `pago_registrar`, `transferencia_crear` — verificar que el backend dedup devuelve 200 en reintentos (ya hay `idempotency_key`). |
| D4 | **Tokens / comandos especiales del agente** | ❌ | Definir convenciones: prefijo `mwt_` para meta-tools; comandos tipo `/mwt:liquidation` no aplican en MCP — en su lugar, **skills** (ver Eje G). |
| D5 | **Tools de diagnóstico** | ❌ | Añadir `mwt_diag_scope(usuario)` (CEO-only): qué legal_entities ve un usuario, qué tools, qué permiso le falta. Imprescindible para soporte. |
| D6 | **Bulk/batch** | ⚠️ | `expedientes_crear_lote` existe. Evaluar `cliente_crear_lote`, `documento_subir_lote`. |

### Eje E — Fuga de información (P0)

| # | Riesgo | Mitigación |
|---|---|---|
| E1 | `campos` mal usado o tool que devuelve todo | Redacción central en `client.py._handle()` (Eje B) — es la red de seguridad definitiva. |
| E2 | URLs firmadas en logs/auditoría | `_AUDIT_REDACT` ya tapa `key`, `storage_url`, `file_path`. Verificar también `signed_url`. |
| E3 | Errores que filtran stack traces/URLs internas | `_safe` ya devuelve `detail` — verificar que no exponga rutas internas del servidor. |
| E4 | `mwt_whoami` exponiendo legal_entities de OTRO tenant | Scope-check por JWT — ya hecho, re-verificar. |
| E5 | Campos anidados (dict dentro de líneas) | `_strip_keys` debe ser **recursivo** (buscar claves CEO_ONLY en todos los niveles). |
| E6 | Paginación que permite enumerar todo | Rate limit + scope por legal_entity (A7). |

### Eje F — Privacidad de datos (P1)

| # | Ítem | Acción |
|---|---|---|
| F1 | **Datos personales (PII)** | Los clientes B2B tienen `contact_email`, `phone`. Definir política: un rol client_b2b NO ve PII de otros clientes (ya lo fuerza el scope). Documentar en README. |
| F2 | **Retención de auditoría** | Tabla `mcp_audit` con TTL/retención definida (¿90 días?) y redacción de PII en logs. |
| F3 | **Consentimiento/transparencia** | Documentar en el portal qué datos ve el agente MCP del cliente. |
| F4 | **No registrar bodies sensibles** | `_audit_sanitize` ya redacta `password`, `token`, `evidencia`, `documento_sap`. Ampliar con `tax_id`, `contact_email`, `phone`, `cedula`. |

### Eje G — Skills y documentación (P2)

| # | Ítem | Acción |
|---|---|---|
| G1 | **Skill `mwt-operations`** (estilo `chart-visualization-skills`) | Skill Markdown que le enseña al agente: qué tool usar en cada flujo, en qué orden, anti-patrones. Instalable via `npx skills add`. |
| G2 | **README a nivel antvis** | Diagrama de arquitectura, tabla de tools por dominio/rol, tabla de permisos, ejemplos de uso, sección de seguridad. |
| G3 | **Guía de seguridad** | Documento `SECURITY.md` del MCP: cómo se autentica, qué protege cada capa, qué hacer ante una fuga. |
| G4 | **Ejemplos reales** | 5-10 flujos completos documentados (crear OC → expediente → documentos → SAP → transferencia → liquidación → pago). |

### Eje H — Operación y mantenimiento (P1)

| # | Ítem | Acción |
|---|---|---|
| H1 | **Versión y changelog del MCP** | `__init__.py` tiene `__version__`; añadir `CHANGELOG.md` del MCP. |
| H2 | **Tests del MCP** | No hay suite. Añadir tests unitarios de `redact.py`, `schemas.py`, `tool_rbac.py`, `jwt_minter.py` (fail-closed). |
| H3 | **CI** | GitHub Action que compile el MCP + corra tests de redacción/RBAC en cada PR. |
| H4 | **Healthcheck del container MCP** | Ya existe (`mwt_health`). Verificar que el Docker healthcheck del compose use algo similar. |

---

## 3. Detalle del GAP principal (Eje B): redacción por rol — implementación

### 3.1 Nuevo archivo: `mcp_server/mwt_mcp/redact.py`

```python
"""Redacción de campos sensibles por rol en la frontera del MCP.

Política (alineada con RoleContext.jsx del frontend y con la matriz /roles):
  superadmin / admin / ceo  -> acceso total
  manager                   -> ve costos de expediente, NO márgenes/comisiones globales
  operator                  -> operación, NO rentabilidad interna
  finance                   -> pagos/crédito, NO comisiones
  compras                   -> catálogos/precios de compra, NO márgenes de venta
  viewer                    -> read-only, sin rentabilidad
  client_b2b                -> SOLO lo del Portal (nunca costos/margen/comisión/proveedor)

Uso: se invoca desde client.py._handle() para que NINGUNA tool pueda filtrar
campos CEO_ONLY a un rol no autorizado. Es la red de seguridad definitiva:
aunque una tool devuelva todo, aquí se recorta.
"""
from __future__ import annotations

import copy

# Claves que SOLO CEO/Admin pueden ver, en cualquier nivel del payload.
CEO_ONLY_KEYS = {
    "unit_price_mwt", "unit_cost", "costo_estandar", "costo_operativo",
    "cost_share_usd", "landed_cost_usd", "unit_landed_cost_usd",
    "margen", "margin", "real_margin", "projected_margin",
    "comision_pct", "commission_pct", "commission_amount",
    "credito_limit_usd", "credito_aprobado", "credito_usado_interno",
    "price_view", "unit_price",  # solo se redacta si está bajo clave costo
    "internal_notes", "notas_internas",
}

# Claves que tampoco ve un client_b2b (PII + costos + proveedores).
B2B_FORBIDDEN_KEYS = CEO_ONLY_KEYS | {
    "supplier_id", "proveedor_id", "supplier_name", "proveedor_nombre",
    "contact_email", "phone", "cedula", "tax_id",
}

def is_ceo_or_admin(role: str) -> bool:
    return (role or "").strip().lower() in ("superadmin", "admin", "ceo")

def is_client(role: str) -> bool:
    r = (role or "").strip().lower()
    return r.startswith("client_") or r in ("cliente", "client")

def _strip(value, forbidden: set):
    """Recursivo: oscurece claves prohibidas en dicts y listas."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            lk = (k or "").lower()
            if lk in forbidden:
                out[k] = "***"
            else:
                out[k] = _strip(v, forbidden)
        return out
    if isinstance(value, list):
        return [_strip(v, forbidden) for v in value]
    return value

def redact_for_role(payload, role: str):
    """Devuelve el payload redactado según el rol. CEO/Admin -> sin cambios."""
    if is_ceo_or_admin(role):
        return payload
    forbidden = B2B_FORBIDDEN_KEYS if is_client(role) else CEO_ONLY_KEYS
    return _strip(copy.deepcopy(payload), forbidden)
```

### 3.2 Integración en `client.py._handle()` (frontera central)

```python
# client.py
from .identity import current_identity
from .redact import redact_for_role

def _handle(resp):
    if resp.status_code >= 400:
        raise MwtApiError(resp.status_code, _parse(resp), str(resp.request.url))
    if resp.status_code == 204:
        return {"ok": True, "status": 204}
    data = _parse(resp)
    # Frontera de redacción: recorta campos CEO_ONLY según el rol del usuario.
    # Solo aplica cuando hay identidad de usuario; sin identidad (ServiceToken
    # directo) el agente ya no debería existir en producción.
    identity = current_identity()
    if identity.is_present:
        # rol se resuelve del JWT minteado (perfiles_for_role_exact del backend)
        from .jwt_minter import get_identity_user
        user = get_identity_user() or {}
        role = user.get("role") or user.get("role_slug") or ""
        data = redact_for_role(data, role)
    return data
```

> **Nota importante:** el rol se resuelve de `get_identity_user()` (que hace token exchange y ya cachea). Esto añade una dependencia: `_handle` pasaría a ser async o debe aceptar el rol resuelto. **Diseño alternativo más limpio:** envolver cada tool con `_safe_role(role, call)` que resuelve el rol UNA vez por llamada y redacta el resultado. Recomiendo esto en lugar de tocar `_handle` (que es síncrono y no conoce el rol).

### 3.3 Wrapper `_safe_role` (recomendado)

```python
# server.py — reemplaza _safe en las tools que devuelven datos sensibles
def _safe_role(call):
    """Ejecuta + redacta por rol. CEO/Admin sin cambios."""
    def run():
        data = call()
        user = get_identity_user() or {}
        role = user.get("role") or user.get("role_slug") or ""
        return redact_for_role(data, role)
    try:
        return run()
    except MwtApiError as e:
        return {"error": True, "status": e.status, "detail": e.payload, "url": e.url}
    except Exception as e:
        return {"error": True, "detail": str(e)}
```

**Migración:** cambiar `_safe(...)` → `_safe_role(...)` en las tools que devuelven datos de negocio (expedientes, clientes, transferencias, costos, liquidación, proformas, nodos, inventario, pagos). Las meta-tools (`mwt_*`) no necesitan redacción.

---

## 4. Orden de ejecución (Olas)

### Ola 3.5 — Seguridad de datos (1-2 semanas) — P0
1. Crear `redact.py` + catálogo de campos CEO_ONLY/B2B.
2. Crear `_safe_role` y migrar las ~60 tools de negocio.
3. Tests unitarios de `redact.py` (CEO ve todo, client_b2b no ve costos, recursivo en líneas anidadas).
4. Verificar E2/E3 (redacción en logs, errores sin rutas internas).

### Ola 3.6 — Auditoría durable + rate limit (1-2 semanas) — P0/P1
1. Tabla `mcp_audit` (DDL versionado en `backend/sql/`) + endpoint/repo.
2. Registrar reads sensibles (quién vio qué expediente con costo) + writes (ya hay `@write_tool`).
3. Rate limit por usuario en el backend (`mcp-token` + endpoints de lectura pesada).
4. `mwt_diag_scope` (CEO-only).

### Ola 3.7 — Calidad y contrato (2 semanas) — P1
1. Completar Pydantic schemas (C2).
2. Proyección `campos` en todas las tools de detalle (C1).
3. Errores con `hint` (C5).
4. `mwt_whoami` enriquecido (D2).

### Ola 3.8 — Skills + documentación (1 semana) — P2
1. Skill `mwt-operations` (G1).
2. README a nivel antvis con diagrama + tabla de permisos (G2).
3. `SECURITY.md` del MCP (G3).
4. Ejemplos de flujos completos (G4).

### Ola 3.9 — Operación (1 semana) — P1
1. Tests del MCP (H2) + CI (H3).
2. CHANGELOG del MCP (H1).
3. Revisión Docker hardening (A8).

### Ola 3.10 — Capa de presentación (2-3 semanas) — P2
1. **Renderizador server-side**: crear `chart-renderer/` (Opción A: Node + echarts SSR) o helper SVG en Django (Opción B). Empezar con line/bar/pie/area.
2. **Endpoint `POST /api/charts/render/`** en backend: auth + rol + throttle + reenvío al renderer + URL firmada TTL 5 min.
3. **Módulo MCP `visualization.py`** + 4 tools (`generar_grafico`, `dashboard_resumen`, `cashflow_chart`, `margen_marcas_chart`).
4. **Registrar en `TOOL_MODULES`** con acción `view` (RBAC CAPA 1 las filtra).
5. **`redact_for_role` aplicado ANTES de renderizar** (depende de Ola 3.5).
6. **Skill de visualización** en `mwt-operations` (tipo de chart ↔ pregunta).
7. Tests: render < 2s, redacción en chart, URLs firmadas TTL.

---

## 5. Riesgos transversales

1. **Redacción agresiva puede romper flujos legítimos del agente** (CEO que necesita costos). → Política por rol probada; CEO/Admin intacto.
2. **`redact_for_role` en `client.py._handle` añadiría una llamada de token exchange** por request. → Usar el wrapper `_safe_role` (rol resuelto una vez por llamada, cacheado 45 min en `jwt_minter`).
3. **Compatibilidad de shape**: oscurecer con `"***"` en vez de eliminar la clave preserva el shape (el agente no rompe al esperar el campo).
4. **Añadir `get_identity_user()` en tools de solo lectura** puede fallar si no hay identidad → fallback: sin identidad = ServiceToken puro = no redactar (pero en producción el gateway siempre propaga identidad).
5. **Auditoría sensible**: la tabla `mcp_audit` debe redactar PII y URLs firmadas (reusar `_audit_sanitize`).

---

## 6. Métricas de éxito

| Métrica | Meta |
|---|---|
| Campos CEO_ONLY filtrados | 100% en roles no-admin (tests) |
| Fugas de datos cross-tenant | 0 (test de scope por legal_entity) |
| Llamadas auditadas | 100% de writes + reads sensibles |
| Tiempo de respuesta `mwt_health` | < 500ms |
| README/skill completos | 100% de flujos documentados |
| Tests del MCP | ≥ 40 tests verdes en CI |
| **Render de chart** | **< 2s para ≤ 5000 filas (Ola 3.10)** |
| **Charts RBAC-scopeados** | **0 charts con datos CEO_ONLY a rol no-admin (Ola 3.10)** |
| **URLs de imagen** | **100% firmadas TTL ≤ 5 min (Ola 3.10)** |
| **Tools de visualización** | **4 tools view-scopeadas, 0 fugas (Ola 3.10)** |

---

## 7. Conclusión

Tu MCP ya tiene la columna vertebral correcta: **autenticación OAuth real, token exchange con identidad, y RBAC por rol** (algo que antvis ni siquiera tiene porque su server es público). El salto de nivel que falta es **no confiar en el backend para proteger datos sensibles**: la redacción de campos CEO_ONLY en la frontera del MCP (Eje B) es el cambio de mayor impacto, seguido de auditoría durable y protección contra abuso. Con eso, tu MCP no solo iguala sino que supera a antvis en robustez, y queda listo para operar datos reales de negocio con clientes B2B.

*Fin del plan.*
