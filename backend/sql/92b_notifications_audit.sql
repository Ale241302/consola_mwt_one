-- ============================================================
-- MWT.ONE · 92b_notifications_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack del módulo
-- Historial de Notificaciones (NotificationLog.jsx + CollectionBot).
--
-- Cubre cuatro gaps entre el frontend y el schema persistido:
--
--   1. notifications.grace_days_cat  · catálogo de ventanas de
--      gracia por tipo de cobranza (C1=0d, C2=3d, C3=7d, +legal).
--      Antes vivía hardcodeado en tasks/collection_tasks.py —
--      ahora es data editable por finance.
--
--   2. notifications.notification_log.idempotence_token  ·
--      columna + unique partial index para evitar doble-envío
--      cuando Celery reintenta (p.ej. un retry de C1 que se cruza
--      con el cron nocturno).
--
--   3. notifications.email_queue_log  · tabla de estado de la cola
--      de Celery (QUEUED / SENDING / SENT / FAILED / RETRY). Cada
--      fila de notification_log referencia su queue_id opcional
--      para trazar el ciclo de vida completo en Celery.
--
--   4. notifications.notification_log.retry_of / retry_of_token ·
--      soporte nativo para la acción POST /retry del frontend.
--
-- Arquitectura: CERO migraciones, CERO FKs, aditivo, idempotente.
-- ============================================================

SET search_path = notifications, public;

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función notifications.touch_updated_at()
--    ya existe (creada en 92_notifications.sql).
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'touch_updated_at' AND n.nspname = 'notifications'
  ) THEN
    CREATE OR REPLACE FUNCTION notifications.touch_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. notifications.grace_days_cat
--
--    Catálogo de ventanas de gracia para triggers de cobranza.
--    Finance puede editar estos días sin tocar código.
--
--    Canónico:
--      · C1     · 0  días (aviso pre-vencimiento o día del vto)
--      · C2     · 3  días (primer recordatorio post-vencimiento)
--      · C3     · 7  días (aviso de bloqueo comercial)
--      · LEGAL  · 15 días (escalamiento a legal)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications.grace_days_cat (
    codigo      VARCHAR(16)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    dias        INTEGER      NOT NULL DEFAULT 0,
    escalar_a   VARCHAR(16),
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO notifications.grace_days_cat(codigo, label, dias, escalar_a, orden) VALUES
    ('C1',     'Recordatorio C1',          0,  'C2',    10),
    ('C2',     'Aviso vencimiento C2',     3,  'C3',    20),
    ('C3',     'Bloqueo comercial C3',     7,  'LEGAL', 30),
    ('LEGAL',  'Escalamiento legal',      15,  NULL,    40)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. notifications.notification_log  — idempotence + retry + queue_id
-- ────────────────────────────────────────────────────────────
ALTER TABLE notifications.notification_log
    ADD COLUMN IF NOT EXISTS idempotence_token   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS retry_of            UUID,
    ADD COLUMN IF NOT EXISTS retry_of_token      VARCHAR(64),
    ADD COLUMN IF NOT EXISTS queue_id            UUID,
    ADD COLUMN IF NOT EXISTS celery_task_id      VARCHAR(128),
    ADD COLUMN IF NOT EXISTS bounced_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bounce_reason       VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nlog_idempotence_active
    ON notifications.notification_log (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_nlog_retry_of  ON notifications.notification_log(retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nlog_queue_id  ON notifications.notification_log(queue_id) WHERE queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nlog_celery    ON notifications.notification_log(celery_task_id) WHERE celery_task_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. notifications.email_queue_log
--
--    Estado de la cola de Celery para envíos de email. Una fila
--    por task de Celery. Cuando Celery entrega con éxito, el
--    `notification_log` correspondiente recibe su status final.
--
--    Estados:
--      · QUEUED    · encolada en Redis
--      · SENDING   · worker la tomó
--      · SENT      · SMTP ack recibido
--      · FAILED    · error terminal (sin más reintentos)
--      · RETRY     · falló, en backoff
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications.email_queue_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    celery_task_id      VARCHAR(128) UNIQUE,
    notification_id     UUID,                      -- notifications.notification_log.id (vínculo lógico)
    template_key        VARCHAR(64),
    recipient_email     VARCHAR(255),
    status              VARCHAR(16)  NOT NULL DEFAULT 'QUEUED',
    retries             INTEGER      NOT NULL DEFAULT 0,
    max_retries         INTEGER      NOT NULL DEFAULT 5,
    last_error          TEXT,
    next_retry_at       TIMESTAMPTZ,
    enqueued_at         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    duration_ms         INTEGER,
    payload             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eqlog_status        ON notifications.email_queue_log(status);
CREATE INDEX IF NOT EXISTS idx_eqlog_notification  ON notifications.email_queue_log(notification_id);
CREATE INDEX IF NOT EXISTS idx_eqlog_tpl_key       ON notifications.email_queue_log(template_key);
CREATE INDEX IF NOT EXISTS idx_eqlog_next_retry    ON notifications.email_queue_log(next_retry_at) WHERE status = 'RETRY';
CREATE INDEX IF NOT EXISTS idx_eqlog_enqueued      ON notifications.email_queue_log(enqueued_at DESC);

DROP TRIGGER IF EXISTS tg_eqlog_upd ON notifications.email_queue_log;
CREATE TRIGGER tg_eqlog_upd
    BEFORE UPDATE ON notifications.email_queue_log
    FOR EACH ROW EXECUTE FUNCTION notifications.touch_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. Reforzar trigger_cat con CRON_REPORT y BULK (no estaban)
-- ────────────────────────────────────────────────────────────
INSERT INTO notifications.trigger_cat(codigo, label) VALUES
    ('bulk_send',      'Envío masivo'),
    ('cron_report',    'Reporte programado'),
    ('retry',          'Reintento manual'),
    ('workflow_push_retry','Workflow push retry')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Fin 92b_notifications_audit.sql
-- ============================================================
