// Mock data for MWT ONE prototype
// Expedientes, clients, brands, products, pagos, artifacts, activity...

// ─────────────────────────────────────────────────────────
// MARCAS — ENT_PLAT_MARCAS (canónico)
//   brand_id          slug corto (BIS, MLV, RW...)
//   tipo              'PROPIA' | 'DISTRIBUCION'
//   issuing_entity    legal_entity_id que factura
//   mercados_activos  array de country codes
//   status            'ACTIVO' | 'INACTIVO'
//   feature_flags     { STOREFRONT_ENABLED, B2B_PORTAL_ENABLED,
//                       EXPEDITION_ENABLED, SCANNER_ENABLED }
// ─────────────────────────────────────────────────────────
export const BRANDS = [
  {
    id: 'bis', brand_id: 'BIS',
    name: 'Bison', code: 'BIS', color: '#8E6B3F',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e007', // MWT US LLC
    mercados_activos: ['US','MX','PE','CO','CL'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: true,  B2B_PORTAL_ENABLED: true,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: true,
    },
    active_skus: 42, expedientes: 14,
    revenue_ytd: 1840000, avg_margin: 0.218,
    created_at: '2022-03-14',
    description: 'Calzado de seguridad premium — línea Bison.',
  },
  {
    id: 'gol', brand_id: 'GOL',
    name: 'Goliath', code: 'GOL', color: '#013A57',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e007',
    mercados_activos: ['US','BR','MX'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: false, B2B_PORTAL_ENABLED: true,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: true,
    },
    active_skus: 28, expedientes: 9,
    revenue_ytd: 920000, avg_margin: 0.194,
    created_at: '2022-08-01',
    description: 'Bota industrial heavy-duty Goliath.',
  },
  {
    id: 'leo', brand_id: 'LEO',
    name: 'Leopard', code: 'LEO', color: '#B45309',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e001', // MWT MX
    mercados_activos: ['MX','CO','CR'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: true,  B2B_PORTAL_ENABLED: false,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: false,
    },
    active_skus: 18, expedientes: 6,
    revenue_ytd: 410000, avg_margin: 0.231,
    created_at: '2023-02-22',
    description: 'Línea urbana Leopard — sneakers y casuales.',
  },
  {
    id: 'orb', brand_id: 'ORB',
    name: 'Orbis', code: 'ORB', color: '#0369A1',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e005', // MWT PA
    mercados_activos: ['PA','CR','DO','MX'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: true,  B2B_PORTAL_ENABLED: true,
      EXPEDITION_ENABLED: false, SCANNER_ENABLED: false,
    },
    active_skus: 34, expedientes: 12,
    revenue_ytd: 630000, avg_margin: 0.172,
    created_at: '2023-06-10',
    description: 'Accesorios y mochilería Orbis.',
  },
  {
    id: 'vel', brand_id: 'VEL',
    name: 'Velox', code: 'VEL', color: '#75CBB3',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e001',
    mercados_activos: ['MX','CL','AR'],
    status: 'INACTIVO', active: false,
    feature_flags: {
      STOREFRONT_ENABLED: false, B2B_PORTAL_ENABLED: false,
      EXPEDITION_ENABLED: false, SCANNER_ENABLED: false,
    },
    active_skus: 12, expedientes: 4,
    revenue_ytd: 180000, avg_margin: 0.148,
    created_at: '2024-01-30',
    description: 'Running técnico Velox — línea en pausa.',
  },
  {
    id: 'mlv', brand_id: 'MLV',
    name: 'Marluvas', code: 'MLV', color: '#DC2626',
    tipo: 'DISTRIBUCION',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e006', // MWT BR
    mercados_activos: ['BR','CR','PE','CO','CL','PA'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: false, B2B_PORTAL_ENABLED: true,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: true,
    },
    active_skus: 96, expedientes: 21,
    revenue_ytd: 2840000, avg_margin: 0.124,
    created_at: '2021-11-05',
    description: 'Calzado de seguridad brasileño — distribución exclusiva LatAm.',
  },
  {
    id: 'tec', brand_id: 'TEC',
    name: 'Tecmater', code: 'TEC', color: '#481EE3',
    tipo: 'DISTRIBUCION',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e002', // MWT PE
    mercados_activos: ['PE','CL','EC'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: false, B2B_PORTAL_ENABLED: true,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: false,
    },
    active_skus: 24, expedientes: 5,
    revenue_ytd: 310000, avg_margin: 0.162,
    created_at: '2024-07-18',
    description: 'Botas industriales Tecmater — distribución andina.',
  },
  {
    id: 'rw',  brand_id: 'RW',
    name: 'Rana Walk', code: 'RW', color: '#00B286',
    tipo: 'PROPIA',
    issuing_entity: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e005', // MWT PA
    mercados_activos: ['PA','CR','MX'],
    status: 'ACTIVO', active: true,
    feature_flags: {
      STOREFRONT_ENABLED: true,  B2B_PORTAL_ENABLED: false,
      EXPEDITION_ENABLED: true,  SCANNER_ENABLED: true,
    },
    active_skus: 8, expedientes: 2,
    revenue_ytd: 64000, avg_margin: 0.285,
    created_at: '2025-09-02',
    description: 'Rana Walk — línea propia MWT en ramp-up.',
  },
];

// ─────────────────────────────────────────────────────────
// BRAND_ATTRIBUTES — enums de calzado de seguridad
// (para formularios y mapeo Excel)
// ─────────────────────────────────────────────────────────
export const BRAND_ATTRIBUTES = {
  tipo_calzado:      ['Bota Alta','Bota al Tobillo','Zapato','Tenis'],
  cubrepuntera:      ['Sí','No'],
  tipo_puntera:      ['Acero 200J','Composite 200J','No tiene','Plástico','Citoplástico 200C'],
  antiperforante:    ['Acero 1100 N','Textil 1100 N','No'],
  protector_metatarsal: ['Interno','Externo','No'],
  capellada: [
    'Cuero Carnaza','Cuero Plena Flor','Cuero Plena Flor HIDRO','Cuero Nobuck',
    'Microfibra','Mmicro','PVC','Cuero Rodock','Cuero Vaqueta Lisa','EVA',
    'Cuero Vaqueta HIDRO','Cuero Liso Fuego','Cuero Nobuck Hidrofugado',
    'Cuero Liso HIDRO','Anti-llamas',
  ],
  disipativo_energia: [
    'ISO 20345 14.000V','ASTM 2413 18.000V','ABNT NBR 16603-2017 500V',
    'ISO 20345 14.000V ANT','Conductivo','No',
  ],
  suela:      ['Bidensidad PU','Caucho','Monodensidad Caucho'],
  normativa:  ['ASTM F2413','ISO 20345','No','ISO 20347','ABNT NBR 16.603:2017 500V - SECO'],
  cierre:     ['Sin Cordones','Con Cordones','De meter','Zipper','Cierre Velcro'],
  color: [
    'Negro','Blanco','Marron','Café','Verde Musgo','Gris','Azul Marino',
    'Marron Claro','Dark Brown','Grafite','Marron Taupe','Rojo','Castor','Amarillo',
  ],
  segmento: [
    'Agrícola','Alimentaria','Producción','Administrativo','Construcción',
    'Electricista','Astillero','Limpieza','Madereras','Metalurgia','Militares',
    'Mineria','Montadoras','Mensajeria','Petroquimicos','Rescate','Salud',
    'Siderurgia','Trekking','Multiservicios','Agroindustria',
  ],
  materiales_circulares: ['Sí','No','Suela'],
  plantilla_interna: ['Poliuretano','Etilvinilacetato','Etilvinilacetato ANT','No'],
  riesgo: [
    'Alta Temperatura','Ambiente Frio','Shock','Estática','Esguince',
    'Punción Plantar','Humedad','Piso Resbaladizo','Caída Objetos',
    'Ocupacional','Seguridad','Polimerico','Químicos',
  ],
};

// ─────────────────────────────────────────────────────────
// BRAND_PRODUCTS — catálogo técnico con specs colapsadas
// ─────────────────────────────────────────────────────────
export const BRAND_PRODUCTS = [
  // ── Marluvas (MLV) — calzado de seguridad ─────────
  {
    id: 'bp-mlv-001', brand_id: 'mlv', sku: 'MLV-50S29-BLK-42',
    nombre: 'Bota 50S29 Plena Flor Negra', ncm: '6403.40.00',
    tipo_calzado: 'Bota al Tobillo', cubrepuntera: 'Sí', tipo_puntera: 'Composite 200J',
    antiperforante: 'Textil 1100 N', protector_metatarsal: 'No',
    capellada: 'Cuero Plena Flor HIDRO', disipativo_energia: 'ABNT NBR 16603-2017 500V',
    suela: 'Bidensidad PU', normativa: 'ABNT NBR 16.603:2017 500V - SECO',
    cierre: 'Con Cordones', color: 'Negro', segmento: 'Construcción',
    materiales_circulares: 'Suela', plantilla_interna: 'Etilvinilacetato ANT',
    riesgo: 'Caída Objetos', active_in_markets: ['BR','PE','CR'],
    unit_cost_fob: 18.50, list_price: 52.00,
  },
  {
    id: 'bp-mlv-002', brand_id: 'mlv', sku: 'MLV-40S18-BRN-41',
    nombre: 'Bota Alta 40S18 Hidro Marrón', ncm: '6403.40.00',
    tipo_calzado: 'Bota Alta', cubrepuntera: 'Sí', tipo_puntera: 'Acero 200J',
    antiperforante: 'Acero 1100 N', protector_metatarsal: 'Externo',
    capellada: 'Cuero Vaqueta HIDRO', disipativo_energia: 'ISO 20345 14.000V',
    suela: 'Caucho', normativa: 'ISO 20345',
    cierre: 'Con Cordones', color: 'Marron', segmento: 'Petroquimicos',
    materiales_circulares: 'No', plantilla_interna: 'Poliuretano',
    riesgo: 'Químicos', active_in_markets: ['BR','CL'],
    unit_cost_fob: 24.80, list_price: 68.00,
  },
  {
    id: 'bp-mlv-003', brand_id: 'mlv', sku: 'MLV-EVA-AST-BLK-40',
    nombre: 'Zapato Antiestático Astillero', ncm: '6402.99.00',
    tipo_calzado: 'Zapato', cubrepuntera: 'Sí', tipo_puntera: 'Composite 200J',
    antiperforante: 'No', protector_metatarsal: 'No',
    capellada: 'Microfibra', disipativo_energia: 'ISO 20345 14.000V ANT',
    suela: 'Bidensidad PU', normativa: 'ISO 20345',
    cierre: 'Sin Cordones', color: 'Negro', segmento: 'Astillero',
    materiales_circulares: 'Sí', plantilla_interna: 'Etilvinilacetato',
    riesgo: 'Estática', active_in_markets: ['BR','CR','PE'],
    unit_cost_fob: 15.20, list_price: 44.00,
  },
  {
    id: 'bp-mlv-004', brand_id: 'mlv', sku: 'MLV-FUEGO-BRN-43',
    nombre: 'Bota Anti-llamas Siderúrgica', ncm: '6403.40.00',
    tipo_calzado: 'Bota Alta', cubrepuntera: 'Sí', tipo_puntera: 'Acero 200J',
    antiperforante: 'Acero 1100 N', protector_metatarsal: 'Externo',
    capellada: 'Anti-llamas', disipativo_energia: 'Conductivo',
    suela: 'Caucho', normativa: 'ISO 20345',
    cierre: 'Con Cordones', color: 'Castor', segmento: 'Siderurgia',
    materiales_circulares: 'No', plantilla_interna: 'Etilvinilacetato ANT',
    riesgo: 'Alta Temperatura', active_in_markets: ['BR'],
    unit_cost_fob: 32.00, list_price: 89.00,
  },

  // ── Bison (BIS) — línea propia MWT ─────────
  {
    id: 'bp-bis-001', brand_id: 'bis', sku: 'BIS-OXF-BLK-42',
    nombre: 'Oxford cuero negro T.42', ncm: '6403.59.00',
    tipo_calzado: 'Zapato', cubrepuntera: 'No', tipo_puntera: 'No tiene',
    antiperforante: 'No', protector_metatarsal: 'No',
    capellada: 'Cuero Plena Flor', disipativo_energia: 'No',
    suela: 'Monodensidad Caucho', normativa: 'No',
    cierre: 'Con Cordones', color: 'Negro', segmento: 'Administrativo',
    materiales_circulares: 'No', plantilla_interna: 'Poliuretano',
    riesgo: 'Ocupacional', active_in_markets: ['US','MX','PE'],
    unit_cost_fob: 48.50, list_price: 89.00,
  },
  {
    id: 'bp-bis-002', brand_id: 'bis', sku: 'BIS-OXF-TAN-42',
    nombre: 'Oxford cuero tan T.42', ncm: '6403.59.00',
    tipo_calzado: 'Zapato', cubrepuntera: 'No', tipo_puntera: 'No tiene',
    antiperforante: 'No', protector_metatarsal: 'No',
    capellada: 'Cuero Plena Flor', disipativo_energia: 'No',
    suela: 'Monodensidad Caucho', normativa: 'No',
    cierre: 'Con Cordones', color: 'Marron Claro', segmento: 'Administrativo',
    materiales_circulares: 'No', plantilla_interna: 'Poliuretano',
    riesgo: 'Ocupacional', active_in_markets: ['US','MX','PE','CO'],
    unit_cost_fob: 48.50, list_price: 89.00,
  },

  // ── Goliath (GOL) ─────────
  {
    id: 'bp-gol-001', brand_id: 'gol', sku: 'GOL-BT-BLK-44',
    nombre: 'Bota industrial puntera acero T.44', ncm: '6403.40.00',
    tipo_calzado: 'Bota Alta', cubrepuntera: 'Sí', tipo_puntera: 'Acero 200J',
    antiperforante: 'Acero 1100 N', protector_metatarsal: 'Interno',
    capellada: 'Cuero Plena Flor HIDRO', disipativo_energia: 'ASTM 2413 18.000V',
    suela: 'Bidensidad PU', normativa: 'ASTM F2413',
    cierre: 'Con Cordones', color: 'Negro', segmento: 'Mineria',
    materiales_circulares: 'Suela', plantilla_interna: 'Poliuretano',
    riesgo: 'Punción Plantar', active_in_markets: ['US','BR','MX'],
    unit_cost_fob: 55.80, list_price: 128.00,
  },

  // ── Leopard (LEO) ─────────
  {
    id: 'bp-leo-001', brand_id: 'leo', sku: 'LEO-SN-WH-38',
    nombre: 'Sneaker urbano blanco T.38', ncm: '6404.19.00',
    tipo_calzado: 'Tenis', cubrepuntera: 'No', tipo_puntera: 'No tiene',
    antiperforante: 'No', protector_metatarsal: 'No',
    capellada: 'Microfibra', disipativo_energia: 'No',
    suela: 'Monodensidad Caucho', normativa: 'No',
    cierre: 'Con Cordones', color: 'Blanco', segmento: 'Multiservicios',
    materiales_circulares: 'Sí', plantilla_interna: 'Etilvinilacetato',
    riesgo: 'Ocupacional', active_in_markets: ['MX','CR','CO'],
    unit_cost_fob: 22.40, list_price: 48.00,
  },
  // ── Velox (VEL) ─────────
  {
    id: 'bp-vel-001', brand_id: 'vel', sku: 'VEL-RN-BLU-40',
    nombre: 'Running azul T.40', ncm: '6404.11.00',
    tipo_calzado: 'Tenis', cubrepuntera: 'No', tipo_puntera: 'No tiene',
    antiperforante: 'No', protector_metatarsal: 'No',
    capellada: 'Microfibra', disipativo_energia: 'No',
    suela: 'Bidensidad PU', normativa: 'No',
    cierre: 'Con Cordones', color: 'Azul Marino', segmento: 'Trekking',
    materiales_circulares: 'Suela', plantilla_interna: 'Etilvinilacetato',
    riesgo: 'Esguince', active_in_markets: ['MX','CL'],
    unit_cost_fob: 18.80, list_price: 42.00,
  },
];

// ─────────────────────────────────────────────────────────
// BRAND_PRICING — tabla de precios con governance
//   base_price    (Precio de Lista)
//   client_prices { [client_id]: override }
//   internal_cost (Costo FOB/Fábrica · CEO-ONLY)
// ─────────────────────────────────────────────────────────
export const BRAND_PRICING = [
  { brand_id:'mlv', sku:'MLV-50S29-BLK-42',   base_price: 52.00, client_prices: { c1: 49.00, c2: 47.50, c3: 51.00 }, internal_cost: 18.50 },
  { brand_id:'mlv', sku:'MLV-40S18-BRN-41',   base_price: 68.00, client_prices: { c1: 64.00, c5: 62.00 },            internal_cost: 24.80 },
  { brand_id:'mlv', sku:'MLV-EVA-AST-BLK-40', base_price: 44.00, client_prices: { c2: 41.00, c4: 42.00, c8: 43.00 }, internal_cost: 15.20 },
  { brand_id:'mlv', sku:'MLV-FUEGO-BRN-43',   base_price: 89.00, client_prices: { c1: 85.00 },                        internal_cost: 32.00 },
  { brand_id:'bis', sku:'BIS-OXF-BLK-42',     base_price: 89.00, client_prices: { c1: 82.00, c5: 78.00 },             internal_cost: 48.50 },
  { brand_id:'bis', sku:'BIS-OXF-TAN-42',     base_price: 89.00, client_prices: { c1: 82.00, c5: 78.00, c7: 84.00 }, internal_cost: 48.50 },
  { brand_id:'gol', sku:'GOL-BT-BLK-44',      base_price: 128.00, client_prices: { c3: 118.00, c5: 120.00 },          internal_cost: 55.80 },
  { brand_id:'leo', sku:'LEO-SN-WH-38',       base_price: 48.00, client_prices: { c2: 44.00, c4: 45.00 },             internal_cost: 22.40 },
  { brand_id:'vel', sku:'VEL-RN-BLU-40',      base_price: 42.00, client_prices: { c2: 39.00 },                        internal_cost: 18.80 },
];

