-- ============================================================
-- MWT.ONE · 99_seed.sql
-- Agente responsable: [AG-DATABASE]
--
-- Seeds demo FULL-STACK — cada página del SPA debería ver data:
--   nodos               — 5 nodos (Callao HQ · Bodega Medellín · FBA
--                         US LGB8 · Bodega Bogotá · Hub Shanghái)
--   brands              — 4 marcas (Rana Walk propia, Sondel tercero,
--                         Marluvas tercero, Urban Pro tercero)
--   clientes            — 5 (Sondel, Marluvas, Overseas Buyer, Retail
--                         Local Lima, Distribuidor MX)
--   productos           — 6 SKUs (3 Rana Walk + 2 Sondel + 1 Marluvas)
--   proveedores         — 4 (Fábrica Jinjiang CN, Calzados ABC PE,
--                         Sedexp Logistics, Aduanas Silva)
--   inventario.stock    — 8 filas (mezcla nodos/productos/lotes)
--   expedientes.oc      — 3 OCs (emitida, en ejecución, cerrada)
--   expedientes.exp     — 4 expedientes (1 REGISTRO, 1 PRODUCCIÓN,
--                         1 TRÁNSITO, 1 EN_DESTINO)
--   expedientes.linea   — 6 líneas cruzadas
--   expedientes.doc     — 6 documentos (ART-01..ART-06 equivalentes)
--   cobros.cobro        — 3 cobros agrupadores
--   cobros.pago         — 5 pagos (INGRESO/EGRESO mezcla de estados
--                         incl. RECHAZADO con rejection_reason)
--   transfers.*         — 2 transferencias (ya estaban — preservadas)
--   email_templates     — 6 templates (ya estaban — preservados)
--   notifications       — 8 logs (ya estaban — preservados)
--   pipeline.event_log  — 6 eventos workflow C1..C11
--   financiero.cost_line— 6 líneas de costo (flete, aduana, producto)
--   portal.mwt_user     — 3 usuarios B2B (Sondel tesorería, Marluvas
--                         logística, API Overseas)
--   dashboard.snapshot  — 2 snapshots (preferencias + KPI mensual)
--
-- Uso:
--   - Se ejecuta DESPUÉS de 90_transfers.sql, 91_email_templates.sql,
--     92_notifications.sql, 93_schema_extensions.sql y
--     94_pipeline_financiero_portal.sql.
--   - UUIDs fijos + ON CONFLICT (id) DO NOTHING ⇒ re-entrante.
--   - Cero FKs físicas: todos los vínculos son UUIDs lógicos.
--   - Los UUIDs siguen el patrón semántico de los JSON canónicos:
--       * n7…-nodo…         = nodos
--       * b9…-brand…        = brands
--       * c8…-cliente…      = clientes
--       * p4…-producto…     = productos
--       * v5…-proveedor…    = proveedores
--       * s6…-stock…        = inventario.stock
--       * o70…-oc…          = expedientes.oc
--       * e20…-exp…         = expedientes.expediente
--       * lnn…-linea…       = expedientes.linea
--       * d70…-doc…         = expedientes.documento
--       * cb8…-cobro…       = cobros.cobro
--       * pg8…-pago…        = cobros.pago
--       * ev3…-event…       = pipeline.event_log
--       * cl5…-costline…    = financiero.cost_line
--       * u40…-mwtuser…     = portal.mwt_user
--       * ds1…-snap…        = dashboard.snapshot
-- ============================================================

SET search_path = public;

