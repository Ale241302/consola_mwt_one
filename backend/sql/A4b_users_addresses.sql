-- ============================================================
-- MWT.ONE · A4b_users_addresses.sql
-- Agente responsable: [AG-DATABASE]
--
-- Migración ADITIVA sobre el schema `users` (creado en A4_users_roles.sql).
--
--   · users.addresses  ·  direcciones múltiples por usuario
--
-- Contrato MWT:
--   · CERO FKs físicas → user_id es UUID plano con índice.
--   · is_active = FALSE  ≡  soft delete (nunca DELETE real).
--   · Trigger tg_set_updated_at ya existe (definido en A4).
--   · Índice parcial para garantizar 1 sola dirección default activa
--     por usuario (enforcement en BD — el backend NO depende sólo del
--     frontend para respetar esta invariante).
-- ============================================================

-- Guard: re-ejecutable.  Si alguien corre este script varias veces
-- todos los CREATE son IF NOT EXISTS y los seeds son idempotentes.


-- ────────────────────────────────────────────────────────────
-- 1. users.addresses
--
-- Uso:
--   · Un usuario B2B puede tener 1..N direcciones de envío/facturación.
--   · Se marca UNA como `is_default = TRUE` → aparece preseleccionada
--     en el wizard de creación de OC.
--   · `label` es un alias libre para que el cliente distinga "Oficina",
--     "Bodega Norte", etc.
--   · `kind` categoriza el uso: SHIPPING / BILLING / BOTH.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.addresses (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FK lógica a users.mwtuser.id (UUID string, sin constraint FK).
    user_id          UUID           NOT NULL,

    -- Alias libre que elige el cliente (ej. "Oficina Central",
    -- "Bodega San Miguel"). Útil para el dropdown de selección.
    label            VARCHAR(96),

    -- SHIPPING | BILLING | BOTH  (free-form VARCHAR por extensibilidad).
    kind             VARCHAR(16)    NOT NULL DEFAULT 'SHIPPING',

    -- Contacto específico de esta dirección (opcional — por defecto
    -- hereda del usuario).
    contact_name     VARCHAR(160),
    contact_phone    VARCHAR(32),

    -- Dirección postal. Campos free-form porque los formatos varían
    -- mucho entre LATAM (ES: provincia, MX: colonia, CL: comuna).
    address_line_1   VARCHAR(255)   NOT NULL,
    address_line_2   VARCHAR(255),
    city             VARCHAR(96),
    state            VARCHAR(96),
    country          VARCHAR(64),        -- ISO alpha-2 preferido (PE, CL, MX)
    zip_code         VARCHAR(32),

    -- Geo opcional — para integraciones de logística (Shipmondo, etc.).
    latitude         NUMERIC(10, 7),
    longitude        NUMERIC(10, 7),

    -- Marca la dirección por defecto. Ver índice único parcial más abajo.
    is_default       BOOLEAN        NOT NULL DEFAULT FALSE,

    -- Notas internas para el equipo de logística / finanzas.
    notes            TEXT,

    -- Auditoría estándar MWT.
    is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Índices operativos.
CREATE INDEX IF NOT EXISTS addresses_user_idx
    ON users.addresses (user_id);
CREATE INDEX IF NOT EXISTS addresses_active_idx
    ON users.addresses (user_id, is_active)
    WHERE is_active = TRUE;

-- Garantía: máximo UNA dirección default activa por usuario.
-- Esto lo enforza la BD aunque el backend falle.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
    ON users.addresses (user_id)
    WHERE is_default = TRUE AND is_active = TRUE;

-- Trigger updated_at (la función tg_set_updated_at ya fue creada en A4).
DROP TRIGGER IF EXISTS tg_addresses_updated_at ON users.addresses;
CREATE TRIGGER tg_addresses_updated_at
    BEFORE UPDATE ON users.addresses
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

COMMENT ON TABLE users.addresses IS
    'Direcciones múltiples por usuario (B2B). Sin FK física a users.mwtuser. Una sola default activa por user (unique index parcial).';


-- ────────────────────────────────────────────────────────────
-- 2. Seed · sembramos una dirección demo para el superadmin
--    (solo si no existe ninguna dirección aún — idempotente).
-- ────────────────────────────────────────────────────────────
INSERT INTO users.addresses (
    id, user_id, label, kind,
    contact_name, contact_phone,
    address_line_1, address_line_2, city, state, country, zip_code,
    is_default
)
SELECT
    gen_random_uuid(),
    u.id,
    'Oficina Lima',
    'BOTH',
    u.full_name,
    u.phone,
    'Av. Javier Prado Este 4200',
    'Piso 8, Oficina 802',
    'Santiago de Surco',
    'Lima',
    'PE',
    '15023',
    TRUE
FROM users.mwtuser u
WHERE u.is_superuser = TRUE
  AND NOT EXISTS (SELECT 1 FROM users.addresses WHERE user_id = u.id)
LIMIT 1;


-- ============================================================
-- FIN A4b_users_addresses.sql
-- ============================================================
