// =====================================================================
// MWT.ONE · lib/aiGovernanceMock.js
// Agente responsable: [AG-FRONTEND]
//
// Fixtures demo para las 3 tabs de la Gobernanza del AI Hub en modo
// VITE_USE_MOCKS=1:
//
//   GET /api/ai/agents/        → AI_AGENTS_DEMO
//   GET /api/ai/skills/        → AI_SKILLS_DEMO
//   GET /api/ai/instructions/  → AI_INSTRUCTIONS_DEMO
//
// El shape imita el backend real (apps.ai_hub.serializers):
//
//   Agent       { id, nombre, slug, role, autonomy, default_model,
//                 is_global, description, is_active, created_at }
//   Skill       { id, nombre, slug, scope, autonomy, tags[],
//                 is_global, is_active, description }
//   Instruction { id, titulo, slug, priority, is_global, auto_inject,
//                 body, is_active }
//
// Los valores canónicos de `role`, `autonomy`, `scope` son los que
// espera el renderer AIGovernance.jsx (ver BADGE_COLORS):
//   role:     CHAT · INTERNAL · CONNECTOR · TOOL
//   autonomy: READ_ONLY · SUGGEST · EXECUTE · AUTO
//   scope:    READ · WRITE · DESTRUCTIVE · EXTERNAL
// =====================================================================

export const AI_AGENTS_DEMO = [
  {
    id:             "ag-collection-bot",
    nombre:         "CollectionBot",
    slug:           "collection-bot",
    role:           "CONNECTOR",
    autonomy:       "EXECUTE",
    default_model:  "claude-sonnet-4-6",
    is_global:      true,
    is_active:      true,
    description:    "Motor de cobranza automática. Dispara recordatorios T1/T2/T3 sobre expedientes vencidos usando plantillas publicadas.",
    created_at:     "2026-01-15T09:00:00Z",
  },
  {
    id:             "ag-ocr-assistant",
    nombre:         "OCR Assistant",
    slug:           "ocr-assistant",
    role:           "INTERNAL",
    autonomy:       "SUGGEST",
    default_model:  "claude-opus-4-6",
    is_global:      true,
    is_active:      true,
    description:    "Lee OCs en PDF o XLSX del wizard, extrae cliente/marca/líneas y sugiere matches contra el catálogo.",
    created_at:     "2026-02-10T14:22:00Z",
  },
  {
    id:             "ag-pricing-advisor",
    nombre:         "Pricing Advisor",
    slug:           "pricing-advisor",
    role:           "INTERNAL",
    autonomy:       "SUGGEST",
    default_model:  "claude-sonnet-4-6",
    is_global:      false,
    is_active:      true,
    description:    "Resuelve precio cliente (waterfall) y señala desviaciones ≥2% respecto al pricing interno.",
    created_at:     "2026-02-28T10:05:00Z",
  },
  {
    id:             "ag-portal-chat",
    nombre:         "Portal Chat",
    slug:           "portal-chat",
    role:           "CHAT",
    autonomy:       "READ_ONLY",
    default_model:  "claude-haiku-4-5-20251001",
    is_global:      true,
    is_active:      true,
    description:    "Asistente conversacional del Portal B2B. Responde preguntas sobre el estado de órdenes y documentos usando datos scopeados al client_id.",
    created_at:     "2026-03-05T16:40:00Z",
  },
  {
    id:             "ag-customs",
    nombre:         "Customs Watcher",
    slug:           "customs-watcher",
    role:           "TOOL",
    autonomy:       "READ_ONLY",
    default_model:  "claude-sonnet-4-6",
    is_global:      true,
    is_active:      true,
    description:    "Monitorea eventos de aduanas (BL/AWB) para expedientes en tránsito. Alerta si detecta retrasos >48h vs ETA.",
    created_at:     "2026-03-18T08:12:00Z",
  },
  {
    id:             "ag-triage",
    nombre:         "Expediente Triage",
    slug:           "expediente-triage",
    role:           "INTERNAL",
    autonomy:       "AUTO",
    default_model:  "claude-haiku-4-5-20251001",
    is_global:      true,
    is_active:      true,
    description:    "Clasifica expedientes entrantes del Portal B2B (PENDING_CEO_REVIEW) y asigna prioridad + responsable en base a monto y contrato.",
    created_at:     "2026-04-02T11:20:00Z",
  },
  {
    id:             "ag-sap",
    nombre:         "SAP Confirmer",
    slug:           "sap-confirmer",
    role:           "CONNECTOR",
    autonomy:       "EXECUTE",
    default_model:  "claude-sonnet-4-6",
    is_global:      false,
    is_active:      false,
    description:    "Integra con sistema SAP de la fábrica para confirmar órdenes (C5). Actualmente deshabilitado mientras se valida el endpoint de fábrica.",
    created_at:     "2026-01-20T13:50:00Z",
  },
];

