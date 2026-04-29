-- =====================================================================
-- MWT.ONE · 91h_transfers_lifecycle.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v4 · 2026-04-29
-- Ciclo de vida + Reconciliación con gap contable + soporte PDF.
--
-- Estado actual del schema (lo que YA hay):
--   · transferencia.estado          → PLANNED/APPROVED/IN_TRANSIT/RECEIVED/RECONCILED/CLOSED/CANCELLED
--   · transferencia.dispatched_at   ✓
--   · transferencia.eta             ✓
--   · transferencia.received_at     ✓
--   · transferencia.reconciled_at   ✓ (BLOQUE 3)
--   · transferencia.has_discrepancy ✓ (BLOQUE 3)
--   · linea.qty_transfer            ✓ (cantidad PLANEADA)
--   · linea.qty_received            ✓ (cantidad real recibida)
--   · transicion_cat                ✓ (state machine)
--   · transferencia_documento       ✓ (tipos: REMISION/BL/DUA/FACTURA/ACTA_RECEPCION/...)
--
-- Lo que ESTE script AGREGA:
--   1. linea.qty_dispatched          → cantidad realmente despachada
--                                      (≠ qty_transfer = planeado).
--   2. transferencia.approved_at     → timestamp de aprobación CEO.
--   3. transferencia.dispatch_document_id  → UUID del comprobante de salida (ART-15)
--   4. transferencia.receipt_document_id   → UUID del acta de recepción (ART-13)
--   5. transferencia.exception_document_id → UUID del acta de excepción (ART-17)
--   6. transferencia_documento: ampliar enum tipo con 'EXCEPCION' y 'DESPACHO'.
--   7. Catálogo transicion_cat: REGLA DURA — solo se puede pasar de
--      RECEIVED→RECONCILED si has_discrepancy=FALSE o si existe
--      exception_document_id (validación canónica vive en app layer;
--      acá dejamos la transición habilitada para que el ViewSet decida).
--
-- Reglas MWT respetadas:
--   · CERO FK física.
--   · Idempotente.
--   · Soft-delete vía is_active.
-- =====================================================================

-- ────────────────────────────────────────────────────────────
-- 1. Linea: qty_dispatched (lo que salió REALMENTE)
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.linea
    ADD COLUMN IF NOT EXISTS qty_dispatched INTEGER;

COMMENT ON COLUMN transfers.linea.qty_dispatched IS
    'Cantidad realmente despachada del nodo origen (puede diferir de '
    'qty_transfer si en el momento de la salida hubo un ajuste). '
    'NULL = no despachado aún. Se llena en /dispatch/.';


-- ────────────────────────────────────────────────────────────
-- 2. Transferencia: timestamps + IDs documentales por etapa
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS approved_at              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_document_id     UUID,
    ADD COLUMN IF NOT EXISTS receipt_document_id      UUID,
    ADD COLUMN IF NOT EXISTS exception_document_id    UUID,
    ADD COLUMN IF NOT EXISTS gap_justification        TEXT;

COMMENT ON COLUMN transfers.transferencia.approved_at IS
    'Timestamp de aprobación. Se llena en /approve/.';
COMMENT ON COLUMN transfers.transferencia.dispatch_document_id IS
    'UUID en transferencia_documento del comprobante de despacho (ART-15). '
    'Sin FK; integridad en app layer.';
COMMENT ON COLUMN transfers.transferencia.receipt_document_id IS
    'UUID del acta de recepción (ART-13). Sin FK.';
COMMENT ON COLUMN transfers.transferencia.exception_document_id IS
    'UUID del acta de excepción (ART-17). REQUERIDO si has_discrepancy=TRUE '
    'antes de transitar a RECONCILED. Sin FK.';
COMMENT ON COLUMN transfers.transferencia.gap_justification IS
    'Texto libre con la justificación de la pérdida/sobrante contable. '
    'Se exige cuando la transferencia tiene gaps y se intenta reconciliar.';


-- ────────────────────────────────────────────────────────────
-- 3. Vínculos rápidos (índices)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trf_dispatch_doc
    ON transfers.transferencia(dispatch_document_id)
    WHERE dispatch_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trf_receipt_doc
    ON transfers.transferencia(receipt_document_id)
    WHERE receipt_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trf_exception_doc
    ON transfers.transferencia(exception_document_id)
    WHERE exception_document_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 4. Refuerzo del catálogo de tipos de documento
--    (transferencia_documento.tipo es VARCHAR libre — solo
--    aseguramos que las apps clientes vean los valores nuevos
--    como "ofiacializados" via comentario).
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN transfers.transferencia_documento.tipo IS
    'Tipo del documento. Valores canónicos: REMISION | BL | AWB | DUA | '
    'FACTURA | DESPACHO | ACTA_RECEPCION | EXCEPCION | FOTO | OTRO. '
    'EXCEPCION = acta de gap contable (ART-17), exigido para reconciliar '
    'con discrepancia.';


-- ────────────────────────────────────────────────────────────
-- 5. Transiciones canónicas (idempotente — solo agrega lo que falta)
--    El ViewSet ya valida vía transicion_cat; acá garantizamos que
--    la regla RECEIVED→RECONCILED esté disponible.
-- ────────────────────────────────────────────────────────────
INSERT INTO transfers.transicion_cat (
    id, estado_from, estado_to, needs_approval, legal_context, descripcion, orden, is_active, created_at
) VALUES
    (gen_random_uuid(), 'RECEIVED',  'RECONCILED', FALSE, NULL,
     'Cierre con/sin discrepancia. Si hay gap, exige exception_document_id.', 50, TRUE, NOW()),
    (gen_random_uuid(), 'RECONCILED','CLOSED',     FALSE, NULL,
     'Cierre operativo final.', 60, TRUE, NOW())
ON CONFLICT DO NOTHING;


-- =====================================================================
-- FIN 91h_transfers_lifecycle.sql
-- =====================================================================
