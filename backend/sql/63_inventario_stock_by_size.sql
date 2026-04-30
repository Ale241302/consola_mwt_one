-- =====================================================================
-- MWT.ONE · 63_inventario_stock_by_size.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Inbound v2 / Transfer v4 · 2026-04-30
--
-- Objetivo: rastrear stock con granularidad (nodo, producto, talla, lote).
-- Antes: UNIQUE(nodo_id, producto_id, lote) — todas las tallas se sumaban
-- en una sola fila, perdiendo trazabilidad. Ahora: cada fila representa
-- inventario de una talla específica.
--
-- Cambios:
--   1. ADD COLUMN size VARCHAR(16)  (NULL = "talla única" / sin variante)
--   2. DROP constraint UNIQUE viejo
--   3. ADD UNIQUE (nodo_id, producto_id, lote, COALESCE(size,''))
--      → vía índice UNIQUE sobre expresión (nullable-safe).
--
-- Idempotente. Sin FK física (R6).
-- =====================================================================

-- 1. Columna size
ALTER TABLE inventario.stock
    ADD COLUMN IF NOT EXISTS size VARCHAR(16);

COMMENT ON COLUMN inventario.stock.size IS
    'Talla canónica (ej. 43, M, XL, ÚNICA). NULL = sin variante de talla. '
    'Granularidad: cada fila es (nodo, producto, lote, talla) — un mismo '
    'SKU con múltiples tallas tiene múltiples filas. El motor de inbound '
    'inserta una fila por cada (talla, qty) que el operador captura.';

-- 2. Drop UNIQUE viejo si existe (por nombre auto-generado o explícito)
DO $$
DECLARE
    cname TEXT;
BEGIN
    SELECT conname INTO cname
      FROM pg_constraint
     WHERE conrelid = 'inventario.stock'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%(nodo_id, producto_id, lote)%'
     LIMIT 1;
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE inventario.stock DROP CONSTRAINT %I', cname);
        RAISE NOTICE 'Dropped UNIQUE %', cname;
    END IF;
END $$;

-- 3. UNIQUE nuevo (talla incluida) — vía índice UNIQUE con COALESCE para
--    que tallas NULL no choquen entre sí (UNIQUE estándar trata NULLs
--    como distintos pero queremos exactamente un row con size NULL por
--    (nodo, producto, lote)).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_nodo_producto_lote_size
    ON inventario.stock (nodo_id, producto_id, lote, COALESCE(size, ''));

CREATE INDEX IF NOT EXISTS ix_stock_producto_size
    ON inventario.stock (producto_id, size);

-- =====================================================================
-- 4. recepcion_linea ya tiene `talla` (existente). Sanity check.
-- =====================================================================
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='inventario' AND table_name='recepcion_linea'
          AND column_name='talla'
    ) THEN
        EXECUTE 'ALTER TABLE inventario.recepcion_linea ADD COLUMN talla VARCHAR(16)';
        RAISE NOTICE 'Added talla column to inventario.recepcion_linea';
    END IF;
END $$;

-- =====================================================================
-- FIN 63_inventario_stock_by_size.sql
-- =====================================================================
