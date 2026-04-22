-- =====================================================================
-- MWT.ONE · A3_sizing_engine.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint: SIZING ENGINE v1
--
-- Crea el schema `ops` y la tabla maestra `ops.tallas`, junto con dos
-- catálogos de soporte para alimentar los selects del frontend (cero
-- datos quemados). Cumple las REGLAS DE ORO MWT:
--
--   · CERO Foreign Keys — todos los vínculos lógicos se materializan
--     como UUID (texto) y se resuelven en backend/frontend.
--   · TODOS los campos de negocio son NULLABLE (la tabla acepta
--     borradores: una fila puede crearse con sólo el `id`).
--   · Idempotencia — `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
--   · Auditoría: `id` UUID PK, `is_active` boolean, `created_at`,
--     `updated_at` con trigger `ops.touch_updated_at()`.
--
-- Lógica de aplicación:
--   · `tipo_producto`  ∈ {'calzado','plantilla'} (catálogo extensible)
--   · Si `tipo_producto = 'calzado'`     → matriz de equivalencias
--   · Si `tipo_producto = 'plantilla'`   → matriz + dimensiones físicas
--     (`grosor_antepie_mm`, `grosor_talon_mm`, `drop_mm`, `peso_g`)
--
-- Ningún CHECK fuerza estas reglas a nivel DB — se aplican en backend
-- vía `apps.sizing.serializers.TallaSerializer.validate()`. La DB
-- siempre acepta NULL para no bloquear borradores ni migraciones.
-- =====================================================================

-- ─── Extensiones requeridas ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid()

-- ─── Schema dedicado al dominio operativo ──────────────────────────
CREATE SCHEMA IF NOT EXISTS ops;
COMMENT ON SCHEMA ops IS
  'OPS — operaciones transversales (tallas, taxonomías y otras tablas '
  'maestras de uso operativo). Sprint Sizing Engine v1.';

-- ─── Trigger genérico para mantener updated_at ─────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'ops'
           AND p.proname = 'touch_updated_at'
    ) THEN
        EXECUTE $func$
            CREATE OR REPLACE FUNCTION ops.touch_updated_at()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $body$
            BEGIN
                NEW.updated_at := NOW();
                RETURN NEW;
            END;
            $body$;
        $func$;
    END IF;
END;
$$;


-- =====================================================================
-- 1) CATÁLOGO · ops.tipo_producto_cat
--    (alimenta el <select> "Tipo de producto" en el frontend)
-- =====================================================================
CREATE TABLE IF NOT EXISTS ops.tipo_producto_cat (
    codigo       VARCHAR(32)  PRIMARY KEY,        -- 'calzado', 'plantilla', …
    label        VARCHAR(80)  NOT NULL,
    descripcion  TEXT         NULL,
    icon         VARCHAR(40)  NULL,                -- nombre lógico de icono FE
    requiere_dimensiones BOOLEAN NOT NULL DEFAULT FALSE,  -- gating del FE
    orden        INTEGER      NOT NULL DEFAULT 100,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tipo_producto_cat_touch ON ops.tipo_producto_cat;
CREATE TRIGGER trg_tipo_producto_cat_touch
    BEFORE UPDATE ON ops.tipo_producto_cat
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

INSERT INTO ops.tipo_producto_cat
    (codigo, label, descripcion, icon, requiere_dimensiones, orden)
VALUES
    ('calzado',   'Calzado',
     'Tallas estándar de calzado de seguridad/casual (no requieren dimensiones físicas).',
     'shoe',      FALSE, 10),
    ('plantilla', 'Plantilla',
     'Plantillas anatómicas — habilita matriz de dimensiones físicas (grosor, drop, peso).',
     'insole',    TRUE,  20)
ON CONFLICT (codigo) DO NOTHING;


-- =====================================================================
-- 2) CATÁLOGO · ops.medida_sistema_cat
--    Define los 15 sistemas internacionales que el FE mostrará como
--    columnas en la "Matriz de Equivalencias".  El FE debe leer este
--    catálogo y NUNCA hardcodear los nombres de columna.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ops.medida_sistema_cat (
    codigo       VARCHAR(24) PRIMARY KEY,   -- coincide con la columna en ops.tallas
    label        VARCHAR(60) NOT NULL,
    region       VARCHAR(40) NULL,          -- 'EU' / 'US' / 'UK' / 'LATAM' / 'ASIA' / 'METRIC'
    descripcion  TEXT        NULL,
    grupo        VARCHAR(40) NULL,          -- 'numerica' / 'alfa' / 'longitud_cm'
    orden        INTEGER     NOT NULL DEFAULT 100,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_medida_sistema_cat_touch ON ops.medida_sistema_cat;
CREATE TRIGGER trg_medida_sistema_cat_touch
    BEFORE UPDATE ON ops.medida_sistema_cat
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- 15 sistemas internacionales — todos los `codigo` aquí coinciden con
-- una columna VARCHAR opcional en `ops.tallas`. Cualquier extensión
-- futura sólo requiere ALTER TABLE + INSERT en este catálogo.
INSERT INTO ops.medida_sistema_cat
    (codigo, label, region, descripcion, grupo, orden)
VALUES
    ('eu',         'EU',                'EU',     'European standard (Continental).', 'numerica',    10),
    ('us_men',     'US Men',            'US',     'United States — male sizing.',     'numerica',    20),
    ('us_women',   'US Women',          'US',     'United States — female sizing.',   'numerica',    30),
    ('us_youth',   'US Youth',          'US',     'United States — youth/kids.',      'numerica',    40),
    ('uk_men',     'UK Men',            'UK',     'United Kingdom — male sizing.',    'numerica',    50),
    ('uk_women',   'UK Women',          'UK',     'United Kingdom — female sizing.',  'numerica',    60),
    ('uk_youth',   'UK Youth',          'UK',     'United Kingdom — youth/kids.',     'numerica',    70),
    ('br',         'BR',                'LATAM',  'Brazilian standard.',              'numerica',    80),
    ('mx',         'MX',                'LATAM',  'Mexican standard.',                'numerica',    90),
    ('ar',         'AR',                'LATAM',  'Argentine standard.',              'numerica',   100),
    ('jp',         'JP',                'ASIA',   'Japanese standard (cm Mondopoint).','longitud_cm',110),
    ('cn',         'CN',                'ASIA',   'Chinese standard (mm).',           'numerica',   120),
    ('kr',         'KR',                'ASIA',   'Korean standard (mm).',            'numerica',   130),
    ('cm',         'CM (Mondopoint)',   'METRIC', 'Last length in centimetres.',      'longitud_cm',140),
    ('alfa',       'Alfa (S/M/L)',      'METRIC', 'Alphanumeric — usado en plantillas.', 'alfa',    150)
ON CONFLICT (codigo) DO NOTHING;


-- =====================================================================
-- 3) MAESTRO · ops.tallas
--    Una fila = una talla MWT (de calzado o plantilla).
--    TODOS los campos de negocio son NULLABLE — sólo `id` es obligatorio.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ops.tallas (
    -- ── Auditoría ───────────────────────────────────────────────
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- ── Clasificación (catálogo lógico, sin FK) ─────────────────
    -- 'calzado' | 'plantilla' (validado por backend, no por DB)
    tipo_producto VARCHAR(32)  NULL,

    -- ── Identificador base de la talla ──────────────────────────
    talla_base    VARCHAR(40)  NULL,   -- p.ej. "42", "S3", "M-WIDE"
    nombre        VARCHAR(120) NULL,   -- etiqueta humana opcional
    descripcion   TEXT         NULL,

    -- ── Matriz de Equivalencias (15 sistemas) ───────────────────
    -- Cada columna corresponde a un `codigo` en ops.medida_sistema_cat.
    eu            VARCHAR(20)  NULL,
    us_men        VARCHAR(20)  NULL,
    us_women      VARCHAR(20)  NULL,
    us_youth      VARCHAR(20)  NULL,
    uk_men        VARCHAR(20)  NULL,
    uk_women      VARCHAR(20)  NULL,
    uk_youth      VARCHAR(20)  NULL,
    br            VARCHAR(20)  NULL,
    mx            VARCHAR(20)  NULL,
    ar            VARCHAR(20)  NULL,
    jp            VARCHAR(20)  NULL,
    cn            VARCHAR(20)  NULL,
    kr            VARCHAR(20)  NULL,
    cm            VARCHAR(20)  NULL,
    alfa          VARCHAR(20)  NULL,

    -- ── Especificaciones Dimensionales (sólo plantillas) ────────
    -- En `tipo_producto = 'calzado'` quedan NULL.  En 'plantilla'
    -- el FE las solicita pero NUNCA las marca como required.
    grosor_antepie_mm NUMERIC(6,2) NULL,
    grosor_talon_mm   NUMERIC(6,2) NULL,
    drop_mm           NUMERIC(6,2) NULL,
    peso_g            NUMERIC(7,2) NULL,

    -- ── Metadata libre (extensión futura sin migración) ─────────
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE ops.tallas IS
  'Catálogo maestro de tallas MWT. Todos los campos de negocio son NULLABLE '
  '— acepta borradores. Lógica condicional plantilla/calzado se aplica en '
  'apps.sizing (backend) y en SizingEngine.jsx (frontend).';

-- ── Trigger updated_at ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tallas_touch ON ops.tallas;
CREATE TRIGGER trg_tallas_touch
    BEFORE UPDATE ON ops.tallas
    FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- ── Índices de soporte (NUNCA UNIQUE — los borradores se permiten) ─
CREATE INDEX IF NOT EXISTS ix_tallas_tipo_producto
    ON ops.tallas (tipo_producto);
CREATE INDEX IF NOT EXISTS ix_tallas_talla_base
    ON ops.tallas (talla_base);
CREATE INDEX IF NOT EXISTS ix_tallas_is_active
    ON ops.tallas (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS ix_tallas_eu        ON ops.tallas (eu);
CREATE INDEX IF NOT EXISTS ix_tallas_us_men    ON ops.tallas (us_men);
CREATE INDEX IF NOT EXISTS ix_tallas_metadata  ON ops.tallas USING gin (metadata);

-- =====================================================================
-- FIN  · ops.tallas y catálogos listos.
-- Próximos pasos:
--   · Backend (apps.sizing) lee /api/sizing/options/  → catálogos
--   · Frontend (SizingEngine.jsx) consume options + CRUD /api/sizing/tallas/
-- =====================================================================