// ─────────────────────────────────────────────────────────
// CLIENTES B2B — ENT_COMERCIAL_CLIENTES (canónico)
//   id                UUID interno
//   codigo_marluvas   SAP identifier (mono-sp en UI)
//   cedula_juridica   RUC / NIT / RFC / etc.
//   cliente           razón social
//   pais / flag       país + bandera emoji
//   direccion_entrega dirección canónica
//   contacto_*        persona principal
//   credito_dias      plazo default
//   credito_limit/used
//   medio_pago        transferencia | carta_credito | anticipo | mixto
//   incoterm          FOB | CIF | EXW | DAP | DDP
//   canal             directo | distribuidor
//   estado            ACTIVO | PAUSADO | BLOQUEADO
//   band              GREEN | AMBER | RED (derivado por ahora)
// ─────────────────────────────────────────────────────────
export const CLIENTS = [
  {
    id: 'c1', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000001',
    codigo_marluvas: '4000000100', cedula_juridica: '20512345678',
    name: 'Andes Retail Co.',       cliente: 'Andes Retail Co. S.A.C.',
    country: 'Perú', country_code: 'PE', flag: '🇵🇪',
    direccion_entrega: 'Av. Javier Prado 2450, San Isidro, Lima',
    contact: 'L. Paredes',  contacto_nombre: 'Luz Paredes',
    email: 'lpa@andesretail.pe',    phone: '+51 1 234 5678',
    credito_dias: 60, credito_limit: 180000, credito_used: 142300,
    credit_limit: 180000, credit_used: 142300, // alias legacy
    medio_pago: 'transferencia', incoterm: 'CIF',
    canal: 'distribuidor', estado: 'ACTIVO', band: 'AMBER',
    created_at: '2024-03-12',
  },
  {
    id: 'c2', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000002',
    codigo_marluvas: '4000000101', cedula_juridica: '76543210-K',
    name: 'Atacama Distribuidora',  cliente: 'Atacama Distribuidora Ltda.',
    country: 'Chile', country_code: 'CL', flag: '🇨🇱',
    direccion_entrega: 'Av. Apoquindo 4800, Las Condes, Santiago',
    contact: 'C. Rojas', contacto_nombre: 'Carolina Rojas',
    email: 'rojas@atacama.cl',      phone: '+56 2 987 6543',
    credito_dias: 45, credito_limit: 240000, credito_used: 88500,
    credit_limit: 240000, credit_used: 88500,
    medio_pago: 'transferencia', incoterm: 'FOB',
    canal: 'distribuidor', estado: 'ACTIVO', band: 'GREEN',
    created_at: '2023-11-04',
  },
  {
    id: 'c3', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000003',
    codigo_marluvas: '4000000102', cedula_juridica: '30-71234567-4',
    name: 'Pampas Importaciones',   cliente: 'Pampas Importaciones S.A.',
    country: 'Argentina', country_code: 'AR', flag: '🇦🇷',
    direccion_entrega: 'Av. del Libertador 1200, CABA',
    contact: 'J. Álvarez', contacto_nombre: 'Javier Álvarez',
    email: 'ja@pampasimp.com.ar',   phone: '+54 11 555 1234',
    credito_dias: 90, credito_limit: 120000, credito_used: 118700,
    credit_limit: 120000, credit_used: 118700,
    medio_pago: 'carta_credito', incoterm: 'CIF',
    canal: 'distribuidor', estado: 'BLOQUEADO', band: 'RED',
    created_at: '2024-06-18',
  },
  {
    id: 'c4', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000004',
    codigo_marluvas: '4000000103', cedula_juridica: '901.234.567-8',
    name: 'Cafetera del Norte',     cliente: 'Cafetera del Norte SAS',
    country: 'Colombia', country_code: 'CO', flag: '🇨🇴',
    direccion_entrega: 'Cra. 43A #7-50, Medellín',
    contact: 'M. Uribe', contacto_nombre: 'Mónica Uribe',
    email: 'muribe@cdnorte.co',     phone: '+57 1 222 3344',
    credito_dias: 30, credito_limit: 95000, credito_used: 41200,
    credit_limit: 95000, credit_used: 41200,
    medio_pago: 'transferencia', incoterm: 'DAP',
    canal: 'directo', estado: 'ACTIVO', band: 'GREEN',
    created_at: '2024-01-22',
  },
  {
    id: 'c5', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000005',
    codigo_marluvas: '4000000104', cedula_juridica: 'PTR940215AB3',
    name: 'Pacífico Trading',       cliente: 'Pacífico Trading S.A. de C.V.',
    country: 'México', country_code: 'MX', flag: '🇲🇽',
    direccion_entrega: 'Av. Insurgentes Sur 1602, CDMX',
    contact: 'R. Becerra', contacto_nombre: 'Ricardo Becerra',
    email: 'r.becerra@pactr.mx',    phone: '+52 55 777 8899',
    credito_dias: 60, credito_limit: 310000, credito_used: 205400,
    credit_limit: 310000, credit_used: 205400,
    medio_pago: 'mixto', incoterm: 'DDP',
    canal: 'distribuidor', estado: 'ACTIVO', band: 'AMBER',
    created_at: '2023-07-30',
  },
  {
    id: 'c6', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000006',
    codigo_marluvas: '4000000105', cedula_juridica: '1-30-123-456-7',
    name: 'Caribe Logistics SRL',   cliente: 'Caribe Logistics SRL',
    country: 'R. Dominicana', country_code: 'DO', flag: '🇩🇴',
    direccion_entrega: 'Av. Winston Churchill 1099, Santo Domingo',
    contact: 'A. Peña', contacto_nombre: 'Andrés Peña',
    email: 'ap@caribelog.do',       phone: '+1 809 222 1111',
    credito_dias: 45, credito_limit: 68000, credito_used: 12800,
    credit_limit: 68000, credit_used: 12800,
    medio_pago: 'transferencia', incoterm: 'CIF',
    canal: 'directo', estado: 'ACTIVO', band: 'GREEN',
    created_at: '2024-09-02',
  },
  {
    id: 'c7', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000007',
    codigo_marluvas: '4000000106', cedula_juridica: '1790012345001',
    name: 'Andean Foods S.A.',      cliente: 'Andean Foods S.A.',
    country: 'Ecuador', country_code: 'EC', flag: '🇪🇨',
    direccion_entrega: 'Av. Amazonas N36-152, Quito',
    contact: 'S. Vallejo', contacto_nombre: 'Sofía Vallejo',
    email: 'svallejo@andean.ec',    phone: '+593 2 333 4444',
    credito_dias: 75, credito_limit: 145000, credito_used: 132600,
    credit_limit: 145000, credit_used: 132600,
    medio_pago: 'carta_credito', incoterm: 'FOB',
    canal: 'distribuidor', estado: 'PAUSADO', band: 'AMBER',
    created_at: '2024-05-14',
  },
  {
    id: 'c8', uuid: '0c77c2ea-1c11-4d4a-9e61-e10001000008',
    codigo_marluvas: '4000000107', cedula_juridica: '3-101-456789',
    name: 'Sondel S.A.',            cliente: 'Sondel Sociedad Anónima',
    country: 'Costa Rica', country_code: 'CR', flag: '🇨🇷',
    direccion_entrega: 'Escazú, San José',
    contact: 'E. Mora', contacto_nombre: 'Eduardo Mora',
    email: 'emora@sondel.cr',       phone: '+506 2220 3344',
    credito_dias: 60, credito_limit: 90000, credito_used: 22100,
    credit_limit: 90000, credit_used: 22100,
    medio_pago: 'transferencia', incoterm: 'CIF',
    canal: 'directo', estado: 'ACTIVO', band: 'GREEN',
    created_at: '2025-02-20',
  },
];

// ─────────────────────────────────────────────────────────
// CLIENT_PAYMENTS — Payment Status Machine
//   status: pending | verified | credit_released | rejected
// ─────────────────────────────────────────────────────────
export const CLIENT_PAYMENTS = [
  // c1 · Andes Retail
  { id:'PG-2026-00821', client_id:'c1', date:'2026-01-12', amount:47400, method:'Transferencia', ref:'TRX-88412', expediente:'EXP-1029', status:'credit_released', verified_by:'T. Muñoz', notes:'Aplicado a PF-0942 · 50%' },
  { id:'PG-2026-00914', client_id:'c1', date:'2026-02-04', amount:47400, method:'Transferencia', ref:'TRX-91203', expediente:'EXP-1029', status:'credit_released', verified_by:'T. Muñoz', notes:'Saldo PF-0942' },
  { id:'PG-2026-01120', client_id:'c1', date:'2026-03-28', amount:32000, method:'Transferencia', ref:'TRX-99314', expediente:'EXP-1034', status:'verified',        verified_by:'T. Muñoz', notes:'Pendiente liberación crédito' },
  { id:'PG-2026-01212', client_id:'c1', date:'2026-04-12', amount:18400, method:'Carta Crédito', ref:'LC-44892',  expediente:'EXP-1037', status:'pending',         verified_by:null,        notes:'En revisión bancaria' },
  // c2
  { id:'PG-2026-00680', client_id:'c2', date:'2026-01-08', amount:52000, method:'Transferencia', ref:'TRX-77120', expediente:'EXP-1031', status:'credit_released', verified_by:'T. Muñoz', notes:'' },
  { id:'PG-2026-00991', client_id:'c2', date:'2026-02-18', amount:36500, method:'Transferencia', ref:'TRX-82210', expediente:'EXP-1038', status:'credit_released', verified_by:'T. Muñoz', notes:'' },
  // c3 · Pampas (bloqueado)
  { id:'PG-2026-00450', client_id:'c3', date:'2025-11-22', amount:24000, method:'Transferencia', ref:'TRX-44091', expediente:'EXP-1015', status:'rejected',        verified_by:'CEO',       notes:'Origen de fondos no verificado' },
  { id:'PG-2026-00712', client_id:'c3', date:'2026-01-30', amount:18400, method:'Transferencia', ref:'TRX-55120', expediente:'EXP-1022', status:'verified',        verified_by:'T. Muñoz', notes:'No liberado · crédito en rojo' },
  // c5 · Pacífico
  { id:'PG-2026-01030', client_id:'c5', date:'2026-03-04', amount:68000, method:'Transferencia', ref:'TRX-88990', expediente:'EXP-1040', status:'credit_released', verified_by:'T. Muñoz', notes:'' },
  { id:'PG-2026-01188', client_id:'c5', date:'2026-04-08', amount:42000, method:'Mixto',         ref:'TRX-91045', expediente:'EXP-1042', status:'pending',         verified_by:null,        notes:'Conciliación parcial' },
  // c7 · Andean
  { id:'PG-2026-01045', client_id:'c7', date:'2026-03-15', amount:29500, method:'Carta Crédito', ref:'LC-39921',  expediente:'EXP-1044', status:'verified',        verified_by:'T. Muñoz', notes:'LC emitida por Banco Pichincha' },
  // c8
  { id:'PG-2026-01220', client_id:'c8', date:'2026-04-14', amount:11200, method:'Transferencia', ref:'TRX-93482', expediente:'EXP-1048', status:'credit_released', verified_by:'T. Muñoz', notes:'' },
];

// ─────────────────────────────────────────────────────────
// CLIENT_PRODUCTS_BOUGHT — inteligencia de surtido
// ─────────────────────────────────────────────────────────
export const CLIENT_PRODUCTS_BOUGHT = [
  // c1 · Andes Retail
  { client_id:'c1', sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', units_12m: 1840, revenue_12m: 83420, last_order:'2026-03-22', frequency: 'mensual' },
  { client_id:'c1', sku:'BIS-OXF-TAN-42', product:'Oxford cuero tan T.42',   units_12m: 1200, revenue_12m: 54400, last_order:'2026-02-18', frequency: 'bi-mensual' },
  { client_id:'c1', sku:'BIS-BLT-BRN-L',  product:'Cinturón cuero marrón L', units_12m:  960, revenue_12m: 23900, last_order:'2026-01-30', frequency: 'trimestral' },
  { client_id:'c1', sku:'LEO-SN-WH-38',   product:'Sneaker blanco 38',       units_12m:  420, revenue_12m: 18400, last_order:'2025-12-11', frequency: 'esporádica' },
  // c2 · Atacama
  { client_id:'c2', sku:'LEO-SN-WH-38',   product:'Sneaker blanco 38',       units_12m: 2100, revenue_12m: 94300, last_order:'2026-04-01', frequency: 'mensual' },
  { client_id:'c2', sku:'VEL-RN-BLU-40',  product:'Running azul 40',         units_12m: 1680, revenue_12m: 59400, last_order:'2026-03-14', frequency: 'mensual' },
  { client_id:'c2', sku:'ORB-BKP-20L',    product:'Mochila 20L',             units_12m:  640, revenue_12m: 29500, last_order:'2026-02-02', frequency: 'bi-mensual' },
  // c3 · Pampas
  { client_id:'c3', sku:'GOL-BT-BLK-44',  product:'Bota industrial 44',      units_12m:  780, revenue_12m: 42900, last_order:'2025-11-19', frequency: 'trimestral' },
  { client_id:'c3', sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', units_12m:  420, revenue_12m: 19400, last_order:'2025-10-22', frequency: 'esporádica' },
  // c5 · Pacífico
  { client_id:'c5', sku:'ORB-BKP-20L',    product:'Mochila 20L',             units_12m: 3200, revenue_12m: 148000, last_order:'2026-04-02', frequency: 'mensual' },
  { client_id:'c5', sku:'ORB-WLT-BLK',    product:'Billetera negra',         units_12m: 2100, revenue_12m:  48300, last_order:'2026-03-18', frequency: 'mensual' },
  { client_id:'c5', sku:'LEO-SN-WH-38',   product:'Sneaker blanco 38',       units_12m: 1200, revenue_12m:  54000, last_order:'2026-02-24', frequency: 'bi-mensual' },
  // c7 · Andean
  { client_id:'c7', sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', units_12m:  780, revenue_12m:  35400, last_order:'2026-03-02', frequency: 'trimestral' },
  { client_id:'c7', sku:'VEL-RN-BLU-40',  product:'Running azul 40',         units_12m:  610, revenue_12m:  21400, last_order:'2026-02-09', frequency: 'trimestral' },
  // c8
  { client_id:'c8', sku:'ORB-WLT-BLK',    product:'Billetera negra',         units_12m:  320, revenue_12m:   7400, last_order:'2026-04-01', frequency: 'bi-mensual' },
];

// ─────────────────────────────────────────────────────────
// Legal entities & Operators (ENT_OPS_NODOS · owner ≠ operator)
// ─────────────────────────────────────────────────────────
export const LEGAL_ENTITIES = [
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e001', name: 'MWT México S. de R.L.',      short: 'MWT MX',      country: 'MX' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e002', name: 'MWT Perú S.A.C.',            short: 'MWT PE',      country: 'PE' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e003', name: 'MWT Colombia SAS',           short: 'MWT CO',      country: 'CO' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e004', name: 'MWT Chile SpA',              short: 'MWT CL',      country: 'CL' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e005', name: 'MWT Panamá Corp.',           short: 'MWT PA',      country: 'PA' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e006', name: 'MWT Brasil Ltda.',           short: 'MWT BR',      country: 'BR' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e007', name: 'MWT USA LLC',                short: 'MWT US',      country: 'US' },
  { id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e008', name: 'MWT Shanghai Trading Co.',   short: 'MWT CN',      country: 'CN' },
];

export const OPERATORS = [
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110001', name: 'MWT Operations',  kind: 'mwt'        },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110002', name: 'Amazon FBA',      kind: '3pl'        },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110003', name: 'Mercado Libre Fulfillment', kind: '3pl' },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110004', name: 'DHL Supply Chain', kind: '3pl'       },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110005', name: 'APM Terminals',   kind: 'port'       },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110006', name: 'Cliente directo', kind: 'client'     },
  { id: '7c2ab401-aeb1-42f1-b1c0-111111110007', name: 'Fábrica Asia',    kind: 'factory'    },
];

// ─────────────────────────────────────────────────────────
// Nodos logísticos — estructura canónica ENT_OPS_NODOS
//   id             UUID
//   node_id        slug corto (FBA-US, MLC-MX, ...)
//   name           humano
//   type           marketplace | fiscal | warehouse | distributor | factory
//   legal_entity_id (dueño del inventario)
//   operator_id    (quién opera el espacio — puede ser distinto)
//   country        ISO-2
//   status         ACTIVE | PLANNED
//   capabilities   { receive, store, prepare, dispatch, report_sales, report_inventory }
//   capacity_units capacidad total de pallets/cajas
//   capacity_used  ocupación actual
//
// Campos legacy (location, entity) se mantienen para no
// romper consumidores existentes (Dashboard, Expedientes, etc.).
// ─────────────────────────────────────────────────────────
export const NODES = [
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    node_id: 'SHA-CN',
    name: 'Shanghái DC',
    country: 'CN',
    flag: '🇨🇳',
    type: 'factory',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e008',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110007',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:true, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 4200, capacity_used: 2810,
    // legacy:
    location: 'Shanghái, CN', entity: 'MWT CN',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e002',
    node_id: 'NGB-CN',
    name: 'Ningbo Puerto',
    country: 'CN',
    flag: '🇨🇳',
    type: 'fiscal',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e008',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110005',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:false, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 1800, capacity_used: 430,
    location: 'Ningbo, CN', entity: 'MWT CN',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    node_id: 'LIM-PE',
    name: 'Callao CD',
    country: 'PE',
    flag: '🇵🇪',
    type: 'warehouse',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e002',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110001',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:true, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 2600, capacity_used: 2184,
    location: 'Callao, PE', entity: 'MWT PE',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e004',
    node_id: 'BUN-CO',
    name: 'Buenaventura Pto',
    country: 'CO',
    flag: '🇨🇴',
    type: 'fiscal',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e003',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110005',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:false, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 1400, capacity_used: 910,
    location: 'Buenaventura, CO', entity: 'MWT CO',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e005',
    node_id: 'SAI-CL',
    name: 'San Antonio Pto',
    country: 'CL',
    flag: '🇨🇱',
    type: 'fiscal',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e004',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110005',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:false, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 1600, capacity_used: 640,
    location: 'San Antonio, CL', entity: 'MWT CL',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    node_id: 'PTY-PA',
    name: 'Panamá Hub',
    country: 'PA',
    flag: '🇵🇦',
    type: 'distributor',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e005',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110004',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:true, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 3200, capacity_used: 1580,
    location: 'Panamá, PA', entity: 'MWT PA',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e007',
    node_id: 'SSZ-BR',
    name: 'Santos Puerto',
    country: 'BR',
    flag: '🇧🇷',
    type: 'fiscal',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e006',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110005',
    status: 'PLANNED',
    capabilities: { receive:true, store:false, prepare:false, dispatch:true, report_sales:false, report_inventory:false },
    capacity_units: 2000, capacity_used: 0,
    location: 'Santos, BR', entity: 'MWT BR',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008',
    node_id: 'FBA-US',
    name: 'Amazon FBA USA',
    country: 'US',
    flag: '🇺🇸',
    type: 'marketplace',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e007',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110002',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:true, dispatch:true, report_sales:true, report_inventory:true },
    capacity_units: 9000, capacity_used: 6340,
    location: 'Múltiples FC, US', entity: 'MWT US',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009',
    node_id: 'MLM-MX',
    name: 'Mercado Libre Full MX',
    country: 'MX',
    flag: '🇲🇽',
    type: 'marketplace',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e001',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110003',
    status: 'ACTIVE',
    capabilities: { receive:true, store:true, prepare:true, dispatch:true, report_sales:true, report_inventory:true },
    capacity_units: 5200, capacity_used: 2990,
    location: 'CDMX / Guadalajara, MX', entity: 'MWT MX',
  },
  {
    id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e010',
    node_id: 'CRC-FZ',
    name: 'Almacén Fiscal CR',
    country: 'CR',
    flag: '🇨🇷',
    type: 'fiscal',
    legal_entity_id: '9a1e2bfc-7e4a-4b6a-93e1-01c1f2a0e005',
    operator_id:     '7c2ab401-aeb1-42f1-b1c0-111111110001',
    status: 'PLANNED',
    capabilities: { receive:true, store:true, prepare:false, dispatch:true, report_sales:false, report_inventory:true },
    capacity_units: 1200, capacity_used: 0,
    location: 'Alajuela, CR', entity: 'MWT PA',
  },
];

