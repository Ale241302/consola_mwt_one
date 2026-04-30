-- =====================================================================
-- MWT.ONE · 91j_skill_ocr_aduanas_content.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v3.5 · 2026-04-30
--
-- Carga el contenido oficial del skill SKILL_OCR_ADUANAS según el spec
-- entregado por el CEO. El skill anterior (creado en 91i con skill_key
-- 'ocr-transfers') se renombra a 'ocr-aduanas' (trigger_word canónico
-- según el ARCH_AGENT_PRINCIPLES).
--
-- Idempotente:
--   1. UPDATE el row existente si lo encuentra por skill_key='ocr-transfers'
--      o codigo='SKILL_OCR_TRANSFERS'.
--   2. Si NO existe → INSERT nuevo desde cero.
--   3. Tras correr este script, queda exactamente UN registro con
--      skill_key='ocr-aduanas'.
-- =====================================================================

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
        || E'  IDLE → PARSING_DOC → EXTRACTING → PROPOSING → CONSOLIDATED.\n\n'
        || E'AUTONOMÍA: PROPONE (no ejecuta cambios sin aprobación humana).\n'
        || E'ESCALATION: CEO directo si el documento es ilegible, multi-divisa\n'
        || E'no reconocida o los montos totales no cuadran con el desglose.';
BEGIN
    -- 1) Buscar el row existente del skill (cualquiera de los identificadores)
    SELECT id INTO target_id
      FROM ai.skill
     WHERE skill_key IN ('ocr-aduanas', 'ocr-transfers')
        OR codigo    IN ('SKILL_OCR_ADUANAS', 'SKILL_OCR_TRANSFERS')
     ORDER BY updated_at DESC
     LIMIT 1;

    IF target_id IS NOT NULL THEN
        -- 2) UPDATE in-place (preserva uuid + foreign references lógicas).
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
                                   || 'transferencias inter-nodos (motivos: '
                                   || 'Nacionalización y Reexportación).',
               system_prompt     = new_prompt,
               category          = 'vision',
               icon              = 'truck',
               accent_color      = '#481EE3',
               model_id          = COALESCE(model_id, 'gpt-5-nano'),
               model_provider_id = COALESCE(model_provider_id, 'openai'),
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
        RAISE NOTICE 'Skill % actualizado a SKILL_OCR_ADUANAS (skill_key=ocr-aduanas).', target_id;
    ELSE
        -- 3) INSERT desde cero
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

-- Verificación
SELECT
    skill_key,
    codigo,
    display_name,
    model_id,
    model_provider_id,
    LEFT(system_prompt, 100) AS prompt_preview,
    metadata->>'status' AS status,
    metadata->>'autonomy_ceiling' AS autonomy
  FROM ai.skill
 WHERE skill_key IN ('ocr-aduanas', 'ocr-transfers');

-- =====================================================================
-- FIN 91j_skill_ocr_aduanas_content.sql
-- =====================================================================
