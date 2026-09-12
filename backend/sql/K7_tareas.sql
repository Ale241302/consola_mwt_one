-- =====================================================================
-- K7 · Etapa 2 - Tareas: catálogo, agenda del expediente y mesa de trabajo
-- Esquema `tareas`. Idempotente. Días hábiles = lunes a viernes (sin feriados).
--
--   tareas.catalogo      -> plantillas reutilizables (catálogo de tareas)
--   tareas.tarea         -> agenda del expediente (instancias)
--   tareas.tarea_evento  -> bitácora de cambios de cada tarea
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS tareas;

-- ── Catálogo de plantillas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tareas.catalogo (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo               VARCHAR(48)  NOT NULL UNIQUE,
    nombre               VARCHAR(160) NOT NULL,
    descripcion          TEXT,
    tipo                 VARCHAR(24)  NOT NULL DEFAULT 'OPERATIVO',
    offset_dias_habiles  INTEGER,                 -- (+/-) días hábiles vs. fecha de referencia
    offset_ref           VARCHAR(24),             -- REGISTRO | PRODUCCION | ENVIO
    depends_on_hito      VARCHAR(24),             -- fase/hito relacionado (opcional)
    orden                INTEGER      NOT NULL DEFAULT 100,
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT tareas_catalogo_tipo_chk
        CHECK (tipo IN ('PRODUCCION','DOCUMENTO','LOGISTICA','SEGUIMIENTO','OPERATIVO')),
    CONSTRAINT tareas_catalogo_ref_chk
        CHECK (offset_ref IS NULL OR offset_ref IN ('REGISTRO','PRODUCCION','ENVIO'))
);

-- ── Agenda del expediente ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tareas.tarea (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expediente_id        UUID,
    oc_id                UUID,
    client_id            UUID,
    catalogo_id          UUID,
    catalogo_codigo      VARCHAR(48),             -- desnormalizado: idempotencia/filtros
    titulo               VARCHAR(200) NOT NULL,
    descripcion          TEXT,
    tipo                 VARCHAR(24)  NOT NULL DEFAULT 'OPERATIVO',
    estado               VARCHAR(24)  NOT NULL DEFAULT 'PENDIENTE',
    prioridad            VARCHAR(16)  NOT NULL DEFAULT 'MEDIA',
    responsable_user_id  UUID,
    origen               VARCHAR(12)  NOT NULL DEFAULT 'MANUAL',
    due_date             DATE,
    depends_on_hito      VARCHAR(24),
    last_sent_at         TIMESTAMPTZ,
    responded_at         TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    notes                TEXT,
    external_ref         TEXT,                    -- proforma / SAP / referencia visible
    evidence             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_override          BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by_id        UUID,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT tareas_tarea_estado_chk
        CHECK (estado IN ('PENDIENTE','BORRADOR_LISTO','ESPERANDO_RESPUESTA',
                          'REQUIERE_REVISION','RESUELTA','CANCELADA')),
    CONSTRAINT tareas_tarea_prioridad_chk
        CHECK (prioridad IN ('ALTA','MEDIA','BAJA')),
    CONSTRAINT tareas_tarea_origen_chk
        CHECK (origen IN ('AUTO','MANUAL')),
    CONSTRAINT tareas_tarea_tipo_chk
        CHECK (tipo IN ('PRODUCCION','DOCUMENTO','LOGISTICA','SEGUIMIENTO','OPERATIVO'))
);

CREATE INDEX IF NOT EXISTS tarea_expediente_idx ON tareas.tarea (expediente_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS tarea_estado_idx     ON tareas.tarea (estado)         WHERE is_active;
CREATE INDEX IF NOT EXISTS tarea_due_idx        ON tareas.tarea (due_date)       WHERE is_active;
CREATE INDEX IF NOT EXISTS tarea_responsable_idx ON tareas.tarea (responsable_user_id) WHERE is_active;
-- Idempotencia: no más de una tarea AUTO viva por (expediente, plantilla).
CREATE UNIQUE INDEX IF NOT EXISTS tarea_auto_uniq
    ON tareas.tarea (expediente_id, catalogo_codigo)
    WHERE origen = 'AUTO' AND is_active = TRUE
      AND estado NOT IN ('RESUELTA','CANCELADA');

-- ── Bitácora ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tareas.tarea_evento (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tarea_id    UUID NOT NULL,
    accion      VARCHAR(32) NOT NULL,
    detalle     JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id     UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tarea_evento_tarea_idx ON tareas.tarea_evento (tarea_id, created_at DESC);

-- ── Catálogo base (plantillas) ──────────────────────────────────────
INSERT INTO tareas.catalogo
    (codigo, nombre, descripcion, tipo, offset_dias_habiles, offset_ref, depends_on_hito, orden)
VALUES
    ('SOLICITAR_FECHA_PRODUCCION',
     'Solicitar fecha concreta de producción',
     'Consultar a fábrica/COMEX una fecha concreta de producción.',
     'PRODUCCION', 15, 'REGISTRO', NULL, 10),
    ('RECONFIRMAR_PRODUCCION',
     'Reconfirmar producción',
     'Reconfirmar 10 días hábiles antes de la fecha de producción informada.',
     'PRODUCCION', -10, 'PRODUCCION', NULL, 20),
    ('SEGUIMIENTO_SIN_RESPUESTA',
     'Seguimiento sin respuesta',
     'Insistir 3 días hábiles después del envío efectivo de la consulta.',
     'SEGUIMIENTO', 3, 'ENVIO', NULL, 30),
    ('SOLICITAR_DOCUMENTO',
     'Solicitar documento',
     'Pedir un documento faltante (factura, packing list, AWB/BL, certificado).',
     'DOCUMENTO', NULL, NULL, NULL, 40),
    ('REVISAR_ITINERARIO',
     'Revisar itinerario',
     'Revisar itinerario/ruta y confirmar salida o llegada.',
     'LOGISTICA', NULL, NULL, NULL, 50),
    ('PREPARAR_DESPACHO',
     'Preparar despacho',
     'Preparar el despacho cuando el pedido entra en preparación.',
     'LOGISTICA', NULL, NULL, 'PREPARACION', 60)
ON CONFLICT (codigo) DO UPDATE
   SET nombre              = EXCLUDED.nombre,
       descripcion         = EXCLUDED.descripcion,
       tipo                = EXCLUDED.tipo,
       offset_dias_habiles = EXCLUDED.offset_dias_habiles,
       offset_ref          = EXCLUDED.offset_ref,
       depends_on_hito     = EXCLUDED.depends_on_hito,
       orden               = EXCLUDED.orden,
       is_active           = TRUE,
       updated_at          = NOW();

COMMIT;
