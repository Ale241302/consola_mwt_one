-- =====================================================================
-- G1 · Motor de Tallas v2 + Catálogo de opciones de atributos
-- Sprint 2026-07-16
--
-- PARTE A — ops.tallas: cada talla pasa a tener 3 clasificadores,
-- todos MULTI-VALOR (decisión CEO 2026-07-16):
--   · marca_ids  JSONB  → 1+ marcas (UUIDs de brands.marca, como texto)
--   · tipos      JSONB  → 1+ tipos  (Bota Alta / Bota al Tobillo /
--                          Zapato tipo crocs / Tenis / Plantillas / …)
--   · familias   JSONB  → 1+ familias (prefijo del nombre del producto,
--                          ej. 50B22 engloba 50B22M-CPAP-PAD, 50B22-V-…)
--
-- Backfill: las tallas ya existentes se asignan a la marca Marluvas y a
-- TODAS las familias detectadas en los nombres de producto actuales
-- (patrón dígitos+letras+dígitos al inicio del nombre: 50B22, 70C32…).
--
-- PARTE B — productos.attr_opcion: catálogo PERSISTIDO de opciones de
-- los atributos técnicos (tipo_calzado, capellada, color, …). Hasta hoy
-- las opciones eran constante del FE ∪ valores en uso — imposible
-- eliminar una opción (p.ej. "Zapato"). Ahora el FE consume
-- GET /api/productos/attr-options/ y la eliminación es real
-- (bloqueada si algún producto usa el valor).
--
-- Idempotente. El entrypoint del backend lo aplica solo una vez
-- (public._applied_sql). Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- A1 · Columnas nuevas en ops.tallas
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tallas ADD COLUMN IF NOT EXISTS marca_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ops.tallas ADD COLUMN IF NOT EXISTS tipos     JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ops.tallas ADD COLUMN IF NOT EXISTS familias  JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS ix_tallas_marcas   ON ops.tallas USING gin (marca_ids);
CREATE INDEX IF NOT EXISTS ix_tallas_familias ON ops.tallas USING gin (familias);

-- La tabla ops.talla_grupo fue un WIP nunca desplegado (diseño
-- descartado a favor de campos multi-valor en la talla). Limpieza segura.
DROP TABLE IF EXISTS ops.talla_grupo;

-- ─────────────────────────────────────────────────────────────────────
-- A2 · Backfill de tallas existentes:
--      marca = Marluvas · familias = todas las detectadas en productos
-- ─────────────────────────────────────────────────────────────────────
WITH fams AS (
    SELECT DISTINCT upper(substring(nombre FROM '^[0-9]+[A-Za-z]+[0-9]+')) AS fam
    FROM productos.producto
    WHERE is_active AND nombre ~* '^[0-9]+[A-Za-z]+[0-9]+'
),
fam_arr AS (
    SELECT COALESCE(jsonb_agg(fam ORDER BY fam), '[]'::jsonb) AS arr
    FROM fams WHERE fam IS NOT NULL
),
marluvas AS (
    SELECT id::text AS mid FROM brands.marca
    WHERE lower(nombre) = 'marluvas'
    LIMIT 1
)
UPDATE ops.tallas t
   SET marca_ids = COALESCE(
           (SELECT jsonb_build_array(mid) FROM marluvas), t.marca_ids),
       familias  = (SELECT arr FROM fam_arr),
       updated_at = NOW()
 WHERE t.marca_ids = '[]'::jsonb
   AND t.familias  = '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────
