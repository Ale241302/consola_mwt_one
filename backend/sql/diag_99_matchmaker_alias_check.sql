-- =====================================================================
-- MWT.ONE · diag_99_matchmaker_alias_check.sql
-- Agente responsable: [AG-DATABASE]
--
-- Script de DIAGNÓSTICO (no DDL · no idempotente · solo SELECTs).
-- Sirve para entender por qué el Document Matchmaker no aplicó el alias
-- `75BPR29-CLIMM-CPAP` de SonDel S.A en la OC PO-504802 del expediente
-- EXP-2026-0015.
--
-- Hipótesis #1 a refutar/confirmar: la OC se subió ANTES de que el alias
-- fuera registrado en `productos.product_client_alias`. El match_log es
-- inmutable (su `mismatch_payload` se persiste una sola vez en el
-- POST /upload-match/), así que registrar el alias DESPUÉS no recalcula
-- las 10 discrepancias previas.
--
-- ─── USO ───────────────────────────────────────────────────────────────
--   1) Edita los dos `\set` de abajo con los UUIDs reales. Si vienen
--      desde la URL /expedientes/<UUID>, ése es el `exp_id`. El `cli_id`
--      lo sacas con:
--         SELECT id FROM clientes.cliente
--          WHERE razon_social ILIKE '%SonDel%' LIMIT 1;
--
--   2) Desde el VPS, en /opt/consola-mwt-one:
--         docker compose exec -T postgres \
--           psql -U mwt -d mwt_one \
--           < backend/sql/diag_99_matchmaker_alias_check.sql
--
-- ─── INTERPRETACIÓN ────────────────────────────────────────────────────
--   · Si A devuelve `existe = TRUE` → la tabla canónica vive ahí.
--   · Si B devuelve `match_strategy = "UNRESOLVED"` para las 10 líneas
--     y el `created_at` es ANTERIOR al alias_registered_at de C →
--     hipótesis #1 confirmada. Fix: re-subir el mismo PDF de la OC.
--   · Si B devuelve `match_strategy = "ALIAS_EXACT/CLIENT_PART_BASE"`
--     pero la UI sigue mostrando 10 discrepancias → bug en frontend
--     (cache stale del log_id). Fix: refrescar /resolver-discrepancias.
--   · Si B devuelve `UNRESOLVED` y el `created_at` es POSTERIOR al alias
--     → bug real en `_resolve_oc_lines_to_canonical`. Manda el JSON de
--     `ai_lines_resolved` para análisis.
-- =====================================================================

-- ⚠️  EDITAR ESTOS DOS UUIDS ANTES DE EJECUTAR ⚠️
\set exp_id '1359a8e4-XXXX-XXXX-XXXX-XXXXXXXXXXXX'
\set cli_id '1c160671-XXXX-XXXX-XXXX-XXXXXXXXXXXX'

\echo '═══════════════════════════════════════════════════════════════'
\echo ' MWT.ONE · Matchmaker Alias Diagnostic                          '
\echo '═══════════════════════════════════════════════════════════════'
\echo ''
\echo '→ Expediente :' :exp_id
\echo '→ Cliente    :' :cli_id
\echo ''

-- ─────────────────────────────────────────────────────────────────────
-- A) ¿Existe la tabla canónica del matchmaker?
-- ─────────────────────────────────────────────────────────────────────
\echo '─── A) ¿Existe expedientes.document_match_log? ──────────────────'
SELECT
    to_regclass('expedientes.document_match_log') IS NOT NULL                AS document_match_log_existe,
    to_regclass('productos.product_client_alias') IS NOT NULL                AS product_client_alias_existe,
    to_regclass('expedientes.expediente')         IS NOT NULL                AS expediente_existe;

