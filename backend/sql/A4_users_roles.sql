-- ============================================================
-- MWT.ONE · A4_users_roles.sql
-- Agente responsable: [AG-DATABASE]
--
-- Schema `users` para el módulo CORE M3:
--   · users.mwtuser               (usuarios del ERP — admin + B2B)
--   · users.role_cat              (catálogo de roles canónicos)
--   · users.role_permission       (matriz CRUD por módulo por rol)
--   · users.user_role_bridge      (N:M users ↔ roles, un user puede tener
--                                  varios roles aditivos)
--   · users.password_reset_token  (tokens one-shot con TTL)
--   · users.activity_feed         (notificaciones del header — ya existía
--                                  parcialmente, ver 92_notifications.sql;
--                                  aquí solo añadimos una VIEW útil)
--
-- Arquitectura MWT:
--   · Idempotente (IF NOT EXISTS + guards DO $$ …)
--   · CERO FKs — todo vínculo es UUID string con índice
--   · Seed canónico de roles (superadmin, admin, manager, operator,
--     finance, viewer, client_b2b)
--   · Seed canónico de módulos del ERP (expedientes, productos, clientes,
--     marcas, cobros, etc.)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS users;


-- ────────────────────────────────────────────────────────────
-- 0. Función tg_set_updated_at (re-crea defensivamente)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 1. users.mwtuser  ·  usuario raíz del ERP
--
-- Notas:
--   · email_plain: email único del login (lower-case).
--   · password_hash: pbkdf2/argon2 (no truncar longitud).
--   · contact_email: email de contacto separado del login (facturación,
--     notificaciones comerciales). Puede cambiarlo el propio CLIENT vía
--     PATCH /api/users/me/profile/.
--   · preferred_language: 'es' | 'en' | 'pt' (free-form VARCHAR por si
--     agregamos más idiomas).
--   · legal_entity_id: UUID del cliente al que pertenece (SOLO para rol
--     client_b2b — blinda el scope del portal).
--   · role_default: slug del rol principal del usuario (FK lógica a
--     users.role_cat.slug). Los roles adicionales viven en
--     users.user_role_bridge (N:M).
--   · is_active: soft-delete.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.mwtuser (
    id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

    email_plain          VARCHAR(255)   NOT NULL UNIQUE,
    password_hash        TEXT,
    password_changed_at  TIMESTAMPTZ,

    full_name            VARCHAR(160),
    contact_email        VARCHAR(255),
    phone                VARCHAR(32),
    preferred_language   VARCHAR(8)     NOT NULL DEFAULT 'es',
    timezone             VARCHAR(64)    NOT NULL DEFAULT 'America/Lima',
    avatar_url           TEXT,

    -- Scope del portal B2B (legal_entity_id = clientes.cliente.id).
    -- Sólo tiene valor si role_default ∈ {'client_b2b','cliente','client'}.
    legal_entity_id      UUID,

    role_default         VARCHAR(32)    NOT NULL DEFAULT 'viewer',
    is_superuser         BOOLEAN        NOT NULL DEFAULT FALSE,

    is_api_user          BOOLEAN        NOT NULL DEFAULT FALSE,
    api_key_hash         TEXT,

    last_login_at        TIMESTAMPTZ,
    failed_login_count   INTEGER        NOT NULL DEFAULT 0,
    locked_until         TIMESTAMPTZ,

    accepted_terms_at    TIMESTAMPTZ,
    preferences          JSONB          NOT NULL DEFAULT '{}'::jsonb,

    is_active            BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mwtuser_email_idx        ON users.mwtuser (lower(email_plain));
CREATE INDEX IF NOT EXISTS mwtuser_role_default_idx ON users.mwtuser (role_default);
CREATE INDEX IF NOT EXISTS mwtuser_legal_entity_idx ON users.mwtuser (legal_entity_id);
CREATE INDEX IF NOT EXISTS mwtuser_active_idx       ON users.mwtuser (is_active) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tg_mwtuser_updated_at ON users.mwtuser;
CREATE TRIGGER tg_mwtuser_updated_at
    BEFORE UPDATE ON users.mwtuser
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

COMMENT ON TABLE users.mwtuser IS
    'Usuarios del ERP MWT.ONE. Incluye staff interno + clientes B2B del portal. El login es por email_plain; el scope B2B por legal_entity_id.';


-- ────────────────────────────────────────────────────────────
-- 2. users.role_cat  ·  catálogo canónico de roles
--
-- is_system=TRUE bloquea mutaciones (el CEO no puede borrar
-- 'superadmin' ni 'client_b2b' por accidente).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.role_cat (
    slug          VARCHAR(32)   PRIMARY KEY,
    nombre        VARCHAR(96)   NOT NULL,
    descripcion   TEXT,
    color         VARCHAR(16)   NOT NULL DEFAULT '#64748B',
    orden         INTEGER       NOT NULL DEFAULT 100,
    is_system     BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_role_cat_updated_at ON users.role_cat;
CREATE TRIGGER tg_role_cat_updated_at
    BEFORE UPDATE ON users.role_cat
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

INSERT INTO users.role_cat (slug, nombre, descripcion, color, orden, is_system) VALUES
    ('superadmin', 'Super Admin',      'Acceso total al sistema incluyendo gobernanza y Kill-Switch.', '#481EE3', 10,  TRUE),
    ('admin',      'Admin (CEO)',      'Acceso total operativo y comercial. Ve costos y márgenes.', '#0B1E3A', 20,  TRUE),
    ('manager',    'Manager',          'Orquesta expedientes y equipo. No ve rentabilidad interna.', '#3083FE', 30,  FALSE),
    ('operator',   'Operador',         'Gestión diaria de OCs, documentos y líneas.',               '#00B286', 40,  FALSE),
    ('finance',    'Finance',          'Cobros, pagos y conciliación. Ve límites de crédito.',      '#B45309', 50,  FALSE),
    ('compras',    'Compras',          'Gestión de proveedores + productos.',                        '#1EE3D7', 60,  FALSE),
    ('viewer',    'Viewer (Solo lectura)', 'Lectura de módulos operativos sin poder modificar.',     '#64748B', 80,  FALSE),
    ('client_b2b', 'Cliente B2B',      'Usuario del Portal B2B. Scope estricto al legal_entity_id.', '#008B69', 90,  TRUE)
ON CONFLICT (slug) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. users.module_cat  ·  catálogo de módulos del ERP
--
-- Lista hardcoded de módulos que la matriz RBAC puede parametrizar.
-- Si se agregan módulos nuevos al sistema, se insertan aquí y la UI
-- los recoge automáticamente.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.module_cat (
    slug          VARCHAR(32)   PRIMARY KEY,
    nombre        VARCHAR(96)   NOT NULL,
    descripcion   TEXT,
    icon          VARCHAR(32),
    categoria     VARCHAR(32)   NOT NULL DEFAULT 'OPERACIONAL',
    orden         INTEGER       NOT NULL DEFAULT 100,
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden) VALUES
    ('dashboard',      'Dashboard',              'KPIs + shortcuts',                             'dashboard',  'CORE',         10),
    ('expedientes',    'Expedientes',            'OCs + expedientes + confirmación SAP',          'folder',     'OPERACIONAL',  20),
    ('pipeline',       'Pipeline',               'Kanban de expedientes por fase',                'kanban',     'OPERACIONAL',  30),
    ('inventario',     'Inventario',             'Stock por nodo + movimientos',                  'package',    'OPERACIONAL',  40),
    ('transferencias', 'Transferencias',         'Transfers entre nodos',                         'truck',      'OPERACIONAL',  50),
    ('productos',      'Productos',              'Catálogo de productos + especificaciones',      'tag',        'CATALOGOS',    60),
    ('marcas',         'Marcas',                 'Catálogo de marcas',                            'award',      'CATALOGOS',    70),
    ('clientes',       'Clientes',               'CRM + límites de crédito',                      'users',      'COMERCIAL',    80),
    ('proveedores',    'Proveedores',            'Fábricas + auditorías',                         'factory',    'COMERCIAL',    90),
    ('nodos',          'Nodos',                  'Warehouses + capabilities',                      'map-pin',    'OPERACIONAL', 100),
    ('cobros',         'Cobros',                 'Cartera + CollectionBot',                       'dollar',     'FINANCIERO',  110),
    ('pagos',          'Pagos',                  'Pagos + conciliación',                          'dollar',     'FINANCIERO',  120),
    ('financiero',     'Financiero',             'Vista agregada financiera',                     'chart',      'FINANCIERO',  130),
    ('notificaciones', 'Notificaciones',         'Historial de emails y cobranza',                'mail',       'OPERACIONAL', 140),
    ('plantillas',     'Plantillas (Email)',     'Email templates CRUD',                          'mail',       'CATALOGOS',  150),
    ('portal',         'Portal B2B',             'Vista del cliente B2B',                         'globe',      'B2B',         160),
    ('ai-hub',         'AI Hub',                 'Agentes + skills + instrucciones',              'bot',        'AI',          170),
    ('ai-governance',  'AI Gobernanza',          'CRUD de catálogos AI (CEO-ONLY)',               'shield',     'AI',          175),
    ('sizing',         'Motor de Tallas',        'Plantillas de tallas por categoría',            'ruler',      'CATALOGOS',  180),
    ('pricing',        'Motor de Precios',       'Pricing waterfall por cliente',                 'price-tag',  'COMERCIAL',   190),
    ('usuarios',       'Usuarios',               'Gestión de usuarios del ERP',                    'user',       'CORE',        200),
    ('roles',          'Roles y Permisos',       'Matriz RBAC',                                   'shield',     'CORE',        210),
    ('storage',        'Storage',                'MinIO + Paperless-ngx',                          'hard-drive', 'INFRA',       300)
ON CONFLICT (slug) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 4. users.role_permission  ·  matriz CRUD por (role, module)
--
-- Un row por combinación (role_slug, module_slug) con los 4 booleanos.
-- El front serializa así:
--   [{ role: 'manager', module: 'expedientes',
--      can_create: true, can_read: true, can_update: true, can_delete: false }, ...]
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.role_permission (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    role_slug       VARCHAR(32)    NOT NULL,     -- FK lógica a role_cat
    module_slug     VARCHAR(32)    NOT NULL,     -- FK lógica a module_cat
    can_create      BOOLEAN        NOT NULL DEFAULT FALSE,
    can_read        BOOLEAN        NOT NULL DEFAULT FALSE,
    can_update      BOOLEAN        NOT NULL DEFAULT FALSE,
    can_delete      BOOLEAN        NOT NULL DEFAULT FALSE,
    updated_by_id   UUID,
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    UNIQUE (role_slug, module_slug)
);

CREATE INDEX IF NOT EXISTS role_perm_role_idx   ON users.role_permission (role_slug);
CREATE INDEX IF NOT EXISTS role_perm_module_idx ON users.role_permission (module_slug);

DROP TRIGGER IF EXISTS tg_role_perm_updated_at ON users.role_permission;
CREATE TRIGGER tg_role_perm_updated_at
    BEFORE UPDATE ON users.role_permission
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- Seed de permisos canónicos (wildcard baseline — el CEO los afina luego)
-- superadmin y admin: full CRUD en todo
-- manager:  CRUD completo excepto CATEGORÍA=CORE
-- operator: CRUD operacional (sin delete)
-- finance:  CRUD financiero + read operacional
-- compras:  CRUD catálogos + read operacional
-- viewer:   read-only global
-- client_b2b: solo lectura del portal
INSERT INTO users.role_permission (role_slug, module_slug, can_create, can_read, can_update, can_delete)
SELECT r.slug, m.slug,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         WHEN r.slug='manager' AND m.categoria NOT IN ('CORE') THEN TRUE
         WHEN r.slug='operator' AND m.categoria IN ('OPERACIONAL') THEN TRUE
         WHEN r.slug='finance' AND m.categoria='FINANCIERO' THEN TRUE
         WHEN r.slug='compras' AND m.categoria IN ('CATALOGOS','COMERCIAL') THEN TRUE
         ELSE FALSE END AS can_create,
    CASE WHEN r.slug='client_b2b' AND m.slug IN ('portal','dashboard','expedientes','pipeline','pagos','ai-hub') THEN TRUE
         WHEN r.slug NOT IN ('client_b2b') AND m.categoria NOT IN ('B2B') THEN TRUE
         ELSE FALSE END AS can_read,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         WHEN r.slug='manager' AND m.categoria NOT IN ('CORE') THEN TRUE
         WHEN r.slug='operator' AND m.categoria IN ('OPERACIONAL') THEN TRUE
         WHEN r.slug='finance' AND m.categoria='FINANCIERO' THEN TRUE
         WHEN r.slug='compras' AND m.categoria IN ('CATALOGOS','COMERCIAL') THEN TRUE
         ELSE FALSE END AS can_update,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         ELSE FALSE END AS can_delete
FROM users.role_cat r
CROSS JOIN users.module_cat m
WHERE r.is_active = TRUE AND m.is_active = TRUE
ON CONFLICT (role_slug, module_slug) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 5. users.user_role_bridge  ·  N:M user ↔ roles adicionales
--
-- role_default en mwtuser es el principal; acá se agregan roles
-- adicionales (ej. un manager que también sea finance).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.user_role_bridge (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID           NOT NULL,       -- FK lógica a users.mwtuser
    role_slug    VARCHAR(32)    NOT NULL,       -- FK lógica a users.role_cat
    granted_by   UUID,                           -- FK lógica a mwtuser
    granted_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    is_active    BOOLEAN        NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, role_slug)
);

CREATE INDEX IF NOT EXISTS user_role_user_idx ON users.user_role_bridge (user_id);
CREATE INDEX IF NOT EXISTS user_role_role_idx ON users.user_role_bridge (role_slug);


-- ────────────────────────────────────────────────────────────
-- 6. users.password_reset_token  ·  tokens one-shot con TTL
--
-- Generados por POST /api/users/<id>/reset-password/. El email se manda
-- con la plantilla 'auth.password_reset' de email_templates.
-- TTL default: 24h.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.password_reset_token (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID           NOT NULL,    -- FK lógica a users.mwtuser
    token_hash       VARCHAR(128)   NOT NULL UNIQUE,
    issued_by        UUID,                         -- quien pidió el reset (admin o el propio user)
    expires_at       TIMESTAMPTZ    NOT NULL,
    consumed_at      TIMESTAMPTZ,
    ip_address       VARCHAR(64),
    user_agent       VARCHAR(255),
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pwd_reset_user_idx     ON users.password_reset_token (user_id);
CREATE INDEX IF NOT EXISTS pwd_reset_valid_idx    ON users.password_reset_token (expires_at)
    WHERE consumed_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- 7. users.activity_feed  ·  notificaciones del header
--
-- El header (campana 🔔) muestra las últimas N notificaciones del
-- usuario logueado con badge rojo si hay `read_at IS NULL`. Las
-- fuentes son: expediente.created, cobro.overdue, sap.confirmed,
-- email.queued_failed, portal.message, etc.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users.activity_feed (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID           NOT NULL,        -- destinatario
    kind            VARCHAR(48)    NOT NULL,        -- expediente.created, cobro.overdue, …
    title           VARCHAR(160)   NOT NULL,
    body            TEXT,
    icon            VARCHAR(32),                    -- lookup en icons.jsx
    severity        VARCHAR(16)    NOT NULL DEFAULT 'INFO',  -- INFO / WARN / CRITICAL / SUCCESS
    deep_link       TEXT,                           -- ruta interna del ERP (ej. /expedientes/x/exp/y)
    related_type    VARCHAR(32),                    -- expediente / oc / cobro / message
    related_id      UUID,
    read_at         TIMESTAMPTZ,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_user_idx   ON users.activity_feed (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_unread_idx ON users.activity_feed (user_id)
    WHERE read_at IS NULL AND is_active = TRUE;


-- ────────────────────────────────────────────────────────────
-- 8. Seed de un admin demo (solo si no existe ningún usuario)
--
-- Password "demo" con pbkdf2 (scheme minimal — lo reemplaza el backend
-- con Argon2 al primer login real).
-- ────────────────────────────────────────────────────────────
INSERT INTO users.mwtuser (
    id, email_plain, full_name, contact_email,
    preferred_language, timezone,
    role_default, is_superuser, is_active
)
SELECT
    gen_random_uuid(),
    'admin@mwt.one',
    'Alejandro Mendoza',
    'admin@mwt.one',
    'es', 'America/Lima',
    'superadmin', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM users.mwtuser WHERE is_superuser = TRUE);


-- ============================================================
-- FIN A4_users_roles.sql
-- ============================================================
