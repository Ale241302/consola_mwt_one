-- ============================================================
-- MWT.ONE · B3_builder_artifact_transferencia.sql
-- Sprint 2026-05-14 · Fase 16 — Artefactos del Builder en una
--                                transferencia inter-nodos.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (CEO):
--   "Una transferencia mueve stock origen→destino y va acompañada
--    de documentación: factura comercial interna, BL/AWB, remisión,
--    DUA, contratos 3PL. El admin debe poder agregar artefactos
--    del Builder a la transferencia con un alcance específico
--    (expedientes + líneas) — idéntico patrón al wizard de recepción."
--
-- Decisión de diseño: en vez de crear una tabla nueva
-- `transfers.builder_artifact_instance`, AMPLIAMOS la tabla existente
-- `nodos.builder_artifact_instance` con una columna `transferencia_id`
-- nullable. Razones:
--   1. Una instancia puede vivir a nivel nodo (recepción) o
--      transferencia (move) — la diferencia es semántica, no de schema.
--   2. Reutilizamos índices, trigger updated_at, gin sobre data, y
--      todos los endpoints existentes.
--   3. Migración trivial (ALTER ADD COLUMN nullable). Backward-compat.
--
-- Filas existentes quedan con transferencia_id = NULL → "artefacto de
-- nodo, sin transferencia asociada" (semántica pre-fase 16, idéntica).
-- Filas nuevas creadas desde el endpoint de transfer cargan el UUID.
-- ============================================================

ALTER TABLE nodos.builder_artifact_instance
    ADD COLUMN IF NOT EXISTS transferencia_id UUID;

COMMENT ON COLUMN nodos.builder_artifact_instance.transferencia_id IS
    'Sprint 2026-05-14 fase 16 · Si el artefacto se creó desde el detalle '
    'de una transferencia (/transferencias/{id}), apunta a transfers.transferencia. '
    'NULL si el artefacto vive solo a nivel nodo (recepción/inventario).';

-- Índice parcial — solo cuando hay transferencia, para listar rápido
-- los artefactos de una transferencia dada.
CREATE INDEX IF NOT EXISTS nbai_transferencia_idx
    ON nodos.builder_artifact_instance (transferencia_id)
    WHERE transferencia_id IS NOT NULL AND is_active = TRUE;

-- ============================================================
-- FIN B3_builder_artifact_transferencia.sql
-- ============================================================
