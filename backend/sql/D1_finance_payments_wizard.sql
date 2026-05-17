-- =====================================================================
-- MWT.ONE · D1_finance_payments_wizard.sql
-- Sprint Registrar Pago (Fase 1) — delta schema sobre finance.payment +
-- nueva tabla finance.mwt_account.
-- =====================================================================
--
-- Origen: §6 Delta Document v1.0 sobre apps/finance (brief v1.2).
--
-- Cambios:
--   1. ALTER TABLE finance.payment — 7 columnas nuevas + 2 CHECK + 2 indices
--      para soportar el wizard de "Registrar pago":
--        · counterparty_type / counterparty_id (discriminator + UUID)
--        · direction (IN | OUT)
--        · reconciled_with_bank (boolean sub-flag de PENDIENTE_AI)
--        · rejection_reason / rejection_comment (motivo rechazo CEO)
--        · source_mwt_account_id / destination_mwt_account_id (cta MWT)
--
--   2. CREATE TABLE finance.mwt_account — cuentas bancarias propias MWT.
--      CEO-ONLY visibility. multi-tenancy via operating_company_id (NO RLS,
--      consistente con resto del repo).
--
-- NO se toca:
--   · expedientes.forma_pago — ya existe (B9_expedientes_forma_pago.sql).
--   · payment_application / payment_evidence / activity_log — se reusan.
--   · payment_state_transitions — FinanceActivityLog cubre la auditoria.
--   · enum motivos rechazo en tabla — se usa Python TextChoices + CHECK.
--
-- Idempotente. Ejecutable multiples veces sin error.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/D1_finance_payments_wizard.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. ALTER TABLE finance.payment
-- ---------------------------------------------------------------------
ALTER TABLE finance.payment
    ADD COLUMN IF NOT EXISTS counterparty_type           text  NULL,
    ADD COLUMN IF NOT EXISTS counterparty_id             uuid  NULL,
    ADD COLUMN IF NOT EXISTS direction                   text  NOT NULL DEFAULT 'IN',
    ADD COLUMN IF NOT EXISTS reconciled_with_bank        boolean NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rejection_reason            text  NULL,
    ADD COLUMN IF NOT EXISTS rejection_comment           text  NULL,
    ADD COLUMN IF NOT EXISTS source_mwt_account_id       uuid  NULL,
    ADD COLUMN IF NOT EXISTS destination_mwt_account_id  uuid  NULL;

-- CHECK: counterparty_type valido (dejamos NULL para retrocompat con
-- pagos legacy creados antes de este sprint).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_counterparty_type'
    ) THEN
        ALTER TABLE finance.payment
        ADD CONSTRAINT chk_payment_counterparty_type
        CHECK (counterparty_type IS NULL OR counterparty_type IN (
            'CLIENTE','PROVEEDOR','ADUANERO',
            'TRANSPORTISTA','AGENTE','DISTRIBUIDOR'
        ));
    END IF;
END$$;

-- CHECK: direction valido (default IN ya cubre filas existentes).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_direction'
    ) THEN
        ALTER TABLE finance.payment
        ADD CONSTRAINT chk_payment_direction
        CHECK (direction IN ('IN','OUT'));
    END IF;
END$$;

-- CHECK: rejection_reason valido (enum mirror Python TextChoices).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_rejection_reason'
    ) THEN
        ALTER TABLE finance.payment
        ADD CONSTRAINT chk_payment_rejection_reason
        CHECK (rejection_reason IS NULL OR rejection_reason IN (
            'REF_ERRONEA','MONTO_NO_COINCIDE','DUPLICADO',
            'COMPROBANTE_INVALIDO','FUERA_DE_PLAZO',
            'CONTRAPARTE_INCORRECTA','OTRO'
        ));
    END IF;
END$$;

-- CHECK: si rejection_reason='OTRO', rejection_comment NOT NULL + no vacio.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_rejection_comment_when_otro'
    ) THEN
        ALTER TABLE finance.payment
        ADD CONSTRAINT chk_payment_rejection_comment_when_otro
        CHECK (
            rejection_reason IS DISTINCT FROM 'OTRO'
            OR (rejection_comment IS NOT NULL
                AND length(trim(rejection_comment)) > 0)
        );
    END IF;
END$$;

