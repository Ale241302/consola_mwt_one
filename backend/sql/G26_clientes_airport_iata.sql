-- G26 · Aeropuerto destino (IATA) del cliente
--
-- El segmento de LUGAR del código de OC depende del tipo de transporte:
--   · marítimo (SEA)  → país ISO-2 del cliente   → MAR-SONDEL-CR-505516-26
--   · aéreo    (AIR)  → aeropuerto IATA destino  → MAR-SONDEL-SJO-505516-26
--
-- El consecutivo (NN) y el año (AA) NO cambian: son los mismos para ambos
-- modos (la serie es por cliente + marca). Lo que cambia es el lugar.
-- Esta columna guarda el aeropuerto que se usa cuando el envío es aéreo.
-- Se edita en la ficha del cliente (Crear/Editar cliente).
--
-- Idempotente: se puede correr dos veces.

ALTER TABLE clientes.cliente
    ADD COLUMN IF NOT EXISTS airport_iata CHAR(3) NULL;

COMMENT ON COLUMN clientes.cliente.airport_iata IS
    'Aeropuerto IATA de destino del cliente (SJO, GUA, BOG...). Se usa en el segmento de lugar del código de OC cuando el envío es aéreo; en marítimo va el país ISO-2.';

-- ── Semilla 1 · historia: último segmento IATA real en los códigos ──────
-- Toma `EXP-<PRV>-<CLIENTE>-<XXX>-…` donde XXX son 3 letras distintas del
-- país del cliente (es decir, un aeropuerto) y se queda con el más reciente.
WITH hist AS (
    SELECT e.client_id,
           upper(split_part(e.codigo, '-', 4)) AS iata,
           e.created_at,
           upper(coalesce(c.pais_iso2, ''))    AS pais
      FROM expedientes.expediente e
      JOIN clientes.cliente c ON c.id = e.client_id
     WHERE e.is_active
       AND e.codigo ~ '^EXP-(MAR|TEC|BAN)-[A-Z0-9]+-[A-Z]{3}-'
),
ultimo AS (
    SELECT DISTINCT ON (client_id) client_id, iata
      FROM hist
     WHERE iata <> pais
     ORDER BY client_id, created_at DESC
)
UPDATE clientes.cliente c
   SET airport_iata = u.iata
  FROM ultimo u
 WHERE c.id = u.client_id
   AND (c.airport_iata IS NULL OR btrim(c.airport_iata) = '');

-- ── Semilla 2 · mapa conocido para quien no tenga historia ─────────────
-- Solo rellena los NULL; cualquier valor puesto a mano se respeta.
UPDATE clientes.cliente c
   SET airport_iata = m.iata
  FROM (VALUES
        ('CR', 'SJO'),   -- San José / Alajuela
        ('GT', 'GUA'),   -- Guatemala (La Aurora)
        ('CO', 'BOG'),   -- Bogotá (El Dorado)
        ('HN', 'SPS'),   -- San Pedro Sula (Ramón Villeda Morales)
        ('PA', 'PTY'),   -- Panamá (Tocumen)
        ('MX', 'MEX'),
        ('BR', 'GRU'),
        ('US', 'MIA')
       ) AS m(pais, iata)
 WHERE upper(coalesce(c.pais_iso2, '')) = m.pais
   AND c.is_active
   AND (c.airport_iata IS NULL OR btrim(c.airport_iata) = '');
