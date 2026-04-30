-- =====================================================================
-- MWT.ONE · 65_backfill_stock_size_from_recepcion.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Inbound v3 · 2026-04-30
--
-- Backfill: las primeras recepciones del sprint v3 fueron registradas
-- con el modelo Stock SIN la columna `size` declarada en Django, así
-- que la columna en BD quedó en NULL aunque la línea de recepción sí
-- traía la talla. Este script copia la talla desde
-- inventario.recepcion_linea hacia inventario.stock para esos casos.
--
-- Match: (nodo_destino, producto_id, lote_code) ↔ (nodo_id, producto_id, lote)
-- Solo actualiza cuando inventario.stock.size IS NULL.
--
-- Idempotente: re-ejecutarlo no produce cambios extra una vez aplicado.
-- =====================================================================

BEGIN;

WITH src AS (
    SELECT DISTINCT ON (r.destination_node_id, l.producto_id, l.lote_code)
           r.destination_node_id   AS nodo_id,
           l.producto_id            AS producto_id,
           l.lote_code              AS lote,
           NULLIF(UPPER(TRIM(l.talla)), '') AS size
      FROM inventario.recepcion         r
      JOIN inventario.recepcion_linea   l ON l.recepcion_id = r.id
     WHERE l.producto_id IS NOT NULL
       AND NULLIF(UPPER(TRIM(l.talla)), '') IS NOT NULL
     ORDER BY r.destination_node_id, l.producto_id, l.lote_code, r.created_at DESC
)
UPDATE inventario.stock s
   SET size       = src.size,
       updated_at = NOW()
  FROM src
 WHERE s.nodo_id     = src.nodo_id
   AND s.producto_id = src.producto_id
   AND COALESCE(s.lote, '') = COALESCE(src.lote, '')
   AND s.is_active = TRUE
   AND s.size IS NULL;

COMMIT;

-- Verificación: cuántas filas quedaron con size populado
SELECT COUNT(*) FILTER (WHERE size IS NOT NULL) AS con_talla,
       COUNT(*) FILTER (WHERE size IS NULL)     AS sin_talla,
       COUNT(*)                                  AS total
  FROM inventario.stock
 WHERE is_active = TRUE;

-- =====================================================================
-- FIN 65_backfill_stock_size_from_recepcion.sql
-- =====================================================================