export const AI_SKILLS_DEMO = [
  {
    id:          "sk-search-expedientes",
    nombre:      "Buscar expedientes",
    slug:        "search-expedientes",
    scope:       "READ",
    autonomy:    "READ_ONLY",
    tags:        ["expedientes", "búsqueda", "listado"],
    is_global:   true,
    is_active:   true,
    description: "Query contra pgvector + SQL para encontrar expedientes por código, cliente, SAP o rango de fechas.",
  },
  {
    id:          "sk-send-collection",
    nombre:      "Enviar recordatorio de cobranza",
    slug:        "send-collection-email",
    scope:       "WRITE",
    autonomy:    "EXECUTE",
    tags:        ["cobranza", "email", "C1-C2-C3"],
    is_global:   true,
    is_active:   true,
    description: "Dispara un email usando plantilla PUBLISHED + log en notifications.notification_log (idempotente por token).",
  },
  {
    id:          "sk-parse-oc",
    nombre:      "Parsear OC del cliente",
    slug:        "parse-oc-document",
    scope:       "READ",
    autonomy:    "EXECUTE",
    tags:        ["ocr", "wizard", "pdf", "xlsx"],
    is_global:   true,
    is_active:   true,
    description: "Lee el archivo subido por el admin o el cliente en el Wizard y devuelve cliente, marca, PO, líneas.",
  },
  {
    id:          "sk-resolve-price",
    nombre:      "Resolver precio cliente",
    slug:        "resolve-client-price",
    scope:       "READ",
    autonomy:    "READ_ONLY",
    tags:        ["pricing", "comercial", "waterfall"],
    is_global:   true,
    is_active:   true,
    description: "Corre el waterfall de apps.commercial.resolve_client_price (PriceListVersion > GradeItem > ClientAssignment).",
  },
  {
    id:          "sk-send-email",
    nombre:      "Enviar email (Mailgun)",
    slug:        "send-email",
    scope:       "EXTERNAL",
    autonomy:    "EXECUTE",
    tags:        ["email", "external", "mailgun"],
    is_global:   true,
    is_active:   true,
    description: "Wrapper sobre Mailgun API + logging en email_queue_log. Respeta rate limits (5000/h).",
  },
  {
    id:          "sk-archive-expediente",
    nombre:      "Archivar expediente",
    slug:        "archive-expediente",
    scope:       "DESTRUCTIVE",
    autonomy:    "SUGGEST",
    tags:        ["expedientes", "destructive", "CEO-only"],
    is_global:   true,
    is_active:   true,
    description: "Marca is_active=false en el expediente. Requiere confirmación CEO (nunca auto).",
  },
  {
    id:          "sk-fetch-sap",
    nombre:      "Consultar SAP",
    slug:        "fetch-sap-status",
    scope:       "EXTERNAL",
    autonomy:    "READ_ONLY",
    tags:        ["sap", "fábrica", "tracking"],
    is_global:   false,
    is_active:   true,
    description: "Consulta el estado de producción de una línea en el sistema SAP de la fábrica (solo lectura, no escribe).",
  },
  {
    id:          "sk-generate-proforma",
    nombre:      "Generar proforma MWT",
    slug:        "generate-proforma",
    scope:       "WRITE",
    autonomy:    "EXECUTE",
    tags:        ["proforma", "art-02", "comercial"],
    is_global:   true,
    is_active:   true,
    description: "Renderiza ART-02 Proforma MWT desde un expediente y lo sube a MinIO + Paperless.",
  },
  {
    id:          "sk-notify-portal",
    nombre:      "Notificar al Portal B2B",
    slug:        "notify-client-portal",
    scope:       "EXTERNAL",
    autonomy:    "EXECUTE",
    tags:        ["portal", "notificación", "cliente"],
    is_global:   true,
    is_active:   true,
    description: "Envía un push notification al Portal del cliente cuando un expediente cambia de fase.",
  },
];

