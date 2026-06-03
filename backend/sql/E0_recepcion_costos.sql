-- =====================================================================
-- E0_recepcion_costos.sql
-- Sprint 2026-06-02 · Costos operativos en la RECEPCIÓN de inventario.
--
-- El wizard de recepción (/inventario/recepcion) gana un paso "Costos
-- operativos" (igual al de /transferencias/nueva). Estos costos se
-- guardan en el nodo logístico y se PRORRATEAN por unidad. El costo
-- prorrateado por unidad se estampa en cada asignación
-- expediente→nodo (costo_operativo_unitario_usd), de modo que cuando
-- una transferencia mueve la asignación, el costo viaja con ella
-- (es invariante al split: copiar el valor por-unidad basta).
--
-- Idempotente. Se aplica vía backend/docker-entrypoint.sh
-- (registro en public._applied_sql). Naming "E0_*" → ordena después de
-- 65b/65c (assignment) y de los D?_ existentes.
-- =====================================================================

-- 1) Audit de las líneas de costo capturadas en el paso 3 ------------
--    Una de las dos referencias estará presente:
--      · recepcion_id  → flow legacy de líneas físicas (/inventory/receive/)
--      · batch_id      → flow EXPEDIENTE_ASSIGN (no crea fila en recepcion)
CREATE TABLE IF NOT EXISTS inventario.recepcion_costo (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id     UUID,                                  -- ⛔ sin FK
    batch_id         UUID,                                  -- ⛔ sin FK
    nodo_id          UUID,                                  -- nodo destino
    kind             VARCHAR(32)   NOT NULL DEFAULT 'OTRO',
    label            VARCHAR(160),
    amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency         CHAR(3)       NOT NULL DEFAULT 'USD',
    fx_to_usd        NUMERIC(14,6) NOT NULL DEFAULT 1,
    amount_usd       NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(amount * fx_to_usd, 2)) STORED,
    source           VARCHAR(16)   NOT NULL DEFAULT 'MANUAL',
    scope_json       JSONB,
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by_id    UUID,                                  -- ⛔ sin FK
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recepcion_costo_recepcion
    ON inventario.recepcion_costo(recepcion_id) WHERE recepcion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recepcion_costo_batch
    ON inventario.recepcion_costo(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recepcion_costo_nodo
    ON inventario.recepcion_costo(nodo_id) WHERE nodo_id IS NOT NULL;

-- 2) Costo operativo por unidad en la asignación expediente→nodo -----
--    Prorrateo de los costos del batch / qty total. Se copia tal cual
--    al mover la asignación en una transferencia (ver views.transfer()).
ALTER TABLE inventario.expediente_nodo_assignment
    ADD COLUMN IF NOT EXISTS costo_operativo_unitario_usd NUMERIC(14,4) NOT NULL DEFAULT 0;

-- Trazabilidad del batch de costos que originó el costo operativo.
ALTER TABLE inventario.expediente_nodo_assignment
    ADD COLUMN IF NOT EXISTS costo_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_ena_costo_batch
    ON inventario.expediente_nodo_assignment(costo_batch_id)
    WHERE costo_batch_id IS NOT NULL;
