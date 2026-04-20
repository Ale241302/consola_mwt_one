-- =====================================================================
-- MWT.ONE · 10_nodos.sql · MÓDULO NODOS (red física)
-- Agente responsable: [AG-DATABASE]
--
-- Convenciones:
--   · UUID PK con gen_random_uuid() (pgcrypto, ya habilitado en init.sql)
--   · is_active BOOLEAN para soft-delete
--   · created_at / updated_at TIMESTAMPTZ
--   · CERO FOREIGN KEYs — responsable_id es UUID plano (sin REFERENCES)
--   · Vive en el schema `nodos`
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/10_nodos.sql
-- =====================================================================

-- ── Tabla principal ────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodos.nodo (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          VARCHAR(16)  NOT NULL UNIQUE,
    nombre          VARCHAR(128) NOT NULL,
    tipo            VARCHAR(16)  NOT NULL,    -- HQ · OFICINA · ALMACEN · HUB
    pais_iso2       CHAR(2)      NOT NULL,    -- join lógico a core.pais_cat.iso2
    ciudad          VARCHAR(96)  NOT NULL,
    direccion       TEXT,
    zona_horaria    VARCHAR(48)  NOT NULL DEFAULT 'America/Lima',
    responsable_id  UUID,                     -- join lógico a core.users.id (SIN FK)
    contacto_email  VARCHAR(160),
    contacto_tel    VARCHAR(32),
    lat             NUMERIC(9,6),
    lng             NUMERIC(9,6),
    capacidad_m2    NUMERIC(12,2),
    observaciones   TEXT,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodo_tipo    ON nodos.nodo(tipo)      WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_nodo_pais    ON nodos.nodo(pais_iso2) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_nodo_active  ON nodos.nodo(is_active);
CREATE INDEX IF NOT EXISTS idx_nodo_resp    ON nodos.nodo(responsable_id);

-- ── Trigger updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION nodos.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_nodo_updated_at ON nodos.nodo;
CREATE TRIGGER tg_nodo_updated_at
    BEFORE UPDATE ON nodos.nodo
    FOR EACH ROW EXECUTE FUNCTION nodos.tg_set_updated_at();

-- ── Catálogo: tipo de nodo (alimenta el <select> del FE) ──
CREATE TABLE IF NOT EXISTS nodos.tipo_cat (
    codigo VARCHAR(16) PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    color  VARCHAR(16),
    orden  SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO nodos.tipo_cat (codigo, label, color, orden) VALUES
    ('HQ',      'Casa Matriz',        '#481EE3', 1),
    ('OFICINA', 'Oficina Comercial',  '#3083FE', 2),
    ('ALMACEN', 'Almacén',            '#00B286', 3),
    ('HUB',     'Hub Logístico',      '#1EE3D7', 4)
ON CONFLICT (codigo) DO NOTHING;
