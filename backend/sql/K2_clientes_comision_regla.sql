-- =====================================================================
-- K2 · Comisiones por Marca y Familia + snapshot por línea
-- Idempotente. Se aplica automáticamente en el arranque del container
-- django (/sql-modules ← backend/sql).
-- =====================================================================

-- 1) Helper: familia a partir del SKU (prefijo antes del 1er '-' o espacio,
--    en mayúsculas). Ej: '50B19-MIN-A-PA-CP' -> '50B19'; 'PALMILHA X' -> 'PALMILHA'.
CREATE OR REPLACE FUNCTION clientes.familia_from_sku(p_sku text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT upper(
        split_part(
            regexp_replace(coalesce(nullif(trim(p_sku), ''), ''), '\s+', '-', 'g'),
            '-', 1
        )
    );
$$;

-- 2) Reglas de comisión por cliente × marca × familia.
--    brand_id NULL  = todas las marcas
--    familia  NULL  = toda la marca
CREATE TABLE IF NOT EXISTS clientes.comision_regla (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      uuid NOT NULL,
    brand_id       uuid,
    familia        varchar(64),
    commission_pct numeric(6,4) NOT NULL
                   CHECK (commission_pct >= 0 AND commission_pct <= 1),
    valid_from     date DEFAULT CURRENT_DATE,
    valid_to       date,
    notas          text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comision_regla_vigente
    ON clientes.comision_regla (
        client_id,
        COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(familia, '')
    )
    WHERE is_active;

CREATE INDEX IF NOT EXISTS ix_comision_regla_client
    ON clientes.comision_regla (client_id) WHERE is_active;

-- 3) Resolver el % de comisión para (cliente, marca, SKU) con prioridad:
--    marca+familia > familia(cualquier marca) > marca > global. NULL si no hay.
--    (Debe ir DESPUÉS de CREATE TABLE: Postgres valida el cuerpo del SQL function.)
CREATE OR REPLACE FUNCTION clientes.comision_pct_for(p_client uuid, p_brand uuid, p_sku text)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
    SELECT r.commission_pct
      FROM clientes.comision_regla r
     WHERE r.client_id = p_client
       AND r.is_active
       AND (r.valid_to IS NULL OR r.valid_to >= CURRENT_DATE)
       AND (
            (r.brand_id IS NOT DISTINCT FROM p_brand
             AND r.familia IS NOT NULL
             AND upper(r.familia) = clientes.familia_from_sku(p_sku))
         OR (r.brand_id IS NULL AND r.familia IS NOT NULL
             AND upper(r.familia) = clientes.familia_from_sku(p_sku))
         OR (r.brand_id IS NOT DISTINCT FROM p_brand AND r.familia IS NULL)
         OR (r.brand_id IS NULL AND r.familia IS NULL)
       )
     ORDER BY
       (CASE
          WHEN r.brand_id IS NOT DISTINCT FROM p_brand
               AND r.familia IS NOT NULL
               AND upper(r.familia) = clientes.familia_from_sku(p_sku) THEN 0
          WHEN r.brand_id IS NULL AND r.familia IS NOT NULL
               AND upper(r.familia) = clientes.familia_from_sku(p_sku) THEN 1
          WHEN r.brand_id IS NOT DISTINCT FROM p_brand AND r.familia IS NULL THEN 2
          WHEN r.brand_id IS NULL AND r.familia IS NULL THEN 3
          ELSE 9 END)
     LIMIT 1;
$$;

-- 4) Snapshot de comisión por línea (congelado al crear el expediente).
ALTER TABLE expedientes.linea ADD COLUMN IF NOT EXISTS commission_pct numeric(6,4);

-- 5) Backfill: la comisión global del cliente pasa a una regla (marca/familia NULL).
INSERT INTO clientes.comision_regla (client_id, brand_id, familia, commission_pct)
SELECT c.id, NULL, NULL, c.comision_pct
  FROM clientes.cliente c
 WHERE c.comision_pct IS NOT NULL
   AND c.is_active
   AND NOT EXISTS (
        SELECT 1 FROM clientes.comision_regla r
         WHERE r.client_id = c.id
           AND r.brand_id IS NULL
           AND r.familia IS NULL
           AND r.is_active
   );
