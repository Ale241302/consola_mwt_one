-- M2 · Sesiones compartidas de un Space del harness DeepSeek.
--
-- El harness ya publica en la consola los recursos de un Space al compartirlo
-- (agentes, skills, memoria, contexto, Work Flows y rutinas), pero las sesiones
-- de conversación viajan por una vía aparte: el dueño captura una sesión local
-- y la publica para que los miembros del Space la lean. M1 modeló los grants de
-- Space/Work Flow; falta el almacén de esas sesiones.
--
-- Una fila por (autor, Space, sesión). `content` guarda el log portable (JSON
-- de la sesión) que el invitado materializa en modo lectura; `workspace_id`
-- recuerda el área de conversación en el host del autor.
--
-- Aplicado una sola vez por docker-entrypoint.sh, rastreado en public._applied_sql.

CREATE TABLE IF NOT EXISTS core.harness_shared_session (
    id            uuid        PRIMARY KEY,
    space_id      text        NOT NULL,
    session_id    text        NOT NULL,
    owner_email   text        NOT NULL,
    company_id    text,
    title         text        NOT NULL DEFAULT '',
    workspace_id  text,
    message_count integer     NOT NULL DEFAULT 0,
    content       text        NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Una sesión por autor y Space: recapturarla actualiza la fila, no la duplica.
CREATE UNIQUE INDEX IF NOT EXISTS harness_shared_session_key
    ON core.harness_shared_session (owner_email, space_id, session_id);
CREATE INDEX IF NOT EXISTS harness_shared_session_space_idx
    ON core.harness_shared_session (space_id);
CREATE INDEX IF NOT EXISTS harness_shared_session_owner_idx
    ON core.harness_shared_session (owner_email);

COMMENT ON TABLE core.harness_shared_session IS
    'Sesiones de conversación que un miembro comparte en un Space del harness; el invitado las lee en modo lectura.';
COMMENT ON COLUMN core.harness_shared_session.content IS
    'Log portable de la sesión (JSON) que el invitado materializa como lectura.';
