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

// Importamos las fixtures del mockData para que el "OCR" devuelva IDs
// que SÍ existen en el pool de clientes/marcas que renderiza la UI —
// así el setClientId/setBrandId del Wizard matchea inmediatamente.
import { CLIENTS as MOCK_CLIENTS, BRANDS as MOCK_BRANDS, BRAND_PRODUCTS as MOCK_BRAND_PRODUCTS } from "../data/mockData.js";

// Pequeño pool de clientes ficticios para rotar según el nombre del archivo
// (heurística barata para que distintos uploads muestren distintos clientes
//  y se sienta "inteligente").
// Pool de clientes de respaldo — sólo se usa si MOCK_CLIENTS de mockData
// no pudo cargarse (SSR safety). En runtime real el seed siempre cae en
// MOCK_CLIENTS y estos dos registros quedan inertes.
const CLIENT_POOL = [
  {
    id:                "client-acme-fallback",
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
    id:                "client-delta-fallback",
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
 *
 * Los IDs devueltos (`client._candidates[0].id`, `brand._candidates[0].id`)
 * son IDs que EXISTEN en mockData.CLIENTS / mockData.BRANDS — así el Wizard
 * puede hacer `setClientId(resp.client._candidates[0].id)` y la UI lo
 * resuelve a una fila real del pool demo.
 */
export function portalOcrParseMock(file, opts = {}) {
  const filename = (file && file.name) || opts.filename || "oc_demo.pdf";
  const seed     = hashString(filename);

  // ── Cliente real del pool mockData ────────────────────────────
  // Tomamos el cliente por seed → siempre determinístico.
  const pool = (Array.isArray(MOCK_CLIENTS) && MOCK_CLIENTS.length)
    ? MOCK_CLIENTS
    : CLIENT_POOL;
  const client = pool[seed % pool.length];
  const clientId     = client.id || client.uuid;
  const clientName   = client.cliente || client.name || client.razon_social || "Cliente demo";
  const taxId        = client.cedula_juridica || client.tax_id || "";
  const creditDays   = client.credito_dias   ?? client.credit_days  ?? null;
  const creditLimit  = client.credit_limit   ?? client.credito_limit ?? client.credit_limit_usd ?? null;
  const countryIso   = client.country_code   || client.pais_iso2 || null;
  const contactName  = client.contact        || client.contacto || null;
  const contactEmail = client.email          || null;

  // 2do candidato (score más bajo) para simular el fuzzy-matching
  const clientAlt = pool[(seed + 1) % pool.length];

  // ── Marca real del pool mockData ──────────────────────────────
  const brandPool = (Array.isArray(MOCK_BRANDS) && MOCK_BRANDS.length)
    ? MOCK_BRANDS
    : [{ id: "bis", name: "Bison", code: "BIS" }];
  const brand = brandPool[seed % brandPool.length];

  // ── Líneas ─────────────────────────────────────────────────────
  // Si BRAND_PRODUCTS del mockData tiene items para esta marca, los usamos;
  // si no, caemos al LINE_POOL.
  const brandProducts = (Array.isArray(MOCK_BRAND_PRODUCTS) ? MOCK_BRAND_PRODUCTS : [])
    .filter((p) => p.brand_id === brand.id);
  const nLines = 3 + (seed % 2);    // 3 o 4 líneas
  const lines  = [];
  for (let i = 0; i < nLines; i++) {
    const qtyJitter = 60 + ((seed >> (i + 1)) % 6) * 24;
    if (brandProducts.length > 0) {
      const src = brandProducts[(seed + i) % brandProducts.length];
      const unitPrice = Number(src.base_price || src.price || 70).toFixed(2);
      lines.push({
        sku:          src.sku,
        descripcion:  src.nombre || src.name || src.sku,
        size:         src.size || null,
        qty:          qtyJitter,
        unit_price:   Number(unitPrice),
        confidence:   0.93,
        producto_id:  src.id,
        price_verdict: "OK",
        moq_client:    null,
        moq_violated:  false,
        notes:         null,
        ocr_raw_line: `${src.sku} · ${qtyJitter} pares · $${unitPrice}`,
      });
    } else {
      const src = LINE_POOL[(seed + i) % LINE_POOL.length];
      lines.push({
        ...src,
        qty: qtyJitter,
        ocr_raw_line: `${src.sku} · ${qtyJitter} pares · $${src.unit_price.toFixed(2)}`,
      });
    }
  }
  const total = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);

  // ── PO number derivado del cliente + archivo ──────────────────
  const shortName = (clientName.split(" ")[0] || "OC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const poNumber = `PO-${shortName}-${String(seed).slice(-4).padStart(4, "0")}`;
  const poDate   = new Date(Date.now() - (seed % 30) * 86400000).toISOString().slice(0, 10);

  return {
    ok:     true,
    error:  null,
    payload: {
      client: {
        name:   clientName,
        tax_id: taxId,
        _candidates: [
          {
            id:                clientId,
            razon_social:      clientName,
            score:             0.97,
            credit_days:       creditDays,
            credit_limit_usd:  creditLimit,
          },
          {
            id:                clientAlt.id,
            razon_social:      clientAlt.cliente || clientAlt.name,
            score:             0.62,
            credit_days:       clientAlt.credito_dias ?? clientAlt.credit_days ?? null,
            credit_limit_usd:  clientAlt.credit_limit  ?? clientAlt.credito_limit ?? null,
          },
        ],
        credit_days:      creditDays,
        credit_limit_usd: creditLimit,
        contacto:         contactName,
        email:            contactEmail,
        pais_iso2:        countryIso,
      },
      brand: {
        name:       brand.name,
        brand_code: brand.code || brand.brand_id || null,
        _candidates: [
          { id: brand.id, nombre: brand.name, score: 0.99 },
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
        `Cliente: ${clientName}\n` +
        `RUC/CUIT: ${taxId}\n` +
        `Fecha: ${poDate}\n` +
        `Marca: ${brand.name}\n\n` +
        lines.map((l) => `${l.sku}  ${l.qty} pares  $${l.unit_price.toFixed(2)}  ${l.descripcion}`).join("\n"),
    },
  };
}
