-- =====================================================================
-- MWT.ONE · 54_suppliers_iso_evaluations.sql
-- Agente responsable: [AG-DATABASE]
--
-- Bitácora ISO 9001:2015 §8.4 — evaluación periódica de proveedores
-- (PLB_SUPPLIER_EVAL). Cada fila es una auditoría puntual con scores
-- 1..5 en 5 ejes, score_total ponderado y decisión derivada.
--
-- Pesos canónicos (blindados en backend, NO en CHECK):
--   calidad 30 % · entrega 25 % · comunicacion 15 %
--   tecnica 15 % · precio 15 %  → SUMA = 100 %
--
-- CHECK constraints:
--   · scores enteros 1..5
--   · decision en el enum cerrado MANTENER / MONITOREAR / PLAN_MEJORA / DESCONTINUAR
--
-- CERO foreign keys (patrón MWT). evaluator_id es UUID suelto.
-- Idempotente.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/54_suppliers_iso_evaluations.sql
-- =====================================================================

SET search_path = proveedores, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS proveedores.suppliers_iso_evaluations (
    id                    UUID         PRIMARY KEY,
    supplier_id           UUID         NOT NULL,                      -- ⛔ sin FK
    evaluator_id          UUID,                                       -- ⛔ sin FK (puede ser NULL si es bot)

    periodo               VARCHAR(16)  NOT NULL,                      -- "Q2-2026" / "2026-04"

    -- Scores humanos (1..5 enteros, blindados por CHECK)
    score_calidad         SMALLINT     NOT NULL,
    score_entrega         SMALLINT     NOT NULL,
    score_comunicacion    SMALLINT     NOT NULL,
    score_tecnica         SMALLINT     NOT NULL,
    score_precio          SMALLINT     NOT NULL,

    -- Calculados por backend (NUNCA confiar en lo que mande FE)
    score_total           NUMERIC(3,2) NOT NULL,
    decision              VARCHAR(16)  NOT NULL,

    comentarios           TEXT,
    documento_evidencia   VARCHAR(500),                               -- storage_key MinIO opcional

    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_eval_score_calidad      CHECK (score_calidad      BETWEEN 1 AND 5),
    CONSTRAINT ck_eval_score_entrega      CHECK (score_entrega      BETWEEN 1 AND 5),
    CONSTRAINT ck_eval_score_comunicacion CHECK (score_comunicacion BETWEEN 1 AND 5),
    CONSTRAINT ck_eval_score_tecnica      CHECK (score_tecnica      BETWEEN 1 AND 5),
    CONSTRAINT ck_eval_score_precio       CHECK (score_precio       BETWEEN 1 AND 5),
    CONSTRAINT ck_eval_decision CHECK (
        decision IN ('MANTENER', 'MONITOREAR', 'PLAN_MEJORA', 'DESCONTINUAR')
    )
);

CREATE INDEX IF NOT EXISTS ix_iso_eval_supplier
    ON proveedores.suppliers_iso_evaluations (supplier_id);

CREATE INDEX IF NOT EXISTS ix_iso_eval_periodo
    ON proveedores.suppliers_iso_evaluations (periodo);

CREATE INDEX IF NOT EXISTS ix_iso_eval_created
    ON proveedores.suppliers_iso_evaluations (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_iso_eval_decision
    ON proveedores.suppliers_iso_evaluations (decision);

DROP TRIGGER IF EXISTS trg_iso_eval_updated_at
    ON proveedores.suppliers_iso_evaluations;
CREATE TRIGGER trg_iso_eval_updated_at
    BEFORE UPDATE ON proveedores.suppliers_iso_evaluations
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DO $$ BEGIN
    RAISE NOTICE '[54_suppliers_iso_evaluations] tabla creada / verificada';
END $$;
