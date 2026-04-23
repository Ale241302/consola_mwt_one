// =====================================================================
// MWT.ONE · lib/ocrMock.js
// Agente responsable: [AG-FRONTEND]
//
// Fixtures demo para POST /api/ocr/parse-oc/ en modo VITE_USE_MOCKS=1.
// El shape IMITA exactamente lo que devuelve apps.ocr.services.parse_oc_*
// del backend:
//   {
//     ok: true,
//     payload: {
//       client: { name, tax_id, _candidates: [{id, razon_social, score,
//                                              credit_days, credit_limit_usd}] },
//       brand:  { name, _candidates: [{id, nombre, score}] },
//       po:     { number, date, currency, incoterm, total },
//       lines:  [{ sku, descripcion, size, qty, unit_price, confidence,
//                  price_verdict, moq_client, moq_violated, notes, producto_id }],
//       confidence, ocr_engine, paperless_task_id, raw_text_preview
//     }
//   }
//
// Los SKUs están cruzados con PORTAL_PRODUCTS_DEMO (portalProductsMock.js)
// — así, cuando un CLIENT B2B suba un archivo en su portal, los productos
// "detectados" corresponden con los que ya puede ver en el catálogo,
// cerrando el loop UX.
// =====================================================================

// IDs demo coherentes con el resto de mocks (Rana Walk + Rana Pro)
const CLIENT_ACME_ID    = "client-acme-demo";
const CLIENT_DELTA_ID   = "client-delta-demo";
const BRAND_RANA_WALK_ID = "brand-ranawalk-demo";
const BRAND_RANA_PRO_ID  = "brand-ranapro-demo";

// Pequeño pool de clientes ficticios para rotar según el nombre del archivo
// (heurística barata para que distintos uploads muestren distintos clientes
//  y se sienta "inteligente").
const CLIENT_POOL = [
  {
    id:                CLIENT_ACME_ID,
    razon_social:      "ACME Industrial S.R.L.",
    nombre_comercial:  "ACME Industrial",
    tax_id:            "30-12345678-9",
    credit_days:       45,
    credit_limit_usd:  150000,
    pais_iso2:         "AR",
    contacto:          "Alejandra Pérez",
    email:             "compras@acme-industrial.com.ar",
  },
  {
    id:                CLIENT_DELTA_ID,
    razon_social:      "Constructora Delta S.A.",
    nombre_comercial:  "Delta Construcciones",
    tax_id:            "20-08765432-1",
    credit_days:       60,
    credit_limit_usd:  250000,
    pais_iso2:         "PE",
    contacto:          "Javier Rojas",
    email:             "jrojas@delta-sa.pe",
  },
];

// Líneas plantilla (SKUs del catálogo demo). El mock las mezcla.
const LINE_POOL = [
  {
    sku:          "RW-IND-STL-42",
    descripcion:  "Bota industrial con puntera de acero",
    size:         "42",
    qty:          120,
    unit_price:   89.50,
    confidence:   0.95,
    producto_id:  "prod-rw-001",
    price_verdict: "OK",
    moq_client:    50,
    moq_violated:  false,
    notes:         null,
  },
  {
    sku:          "RW-IND-COMP-41",
    descripcion:  "Zapato de seguridad puntera compuesta",
    size:         "41",
    qty:          80,
    unit_price:   72.00,
    confidence:   0.93,
    producto_id:  "prod-rw-002",
    price_verdict: "OK",
    moq_client:    40,
    moq_violated:  false,
    notes:         null,
  },
  {
    sku:          "RW-FIELD-44",
    descripcion:  "Bota de trabajo cuero engrasado",
    size:         "44",
    qty:          60,
    unit_price:   98.75,
    confidence:   0.91,
    producto_id:  "prod-rw-005",
    price_verdict: "WARN_BELOW_SYSTEM",
    moq_client:    30,
    moq_violated:  false,
    notes:         "cliente_pagó_3.25%_menos",
  },
  {
    sku:          "RP-DIEL-43",
    descripcion:  "Bota dieléctrica 18 kV",
    size:         "43",
    qty:          24,
    unit_price:   118.90,
    confidence:   0.92,
    producto_id:  "prod-rp-003",
    price_verdict: "OK",
    moq_client:    12,
    moq_violated:  false,
    notes:         null,
  },
];

