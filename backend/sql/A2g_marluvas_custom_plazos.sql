-- =====================================================================
-- MWT.ONE · A2g_marluvas_custom_plazos.sql
-- Agente responsable: [AG-DATABASE]
--
-- Propósito: agregar la columna `custom_plazos` (JSONB) a la tabla
-- pricing.marluvas_client_sku_pricing para soportar plazos personalizados
-- por banda (agregar/quitar plazos default).
--
-- Contexto Fase 4:
--   Los 4 plazos default (90d, 60d, 30d, 8d) son hardcoded a nivel
--   global. Esta columna permite que cada banda cambial tenga su propia
--   lista de plazos — el operador puede:
--     · Agregar plazos custom (ej. 120d con +2% sobre 90d).
--     · Quitar plazos default (ej. eliminar 8d de banda piso).
--   Y por banda independiente.
--
-- Modelo de datos:
--   Bandas SIN entrada en `custom_plazos` → usan defaults [90/60/30/8].
--   Bandas CON entrada → usan SOLO esa lista (materialización lazy).
--
-- Shape JSON:
--   {
--     "1": [
--       {"dias": 120, "factor": 1.02 },
--       {"dias": 90,  "factor": 1.0  },
--       {"dias": 60,  "factor": 0.99 }
--     ],
--     "6": [...]
--   }
--   Bandas no listadas usan defaults completos.
--
-- Persistencia:
--   El simulador cliente-marca guarda el MISMO custom_plazos en TODOS
--   los rows del par (brand, cliente) durante save-simulation (snapshot
--   atómico por reemplazo). Redundancia aceptada por simplicidad — el
--   objeto es pequeño y la atomicidad del save garantiza consistencia.
--
-- Idempotente (IF NOT EXISTS) — seguro de re-aplicar.
-- =====================================================================
SET client_min_messages = warning;

ALTER TABLE pricing.marluvas_client_sku_pricing
    ADD COLUMN IF NOT EXISTS custom_plazos JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pricing.marluvas_client_sku_pricing.custom_plazos IS
    'Plazos personalizados por banda. Shape: { "<bandaId>": [{"dias": <int>, "factor": <float>}] }. Bandas sin entrada usan defaults [90/60/30/8]. Bandas con entrada usan SOLO esa lista (materialización lazy: edit por primera vez clona defaults).';

-- =====================================================================
-- ROLLBACK manual:
--   ALTER TABLE pricing.marluvas_client_sku_pricing
--     DROP COLUMN IF EXISTS custom_plazos;
-- =====================================================================
