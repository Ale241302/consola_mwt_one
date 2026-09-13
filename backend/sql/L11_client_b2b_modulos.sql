-- =====================================================================
-- L11 · Cliente B2B: módulos permitidos.
--   · Quita `cartera` (Portfolio) e `inventario` del rol client_b2b
--     (no aplican al cliente y ya no se muestran en el sidebar).
--   · Agrega `tickets` para que el cliente vea SUS tickets
--     (el endpoint /api/tickets/ ya filtra por user_id para no-admin).
--   · Conserva `productos` porque el wizard del cliente (crear OC) resuelve
--     líneas con /api/productos/. `cartera`/`cobros` del cliente van por
--     /api/portal/... (módulo portal).
--   Idempotente en la práctica: el archivo se aplica una sola vez.
-- =====================================================================
BEGIN;

UPDATE core.roles
SET permissions = jsonb_build_object(
    'modules',
      (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
         FROM jsonb_array_elements_text(permissions -> 'modules') AS x
        WHERE x NOT IN ('cartera', 'inventario'))
      || '["tickets"]'::jsonb,
    'actions',
      (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
         FROM jsonb_array_elements_text(permissions -> 'actions') AS x
        WHERE x NOT LIKE 'cartera.%' AND x NOT LIKE 'inventario.%')
      || '["tickets.view","tickets.create","tickets.view_doc","tickets.download_doc","tickets.upload_doc"]'::jsonb,
    'read_only', COALESCE(permissions -> 'read_only', 'false'::jsonb)
)
WHERE slug = 'client_b2b';

COMMIT;