// ─────────────────────────────────────────────────────────
// Inventario por nodo (NODE_INVENTORY) — SKUs × nodo × días de stock
// ─────────────────────────────────────────────────────────
export const NODE_INVENTORY = [
  // FBA-US — surtido alto, rotación alta → días de stock variados
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', sku: 'BIS-OXF-BLK-42', qty: 420, days_stock: 42, value: 18900 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', sku: 'LEO-SN-WH-38',   qty: 380, days_stock: 28, value: 14300 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', sku: 'ORB-BKP-20L',    qty: 210, days_stock: 18, value:  9700 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', sku: 'VEL-RN-BLU-40',  qty: 640, days_stock: 52, value: 22400 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', sku: 'GOL-BT-BLK-44',  qty:  95, days_stock: 14, value:  5200 },
  // MLM-MX
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', sku: 'BIS-OXF-TAN-42', qty: 180, days_stock: 31, value:  8100 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', sku: 'ORB-WLT-BLK',    qty: 340, days_stock: 47, value:  7800 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', sku: 'LEO-SN-WH-38',   qty: 220, days_stock: 22, value:  8300 },
  // LIM-PE
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', sku: 'BIS-OXF-BLK-42', qty: 310, days_stock: 38, value: 13950 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', sku: 'BIS-BLT-BRN-L',  qty: 140, days_stock: 19, value:  3900 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', sku: 'VEL-RN-BLU-40',  qty:  72, days_stock: 11, value:  2500 },
  // PTY-PA
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', sku: 'ORB-BKP-20L',    qty: 540, days_stock: 40, value: 24900 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', sku: 'GOL-BT-BLK-44',  qty: 290, days_stock: 34, value: 15800 },
  // SHA-CN (fábrica — acumulado grande)
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', sku: 'BIS-OXF-BLK-42', qty: 1400, days_stock: 60, value: 63000 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', sku: 'LEO-SN-WH-38',   qty: 1100, days_stock: 55, value: 41500 },
  { node_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', sku: 'VEL-RN-BLU-40',  qty:  780, days_stock: 40, value: 27300 },
];

