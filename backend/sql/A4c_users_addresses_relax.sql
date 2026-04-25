-- ============================================================
-- MWT.ONE · A4c_users_addresses_relax.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Cliente M3b · ajuste UX:
--   En la UI ningún campo de dirección debe ser obligatorio.
--   El usuario puede crear una dirección con sólo el `label`
--   ("Casa", "Bodega Norte") y completar después.
--
-- Cambio:
--   address_line_1 VARCHAR(255) NOT NULL  →  NULL permitido.
--
-- Idempotente: si la columna ya es NULL, no hace nada.
-- ============================================================

ALTER TABLE users.addresses
    ALTER COLUMN address_line_1 DROP NOT NULL;

COMMENT ON COLUMN users.addresses.address_line_1 IS
    'Calle y número. Opcional desde A4c (sprint Cliente M3b).';
