-- =====================================================================
-- MWT.ONE · E2_documento_storage_url_normalize.sql
-- Agente responsable: [AG-DB-SQL]
-- Sprint 2026-06-19 · FIX visor de documentos (NoSuchKey en MinIO)
--
-- CONTEXTO
--   Históricamente `expedientes.documento.storage_url` quedó poblado con
--   3 formatos distintos:
--     a) KEY directa           → 'documento/<uuid>/file.pdf'      (create OK)
--     b) URL GET firmada (24h) → 'http://IP:9000/mwt-one/<key>?X-Amz-...'  (matchmaker)
--     c) URL PUT firmada       → 'http://IP:9000/mwt-one/<key>?X-Amz-...'  (wizard legacy)
--     d) NULL / vacío          → el binario NUNCA se subió (wizard legacy)
--
--   El visor sólo funciona con la KEY limpia (b/c expiran o rompen la firma;
--   d directamente no tiene archivo). Este script normaliza b) y c) a la KEY
--   canónica para que el endpoint /api/storage/download/?key= sirva el objeto.
--
--   IDEMPOTENTE: tras correr, las filas ya normalizadas dejan de cumplir el
--   WHERE → re-ejecutar no cambia nada. Backward-compatible (rolling deploy).
--   NOTA: el backend además normaliza al vuelo en signed_url(), así que este
--   script es "belt & suspenders" + higiene de datos.
-- =====================================================================

BEGIN;

-- 1) Normalizar URLs firmadas (GET o PUT) → object key limpia.
--    Quita el query-string de firma (?X-Amz-...) y el prefijo
--    scheme://host/<bucket>/ dejando sólo '<scope>/<...>'.
UPDATE expedientes.documento
   SET storage_url = regexp_replace(
                       regexp_replace(storage_url, '\?.*$', ''),          -- quita query SigV4
                       '^https?://[^/]+/mwt-one/', ''                      -- quita scheme+host+bucket
                     ),
       updated_at  = now()
 WHERE storage_url ~* '^https?://[^/]+/mwt-one/';

-- 2) Diagnóstico (NO destructivo): cuántos documentos quedan SIN archivo
--    real recuperable (storage_url NULL/vacío). Estos son registros legacy
--    del wizard que nunca subió el binario: deben re-subirse manualmente
--    desde la UI ("Agregar documento"). Se reporta como NOTICE.
DO $$
DECLARE
    n_huerfanos  integer;
    n_dynamicos  integer;
    n_keys       integer;
BEGIN
    SELECT count(*) INTO n_huerfanos
      FROM expedientes.documento
     WHERE is_active = TRUE
       AND (storage_url IS NULL OR btrim(storage_url) = '');

    SELECT count(*) INTO n_dynamicos
      FROM expedientes.documento
     WHERE is_active = TRUE
       AND storage_url LIKE 'dynamic://%';

    SELECT count(*) INTO n_keys
      FROM expedientes.documento
     WHERE is_active = TRUE
       AND storage_url IS NOT NULL
       AND btrim(storage_url) <> ''
       AND storage_url NOT LIKE 'dynamic://%';

    RAISE NOTICE '[E2] documento.storage_url → keys=%, dinamicos=%, SIN_ARCHIVO(huerfanos)=%',
                 n_keys, n_dynamicos, n_huerfanos;
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- Query manual de inspección de huérfanos (descomentar para listarlos):
--
-- SELECT id, expediente_id, oc_id, kind, codigo, fecha, author
--   FROM expedientes.documento
--  WHERE is_active = TRUE
--    AND (storage_url IS NULL OR btrim(storage_url) = '')
--  ORDER BY created_at DESC;
-- ---------------------------------------------------------------------
