-- =====================================================================
-- K3 · Default de comisión por línea (trigger)
-- La FAMILIA se deriva del MODELO del producto (nombre, ej. "70B22-BP-HIDRO"
-- -> "70B22"), no del SKU (que puede ser numérico). Fallback al SKU.
-- Al insertar una línea sin commission_pct, se resuelve desde las reglas
-- del cliente (clientes.comision_pct_for por marca+familia). Si el caller
-- envía un valor explícito, se respeta (admin puede sobreescribir).
-- =====================================================================
CREATE OR REPLACE FUNCTION expedientes.linea_default_commission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_client uuid;
    v_brand  uuid;
    v_model  text;
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
        SELECT p.marca_id, p.nombre INTO v_brand, v_model
          FROM productos.producto p
         WHERE p.id = NEW.producto_id;
    END IF;
    v_pct := clientes.comision_pct_for(
        v_client, v_brand, COALESCE(NULLIF(v_model, ''), NEW.sku));
    NEW.commission_pct := v_pct;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linea_default_commission ON expedientes.linea;
CREATE TRIGGER trg_linea_default_commission
    BEFORE INSERT ON expedientes.linea
    FOR EACH ROW
    EXECUTE FUNCTION expedientes.linea_default_commission();

-- Recompute de líneas existentes usando el MODELO (nombre del producto).
UPDATE expedientes.linea l
   SET commission_pct = clientes.comision_pct_for(
         e.client_id,
         (SELECT p.marca_id FROM productos.producto p WHERE p.id = l.producto_id),
         COALESCE(NULLIF((SELECT p.nombre FROM productos.producto p WHERE p.id = l.producto_id), ''), l.sku))
  FROM expedientes.expediente e
 WHERE e.id = l.expediente_id
   AND l.is_active;