-- CHECK: source XOR destination segun direction. Dejamos NULL/NULL valido
-- para pagos legacy o flujos manuales sin cuenta asociada todavia.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_account_per_direction'
    ) THEN
        ALTER TABLE finance.payment
        ADD CONSTRAINT chk_payment_account_per_direction
        CHECK (
            (direction = 'OUT' AND (source_mwt_account_id      IS NOT NULL OR source_mwt_account_id      IS NULL)
                              AND destination_mwt_account_id IS NULL)
            OR
            (direction = 'IN'  AND (destination_mwt_account_id IS NOT NULL OR destination_mwt_account_id IS NULL)
                              AND source_mwt_account_id      IS NULL)
            OR (source_mwt_account_id IS NULL AND destination_mwt_account_id IS NULL)
        );
    END IF;
END$$;

-- Indices (parciales sobre is_active = TRUE para mantener calidad).
CREATE INDEX IF NOT EXISTS idx_payment_counterparty
    ON finance.payment (counterparty_type, counterparty_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_payment_direction_estado
    ON finance.payment (direction, estado)
    WHERE is_active = TRUE;

-- Comentarios para auditoria y discovery futuro.
COMMENT ON COLUMN finance.payment.counterparty_type IS
    'Discriminator del tipo de contraparte: CLIENTE | PROVEEDOR | ADUANERO | TRANSPORTISTA | AGENTE | DISTRIBUIDOR. NULL = pago legacy sin contraparte clasificada.';
COMMENT ON COLUMN finance.payment.counterparty_id IS
    'UUID de la contraparte. FK logica a apps.clientes.cliente o apps.proveedores.proveedor segun counterparty_type.';
COMMENT ON COLUMN finance.payment.direction IS
    'IN = MWT cobra (entrante) | OUT = MWT paga (saliente). Default IN para backward-compat.';
COMMENT ON COLUMN finance.payment.reconciled_with_bank IS
    'Sub-flag de PENDIENTE_AI: false = reportado sin conciliar | true = conciliado en banco, esperando liberacion CEO.';
COMMENT ON COLUMN finance.payment.rejection_reason IS
    'Enum motivo de rechazo CEO. NULL si pago NO rechazado. Si OTRO, rejection_comment es obligatorio (CHECK).';
COMMENT ON COLUMN finance.payment.source_mwt_account_id IS
    'Cuenta MWT origen del pago (solo si direction=OUT). FK logica a finance.mwt_account.';
COMMENT ON COLUMN finance.payment.destination_mwt_account_id IS
    'Cuenta MWT destino del pago (solo si direction=IN). FK logica a finance.mwt_account.';


-- ---------------------------------------------------------------------
-- 2. CREATE TABLE finance.mwt_account
--    Cuentas bancarias propias de las legal entities MWT. CEO-ONLY.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.mwt_account (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operating_company_id  uuid NOT NULL,                       -- FK logica a clientes.cliente
    bank_name             text NOT NULL,
    account_number        text NOT NULL,
    account_alias         text NULL,                           -- nombre amigable ("Cuenta operativa USD CR")
    currency              text NOT NULL,
    country_iso2          text NOT NULL,
    swift_bic             text NULL,
    is_active             boolean NOT NULL DEFAULT TRUE,
    notes                 text NULL,
    created_by            uuid NULL,
    created_at            timestamptz NOT NULL DEFAULT NOW(),
    updated_at            timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (operating_company_id, account_number, currency)
);

-- CHECK: currency valida (enum minimal — extendible).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_mwt_account_currency'
    ) THEN
        ALTER TABLE finance.mwt_account
        ADD CONSTRAINT chk_mwt_account_currency
        CHECK (currency IN ('USD','COP','BRL','CRC','MXN','EUR','PEN','ARS','CLP','PYG','UYU'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_mwt_account_op_active
    ON finance.mwt_account (operating_company_id)
    WHERE is_active = TRUE;

COMMENT ON TABLE finance.mwt_account IS
    'Cuentas bancarias propias de las legal entities MWT. CEO-ONLY visibility. Multi-tenancy via operating_company_id (NO RLS, consistente con resto del repo).';


-- ---------------------------------------------------------------------
-- 3. Trigger updated_at en finance.mwt_account
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.fn_mwt_account_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mwt_account_updated_at ON finance.mwt_account;
CREATE TRIGGER trg_mwt_account_updated_at
    BEFORE UPDATE ON finance.mwt_account
    FOR EACH ROW EXECUTE FUNCTION finance.fn_mwt_account_updated_at();


COMMIT;

-- =====================================================================
-- Fin de D1_finance_payments_wizard.sql
-- =====================================================================