-- B1 · Catálogo persistido de opciones de atributos técnicos
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.attr_opcion (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    key         VARCHAR(40)  NOT NULL,
    value       VARCHAR(160) NOT NULL,
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_attr_opcion_key_value
    ON productos.attr_opcion (key, lower(value));

-- ─────────────────────────────────────────────────────────────────────
-- B2 · Seed base (espejo de BRAND_ATTRIBUTES del frontend a 2026-07-16)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO productos.attr_opcion (key, value) VALUES
  ('tipo_calzado','Bota Alta'),('tipo_calzado','Bota al Tobillo'),
  ('tipo_calzado','Zapato tipo crocs'),('tipo_calzado','Tenis'),
  ('tipo_calzado','Plantilla'),
  ('cubrepuntera','Sí'),('cubrepuntera','No'),
  ('tipo_puntera','Acero 200J'),('tipo_puntera','Composite 200J'),
  ('tipo_puntera','No tiene'),('tipo_puntera','Plástico'),
  ('tipo_puntera','Citoplástico 200C'),
  ('antiperforante','Acero 1100 N'),('antiperforante','Textil 1100 N'),
  ('antiperforante','No'),
  ('protector_metatarsal','Interno'),('protector_metatarsal','Externo'),
  ('protector_metatarsal','No'),
  ('capellada','Cuero Carnaza'),('capellada','Cuero Plena Flor'),
  ('capellada','Cuero Plena Flor HIDRO'),('capellada','Cuero Nobuck'),
  ('capellada','Microfibra'),('capellada','Mmicro'),('capellada','PVC'),
  ('capellada','Cuero Rodock'),('capellada','Cuero Vaqueta Lisa'),
  ('capellada','EVA'),('capellada','Cuero Vaqueta HIDRO'),
  ('capellada','Cuero Liso Fuego'),('capellada','Cuero Nobuck Hidrofugado'),
  ('capellada','Cuero Liso HIDRO'),('capellada','Anti-llamas'),
  ('disipativo_energia','ISO 20345 14.000V'),
  ('disipativo_energia','ASTM 2413 18.000V'),
  ('disipativo_energia','ABNT NBR 16603-2017 500V'),
  ('disipativo_energia','ISO 20345 14.000V ANT'),
  ('disipativo_energia','Conductivo'),('disipativo_energia','No'),
  ('suela','Bidensidad PU'),('suela','Bidensidad PU Caucho'),
  ('suela','Caucho'),('suela','Monodensidad Caucho'),
  ('normativa','ASTM F2413'),('normativa','ISO 20345'),('normativa','No'),
  ('normativa','ISO 20347'),('normativa','ABNT NBR 16.603:2017 500V - SECO'),
  ('cierre','Sin Cordones'),('cierre','Con Cordones'),('cierre','De meter'),
  ('cierre','Zipper'),('cierre','Cierre Velcro'),
  ('color','Negro'),('color','Blanco'),('color','Marron'),('color','Café'),
  ('color','Verde Musgo'),('color','Gris'),('color','Azul Marino'),
  ('color','Marron Claro'),('color','Dark Brown'),('color','Grafite'),
  ('color','Marron Taupe'),('color','Rojo'),('color','Castor'),
  ('color','Amarillo'),
  ('segmento','Agrícola'),('segmento','Alimentaria'),('segmento','Producción'),
  ('segmento','Administrativo'),('segmento','Construcción'),
  ('segmento','Electricista'),('segmento','Astillero'),('segmento','Limpieza'),
  ('segmento','Madereras'),('segmento','Metalurgia'),('segmento','Militares'),
  ('segmento','Mineria'),('segmento','Montadoras'),('segmento','Mensajeria'),
  ('segmento','Petroquimicos'),('segmento','Rescate'),('segmento','Salud'),
  ('segmento','Siderurgia'),('segmento','Trekking'),('segmento','Multiservicios'),
  ('segmento','Agroindustria'),
  ('materiales_circulares','Sí'),('materiales_circulares','No'),
  ('materiales_circulares','Suela'),
  ('plantilla_interna','Poliuretano'),('plantilla_interna','Etilvinilacetato'),
  ('plantilla_interna','Etilvinilacetato ANT'),('plantilla_interna','No'),
  ('riesgo','Alta Temperatura'),('riesgo','Ambiente Frio'),('riesgo','Shock'),
  ('riesgo','Estática'),('riesgo','Esguince'),('riesgo','Punción Plantar'),
  ('riesgo','Humedad'),('riesgo','Piso Resbaladizo'),('riesgo','Caída Objetos'),
  ('riesgo','Ocupacional'),('riesgo','Seguridad'),('riesgo','Polimerico'),
  ('riesgo','Químicos')
ON CONFLICT (key, lower(value)) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- B3 · Seed dinámico: valores YA en uso en productos.producto
--      (single-select + multi-select) que no estén en el catálogo.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO productos.attr_opcion (key, value)
SELECT k.key, v.val
FROM (VALUES ('tipo_calzado'),('cubrepuntera'),('tipo_puntera'),
             ('antiperforante'),('protector_metatarsal'),('capellada'),
             ('suela'),('cierre'),('color'),('materiales_circulares'),
             ('plantilla_interna')) AS k(key)
CROSS JOIN LATERAL (
    SELECT DISTINCT trim(p.especificaciones ->> k.key) AS val
    FROM productos.producto p
    WHERE p.especificaciones ->> k.key IS NOT NULL
      AND trim(p.especificaciones ->> k.key) <> ''
) v
ON CONFLICT (key, lower(value)) DO NOTHING;

INSERT INTO productos.attr_opcion (key, value)
SELECT k.key, v.val
FROM (VALUES ('disipativo_energia'),('normativa'),('segmento'),('riesgo')) AS k(key)
CROSS JOIN LATERAL (
    SELECT DISTINCT trim(e.val) AS val
    FROM productos.producto p,
         jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p.especificaciones -> k.key) = 'array'
                  THEN p.especificaciones -> k.key
                  ELSE '[]'::jsonb END) AS e(val)
    WHERE trim(e.val) <> ''
) v
ON CONFLICT (key, lower(value)) DO NOTHING;
