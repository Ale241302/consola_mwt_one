-- =====================================================================
-- MWT.ONE · 91k_skill_ocr_aduanas_idempotent_full.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v3.5 · 2026-04-30
--
-- Script TODO-EN-UNO (idempotente) que garantiza el estado correcto
-- del skill SKILL_OCR_ADUANAS sin importar si 91i / 91j ya corrieron.
--
-- 1. ALTER ai.skill — columnas skill_key, display_name, model_id,
--    model_provider_id (IF NOT EXISTS).
-- 2. Backfill skill_key = LOWER(REPLACE(codigo,'_','-')) cuando NULL.
-- 3. UNIQUE INDEX uq_ai_skill_key_active.
-- 4. UPSERT del row SKILL_OCR_ADUANAS / skill_key='ocr-aduanas' con el
--    system_prompt oficial (CEO spec del 2026-04-30).
--
-- Tras correrlo, el endpoint /api/ai/skills/ocr-aduanas/ devuelve 200
-- y el sidebar "Motor OCR · IA" del wizard de transferencias muestra
-- el skill activo en lugar de "Skill no configurado".
-- =====================================================================

-- ── 1. Columnas ────────────────────────────────────────────────────
ALTER TABLE ai.skill
    ADD COLUMN IF NOT EXISTS skill_key          VARCHAR(64),
    ADD COLUMN IF NOT EXISTS display_name       VARCHAR(160),
    ADD COLUMN IF NOT EXISTS model_id           VARCHAR(64),
    ADD COLUMN IF NOT EXISTS model_provider_id  VARCHAR(32);

-- ── 2. Backfill skill_key/display_name si vienen NULL ──────────────
UPDATE ai.skill
   SET skill_key    = COALESCE(skill_key, LOWER(REPLACE(codigo, '_', '-'))),
       display_name = COALESCE(display_name, nombre)
 WHERE skill_key IS NULL OR display_name IS NULL;

-- ── 3. Índice UNIQUE parcial (solo activos) ────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_skill_key_active
    ON ai.skill (skill_key)
    WHERE is_active = TRUE;

-- ── 4. UPSERT del row SKILL_OCR_ADUANAS ────────────────────────────
DO $$
DECLARE
    target_id UUID;
    new_prompt TEXT := E'Eres el Agente Especialista en Aduanas de MWT.ONE. Tu objetivo es leer el texto extraído de una Declaración Única Aduanera (DUA) o liquidación de impuestos y estructurar los cobros operativos.\n\n'
        || E'REGLAS DE EXTRACCIÓN:\n\n'
        || E'1. Identifica los 4 rubros principales. Busca específicamente montos correspondientes a:\n'
        || E'   - Derechos Arancelarios a la Importación (DAI / Aranceles).\n'
        || E'   - Impuestos al Valor Agregado (IVA / IGV / ICMS).\n'
        || E'   - Gastos de Almacenaje / Bodegaje aduanero.\n'
        || E'   - Honorarios de Agencia Aduanal o Manejo.\n\n'
        || E'2. Mapeo Estricto. Clasifica cada rubro encontrado en uno de los siguientes cost_type válidos:\n'
        || E'   arancel_aduana, impuesto_iva, almacenaje_fiscal, flete_internacional, maniobras, seguro.\n\n'
        || E'3. Detección de Moneda. Identifica la moneda del documento (USD, CRC, BRL, PEN, etc.). Si hay múltiples monedas, extrae el monto en la moneda original facturada.\n\n'
        || E'4. Cero Alucinaciones. Si un rubro no aparece explícitamente en el texto, omítelo. NO lo inventes ni asumas que es cero.\n\n'
        || E'FORMATO DE SALIDA:\n'
        || E'Debes devolver ÚNICAMENTE un JSON válido con la siguiente estructura, sin texto adicional ni formato markdown:\n\n'
        || E'{\n'
        || E'  "document_reference": "Número del DUA o Factura encontrado",\n'
        || E'  "cost_lines": [\n'
        || E'    {\n'
        || E'      "cost_type": "arancel_aduana",\n'
        || E'      "amount": 1250.50,\n'
        || E'      "currency": "USD",\n'
        || E'      "description": "DAI liquidado según línea 14"\n'
        || E'    }\n'
        || E'  ],\n'
        || E'  "confidence": "HIGH|MEDIUM|LOW",\n'
        || E'  "gaps_detected": ["Falta página 2", "Moneda ilegible en línea de almacenaje"]\n'
        || E'}\n\n'
        || E'STATE MACHINE (referencia interna · MWT.ONE):\n'
        || E'  IDLE -> PARSING_DOC -> EXTRACTING -> PROPOSING -> CONSOLIDATED.\n\n'
        || E'AUTONOMÍA: PROPONE (no ejecuta cambios sin aprobación humana).\n'
        || E'ESCALATION: CEO directo si el documento es ilegible, multi-divisa\n'
        || E'no reconocida o los montos totales no cuadran con el desglose.';
