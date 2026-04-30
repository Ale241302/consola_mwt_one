-- =====================================================================
-- MWT.ONE · 91l_transfers_notes_log.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v3.5 · 2026-04-30
--
-- Agrega columna notes_log JSONB a transfers.transferencia para guardar
-- el ledger de notas (cada nota: {id, text, created_at, created_by}).
-- Reemplaza el campo notes (TEXT plano) que solo permitía 1 nota.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill conservador.
-- =====================================================================

ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS notes_log JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN transfers.transferencia.notes_log IS
    'Ledger de notas operativas. Cada elemento: '
    '{id: uuid, text: string, created_at: ISO8601, created_by_name: string}. '
    'Append-only desde el FE; eliminación via filter is_active=false en '
    'el objeto JSON. Reemplaza el campo `notes` plano.';

-- Backfill: si la transferencia tiene `notes` (texto antiguo) pero
-- notes_log está vacío, migramos como una sola nota con timestamp =
-- created_at de la transferencia.
UPDATE transfers.transferencia
   SET notes_log = jsonb_build_array(
        jsonb_build_object(
            'id',         gen_random_uuid()::text,
            'text',       notes,
            'created_at', COALESCE(created_at, NOW())::text,
            'created_by_name', COALESCE(created_by_name, '')
        )
    )
 WHERE notes IS NOT NULL
   AND notes <> ''
   AND (notes_log IS NULL OR notes_log = '[]'::jsonb);

-- Verificación
SELECT
    codigo,
    LENGTH(COALESCE(notes, ''))            AS legacy_chars,
    jsonb_array_length(notes_log)          AS notes_count
  FROM transfers.transferencia
 WHERE is_active = TRUE
 ORDER BY created_at DESC
 LIMIT 10;

-- =====================================================================
-- FIN 91l_transfers_notes_log.sql
-- =====================================================================
