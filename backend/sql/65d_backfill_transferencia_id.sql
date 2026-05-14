-- =====================================================================
-- MWT.ONE · 65d_backfill_transferencia_id.sql
-- Sprint 2026-05-14 · Fase 11 · Backfill de transferencia_id.
-- Agente responsable: [AG-DATABASE]
--
-- Contexto:
--   Antes de 65c, las filas creadas por /nodo-assignments/transfer/
--   guardaban el ID de la transferencia sólo en `notas` como string
--   ('transfer from {uuid}'). Tras 65c añadimos la columna UUID
--   `transferencia_id` y el backend la popula, pero las filas previas
--   quedaron con transferencia_id=NULL. Esto rompe el enrichment de
--   `lineas` en /api/transferencias/{id}/ (columna Expediente vacía)
--   y el endpoint de costos por OC pierde rastreabilidad.
--
-- Estrategia (idempotente):
--   UPDATE sólo donde transferencia_id IS NULL Y `notas` matchea el
--   patrón. Si el UUID parseado no existe en transfers.transferencia,
--   el cast falla — usamos un sub-select que lo valida antes.
-- =====================================================================

WITH parsed AS (
    SELECT a.id                                        AS assignment_id,
           (regexp_match(a.notas, '([0-9a-f-]{36})'))[1] AS trf_id_raw
    FROM inventario.expediente_nodo_assignment a
    WHERE a.transferencia_id IS NULL
      AND a.notas IS NOT NULL
      AND a.notas ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
),
matched AS (
    SELECT p.assignment_id,
           p.trf_id_raw::uuid AS trf_id
    FROM parsed p
    JOIN transfers.transferencia t
      ON t.id = p.trf_id_raw::uuid
)
UPDATE inventario.expediente_nodo_assignment a
SET    transferencia_id = m.trf_id
FROM   matched m
WHERE  a.id = m.assignment_id
  AND  a.transferencia_id IS NULL;

-- =====================================================================
-- FIN 65d_backfill_transferencia_id.sql
-- =====================================================================
