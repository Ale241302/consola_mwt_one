-- =====================================================================
-- MWT.ONE · 02_auth_admin.sql
-- Agente responsable: [AG-DATABASE]
--
-- Propósito:
--   · Crear el modelo de roles y permisos (core.roles, core.user_roles).
--   · Sembrar el rol Admin con permisos totales.
--   · Upsertear al usuario admin (alejandro@muitowork.com) con la
--     contraseña "MuitoWork2026?" hasheada en SHA-256 (hex lower).
--   · Vincular admin ↔ Admin.
--
-- Ejecutar DESPUÉS de init.sql:
--     psql -U mwt -d mwt_one -f 02_auth_admin.sql
--
-- Hash verificado (hex lower, 64 chars):
--     printf '%s' 'MuitoWork2026?' | sha256sum
--     → 9fd0f3edaadea3046e561859e9f211878e8d124b1c196ddad82924ed570c05f9
--
-- Nota de seguridad:
--   SHA-256 plano cumple con el requerimiento explícito del CEO. Para
--   producción se recomienda migrar a pbkdf2_sha256 / argon2 / bcrypt;
--   el backend ya tolera ambos formatos (hash_kind prefix).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabla de roles
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.roles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            VARCHAR(40)  UNIQUE NOT NULL,          -- ej. 'admin'
    name            VARCHAR(120) NOT NULL,                 -- ej. 'Admin'
    description     TEXT,
    permissions     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    --  permissions = { "modules": ["*"]  } ó
    --                 { "modules": ["expedientes.view","expedientes.edit", ... ] }
    is_system       BOOLEAN      NOT NULL DEFAULT FALSE,   -- no se puede borrar
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roles_slug ON core.roles(slug);

-- ---------------------------------------------------------------------
-- 2. Junction user ↔ role (sin FK; solo UUIDs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.user_roles (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid      UUID NOT NULL,          -- core.users.id
    role_uuid      UUID NOT NULL,          -- core.roles.id
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by     UUID,                   -- core.users.id (quien lo asignó)
    UNIQUE (user_uuid, role_uuid)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON core.user_roles(user_uuid);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON core.user_roles(role_uuid);

-- ---------------------------------------------------------------------
-- 3. Columna hash_kind en core.users (compatibilidad hacia bcrypt futuro)
-- ---------------------------------------------------------------------
ALTER TABLE core.users
    ADD COLUMN IF NOT EXISTS hash_kind VARCHAR(20) NOT NULL DEFAULT 'sha256';
--  hash_kind ∈ {sha256, pbkdf2_sha256, bcrypt, argon2}

-- Trigger de updated_at para roles
DROP TRIGGER IF EXISTS touch_updated_at ON core.roles;
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON core.roles
    FOR EACH ROW EXECUTE FUNCTION core.tg_touch_updated_at();

-- =====================================================================
-- 4. Seed del rol Admin (permisos totales)
-- =====================================================================
INSERT INTO core.roles (slug, name, description, permissions, is_system)
VALUES (
    'admin',
    'Admin',
    'Administrador global — acceso total a todos los módulos de MWT.ONE',
    jsonb_build_object(
        'modules',      jsonb_build_array('*'),
        'actions',      jsonb_build_array('view','create','edit','delete','export','admin'),
        'dashboard',    TRUE,
        'expedientes',  TRUE,
        'pipeline',     TRUE,
        'portal',       TRUE,
        'financiero',   TRUE,
        'transfers',    TRUE,
        'nodos',        TRUE,
        'clientes',     TRUE,
        'brands',       TRUE,
        'productos',    TRUE,
        'proveedores',  TRUE,
        'inventario',   TRUE,
        'templates',    TRUE,
        'notificaciones', TRUE,
        'cobros',       TRUE,
        'settings',     TRUE,
        'user_mgmt',    TRUE
    ),
    TRUE
)
ON CONFLICT (slug) DO UPDATE
    SET name         = EXCLUDED.name,
        description  = EXCLUDED.description,
        permissions  = EXCLUDED.permissions,
        is_system    = EXCLUDED.is_system,
        updated_at   = NOW();

-- =====================================================================
-- 5. Upsert del usuario admin
--    email:    alejandro@muitowork.com
--    password: MuitoWork2026?   (SHA-256 hex lower)
-- =====================================================================
INSERT INTO core.users (
    email,
    email_plain,
    password_hash,
    hash_kind,
    full_name,
    role,
    is_active,
    is_staff
)
VALUES (
    'alejandro@muitowork.com',
    'alejandro@muitowork.com',
    '9fd0f3edaadea3046e561859e9f211878e8d124b1c196ddad82924ed570c05f9',
    'sha256',
    'Alejandro Mendoza',
    'admin',
    TRUE,
    TRUE
)
ON CONFLICT (email_plain) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        hash_kind     = EXCLUDED.hash_kind,
        full_name     = EXCLUDED.full_name,
        role          = EXCLUDED.role,
        is_active     = EXCLUDED.is_active,
        is_staff      = EXCLUDED.is_staff,
        updated_at    = NOW();

-- =====================================================================
-- 6. Vincular admin → rol Admin
-- =====================================================================
INSERT INTO core.user_roles (user_uuid, role_uuid)
SELECT u.id, r.id
  FROM core.users u
  JOIN core.roles r ON r.slug = 'admin'
 WHERE u.email_plain = 'alejandro@muitowork.com'
ON CONFLICT (user_uuid, role_uuid) DO NOTHING;

-- =====================================================================
-- 7. Verificación rápida (solo para ejecución manual)
-- =====================================================================
-- SELECT u.email_plain, u.full_name, u.role, u.is_active, r.name AS role_name
--   FROM core.users u
--   LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
--   LEFT JOIN core.roles r       ON r.id = ur.role_uuid
--  WHERE u.email_plain = 'alejandro@muitowork.com';

-- FIN 02_auth_admin.sql
