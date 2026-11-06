-- =====================================================================
-- MWT.ONE · backend/sql/N1_service_token_auto_renew.sql
--
-- Vigencia deslizante para los ServiceToken de infraestructura.
--
-- Motivo: `mint_mcp_token` tiene un tope de 90 días y nadie avisaba del
-- vencimiento. Al expirar, el MCP falla cerrado en `list_tools` y el
-- conector muestra "no tiene herramientas disponibles" — un síntoma que
-- no apunta a la causa. Con `auto_renew` la vigencia se corre sola
-- (Celery diario + el propio MCP al arrancar) y el apagado real queda
-- en `revoked_at` / `is_active`.
--
-- Backward-compatible: columna nueva con DEFAULT (las filas existentes
-- quedan renovables y el código viejo la ignora). La vista se recrea
-- agregando la columna al final.
-- =====================================================================

ALTER TABLE core.service_token
    ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT TRUE;

-- El task diario busca tokens renovables que vencen pronto; este índice
-- parcial mantiene la consulta barata a medida que crezcan los tokens.
CREATE INDEX IF NOT EXISTS idx_service_token_auto_renew
    ON core.service_token (expires_at)
    WHERE is_active = TRUE AND auto_renew = TRUE AND revoked_at IS NULL;

CREATE OR REPLACE VIEW core.service_token_flat AS
SELECT
    t.id,
    t.name,
    t.role_slug,
    t.is_active,
    t.expires_at,
    t.revoked_at,
    t.last_used_at,
    t.created_by_id,
    t.created_at,
    t.updated_at,
    array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL) AS scopes,
    array_agg(DISTINCT s.client_id) FILTER (WHERE s.client_id IS NOT NULL) AS client_ids,
    t.auto_renew
FROM core.service_token t
LEFT JOIN core.service_token_scope s ON s.service_token_id = t.id
GROUP BY t.id;
