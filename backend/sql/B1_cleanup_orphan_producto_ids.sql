-- ============================================================
-- MWT.ONE · B1_cleanup_orphan_producto_ids.sql
-- Agente responsable: [AG-DATABASE]
--
-- Limpia `producto_id` huerfanos en `expedientes.linea`. Estos
-- son referencias a productos seed/mock viejos que ya no existen
-- en `productos.producto`. Causan 404 ruidosos en el frontend
-- cuando intenta resolver el precio del catalogo.
--
-- La columna NO tiene FK hard de Postgres (politica MWT: vinculos
-- por UUID en ORM, ver 70_expedientes.sql), por eso los huerfanos
-- pasaron desapercibidos.
--
-- Idempotente: solo NULLifica los que NO matchean ningun producto
-- activo. Si manana re-creas un producto con el mismo UUID, esta
-- script no lo toca (porque ya existe).
-- ============================================================

UPDATE expedientes.linea l
   SET producto_id = NULL,
       updated_at  = now()
 WHERE l.producto_id IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
         FROM productos.producto p
        WHERE p.id = l.producto_id
          AND p.is_active = TRUE
   );

-- Verificacion (informativa, no bloquea):
--   SELECT COUNT(*) FILTER (WHERE producto_id IS NULL) AS sin_producto,
--          COUNT(*) FILTER (WHERE producto_id IS NOT NULL) AS con_producto
--     FROM expedientes.linea
--    WHERE is_active = TRUE;
