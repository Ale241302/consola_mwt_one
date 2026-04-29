-- =====================================================================
-- MWT.ONE · A4d_users_legal_entity_ids.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Usuarios multi-empresa · 2026-04-29
--
-- Antes: users.mwtuser tenía `legal_entity_id UUID` (singular) — un
-- usuario solo podía estar scopeado a UNA empresa.
--
-- Ahora: añade `legal_entity_ids TEXT[]` (array de UUIDs en texto, sin
-- FK física) para que un usuario pueda asignarse a 1..N empresas
-- (incluyendo subsidiarias específicas, ver POL_SUBSIDIARIAS).
--
-- Reglas:
--   · CERO FK física (R6 — cliente vive en otro schema).
--   · legal_entity_id (singular) se mantiene por retrocompat:
--     si está presente, contiene el primer ID del array (empresa
--     "primaria" / scope default del Portal B2B).
--   · El backend (serializer) sincroniza ambos campos en write.
--   · Idempotente · NOT VALID donde aplique.
--
-- Índice: GIN sobre el array para búsquedas rápidas
--   (¿qué usuarios pertenecen al cliente X?).
-- =====================================================================

ALTER TABLE users.mwtuser
    ADD COLUMN IF NOT EXISTS legal_entity_ids TEXT[] DEFAULT '{}'::TEXT[] NOT NULL;

COMMENT ON COLUMN users.mwtuser.legal_entity_ids IS
    'Array de UUIDs (texto) de clientes asignados al usuario. CERO FK '
    'física. Soporta multi-empresa (incluyendo subsidiarias). El campo '
    'singular legal_entity_id queda como alias del primer elemento por '
    'retrocompatibilidad con código legacy (Portal, Wizard, etc.).';

-- Índice GIN para queries "qué usuarios pertenecen al cliente X"
CREATE INDEX IF NOT EXISTS idx_mwtuser_legal_entity_ids_gin
    ON users.mwtuser USING GIN (legal_entity_ids);

-- Backfill: para usuarios que ya tienen legal_entity_id pero array vacío,
-- copiar el singular al array (idempotente — no afecta usuarios ya migrados).
UPDATE users.mwtuser
SET    legal_entity_ids = ARRAY[legal_entity_id::text]
WHERE  legal_entity_id IS NOT NULL
  AND  (legal_entity_ids IS NULL OR cardinality(legal_entity_ids) = 0);

-- =====================================================================
-- FIN A4d_users_legal_entity_ids.sql
-- =====================================================================
