// MWT.ONE · pages/product-form/clients.logic.js
// Lógica pura de adaptación/ordenamiento de clientes del formulario de
// producto. Extraída de ProductFormView (Ola 3 · 3.28). SIN React.
// =====================================================================

/** Adapta un cliente del API al shape del grid de marcas/pricing. */
export function adaptClienteForGrid(c) {
  return {
    id:           c.id || c.uuid,
    name:         c.nombre_comercial || c.razon_social || '—',
    parent_id:    c.parent_id || null,
    parent_name:  null,   // se rellena en orderClientsHierarchy()
  };
}

/** Ordena clientes con padres primero, seguidos de sus subsidiarias
 *  (sangradas). Pre-resuelve parent_name para mostrar contexto. */
export function orderClientsHierarchy(clients) {
  const byId = new Map(clients.map(c => [c.id, c]));
  const parents = clients.filter(c => !c.parent_id);
  const out = [];
  parents.forEach(p => {
    out.push(p);
    clients
      .filter(c => c.parent_id === p.id)
      .forEach(s => {
        out.push({ ...s, parent_name: p.name });
      });
  });
  // Subsidiarias huérfanas (padre no en la lista) — al final por seguridad
  clients.forEach(c => {
    if (c.parent_id && !byId.has(c.parent_id) && !out.find(o => o.id === c.id)) {
      out.push(c);
    }
  });
  return out;
}
