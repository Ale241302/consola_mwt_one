-- ═════════════════════════════════════════════════════════════════════
-- E3 · Sprint 2026-06-11 — Fusión visual de expedientes
--
-- Caso de negocio: una PO del cliente se divide en N partes (p.ej. dos
-- operadas por Muito Work Limitada y una por el cliente). Cada parte es
-- un expediente COMPLETO e independiente (su SAP, su proforma, su OC,
-- sus documentos, su operador, su pipeline). La fusión es SOLO una
-- agrupación visual en el listado /expedientes: los miembros comparten
-- un fusion_id y se renderizan como una fila padre expandible.
--
-- Semántica:
--   · fusion_id    — uuid del grupo. NULL = expediente no fusionado.
--   · fusion_label — etiqueta opcional del grupo (p.ej. la PO común).
--   · NO hay tabla aparte: el grupo existe mientras ≥1 miembro lo
--     referencie. Desfusionar = poner ambos campos en NULL.
--   · Ningún otro módulo (cronograma, portal, finanzas, transferencias,
--     inventario) consume estos campos — cero impacto en su lógica.
--
-- Idempotente · backward-compatible (zero-downtime, rolling deploy).
-- ═════════════════════════════════════════════════════════════════════
ALTER TABLE expedientes.expediente
  ADD COLUMN IF NOT EXISTS fusion_id uuid,
  ADD COLUMN IF NOT EXISTS fusion_label varchar(64);

CREATE INDEX IF NOT EXISTS idx_expediente_fusion_id
  ON expedientes.expediente (fusion_id)
  WHERE fusion_id IS NOT NULL;

COMMENT ON COLUMN expedientes.expediente.fusion_id IS
  'Grupo de fusión visual en /expedientes. Los miembros conservan OC/SAP/proforma/documentos propios; solo se agrupan en el listado.';
COMMENT ON COLUMN expedientes.expediente.fusion_label IS
  'Etiqueta opcional del grupo de fusión (p.ej. la PO común del cliente).';
