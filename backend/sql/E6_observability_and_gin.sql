-- ═════════════════════════════════════════════════════════════════════
-- E6 · Sprint 2026-06-11 — Auditoría Fable5 (WAVE C/D)
-- 1) Observabilidad self-hosted (equivalente Sentry sin dependencia
--    externa): tabla de errores del cliente reportados por el frontend
--    (ErrorBoundary + window.onerror + unhandledrejection).
-- 2) Índices GIN/btree pendientes de los sprints 07/09/10.
-- Idempotente y guardado por information_schema (a prueba de drift).
-- ═════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.client_error_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  path        varchar(512),
  message     text,
  stack       text,
  user_agent  varchar(512),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_error_created
  ON analytics.client_error_log (created_at DESC);

-- GIN para el filtrado por scope de costos (sprints 07/09).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='transfers' AND table_name='cost_line'
                AND column_name='scope_json') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cost_line_scope_gin
               ON transfers.cost_line USING gin (scope_json)';
  END IF;
END $$;

-- Feed de notificaciones por fecha (sprint 10).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='notifications' AND table_name='notification_log'
                AND column_name='created_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notification_log_created
               ON notifications.notification_log (created_at DESC)';
  END IF;
END $$;
