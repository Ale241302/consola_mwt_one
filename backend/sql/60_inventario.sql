-- ============================================================
-- MWT.ONE · 60_inventario.sql
-- Agente responsable: [AG-DATABASE]
--
-- Stock por (nodo, producto, lote) + Ledger de movimientos.
-- Cero FKs gestionadas por Postgres — vínculos por UUID en ORM.
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS inventario;

SET search_path = inventario, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.tipo_movimiento_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(48)  NOT NULL,
    direccion  CHAR(1)      NOT NULL CHECK (direccion IN ('+', '-', '=')),
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventario.motivo_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(96)  NOT NULL,
    tipo_mov   VARCHAR(16),                 -- vincula a tipo_movimiento_cat por codigo
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO inventario.tipo_movimiento_cat(codigo, label, direccion, color, orden) VALUES
    ('ENTRADA',  'Entrada',           '+', '#00B286', 10),
    ('SALIDA',   'Salida',            '-', '#EF4444', 20),
    ('TRANSFER', 'Transferencia',     '=', '#481EE3', 30),
    ('AJUSTE',   'Ajuste de stock',   '=', '#F59E0B', 40),
    ('MERMA',    'Merma / pérdida',   '-', '#6B7280', 50),
    ('RETORNO',  'Retorno cliente',   '+', '#3083FE', 60),
    ('RESERVA',  'Reserva',           '=', '#1EE3D7', 70),
    ('LIBERA',   'Liberar reserva',   '=', '#1DE394', 80)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO inventario.motivo_cat(codigo, label, tipo_mov, orden) VALUES
    ('COMPRA_OC',         'Recepción de OC',           'ENTRADA',  10),
    ('IMPORTACION',       'Importación / aduana',      'ENTRADA',  20),
    ('VENTA',             'Venta a cliente',           'SALIDA',   10),
    ('VENTA_MARKETPLACE', 'Venta marketplace',         'SALIDA',   20),
    ('TRANSFER_INTERNO',  'Transferencia entre nodos', 'TRANSFER', 10),
    ('AJUSTE_INVENTARIO', 'Ajuste por conteo físico',  'AJUSTE',   10),
    ('AJUSTE_FISCAL',     'Ajuste fiscal',             'AJUSTE',   20),
    ('MERMA_DAÑO',        'Merma por daño',            'MERMA',    10),
    ('MERMA_VENCIMIENTO', 'Merma por vencimiento',     'MERMA',    20),
    ('DEVOLUCION',        'Devolución de cliente',     'RETORNO',  10),
    ('RESERVA_PEDIDO',    'Reservado por pedido',      'RESERVA',  10),
    ('LIBERACION',        'Liberación de reserva',     'LIBERA',   10)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- STOCK por (nodo, producto, lote)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.stock (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    nodo_id                  UUID         NOT NULL,           -- ⛔ sin FK
    producto_id              UUID         NOT NULL,           -- ⛔ sin FK
    lote                     VARCHAR(64)  NOT NULL DEFAULT '',
    fecha_vencimiento        DATE,

    cantidad_disponible      NUMERIC(14,3) NOT NULL DEFAULT 0,
    cantidad_reservada       NUMERIC(14,3) NOT NULL DEFAULT 0,
    cantidad_en_transito     NUMERIC(14,3) NOT NULL DEFAULT 0,

    costo_unitario_usd       NUMERIC(14,4) NOT NULL DEFAULT 0,
    ubicacion_fisica         VARCHAR(64),                     -- pasillo / estante
    last_movement_at         TIMESTAMPTZ,

    is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (nodo_id, producto_id, lote)
);

CREATE INDEX IF NOT EXISTS ix_stock_nodo      ON inventario.stock(nodo_id);
CREATE INDEX IF NOT EXISTS ix_stock_producto  ON inventario.stock(producto_id);
CREATE INDEX IF NOT EXISTS ix_stock_venc      ON inventario.stock(fecha_vencimiento);

DROP TRIGGER IF EXISTS tg_stock_updated ON inventario.stock;
CREATE TRIGGER tg_stock_updated
    BEFORE UPDATE ON inventario.stock
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- LEDGER de movimientos (append-only desde el ORM)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.movimiento (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    tipo                VARCHAR(16)  NOT NULL,                -- ENTRADA/SALIDA/TRANSFER/...
    motivo              VARCHAR(32),                          -- vincula a motivo_cat.codigo

    producto_id         UUID         NOT NULL,                -- ⛔ sin FK
    nodo_origen_id      UUID,                                 -- ⛔ sin FK (vacío si es ENTRADA pura)
    nodo_destino_id     UUID,                                 -- ⛔ sin FK (vacío si es SALIDA pura)
    lote                VARCHAR(64)  NOT NULL DEFAULT '',

    cantidad            NUMERIC(14,3) NOT NULL,
    costo_unitario_usd  NUMERIC(14,4) NOT NULL DEFAULT 0,

    referencia_tipo     VARCHAR(24),                          -- 'transfer', 'oc', 'venta'...
    referencia_id       UUID,
    notas               TEXT,

    user_id             UUID,                                 -- ⛔ sin FK (core.users)

    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_mov_tipo            ON inventario.movimiento(tipo);
CREATE INDEX IF NOT EXISTS ix_mov_motivo          ON inventario.movimiento(motivo);
CREATE INDEX IF NOT EXISTS ix_mov_producto        ON inventario.movimiento(producto_id);
CREATE INDEX IF NOT EXISTS ix_mov_nodo_origen     ON inventario.movimiento(nodo_origen_id);
CREATE INDEX IF NOT EXISTS ix_mov_nodo_destino    ON inventario.movimiento(nodo_destino_id);
CREATE INDEX IF NOT EXISTS ix_mov_referencia      ON inventario.movimiento(referencia_tipo, referencia_id);
CREATE INDEX IF NOT EXISTS ix_mov_created_at      ON inventario.movimiento(created_at DESC);
