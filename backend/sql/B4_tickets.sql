-- =====================================================================
-- MWT.ONE · B4_tickets.sql
-- Agente responsable: [AG-01 · AG-DATABASE]
--
-- Modulo: Ticketing y Soporte Interno (LOTE_SM_TICKETS).
--
-- Crea schema `tickets` con 3 tablas:
--   1) tickets.ticket             — encabezado del ticket
--   2) tickets.ticket_message     — hilo tipo chat
--   3) tickets.ticket_attachment  — adjuntos polimorficos (ticket o message)
--
-- Reglas MWT respetadas:
--   · CERO FKs fisicas — todos los vinculos por UUID plano.
--   · Soft-delete (is_active) en cabecera + mensajes.
--   · Trigger updated_at compartido (tg_set_updated_at).
--   · CHECKs NOT VALID para no romper restores legacy.
--   · Adjuntos referencian MinIO via file_object_key (no se guardan blobs).
--
-- Tambien seedea 2 plantillas Jinja2 en email_templates.template
-- (template_key 'ticket_admin_alert' y 'ticket_user_confirmation').
-- =====================================================================


-- ────────────────────────────────────────────────────────────
-- 0. Schema
-- ────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS tickets;


-- ────────────────────────────────────────────────────────────
-- 1. tickets.ticket
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets.ticket (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Usuario creador (core.users.id, sin FK fisica)
    user_id         UUID         NOT NULL,
    user_email      VARCHAR(255),                -- snapshot al crear (sobrevive a borrados)
    user_full_name  VARCHAR(255),                -- snapshot al crear

    -- Contexto donde se abrio el flotante (path / vista actual)
    context_url     VARCHAR(512),

    -- Motivo del ticket (enum). El catalogo MWT vive en
    -- tickets.reason_cat (mas abajo) — aqui guardamos el codigo.
    reason          VARCHAR(32)  NOT NULL DEFAULT 'OTRO',

    -- Cuerpo libre escrito por el usuario.
    description     TEXT         NOT NULL,

    -- Estado del flujo. Catalogo en tickets.status_cat.
    --   ABIERTO     → recien creado, nadie lo ha tomado
    --   EN_REVISION → el admin esta trabajando en el
    --   RESUELTO    → admin propone solucion (todavia editable)
    --   FINALIZADO  → cerrado por admin → INMUTABLE (back rechaza writes)
    status          VARCHAR(16)  NOT NULL DEFAULT 'ABIERTO',

    -- Auditoria de la transicion final
    finalized_at    TIMESTAMPTZ,
    finalized_by_id UUID,

    -- Tiempo de primera respuesta del staff (para dashboard).
    first_response_at TIMESTAMPTZ,

    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_user_idx
    ON tickets.ticket (user_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ticket_status_idx
    ON tickets.ticket (status) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ticket_created_at_idx
    ON tickets.ticket (created_at DESC) WHERE is_active = TRUE;


-- ────────────────────────────────────────────────────────────
-- 2. tickets.ticket_message
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets.ticket_message (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    ticket_id     UUID         NOT NULL,                     -- → tickets.ticket.id
    sender_id     UUID         NOT NULL,                     -- → core.users.id
    sender_email  VARCHAR(255),                              -- snapshot
    sender_role   VARCHAR(32),                               -- 'admin' | 'cliente' | …

    -- Contenido del mensaje (texto). Adjuntos viven aparte.
    content       TEXT         NOT NULL,

    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msg_ticket_idx
    ON tickets.ticket_message (ticket_id, created_at)
    WHERE is_active = TRUE;


-- ────────────────────────────────────────────────────────────
-- 3. tickets.ticket_attachment
--    Polimorfico: vincula a un ticket (ticket_id) O a un mensaje
--    (message_id). El backend valida que se setee exactamente uno.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets.ticket_attachment (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    ticket_id       UUID,
    message_id      UUID,

    -- Storage MinIO (S3-compatible)
    file_object_key TEXT         NOT NULL,           -- key dentro del bucket
    file_name       VARCHAR(255) NOT NULL,           -- nombre original
    file_size_bytes INTEGER,
    file_mime       VARCHAR(96),                     -- application/pdf, image/png, …

    -- Tipo logico del archivo (filtrado a PDF / DOCX / JPG / PNG)
    file_kind       VARCHAR(8)   NOT NULL DEFAULT 'OTHER',

    uploaded_by_id  UUID,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS att_ticket_idx
    ON tickets.ticket_attachment (ticket_id)
    WHERE is_active = TRUE AND ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS att_message_idx
    ON tickets.ticket_attachment (message_id)
    WHERE is_active = TRUE AND message_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 4. Catalogos de UI (motivos + estados)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets.reason_cat (
    codigo    VARCHAR(32) PRIMARY KEY,
    label_es  VARCHAR(96) NOT NULL,
    label_en  VARCHAR(96),
    orden     INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO tickets.reason_cat (codigo, label_es, label_en, orden) VALUES
    ('MEJORA',     'Mejoras de funcionamiento', 'Functional improvements', 10),
    ('BUG',        'Reporte de bug',            'Bug report',              20),
    ('SOPORTE_OP', 'Soporte operativo',         'Operational support',     30),
    ('FACTURACION','Duda de facturacion',       'Billing question',        40),
    ('OTRO',       'Otro',                      'Other',                   90)
ON CONFLICT (codigo) DO NOTHING;


CREATE TABLE IF NOT EXISTS tickets.status_cat (
    codigo          VARCHAR(16) PRIMARY KEY,
    label_es        VARCHAR(64) NOT NULL,
    label_en        VARCHAR(64),
    color           VARCHAR(16),
    orden           INTEGER NOT NULL DEFAULT 100,
    -- Solo el admin puede setear los estados con admin_only=TRUE.
    admin_only      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Tickets en estado_final=TRUE rechazan cualquier mutacion.
    estado_final    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO tickets.status_cat (codigo, label_es, label_en, color, orden, admin_only, estado_final) VALUES
    ('ABIERTO',     'Abierto',     'Open',         'amber',  10, FALSE, FALSE),
    ('EN_REVISION', 'En revision', 'In review',    'blue',   20, TRUE,  FALSE),
    ('RESUELTO',    'Resuelto',    'Resolved',     'green',  30, TRUE,  FALSE),
    ('FINALIZADO',  'Finalizado',  'Finalized',    'gray',   40, TRUE,  TRUE)
ON CONFLICT (codigo) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 5. Triggers updated_at
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
        CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
        BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS tg_ticket_updated_at ON tickets.ticket;
CREATE TRIGGER tg_ticket_updated_at
    BEFORE UPDATE ON tickets.ticket
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_ticket_msg_updated_at ON tickets.ticket_message;
CREATE TRIGGER tg_ticket_msg_updated_at
    BEFORE UPDATE ON tickets.ticket_message
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();


-- ────────────────────────────────────────────────────────────
-- 6. CHECKs (NOT VALID)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_ticket_status_valid'
                     AND conrelid = 'tickets.ticket'::regclass) THEN
        ALTER TABLE tickets.ticket
            ADD CONSTRAINT ck_ticket_status_valid
            CHECK (status IN ('ABIERTO','EN_REVISION','RESUELTO','FINALIZADO'))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_ticket_reason_valid'
                     AND conrelid = 'tickets.ticket'::regclass) THEN
        ALTER TABLE tickets.ticket
            ADD CONSTRAINT ck_ticket_reason_valid
            CHECK (reason IN ('MEJORA','BUG','SOPORTE_OP','FACTURACION','OTRO'))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_ticket_description_not_blank'
                     AND conrelid = 'tickets.ticket'::regclass) THEN
        ALTER TABLE tickets.ticket
            ADD CONSTRAINT ck_ticket_description_not_blank
            CHECK (length(btrim(description)) > 0)
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_msg_content_not_blank'
                     AND conrelid = 'tickets.ticket_message'::regclass) THEN
        ALTER TABLE tickets.ticket_message
            ADD CONSTRAINT ck_msg_content_not_blank
            CHECK (length(btrim(content)) > 0)
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_att_polymorphic_xor'
                     AND conrelid = 'tickets.ticket_attachment'::regclass) THEN
        ALTER TABLE tickets.ticket_attachment
            ADD CONSTRAINT ck_att_polymorphic_xor
            CHECK (
                (ticket_id IS NOT NULL AND message_id IS NULL) OR
                (ticket_id IS NULL     AND message_id IS NOT NULL)
            )
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_att_kind_valid'
                     AND conrelid = 'tickets.ticket_attachment'::regclass) THEN
        ALTER TABLE tickets.ticket_attachment
            ADD CONSTRAINT ck_att_kind_valid
            CHECK (file_kind IN ('PDF','DOCX','JPG','PNG','OTHER'))
            NOT VALID;
    END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 7. Seed de plantillas Jinja2 (email_templates.template).
