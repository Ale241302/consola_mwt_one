-- =====================================================================
-- MWT.ONE · 91i_transfers_legal_documents.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v3 · 2026-04-30
-- Documentos legales por motivo de transferencia (NATIONALIZATION,
-- EXPORT, DISTRIBUTION, CONSIGNMENT) — IDs UUID-text que apuntan a
-- expedientes.artifact_instances o equivalente, sin FK física (R6).
--
-- Mapeo motivo → documento:
--   · NATIONALIZATION → supplier_invoice_document_id (Factura Comercial Proveedor)
--   · EXPORT          → export_invoice_document_id   (Factura de Exportación)
--                       freight_quote_document_id    (Cotización de Flete · ART-06)
--   · DISTRIBUTION    → export_invoice_document_id   (Factura Comercial MWT · ART-09)
--   · CONSIGNMENT     → remission_guide_document_id  (Guía de Remisión / Traslado)
--
-- Reglas MWT respetadas:
--   · Idempotente (ADD COLUMN IF NOT EXISTS).
--   · Sin FK física — solo VARCHAR(36) que guarda el UUID en texto.
--   · La validación lógica vive en el serializer DRF (transfers/serializers.py).
-- =====================================================================

ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS supplier_invoice_document_id   VARCHAR(36),
    ADD COLUMN IF NOT EXISTS export_invoice_document_id     VARCHAR(36),
    ADD COLUMN IF NOT EXISTS freight_quote_document_id      VARCHAR(36),
    ADD COLUMN IF NOT EXISTS remission_guide_document_id    VARCHAR(36);

COMMENT ON COLUMN transfers.transferencia.supplier_invoice_document_id IS
    'NATIONALIZATION · Factura Comercial del Proveedor (acompaña al DUA). '
    'UUID en texto plano; sin FK por R6.';
COMMENT ON COLUMN transfers.transferencia.export_invoice_document_id IS
    'EXPORT · Factura de Exportación. DISTRIBUTION · Factura Comercial '
    'MWT (ART-09). UUID en texto plano; sin FK por R6.';
COMMENT ON COLUMN transfers.transferencia.freight_quote_document_id IS
    'EXPORT · Cotización de Flete (ART-06). UUID en texto plano; sin FK.';
COMMENT ON COLUMN transfers.transferencia.remission_guide_document_id IS
    'CONSIGNMENT · Guía de Remisión / Traslado. UUID en texto plano; sin FK.';

-- Índices parciales sobre documentos pendientes (NULL) — query útil:
-- "qué transferencias de NACIONALIZACION están sin factura del proveedor".
CREATE INDEX IF NOT EXISTS idx_trf_pending_supplier_inv
    ON transfers.transferencia (legal_context)
    WHERE legal_context = 'NATIONALIZATION'
      AND supplier_invoice_document_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_trf_pending_remission_guide
    ON transfers.transferencia (legal_context)
    WHERE legal_context = 'CONSIGNMENT'
      AND remission_guide_document_id IS NULL;


-- =====================================================================
-- 2. Enriquecer ai.skill con campos de routing LLM
-- =====================================================================
-- Skills hoy tienen: id, codigo, nombre, system_prompt, category, etc.
-- Falta el modelo activo (gpt-5-nano, claude-sonnet-4-6, etc.) y el
-- proveedor (openai, anthropic, …). Lo agregamos como columnas nuevas;
-- ya existe `metadata` JSONB pero queremos columnas tipadas para que
-- el endpoint /ai/skills/<key>/ lo serialice de forma estable.
--
-- skill_key  → alias UNIQUE de codigo (compat con la API que pide
--              /api/ai/skills/ocr-transfers/).
-- display_name → alias de nombre (compat con FE).
-- model_id   → id LLM canónico (ej. "gpt-5-nano", "claude-sonnet-4-6").
-- model_provider_id → "openai" / "anthropic" / "google" / "local".

ALTER TABLE ai.skill
    ADD COLUMN IF NOT EXISTS skill_key          VARCHAR(64),
    ADD COLUMN IF NOT EXISTS display_name       VARCHAR(160),
    ADD COLUMN IF NOT EXISTS model_id           VARCHAR(64),
    ADD COLUMN IF NOT EXISTS model_provider_id  VARCHAR(32);

