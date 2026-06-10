-- ═════════════════════════════════════════════════════════════════════
-- E2 · Sprint 2026-06-10 — Backfill freight_mode de expedientes entregados
--
-- Diagnóstico (dump 2026-06-10): EXP-2026-0001 / 0005 / 0006 viajaron por
-- AÉREO (AWB COPA, visible vía ART-05 en la UI) pero su columna
-- freight_mode quedó NULL. phase-stats bucketiza por freight_mode
-- (AIR→Aereo / SEA→Maritimo); con NULL sus muestras caían sólo al agregado
-- "_ALL" y Tránsito (que es modo-específico) nunca heredaba los tránsitos
-- reales (~3.7d) → el Cronograma proyectaba con el estándar de 10d.
--
-- Idempotente: sólo toca filas con freight_mode NULL/'' de esos códigos.
-- ═════════════════════════════════════════════════════════════════════
UPDATE expedientes.expediente
   SET freight_mode = 'AIR'
 WHERE codigo IN ('EXP-2026-0001', 'EXP-2026-0005', 'EXP-2026-0006')
   AND (freight_mode IS NULL OR freight_mode = '')
   AND is_active = TRUE;