BEGIN
    -- Buscar cualquier row del skill aduanas/transfers (compat).
    SELECT id INTO target_id
      FROM ai.skill
     WHERE skill_key IN ('ocr-aduanas', 'ocr-transfers')
        OR codigo    IN ('SKILL_OCR_ADUANAS', 'SKILL_OCR_TRANSFERS')
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1;

    IF target_id IS NOT NULL THEN
        UPDATE ai.skill
           SET codigo            = 'SKILL_OCR_ADUANAS',
               skill_key         = 'ocr-aduanas',
               nombre            = 'OCR · Aduanas (DUA + Liquidaciones)',
               display_name      = 'Motor OCR · Aduanas',
               descripcion       = 'Motor de extracción estructurada para documentos '
                                   || 'de internación aduanera (DUA, liquidaciones, '
                                   || 'facturas de agencia aduanal). Transforma PDFs '
                                   || 'crudos en cost_lines incrementales para el '
                                   || 'cálculo automatizado del Landed Cost en '
                                   || 'transferencias inter-nodos.',
               system_prompt     = new_prompt,
               category          = 'vision',
               icon              = 'truck',
               accent_color      = '#481EE3',
               model_id          = COALESCE(NULLIF(model_id, ''),     'gpt-5-nano'),
               model_provider_id = COALESCE(NULLIF(model_provider_id, ''), 'openai'),
               requires_files    = TRUE,
               supports_multimodal = TRUE,
               tags              = '["transfers","dua","ocr","customs","liquidation","aduanas","arancel","iva"]'::jsonb,
               metadata          = '{
                                      "version": "1.0",
                                      "status": "SHADOW",
                                      "trigger_word": "ocr-aduanas",
                                      "autonomy_ceiling": "PROPONE",
                                      "domain": "Operaciones",
                                      "kb_refs": ["ENT_OPS_TRANSFERS", "ENT_COMERCIAL_COSTOS"],
                                      "escalation_policy": "CEO directo si documento ilegible / multi-divisa no reconocida / totales no cuadran",
                                      "editable_by": "CEO_ADMIN",
                                      "critical": true,
                                      "impact": "company-wide cost calculation",
                                      "valid_cost_types": ["arancel_aduana","impuesto_iva","almacenaje_fiscal","flete_internacional","maniobras","seguro"],
                                      "events": ["ocr_aduanas.started","ocr_aduanas.proposed","ocr_aduanas.failed"],
                                      "state_machine": ["IDLE","PARSING_DOC","EXTRACTING","PROPOSING","CONSOLIDATED"],
                                      "learning_consolidation": {
                                        "fact_correction":   "Usuario edita monto extraído (formato no leído bien)",
                                        "skill_refinement":  "Usuario cambia cost_type (vocabulario del agente aduanal)",
                                        "promotion_threshold": 5
                                      }
                                    }'::jsonb,
               is_active         = TRUE,
               updated_at        = NOW()
         WHERE id = target_id;
        RAISE NOTICE 'Skill % actualizado a SKILL_OCR_ADUANAS / ocr-aduanas.', target_id;
    ELSE
        INSERT INTO ai.skill (
            id, codigo, skill_key, nombre, display_name, descripcion,
            system_prompt, category, icon, accent_color,
            model_id, model_provider_id,
            requires_files, supports_multimodal,
            tags, metadata,
            is_active, created_at, updated_at
        )
        VALUES (
            gen_random_uuid(), 'SKILL_OCR_ADUANAS', 'ocr-aduanas',
            'OCR · Aduanas (DUA + Liquidaciones)', 'Motor OCR · Aduanas',
            'Motor de extracción estructurada para documentos de internación aduanera.',
            new_prompt,
            'vision', 'truck', '#481EE3',
            'gpt-5-nano', 'openai',
            TRUE, TRUE,
            '["transfers","dua","ocr","customs","liquidation","aduanas","arancel","iva"]'::jsonb,
            '{
                "version": "1.0",
                "status": "SHADOW",
                "trigger_word": "ocr-aduanas",
                "autonomy_ceiling": "PROPONE",
                "domain": "Operaciones",
                "editable_by": "CEO_ADMIN",
                "critical": true
             }'::jsonb,
            TRUE, NOW(), NOW()
        );
        RAISE NOTICE 'Skill SKILL_OCR_ADUANAS creado desde cero.';
    END IF;
END $$;

-- ── 5. Verificación ────────────────────────────────────────────────
SELECT
    skill_key,
    codigo,
    display_name,
    model_id,
    model_provider_id,
    is_active,
    metadata->>'status'           AS status,
    metadata->>'autonomy_ceiling' AS autonomy,
    metadata->>'trigger_word'     AS trigger_word,
    LENGTH(system_prompt)         AS prompt_chars
  FROM ai.skill
 WHERE skill_key = 'ocr-aduanas';

-- =====================================================================
-- FIN 91k_skill_ocr_aduanas_idempotent_full.sql
-- =====================================================================
