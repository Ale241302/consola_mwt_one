-- =====================================================================
-- G21 · Corrida "Prime" — tallas BR 33–50 (Puntera de Plástico o Acero)
-- Sprint 2026-07-23
--
-- Crea el catálogo de tallas para la familia Prime de Marluvas usando
-- las medidas internas del PDF "Sepa la Talla del Calzado Marluvas"
-- (tabla "Puntera de Plástico o Acero"). El resto de equivalencias
-- (EU/US/UK/AR/JP/CN/KR/ALFA) se toman de la matriz canónica ya
-- validada para calzado Marluvas; MX se deriva de CM redondeado a 0.5.
--
-- Idempotente: DELETE previo por (marca_id, familia_id, talla_base).
-- Manual: psql -U mwt -d mwt_one -f <este_archivo>
-- =====================================================================

BEGIN;

-- ─── Marca / familia objetivo ─────────────────────────────────────
DROP TABLE IF EXISTS _g21_target;
CREATE TEMP TABLE _g21_target AS
SELECT
  '51db751c-2e74-4dd3-a592-d4bd2cc38b25'::uuid AS marca_id,
  '3296dc26-96c5-45df-a916-78f42f9ac6b4'::uuid AS familia_id;

-- ─── Datos canónicos Prime ──────────────────────────────────────────
DROP TABLE IF EXISTS _g21_data;
CREATE TEMP TABLE _g21_data (
    talla text PRIMARY KEY,
    eu text, us_men text, us_women text, us_youth text,
    uk_men text, uk_women text, uk_youth text,
    ar text, jp text, cn text, kr text, alfa text,
    ancho numeric(5,1), compr numeric(6,2)
);
INSERT INTO _g21_data VALUES
--  talla eu   us_men     us_women    us_youth  uk_men    uk_women  uk_youth  ar   jp     cn   kr    alfa  ancho  compr
    ('33','35','3-3.5',   '5-5.5',    '3.5',    '2.5-3',  '2.5-3',  '2.5',    '35','22',  '35','225','XS', 83.1,  223.38),
    ('34','36','4',       '6',        '4-4.5',  '3-3.5',  '3-3.5',  '3-3.5',  '36','22.5','37','235','S',  84.8,  230.04),
    ('35','37','4.5',     '6.5',      '5',      '4',      '4',      '4',      '37','23',  '38','240','S',  86.5,  236.70),
    ('36','38','5-5.5',   '7-7.5',    '5.5-6',  '4.5-5',  '4.5-5',  '4.5-5',  '38','24',  '39','245','S',  88.2,  243.36),
    ('37','39','6-6.5',   '8-8.5',    '6.5-7',  '5.5-6',  '5.5-6',  '5.5-6',  '39','24.5','41','255','M',  89.9,  250.02),
    ('38','40','7',       '9',        '7',      '6.5',    '6.5',    '6',      '40','25',  '42','260','M',  91.6,  256.68),
    ('39','41','7.5-8',   '9.5-10',   NULL,     '7-7.5',  '7-7.5',  NULL,     '41','26',  '43','265','M',  93.3,  263.34),
    ('40','42','8.5-9',   '10.5-11',  NULL,     '8-8.5',  '8-8.5',  NULL,     '42','26.5','45','275','L',  95.0,  270.00),
    ('41','43','9.5',     '11.5',     NULL,     '9',      '9',      NULL,     '43','27',  '46','280','L',  96.7,  276.66),
    ('42','44','10-10.5', '12-12.5',  NULL,     '9.5-10', '9.5-10', NULL,     '44','28',  '47','285','L',  98.4,  283.32),
    ('43','45','11',      '13',       NULL,     '10.5-11','10.5-11',NULL,     '45','28.5','49','295','XL', 100.1, 289.98),
    ('44','46','12',      '14',       NULL,     '11.5',   '11.5',   NULL,     '46','29',  '50','300','XL', 101.8, 296.64),
    ('45','47','12.5-13', '14.5-15',  NULL,     '12',     '12',     NULL,     '47','30',  '51','305','XXL',103.5, 303.30),
    ('46','48','14',      '16',       NULL,     '13',     '13',     NULL,     '48','30.5','53','315','XXL',105.2, 309.96),
    ('47','49','15',      '17',       NULL,     '14',     '14',     NULL,     '49','31',  '54','320','XXL',106.9, 316.62),
    ('48','50','15.5-16', '17.5-18',  NULL,     '15',     '15',     NULL,     '50','31.5','55','325','3XL',NULL,  323.28),
    ('49','51','16.5-17', '18.5-19',  NULL,     '16',     '16',     NULL,     '51','32',  '56','330','3XL',NULL,  329.94),
    ('50','52','17.5-18', '19.5-20',  NULL,     '17',     '17',     NULL,     '52','32.5','57','335','3XL',NULL,  336.60);

-- ─── Limpieza idempotente ─────────────────────────────────────────
DELETE FROM ops.tallas
 WHERE marca_id = (SELECT marca_id FROM _g21_target)
   AND familia_id = (SELECT familia_id FROM _g21_target);

-- ─── Inserción ────────────────────────────────────────────────────
WITH prime AS (
    SELECT d.*,
           trim(to_char(ROUND(d.compr / 10, 2), 'FM999990.00')) AS cm,
           trim(to_char(ROUND(d.compr / 25.4, 2), 'FM999990.00')) AS inch,
           -- MX (México) = CM redondeado a 0.5 más cercano (G24).
           trim_scale(round((ROUND(d.compr / 10, 2))::numeric * 2) / 2)::text AS mx
      FROM _g21_data d
)
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_id, familia_id, marca_ids,
    equivalencias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, inch, alfa,
    ancho_mm, comprimento_mm, metadata,
    is_active, created_at, updated_at
)
SELECT
    'calzado',
    d.talla,
    d.talla,
    'Medidas internas Marluvas (familia Prime · puntera plástico o acero): '
    || concat_ws(' · ',
         CASE WHEN d.ancho IS NOT NULL THEN 'ancho ' || replace(trim(to_char(d.ancho, 'FM999990.0')), '.', ',') || ' mm' END,
         'comprimento ' || replace(trim(to_char(d.compr, 'FM999990.00')), '.', ',') || ' mm'),
    tg.marca_id,
    tg.familia_id,
    jsonb_build_array(tg.marca_id),
    jsonb_strip_nulls(jsonb_build_object(
        'eu', d.eu, 'us_men', d.us_men, 'us_women', d.us_women, 'us_youth', d.us_youth,
        'uk_men', d.uk_men, 'uk_women', d.uk_women, 'uk_youth', d.uk_youth,
        'br', d.talla, 'mx', d.mx, 'ar', d.ar, 'jp', d.jp, 'cn', d.cn, 'kr', d.kr,
        'cm', d.cm,
        'inch', d.inch,
        'alfa', d.alfa
    )),
    d.eu, d.us_men, d.us_women, d.us_youth, d.uk_men, d.uk_women, d.uk_youth,
    d.talla, d.mx, d.ar, d.jp, d.cn, d.kr,
    d.cm,
    d.inch,
    d.alfa,
    d.ancho, d.compr,
    jsonb_build_object('familia', 'Prime'),
    TRUE, NOW(), NOW()
  FROM prime d
 CROSS JOIN _g21_target tg;

COMMIT;

-- Verificación esperada: 18 tallas con familia_id = Prime y cm en
-- 22.34, 23.00, 23.67, 24.34, 25.00, 25.67, 26.33, 27.00, 27.67,
-- 28.33, 29.00, 29.66, 30.33, 31.00, 31.66, 32.33, 32.99, 33.66.
-- =====================================================================
