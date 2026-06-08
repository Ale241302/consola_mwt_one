-- =====================================================================
-- MWT.ONE · E1_ncm_engine.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint: NCM ENGINE v1
--
-- Crea la tabla maestra `productos.ncm_code` para almacenar códigos NCM/HS,
-- descripciones y tarifas de importación por país de origen/destino.
-- =====================================================================

CREATE TABLE IF NOT EXISTS productos.ncm_code (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(16)  NOT NULL UNIQUE,
    descripcion   TEXT         NULL,
    tarifas       JSONB        NOT NULL DEFAULT '[]'::jsonb, -- [{origin_iso2: "BR", destination_iso2: "CR", rate_pct: 13.0}]
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_ncm_code_touch ON productos.ncm_code;
CREATE TRIGGER trg_ncm_code_touch
    BEFORE UPDATE ON productos.ncm_code
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS ix_ncm_code_code ON productos.ncm_code(code);
CREATE INDEX IF NOT EXISTS ix_ncm_code_is_active ON productos.ncm_code(is_active) WHERE is_active = TRUE;

-- Seed initial data
INSERT INTO productos.ncm_code (code, descripcion, tarifas) VALUES
('6403.40.00', 'Calzado de seguridad con puntera de metal', '[{"origin_iso2": "BR", "destination_iso2": "CR", "rate_pct": 13.0}, {"origin_iso2": "CN", "destination_iso2": "CR", "rate_pct": 0.0}]'::jsonb),
('6403.99.90', 'Otros calzados con suela de caucho y parte superior de cuero', '[{"origin_iso2": "BR", "destination_iso2": "CR", "rate_pct": 10.0}]'::jsonb),
('6406.90.20', 'Plantillas amovibles (Palmilhas) de seguridad', '[{"origin_iso2": "BR", "destination_iso2": "CR", "rate_pct": 10.0}]'::jsonb)
ON CONFLICT (code) DO NOTHING;

