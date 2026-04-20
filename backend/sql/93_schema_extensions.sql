-- ============================================================
-- MWT.ONE · 93_schema_extensions.sql
-- Agente responsable: [AG-DATABASE]
--
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS para los campos que
-- los JSON canónicos (15 entidades) introducen y aún no existen
-- en los SQL originales (10..92). Cero borrado de columnas
-- existentes — solo aditivo.
--
-- Agrupa SOLO extensiones a tablas YA creadas. Tablas
-- completamente nuevas (pipeline.event_log, financiero.cost_line,
-- portal.mwt_user, dashboard.snapshot) van en 94_*.sql.
--
-- Idempotente. Se puede correr N veces sin romper.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. expedientes.expediente — Trazabilidad OC + SAP
--    (JSON #2 amplía con oc_id ya presente, numero_sap explícito,
--    fecha_produccion_estimada, price_basis, parent_expediente_id,
--    is_inverted_child, transport_mode, deferred_visible.)
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS numero_sap                VARCHAR(32);
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS fecha_produccion_estimada DATE;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS price_basis               VARCHAR(16);   -- fob, cif, exw, ddp...
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS transport_mode            VARCHAR(16);   -- maritimo / aereo / terrestre
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS parent_expediente_id      UUID;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS is_inverted_child         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS deferred_visible          BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS exp_numero_sap_idx          ON expedientes.expediente (numero_sap);
CREATE INDEX IF NOT EXISTS exp_parent_idx              ON expedientes.expediente (parent_expediente_id);
CREATE INDEX IF NOT EXISTS exp_inverted_child_idx      ON expedientes.expediente (is_inverted_child);

-- ────────────────────────────────────────────────────────────
-- 2. nodos.nodo — Gobernanza (legal entity owner / operator),
--    capacidades y status explícito (vs solo is_active).
--    JSON #7
-- ────────────────────────────────────────────────────────────
ALTER TABLE nodos.nodo ADD COLUMN IF NOT EXISTS legal_entity_owner_id  UUID;
ALTER TABLE nodos.nodo ADD COLUMN IF NOT EXISTS operator_id            UUID;
ALTER TABLE nodos.nodo ADD COLUMN IF NOT EXISTS capabilities           JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE nodos.nodo ADD COLUMN IF NOT EXISTS status                 VARCHAR(16);   -- ACTIVE / INACTIVE / SETUP / RETIRED

CREATE INDEX IF NOT EXISTS idx_nodo_status   ON nodos.nodo(status);
CREATE INDEX IF NOT EXISTS idx_nodo_owner    ON nodos.nodo(legal_entity_owner_id);
CREATE INDEX IF NOT EXISTS idx_nodo_operator ON nodos.nodo(operator_id);
CREATE INDEX IF NOT EXISTS idx_nodo_caps_gin ON nodos.nodo USING gin (capabilities);

-- ────────────────────────────────────────────────────────────
-- 3. brands.marca — issuing_entity_id, mercados_activos y umbral
--    de margen mínimo. JSON #9
--    (la columna `territorios` ya existe; mercados_activos es un
--    campo distinto orientado a "ventas" vs "geografía permitida")
-- ────────────────────────────────────────────────────────────
ALTER TABLE brands.marca ADD COLUMN IF NOT EXISTS issuing_entity_id   UUID;
ALTER TABLE brands.marca ADD COLUMN IF NOT EXISTS mercados_activos    JSONB        NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE brands.marca ADD COLUMN IF NOT EXISTS min_margin_alert_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00;
ALTER TABLE brands.marca ADD COLUMN IF NOT EXISTS brand_code           VARCHAR(16);
ALTER TABLE brands.marca ADD COLUMN IF NOT EXISTS tipo                 VARCHAR(16);   -- PROPIA / TERCEROS / EXCLUSIVA

CREATE INDEX IF NOT EXISTS idx_marca_brand_code     ON brands.marca(brand_code);
CREATE INDEX IF NOT EXISTS idx_marca_tipo           ON brands.marca(tipo);
CREATE INDEX IF NOT EXISTS idx_marca_issuing        ON brands.marca(issuing_entity_id);

-- ────────────────────────────────────────────────────────────
-- 4. clientes.cliente — Campos comerciales que el JSON #8
--    expone (codigo_marluvas, cedula_juridica = alias semántico,
--    canal, incoterm, medio_pago).
--    razon_social y tax_id se mantienen como columnas oficiales
--    del schema; estos son alias del dominio comercial.
-- ────────────────────────────────────────────────────────────
ALTER TABLE clientes.cliente ADD COLUMN IF NOT EXISTS codigo_marluvas   VARCHAR(32);
ALTER TABLE clientes.cliente ADD COLUMN IF NOT EXISTS canal             VARCHAR(32);     -- distribuidor / retail / oem
ALTER TABLE clientes.cliente ADD COLUMN IF NOT EXISTS incoterm          VARCHAR(8);
ALTER TABLE clientes.cliente ADD COLUMN IF NOT EXISTS medio_pago        VARCHAR(48);
ALTER TABLE clientes.cliente ADD COLUMN IF NOT EXISTS direccion_entrega TEXT;

