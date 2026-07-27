-- =====================================================================
-- G2 · Motor de Tallas — tipos completos + Matriz de Equivalencias
-- Sprint 2026-07-16 (parte 2)
--
-- 1) TIPOS: todas las tallas activas quedan marcadas con los 5 tipos
--    (decisión CEO): Bota Alta · Bota al Tobillo · Plantilla · Tenis ·
--    Zapato tipo crocs.
--
-- 2) MATRIZ DE EQUIVALENCIAS (EU 34–49) — 15 sistemas, investigada de
--    tablas internacionales estándar (2026-07-16):
--      · EU/BR/US men/UK men/CM: se respeta el grading ya en producción
--        (BR = EU − 2, paso CM 2/3 · Marluvas) y se completan los vacíos
--        (tallas 34–36).
--      · US women = US men + 2 (convención Brannock/charts USA).
--      · UK women = UK men (el Reino Unido usa la misma escala adulta).
--      · US/UK youth: sólo hasta EU 40 (7Y / UK 6), rango junior.
--      · MX = CM redondeado a 0.5 más cercano; JP = largo de pie en cm
--        (charts: JP/MX comparten origen en Mondopoint, MX se redondea).
--      · AR = EU (sistema argentino idéntico al europeo, IRAM 8604).
--      · KR = milímetros (JP × 10, pasos de 5 mm).
--      · CN = numeración china tradicional ≈ 2×cm − 10.
--      · ALFA: XS 34-35 · S 36-38 · M 39-41 · L 42-44 · XL 45-46 · XXL 47-49.
--    ⚠ Talla 34: tenía BR=34 (chocaba con la 36, que también es BR 34).
--      Se corrige a BR=32 siguiendo el patrón BR = EU − 2.
--
-- Idempotente (UPDATEs deterministas). El entrypoint lo aplica una vez
-- (public._applied_sql). Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1 · Todas las tallas activas → los 5 tipos
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas
   SET tipos = '["Bota Alta","Bota al Tobillo","Plantilla","Tenis","Zapato tipo crocs"]'::jsonb,
       updated_at = NOW()
 WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- 2 · Matriz de Equivalencias completa (por talla_base, EU 34–49)
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas t
   SET eu        = v.eu,
       us_men    = v.us_men,
       us_women  = v.us_women,
       us_youth  = v.us_youth,
       uk_men    = v.uk_men,
       uk_women  = v.uk_women,
       uk_youth  = v.uk_youth,
       br        = v.br,
       mx        = v.mx,
       ar        = v.ar,
       jp        = v.jp,
       cn        = v.cn,
       kr        = v.kr,
       cm        = v.cm,
       alfa      = v.alfa,
       updated_at = NOW()
  FROM (VALUES
    -- base  eu    us_men      us_women     us_youth   uk_men      uk_women    uk_youth   br    mx      ar    jp      cn    kr     cm       alfa
    ('34', '34', '2.5-3',    '4.5-5',     '2.5-3',   '1.5-2',    '1.5-2',    '1.5-2',   '32', '22',   '34', '21',   '32', '210', '21.97', 'XS'),
    ('35', '35', '3-3.5',    '5-5.5',     '3.5',     '2.5-3',    '2.5-3',    '2.5',     '33', '22.5', '35', '22',   '34', '220', '22.64', 'XS'),
    ('36', '36', '4',        '6',         '4-4.5',   '3-3.5',    '3-3.5',    '3-3.5',   '34', '23.5', '36', '22.5', '35', '225', '23.30', 'S'),
    ('37', '37', '4.5',      '6.5',       '5',       '4',        '4',        '4',       '35', '24',   '37', '23',   '36', '230', '23.97', 'S'),
    ('38', '38', '5-5.5',    '7-7.5',     '5.5-6',   '4.5-5',    '4.5-5',    '4.5-5',   '36', '24.5', '38', '24',   '39', '240', '24.63', 'S'),
    ('39', '39', '6-6.5',    '8-8.5',     '6.5-7',   '5.5-6',    '5.5-6',    '5.5-6',   '37', '25.5', '39', '24.5', '39', '245', '25.30', 'M'),
    ('40', '40', '7',        '9',         '7',       '6.5',      '6.5',      '6',       '38', '26',   '40', '25',   '40', '250', '25.96', 'M'),
    ('41', '41', '7.5-8',    '9.5-10',    NULL,      '7-7.5',    '7-7.5',    NULL,      '39', '26.5', '41', '26',   '42', '260', '26.63', 'M'),
    ('42', '42', '8.5-9',    '10.5-11',   NULL,      '8-8.5',    '8-8.5',    NULL,      '40', '27.5', '42', '26.5', '43', '265', '27.30', 'L'),
    ('43', '43', '9.5',      '11.5',      NULL,      '9',        '9',        NULL,      '41', '28',   '43', '27',   '44', '270', '27.96', 'L'),
    ('44', '44', '10-10.5',  '12-12.5',   NULL,      '9.5-10',   '9.5-10',   NULL,      '42', '28.5', '44', '28',   '46', '280', '28.63', 'L'),
    ('45', '45', '11',       '13',        NULL,      '10.5-11',  '10.5-11',  NULL,      '43', '29.5', '45', '28.5', '47', '285', '29.29', 'XL'),
    ('46', '46', '12',       '14',        NULL,      '11.5',     '11.5',     NULL,      '44', '30',   '46', '29',   '48', '290', '29.96', 'XL'),
    ('47', '47', '12.5-13',  '14.5-15',   NULL,      '12',       '12',       NULL,      '45', '30.5', '47', '30',   '50', '300', '30.63', 'XXL'),
    ('48', '48', '14',       '16',        NULL,      '13',       '13',       NULL,      '46', '31.5', '48', '30.5', '51', '305', '31.29', 'XXL'),
    ('49', '49', '15',       '17',        NULL,      '14',       '14',       NULL,      '47', '32',   '49', '31',   '52', '310', '31.96', 'XXL')
  ) AS v(talla_base, eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
         br, mx, ar, jp, cn, kr, cm, alfa)
 WHERE t.is_active = TRUE
   AND t.tipo_producto = 'calzado'
   AND trim(t.talla_base) = v.talla_base;
