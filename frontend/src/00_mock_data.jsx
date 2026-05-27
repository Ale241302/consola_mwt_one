// Mock data for MWT ONE prototype
// Expedientes, clients, brands, products, pagos, artifacts, activity...

const BRANDS = [
  { id: 'bis', name: 'Bison', code: 'BIS', color: '#8E6B3F', active: true, expedientes: 14 },
  { id: 'gol', name: 'Goliath', code: 'GOL', color: '#013A57', active: true, expedientes: 9 },
  { id: 'leo', name: 'Leopard', code: 'LEO', color: '#B45309', active: true, expedientes: 6 },
  { id: 'orb', name: 'Orbis', code: 'ORB', color: '#0369A1', active: true, expedientes: 12 },
  { id: 'vel', name: 'Velox', code: 'VEL', color: '#75CBB3', active: true, expedientes: 4 },
];

const CLIENTS = [
  { id: 'c1', name: 'Andes Retail Co.',      country: 'Perú',     contact: 'L. Paredes',   email: 'lpa@andesretail.pe',  phone: '+51 1 234 5678',  credit_limit: 180000, credit_used: 142300, band: 'AMBER' },
  { id: 'c2', name: 'Atacama Distribuidora', country: 'Chile',    contact: 'C. Rojas',     email: 'rojas@atacama.cl',    phone: '+56 2 987 6543',  credit_limit: 240000, credit_used: 88500,  band: 'GREEN' },
  { id: 'c3', name: 'Pampas Importaciones',  country: 'Argentina',contact: 'J. Álvarez',   email: 'ja@pampasimp.com.ar', phone: '+54 11 555 1234', credit_limit: 120000, credit_used: 118700, band: 'RED'   },
  { id: 'c4', name: 'Cafetera del Norte',    country: 'Colombia', contact: 'M. Uribe',     email: 'muribe@cdnorte.co',   phone: '+57 1 222 3344',  credit_limit: 95000,  credit_used: 41200,  band: 'GREEN' },
  { id: 'c5', name: 'Pacífico Trading',      country: 'México',   contact: 'R. Becerra',   email: 'r.becerra@pactr.mx',  phone: '+52 55 777 8899', credit_limit: 310000, credit_used: 205400, band: 'AMBER' },
  { id: 'c6', name: 'Caribe Logistics SRL',  country: 'R. Dominicana',contact: 'A. Peña',  email: 'ap@caribelog.do',     phone: '+1 809 222 1111', credit_limit: 68000,  credit_used: 12800,  band: 'GREEN' },
  { id: 'c7', name: 'Andean Foods S.A.',     country: 'Ecuador',  contact: 'S. Vallejo',   email: 'svallejo@andean.ec',  phone: '+593 2 333 4444', credit_limit: 145000, credit_used: 132600, band: 'AMBER' },
];

const NODES = [
  { id: 'n1', name: 'Shanghái DC',      type: 'Fábrica',   location: 'Shanghái, CN',     entity: 'MWT CN',      status: 'ACTIVE' },
  { id: 'n2', name: 'Ningbo Puerto',    type: 'Puerto',    location: 'Ningbo, CN',       entity: 'MWT CN',      status: 'ACTIVE' },
  { id: 'n3', name: 'Callao CD',        type: 'CD',        location: 'Callao, PE',       entity: 'MWT PE',      status: 'ACTIVE' },
  { id: 'n4', name: 'Buenaventura Pto', type: 'Puerto',    location: 'Buenaventura, CO', entity: 'MWT CO',      status: 'ACTIVE' },
  { id: 'n5', name: 'San Antonio Pto',  type: 'Puerto',    location: 'San Antonio, CL',  entity: 'MWT CL',      status: 'ACTIVE' },
  { id: 'n6', name: 'Panamá Hub',       type: 'Hub',       location: 'Panamá, PA',       entity: 'MWT PA',      status: 'ACTIVE' },
  { id: 'n7', name: 'Santos Puerto',    type: 'Puerto',    location: 'Santos, BR',       entity: 'MWT BR',      status: 'STANDBY' },
];

