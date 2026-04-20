-- ============================================================
-- MWT.ONE · 90_transfers.sql
-- Agente responsable: [AG-DATABASE]
--
-- Transferencias inter-nodo (stock que se mueve entre almacenes /
-- hubs / FBA / distribuidores). No toca inventory ledger directo —
-- eso se hace vía triggers/eventos o workflow de Celery.
-- Cero FKs gestionadas por Postgres — vínculos por UUID en ORM.
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS transfers;

SET search_path = transfers, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.estado_transfer_cat (
    codigo      VARCHAR(32)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    color       VARCHAR(16),
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO transfers.estado_transfer_cat(codigo, label, color, orden) VALUES
    ('PLANNED',      'Planeada',            '#64748B', 10),
    ('APPROVED',     'Aprobada',            '#3083FE', 20),
    ('IN_TRANSIT',   'En tránsito',         '#F59E0B', 30),
    ('RECEIVED',     'Recibida',            '#00B286', 40),
    ('RECONCILED',   'Conciliada',          '#1DE394', 50),
    ('CANCELLED',    'Cancelada',           '#EF4444', 60)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS transfers.legal_context_cat (
    codigo      VARCHAR(32)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO transfers.legal_context_cat(codigo, label, descripcion) VALUES
    ('INTERNAL',         'Movimiento interno',    'Entre nodos propios — sin cambio de propiedad legal.'),
    ('NATIONALIZATION',  'Nacionalización',       'Ingreso a un país — requiere DUA/importación.'),
    ('DISTRIBUTION',     'Distribución',          'Consignación a marketplace (Amazon FBA, MELI Full, etc.).'),
    ('CONSIGNMENT',      'Consignación',          'Distribución en consignación — propiedad retenida.'),
    ('EXPORT',           'Exportación',           'Salida internacional con DUA.')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Transferencia
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.transferencia (
    id              UUID PRIMARY KEY,
    codigo          VARCHAR(32) UNIQUE NOT NULL,   -- TRF-2026-0024
    origen_id       UUID,                          -- nodos.nodo.id
    destino_id      UUID,                          -- nodos.nodo.id
    origen_label    VARCHAR(128),                  -- snapshot del nombre
    destino_label   VARCHAR(128),
    legal_context   VARCHAR(32)  NOT NULL DEFAULT 'INTERNAL',
    estado          VARCHAR(32)  NOT NULL DEFAULT 'PLANNED',
    ref_tracking    VARCHAR(64),                   -- AWB / BL / guía
    needs_approval  BOOLEAN      NOT NULL DEFAULT FALSE,
    value_usd       NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by_id   UUID,                          -- core.user.id
    created_by_name VARCHAR(128),
    approved_by_id  UUID,
    approved_by_name VARCHAR(128),
    received_by_id  UUID,
    received_by_name VARCHAR(128),
    dispatched_at   DATE,
    eta             DATE,
    received_at     DATE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trf_origen       ON transfers.transferencia(origen_id);
CREATE INDEX IF NOT EXISTS idx_trf_destino      ON transfers.transferencia(destino_id);
CREATE INDEX IF NOT EXISTS idx_trf_estado       ON transfers.transferencia(estado);
CREATE INDEX IF NOT EXISTS idx_trf_needs_approv ON transfers.transferencia(needs_approval);
CREATE INDEX IF NOT EXISTS idx_trf_codigo       ON transfers.transferencia(codigo);
CREATE INDEX IF NOT EXISTS idx_trf_active       ON transfers.transferencia(is_active);

-- ────────────────────────────────────────────────────────────
-- Línea de transferencia
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.linea (
    id                UUID PRIMARY KEY,
    transferencia_id  UUID NOT NULL,
    producto_id       UUID,
    sku               VARCHAR(64),
    product_label     VARCHAR(255),
    size              VARCHAR(16),
    qty_transfer      INTEGER NOT NULL DEFAULT 0,
    qty_reserve       INTEGER NOT NULL DEFAULT 0,
    qty_received      INTEGER,                          -- NULL = no recibido aún
    unit_cost         NUMERIC(12,2),
    unit_value        NUMERIC(12,2),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trfline_trf ON transfers.linea(transferencia_id);
CREATE INDEX IF NOT EXISTS idx_trfline_sku ON transfers.linea(sku);

-- ────────────────────────────────────────────────────────────
-- Eventos (auditoría de cambios de estado)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.evento (
    id                UUID PRIMARY KEY,
    transferencia_id  UUID NOT NULL,
    estado_prev       VARCHAR(32),
    estado_nuevo      VARCHAR(32) NOT NULL,
    actor_id          UUID,
    actor_name        VARCHAR(128),
    notes             TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trfev_trf     ON transfers.evento(transferencia_id);
CREATE INDEX IF NOT EXISTS idx_trfev_estado  ON transfers.evento(estado_nuevo);

-- ────────────────────────────────────────────────────────────
-- Triggers de updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transfers.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_trf_upd    ON transfers.transferencia;
DROP TRIGGER IF EXISTS tg_trfline_upd ON transfers.linea;

CREATE TRIGGER tg_trf_upd
    BEFORE UPDATE ON transfers.transferencia
    FOR EACH ROW EXECUTE FUNCTION transfers.touch_updated_at();

CREATE TRIGGER tg_trfline_upd
    BEFORE UPDATE ON transfers.linea
    FOR EACH ROW EXECUTE FUNCTION transfers.touch_updated_at();