// ─────────────────────────────────────────────────────────
// Transferencias entre nodos (ENT_OPS_TRANSFERS)
// ─────────────────────────────────────────────────────────
export const NODE_TRANSFERS = [
  { id:'TR-2026-00421', date:'2026-04-18', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', skus: 3, units: 820, status:'in_transit' },
  { id:'TR-2026-00419', date:'2026-04-15', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', skus: 2, units: 410, status:'received'   },
  { id:'TR-2026-00418', date:'2026-04-14', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', skus: 1, units: 230, status:'approved'   },
  { id:'TR-2026-00415', date:'2026-04-10', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e002', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', skus: 4, units: 560, status:'received'   },
  { id:'TR-2026-00413', date:'2026-04-08', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', skus: 1, units: 120, status:'planned'    },
  { id:'TR-2026-00410', date:'2026-04-05', from:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001', to:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', skus: 2, units: 340, status:'in_transit' },
];

// ─────────────────────────────────────────────────────────
// Automatizaciones ancladas a nodos (context anchors)
// ─────────────────────────────────────────────────────────
export const NODE_AUTOMATIONS = [
  { id:'au1', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', name:'Sync FBA inbound shipments',   cadence:'cada 15 min', state:'active' },
  { id:'au2', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', name:'Cálculo restock semanal',       cadence:'lunes 07:00', state:'active' },
  { id:'au3', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008', name:'Alerta días de stock < 21',     cadence:'diario 08:00', state:'active' },
  { id:'au4', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', name:'Sync Mercado Libre stock',      cadence:'cada 30 min', state:'active' },
  { id:'au5', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009', name:'Sugerencia reprecio',           cadence:'diario 06:00', state:'paused' },
  { id:'au6', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003', name:'Cierre fiscal mensual',         cadence:'fin de mes',   state:'active' },
  { id:'au7', node_id:'3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006', name:'Consolidación hub LatAm',        cadence:'diario 22:00', state:'active' },
];

export const PRODUCTS = [
  { id: 'p1',  brand: 'Bison',   sku: 'BIS-OXF-BLK-42', name: 'Oxford cuero negro',  category: 'Calzado', desc: 'Oxford caballero cuero vacuno' },
  { id: 'p2',  brand: 'Bison',   sku: 'BIS-OXF-TAN-42', name: 'Oxford cuero tan',    category: 'Calzado', desc: 'Oxford caballero cuero vacuno' },
  { id: 'p3',  brand: 'Goliath', sku: 'GOL-BT-BLK-44',  name: 'Bota industrial',     category: 'Calzado', desc: 'Bota industrial puntera acero' },
  { id: 'p4',  brand: 'Leopard', sku: 'LEO-SN-WH-38',   name: 'Sneaker blanco',      category: 'Calzado', desc: 'Sneaker urbano' },
  { id: 'p5',  brand: 'Orbis',   sku: 'ORB-BKP-20L',    name: 'Mochila 20L',         category: 'Accesorios', desc: 'Mochila laptop 20 litros' },
  { id: 'p6',  brand: 'Velox',   sku: 'VEL-RN-BLU-40',  name: 'Running azul',        category: 'Calzado', desc: 'Zapatilla running' },
  { id: 'p7',  brand: 'Bison',   sku: 'BIS-BLT-BRN-L',  name: 'Cinturón cuero L',    category: 'Accesorios', desc: 'Cinturón cuero marrón' },
  { id: 'p8',  brand: 'Orbis',   sku: 'ORB-WLT-BLK',    name: 'Billetera negra',     category: 'Accesorios', desc: 'Billetera cuero slim' },
];

export const STATES = ['REGISTRO','PRODUCCION','PREPARACION','DESPACHO','TRANSITO','EN_DESTINO','CERRADO'];

const rand = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

// ── Historical phase durations in days (company baseline) ─────
export const PHASE_BASELINE = {
  REGISTRO:    3,
  PRODUCCION: 32,
  PREPARACION: 8,
  DESPACHO:    5,
  TRANSITO:   28,
  EN_DESTINO:  7,
};

function makeExpediente(n) {
  const status = pick(STATES.slice(0, 6)); // keep active
  const client = CLIENTS[n % CLIENTS.length];
  const brand  = BRANDS[(n+1) % BRANDS.length];
  const credit_days = Math.floor(rand(10, 95));
  const cost_total   = Math.round(rand(18000, 260000));
  const invoiced     = Math.round(cost_total * rand(1.10, 1.32));
  const paid         = Math.round(invoiced * rand(0.1, 0.95));
  // CEO fields
  const projected_margin = +rand(0.14, 0.28).toFixed(3);
  const margin_drift     = +rand(-0.06, 0.04).toFixed(3);         // real vs proyectado
  const real_margin      = +Math.max(0.02, projected_margin + margin_drift).toFixed(3);
  const op_mode          = pick(['COMISION','FULL']);
  const commission_pct   = op_mode === 'COMISION' ? +rand(0.04, 0.09).toFixed(3) : null;
  const dai_pct          = +rand(0.06, 0.12).toFixed(3);
  const iva_pct          = 0.18;
  const dai_amount       = Math.round(cost_total * dai_pct);
  const iva_amount       = Math.round((cost_total + dai_amount) * iva_pct);
  const logistic_cost    = Math.round(cost_total * rand(0.08, 0.16));
  const base_price       = Math.round(invoiced * rand(0.96, 1.04));
  const deferred_total_price = Math.round(invoiced * rand(0.92, 1.08));
  const show_deferred_to_client = Math.random() < 0.3;
  const cost_corrections = Math.random() < 0.22;
  const proforma_reviewed = Math.random() < 0.18;
  // Payments breakdown
  const pg_verified   = Math.round(paid * rand(0.55, 0.85));
  const pg_released   = Math.round(paid * rand(0.10, 0.30));
  const pg_pending    = Math.max(0, paid - pg_verified - pg_released);
  const pg_rejected   = Math.round(invoiced * rand(0, 0.03));
  // Phase timing: time in current phase vs baseline
  const baseline_days = PHASE_BASELINE[status] || 10;
  const time_in_phase = Math.round(baseline_days * rand(0.3, 1.7));
  const phase_ratio   = time_in_phase / baseline_days;
  const phase_signal  = phase_ratio < 0.9 ? 'green' : phase_ratio < 1.2 ? 'green' : phase_ratio < 1.5 ? 'amber' : 'red';
  const destinos = {Perú:'Callao',Chile:'San Antonio',Argentina:'Buenos Aires',Colombia:'Buenaventura',México:'Manzanillo',Ecuador:'Guayaquil','R. Dominicana':'Caucedo'};
  const origenes = ['Shanghái','Ningbo','Qingdao','Shenzhen'];
  const is_blocked_hard = credit_days > 75 || client.band === 'RED' && Math.random() < 0.35;
  const block_cause = is_blocked_hard
    ? (credit_days > 75 ? 'credit_75' : 'docs')
    : null;
  const factory_delay = !is_blocked_hard && Math.random() < 0.18;
  return {
    id: 'EXP-' + (1027 + n),
    ref: 'EXP-' + (1027 + n),
    oc_client: 'PO-2026-' + String(4100 + n).padStart(5,'0'),
    sap: Math.random() < 0.85 ? 'SAP-' + String(50200 + n).padStart(6,'0') : null,
    proforma: 'PF-' + String(910 + n).padStart(4,'0'),
    client: client.name,
    client_country: client.country,
    client_id: client.id,
    brand: brand.name,
    brand_id: brand.id,
    status,
    credit_days,
    credit_band: client.band,
    is_blocked: is_blocked_hard,
    block_reason: is_blocked_hard
      ? (credit_days > 75 ? 'Reloj crédito > 75d (bloqueo)' : 'Documentos pendientes')
      : null,
    block_cause,
    factory_delay,
    artifacts_done: Math.floor(rand(1, 6)),
    artifacts_total: 6,
    op_mode: Math.random() < 0.45 ? 'B' : 'C',  // Modo B (Comisión) vs Modo C (FULL)
    total_cost: cost_total,
    total_invoiced: invoiced,
    total_paid: paid,
    balance: invoiced - paid,
    // CEO / finance
    projected_margin, real_margin, margin_drift,
    op_mode, commission_pct,
    dai_pct, iva_pct, dai_amount, iva_amount, logistic_cost,
    base_price, deferred_total_price, show_deferred_to_client,
    cost_corrections, proforma_reviewed,
    // Payments split
    pg_verified, pg_released, pg_pending, pg_rejected,
    // Phase timing
    time_in_phase, baseline_days, phase_ratio, phase_signal,
    currency: 'USD',
    mode: pick(['FOB','CIF','DDP','EXW']),
    freight_mode: pick(['SEA','AIR']),
    dispatch_mode: pick(['FCL','LCL']),
    origin: pick(origenes) + ', CN',
    destination: destinos[client.country] + ', ' + client.country,
    shipment_date: randomRecentDate(-60, 40),
    eta: randomRecentDate(5, 55),
    created_at: randomRecentDate(-120, -20),
    updated_at: randomRecentDate(-14, 0),
    last_event_at: randomRecentDate(-3, 0),
    product_count: Math.floor(rand(2, 6)),
    container_count: Math.floor(rand(1, 4)),
    notes: '',
  };
}

function randomRecentDate(daysFrom, daysTo) {
  const now = Date.now();
  const day = 86400000;
  const offset = rand(daysFrom, daysTo) * day;
  return new Date(now + offset).toISOString();
}

export const EXPEDIENTES = Array.from({length: 32}, (_, i) => makeExpediente(i));

// One hero expediente with rich detail
export const HERO_ID = EXPEDIENTES[2].id;
EXPEDIENTES[2] = {
  ...EXPEDIENTES[2],
  id: HERO_ID,
  ref: HERO_ID,
  oc_client: 'PO-2026-04128',
  sap: 'SAP-502147',
  proforma: 'PF-0942',
  client: 'Andes Retail Co.',
  client_country: 'Perú',
  client_id: 'c1',
  brand: 'Bison',
  brand_id: 'bis',
  status: 'TRANSITO',
  credit_days: 62,
  credit_band: 'AMBER',
  is_blocked: false,
  artifacts_done: 4,
  artifacts_total: 6,
  op_mode: 'C',
  total_cost: 148200,
  total_invoiced: 189600,
  total_paid: 94800,
  balance: 94800,
  currency: 'USD',
  mode: 'CIF',
  freight_mode: 'SEA',
  dispatch_mode: 'FCL',
  origin: 'Shanghái, CN',
  destination: 'Callao, Perú',
  container_count: 2,
  product_count: 4,
  notes: 'Lote invierno 2026. Revisar tallas 42-44 con QC interno antes del despacho.',
};

// ── Product lines for the hero expediente ─────
export const HERO_LINES = [
  { id: 'l1', sku: 'BIS-OXF-BLK-42', name: 'Oxford cuero negro T.42', qty: 420, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-7821094' },
  { id: 'l2', sku: 'BIS-OXF-TAN-42', name: 'Oxford cuero tan T.42',   qty: 360, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-7821094' },
  { id: 'l3', sku: 'BIS-BLT-BRN-L',  name: 'Cinturón cuero marrón L', qty: 520, unit_cost: 12.20, unit_price: 24.90, margin: 0.510, container: 'MSCU-4398721' },
  { id: 'l4', sku: 'BIS-OXF-BLK-43', name: 'Oxford cuero negro T.43', qty: 280, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-4398721' },
];

// ── Costs for the hero expediente ─────
export const HERO_COSTS = [
  { id: 'co1', date: '2026-01-14', type: 'Mercadería',         amount:  96420, currency: 'USD', visibility: 'CLIENT', supplier: 'Bison CN Ltd.',        doc: 'CI-88214' },
  { id: 'co2', date: '2026-01-22', type: 'Flete marítimo',     amount:  12800, currency: 'USD', visibility: 'CLIENT', supplier: 'MSC Line',             doc: 'BL-MSCU-99812' },
  { id: 'co3', date: '2026-01-22', type: 'Seguro',             amount:   1840, currency: 'USD', visibility: 'CLIENT', supplier: 'MAPFRE',               doc: 'POL-2026-4412' },
  { id: 'co4', date: '2026-02-03', type: 'Aduana origen',      amount:   3100, currency: 'USD', visibility: 'INTERNAL', supplier: 'CN Customs Agent',    doc: 'INV-CN-1402' },
  { id: 'co5', date: '2026-02-18', type: 'Aduana destino',     amount:   4850, currency: 'USD', visibility: 'CLIENT', supplier: 'Agencia Callao',       doc: 'INV-PE-2811' },
  { id: 'co6', date: '2026-02-20', type: 'Transporte interno', amount:   1900, currency: 'USD', visibility: 'INTERNAL', supplier: 'Transporte Rodríguez', doc: 'GRE-4422' },
  { id: 'co7', date: '2026-02-22', type: 'Almacenaje',         amount:   1290, currency: 'USD', visibility: 'CLIENT', supplier: 'Almacenes Callao',     doc: 'ALM-9921' },
];

// ── Pagos for the hero expediente ─────
export const HERO_PAGOS = [
  { id: 'pg1', date: '2026-01-12', amount: 47400, method: 'Transferencia', ref: 'TRX-88412', currency: 'USD', applied_to: 'PF-0942 · 50%',  status: 'APPLIED' },
  { id: 'pg2', date: '2026-02-04', amount: 47400, method: 'Transferencia', ref: 'TRX-91203', currency: 'USD', applied_to: 'PF-0942 · 50%',  status: 'APPLIED' },
];

// ── Artifacts (documents) ─────
export const HERO_ARTIFACTS = [
  { id: 'a1', kind: 'Proforma Cliente',    code: 'PF-0942',        status: 'issued',  date: '2026-01-10', author: 'A. Mendoza' },
  { id: 'a2', kind: 'Proforma Fábrica',    code: 'PFF-BIS-1142',   status: 'issued',  date: '2026-01-12', author: 'Bison CN' },
  { id: 'a3', kind: 'Commercial Invoice',  code: 'CI-88214',       status: 'issued',  date: '2026-01-22', author: 'Bison CN' },
  { id: 'a4', kind: 'Packing List',        code: 'PL-88214',       status: 'issued',  date: '2026-01-22', author: 'Bison CN' },
  { id: 'a5', kind: 'Bill of Lading',      code: 'BL-MSCU-99812',  status: 'pending', date: null,         author: null },
  { id: 'a6', kind: 'Factura MWT',         code: null,             status: 'future',  date: null,         author: null },
];

// ── Activity feed for hero ─────
export const HERO_ACTIVITY = [
  { id: 'ev1', t: '2026-03-28T10:14:00Z', who: 'A. Mendoza',    what: 'Zarpe confirmado',               detail: 'Nave MSC Leone zarpó de Ningbo. ETA Callao 2026-04-22.' },
  { id: 'ev2', t: '2026-03-26T16:02:00Z', who: 'Sistema',       what: 'Artefacto recibido',             detail: 'Bill of Lading preliminar recibido de MSC.' },
  { id: 'ev3', t: '2026-03-21T09:41:00Z', who: 'L. Paredes',    what: 'Pago registrado',                detail: 'Transferencia USD 47,400 aplicada a PF-0942 (saldo 50%).' },
  { id: 'ev4', t: '2026-03-18T12:30:00Z', who: 'A. Mendoza',    what: 'Cambio de estado',               detail: 'DESPACHO → TRANSITO. Salida de aduana China confirmada.' },
  { id: 'ev5', t: '2026-03-04T08:12:00Z', who: 'Bison CN',      what: 'Producción finalizada',          detail: 'Lote de 1,580 pares liberado para despacho.' },
  { id: 'ev6', t: '2026-02-22T11:45:00Z', who: 'Sistema',       what: 'Cost registrado',                detail: 'Almacenaje USD 1,290 asignado a EXP-1029.' },
  { id: 'ev7', t: '2026-01-14T14:05:00Z', who: 'A. Mendoza',    what: 'Expediente creado',              detail: 'EXP-1029 creado desde proforma PF-0942.' },
];

// ── Inventory ─────
export const INVENTORY = [
  // node · sku · qty / reserved / vendidos / days_stock (para semáforo salud)
  { sku: 'BIS-OXF-BLK-42', product: 'Oxford cuero negro T.42', node: 'Callao CD',       qty: 248, reserved: 120, vendidos: 186, lot: 'BIS-L-24-01', received: '2026-02-22', days_stock: 38 },
  { sku: 'BIS-OXF-TAN-42', product: 'Oxford cuero tan T.42',   node: 'Callao CD',       qty: 210, reserved: 200, vendidos: 142, lot: 'BIS-L-24-01', received: '2026-02-22', days_stock: 12 },
  { sku: 'GOL-BT-BLK-44',  product: 'Bota industrial 44',      node: 'Callao CD',       qty:  89, reserved:   0, vendidos:  64, lot: 'GOL-L-23-48', received: '2026-01-14', days_stock: 18 },
  { sku: 'LEO-SN-WH-38',   product: 'Sneaker blanco 38',       node: 'Panamá Hub',      qty: 560, reserved: 280, vendidos: 420, lot: 'LEO-L-24-02', received: '2026-03-02', days_stock: 44 },
  { sku: 'ORB-BKP-20L',    product: 'Mochila 20L',             node: 'Buenaventura Pto',qty: 312, reserved:  60, vendidos: 198, lot: 'ORB-L-24-01', received: '2026-02-18', days_stock: 29 },
  { sku: 'VEL-RN-BLU-40',  product: 'Running azul 40',         node: 'San Antonio Pto', qty: 128, reserved:  40, vendidos:  86, lot: 'VEL-L-24-01', received: '2026-03-07', days_stock: 17 },
  { sku: 'BIS-BLT-BRN-L',  product: 'Cinturón cuero marrón L', node: 'Callao CD',       qty: 520, reserved: 320, vendidos: 388, lot: 'BIS-L-24-01', received: '2026-02-22', days_stock: 48 },
  { sku: 'ORB-WLT-BLK',    product: 'Billetera negra',         node: 'Panamá Hub',      qty: 190, reserved:  20, vendidos:  92, lot: 'ORB-L-24-01', received: '2026-03-02', days_stock: 52 },
  { sku: 'BIS-OXF-BLK-42', product: 'Oxford cuero negro T.42', node: 'Shanghái DC',     qty:1400, reserved:   0, vendidos:   0, lot: 'BIS-L-24-03', received: '2026-03-18', days_stock: 60 },
  { sku: 'LEO-SN-WH-38',   product: 'Sneaker blanco 38',       node: 'Amazon FBA USA',  qty: 380, reserved: 140, vendidos: 622, lot: 'LEO-L-24-02', received: '2026-02-08', days_stock: 26 },
  { sku: 'GOL-BT-BLK-44',  product: 'Bota industrial 44',      node: 'Amazon FBA USA',  qty:  95, reserved:  40, vendidos:  82, lot: 'GOL-L-24-01', received: '2026-02-12', days_stock: 14 },
  { sku: 'VEL-RN-BLU-40',  product: 'Running azul 40',         node: 'Mercado Libre Full MX', qty: 220, reserved:  80, vendidos: 156, lot: 'VEL-L-24-02', received: '2026-03-01', days_stock: 22 },
];

// ─────────────────────────────────────────────────────────
// TRANSFERS_IN_TRANSIT — transferencias activas (mock)
//   legal_context: internal | nationalization | reexport | distribution | consignment
// ─────────────────────────────────────────────────────────
export const TRANSFERS_IN_TRANSIT = [
  {
    id: 'TRF-2026-0018', origen:'Shanghái DC', destino:'Callao CD',
    legal_context: 'nationalization', ref_tracking: 'BL-COSCO-88421',
    units_total: 820, units_reserved: 420,
    created: '2026-04-02', eta: '2026-04-28',
    status: 'TRANSITO',
  },
  {
    id: 'TRF-2026-0019', origen:'Shanghái DC', destino:'Amazon FBA USA',
    legal_context: 'distribution', ref_tracking: 'AWB-FX-90214',
    units_total: 340, units_reserved: 0,
    created: '2026-04-08', eta: '2026-04-22',
    status: 'TRANSITO',
  },
  {
    id: 'TRF-2026-0020', origen:'Panamá Hub', destino:'Mercado Libre Full MX',
    legal_context: 'consignment', ref_tracking: 'AWB-DHL-44120',
    units_total: 260, units_reserved: 120,
    created: '2026-04-12', eta: '2026-04-19',
    status: 'TRANSITO',
  },
];

// Helpers del módulo Inventario
export function getDaysStockTier(d) {
  if (d >= 35) return 'OK';       // verde  — >35 días
  if (d >= 21) return 'WARN';     // amarillo — 21–35
  return 'CRIT';                  // rojo — <21
}

// ─────────────────────────────────────────────────────────
// TRANSFERS — Dataset completo (ENT_OPS_TRANSFERS)
//   state machine: planned → approved → in_transit → received → reconciled
//   legal_context: internal | nationalization | reexport | distribution | consignment
//   needs_approval: true cuando supera monto o implica cambio de ownership legal
//   Cada transferencia lleva líneas (SKUs) con:
//     qty_transfer    unidades que físicamente viajan
//     qty_reserve     unidades pre-comprometidas del total transferido
//     qty_received    null hasta que se reciba, luego cantidad validada en destino
// ─────────────────────────────────────────────────────────
export const TRANSFERS = [
  // ── PLANNED (pendientes de aprobación / alistamiento) ─────
  {
    id: 'TRF-2026-0024',
    created_at: '2026-04-19',
    dispatched_at: null,
    eta: '2026-05-12',
    received_at: null,
    origen: 'Shanghái DC', destino: 'Callao CD',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    legal_context: 'nationalization',
    ref_tracking: '',
    status: 'planned',
    needs_approval: true,        // > USD 80k → requiere CEO
    value_usd: 92400,
    created_by: 'A. Mendoza', approved_by: null, received_by: null,
    notes: 'Lote ene-26 Bison. Espera visto bueno CEO (monto).',
    lines: [
      { sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', qty_transfer: 720, qty_reserve: 420, qty_received: null },
      { sku:'BIS-OXF-TAN-42', product:'Oxford cuero tan T.42',   qty_transfer: 480, qty_reserve: 240, qty_received: null },
      { sku:'BIS-BLT-BRN-L',  product:'Cinturón cuero marrón L', qty_transfer: 300, qty_reserve:   0, qty_received: null },
    ],
  },
  {
    id: 'TRF-2026-0023',
    created_at: '2026-04-18',
    dispatched_at: null,
    eta: '2026-04-29',
    received_at: null,
    origen: 'Callao CD', destino: 'Panamá Hub',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    legal_context: 'internal',
    ref_tracking: '',
    status: 'planned',
    needs_approval: false,
    value_usd: 12800,
    created_by: 'L. Paredes', approved_by: null, received_by: null,
    notes: 'Rebalance regional LatAm.',
    lines: [
      { sku:'ORB-BKP-20L',  product:'Mochila 20L',       qty_transfer: 120, qty_reserve: 40, qty_received: null },
      { sku:'ORB-WLT-BLK',  product:'Billetera negra',    qty_transfer:  80, qty_reserve:  0, qty_received: null },
    ],
  },

  // ── APPROVED (listos para despacho) ─────
  {
    id: 'TRF-2026-0022',
    created_at: '2026-04-17',
    dispatched_at: null,
    eta: '2026-04-26',
    received_at: null,
    origen: 'Panamá Hub', destino: 'Amazon FBA USA',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008',
    legal_context: 'distribution',
    ref_tracking: 'AWB-FX-90318',
    status: 'approved',
    needs_approval: false,
    value_usd: 34200,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: null,
    notes: 'Distribución FBA · prep cross-dock 24h.',
    lines: [
      { sku:'LEO-SN-WH-38', product:'Sneaker blanco 38',  qty_transfer: 260, qty_reserve: 140, qty_received: null },
      { sku:'ORB-WLT-BLK',  product:'Billetera negra',     qty_transfer: 140, qty_reserve:  60, qty_received: null },
    ],
  },
  {
    id: 'TRF-2026-0021',
    created_at: '2026-04-15',
    dispatched_at: null,
    eta: '2026-04-24',
    received_at: null,
    origen: 'Panamá Hub', destino: 'Mercado Libre Full MX',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009',
    legal_context: 'consignment',
    ref_tracking: 'AWB-DHL-44211',
    status: 'approved',
    needs_approval: false,
    value_usd: 18700,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: null,
    notes: 'Consignación MELI Full MX.',
    lines: [
      { sku:'VEL-RN-BLU-40', product:'Running azul 40', qty_transfer: 180, qty_reserve: 80, qty_received: null },
    ],
  },

  // ── IN_TRANSIT (viajando) ─────
  {
    id: 'TRF-2026-0020',
    created_at: '2026-04-12',
    dispatched_at: '2026-04-13',
    eta: '2026-04-19',
    received_at: null,
    origen: 'Panamá Hub', destino: 'Mercado Libre Full MX',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009',
    legal_context: 'consignment',
    ref_tracking: 'AWB-DHL-44120',
    status: 'in_transit',
    needs_approval: false,
    value_usd: 21400,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: null,
    notes: '',
    lines: [
      { sku:'VEL-RN-BLU-40', product:'Running azul 40',  qty_transfer: 180, qty_reserve: 80, qty_received: null },
      { sku:'LEO-SN-WH-38',  product:'Sneaker blanco 38', qty_transfer:  80, qty_reserve: 40, qty_received: null },
    ],
  },
  {
    id: 'TRF-2026-0019',
    created_at: '2026-04-08',
    dispatched_at: '2026-04-09',
    eta: '2026-04-22',
    received_at: null,
    origen: 'Shanghái DC', destino: 'Amazon FBA USA',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008',
    legal_context: 'distribution',
    ref_tracking: 'AWB-FX-90214',
    status: 'in_transit',
    needs_approval: false,
    value_usd: 38900,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: null,
    notes: '',
    lines: [
      { sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', qty_transfer: 220, qty_reserve:   0, qty_received: null },
      { sku:'GOL-BT-BLK-44',  product:'Bota industrial 44',      qty_transfer: 120, qty_reserve:   0, qty_received: null },
    ],
  },
  {
    id: 'TRF-2026-0018',
    created_at: '2026-04-02',
    dispatched_at: '2026-04-03',
    eta: '2026-04-28',
    received_at: null,
    origen: 'Shanghái DC', destino: 'Callao CD',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    legal_context: 'nationalization',
    ref_tracking: 'BL-COSCO-88421',
    status: 'in_transit',
    needs_approval: false,
    value_usd: 56800,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: null,
    notes: '',
    lines: [
      { sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', qty_transfer: 420, qty_reserve: 220, qty_received: null },
      { sku:'BIS-OXF-TAN-42', product:'Oxford cuero tan T.42',   qty_transfer: 260, qty_reserve: 120, qty_received: null },
      { sku:'BIS-BLT-BRN-L',  product:'Cinturón cuero marrón L', qty_transfer: 140, qty_reserve:  80, qty_received: null },
    ],
  },

  // ── RECEIVED sin discrepancia (pronto reconciliada) ─────
  {
    id: 'TRF-2026-0017',
    created_at: '2026-03-28', dispatched_at: '2026-03-29',
    eta: '2026-04-12', received_at: '2026-04-11',
    origen: 'Buenaventura Pto', destino: 'Panamá Hub',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e004',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    legal_context: 'internal',
    ref_tracking: 'GRE-CO-77214',
    status: 'received',
    needs_approval: false,
    value_usd: 14800,
    created_by: 'L. Paredes', approved_by: 'A. Mendoza', received_by: 'M. Serrano',
    notes: '',
    lines: [
      { sku:'ORB-BKP-20L', product:'Mochila 20L', qty_transfer: 180, qty_reserve: 40, qty_received: 180 },
      { sku:'ORB-WLT-BLK', product:'Billetera negra', qty_transfer: 80, qty_reserve: 0, qty_received: 80 },
    ],
  },

  // ── RECEIVED con discrepancia (pendiente reconciliación) ─────
  {
    id: 'TRF-2026-0016',
    created_at: '2026-03-22', dispatched_at: '2026-03-23',
    eta: '2026-04-06', received_at: '2026-04-08',
    origen: 'San Antonio Pto', destino: 'Callao CD',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e005',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    legal_context: 'internal',
    ref_tracking: 'GRE-CL-66110',
    status: 'received',
    needs_approval: false,
    has_discrepancy: true,
    value_usd: 17800,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: 'J. Rojas',
    notes: 'Diferencia detectada en Running 40 — reconciliar con operador origen.',
    lines: [
      { sku:'VEL-RN-BLU-40', product:'Running azul 40', qty_transfer: 160, qty_reserve: 60, qty_received: 152 },
      { sku:'LEO-SN-WH-38',  product:'Sneaker blanco 38', qty_transfer: 120, qty_reserve: 40, qty_received: 120 },
    ],
  },
  {
    id: 'TRF-2026-0015',
    created_at: '2026-03-18', dispatched_at: '2026-03-19',
    eta: '2026-04-01', received_at: '2026-04-02',
    origen: 'Shanghái DC', destino: 'Panamá Hub',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e006',
    legal_context: 'distribution',
    ref_tracking: 'BL-MSCU-99812',
    status: 'received',
    needs_approval: false,
    has_discrepancy: true,
    value_usd: 42900,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: 'M. Serrano',
    notes: 'Faltan 12 unidades Oxford 42 — investigar en origen.',
    lines: [
      { sku:'BIS-OXF-BLK-42', product:'Oxford cuero negro T.42', qty_transfer: 320, qty_reserve: 120, qty_received: 308 },
      { sku:'BIS-OXF-TAN-42', product:'Oxford cuero tan T.42',   qty_transfer: 180, qty_reserve:  60, qty_received: 180 },
    ],
  },

  // ── RECONCILED (cerradas limpias) ─────
  {
    id: 'TRF-2026-0014',
    created_at: '2026-03-05', dispatched_at: '2026-03-06',
    eta: '2026-03-20', received_at: '2026-03-19',
    origen: 'Shanghái DC', destino: 'Buenaventura Pto',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e001',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e004',
    legal_context: 'nationalization',
    ref_tracking: 'BL-COSCO-88220',
    status: 'reconciled',
    needs_approval: false,
    value_usd: 28400,
    created_by: 'A. Mendoza', approved_by: 'CEO', received_by: 'R. Ortega',
    notes: '',
    lines: [
      { sku:'ORB-BKP-20L',  product:'Mochila 20L',   qty_transfer: 240, qty_reserve: 60, qty_received: 240 },
      { sku:'GOL-BT-BLK-44', product:'Bota industrial 44', qty_transfer: 140, qty_reserve: 40, qty_received: 140 },
    ],
  },
  {
    id: 'TRF-2026-0013',
    created_at: '2026-02-28', dispatched_at: '2026-03-01',
    eta: '2026-03-14', received_at: '2026-03-13',
    origen: 'Callao CD', destino: 'Amazon FBA USA',
    origen_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003',
    destino_id: '3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008',
    legal_context: 'reexport',
    ref_tracking: 'AWB-FX-88711',
    status: 'reconciled',
    needs_approval: false,
    value_usd: 19200,
    created_by: 'L. Paredes', approved_by: 'A. Mendoza', received_by: 'S. Park',
    notes: '',
    lines: [
      { sku:'BIS-BLT-BRN-L', product:'Cinturón cuero marrón L', qty_transfer: 180, qty_reserve: 80, qty_received: 180 },
    ],
  },
];

// Meta del state machine — (sólo strings/hex, sin JSX)
export const TRANSFER_STATUS_META = {
  planned:    { label:'Planificada',    sub:'Awaiting approval/prep', color:'#6B7280', soft:'rgba(107,114,128,0.12)' },
  approved:   { label:'Aprobada',        sub:'Ready to dispatch',      color:'#3083FE', soft:'rgba(48,131,254,0.12)'  },
  in_transit: { label:'En tránsito',     sub:'Moving in the network',  color:'#B45309', soft:'rgba(180,83,9,0.12)'    },
  received:   { label:'Recibida',         sub:'Arrived at destination', color:'#1DE394', soft:'rgba(29,227,148,0.14)'  },
  reconciled: { label:'Reconciliada',     sub:'Closed — no variance',   color:'#0E8A6D', soft:'rgba(14,138,109,0.14)'  },
};

export const LEGAL_CONTEXT_META = {
  internal:        { label:'Redistribución interna', color:'#3083FE' },
  nationalization: { label:'Nacionalización',         color:'#00B286' },
  reexport:        { label:'Reexportación',           color:'#481EE3' },
  distribution:    { label:'A distribuidor',           color:'#1EE3D7' },
  consignment:     { label:'Consignación',             color:'#B45309' },
};

// Helper — totales por transferencia
export function getTransferTotals(t) {
  const units_total    = t.lines.reduce((a,l) => a + (l.qty_transfer || 0), 0);
  const units_reserved = t.lines.reduce((a,l) => a + (l.qty_reserve  || 0), 0);
  const units_received = t.lines.reduce((a,l) => a + (l.qty_received || 0), 0);
  const lines_count    = t.lines.length;
  const has_discrepancy = t.lines.some(l => l.qty_received != null && l.qty_received !== l.qty_transfer);
  return { units_total, units_reserved, units_received, lines_count, has_discrepancy };
}

// ── Dashboard KPIs ─────
export const DASHBOARD = {
  kpi: {
    active: EXPEDIENTES.length,
    total_cost:       EXPEDIENTES.reduce((a,e)=>a+e.total_cost,0),
    total_invoiced:   EXPEDIENTES.reduce((a,e)=>a+e.total_invoiced,0),
    total_paid:       EXPEDIENTES.reduce((a,e)=>a+e.total_paid,0),
    receivables:      EXPEDIENTES.reduce((a,e)=>a+e.balance,0),
    margin_pct: 0.187,
  },
  by_status: STATES.slice(0,6).map(s => ({ status: s, count: EXPEDIENTES.filter(e => e.status === s).length })),
  by_brand: BRANDS.map(b => ({
    brand: b.name,
    count: EXPEDIENTES.filter(e=>e.brand_id===b.id).length,
    total_cost:   EXPEDIENTES.filter(e=>e.brand_id===b.id).reduce((a,e)=>a+e.total_cost,0),
    total_invoiced: EXPEDIENTES.filter(e=>e.brand_id===b.id).reduce((a,e)=>a+e.total_invoiced,0),
  })),
  urgent: EXPEDIENTES.filter(e => e.is_blocked || e.credit_days > 70).slice(0,5).map(e => ({
    id: e.id, ref: e.ref, client: e.client, action: e.is_blocked ? 'Resolver bloqueo de crédito' : 'Confirmar arribo antes del vencimiento',
    urgency: e.is_blocked ? 'high' : 'medium',
  })),
  cash_90: [
    {month:'Feb', invoiced: 182000, paid: 142000},
    {month:'Mar', invoiced: 248000, paid: 210000},
    {month:'Abr', invoiced: 312000, paid: 165000}, // projected
  ],
};

// ══════════════════════════════════════════════════════════════
// PURCHASE ORDERS (OC) — client-facing document, contains many lines
// An OC splits into several SAP numbers = several expedientes
// ══════════════════════════════════════════════════════════════

// Build OCs: group expedientes by OC code (we'll reshape so 1 OC = 2-3 expedientes)
function buildOCs() {
  // We take expedientes and cluster them in OCs of 1-3 expedientes each
  const ocs = [];
  let idx = 0;
  let ocCounter = 4100;
  while (idx < EXPEDIENTES.length) {
    const groupSize = 1 + Math.floor(Math.random() * 3); // 1-3 expedientes per OC
    const slice = EXPEDIENTES.slice(idx, idx + groupSize);
    if (!slice.length) break;
    const first = slice[0];
    const oc_code = 'PO-2026-' + String(ocCounter++).padStart(5,'0');
    // Rewrite oc_client across all slice members to match
    slice.forEach(exp => { exp.oc_client = oc_code; exp.oc_id = 'OC-' + (ocCounter-1); });

    // ── Lines: 2-4 per expediente inside this OC ─────
    const lines = [];
    let lineCounter = 1;
    slice.forEach((exp, si) => {
      const product_count = 2 + Math.floor(Math.random()*3);
      const brandProducts = PRODUCTS.filter(p => p.brand === exp.brand);
      for (let li = 0; li < product_count; li++) {
        const p = brandProducts[li % brandProducts.length] || PRODUCTS[li % PRODUCTS.length];
        const sizes = ['38','39','40','41','42','43','44','L','M','S','U'];
        const size = sizes[(li + si) % sizes.length];
        const qty = Math.round(rand(80, 520));
        const unit_cost  = +rand(12, 68).toFixed(2);
        const unit_price = +(unit_cost * rand(1.18, 1.42)).toFixed(2);
        const deferred_qty = Math.random() < 0.25 ? Math.round(qty * rand(0.05, 0.25)) : 0;
        const deferred_unit_price = deferred_qty > 0 ? +(unit_price * rand(1.02, 1.12)).toFixed(2) : 0;
        lines.push({
          id: 'L-' + oc_code + '-' + (lineCounter++),
          sku: p.sku,
          product: p.name,
          size,
          qty,
          unit_price,
          total_price: +(qty * unit_price).toFixed(2),
          unit_cost,
          sap: exp.sap,                    // SAP assignment (null if orphan)
          exp_id: exp.id,
          transport_mode: exp.freight_mode === 'SEA' ? 'MARITIMO' : 'AEREO',
          production_date: new Date(2026, 1 + si, 5 + (li % 20)).toISOString().slice(0,10),
          status: exp.status,
          deferred_qty,
          deferred_unit_price,
          show_deferred_to_client: Math.random() < 0.35,
        });
      }
    });

    // Add 0-2 orphan lines (without SAP) to showcase the "coverage" metric
    if (Math.random() < 0.35) {
      const orphanCount = 1 + Math.floor(Math.random()*2);
      const brandProducts = PRODUCTS.filter(p => p.brand === first.brand);
      for (let oi = 0; oi < orphanCount; oi++) {
        const p = brandProducts[oi % brandProducts.length] || PRODUCTS[oi];
        lines.push({
          id: 'L-' + oc_code + '-' + (lineCounter++),
          sku: p.sku,
          product: p.name,
          size: ['40','41','42','L'][oi % 4],
          qty: Math.round(rand(50, 200)),
          unit_price: +rand(22, 60).toFixed(2),
          total_price: 0, // computed below
          unit_cost: +rand(12, 40).toFixed(2),
          sap: null,
          exp_id: null,
          transport_mode: null,
          production_date: null,
          status: 'PENDIENTE_SAP',
          deferred_qty: 0,
          deferred_unit_price: 0,
          show_deferred_to_client: false,
        });
      }
    }
    lines.forEach(l => { if (!l.total_price) l.total_price = +(l.qty * l.unit_price).toFixed(2); });

    // Aggregates
    const total_value = lines.reduce((a,l)=>a+l.total_price, 0);
    const total_invoiced = slice.reduce((a,e)=>a+e.total_invoiced, 0);
    const total_paid     = slice.reduce((a,e)=>a+e.total_paid, 0);
    const balance        = total_invoiced - total_paid;
    const lines_with_sap = lines.filter(l => l.sap).length;
    const coverage_pct   = lines_with_sap / lines.length;
    const air_value = lines.filter(l=>l.transport_mode==='AEREO').reduce((a,l)=>a+l.total_price,0);
    const sea_value = lines.filter(l=>l.transport_mode==='MARITIMO').reduce((a,l)=>a+l.total_price,0);
    const assigned_value = air_value + sea_value;
    const air_pct = assigned_value ? air_value / assigned_value : 0;
    const sea_pct = assigned_value ? sea_value / assigned_value : 0;
    const max_credit_days = Math.max(...slice.map(e=>e.credit_days));
    const credit_band = max_credit_days > 75 ? 'RED' : max_credit_days > 60 ? 'AMBER' : 'GREEN';

    // Documents attached to the OC
    const docs = [
      { id: 'd1', kind: 'OC Cliente',        code: 'ART-01 / ' + oc_code,         date: new Date(2026, 0, 8).toISOString().slice(0,10),  size: '312 KB', ext: 'pdf', author: first.client },
      { id: 'd2', kind: 'Proforma MWT',       code: 'ART-02 / PF-' + String(900+ocCounter).padStart(4,'0'), date: new Date(2026, 0, 11).toISOString().slice(0,10), size: '218 KB', ext: 'pdf', author: 'MWT Comercial' },
      ...(lines_with_sap ? [{ id: 'd3', kind: 'Confirmación SAP Fábrica', code: 'ART-04 / ' + slice.map(e=>e.sap).filter(Boolean).join(', '), date: new Date(2026, 0, 18).toISOString().slice(0,10), size: '148 KB', ext: 'xlsx', author: first.brand + ' Fábrica' }] : []),
    ];

    ocs.push({
      id: 'OC-' + (ocCounter-1),
      code: oc_code,
      client_id: first.client_id,
      client: first.client,
      client_country: first.client_country,
      brand_id: first.brand_id,
      brand: first.brand,
      issued: new Date(2026, 0, 8).toISOString().slice(0,10),
      status: slice.every(e=>e.status==='CERRADO') ? 'CERRADO' : lines_with_sap === lines.length ? 'EN_EJECUCION' : 'ASIGNACION_PARCIAL',
      lines,
      expedientes: slice.map(e=>e.id),
      total_value,
      total_invoiced,
      total_paid,
      balance,
      coverage_pct,
      lines_count: lines.length,
      lines_with_sap,
      air_pct, sea_pct,
      max_credit_days,
      credit_band,
      docs,
    });
    idx += groupSize;
  }
  return ocs;
}

export const OCS = buildOCs();

// Pick a hero OC: the one containing HERO_ID
export const HERO_OC_ID = OCS.find(oc => oc.expedientes.includes(HERO_ID))?.id || OCS[0].id;

// ══════════════════════════════════════════════════════════════
// ARTIFACT CATALOG — global library of artifact types per state
// Each artifact defines its record fields (rendered in modal)
// ══════════════════════════════════════════════════════════════
export const ARTIFACT_CATALOG = [
  // Registro
  { id: 'AC-01', code: 'ART-01',  name: 'OC del Cliente',              state: 'REGISTRO',   kind: 'doc',
    fields: [ {k:'oc_number', l:'Número de OC', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'amount', l:'Monto', type:'money'}, {k:'file', l:'Archivo', type:'file'} ] },
  { id: 'AC-02', code: 'ART-02',  name: 'Proforma MWT',                state: 'REGISTRO',   kind: 'doc',
    fields: [ {k:'pf_code', l:'Código PF', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'amount', l:'Monto', type:'money'}, {k:'valid_until', l:'Válida hasta', type:'date'}, {k:'file', l:'Archivo', type:'file'} ] },
  { id: 'AC-03', code: 'ART-03',  name: 'Pago inicial / Anticipo',     state: 'REGISTRO',   kind: 'payment',
    fields: [ {k:'amount', l:'Monto', type:'money'}, {k:'method', l:'Método', type:'select', opts:['Transferencia','Crédito','Carta de crédito']}, {k:'ref', l:'Referencia', type:'text'}, {k:'date', l:'Fecha', type:'date'} ] },

  // Producción
  { id: 'AC-04', code: 'ART-04',  name: 'Confirmación SAP Fábrica',    state: 'PRODUCCION', kind: 'doc',
    fields: [ {k:'sap_number', l:'N° SAP', type:'text'}, {k:'factory', l:'Fábrica', type:'text'}, {k:'delivery_est', l:'Fecha estimada de entrega', type:'date'}, {k:'file', l:'Confirmación', type:'file'} ] },
  { id: 'AC-05', code: 'ART-05',  name: 'Orden de Producción',         state: 'PRODUCCION', kind: 'doc',
    fields: [ {k:'po_fab', l:'OP fábrica', type:'text'}, {k:'qty', l:'Cantidad', type:'number'}, {k:'start_date', l:'Inicio producción', type:'date'}, {k:'end_date', l:'Fin producción', type:'date'} ] },
  { id: 'AC-06', code: 'ART-06',  name: 'Avance de Producción',        state: 'PRODUCCION', kind: 'progress',
    fields: [ {k:'progress_pct', l:'% Avance', type:'number'}, {k:'notes', l:'Notas', type:'textarea'}, {k:'date', l:'Fecha de reporte', type:'date'}, {k:'evidence', l:'Evidencia', type:'file'} ] },
  { id: 'AC-07', code: 'ART-07',  name: 'QC Fábrica',                  state: 'PRODUCCION', kind: 'quality',
    fields: [ {k:'qc_status', l:'Resultado', type:'select', opts:['Aprobado','Aprobado c/ observaciones','Rechazado']}, {k:'notes', l:'Observaciones', type:'textarea'}, {k:'date', l:'Fecha', type:'date'}, {k:'report', l:'Reporte QC', type:'file'} ] },

  // Preparación
  { id: 'AC-08', code: 'ART-08',  name: 'Packing List',                state: 'PREPARACION', kind: 'doc',
    fields: [ {k:'pl_code', l:'Código PL', type:'text'}, {k:'boxes', l:'Cajas', type:'number'}, {k:'weight', l:'Peso bruto (kg)', type:'number'}, {k:'cbm', l:'Volumen CBM', type:'number'}, {k:'file', l:'PDF Packing List', type:'file'} ] },
  { id: 'AC-09', code: 'ART-09',  name: 'Commercial Invoice',          state: 'PREPARACION', kind: 'doc',
    fields: [ {k:'ci_code', l:'Código CI', type:'text'}, {k:'amount', l:'Monto', type:'money'}, {k:'date', l:'Fecha', type:'date'}, {k:'file', l:'PDF CI', type:'file'} ] },
  { id: 'AC-10', code: 'ART-10',  name: 'Booking Naviero / Aéreo',     state: 'PREPARACION', kind: 'booking',
    fields: [ {k:'booking_ref', l:'Booking Ref.', type:'text'}, {k:'carrier', l:'Línea / Aerolínea', type:'text'}, {k:'vessel', l:'Nave / Vuelo', type:'text'}, {k:'etd', l:'ETD', type:'date'}, {k:'eta', l:'ETA', type:'date'} ] },

  // Despacho
  { id: 'AC-11', code: 'ART-11',  name: 'Bill of Lading / AWB',        state: 'DESPACHO',   kind: 'doc',
    fields: [ {k:'bl_code', l:'B/L o AWB', type:'text'}, {k:'issue_date', l:'Fecha de emisión', type:'date'}, {k:'container', l:'Contenedor / Guía', type:'text'}, {k:'file', l:'Archivo', type:'file'} ] },
  { id: 'AC-12', code: 'ART-12',  name: 'Declaración de Exportación',  state: 'DESPACHO',   kind: 'doc',
    fields: [ {k:'dex_code', l:'DEX', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'customs_agent', l:'Agente', type:'text'}, {k:'file', l:'PDF', type:'file'} ] },
  { id: 'AC-13', code: 'ART-13',  name: 'Seguro de Carga',             state: 'DESPACHO',   kind: 'doc',
    fields: [ {k:'policy', l:'Póliza', type:'text'}, {k:'insurer', l:'Aseguradora', type:'text'}, {k:'amount', l:'Valor asegurado', type:'money'}, {k:'file', l:'PDF', type:'file'} ] },

  // Tránsito
  { id: 'AC-14', code: 'ART-14',  name: 'Zarpe / Despegue',            state: 'TRANSITO',   kind: 'event',
    fields: [ {k:'date', l:'Fecha / hora', type:'datetime'}, {k:'port', l:'Puerto / Aeropuerto', type:'text'}, {k:'notes', l:'Notas', type:'textarea'} ] },
  { id: 'AC-15', code: 'ART-15',  name: 'Tracking en tránsito',        state: 'TRANSITO',   kind: 'tracking',
    fields: [ {k:'date', l:'Fecha', type:'date'}, {k:'location', l:'Ubicación', type:'text'}, {k:'status', l:'Estado', type:'select', opts:['En ruta','Trasbordo','Retraso','En tiempo']}, {k:'notes', l:'Notas', type:'textarea'} ] },
  { id: 'AC-16', code: 'ART-16',  name: 'Arribo al destino',           state: 'TRANSITO',   kind: 'event',
    fields: [ {k:'date', l:'Fecha arribo', type:'datetime'}, {k:'port', l:'Puerto destino', type:'text'}, {k:'notes', l:'Notas', type:'textarea'} ] },

  // En destino
  { id: 'AC-17', code: 'ART-17',  name: 'DUA / Importación',           state: 'EN_DESTINO', kind: 'doc',
    fields: [ {k:'dua_code', l:'DUA', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'customs_agent', l:'Agente', type:'text'}, {k:'duties', l:'Aranceles pagados', type:'money'}, {k:'file', l:'DUA PDF', type:'file'} ] },
  { id: 'AC-18', code: 'ART-18',  name: 'Liberación Aduana',           state: 'EN_DESTINO', kind: 'event',
    fields: [ {k:'date', l:'Fecha liberación', type:'date'}, {k:'notes', l:'Notas', type:'textarea'}, {k:'file', l:'Evidencia', type:'file'} ] },
  { id: 'AC-19', code: 'ART-19',  name: 'Entrega al cliente',          state: 'EN_DESTINO', kind: 'delivery',
    fields: [ {k:'date', l:'Fecha entrega', type:'datetime'}, {k:'receiver', l:'Receptor', type:'text'}, {k:'pod', l:'POD / Guía', type:'file'}, {k:'notes', l:'Notas', type:'textarea'} ] },

  // Cerrado
  { id: 'AC-20', code: 'ART-20',  name: 'Factura MWT al Cliente',      state: 'CERRADO',    kind: 'doc',
    fields: [ {k:'invoice_code', l:'Factura', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'amount', l:'Monto', type:'money'}, {k:'file', l:'PDF', type:'file'} ] },
  { id: 'AC-21', code: 'ART-21',  name: 'Pago Final',                  state: 'CERRADO',    kind: 'payment',
    fields: [ {k:'amount', l:'Monto', type:'money'}, {k:'method', l:'Método', type:'select', opts:['Transferencia','Cheque','Otro']}, {k:'ref', l:'Referencia', type:'text'}, {k:'date', l:'Fecha', type:'date'} ] },
  { id: 'AC-22', code: 'ART-22',  name: 'Cierre Contable',             state: 'CERRADO',    kind: 'doc',
    fields: [ {k:'date', l:'Fecha de cierre', type:'date'}, {k:'margin_real', l:'Margen real %', type:'number'}, {k:'notes', l:'Notas finales', type:'textarea'} ] },
];

// ── Seed records for the hero expediente ─────
// Map: artifactId → [records]
export const HERO_ARTIFACT_RECORDS = {
  'AC-01': [{ id:'R-1',  created:'2026-01-09', author:'A. Mendoza', oc_number:'PO-2026-04128', date:'2026-01-08', amount:189600, file:'OC_AndesRetail.pdf' }],
  'AC-02': [{ id:'R-2',  created:'2026-01-10', author:'A. Mendoza', pf_code:'PF-0942',         date:'2026-01-10', amount:189600, valid_until:'2026-01-31', file:'PF-0942.pdf' }],
  'AC-03': [{ id:'R-3',  created:'2026-01-12', author:'A. Mendoza', amount:47400, method:'Transferencia', ref:'TRX-88412', date:'2026-01-12' }],
  'AC-04': [{ id:'R-4',  created:'2026-01-15', author:'Bison CN',   sap_number:'SAP-502147',  factory:'Bison CN Ltd.', delivery_est:'2026-03-05', file:'ConfSAP_502147.xlsx' }],
  'AC-05': [{ id:'R-5',  created:'2026-01-18', author:'Bison CN',   po_fab:'OP-BIS-1142',     qty: 1580, start_date:'2026-01-22', end_date:'2026-03-04' }],
  'AC-06': [
    { id:'R-6a', created:'2026-02-01', author:'Bison CN', progress_pct: 25, notes:'Corte completado.', date:'2026-02-01', evidence:'avance_25.jpg' },
    { id:'R-6b', created:'2026-02-18', author:'Bison CN', progress_pct: 65, notes:'Armado 65%.',       date:'2026-02-18', evidence:'avance_65.jpg' },
    { id:'R-6c', created:'2026-03-03', author:'Bison CN', progress_pct: 100, notes:'Lote finalizado.',  date:'2026-03-03', evidence:'avance_100.jpg' },
  ],
  'AC-07': [{ id:'R-7',  created:'2026-03-04', author:'QC Bison',   qc_status:'Aprobado c/ observaciones', notes:'Pequeña variación de tono en T.42 TAN, aprobada por cliente.', date:'2026-03-04', report:'QC_88214.pdf' }],
  'AC-08': [{ id:'R-8',  created:'2026-01-22', author:'Bison CN',   pl_code:'PL-88214', boxes: 96, weight: 1840, cbm: 18.4, file:'PL-88214.pdf' }],
  'AC-09': [{ id:'R-9',  created:'2026-01-22', author:'Bison CN',   ci_code:'CI-88214', amount: 96420, date:'2026-01-22', file:'CI-88214.pdf' }],
  'AC-10': [{ id:'R-10', created:'2026-03-14', author:'A. Mendoza', booking_ref:'MSCU-BK-9821', carrier:'MSC Line', vessel:'MSC Leone V.2403', etd:'2026-03-26', eta:'2026-04-22' }],
  'AC-11': [{ id:'R-11', created:'2026-03-26', author:'MSC Line',   bl_code:'BL-MSCU-99812', issue_date:'2026-03-26', container:'MSCU-7821094 / MSCU-4398721', file:'BL_prelim.pdf' }],
  'AC-14': [{ id:'R-14', created:'2026-03-28', author:'Sistema',    date:'2026-03-28T10:14', port:'Ningbo, CN', notes:'Zarpe confirmado' }],
  'AC-15': [
    { id:'R-15a', created:'2026-04-05', author:'MSC Tracking', date:'2026-04-05', location:'Pacífico · Singapur',   status:'En ruta',    notes:'Trasbordo completo' },
    { id:'R-15b', created:'2026-04-14', author:'MSC Tracking', date:'2026-04-14', location:'Pacífico sur',          status:'En tiempo',  notes:'' },
  ],
};

// ═══════════════════════════════════════════════════════════
// MÓDULO PRODUCTOS + MOTOR DE TALLAS
// ENT_PRODUCTO_TALLAS · ENT_PRODUCTO_GOBIERNO · ENT_PRODUCTO_TRAZABILIDAD
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// SIZE_SYSTEMS — sistemas de medida soportados
// ─────────────────────────────────────────────────────────
export const SIZE_SYSTEMS = [
  { id: 'EU',     label: 'EU',         desc: 'Europa (Mondopoint derivado)', color: '#3083FE' },
  { id: 'US_MEN', label: 'US Men',     desc: 'Estados Unidos · Hombre',      color: '#00B286' },
  { id: 'US_WMN', label: 'US Women',   desc: 'Estados Unidos · Mujer',       color: '#481EE3' },
  { id: 'BR',     label: 'BR',         desc: 'Brasil (sist. propio)',        color: '#1DE394' },
  { id: 'CM',     label: 'CM',         desc: 'Mondopoint · centímetros',     color: '#1EE3D7' },
  { id: 'UK',     label: 'UK',         desc: 'Reino Unido',                  color: '#B45309' },
];

// ─────────────────────────────────────────────────────────
// SIZES — catálogo de tallas con especificaciones dimensionales
//   dimensional_specs
//     forefoot_mm  (Grosor antepié)
//     heel_mm      (Grosor talón)
//     drop_mm      (Drop · diferencia talón-antepié)
//     weight_g     (Peso gramos · par referencial)
//   equivalences — mapeo cross-system
// ─────────────────────────────────────────────────────────
export const SIZES = [
  // EU 38..46 (línea principal)
  { id: 'sz-eu-38', system: 'EU', valor_talla: '38', dimensional_specs: { forefoot_mm: 18, heel_mm: 30, drop_mm: 12, weight_g: 540 },
    equivalences: [ {system:'US_MEN', value:'6'},   {system:'US_WMN', value:'7.5'}, {system:'BR', value:'36'}, {system:'CM', value:'24.0'}, {system:'UK', value:'5'}   ] },
  { id: 'sz-eu-39', system: 'EU', valor_talla: '39', dimensional_specs: { forefoot_mm: 18, heel_mm: 30, drop_mm: 12, weight_g: 560 },
    equivalences: [ {system:'US_MEN', value:'6.5'}, {system:'US_WMN', value:'8'},   {system:'BR', value:'37'}, {system:'CM', value:'24.5'}, {system:'UK', value:'6'}   ] },
  { id: 'sz-eu-40', system: 'EU', valor_talla: '40', dimensional_specs: { forefoot_mm: 19, heel_mm: 31, drop_mm: 12, weight_g: 580 },
    equivalences: [ {system:'US_MEN', value:'7'},   {system:'US_WMN', value:'8.5'}, {system:'BR', value:'38'}, {system:'CM', value:'25.0'}, {system:'UK', value:'6.5'} ] },
  { id: 'sz-eu-41', system: 'EU', valor_talla: '41', dimensional_specs: { forefoot_mm: 19, heel_mm: 31, drop_mm: 12, weight_g: 600 },
    equivalences: [ {system:'US_MEN', value:'8'},   {system:'US_WMN', value:'9.5'}, {system:'BR', value:'39'}, {system:'CM', value:'25.5'}, {system:'UK', value:'7'}   ] },
  { id: 'sz-eu-42', system: 'EU', valor_talla: '42', dimensional_specs: { forefoot_mm: 20, heel_mm: 32, drop_mm: 12, weight_g: 620 },
    equivalences: [ {system:'US_MEN', value:'9'},   {system:'US_WMN', value:'10.5'},{system:'BR', value:'40'}, {system:'CM', value:'26.0'}, {system:'UK', value:'8'}   ] },
  { id: 'sz-eu-43', system: 'EU', valor_talla: '43', dimensional_specs: { forefoot_mm: 20, heel_mm: 32, drop_mm: 12, weight_g: 650 },
    equivalences: [ {system:'US_MEN', value:'9.5'}, {system:'US_WMN', value:'11'},  {system:'BR', value:'41'}, {system:'CM', value:'26.5'}, {system:'UK', value:'8.5'} ] },
  { id: 'sz-eu-44', system: 'EU', valor_talla: '44', dimensional_specs: { forefoot_mm: 21, heel_mm: 33, drop_mm: 12, weight_g: 680 },
    equivalences: [ {system:'US_MEN', value:'10.5'},{system:'US_WMN', value:'12'},  {system:'BR', value:'42'}, {system:'CM', value:'27.0'}, {system:'UK', value:'9.5'} ] },
  { id: 'sz-eu-45', system: 'EU', valor_talla: '45', dimensional_specs: { forefoot_mm: 22, heel_mm: 34, drop_mm: 12, weight_g: 710 },
    equivalences: [ {system:'US_MEN', value:'11'},  {system:'US_WMN', value:'12.5'},{system:'BR', value:'43'}, {system:'CM', value:'27.5'}, {system:'UK', value:'10'}  ] },
  { id: 'sz-eu-46', system: 'EU', valor_talla: '46', dimensional_specs: { forefoot_mm: 22, heel_mm: 34, drop_mm: 12, weight_g: 740 },
    equivalences: [ {system:'US_MEN', value:'12'},  {system:'US_WMN', value:'13'},  {system:'BR', value:'44'}, {system:'CM', value:'28.0'}, {system:'UK', value:'11'}  ] },

  // Tallas especiales
  { id: 'sz-br-39', system: 'BR', valor_talla: '39', dimensional_specs: { forefoot_mm: 18, heel_mm: 30, drop_mm: 12, weight_g: 560 },
    equivalences: [ {system:'EU', value:'41'}, {system:'US_MEN', value:'8'} ] },
  { id: 'sz-us-9',  system: 'US_MEN', valor_talla: '9',  dimensional_specs: { forefoot_mm: 20, heel_mm: 32, drop_mm: 12, weight_g: 620 },
    equivalences: [ {system:'EU', value:'42'}, {system:'BR', value:'40'}, {system:'CM', value:'26.0'} ] },
  { id: 'sz-cm-260',system: 'CM', valor_talla: '26.0',   dimensional_specs: { forefoot_mm: 20, heel_mm: 32, drop_mm: 12, weight_g: 620 },
    equivalences: [ {system:'EU', value:'42'}, {system:'US_MEN', value:'9'} ] },
];

// ─────────────────────────────────────────────────────────
// PRODUCT_SIZES — qué tallas maneja cada producto (por SKU)
// ─────────────────────────────────────────────────────────
export const PRODUCT_SIZES = [
  { sku: 'MLV-50S29-BLK-42',   sizes: ['sz-eu-38','sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44'] },
  { sku: 'MLV-40S18-BRN-41',   sizes: ['sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44','sz-eu-45'] },
  { sku: 'MLV-EVA-AST-BLK-40', sizes: ['sz-eu-38','sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43'] },
  { sku: 'MLV-FUEGO-BRN-43',   sizes: ['sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44','sz-eu-45','sz-eu-46'] },
  { sku: 'BIS-OXF-BLK-42',     sizes: ['sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44','sz-eu-45'] },
  { sku: 'BIS-OXF-TAN-42',     sizes: ['sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44'] },
  { sku: 'GOL-BT-BLK-44',      sizes: ['sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43','sz-eu-44','sz-eu-45','sz-eu-46'] },
  { sku: 'LEO-SN-WH-38',       sizes: ['sz-eu-38','sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42'] },
  { sku: 'VEL-RN-BLU-40',      sizes: ['sz-eu-39','sz-eu-40','sz-eu-41','sz-eu-42','sz-eu-43'] },
];

// ─────────────────────────────────────────────────────────
// PRODUCT_CLIENT_VISIBILITY — gobernanza de visibilidad
//   visible_to_all   master toggle
//   client_overrides { [client_id]: true|false }  solo aplica si visible_to_all=false
// ─────────────────────────────────────────────────────────
export const PRODUCT_CLIENT_VISIBILITY = [
  { sku: 'MLV-50S29-BLK-42',   visible_to_all: true,  client_overrides: {} },
  { sku: 'MLV-40S18-BRN-41',   visible_to_all: false, client_overrides: { c1:true, c2:true, c3:false, c4:false, c5:true,  c6:false, c7:false, c8:false } },
  { sku: 'MLV-EVA-AST-BLK-40', visible_to_all: true,  client_overrides: {} },
  { sku: 'MLV-FUEGO-BRN-43',   visible_to_all: false, client_overrides: { c1:true, c2:false, c3:false, c4:false, c5:true,  c6:false, c7:false, c8:false } },
  { sku: 'BIS-OXF-BLK-42',     visible_to_all: true,  client_overrides: {} },
  { sku: 'BIS-OXF-TAN-42',     visible_to_all: true,  client_overrides: {} },
  { sku: 'GOL-BT-BLK-44',      visible_to_all: false, client_overrides: { c1:false, c2:true,  c3:true,  c4:false, c5:true,  c6:false, c7:false, c8:false } },
  { sku: 'LEO-SN-WH-38',       visible_to_all: true,  client_overrides: {} },
  { sku: 'VEL-RN-BLU-40',      visible_to_all: true,  client_overrides: {} },
];

// ─────────────────────────────────────────────────────────
// PRODUCT_NODE_ASSIGNMENTS — qué nodos logísticos operan cada SKU
// ─────────────────────────────────────────────────────────
export const PRODUCT_NODE_ASSIGNMENTS = [
  { sku: 'MLV-50S29-BLK-42',   node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e004'] },
  { sku: 'MLV-40S18-BRN-41',   node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e005'] },
  { sku: 'MLV-EVA-AST-BLK-40', node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003'] },
  { sku: 'MLV-FUEGO-BRN-43',   node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e004'] },
  { sku: 'BIS-OXF-BLK-42',     node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e003','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009'] },
  { sku: 'BIS-OXF-TAN-42',     node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008'] },
  { sku: 'GOL-BT-BLK-44',      node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008'] },
  { sku: 'LEO-SN-WH-38',       node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e008','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009'] },
  { sku: 'VEL-RN-BLU-40',      node_ids: ['3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e009','3d2a1c5f-4c18-4b6b-9f10-a1b2c3d4e005'] },
];

// ─────────────────────────────────────────────────────────
// PRODUCT_EXPEDIENTE_LINES — trazabilidad de ventas históricas
//   expediente_ref   (EXP-xxxx · visible en UI)
//   client_id        link a CLIENTS
//   qty              unidades vendidas
//   unit_price_sold  precio efectivo al cobrado
//   size_breakdown   { [size_id]: qty }
//   estado           fase textual
// ─────────────────────────────────────────────────────────
export const PRODUCT_EXPEDIENTE_LINES = [
  // BIS-OXF-BLK-42 — hero + históricos
  { id:'pl-001', sku:'BIS-OXF-BLK-42', expediente_ref:'EXP-1029', client_id:'c1', estado:'TRANSITO',    qty:420, unit_price_sold: 69.90, size_breakdown:{ 'sz-eu-40':60,'sz-eu-41':80,'sz-eu-42':140,'sz-eu-43':90,'sz-eu-44':50 } },
  { id:'pl-002', sku:'BIS-OXF-BLK-42', expediente_ref:'EXP-1015', client_id:'c3', estado:'CERRADO',     qty:220, unit_price_sold: 68.00, size_breakdown:{ 'sz-eu-41':50,'sz-eu-42':90,'sz-eu-43':60,'sz-eu-44':20 } },
  { id:'pl-003', sku:'BIS-OXF-BLK-42', expediente_ref:'EXP-1044', client_id:'c7', estado:'EN_DESTINO',  qty:180, unit_price_sold: 66.50, size_breakdown:{ 'sz-eu-40':30,'sz-eu-41':40,'sz-eu-42':60,'sz-eu-43':40,'sz-eu-44':10 } },
  { id:'pl-004', sku:'BIS-OXF-BLK-42', expediente_ref:'EXP-1022', client_id:'c5', estado:'CERRADO',     qty:360, unit_price_sold: 65.00, size_breakdown:{ 'sz-eu-41':80,'sz-eu-42':140,'sz-eu-43':100,'sz-eu-44':40 } },

  // BIS-OXF-TAN-42
  { id:'pl-010', sku:'BIS-OXF-TAN-42', expediente_ref:'EXP-1029', client_id:'c1', estado:'TRANSITO',    qty:360, unit_price_sold: 69.90, size_breakdown:{ 'sz-eu-40':40,'sz-eu-41':80,'sz-eu-42':140,'sz-eu-43':70,'sz-eu-44':30 } },
  { id:'pl-011', sku:'BIS-OXF-TAN-42', expediente_ref:'EXP-1038', client_id:'c2', estado:'CERRADO',     qty:180, unit_price_sold: 58.00, size_breakdown:{ 'sz-eu-40':40,'sz-eu-41':40,'sz-eu-42':60,'sz-eu-43':30,'sz-eu-44':10 } },

  // MLV-50S29-BLK-42
  { id:'pl-020', sku:'MLV-50S29-BLK-42', expediente_ref:'EXP-1031', client_id:'c2', estado:'EN_DESTINO', qty:280, unit_price_sold: 51.00, size_breakdown:{ 'sz-eu-40':50,'sz-eu-41':60,'sz-eu-42':90,'sz-eu-43':50,'sz-eu-44':30 } },
  { id:'pl-021', sku:'MLV-50S29-BLK-42', expediente_ref:'EXP-1034', client_id:'c1', estado:'PREPARACION',qty:520, unit_price_sold: 49.00, size_breakdown:{ 'sz-eu-39':40,'sz-eu-40':80,'sz-eu-41':110,'sz-eu-42':160,'sz-eu-43':80,'sz-eu-44':50 } },

  // MLV-40S18-BRN-41
  { id:'pl-030', sku:'MLV-40S18-BRN-41', expediente_ref:'EXP-1037', client_id:'c1', estado:'PRODUCCION',  qty:240, unit_price_sold: 64.00, size_breakdown:{ 'sz-eu-40':40,'sz-eu-41':60,'sz-eu-42':80,'sz-eu-43':40,'sz-eu-44':20 } },
  { id:'pl-031', sku:'MLV-40S18-BRN-41', expediente_ref:'EXP-1040', client_id:'c5', estado:'CERRADO',     qty:180, unit_price_sold: 62.00, size_breakdown:{ 'sz-eu-41':40,'sz-eu-42':70,'sz-eu-43':50,'sz-eu-44':20 } },

  // GOL-BT-BLK-44
  { id:'pl-040', sku:'GOL-BT-BLK-44',  expediente_ref:'EXP-1022', client_id:'c3', estado:'CERRADO',     qty:180, unit_price_sold: 118.00, size_breakdown:{ 'sz-eu-42':40,'sz-eu-43':60,'sz-eu-44':50,'sz-eu-45':30 } },
  { id:'pl-041', sku:'GOL-BT-BLK-44',  expediente_ref:'EXP-1042', client_id:'c5', estado:'TRANSITO',    qty:140, unit_price_sold: 120.00, size_breakdown:{ 'sz-eu-42':30,'sz-eu-43':50,'sz-eu-44':40,'sz-eu-45':20 } },

  // LEO-SN-WH-38
  { id:'pl-050', sku:'LEO-SN-WH-38',   expediente_ref:'EXP-1031', client_id:'c2', estado:'EN_DESTINO',  qty:620, unit_price_sold: 44.00, size_breakdown:{ 'sz-eu-38':140,'sz-eu-39':180,'sz-eu-40':200,'sz-eu-41':80,'sz-eu-42':20 } },
  { id:'pl-051', sku:'LEO-SN-WH-38',   expediente_ref:'EXP-1048', client_id:'c8', estado:'CERRADO',     qty:240, unit_price_sold: 46.00, size_breakdown:{ 'sz-eu-38':60,'sz-eu-39':70,'sz-eu-40':60,'sz-eu-41':30,'sz-eu-42':20 } },
  { id:'pl-052', sku:'LEO-SN-WH-38',   expediente_ref:'EXP-1044', client_id:'c7', estado:'CERRADO',     qty:180, unit_price_sold: 46.50, size_breakdown:{ 'sz-eu-38':40,'sz-eu-39':50,'sz-eu-40':50,'sz-eu-41':30,'sz-eu-42':10 } },

  // VEL-RN-BLU-40
  { id:'pl-060', sku:'VEL-RN-BLU-40',  expediente_ref:'EXP-1038', client_id:'c2', estado:'CERRADO',     qty:360, unit_price_sold: 39.00, size_breakdown:{ 'sz-eu-39':80,'sz-eu-40':120,'sz-eu-41':90,'sz-eu-42':50,'sz-eu-43':20 } },

  // MLV-EVA-AST-BLK-40
  { id:'pl-070', sku:'MLV-EVA-AST-BLK-40', expediente_ref:'EXP-1048', client_id:'c8', estado:'CERRADO', qty:140, unit_price_sold: 43.00, size_breakdown:{ 'sz-eu-39':30,'sz-eu-40':50,'sz-eu-41':30,'sz-eu-42':20,'sz-eu-43':10 } },
];

// ═══════════════════════════════════════════════════════════
// MÓDULO PROVEEDORES · ENT_PROV_MAESTRO · ISO 9001 Compliance
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// SUPPLIERS — fabricantes, OEMs, proveedores de servicios
//   clase         CRITICO | IMPORTANTE | ESTANDAR (política ISO)
//   status        ACTIVO | EN_SELECCION | DESCARTADO
//   iso_score     1.0–5.0 (último score consolidado)
//   lead_time_*   días prometido vs. real promedio
//   certs         ['CE','RoHS','FCC','ISO 9001']
// ─────────────────────────────────────────────────────────
export const SUPPLIERS = [
  {
    id: 'SUP-001', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000001',
    nombre_comercial: 'Marluvas',   razon_social: 'Marluvas Calçados de Segurança Ltda.',
    pais: 'Brasil', country_code: 'BR', flag: '🇧🇷',
    producto_servicio: 'Calzado de seguridad',
    clase: 'CRITICO', status: 'ACTIVO',
    iso_score: 4.4, lead_time_promised: 45, lead_time_real: 47,
    volumen_transaccionado: 1840000, expedientes_activos: 6,
    contacto_nombre: 'R. Cardoso', contacto_email: 'rcardoso@marluvas.com.br',
    contacto_tel: '+55 21 3456 7890',
    certs: ['ISO 9001','CE'],
    onboarded: '2021-11-05',
    categoria_desc: 'Fabricante OEM · calzado industrial premium ABNT NBR 16.603',
  },
  {
    id: 'SUP-002', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000002',
    nombre_comercial: 'Bangni',    razon_social: 'Bangni Footwear Co., Ltd.',
    pais: 'China', country_code: 'CN', flag: '🇨🇳',
    producto_servicio: 'Calzado de seguridad · producción OEM',
    clase: 'CRITICO', status: 'ACTIVO',
    iso_score: 4.1, lead_time_promised: 60, lead_time_real: 64,
    volumen_transaccionado: 920000, expedientes_activos: 4,
    contacto_nombre: 'Li Wang', contacto_email: 'li.wang@bangni.cn',
    contacto_tel: '+86 574 8888 1234',
    certs: ['ISO 9001','CE','RoHS'],
    onboarded: '2022-01-20',
    categoria_desc: 'OEM Ningbo · líneas Bison y Goliath',
  },
  {
    id: 'SUP-003', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000003',
    nombre_comercial: 'Bison CN',  razon_social: 'Bison CN Ltd.',
    pais: 'China', country_code: 'CN', flag: '🇨🇳',
    producto_servicio: 'Fábrica principal Bison (calzado casual)',
    clase: 'CRITICO', status: 'ACTIVO',
    iso_score: 3.8, lead_time_promised: 55, lead_time_real: 58,
    volumen_transaccionado: 1240000, expedientes_activos: 5,
    contacto_nombre: 'J. Chen', contacto_email: 'j.chen@bisoncn.com',
    contacto_tel: '+86 21 6677 2233',
    certs: ['ISO 9001'],
    onboarded: '2021-06-10',
    categoria_desc: 'Fábrica dedicada Bison · capacidad 18k pares/mes',
  },
  {
    id: 'SUP-004', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000004',
    nombre_comercial: 'Tecmater',  razon_social: 'Tecmater Industrial S.A.C.',
    pais: 'Perú', country_code: 'PE', flag: '🇵🇪',
    producto_servicio: 'Botas industriales andinas · distribución',
    clase: 'IMPORTANTE', status: 'ACTIVO',
    iso_score: 3.6, lead_time_promised: 30, lead_time_real: 32,
    volumen_transaccionado: 310000, expedientes_activos: 2,
    contacto_nombre: 'C. Villacorta', contacto_email: 'cvillacorta@tecmater.pe',
    contacto_tel: '+51 1 234 0099',
    certs: ['ISO 9001'],
    onboarded: '2024-07-18',
    categoria_desc: 'Partner distribución andina',
  },
  {
    id: 'SUP-005', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000005',
    nombre_comercial: 'Ortholab',  razon_social: 'Ortholab Biomecánica S.A.',
    pais: 'México', country_code: 'MX', flag: '🇲🇽',
    producto_servicio: 'Plantillas biomecánicas ortopédicas',
    clase: 'IMPORTANTE', status: 'ACTIVO',
    iso_score: 4.6, lead_time_promised: 25, lead_time_real: 24,
    volumen_transaccionado: 185000, expedientes_activos: 3,
    contacto_nombre: 'M. Hidalgo', contacto_email: 'm.hidalgo@ortholab.mx',
    contacto_tel: '+52 55 4422 1100',
    certs: ['ISO 9001','CE','FCC'],
    onboarded: '2023-03-12',
    categoria_desc: 'Laboratorio ortopédico · plantillas premium',
  },
  {
    id: 'SUP-006', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000006',
    nombre_comercial: 'Hostinger', razon_social: 'Hostinger International Ltd.',
    pais: 'Chipre', country_code: 'CY', flag: '🇨🇾',
    producto_servicio: 'Hosting y DNS · infraestructura cloud',
    clase: 'ESTANDAR', status: 'ACTIVO',
    iso_score: 4.2, lead_time_promised: 1, lead_time_real: 1,
    volumen_transaccionado: 4800, expedientes_activos: 0,
    contacto_nombre: 'Support Tier 2', contacto_email: 'vps@hostinger.com',
    contacto_tel: '+370 5 205 5000',
    certs: ['ISO 9001','ISO 27001'],
    onboarded: '2024-12-01',
    categoria_desc: 'Proveedor de servicio · VPS + DNS',
  },
  {
    id: 'SUP-007', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000007',
    nombre_comercial: 'Talare',    razon_social: 'Talare Componentes Ltda.',
    pais: 'Brasil', country_code: 'BR', flag: '🇧🇷',
    producto_servicio: 'Punteras de acero y composite',
    clase: 'IMPORTANTE', status: 'EN_SELECCION',
    iso_score: 3.1, lead_time_promised: 20, lead_time_real: 28,
    volumen_transaccionado: 0, expedientes_activos: 0,
    contacto_nombre: 'B. Souza', contacto_email: 'bsouza@talare.com.br',
    contacto_tel: '+55 11 2244 8800',
    certs: [],
    onboarded: '2026-02-14',
    categoria_desc: 'En evaluación · sample batch pendiente',
  },
  {
    id: 'SUP-008', uuid: '1b2c3d4e-5f60-71a2-b3c4-d5e6f7000008',
    nombre_comercial: 'Yunnan Steel',razon_social: 'Yunnan Steel Materials Co.',
    pais: 'China', country_code: 'CN', flag: '🇨🇳',
    producto_servicio: 'Láminas acero para antiperforación',
    clase: 'ESTANDAR', status: 'DESCARTADO',
    iso_score: 2.4, lead_time_promised: 40, lead_time_real: 62,
    volumen_transaccionado: 48000, expedientes_activos: 0,
    contacto_nombre: 'Z. Liu', contacto_email: 'liu@yunnansteel.cn',
    contacto_tel: '+86 871 6677 1111',
    certs: [],
    onboarded: '2023-09-01',
    categoria_desc: 'Descartado tras 3 NCs por desviación dimensional',
  },
];

// ─────────────────────────────────────────────────────────
// SUPPLIER_PRODUCTS — SKUs proveídos por cada supplier
// ─────────────────────────────────────────────────────────
export const SUPPLIER_PRODUCTS = [
  // SUP-001 Marluvas
  { supplier_id:'SUP-001', sku:'MLV-50S29-BLK-42',   units_12m: 2400, last_purchase_price: 18.50, last_po_date:'2026-03-18' },
  { supplier_id:'SUP-001', sku:'MLV-40S18-BRN-41',   units_12m: 1860, last_purchase_price: 24.80, last_po_date:'2026-02-22' },
  { supplier_id:'SUP-001', sku:'MLV-EVA-AST-BLK-40', units_12m: 1420, last_purchase_price: 15.20, last_po_date:'2026-03-01' },
  { supplier_id:'SUP-001', sku:'MLV-FUEGO-BRN-43',   units_12m:  480, last_purchase_price: 32.00, last_po_date:'2026-01-14' },
  // SUP-002 Bangni
  { supplier_id:'SUP-002', sku:'GOL-BT-BLK-44',      units_12m: 1580, last_purchase_price: 55.80, last_po_date:'2026-03-28' },
  { supplier_id:'SUP-002', sku:'BIS-OXF-BLK-42',     units_12m:  920, last_purchase_price: 48.50, last_po_date:'2026-02-09' },
  // SUP-003 Bison CN
  { supplier_id:'SUP-003', sku:'BIS-OXF-BLK-42',     units_12m: 4200, last_purchase_price: 46.00, last_po_date:'2026-03-22' },
  { supplier_id:'SUP-003', sku:'BIS-OXF-TAN-42',     units_12m: 3600, last_purchase_price: 46.00, last_po_date:'2026-03-22' },
  { supplier_id:'SUP-003', sku:'BIS-OXF-BLK-43',     units_12m: 1800, last_purchase_price: 48.00, last_po_date:'2026-02-18' },
  // SUP-004 Tecmater
  { supplier_id:'SUP-004', sku:'TEC-BT-STEEL-42',    units_12m:  640, last_purchase_price: 38.50, last_po_date:'2026-02-26' },
  // SUP-005 Ortholab
  { supplier_id:'SUP-005', sku:'ORT-INS-EVA-42',     units_12m: 3200, last_purchase_price:  4.80, last_po_date:'2026-03-30' },
  { supplier_id:'SUP-005', sku:'ORT-INS-PU-42',      units_12m: 2100, last_purchase_price:  6.20, last_po_date:'2026-03-15' },
  // SUP-008 Yunnan (histórico descartado)
  { supplier_id:'SUP-008', sku:'RAW-STEEL-1100N',    units_12m:   85, last_purchase_price: 11.80, last_po_date:'2025-06-10' },
];

// ─────────────────────────────────────────────────────────
// SUPPLIER_EXPEDIENTE_REFS — expedientes asociados a cada supplier
// ─────────────────────────────────────────────────────────
export const SUPPLIER_EXPEDIENTE_REFS = [
  { supplier_id:'SUP-001', expediente_ref:'EXP-1029', estado:'TRANSITO',    fecha:'2026-01-09', monto: 189600 },
  { supplier_id:'SUP-001', expediente_ref:'EXP-1037', estado:'PRODUCCION',  fecha:'2026-03-14', monto: 142800 },
  { supplier_id:'SUP-001', expediente_ref:'EXP-1048', estado:'CERRADO',     fecha:'2025-11-22', monto:  86400 },
  { supplier_id:'SUP-001', expediente_ref:'EXP-1022', estado:'CERRADO',     fecha:'2025-08-18', monto: 112000 },
  { supplier_id:'SUP-002', expediente_ref:'EXP-1031', estado:'EN_DESTINO',  fecha:'2026-02-04', monto: 156000 },
  { supplier_id:'SUP-002', expediente_ref:'EXP-1042', estado:'TRANSITO',    fecha:'2026-03-18', monto:  98400 },
  { supplier_id:'SUP-002', expediente_ref:'EXP-1015', estado:'CERRADO',     fecha:'2025-09-05', monto:  74200 },
  { supplier_id:'SUP-003', expediente_ref:'EXP-1029', estado:'TRANSITO',    fecha:'2026-01-15', monto: 148200 },
  { supplier_id:'SUP-003', expediente_ref:'EXP-1034', estado:'PREPARACION', fecha:'2026-03-22', monto: 180400 },
  { supplier_id:'SUP-003', expediente_ref:'EXP-1044', estado:'EN_DESTINO',  fecha:'2026-02-28', monto:  92800 },
  { supplier_id:'SUP-004', expediente_ref:'EXP-1040', estado:'CERRADO',     fecha:'2026-01-26', monto:  64400 },
  { supplier_id:'SUP-004', expediente_ref:'EXP-1038', estado:'CERRADO',     fecha:'2025-12-14', monto:  48800 },
  { supplier_id:'SUP-005', expediente_ref:'EXP-1042', estado:'TRANSITO',    fecha:'2026-03-22', monto:  18400 },
  { supplier_id:'SUP-005', expediente_ref:'EXP-1034', estado:'PREPARACION', fecha:'2026-03-22', monto:  22200 },
];

// ─────────────────────────────────────────────────────────
// SUPPLIER_PROMO_CODES — rebates, volume discounts, marketing
//   scope: 'ALL' | ['sku1','sku2']
// ─────────────────────────────────────────────────────────
export const SUPPLIER_PROMO_CODES = [
  {
    id: 'PC-001', supplier_id:'SUP-001', codigo:'MLV-SUMMER-5',
    descripcion:'Rebaja verano 2026', scope:'ALL',
    moq: 500, pct: 5, uses: 45, limit: 100,
    start:'2026-03-01', end:'2026-06-30', status:'ACTIVO',
    ahorro_total: 8420,
  },
  {
    id: 'PC-002', supplier_id:'SUP-001', codigo:'MLV-VOL-1000',
    descripcion:'Volumen ≥1000 pares', scope:'ALL',
    moq: 1000, pct: 8, uses: 12, limit: 25,
    start:'2026-01-01', end:'2026-12-31', status:'ACTIVO',
    ahorro_total: 14200,
  },
  {
    id: 'PC-003', supplier_id:'SUP-001', codigo:'MLV-EVA-OUTLET',
    descripcion:'Liquidación EVA-AST', scope:['MLV-EVA-AST-BLK-40'],
    moq: 200, pct: 12, uses: 8, limit: 10,
    start:'2026-02-15', end:'2026-04-30', status:'ACTIVO',
    ahorro_total: 3820,
  },
  {
    id: 'PC-004', supplier_id:'SUP-002', codigo:'BNG-LAUNCH-10',
    descripcion:'Lanzamiento fábrica Bangni', scope:'ALL',
    moq: 300, pct: 10, uses: 6, limit: 20,
    start:'2026-01-15', end:'2026-03-31', status:'EXPIRADO',
    ahorro_total: 5880,
  },
  {
    id: 'PC-005', supplier_id:'SUP-002', codigo:'BNG-GOL-BULK',
    descripcion:'Goliath ≥500 pares', scope:['GOL-BT-BLK-44'],
    moq: 500, pct: 7, uses: 4, limit: 15,
    start:'2026-02-01', end:'2026-08-31', status:'ACTIVO',
    ahorro_total: 7820,
  },
  {
    id: 'PC-006', supplier_id:'SUP-003', codigo:'BIS-QTR-VOL',
    descripcion:'Q2 volumen consolidado', scope:'ALL',
    moq: 2000, pct: 6, uses: 3, limit: 8,
    start:'2026-04-01', end:'2026-06-30', status:'ACTIVO',
    ahorro_total: 12400,
  },
  {
    id: 'PC-007', supplier_id:'SUP-005', codigo:'ORT-INS-PKG',
    descripcion:'Paquete plantillas >2000u', scope:'ALL',
    moq: 2000, pct: 4, uses: 2, limit: 6,
    start:'2026-03-01', end:'2026-12-31', status:'ACTIVO',
    ahorro_total: 2420,
  },
];

// ─────────────────────────────────────────────────────────
// SUPPLIER_AUDIT_SCORES — radar ISO 9001 (última auditoría)
//   Calidad 30% · Entregas 25% · Comunicación 15% · Técnica 15% · Precio 15%
//   Todas las dimensiones en escala 1.0–5.0
// ─────────────────────────────────────────────────────────
export const SUPPLIER_AUDIT_SCORES = {
  'SUP-001': { audit_date:'2026-03-15', auditor:'K. Vargas',
    dimensions: { calidad: 4.6, entregas: 4.2, comunicacion: 4.5, tecnica: 4.8, precio: 3.9 },
    history: [
      { date:'2025-03-10', score: 4.2 },
      { date:'2025-09-12', score: 4.3 },
      { date:'2026-03-15', score: 4.4 },
    ],
  },
  'SUP-002': { audit_date:'2026-02-28', auditor:'K. Vargas',
    dimensions: { calidad: 4.3, entregas: 3.8, comunicacion: 4.0, tecnica: 4.4, precio: 4.2 },
    history: [
      { date:'2025-04-02', score: 3.9 },
      { date:'2025-10-15', score: 4.0 },
      { date:'2026-02-28', score: 4.1 },
    ],
  },
  'SUP-003': { audit_date:'2026-03-08', auditor:'C. Peralta',
    dimensions: { calidad: 3.8, entregas: 3.4, comunicacion: 4.1, tecnica: 4.0, precio: 4.0 },
    history: [
      { date:'2025-03-20', score: 4.0 },
      { date:'2025-09-25', score: 3.9 },
      { date:'2026-03-08', score: 3.8 },
    ],
  },
  'SUP-004': { audit_date:'2026-01-22', auditor:'K. Vargas',
    dimensions: { calidad: 3.5, entregas: 3.7, comunicacion: 3.8, tecnica: 3.2, precio: 3.9 },
    history: [
      { date:'2025-07-14', score: 3.4 },
      { date:'2026-01-22', score: 3.6 },
    ],
  },
  'SUP-005': { audit_date:'2026-03-20', auditor:'C. Peralta',
    dimensions: { calidad: 4.8, entregas: 4.7, comunicacion: 4.4, tecnica: 4.6, precio: 4.3 },
    history: [
      { date:'2025-04-08', score: 4.3 },
      { date:'2025-10-12', score: 4.5 },
      { date:'2026-03-20', score: 4.6 },
    ],
  },
  'SUP-006': { audit_date:'2025-12-15', auditor:'IT Audit',
    dimensions: { calidad: 4.2, entregas: 4.8, comunicacion: 3.8, tecnica: 4.0, precio: 4.6 },
    history: [ { date:'2025-12-15', score: 4.2 } ],
  },
  'SUP-007': { audit_date:'2026-02-20', auditor:'K. Vargas',
    dimensions: { calidad: 3.2, entregas: 2.8, comunicacion: 3.4, tecnica: 3.1, precio: 3.2 },
    history: [ { date:'2026-02-20', score: 3.1 } ],
  },
  'SUP-008': { audit_date:'2025-05-10', auditor:'K. Vargas',
    dimensions: { calidad: 2.2, entregas: 1.9, comunicacion: 2.8, tecnica: 2.5, precio: 2.9 },
    history: [
      { date:'2024-11-02', score: 3.1 },
      { date:'2025-05-10', score: 2.4 },
    ],
  },
};

// ─────────────────────────────────────────────────────────
// SUPPLIER_INCIDENTS — NC log · ISO 9001 8.7 control de no conformes
//   impacto: BAJO | MEDIO | ALTO | CRITICO
// ─────────────────────────────────────────────────────────
export const SUPPLIER_INCIDENTS = [
  { id:'NC-2026-001', supplier_id:'SUP-001', date:'2026-02-12',
    descripcion:'Variación de tono en lote T.42 TAN (MLV-50S29 batch BC-142)',
    impacto:'MEDIO', accion:'Inspección 100% · aprobado con observación por cliente Andes',
    ref_nc:'NC-MLV-2026-0012' },
  { id:'NC-2026-002', supplier_id:'SUP-002', date:'2026-01-28',
    descripcion:'Retraso ETD Ningbo · 4 días sobre promesa',
    impacto:'MEDIO', accion:'Compensación con flete aéreo parcial · coste asumido por supplier',
    ref_nc:'NC-BNG-2026-0004' },
  { id:'NC-2026-003', supplier_id:'SUP-003', date:'2026-03-02',
    descripcion:'Etiquetado incorrecto de talla en 28 pares (lote PL-88214)',
    impacto:'BAJO', accion:'Reetiquetado en destino · sin impacto en cliente final',
    ref_nc:'NC-BIS-2026-0007' },
  { id:'NC-2025-012', supplier_id:'SUP-003', date:'2025-11-14',
    descripcion:'Descocido menor en 12 pares de horma 41',
    impacto:'BAJO', accion:'Reemplazo inventario local · supplier reembolsó USD 580',
    ref_nc:'NC-BIS-2025-0012' },
  { id:'NC-2026-004', supplier_id:'SUP-004', date:'2026-02-18',
    descripcion:'Documentación DUA con typo en NCM',
    impacto:'BAJO', accion:'Corrección digital · despacho sin demora',
    ref_nc:'NC-TEC-2026-0002' },
  { id:'NC-2025-008', supplier_id:'SUP-007', date:'2026-03-05',
    descripcion:'Sample batch con variación dimensional > tolerancia (±2mm)',
    impacto:'ALTO', accion:'Solicitud de 2º sample · proceso en HOLD',
    ref_nc:'NC-TAL-2026-0001' },
  { id:'NC-2025-005', supplier_id:'SUP-008', date:'2025-03-22',
    descripcion:'Láminas acero con desviación de dureza HRC',
    impacto:'CRITICO', accion:'Rechazo total de embarque · supplier asumió flete retorno',
    ref_nc:'NC-YUN-2025-0005' },
  { id:'NC-2025-006', supplier_id:'SUP-008', date:'2025-04-14',
    descripcion:'Segunda no conformidad dimensional consecutiva',
    impacto:'CRITICO', accion:'Escalado a CEO · supplier bloqueado para nuevas POs',
    ref_nc:'NC-YUN-2025-0006' },
  { id:'NC-2025-007', supplier_id:'SUP-008', date:'2025-05-02',
    descripcion:'Documentación de origen inconsistente',
    impacto:'ALTO', accion:'Supplier marcado DESCARTADO · cierre auditoría',
    ref_nc:'NC-YUN-2025-0007' },
];

// ─────────────────────────────────────────────────────────
// Helpers de agregación para el módulo Productos
// ─────────────────────────────────────────────────────────
export function getProductTotals(sku) {
  const lines = PRODUCT_EXPEDIENTE_LINES.filter(l => l.sku === sku);
  const units = lines.reduce((a,l) => a + l.qty, 0);
  const revenue = lines.reduce((a,l) => a + l.qty * l.unit_price_sold, 0);
  const avg_price = units > 0 ? revenue / units : 0;
  // Tallas más vendidas
  const sizeMap = {};
  lines.forEach(l => {
    Object.entries(l.size_breakdown || {}).forEach(([sid, q]) => {
      sizeMap[sid] = (sizeMap[sid] || 0) + q;
    });
  });
  const top_sizes = Object.entries(sizeMap)
    .map(([sid, q]) => ({ size_id: sid, qty: q }))
    .sort((a,b) => b.qty - a.qty);
  return { units, revenue, avg_price, top_sizes, expedientes: lines.length };
}

// ─────────────────────────────────────────────────────────
// PLANTILLAS DE EMAIL (Sprint 26 · Notificaciones MWT.ONE)
//   template_key es único por (language, brand)
//   language: ES | EN | PT-BR
//   brand: GLOBAL | RANA_WALK | MARLUVAS | TECMATER
//   is_active: false → soft-deleted, permite restauración
// ─────────────────────────────────────────────────────────
export const EMAIL_BRANDS = [
  { value:'GLOBAL',    label:'Default / Global' },
  { value:'RANA_WALK', label:'Rana Walk' },
  { value:'MARLUVAS',  label:'Marluvas' },
  { value:'TECMATER',  label:'Tecmater' },
];

export const EMAIL_LANGUAGES = [
  { value:'ES',    label:'Español' },
  { value:'EN',    label:'English' },
  { value:'PT-BR', label:'Português (BR)' },
];

export const EMAIL_TEMPLATES = [
  {
    id:'tpl-001',
    name:'Aviso de Despacho',
    template_key:'expediente.dispatched',
    language:'ES', brand:'GLOBAL',
    subject_template:'Despacho confirmado · Expediente {{ expediente_code }}',
    body_template:
`Hola {{ client_name }},

Te informamos que el expediente {{ expediente_code }} ha sido despachado con fecha {{ dispatch_date }}.

Modo de transporte: {{ freight_mode }}
ETA estimada: {{ eta_date }}

Tu ejecutivo {{ operator_name }} dará seguimiento en cada paso.

Saludos,
Equipo MWT.ONE`,
    is_active:true,
    updated_at:'2026-04-12',
    sent_count_30d: 48,
  },
  {
    id:'tpl-002',
    name:'Proforma Enviada',
    template_key:'proforma.sent',
    language:'ES', brand:'GLOBAL',
    subject_template:'Proforma {{ proforma_code }} · {{ expediente_code }}',
    body_template:
`Estimado {{ client_name }},

Adjuntamos la proforma {{ proforma_code }} correspondiente al expediente {{ expediente_code }}.

Total: {{ total_amount }} {{ currency }}
Validez: 15 días calendario

Agradecemos revisar y confirmar para proceder con el pago del {{ advance_pct }}% conforme a acuerdo comercial.

Atentamente,
MWT.ONE`,
    is_active:true,
    updated_at:'2026-04-15',
    sent_count_30d: 27,
  },
  {
    id:'tpl-003',
    name:'Recordatorio de cobro — C1',
    template_key:'collection.c1',
    language:'ES', brand:'GLOBAL',
    subject_template:'Recordatorio · Factura {{ invoice_code }} pendiente',
    body_template:
`Hola {{ client_name }},

Te escribimos para recordarte que la factura {{ invoice_code }} del expediente {{ expediente_code }} vence en {{ days_to_due }} días.

Monto pendiente: {{ balance }} {{ currency }}
Fecha de vencimiento: {{ due_date }}

Si ya efectuaste el pago, por favor omite este mensaje.

Gracias,
Equipo MWT.ONE · Área Financiera`,
    is_active:true,
    updated_at:'2026-04-18',
    sent_count_30d: 112,
  },
  {
    id:'tpl-004',
    name:'Recordatorio de cobro — C2',
    template_key:'collection.c2',
    language:'ES', brand:'GLOBAL',
    subject_template:'[ATENCIÓN] Factura {{ invoice_code }} vencida',
    body_template:
`Estimado {{ client_name }},

La factura {{ invoice_code }} del expediente {{ expediente_code }} se encuentra vencida desde hace {{ days_overdue }} días.

Monto: {{ balance }} {{ currency }}

Te solicitamos regularizar a la brevedad para evitar bloqueos operativos del expediente.

Saludos cordiales,
MWT.ONE`,
    is_active:true,
    updated_at:'2026-04-16',
    sent_count_30d: 34,
  },
  {
    id:'tpl-005',
    name:'Verificación de pago recibido',
    template_key:'payment.verified',
    language:'ES', brand:'GLOBAL',
    subject_template:'Pago recibido · {{ expediente_code }}',
    body_template:
`Hola {{ client_name }},

Hemos verificado el pago de {{ amount }} {{ currency }} aplicado al expediente {{ expediente_code }}.

Saldo actualizado: {{ balance }} {{ currency }}

Gracias por tu confianza.

MWT.ONE`,
    is_active:true,
    updated_at:'2026-04-10',
    sent_count_30d: 63,
  },
  {
    id:'tpl-006',
    name:'Expediente Registrado',
    template_key:'expediente.registered',
    language:'ES', brand:'RANA_WALK',
    subject_template:'Expediente {{ expediente_code }} registrado en Rana Walk',
    body_template:
`Hola {{ client_name }},

Tu expediente {{ expediente_code }} fue registrado en nuestra plataforma.

Ejecutivo asignado: {{ operator_name }}

Pronto recibirás la proforma correspondiente.

Saludos,
Rana Walk · By MWT.ONE`,
    is_active:true,
    updated_at:'2026-03-28',
    sent_count_30d: 41,
  },
  {
    id:'tpl-007',
    name:'Dispatch Confirmation',
    template_key:'expediente.dispatched',
    language:'EN', brand:'GLOBAL',
    subject_template:'Shipment confirmed · File {{ expediente_code }}',
    body_template:
`Hi {{ client_name }},

Your file {{ expediente_code }} has been dispatched on {{ dispatch_date }}.

Transport mode: {{ freight_mode }}
Estimated arrival: {{ eta_date }}

Your account manager {{ operator_name }} will keep you posted.

Best,
MWT.ONE Team`,
    is_active:true,
    updated_at:'2026-04-12',
    sent_count_30d: 18,
  },
  {
    id:'tpl-008',
    name:'Aviso de bloqueo de crédito (legacy)',
    template_key:'credit.blocked_v1',
    language:'ES', brand:'GLOBAL',
    subject_template:'[LEGACY] Crédito del expediente {{ expediente_code }} bloqueado',
    body_template:
`Hola {{ client_name }},

El crédito del expediente {{ expediente_code }} ha sido bloqueado por superar los días acordados.

Saludos,
MWT.ONE`,
    is_active:false,   // ← soft-deleted
    updated_at:'2026-01-22',
    sent_count_30d: 0,
  },
  {
    id:'tpl-009',
    name:'Aviso Expedição (PT)',
    template_key:'expediente.dispatched',
    language:'PT-BR', brand:'MARLUVAS',
    subject_template:'Despacho confirmado · Expediente {{ expediente_code }}',
    body_template:
`Olá {{ client_name }},

Seu expediente {{ expediente_code }} foi despachado em {{ dispatch_date }}.

Modo de transporte: {{ freight_mode }}
ETA: {{ eta_date }}

Seu executivo {{ operator_name }} cuidará de cada etapa.

Atenciosamente,
Marluvas · MWT.ONE`,
    is_active:true,
    updated_at:'2026-04-02',
    sent_count_30d: 9,
  },
];

// ─────────────────────────────────────────────────────────
// NOTIFICATION LOG — bitácora envíos transaccionales
// ─────────────────────────────────────────────────────────
//   trigger codes: verify_payment · cron · manual · webhook
//                  workflow_push · C1 · C2 · C3
//   status codes:  Sent · Skipped · Disabled · Exhausted · Failed
// ─────────────────────────────────────────────────────────
export const NOTIFICATION_LOGS = [
  { id:'nl-1001', ts:'2026-04-20T10:52:00Z', completed_at:'2026-04-20T10:52:04Z',
    expediente_id:'EXP-1029', to:'buyer@andesretail.pe', recipient_email:'buyer@andesretail.pe',
    subject:'Despacho confirmado · Expediente EXP-1029', template_key:'expediente.dispatched',
    trigger:'workflow_push', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola Andes Retail,\n\nTu expediente EXP-1029 salió despachado el 2026-04-20 vía Ocean LCL. ETA estimado: 2026-05-18.\n\nGracias por confiar en Rana Walk.\n— Equipo MWT.ONE' },
  { id:'nl-1002', ts:'2026-04-20T10:48:00Z', completed_at:'2026-04-20T10:48:02Z',
    expediente_id:'EXP-1031', to:'finance@vialedos.cl', recipient_email:'finance@vialedos.cl',
    subject:'Recordatorio · Factura INV-2611 pendiente', template_key:'collection.c1',
    trigger:'cron', status:'Sent', retries:0, attempt_count:1,
    amount_overdue: 4820.50, grace_days_used: 3, currency:'USD', proforma_id:'PF-0991',
    body_preview:'Estimado cliente,\n\nLa factura INV-2611 por USD 4,820.50 presenta 3 días de atraso. Este es el primer recordatorio (C1) antes del corte.\n\n— Equipo de Cobranza' },
  { id:'nl-1003', ts:'2026-04-20T10:33:00Z', completed_at:null,
    expediente_id:'EXP-1028', to:'—', recipient_email:null,
    subject:'—', template_key:'payment.verified',
    trigger:'verify_payment', status:'Skipped', retries:0, attempt_count:0,
    skip_reason:'client sin email definido',
    body_preview:'[no se generó body — envío omitido antes de renderizar plantilla]' },
  { id:'nl-1004', ts:'2026-04-20T09:58:00Z', completed_at:'2026-04-20T09:58:03Z',
    expediente_id:'EXP-1044', to:'ops@comexmx.mx', recipient_email:'ops@comexmx.mx',
    subject:'Pago recibido · EXP-1044', template_key:'payment.verified',
    trigger:'verify_payment', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola ComexMX,\n\nHemos acreditado el pago del expediente EXP-1044 por USD 12,450.00. Quedamos listos para liberar despacho.\n\n— MWT.ONE' },
  { id:'nl-1005', ts:'2026-04-20T09:12:00Z', completed_at:'2026-04-20T09:14:18Z',
    expediente_id:'EXP-1037', to:'contacto@caribeshop.do', recipient_email:'contacto@caribeshop.do',
    subject:'[ATENCIÓN] Factura INV-2598 vencida', template_key:'collection.c2',
    trigger:'C2', status:'Sent', retries:1, attempt_count:2,
    amount_overdue: 9340.00, grace_days_used: 9, currency:'USD', proforma_id:'PF-0983',
    body_preview:'Estimado cliente,\n\nLa factura INV-2598 mantiene 9 días de atraso por USD 9,340.00. Requerimos regularización inmediata para evitar el bloqueo comercial (C3).\n\n— Cobranza MWT.ONE' },
  { id:'nl-1006', ts:'2026-04-20T08:44:00Z', completed_at:'2026-04-20T08:44:05Z',
    expediente_id:'EXP-1052', to:'buyer@retailec.ec', recipient_email:'buyer@retailec.ec',
    subject:'Proforma PF-0998 · EXP-1052', template_key:'proforma.sent',
    trigger:'manual', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola Retail EC,\n\nAdjuntamos la proforma PF-0998 correspondiente a EXP-1052. 50% anticipo · 50% contra BL.\n\nQuedamos a la espera de su confirmación.' },
  { id:'nl-1007', ts:'2026-04-20T08:20:00Z', completed_at:null,
    expediente_id:'EXP-1041', to:'legacy@old-broker.co', recipient_email:'legacy@old-broker.co',
    subject:'—', template_key:'credit.blocked_v1',
    trigger:'cron', status:'Disabled', retries:0, attempt_count:0,
    skip_reason:'kill switch activo · template soft-deleted',
    body_preview:'[envío bloqueado por kill switch global · plantilla credit.blocked_v1 marcada como is_active=false]' },
  { id:'nl-1008', ts:'2026-04-19T22:03:00Z', completed_at:'2026-04-19T22:18:40Z',
    expediente_id:'EXP-1033', to:'imports@argmercado.ar', recipient_email:'imports@argmercado.ar',
    subject:'Shipment confirmed · File EXP-1033', template_key:'expediente.dispatched',
    trigger:'workflow_push', status:'Exhausted', retries:5, attempt_count:5,
    error:'550 mailbox full · reintentos agotados (Celery max_retries=5)',
    body_preview:'Hello ArgMercado,\n\nYour file EXP-1033 has been dispatched on 2026-04-19 · Air Express. ETA 2026-04-27.\n\n— MWT.ONE Logistics' },
  { id:'nl-1009', ts:'2026-04-19T20:14:00Z', completed_at:'2026-04-19T20:14:02Z',
    expediente_id:'EXP-1048', to:'cfo@grupocontigo.pe', recipient_email:'cfo@grupocontigo.pe',
    subject:'Recordatorio · Factura INV-2620 pendiente', template_key:'collection.c1',
    trigger:'C1', status:'Sent', retries:0, attempt_count:1,
    amount_overdue: 2145.75, grace_days_used: 2, currency:'USD', proforma_id:'PF-0995',
    body_preview:'Estimado cliente,\n\nLe recordamos que la factura INV-2620 por USD 2,145.75 tiene 2 días de retraso. Este es el primer aviso (C1).\n\n— Equipo de Cobranza' },
  { id:'nl-1010', ts:'2026-04-19T18:42:00Z', completed_at:'2026-04-19T18:46:10Z',
    expediente_id:'EXP-1039', to:'buyer@retailec.ec', recipient_email:'buyer@retailec.ec',
    subject:'Despacho confirmado · Expediente EXP-1039', template_key:'expediente.dispatched',
    trigger:'workflow_push', status:'Sent', retries:2, attempt_count:3,
    body_preview:'Hola Retail EC,\n\nTu expediente EXP-1039 salió despachado vía Ocean FCL. ETA 2026-05-20.\n\n— MWT.ONE' },
  { id:'nl-1011', ts:'2026-04-19T17:20:00Z', completed_at:'2026-04-19T17:20:08Z',
    expediente_id:'EXP-1055', to:'—', recipient_email:null,
    subject:'—', template_key:'proforma.sent',
    trigger:'manual', status:'Failed', retries:1, attempt_count:1,
    error:'Jinja2 · UndefinedError: proforma_code no disponible en el contexto',
    body_preview:'[render abortado por variable faltante · revisar plantilla proforma.sent]' },
  { id:'nl-1012', ts:'2026-04-19T16:05:00Z', completed_at:'2026-04-19T16:05:03Z',
    expediente_id:'EXP-1027', to:'imports@andesretail.pe', recipient_email:'imports@andesretail.pe',
    subject:'Expediente EXP-1027 registrado en Rana Walk', template_key:'expediente.registered',
    trigger:'workflow_push', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola Andes Retail,\n\nTu expediente EXP-1027 ha sido registrado correctamente en Rana Walk. Código de seguimiento interno: EXP-1027.\n\n— MWT.ONE' },
  { id:'nl-1013', ts:'2026-04-19T14:40:00Z', completed_at:'2026-04-19T14:40:04Z',
    expediente_id:'EXP-1043', to:'buyer@vialedos.cl', recipient_email:'buyer@vialedos.cl',
    subject:'Pago recibido · EXP-1043', template_key:'payment.verified',
    trigger:'verify_payment', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola ViaLedos,\n\nPago del 50% anticipo recibido · EXP-1043 por USD 8,200.00.\n\n— MWT.ONE' },
  { id:'nl-1014', ts:'2026-04-19T11:27:00Z', completed_at:'2026-04-19T11:27:06Z',
    expediente_id:'EXP-1050', to:'finance@grupocontigo.pe', recipient_email:'finance@grupocontigo.pe',
    subject:'[ATENCIÓN] Factura INV-2611 vencida', template_key:'collection.c2',
    trigger:'C2', status:'Sent', retries:0, attempt_count:1,
    amount_overdue: 15780.25, grace_days_used: 12, currency:'USD', proforma_id:'PF-0987',
    body_preview:'Estimado cliente,\n\nLa factura INV-2611 presenta 12 días de atraso por USD 15,780.25. Este es el segundo aviso (C2).\n\n— Cobranza MWT.ONE' },
  { id:'nl-1015', ts:'2026-04-19T10:12:00Z', completed_at:null,
    expediente_id:'EXP-1034', to:'buyer@comexmx.mx', recipient_email:'buyer@comexmx.mx',
    subject:'—', template_key:'expediente.dispatched',
    trigger:'workflow_push', status:'Skipped', retries:0, attempt_count:0,
    skip_reason:'expediente en DRAFT · sin dispatch_date',
    body_preview:'[envío omitido — expediente aún no tiene dispatch_date, no cumple precondición del trigger]' },
  { id:'nl-1016', ts:'2026-04-19T08:00:00Z', completed_at:'2026-04-19T08:00:05Z',
    expediente_id:'EXP-1046', to:'contacto@retailec.ec', recipient_email:'contacto@retailec.ec',
    subject:'Recordatorio · Factura INV-2603 pendiente', template_key:'collection.c1',
    trigger:'C1', status:'Sent', retries:0, attempt_count:1,
    amount_overdue: 6740.00, grace_days_used: 4, currency:'USD', proforma_id:'PF-0979',
    body_preview:'Estimado cliente,\n\nLe recordamos que la factura INV-2603 por USD 6,740.00 tiene 4 días de atraso. Este es el primer aviso (C1).\n\n— Cobranza MWT.ONE' },
  { id:'nl-1017', ts:'2026-04-18T19:50:00Z', completed_at:'2026-04-18T20:14:22Z',
    expediente_id:'EXP-1035', to:'finance@caribeshop.do', recipient_email:'finance@caribeshop.do',
    subject:'[ATENCIÓN] Factura INV-2590 vencida', template_key:'collection.c2',
    trigger:'C2', status:'Exhausted', retries:5, attempt_count:5,
    error:'SMTP timeout tras 5 intentos · 110.4 Caribbean Shop bounce detectado',
    amount_overdue: 11230.00, grace_days_used: 15, currency:'USD', proforma_id:'PF-0972',
    body_preview:'Estimado cliente,\n\nLa factura INV-2590 mantiene 15 días de atraso por USD 11,230.00. Requerimos regularización inmediata para evitar el bloqueo comercial (C3).\n\n— Cobranza MWT.ONE' },
  { id:'nl-1018', ts:'2026-04-18T15:25:00Z', completed_at:'2026-04-18T15:25:07Z',
    expediente_id:'EXP-1029', to:'buyer@andesretail.pe', recipient_email:'buyer@andesretail.pe',
    subject:'Proforma PF-0942 · EXP-1029', template_key:'proforma.sent',
    trigger:'manual', status:'Sent', retries:0, attempt_count:1,
    body_preview:'Hola Andes Retail,\n\nAdjuntamos la proforma PF-0942 correspondiente a EXP-1029.\n\nQuedamos atentos a su confirmación.' },
];

// ─────────────────────────────────────────────────────────
// COLLECTION_EMAIL_LOG — correos automáticos de cobranza
//   Enriquecido con amount_overdue, grace_days_used, proforma_id
//   para Tab 2 del Historial de Notificaciones
// ─────────────────────────────────────────────────────────
export const COLLECTION_EMAIL_LOG = NOTIFICATION_LOGS
  .filter(n =>
    ['C1','C2','C3'].includes(n.trigger) ||
    ['collection.c1','collection.c2','collection.c3'].includes(n.template_key)
  )
  .map(n => ({
    id:               n.id,
    created_at:       n.ts,
    ts:               n.ts,
    expediente_id:    n.expediente_id,
    proforma_id:      n.proforma_id || null,
    recipient_email:  n.recipient_email || n.to || '—',
    to:               n.to,
    amount_overdue:   n.amount_overdue != null ? n.amount_overdue : 0,
    grace_days_used:  n.grace_days_used != null ? n.grace_days_used : 0,
    currency:         n.currency || 'USD',
    trigger:          n.trigger,
    template_key:     n.template_key,
    status:           n.status === 'Sent' ? 'Sent' : (n.status === 'Exhausted' || n.status === 'Failed' ? 'Failed' : n.status),
    error:            n.error || null,
    subject:          n.subject,
  }));

// Meta del status (sólo strings/hex, sin JSX)
export const NOTIFICATION_STATUS_META = {
  Sent:      { label:'Sent',      color:'#0E8A6D', soft:'rgba(14,138,109,0.14)',  tone:'ok'   },
  Skipped:   { label:'Skipped',   color:'#6B7280', soft:'rgba(107,114,128,0.12)', tone:'mute' },
  Disabled:  { label:'Disabled',  color:'#B45309', soft:'rgba(180,83,9,0.12)',    tone:'warn' },
  Exhausted: { label:'Exhausted', color:'#DC2626', soft:'rgba(220,38,38,0.12)',   tone:'crit' },
  Failed:    { label:'Failed',    color:'#DC2626', soft:'rgba(220,38,38,0.12)',   tone:'crit' },
};

export const NOTIFICATION_TRIGGER_META = {
  verify_payment: { label:'verify_payment', color:'#00B286' },
  cron:           { label:'cron',           color:'#6B7280' },
  manual:         { label:'manual',         color:'#481EE3' },
  workflow_push:  { label:'workflow_push',  color:'#3083FE' },
  webhook:        { label:'webhook',        color:'#1EE3D7' },
  C1:             { label:'C1',             color:'#3083FE' },
  C2:             { label:'C2',             color:'#B45309' },
  C3:             { label:'C3',             color:'#DC2626' },
};

// Helper — buscar plantilla por (key, language, brand)
export function findTemplate(key, language='ES', brand='GLOBAL') {
  return EMAIL_TEMPLATES.find(
    t => t.template_key === key && t.language === language && t.brand === brand && t.is_active
  ) || EMAIL_TEMPLATES.find(
    t => t.template_key === key && t.language === language && t.is_active
  ) || null;
}