CREATE INDEX IF NOT EXISTS idx_cliente_marluvas ON clientes.cliente(codigo_marluvas);
CREATE INDEX IF NOT EXISTS idx_cliente_canal    ON clientes.cliente(canal);

-- ────────────────────────────────────────────────────────────
-- 5. productos.producto — JSON #10
--    "precio_mwt" (≈ precio_distribuidor pero conceptualmente
--    distinto: precio interno MWT) y "especificaciones" JSONB
--    para fichas técnicas largas (calzado: tipo_puntera, normativa…)
-- ────────────────────────────────────────────────────────────
ALTER TABLE productos.producto ADD COLUMN IF NOT EXISTS precio_mwt       NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE productos.producto ADD COLUMN IF NOT EXISTS especificaciones JSONB         NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ix_producto_specs_gin
    ON productos.producto USING gin (especificaciones);

-- ────────────────────────────────────────────────────────────
-- 6. proveedores.proveedor — JSON #11
--    "clase" (CRITICO / NORMAL / EVENTUAL) + "score_iso" (0..5)
--    + lead_time_estimado (alias de lead_time_dias para
--    coherencia con el JSON; columna independiente).
-- ────────────────────────────────────────────────────────────
ALTER TABLE proveedores.proveedor ADD COLUMN IF NOT EXISTS clase                VARCHAR(16);
ALTER TABLE proveedores.proveedor ADD COLUMN IF NOT EXISTS score_iso            NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE proveedores.proveedor ADD COLUMN IF NOT EXISTS producto_servicio    VARCHAR(192);

CREATE INDEX IF NOT EXISTS ix_prov_clase ON proveedores.proveedor(clase);

-- ────────────────────────────────────────────────────────────
-- 7. inventario.stock — JSON #12
--    "vendidos" (no existía: counter de unidades despachadas
--    cumulativas) + "lote_code" (alias semántico de `lote`) +
--    "recibido_en" (DATE en JSON; ya tenemos last_movement_at,
--    pero recibido_en marca el primer ingreso).
-- ────────────────────────────────────────────────────────────
ALTER TABLE inventario.stock ADD COLUMN IF NOT EXISTS vendidos    NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE inventario.stock ADD COLUMN IF NOT EXISTS lote_code   VARCHAR(64);
ALTER TABLE inventario.stock ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_stock_lote_code  ON inventario.stock(lote_code);
CREATE INDEX IF NOT EXISTS ix_stock_recibido   ON inventario.stock(recibido_en);

-- ────────────────────────────────────────────────────────────
-- 8. notifications.notification_log — JSON #14
--    "correlation_id" (vincula al evento del pipeline que disparó
--    el envío) + "trigger_action_source" (C1..C11 — el slot
--    semántico del workflow). Existen ya: template_id, expediente_id,
--    body_preview, status, attempt_count, error.
-- ────────────────────────────────────────────────────────────
ALTER TABLE notifications.notification_log ADD COLUMN IF NOT EXISTS correlation_id        UUID;
ALTER TABLE notifications.notification_log ADD COLUMN IF NOT EXISTS trigger_action_source VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_nlog_correlation  ON notifications.notification_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_nlog_action_src   ON notifications.notification_log(trigger_action_source);

-- ────────────────────────────────────────────────────────────
-- 9. cobros.pago — JSON #15 (ExpedientePago / Payment Status Machine)
--    "rejection_reason" (cuando estado=RECHAZADO) +
--    "credit_released_at" / "credit_released_by_id" (cuándo se
--    liberó el crédito asociado al cliente). proforma_id ya
--    se infiere desde cobro_id; añadimos columna explícita.
-- ────────────────────────────────────────────────────────────
ALTER TABLE cobros.pago ADD COLUMN IF NOT EXISTS proforma_id            UUID;
ALTER TABLE cobros.pago ADD COLUMN IF NOT EXISTS rejection_reason       VARCHAR(255);
ALTER TABLE cobros.pago ADD COLUMN IF NOT EXISTS credit_released_at     TIMESTAMPTZ;
ALTER TABLE cobros.pago ADD COLUMN IF NOT EXISTS credit_released_by_id  UUID;

CREATE INDEX IF NOT EXISTS pago_proforma_idx    ON cobros.pago(proforma_id);
CREATE INDEX IF NOT EXISTS pago_credit_rel_idx  ON cobros.pago(credit_released_at);

-- ────────────────────────────────────────────────────────────
-- Verificación rápida (informativa):
--   \d expedientes.expediente
--   \d nodos.nodo
--   \d productos.producto
--   \d inventario.stock
--   \d cobros.pago
-- Todas las columnas nuevas deben aparecer al final del listado.
-- ────────────────────────────────────────────────────────────
