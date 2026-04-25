-- =====================================================================
-- MWT.ONE · 10b_nodos_relax.sql · Hace opcionales los campos que el
--          formulario "Nuevo nodo" del FE NO envía.
-- Agente responsable: [AG-DATABASE]
--
-- Motivo: el modal de creación (frontend/src/pages/Nodos.jsx →
--   CreateNodeModal) sólo envía: codigo, nombre, tipo, pais_iso2,
--   zona_horaria, status, is_active, capabilities, legal_entity_owner_id,
--   operator_id.
--
-- En particular NO pregunta por `ciudad`, lo que reventaba el POST
-- con: {"ciudad":["Este campo es requerido."]}.
--
-- Filosofía MWT: el form manda. Si no se pide al humano, no puede ser
-- requerido en BD. (Se podrá completar luego en el detalle / edición.)
--
-- Idempotente — usa DROP NOT NULL sin IF EXISTS porque PostgreSQL no
-- error-ea si la columna ya es NULLABLE (es no-op).
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/10b_nodos_relax.sql
-- =====================================================================

ALTER TABLE nodos.nodo ALTER COLUMN ciudad DROP NOT NULL;

-- Sanity: confirma estado final
DO $$
DECLARE
    is_nullable text;
BEGIN
    SELECT c.is_nullable INTO is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'nodos'
      AND c.table_name   = 'nodo'
      AND c.column_name  = 'ciudad';
    RAISE NOTICE '[10b_nodos_relax] nodos.nodo.ciudad is_nullable = %', is_nullable;
END $$;