-- ────────────────────────────────────────────────────────────
-- 0. nodos.nodo  (5 nodos — origen de stock y destino de transfers)
-- ────────────────────────────────────────────────────────────
INSERT INTO nodos.nodo (
    id, codigo, nombre, tipo, pais_iso2, ciudad, direccion,
    zona_horaria, responsable_id, contacto_email, contacto_tel,
    capacidad_m2, observaciones, is_active,
    legal_entity_owner_id, operator_id, capabilities, status
) VALUES
(
    '77777777-0000-4000-8000-000000000001',
    'N-CALLAO', 'Callao HQ Logístico', 'HUB', 'PE', 'Callao',
    'Av. Argentina 3500', 'America/Lima',
    NULL, 'callao@muitowork.com', '+51 1 2345678',
    4200.00, 'Hub principal Pacífico Sur — aduana/WMS/FBA prep', TRUE,
    NULL, NULL,
    '["RECEIVE","DISPATCH","CUSTOMS","FBA_PREP","PICKING"]'::jsonb,
    'ACTIVE'
),
(
    '77777777-0000-4000-8000-000000000002',
    'N-MDE',    'Bodega Medellín',     'ALMACEN', 'CO', 'Medellín',
    'Cra 43A #5-15',   'America/Bogota',
    NULL, 'medellin@muitowork.com', '+57 604 5550199',
    1800.00, 'Bodega doméstica Colombia — entrega urbana', TRUE,
    NULL, NULL,
    '["RECEIVE","DISPATCH","PICKING"]'::jsonb,
    'ACTIVE'
),
(
    '77777777-0000-4000-8000-000000000003',
    'N-LGB8',   'FBA US · LGB8',       'HUB', 'US', 'Long Beach',
    '3150 N Fairview Pl',      'America/Los_Angeles',
    NULL, 'fba-us@muitowork.com', '+1 562 5550123',
    NULL, 'Centro Amazon FBA — inbound shipments', TRUE,
    NULL, NULL,
    '["FBA_INBOUND","STORAGE"]'::jsonb,
    'ACTIVE'
),
(
    '77777777-0000-4000-8000-000000000004',
    'N-BOG',    'Bodega Bogotá',       'ALMACEN', 'CO', 'Bogotá',
    'Cll 13 #71-50', 'America/Bogota',
    NULL, 'bogota@muitowork.com', '+57 601 5550177',
    900.00, 'Bodega secundaria Colombia', TRUE,
    NULL, NULL,
    '["RECEIVE","DISPATCH"]'::jsonb,
    'ACTIVE'
),
(
    '77777777-0000-4000-8000-000000000005',
    'N-PVG',    'Hub Shanghái PVG',    'HUB', 'CN', 'Shanghái',
    'Pudong Free Trade Zone',  'Asia/Shanghai',
    NULL, 'china@muitowork.com', '+86 21 55550100',
    NULL, 'Hub consolidación China — origen producción', TRUE,
    NULL, NULL,
    '["CONSOLIDATION","CUSTOMS","DISPATCH"]'::jsonb,
    'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 1. brands.marca  (4 marcas)
-- ────────────────────────────────────────────────────────────
INSERT INTO brands.marca (
    id, nombre, slug, pais_origen_iso2, categoria_principal,
    descripcion, estado_comercial, fecha_firma,
    territorios, markup_default, dias_pago_default, moneda_default,
    visibility_tier, is_active,
    issuing_entity_id, mercados_activos, min_margin_alert_pct,
    brand_code, tipo
) VALUES
(
    '99999999-0000-4000-8000-000000000001',
    'Rana Walk', 'rana-walk', 'PE', 'CALZADO',
    'Marca propia MWT — calzado casual premium.',
    'ACTIVO', '2024-03-12',
    '["PE","CO","MX","US"]'::jsonb, 2.80, 30, 'USD',
    'INTERNAL', TRUE,
    NULL,
    '["PE","CO","MX","US"]'::jsonb, 18.00,
    'RW', 'PROPIA'
),
(
    '99999999-0000-4000-8000-000000000002',
    'Sondel', 'sondel', 'BR', 'CALZADO',
    'Marca tercero — seguridad industrial Brasil.',
    'ACTIVO', '2023-08-01',
    '["CO","PE","EC"]'::jsonb, 2.20, 45, 'USD',
    'INTERNAL', TRUE,
    NULL,
    '["CO","PE"]'::jsonb, 12.00,
    'SND', 'TERCEROS'
),
(
    '99999999-0000-4000-8000-000000000003',
    'Marluvas', 'marluvas', 'BR', 'CALZADO',
    'Marca tercero — calzado seguridad (EPP) Brasil.',
    'ACTIVO', '2024-01-20',
    '["PE","CO","EC","BO"]'::jsonb, 2.10, 30, 'USD',
    'INTERNAL', TRUE,
    NULL,
    '["PE","CO"]'::jsonb, 10.00,
    'MLV', 'TERCEROS'
),
(
    '99999999-0000-4000-8000-000000000004',
    'Urban Pro', 'urban-pro', 'CN', 'ROPA',
    'Marca tercero — apparel técnico urbano.',
    'PROSPECTO', NULL,
    '["PE","CO"]'::jsonb, 2.50, 30, 'USD',
    'INTERNAL', TRUE,
    NULL,
    '[]'::jsonb, 14.00,
    'URB', 'TERCEROS'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. clientes.cliente  (5 cuentas B2B/retail)
-- ────────────────────────────────────────────────────────────
INSERT INTO clientes.cliente (
    id, razon_social, nombre_comercial, tax_id, tipo, segmento,
    pais_iso2, ciudad, direccion, moneda,
    credito_aprobado, credito_usado, dias_credito,
    contacto_nombre, contacto_email, contacto_tel,
    estado, nodo_asignado_id, responsable_id,
    visibility_tier, is_active,
    codigo_marluvas, canal, incoterm, medio_pago, direccion_entrega
) VALUES
(
    '88888888-0000-4000-8000-000000000001',
    'Sondel Importadora S.A.C.', 'Sondel Perú',
    '20512345678', 'B2B', 'A', 'PE', 'Lima',
    'Av. Javier Prado 1234, San Isidro', 'USD',
    120000.00, 42000.00, 30,
    'Juan Vargas', 'tesoreria@sondel.pe', '+51 1 2340011',
    'ACTIVO', '77777777-0000-4000-8000-000000000001',
    NULL, 'INTERNAL', TRUE,
    'SND-PE-001', 'distribuidor', 'FOB', 'Transferencia USD',
    'Av. Javier Prado 1234, San Isidro, Lima'
),
(
    '88888888-0000-4000-8000-000000000002',
    'Marluvas Distribuidora SAS', 'Marluvas Colombia',
    '900123456-1', 'B2B', 'A', 'CO', 'Bogotá',
    'Calle 100 #8-20', 'USD',
    80000.00, 18500.00, 45,
    'Laura Ríos', 'ap@marluvas.co', '+57 601 7340099',
    'ACTIVO', '77777777-0000-4000-8000-000000000002',
    NULL, 'INTERNAL', TRUE,
    'MLV-CO-002', 'distribuidor', 'CIF', 'Transferencia USD / ACH',
    'Calle 100 #8-20, Bogotá'
),
(
    '88888888-0000-4000-8000-000000000003',
    'Overseas Buyer LLC', 'Overseas US',
    'US-EIN-98-1234567', 'B2B', 'B', 'US', 'Miami',
    '1450 Brickell Ave, Suite 1100', 'USD',
    60000.00, 12900.00, 30,
    'John Pérez', 'ap@overseas-buyer.com', '+1 305 5550044',
    'ACTIVO', '77777777-0000-4000-8000-000000000003',
    NULL, 'INTERNAL', TRUE,
    'OVB-US-003', 'retail', 'DDP', 'Wire USD',
    '1450 Brickell Ave, Miami FL 33131'
),
(
    '88888888-0000-4000-8000-000000000004',
    'Retail Local Lima S.R.L.', 'RL Lima',
    '20556677889', 'B2B', 'C', 'PE', 'Lima',
    'Calle Los Olivos 245, Surco', 'PEN',
    18000.00, 3200.00, 15,
    'María Ñopo', 'compras@retail-local.pe', '+51 1 4448822',
    'ACTIVO', '77777777-0000-4000-8000-000000000001',
    NULL, 'INTERNAL', TRUE,
    NULL, 'retail', 'EXW', 'Transferencia PEN',
    'Calle Los Olivos 245, Surco, Lima'
),
(
    '88888888-0000-4000-8000-000000000005',
    'Distribuidora Mexicana del Norte S.A. de C.V.', 'DistNorte MX',
    'DMN120345H92', 'DISTRIBUIDOR', 'B', 'MX', 'Monterrey',
    'Av. Lázaro Cárdenas 2000', 'USD',
    45000.00, 0.00, 30,
    'Pedro Quintero', 'tesoreria@distnorte.mx', '+52 81 83334455',
    'ACTIVO', '77777777-0000-4000-8000-000000000001',
    NULL, 'INTERNAL', TRUE,
    'DMN-MX-005', 'distribuidor', 'FOB', 'Transferencia USD',
    'Av. Lázaro Cárdenas 2000, Monterrey'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. productos.producto  (6 SKUs)
-- ────────────────────────────────────────────────────────────
INSERT INTO productos.producto (
    id, sku, nombre, descripcion,
    marca_id, categoria, subcategoria, unidad,
    moneda, costo_estandar, precio_lista, precio_distribuidor,
    peso_kg, volumen_m3, imagen_url, ficha_url,
    tallas, colores,
    estado, proveedor_principal_id, pais_origen_iso2, hs_code,
    stock_minimo, stock_maximo, visibility_tier, is_active,
    precio_mwt, especificaciones
) VALUES
(
    '44444444-1111-4000-8000-000000000001',
    'RW-CLA-BLK', 'Rana Walk Classic · Negro',
    'Calzado casual unisex, plantilla eco-foam, horma ancha.',
    '99999999-0000-4000-8000-000000000001', 'CALZADO', 'CALZADO_CASUAL', 'PAR',
    'USD', 82.50, 155.00, 132.00,
    0.82, 0.0075, 'https://cdn.mwt.one/p/rw-cla-blk.webp', 'https://cdn.mwt.one/p/rw-cla-blk.pdf',
    '["37","38","39","40","41","42","43","44"]'::jsonb,
    '[{"code":"BLK","label":"Negro"}]'::jsonb,
    'ACTIVO', NULL, 'CN', '6403.99',
    120, 800, 'INTERNAL', TRUE,
    108.00,
    '{"material_upper":"malla técnica","suela":"EVA","horma":"AM-2","genero":"unisex"}'::jsonb
),
(
    '44444444-1111-4000-8000-000000000002',
    'RW-CLA-WHT', 'Rana Walk Classic · Blanco',
    'Mismo modelo, color blanco.',
    '99999999-0000-4000-8000-000000000001', 'CALZADO', 'CALZADO_CASUAL', 'PAR',
    'USD', 82.50, 155.00, 132.00,
    0.82, 0.0075, 'https://cdn.mwt.one/p/rw-cla-wht.webp', 'https://cdn.mwt.one/p/rw-cla-wht.pdf',
    '["37","38","39","40","41","42","43","44"]'::jsonb,
    '[{"code":"WHT","label":"Blanco"}]'::jsonb,
    'ACTIVO', NULL, 'CN', '6403.99',
    120, 800, 'INTERNAL', TRUE,
    108.00,
    '{"material_upper":"malla técnica","suela":"EVA","horma":"AM-2","genero":"unisex"}'::jsonb
),
(
    '44444444-1111-4000-8000-000000000003',
    'RW-PRO-BLU', 'Rana Walk Pro · Azul',
    'Versión Pro — suela reforzada, antideslizante certificado.',
    '99999999-0000-4000-8000-000000000001', 'CALZADO', 'CALZADO_DEPORTIVO', 'PAR',
    'USD', 95.00, 175.00, 149.00,
    0.95, 0.0080, 'https://cdn.mwt.one/p/rw-pro-blu.webp', NULL,
    '["38","39","40","41","42","43","44"]'::jsonb,
    '[{"code":"BLU","label":"Azul"}]'::jsonb,
    'ACTIVO', NULL, 'CN', '6403.99',
    80, 500, 'INTERNAL', TRUE,
    124.00,
    '{"material_upper":"cuero sintético","suela":"TPU","certificacion":"SRC","genero":"unisex"}'::jsonb
),
(
    '44444444-1111-4000-8000-000000000004',
    'SND-SAFE-BLK', 'Sondel Safety Boot · Negro',
    'Bota de seguridad con puntera de acero.',
    '99999999-0000-4000-8000-000000000002', 'CALZADO', 'CALZADO_SEGURIDAD', 'PAR',
    'USD', 64.00, 128.00, 112.00,
    1.30, 0.0090, 'https://cdn.mwt.one/p/snd-safe-blk.webp', NULL,
    '["38","39","40","41","42","43","44","45"]'::jsonb,
    '[{"code":"BLK","label":"Negro"}]'::jsonb,
    'ACTIVO', NULL, 'BR', '6403.40',
    100, 600, 'INTERNAL', TRUE,
    89.00,
    '{"tipo_puntera":"acero","normativa":"EN ISO 20345","suela":"poliuretano","genero":"unisex"}'::jsonb
),
(
    '44444444-1111-4000-8000-000000000005',
    'SND-LIGHT-BRW', 'Sondel LightSafe · Café',
    'Zapatilla seguridad ligera, puntera composite.',
    '99999999-0000-4000-8000-000000000002', 'CALZADO', 'CALZADO_SEGURIDAD', 'PAR',
    'USD', 58.00, 115.00, 99.00,
    0.90, 0.0075, 'https://cdn.mwt.one/p/snd-light-brw.webp', NULL,
    '["38","39","40","41","42","43","44"]'::jsonb,
    '[{"code":"BRW","label":"Café"}]'::jsonb,
    'ACTIVO', NULL, 'BR', '6403.40',
    100, 600, 'INTERNAL', TRUE,
    78.00,
    '{"tipo_puntera":"composite","normativa":"EN ISO 20345","suela":"EVA+caucho","genero":"unisex"}'::jsonb
),
(
    '44444444-1111-4000-8000-000000000006',
    'MLV-MAX-BLK', 'Marluvas Max Industrial · Negro',
    'Bota industrial alta — electrostática.',
    '99999999-0000-4000-8000-000000000003', 'CALZADO', 'CALZADO_SEGURIDAD', 'PAR',
    'USD', 72.00, 138.00, 118.00,
    1.40, 0.0095, 'https://cdn.mwt.one/p/mlv-max-blk.webp', NULL,
    '["39","40","41","42","43","44","45"]'::jsonb,
    '[{"code":"BLK","label":"Negro"}]'::jsonb,
    'ACTIVO', NULL, 'BR', '6403.40',
    80, 400, 'INTERNAL', TRUE,
    96.00,
    '{"tipo_puntera":"acero","normativa":"EN ISO 20345 S3","electrostatica":true,"genero":"unisex"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. proveedores.proveedor  (4 proveedores)
-- ────────────────────────────────────────────────────────────
INSERT INTO proveedores.proveedor (
    id, codigo, razon_social, nombre_comercial, tax_id, tipo, estado,
    pais_iso2, ciudad, contacto_nombre, contacto_email, contacto_tel,
    moneda_default, incoterm_default, lead_time_dias, moq,
    condiciones_pago, dias_credito, rating, categorias, certificaciones,
    visibility_tier, is_active,
    clase, score_iso, producto_servicio
) VALUES
(
    '55555555-1111-4000-8000-000000000001',
    'PRV-CN-JJ', 'Jinjiang Footwear Co. Ltd.', 'Jinjiang CN',
    'CN-91350582', 'FABRICANTE', 'ACTIVO',
    'CN', 'Jinjiang', 'Lei Zhao', 'sales@jinjiang-footwear.cn', '+86 595 5550100',
    'USD', 'FOB', 60, 500,
    '30% anticipo · 70% B/L', 30, 4.35,
    '["calzado","moldes"]'::jsonb,
    '["ISO9001","BSCI"]'::jsonb,
    'INTERNAL', TRUE,
    'CRITICO', 4.35, 'Fabricación calzado Rana Walk + Urban Pro'
),
(
    '55555555-1111-4000-8000-000000000002',
    'PRV-PE-ABC', 'Calzados ABC S.A.', 'ABC Perú',
    '20411223344', 'FABRICANTE', 'ACTIVO',
    'PE', 'Trujillo', 'Andrés Calle', 'comercial@calzados-abc.pe', '+51 44 5550199',
    'USD', 'EXW', 45, 200,
    '50% anticipo · 50% entrega', 15, 3.80,
    '["calzado","cuero"]'::jsonb,
    '["ISO14001"]'::jsonb,
    'INTERNAL', TRUE,
    'NORMAL', 3.80, 'Fabricación complementaria Rana Walk'
),
(
    '55555555-1111-4000-8000-000000000003',
    'PRV-SDX', 'Sedexp Logistics S.A.', 'Sedexp',
    '20123123123', 'DISTRIBUIDOR', 'ACTIVO',
    'PE', 'Callao', 'Ximena Solís', 'ops@sedexp.pe', '+51 1 5550088',
    'USD', 'DAP', 7, 0,
    'Transferencia 15 días', 15, 4.10,
    '["logistica","transporte"]'::jsonb,
    '["BASC"]'::jsonb,
    'INTERNAL', TRUE,
    'NORMAL', 4.10, 'Flete marítimo + aéreo'
),
(
    '55555555-1111-4000-8000-000000000004',
    'PRV-ADS', 'Aduanas Silva S.C.R.L.', 'Silva Aduanas',
    '20987654321', 'DISTRIBUIDOR', 'ACTIVO',
    'PE', 'Callao', 'Oscar Silva', 'operaciones@aduanas-silva.pe', '+51 1 5550077',
    'USD', 'DAP', 3, 0,
    'Transferencia contra DUA', 0, 4.60,
    '["aduana"]'::jsonb,
    '["OEA"]'::jsonb,
    'INTERNAL', TRUE,
    'CRITICO', 4.60, 'Agente aduanero SUNAT — importaciones'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 5. inventario.stock  (8 filas)
-- ────────────────────────────────────────────────────────────
INSERT INTO inventario.stock (
    id, nodo_id, producto_id, lote, fecha_vencimiento,
    cantidad_disponible, cantidad_reservada, cantidad_en_transito,
    costo_unitario_usd, ubicacion_fisica, last_movement_at, is_active,
    vendidos, lote_code, recibido_en
) VALUES
-- Callao · Rana Walk Classic Negro
(
    '66666666-1111-4000-8000-000000000001',
    '77777777-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000001',
    'L-RW-CLA-BLK-2026-01', NULL,
    420.000, 24.000, 0.000, 82.5000,
    'A-12-03', '2026-04-17 09:00:00', TRUE,
    260.000, 'L-RW-CLA-BLK-2026-01', '2026-02-18 08:30:00'
),
-- Callao · Rana Walk Classic Blanco
(
    '66666666-1111-4000-8000-000000000002',
    '77777777-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000002',
    'L-RW-CLA-WHT-2026-01', NULL,
    380.000, 12.000, 60.000, 82.5000,
    'A-12-04', '2026-04-16 17:45:00', TRUE,
    220.000, 'L-RW-CLA-WHT-2026-01', '2026-02-18 08:45:00'
),
-- Callao · Rana Walk Pro Azul
(
    '66666666-1111-4000-8000-000000000003',
    '77777777-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000003',
    'L-RW-PRO-BLU-2026-02', NULL,
    180.000, 6.000, 0.000, 95.0000,
    'B-04-09', '2026-04-10 11:20:00', TRUE,
    95.000, 'L-RW-PRO-BLU-2026-02', '2026-03-06 10:00:00'
),
-- FBA LGB8 · Rana Walk Classic Negro
(
    '66666666-1111-4000-8000-000000000004',
    '77777777-0000-4000-8000-000000000003',
    '44444444-1111-4000-8000-000000000001',
    'L-RW-CLA-BLK-2026-01', NULL,
    120.000, 6.000, 60.000, 88.0000,
    'FBA-AMZ-LGB8', '2026-04-18 22:10:00', TRUE,
    540.000, 'L-RW-CLA-BLK-2026-01', '2026-03-22 14:00:00'
),
-- Medellín · Sondel Safety Boot Negro
(
    '66666666-1111-4000-8000-000000000005',
    '77777777-0000-4000-8000-000000000002',
    '44444444-1111-4000-8000-000000000004',
    'L-SND-SAFE-2026-03', NULL,
    210.000, 0.000, 0.000, 64.0000,
    'MDE-C-14', '2026-04-12 09:30:00', TRUE,
    145.000, 'L-SND-SAFE-2026-03', '2026-03-30 11:00:00'
),
-- Bogotá · Sondel LightSafe Café
(
    '66666666-1111-4000-8000-000000000006',
    '77777777-0000-4000-8000-000000000004',
    '44444444-1111-4000-8000-000000000005',
    'L-SND-LIGHT-2026-02', NULL,
    95.000, 0.000, 0.000, 58.0000,
    'BOG-B-02', '2026-04-05 10:15:00', TRUE,
    80.000, 'L-SND-LIGHT-2026-02', '2026-03-15 12:00:00'
),
-- Callao · Marluvas Max
(
    '66666666-1111-4000-8000-000000000007',
    '77777777-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000006',
    'L-MLV-MAX-2026-02', NULL,
    160.000, 18.000, 40.000, 72.0000,
    'C-03-01', '2026-04-14 16:20:00', TRUE,
    72.000, 'L-MLV-MAX-2026-02', '2026-03-12 09:00:00'
),
-- Shanghái · Rana Walk Pro Azul (producción salida)
(
    '66666666-1111-4000-8000-000000000008',
    '77777777-0000-4000-8000-000000000005',
    '44444444-1111-4000-8000-000000000003',
    'L-RW-PRO-BLU-2026-03', NULL,
    0.000, 0.000, 240.000, 95.0000,
    'PVG-CY-AREA-3', '2026-04-17 03:00:00', TRUE,
    0.000, 'L-RW-PRO-BLU-2026-03', '2026-04-17 03:00:00'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 6. expedientes.oc  (3 OCs) + expediente + linea + documento
-- ────────────────────────────────────────────────────────────
INSERT INTO expedientes.oc (
    id, codigo, client_id, brand_id, proforma, sap, estado,
    moneda, issued_at, total_value, total_invoiced, total_paid, balance,
    coverage_pct, lines_count, lines_with_sap,
    air_pct, sea_pct, credit_days_max, credit_band,
    notas, visibility_tier, is_active
) VALUES
(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'PO-2026-04100',
    '88888888-0000-4000-8000-000000000001',          -- Sondel PE
    '99999999-0000-4000-8000-000000000001',          -- Rana Walk
    'PF-2026-0142', 'SAP-502147', 'EN_EJECUCION',
    'USD', '2026-03-10',
    24820.00, 24820.00, 12410.00, 12410.00,
    1.0000, 3, 3,
    0.2500, 0.7500, 30, 'GREEN',
    'Primera OC Sondel 2026 — mix Classic/Pro', 'INTERNAL', TRUE
),
(
    'aaaaaaaa-0000-4000-8000-000000000002',
    'PO-2026-04101',
    '88888888-0000-4000-8000-000000000003',          -- Overseas US
    '99999999-0000-4000-8000-000000000001',          -- Rana Walk
    'PF-2026-0156', 'SAP-502298', 'EMITIDA',
    'USD', '2026-04-05',
    12900.00, 12900.00, 0.00, 12900.00,
    0.6667, 3, 2,
    1.0000, 0.0000, 30, 'AMBER',
    'OC US aéreo — necesita aprobación producción', 'INTERNAL', TRUE
),
(
    'aaaaaaaa-0000-4000-8000-000000000003',
    'PO-2026-03090',
    '88888888-0000-4000-8000-000000000002',          -- Marluvas CO
    '99999999-0000-4000-8000-000000000003',          -- Marluvas brand
    'PF-2026-0098', 'SAP-502060', 'CERRADO',
    'USD', '2026-02-18',
    18500.00, 18500.00, 18500.00, 0.00,
    1.0000, 2, 2,
    0.0000, 1.0000, 45, 'GREEN',
    'OC cerrada Q1 — entregada completa', 'INTERNAL', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- expedientes (4) — cada OC puede tener 1+ expedientes
INSERT INTO expedientes.expediente (
    id, codigo, oc_id, client_id, brand_id, sap,
    estado, modo_operacion, incoterm, freight_mode, dispatch_mode,
    origin, destination, origin_country, destination_country,
    shipment_date, eta, container_count, product_count,
    moneda, total_cost, total_invoiced, total_paid, balance,
    commission_pct, dai_pct, iva_pct, logistic_cost, base_price,
    deferred_total_price, show_deferred_to_client,
    projected_margin, real_margin,
    pg_verified, pg_released, pg_pending, pg_rejected,
    credit_days, credit_band, is_blocked,
    artifacts_done, artifacts_total,
    baseline_days, time_in_phase, phase_ratio, phase_signal,
    last_event_at,
    proforma_reviewed, notas, visibility_tier, is_active,
    numero_sap, fecha_produccion_estimada, price_basis,
    transport_mode, parent_expediente_id,
    is_inverted_child, deferred_visible
) VALUES
-- EXP-1 · PO-2026-04100 Sondel — Clásico Negro (ya en destino)
(
    'bbbbbbbb-0000-4000-8000-000000000001',
    'EXP-1027', 'aaaaaaaa-0000-4000-8000-000000000001',
    '88888888-0000-4000-8000-000000000001',
    '99999999-0000-4000-8000-000000000001',
    'SAP-502147', 'EN_DESTINO', 'FULL', 'FOB', 'SEA', 'FCL',
    'Shanghái PVG', 'Callao PE', 'CN', 'PE',
    '2026-03-05', '2026-04-10', 1, 300,
    'USD', 16220.00, 16220.00, 8110.00, 8110.00,
    NULL, 0.1100, 0.1800, 2640.00, 13580.00,
    0.00, FALSE,
    0.2800, 0.2620,
    8110.00, 8110.00, 0.00, 0.00,
    30, 'GREEN', FALSE,
    6, 6,
    7, 4, 0.571, 'green',
    '2026-04-10 14:20:00',
    TRUE, 'Llegó a Callao — pendiente última liberación pago.',
    'INTERNAL', TRUE,
    'SAP-502147', '2026-03-25', 'fob',
    'maritimo', NULL,
    FALSE, FALSE
),
-- EXP-2 · PO-2026-04100 Sondel — Pro Azul (en tránsito)
(
    'bbbbbbbb-0000-4000-8000-000000000002',
    'EXP-1028', 'aaaaaaaa-0000-4000-8000-000000000001',
    '88888888-0000-4000-8000-000000000001',
    '99999999-0000-4000-8000-000000000001',
    'SAP-502148', 'TRANSITO', 'FULL', 'FOB', 'SEA', 'LCL',
    'Shanghái PVG', 'Callao PE', 'CN', 'PE',
    '2026-04-15', '2026-05-08', 0, 240,
    'USD', 8600.00, 8600.00, 4300.00, 4300.00,
    NULL, 0.1100, 0.1800, 1320.00, 7280.00,
    0.00, FALSE,
    0.2900, NULL,
    4300.00, 4300.00, 0.00, 0.00,
    30, 'GREEN', FALSE,
    4, 6,
    28, 5, 0.179, 'green',
    '2026-04-17 03:00:00',
    TRUE, 'Zarpó PVG el 2026-04-15.', 'INTERNAL', TRUE,
    'SAP-502148', '2026-04-01', 'fob',
    'maritimo', 'bbbbbbbb-0000-4000-8000-000000000001',
    FALSE, FALSE
),
-- EXP-3 · PO-2026-04101 Overseas US — aéreo (REGISTRO)
(
    'bbbbbbbb-0000-4000-8000-000000000003',
    'EXP-1030', 'aaaaaaaa-0000-4000-8000-000000000002',
    '88888888-0000-4000-8000-000000000003',
    '99999999-0000-4000-8000-000000000001',
    'SAP-502298', 'REGISTRO', 'FULL', 'DDP', 'AIR', 'LCL',
    'Callao PE', 'Long Beach US', 'PE', 'US',
    NULL, '2026-05-02', 0, 150,
    'USD', 9100.00, 12900.00, 0.00, 12900.00,
    NULL, 0.0000, 0.0000, 2400.00, 10500.00,
    0.00, FALSE,
    0.3100, NULL,
    0.00, 0.00, 12900.00, 0.00,
    30, 'AMBER', FALSE,
    2, 6,
    3, 1, 0.333, 'amber',
    '2026-04-17 10:05:00',
    FALSE, 'Pendiente crédito — AMBER', 'INTERNAL', TRUE,
    'SAP-502298', '2026-04-22', 'ddp',
    'aereo', NULL,
    FALSE, TRUE
),
-- EXP-4 · PO-2026-04101 Overseas US — producción (PRODUCCIÓN)
(
    'bbbbbbbb-0000-4000-8000-000000000004',
    'EXP-1031', 'aaaaaaaa-0000-4000-8000-000000000002',
    '88888888-0000-4000-8000-000000000003',
    '99999999-0000-4000-8000-000000000001',
    'SAP-502299', 'PRODUCCION', 'FULL', 'DDP', 'SEA', 'FCL',
    'Shanghái PVG', 'Long Beach US', 'CN', 'US',
    NULL, '2026-06-14', 1, 400,
    'USD', 22400.00, 0.00, 0.00, 0.00,
    NULL, 0.0000, 0.0000, 4800.00, 17600.00,
    0.00, FALSE,
    0.2700, NULL,
    0.00, 0.00, 0.00, 0.00,
    30, 'GREEN', FALSE,
    3, 6,
    32, 12, 0.375, 'green',
    '2026-04-16 08:30:00',
    TRUE, 'En fábrica — producción en curso.', 'INTERNAL', TRUE,
    'SAP-502299', '2026-05-10', 'ddp',
    'maritimo', NULL,
    FALSE, FALSE
)
ON CONFLICT (id) DO NOTHING;

-- líneas (6 — distribuidas en 4 expedientes)
INSERT INTO expedientes.linea (
    id, oc_id, expediente_id, producto_id, sku, size,
    qty, unit_cost, unit_price, total_price, sap,
    transport_mode, production_date, estado,
    deferred_qty, deferred_unit_price, show_deferred_to_client,
    notas, is_active
) VALUES
-- EXP-1027 · Classic Negro talla 40 (120 pares)
(
    'cccccccc-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000001',
    'RW-CLA-BLK', '40', 120, 82.50, 132.00, 15840.00,
    'SAP-502147', 'MARITIMO', '2026-03-01', 'CERRADO',
    0, 0, FALSE, NULL, TRUE
),
-- EXP-1027 · Classic Blanco talla 39 (80 pares)
(
    'cccccccc-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    '44444444-1111-4000-8000-000000000002',
    'RW-CLA-WHT', '39', 80, 82.50, 132.00, 10560.00,
    'SAP-502147', 'MARITIMO', '2026-03-01', 'CERRADO',
    0, 0, FALSE, NULL, TRUE
),
-- EXP-1028 · Pro Azul talla 42 (100 pares)
(
    'cccccccc-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    '44444444-1111-4000-8000-000000000003',
    'RW-PRO-BLU', '42', 100, 95.00, 149.00, 14900.00,
    'SAP-502148', 'MARITIMO', '2026-04-05', 'TRANSITO',
    0, 0, FALSE, NULL, TRUE
),
-- EXP-1030 · Classic Negro talla 41 (150 pares) aéreo
(
    'cccccccc-0000-4000-8000-000000000004',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000003',
    '44444444-1111-4000-8000-000000000001',
    'RW-CLA-BLK', '41', 150, 88.00, 155.00, 23250.00,
    'SAP-502298', 'AEREO', NULL, 'PENDIENTE_SAP',
    0, 0, FALSE, 'Pend. crédito cliente', TRUE
),
-- EXP-1031 · Pro Azul talla 43 (200 pares)
(
    'cccccccc-0000-4000-8000-000000000005',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000004',
    '44444444-1111-4000-8000-000000000003',
    'RW-PRO-BLU', '43', 200, 95.00, 149.00, 29800.00,
    'SAP-502299', 'MARITIMO', '2026-05-08', 'EN_PRODUCCION',
    0, 0, FALSE, NULL, TRUE
),
-- OC-CERRADA (PO-2026-03090) · Marluvas Max talla 42 (130 pares)
(
    'cccccccc-0000-4000-8000-000000000006',
    'aaaaaaaa-0000-4000-8000-000000000003',
    NULL,
    '44444444-1111-4000-8000-000000000006',
    'MLV-MAX-BLK', '42', 130, 72.00, 118.00, 15340.00,
    'SAP-502060', 'MARITIMO', '2026-02-15', 'CERRADO',
    0, 0, FALSE, 'OC cerrada', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- documentos (6 — ART-01..ART-06 style)
INSERT INTO expedientes.documento (
    id, oc_id, expediente_id, kind, codigo,
    file_ext, file_size_bytes, storage_url, author, fecha, is_active
) VALUES
(
    'dddddddd-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001', NULL,
    'OC Cliente', 'ART-01 / PO-2026-04100',
    'pdf', 482311,
    's3://mwt-docs/oc/PO-2026-04100.pdf',
    'Sondel Importadora', '2026-03-10', TRUE
),
(
    'dddddddd-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001', NULL,
    'Proforma', 'ART-02 / PF-2026-0142',
    'pdf', 214099,
    's3://mwt-docs/proforma/PF-2026-0142.pdf',
    'MWT Facturación', '2026-03-11', TRUE
),
(
    'dddddddd-0000-4000-8000-000000000003',
    NULL, 'bbbbbbbb-0000-4000-8000-000000000001',
    'BL', 'ART-03 / BL-MSK2026030511',
    'pdf', 1842003,
    's3://mwt-docs/bl/BL-MSK2026030511.pdf',
    'Maersk', '2026-03-06', TRUE
),
(
    'dddddddd-0000-4000-8000-000000000004',
    NULL, 'bbbbbbbb-0000-4000-8000-000000000001',
    'DUA', 'ART-04 / SAP-502147',
    'pdf', 612400,
    's3://mwt-docs/dua/SAP-502147.pdf',
    'Aduanas Silva', '2026-04-08', TRUE
),
(
    'dddddddd-0000-4000-8000-000000000005',
    NULL, 'bbbbbbbb-0000-4000-8000-000000000003',
    'Factura', 'ART-05 / INV-2026-0301',
    'pdf', 198220,
    's3://mwt-docs/invoice/INV-2026-0301.pdf',
    'MWT Facturación', '2026-04-05', TRUE
),
(
    'dddddddd-0000-4000-8000-000000000006',
    NULL, 'bbbbbbbb-0000-4000-8000-000000000004',
    'Ficha Técnica', 'ART-06 / FT-RW-PRO-BLU',
    'pdf', 87402,
    's3://mwt-docs/ft/FT-RW-PRO-BLU.pdf',
    'MWT Producto', '2026-03-20', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 7. cobros.cobro  (3 agrupadores) + cobros.pago  (5 movimientos)
-- ────────────────────────────────────────────────────────────
INSERT INTO cobros.cobro (
    id, codigo, oc_id, expediente_id, client_id,
    moneda, monto_total, monto_pagado, fecha_vencimiento,
    dias_credito, estado, notas, visibility_tier, is_active
) VALUES
(
    'eeeeeeee-0000-4000-8000-000000000001',
    'CBR-2026-0001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    '88888888-0000-4000-8000-000000000001',
    'USD', 24820.00, 12410.00, '2026-05-10',
    30, 'PARCIAL', 'Primer 50% recibido, pendiente 50%',
    'INTERNAL', TRUE
),
(
    'eeeeeeee-0000-4000-8000-000000000002',
    'CBR-2026-0002',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000003',
    '88888888-0000-4000-8000-000000000003',
    'USD', 12900.00, 0.00, '2026-05-05',
    30, 'PENDIENTE', 'Pendiente anticipo — bloqueado crédito AMBER',
    'INTERNAL', TRUE
),
(
    'eeeeeeee-0000-4000-8000-000000000003',
    'CBR-2026-0003',
    'aaaaaaaa-0000-4000-8000-000000000003',
    NULL,
    '88888888-0000-4000-8000-000000000002',
    'USD', 18500.00, 18500.00, '2026-04-05',
    45, 'CONCILIADO', 'Cobro completo Marluvas Q1',
    'INTERNAL', TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cobros.pago (
    id, codigo, direccion, cobro_id, oc_id, expediente_id,
    client_id, proveedor_id, metodo, referencia_externa,
    banco_origen, banco_destino, moneda, monto, fx_rate, monto_usd,
    estado, fecha_operacion, fecha_acreditacion, verificado_at,
    liberado_at, conciliado_at, comprobante_url, notas,
    visibility_tier, is_active,
    proforma_id, rejection_reason, credit_released_at, credit_released_by_id
) VALUES
-- Pago 1 — INGRESO anticipo Sondel (verificado + liberado)
(
    'ffffffff-0000-4000-8000-000000000001',
    'PAG-2026-00001', 'INGRESO',
    'eeeeeeee-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    '88888888-0000-4000-8000-000000000001', NULL,
    'WIRE_SWIFT', 'SWIFT-BCP-987654',
    'BCP (Sondel)', 'Scotiabank MWT', 'USD',
    12410.00, 1.000000, 12410.00,
    'LIBERADO', '2026-03-12', '2026-03-13',
    '2026-03-13 09:30:00+00', '2026-03-13 10:00:00+00', NULL,
    's3://mwt-docs/pagos/PAG-2026-00001.pdf',
    'Anticipo 50% PO-2026-04100',
    'INTERNAL', TRUE,
    NULL, NULL, '2026-03-13 10:00:00+00', NULL
),
-- Pago 2 — INGRESO rechazado (Overseas US)
(
    'ffffffff-0000-4000-8000-000000000002',
    'PAG-2026-00002', 'INGRESO',
    'eeeeeeee-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000003',
    '88888888-0000-4000-8000-000000000003', NULL,
    'WIRE_SWIFT', 'SWIFT-OVB-555112',
    'Chase (Overseas)', 'Scotiabank MWT', 'USD',
    3000.00, 1.000000, 3000.00,
    'RECHAZADO', '2026-04-09', NULL,
    NULL, NULL, NULL,
    NULL,
    'Monto no coincide con PF-2026-0156 (USD 12,900)',
    'INTERNAL', TRUE,
    NULL, 'Monto parcial no aceptado — se requiere el anticipo total según política DDP',
    NULL, NULL
),
-- Pago 3 — EGRESO a proveedor Jinjiang CN (conciliado)
(
    'ffffffff-0000-4000-8000-000000000003',
    'PAG-2026-00003', 'EGRESO',
    NULL,
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    NULL, '55555555-1111-4000-8000-000000000001',
    'WIRE_SWIFT', 'SWIFT-OUT-20260220',
    'Scotiabank MWT', 'ICBC (Jinjiang)', 'USD',
    4860.00, 1.000000, 4860.00,
    'CONCILIADO', '2026-02-20', '2026-02-21',
    '2026-02-21 08:30:00+00', '2026-02-21 09:00:00+00',
    '2026-02-22 11:00:00+00',
    's3://mwt-docs/pagos/PAG-2026-00003.pdf',
    '30% anticipo fábrica — PO PVG-lot-202602',
    'INTERNAL', TRUE,
    NULL, NULL, NULL, NULL
),
-- Pago 4 — INGRESO Marluvas CO (conciliado completo)
(
    'ffffffff-0000-4000-8000-000000000004',
    'PAG-2026-00004', 'INGRESO',
    'eeeeeeee-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000003',
    NULL,
    '88888888-0000-4000-8000-000000000002', NULL,
    'TRANSFERENCIA', 'REF-BANCOL-2026-0401',
    'Bancolombia', 'Scotiabank MWT', 'USD',
    18500.00, 1.000000, 18500.00,
    'CONCILIADO', '2026-04-01', '2026-04-02',
    '2026-04-02 09:00:00+00', '2026-04-02 09:30:00+00',
    '2026-04-03 10:00:00+00',
    's3://mwt-docs/pagos/PAG-2026-00004.pdf',
    'Cierre total cobranza Marluvas Q1',
    'INTERNAL', TRUE,
    NULL, NULL, '2026-04-02 09:30:00+00', NULL
),
-- Pago 5 — EGRESO agente aduanero (verificado)
(
    'ffffffff-0000-4000-8000-000000000005',
    'PAG-2026-00005', 'EGRESO',
    NULL,
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    NULL, '55555555-1111-4000-8000-000000000004',
    'TRANSFERENCIA', 'REF-TX-20260408-SILVA',
    'Scotiabank MWT', 'BCP (Silva Aduanas)', 'USD',
    1485.00, 1.000000, 1485.00,
    'VERIFICADO', '2026-04-08', '2026-04-09',
    '2026-04-09 11:00:00+00', NULL, NULL,
    's3://mwt-docs/pagos/PAG-2026-00005.pdf',
    'Aranceles DUA SAP-502147',
    'INTERNAL', TRUE,
    NULL, NULL, NULL, NULL
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8. transfers.transferencia  (preservado del seed anterior — 2 transfers)
-- ────────────────────────────────────────────────────────────
INSERT INTO transfers.transferencia (
    id, codigo,
    origen_id, destino_id, origen_label, destino_label,
    legal_context, estado, ref_tracking, needs_approval, value_usd, notes,
    created_by_id, created_by_name, approved_by_id, approved_by_name,
    dispatched_at, eta, received_at, is_active
) VALUES
(
    '11111111-1111-4111-8111-111111111001',
    'TRF-2026-0001',
    '77777777-0000-4000-8000-000000000001',          -- Callao
    '77777777-0000-4000-8000-000000000003',          -- FBA LGB8
    'HQ Callao', 'FBA US · LGB8',
    'DISTRIBUTION', 'IN_TRANSIT', 'AWB-982-74651231', FALSE, 14820.00,
    'Seed demo — envío FBA Q2',
    NULL, 'Alejandro (seed)', NULL, 'Alejandro (seed)',
    '2026-04-10', '2026-04-25', NULL, TRUE
),
(
    '11111111-1111-4111-8111-111111111002',
    'TRF-2026-0002',
    '77777777-0000-4000-8000-000000000001',          -- Callao
    '77777777-0000-4000-8000-000000000004',          -- Bogotá
    'HQ Callao', 'Bodega Bogotá',
    'INTERNAL', 'PLANNED', NULL, FALSE, 3260.00,
    'Seed demo — traslado interno',
    NULL, 'Alejandro (seed)', NULL, NULL,
    NULL, '2026-04-30', NULL, TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfers.linea (
    id, transferencia_id, producto_id, sku, product_label, size,
    qty_transfer, qty_reserve, qty_received, unit_cost, unit_value, is_active
) VALUES
(
    '22222222-2222-4222-8222-222222222001',
    '11111111-1111-4111-8111-111111111001',
    '44444444-1111-4000-8000-000000000001',
    'RW-CLA-BLK-38', 'Rana Walk Classic · Negro · 38', '38',
    60, 6, NULL, 82.50, 140.00, TRUE
),
(
    '22222222-2222-4222-8222-222222222002',
    '11111111-1111-4111-8111-111111111001',
    '44444444-1111-4000-8000-000000000001',
    'RW-CLA-BLK-39', 'Rana Walk Classic · Negro · 39', '39',
    60, 6, NULL, 82.50, 140.00, TRUE
),
(
    '22222222-2222-4222-8222-222222222003',
    '11111111-1111-4111-8111-111111111002',
    '44444444-1111-4000-8000-000000000003',
    'RW-PRO-WHT-40', 'Rana Walk Pro · Blanco · 40', '40',
    24, 2, NULL, 95.00, 155.00, TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfers.evento (
    id, transferencia_id, estado_prev, estado_nuevo,
    actor_id, actor_name, notes, created_at
) VALUES
(
    '33333333-3333-4333-8333-333333333001',
    '11111111-1111-4111-8111-111111111001',
    NULL, 'PLANNED',
    NULL, 'system (seed)', 'Creada por seed inicial',
    '2026-04-08 10:00:00'
),
(
    '33333333-3333-4333-8333-333333333002',
    '11111111-1111-4111-8111-111111111001',
    'PLANNED', 'APPROVED',
    NULL, 'Alejandro (seed)', 'Aprobada para despacho',
    '2026-04-09 14:20:00'
),
(
    '33333333-3333-4333-8333-333333333003',
    '11111111-1111-4111-8111-111111111001',
    'APPROVED', 'IN_TRANSIT',
    NULL, 'Alejandro (seed)', 'Despachada a FBA',
    '2026-04-10 09:00:00'
),
(
    '33333333-3333-4333-8333-333333333004',
    '11111111-1111-4111-8111-111111111002',
    NULL, 'PLANNED',
    NULL, 'system (seed)', 'Creada por seed inicial',
    '2026-04-15 11:30:00'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 9. email_templates.template  (preservado — 6 templates ES/EN)
-- ────────────────────────────────────────────────────────────
INSERT INTO email_templates.template (
    id, name, template_key, language, brand, brand_id,
    subject_template, body_template, variables_meta,
    sent_count_30d, is_active
) VALUES
(
    '44444444-4444-4444-8444-444444444001',
    'Expediente registrado (ES)',
    'expediente.registered', 'ES', 'GLOBAL', NULL,
    'Hemos recibido tu OC {{ expediente.codigo }}',
    'Hola {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'Registramos la OC {{ expediente.codigo }} por un monto total de {{ expediente.total | money }}.' || chr(10) ||
    'Iniciaremos la operación y te avisaremos al despacho.' || chr(10) || chr(10) ||
    'Gracias,' || chr(10) || 'Equipo MWT.ONE',
    '[
      {"name": "cliente.nombre",      "kind": "string", "required": true},
      {"name": "expediente.codigo",   "kind": "string", "required": true},
      {"name": "expediente.total",    "kind": "money",  "required": true}
    ]'::jsonb,
    4, TRUE
),
(
    '44444444-4444-4444-8444-444444444002',
    'Purchase order received (EN)',
    'expediente.registered', 'EN', 'GLOBAL', NULL,
    'We received your PO {{ expediente.codigo }}',
    'Hi {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'We registered PO {{ expediente.codigo }} for {{ expediente.total | money }}.' || chr(10) ||
    'We will start the operation and notify you at dispatch.' || chr(10) || chr(10) ||
    'Thanks,' || chr(10) || 'MWT.ONE Team',
    '[
      {"name": "cliente.nombre",      "kind": "string", "required": true},
      {"name": "expediente.codigo",   "kind": "string", "required": true},
      {"name": "expediente.total",    "kind": "money",  "required": true}
    ]'::jsonb,
    2, TRUE
),
(
    '44444444-4444-4444-8444-444444444003',
    'Envío de proforma (ES)',
    'proforma.sent', 'ES', 'GLOBAL', NULL,
    'Proforma {{ proforma.codigo }} — {{ proforma.total | money }}',
    'Hola {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'Adjuntamos la proforma {{ proforma.codigo }} por {{ proforma.total | money }}.' || chr(10) ||
    'Vence: {{ proforma.vencimiento }}.' || chr(10) || chr(10) ||
    'Medios de pago habilitados: transferencia USD · ACH.' || chr(10) || chr(10) ||
    'Saludos,' || chr(10) || 'Equipo MWT.ONE',
    '[
      {"name": "cliente.nombre",       "kind": "string", "required": true},
      {"name": "proforma.codigo",      "kind": "string", "required": true},
      {"name": "proforma.total",       "kind": "money",  "required": true},
      {"name": "proforma.vencimiento", "kind": "date",   "required": true}
    ]'::jsonb,
    11, TRUE
),
(
    '44444444-4444-4444-8444-444444444004',
    'Proforma sent (EN)',
    'proforma.sent', 'EN', 'GLOBAL', NULL,
    'Proforma {{ proforma.codigo }} — {{ proforma.total | money }}',
    'Hi {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'Attached is proforma {{ proforma.codigo }} for {{ proforma.total | money }}.' || chr(10) ||
    'Due date: {{ proforma.vencimiento }}.' || chr(10) || chr(10) ||
    'Payment methods: USD wire · ACH.' || chr(10) || chr(10) ||
    'Regards,' || chr(10) || 'MWT.ONE Team',
    '[
      {"name": "cliente.nombre",       "kind": "string", "required": true},
      {"name": "proforma.codigo",      "kind": "string", "required": true},
      {"name": "proforma.total",       "kind": "money",  "required": true},
      {"name": "proforma.vencimiento", "kind": "date",   "required": true}
    ]'::jsonb,
    5, TRUE
),
(
    '44444444-4444-4444-8444-444444444005',
    'Expediente despachado (ES)',
    'expediente.dispatched', 'ES', 'GLOBAL', NULL,
    'Tu OC {{ expediente.codigo }} fue despachada',
    'Hola {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'La OC {{ expediente.codigo }} fue despachada el {{ expediente.dispatched_at }}.' || chr(10) ||
    'Tracking: {{ expediente.ref_tracking }}' || chr(10) ||
    'ETA: {{ expediente.eta }}' || chr(10) || chr(10) ||
    'Cualquier novedad te avisamos,' || chr(10) || 'Equipo MWT.ONE',
    '[
      {"name": "cliente.nombre",            "kind": "string", "required": true},
      {"name": "expediente.codigo",         "kind": "string", "required": true},
      {"name": "expediente.dispatched_at",  "kind": "date",   "required": true},
      {"name": "expediente.ref_tracking",   "kind": "string", "required": false},
      {"name": "expediente.eta",            "kind": "date",   "required": false}
    ]'::jsonb,
    3, TRUE
),
(
    '44444444-4444-4444-8444-444444444006',
    'Order dispatched (EN)',
    'expediente.dispatched', 'EN', 'GLOBAL', NULL,
    'Your PO {{ expediente.codigo }} has been dispatched',
    'Hi {{ cliente.nombre }},' || chr(10) || chr(10) ||
    'PO {{ expediente.codigo }} was dispatched on {{ expediente.dispatched_at }}.' || chr(10) ||
    'Tracking: {{ expediente.ref_tracking }}' || chr(10) ||
    'ETA: {{ expediente.eta }}' || chr(10) || chr(10) ||
    'We will keep you posted,' || chr(10) || 'MWT.ONE Team',
    '[
      {"name": "cliente.nombre",            "kind": "string", "required": true},
      {"name": "expediente.codigo",         "kind": "string", "required": true},
      {"name": "expediente.dispatched_at",  "kind": "date",   "required": true},
      {"name": "expediente.ref_tracking",   "kind": "string", "required": false},
      {"name": "expediente.eta",            "kind": "date",   "required": false}
    ]'::jsonb,
    1, TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 10. notifications.notification_log  (preservado — 8 logs)
--     Con correlation_id + trigger_action_source nuevos (JSON #14)
-- ────────────────────────────────────────────────────────────
INSERT INTO notifications.notification_log (
    id, ts, completed_at,
    expediente_id, proforma_id, template_key, template_id,
    recipient_email, subject, body_preview,
    trigger, status, retries, attempt_count,
    error, skip_reason,
    amount_overdue, grace_days_used, currency,
    is_active,
    correlation_id, trigger_action_source
) VALUES
(
    '55555555-5555-4555-8555-555555555001',
    '2026-04-17 09:12:00+00', '2026-04-17 09:12:03+00',
    'bbbbbbbb-0000-4000-8000-000000000003', NULL, 'expediente.registered',
    '44444444-4444-4444-8444-444444444001',
    'ap@overseas-buyer.com',
    'Hemos recibido tu OC EXP-1030',
    'Hola John, registramos la OC EXP-1030 por USD 12,900.00…',
    'workflow_push', 'Delivered', 0, 1,
    NULL, NULL,
    NULL, NULL, NULL,
    TRUE,
    'f0000000-0000-4000-8000-000000001030', 'C1'
),
(
    '55555555-5555-4555-8555-555555555002',
    '2026-04-17 15:03:00+00', '2026-04-17 15:03:05+00',
    'bbbbbbbb-0000-4000-8000-000000000003', NULL, 'proforma.sent',
    '44444444-4444-4444-8444-444444444003',
    'tesoreria@sondel.pe',
    'Proforma PF-2026-0156 — USD 12,900.00',
    'Hola Juan, adjuntamos la proforma PF-2026-0156 por USD 12,900.00…',
    'workflow_push', 'Sent', 0, 1,
    NULL, NULL,
    NULL, NULL, NULL,
    TRUE,
    'f0000000-0000-4000-8000-000000001030', 'C2'
),
(
    '55555555-5555-4555-8555-555555555003',
    '2026-04-18 08:45:00+00', NULL,
    'bbbbbbbb-0000-4000-8000-000000000001', NULL, 'expediente.dispatched',
    '44444444-4444-4444-8444-444444444005',
    'tesoreria@sondel.pe',
    'Tu OC EXP-1027 fue despachada',
    'Hola Juan, la OC EXP-1027 fue despachada el 2026-04-10…',
    'workflow_push', 'Failed', 2, 3,
    'SMTP 421 temporary failure', NULL,
    NULL, NULL, NULL,
    TRUE,
    'f0000000-0000-4000-8000-000000001027', 'C5'
),
(
    '55555555-5555-4555-8555-555555555004',
    '2026-04-18 11:20:00+00', '2026-04-18 11:20:02+00',
    'bbbbbbbb-0000-4000-8000-000000000003', NULL, 'proforma.sent',
    '44444444-4444-4444-8444-444444444004',
    'ap@overseas-buyer.com',
    'Proforma PF-2026-0156 — USD 12,900.00',
    'Hi John, attached is proforma PF-2026-0156 for USD 12,900.00…',
    'manual', 'Delivered', 0, 1,
    NULL, NULL,
    NULL, NULL, NULL,
    TRUE,
    'f0000000-0000-4000-8000-000000001030', 'C2'
),
(
    '55555555-5555-4555-8555-555555555005',
    '2026-04-19 07:10:00+00', '2026-04-19 07:10:01+00',
    NULL, NULL, 'expediente.registered',
    '44444444-4444-4444-8444-444444444001',
    'compras@retail-local.pe',
    'Hemos recibido tu OC EXP-2026-0044',
    '',
    'workflow_push', 'Skipped', 0, 1,
    NULL, 'cliente suspendido — no notificar',
    NULL, NULL, NULL,
    TRUE,
    NULL, 'C1'
),
(
    '55555555-5555-4555-8555-5555555550C1',
    '2026-04-14 10:00:00+00', '2026-04-14 10:00:02+00',
    NULL, NULL, 'collection.c1',
    NULL,
    'tesoreria@sondel.pe',
    'Recordatorio: proforma PF-2026-0142 próxima a vencer',
    'Hola Juan, te recordamos que la proforma PF-2026-0142 por USD 12,410.00 vence en 3 días…',
    'C1', 'Delivered', 0, 1,
    NULL, NULL,
    12410.00, 0, 'USD',
    TRUE,
    'f0000000-0000-4000-8000-000000000142', 'C9'
),
(
    '55555555-5555-4555-8555-5555555550C2',
    '2026-04-16 10:00:00+00', '2026-04-16 10:00:03+00',
    NULL, NULL, 'collection.c2',
    NULL,
    'tesoreria@sondel.pe',
    'Aviso: proforma PF-2026-0142 vencida (gracia activa)',
    'Hola Juan, la proforma PF-2026-0142 por USD 12,410.00 venció hace 2 días. Gracia: 3 días…',
    'C2', 'Delivered', 0, 1,
    NULL, NULL,
    12410.00, 3, 'USD',
    TRUE,
    'f0000000-0000-4000-8000-000000000142', 'C10'
),
(
    '55555555-5555-4555-8555-5555555550C3',
    '2026-04-19 10:00:00+00', '2026-04-19 10:00:04+00',
    NULL, NULL, 'collection.c3',
    NULL,
    'tesoreria@sondel.pe',
    'Bloqueo comercial: proforma PF-2026-0142 · acción requerida',
    'Hola Juan, la proforma PF-2026-0142 por USD 12,410.00 permanece impaga. Bloqueo comercial activado…',
    'C3', 'Sent', 0, 1,
    NULL, NULL,
    12410.00, 5, 'USD',
    TRUE,
    'f0000000-0000-4000-8000-000000000142', 'C11'
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 11. pipeline.event_log  (6 eventos — audit trail workflow)
-- ────────────────────────────────────────────────────────────
INSERT INTO pipeline.event_log (
    id, correlation_id, event_type, aggregate_type, aggregate_id,
    action_source, previous_status, new_status,
    payload, emitted_by_id, emitted_by_role, is_active
) VALUES
(
    '3e000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000001027',
    'oc.created', 'oc',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'C1', NULL, 'EMITIDA',
    '{"codigo":"PO-2026-04100","client":"Sondel PE","total_value":24820.00}'::jsonb,
    NULL, 'admin', TRUE
),
(
    '3e000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000001027',
    'expediente.created', 'expediente',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'C2', NULL, 'REGISTRO',
    '{"codigo":"EXP-1027","oc_id":"aaaaaaaa-0000-4000-8000-000000000001","sap":"SAP-502147"}'::jsonb,
    NULL, 'admin', TRUE
),
(
    '3e000000-0000-4000-8000-000000000003',
    'f0000000-0000-4000-8000-000000001027',
    'expediente.status_changed', 'expediente',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'C5', 'TRANSITO', 'EN_DESTINO',
    '{"via":"arrival_scan","port":"CALLAO","date":"2026-04-10"}'::jsonb,
    NULL, 'system', TRUE
),
(
    '3e000000-0000-4000-8000-000000000004',
    'f0000000-0000-4000-8000-000000001027',
    'pago.verified', 'pago',
    'ffffffff-0000-4000-8000-000000000001',
    'C7', 'PENDIENTE', 'VERIFICADO',
    '{"monto":12410.00,"moneda":"USD","cliente":"Sondel PE"}'::jsonb,
    NULL, 'finance', TRUE
),
(
    '3e000000-0000-4000-8000-000000000005',
    'f0000000-0000-4000-8000-000000001030',
    'oc.created', 'oc',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'C1', NULL, 'EMITIDA',
    '{"codigo":"PO-2026-04101","client":"Overseas US","total_value":12900.00,"credit_band":"AMBER"}'::jsonb,
    NULL, 'admin', TRUE
),
(
    '3e000000-0000-4000-8000-000000000006',
    'f0000000-0000-4000-8000-000000001030',
    'pago.rejected', 'pago',
    'ffffffff-0000-4000-8000-000000000002',
    'C8', 'PENDIENTE', 'RECHAZADO',
    '{"monto":3000.00,"reason":"Monto parcial no aceptado — política DDP"}'::jsonb,
    NULL, 'finance', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 12. financiero.cost_line  (6 líneas — costos planificados + reales)
-- ────────────────────────────────────────────────────────────
INSERT INTO financiero.cost_line (
    id, expediente_id, cost_type, description,
    amount, currency, exchange_rate, amount_base,
    phase, proveedor_id, document_id, invoice_number, invoice_date,
    payment_status, notes, is_active, created_by_id
) VALUES
(
    '5c000000-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'producto', 'Producción Rana Walk Classic x 200 pares',
    16500.00, 'USD', 1.000000, 16500.00,
    'real', '55555555-1111-4000-8000-000000000001',
    NULL, 'INV-JJ-20260215', '2026-02-15',
    'PAGADO', 'Costo base FOB Shanghái', TRUE, NULL
),
(
    '5c000000-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'flete', 'Flete marítimo Shanghái → Callao',
    1860.00, 'USD', 1.000000, 1860.00,
    'real', '55555555-1111-4000-8000-000000000003',
    NULL, 'INV-SDX-20260306', '2026-03-06',
    'PAGADO', 'Maersk FCL 20ft', TRUE, NULL
),
(
    '5c000000-0000-4000-8000-000000000003',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'aduana', 'Aranceles + honorarios aduaneros',
    1485.00, 'USD', 1.000000, 1485.00,
    'real', '55555555-1111-4000-8000-000000000004',
    'dddddddd-0000-4000-8000-000000000004', 'INV-ADS-20260408', '2026-04-08',
    'PAGADO', 'DUA SAP-502147', TRUE, NULL
),
(
    '5c000000-0000-4000-8000-000000000004',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'producto', 'Producción Rana Walk Pro x 100 pares',
    9500.00, 'USD', 1.000000, 9500.00,
    'planned', '55555555-1111-4000-8000-000000000001',
    NULL, NULL, NULL,
    'PENDIENTE', 'Planificado — en producción', TRUE, NULL
),
(
    '5c000000-0000-4000-8000-000000000005',
    'bbbbbbbb-0000-4000-8000-000000000003',
    'flete', 'Flete aéreo Callao → LGB',
    3200.00, 'USD', 1.000000, 3200.00,
    'planned', '55555555-1111-4000-8000-000000000003',
    NULL, NULL, NULL,
    'PENDIENTE', 'Estimado DHL cargo', TRUE, NULL
),
(
    '5c000000-0000-4000-8000-000000000006',
    'bbbbbbbb-0000-4000-8000-000000000004',
    'producto', 'Producción Rana Walk Pro x 200 pares',
    19000.00, 'USD', 1.000000, 19000.00,
    'planned', '55555555-1111-4000-8000-000000000001',
    NULL, NULL, NULL,
    'PENDIENTE', 'Planificado — en producción', TRUE, NULL
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 13. portal.mwt_user  (3 usuarios B2B)
-- ────────────────────────────────────────────────────────────
INSERT INTO portal.mwt_user (
    id, email, full_name, role, legal_entity_id,
    phone, locale, timezone, is_api_user, api_key_hash,
    last_login_at, invited_by_id, accepted_at, is_active, metadata
) VALUES
(
    '40000000-0000-4000-8000-000000000001',
    'tesoreria@sondel.pe', 'Juan Vargas (Sondel)',
    'b2b_finance', '88888888-0000-4000-8000-000000000001',
    '+51 1 2340011', 'es', 'America/Lima',
    FALSE, NULL,
    '2026-04-17 14:20:00+00', NULL, '2024-03-12 10:00:00+00', TRUE,
    '{"notif_channels":["email"],"watches":["proformas","pagos"]}'::jsonb
),
(
    '40000000-0000-4000-8000-000000000002',
    'ap@marluvas.co', 'Laura Ríos (Marluvas)',
    'b2b_logistics', '88888888-0000-4000-8000-000000000002',
    '+57 601 7340099', 'es', 'America/Bogota',
    FALSE, NULL,
    '2026-04-10 11:40:00+00', NULL, '2024-01-20 10:00:00+00', TRUE,
    '{"notif_channels":["email","whatsapp"],"watches":["expedientes"]}'::jsonb
),
(
    '40000000-0000-4000-8000-000000000003',
    'api@overseas-buyer.com', 'API · Overseas Buyer',
    'api_user', '88888888-0000-4000-8000-000000000003',
    NULL, 'en', 'America/New_York',
    TRUE, 'sha256:$2b$12$REPLACE_WITH_REAL_HASH',
    '2026-04-18 03:00:00+00', NULL, '2025-12-01 09:00:00+00', TRUE,
    '{"scopes":["read:expedientes","read:pagos"],"source":"integration"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 14. dashboard.snapshot  (2 snapshots)
-- ────────────────────────────────────────────────────────────
INSERT INTO dashboard.snapshot (
    id, user_id, snapshot_type, label,
    period_start, period_end, snapshot_data,
    is_pinned, is_active
) VALUES
(
    'd1000000-0000-4000-8000-000000000001',
    NULL, 'preferences', 'Dashboard default (admin)',
    NULL, NULL,
    '{
      "layout": {
        "widgets": [
          "kpi_ventas_mes",
          "expedientes_open",
          "stock_critico",
          "pagos_pendientes",
          "pipeline_health"
        ]
      },
      "filters": {
        "moneda": "USD",
        "nodo_id": null,
        "periodo": "ultimos_30_dias"
      }
    }'::jsonb,
    TRUE, TRUE
),
(
    'd1000000-0000-4000-8000-000000000002',
    NULL, 'kpi_monthly', 'Cierre Marzo 2026',
    '2026-03-01', '2026-03-31',
    '{
      "kpis": {
        "ventas_usd":          42320.00,
        "costos_usd":          28145.00,
        "margen_real_pct":     33.5,
        "expedientes_cerrados": 3,
        "expedientes_open":    4,
        "pagos_verificados":   2,
        "pagos_rechazados":    0,
        "stock_critico_skus":  2
      },
      "top_clientes_usd": [
        {"client":"Marluvas CO", "monto": 18500},
        {"client":"Sondel PE",   "monto": 12410},
        {"client":"Overseas US", "monto": 0}
      ]
    }'::jsonb,
    FALSE, TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Fin de seeds. Verificación rápida (informativa — no rompe):
--   SELECT COUNT(*) FROM nodos.nodo;                  -- 5
--   SELECT COUNT(*) FROM brands.marca;                -- 4
--   SELECT COUNT(*) FROM clientes.cliente;            -- 5
--   SELECT COUNT(*) FROM productos.producto;          -- 6
--   SELECT COUNT(*) FROM proveedores.proveedor;       -- 4
--   SELECT COUNT(*) FROM inventario.stock;            -- 8
--   SELECT COUNT(*) FROM expedientes.oc;              -- 3
--   SELECT COUNT(*) FROM expedientes.expediente;      -- 4
--   SELECT COUNT(*) FROM expedientes.linea;           -- 6
--   SELECT COUNT(*) FROM expedientes.documento;       -- 6
--   SELECT COUNT(*) FROM cobros.cobro;                -- 3
--   SELECT COUNT(*) FROM cobros.pago;                 -- 5
--   SELECT COUNT(*) FROM transfers.transferencia;     -- 2
--   SELECT COUNT(*) FROM transfers.linea;             -- 3
--   SELECT COUNT(*) FROM transfers.evento;            -- 4
--   SELECT COUNT(*) FROM email_templates.template;    -- 6
--   SELECT COUNT(*) FROM notifications.notification_log;-- 8
--   SELECT COUNT(*) FROM pipeline.event_log;          -- 6
--   SELECT COUNT(*) FROM financiero.cost_line;        -- 6
--   SELECT COUNT(*) FROM portal.mwt_user;             -- 3
--   SELECT COUNT(*) FROM dashboard.snapshot;          -- 2
-- ────────────────────────────────────────────────────────────
