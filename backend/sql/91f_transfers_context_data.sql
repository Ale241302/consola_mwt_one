-- =====================================================================
-- MWT.ONE · 91f_transfers_context_data.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v2 · 2026-04-29
-- Metadata condicional por motivo legal (ENT_OPS_TRANSFERS).
--
-- Cada `legal_context` necesita información distinta:
--   · INTERNAL        → { carrier_name, vehicle_plate, vehicle_id, conductor_name }
--   · NATIONALIZATION → { bl_awb_number, dua_number }     (los costos van en cost_line)
--   · EXPORT          → { international_carrier, container_number, awb_bl_number }
--   · DISTRIBUTION    → { transfer_pricing_amount, transfer_pricing_currency,
--                         transfer_pricing_basis, requires_tp_approval,
--                         crosses_border, awb_bl_number }
--   · CONSIGNMENT     → { report_frequency, contract_ref, awb_bl_number }
--
-- Decisión de diseño: usamos JSONB en lugar de columnas dedicadas porque
--   1. La forma cambia por motivo y la mayoría serían NULL.
--   2. Permite extender campos en el futuro sin migration.
--   3. Postgres soporta queries y GIN index sobre JSONB.
-- La validación de shape mínimo vive en el serializer DRF.
--
-- Reglas MWT respetadas:
--   · Idempotente (IF NOT EXISTS).
--   · Sin FKs.
--   · Soft-delete vía is_active de la tabla padre (no aplica aquí).
-- =====================================================================

ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS context_data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN transfers.transferencia.context_data IS
    'Metadata específica del legal_context. Shape varía por motivo: '
    'INTERNAL → {carrier_name, vehicle_plate, conductor_name}; '
    'NATIONALIZATION → {bl_awb_number, dua_number}; '
    'EXPORT → {international_carrier, container_number, awb_bl_number}; '
    'DISTRIBUTION → {transfer_pricing_amount, transfer_pricing_currency, '
    'requires_tp_approval, crosses_border}; '
    'CONSIGNMENT → {report_frequency, contract_ref}.';

-- Índice GIN para consultas tipo "qué transfers tienen contenedor X"
-- o "cuáles requieren aprobación de transfer pricing".
CREATE INDEX IF NOT EXISTS idx_trf_context_data_gin
    ON transfers.transferencia USING gin (context_data);

-- Índice parcial sobre el flag de aprobación de transfer pricing
-- (consulta caliente: "transfers de distribución pendientes de aprobación TP").
CREATE INDEX IF NOT EXISTS idx_trf_requires_tp_approval
    ON transfers.transferencia ((context_data->>'requires_tp_approval'))
    WHERE legal_context = 'DISTRIBUTION';

-- =====================================================================
-- FIN 91f_transfers_context_data.sql
-- =====================================================================
