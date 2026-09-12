-- =====================================================================
-- K3 Â· Default de comisiÃ³n por lÃ­nea (trigger)
-- Al insertar una lÃ­nea sin commission_pct, se resuelve desde las reglas
-- del cliente (clientes.comision_pct_for por marca+familia). Si el caller
-- envÃ­a un valor explÃ­cito, se respeta (admin puede sobreescribir).
-- =====================================================================
CREATE OR REPLACE FUNCTION expedientes.linea_default_commission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_client uuid;
    v_brand  uuid;
    v_pct    numeric;
BEGIN
    IF NEW.commission_pct IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.expediente_id IS NOT NULL THEN
        SELECT e.client_id INTO v_client
          FROM expedientes.expediente e
         WHERE e.id = NEW.expediente_id;
    END IF;
    IF v_client IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.producto_id IS NOT NULL THEN
        SELECT p.marca_id INTO v_brand
          FROM productos.producto p
         WHERE p.id = NEW.producto_id;
    END IF;
    v_pct := clientes.comision_pct_for(v_client, v_brand, NEW.sku);
    NEW.commission_pct := v_pct;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linea_default_commission ON expedientes.linea;
CREATE TRIGGER trg_linea_default_commission
    BEFORE INSERT ON expedientes.linea
    FOR EACH ROW
    EXECUTE FUNCTION expedientes.linea_default_commission();

-- Backfill de lÃ­neas existentes sin comisiÃ³n.
UPDATE expedientes.linea l
   SET commission_pct = clientes.comision_pct_for(e.client_id, p.marca_id, l.sku)
  FROM expedientes.expediente e, productos.producto p
 WHERE e.id = l.expediente_id
   AND p.id = l.producto_id
   AND l.commission_pct IS NULL
   AND l.is_active;

