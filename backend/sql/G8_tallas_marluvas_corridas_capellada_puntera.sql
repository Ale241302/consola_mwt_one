-- =====================================================================
-- G8 · Motor de Tallas — corridas Marluvas por capellada × tipo puntera
-- Sprint 2026-07-21
--
-- Re-clasifica el catálogo de tallas según la decisión del CEO:
--   · `tipos`    pasa a ser la CAPELLADA (catálogo productos.attr_opcion,
--                key='capellada') — antes tenía los 5 tipo_calzado.
--   · `familias` pasa a ser el TIPO DE PUNTERA (key='tipo_puntera') —
--                antes tenía los prefijos de familia (50B22, …).
--
-- Fuente de verdad de medidas: PDF oficial Marluvas "Sepa cual la talla
-- de su calzado" (comprimento/ancho internos en mm) + "Tabla de
-- Numeracion oficial de Marluvas" (equivalencias BRA/EU/USA).
--   · CM (Mondopoint) = comprimento ÷ 10, redondeado a 2 decimales.
--   · El ANCHO no tiene columna en la matriz de 15 sistemas: se conserva
--     en `descripcion` junto al comprimento original.
--
-- Corridas creadas (según los grupos del PDF):
--   A · Cuero/Nobuck/Microfibra (13 capelladas) × Plástico/Acero 200J/
--       Citoplástico 200C  → BR 33–50
--   B · Cuero × Composite 200J → BR 33–50. Los 17 registros existentes
--       (32–48) se CONVIERTEN en esta corrida (sus cm ya venían de la
--       tabla composite) y se insertan sólo las tallas nuevas 49–50.
--   C · Cuero × No tiene (sin puntera) → BR 33–47
--   D · EVA × No tiene → BR 33–47
--   E · PVC × Acero 200J/No tiene (All Work) → BR 33–48. La línea
--       Vulcafiex (≈ +8 mm de comprimento) queda notada en `descripcion`
--       para no duplicar tallas en el selector del form de producto.
--
-- Las equivalencias de los 15 sistemas se heredan de la matriz oficial
-- ya validada en producción (BR base); 49–50 se extrapolan con el mismo
-- grading (EU = BR + 2, paso ⅔ cm) porque el PDF de numeración llega a
-- 47 — queda documentado.
--
-- Idempotente: PARTE 1 sólo toca registros que aún tienen la etiqueta
-- vieja 'Bota Alta'; los INSERTs usan NOT EXISTS sobre
-- (talla_base, tipos, familias). Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

DROP TABLE IF EXISTS _g8_marca;
CREATE TEMP TABLE _g8_marca AS
SELECT id::text AS marca_id
  FROM brands.marca
 WHERE is_active = TRUE AND lower(nombre) = 'marluvas'
 LIMIT 1;

