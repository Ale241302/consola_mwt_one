-- =====================================================================
-- G23 · Matriz de Equivalencias por Tipo + Marca + Grupo
-- Sprint 2026-07-23
--
-- Hasta G22 la lista de unidades de la matriz vivía en
-- ops.tipo_producto_cat.sistemas y era la MISMA para todas las marcas y
-- grupos de un mismo tipo de producto.
--
-- Con este script se crea ops.tipo_producto_matriz que permite definir
-- unidades (y más adelante defaults) por combinación
-- (tipo_producto, marca_id, familia_id). La tabla padre conserva
-- `sistemas` como fallback/default cuando no hay matriz específica.
--
-- Idempotente. Manual: psql -U mwt -d mwt_one -f <este_archivo>
-- =====================================================================

BEGIN;

-- ─── 1) Tabla de configuración de matrices ───────────────────────────
CREATE TABLE IF NOT EXISTS ops.tipo_producto_matriz (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_producto varchar(32) NOT NULL,
    marca_id    uuid NULL,
    familia_id  uuid NULL,
    sistemas    jsonb NOT NULL DEFAULT '[]'::jsonb,
    defaults    jsonb NULL,        -- valores por defecto de equivalencias
    is_active   boolean NOT NULL DEFAULT TRUE,
    created_at  timestamptz NOT NULL DEFAULT NOW(),
    updated_at  timestamptz NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS ops.uq_tipo_producto_matriz;
CREATE UNIQUE INDEX uq_tipo_producto_matriz
  ON ops.tipo_producto_matriz (
      tipo_producto,
      COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(familia_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMENT ON TABLE ops.tipo_producto_matriz IS
  'Configuración de unidades de la matriz de equivalencias por tipo de producto, marca y grupo de tallas.';

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION ops.tpm_set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tipo_producto_matriz_updated_at
  ON ops.tipo_producto_matriz;
CREATE TRIGGER trg_tipo_producto_matriz_updated_at
  BEFORE UPDATE ON ops.tipo_producto_matriz
  FOR EACH ROW EXECUTE FUNCTION ops.tpm_set_updated_at();

-- ─── 2) Migración de sistemas existentes del tipo base ─────────────
-- Cada tipo_producto_cat.sistemas vigente se copia como matriz default
-- (marca_id=NULL, familia_id=NULL) para no romper el FE actual.
INSERT INTO ops.tipo_producto_matriz
    (tipo_producto, marca_id, familia_id, sistemas, is_active)
SELECT codigo, NULL, NULL, COALESCE(sistemas, '[]'::jsonb), is_active
  FROM ops.tipo_producto_cat
 WHERE COALESCE(sistemas, '[]'::jsonb) <> '[]'::jsonb
ON CONFLICT (tipo_producto,
             COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(familia_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO UPDATE SET sistemas = EXCLUDED.sistemas,
              is_active = EXCLUDED.is_active,
              updated_at = NOW();

-- ─── 3) Matriz específica para Marluvas Calzado ────────────────────
-- Composite y Prime comparten la misma lista de unidades actual.
INSERT INTO ops.tipo_producto_matriz
    (tipo_producto, marca_id, familia_id, sistemas)
VALUES
    ('calzado', '51db751c-2e74-4dd3-a592-d4bd2cc38b25'::uuid,
     'c696fe4f-a287-4099-920a-c9534d28ded4'::uuid,
     '["eu","us_men","us_women","us_youth",
       "uk_men","uk_women","uk_youth",
       "mx","ar","cr","gt","cop",
       "jp","cn","kr","cm","inch","alfa"]'::jsonb),
    ('calzado', '51db751c-2e74-4dd3-a592-d4bd2cc38b25'::uuid,
     '3296dc26-96c5-45df-a916-78f42f9ac6b4'::uuid,
     '["eu","us_men","us_women","us_youth",
       "uk_men","uk_women","uk_youth",
       "mx","ar","cr","gt","cop",
       "jp","cn","kr","cm","inch","alfa"]'::jsonb)
ON CONFLICT (tipo_producto,
             COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(familia_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO UPDATE SET sistemas = EXCLUDED.sistemas,
              updated_at = NOW();

COMMIT;

-- Verificación esperada:
--   SELECT tipo_producto, marca_id, familia_id, jsonb_array_length(sistemas)
--     FROM ops.tipo_producto_matriz ORDER BY tipo_producto;
-- =====================================================================
