-- =====================================================================
-- MWT.ONE · 52_supplier_promo_relax.sql · Relaja constraints NOT NULL
--          en proveedores.supplier_promo_code para alineación con el
--          modelo Django (ningún campo obligatorio para draft).
-- Agente responsable: [AG-DATABASE]
--
-- Razón: el modelo Django marca vigente_desde/hasta como nullable, pero
-- la tabla original tenía vigencia_inicio NOT NULL. Si el frontend
-- envía null (futuro caso de "código sin fecha"), el INSERT truena con
-- IntegrityError sin traceback (DEBUG=0).
--
-- Idempotente: DROP NOT NULL es no-op si ya es NULLABLE.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/52_supplier_promo_relax.sql
-- =====================================================================

ALTER TABLE proveedores.supplier_promo_code
    ALTER COLUMN vigencia_inicio DROP NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '[52_supplier_promo_relax] vigencia_inicio ahora es nullable';
END $$;
