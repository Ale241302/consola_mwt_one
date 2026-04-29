-- =====================================================================
-- MWT.ONE · 91g_transfers_landed_cost.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v3 · 2026-04-29
-- Motor de Liquidación / Landed Cost.
--
-- Cuando una transferencia cruza fronteras o régimen fiscal, llega al
-- nodo destino con costos incrementales (aranceles, flete, seguros,
-- maniobras). Este script añade lo necesario para CALCULAR el "Landed
-- Cost" por línea (FOB + porción prorrateada de costos extras) y dejarlo
-- congelado en cada `linea` antes de que el inventario impacte al destino.
--
-- Mapeo prompt → schema real (las entidades ya existen):
--   ops_transfers       → transfers.transferencia
--   ops_transfer_lines  → transfers.linea
--   ops_transfer_cost_lines → transfers.cost_line
--
-- Estado previo:
--   · 90_transfers.sql              → tabla base
--   · 91_transfers_audit.sql        → BLOQUE 3 (transicion_cat, etc.)
--   · 91e_transfers_cost_lines.sql  → cost_line, total_cost_usd, view pool
--   · 91f_transfers_context_data.sql → context_data por motivo legal
--
-- Este script AGREGA:
--   1. linea.landed_cost_usd        → costo unitario al ingresar al destino
--   2. linea.cost_share_usd         → porción prorrateada del costo extra
--   3. transferencia.liquidated_at, liquidated_by_id, liquidated_by_name
--   4. transferencia.dua_document_id, awb_document_id (refs a docs)
--   5. View v_transfer_liquidation   → precálculo del reporte
--
-- Reglas MWT respetadas:
--   · CERO FK física.
--   · Idempotente.
--   · Cálculo canónico vive en app layer (Django); SQL solo soporta data.
-- =====================================================================

-- ────────────────────────────────────────────────────────────
-- 1. linea.landed_cost_usd + cost_share_usd
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.linea
    ADD COLUMN IF NOT EXISTS landed_cost_usd  NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS cost_share_usd   NUMERIC(14,4);

COMMENT ON COLUMN transfers.linea.landed_cost_usd IS
    'Costo unitario PUESTO EN DESTINO en USD. Calculado en /liquidate/: '
    'unit_value + (cost_share_usd / qty_transfer). NULL = sin liquidar.';
COMMENT ON COLUMN transfers.linea.cost_share_usd IS
    'Porción TOTAL del prorrateo de costos extra que cae sobre esta '
    'línea (no per-unit). cost_share_usd / qty_transfer = adder unitario.';


-- ────────────────────────────────────────────────────────────
-- 2. Audit fields de liquidación en transferencia
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS liquidated_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS liquidated_by_id      UUID,
    ADD COLUMN IF NOT EXISTS liquidated_by_name    VARCHAR(128),
    ADD COLUMN IF NOT EXISTS dua_document_id       UUID,
    ADD COLUMN IF NOT EXISTS awb_document_id       UUID,
    ADD COLUMN IF NOT EXISTS liquidation_method    VARCHAR(16) DEFAULT 'BY_VALUE';
    -- BY_VALUE | BY_QUANTITY | BY_VOLUME (MVP solo soporta BY_VALUE)

COMMENT ON COLUMN transfers.transferencia.liquidated_at IS
    'Timestamp de cuando se ejecutó /liquidate/. NULL = no liquidada.';
COMMENT ON COLUMN transfers.transferencia.dua_document_id IS
    'UUID del DUA en transferencia_documento. Sin FK.';
COMMENT ON COLUMN transfers.transferencia.awb_document_id IS
    'UUID del BL/AWB en transferencia_documento. Sin FK.';
COMMENT ON COLUMN transfers.transferencia.liquidation_method IS
    'Estrategia de prorrateo. BY_VALUE = por valor FOB (default).';


