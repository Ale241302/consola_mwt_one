-- =====================================================================
-- M6 · 2026-11-03 · Sanear URLs de archivo con `?token=` guardadas en BD
-- =====================================================================
-- Contexto (P0 de seguridad · informe de Álvaro, punto 1):
--
-- El frontend guardaba en el campo `url` de los campos de archivo del Builder
-- (`nodos.builder_artifact_instance.data[<field_id>]`) la URL del proxy de
-- descarga CON el access token de la cuenta (`...&token=<JWT>`). Ese JWT
-- (30 min, pero renovable y con acceso a toda la API) quedaba persistido en
-- la base y se reenviaba a cualquiera que leyera el artefacto: UI, export,
-- agente MCP.
--
-- El código ya no lo escribe (`DynamicField.jsx` persiste sólo la `key`).
-- Este script limpia lo que quedó guardado: quita la clave `url` cuando
-- contiene `token=`, preservando `key` (el binario no se toca ni se pierde).
--
-- Idempotente.
-- =====================================================================

BEGIN;

-- 1) Campos de archivo del Builder (JSONB).
UPDATE nodos.builder_artifact_instance bai
   SET data = sub.new_data,
       updated_at = NOW()
  FROM (
        SELECT bai2.id,
               jsonb_object_agg(
                   e.key,
                   CASE
                     WHEN jsonb_typeof(e.value) = 'object'
                          AND COALESCE(e.value->>'url', '') LIKE '%token=%'
                     THEN e.value - 'url'
                     ELSE e.value
                   END
               ) AS new_data
          FROM nodos.builder_artifact_instance bai2
          CROSS JOIN LATERAL jsonb_each(bai2.data) AS e(key, value)
         WHERE bai2.data::text LIKE '%token=%'
         GROUP BY bai2.id
       ) sub
 WHERE bai.id = sub.id;

-- 2) Artefacto legacy (columna de texto): quitar sólo el parámetro token.
UPDATE nodos.artefacto
   SET archivo_url = regexp_replace(archivo_url, '[?&]token=[^&]*', '', 'g'),
       updated_at  = NOW()
 WHERE archivo_url LIKE '%token=%';

-- 3) Evidencia de pago: nada que limpiar (la URL se arma al leer, no se
--    persiste). Se deja constancia para que no se busque dos veces.

COMMIT;
