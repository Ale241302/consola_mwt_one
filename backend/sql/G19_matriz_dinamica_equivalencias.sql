-- =====================================================================
-- G19 · Matriz de Equivalencias DINÁMICA por tipo de producto
-- Sprint 2026-07-22 (decisión CEO: "motor dinámico")
--
-- La matriz deja de ser 16 columnas fijas: pasa a ser un objeto JSONB
-- por talla (`equivalencias`) cuyas claves son códigos de UNIDAD DE
-- MEDIDA administrables (ops.medida_sistema_cat), y cada TIPO de
-- producto declara qué unidades usa (ops.tipo_producto_cat.sistemas).
--
--   1) ops.tallas.equivalencias JSONB — fuente de verdad de la matriz.
--      Backfill desde las 16 columnas legacy no-nulas + las 4
--      dimensionales (como texto). Las 16 columnas char quedan como
--      ESPEJO legacy para consumidores SQL (matchmaker,
--      proforma_extractor, wizard, portal) — el backend las mantiene
--      sincronizadas en TallaSerializer.validate().
--
--   2) ops.tipo_producto_cat +sistemas (códigos de unidad, en orden)
--      +talla_base_label. Config inicial:
--        · calzado   → los 16 códigos de equivalencia del modelo
--          (eu…inch + alfa — `alfa` existe en el catálogo desde A3,
--          hoy inactiva por G12; queda al final y el FE la filtra).
--        · plantilla → los mismos 16 + las 4 dimensionales.
--
--   3) Seed de unidades nuevas en ops.medida_sistema_cat:
--      4 DIMENSIONAL (plantilla) + 11 CORPORAL (prenda/cuerpo) +
--      2 US (pantalón). Órdenes secuenciales tras los existentes
--      (máx actual = 150 de alfa). NO se crean tipos de producto
--      nuevos (Camisas, Pantalones… los crea el usuario desde la UI).
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING / backfill con
-- guarda equivalencias='{}'. Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) ops.tallas.equivalencias + backfill desde columnas legacy
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tallas
    ADD COLUMN IF NOT EXISTS equivalencias JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN ops.tallas.equivalencias IS
  'Matriz dinámica de equivalencias (G19): {codigo_unidad: valor}. Fuente '
  'de verdad; las 16 columnas char son espejo legacy sincronizado por el backend.';

UPDATE ops.tallas
   SET equivalencias = jsonb_strip_nulls(jsonb_build_object(
           'eu', eu, 'us_men', us_men, 'us_women', us_women,
           'us_youth', us_youth, 'uk_men', uk_men, 'uk_women', uk_women,
           'uk_youth', uk_youth, 'br', br, 'mx', mx, 'ar', ar,
           'jp', jp, 'cn', cn, 'kr', kr, 'cm', cm, 'inch', inch,
           'alfa', alfa,
           'grosor_antepie_mm', grosor_antepie_mm::text,
           'grosor_talon_mm',   grosor_talon_mm::text,
           'drop_mm',           drop_mm::text,
           'peso_g',            peso_g::text)),
       updated_at = NOW()
 WHERE equivalencias = '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────
-- 2) ops.tipo_producto_cat · sistemas + talla_base_label
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tipo_producto_cat
    ADD COLUMN IF NOT EXISTS sistemas JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS talla_base_label VARCHAR(60) NULL;

-- Red de seguridad: `alfa` existe desde A3 (G12 sólo la desactivó).
-- Si algún entorno no la tuviera, se crea aquí (grupo 'alfa' · METRIC).
INSERT INTO ops.medida_sistema_cat
    (codigo, label, region, descripcion, grupo, orden)
VALUES
    ('alfa', 'Alfa (S/M/L)', 'METRIC',
     'Alphanumeric — usado en plantillas.', 'alfa', 150)
ON CONFLICT (codigo) DO NOTHING;

UPDATE ops.tipo_producto_cat
   SET sistemas = '["eu","us_men","us_women","us_youth",
                    "uk_men","uk_women","uk_youth",
                    "br","mx","ar","jp","cn","kr","cm","inch","alfa"]'::jsonb,
       talla_base_label = 'Talla base (BRA)',
       updated_at = NOW()
 WHERE codigo = 'calzado';

