-- ============================================================
-- MWT.ONE · 96b_pipeline_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack del módulo
-- Pipeline (expedientes kanban + event_log + motor de fases).
--
-- Cubre tres gaps entre el frontend (ExpedienteKanban.jsx,
-- ExpedientePhaseWidget, pipeline.jsx) y el schema persistido:
--
--   1. pipeline.transicion_cat  · catálogo cerrado de transiciones
--      válidas entre fases (REGISTRO → PRODUCCION → PREPARACION →
--      DESPACHO → TRANSITO → EN_DESTINO → CERRADO). Garantiza que
--      el motor de fases NUNCA permita transiciones ilegales.
--
--   2. pipeline.event_log.idempotence_token  · columna +
--      unique partial index para bloquear duplicados cuando Celery
--      reintenta la emisión de un evento (misma OC, misma acción).
--
--   3. pipeline.event_log.phase_from / phase_to  · columnas para
--      acelerar el cálculo del semáforo `phase_signal` sin hacer
--      JOIN al agregado.
--
-- Arquitectura: CERO migraciones Django (solo SQL idempotente),
-- CERO foreign keys (UUIDs sin FK), aditivo.
-- Se puede correr N veces sin romper.
-- ============================================================

SET search_path = pipeline, public;

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función pipeline.touch_updated_at() ya existe
--    (creada en 94_pipeline_financiero_portal.sql). Re-creada
--    defensivamente por si el apply-order cambia.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'touch_updated_at' AND n.nspname = 'pipeline'
  ) THEN
    CREATE OR REPLACE FUNCTION pipeline.touch_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. pipeline.transicion_cat
--
--    Catálogo cerrado de transiciones legales del motor de fases.
--    Cada fila declara:
--      · (fase_from, fase_to)     · pareja ordenada permitida
--      · requiere_rol             · rol mínimo que puede ejecutarla
--      · requiere_documento       · artefacto obligatorio para cruzar
--      · is_rollback              · transición hacia atrás (excepcional)
--
--    Fases canónicas:
--      REGISTRO    · expediente creado a partir de OC
--      PRODUCCION  · proveedor manufacturando
--      PREPARACION · listo, esperando consolidación
--      DESPACHO    · en consolidación final / emitido BL
--      TRANSITO    · en tránsito marítimo/terrestre
--      EN_DESTINO  · llegó, pendiente de nacionalización/recepción
--      CERRADO     · entregado + conciliado
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline.transicion_cat (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    fase_from          VARCHAR(32)   NOT NULL,
    fase_to            VARCHAR(32)   NOT NULL,
    label              VARCHAR(128)  NOT NULL,
    requiere_rol       VARCHAR(32),
    requiere_documento VARCHAR(32),
    is_rollback        BOOLEAN       NOT NULL DEFAULT FALSE,
    orden              INTEGER       NOT NULL DEFAULT 100,
    is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_transicion_pair UNIQUE (fase_from, fase_to)
);

CREATE INDEX IF NOT EXISTS idx_transicion_from    ON pipeline.transicion_cat(fase_from);
CREATE INDEX IF NOT EXISTS idx_transicion_to      ON pipeline.transicion_cat(fase_to);
CREATE INDEX IF NOT EXISTS idx_transicion_active  ON pipeline.transicion_cat(is_active);

INSERT INTO pipeline.transicion_cat
    (fase_from, fase_to, label, requiere_rol, requiere_documento, is_rollback, orden) VALUES
    ('REGISTRO',    'PRODUCCION',  'Enviar a producción',       'ops',     'OC',             FALSE, 10),
    ('PRODUCCION',  'PREPARACION', 'Marcar lista para embarque','ops',     NULL,             FALSE, 20),
    ('PREPARACION', 'DESPACHO',    'Iniciar despacho',          'ops',     'PACKING_LIST',   FALSE, 30),
    ('DESPACHO',    'TRANSITO',    'En tránsito',               'ops',     'BL',             FALSE, 40),
    ('TRANSITO',    'EN_DESTINO',  'Arribo destino',            'ops',     NULL,             FALSE, 50),
    ('EN_DESTINO',  'CERRADO',     'Cerrar expediente',         'finance', 'FACTURA',        FALSE, 60),
    -- Rollbacks excepcionales (auditados):
    ('PRODUCCION',  'REGISTRO',    'Rollback a registro',       'admin',   NULL,             TRUE,  110),
    ('PREPARACION', 'PRODUCCION',  'Rollback a producción',     'admin',   NULL,             TRUE,  120),
    ('DESPACHO',    'PREPARACION', 'Rollback a preparación',    'admin',   NULL,             TRUE,  130),
    ('TRANSITO',    'DESPACHO',    'Rollback a despacho',       'admin',   NULL,             TRUE,  140),
    ('EN_DESTINO',  'TRANSITO',    'Rollback a tránsito',       'admin',   NULL,             TRUE,  150)
ON CONFLICT (fase_from, fase_to) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. pipeline.event_log  — idempotence_token + phase columns
--
--    idempotence_token: si Celery reintenta la emisión del mismo
--    evento, el segundo INSERT choca con el unique partial index y
--    el workflow puede hacer early-return (no-op seguro).
-- ────────────────────────────────────────────────────────────
ALTER TABLE pipeline.event_log
    ADD COLUMN IF NOT EXISTS idempotence_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS phase_from        VARCHAR(32),
    ADD COLUMN IF NOT EXISTS phase_to          VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evlog_idempotence_active
    ON pipeline.event_log (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_evlog_phase_from ON pipeline.event_log(phase_from) WHERE phase_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evlog_phase_to   ON pipeline.event_log(phase_to)   WHERE phase_to   IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- Fin 96b_pipeline_audit.sql
-- ============================================================
