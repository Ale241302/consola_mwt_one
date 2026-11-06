-- =====================================================================
-- MWT.ONE · backend/sql/N2_mcp_audit_actor.sql
--
-- Auditoría MCP: registrar al ACTOR real y la SESIÓN, no solo al servicio.
--
-- Antes `identity_sub` guardaba siempre `service:mcp-gateway-prod` (la
-- credencial que firma el POST), así que la tabla respondía "qué hizo el
-- MCP" pero no "qué hizo cada usuario". Con `actor_email`/`actor_role` la
-- pregunta "¿qué hizo X el martes?" pasa a ser una consulta directa, y
-- `session_id` permite agrupar las llamadas de una misma conversación.
--
-- Backward-compatible: columnas nullable, sin default ni backfill. Las filas
-- históricas quedan con actor NULL (no se puede reconstruir).
-- =====================================================================

ALTER TABLE core.mcp_audit
    ADD COLUMN IF NOT EXISTS actor_email TEXT,
    ADD COLUMN IF NOT EXISTS actor_role  TEXT,
    ADD COLUMN IF NOT EXISTS session_id  TEXT;

-- "Qué hizo este usuario en este rango" es la consulta más frecuente.
CREATE INDEX IF NOT EXISTS idx_mcp_audit_actor_at
    ON core.mcp_audit (actor_email, at_created DESC);

-- Agrupar una conversación por sesión MCP.
CREATE INDEX IF NOT EXISTS idx_mcp_audit_session
    ON core.mcp_audit (session_id, at_created DESC)
    WHERE session_id IS NOT NULL;
