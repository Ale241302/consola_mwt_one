-- ============================================================
-- MWT.ONE · B1_nodos_builder_artifacts.sql
-- Sprint 2026-05-11 · Fase 4 — Builder artifacts en nodos.
-- Agente responsable: [AG-DATABASE]
--
-- Paralela a expedientes.builder_artifact_instance (B0).
--
-- Diferencias clave con la del expediente:
--   1. Vinculada a un nodo (nodo_id) en lugar de a un expediente.
--   2. NO hay `stage` — los nodos no tienen máquina de estados.
--      Cualquier artefacto del Builder puede asociarse al nodo.
--   3. El mismo `template_id` puede repetirse libremente para un
--      mismo nodo (sin UNIQUE) — el CEO puede tener varias
--      proformas, varios contratos 3PL, varias fotos, etc.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP/CREATE TRIGGER.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS nodos;

CREATE TABLE IF NOT EXISTS nodos.builder_artifact_instance (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculo con el nodo (UUID plano, sin FK física — convención MWT).
    nodo_id              UUID         NOT NULL,

    -- Referencia al template del Builder (https://builder.muito.work).
    -- Se snapshotea el título por denormalización para evitar fetch
    -- extra en el listado.
    template_id          INTEGER      NOT NULL,
    template_title       TEXT         NOT NULL,

    -- Datos llenados por el usuario. Clave = field.id del structure_json.
    -- Para campos de archivo, el value es un array de objetos
    -- {url, name, size, mime} apuntando al storage (MinIO).
    data                 JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- Snapshot de la estructura del formulario al crear la instancia.
    -- Si el template cambia en el Builder después, el render del
    -- usuario en Consola se mantiene estable.
    structure_snapshot   JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- Auditoría
    created_by_id        UUID,
    created_by_name      VARCHAR(128),
    updated_by_id        UUID,
    updated_by_name      VARCHAR(128),

    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    publicado            BOOLEAN      NOT NULL DEFAULT FALSE,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────
-- (a) listado del nodo
CREATE INDEX IF NOT EXISTS nbai_nodo_idx
    ON nodos.builder_artifact_instance (nodo_id)
    WHERE is_active = TRUE;
-- (b) filtro por template
CREATE INDEX IF NOT EXISTS nbai_template_idx
    ON nodos.builder_artifact_instance (template_id);
-- (c) full-text search dentro de los datos del artefacto
CREATE INDEX IF NOT EXISTS nbai_data_gin
    ON nodos.builder_artifact_instance USING gin (data);
-- (d) soft-delete auditing
CREATE INDEX IF NOT EXISTS nbai_active_idx
    ON nodos.builder_artifact_instance (is_active);

-- ── Trigger updated_at ─────────────────────────────────
DROP TRIGGER IF EXISTS tg_nbai_upd ON nodos.builder_artifact_instance;
CREATE TRIGGER tg_nbai_upd
    BEFORE UPDATE ON nodos.builder_artifact_instance
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── Migración idempotente: visibilidad cliente ────────────
-- Sprint 2026-07-30 · Los artefactos de nodo pueden marcarse como
-- publicados para que los clientes B2B los vean en el detalle de
-- expediente. Staff interno (admin/manager/operator/...) los ve todos.
ALTER TABLE nodos.builder_artifact_instance
    ADD COLUMN IF NOT EXISTS publicado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS nbai_publicado_idx
    ON nodos.builder_artifact_instance (nodo_id, publicado)
    WHERE is_active = TRUE;

COMMENT ON TABLE nodos.builder_artifact_instance IS
    'Instancias de templates del Builder externo (builder.muito.work) '
    'asociadas a un nodo. Sprint 2026-05-11 fase 4. Tipos repetibles, '
    'sin enum de estado.';
