-- =====================================================================
-- MWT.ONE · 99_wipe_inventory_and_transfers.sql
-- Agente responsable: [AG-DATABASE]
--
-- ⚠ DESTRUCTIVO · NO IDEMPOTENTE EN DATA  ⚠
--
-- Borra TODA la data operativa de:
--   · inventario.stock                (stock físico de nodos)
--   · inventario.stock_snapshot       (snapshots de cierre)
--   · inventario.stock_ubicacion      (ubicaciones físicas)
--   · inventario.movimiento           (ledger de movimientos)
--   · inventario.recepcion            (cabeceras de inbound)
--   · inventario.recepcion_linea      (líneas de recepción)
--   · inventario.recepcion_excepcion  (ART-17 gaps)
--   · transfers.transferencia         (cabeceras de transfer)
--   · transfers.linea                 (líneas de transfer)
--   · transfers.evento                (audit trail de transfers)
--   · transfers.cost_line             (costos operativos)
--
-- NO toca:
--   · nodos.nodo                      (los nodos persisten, solo quedan vacíos)
--   · productos.producto              (catálogo intacto)
--   · clientes.cliente                (catálogo intacto)
--   · expedientes.*                   (orders y artifacts intactos)
--   · pricing.*                       (catálogos intactos)
--
-- Tras correr esto:
--   · Cada nodo queda con 0 unidades en stock.
--   · No hay transferencias activas ni históricas.
--   · No hay recepciones registradas.
--   · El catálogo (productos, clientes, marcas, nodos) queda intacto.
--
-- Uso:
--   docker compose exec -T postgres psql -U mwt -d mwt_one \
--     < backend/sql/99_wipe_inventory_and_transfers.sql
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. INVENTARIO
-- =====================================================================
DO $$ DECLARE
    rows_stock      INTEGER := 0;
    rows_movimiento INTEGER := 0;
    rows_recepcion  INTEGER := 0;
    rows_rec_linea  INTEGER := 0;
    rows_rec_exc    INTEGER := 0;
    rows_snapshot   INTEGER := 0;
    rows_ubicacion  INTEGER := 0;
BEGIN
    -- inventario.stock — la fuente de verdad del inventario actual
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='stock') THEN
        SELECT COUNT(*) INTO rows_stock FROM inventario.stock;
        TRUNCATE TABLE inventario.stock RESTART IDENTITY;
        RAISE NOTICE 'inventario.stock                : % filas borradas', rows_stock;
    END IF;

    -- inventario.movimiento — ledger
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='movimiento') THEN
        SELECT COUNT(*) INTO rows_movimiento FROM inventario.movimiento;
        TRUNCATE TABLE inventario.movimiento RESTART IDENTITY;
        RAISE NOTICE 'inventario.movimiento           : % filas borradas', rows_movimiento;
    END IF;

    -- inventario.recepcion_excepcion — primero (cascade-safe sin FK)
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='recepcion_excepcion') THEN
        SELECT COUNT(*) INTO rows_rec_exc FROM inventario.recepcion_excepcion;
        TRUNCATE TABLE inventario.recepcion_excepcion RESTART IDENTITY;
        RAISE NOTICE 'inventario.recepcion_excepcion  : % filas borradas', rows_rec_exc;
    END IF;

    -- inventario.recepcion_linea
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='recepcion_linea') THEN
        SELECT COUNT(*) INTO rows_rec_linea FROM inventario.recepcion_linea;
        TRUNCATE TABLE inventario.recepcion_linea RESTART IDENTITY;
        RAISE NOTICE 'inventario.recepcion_linea      : % filas borradas', rows_rec_linea;
    END IF;

    -- inventario.recepcion — cabeceras
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='recepcion') THEN
        SELECT COUNT(*) INTO rows_recepcion FROM inventario.recepcion;
        TRUNCATE TABLE inventario.recepcion RESTART IDENTITY;
        RAISE NOTICE 'inventario.recepcion            : % filas borradas', rows_recepcion;
    END IF;

    -- inventario.stock_snapshot — opcional
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='stock_snapshot') THEN
        SELECT COUNT(*) INTO rows_snapshot FROM inventario.stock_snapshot;
        TRUNCATE TABLE inventario.stock_snapshot RESTART IDENTITY;
        RAISE NOTICE 'inventario.stock_snapshot       : % filas borradas', rows_snapshot;
    END IF;

    -- inventario.stock_ubicacion — opcional
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='inventario' AND table_name='stock_ubicacion') THEN
        SELECT COUNT(*) INTO rows_ubicacion FROM inventario.stock_ubicacion;
        TRUNCATE TABLE inventario.stock_ubicacion RESTART IDENTITY;
        RAISE NOTICE 'inventario.stock_ubicacion      : % filas borradas', rows_ubicacion;
    END IF;
