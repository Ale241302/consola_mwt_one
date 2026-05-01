-- ============================================================
-- MWT.ONE · B0_builder_artifacts.sql
-- Agente responsable: [AG-DATABASE]
--
-- Tabla `expedientes.builder_artifact_instance`
-- ----------------------------------------------------------------
-- Instancias de artefactos llenados por el usuario, anclados al
-- expediente y a una etapa del flujo (REGISTRO → CERRADO). La
-- estructura del formulario (campos, secciones) viene del
-- Builder externo (https://builder.muito.work) y se snapshotea
-- en `structure_snapshot` para estabilidad histórica.
--
-- ⚠ Esta tabla NO reemplaza `expedientes.artifact_instances`
-- (que está cableada al wizard OCR + Paperless + ART-01..ART-11).
-- Coexiste para soportar el catálogo de Builder.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS / DROP-CREATE
-- triggers.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS expedientes;

-- ────────────────────────────────────────────────────────────
-- Tabla principal
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.builder_artifact_instance (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculo con el expediente
    expediente_id        UUID         NOT NULL,                    -- FK lógico → expedientes.expediente

    -- Etapa del flujo a la que pertenece la instancia
    -- (NO el estado actual del expediente — la etapa donde se ancla)
    stage                VARCHAR(32)  NOT NULL
        CHECK (stage IN (
            'REGISTRO','PRODUCCION','PREPARACION','DESPACHO',
            'TRANSITO','EN_DESTINO','CERRADO'
        )),

    -- Referencia al template del Builder (sólo metadata; el Builder es
    -- la fuente de la verdad de la plantilla pero la guardamos por
    -- denormalización para evitar fetch extra en el listado)
    template_id          INTEGER      NOT NULL,                    -- builder.artefactos.id
    template_title       TEXT         NOT NULL,                    -- snapshot del título al crear

    -- Datos llenados (clave: field.id del structure_json)
    data                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Estructura del formulario congelada en el momento de crear
    -- (sections → columns → fields). Garantiza render consistente
    -- aunque el template del Builder cambie después.
    structure_snapshot   JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- Auditoría
    created_by_id        UUID,                                     -- users.user.id (FK lógico)
    created_by_name      VARCHAR(128),                             -- snapshot legible
    updated_by_id        UUID,
    updated_by_name      VARCHAR(128),

    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- Índices
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS bai_exp_idx
    ON expedientes.builder_artifact_instance (expediente_id);

CREATE INDEX IF NOT EXISTS bai_exp_stage_idx
    ON expedientes.builder_artifact_instance (expediente_id, stage)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS bai_template_idx
    ON expedientes.builder_artifact_instance (template_id);

CREATE INDEX IF NOT EXISTS bai_data_gin
    ON expedientes.builder_artifact_instance USING gin (data);

-- ────────────────────────────────────────────────────────────
-- Trigger updated_at — reusa función global tg_set_updated_at()
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tg_bai_upd ON expedientes.builder_artifact_instance;

CREATE TRIGGER tg_bai_upd
    BEFORE UPDATE ON expedientes.builder_artifact_instance
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Verificación rápida (informativa):
--   \d expedientes.builder_artifact_instance
--   SELECT COUNT(*) FROM expedientes.builder_artifact_instance;
-- ────────────────────────────────────────────────────────────
