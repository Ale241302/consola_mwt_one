-- =====================================================================
-- G7 · Motor de Tallas — recomputar KR y CN con fórmula consistente
-- Sprint 2026-07-18 (auditoría de equivalencias)
--
-- La matriz G2/G4 tiene los valores core correctos (EU/BR/US/UK/CM/
-- MX/JP/AR/ALFA/youth), pero dos columnas no siguen fórmula estable:
--
--   · KR (Corea): las tallas coreanas SON milímetros de largo de pie
--     (Mondopoint en mm, pasos de 5 mm). Los valores actuales están
--     ~5–10 mm bajos y con pasos irregulares (…230, 240, 245…).
--     Regla: kr = round(cm × 10 al múltiplo de 5 más cercano).
--       BR 40 (cm 27.30) → 273 mm → 275   (antes 265 ✗)
--
--   · CN (China): la numeración china clásica ≈ 2 × cm_pie − 10.
--     Los valores actuales no la siguen (declarada en G2, no aplicada).
--       BR 40 (cm 27.30) → 2×27.30 − 10 = 44.6 → 45   (antes 43 ✗)
--
-- Idempotente (UPDATE determinista por fórmula sobre cm).
-- =====================================================================
UPDATE ops.tallas
   SET kr = (round((cm::numeric * 10) / 5.0) * 5)::int::text,
       cn = round(cm::numeric * 2 - 10)::int::text,
       updated_at = NOW()
 WHERE is_active
   AND tipo_producto = 'calzado'
   AND cm ~ '^[0-9]+(\.[0-9]+)?$';