-- ─────────────────────────────────────────────────────────────────────
-- 0 · Matriz de equivalencias compartida (BR 33–50) — misma numeración
--     oficial para todas las corridas; sólo varía el CM por corrida.
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _g8_equiv;
CREATE TEMP TABLE _g8_equiv (
    talla text PRIMARY KEY,
    eu text, us_men text, us_women text, us_youth text,
    uk_men text, uk_women text, uk_youth text,
    mx text, ar text, jp text, cn text, kr text, alfa text
);
INSERT INTO _g8_equiv VALUES
--  talla  eu    us_men      us_women     us_youth   uk_men     uk_women   uk_youth   mx      ar    jp      cn    kr     alfa
    ('33', '35', '3-3.5',    '5-5.5',     '3.5',     '2.5-3',   '2.5-3',   '2.5',     '22',   '35', '22',   '35', '225', 'XS'),
    ('34', '36', '4',        '6',         '4-4.5',   '3-3.5',   '3-3.5',   '3-3.5',   '22.5', '36', '22.5', '37', '235', 'S'),
    ('35', '37', '4.5',      '6.5',       '5',       '4',       '4',       '4',       '23',   '37', '23',   '38', '240', 'S'),
    ('36', '38', '5-5.5',    '7-7.5',     '5.5-6',   '4.5-5',   '4.5-5',   '4.5-5',   '24',   '38', '24',   '39', '245', 'S'),
    ('37', '39', '6-6.5',    '8-8.5',     '6.5-7',   '5.5-6',   '5.5-6',   '5.5-6',   '24.5', '39', '24.5', '41', '255', 'M'),
    ('38', '40', '7',        '9',         '7',       '6.5',     '6.5',     '6',       '25',   '40', '25',   '42', '260', 'M'),
    ('39', '41', '7.5-8',    '9.5-10',    NULL,      '7-7.5',   '7-7.5',   NULL,      '26',   '41', '26',   '43', '265', 'M'),
    ('40', '42', '8.5-9',    '10.5-11',   NULL,      '8-8.5',   '8-8.5',   NULL,      '26.5', '42', '26.5', '45', '275', 'L'),
    ('41', '43', '9.5',      '11.5',      NULL,      '9',       '9',       NULL,      '27',   '43', '27',   '46', '280', 'L'),
    ('42', '44', '10-10.5',  '12-12.5',   NULL,      '9.5-10',  '9.5-10',  NULL,      '28',   '44', '28',   '47', '285', 'L'),
    ('43', '45', '11',       '13',        NULL,      '10.5-11', '10.5-11', NULL,      '28.5', '45', '28.5', '49', '295', 'XL'),
    ('44', '46', '12',       '14',        NULL,      '11.5',    '11.5',    NULL,      '29',   '46', '29',   '50', '300', 'XL'),
    ('45', '47', '12.5-13',  '14.5-15',   NULL,      '12',      '12',      NULL,      '30',   '47', '30',   '51', '305', 'XXL'),
    ('46', '48', '14',       '16',        NULL,      '13',      '13',      NULL,      '30.5', '48', '30.5', '53', '315', 'XXL'),
    ('47', '49', '15',       '17',        NULL,      '14',      '14',      NULL,      '31',   '49', '31',   '54', '320', 'XXL'),
    ('48', '50', '15.5-16',  '17.5-18',   NULL,      '15',      '15',      NULL,      '31.5', '50', '31.5', '55', '325', '3XL'),
    -- 49–50: extrapoladas con el grading oficial (EU = BR+2, paso ⅔ cm)
    ('49', '51', '16.5-17',  '18.5-19',   NULL,      '16',      '16',      NULL,      '32',   '51', '32',   '56', '330', '3XL'),
    ('50', '52', '17.5-18',  '19.5-20',   NULL,      '17',      '17',      NULL,      '32.5', '52', '32.5', '57', '335', '3XL');

-- ─────────────────────────────────────────────────────────────────────
-- 1 · Medidas internas del PDF (mm) por corrida + CM derivado.
--     ancho NULL a partir de la 48 (el PDF no lo publica).
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _g8_medidas;
CREATE TEMP TABLE _g8_medidas (
    grupo  text,
    talla  text,
    ancho  text,   -- mm, tal cual PDF (coma decimal)
    compr  text,   -- mm, tal cual PDF
    cm     text,   -- compr ÷ 10 redondeado a 2 decimales
    PRIMARY KEY (grupo, talla)
);
INSERT INTO _g8_medidas VALUES
-- Puntera de Plástico o Acero (cuero/nobuck/microfibra) · BR 33–50
    ('plas_acero','33','83,1','223,38','22.34'),
    ('plas_acero','34','84,8','230,04','23.00'),
    ('plas_acero','35','86,5','236,7','23.67'),
    ('plas_acero','36','88,2','243,36','24.34'),
    ('plas_acero','37','89,9','250,02','25.00'),
    ('plas_acero','38','91,6','256,68','25.67'),
    ('plas_acero','39','93,3','263,34','26.33'),
    ('plas_acero','40','95','270','27.00'),
    ('plas_acero','41','96,7','276,66','27.67'),
    ('plas_acero','42','98,4','283,32','28.33'),
    ('plas_acero','43','100,1','289,98','29.00'),
    ('plas_acero','44','101,8','296,64','29.66'),
    ('plas_acero','45','103,5','303,3','30.33'),
    ('plas_acero','46','105,2','309,96','31.00'),
    ('plas_acero','47','106,9','316,62','31.66'),
    ('plas_acero','48',NULL,'323,28','32.33'),
    ('plas_acero','49',NULL,'329,94','32.99'),
    ('plas_acero','50',NULL,'336,6','33.66'),
