-- =====================================================================
-- MWT.ONE · 32_clientes_extensions.sql
-- Agente responsable: [AG-DATABASE]
--
-- Extensión aditiva del módulo `clientes` para soportar la ficha
-- completa B2B de la operación SAP-Marluvas (sprint Cliente M3b).
--
-- Estado previo (ya creado en 30_clientes.sql + 93_schema_extensions.sql):
--   · razon_social, nombre_comercial, tax_id, tipo, segmento
--   · pais_iso2, ciudad, direccion, moneda
--   · credito_aprobado, credito_usado, dias_credito
--   · contacto_nombre, contacto_email, contacto_tel
--   · estado (ACTIVO · INACTIVO · BLOQUEADO)
--   · codigo_marluvas, canal, incoterm, medio_pago, direccion_entrega
--
-- Campos que AGREGA este script:
--   · cedula_juridica    VARCHAR(32)    — identificador legal alterno
--   · comision_pct       NUMERIC(6,4)   — CEO-ONLY · % de comisión pactada
--
-- Ajustes adicionales:
--   · estado_cat + 'PAUSADO' (Amber · #F59E0B)
--   · CHECK codigo_marluvas: exactamente 10 dígitos numéricos (NULL ok)
--   · CHECK dias_credito   : rango 0..180 (NULL ok)
--   · CHECK comision_pct   : rango 0..0.9999
--   · CHECK estado         : ACTIVO | PAUSADO | BLOQUEADO | INACTIVO
--
-- Reglas MWT respetadas:
--   · CERO FKs — sólo UUIDs en texto cuando hay relación lógica.
--   · Soft-delete mantenido vía is_active.
--   · CHECK creados con NOT VALID para no bloquear si hay registros
--     legacy fuera del patrón; un VALIDATE puede correrse luego.
-- =====================================================================


-- ────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en clientes.cliente
-- ────────────────────────────────────────────────────────────
ALTER TABLE clientes.cliente
    ADD COLUMN IF NOT EXISTS cedula_juridica VARCHAR(32),
    ADD COLUMN IF NOT EXISTS comision_pct    NUMERIC(6,4);

COMMENT ON COLUMN clientes.cliente.cedula_juridica IS
    'Identificador legal alterno (usado en CR/PA además del tax_id).';
COMMENT ON COLUMN clientes.cliente.comision_pct    IS
    'Porcentaje de comisión pactado con el cliente. CEO-ONLY (POL_VISIBILIDAD). 0.0850 = 8.5%.';

-- Índice para búsquedas por codigo_marluvas (identificador SAP).
CREATE INDEX IF NOT EXISTS idx_cliente_codigo_marluvas
    ON clientes.cliente (codigo_marluvas)
    WHERE codigo_marluvas IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cliente_cedula_juridica
    ON clientes.cliente (cedula_juridica)
    WHERE cedula_juridica IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 2. Estado PAUSADO (Amber) — nuevo estado operativo intermedio
-- ────────────────────────────────────────────────────────────
INSERT INTO clientes.estado_cat (codigo, label, color) VALUES
    ('PAUSADO', 'Pausado', '#F59E0B')
ON CONFLICT (codigo) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. CHECK constraints (NOT VALID para no bloquear datos legacy)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_codigo_marluvas'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_codigo_marluvas
            CHECK (codigo_marluvas IS NULL OR codigo_marluvas ~ '^\d{10}$')
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_dias_credito_rng'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_dias_credito_rng
            CHECK (dias_credito IS NULL OR (dias_credito >= 0 AND dias_credito <= 180))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_comision_pct_rng'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_comision_pct_rng
            CHECK (comision_pct IS NULL OR (comision_pct >= 0 AND comision_pct <= 0.9999))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_estado_enum'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_estado_enum
            CHECK (estado IN ('ACTIVO','PAUSADO','BLOQUEADO','INACTIVO'))
            NOT VALID;
    END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. Seed de canales canónicos + medios de pago + incoterms
--    (31_clientes_audit.sql ya creó estas tablas; reforzamos
--     los catálogos si quedaron vacíos tras migraciones previas).
-- ────────────────────────────────────────────────────────────
INSERT INTO clientes.canal_cat (codigo, label, orden) VALUES
    ('DIRECTO',      'Directo',      10),
    ('DISTRIBUIDOR', 'Distribuidor', 20),
    ('RETAIL',       'Retail',       30),
    ('ECOMMERCE',    'E-commerce',   40)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO clientes.medio_pago_cat (codigo, label, orden) VALUES
    ('TRANSFER_BANCARIA', 'Transferencia bancaria', 10),
    ('CARTA_CREDITO',     'Carta de crédito',       20),
    ('CUENTA_CORRIENTE',  'Cuenta corriente',       30),
    ('CONTADO',           'Pago de contado',        40),
    ('CHEQUE',            'Cheque',                 50)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO clientes.incoterm_cat (codigo, label, descripcion, orden) VALUES
    ('EXW', 'EXW · Ex Works',       'Comprador retira en fábrica del vendedor.', 10),
    ('FCA', 'FCA · Free Carrier',   'Vendedor entrega al transportista designado.', 20),
    ('CPT', 'CPT · Carriage Paid',  'Vendedor paga flete al destino acordado.', 30),
    ('CIP', 'CIP · Carriage + Ins', 'CPT + seguro mínimo hasta el destino.',     40),
    ('FOB', 'FOB · Free On Board',  'Entrega sobre el buque en puerto de embarque.', 50),
    ('CFR', 'CFR · Cost + Freight', 'FOB + flete marítimo pagado.',              60),
    ('CIF', 'CIF · Cost Ins + Freight', 'CFR + seguro marítimo.',                70),
    ('DAP', 'DAP · Delivered At Place', 'Entregado en destino sin descargar.',    80),
    ('DDP', 'DDP · Delivered Duty Paid', 'Vendedor asume todo hasta destino.',    90)
ON CONFLICT (codigo) DO NOTHING;


-- =====================================================================
-- FIN 32_clientes_extensions.sql
-- =====================================================================
