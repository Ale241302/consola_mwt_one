-- ═════════════════════════════════════════════════════════════════════
-- E4 · Sprint 2026-06-11 — Alias visible del header de la OC
--
-- El admin/CEO puede renombrar el código que se muestra en el header del
-- detalle de la OC (/expedientes/{ocId}) y, si lo define, TODOS los
-- roles lo ven (el cliente ve el alias en lugar del número de su OC).
-- Si es NULL, el header cae al comportamiento actual:
--   · ADMIN/CEO → proforma más reciente (o código de la OC)
--   · CLIENT_*  → código de su OC (PO)
--
-- Idempotente · backward-compatible (zero-downtime, rolling deploy).
-- ═════════════════════════════════════════════════════════════════════
ALTER TABLE expedientes.oc
  ADD COLUMN IF NOT EXISTS display_label varchar(64);

COMMENT ON COLUMN expedientes.oc.display_label IS
  'Alias visible del header del detalle de la OC. NULL = comportamiento por defecto (proforma para staff / PO para cliente).';