export const AI_INSTRUCTIONS_DEMO = [
  {
    id:           "in-visibilidad",
    titulo:       "Política de visibilidad MWT (POL_VISIBILIDAD)",
    slug:         "pol-visibilidad",
    priority:     100,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "NUNCA expongas al cliente B2B: costo_estandar, precio_mwt, projected_margin, real_margin, commission_pct, supplier_id, modo_operacion interno, available_transitions. El cliente solo ve: precio de venta resuelto, estado público traducido, líneas y documentos whitelisted.",
  },
  {
    id:           "in-ceo-only",
    titulo:       "Restricciones CEO-ONLY",
    slug:         "ceo-only-gates",
    priority:     100,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "Los endpoints de gobernanza (eliminar expedientes, cambiar modo COMISION/FULL, ajustar pricing interno, aprobar descuentos >5%) requieren role=admin o role=superadmin. Para CLIENT_* devuelve 403 explícito con audit log.",
  },
  {
    id:           "in-no-costos",
    titulo:       "Nunca exponer costos operativos",
    slug:         "no-cost-leakage",
    priority:     100,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "En cualquier respuesta al Portal B2B o al chat con role=cliente, jamás mezcles cost_usd, margen_usd, precio_mwt ni información de fábrica. Si el cliente pregunta directamente por costos, responde: 'Esa información no está disponible desde el Portal; consulta con tu Account Manager.'",
  },
  {
    id:           "in-tono-b2b",
    titulo:       "Tono profesional B2B (Rana Walk)",
    slug:         "tono-b2b-ranawalk",
    priority:     80,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "Comunícate en un español formal pero cálido, típico de la industria de calzado de seguridad industrial. Usa 'tú' con clientes de México/Colombia/Perú; 'usted' con clientes corporativos argentinos. Nunca uses jerga técnica interna (ART-04, C5, phase_signal) sin explicarla.",
  },
  {
    id:           "in-email-format",
    titulo:       "Formato de emails Rana Walk",
    slug:         "email-format-ranawalk",
    priority:     70,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "Todos los emails al cliente B2B usan: (1) saludo con nombre del contacto comercial; (2) referencia explícita al PO Number y SKU relevante; (3) cierre con firma de MWT.ONE y link al Portal; (4) asunto en formato [Rana Walk] {acción} · {PO Number}. NUNCA menciones el nombre de la fábrica.",
  },
  {
    id:           "in-escalada",
    titulo:       "Protocolo de escalada comercial",
    slug:         "escalada-comercial",
    priority:     60,
    is_global:    true,
    auto_inject:  false,
    is_active:    true,
    body:         "Si el cliente solicita: (a) descuento >5%, (b) plazo de crédito >90 días, (c) cambio de incoterm post-confirmación SAP — crea un ticket AI_HUB_ESCALATION con prioridad=HIGH y notifica al Account Manager + CEO por Slack. No respondas al cliente hasta recibir aprobación.",
  },
  {
    id:           "in-idempotencia",
    titulo:       "Respetar idempotence_token",
    slug:         "idempotence-first",
    priority:     90,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "Toda operación de escritura contra el backend MWT debe incluir `idempotence_token` generado por el agente (UUID v4). Si el backend responde 200 + X-Idempotent-Replay:true, NO asumas error — significa que la operación ya se ejecutó previamente.",
  },
  {
    id:           "in-regla-oro-uuid",
    titulo:       "Regla de Oro: UUIDs como strings",
    slug:         "uuid-as-string",
    priority:     90,
    is_global:    true,
    auto_inject:  true,
    is_active:    true,
    body:         "Los campos `*_id` (client_id, brand_id, oc_id, expediente_id, linea_id, producto_id) siempre son strings de UUID v4. Nunca asumas integer IDs ni ForeignKeys físicas. Si necesitas joinear, hacelo por UUID string match.",
  },
];


// ---------------------------------------------------------------------
// Helpers de filtrado (replican comportamiento del ViewSet DRF)
// ---------------------------------------------------------------------
function orderBy(items, orderingParam) {
  if (!orderingParam) return items;
  const desc = orderingParam.startsWith("-");
  const field = desc ? orderingParam.slice(1) : orderingParam;
  const sorted = [...items].sort((a, b) => {
    const va = a[field];
    const vb = b[field];
    if (va === vb) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  });
  return desc ? sorted.reverse() : sorted;
}


/** /api/ai/agents/ — list endpoint mock */
export function aiAgentsListMock({ ordering = "nombre", is_active } = {}) {
  let items = AI_AGENTS_DEMO.slice();
  if (is_active === "true" || is_active === true)   items = items.filter((a) => a.is_active);
  if (is_active === "false" || is_active === false) items = items.filter((a) => !a.is_active);
  return orderBy(items, ordering);
}

/** /api/ai/skills/ — list endpoint mock */
export function aiSkillsListMock({ ordering = "nombre", is_active } = {}) {
  let items = AI_SKILLS_DEMO.slice();
  if (is_active === "true" || is_active === true)   items = items.filter((a) => a.is_active);
  if (is_active === "false" || is_active === false) items = items.filter((a) => !a.is_active);
  return orderBy(items, ordering);
}

/** /api/ai/instructions/ — list endpoint mock */
export function aiInstructionsListMock({ ordering = "-priority", is_active } = {}) {
  let items = AI_INSTRUCTIONS_DEMO.slice();
  if (is_active === "true" || is_active === true)   items = items.filter((a) => a.is_active);
  if (is_active === "false" || is_active === false) items = items.filter((a) => !a.is_active);
  return orderBy(items, ordering);
}

/** Detail (GET /api/ai/agents/<id>/) — devuelve null si no existe */
export function aiAgentDetailMock(id) {
  return AI_AGENTS_DEMO.find((a) => a.id === id) || null;
}
export function aiSkillDetailMock(id) {
  return AI_SKILLS_DEMO.find((a) => a.id === id) || null;
}
export function aiInstructionDetailMock(id) {
  return AI_INSTRUCTIONS_DEMO.find((a) => a.id === id) || null;
}
