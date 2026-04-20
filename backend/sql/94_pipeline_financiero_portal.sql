-- ============================================================
-- MWT.ONE · 94_pipeline_financiero_portal.sql
-- Agente responsable: [AG-DATABASE]
--
-- Crea las TABLAS NUEVAS que los JSON canónicos #1, #3, #4 y #5
-- introducen y que aún no existen en ningún 10..92:
--
--   pipeline.event_log      — JSON #3  (audit trail inmutable)
--   financiero.cost_line    — JSON #5  (líneas de costo por expediente)
--   portal.mwt_user         — JSON #4  (usuarios del portal MWT)
--   dashboard.snapshot      — JSON #1  (snapshots de KPIs / preferencias)
--
-- Cero FKs gestionadas por Postgres (vínculos por UUID lógico).
-- Idempotente: CREATE SCHEMA / TABLE / INDEX / TRIGGER IF NOT EXISTS.
-- Solo aditivo. Compatible con 93_schema_extensions.sql ejecutado.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Schemas (los 3 primeros ya existen desde init.sql; dashboard nuevo)
-- ────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS pipeline;
CREATE SCHEMA IF NOT EXISTS financiero;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS dashboard;

-- ────────────────────────────────────────────────────────────
-- Helper de updated_at — uno por schema (cada uno autocontenido)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pipeline.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION financiero.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION portal.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dashboard.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. pipeline.event_log  (JSON #3)
--    Audit trail INMUTABLE de todos los eventos del workflow C1..C11.
--    correlation_id agrupa cadenas de eventos relacionados (ej: una
--    misma OC genera N eventos a lo largo de su ciclo de vida).
--    NUNCA se hace UPDATE — solo INSERT y SELECT.
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline.event_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id      UUID,                               -- agrupa cadena de eventos
    event_type          VARCHAR(64)   NOT NULL,             -- p.ej. 'oc.created', 'expediente.status_changed', 'pago.verified'
    aggregate_type      VARCHAR(32)   NOT NULL,             -- 'oc' / 'expediente' / 'pago' / 'transferencia' / 'cliente' / ...
    aggregate_id        UUID          NOT NULL,             -- ID del agregado afectado
    action_source       VARCHAR(16),                        -- C1..C11 — slot semántico del workflow
    previous_status     VARCHAR(32),                        -- estado anterior (si aplica)
    new_status          VARCHAR(32),                        -- estado nuevo (si aplica)
    payload             JSONB         NOT NULL DEFAULT '{}'::jsonb,
    emitted_by_id       UUID,                               -- core.users.id o portal.mwt_user.id
    emitted_by_role     VARCHAR(32),                        -- 'system' / 'admin' / 'finance' / 'b2b_client' / ...
    ip_address          INET,
    user_agent          TEXT,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evlog_correlation     ON pipeline.event_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_evlog_aggregate       ON pipeline.event_log(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_evlog_event_type      ON pipeline.event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_evlog_action_source   ON pipeline.event_log(action_source);
CREATE INDEX IF NOT EXISTS idx_evlog_created         ON pipeline.event_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evlog_emitted_by      ON pipeline.event_log(emitted_by_id);
CREATE INDEX IF NOT EXISTS idx_evlog_payload_gin     ON pipeline.event_log USING gin (payload);

DROP TRIGGER IF EXISTS tg_evlog_upd ON pipeline.event_log;
CREATE TRIGGER tg_evlog_upd
    BEFORE UPDATE ON pipeline.event_log
    FOR EACH ROW EXECUTE FUNCTION pipeline.touch_updated_at();

-- ============================================================
-- 2. financiero.cost_line  (JSON #5)
--    Línea de costo asociada a un expediente. Permite trazar el
--    margen real: SUM(cost_line.amount WHERE expediente_id=X)
--    vs precio_lista del expediente.
--    `phase` distingue costo planificado vs costo real ejecutado.
-- ============================================================
CREATE TABLE IF NOT EXISTS financiero.cost_line (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expediente_id       UUID          NOT NULL,             -- expedientes.expediente.id
    cost_type           VARCHAR(32)   NOT NULL,             -- 'producto' / 'flete' / 'aduana' / 'seguro' / 'comision' / 'otros'
    description         VARCHAR(255),
    amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency            VARCHAR(8)    NOT NULL DEFAULT 'USD',
    exchange_rate       NUMERIC(14,6) NOT NULL DEFAULT 1.0, -- tasa al USD/base
    amount_base         NUMERIC(14,2),                       -- monto convertido (auto o app)
    phase               VARCHAR(16)   NOT NULL DEFAULT 'planned', -- 'planned' / 'real'
    proveedor_id        UUID,                                -- proveedores.proveedor.id (opcional)
    document_id         UUID,                                -- expedientes.documento.id si lo respalda
    invoice_number      VARCHAR(64),
    invoice_date        DATE,
    payment_status      VARCHAR(16)   NOT NULL DEFAULT 'PENDIENTE', -- 'PENDIENTE'/'PAGADO'/'CANCELADO'
    notes               TEXT,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_id       UUID                                 -- core.users.id
);

CREATE INDEX IF NOT EXISTS idx_costline_exp           ON financiero.cost_line(expediente_id);
CREATE INDEX IF NOT EXISTS idx_costline_type          ON financiero.cost_line(cost_type);
CREATE INDEX IF NOT EXISTS idx_costline_phase         ON financiero.cost_line(phase);
CREATE INDEX IF NOT EXISTS idx_costline_paystatus     ON financiero.cost_line(payment_status);
CREATE INDEX IF NOT EXISTS idx_costline_proveedor     ON financiero.cost_line(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_costline_active        ON financiero.cost_line(is_active);

DROP TRIGGER IF EXISTS tg_costline_upd ON financiero.cost_line;
CREATE TRIGGER tg_costline_upd
    BEFORE UPDATE ON financiero.cost_line
    FOR EACH ROW EXECUTE FUNCTION financiero.touch_updated_at();

-- ============================================================
-- 3. portal.mwt_user  (JSON #4)
--    Usuarios del portal B2B (separados de core.users — éstos son
--    los administradores/operadores internos de MWT).
--    legal_entity_id permite que un mismo email tenga acceso a varias
--    entidades legales (cliente con holding multi-país).
-- ============================================================
CREATE TABLE IF NOT EXISTS portal.mwt_user (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               CITEXT        UNIQUE NOT NULL,
    full_name           VARCHAR(180)  NOT NULL,
    role                VARCHAR(32)   NOT NULL DEFAULT 'b2b_client',
    -- role ∈ { b2b_client, b2b_finance, b2b_logistics, partner_viewer, api_user }
    legal_entity_id     UUID,                                -- clientes.cliente.id
    phone               VARCHAR(40),
    locale              VARCHAR(8)    NOT NULL DEFAULT 'es',
    timezone            VARCHAR(48)   NOT NULL DEFAULT 'America/Lima',
    is_api_user         BOOLEAN       NOT NULL DEFAULT FALSE,
    api_key_hash        VARCHAR(255),
    last_login_at       TIMESTAMPTZ,
    invited_by_id       UUID,                                -- core.users.id (admin que invitó)
    accepted_at         TIMESTAMPTZ,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mwtuser_role           ON portal.mwt_user(role);
CREATE INDEX IF NOT EXISTS idx_mwtuser_entity         ON portal.mwt_user(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_mwtuser_active         ON portal.mwt_user(is_active);
CREATE INDEX IF NOT EXISTS idx_mwtuser_apiuser        ON portal.mwt_user(is_api_user);

DROP TRIGGER IF EXISTS tg_mwtuser_upd ON portal.mwt_user;
CREATE TRIGGER tg_mwtuser_upd
    BEFORE UPDATE ON portal.mwt_user
    FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- ============================================================
-- 4. dashboard.snapshot  (JSON #1)
--    Snapshot de KPIs / preferencias guardado por usuario. Se usa
--    para "memorizar" la última vista del Dashboard (filtros,
--    layout, métricas favoritas) Y para almacenar snapshots
--    históricos de KPIs (ej: cierre mensual).
-- ============================================================
CREATE TABLE IF NOT EXISTS dashboard.snapshot (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID,                                -- core.users.id (NULL = snapshot global)
    snapshot_type       VARCHAR(32)   NOT NULL DEFAULT 'preferences',
    -- snapshot_type ∈ { preferences, kpi_monthly, kpi_weekly, kpi_daily, custom }
    label               VARCHAR(120),
    period_start        DATE,
    period_end          DATE,
    snapshot_data       JSONB         NOT NULL DEFAULT '{}'::jsonb,
    -- Estructura típica de snapshot_data:
    --   {
    --     "kpis": { "ventas_mes": 1234.56, "expedientes_open": 12, ... },
    --     "filters": { "nodo_id": "...", "moneda": "USD" },
    --     "layout":  { "widgets": [ "ventas", "stock_critico", ... ] }
    --   }
    is_pinned           BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashsnap_user         ON dashboard.snapshot(user_id);
CREATE INDEX IF NOT EXISTS idx_dashsnap_type         ON dashboard.snapshot(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_dashsnap_period       ON dashboard.snapshot(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_dashsnap_pinned       ON dashboard.snapshot(is_pinned) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_dashsnap_data_gin     ON dashboard.snapshot USING gin (snapshot_data);

DROP TRIGGER IF EXISTS tg_dashsnap_upd ON dashboard.snapshot;
CREATE TRIGGER tg_dashsnap_upd
    BEFORE UPDATE ON dashboard.snapshot
    FOR EACH ROW EXECUTE FUNCTION dashboard.touch_updated_at();

-- ============================================================
-- Verificación rápida (informativa):
--   \dt pipeline.*
--   \dt financiero.*
--   \dt portal.*
--   \dt dashboard.*
-- Las 4 tablas deben aparecer.
-- ============================================================
