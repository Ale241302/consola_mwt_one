-- =====================================================================
-- MWT.ONE · 33_clientes_parent_child.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Cliente · arquitectura Padre-Subsidiaria (2 niveles MAX).
--
-- Decisiones canónicas (resolución arquitectónica · 2026-04-29):
--   · Self-referential vía VARCHAR(36) (UUID en texto). CERO FOREIGN KEYs
--     físicas — la integridad se valida en app layer (DRF clean()).
--   · 2 niveles máximo: padre.parent_id IS NULL ⇒ ok.
--                       subsidiaria.parent_id = padre.id ⇒ ok.
--                       nieto (parent.parent_id NOT NULL) ⇒ rechazado.
--   · Pool de crédito compartido: la subsidiaria consume del límite
--     del padre. credito_aprobado / credito_usado en la subsidiaria
--     quedan para reporting per-entity, pero el "cap" operativo se
--     calcula sobre la suma del pool en el ViewSet.
--   · Aislamiento logístico/fiscal: codigo_marluvas, direccion_entrega
--     y contacto_email YA existen en la tabla (32_clientes_extensions
--     + 93_schema_extensions §4) — la subsidiaria los usa de forma
--     INDEPENDIENTE. Los Expedientes se asocian a la subsidiaria.
--
-- Estado previo (ya creado en scripts anteriores):
--   · 30_clientes.sql                → tabla base + catálogos
--   · 31_clientes_audit.sql          → audit + canal/medio_pago/incoterm
--   · 32_clientes_extensions.sql     → cedula_juridica, comision_pct,
--                                      checks codigo_marluvas/dias_credito
--   · 93_schema_extensions.sql §4    → codigo_marluvas, canal, incoterm,
--                                      medio_pago, direccion_entrega
--
-- Campos que AGREGA este script:
--   · parent_id  VARCHAR(36)         — UUID del cliente padre (NULL = top-level)
--
-- Índices que AGREGA:
--   · idx_cliente_parent              → lookups subsidiarias por padre
--   · idx_cliente_top_level (parcial) → dashboard top-level (parent_id IS NULL)
--   · idx_cliente_marluvas_unique     → unicidad de codigo_marluvas activo
--                                       (para que cada subsidiaria tenga
--                                        SAP propio e irrepetible)
--
-- CHECKs que AGREGA (NOT VALID — no rompe legacy):
--   · ck_cliente_parent_format        → parent_id es UUID válido si presente
--   · ck_cliente_parent_not_self      → un cliente no puede ser su propio padre
--
-- Reglas MWT respetadas:
--   · CERO FKs (R6 implícita: integridad relacional vive en app layer).
--   · Soft-delete mantenido vía is_active.
--   · CHECKs creados con NOT VALID; un VALIDATE puede correrse luego.
--   · Idempotente (IF NOT EXISTS / DO $$ check pg_constraint).
--
-- Backfill: NO se requiere migración de datos. Los clientes existentes
-- quedan automáticamente como top-level (parent_id IS NULL = default).
-- =====================================================================


-- ────────────────────────────────────────────────────────────
-- 1. Columna parent_id (self-referential, sin FK)
-- ────────────────────────────────────────────────────────────
ALTER TABLE clientes.cliente
    ADD COLUMN IF NOT EXISTS parent_id VARCHAR(36);

COMMENT ON COLUMN clientes.cliente.parent_id IS
    'UUID del cliente padre en formato texto (sin FK física). '
    'NULL = cliente top-level. Validación 2 niveles en app layer (DRF). '
    'Pool de crédito: subsidiarias consumen del límite del padre.';


-- ────────────────────────────────────────────────────────────
-- 2. Índices
-- ────────────────────────────────────────────────────────────

-- Lookup de subsidiarias por padre (fuente del endpoint /subsidiarias/)
CREATE INDEX IF NOT EXISTS idx_cliente_parent
    ON clientes.cliente (parent_id)
    WHERE parent_id IS NOT NULL;

-- Dashboard top-level (filtrar parent_id IS NULL es la query más caliente)
CREATE INDEX IF NOT EXISTS idx_cliente_top_level
    ON clientes.cliente (id)
    WHERE parent_id IS NULL AND is_active = TRUE;

-- Unicidad de codigo_marluvas por cliente activo (cada subsidiaria
-- DEBE tener su propio SAP — los Expedientes apuntan al SAP de la
-- subsidiaria, no del padre). Permite múltiples NULLs y reuso si
-- el cliente está soft-deleted.
DROP INDEX IF EXISTS clientes.idx_cliente_codigo_marluvas;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cliente_marluvas_unique
    ON clientes.cliente (codigo_marluvas)
    WHERE codigo_marluvas IS NOT NULL AND is_active = TRUE;


-- ────────────────────────────────────────────────────────────
-- 3. CHECK constraints (NOT VALID para no bloquear datos legacy)
-- ────────────────────────────────────────────────────────────

-- parent_id, si está presente, debe ser un UUID válido (8-4-4-4-12 hex).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_parent_format'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_parent_format
            CHECK (
                parent_id IS NULL OR
                parent_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            )
            NOT VALID;
    END IF;
END $$;

-- Auto-referencia: un cliente no puede ser su propio padre.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cliente_parent_not_self'
          AND conrelid = 'clientes.cliente'::regclass
    ) THEN
        ALTER TABLE clientes.cliente
            ADD CONSTRAINT ck_cliente_parent_not_self
            CHECK (parent_id IS NULL OR parent_id::text <> id::text)
            NOT VALID;
    END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. Vista helper: clientes top-level con stats consolidadas
--    (uso opcional desde reportería; el ViewSet ya consolida en runtime).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW clientes.v_cliente_pool AS
SELECT
    p.id                      AS parent_id,
    p.razon_social            AS parent_razon_social,
    p.credito_aprobado        AS parent_credito_aprobado,
    -- Suma del pool: padre + subsidiarias activas
    COALESCE(p.credito_usado, 0) +
        COALESCE((
            SELECT SUM(s.credito_usado)
            FROM clientes.cliente s
            WHERE s.parent_id = p.id::text AND s.is_active = TRUE
        ), 0)                 AS pool_credito_usado,
    (SELECT COUNT(*) FROM clientes.cliente s
        WHERE s.parent_id = p.id::text AND s.is_active = TRUE)
                              AS subsidiarias_activas
FROM clientes.cliente p
WHERE p.parent_id IS NULL AND p.is_active = TRUE;

COMMENT ON VIEW clientes.v_cliente_pool IS
    'Vista de solo lectura para reportes BI. El cálculo canónico de '
    'pool de crédito vive en apps.clientes.models.calcular_kpis_consolidados().';


-- =====================================================================
-- FIN 33_clientes_parent_child.sql
-- =====================================================================
