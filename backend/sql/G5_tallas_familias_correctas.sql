-- =====================================================================
-- G5 · Motor de Tallas — familias correctas por talla (verdad COMEX)
-- Sprint 2026-07-18
--
-- El backfill de G1 puso las 7 familias detectadas en los productos de
-- la DB en TODAS las tallas ("todas en todas" — aproximación). La verdad
-- de fábrica (Excel COMEX, hoja Calculadora, grillas M–X por SKU) dice:
--
--   · 44 familias fabrican la corrida completa BR 33–48
--   ·  3 familias (20S29, 55AG19, 65C32) fabrican BR 35–48
--   · 10 familias (10VB41 … 11WLS48)  fabrican BR 37–48
--   · BR 32 no la fabrica ninguna familia → familias = []
--
-- Resultado por talla: 33/34 → 44 familias · 35/36 → 47 · 37-48 → 53.
-- Ninguna familia fabrica fuera de 33–48 → no hay tallas nuevas que crear.
--
-- Idempotente (UPDATE determinista desde la tabla de corridas).
-- =====================================================================
WITH fam_runs(fam, lo, hi) AS (VALUES
  -- Corrida BR 37–48 (10 familias)
  ('10VB41',37,48),('10VB48',37,48),('10VS48',37,48),('10VT48',37,48),
  ('11SFB41',37,48),('11SFB48',37,48),('11SFS48',37,48),('11SFT48',37,48),
  ('11WLB41',37,48),('11WLS48',37,48),
  -- Corrida BR 35–48 (3 familias)
  ('20S29',35,48),('55AG19',35,48),('65C32',35,48),
  -- Corrida completa BR 33–48 (44 familias)
  ('30B19',33,48),('30B22',33,48),('30S29',33,48),('30T19',33,48),
  ('35B19',33,48),('35B22',33,48),('35B29',33,48),
  ('50B19',33,48),('50B21',33,48),('50B22',33,48),('50B26',33,48),
  ('50B29',33,48),('50C32',33,48),('50F60',33,48),('50F61',33,48),
  ('50S29',33,48),('50T18',33,48),('50T19',33,48),
  ('60B19',33,48),('60B22',33,48),('60B29',33,48),('60C32',33,48),
  ('60C39',33,48),('65B19',33,48),('65B22',33,48),
  ('70B19',33,48),('70B22',33,48),('70B29',33,48),('70C32',33,48),
  ('70F60',33,48),('70F61',33,48),('70S29',33,48),('70T18',33,48),
  ('70T19',33,48),('72B29',33,48),('72T18',33,48),
  ('75BPR26',33,48),('75BPR29',33,48),
  ('95B19',33,48),('95B22',33,48),('95B26',33,48),('95C32',33,48),
  ('95S19',33,48),('95S29',33,48)
),
per_talla AS (
  SELECT x.base,
         jsonb_agg(fr.fam ORDER BY fr.fam)
           FILTER (WHERE fr.fam IS NOT NULL) AS fams
    FROM generate_series(32, 48) AS x(base)
    LEFT JOIN fam_runs fr ON x.base BETWEEN fr.lo AND fr.hi
   GROUP BY x.base
)
UPDATE ops.tallas t
   SET familias   = COALESCE(pt.fams, '[]'::jsonb),
       updated_at = NOW()
  FROM per_talla pt
 WHERE t.is_active
   AND t.tipo_producto = 'calzado'
   AND t.talla_base = pt.base::text;
