-- =====================================================================
-- MWT.ONE · A0_ai_module.sql
-- Agente responsable: [AG-DATABASE]
--
-- Schema `ai` — AI Hub módulo conversacional MWT.ONE
--   · Catálogos de gobernanza:    agent · skill · instruction
--   · Conversación:               thread · thread_context · message
--   · Adjuntos & telemetría:      attachment · usage_log
--
-- Convenciones MWT:
--   · CERO Foreign Keys (vínculos por UUID lógico).
--   · Idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING).
--   · is_active, created_at, updated_at en cada fila.
--   · Trigger ai.touch_updated_at compartido por todas las tablas.
--   · Catálogos seed (10 agentes base, 10 skills base, 5 instrucciones).
--
-- Sufijo "A0" para que el entrypoint lo aplique DESPUÉS de 99_seed.sql
-- (en ASCII '9' < 'A').
-- =====================================================================
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS ai;
SET search_path = ai, public;

-- ────────────────────────────────────────────────────────────
-- Trigger genérico touch_updated_at
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ai' AND p.proname = 'touch_updated_at'
    ) THEN
        EXECUTE $f$
            CREATE OR REPLACE FUNCTION ai.touch_updated_at()
            RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $body$;
        $f$;
    END IF;
END $$;

-- ============================================================
-- 1. ai.agent  — Catálogo de Agentes (personalidad + rol)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.agent (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                VARCHAR(48)  NOT NULL,
    nombre                VARCHAR(120) NOT NULL,
    rol                   VARCHAR(64)  NOT NULL,
    -- rol ∈ { architect, finance, legal, ops, marketing, hr, research, dev, qa, analyst }
    descripcion           TEXT,
    prompt_base           TEXT         NOT NULL,
    autonomy_ceiling      VARCHAR(16)  NOT NULL DEFAULT 'suggest',
    -- autonomy_ceiling ∈ { read, suggest, draft, execute, deploy }
    avatar_emoji          VARCHAR(8)   DEFAULT '🤖',
    accent_color          VARCHAR(16)  DEFAULT '#00B286',
    model_default         VARCHAR(48)  NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_tokens_default    INTEGER      NOT NULL DEFAULT 4096,
    temperature_default   NUMERIC(3,2) NOT NULL DEFAULT 0.30,
    tags                  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by_id         UUID,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_codigo_active
    ON ai.agent (codigo) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_agent_rol         ON ai.agent (rol);
CREATE INDEX IF NOT EXISTS idx_ai_agent_active      ON ai.agent (is_active);
CREATE INDEX IF NOT EXISTS idx_ai_agent_tags_gin    ON ai.agent USING gin (tags);

DROP TRIGGER IF EXISTS tg_ai_agent_upd ON ai.agent;
CREATE TRIGGER tg_ai_agent_upd
    BEFORE UPDATE ON ai.agent
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 2. ai.skill  — Catálogo de Skills (habilidad + system_prompt)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.skill (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                VARCHAR(48)  NOT NULL,
    nombre                VARCHAR(120) NOT NULL,
    descripcion           TEXT,
    system_prompt         TEXT         NOT NULL,
    category              VARCHAR(48),
    -- category ∈ { reasoning, writing, analysis, coding, search, math, vision, audio, custom }
    icon                  VARCHAR(48)  DEFAULT 'sparkles',
    -- nombre del icono (lucide-react)
    accent_color          VARCHAR(16)  DEFAULT '#1DE394',
    requires_files        BOOLEAN      NOT NULL DEFAULT FALSE,
    supports_multimodal   BOOLEAN      NOT NULL DEFAULT FALSE,
    tags                  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by_id         UUID,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_skill_codigo_active
    ON ai.skill (codigo) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_skill_category    ON ai.skill (category);
CREATE INDEX IF NOT EXISTS idx_ai_skill_active      ON ai.skill (is_active);
CREATE INDEX IF NOT EXISTS idx_ai_skill_tags_gin    ON ai.skill USING gin (tags);

DROP TRIGGER IF EXISTS tg_ai_skill_upd ON ai.skill;
CREATE TRIGGER tg_ai_skill_upd
    BEFORE UPDATE ON ai.skill
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 3. ai.instruction  — Directrices globales / políticas
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.instruction (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                VARCHAR(64)  NOT NULL,
    titulo                VARCHAR(160) NOT NULL,
    contenido             TEXT         NOT NULL,
    scope                 VARCHAR(32)  NOT NULL DEFAULT 'global',
    -- scope ∈ { global, domain, role, agent }
    domain                VARCHAR(32),
    -- domain ∈ { finance, legal, ops, marketing, dev, ... } (cuando scope='domain')
    target_agent_id       UUID,
    -- (cuando scope='agent') referencia lógica a ai.agent.id
    target_role           VARCHAR(32),
    prioridad             INTEGER      NOT NULL DEFAULT 100,
    -- 0 = máxima; 1000 = mínima
    auto_inject           BOOLEAN      NOT NULL DEFAULT TRUE,
    -- TRUE → siempre se inyecta en system_prompt; FALSE → opcional
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by_id         UUID,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_instruction_codigo_active
    ON ai.instruction (codigo) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_instruction_scope     ON ai.instruction (scope);
CREATE INDEX IF NOT EXISTS idx_ai_instruction_domain    ON ai.instruction (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_instruction_priority  ON ai.instruction (prioridad);
CREATE INDEX IF NOT EXISTS idx_ai_instruction_auto      ON ai.instruction (auto_inject) WHERE auto_inject = TRUE;

DROP TRIGGER IF EXISTS tg_ai_instruction_upd ON ai.instruction;
CREATE TRIGGER tg_ai_instruction_upd
    BEFORE UPDATE ON ai.instruction
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 4. ai.thread  — Hilos de conversación
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.thread (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo                VARCHAR(200) NOT NULL DEFAULT 'Nuevo chat',
    user_id               UUID         NOT NULL,
    -- user_id = portal.mwt_user.id (vínculo lógico)
    user_email            VARCHAR(255),
    summary               TEXT,
    -- resumen autogenerado del hilo (cron / on-demand)
    pinned                BOOLEAN      NOT NULL DEFAULT FALSE,
    archived              BOOLEAN      NOT NULL DEFAULT FALSE,
    last_message_at       TIMESTAMPTZ,
    message_count         INTEGER      NOT NULL DEFAULT 0,
    total_tokens_in       BIGINT       NOT NULL DEFAULT 0,
    total_tokens_out      BIGINT       NOT NULL DEFAULT 0,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_thread_user           ON ai.thread (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_thread_user_active    ON ai.thread (user_id, is_active, archived);
CREATE INDEX IF NOT EXISTS idx_ai_thread_last_msg       ON ai.thread (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ai_thread_pinned         ON ai.thread (pinned) WHERE pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_thread_metadata_gin   ON ai.thread USING gin (metadata);

DROP TRIGGER IF EXISTS tg_ai_thread_upd ON ai.thread;
CREATE TRIGGER tg_ai_thread_upd
    BEFORE UPDATE ON ai.thread
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 5. ai.thread_context  — Tabla puente (anclaje multi-agent/skill)
--
-- Permite anclar múltiples Agentes / Skills / Instrucciones a un hilo.
-- ref_type identifica el catálogo destino; ref_id es el UUID lógico.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.thread_context (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID         NOT NULL,
    ref_type              VARCHAR(16)  NOT NULL,
    -- ref_type ∈ { agent, skill, instruction }
    ref_id                UUID         NOT NULL,
    ref_label             VARCHAR(160),
    -- snapshot del label al momento del anclaje (para historial)
    position              INTEGER      NOT NULL DEFAULT 0,
    pinned_by_id          UUID,
    pinned_at             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_threadctx_thread_ref_active
    ON ai.thread_context (thread_id, ref_type, ref_id)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_threadctx_thread      ON ai.thread_context (thread_id);
CREATE INDEX IF NOT EXISTS idx_ai_threadctx_ref         ON ai.thread_context (ref_type, ref_id);

DROP TRIGGER IF EXISTS tg_ai_threadctx_upd ON ai.thread_context;
CREATE TRIGGER tg_ai_threadctx_upd
    BEFORE UPDATE ON ai.thread_context
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 6. ai.message  — Mensajes del chat
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.message (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID         NOT NULL,
    sender                VARCHAR(16)  NOT NULL,
    -- sender ∈ { user, assistant, system, tool }
    user_id               UUID,
    role_label            VARCHAR(64),
    -- "Usuario", "Asistente", "Agente: Finanzas", "Skill: Analista"
    content               TEXT         NOT NULL DEFAULT '',
    content_format        VARCHAR(16)  NOT NULL DEFAULT 'text',
    -- content_format ∈ { text, markdown, html, json }
    attachments           JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- snapshot ligero (id, filename, mime, size_kb) — la verdad está en ai.attachment
    context_snapshot      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- snapshot del contexto activo al enviar este mensaje
    -- {agents:[{id,codigo,nombre}], skills:[...], instructions:[...]}
    model                 VARCHAR(48),
    tokens_in             INTEGER,
    tokens_out            INTEGER,
    latency_ms            INTEGER,
    finish_reason         VARCHAR(32),
    -- finish_reason ∈ { end_turn, stop_sequence, max_tokens, tool_use, error }
    error_code            VARCHAR(64),
    error_message         TEXT,
    parent_message_id     UUID,
    -- para threading (regenerar respuesta, edit user message)
    idempotence_token     VARCHAR(64),
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_message_thread        ON ai.message (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_message_user          ON ai.message (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_message_sender        ON ai.message (sender);
CREATE INDEX IF NOT EXISTS idx_ai_message_parent        ON ai.message (parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_message_idempotence_active
    ON ai.message (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_message_attachments_gin
    ON ai.message USING gin (attachments);

DROP TRIGGER IF EXISTS tg_ai_message_upd ON ai.message;
CREATE TRIGGER tg_ai_message_upd
    BEFORE UPDATE ON ai.message
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 7. ai.attachment  — Adjuntos persistentes
--
-- Storage real (MinIO/S3/disk) referenciado por storage_url.
-- Para PDFs/TXT guardamos el texto extraído en extracted_text.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.attachment (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID,
    message_id            UUID,
    user_id               UUID         NOT NULL,
    filename              VARCHAR(255) NOT NULL,
    mime_type             VARCHAR(96)  NOT NULL,
    size_bytes            BIGINT       NOT NULL DEFAULT 0,
    storage_backend       VARCHAR(16)  NOT NULL DEFAULT 'local',
    -- storage_backend ∈ { local, minio, s3, gcs }
    storage_url           TEXT         NOT NULL,
    storage_bucket        VARCHAR(96),
    storage_key           VARCHAR(512),
    sha256                VARCHAR(64),
    extracted_text        TEXT,
    extracted_chars       INTEGER,
    extracted_pages       INTEGER,
    is_image              BOOLEAN      NOT NULL DEFAULT FALSE,
    image_width           INTEGER,
    image_height          INTEGER,
    processing_status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
    -- processing_status ∈ { pending, processing, ready, failed }
    processing_error      TEXT,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_attachment_thread     ON ai.attachment (thread_id);
CREATE INDEX IF NOT EXISTS idx_ai_attachment_message    ON ai.attachment (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_attachment_user       ON ai.attachment (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_attachment_status     ON ai.attachment (processing_status);
CREATE INDEX IF NOT EXISTS idx_ai_attachment_sha256     ON ai.attachment (sha256) WHERE sha256 IS NOT NULL;

DROP TRIGGER IF EXISTS tg_ai_attachment_upd ON ai.attachment;
CREATE TRIGGER tg_ai_attachment_upd
    BEFORE UPDATE ON ai.attachment
    FOR EACH ROW EXECUTE FUNCTION ai.touch_updated_at();

-- ============================================================
-- 8. ai.usage_log  — Telemetría append-only por llamada al LLM
-- ============================================================
CREATE TABLE IF NOT EXISTS ai.usage_log (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID,
    message_id            UUID,
    user_id               UUID,
    provider              VARCHAR(16)  NOT NULL DEFAULT 'anthropic',
    -- provider ∈ { anthropic, openai, google, mistral, local }
    model                 VARCHAR(48)  NOT NULL,
    operation             VARCHAR(24)  NOT NULL DEFAULT 'chat',
    -- operation ∈ { chat, embedding, vision, audio, completion }
    tokens_in             INTEGER      NOT NULL DEFAULT 0,
    tokens_out            INTEGER      NOT NULL DEFAULT 0,
    latency_ms            INTEGER,
    cost_usd              NUMERIC(12,6) DEFAULT 0,
    success               BOOLEAN      NOT NULL DEFAULT TRUE,
    error_code            VARCHAR(64),
    error_message         TEXT,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- append-only: NO updated_at, NO trigger.

CREATE INDEX IF NOT EXISTS idx_ai_usage_thread          ON ai.usage_log (thread_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_message         ON ai.usage_log (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user            ON ai.usage_log (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model           ON ai.usage_log (model);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created         ON ai.usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_success_failed  ON ai.usage_log (success, created_at DESC) WHERE success = FALSE;

-- ============================================================
-- SEEDS — Catálogos base (idempotente)
-- ============================================================

-- ── 10 Agentes base ───────────────────────────────────────────
INSERT INTO ai.agent (codigo, nombre, rol, descripcion, prompt_base, autonomy_ceiling, avatar_emoji, accent_color, model_default, tags) VALUES
('arch-mwt',     'Arquitecto MWT',       'architect', 'Arquitecto ejecutor de la KB MWT/Rana Walk.',
    'Eres el Arquitecto Ejecutor de la KB MWT.ONE. Construyes, corriges y ensamblas documentos siguiendo las 6 reglas y la taxonomía de 8 tipos. Nunca inventas datos: dato ausente = [PENDIENTE — NO INVENTAR]. Respondes en español salvo que el usuario pida otro idioma. Tech names, marcas y labels de talla nunca se traducen.',
    'draft', '🏛️', '#481EE3', 'claude-sonnet-4-6', '["mwt","arquitectura","kb"]'::jsonb),

('finance',      'Analista Financiero',  'finance',   'Analista financiero senior con foco en cashflow y aging.',
    'Eres un analista financiero senior de MWT.ONE. Tu prioridad es la salud del cashflow operativo. Cuando muestres números, agrupa por moneda. Identifica riesgos de liquidez antes que oportunidades. Pides datos cuando faltan en lugar de asumir.',
    'suggest', '💰', '#1DE394', 'claude-sonnet-4-6', '["finance","cashflow","aging"]'::jsonb),

('legal',        'Asesor Legal',         'legal',     'Asesor legal corporativo enfocado en B2B y contratos internacionales.',
    'Eres asesor legal corporativo de MWT.ONE con experiencia en comercio internacional, B2B y compliance. Citas la base normativa cuando aplica. Eres conservador frente a riesgo legal y siempre recomiendas revisión humana antes de firmar.',
    'suggest', '⚖️', '#3083FE', 'claude-sonnet-4-6', '["legal","compliance","contratos"]'::jsonb),

('ops',          'Coordinador OPS',      'ops',       'Coordinador de operaciones / pipeline de expedientes.',
    'Eres coordinador de operaciones de MWT.ONE. Conoces la state machine de expedientes (REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO) y las transiciones válidas. Identificas bloqueos y propones acciones correctivas.',
    'execute', '📦', '#00B286', 'claude-sonnet-4-6', '["ops","pipeline","expedientes"]'::jsonb),

('marketing',    'Estratega Marketing',  'marketing', 'Estratega de marketing B2B y go-to-market.',
    'Eres estratega de marketing B2B de Rana Walk. Hablas en métricas (CAC, LTV, funnel). Diferencias entre awareness, consideration y decision. Adaptas el tono según el segmento de cliente.',
    'draft', '📣', '#1EE3D7', 'claude-sonnet-4-6', '["marketing","b2b","funnel"]'::jsonb),

('hr',           'People Ops',           'hr',        'People Ops / talento y cultura.',
    'Eres People Ops de MWT.ONE. Cuidas la cultura, la transparencia y la salud psicológica del equipo. Sugieres prácticas concretas (1-on-1, retrospectivas) en lugar de generalidades.',
    'suggest', '🧑‍💼', '#481EE3', 'claude-haiku-4-5', '["hr","cultura","people"]'::jsonb),

('research',     'Investigador',         'research',  'Investigador de mercados y benchmarks.',
    'Eres investigador de mercados con foco en e-commerce, calzado deportivo y comercio internacional Asia↔LATAM. Citas fuentes verificables. Distingues hechos de opiniones.',
    'read', '🔍', '#3083FE', 'claude-sonnet-4-6', '["research","benchmarks","mercados"]'::jsonb),

('dev',          'Senior Developer',     'dev',       'Senior developer Django/React/Postgres.',
    'Eres senior developer del stack MWT.ONE: Django + DRF + Postgres + React + Tailwind. Sigues las convenciones MWT: cero FK (UUIDs lógicos), Meta.managed=False, schema-qualified db_table, idempotencia en SQL. Cuando muestras código, lo entregas completo y funcional.',
    'draft', '💻', '#1DE394', 'claude-sonnet-4-6', '["dev","django","react"]'::jsonb),

('qa',           'QA Reviewer',          'qa',        'QA reviewer técnico — busca bordes y casos límite.',
    'Eres QA reviewer técnico. Tu trabajo es encontrar lo que se rompe: edge cases, condiciones de carrera, casos vacíos, validaciones faltantes. Sé directo: si hay un bug, dilo.',
    'suggest', '🧪', '#1EE3D7', 'claude-sonnet-4-6', '["qa","testing","review"]'::jsonb),

('analyst',      'Data Analyst',         'analyst',   'Analista de datos con foco en SQL y dashboards.',
    'Eres data analyst de MWT.ONE. Trabajas sobre los schemas existentes (expedientes, cobros, inventario, transfers, dashboard). Antes de proponer un análisis, validas que las columnas existan. Prefieres queries SQL idempotentes.',
    'execute', '📊', '#00B286', 'claude-sonnet-4-6', '["analyst","sql","dashboard"]'::jsonb)
ON CONFLICT DO NOTHING;

-- ── 10 Skills base ────────────────────────────────────────────
INSERT INTO ai.skill (codigo, nombre, descripcion, system_prompt, category, icon, accent_color, requires_files, supports_multimodal, tags) VALUES
('reasoning-chain',  'Cadena de razonamiento', 'Razonamiento paso a paso explícito antes de responder.',
    'Antes de responder, expón tu cadena de razonamiento paso a paso entre <thinking>...</thinking>. Luego, fuera de esos tags, da la respuesta final clara y accionable.',
    'reasoning', 'brain', '#481EE3', FALSE, FALSE, '["chain-of-thought","reasoning"]'::jsonb),

('summarize',        'Resumen ejecutivo',      'Resume documentos largos en formato ejecutivo.',
    'Resume el contenido en formato ejecutivo: TL;DR (1 párrafo), Hallazgos clave (3-5 bullets), Riesgos (2-3 bullets), Próximos pasos (2-3 bullets). Sé conciso. Cita pasajes literales solo cuando sean críticos.',
    'writing', 'file-text', '#3083FE', FALSE, FALSE, '["summary","executive"]'::jsonb),

('extract-data',     'Extracción de datos',    'Extrae datos estructurados de PDFs/imágenes.',
    'Extrae todos los datos estructurados del documento adjunto. Devuelve JSON válido con keys descriptivas en snake_case. Si un valor no está presente, usa null (nunca inventes).',
    'analysis', 'database', '#1DE394', TRUE, TRUE, '["extract","ocr","structured"]'::jsonb),

('code-review',      'Code review',            'Revisa código y propone mejoras concretas.',
    'Revisa el código adjunto. Identifica: (1) bugs reales, (2) edge cases no manejados, (3) violaciones de convenciones MWT (FK, idempotencia, etc.), (4) mejoras de legibilidad. Para cada hallazgo, cita el número de línea.',
    'coding', 'code', '#00B286', TRUE, FALSE, '["code","review","quality"]'::jsonb),

('translate-es-en',  'Traducción ES↔EN',       'Traducción profesional español-inglés en ambas direcciones.',
    'Traduce el contenido manteniendo el tono y registro originales. Tech names, marcas y labels de talla NUNCA se traducen. Si hay ambigüedad, ofrece dos versiones.',
    'writing', 'languages', '#1EE3D7', FALSE, FALSE, '["translate","es","en"]'::jsonb),

('compare-docs',     'Comparar documentos',    'Diff conceptual entre dos documentos.',
    'Recibes dos documentos. Identifica diferencias materiales (no cosméticas) y agrupa por: (a) cambios de fondo, (b) cambios de forma, (c) ambigüedades. Devuelve tabla markdown.',
    'analysis', 'git-compare', '#481EE3', TRUE, FALSE, '["diff","compare"]'::jsonb),

('math-checker',     'Verificador matemático', 'Recalcula y valida cualquier afirmación numérica.',
    'Recalcula cada afirmación numérica del input. Para cada cálculo: muestra los operandos, la operación, el resultado. Marca con ✗ los que no cuadran y propone el valor correcto.',
    'math', 'calculator', '#1DE394', FALSE, FALSE, '["math","verify"]'::jsonb),

('vision-describe',  'Descripción de imágenes','Describe imágenes en detalle para accesibilidad y análisis.',
    'Describe la imagen adjunta con detalle: composición, elementos, texto visible, colores dominantes. Si es un screenshot técnico, identifica la UI y los datos visibles.',
    'vision', 'image', '#3083FE', TRUE, TRUE, '["vision","accessibility","ocr-light"]'::jsonb),

('search-web',       'Búsqueda web',           'Investiga en la web y cita fuentes.',
    'Investiga el tema usando búsquedas web. Cita 3+ fuentes (URL + fecha de publicación). Distingue hechos verificados de opiniones. Si la información cambió recientemente, advierte la volatilidad.',
    'search', 'globe', '#00B286', FALSE, FALSE, '["web","search","sources"]'::jsonb),

('rewrite-tone',     'Reescribir tono',        'Reescribe texto adaptando el tono solicitado.',
    'Reescribe el texto preservando el contenido pero adaptando el tono al solicitado por el usuario (formal, casual, técnico, comercial, etc.). Mantén la estructura y longitud aproximada.',
    'writing', 'pen-tool', '#1EE3D7', FALSE, FALSE, '["rewrite","tone","style"]'::jsonb)
ON CONFLICT DO NOTHING;

-- ── 5 Instrucciones globales base ────────────────────────────
INSERT INTO ai.instruction (codigo, titulo, contenido, scope, prioridad, auto_inject) VALUES
('GLOBAL-IDENTITY',
    'Identidad MWT.ONE',
    'Eres parte del AI Hub de MWT.ONE / Rana Walk. Trabajas dentro de la consola interna B2B. El usuario es típicamente equipo interno o cliente B2B con acceso scopeado. Mantén un tono profesional pero cálido. Responde en español salvo que el usuario pida otro idioma. Tech names, marcas y labels de talla NUNCA se traducen.',
    'global', 0, TRUE),

('GLOBAL-NO-INVENT',
    'No inventar datos',
    'NUNCA inventes datos. Si te falta información para responder con precisión, di "[PENDIENTE — necesito X dato]" y pide al usuario el dato faltante. Es preferible una respuesta incompleta y honesta a una respuesta completa pero inventada.',
    'global', 1, TRUE),

('GLOBAL-CITATIONS',
    'Citaciones de fuentes',
    'Cuando uses información de un archivo adjunto, cita textualmente el fragmento entre comillas y referencia el nombre del archivo. Cuando uses información de una búsqueda web, incluye URL y fecha.',
    'global', 10, TRUE),

('GLOBAL-SECURITY',
    'Seguridad y privacidad',
    'No reveles credenciales, claves API, tokens ni hashes de password. Si el usuario te pide algo que requiere acceso elevado (ejecutar SQL, deploy, mover dinero), responde con el plan pero pide confirmación explícita antes de ejecutar.',
    'global', 5, TRUE),

('GLOBAL-FORMAT',
    'Formato de respuesta',
    'Estructura tus respuestas: (1) respuesta directa primero, (2) detalles después, (3) próximos pasos al final cuando aplique. Usa markdown solo cuando agregue claridad (tablas, código, listas verdaderamente paralelas).',
    'global', 50, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verificación rápida (informativa):
--   SELECT 'agents' AS t, COUNT(*) FROM ai.agent UNION ALL
--   SELECT 'skills',       COUNT(*) FROM ai.skill UNION ALL
--   SELECT 'instructions', COUNT(*) FROM ai.instruction;
-- Esperado: 10 / 10 / 5
-- ============================================================
-- Fin A0_ai_module.sql
-- ============================================================
