-- ═════════════════════════════════════════════════════════════════════
-- E5 · Sprint 2026-06-11 — Auditoría Fable5 (checklist #4)
-- Índices en columnas UUID de vinculación LÓGICA (la arquitectura no
-- usa FKs físicas, así que Postgres no crea índices implícitos y cada
-- JOIN/WHERE por estas columnas era un seq scan).
--
-- 100% idempotente y a prueba de drift de esquema: cada índice se crea
-- SOLO si la tabla y la columna existen (information_schema), así el
-- entrypoint nunca falla aunque un módulo previo no esté aplicado.
-- Backward-compatible (CREATE INDEX no bloquea lecturas en tablas de
-- este tamaño; zero-downtime en el deploy rolling).
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp._mwt_idx(
  p_schema text, p_table text, p_cols text[], p_index text, p_where text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  col text;
BEGIN
  IF to_regclass(format('%I.%I', p_schema, p_table)) IS NULL THEN
    RETURN;  -- tabla no existe en esta instalación → omitir
  END IF;
  FOREACH col IN ARRAY p_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = p_schema AND table_name = p_table
         AND column_name = col
    ) THEN
      RETURN;  -- columna faltante → omitir este índice
    END IF;
  END LOOP;
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)%s',
    p_index, p_schema, p_table,
    (SELECT string_agg(format('%I', c), ', ') FROM unnest(p_cols) AS c),
    COALESCE(' WHERE ' || p_where, '')
  );
END;
$fn$;

-- ── expedientes.linea — la consultan el listado (saps por expediente),
--    OCDetail (líneas por OC) y confirm-sap ──────────────────────────
SELECT pg_temp._mwt_idx('expedientes','linea', ARRAY['oc_id'],         'idx_linea_oc_id');
SELECT pg_temp._mwt_idx('expedientes','linea', ARRAY['expediente_id'], 'idx_linea_expediente_id');
SELECT pg_temp._mwt_idx('expedientes','linea', ARRAY['producto_id'],   'idx_linea_producto_id');
SELECT pg_temp._mwt_idx('expedientes','linea', ARRAY['expediente_id','sap'], 'idx_linea_exp_sap');

-- ── expedientes.documento — chips REF del listado (kind=PROFORMA/OC),
--    Documentos comerciales de OCDetail/FusionDetail ─────────────────
SELECT pg_temp._mwt_idx('expedientes','documento', ARRAY['oc_id'],              'idx_documento_oc_id');
SELECT pg_temp._mwt_idx('expedientes','documento', ARRAY['expediente_id','kind'],'idx_documento_exp_kind');

-- ── pipeline.event_log — phase-stats y Cronograma lo recorren por
--    agregado + orden temporal ────────────────────────────────────────
SELECT pg_temp._mwt_idx('pipeline','event_log', ARRAY['aggregate_id','created_at'], 'idx_event_log_agg_created');

-- ── finance.payment — filtros del listado de pagos (OC/expediente/
--    transferencia/nodo) ──────────────────────────────────────────────
SELECT pg_temp._mwt_idx('finance','payment', ARRAY['oc_id'],            'idx_payment_oc_id');
SELECT pg_temp._mwt_idx('finance','payment', ARRAY['expediente_id'],    'idx_payment_expediente_id');
SELECT pg_temp._mwt_idx('finance','payment', ARRAY['transferencia_id'], 'idx_payment_transferencia_id');

-- ── transfers.cost_line — landed cost y costos por OC/nodo ───────────
SELECT pg_temp._mwt_idx('transfers','cost_line', ARRAY['transferencia_id'], 'idx_cost_line_transferencia_id');

-- ── inventario.expediente_nodo_assignment — nodo por línea (factura-
--    payload LATERAL, shipping-summary, transfers) ────────────────────
SELECT pg_temp._mwt_idx('inventario','expediente_nodo_assignment', ARRAY['expediente_id'],    'idx_ena_expediente_id');
SELECT pg_temp._mwt_idx('inventario','expediente_nodo_assignment', ARRAY['transferencia_id'], 'idx_ena_transferencia_id');

-- ── expedientes.expediente — scope dual del listado por rol ──────────
SELECT pg_temp._mwt_idx('expedientes','expediente', ARRAY['client_id'],            'idx_expediente_client_id');
SELECT pg_temp._mwt_idx('expedientes','expediente', ARRAY['operating_company_id'], 'idx_expediente_operating_company_id');
SELECT pg_temp._mwt_idx('expedientes','expediente', ARRAY['oc_id'],                'idx_expediente_oc_id');

DROP FUNCTION IF EXISTS pg_temp._mwt_idx(text, text, text[], text, text);