-- Puntera Composite (cuero/nobuck/microfibra) · BR 33–50
    ('composite','33','83,1','226,38','22.64'),
    ('composite','34','84,8','233,04','23.30'),
    ('composite','35','86,5','239,7','23.97'),
    ('composite','36','88,2','246,36','24.64'),
    ('composite','37','89,9','253,02','25.30'),
    ('composite','38','91,6','259,68','25.97'),
    ('composite','39','93,3','266,34','26.63'),
    ('composite','40','95','273','27.30'),
    ('composite','41','96,7','279,66','27.97'),
    ('composite','42','98,4','286,32','28.63'),
    ('composite','43','100,1','292,98','29.30'),
    ('composite','44','101,8','299,64','29.96'),
    ('composite','45','103,5','306,3','30.63'),
    ('composite','46','105,2','312,96','31.30'),
    ('composite','47','106,9','319,62','31.96'),
    ('composite','48',NULL,'326,28','32.63'),
    ('composite','49',NULL,'332,94','33.29'),
    ('composite','50',NULL,'339,6','33.96'),
-- Cuero Sin Puntera · BR 33–47 (la 33 no publica comprimento)
    ('sin_puntera','33','83,1',NULL,NULL),
    ('sin_puntera','34','84,8','244,28','24.43'),
    ('sin_puntera','35','86,5','250,87','25.09'),
    ('sin_puntera','36','88,2','257,46','25.75'),
    ('sin_puntera','37','89,9','264,06','26.41'),
    ('sin_puntera','38','91,6','270,65','27.07'),
    ('sin_puntera','39','93,3','277,25','27.73'),
    ('sin_puntera','40','95','283,84','28.38'),
    ('sin_puntera','41','96,7','290,44','29.04'),
    ('sin_puntera','42','98,4','297,03','29.70'),
    ('sin_puntera','43','100,1','303,63','30.36'),
    ('sin_puntera','44','101,8','310,26','31.03'),
    ('sin_puntera','45','103,5','316,85','31.69'),
    ('sin_puntera','46','105,2','323,45','32.35'),
    ('sin_puntera','47','106,9','330,04','33.00'),
-- EVA Sin Puntera · BR 33–47
    ('eva','33','83,1','219,2','21.92'),
    ('eva','34','84,8','225,81','22.58'),
    ('eva','35','86,5','232,04','23.20'),
    ('eva','36','88,2','238,64','23.86'),
    ('eva','37','89,9','245,27','24.53'),
    ('eva','38','91,6','251,78','25.18'),
    ('eva','39','93,3','258,36','25.84'),
    ('eva','40','95','265,32','26.53'),
    ('eva','41','96,7','272,25','27.23'),
    ('eva','42','98,4','278,53','27.85'),
    ('eva','43','100,1','285','28.50'),
    ('eva','44','101,8','294,33','29.43'),
    ('eva','45','103,5','294,33','29.43'),
    ('eva','46','105,2','308,46','30.85'),
    ('eva','47','106,9','308,46','30.85'),
-- PVC All Work · Con o sin Puntera de Acero · BR 33–48
    ('pvc','33','83,1','228,5','22.85'),
    ('pvc','34','84,8','228,5','22.85'),
    ('pvc','35','86,5','241,5','24.15'),
    ('pvc','36','88,2','241,5','24.15'),
    ('pvc','37','89,9','251,5','25.15'),
    ('pvc','38','91,6','258','25.80'),
    ('pvc','39','93,3','264,5','26.45'),
    ('pvc','40','95','271','27.10'),
    ('pvc','41','96,7','277,5','27.75'),
    ('pvc','42','98,4','284','28.40'),
    ('pvc','43','100,1','290,5','29.05'),
    ('pvc','44','101,8','297','29.70'),
    ('pvc','45','103,5','307','30.70'),
    ('pvc','46','105,2','307','30.70'),
    ('pvc','47','106,9','320','32.00'),
    ('pvc','48',NULL,'320','32.00');

