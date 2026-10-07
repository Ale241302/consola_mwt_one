-- M3 · Contenido compartido de un Space del harness DeepSeek.
--
-- Al compartir un Space, sus miembros no comparten sólo agentes/skills ni
-- sesiones: cada uno publica su propia memoria, contexto, Work Flows y rutinas
-- para que el resto de invitados del Space los lea. M2 modeló las sesiones de
-- conversación; falta el almacén de estos ítems.
--
-- Una fila por (Space, tipo, autor, clave del ítem). `payload` guarda el objeto
-- portable que el invitado materializa en modo lectura; `item_key` identifica
-- el ítem dentro del autor, de modo que republicar reemplaza su conjunto
-- completo sin duplicar filas.
--
-- Aplicado una sola vez por docker-entrypoint.sh, rastreado en public._applied_sql.

CREATE TABLE IF NOT EXISTS core.harness_shared_content (
    id           uuid        PRIMARY KEY,
    space_id     text        NOT NULL,
    kind         text        NOT NULL,
    item_key     text        NOT NULL,
    author_email text        NOT NULL,
    company_id   text,
    payload      jsonb       NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT harness_shared_content_kind_check CHECK (kind IN ('memory','context','workflow','routine'))
);

-- Un ítem por autor y Space: republicarlo actualiza la fila, no la duplica.
CREATE UNIQUE INDEX IF NOT EXISTS harness_shared_content_key
    ON core.harness_shared_content (space_id, kind, author_email, item_key);
CREATE INDEX IF NOT EXISTS harness_shared_content_space_idx
    ON core.harness_shared_content (space_id);
CREATE INDEX IF NOT EXISTS harness_shared_content_author_idx
    ON core.harness_shared_content (author_email);

COMMENT ON TABLE core.harness_shared_content IS
    'Memoria, contexto, Work Flows y rutinas que un miembro comparte en un Space del harness; el invitado los lee en modo lectura.';
COMMENT ON COLUMN core.harness_shared_content.kind IS
    'Tipo de ítem compartido: memory, context, workflow o routine.';
COMMENT ON COLUMN core.harness_shared_content.item_key IS
    'Clave local del ítem en el host del autor; identifica la fila dentro de (Space, tipo, autor).';
COMMENT ON COLUMN core.harness_shared_content.payload IS
    'Objeto portable del ítem (JSON) que el invitado materializa como lectura.';
