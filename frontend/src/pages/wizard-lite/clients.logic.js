// MWT.ONE · pages/wizard-lite/clients.logic.js
// Lógica pura de adaptación/ordenamiento de clientes del wizard-lite.
// Extraída de CreateExpedienteWizardLite (Ola 3 · 3.28). SIN React.
// =====================================================================

/** Adapta un cliente del API al shape que consume el wizard. */
export function adaptClient(c) {
  return {
    id:              c.id,
    label:           c.razon_social || c.nombre_comercial || "—",
    razon_social:    c.razon_social,
    tax_id:          c.tax_id,
    parent_id:       c.parent_id || null,
    parent_label:    null,
    contacto_email:  c.contacto_email,
    credito_limit:   Number(c.credito_aprobado || c.credito_limit_usd || 0),
    credito_used:    Number(c.credito_usado || 0),
    dias_credito:    Number(c.dias_credito || 0),
  };
}

/** Ordena clientes en jerarquía padre → subsidiarios (anida por parent_id). */
export function orderClientsHierarchy(clients) {
  const out = []; const seen = new Set();
  clients.filter((c) => !c.parent_id).forEach((parent) => {
    out.push(parent); seen.add(parent.id);
    clients.filter((c) => c.parent_id === parent.id).forEach((sub) => {
      out.push({ ...sub, parent_label: parent.label });
      seen.add(sub.id);
    });
  });
  clients.forEach((c) => { if (!seen.has(c.id)) out.push(c); });
  return out;
}
