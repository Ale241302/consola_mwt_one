-- =====================================================================
-- L13 · Correo por usuario: cada mensaje pertenece a un BUZÓN (owner_email).
--   Antes la bandeja era única (álvaro). Ahora se sincronizan los buzones
--   mwt (alvaro@, alejandro@, conta@, 506@) y cada usuario ve el suyo.
--   Idempotente.
-- =====================================================================
BEGIN;

ALTER TABLE correo.mensaje
    ADD COLUMN IF NOT EXISTS owner_email VARCHAR(254);

-- Los mensajes existentes se atribuyen al buzón configurado (Álvaro).
UPDATE correo.mensaje
   SET owner_email = 'alvaro@muitowork.com'
 WHERE owner_email IS NULL;

CREATE INDEX IF NOT EXISTS correo_mensaje_owner_idx
    ON correo.mensaje (owner_email, is_active, sent_at DESC);

COMMENT ON COLUMN correo.mensaje.owner_email IS
    'Etapa 8: buzón (cuenta) al que pertenece el mensaje; base del aislamiento por usuario.';

COMMIT;