-- ─────────────────────────────────────────────────────────────────────
-- 2 · PARTE 1 — los 17 registros actuales (BR 32–48, aún etiquetados
--     con 'Bota Alta') se convierten en la corrida B · Cuero × Composite
--     200J. Sus equivalencias y cm ya son las oficiales: sólo se
--     re-etiquetan y se documenta el ancho/comprimento del PDF.
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas t
   SET tipos = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       familias = '["Composite 200J"]'::jsonb,
       descripcion = 'Medidas internas Marluvas (cuero/nobuck/microfibra · puntera Composite 200J): '
                     || concat_ws(' · ',
                          CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
                          CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END),
       updated_at = NOW()
  FROM _g8_medidas m
 WHERE t.is_active = TRUE
   AND t.tipo_producto = 'calzado'
   AND t.tipos ? 'Bota Alta'          -- ← marca de la clasificación vieja
   AND m.grupo = 'composite'
   AND trim(t.talla_base) = m.talla;

-- Talla 32: fuera de la tabla oficial (33–47), conserva sus
-- equivalencias actuales; sólo se re-etiqueta.
UPDATE ops.tallas t
   SET tipos = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       familias = '["Composite 200J"]'::jsonb,
       descripcion = 'Corrida cuero/nobuck/microfibra · puntera Composite 200J. '
                     'Talla fuera de la tabla oficial Marluvas (33–47): medidas internas no publicadas.',
       updated_at = NOW()
 WHERE t.is_active = TRUE
   AND t.tipo_producto = 'calzado'
   AND t.tipos ? 'Bota Alta'
   AND trim(t.talla_base) = '32';

-- ─────────────────────────────────────────────────────────────────────
-- 3 · PARTE 2 — INSERT de las corridas nuevas (NOT EXISTS = idempotente)
-- ─────────────────────────────────────────────────────────────────────

-- A · Cuero × Plástico / Acero 200J / Citoplástico 200C · BR 33–50
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa
)
SELECT 'calzado', e.talla, e.talla,
       'Medidas internas Marluvas (cuero/nobuck/microfibra · puntera Plástico/Acero 200J/Citoplástico 200C): '
       || concat_ws(' · ',
            CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
            CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END),
       CASE WHEN (SELECT marca_id FROM _g8_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g8_marca))
            ELSE '[]'::jsonb END,
       '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       '["Plástico","Acero 200J","Citoplástico 200C"]'::jsonb,
       e.eu, e.us_men, e.us_women, e.us_youth, e.uk_men, e.uk_women, e.uk_youth,
       e.talla, e.mx, e.ar, e.jp, e.cn, e.kr, m.cm, e.alfa
  FROM _g8_equiv e
  JOIN _g8_medidas m ON m.grupo = 'plas_acero' AND m.talla = e.talla
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = e.talla
          AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
          AND t.familias = '["Plástico","Acero 200J","Citoplástico 200C"]'::jsonb
 );

-- B · Cuero × Composite 200J · BR 49–50 (33–48 ya existen tras PARTE 1)
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa
)
SELECT 'calzado', e.talla, e.talla,
       'Medidas internas Marluvas (cuero/nobuck/microfibra · puntera Composite 200J): '
       || concat_ws(' · ',
            CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
            CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END),
       CASE WHEN (SELECT marca_id FROM _g8_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g8_marca))
            ELSE '[]'::jsonb END,
       '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       '["Composite 200J"]'::jsonb,
       e.eu, e.us_men, e.us_women, e.us_youth, e.uk_men, e.uk_women, e.uk_youth,
       e.talla, e.mx, e.ar, e.jp, e.cn, e.kr, m.cm, e.alfa
  FROM _g8_equiv e
  JOIN _g8_medidas m ON m.grupo = 'composite' AND m.talla = e.talla
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = e.talla
          AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
          AND t.familias = '["Composite 200J"]'::jsonb
 );

