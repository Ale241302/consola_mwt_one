-- =====================================================================
-- MWT.ONE · B2_seed_tallas_calzado.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint Sizing Engine v1 · Seed canónico de tallas de calzado.
-- Fecha: 2026-05-02
--
-- Pobla `ops.tallas` con las 15 tallas oficiales MWT (EU 35–49) y sus
-- equivalencias internacionales (BR, US Men, UK Men, CM Mondopoint).
-- Datos provienen de la tabla maestra MWT validada con MARLUVAS Brasil.
--
--   BRA 33–34  → sin equivalencia US/UK (sólo EU + BR + CM)
--   BRA 35–47  → matriz completa EU/US/UK/CM
--
-- IDEMPOTENCIA:
--   · Las filas se marcan con metadata.seed_source = 'B2_seed_tallas_calzado_v1'.
--   · Antes del INSERT borramos todas las filas con ese marker, así
--     re-ejecutar el archivo deja la tabla en estado canónico.
--   · `pulgadas` (in) se preserva en metadata porque el schema no tiene
--     columna dedicada para inches (sólo cm Mondopoint).
--
-- Dependencias: A3_sizing_engine.sql (crea ops.tallas).
-- =====================================================================

BEGIN;

-- ─── Limpieza idempotente del seed anterior ─────────────────────────
DELETE FROM ops.tallas
 WHERE metadata ->> 'seed_source' = 'B2_seed_tallas_calzado_v1';

-- ─── Seed canónico · 15 tallas EU 35–49 ─────────────────────────────
INSERT INTO ops.tallas (
    tipo_producto, talla_base, nombre, descripcion,
    eu, us_men, uk_men, br, cm,
    is_active, metadata
) VALUES
    -- BRA 33 / EU 35 — sin US/UK
    ('calzado', '35', '35', 'Calzado MWT — talla EU 35 / BRA 33',
     '35', NULL, NULL, '33', '22.64',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"8.91"}'::jsonb),

    -- BRA 34 / EU 36 — sin US/UK
    ('calzado', '36', '36', 'Calzado MWT — talla EU 36 / BRA 34',
     '36', NULL, NULL, '34', '23.30',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"9.17"}'::jsonb),

    -- BRA 35 / EU 37
    ('calzado', '37', '37', 'Calzado MWT — talla EU 37 / BRA 35',
     '37', '4.5', '4', '35', '23.97',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"9.44"}'::jsonb),

    -- BRA 36 / EU 38
    ('calzado', '38', '38', 'Calzado MWT — talla EU 38 / BRA 36',
     '38', '5-5.5', '4.5-5', '36', '24.63',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"9.69"}'::jsonb),

    -- BRA 37 / EU 39
    ('calzado', '39', '39', 'Calzado MWT — talla EU 39 / BRA 37',
     '39', '6-6.5', '5.5-6', '37', '25.30',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"9.96"}'::jsonb),

    -- BRA 38 / EU 40
    ('calzado', '40', '40', 'Calzado MWT — talla EU 40 / BRA 38',
     '40', '7', '6.5', '38', '25.96',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"10.22"}'::jsonb),

    -- BRA 39 / EU 41
    ('calzado', '41', '41', 'Calzado MWT — talla EU 41 / BRA 39',
     '41', '7.5-8', '7-7.5', '39', '26.63',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"10.48"}'::jsonb),

    -- BRA 40 / EU 42
    ('calzado', '42', '42', 'Calzado MWT — talla EU 42 / BRA 40',
     '42', '8.5-9', '8-8.5', '40', '27.30',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"10.75"}'::jsonb),

    -- BRA 41 / EU 43
    ('calzado', '43', '43', 'Calzado MWT — talla EU 43 / BRA 41',
     '43', '9.5', '9', '41', '27.96',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"11.00"}'::jsonb),

    -- BRA 42 / EU 44
    ('calzado', '44', '44', 'Calzado MWT — talla EU 44 / BRA 42',
     '44', '10-10.5', '9.5-10', '42', '28.63',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"11.27"}'::jsonb),

    -- BRA 43 / EU 45
    ('calzado', '45', '45', 'Calzado MWT — talla EU 45 / BRA 43',
     '45', '11', '11', '43', '29.29',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"11.53"}'::jsonb),

    -- BRA 44 / EU 46
    ('calzado', '46', '46', 'Calzado MWT — talla EU 46 / BRA 44',
     '46', '12', '11.5', '44', '29.96',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"11.79"}'::jsonb),

    -- BRA 45 / EU 47
    ('calzado', '47', '47', 'Calzado MWT — talla EU 47 / BRA 45',
     '47', '12.5-13', '12', '45', '30.63',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"12.06"}'::jsonb),

    -- BRA 46 / EU 48
    ('calzado', '48', '48', 'Calzado MWT — talla EU 48 / BRA 46',
     '48', '14', '13', '46', '31.29',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"12.32"}'::jsonb),

    -- BRA 47 / EU 49
    ('calzado', '49', '49', 'Calzado MWT — talla EU 49 / BRA 47',
     '49', '15', '14', '47', '31.96',
     TRUE,
     '{"seed_source":"B2_seed_tallas_calzado_v1","inches":"12.58"}'::jsonb);

COMMIT;

-- =====================================================================
-- Verificación rápida (no falla si está vacío, sólo informa).
--   SELECT COUNT(*) FROM ops.tallas
--    WHERE metadata->>'seed_source' = 'B2_seed_tallas_calzado_v1';
--   → 15
--
--   SELECT talla_base, eu, us_men, uk_men, br, cm
--     FROM ops.tallas
--    WHERE tipo_producto = 'calzado'
--    ORDER BY (eu)::int ASC;
-- =====================================================================
