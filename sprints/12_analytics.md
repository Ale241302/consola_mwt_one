# Sprint 12 · Analytics — Dashboard CEO y Métricas de Negocio

## 1. Propósito
Cockpit operativo: KPIs del CEO (cash en riesgo, margen ponderado, reloj de crédito, TACoS, R1+), heatmap de tallas, top SKUs/clientes, scatter margen real vs proyectado, feed de actividad y el dashboard cliente (banda B2B).

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `analytics` (`93_schema_extensions.sql`, `94_pipeline_financiero_portal.sql`, `94b_portal_analytics_audit.sql`, `D3_amazon_ads_schema.sql`).
*   **Backend**: app `analytics` (endpoints `dashboard_kpis`, `aging`, `urgent`, `inventory_coverage_by_node`, `top_skus_margen`, `r1_correction_ratio`, `activity`); `expedientes/phase-stats` (tiempos por fase).
*   **Frontend**: `Dashboard.jsx` (~850 líneas, bandas 1-4 + banda cliente), `hooks/useDashboardKpis.js`, `components/dashboard/ClientDashboard.jsx`, `SafeWidget`, `Cronograma.jsx` (stats), card Tiempos operativos de `Expedientes.jsx`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `useDashboardKpis`: ¿cuántos endpoints dispara en paralelo al montar? Consolidar los que comparten agregados base.
- [ ] `dashboard_kpis`/`aging`/`top_skus_margen`: `EXPLAIN ANALYZE`; agregaciones sobre líneas/pagos con índices por fecha y `is_active`.
- [ ] `phase-stats`: full scan de `pipeline.event_log` (compartido con sprint 03) — una sola fuente para Dashboard, Cronograma y Tiempos operativos.
- [ ] Heatmap tallas: agregado global 365d — ventana e índice.
- [ ] FX Frankfurter: cachear el tipo de cambio (no por widget).

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `SafeWidget` ya aísla fallos por widget — extender el patrón a la banda cliente (`ClientDashboard` tiene loading/error propios; verificar).
- [ ] "Actualizar" (reload bajo demanda): doble click no debe duplicar fetches.
- [ ] Dashboard ↔ Expedientes rápido: el hook no debe setear estado tras desmontar (cablear abort cuando exista signal).
- [ ] Banda cliente: una sola pasada de carga (fix 2026-06-11) — mantener invariante.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** lista los endpoints del mount del Dashboard con tiempos (waterfall).
2. **Backend** propone consolidación + cache corto (30-60s) para KPIs costosos; **SQL** indexa los agregados.
3. Cierre: mount completo del Dashboard CEO < 2s con datos reales; cliente < 1.5s.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (transversal)** — ErrorBoundary por ruta + SafeWidget por widget: un crash de un panel ya no deja el Dashboard en blanco.
- ✅ **CORREGIDO (WAVE B)** — `useDashboardKpis`: patrón `alive` + cleanup (los wrappers no aceptan opciones, así que se aplicó la alternativa de guard) — sin setState tras desmontar; `reload` manual intacto.
- ✅ **VERIFICADO OK (WAVE B)** — `Dashboard.jsx:279`: el guard `Array.isArray(marginScatter)` YA existía en main; falso positivo del barrido.
- ✅ **NUEVO (WAVE C)** — Observabilidad self-hosted: `analytics.client_error_log` + `POST/GET /analytics/client-errors/` (GET staff-only) — equivalente Sentry sin dependencia externa, alimentado por ErrorBoundary y listeners globales.
- ✅ **HEREDADO** — `phase-stats` con índice nuevo `event_log(aggregate_id, created_at)` (E5) acelera Tiempos operativos, Cronograma y export.
