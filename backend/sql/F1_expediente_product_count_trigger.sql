-- =====================================================================
-- MWT.ONE · F1_expediente_product_count_trigger.sql
-- Agente responsable: Antigravity
-- Sprint 2026-06-22 · Fix visual bug of product_count showing 0 in list page.
--
-- Se aplica AUTOMÁTICAMENTE en el deploy o manualmente.
-- =====================================================================

BEGIN;

-- 1. Crear función para mantener actualizado el conteo de SKUs distintos
--    (NO filas: líneas con el mismo SKU en distintas tallas cuentan 1)
CREATE OR REPLACE FUNCTION expedientes.tg_update_expediente_product_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF NEW.expediente_id IS NOT NULL THEN
            UPDATE expedientes.expediente
            SET product_count = (
                SELECT COALESCE(COUNT(DISTINCT COALESCE(NULLIF(l.sku, ''), l.producto_id::text, l.id::text)), 0)
                FROM expedientes.linea l
                WHERE l.expediente_id = NEW.expediente_id
                  AND l.is_active = TRUE
            )
            WHERE id = NEW.expediente_id;
        END IF;
    END IF;
    
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF OLD.expediente_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.expediente_id <> COALESCE(NEW.expediente_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
            UPDATE expedientes.expediente
            SET product_count = (
                SELECT COALESCE(COUNT(DISTINCT COALESCE(NULLIF(l.sku, ''), l.producto_id::text, l.id::text)), 0)
                FROM expedientes.linea l
                WHERE l.expediente_id = OLD.expediente_id
                  AND l.is_active = TRUE
            )
            WHERE id = OLD.expediente_id;
        END IF;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Asignar el trigger a la tabla expedientes.linea
DROP TRIGGER IF EXISTS tg_linea_product_count ON expedientes.linea;
CREATE TRIGGER tg_linea_product_count
AFTER INSERT OR UPDATE OR DELETE ON expedientes.linea
FOR EACH ROW
EXECUTE FUNCTION expedientes.tg_update_expediente_product_count();

-- 3. Backfill inicial para corregir los expedientes actuales
UPDATE expedientes.expediente e
SET product_count = (
    SELECT COALESCE(COUNT(DISTINCT COALESCE(NULLIF(l.sku, ''), l.producto_id::text, l.id::text)), 0)
    FROM expedientes.linea l
    WHERE l.expediente_id = e.id
      AND l.is_active = TRUE
);

COMMIT;
