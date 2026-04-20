-- =====================================================================
-- MWT.ONE · 05_shared_catalogs.sql
-- Agente responsable: [AG-DATABASE]
--
-- Catálogos transversales consumidos por múltiples módulos.
-- Vive en el schema `core` (ya creado por database/01_init.sql).
--   · core.pais_cat              · países ISO-3166 alpha-2
--
-- Ejecutar UNA sola vez (idempotente) con:
--   psql -U mwt -d mwt_one -f backend/sql/05_shared_catalogs.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.pais_cat (
    iso2      CHAR(2)      PRIMARY KEY,
    label     VARCHAR(80)  NOT NULL,
    region    VARCHAR(32),          -- LATAM · NORTH_AMERICA · EUROPE · ASIA
    moneda    CHAR(3),              -- USD, PEN, MXN...
    is_active BOOLEAN      NOT NULL DEFAULT TRUE,
    orden     SMALLINT     NOT NULL DEFAULT 100
);

INSERT INTO core.pais_cat (iso2, label, region, moneda, orden) VALUES
  ('PE','Perú',            'LATAM','PEN', 1),
  ('MX','México',          'LATAM','MXN', 2),
  ('CO','Colombia',        'LATAM','COP', 3),
  ('CL','Chile',           'LATAM','CLP', 4),
  ('EC','Ecuador',         'LATAM','USD', 5),
  ('AR','Argentina',       'LATAM','ARS', 6),
  ('BR','Brasil',          'LATAM','BRL', 7),
  ('UY','Uruguay',         'LATAM','UYU', 8),
  ('US','Estados Unidos',  'NORTH_AMERICA','USD', 10),
  ('CA','Canadá',          'NORTH_AMERICA','CAD', 11),
  ('ES','España',          'EUROPE','EUR', 20),
  ('IT','Italia',          'EUROPE','EUR', 21),
  ('FR','Francia',         'EUROPE','EUR', 22),
  ('DE','Alemania',        'EUROPE','EUR', 23),
  ('CN','China',           'ASIA','CNY', 30),
  ('JP','Japón',           'ASIA','JPY', 31),
  ('IN','India',           'ASIA','INR', 32)
ON CONFLICT (iso2) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_pais_cat_region ON core.pais_cat(region) WHERE is_active;
