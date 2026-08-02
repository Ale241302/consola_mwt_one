// i18n — Spanish primary, English secondary
const STRINGS = {
  es: {
    // Nav
    dashboard: 'Dashboard', expedientes: 'Expedientes', pipeline: 'Pipeline', portal: 'Portal',
    financiero: 'Financiero', transfers: 'Movimientos', nodos: 'Nodos', clientes: 'Clientes', finanzas: 'Finanzas',
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
    REGISTRO: 'Registro', PRODUCCION: 'Producción', PREPARACION: 'Preparación de despacho',
    DESPACHO: 'Despacho', PREPARACION_DESPACHO: 'Preparación de despacho', TRANSITO: 'Tránsito', EN_DESTINO: 'En destino',
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
    // Pagos v2 (drawer rediseñado · spec v2.0)
    pay_section_amount: 'Monto y moneda', pay_section_when: 'Fecha y método',
    pay_type: 'Tipo de pago', pay_type_partial: 'Parcial', pay_type_complete: 'Completo',
    pay_type_partial_hint: 'El monto debe ser menor al saldo del documento',
    pay_type_complete_hint: 'El monto se ajusta automáticamente al saldo total',
    pay_method_transfer: 'Transferencia bancaria', pay_method_credit_note: 'Nota de crédito',
    pay_notes_optional: 'Notas (opcional)',
    pay_notes_ph: 'Ej. Anticipo Sonepar · OC-2026-3142',
    pay_evidence: 'Comprobante de pago', pay_evidence_credit_note: 'PDF de la nota de crédito',
    pay_evidence_hint_transfer: 'PDF o imagen (PNG/JPG/WEBP) · máx. 10 MB · obligatorio',
    pay_evidence_hint_credit_note: 'PDF de la nota emitida · máx. 10 MB · obligatorio',
    pay_evidence_drop: 'Arrastra el archivo o haz clic para seleccionar',
    pay_evidence_change: 'Cambiar archivo', pay_evidence_remove: 'Quitar',
    pay_apply_costo: 'Costo', pay_apply_producto: 'Producto',
    pay_apply_proforma: 'Proforma', pay_apply_factura: 'Factura',
    pay_apply_empty: 'No hay items con saldo en esta categoría',
    pay_apply_search_ph: 'Buscar por código, descripción o monto…',
    pay_applied_amount: 'Monto aplicado',
    pay_submit: 'Registrar pago', pay_submitting: 'Registrando…',
    pay_required: 'Campo requerido',
    pay_min_chars: 'Mínimo 3 caracteres',
    pay_amount_invalid: 'El monto debe ser mayor a cero',
    pay_amount_complete_mismatch: 'En tipo Completo, el monto debe ser igual al saldo del documento',
    pay_amount_partial_too_high: 'En tipo Parcial, el monto debe ser menor al saldo',
    pay_evidence_required: 'Adjunta el comprobante para continuar',
    pay_evidence_too_big: 'El archivo supera 10 MB',
    pay_evidence_bad_type: 'Solo se permiten PDF, PNG, JPG o WEBP',
    pay_apply_required: 'Selecciona al menos un documento al que aplicar el pago',
    pay_toast_pending_backend_title: 'UI lista · backend pendiente',
    pay_toast_pending_backend_body: 'El drawer ya recoge todos los datos del spec v2.0 pero el endpoint /api/v1/expedientes/{id}/pagos/ todavía no existe. El pago NO se persistió.',
    pay_subject: '¿A qué se aplica?',
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
    sap_assignment: 'SAP', prod_date: 'Fecha de registro',
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
    dashboard: 'Dashboard', expedientes: 'Files', pipeline: 'Pipeline', portal: 'Portal',
    financiero: 'Financial', transfers: 'Transfers', nodos: 'Nodes', clientes: 'Clients', finanzas: 'Finance',
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
    REGISTRO: 'Record', PRODUCCION: 'Production', PREPARACION: 'Dispatch preparation',
    DESPACHO: 'Dispatch', PREPARACION_DESPACHO: 'Dispatch preparation', TRANSITO: 'Transit', EN_DESTINO: 'At destination',
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
    pay_section_amount: 'Amount & currency', pay_section_when: 'Date & method',
    pay_type: 'Payment type', pay_type_partial: 'Partial', pay_type_complete: 'Complete',
    pay_type_partial_hint: 'Amount must be less than the document balance',
    pay_type_complete_hint: 'Amount auto-adjusts to the full document balance',
    pay_method_transfer: 'Bank transfer', pay_method_credit_note: 'Credit note',
    pay_notes_optional: 'Notes (optional)',
    pay_notes_ph: 'E.g. Sonepar advance · PO-2026-3142',
    pay_evidence: 'Payment evidence', pay_evidence_credit_note: 'Credit note PDF',
    pay_evidence_hint_transfer: 'PDF or image (PNG/JPG/WEBP) · max 10 MB · required',
    pay_evidence_hint_credit_note: 'PDF of the issued note · max 10 MB · required',
    pay_evidence_drop: 'Drag the file or click to select',
    pay_evidence_change: 'Change file', pay_evidence_remove: 'Remove',
    pay_apply_costo: 'Cost', pay_apply_producto: 'Product',
    pay_apply_proforma: 'Proforma', pay_apply_factura: 'Invoice',
    pay_apply_empty: 'No items with balance in this category',
    pay_apply_search_ph: 'Search by code, description or amount…',
    pay_applied_amount: 'Applied amount',
    pay_submit: 'Register payment', pay_submitting: 'Registering…',
    pay_required: 'Required field',
    pay_min_chars: 'Minimum 3 characters',
    pay_amount_invalid: 'Amount must be greater than zero',
    pay_amount_complete_mismatch: 'In Complete type, amount must equal the document balance',
    pay_amount_partial_too_high: 'In Partial type, amount must be less than the balance',
    pay_evidence_required: 'Attach the evidence to continue',
    pay_evidence_too_big: 'File exceeds 10 MB',
    pay_evidence_bad_type: 'Only PDF, PNG, JPG or WEBP are allowed',
    pay_apply_required: 'Select at least one document to apply the payment to',
    pay_toast_pending_backend_title: 'UI ready · backend pending',
    pay_toast_pending_backend_body: 'The drawer captures every field from spec v2.0 but the endpoint /api/v1/expedientes/{id}/pagos/ does not exist yet. Payment was NOT persisted.',
    pay_subject: 'What is being paid?',
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
    sap_assignment: 'SAP', prod_date: 'Registration date',
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

function tr(lang, key) {
  const dict = STRINGS[lang] || STRINGS.es;
  return dict[key] ?? STRINGS.es[key] ?? key;
}

function fmtMoney(n, currency='USD') {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
function fmtMoneyDetail(n, currency='USD') {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}
function fmtDate(iso, lang='es') {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'es' ? 'es-PE' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}
function fmtShortDate(iso, lang='es') {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-PE' : 'en-US', { day: '2-digit', month: 'short' });
  } catch { return '—'; }
}
function relativeTime(iso, lang='es') {
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

Object.assign(window, { STRINGS, tr, fmtMoney, fmtMoneyDetail, fmtDate, fmtShortDate, relativeTime });
