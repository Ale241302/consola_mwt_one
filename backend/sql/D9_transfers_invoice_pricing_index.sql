-- =====================================================================
-- MWT.ONE · D9_transfers_invoice_pricing_index.sql
-- Agente responsable: [AG-BACKEND / SQL]
-- Sprint 2026-06-01 · Factura/Remisión por audiencia (MWT vs Cliente).
--
-- Contexto
-- --------
-- La generación de la Factura/Remisión de una transferencia resuelve, por
-- línea, el precio congelado en expedientes.linea (unit_price_mwt /
-- unit_price_client) mediante un lookup por la tupla
--   (expediente_id, producto_id, COALESCE(size,'')).
-- Ese mismo patrón ya lo usa TransferenciaViewSet.retrieve() y ahora
-- también invoice_payload (_resolve_line_pricing). NO hay cambio de
-- esquema: las columnas de precio ya existen en expedientes.linea
-- (creadas por C0/D5). Este archivo solo agrega un índice compuesto para
-- que el batch IN (...) sea un index scan en vez de seq scan.
--
-- Idempotente · backward-compatible · zero-downtime
-- -------------------------------------------------
-- CREATE INDEX IF NOT EXISTS no falla si ya existe. La tabla
-- expedientes.linea es pequeña (líneas por expediente), por lo que el
-- lock de creación es despreciable; no se usa CONCURRENTLY porque el
-- entrypoint aplica los .sql dentro de su runner transaccional.
-- =====================================================================

CREATE INDEX IF NOT EXISTS linea_exp_prod_size_active_idx
    ON expedientes.linea (expediente_id, producto_id, size)
    WHERE is_active = TRUE;

-- Verificación opcional (no rompe si el índice ya estaba):
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'expedientes' AND tablename = 'linea'
--    AND indexname = 'linea_exp_prod_size_active_idx';
