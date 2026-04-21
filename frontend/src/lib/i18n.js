// i18n — Spanish primary, English secondary
export const STRINGS = {
  es: {
    // Nav
    dashboard: 'Dashboard', expedientes: 'Expedientes', pipeline: 'Pipeline', portal: 'Portal',
    financiero: 'Financiero', transfers: 'Transferencias', nodos: 'Nodos', clientes: 'Clientes',
    brands: 'Marcas', productos: 'Productos', suppliers: 'Proveedores', inventario: 'Inventario',
    templates: 'Plantillas', history: 'Historial', collections: 'Cobros',
    core: 'Operación', structure: 'Estructura', notifications: 'Notificaciones',
    // Common
    search: 'Buscar', search_ph: 'Buscar expediente, OC, SAP, cliente…', new: 'Nuevo', save: 'Guardar', cancel: 'Cancelar',
    filter: 'Filtrar', clear: 'Limpiar', edit: 'Editar', delete: 'Eliminar', view_all: 'Ver todos',
    refresh: 'Actualizar', export: 'Exportar', import: 'Importar',
    // Dashboard
    overview: 'Resumen operativo y financiero',
    active_exp: 'Expedientes activos', total_cost: 'Costo total', invoiced: 'Facturado', paid: 'Cobrado',
    receivable: 'Por cobrar', margin: 'Margen', operational_pipeline: 'Pipeline operativo',
    urgent_actions: 'Acciones urgentes', brand_breakdown: 'Breakdown por marca',
    cash_flow: 'Flujo de caja · últimos 90 días', recent_activity: 'Actividad reciente',
    // Expediente
    ref: 'Ref', client: 'Cliente', brand: 'Marca', status: 'Estado', credit_days: 'Días crédito',
    amount: 'Monto', activity: 'Actividad', blocked_only: 'Solo bloqueados',
    all_brands: 'Todas las marcas', blocked: 'Bloqueado', risk: 'Riesgo', on_time: 'Al día',
    critical: 'Crítico', warning: 'Advertencia',
    // States
    REGISTRO: 'Registro', PRODUCCION: 'Producción', PREPARACION: 'Preparación',
    DESPACHO: 'Despacho', TRANSITO: 'Tránsito', EN_DESTINO: 'En destino',
    CERRADO: 'Cerrado', CANCELADO: 'Cancelado',
    advance_state: 'Avanzar estado', advance_to: 'Avanzar a', state: 'Estado',
    // Tabs
    tab_overview: 'Resumen', tab_artifacts: 'Documentos', tab_costs: 'Costos',
    tab_payments: 'Pagos', tab_lines: 'Productos', tab_activity: 'Actividad',
    // Detail
    details: 'Detalles', cost_summary: 'Resumen de costos', payment_progress: 'Avance de cobro',
    origin: 'Origen', destination: 'Destino', mode: 'Modo', freight: 'Flete',
    dispatch: 'Despacho', shipment_date: 'Fecha embarque', eta: 'ETA',
    containers: 'Contenedores', products: 'Productos', created: 'Creado', updated: 'Actualizado',
    // Documents
    doc_status_issued: 'Emitido', doc_status_pending: 'Pendiente', doc_status_future: 'Futuro',
    upload: 'Subir', add_document: 'Agregar documento',
    // Costs
    add_cost: 'Registrar costo', cost_type: 'Tipo de costo', supplier: 'Proveedor',
    visibility: 'Visibilidad', client_visible: 'Visible para cliente', internal_only: 'Sólo interno',
    // Pagos
    register_payment: 'Registrar pago', payment_method: 'Método', reference: 'Referencia',
    apply_to: 'Aplicar a', total_invoiced_lbl: 'Total facturado', paid_lbl: 'Cobrado',
    balance: 'Saldo',
    // Wizard
    new_expediente: 'Nuevo expediente', step_client: 'Cliente y marca', step_mode: 'Modo y flete',
    step_lines: 'Productos', step_review: 'Revisar y crear', back: 'Atrás', next: 'Siguiente',
    create: 'Crear expediente',
    // Portal
    portal_welcome: 'Bienvenido de vuelta', portal_overview: 'Tus órdenes activas y pagos recientes',
    track_order: 'Seguir orden', your_orders: 'Tus órdenes',
    // Inventario
    stock: 'Stock', reserved: 'Reservado', lot: 'Lote', received: 'Recibido', node: 'Nodo',
    available: 'Disponible',
    // RBAC viewport (Tweaks / Portal B2B)
    my_orders: 'Mis Pedidos',
    agreed_price: 'Precio acordado',
    role_client_b2b: 'Cliente B2B',
    // RBAC CLIENT — Pipeline/Portal/Financiero (sprint 2026-04-21)
    my_company: 'Mi Empresa',
    fiscal_name: 'Razón social',
    fiscal_id: 'RUC / CUIT',
    fiscal_address: 'Dirección fiscal',
    account_manager: 'Ejecutivo de cuenta',
    payment_terms: 'Condiciones de pago',
    read_only: 'Solo lectura',
    current_balance: 'Saldo actual',
    credit_limit_lbl: 'Límite de crédito',
    credit_usage: 'Uso de límite de crédito',
    next_payments: 'Próximos vencimientos',
    no_upcoming_payments: 'No tenés vencimientos próximos.',
    due_date: 'Vencimiento',
    days_left: 'Días restantes',
    order_status_title: 'Estado de tus pedidos',
    needs_attention: 'Solo atención',
    // CEO Admin Dashboard
    ceo_scope: 'ADMIN · CEO',
    ceo_overview: 'Rentabilidad, cash flow y logística en vivo',
    live_profitability: 'Rentabilidad en vivo',
    real_margin: 'Margen real', projected_margin: 'Margen proyectado',
    margin_drift: 'Drift', vs_projected: 'vs. proyectado',
    cash_flow_coll: 'Cash flow · Cobranza',
    receivables_total: 'Total por cobrar',
    payables_total: 'Pagos por salir',
    credit_clock: 'Reloj de crédito',
    credit_clock_sub: 'Tope: 90 días · alerta amarilla 60d · bloqueo rojo 75d',
    operational_times: 'Tiempos operativos',
    avg_phase_time: 'Promedio por fase',
    vs_historical: 'vs. histórico',
    process_quality: 'Calidad del proceso',
    with_cost_correction: 'Con corrección de costos',
    proformas_reviewed: 'Proformas con revisión',
    proformas_clean: 'Proformas sin revisión',
    time_signal: 'Semáforo',
    alerts_blocks: 'Alertas y bloqueos',
    docs_missing: 'Documentos pendientes',
    factory_delay: 'Retraso de fábrica',
    credit_60: 'Crédito > 60d (alerta)',
    credit_75: 'Crédito > 75d (bloqueo)',
    payments_breakdown: 'Desglose de pagos',
    pg_paid: 'Pagado', pg_pending: 'Pendiente', pg_verified: 'Verificado',
    pg_released: 'Liberado', pg_rejected: 'Rechazado',
    credit_available: 'Crédito disponible',
    exposure: 'Exposición',
    internal_costs: 'Costos internos (CEO-ONLY)',
    logistic_cost: 'Costo logístico',
    taxes: 'Impuestos',
    mode_op: 'Modo de operación',
    commission: 'Comisión', full_mode: 'FULL',
    base_price_lbl: 'Precio base',
    deferred_price: 'Precio diferido',
    deferred_price_sub: 'Negociación interna',
    visible_to_client: 'Visible para cliente',
    edit: 'Editar',
    // Filters
    signal_green: 'En tiempo', signal_amber: 'Retraso', signal_red: 'Crítico',
    show_blocked: 'Con bloqueos', show_alerts: 'Con alertas',
    fleet_view: 'Vista flota', financial_view: 'Vista financiera', ops_view: 'Vista operativa',
    all_clients: 'Todos los clientes',
    // OC Detail
    oc_detail: 'Detalle de Orden de Compra', oc_short: 'OC', po_number: 'Número de OC',
    issued_date: 'Emitida', order_value: 'Valor de la orden',
    oc_coverage: 'Cobertura de la Orden', coverage_sub: 'Con SAP asignado',
    logistics_split: 'Split Logístico', logistics_sub: 'Marítimo vs Aéreo',
    financial_status: 'Estado Financiero', pending: 'Pendiente',
    oc_lines: 'Líneas de la OC', product_line: 'Producto',
    grouped_by_sap: 'Agrupado por SAP', line_status_orphan: 'Pendiente SAP', orphan_line: 'Línea huérfana',
    sap_assignment: 'SAP', prod_date: 'Fecha de producción',
    transport_air: 'Aéreo', transport_sea: 'Marítimo',
    unit_price_lbl: 'Valor unitario', total_price_lbl: 'Valor total',
    deferred_qty: 'Cant. diferida', deferred_price_col: 'Precio diferido',
    visible_to_client_short: 'Visible al cliente',
    expedientes_in_oc: 'Expedientes de la OC',
    documents_hub: 'Documentos comerciales', download: 'Descargar',
    back_to_list: 'Volver a Expedientes', back_to_oc: 'Volver a OC',
    open_expediente: 'Abrir expediente',
    oc_stats: 'Indicadores de la OC',
    credit_triggered: 'Reloj activado', credit_idle: 'Sin envios',
    lines_count: 'Líneas',
    no_sap: 'Sin SAP',
    pending_sap: 'Pendiente de confirmación de fábrica',
    view_lines: 'Ver líneas',
    ocs: 'OCs', ocs_count: 'Ordenes de Compra',
    oc_state_closed: 'Cerrada', oc_state_active: 'En ejecución', oc_state_partial: 'Asignación parcial',
  },
  en: {
    // RBAC viewport (Tweaks / Portal B2B)
    my_orders: 'My Orders',
    agreed_price: 'Agreed price',
    role_client_b2b: 'B2B Client',
    // RBAC CLIENT — Pipeline/Portal/Financial (sprint 2026-04-21)
    my_company: 'My Company',
    fiscal_name: 'Legal name',
    fiscal_id: 'Tax ID',
    fiscal_address: 'Fiscal address',
    account_manager: 'Account manager',
    payment_terms: 'Payment terms',
    read_only: 'Read only',
    current_balance: 'Current balance',
    credit_limit_lbl: 'Credit limit',
    credit_usage: 'Credit limit usage',
    next_payments: 'Upcoming payments',
    no_upcoming_payments: 'No upcoming payments.',
    due_date: 'Due date',
    days_left: 'Days left',
    order_status_title: 'Your orders status',
    needs_attention: 'Needs attention',
    dashboard: 'Dashboard', expedientes: 'Files', pipeline: 'Pipeline', portal: 'Portal',
    financiero: 'Financial', transfers: 'Transfers', nodos: 'Nodes', clientes: 'Clients',
    brands: 'Brands', productos: 'Products', suppliers: 'Suppliers', inventario: 'Inventory',
    templates: 'Templates', history: 'History', collections: 'Collections',
    core: 'Operations', structure: 'Structure', notifications: 'Notifications',
    search: 'Search', search_ph: 'Search file, PO, SAP, client…', new: 'New', save: 'Save', cancel: 'Cancel',
    filter: 'Filter', clear: 'Clear', edit: 'Edit', delete: 'Delete', view_all: 'View all',
    refresh: 'Refresh', export: 'Export', import: 'Import',
    overview: 'Operational & financial summary',
    active_exp: 'Active files', total_cost: 'Total cost', invoiced: 'Invoiced', paid: 'Paid',
    receivable: 'Receivable', margin: 'Margin', operational_pipeline: 'Operational pipeline',
    urgent_actions: 'Urgent actions', brand_breakdown: 'Brand breakdown',
    cash_flow: 'Cash flow · last 90 days', recent_activity: 'Recent activity',
    ref: 'Ref', client: 'Client', brand: 'Brand', status: 'Status', credit_days: 'Credit days',
    amount: 'Amount', activity: 'Activity', blocked_only: 'Blocked only',
    all_brands: 'All brands', blocked: 'Blocked', risk: 'Risk', on_time: 'On time',
    critical: 'Critical', warning: 'Warning',
    REGISTRO: 'Record', PRODUCCION: 'Production', PREPARACION: 'Preparation',
    DESPACHO: 'Dispatch', TRANSITO: 'Transit', EN_DESTINO: 'At destination',
    CERRADO: 'Closed', CANCELADO: 'Canceled',
    advance_state: 'Advance state', advance_to: 'Advance to', state: 'State',
    tab_overview: 'Overview', tab_artifacts: 'Documents', tab_costs: 'Costs',
    tab_payments: 'Payments', tab_lines: 'Products', tab_activity: 'Activity',
    details: 'Details', cost_summary: 'Cost summary', payment_progress: 'Payment progress',
    origin: 'Origin', destination: 'Destination', mode: 'Mode', freight: 'Freight',
    dispatch: 'Dispatch', shipment_date: 'Shipment', eta: 'ETA',
    containers: 'Containers', products: 'Products', created: 'Created', updated: 'Updated',
    doc_status_issued: 'Issued', doc_status_pending: 'Pending', doc_status_future: 'Future',
    upload: 'Upload', add_document: 'Add document',
    add_cost: 'Register cost', cost_type: 'Cost type', supplier: 'Supplier',
    visibility: 'Visibility', client_visible: 'Client visible', internal_only: 'Internal only',
    register_payment: 'Register payment', payment_method: 'Method', reference: 'Reference',
    apply_to: 'Apply to', total_invoiced_lbl: 'Total invoiced', paid_lbl: 'Paid',
    balance: 'Balance',
    new_expediente: 'New file', step_client: 'Client & brand', step_mode: 'Mode & freight',
    step_lines: 'Products', step_review: 'Review & create', back: 'Back', next: 'Next',
    create: 'Create file',
    portal_welcome: 'Welcome back', portal_overview: 'Your active orders and recent payments',
    track_order: 'Track order', your_orders: 'Your orders',
    stock: 'Stock', reserved: 'Reserved', lot: 'Lot', received: 'Received', node: 'Node',
    available: 'Available',
    // OC Detail
    oc_detail: 'Purchase Order Detail', oc_short: 'PO', po_number: 'PO number',
    issued_date: 'Issued', order_value: 'Order value',
    oc_coverage: 'Order Coverage', coverage_sub: 'With SAP assigned',
    logistics_split: 'Logistics split', logistics_sub: 'Sea vs Air',
    financial_status: 'Financial status', pending: 'Pending',
    oc_lines: 'PO lines', product_line: 'Product',
    grouped_by_sap: 'Grouped by SAP', line_status_orphan: 'SAP pending', orphan_line: 'Orphan line',
    sap_assignment: 'SAP', prod_date: 'Production date',
    transport_air: 'Air', transport_sea: 'Sea',
    unit_price_lbl: 'Unit value', total_price_lbl: 'Total value',
    deferred_qty: 'Deferred qty', deferred_price_col: 'Deferred price',
    visible_to_client_short: 'Visible to client',
    expedientes_in_oc: 'Files in this PO',
    documents_hub: 'Commercial documents', download: 'Download',
    back_to_list: 'Back to Files', back_to_oc: 'Back to PO',
    open_expediente: 'Open file',
    oc_stats: 'PO indicators',
    credit_triggered: 'Credit triggered', credit_idle: 'No shipments',
    lines_count: 'Lines',
    no_sap: 'No SAP',
    pending_sap: 'Pending factory confirmation',
    view_lines: 'View lines',
    ocs: 'POs', ocs_count: 'Purchase Orders',
    oc_state_closed: 'Closed', oc_state_active: 'In execution', oc_state_partial: 'Partial assignment',
  },
};

export function tr(lang, key) {
  const dict = STRINGS[lang] || STRINGS.es;
  return dict[key] ?? STRINGS.es[key] ?? key;
}

export function fmtMoney(n, currency='USD') {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
export function fmtMoneyDetail(n, currency='USD') {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}
export function fmtDate(iso, lang='es') {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'es' ? 'es-PE' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}
export function fmtShortDate(iso, lang='es') {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-PE' : 'en-US', { day: '2-digit', month: 'short' });
  } catch { return '—'; }
}
export function relativeTime(iso, lang='es') {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return lang==='es' ? 'ahora' : 'now';
  if (min < 60) return lang==='es' ? `hace ${min} min` : `${min}m ago`;
  const hr = Math.floor(min/60);
  if (hr < 24) return lang==='es' ? `hace ${hr}h` : `${hr}h ago`;
  const d = Math.floor(hr/24);
  if (d < 30) return lang==='es' ? `hace ${d}d` : `${d}d ago`;
  const mo = Math.floor(d/30);
  return lang==='es' ? `hace ${mo} meses` : `${mo}mo ago`;
}
