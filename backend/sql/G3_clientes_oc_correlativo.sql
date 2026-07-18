-- =====================================================================
-- G3 · clientes.cliente.oc_correlativo — correlativo de OC por cliente
-- Sprint 2026-07-18
--
-- Cuando el wizard crea una OC SIN número de PO (portal B2B sin archivo
-- / payload sintético), el backend auto-numera con la serie del cliente
-- en vez del fallback OC-AUTO-XXXXXXXX:
--
--   siguiente = GREATEST(cliente.oc_correlativo,
--                        mayor expedientes.oc.codigo numérico del cliente) + 1
--
-- El campo guarda el ÚLTIMO número consumido y es editable desde el
-- formulario de cliente (Condiciones Comerciales) para arrancar o
-- corregir la serie (p.ej. 505244 para Sondel → la próxima es 505245).
-- NULL = sin serie configurada → el wizard cae a OC-AUTO-XXXX.
-- Idempotente.
-- =====================================================================
ALTER TABLE clientes.cliente
    ADD COLUMN IF NOT EXISTS oc_correlativo BIGINT NULL;

COMMENT ON COLUMN clientes.cliente.oc_correlativo IS
    'Último número de OC correlativo consumido para este cliente (G3). La próxima OC auto-numerada = GREATEST(oc_correlativo, mayor OC numérica previa) + 1. Editable desde el form de cliente.';
