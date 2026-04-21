-- ============================================================
-- MWT.ONE · 11_nodos_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría Bloque 2 del Módulo 7
-- (Nodos). Cubre catálogo de status + árbol de jerarquía.
--
-- Reglas: PK UUID, CERO FK, is_active soft delete,
-- created_at + updated_at + trigger, IF NOT EXISTS.
-- ============================================================

SET search_path = nodos, public;

-- Pre-requisito: tg_set_updated_at() ya existe.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. nodos.status_cat  ·  catálogo de status operacional.
--    Alimenta el select_status del FE. Valores canónicos según
--    93_schema_extensions.sql §2 (status: ACTIVE/INACTIVE/SETUP/RETIRED).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodos.status_cat (
    codigo      VARCHAR(16)   PRIMARY KEY,
    label       VARCHAR(64)   NOT NULL,
    descripcion TEXT,
    color       VARCHAR(16),
    orden       INTEGER       NOT NULL DEFAULT 100,
    is_active   BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO nodos.status_cat (codigo, label, descripcion, color, orden) VALUES
    ('ACTIVE',   'Activo',        'Nodo operativo',                      '#00B286', 10),
    ('SETUP',    'En setup',      'Nodo en configuración inicial',       '#F59E0B', 20),
    ('INACTIVE', 'Inactivo',      'Nodo pausado temporalmente',          '#64748B', 30),
    ('RETIRED',  'Retirado',      'Nodo fuera de servicio',              '#EF4444', 40)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. nodos.nodo_jerarquia  ·  árbol padre-hijo de nodos.
--    Vinculado por UUID plano (⛔ sin FK). Un nodo puede tener
--    N hijos y 0..1 padre. Usado para representar HQ → Oficina
--    → Almacén en el dashboard de red.
--
--    Constraint blando: (nodo_id, nodo_padre_id) único por
--    jerarquía activa (evita duplicados en rearmes).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodos.nodo_jerarquia (
    id              UUID PRIMARY KEY,
    nodo_id         UUID           NOT NULL,                     -- ⛔ sin FK
    nodo_padre_id   UUID,                                        -- ⛔ sin FK (null = raíz)
    nivel           SMALLINT       NOT NULL DEFAULT 0,
    relacion_tipo   VARCHAR(16)    NOT NULL DEFAULT 'ESTRUCTURAL',
                    -- ESTRUCTURAL / OPERACIONAL / COMERCIAL
    path_uuid       TEXT,                                        -- "uuid1/uuid2/uuid3" para descendants queries
    notas           TEXT,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_nodo_jerarquia_activo
    ON nodos.nodo_jerarquia (nodo_id, COALESCE(nodo_padre_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_nodo_jer_nodo      ON nodos.nodo_jerarquia(nodo_id);
CREATE INDEX IF NOT EXISTS ix_nodo_jer_padre     ON nodos.nodo_jerarquia(nodo_padre_id);
CREATE INDEX IF NOT EXISTS ix_nodo_jer_nivel     ON nodos.nodo_jerarquia(nivel);
CREATE INDEX IF NOT EXISTS ix_nodo_jer_path      ON nodos.nodo_jerarquia(path_uuid);

DROP TRIGGER IF EXISTS trg_nodo_jerarquia_updated_at ON nodos.nodo_jerarquia;
CREATE TRIGGER trg_nodo_jerarquia_updated_at
BEFORE UPDATE ON nodos.nodo_jerarquia
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ============================================================
