-- =====================================================================
-- MWT.ONE · E2_sanitize_numeric_artifacts.sql
-- Ola 1 — F1: Parseo numérico local y saneamiento de artefactos.
--
-- Crea tabla de auditoría para inconsistencias de datos y un índice
-- de búsqueda sobre campos numéricos en builder_artifact_instance.data.
-- El saneamiento propiamente dicho lo ejecuta el comando
--     python manage.py audit_numeric_fields
-- con el flag --apply para corregir inequívocos.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;

-- ─────────────────────────────────────────────────────────────────────
-- Tabla de issues de calidad de datos (genérica, no solo numéricos)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.data_quality_issue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_name     TEXT NOT NULL,
    table_name      TEXT NOT NULL,
    row_id          UUID NOT NULL,
    field_path      TEXT NOT NULL,
    raw_value       TEXT,
    detected_issue  TEXT NOT NULL, -- 'NaN', 'ambiguous_separator', 'invalid_number', 'mismatch'
    proposed_value  NUMERIC,
    applied_at      TIMESTAMPTZ,
    applied_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dqi_unique_issue
    ON core.data_quality_issue (schema_name, table_name, row_id, field_path, detected_issue)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_dqi_schema_table_row
    ON core.data_quality_issue (schema_name, table_name, row_id, is_active);

CREATE INDEX IF NOT EXISTS idx_dqi_issue_type
    ON core.data_quality_issue (detected_issue, is_active);

-- Función utilitaria para extraer todos los field.id de tipo "number"
-- de un structure_snapshot JSONB. Se usa desde el comando Python.
CREATE OR REPLACE FUNCTION core.extract_number_field_ids(snapshot JSONB)
RETURNS TABLE(field_id TEXT)
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT f->>'id' AS field_id
    FROM jsonb_array_elements(snapshot->'sections') AS sec,
         jsonb_array_elements(sec->'columns') AS col,
         jsonb_array_elements(col->'fields') AS f
    WHERE f->>'type' = 'number'
      AND f->>'id' IS NOT NULL;
$$;
