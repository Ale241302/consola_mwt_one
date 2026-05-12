-- =====================================================================
-- MWT.ONE · 11b_nodos_artefactos.sql · Artefactos por Nodo
-- Sprint 2026-05-11 — Fase 2 del paquete Nodos.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso:
--   El CEO necesita una tab "Artefactos" dentro del detalle del nodo
--   (/nodos/{id}) que permita asociar archivos arbitrarios (proformas,
--   certificados, fotos de bodega, contratos 3PL, cualquier documento).
--
-- Reglas duras pedidas por el CEO:
--   1) Se puede tener varios artefactos por nodo.
--   2) El mismo TIPO puede repetirse (no hay UNIQUE por nodo+tipo).
--   3) El estado es libre (string), no hay enum estricto — el FE puede
--      mostrarlo como pill informativo, pero la BD no lo restringe.
--   4) Cero FK (sigue la convención MWT: nodo_id es UUID plano, igual
--      que en `nodos.nodo_jerarquia`, `inventario.stock`, etc.).
--
-- Idempotencia: usa CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS y bloque DO para el trigger.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/11b_nodos_artefactos.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS nodos.artefacto (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nodo_id         UUID         NOT NULL,                 -- ⛔ sin FK física
    tipo            VARCHAR(48)  NOT NULL,                 -- libre · ej: PROFORMA, BL, FOTO, 3PL_CONTRACT, CUSTOM
    nombre          VARCHAR(160) NOT NULL,                 -- título humano del artefacto
    estado          VARCHAR(32)  NOT NULL DEFAULT 'PUBLICADO',
                                                          -- libre · ej: PUBLICADO, BORRADOR, VENCIDO, REVISION
    descripcion     TEXT,                                  -- nota opcional / contexto
    archivo_url     TEXT,                                  -- ruta presigned o pública (devuelta por /storage/upload-proxy/)
    archivo_nombre  VARCHAR(255),                          -- nombre original
    archivo_size    BIGINT,                                -- bytes
    archivo_mime    VARCHAR(96),                           -- ej: application/pdf
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
                                                          -- campos extra libres (numero documento, fecha emisión, etc.)
    uploaded_by_id  UUID,                                  -- ⛔ sin FK · join lógico a core.users.id
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Índices ────────────────────────────────────────────
-- (a) Consulta principal del FE: artefactos de un nodo, ordenados por fecha.
CREATE INDEX IF NOT EXISTS idx_nodo_artefacto_nodo_id
    ON nodos.artefacto(nodo_id) WHERE is_active;
-- (b) Filtro por tipo dentro de un nodo (ej: "todas las proformas de este CD").
CREATE INDEX IF NOT EXISTS idx_nodo_artefacto_nodo_tipo
    ON nodos.artefacto(nodo_id, tipo) WHERE is_active;
-- (c) Soft-delete listing si algún día queremos auditar archivados.
CREATE INDEX IF NOT EXISTS idx_nodo_artefacto_active
    ON nodos.artefacto(is_active);

-- ── Trigger updated_at ─────────────────────────────────
-- Reusamos la función nodos.tg_set_updated_at() creada en 10_nodos.sql.
DROP TRIGGER IF EXISTS tg_nodo_artefacto_updated_at ON nodos.artefacto;
CREATE TRIGGER tg_nodo_artefacto_updated_at
    BEFORE UPDATE ON nodos.artefacto
    FOR EACH ROW EXECUTE FUNCTION nodos.tg_set_updated_at();

-- ── Comment crumb para psql \d+ ────────────────────────
COMMENT ON TABLE nodos.artefacto IS
    'Artefactos arbitrarios asociados a un nodo (sprint 2026-05-11). '
    'Permite mismo tipo repetido; estado es texto libre, sin enum.';
