-- =====================================================================
-- MWT.ONE · 32b_clientes_relax.sql · Hace opcionales los campos NOT NULL
--          de `clientes.cliente` que el formulario "Nuevo cliente" del FE
--          no exige.
-- Agente responsable: [AG-DATABASE]
--
-- Filosofía MWT (mismo principio aplicado a `nodos.nodo.ciudad`):
--   "Si el form no se lo pide al humano, la BD/API no puede exigirlo."
--
-- Campos relajados (originalmente NOT NULL sin DEFAULT):
--   · tipo          (B2B / CONSUMIDOR / DISTRIBUIDOR — ahora opcional)
--   · razon_social  (no debería estar vacía pero el form la valida en cliente,
--                    no obligamos en BD para evitar 400 en imports parciales)
--   · tax_id        (algunos clientes locales no tienen RUC/RFC al alta)
--   · pais_iso2     (puede definirse luego)
--
-- NO se tocan los NOT NULL con DEFAULT (segmento, moneda, credito_*,
-- dias_credito, estado, visibility_tier, is_active, created_at, updated_at)
-- — esos siguen llenándose solos.
--
-- Idempotente: DROP NOT NULL es no-op si ya es NULLABLE.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/32b_clientes_relax.sql
-- =====================================================================

ALTER TABLE clientes.cliente ALTER COLUMN tipo         DROP NOT NULL;
ALTER TABLE clientes.cliente ALTER COLUMN razon_social DROP NOT NULL;
ALTER TABLE clientes.cliente ALTER COLUMN tax_id       DROP NOT NULL;
ALTER TABLE clientes.cliente ALTER COLUMN pais_iso2    DROP NOT NULL;

-- Sanity: deja constancia en el log
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema='clientes' AND table_name='cliente'
          AND column_name IN ('tipo','razon_social','tax_id','pais_iso2')
        ORDER BY column_name
    LOOP
        RAISE NOTICE '[32b_clientes_relax] clientes.cliente.% is_nullable=%',
                     r.column_name, r.is_nullable;
    END LOOP;
END $$;
