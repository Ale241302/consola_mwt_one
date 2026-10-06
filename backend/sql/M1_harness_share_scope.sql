-- M1 · Compartición de Spaces y Work Flows del harness en la consola.
--
-- M0 modelaba sólo agentes/skills: una fila por recurso compartida con varios
-- correos. El harness comparte un Space o un Work Flow como un grant por
-- invitado, con los permisos por acción, el estado de aceptación y el id remoto
-- del recurso, así que la tabla necesita esas columnas y una clave por grant.
--
-- Aplicado una sola vez por docker-entrypoint.sh, rastreado en public._applied_sql.

ALTER TABLE core.harness_share
    DROP CONSTRAINT IF EXISTS harness_share_kind_check;
ALTER TABLE core.harness_share
    ADD CONSTRAINT harness_share_kind_check
    CHECK (kind IN ('agent', 'skill', 'space', 'workflow'));

ALTER TABLE core.harness_share ADD COLUMN IF NOT EXISTS resource_id   text;
ALTER TABLE core.harness_share ADD COLUMN IF NOT EXISTS permissions   text[]      NOT NULL DEFAULT '{}';
ALTER TABLE core.harness_share ADD COLUMN IF NOT EXISTS status        text        NOT NULL DEFAULT 'pending';
ALTER TABLE core.harness_share ADD COLUMN IF NOT EXISTS grantee_email text;
ALTER TABLE core.harness_share ADD COLUMN IF NOT EXISTS accepted_at   timestamptz;

-- Agentes/skills conservan la unicidad por nombre; Spaces/Work Flows se
-- identifican por recurso + invitado, para no pisar el grant de otro invitado.
ALTER TABLE core.harness_share DROP CONSTRAINT IF EXISTS harness_share_owner_kind_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS harness_share_agent_key
    ON core.harness_share (owner_email, kind, name)
    WHERE kind IN ('agent', 'skill');
CREATE UNIQUE INDEX IF NOT EXISTS harness_share_grant_key
    ON core.harness_share (owner_email, kind, resource_id, grantee_email)
    WHERE kind IN ('space', 'workflow');

COMMENT ON COLUMN core.harness_share.resource_id IS
    'Id remoto del Space/Work Flow compartido (NULL en agent/skill).';
COMMENT ON COLUMN core.harness_share.permissions IS
    'Permisos por acción del grant (vacío en agent/skill).';
COMMENT ON COLUMN core.harness_share.status IS
    'Ciclo del grant: pending, active o revoked (pending en agent/skill).';
