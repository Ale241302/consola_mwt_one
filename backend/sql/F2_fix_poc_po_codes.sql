-- ============================================================
-- F2 · Fix de códigos de PO registrados como "POC …" (typo)
-- Sprint 2026-07-15 · el prefijo canónico del PO del cliente es "PO".
--
-- Contexto: en /expedientes hay registro(s) cuyo código de OC quedó
-- guardado como "POC 504978" (typo/OCR) cuando debe ser "PO 504978".
-- El frontend (RefCell) ya normaliza en display y po_alias_matcher.py
-- normaliza los nuevos ingresos; este script corrige la DATA histórica.
--
-- Alcance:
--   · expedientes.documento.codigo   (kind ~ '^OC')
--   · expedientes.oc.codigo
--   · expedientes.expediente.codigo  (formato 'EXP-<po_number>')
--
-- Idempotente: los WHERE solo matchean filas que aún empiezan con POC.
-- ============================================================

BEGIN;

-- 1) Documentos OC ("POC 504978" / "POC-504978" / "POC504978" → "PO 504978")
UPDATE expedientes.documento
   SET codigo = regexp_replace(codigo, '^\s*POC[\s\-_]*', 'PO ', 'i')
 WHERE kind ~* '^OC(\s|_|$)'
   AND codigo ~* '^\s*POC[\s\-_]?\d';

-- 2) OCs (po_number crudo)
UPDATE expedientes.oc
   SET codigo = regexp_replace(codigo, '^\s*POC[\s\-_]*', 'PO ', 'i')
 WHERE codigo ~* '^\s*POC[\s\-_]?\d';

-- 3) Expedientes cuyo código heredó el typo ('EXP-POC 504978' → 'EXP-PO 504978')
UPDATE expedientes.expediente
   SET codigo = regexp_replace(codigo, '^EXP-\s*POC[\s\-_]*', 'EXP-PO ', 'i')
 WHERE codigo ~* '^EXP-\s*POC[\s\-_]?\d';

COMMIT;

-- Verificación rápida (debe devolver 0 filas):
--   SELECT codigo FROM expedientes.documento WHERE codigo ~* '^\s*POC[\s\-_]?\d'
--   UNION ALL SELECT codigo FROM expedientes.oc WHERE codigo ~* '^\s*POC[\s\-_]?\d'
--   UNION ALL SELECT codigo FROM expedientes.expediente WHERE codigo ~* '^EXP-\s*POC[\s\-_]?\d';
