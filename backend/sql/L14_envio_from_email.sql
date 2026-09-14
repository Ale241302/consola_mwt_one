-- =====================================================================
-- L14 · Correo: remitente (buzón) por envío.
--   Permite responder DESDE el buzón del usuario, no siempre desde Álvaro.
--   Idempotente.
-- =====================================================================
BEGIN;
ALTER TABLE correo.envio ADD COLUMN IF NOT EXISTS from_email VARCHAR(254);
COMMENT ON COLUMN correo.envio.from_email IS
    'Buzón remitente del envio (respuesta del usuario). Si NULL, usa la cuenta por defecto.';
COMMIT;