--    El render real lo hace apps.tickets.email_render usando estas
--    filas. Si la app email_templates aun no esta inicializada en
--    este entorno (sin schema), saltamos sin romper.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
    has_email_templates BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'email_templates' AND table_name = 'template'
    ) INTO has_email_templates;

    IF has_email_templates THEN
        -- 7.1 Alerta interna a info@mwt.one
        INSERT INTO email_templates.template (
            id, name, template_key, language, brand,
            subject_template, body_template, variables_meta,
            status, is_active
        )
        SELECT
            gen_random_uuid(),
            'Alerta nuevo ticket (interno)',
            'ticket_admin_alert',
            'ES',
            'GLOBAL',
            '[Tickets MWT] Nuevo ticket #{{ ticket_id_short }} — {{ reason_label }}',
            $body$
<!doctype html>
<html><head><meta charset="utf-8"><title>Nuevo ticket</title></head>
<body style="font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0F1B3D;background:#F8FAFC;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748B;margin-bottom:6px;">CONSOLA · TICKETS</div>
    <h1 style="font-family:'General Sans','Plus Jakarta Sans',Arial,sans-serif;font-size:22px;color:#0B1E3A;margin:0 0 16px;">
      Nuevo ticket #{{ ticket_id_short }}
    </h1>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">
      <tr><td style="color:#64748B;padding:6px 0;width:140px;">Usuario</td>
          <td style="font-weight:600;">{{ user_full_name | default(user_email) }}</td></tr>
      <tr><td style="color:#64748B;padding:6px 0;">Email</td>
          <td>{{ user_email }}</td></tr>
      <tr><td style="color:#64748B;padding:6px 0;">Motivo</td>
          <td><span style="display:inline-block;padding:3px 10px;background:rgba(0,178,134,0.10);color:#00B286;border-radius:6px;font-weight:600;">{{ reason_label }}</span></td></tr>
      <tr><td style="color:#64748B;padding:6px 0;">Vista</td>
          <td><code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#0B1E3A;">{{ context_url | default('—') }}</code></td></tr>
      <tr><td style="color:#64748B;padding:6px 0;">Creado</td>
          <td>{{ created_at }}</td></tr>
    </table>
    <div style="margin-top:18px;padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;line-height:1.5;white-space:pre-wrap;">{{ description }}</div>
    <a href="{{ ticket_admin_url }}" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#0B1E3A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Abrir ticket</a>
  </div>
  <div style="text-align:center;color:#94A3B8;font-size:11px;margin-top:14px;">consola.mwt.one · Tickets MWT</div>
