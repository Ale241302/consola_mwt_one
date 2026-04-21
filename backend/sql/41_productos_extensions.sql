-- ============================================================
-- MWT.ONE · 41_productos_extensions.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack del Módulo
-- 10 (Productos). Cubre los gaps entre el Frontend (Productos.jsx,
-- ProductFormView, ProductMassiveUpload, PricingManagerTable,
-- SizingEngine, SizeFormDrawer) y el Backend existente.
--
-- Tablas añadidas (todas ZERO FKs — vínculos por UUID plano en ORM):
--   1. productos.imports_log     · trazabilidad de cargas masivas
--   2. productos.talla_matriz    · matriz oficial de tallas por SKU
--   3. productos.variante        · combinaciones talla × color
--   4. productos.precio_history  · histórico de cambios de precio
--
-- Arquitectura: CERO migraciones (solo SQL idempotente),
-- CERO foreign keys (solo UUIDs con índices), aditivo.
-- Se puede correr N veces sin romper (IF NOT EXISTS everywhere).
-- ============================================================

SET search_path = productos, public;

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función tg_set_updated_at() ya existe
--    (creada en 70_expedientes.sql). Re-creada defensivamente
--    por si el apply-order cambia.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. productos.imports_log
--
--    Trazabilidad de cargas masivas (Excel/CSV) desde el
--    Frontend (ProductMassiveUpload.jsx). Cada upload del CEO/
--    operador deja una fila con el payload original + el
--    resultado (validado, parcial, fallido) para poder revertir
--    o auditar.
--
--    Flow canónico (2 pasos):
--      · preview  → status='VALIDATING' + errors_json hasta que
--                   el usuario confirma.
--      · commit   → status='COMMITTED' + rows_inserted > 0.
--
--    Nada se inserta en productos.producto hasta status='COMMITTED'.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.imports_log (
    id              UUID PRIMARY KEY,
    user_id         UUID,                                        -- ⛔ sin FK
    filename        VARCHAR(256)   NOT NULL,
    content_type    VARCHAR(96),
    source_url      TEXT,                                        -- signed URL del archivo en Paperless/S3
    sheet_name      VARCHAR(96),                                 -- hoja de Excel procesada
    rows_total      INTEGER        NOT NULL DEFAULT 0,
    rows_valid      INTEGER        NOT NULL DEFAULT 0,
    rows_invalid    INTEGER        NOT NULL DEFAULT 0,
    rows_inserted   INTEGER        NOT NULL DEFAULT 0,
    rows_updated    INTEGER        NOT NULL DEFAULT 0,
    status          VARCHAR(16)    NOT NULL DEFAULT 'VALIDATING',
                    -- VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED
    preview_json    JSONB          NOT NULL DEFAULT '[]'::jsonb, -- primeras N filas parseadas
    errors_json     JSONB          NOT NULL DEFAULT '[]'::jsonb, -- [{row, column, error}]
    summary_json    JSONB          NOT NULL DEFAULT '{}'::jsonb, -- totales, deltas, warnings

    committed_at    TIMESTAMPTZ,
    committed_by    UUID,                                        -- ⛔ sin FK
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_imports_log_user        ON productos.imports_log(user_id);
CREATE INDEX IF NOT EXISTS ix_imports_log_status      ON productos.imports_log(status);
CREATE INDEX IF NOT EXISTS ix_imports_log_created     ON productos.imports_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_imports_log_errors_gin  ON productos.imports_log USING gin (errors_json);

DROP TRIGGER IF EXISTS trg_imports_log_updated_at ON productos.imports_log;
CREATE TRIGGER trg_imports_log_updated_at
BEFORE UPDATE ON productos.imports_log
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. productos.talla_matriz
--
--    Matriz oficial de tallas por SKU. Alimenta el SizingEngine
--    del frontend (SizingEngine.jsx / SizeFormDrawer.jsx).
--    Una fila por (producto_id, sistema, talla) — el sistema
--    puede ser EU, US, UK, MX, BR, CM, ALPHA, INTL.
--
--    Cada talla tiene:
--      · orden (para ordenar ascendente)
--      · medidas JSONB (cm, pulgadas, rango ancho, etc.)
--      · stock_alert (umbral mínimo para el SKU+talla)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.talla_matriz (
    id              UUID PRIMARY KEY,
    producto_id     UUID           NOT NULL,                     -- ⛔ sin FK a productos.producto
    sistema         VARCHAR(16)    NOT NULL,
                    -- EU / US / UK / MX / BR / CM / ALPHA / INTL
    talla           VARCHAR(16)    NOT NULL,                     -- "42", "M", "XL", "9.5", "XXS"
    orden           INTEGER        NOT NULL DEFAULT 100,
    medidas         JSONB          NOT NULL DEFAULT '{}'::jsonb,
                    -- {"cm_largo": 26.5, "cm_ancho": 9.8, "fit": "regular"}
    stock_alert     NUMERIC(14,3)  NOT NULL DEFAULT 0,
    equivalencias   JSONB          NOT NULL DEFAULT '{}'::jsonb,
                    -- {"US": "9.5", "EU": "42", "CM": "26.5"}
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_talla_matriz_producto_sistema_talla
    ON productos.talla_matriz (producto_id, sistema, talla)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_talla_matriz_producto  ON productos.talla_matriz(producto_id);
CREATE INDEX IF NOT EXISTS ix_talla_matriz_sistema   ON productos.talla_matriz(sistema);
CREATE INDEX IF NOT EXISTS ix_talla_matriz_medidas_gin
    ON productos.talla_matriz USING gin (medidas);

DROP TRIGGER IF EXISTS trg_talla_matriz_updated_at ON productos.talla_matriz;
CREATE TRIGGER trg_talla_matriz_updated_at
BEFORE UPDATE ON productos.talla_matriz
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. productos.variante
--
--    Combinación concreta talla × color × atributos extra de un
--    producto padre. Genera el "SKU hijo" que se factura y que
--    consume inventario. Cada variante tiene su EAN propio y su
--    precio puede divergir del SKU padre (ej. talla especial +20%).
--
--    Vínculo a producto padre: producto_id (UUID, sin FK).
--    Vínculo a talla_matriz:   talla_matriz_id (opcional).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.variante (
    id                      UUID PRIMARY KEY,
    producto_id             UUID           NOT NULL,             -- ⛔ sin FK
    talla_matriz_id         UUID,                                -- ⛔ sin FK (puede ser null si no hay sizing)
    sku_hijo                VARCHAR(96)    NOT NULL,
    ean                     VARCHAR(32),
    talla                   VARCHAR(16),                         -- denormalizado para búsqueda rápida
    color                   VARCHAR(48),
    color_hex               VARCHAR(16),                         -- "#0B1E3A"

    costo_override          NUMERIC(14,2),                       -- si null → usa producto.costo_estandar
    precio_override         NUMERIC(14,2),                       -- si null → usa producto.precio_lista
    peso_kg                 NUMERIC(10,3),
    volumen_m3              NUMERIC(10,4),

    stock_minimo            NUMERIC(14,3)  NOT NULL DEFAULT 0,
    stock_maximo            NUMERIC(14,3)  NOT NULL DEFAULT 0,

    imagen_url              TEXT,
    atributos               JSONB          NOT NULL DEFAULT '{}'::jsonb,
                            -- {"ancho": "regular", "fit": "slim", "certif": "ISO-20345"}
    estado                  VARCHAR(16)    NOT NULL DEFAULT 'ACTIVO',
    is_active               BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_variante_sku_hijo
    ON productos.variante (sku_hijo)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_variante_producto      ON productos.variante(producto_id);
CREATE INDEX IF NOT EXISTS ix_variante_talla_matriz  ON productos.variante(talla_matriz_id);
CREATE INDEX IF NOT EXISTS ix_variante_estado        ON productos.variante(estado);
CREATE INDEX IF NOT EXISTS ix_variante_ean           ON productos.variante(ean);
CREATE INDEX IF NOT EXISTS ix_variante_attrs_gin
    ON productos.variante USING gin (atributos);

DROP TRIGGER IF EXISTS trg_variante_updated_at ON productos.variante;
CREATE TRIGGER trg_variante_updated_at
BEFORE UPDATE ON productos.variante
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. productos.precio_history
--
--    Histórico auditable de cambios de precio (lista, distribuidor,
--    MWT interno, costo estándar). Cada edición del PricingManagerTable
--    o del form de producto deja una fila aquí, para responder:
--      · ¿quién cambió el precio y cuándo?
--      · ¿desde qué valor a qué valor?
--      · ¿qué justificación/nota se asoció al cambio?
--
--    Se escribe desde el backend (@action endpoint o signal) — el
--    Frontend NUNCA debe tocar esta tabla directamente.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.precio_history (
    id              UUID PRIMARY KEY,
    producto_id     UUID           NOT NULL,                     -- ⛔ sin FK
    variante_id     UUID,                                        -- ⛔ sin FK (null si es cambio a nivel SKU padre)
    campo           VARCHAR(32)    NOT NULL,
                    -- precio_lista / precio_distribuidor / precio_mwt / costo_estandar
    valor_anterior  NUMERIC(14,2),
    valor_nuevo     NUMERIC(14,2)  NOT NULL,
    moneda          VARCHAR(3)     NOT NULL DEFAULT 'USD',
    delta_pct       NUMERIC(7,2),                                -- calculado: (nuevo - anterior)/anterior * 100

    motivo          VARCHAR(64),                                 -- AJUSTE_FX / COSTO_PROVEEDOR / PROMO / ESTRATEGIA / CORRECCION
    nota            TEXT,
    source          VARCHAR(32)    NOT NULL DEFAULT 'MANUAL',
                    -- MANUAL / MASSIVE_UPLOAD / API / SCHEDULED_JOB
    context_json    JSONB          NOT NULL DEFAULT '{}'::jsonb,
                    -- {"upload_id": "...", "ruleset": "...", "fx_rate": 17.85}

    changed_by      UUID,                                        -- ⛔ sin FK
    changed_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),

    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_precio_history_producto    ON productos.precio_history(producto_id);
CREATE INDEX IF NOT EXISTS ix_precio_history_variante    ON productos.precio_history(variante_id);
CREATE INDEX IF NOT EXISTS ix_precio_history_campo       ON productos.precio_history(campo);
CREATE INDEX IF NOT EXISTS ix_precio_history_changed_at  ON productos.precio_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_precio_history_source      ON productos.precio_history(source);

DROP TRIGGER IF EXISTS trg_precio_history_updated_at ON productos.precio_history;
CREATE TRIGGER trg_precio_history_updated_at
BEFORE UPDATE ON productos.precio_history
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Fin 41_productos_extensions.sql
-- ============================================================
