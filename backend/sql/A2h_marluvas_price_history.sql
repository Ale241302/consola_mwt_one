-- =====================================================================
-- MWT.ONE · A2h_marluvas_price_history.sql
-- Agente responsable: [AG-DATABASE]
--
-- Propósito (F6): bitácora histórica de cambios de precios Marluvas.
-- Cada click en "Guardar" del motor de precios (vista cliente-marca)
-- genera 1 fila en `marluvas_price_history_event` + N filas hijas en
-- `marluvas_price_history_sku` (una por SKU del snapshot).
--
-- Diseño:
--   Tabla cabecera (event)
--     · brand_id, cliente_id, snapshot_at, created_by_user_id
--     · fecha_inicio, fecha_fin → vigencia comercial del snapshot
--     · custom_plazos JSONB → plazos custom por banda (global del cliente)
--     · sku_count, cells_count → resumen del snapshot
--     · notas opcional
--
--   Tabla detalle (sku, 1:N)
--     · sku, brl_override, com_pct, ajuste_usd, sobreprecio_pct
--     · anchor JSONB {bandaId, plazoDias}
--     · prices_matrix JSONB (12 bandas × N plazos)
--     · sizes_pricing JSONB (overrides por talla)
--     · activo boolean
--
-- Visibilidad: CEO-ONLY (los endpoints lo enforce, no hay RLS aquí).
-- No tocamos pricing.marluvas_client_sku_pricing (la activa) —
-- el historial es AUDITORÍA pura, snapshot inmutable.
--
-- ⚠ NO se elimina automáticamente al desactivar un SKU. La política de
--    retención (¿meses?, ¿años?) la decidirá el CEO; mientras tanto
--    crecimiento controlado: ~1 fila cabecera por save + ~10-50 hijas.
-- =====================================================================
BEGIN;

-- ── Cabecera ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing.marluvas_price_history_event (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            UUID         NOT NULL,
  cliente_id          UUID         NOT NULL,
  snapshot_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by_user_id  UUID         NULL,
  fecha_inicio        DATE         NULL,
  fecha_fin           DATE         NULL,
  custom_plazos       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  sku_count           INTEGER      NOT NULL DEFAULT 0,
  cells_count         INTEGER      NOT NULL DEFAULT 0,
  notas               TEXT         NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_event_brand_cliente_at
  ON pricing.marluvas_price_history_event (brand_id, cliente_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_event_at
  ON pricing.marluvas_price_history_event (snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_event_cliente_at
  ON pricing.marluvas_price_history_event (cliente_id, snapshot_at DESC);

-- ── Detalle por SKU ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing.marluvas_price_history_sku (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID            NOT NULL
                  REFERENCES pricing.marluvas_price_history_event(id)
                  ON DELETE CASCADE,
  sku             VARCHAR(64)     NOT NULL,
  brl_override    NUMERIC(14,4)   NULL,
  com_pct         NUMERIC(8,4)    NOT NULL DEFAULT 0,
  ajuste_usd      NUMERIC(14,4)   NOT NULL DEFAULT 0,
  sobreprecio_pct NUMERIC(10,6)   NOT NULL DEFAULT 0,
  anchor          JSONB           NULL,
  prices_matrix   JSONB           NOT NULL DEFAULT '{}'::jsonb,
  sizes_pricing   JSONB           NOT NULL DEFAULT '{}'::jsonb,
  activo          BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_sku_event
  ON pricing.marluvas_price_history_sku (event_id);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_sku_sku
  ON pricing.marluvas_price_history_sku (sku);

CREATE INDEX IF NOT EXISTS idx_marluvas_price_history_sku_event_sku
  ON pricing.marluvas_price_history_sku (event_id, sku);

COMMIT;
