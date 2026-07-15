-- ============================================================
-- F3 · Agregar plazo de 15 días a los snapshots de precios Marluvas
-- Sprint 2026-07-15 · opción (A): el motor expone el plazo de 15 días
-- por SKU/banda, así aparece solo en el wizard (Paso 3) y en las vistas.
--
-- Tabla:  pricing.marluvas_client_sku_pricing (col JSONB `prices_matrix`)
-- Shape:  { "<banda_id>": { "8": precio, "30": precio, "60": ..., "90": ... }, ... }
--
-- El precio de 15 días se INTERPOLA linealmente entre el de 8 y el de 30
-- días de la MISMA banda:
--     p15 = p8 + (p30 - p8) * (15 - 8) / (30 - 8)
--
-- ⚠ IMPORTANTE: es un valor DERIVADO, no un precio oficial de Marluvas.
-- Si el equipo comercial tiene el precio real de 15 días por SKU, debe
-- reemplazar estos valores. Este script solo garantiza que el plazo
-- EXISTA para que el front lo muestre.
--
-- Idempotente: si la banda ya tiene "15", no lo toca. Solo agrega "15"
-- cuando existen tanto "8" como "30" en esa banda.
-- ============================================================

DO $$
DECLARE
  r           RECORD;
  banda_key   text;
  banda_obj   jsonb;
  p8          numeric;
  p30         numeric;
  p15         numeric;
  new_matrix  jsonb;
  changed     boolean;
  n_rows      integer := 0;
  n_bandas    integer := 0;
BEGIN
  FOR r IN
    SELECT id, prices_matrix
      FROM pricing.marluvas_client_sku_pricing
     WHERE is_active = TRUE
       AND prices_matrix IS NOT NULL
       AND jsonb_typeof(prices_matrix) = 'object'
  LOOP
    new_matrix := r.prices_matrix;
    changed    := FALSE;

    FOR banda_key, banda_obj IN
      SELECT key, value FROM jsonb_each(r.prices_matrix)
    LOOP
      IF jsonb_typeof(banda_obj) = 'object'
         AND NOT (banda_obj ? '15')
         AND (banda_obj ? '8')
         AND (banda_obj ? '30')
      THEN
        BEGIN
          p8  := (banda_obj->>'8')::numeric;
          p30 := (banda_obj->>'30')::numeric;
        EXCEPTION WHEN others THEN
          CONTINUE;  -- valores no numéricos: saltar esta banda
        END;

        IF p8 IS NOT NULL AND p30 IS NOT NULL AND p8 > 0 AND p30 > 0 THEN
          p15 := round(p8 + (p30 - p8) * (15 - 8) / (30 - 8), 4);
          new_matrix := jsonb_set(new_matrix, ARRAY[banda_key, '15'], to_jsonb(p15), true);
          changed  := TRUE;
          n_bandas := n_bandas + 1;
        END IF;
      END IF;
    END LOOP;

    IF changed THEN
      UPDATE pricing.marluvas_client_sku_pricing
         SET prices_matrix = new_matrix,
             updated_at     = NOW()
       WHERE id = r.id;
      n_rows := n_rows + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'F3 · plazo 15d agregado: % filas, % bandas.', n_rows, n_bandas;
END $$;

-- Verificación (cuántas bandas tienen ya el plazo de 15 días):
--   SELECT count(*) AS bandas_con_15d
--     FROM pricing.marluvas_client_sku_pricing p,
--          jsonb_each(p.prices_matrix) b
--    WHERE p.is_active AND (b.value ? '15');
