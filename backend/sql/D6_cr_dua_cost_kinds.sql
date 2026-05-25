-- ============================================================
-- MWT.ONE · D6_cr_dua_cost_kinds.sql
-- Sprint 2026-05-25 · Costa Rica DUA · catálogo extendido
--
-- Agrega 5 tipos canónicos faltantes para mapear los tributos del
-- DUA Costa Rica (visibles en cualquier "Consulta de Impuestos para
-- el Dua") que antes caían a OTRO y bloqueaban el reporte fiscal:
--
--   • DAI                  → ya existía (91e)
--   • IVA (Ley 9635)       → ya existía (91e)
--   • PROCOMER             ← NUEVO (tasa exportación 0.25% s/CIF)
--   • LEY_6946             ← NUEVO (seguridad ciudadana, 1% s/CIF)
--   • TIMBRE_ARCHIVO       ← NUEVO (Archivo Nacional CR · ₡20 fijo)
--   • TIMBRE_AGENTES       ← NUEVO (Ley 7017 Agentes de Aduana)
--   • TIMBRE_CONTADORES    ← NUEVO (Colegio de Contadores Privados CR)
--
-- Idempotente: ON CONFLICT (codigo) DO NOTHING. Re-ejecutar es no-op.
-- ============================================================

INSERT INTO transfers.cost_kind_cat
       (codigo,             label,                                      descripcion,                                          is_fiscal, color,     orden)
VALUES ('PROCOMER',         'PROCOMER · Tasa exportación',              'Tasa PROCOMER (0.25% s/CIF) — declarada en el DUA', TRUE,      '#7C2D12', 25),
       ('LEY_6946',         'Ley 6946 · Seguridad Ciudadana',           'Timbre Ley 6946 (1% s/CIF) — fiscal CR',             TRUE,      '#B45309', 28),
       ('TIMBRE_ARCHIVO',   'Timbre Archivo Nacional',                  'Timbre del Archivo Nacional CR (₡20 fijo por DUA)',  FALSE,     '#A16207', 35),
       ('TIMBRE_AGENTES',   'Timbre Agentes de Aduana (Ley 7017)',      'Timbre Asociación Agentes de Aduana CR · Ley 7017',  FALSE,     '#CA8A04', 37),
       ('TIMBRE_CONTADORES','Timbre Contadores Privados CR',            'Timbre Colegio de Contadores Privados de Costa Rica',FALSE,     '#D97706', 39)
ON CONFLICT (codigo) DO NOTHING;