// Deterministic hash sobre el nombre del archivo para elegir cliente+líneas
// (consistente en recargas — si subes el mismo PDF, te da lo mismo).
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}


/**
 * Devuelve la respuesta mockeada de /api/ocr/parse-oc/.
 * @param {File|null} file   archivo subido (se usa su nombre para seeding)
 * @param {object}    [opts]
 * @returns {object} payload con shape backend-compatible
 */
export function portalOcrParseMock(file, opts = {}) {
  const filename = (file && file.name) || opts.filename || "oc_demo.pdf";
  const seed     = hashString(filename);

  // Cliente asignado por hash → deterministic
  const client = CLIENT_POOL[seed % CLIENT_POOL.length];

  // Número de OC generado a partir del nombre del archivo (parece real)
  const poNumber = `OC-${client.nombre_comercial.split(" ")[0].toUpperCase()}-${String(seed).slice(-4).padStart(4,"0")}`;
  const poDate   = new Date(Date.now() - (seed % 30) * 86400000).toISOString().slice(0, 10);

  // Líneas: 3 o 4 según seed
  const nLines = 3 + (seed % 2);
  const lines  = [];
  for (let i = 0; i < nLines; i++) {
    const src = LINE_POOL[(seed + i) % LINE_POOL.length];
    // pequeño jitter en qty para que no sean siempre iguales
    const qtyJitter = ((seed >> (i+1)) % 5) * 12;
    lines.push({
      ...src,
      qty: src.qty + qtyJitter,
      ocr_raw_line: `${src.sku} · ${src.descripcion} · ${src.qty + qtyJitter} pares · $${src.unit_price.toFixed(2)}`,
    });
  }
  const total = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);

  // Brand = siempre Rana Walk para el demo (mayoría del catálogo)
  const brandIsPro = lines.some((l) => l.sku.startsWith("RP-"));
  const brandId    = brandIsPro ? BRAND_RANA_PRO_ID : BRAND_RANA_WALK_ID;
  const brandName  = brandIsPro ? "Rana Pro" : "Rana Walk";

  return {
    ok:     true,
    error:  null,
    payload: {
      client: {
        name:          client.razon_social,
        tax_id:        client.tax_id,
        _candidates: [
          {
            id:                client.id,
            razon_social:      client.razon_social,
            score:             0.97,
            credit_days:       client.credit_days,
            credit_limit_usd:  client.credit_limit_usd,
          },
          // 2do candidato con score más bajo (para mostrar que el algoritmo
          // sabe desambiguar)
          {
            id:                CLIENT_POOL[(seed + 1) % CLIENT_POOL.length].id,
            razon_social:      CLIENT_POOL[(seed + 1) % CLIENT_POOL.length].razon_social,
            score:             0.62,
            credit_days:       CLIENT_POOL[(seed + 1) % CLIENT_POOL.length].credit_days,
            credit_limit_usd:  CLIENT_POOL[(seed + 1) % CLIENT_POOL.length].credit_limit_usd,
          },
        ],
        // Metadata extra útil en la UI (no lo usa el backend real
        // todavía, pero lo dejamos por si luego lo agregamos al payload).
        credit_days:      client.credit_days,
        credit_limit_usd: client.credit_limit_usd,
        contacto:         client.contacto,
        email:            client.email,
        pais_iso2:        client.pais_iso2,
      },
      brand: {
        name:       brandName,
        brand_code: brandIsPro ? "RP" : "RW",
        _candidates: [
          { id: brandId, nombre: brandName, score: 0.99 },
        ],
      },
      po: {
        number:   poNumber,
        date:     poDate,
        currency: "USD",
        incoterm: "FOB",
        total:    Number(total.toFixed(2)),
      },
      lines,
      confidence:        0.94,
      ocr_engine:        "mock-demo (paperless-ngx+pdfminer)",
      paperless_task_id: `mock-task-${seed.toString(16).slice(-8)}`,
      raw_text_preview:
        `ORDEN DE COMPRA ${poNumber}\n` +
        `Cliente: ${client.razon_social}\n` +
        `RUC/CUIT: ${client.tax_id}\n` +
        `Fecha: ${poDate}\n` +
        `Marca: ${brandName}\n\n` +
        lines.map((l) => `${l.sku}  ${l.qty} pares  $${l.unit_price.toFixed(2)}  ${l.descripcion}`).join("\n"),
    },
  };
}