UPDATE ops.tipo_producto_cat
   SET sistemas = '["eu","us_men","us_women","us_youth",
                    "uk_men","uk_women","uk_youth",
                    "br","mx","ar","jp","cn","kr","cm","inch","alfa",
                    "grosor_antepie_mm","grosor_talon_mm","drop_mm","peso_g"]'::jsonb,
       talla_base_label = 'Talla base',
       updated_at = NOW()
 WHERE codigo = 'plantilla';

-- ─────────────────────────────────────────────────────────────────────
-- 3) Seed de unidades nuevas (órdenes secuenciales tras 150=alfa)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO ops.medida_sistema_cat
    (codigo, label, region, descripcion, grupo, orden)
VALUES
    -- Dimensionales de plantilla (vivían como campos fijos del drawer)
    ('grosor_antepie_mm', 'Grosor antepié (mm)', 'DIMENSIONAL',
     'Grosor de la plantilla en el antepié (mm).', 'DIMENSIONAL', 160),
    ('grosor_talon_mm', 'Grosor talón (mm)', 'DIMENSIONAL',
     'Grosor de la plantilla en el talón (mm).', 'DIMENSIONAL', 170),
    ('drop_mm', 'Drop (mm)', 'DIMENSIONAL',
     'Drop talón-antepié de la plantilla (mm).', 'DIMENSIONAL', 180),
    ('peso_g', 'Peso (g)', 'DIMENSIONAL',
     'Peso referencial de la plantilla (g).', 'DIMENSIONAL', 190),
    -- Medidas corporales / de prenda
    ('pecho_cm', 'Pecho (contorno cm)', 'CORPORAL',
     'Contorno de pecho de la prenda (cm).', 'CORPORAL', 200),
    ('cuello_cm', 'Cuello (contorno cm)', 'CORPORAL',
     'Contorno de cuello (cm).', 'CORPORAL', 210),
    ('hombros_cm', 'Hombros (ancho cm)', 'CORPORAL',
     'Ancho de hombros de la prenda (cm).', 'CORPORAL', 220),
    ('manga_cm', 'Largo de manga (cm)', 'CORPORAL',
     'Largo de manga (cm).', 'CORPORAL', 230),
    ('largo_espalda_cm', 'Largo de espalda (cm)', 'CORPORAL',
     'Largo de espalda de la prenda (cm).', 'CORPORAL', 240),
    ('cintura_cm', 'Cintura (contorno cm)', 'CORPORAL',
     'Contorno de cintura (cm).', 'CORPORAL', 250),
    ('cadera_cm', 'Cadera (contorno cm)', 'CORPORAL',
     'Contorno de cadera (cm).', 'CORPORAL', 260),
    ('entrepierna_cm', 'Entrepierna (cm)', 'CORPORAL',
     'Largo de entrepierna (cm).', 'CORPORAL', 270),
    ('largo_total_cm', 'Largo total (cm)', 'CORPORAL',
     'Largo total de la prenda (cm).', 'CORPORAL', 280),
    ('tiro_cm', 'Altura de tiro (cm)', 'CORPORAL',
     'Altura de tiro del pantalón (cm).', 'CORPORAL', 290),
    ('apertura_bota_cm', 'Apertura de bota (cm)', 'CORPORAL',
     'Apertura de bota del pantalón (cm).', 'CORPORAL', 300),
    -- Pantalón (sistemas US)
    ('us_waist', 'US Waist pantalón (in)', 'US',
     'Cintura de pantalón en pulgadas (W).', 'US', 310),
    ('jeans_wl', 'Jeans W×L (in)', 'US',
     'Jeans cintura×largo en pulgadas (W×L).', 'US', 320)
ON CONFLICT (codigo) DO NOTHING;

-- Verificación esperada:
--   SELECT codigo, talla_base_label, jsonb_array_length(sistemas)
--     FROM ops.tipo_producto_cat;          -- calzado 16 · plantilla 20
--   SELECT count(*) FROM ops.medida_sistema_cat;  -- 16 previos + 17 nuevos = 33
--   SELECT equivalencias FROM ops.tallas WHERE equivalencias <> '{}';
-- =====================================================================
