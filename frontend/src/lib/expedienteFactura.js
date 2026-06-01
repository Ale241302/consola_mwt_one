// =====================================================================
// MWT.ONE · lib/expedienteFactura.js
// Agente responsable: [AG-03 FRONTEND]
//
// Genera la "Factura comercial" de un EXPEDIENTE reutilizando el MISMO
// generador HTML que la factura de transferencia (buildTransferInvoiceHtml),
// alimentado por GET /api/expedientes/{id}/factura-payload/.
//
// Flujo: el modal "Agregar documento" → tipo "Factura comercial" elige la
// audiencia (cliente vs MWT/admin), llama aquí para obtener un File .html y
// lo sube a /api/documentos/ con esa audiencia (visibilidad por rol).
// =====================================================================
import { buildTransferInvoiceHtml, INVOICE_AUDIENCE } from "./transferInvoiceHtml.js";
import { getToken } from "./api.js";

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

/**
 * Construye el File .html de la factura comercial del expediente.
 * @param {Object} args
 * @param {string} args.expedienteId
 * @param {('CLIENT'|'MWT_INTERNAL'|'ADMIN_ONLY')} args.audience  audiencia del documento
 * @param {('es'|'en')} [args.lang='es']
 * @returns {Promise<File>} archivo HTML listo para subir
 */
export async function buildExpedienteFacturaFile({ expedienteId, audience, lang = "es" }) {
  const token = getToken();
  const resp = await fetch(
    `${API_BASE}/expedientes/${encodeURIComponent(expedienteId)}/factura-payload/`,
    { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} al obtener datos de la factura${txt ? ": " + txt.slice(0, 160) : ""}`);
  }
  const payload = await resp.json();

  // CLIENT → precio cliente; cualquier audiencia interna (MWT/ADMIN) → precio MWT.
  const invAudience = audience === "CLIENT" ? INVOICE_AUDIENCE.CLIENT : INVOICE_AUDIENCE.MWT;
  const html = buildTransferInvoiceHtml({ payload, audience: invAudience, lang });

  const codigo = String(payload?.transferencia?.codigo || "FACTURA")
    .replace(/[^A-Za-z0-9_-]+/g, "_");
  const tag = audience === "CLIENT" ? "CLIENTE" : "MWT";
  const filename = `Factura_${codigo}_${tag}.html`;
  return new File([html], filename, { type: "text/html" });
}