END $$;

-- =====================================================================
-- 2. TRANSFERENCIAS
-- =====================================================================
DO $$ DECLARE
    rows_evento     INTEGER := 0;
    rows_linea      INTEGER := 0;
    rows_transfer   INTEGER := 0;
    rows_cost_line  INTEGER := 0;
BEGIN
    -- transfers.cost_line — costos operativos (ART-06, etc.)
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='transfers' AND table_name='cost_line') THEN
        SELECT COUNT(*) INTO rows_cost_line FROM transfers.cost_line;
        TRUNCATE TABLE transfers.cost_line RESTART IDENTITY;
        RAISE NOTICE 'transfers.cost_line             : % filas borradas', rows_cost_line;
    END IF;

    -- transfers.evento — audit trail (append-only)
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='transfers' AND table_name='evento') THEN
        SELECT COUNT(*) INTO rows_evento FROM transfers.evento;
        TRUNCATE TABLE transfers.evento RESTART IDENTITY;
        RAISE NOTICE 'transfers.evento                : % filas borradas', rows_evento;
    END IF;

    -- transfers.linea
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='transfers' AND table_name='linea') THEN
        SELECT COUNT(*) INTO rows_linea FROM transfers.linea;
        TRUNCATE TABLE transfers.linea RESTART IDENTITY;
        RAISE NOTICE 'transfers.linea                 : % filas borradas', rows_linea;
    END IF;

    -- transfers.transferencia — cabeceras
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='transfers' AND table_name='transferencia') THEN
        SELECT COUNT(*) INTO rows_transfer FROM transfers.transferencia;
        TRUNCATE TABLE transfers.transferencia RESTART IDENTITY;
        RAISE NOTICE 'transfers.transferencia         : % filas borradas', rows_transfer;
    END IF;
END $$;

COMMIT;

-- =====================================================================
-- VERIFICACIÓN POST-WIPE
-- =====================================================================
SELECT 'inventario.stock'             AS tabla, COUNT(*) AS rows FROM inventario.stock
UNION ALL
SELECT 'inventario.movimiento'        , COUNT(*) FROM inventario.movimiento
UNION ALL
SELECT 'inventario.recepcion'         , COUNT(*) FROM inventario.recepcion
UNION ALL
SELECT 'inventario.recepcion_linea'   , COUNT(*) FROM inventario.recepcion_linea
UNION ALL
SELECT 'inventario.recepcion_excepcion', COUNT(*) FROM inventario.recepcion_excepcion
UNION ALL
SELECT 'transfers.transferencia'      , COUNT(*) FROM transfers.transferencia
UNION ALL
SELECT 'transfers.linea'              , COUNT(*) FROM transfers.linea
UNION ALL
SELECT 'transfers.evento'             , COUNT(*) FROM transfers.evento
ORDER BY tabla;

-- Confirmación: nodos siguen ahí pero sin stock
SELECT n.codigo, n.nombre,
       COALESCE(SUM(s.cantidad_disponible), 0) AS unidades,
       COUNT(s.id) AS filas_stock
  FROM nodos.nodo n
  LEFT JOIN inventario.stock s ON s.nodo_id = n.id AND s.is_active = TRUE
 WHERE n.is_active = TRUE
 GROUP BY n.id, n.codigo, n.nombre
 ORDER BY n.codigo;

-- =====================================================================
-- FIN 99_wipe_inventory_and_transfers.sql
-- =====================================================================
