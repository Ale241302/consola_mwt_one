-- =====================================================================
-- MWT.ONE · 41c_productos_sku_marca_active.sql
-- Agente responsable: [AG-DATABASE]
--
-- Cambia la unicidad de SKU del catálogo:
--   ANTES: UNIQUE(sku) GLOBAL en productos.producto.
--   AHORA: UNIQUE(sku, marca_id) parcial WHERE is_active = TRUE.
--
-- Motivos:
--   1. El mismo SKU puede existir legítimamente en distintas marcas
--      (e.g. el código "50B22M-A" de Marluvas vs un código homónimo
--      de otra distribuida). La unicidad debe ser POR MARCA.
--   2. Registros soft-deleted (is_active=FALSE) no deben bloquear la
--      reutilización del SKU. Aunque ahora el destroy es HARD DELETE,
--      pueden existir filas legacy con is_active=FALSE que estaban
--      reservando el slot por culpa del UNIQUE global.
--
-- Idempotente: identifica el constraint global por inferencia (cualquier
-- UNIQUE constraint sobre (sku) solo). El partial index usa IF NOT EXISTS.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/41c_productos_sku_marca_active.sql
-- =====================================================================

-- 1) Drop del UNIQUE(sku) global, identificando el nombre auto-asignado
--    por Postgres (típicamente `producto_sku_key`). Si no existe, no-op.
DO $$
DECLARE
    cname TEXT;
BEGIN
    SELECT con.conname
      INTO cname
      FROM pg_constraint con
      JOIN pg_class       rel ON rel.oid = con.conrelid
      JOIN pg_namespace   nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'productos'
       AND rel.relname = 'producto'
       AND con.contype = 'u'
       AND (
           SELECT array_agg(att.attname ORDER BY u.ord)
             FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute att
               ON att.attrelid = con.conrelid
              AND att.attnum   = u.attnum
       ) = ARRAY['sku']::name[]
     LIMIT 1;

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE productos.producto DROP CONSTRAINT %I', cname);
        RAISE NOTICE '[41c] DROP CONSTRAINT %', cname;
    ELSE
        RAISE NOTICE '[41c] No se encontró UNIQUE global sobre (sku) — ya estaba migrado';
    END IF;
END $$;

-- 2) Índice único parcial: misma (sku, marca_id) no puede repetirse
--    cuando ambos están activos. Permite:
--      · soft-deleted (is_active=FALSE) compartir SKU sin bloquear nuevos.
--      · borradores sin SKU (sku IS NULL) coexistir libremente.
--      · mismo SKU en distintas marcas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_sku_marca_active
    ON productos.producto (sku, marca_id)
    WHERE is_active = TRUE
      AND sku IS NOT NULL
      AND marca_id IS NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '[41c_productos_sku_marca_active] catálogo ahora usa UNIQUE(sku, marca_id) parcial';
END $$;
