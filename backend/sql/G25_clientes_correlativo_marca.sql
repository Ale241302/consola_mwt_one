-- G25 · Correlativo de OC por cliente y marca
--
-- Reemplaza el uso de `clientes.cliente.oc_correlativo` (un solo número)
-- por una fila por (cliente, marca). El código que ve el usuario es
-- `{PRV}-{CLIENTE}-{PAÍS}-{NN}-{AA}` (por ejemplo `MAR-UMMIE-GT-04-25`):
--   PRV     Marluvas (MAR), Tecmater (TEC), Bangni (BAN)… sale de la marca
--   CLIENTE nombre corto de la empresa
--   PAÍS    ISO-2 del cliente
--   NN      consecutivo editable de la marca para ese cliente
--   AA      año del último código
--
-- Idempotente: se puede correr dos veces.
-- La columna vieja `clientes.cliente.oc_correlativo` se conserva como
-- respaldo y para el arranque (sembrar el último número ya usado).

CREATE TABLE IF NOT EXISTS clientes.cliente_marca_correlativo (
    client_id   UUID      NOT NULL,
    brand_id    UUID      NOT NULL,
    ultimo_nn   BIGINT,
    ultimo_anio SMALLINT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, brand_id)
);

COMMENT ON TABLE clientes.cliente_marca_correlativo IS
    'Último consecutivo de OC por cliente y marca (POL_CODIGO_OC). El alta del portal usa (ultimo_nn + 1).';

CREATE INDEX IF NOT EXISTS idx_cliente_marca_corr_brand
    ON clientes.cliente_marca_correlativo (brand_id);

-- ── Siembra desde los códigos descriptivos ya usados ──────────────────
-- Toma el último `MAR-<CLIENTE>-<PAÍS>-<NN>-<AA>` de la tabla de OCs,
-- ignorando los códigos que no cumplen el formato (números del cliente,
-- proformas, códigos viejos con `PO `).
WITH marluvas AS (
    SELECT id FROM brands.marca WHERE slug = 'marluvas' LIMIT 1
),
normalizados AS (
    SELECT client_id,
           regexp_replace(codigo, '^PO[[:space:]]*', '') AS codigo
      FROM expedientes.oc
     WHERE is_active
       AND client_id IS NOT NULL
),
descriptivos AS (
    SELECT client_id,
           CAST(split_part(codigo, '-', 4) AS BIGINT)   AS nn,
           CAST(split_part(codigo, '-', 5) AS SMALLINT) AS aa
      FROM normalizados
     WHERE codigo ~ '^[A-Z]{3}-[A-Z0-9]+-[A-Z]{2}-[0-9]{1,6}-[0-9]{2}$'
),
ultimo_descriptivo AS (
    SELECT DISTINCT ON (client_id) client_id, nn, (2000 + aa) AS anio
      FROM descriptivos
     ORDER BY client_id, aa DESC, nn DESC
),
semilla AS (
    SELECT c.id                                  AS client_id,
           COALESCE(c.oc_correlativo, 0)         AS nn_serie,
           COALESCE(u.nn, 0)                     AS nn_descriptivo,
           COALESCE(u.anio, EXTRACT(YEAR FROM now())::int) AS anio_descriptivo
      FROM clientes.cliente c
      LEFT JOIN ultimo_descriptivo u ON u.client_id = c.id
)
INSERT INTO clientes.cliente_marca_correlativo
       (client_id, brand_id, ultimo_nn, ultimo_anio, updated_at)
SELECT s.client_id,
       (SELECT id FROM marluvas),
       GREATEST(s.nn_serie, s.nn_descriptivo),
       CASE WHEN s.nn_serie >= s.nn_descriptivo
            THEN EXTRACT(YEAR FROM now())::smallint
            ELSE s.anio_descriptivo::smallint
       END,
       now()
  FROM semilla s
 WHERE GREATEST(s.nn_serie, s.nn_descriptivo) > 0
   AND EXISTS (SELECT 1 FROM marluvas)
ON CONFLICT (client_id, brand_id) DO NOTHING;