COMMENT ON COLUMN ai.skill.skill_key IS
    'Alias estable del skill para URLs públicas (slug). Ej: ocr-transfers, '
    'ocr-aduanas. Si está NULL, se sincroniza con LOWER(codigo).';
COMMENT ON COLUMN ai.skill.display_name IS
    'Nombre legible para UI (alias de `nombre`).';
COMMENT ON COLUMN ai.skill.model_id IS
    'ID canónico del modelo LLM activo. Ej: gpt-5-nano, claude-sonnet-4-6.';
COMMENT ON COLUMN ai.skill.model_provider_id IS
    'Proveedor del modelo. Valores típicos: openai, anthropic, google, local.';

-- Backfill inicial: si skill_key/display_name vienen NULL, copiar
-- desde codigo / nombre.
UPDATE ai.skill
   SET skill_key    = COALESCE(skill_key, LOWER(REPLACE(codigo, '_', '-'))),
       display_name = COALESCE(display_name, nombre)
 WHERE skill_key IS NULL OR display_name IS NULL;

-- Índice UNIQUE parcial sobre skill_key (solo activos) para garantizar
-- lookup determinístico desde el endpoint /ai/skills/<skill_key>/.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_skill_key_active
    ON ai.skill (skill_key)
    WHERE is_active = TRUE;


-- =====================================================================
-- 3. Seed: skill OCR_TRANSFERS (lectura de DUAs y facturas en transfers)
-- =====================================================================
-- Idempotente — solo inserta si no existe.
INSERT INTO ai.skill (
    id, codigo, skill_key, nombre, display_name, descripcion,
    system_prompt, category, icon, accent_color,
    model_id, model_provider_id,
    requires_files, supports_multimodal,
    tags, metadata,
    is_active, created_at, updated_at
)
SELECT
    gen_random_uuid(), 'SKILL_OCR_TRANSFERS', 'ocr-transfers',
    'OCR · Transferencias (DUA + Facturas)', 'Motor OCR · Transferencias',
    'Lee DUAs aduanales, facturas comerciales y guías de remisión '
    'para extraer costos, números de documento y otros campos legales '
    'de transferencias inter-nodo.',
    E'Eres un extractor estructurado para documentos de transferencias.\n\n'
    || E'Lees el archivo (PDF, imagen o Excel) y devuelves un JSON ESTRICTO.\n\n'
    || E'Esquema esperado:\n'
    || E'{\n'
    || E'  "document_kind": "DUA" | "INVOICE" | "FREIGHT_QUOTE" | "REMISSION_GUIDE",\n'
    || E'  "document_number": "...",\n'
    || E'  "issued_date":    "YYYY-MM-DD",\n'
    || E'  "currency":       "USD" | "PEN" | ...,\n'
    || E'  "amounts": {\n'
    || E'    "subtotal":    <decimal o null>,\n'
    || E'    "freight":     <decimal o null>,\n'
    || E'    "insurance":   <decimal o null>,\n'
    || E'    "duty_dai":    <decimal o null>,\n'
    || E'    "iva":         <decimal o null>,\n'
    || E'    "total":       <decimal o null>\n'
    || E'  },\n'
    || E'  "raw_text": "<transcripción literal max 2000 chars>"\n'
    || E'}\n\n'
    || E'Reglas:\n'
    || E'  1. CERO INVENTOS. Si un campo no aparece, omitirlo.\n'
    || E'  2. Devolver SOLO JSON, sin markdown ni texto adicional.\n'
    || E'  3. Los amounts en moneda del documento (no convertir).',
    'vision', 'truck', '#481EE3',
    'gpt-5-nano', 'openai',
    TRUE, TRUE,
    '["transfers","dua","ocr","customs","liquidation"]'::jsonb,
    '{"editable_by":"CEO_ADMIN","critical":true,"impact":"company-wide cost calculation"}'::jsonb,
    TRUE, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM ai.skill WHERE skill_key = 'ocr-transfers'
);

-- =====================================================================
-- FIN 91i_transfers_legal_documents.sql
-- =====================================================================