-- ─────────────────────────────────────────────────────────────────────
-- B) Última corrida del matchmaker para esta OC: qué extrajo la IA y
--    qué hizo el resolver con cada línea.
-- ─────────────────────────────────────────────────────────────────────
\echo ''
\echo '─── B) Líneas extraídas + resolver output (top 3 logs) ──────────'
SELECT
    id,
    document_filename,
    discrepancies_count,
    is_perfect_match,
    is_resolved,
    created_at,
    -- Líneas extraídas con el match_strategy que les puso el resolver:
    jsonb_pretty(
        jsonb_agg(
            jsonb_build_object(
                'client_part_number', l->>'client_part_number',
                'supplier_ref',       l->>'supplier_ref',
                'base_code',          l->>'base_code',
                'talla',              l->>'talla',
                'sku',                l->>'sku',
                'match_strategy',     l->>'match_strategy',
                'match_score',        l->>'match_score',
                'matched_producto_id', l->>'matched_producto_id'
            )
        )
    ) AS ai_lines_resolved
  FROM expedientes.document_match_log,
       jsonb_array_elements(COALESCE(ai_raw_payload->'lines','[]'::jsonb)) AS l
 WHERE expediente_id = :'exp_id'::uuid
   AND document_type = 'ART-01_OC'
   AND is_active     = TRUE
 GROUP BY id, document_filename, discrepancies_count, is_perfect_match, is_resolved, created_at
 ORDER BY created_at DESC
 LIMIT 3;

-- ─────────────────────────────────────────────────────────────────────
-- C) La prueba reina: ¿cuándo se subió la OC vs cuándo se registró el
--    alias? Si oc_uploaded_at < alias_registered_at, el resolver corrió
--    con un catálogo de aliases vacío para este cliente.
-- ─────────────────────────────────────────────────────────────────────
\echo ''
\echo '─── C) Timeline OC vs Alias ─────────────────────────────────────'
WITH timeline AS (
    SELECT
        (SELECT MAX(created_at)
           FROM expedientes.document_match_log
          WHERE expediente_id = :'exp_id'::uuid
            AND document_type = 'ART-01_OC'
            AND is_active     = TRUE)                                        AS oc_uploaded_at,
        (SELECT MAX(created_at)
           FROM productos.product_client_alias
          WHERE alias       = '75BPR29-CLIMM-CPAP'
            AND cliente_id  = :'cli_id'::uuid
            AND is_active   = TRUE)                                          AS alias_registered_at
)
SELECT
    oc_uploaded_at,
    alias_registered_at,
    CASE
        WHEN oc_uploaded_at IS NULL                          THEN 'OC nunca subió por matchmaker'
        WHEN alias_registered_at IS NULL                     THEN 'Alias no existe para este cliente'
        WHEN oc_uploaded_at < alias_registered_at            THEN 'BUG DE SECUENCIA → re-subir la OC arregla'
        WHEN oc_uploaded_at >= alias_registered_at           THEN 'BUG DE CÓDIGO → revisar resolver'
    END                                                                      AS diagnostico,
    EXTRACT(EPOCH FROM (alias_registered_at - oc_uploaded_at)) / 60.0        AS gap_minutos
  FROM timeline;

-- ─────────────────────────────────────────────────────────────────────
-- D) BONUS: ¿el resolver puede ver el alias HOY mismo? (simula el
--    SELECT que corre `_load_catalog_index` cuando recibe cliente_id.)
-- ─────────────────────────────────────────────────────────────────────
\echo ''
\echo '─── D) Aliases visibles HOY para este cliente ───────────────────'
SELECT a.id::text                                   AS alias_id,
       UPPER(a.alias)                               AS alias_upper,
       a.is_active                                  AS alias_active,
       a.cliente_sku,
       p.id::text                                   AS producto_id,
       p.sku                                        AS producto_sku,
       p.nombre                                     AS producto_nombre,
       COALESCE(p.is_active, TRUE)                  AS producto_active,
       a.created_at                                 AS alias_created_at
  FROM productos.product_client_alias a
  JOIN productos.producto p ON p.id = a.producto_id
 WHERE a.cliente_id = :'cli_id'::uuid
   AND a.is_active  = TRUE
 ORDER BY a.created_at DESC;

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo ' FIN diag_99_matchmaker_alias_check.sql                         '
\echo '═══════════════════════════════════════════════════════════════'