const PRODUCTS = [
  { id: 'p1',  brand: 'Bison',   sku: 'BIS-OXF-BLK-42', name: 'Oxford cuero negro',  category: 'Calzado', desc: 'Oxford caballero cuero vacuno' },
  { id: 'p2',  brand: 'Bison',   sku: 'BIS-OXF-TAN-42', name: 'Oxford cuero tan',    category: 'Calzado', desc: 'Oxford caballero cuero vacuno' },
  { id: 'p3',  brand: 'Goliath', sku: 'GOL-BT-BLK-44',  name: 'Bota industrial',     category: 'Calzado', desc: 'Bota industrial puntera acero' },
  { id: 'p4',  brand: 'Leopard', sku: 'LEO-SN-WH-38',   name: 'Sneaker blanco',      category: 'Calzado', desc: 'Sneaker urbano' },
  { id: 'p5',  brand: 'Orbis',   sku: 'ORB-BKP-20L',    name: 'Mochila 20L',         category: 'Accesorios', desc: 'Mochila laptop 20 litros' },
  { id: 'p6',  brand: 'Velox',   sku: 'VEL-RN-BLU-40',  name: 'Running azul',        category: 'Calzado', desc: 'Zapatilla running' },
  { id: 'p7',  brand: 'Bison',   sku: 'BIS-BLT-BRN-L',  name: 'Cinturón cuero L',    category: 'Accesorios', desc: 'Cinturón cuero marrón' },
  { id: 'p8',  brand: 'Orbis',   sku: 'ORB-WLT-BLK',    name: 'Billetera negra',     category: 'Accesorios', desc: 'Billetera cuero slim' },
];

const STATES = ['REGISTRO','PRODUCCION','PREPARACION','DESPACHO','TRANSITO','EN_DESTINO','CERRADO'];

const rand = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

