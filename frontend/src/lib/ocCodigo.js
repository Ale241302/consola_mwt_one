// =====================================================================
// MWT.ONE · lib/ocCodigo.js
//
// Código de OC con la nomenclatura de POL_CODIGO_OC:
//   {PRV}-{CLIENTE}-{LUGAR}-{NN}-{AA}   →  MAR-UMMIE-GT-04-25
//     PRV     marca (MAR Marluvas, TEC Tecmater, BAN Bangni)
//     CLIENTE nombre corto de la empresa
//     LUGAR   marítimo: ISO-2 del país (GT)
//             aéreo:    IATA del aeropuerto destino (GUA, SJO, BOG)  ← G26
//     NN      consecutivo de la marca para ese cliente (1 a 6 dígitos)
//     AA      año del código
//
// Espejo de backend/apps/expedientes/codigo_expediente.py para que la
// ficha del cliente muestre el código mientras se escribe.
// =====================================================================

const CLIENTE_CORTO = [
  ["COMERCIALIZADORA UMMIE", "UMMIE"],
  ["DISTRIBUIDORA COMTEK", "COMTEK"],
  ["EQUIPOS Y GUANTES INDUSTRIALES", "EGUISA"],
  ["GRUPO SOLUCIONES DE INGENIERIA", "SIASA"],
  ["IMPORCOMP", "IMPORCOMP"],
  ["IMPORTACIONES Y COMPRAS", "IMPORTACIONES"],
  ["MUITO WORK", "MUITO"],
  ["PRO CUSTOMER", "PROCUSTOMER"],
  ["MELEXA", "SONEPAR"],
  ["SONDEL", "SONDEL"],
  ["SONEPAR", "SONEPAR"],
  ["MAGNESITA", "MAGNESITA"],
  ["FORAGRO", "FORAGRO"],
];

const NO_SIRVEN = new Set([
  "COMERCIALIZADORA", "DISTRIBUIDORA", "IMPORTADORA", "EQUIPOS", "GRUPO",
  "SOCIEDAD", "COMPANIA", "INDUSTRIAS", "INDUSTRIAL", "CORP", "LTDA",
  "SA", "SAS", "DE", "DEL", "LA", "LAS", "LOS", "Y", "E", "THE", "INC", "LLC",
]);

export function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function clienteCorto(razonSocial) {
  const norm = normalizar(razonSocial);
  for (const [prefijo, corto] of CLIENTE_CORTO) {
    if (norm.startsWith(prefijo)) return corto;
  }
  for (const palabra of norm.split(" ")) {
    if (palabra && !NO_SIRVEN.has(palabra) && palabra.length >= 3) {
      return palabra.slice(0, 12);
    }
  }
  return "CLIENTE";
}

export function prvDeMarca(marca) {
  const key = normalizar(marca?.slug || marca?.nombre).replace(/ /g, "").toLowerCase();
  if (key.includes("marluvas")) return "MAR";
  if (key.includes("tecmater")) return "TEC";
  if (key.includes("bangni")) return "BAN";
  return String(marca?.brand_code || "MAR").toUpperCase().slice(0, 3);
}

export function formatearCodigoOc({ prv, cliente, pais, nn, anio }) {
  const aa = String(anio || new Date().getFullYear()).slice(-2);
  return [
    String(prv || "MAR").toUpperCase().slice(0, 3),
    String(cliente || "CLIENTE").toUpperCase().slice(0, 14),
    // Lugar: 2 letras = país (marítimo), 3 = IATA (aéreo).
    String(pais || "XX").toUpperCase().slice(0, 3),
    String(Number(nn) || 1).padStart(2, "0"),
    aa,
  ].join("-");
}

export function parsearCodigoOc(codigo) {
  const s = String(codigo || "")
    .trim()
    .toUpperCase()
    .replace(/^PO[\s\-_]*/, "")
    .replace(/\s+/g, "");
  const m = s.match(/^([A-Z]{3})-([A-Z0-9]+)-([A-Z]{2,3})-(\d{1,6})-(\d{2})$/);
  if (!m) return null;
  return {
    prv: m[1],
    cliente: m[2],
    pais: m[3],
    nn: Number(m[4]),
    anio: 2000 + Number(m[5]),
    codigo: s,
  };
}

/** Código que se asignaría después del que se muestra. */
export function siguienteCodigoOc(codigo) {
  const partes = parsearCodigoOc(codigo);
  if (!partes) return "";
  return formatearCodigoOc({
    ...partes,
    nn: partes.nn + 1,
    anio: new Date().getFullYear(),
  });
}