-- ────────────────────────────────────────────────────────────
-- 3. Vista v_transfer_liquidation
--    Precalcula totales por transferencia para reportes y BI.
--    El cálculo CANÓNICO sigue siendo Django/calcular_liquidacion();
--    esta vista es solo para queries ad-hoc / dashboards.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW transfers.v_transfer_liquidation AS
WITH lineas_agg AS (
    SELECT
        l.transferencia_id,
        SUM(l.qty_transfer)                                AS units_total,
        SUM(l.qty_transfer * COALESCE(l.unit_value, 0))    AS fob_total_usd,
        SUM(COALESCE(l.cost_share_usd, 0))                 AS cost_share_total_usd,
        SUM(l.qty_transfer * COALESCE(l.landed_cost_usd, 0))   AS landed_total_usd,
        COUNT(*)                                           AS lines_count
    FROM transfers.linea l
    WHERE l.is_active = TRUE
    GROUP BY l.transferencia_id
),
costs_agg AS (
    SELECT
        c.transferencia_id,
        SUM(c.amount_usd)                                                   AS extra_costs_total_usd,
        SUM(c.amount_usd) FILTER (WHERE c.kind IN ('DAI','IVA'))             AS taxes_total_usd,
        SUM(c.amount_usd) FILTER (WHERE c.kind IN ('FLETE','CONSOLIDACION')) AS freight_total_usd,
        SUM(c.amount_usd) FILTER (WHERE c.kind IN ('AGENCIAMIENTO','MANIPULEO')) AS customs_ops_usd,
        SUM(c.amount_usd) FILTER (WHERE c.kind = 'ALMACENAJE')               AS warehousing_usd,
        SUM(c.amount_usd) FILTER (WHERE c.kind IN ('SEGURO','OTRO'))         AS other_usd,
        COUNT(*)                                                            AS cost_lines_count
    FROM transfers.cost_line c
    WHERE c.is_active = TRUE
    GROUP BY c.transferencia_id
)
SELECT
    t.id                                                AS transfer_id,
    t.codigo,
    t.legal_context,
    t.estado,
    t.origen_id, t.origen_label,
    t.destino_id, t.destino_label,
    t.dua_document_id, t.awb_document_id,
    t.liquidated_at, t.liquidation_method,

    COALESCE(la.units_total, 0)                         AS units_total,
    COALESCE(la.lines_count, 0)                         AS lines_count,
    COALESCE(la.fob_total_usd, 0)                       AS fob_total_usd,

    COALESCE(ca.extra_costs_total_usd, 0)               AS extra_costs_total_usd,
    COALESCE(ca.taxes_total_usd, 0)                     AS taxes_total_usd,
    COALESCE(ca.freight_total_usd, 0)                   AS freight_total_usd,
    COALESCE(ca.customs_ops_usd, 0)                     AS customs_ops_usd,
    COALESCE(ca.warehousing_usd, 0)                     AS warehousing_usd,
    COALESCE(ca.other_usd, 0)                           AS other_usd,
    COALESCE(ca.cost_lines_count, 0)                    AS cost_lines_count,

    -- Landed cost total = FOB + costos extra (cuando ya está liquidada,
    -- esto debería igualar la suma de qty * landed_cost_usd por línea).
    COALESCE(la.fob_total_usd, 0) + COALESCE(ca.extra_costs_total_usd, 0)
                                                        AS landed_total_calc_usd,
    COALESCE(la.landed_total_usd, 0)                    AS landed_total_persisted_usd,

    CASE WHEN COALESCE(la.units_total, 0) > 0
         THEN ROUND(
             (COALESCE(la.fob_total_usd, 0) + COALESCE(ca.extra_costs_total_usd, 0))
             / la.units_total, 4)
         ELSE NULL
    END                                                 AS avg_landed_per_unit_usd
FROM transfers.transferencia t
LEFT JOIN lineas_agg la ON la.transferencia_id = t.id
LEFT JOIN costs_agg  ca ON ca.transferencia_id = t.id
WHERE t.is_active = TRUE;

COMMENT ON VIEW transfers.v_transfer_liquidation IS
    'Reporte BI de liquidación por transferencia. Visibility=INTERNAL '
    '(POL_VISIBILIDAD: clientes B2B no acceden a esta vista).';


-- =====================================================================
-- FIN 91g_transfers_landed_cost.sql
-- =====================================================================
