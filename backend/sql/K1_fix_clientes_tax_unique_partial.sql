-- =====================================================================
-- MWT.ONE · K1_fix_clientes_tax_unique_partial.sql
-- Fix 500 IntegrityError en PATCH /api/clientes/<id>/:
--   uq_cliente_tax era UNIQUE(tax_id, pais_iso2) (constraint) SIN predicado →
--   con varios clientes con tax_id = '' (o NULL) cualquier PATCH con tax_id
--   vacío choca con el par existente ("duplicate key").
--
-- Solución: eliminar la constraint y crear un índice único PARCIAL que solo
-- aplica cuando el tax_id tiene valor real (no vacío, no NULL).
-- =====================================================================

ALTER TABLE clientes.cliente DROP CONSTRAINT IF EXISTS uq_cliente_tax;

DROP INDEX IF EXISTS clientes.uq_cliente_tax;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_tax
    ON clientes.cliente (tax_id, pais_iso2)
    WHERE tax_id IS NOT NULL AND tax_id <> '';