</body></html>
$body$,
            '[{"name":"ticket_id_short"},{"name":"reason_label"},{"name":"user_full_name"},{"name":"user_email"},{"name":"context_url"},{"name":"created_at"},{"name":"description"},{"name":"ticket_admin_url"}]'::jsonb,
            'PUBLISHED',
            TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM email_templates.template
            WHERE template_key = 'ticket_admin_alert' AND is_active = TRUE
        );

        -- 7.2 Confirmacion al usuario
        INSERT INTO email_templates.template (
            id, name, template_key, language, brand,
            subject_template, body_template, variables_meta,
            status, is_active
        )
        SELECT
            gen_random_uuid(),
            'Confirmacion ticket creado (usuario)',
            'ticket_user_confirmation',
            'ES',
            'GLOBAL',
            'Hemos recibido tu ticket #{{ ticket_id_short }}',
            $body$
<!doctype html>
<html><head><meta charset="utf-8"><title>Ticket recibido</title></head>
<body style="font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0F1B3D;background:#F8FAFC;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748B;margin-bottom:6px;">MWT · SOPORTE</div>
    <h1 style="font-family:'General Sans','Plus Jakarta Sans',Arial,sans-serif;font-size:22px;color:#0B1E3A;margin:0 0 12px;">
      Hola {{ user_full_name | default(user_email) }},
    </h1>
    <p style="font-size:14px;line-height:1.55;margin:0 0 14px;">
      Recibimos tu ticket <strong>#{{ ticket_id_short }}</strong> y nuestro equipo de soporte ya lo esta revisando. Te avisaremos por este mismo correo cuando haya novedades.
    </p>
    <div style="margin:16px 0;padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;">
      <div style="color:#64748B;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Motivo</div>
      <div style="font-weight:600;">{{ reason_label }}</div>
      <div style="color:#64748B;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;margin:10px 0 6px;">Tu mensaje</div>
      <div style="white-space:pre-wrap;">{{ description }}</div>
    </div>
    <a href="{{ ticket_user_url }}" style="display:inline-block;padding:10px 18px;background:#00B286;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Ver mi ticket</a>
    <p style="font-size:12px;color:#94A3B8;margin-top:18px;">Si tu duda es urgente respondenos a este correo y un humano lo leera.</p>
  </div>
  <div style="text-align:center;color:#94A3B8;font-size:11px;margin-top:14px;">© Muito Work Trading · consola.mwt.one</div>
</body></html>
$body$,
            '[{"name":"ticket_id_short"},{"name":"reason_label"},{"name":"user_full_name"},{"name":"user_email"},{"name":"description"},{"name":"ticket_user_url"}]'::jsonb,
            'PUBLISHED',
            TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM email_templates.template
            WHERE template_key = 'ticket_user_confirmation' AND is_active = TRUE
        );
    END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 8. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE tickets.ticket IS
    'Cabecera de ticket de soporte interno. Crece con tickets.ticket_message (chat) y tickets.ticket_attachment (adjuntos en MinIO).';
COMMENT ON COLUMN tickets.ticket.context_url IS
    'Path o vista donde el usuario abrio el flotante (ej. /productos/abc-123). Se usa para que el admin abra la pantalla relevante.';
COMMENT ON COLUMN tickets.ticket.status IS
    'ABIERTO -> EN_REVISION -> RESUELTO -> FINALIZADO (terminal, inmutable).';
COMMENT ON TABLE tickets.ticket_attachment IS
    'Adjunto polimorfico: o pertenece a un ticket (descripcion inicial) o a un mensaje (chat). El backend valida el XOR.';


-- =====================================================================
-- FIN B4_tickets.sql
-- =====================================================================