// ── Historical phase durations in days (company baseline) ─────
const PHASE_BASELINE = {
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

const EXPEDIENTES = Array.from({length: 32}, (_, i) => makeExpediente(i));

// One hero expediente with rich detail
const HERO_ID = EXPEDIENTES[2].id;
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
const HERO_LINES = [
  { id: 'l1', sku: 'BIS-OXF-BLK-42', name: 'Oxford cuero negro T.42', qty: 420, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-7821094' },
  { id: 'l2', sku: 'BIS-OXF-TAN-42', name: 'Oxford cuero tan T.42',   qty: 360, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-7821094' },
  { id: 'l3', sku: 'BIS-BLT-BRN-L',  name: 'Cinturón cuero marrón L', qty: 520, unit_cost: 12.20, unit_price: 24.90, margin: 0.510, container: 'MSCU-4398721' },
  { id: 'l4', sku: 'BIS-OXF-BLK-43', name: 'Oxford cuero negro T.43', qty: 280, unit_cost: 48.50, unit_price: 69.90, margin: 0.306, container: 'MSCU-4398721' },
];

// ── Costs for the hero expediente ─────
const HERO_COSTS = [
  { id: 'co1', date: '2026-01-14', type: 'Mercadería',         amount:  96420, currency: 'USD', visibility: 'CLIENT', supplier: 'Bison CN Ltd.',        doc: 'CI-88214' },
  { id: 'co2', date: '2026-01-22', type: 'Flete marítimo',     amount:  12800, currency: 'USD', visibility: 'CLIENT', supplier: 'MSC Line',             doc: 'BL-MSCU-99812' },
  { id: 'co3', date: '2026-01-22', type: 'Seguro',             amount:   1840, currency: 'USD', visibility: 'CLIENT', supplier: 'MAPFRE',               doc: 'POL-2026-4412' },
  { id: 'co4', date: '2026-02-03', type: 'Aduana origen',      amount:   3100, currency: 'USD', visibility: 'INTERNAL', supplier: 'CN Customs Agent',    doc: 'INV-CN-1402' },
  { id: 'co5', date: '2026-02-18', type: 'Aduana destino',     amount:   4850, currency: 'USD', visibility: 'CLIENT', supplier: 'Agencia Callao',       doc: 'INV-PE-2811' },
  { id: 'co6', date: '2026-02-20', type: 'Transporte interno', amount:   1900, currency: 'USD', visibility: 'INTERNAL', supplier: 'Transporte Rodríguez', doc: 'GRE-4422' },
  { id: 'co7', date: '2026-02-22', type: 'Almacenaje',         amount:   1290, currency: 'USD', visibility: 'CLIENT', supplier: 'Almacenes Callao',     doc: 'ALM-9921' },
];

// ── Pagos for the hero expediente ─────
const HERO_PAGOS = [
  { id: 'pg1', date: '2026-01-12', amount: 47400, method: 'Movimiento', ref: 'TRX-88412', currency: 'USD', applied_to: 'PF-0942 · 50%',  status: 'APPLIED' },
  { id: 'pg2', date: '2026-02-04', amount: 47400, method: 'Movimiento', ref: 'TRX-91203', currency: 'USD', applied_to: 'PF-0942 · 50%',  status: 'APPLIED' },
];

// ── Artifacts (documents) ─────
const HERO_ARTIFACTS = [
  { id: 'a1', kind: 'Proforma Cliente',    code: 'PF-0942',        status: 'issued',  date: '2026-01-10', author: 'A. Mendoza' },
  { id: 'a2', kind: 'Proforma Fábrica',    code: 'PFF-BIS-1142',   status: 'issued',  date: '2026-01-12', author: 'Bison CN' },
  { id: 'a3', kind: 'Commercial Invoice',  code: 'CI-88214',       status: 'issued',  date: '2026-01-22', author: 'Bison CN' },
  { id: 'a4', kind: 'Packing List',        code: 'PL-88214',       status: 'issued',  date: '2026-01-22', author: 'Bison CN' },
  { id: 'a5', kind: 'Bill of Lading',      code: 'BL-MSCU-99812',  status: 'pending', date: null,         author: null },
  { id: 'a6', kind: 'Factura MWT',         code: null,             status: 'future',  date: null,         author: null },
];

// ── Activity feed for hero ─────
const HERO_ACTIVITY = [
  { id: 'ev1', t: '2026-03-28T10:14:00Z', who: 'A. Mendoza',    what: 'Zarpe confirmado',               detail: 'Nave MSC Leone zarpó de Ningbo. ETA Callao 2026-04-22.' },
  { id: 'ev2', t: '2026-03-26T16:02:00Z', who: 'Sistema',       what: 'Artefacto recibido',             detail: 'Bill of Lading preliminar recibido de MSC.' },
  { id: 'ev3', t: '2026-03-21T09:41:00Z', who: 'L. Paredes',    what: 'Pago registrado',                detail: 'Movimiento USD 47,400 aplicada a PF-0942 (saldo 50%).' },
  { id: 'ev4', t: '2026-03-18T12:30:00Z', who: 'A. Mendoza',    what: 'Cambio de estado',               detail: 'DESPACHO → TRANSITO. Salida de aduana China confirmada.' },
  { id: 'ev5', t: '2026-03-04T08:12:00Z', who: 'Bison CN',      what: 'Producción finalizada',          detail: 'Lote de 1,580 pares liberado para despacho.' },
  { id: 'ev6', t: '2026-02-22T11:45:00Z', who: 'Sistema',       what: 'Cost registrado',                detail: 'Almacenaje USD 1,290 asignado a EXP-1029.' },
  { id: 'ev7', t: '2026-01-14T14:05:00Z', who: 'A. Mendoza',    what: 'Expediente creado',              detail: 'EXP-1029 creado desde proforma PF-0942.' },
];

// ── Inventory ─────
const INVENTORY = [
  { sku: 'BIS-OXF-BLK-42', product: 'Oxford cuero negro T.42', node: 'Callao CD',   qty: 248, reserved: 120, lot: 'BIS-L-24-01', received: '2026-02-22' },
  { sku: 'BIS-OXF-TAN-42', product: 'Oxford cuero tan T.42',   node: 'Callao CD',   qty: 210, reserved: 200, lot: 'BIS-L-24-01', received: '2026-02-22' },
  { sku: 'GOL-BT-BLK-44',  product: 'Bota industrial 44',      node: 'Callao CD',   qty:  89, reserved:   0, lot: 'GOL-L-23-48', received: '2026-01-14' },
  { sku: 'LEO-SN-WH-38',   product: 'Sneaker blanco 38',       node: 'Panamá Hub',  qty: 560, reserved: 280, lot: 'LEO-L-24-02', received: '2026-03-02' },
  { sku: 'ORB-BKP-20L',    product: 'Mochila 20L',             node: 'Buenaventura',qty: 312, reserved:  60, lot: 'ORB-L-24-01', received: '2026-02-18' },
  { sku: 'VEL-RN-BLU-40',  product: 'Running azul 40',         node: 'San Antonio', qty: 128, reserved:  40, lot: 'VEL-L-24-01', received: '2026-03-07' },
  { sku: 'BIS-BLT-BRN-L',  product: 'Cinturón cuero marrón L', node: 'Callao CD',   qty: 520, reserved: 320, lot: 'BIS-L-24-01', received: '2026-02-22' },
  { sku: 'ORB-WLT-BLK',    product: 'Billetera negra',         node: 'Panamá Hub',  qty: 190, reserved:  20, lot: 'ORB-L-24-01', received: '2026-03-02' },
];

// ── Dashboard KPIs ─────
const DASHBOARD = {
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

const OCS = buildOCs();

// Pick a hero OC: the one containing HERO_ID
const HERO_OC_ID = OCS.find(oc => oc.expedientes.includes(HERO_ID))?.id || OCS[0].id;

// ══════════════════════════════════════════════════════════════
// ARTIFACT CATALOG — global library of artifact types per state
// Each artifact defines its record fields (rendered in modal)
// ══════════════════════════════════════════════════════════════
const ARTIFACT_CATALOG = [
  // Registro
  { id: 'AC-01', code: 'ART-01',  name: 'OC del Cliente',              state: 'REGISTRO',   kind: 'doc',
    fields: [ {k:'oc_number', l:'Número de OC', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'amount', l:'Monto', type:'money'}, {k:'file', l:'Archivo', type:'file'} ] },
  { id: 'AC-02', code: 'ART-02',  name: 'Proforma MWT',                state: 'REGISTRO',   kind: 'doc',
    fields: [ {k:'pf_code', l:'Código PF', type:'text'}, {k:'date', l:'Fecha', type:'date'}, {k:'amount', l:'Monto', type:'money'}, {k:'valid_until', l:'Válida hasta', type:'date'}, {k:'file', l:'Archivo', type:'file'} ] },
  { id: 'AC-03', code: 'ART-03',  name: 'Pago inicial / Anticipo',     state: 'REGISTRO',   kind: 'payment',
    fields: [ {k:'amount', l:'Monto', type:'money'}, {k:'method', l:'Método', type:'select', opts:['Movimiento','Crédito','Carta de crédito']}, {k:'ref', l:'Referencia', type:'text'}, {k:'date', l:'Fecha', type:'date'} ] },

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
    fields: [ {k:'amount', l:'Monto', type:'money'}, {k:'method', l:'Método', type:'select', opts:['Movimiento','Cheque','Otro']}, {k:'ref', l:'Referencia', type:'text'}, {k:'date', l:'Fecha', type:'date'} ] },
  { id: 'AC-22', code: 'ART-22',  name: 'Cierre Contable',             state: 'CERRADO',    kind: 'doc',
    fields: [ {k:'date', l:'Fecha de cierre', type:'date'}, {k:'margin_real', l:'Margen real %', type:'number'}, {k:'notes', l:'Notas finales', type:'textarea'} ] },
];

// ── Seed records for the hero expediente ─────
// Map: artifactId → [records]
const HERO_ARTIFACT_RECORDS = {
  'AC-01': [{ id:'R-1',  created:'2026-01-09', author:'A. Mendoza', oc_number:'PO-2026-04128', date:'2026-01-08', amount:189600, file:'OC_AndesRetail.pdf' }],
  'AC-02': [{ id:'R-2',  created:'2026-01-10', author:'A. Mendoza', pf_code:'PF-0942',         date:'2026-01-10', amount:189600, valid_until:'2026-01-31', file:'PF-0942.pdf' }],
  'AC-03': [{ id:'R-3',  created:'2026-01-12', author:'A. Mendoza', amount:47400, method:'Movimiento', ref:'TRX-88412', date:'2026-01-12' }],
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

Object.assign(window, { ARTIFACT_CATALOG, HERO_ARTIFACT_RECORDS });

// export to window so other script files can use
Object.assign(window, {
  BRANDS, CLIENTS, NODES, PRODUCTS, STATES, EXPEDIENTES,
  HERO_ID, HERO_LINES, HERO_COSTS, HERO_PAGOS, HERO_ARTIFACTS, HERO_ACTIVITY,
  INVENTORY, DASHBOARD,
  OCS, HERO_OC_ID,
});
