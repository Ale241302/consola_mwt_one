-- =====================================================================
-- MWT.ONE · I5_expediente_tracking_carrier.sql
-- Nueva columnas de envío en expedientes.expediente:
--   · tracking  → nº de seguimiento / booking / AWB-BL del envío
--   · carrier   → transportista / línea naviera-aérea
-- (shipment_date, eta, origin_country, destination_country ya existen.)
-- =====================================================================

ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS tracking TEXT,
    ADD COLUMN IF NOT EXISTS carrier  TEXT;
