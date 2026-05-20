-- =====================================================================
-- MWT.ONE · A2f_marluvas_sizes_pricing.sql
-- Agente responsable: [AG-DATABASE]
--
-- Propósito: agregar la columna `sizes_pricing` (JSONB) a la tabla
-- pricing.marluvas_client_sku_pricing para soportar overrides de
-- precio por talla dentro del mismo SKU.
--
-- Contexto Fase 3:
--   Un SKU Marluvas se vende en varias tallas (33..48). Hasta ahora la
--   matriz 12×4 (`prices_matrix`) representaba UN precio por (banda,
--   plazo) válido para todas las tallas. Algunos contratos requieren
--   diferenciar precio por talla manteniendo el resto del SKU igual.
--
-- Modelo de herencia:
--   · Talla CON entrada en `sizes_pricing` → usa su matriz/anchor propios.
--   · Talla SIN entrada                    → hereda de `prices_matrix`
--                                            (matriz default del SKU).
--   · BRL único por SKU — no se duplica por talla (decisión negocio).
--
-- Alcance Fase 3:
--   Solo display en el panel. No impacta proformas ni OCs todavía.
--
-- Idempotente (IF NOT EXISTS) — seguro de re-aplicar.
-- =====================================================================
SET client_min_messages = warning;

ALTER TABLE pricing.marluvas_client_sku_pricing
    ADD COLUMN IF NOT EXISTS sizes_pricing JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pricing.marluvas_client_sku_pricing.sizes_pricing IS
    'Overrides de precio por talla dentro del SKU. Shape: { "<talla_uuid>": { "matrix": { "<banda_id>": {"<plazo_dias>": <precio_usd> } }, "anchor": { "bandaId": <int>, "plazoDias": <int> } } }. Tallas sin entrada heredan de prices_matrix (SKU default). BRL único por SKU — no varía por talla.';

-- =====================================================================
-- ROLLBACK (manual):
--   ALTER TABLE pricing.marluvas_client_sku_pricing
--     DROP COLUMN IF EXISTS sizes_pricing;
-- =====================================================================
-- FIN A2f_marluvas_sizes_pricing.sql
-- =====================================================================
