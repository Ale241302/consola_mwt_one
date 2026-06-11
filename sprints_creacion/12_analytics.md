# Creación 12 · Analytics — Dashboard y Métricas de Negocio

## Objetivo
El cockpit del CEO y el dashboard del cliente: KPIs en vivo (expedientes activos, cash en riesgo, margen ponderado, reloj de crédito, TACoS, % R1+), heatmap de tallas, top SKUs/clientes, urgentes, inventario por nodo, feed de actividad y tiempos por fase.

## Base de datos (schema `analytics`)
*   `analytics.activity`: id, user_id, tipo, ref_type/ref_id, payload jsonb, created_at (idx DESC).
*   Extensiones/vistas de agregación (`93`, `94`, `94b`) y `D3_amazon_ads_schema.sql` (TACoS).
*   Sin tablas nuevas para KPIs: se AGREGAN sobre expedientes/lineas/payments/event_log con los índices de E5; materializar solo si el volumen lo exige.

## Backend (app `analytics`)
*   Endpoints de solo lectura: `dashboard_kpis`, `aging`, `urgent` (top 10), `inventory_coverage_by_node`, `top_skus_margen`, `top_clients`, `r1_correction_ratio`, `size_market_heatmap`, `activity` (cursor `?since=` + límite), `margin_scatter`.
*   Cada endpoint: UN agregado SQL, ventana temporal parametrizable, cache corto (30-60s) para los costosos; FX (Frankfurter) cacheado server-side.
*   `expedientes/phase-stats` (general y `?client=`) alimenta Tiempos operativos y Cronograma — una sola fuente de verdad.

## Frontend
*   **Ver registros (es el módulo de lectura)**: `/dashboard` — bandas CEO (KPIs, heatmap, operación, análisis) todas con `SafeWidget` (un widget caído no tumba el resto) + banda CLIENTE (`ClientDashboard`: KPIs de su operación, próximas entregas, pipeline) — carga en UNA pasada.
*   **Crear/Editar/Eliminar**: no aplica a los KPIs (read-only). El feed de actividad permite "marcar leído" (bulk, sprint 10). Filtros del dashboard (período/marca/mercado) editables y persistidos en localStorage.
*   **Ver detalle**: drill-down — click en cualquier registro navega al detalle real (OC/expediente/nodo).
*   Botón “Actualizar” = refresh bajo demanda (sin polling agresivo); doble click no duplica fetches.

## Criterios de aceptación
- [ ] Mount del dashboard CEO < 2s y cliente < 1.5s con datos reales.
- [ ] Cada KPI declara su endpoint y muestra empty-state honesto si no hay datos.
- [ ] CLIENT no recibe ningún agregado financiero interno (R3 server-side).
