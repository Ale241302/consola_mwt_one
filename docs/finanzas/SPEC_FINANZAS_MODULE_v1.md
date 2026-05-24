# SPEC · Módulo Finanzas CEO-ONLY · v1.0

> **Sprint**: 2026-05-24
> **Estado**: MVP entregado · gráficos y subpáginas en deuda diferida
> **Agentes**: orquestación Opus 4.7 · backend + frontend ejecutados secuencialmente (no en paralelo por restricciones de stack real)
> **Visibilidad**: CEO-ONLY · no expuesto a CLIENT_*

---

## 1. Contexto

El CEO solicitó construir un módulo Finanzas que cruzara:

1. Comisiones MWT (delta entre `unit_price_client` y `unit_price_mwt` × `commission_rate`)
2. Margen ponderado por expediente
3. Calendario de devengo (cuándo MWT cobra la comisión)
4. Perfil financiero por cliente

El prompt original asumía Next.js + TypeScript + RLS + `mwt-knowledge-hub`, pero el stack real es **Vite + React + JSX** con `operating_company_id` (no tenant_id) y sin RLS. Este SPEC documenta lo construido contra el stack real.

---

## 2. Arquitectura entregada

### Backend (`backend/apps/finanzas/`)

| Archivo | Líneas | Propósito |
|---|---|---|
| `__init__.py` | 0 | App marker |
| `apps.py` | 18 | AppConfig (label `finanzas`) |
| `permissions.py` | 31 | `IsCeoOrAdmin` — bloquea CLIENT_* con 403 |
| `views.py` | 280 | 3 endpoints + helpers de cálculo al vuelo |
| `urls.py` | 13 | Rutas `/api/finanzas/...` |

**Endpoints (todos `IsCeoOrAdmin`):**
- `GET /api/finanzas/overview/` → 4 KPIs hero + items top-20 + counts
- `GET /api/finanzas/comisiones/` → lista paginada con filtros `?client_id&estado_devengo`
- `GET /api/finanzas/cliente/<uuid:client_id>/` → perfil financiero del cliente

**Registro:**
- `backend/config/settings.py` línea ~90: `'apps.finanzas'` agregado a `INSTALLED_APPS`
- `backend/config/urls.py`: `path("api/", include("apps.finanzas.urls"))` agregado tras `apps.finance.urls`

### Frontend (`frontend/src/pages/Finanzas.jsx`)

- Página única (366 líneas) con 4 KPI cards + tabla de comisiones + filtro por estado de devengo
- Helpers locales: `formatPct`, `formatMoney`, `formatExpedienteId`, `formatDate`
- Badge de devengo con 6 estados (`PROYECTADA`, `DEVENGABLE`, `DEVENGADA`, `VENCIDA`, `MIXTO`, `SIN_TASA`)
- Visibilidad: vía `AdminOnlyRoute` en `App.jsx` (CLIENT_* redirige a `/ai`) + backend 403 como defensa de segunda línea

**Registro:**
- `frontend/src/App.jsx` — `<Route path="/finanzas" element={<AdminOnlyRoute><ScreenFinanzas /></AdminOnlyRoute>} />`
- `frontend/src/components/layout/Sidebar.jsx`:
  - `KEY_TO_PATH.finanzas = '/finanzas'`
  - `screenFromPath()` detecta `/finanzas`
  - Item en `allItems` con `group: 'commercial'`, icono `IconDollar`
- `frontend/src/02_i18n.jsx` — labels `'Finanzas'` (ES) y `'Finance'` (EN)

CLIENT_* no ve el ítem porque `finanzas` no está en `CLIENT_ALLOWED_MODULES` del `RoleContext`. ADMIN/superadmin sí.

---

## 3. Reglas de cálculo (autoritativas)

### 3.1 Tasa de comisión

```
commission_rate = COALESCE(expediente.commission_pct, cliente.comision_pct)
```

- **Fuente primaria**: `cliente.comision_pct` (decimal `0..1`, ej `0.1200` = 12%)
- **Override por expediente**: `expediente.commission_pct` (mismo formato) — gana sobre el del cliente si está poblado
- Si AMBOS son `NULL` → `devengo_estado = SIN_TASA`, `commission_amount = null` en API, UI muestra `—` con tooltip "Cliente sin comision_pct"

### 3.2 Delta y comisión

