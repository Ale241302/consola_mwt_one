-- =====================================================================
-- G14 · Corrida "Composite Prime" — tallas BR 33–50 (decisión CEO)
-- Sprint 2026-07-22
--
-- Reconstrucción del catálogo (tras G13) por familia de línea.
-- Familia COMPOSITE PRIME = cuero/nobuck/microfibra × puntera
-- Composite 200J, rango oficial del PDF "Sepa la talla" (33–50).
--
--   · metadata.familia = 'Composite Prime'  (select Familia del drawer)
--   · tipos     = 13 capelladas cuero/nobuck/microfibra (filtro de
--                 producto sigue funcionando por capellada)
--   · familias  = ["Composite 200J"]        (filtro por tipo puntera)
--   · cm        = comprimento ÷ 10 (valores de la Tabla de Numeración
--                 oficial: 22.64, 23.30, 23.97, 24.63, …)
--   · inch      = comprimento ÷ 25.4 (2 decimales)
--   · ancho_mm / comprimento_mm según la tabla del PDF (ancho sólo
--     33–47; el PDF no lo publica para 48–50)
--   · Equivalencias EU/US/UK/MX/AR/JP/CN/KR/ALFA = matriz oficial ya
--     validada (BR base; 49–50 extrapoladas con el mismo grading).
--
-- Idempotente: NOT EXISTS por (talla_base, metadata->>'familia').
-- Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

DROP TABLE IF EXISTS _g14_marca;
CREATE TEMP TABLE _g14_marca AS
SELECT id::text AS marca_id
  FROM brands.marca
 WHERE is_active = TRUE AND lower(nombre) = 'marluvas'
 LIMIT 1;

DROP TABLE IF EXISTS _g14_data;
CREATE TEMP TABLE _g14_data (
    talla text PRIMARY KEY,
    eu text, us_men text, us_women text, us_youth text,
    uk_men text, uk_women text, uk_youth text,
    mx text, ar text, jp text, cn text, kr text, alfa text,
    ancho numeric(5,1), compr numeric(6,2), cm text
);
INSERT INTO _g14_data VALUES
--  talla eu   us_men     us_women    us_youth  uk_men    uk_women  uk_youth  mx     ar   jp     cn   kr    alfa  ancho  compr    cm
    ('33','35','3-3.5',   '5-5.5',    '3.5',    '2.5-3',  '2.5-3',  '2.5',    '22',  '35','22',  '35','225','XS', 83.1,  226.38, '22.64'),
    ('34','36','4',       '6',        '4-4.5',  '3-3.5',  '3-3.5',  '3-3.5',  '22.5','36','22.5','37','235','S',  84.8,  233.04, '23.30'),
    ('35','37','4.5',     '6.5',      '5',      '4',      '4',      '4',      '23',  '37','23',  '38','240','S',  86.5,  239.70, '23.97'),
    ('36','38','5-5.5',   '7-7.5',    '5.5-6',  '4.5-5',  '4.5-5',  '4.5-5',  '24',  '38','24',  '39','245','S',  88.2,  246.36, '24.63'),
    ('37','39','6-6.5',   '8-8.5',    '6.5-7',  '5.5-6',  '5.5-6',  '5.5-6',  '24.5','39','24.5','41','255','M',  89.9,  253.02, '25.30'),
    ('38','40','7',       '9',        '7',      '6.5',    '6.5',    '6',      '25',  '40','25',  '42','260','M',  91.6,  259.68, '25.96'),
    ('39','41','7.5-8',   '9.5-10',   NULL,     '7-7.5',  '7-7.5',  NULL,     '26',  '41','26',  '43','265','M',  93.3,  266.34, '26.63'),
    ('40','42','8.5-9',   '10.5-11',  NULL,     '8-8.5',  '8-8.5',  NULL,     '26.5','42','26.5','45','275','L',  95.0,  273.00, '27.30'),
    ('41','43','9.5',     '11.5',     NULL,     '9',      '9',      NULL,     '27',  '43','27',  '46','280','L',  96.7,  279.66, '27.96'),
    ('42','44','10-10.5', '12-12.5',  NULL,     '9.5-10', '9.5-10', NULL,     '28',  '44','28',  '47','285','L',  98.4,  286.32, '28.63'),
    ('43','45','11',      '13',       NULL,     '10.5-11','10.5-11',NULL,     '28.5','45','28.5','49','295','XL', 100.1, 292.98, '29.29'),
    ('44','46','12',      '14',       NULL,     '11.5',   '11.5',   NULL,     '29',  '46','29',  '50','300','XL', 101.8, 299.64, '29.96'),
    ('45','47','12.5-13', '14.5-15',  NULL,     '12',     '12',     NULL,     '30',  '47','30',  '51','305','XXL',103.5, 306.30, '30.63'),
    ('46','48','14',      '16',       NULL,     '13',     '13',     NULL,     '30.5','48','30.5','53','315','XXL',105.2, 312.96, '31.29'),
    ('47','49','15',      '17',       NULL,     '14',     '14',     NULL,     '31',  '49','31',  '54','320','XXL',106.9, 319.62, '31.96'),
    ('48','50','15.5-16', '17.5-18',  NULL,     '15',     '15',     NULL,     '31.5','50','31.5','55','325','3XL',NULL,  326.28, '32.63'),
    ('49','51','16.5-17', '18.5-19',  NULL,     '16',     '16',     NULL,     '32',  '51','32',  '56','330','3XL',NULL,  332.94, '33.29'),
    ('50','52','17.5-18', '19.5-20',  NULL,     '17',     '17',     NULL,     '32.5','52','32.5','57','335','3XL',NULL,  339.60, '33.96');

INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    marca_ids, tipos, familias,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, inch, alfa,
    ancho_mm, comprimento_mm, metadata
)
SELECT 'calzado', d.talla, d.talla,
       'Medidas internas Marluvas (Composite Prime · puntera Composite 200J): '
       || concat_ws(' · ',
            CASE WHEN d.ancho IS NOT NULL THEN 'ancho ' || replace(trim(to_char(d.ancho, 'FM999990.0')), '.', ',') || ' mm' END,
            'comprimento ' || replace(trim(to_char(d.compr, 'FM999990.00')), '.', ',') || ' mm'),
       CASE WHEN (SELECT marca_id FROM _g14_marca) IS NOT NULL
            THEN jsonb_build_array((SELECT marca_id FROM _g14_marca))
            ELSE '[]'::jsonb END,
       '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb,
       '["Composite 200J"]'::jsonb,
       d.eu, d.us_men, d.us_women, d.us_youth, d.uk_men, d.uk_women, d.uk_youth,
       d.talla, d.mx, d.ar, d.jp, d.cn, d.kr, d.cm,
       trim(to_char(ROUND(d.compr / 25.4, 2), 'FM999990.00')),
       d.alfa,
       d.ancho, d.compr,
       jsonb_build_object('familia', 'Composite Prime')
  FROM _g14_data d
 WHERE NOT EXISTS (
       SELECT 1 FROM ops.tallas t
        WHERE trim(t.talla_base) = d.talla
          AND t.metadata->>'familia' = 'Composite Prime'
 );

-- Verificación esperada: 18 tallas (33–50) con
-- metadata->>'familia' = 'Composite Prime', cm e inch poblados.
-- =====================================================================
