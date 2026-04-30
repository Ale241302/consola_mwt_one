-- =====================================================================
-- MWT.ONE · 64_currency_full_iso4217.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Inbound v3 · 2026-04-30
--
-- Pobla pricing.currency_cat con el catálogo completo ISO 4217 de
-- monedas relevantes para operaciones MWT (LATAM + países donde
-- compramos / vendemos / facturamos).
--
-- Idempotente: ON CONFLICT (codigo) DO NOTHING.
-- =====================================================================

INSERT INTO pricing.currency_cat (codigo, nombre, symbol) VALUES
    -- LATAM
    ('USD', 'US Dollar',                      '$'),
    ('MXN', 'Peso Mexicano',                  '$'),
    ('PEN', 'Sol Peruano',                    'S/'),
    ('COP', 'Peso Colombiano',                '$'),
    ('CLP', 'Peso Chileno',                   '$'),
    ('ARS', 'Peso Argentino',                 '$'),
    ('BRL', 'Real Brasileño',                 'R$'),
    ('UYU', 'Peso Uruguayo',                  '$U'),
    ('PYG', 'Guaraní Paraguayo',              '₲'),
    ('BOB', 'Boliviano',                      'Bs'),
    ('CRC', 'Colón Costarricense',            '₡'),
    ('GTQ', 'Quetzal Guatemalteco',           'Q'),
    ('HNL', 'Lempira Hondureño',              'L'),
    ('NIO', 'Córdoba Nicaragüense',           'C$'),
    ('PAB', 'Balboa Panameño',                'B/.'),
    ('DOP', 'Peso Dominicano',                'RD$'),
    ('VES', 'Bolívar Venezolano',             'Bs.S'),
    ('CUP', 'Peso Cubano',                    '$MN'),
    -- Norteamérica
    ('CAD', 'Dólar Canadiense',               'C$'),
    -- Europa
    ('EUR', 'Euro',                           '€'),
    ('GBP', 'Libra Esterlina',                '£'),
    ('CHF', 'Franco Suizo',                   'CHF'),
    ('SEK', 'Corona Sueca',                   'kr'),
    ('NOK', 'Corona Noruega',                 'kr'),
    ('DKK', 'Corona Danesa',                  'kr'),
    ('PLN', 'Złoty Polaco',                   'zł'),
    ('CZK', 'Corona Checa',                   'Kč'),
    ('TRY', 'Lira Turca',                     '₺'),
    ('RUB', 'Rublo Ruso',                     '₽'),
    -- Asia · proveedores típicos de fábrica
    ('CNY', 'Yuan Chino',                     '¥'),
    ('HKD', 'Dólar de Hong Kong',             'HK$'),
    ('JPY', 'Yen Japonés',                    '¥'),
    ('KRW', 'Won Surcoreano',                 '₩'),
    ('TWD', 'Dólar Taiwanés',                 'NT$'),
    ('SGD', 'Dólar de Singapur',              'S$'),
    ('THB', 'Baht Tailandés',                 '฿'),
    ('VND', 'Dong Vietnamita',                '₫'),
    ('IDR', 'Rupia Indonesia',                'Rp'),
    ('INR', 'Rupia India',                    '₹'),
    ('PHP', 'Peso Filipino',                  '₱'),
    ('MYR', 'Ringgit Malayo',                 'RM'),
    -- Oceanía
    ('AUD', 'Dólar Australiano',              'A$'),
    ('NZD', 'Dólar Neozelandés',              'NZ$'),
    -- Otras grandes
    ('ZAR', 'Rand Sudafricano',               'R'),
    ('AED', 'Dírham EAU',                     'د.إ'),
    ('SAR', 'Riyal Saudí',                    '﷼'),
    ('ILS', 'Shekel Israelí',                 '₪')
ON CONFLICT (codigo) DO NOTHING;

-- Verificación
SELECT COUNT(*) AS total_currencies FROM pricing.currency_cat WHERE is_active = TRUE;

-- =====================================================================
-- FIN 64_currency_full_iso4217.sql
-- =====================================================================