```
delta_unit  = unit_price_client - unit_price_mwt
delta_total = SUM(qty × delta_unit)      -- por expediente, sobre líneas is_active
commission_amount = delta_total × commission_rate
margen_pct  = delta_total / total_client  -- ponderado del expediente, NULL si total_client=0
```

### 3.3 Estado de devengo

| Estado | Condición |
|---|---|
| `SIN_TASA` | `commission_rate IS NULL` |
| `DEVENGADA` | `total_paid > 0 AND balance == 0` (proxy hasta que exista `commission_settled_at`) |
| `PROYECTADA` | sin `shipment_date` ni `eta` |
| `DEVENGABLE` | `fecha_pago_cliente_a_marluvas <= hoy < fecha_devengo_esperada` |
| `VENCIDA` | `fecha_devengo_esperada <= hoy` y no pagado |

Fórmula de fecha de devengo (constante `BUFFER_RECONCILIACION = 10` días):

```
base = shipment_date OR eta
fecha_pago_cliente_a_marluvas = base + credit_days_cliente
fecha_pago_marluvas_a_mwt     = fecha_pago_cliente_a_marluvas + credit_days_mwt
fecha_devengo_esperada        = fecha_pago_marluvas_a_mwt + 10 días
```

### 3.4 Filtro por operating_company

Solo se incluyen expedientes con `operating_company_id = MWT_OPERATING_CLIENT_ID` (constante en `apps.core.constants`). Otros expedientes (operados directamente por el cliente) **no entran** al cálculo de comisión — quedan para una eventual tabla "sin comisión MWT" (deuda diferida).

---

## 4. Decisiones tomadas (sin preguntar al CEO)

| Decisión | Razón |
|---|---|
| Stack adaptado a Vite + React + JSX | El prompt asumía Next.js + TypeScript; el repo es JSX (CLAUDE.md §1) |
| No usar `tenant_id` ni RLS | `operating_company_id` es el patrón real (memoria `feedback_mwt_tenancy_and_quantities`) |
| Sin MV `mv_linea_finanzas` para MVP | Cálculo al vuelo con un solo JOIN; cuando supere 1000 expedientes activos, migrar a MV |
| Sin Recharts | No está instalado; instalarlo requiere rebuild `npm install`. Gráficos en deuda diferida |
| Sin subpáginas /margen, /devengo, /cliente/[id] | MVP focused en Overview + tabla. Endpoints backend ya existen |
| Sin export CSV/XLSX | Tabla nativa por ahora; export en sprint siguiente |
| Sin auditoría `audit_log` | El backend genera logs standard de DRF; auditoría dedicada en sprint siguiente |
| Sin tests pytest/vitest/Playwright | Sprint corto; añadir en próximo deploy estable |
| Reusar `IsCeoOrAdmin` propio | El sistema no tiene `IsCEO` estándar; permission custom resuelve `role in ('superadmin','admin','ceo')` |
| Item en grupo 'commercial' del sidebar | Encaja con Clientes/Marcas/Productos. No requiere grupo nuevo |
| Iconno `IconDollar` | Único icono financiero disponible en `lib/icons.jsx`; sin instalar Lucide |

---

## 5. Deuda diferida (sprints siguientes)

**Priorizada por impacto:**

1. **Gráficos** (recharts):
   - Bar stacked "Comisión por mes" (12m rolling)
   - Bar horizontal "Top 10 clientes por comisión"
   - Scatter "Margen por SKU" (vol × margen, tamaño = $)
   - Heatmap "SKU × Talla" (color = margen %)
   - Timeline calendario de devengo
2. **Subpáginas**:
   - `/finanzas/margen` con pivot SKU/Talla/Cliente
   - `/finanzas/devengo` con calendario mensual
   - `/finanzas/cliente/[clientId]` con tabs (comisión, salud crediticia, pool, expedientes, mix)
3. **Export**: `POST /api/finanzas/export/` con MinIO signed URL
4. **Materialized View**: `mv_linea_finanzas` refrescada por Celery cada 5 min + invalidación al evento `payment.registered`
5. **Audit log dedicado**: `audit_log` con `actor_id, action, ip, ts, payload_hash` al hit a `/api/finanzas/*`
6. **`commission_settled_at`** en `linea` + trigger / hook de Celery cuando `payment.registered` cubre la comisión
7. **Override `expediente.commission_pct`** — ya existe campo en DB; UI para configurarlo
8. **Indicador en UI** `*` cuando `commission_rate_source = 'expediente.commission_pct'` (override) — ya implementado en tabla
9. **Pool de crédito en perfil cliente** — leer `kpis_pool` de `/api/clientes/<id>/` y mostrar tarjeta consolidada con subsidiarias
10. **i18n keys dedicadas**: hoy las strings están inline en `Finanzas.jsx`; mover a `02_i18n.jsx` para mantener convención del repo
11. **Tests**: pytest backend ≥85%, vitest unit para helpers, Playwright e2e flujo CEO completo
12. **OpenAPI**: anotar endpoints con drf-spectacular para `/api/finanzas/schema/`
13. **Constante `BUFFER_RECONCILIACION`** en settings.py en vez de hardcoded `10`
14. **Tabla "sin comisión MWT"** — expedientes con `operating_company_id != MWT` para ver volumen sin afectar cálculo

