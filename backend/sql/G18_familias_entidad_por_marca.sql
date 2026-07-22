-- =====================================================================
-- G18 · Familias de línea como ENTIDAD por marca (brands.marca_familia)
-- Sprint 2026-07-22
--
-- Hasta aquí la "familia" de una talla era un string libre en
-- `ops.tallas.metadata->>'familia'` y el select del FE venía
-- HARDCODEADO en apps/sizing/views.py (familias_linea). Con G18 la
-- familia pasa a ser una entidad administrable por marca:
--
--   1) brands.marca_familia — catálogo CRUD (única por marca+nombre
--      case-insensitive entre activas). Alimenta
--      GET/POST/PATCH/DELETE /api/sizing/familias/ y el
--      `familias_linea` de /api/sizing/options/.
--
--   2) ops.tallas gana columnas single-valor `marca_id` y `familia_id`
--      (UUID lógico, SIN FK — regla de oro MWT). `marca_ids` (JSONB)
--      queda LEGACY y el backend lo mantiene sincronizado:
--      marca_ids = [marca_id]. `tipos`/`familias` (arrays) quedan
--      legacy/inertes.
--
--   3) Backfill:
--      · Seed de familias desde (marca_ids[0], metadata.familia) de
--        las tallas existentes.
--      · tallas.marca_id  ← marca_ids[0]
--      · tallas.familia_id ← brands.marca_familia.id (match marca+nombre)
--      · productos.producto.especificaciones.familia_id ← id de la
--        familia (match p.marca_id + especificaciones.familia = nombre)
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING / updates con
-- guardas IS NULL. Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ENTIDAD · brands.marca_familia
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands.marca_familia (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    marca_id    UUID         NOT NULL,              -- brands.marca (lógico, sin FK)
    nombre      VARCHAR(64)  NOT NULL,
    descripcion TEXT         NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE brands.marca_familia IS
  'Familias de línea de producto por marca (G18). Una familia pertenece a '
  'UNA marca; unicidad (marca_id, lower(nombre)) entre activas. Sin FK: '
  'vínculos lógicos por UUID, resueltos en backend.';

-- Única por marca+nombre (case-insensitive) sólo entre ACTIVAS: al
-- desactivar una familia se libera el nombre para crear otra.
CREATE UNIQUE INDEX IF NOT EXISTS ux_marca_familia_marca_nombre_ci
    ON brands.marca_familia (marca_id, lower(nombre)) WHERE is_active;
CREATE INDEX IF NOT EXISTS ix_marca_familia_marca
    ON brands.marca_familia (marca_id);

-- Trigger updated_at (misma convención que brands.marca · 20_brands.sql)
CREATE OR REPLACE FUNCTION brands.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_marca_familia_updated_at ON brands.marca_familia;
CREATE TRIGGER tg_marca_familia_updated_at
    BEFORE UPDATE ON brands.marca_familia
    FOR EACH ROW EXECUTE FUNCTION brands.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 2) ops.tallas · columnas single-valor marca_id / familia_id
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tallas ADD COLUMN IF NOT EXISTS marca_id   UUID NULL;
ALTER TABLE ops.tallas ADD COLUMN IF NOT EXISTS familia_id UUID NULL;

CREATE INDEX IF NOT EXISTS ix_tallas_marca_id   ON ops.tallas (marca_id);
CREATE INDEX IF NOT EXISTS ix_tallas_familia_id ON ops.tallas (familia_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3a) SEED · familias detectadas en las tallas existentes
--     (marca = marca_ids[0] · nombre = metadata.familia)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO brands.marca_familia (marca_id, nombre)
SELECT DISTINCT (t.marca_ids->>0)::uuid, t.metadata->>'familia'
  FROM ops.tallas t
 WHERE t.metadata->>'familia' IS NOT NULL
   AND btrim(t.metadata->>'familia') <> ''
   AND t.marca_ids->>0 IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3b) BACKFILL · tallas.marca_id ← marca_ids[0]
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas
   SET marca_id   = (marca_ids->>0)::uuid,
       updated_at = NOW()
 WHERE marca_id IS NULL
   AND jsonb_array_length(marca_ids) > 0;

-- ─────────────────────────────────────────────────────────────────────
-- 3c) BACKFILL · tallas.familia_id ← match (marca_id, metadata.familia)
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas t
   SET familia_id = f.id,
       updated_at = NOW()
  FROM brands.marca_familia f
 WHERE t.familia_id IS NULL
   AND t.marca_id = f.marca_id
   AND f.nombre = t.metadata->>'familia';

-- ─────────────────────────────────────────────────────────────────────
-- 3d) BACKFILL · productos: especificaciones.familia_id (match
--     p.marca_id + especificaciones.familia = nombre de la familia)
-- ─────────────────────────────────────────────────────────────────────
UPDATE productos.producto p
   SET especificaciones = p.especificaciones
                          || jsonb_build_object('familia_id', f.id::text),
       updated_at = NOW()
  FROM brands.marca_familia f
 WHERE p.marca_id = f.marca_id
   AND p.especificaciones->>'familia' = f.nombre
   AND p.especificaciones->>'familia_id' IS NULL;

-- Verificación esperada:
--   SELECT m.nombre AS marca, f.nombre AS familia, f.is_active
--     FROM brands.marca_familia f JOIN brands.marca m ON m.id = f.marca_id
--    ORDER BY 1, 2;
--   SELECT count(*) FILTER (WHERE marca_id IS NOT NULL)   AS con_marca,
--          count(*) FILTER (WHERE familia_id IS NOT NULL) AS con_familia
--     FROM ops.tallas;
-- =====================================================================
