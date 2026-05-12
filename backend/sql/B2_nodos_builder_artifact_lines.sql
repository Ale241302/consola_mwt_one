-- ============================================================
-- MWT.ONE · B2_nodos_builder_artifact_lines.sql
-- Sprint 2026-05-11 · Fase 5 — Líneas (expediente, producto, talla, qty)
--                                  asociadas a un artefacto de nodo.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (palabras del CEO):
--   Cuando agrego un artefacto a un nodo (ej. una Proforma), debo
--   decir A QUÉ EXPEDIENTES aplica y QUÉ LÍNEAS DEL INVENTARIO cubre,
--   incluyendo cantidades por talla. Si para una talla 37 tengo 10 u
--   asignadas al nodo, puedo tomar 5 para esta proforma. La próxima
--   vez que agregue otra proforma (mismo template) sólo veré 5 u
--   disponibles. Si agrego un BL (otro template), vuelvo a ver 10 u
--   porque el descuento es POR TEMPLATE.
--
-- Diseño:
--   · Append-only: cada confirmación inserta filas; nada se UPDATE.
--   · is_active=FALSE para borrar (preserva auditoría).
--   · Sin UNIQUE — múltiples filas para el mismo (instance, prod, talla)
--     suman su qty. Esto permite "splits" en sub-asignaciones.
--   · Cero FK física (sigue convención MWT — todos los join_id son UUID
--     plano, validados por el backend).
--
-- Descuento por template (lógica en el endpoint, no en SQL):
--   Para template T, instancia que se está creando, el saldo disponible
--   de una línea (expediente, producto, talla) es:
--      qty_asignada_al_nodo(linea)
--    - SUM(qty del builder_artifact_line de instancias activas del
--          mismo template, EXCEPTO la instancia actual)
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP/CREATE TRIGGER.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS nodos;

CREATE TABLE IF NOT EXISTS nodos.builder_artifact_line (
    id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK lógico a nodos.builder_artifact_instance (sin REFERENCES — convención MWT).
    builder_artifact_instance_id  UUID         NOT NULL,
    -- Denormalizamos nodo_id para queries directas por nodo.
    nodo_id                       UUID         NOT NULL,
    expediente_id                 UUID         NOT NULL,
    producto_id                   UUID         NOT NULL,
    talla                         VARCHAR(16),
    qty                           INTEGER      NOT NULL CHECK (qty > 0),
    notas                         TEXT,
    created_by_id                 UUID,
    is_active                     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Índices ────────────────────────────────────────────
-- (a) Query principal: líneas de UNA instancia.
CREATE INDEX IF NOT EXISTS nbal_instance_idx
    ON nodos.builder_artifact_line (builder_artifact_instance_id)
    WHERE is_active = TRUE;
-- (b) Descuento por template — necesitamos joinear contra
--     builder_artifact_instance via instance_id, pero también filtrar
--     por nodo/producto/talla, así que estos índices ayudan al planner.
CREATE INDEX IF NOT EXISTS nbal_nodo_prod_talla_idx
    ON nodos.builder_artifact_line (nodo_id, producto_id, talla)
    WHERE is_active = TRUE;
-- (c) Líneas por expediente (para queries globales tipo "qué artefactos
--     mencionan al expediente X").
CREATE INDEX IF NOT EXISTS nbal_expediente_idx
    ON nodos.builder_artifact_line (expediente_id)
    WHERE is_active = TRUE;
-- (d) Soft-delete auditing.
CREATE INDEX IF NOT EXISTS nbal_active_idx
    ON nodos.builder_artifact_line (is_active);

-- ── Trigger updated_at ─────────────────────────────────
DROP TRIGGER IF EXISTS tg_nbal_upd ON nodos.builder_artifact_line;
CREATE TRIGGER tg_nbal_upd
    BEFORE UPDATE ON nodos.builder_artifact_line
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE nodos.builder_artifact_line IS
    'Líneas (expediente, producto, talla, qty) asociadas a un artefacto '
    'de nodo. Sprint 2026-05-11 fase 5. Append-only. El descuento por '
    'template se calcula en endpoints, no en la BD.';
