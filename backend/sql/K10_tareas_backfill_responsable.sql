-- =====================================================================
-- K10 · Etapa 2 - backfill del responsable por defecto en tareas abiertas.
-- (Álvaro es el responsable por defecto; ver TAREAS_DEFAULT_RESPONSABLE_EMAIL.)
-- Idempotente: sólo toca tareas sin responsable.
-- =====================================================================
BEGIN;

UPDATE tareas.tarea t
   SET responsable_user_id = u.id,
       updated_at = NOW()
  FROM core.users u
 WHERE u.email_plain = 'alvaro@muitowork.com'
   AND u.is_active = TRUE
   AND t.responsable_user_id IS NULL
   AND t.is_active = TRUE
   AND t.estado NOT IN ('RESUELTA', 'CANCELADA');

COMMIT;
