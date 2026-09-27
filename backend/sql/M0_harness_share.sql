-- M0 · Compartición de agentes/skills del harness DeepSeek.
--
-- La consola actúa como almacén compartido: cada usuario publica aquí los
-- agentes/skills que crea y decide con quién los comparte (correos concretos o
-- todos los usuarios de su empresa). El harness lee lo que le comparten y lo
-- materializa como copia de solo lectura, de modo que un usuario normal no
-- puede editar ni borrar lo ajeno.
--
-- Aplicado una sola vez por docker-entrypoint.sh, rastreado en public._applied_sql.
-- Ordena después de los prefijos L* existentes.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.harness_share (
    id            uuid        PRIMARY KEY,
    kind          text        NOT NULL,
    owner_email   text        NOT NULL,
    company_id    text,
    name          text        NOT NULL,
    payload       jsonb       NOT NULL,
    share_all     boolean     NOT NULL DEFAULT false,
    shared_emails text[]      NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT harness_share_kind_check CHECK (kind IN ('agent', 'skill')),
    CONSTRAINT harness_share_owner_kind_name_key UNIQUE (owner_email, kind, name)
);

CREATE INDEX IF NOT EXISTS harness_share_owner_idx   ON core.harness_share (owner_email);
CREATE INDEX IF NOT EXISTS harness_share_company_idx ON core.harness_share (company_id);
CREATE INDEX IF NOT EXISTS harness_share_emails_gin  ON core.harness_share USING gin (shared_emails);

COMMENT ON TABLE core.harness_share IS
    'Agentes/skills del harness DeepSeek que un usuario comparte por correo o con toda su empresa.';
