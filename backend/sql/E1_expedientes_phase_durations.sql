-- ═════════════════════════════════════════════════════════════════════
-- E1 · Sprint 2026-06-10 — Días por fase del expediente (override manual)
--
-- Columna JSONB con los días por fase fijados manualmente por Admin/CEO:
--   {"REGISTRO": 3, "PRODUCCION": 12, "TRANSITO": 10, ...}
--
-- Semántica:
--   · La duración REAL por fase se deriva del EventLog (pipeline.event_log,
--     phase_to + created_at). Esta columna sólo guarda OVERRIDES manuales.
--   · El detalle del expediente y el Cronograma del Resumen de Exportación
--     priorizan el override sobre la duración derivada (gráficas, promedios
--     por método de envío y proyección de fases futuras).
--   · Editable únicamente por ADMIN/CEO (POL_VISIBILIDAD) vía
--     PATCH /api/expedientes/{id}/phase-durations/.
--
-- Idempotente · backward-compatible (zero-downtime, rolling deploy).
-- ═════════════════════════════════════════════════════════════════════
ALTER TABLE expedientes.expediente
  ADD COLUMN IF NOT EXISTS phase_durations_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN expedientes.expediente.phase_durations_json IS
  'Overrides manuales de días por fase {"FASE": dias} — admin/CEO. Prioriza sobre la duración derivada del EventLog en el Cronograma del export.';