---

## 6. Comandos de deploy

```bash
# Desde tu máquina local (git add SELECTIVO)
cd ~/OneDrive/Documents/consola_mwt_one
git add backend/apps/finanzas/
git add backend/config/settings.py
git add backend/config/urls.py
git add frontend/src/pages/Finanzas.jsx
git add frontend/src/App.jsx
git add frontend/src/components/layout/Sidebar.jsx
git add frontend/src/02_i18n.jsx
git add docs/finanzas/SPEC_FINANZAS_MODULE_v1.md
git commit -m "feat(finanzas): modulo CEO-ONLY · KPIs comisiones + tabla devengo · MVP"
git push origin main
```

```bash
# En el VPS
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
git pull origin main
bash scripts/redeploy_vps.sh
```

---

## 7. Verificación post-deploy

1. Login como ADMIN/CEO → en el sidebar, sección "Comercial", aparece **Finanzas** con icono `$`.
2. Click → carga `/finanzas` con:
   - 4 KPI cards (Comisión total, Devengada, Pendiente, Margen $/Margen %)
   - Si hay expedientes operados por MWT con `cliente.comision_pct` configurado: tabla poblada.
   - Si no, mensaje "No hay expedientes operados por MWT".
3. API check directo:
   ```bash
   TOKEN="<jwt-admin>"
   curl -s -H "Authorization: Bearer $TOKEN" https://consola.mwt.one/api/finanzas/overview/ | jq .kpis
   ```
4. Verificar 403 para cliente:
   ```bash
   TOKEN_CLI="<jwt-client>"
   curl -s -H "Authorization: Bearer $TOKEN_CLI" -w "%{http_code}" https://consola.mwt.one/api/finanzas/overview/
   # Esperado: 403
   ```
5. Verificar que el ítem **NO aparece** en sidebar para CLIENT_*.

---

## 8. Archivos tocados (changelog)

**Nuevos:**
- `backend/apps/finanzas/__init__.py`
- `backend/apps/finanzas/apps.py`
- `backend/apps/finanzas/permissions.py`
- `backend/apps/finanzas/views.py`
- `backend/apps/finanzas/urls.py`
- `frontend/src/pages/Finanzas.jsx`
- `docs/finanzas/SPEC_FINANZAS_MODULE_v1.md`

**Modificados:**
- `backend/config/settings.py` (+1 línea en `INSTALLED_APPS`)
- `backend/config/urls.py` (+1 línea include)
- `frontend/src/App.jsx` (+2 líneas import + Route)
- `frontend/src/components/layout/Sidebar.jsx` (+3 cambios: KEY_TO_PATH, screenFromPath, allItems)
- `frontend/src/02_i18n.jsx` (+2 keys: `finanzas` en ES y EN)

**No tocados (legacy, no afecta producción):**
- `frontend/src/04_shell.jsx` — sidebar legacy
- `frontend/src/15_app_root.jsx` — router legacy

---

## 9. Riesgos conocidos

- **Cálculo al vuelo escala a O(expedientes × líneas)** — con 100 expedientes × 50 líneas = 5000 filas escaneadas por request. A 60s de caché esto es manejable, pero por encima de 1000 expedientes activos la MV es obligatoria.
- **`commission_amount` en NULL** se trata como `0` en los agregados de KPI. Si quieres comportamiento estricto (excluir del total devengable), filtrar antes del sum.
- **`AdminOnlyRoute` redirige a `/ai`** — si el cliente intenta `/finanzas` directo, va a `/ai` (no a `/login`). Coherente con el patrón existente.
- **POL_VISIBILIDAD R3**: backend hace 403 incluso si alguien (admin defectuoso) muestra el item en sidebar. Defense in depth funciona.

— Fin de SPEC v1.0
