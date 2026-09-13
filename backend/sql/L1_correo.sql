-- =====================================================================
-- L1 · Etapa 3 - Correo de extremo a extremo (schema `correo`)
--   correo.contacto   -> libreta de direcciones relevantes
--   correo.grupo      -> grupos operativos (Para/CC)
--   correo.estilo     -> perfil de estilo versionado (voz de Álvaro)
--   correo.mensaje    -> historial recibidos/enviados (dedup por message_id)
--   correo.adjunto    -> adjuntos de un mensaje
--   correo.envio      -> borradores/envíos salientes (ES + traducción)
-- Idempotente.
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS correo;

-- ── Libreta de contactos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correo.contacto (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(254) NOT NULL,
    nombre          VARCHAR(160),
    empresa         VARCHAR(160),
    marca           VARCHAR(120),
    funcion         VARCHAR(120),
    idioma          VARCHAR(8),
    idioma_source   VARCHAR(24),
    grupos          TEXT[]  NOT NULL DEFAULT '{}',
    notas           TEXT,
    perfil          JSONB   NOT NULL DEFAULT '{}'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacto_email_uniq ON correo.contacto (lower(email)) WHERE is_active;

-- ── Grupos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correo.grupo (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(48) NOT NULL UNIQUE,
    nombre      VARCHAR(160) NOT NULL,
    descripcion TEXT,
    emails      TEXT[] NOT NULL DEFAULT '{}',
    para        TEXT[] NOT NULL DEFAULT '{}',
    cc          TEXT[] NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Perfil de estilo (versionado, append) ───────────────────────────
CREATE TABLE IF NOT EXISTS correo.estilo (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version      INTEGER NOT NULL,
    contenido    TEXT NOT NULL,
    reglas       JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_id UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS estilo_version_uniq ON correo.estilo (version);

-- ── Mensajes (recibidos/enviados) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS correo.mensaje (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id       TEXT,
    thread_key       TEXT,
    folder           VARCHAR(96),
    direction        VARCHAR(3) NOT NULL DEFAULT 'IN',
    from_email       TEXT,
    from_name        TEXT,
    to_emails        TEXT[] NOT NULL DEFAULT '{}',
    cc_emails        TEXT[] NOT NULL DEFAULT '{}',
    subject          TEXT,
    sent_at          TIMESTAMPTZ,
    received_at      TIMESTAMPTZ,
    body_text        TEXT,
    body_html        TEXT,
    has_attachments  BOOLEAN NOT NULL DEFAULT FALSE,
    expediente_id    UUID,
    oc_id            UUID,
    proforma         TEXT,
    sap              TEXT,
    match_status     VARCHAR(16) NOT NULL DEFAULT 'POR_VINCULAR',
    match_reason     TEXT,
    is_read          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    source           VARCHAR(16) NOT NULL DEFAULT 'IMAP',
    raw_ref          TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT correo_mensaje_direction_chk CHECK (direction IN ('IN','OUT')),
    CONSTRAINT correo_mensaje_match_chk
        CHECK (match_status IN ('AUTO','VINCULADO','POR_VINCULAR','IGNORADO'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mensaje_message_id_uniq
    ON correo.mensaje (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mensaje_expediente_idx ON correo.mensaje (expediente_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS mensaje_match_idx      ON correo.mensaje (match_status)   WHERE is_active;
CREATE INDEX IF NOT EXISTS mensaje_sent_idx       ON correo.mensaje (sent_at DESC);

-- ── Adjuntos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correo.adjunto (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mensaje_id  UUID NOT NULL,
    filename    TEXT,
    mimetype    VARCHAR(160),
    size_bytes  BIGINT,
    storage_key TEXT,
    sha256      VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adjunto_mensaje_idx ON correo.adjunto (mensaje_id);

-- ── Envíos salientes (borrador -> enviado) ──────────────────────────
CREATE TABLE IF NOT EXISTS correo.envio (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expediente_id  UUID,
    oc_id          UUID,
    destinatarios  TEXT[] NOT NULL DEFAULT '{}',
    cc             TEXT[] NOT NULL DEFAULT '{}',
    bcc            TEXT[] NOT NULL DEFAULT '{}',
    subject        TEXT,
    body_es        TEXT,
    body_traducido TEXT,
    idioma         VARCHAR(8),
    estado         VARCHAR(16) NOT NULL DEFAULT 'BORRADOR',
    sent_at        TIMESTAMPTZ,
    message_id     TEXT,
    error          TEXT,
    adjuntos       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by_id  UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT correo_envio_estado_chk CHECK (estado IN ('BORRADOR','ENVIADO','ERROR'))
);
CREATE INDEX IF NOT EXISTS envio_expediente_idx ON correo.envio (expediente_id) WHERE TRUE;

-- ── Estilo base v1 (placeholder editable; no inventa reglas de negocio) ──
INSERT INTO correo.estilo (version, contenido, reglas)
SELECT 1,
       'Escribe en primera persona, tono profesional cercano, breve y directo. '
       || 'Firma habitual de Álvaro. No inventa compromisos ni precios.',
       '{"idioma_base":"es","primera_persona":true,"brevedad":"alta"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM correo.estilo WHERE version = 1);

COMMIT;