-- C · Cuero × No tiene (sin puntera) · BR 33–47
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa
)
SELECT 'calzado', e.talla, e.talla,
       'Medidas internas Marluvas (cuero/nobuck/microfibra · sin puntera): '
       || concat_ws(' · ',
            CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
            CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END,
            CASE WHEN m.compr IS NULL THEN 'comprimento no publicado' END),
       CASE WHEN (SELECT marca_id FROM _g8_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g8_marca))
            ELSE '[]'::jsonb END,
       '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       '["No tiene"]'::jsonb,
       e.eu, e.us_men, e.us_women, e.us_youth, e.uk_men, e.uk_women, e.uk_youth,
       e.talla, e.mx, e.ar, e.jp, e.cn, e.kr, m.cm, e.alfa
  FROM _g8_equiv e
  JOIN _g8_medidas m ON m.grupo = 'sin_puntera' AND m.talla = e.talla
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = e.talla
          AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
          AND t.familias = '["No tiene"]'::jsonb
 );

-- D · EVA × No tiene · BR 33–47
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa
)
SELECT 'calzado', e.talla, e.talla,
       'Medidas internas Marluvas (EVA · sin puntera): '
       || concat_ws(' · ',
            CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
            CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END),
       CASE WHEN (SELECT marca_id FROM _g8_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g8_marca))
            ELSE '[]'::jsonb END,
       '["EVA"]'::jsonb,
       '["No tiene"]'::jsonb,
       e.eu, e.us_men, e.us_women, e.us_youth, e.uk_men, e.uk_women, e.uk_youth,
       e.talla, e.mx, e.ar, e.jp, e.cn, e.kr, m.cm, e.alfa
  FROM _g8_equiv e
  JOIN _g8_medidas m ON m.grupo = 'eva' AND m.talla = e.talla
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = e.talla
          AND t.tipos    = '["EVA"]'::jsonb
          AND t.familias = '["No tiene"]'::jsonb
 );

-- E · PVC × Acero 200J / No tiene (All Work) · BR 33–48
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa
)
SELECT 'calzado', e.talla, e.talla,
       'Medidas internas Marluvas (PVC All Work · con o sin puntera de acero): '
       || concat_ws(' · ',
            CASE WHEN m.ancho IS NOT NULL THEN 'ancho ' || m.ancho || ' mm' END,
            CASE WHEN m.compr IS NOT NULL THEN 'comprimento ' || m.compr || ' mm' END)
       || '. Línea Vulcafiex ≈ +8 mm de comprimento (no duplicada para evitar tallas repetidas en el selector)',
       CASE WHEN (SELECT marca_id FROM _g8_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g8_marca))
            ELSE '[]'::jsonb END,
       '["PVC"]'::jsonb,
       '["Acero 200J","No tiene"]'::jsonb,
       e.eu, e.us_men, e.us_women, e.us_youth, e.uk_men, e.uk_women, e.uk_youth,
       e.talla, e.mx, e.ar, e.jp, e.cn, e.kr, m.cm, e.alfa
  FROM _g8_equiv e
  JOIN _g8_medidas m ON m.grupo = 'pvc' AND m.talla = e.talla
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = e.talla
          AND t.tipos    = '["PVC"]'::jsonb
          AND t.familias = '["Acero 200J","No tiene"]'::jsonb
 );

-- ─────────────────────────────────────────────────────────────────────
-- 4 · Verificación (visible en el log del entrypoint)
-- ─────────────────────────────────────────────────────────────────────
--   SELECT familias, COUNT(*), MIN(talla_base), MAX(talla_base)
--     FROM ops.tallas WHERE is_active GROUP BY familias ORDER BY 1;
--   Esperado tras aplicar:
--     ["Acero 200J","No tiene"]            → 16  (PVC 33–48)
--     ["Composite 200J"]                   → 19  (cuero 32–50)
--     ["No tiene"]                         → 30  (cuero 33–47 + EVA 33–47)
--     ["Plástico","Acero 200J","Citoplástico 200C"] → 18 (cuero 33–50)
--   TOTAL activo: 83 tallas.
-- =====================================================================
