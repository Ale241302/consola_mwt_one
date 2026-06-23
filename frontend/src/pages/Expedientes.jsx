// =====================================================================
// MWT.ONE · Expedientes.jsx
//
// Dos experiencias en un solo archivo, gobernadas por RoleContext:
//
//   ADMIN (staff MWT)  → Dashboard CEO global:
//       · KPIs en vivo (rentabilidad, cuentas por cobrar/pagar, crédito)
//       · Tiempos operativos vs baseline + calidad del proceso
//       · Tabla completa con vistas Financial / Ops / Fleet
//       · Fila expandida con costos internos + deferred pricing
//       · Botón "+ Crear Expediente"
//
//   CLIENT (Portal B2B) → Vista "Mis Pedidos":
//       · Título cambia a "Mis Pedidos"
//       · Sin KPIs CEO, sin columnas de margen, sin costos internos
//       · Sin botón "+ Crear" (ART-01 es CEO-ONLY)
//       · Solo columnas útiles para el cliente: ref, estado, destino, ETA
//       · Si show_deferred_to_client=true → muestra "Precio acordado: $X"
//         como lectura, NUNCA como "deferred" ni editable
//
// La seguridad real vive en el backend (apps.portal + ClientScopedManager).
// Este componente solo oculta UI para dar la experiencia correcta.
// =====================================================================
import React, { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  StatusBadge, CreditDot, CountryFlag,
} from "../components/ui/primitives.jsx";
import {
  IconDownload, IconPlus, IconSearch, IconChevDown, IconChevRight,
  IconCreditCard, IconDollar, IconFolder, IconCheck, IconTrash, IconX,
} from "../lib/icons.jsx";
import {
  EXPEDIENTES as MOCK_EXPEDIENTES,
  STATES, PHASE_BASELINE,
  OCS as MOCK_OCS,
} from "../data/mockData.js";
import { expedientesApi, ocsApi, clientesApi, marcasApi, lineasApi, productosApi } from "../lib/api.js";
import { readCache, writeCache } from "../lib/swrCache.js";
import { TableSkeletonRows } from "../components/ui/Skeleton.jsx";
// Sprint 2026-05-20 · Fusión Pipeline → Expedientes.
// Tabla/Kanban toggle reemplaza Vista Financial/Ops/Fleet. El render del
// Kanban delega 100% al ScreenPipeline (mismo fetch, mismo UX, sin reescritura).
import ScreenPipeline from "./Pipeline.jsx";
import { useRole } from "../context/RoleContext.jsx";
// Sprint 2026-05-17 · Celda REF con chips role-aware (proforma / OC / SAP).
import RefCell from "../components/expedientes/RefCell.jsx";
// Sprint 2026-06-04 · Export de expedientes (modal + .html resumen SKU/talla/qty).
import ExportExpedientesModal from "../components/expedientes/ExportExpedientesModal.jsx";
import { runExpedienteExport } from "../lib/expedienteExport.js";
// Sprint 2026-06-11 · promedios por fase de UN cliente (phase-stats?client=).
import { loadClientStats } from "../lib/cronogramaData.js";

// ── Mapeo backend → UI ──────── (Sprint 2026-05-03 v4)
function mapExpedienteFromApi(r) {
  return {
    // id legible para navegacion y React keys (codigo si existe, sino UUID).
    // uuid es el identificador real para llamadas API DELETE/PATCH.
    id:   r.codigo || r.id,
    uuid: r.id || null,
    ref:  r.codigo || '',
    oc_client: '',                     // se resuelve desde la OC cuando exista
    oc_id: r.oc_id || null,
    sap:  r.sap || null,
    // Sprint 2026-05-10 · proforma_codigo viene del backend list
    // serializer — es el código que tipea el admin al subir el PDF en el
    // modal "Agregar documento" (kind=PROFORMA). Se muestra debajo del
    // EXP code en el listado.
    proforma: r.proforma_codigo || '',
    // Sprint 2026-05-17 · arrays role-aware servidos por el backend.
    //   ADMIN/CEO → proforma_codigos[] y sap_codigos[] llegan poblados.
    //   CLIENT_*  → el serializer devuelve [] (los datos sensibles ni
    //               siquiera viajan al cliente — defense in depth).
    //   oc_codigos[] viaja a todos los roles (es la PO del cliente).
    proforma_codigos: Array.isArray(r.proforma_codigos) ? r.proforma_codigos : [],
    oc_codigos:       Array.isArray(r.oc_codigos)       ? r.oc_codigos       : [],
    sap_codigos:      Array.isArray(r.sap_codigos)      ? r.sap_codigos      : [],
    client: '', client_country: '', client_id: r.client_id || null,
    brand:  '', brand_id:  r.brand_id  || null,
    status: r.estado || 'REGISTRO',
    credit_days:  Number(r.credit_days) || 0,
    credit_band:  r.credit_band || 'GREEN',
    is_blocked:   !!r.is_blocked,
    block_reason: r.block_reason || null,
    block_cause:  r.block_cause || null,
    factory_delay: !!r.factory_delay,
    artifacts_done:  r.artifacts_done || 0,
    artifacts_total: r.artifacts_total || 6,
    op_mode: r.modo_operacion === 'COMISION' ? 'B' : 'C',
    total_cost:      Number(r.total_cost) || 0,
    total_invoiced:  Number(r.total_invoiced) || 0,
    total_paid:      Number(r.total_paid) || 0,
    balance:         Number(r.balance) || 0,
    projected_margin: Number(r.projected_margin) || 0,
    real_margin:      Number(r.real_margin) || 0,
    margin_drift:     Number(r.margin_drift) || 0,
    commission_pct:   r.commission_pct != null ? Number(r.commission_pct) : null,
    dai_pct:   Number(r.dai_pct) || 0,
    iva_pct:   Number(r.iva_pct) || 0,
    dai_amount:    Number(r.dai_amount) || 0,
    iva_amount:    Number(r.iva_amount) || 0,
    logistic_cost: Number(r.logistic_cost) || 0,
    base_price:    Number(r.base_price) || 0,
    deferred_total_price:    Number(r.deferred_total_price) || 0,
    show_deferred_to_client: !!r.show_deferred_to_client,
    cost_corrections:        !!r.cost_corrections,
    proforma_reviewed:       !!r.proforma_reviewed,
    pg_verified: Number(r.pg_verified) || 0,
    pg_released: Number(r.pg_released) || 0,
    pg_pending:  Number(r.pg_pending)  || 0,
    pg_rejected: Number(r.pg_rejected) || 0,
    time_in_phase: r.time_in_phase || 0,
    baseline_days: r.baseline_days || 10,
    phase_ratio:   Number(r.phase_ratio) || 0,
    phase_signal:  r.phase_signal || 'green',
    currency:      r.moneda || 'USD',
    mode:          r.incoterm || '—',
    // Sprint 2026-06-10 — SIN default 'SEA': si la columna está vacía el
    // expediente NO tiene método de envío todavía y el Cronograma del
    // export asume Aéreo para la proyección (antes el default fantasma
    // los bucketizaba como Marítimo → tránsito 35d en vez de ~3.7d).
    freight_mode:  r.freight_mode || '',
    dispatch_mode: r.dispatch_mode || 'FCL',
    origin:        r.origin || '',
    destination:   r.destination || '',
    shipment_date: r.shipment_date || null,
    eta:           r.eta || null,
    created_at:    r.created_at || null,
    updated_at:    r.updated_at || null,
    last_event_at: r.last_event_at || null,
    product_count:   r.product_count   || 0,
    container_count: r.container_count || 0,
    notes: r.notas || '',
    // Sprint 2026-05-01: order_value se hidrata en el load() a partir
    // de las lineas activas + catalogo de productos. Sirve como fallback
    // de receivables cuando total_invoiced viene en 0 (caso comun en
    // expedientes recien creados sin facturacion). NO calculamos un
    // estimado de payables — ese KPI muestra solo costos reales.
    order_value:  0,
    // Sprint 2026-06-11 · fusión visual (E3): los miembros de un grupo
    // comparten fusion_id y el listado los pinta como UNA fila padre
    // expandible. Cada miembro conserva su OC/SAP/proforma/documentos.
    fusion_id:    r.fusion_id || null,
    fusion_label: r.fusion_label || '',
    _raw:  r,
  };
}

export default function ScreenExpedientes() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  // Viewport efectivo (ADMIN | CLIENT). Re-renderiza cuando el CEO usa
  // el toggle "Tweaks → Viewport" para simular al cliente.
  const { isAdmin, isClient, can, user } = useRole();

  // ── Data desde API (con caché stale-while-revalidate) ────────
  // Auditoría de carga 2026-06-14: sembramos el último snapshot conocido
  // para pintar la tabla AL INSTANTE en vez de dejarla en blanco 1-2 s.
  const cacheKey = `expedientes:${user?.id || "me"}:${isClient ? "c" : "a"}`;
  const _seed = readCache(cacheKey);
  const [apiExpedientes, setApiExpedientes] = useState(() => _seed?.exp || []);
  const [apiOcs,         setApiOcs]         = useState(() => _seed?.ocs || []);
  const [loading,        setLoading]        = useState(() => !_seed);

  const load = useCallback(async (signal) => {
    // Spinner solo si no hay snapshot cacheado que mostrar mientras revalida.
    setLoading(!readCache(cacheKey));
    try {
      // ── Sprint 2026-06-14: matamos el waterfall. `lineas` y `productos`
      // son listados independientes del resultado de expedientes, así que
      // viajan en el MISMO Promise.all (4 en paralelo) en lugar de en serie.
      // Solo el enriquecimiento de clientes espera (depende de los client_id).
      const [expRaw, ocRaw, lnRaw, prodRaw] = await Promise.all([
        expedientesApi.list(undefined, { signal }).catch(() => []),
        ocsApi.list(undefined, { signal }).catch(() => []),
        lineasApi.list({ is_active: true }, { signal }).catch(() => []),
        productosApi.list(undefined, { signal }).catch(() => []),
      ]);
      const expItems = Array.isArray(expRaw) ? expRaw : (expRaw?.results || []);
      const ocItems  = Array.isArray(ocRaw)  ? ocRaw  : (ocRaw?.results  || []);
      const mapped   = expItems.map(mapExpedienteFromApi);

      // Lineas activas + catalogo de productos para computar order_value por
      // expediente (alimenta receivables cuando total_invoiced = 0).
      const lineasArr = Array.isArray(lnRaw) ? lnRaw : (lnRaw?.results || []);

      // Productos para resolver precio cuando linea.unit_price = 0.
      // El ProductoListSerializer ya incluye `precio_lista` y `especificaciones`.
      const productMap = {};
      {
        const arr = Array.isArray(prodRaw) ? prodRaw : (prodRaw?.results || []);
        for (const p of arr) {
          if (p?.id) productMap[p.id] = p;
        }
      }

      // ── Enriquecimiento batch: hidratar nombre de cliente y días
      // de crédito desde /api/clientes (un fetch por client_id único).
      // Sin esto el listado mostraba "🌐" (CountryFlag con país vacío)
      // y "0d" para los días de crédito porque expedientes.expediente
      // no guarda esos campos — viven en clientes.cliente.
      const uniqueClientIds = Array.from(new Set(
        mapped.map(e => e.client_id).filter(Boolean)
      ));
      let clientMap = {};
      if (uniqueClientIds.length > 0) {
        try {
          const cliResults = await Promise.all(
            uniqueClientIds.map(id => clientesApi.get(id, { signal }).catch(() => null))
          );
          clientMap = cliResults.reduce((acc, c) => {
            if (c?.id) acc[c.id] = c;
            return acc;
          }, {});
        } catch { clientMap = {}; }
      }
      const enriched = mapped.map(e => {
        const cli = clientMap[e.client_id];
        // ── Calcular order_value sumando lineas de este expediente.
        //    Para cada linea: usar unit_price si > 0, sino caer al
        //    catalogo via especificaciones.client_prices[client_id]
        //    o precio_lista. Mismo enfoque que OCDetail.
        const expLines = lineasArr.filter(
          l => l.expediente_id === e._raw.id
        );
        let orderValue = 0;
        for (const ln of expLines) {
          const qty = Number(ln.qty || 0);
          let unit  = Number(ln.unit_price || 0);
          if (unit === 0 && ln.producto_id) {
            const p = productMap[ln.producto_id];
            if (p) {
              const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
              const override = Number(cliMap[e.client_id] || 0);
              const lista    = Number(p.precio_lista || 0);
              unit = override > 0 ? override : lista;
            }
          }
          orderValue += qty * unit;
        }
        const enrichedExp = {
          ...e,
          order_value: orderValue,
        };
        if (!cli) return enrichedExp;
        return {
          ...enrichedExp,
          client:         cli.razon_social || cli.nombre || cli.codigo || e.client,
          client_country: cli.pais_iso2 || e.client_country,
          credit_days:    Number(
            cli.dias_credito ?? cli.credit_days ?? cli.credito_dias ?? e.credit_days ?? 0
          ),
        };
      });

      if (signal?.aborted) return;
      writeCache(cacheKey, { exp: enriched, ocs: ocItems });
      setApiExpedientes(enriched);
      setApiOcs(ocItems);
    } catch (e) {
      if (e?.name === "AbortError" || signal?.aborted) return;
      // No pisamos con [] si ya teníamos datos cacheados en pantalla.
      if (!readCache(cacheKey)) {
        setApiExpedientes([]);
        setApiOcs([]);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cacheKey]);

  // Sprint 2026-06-13 · AbortController: cancela los fetches (lineas/productos/
  // N·clientes) al navegar fuera, liberando el pool de conexiones.
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Sprint 2026-05-10 · CEO ordenó eliminar TODA fallback a mock data.
  // Si el backend devuelve [] mostramos estado vacío real, no demo.
  const EXPEDIENTES = apiExpedientes;
  const OCS         = apiOcs;

  const onNavigate = (key) => {
    const map = { wizard: '/wizard' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);
  // Sprint 2026-06-13 · #expedientes por OC. Si una OC tiene >1 (split),
  // cada fila abre SU expediente (/exp/<id>) en vez de la vista OC común.
  const ocExpCount = {};
  (apiExpedientes || []).forEach((x) => {
    const k = x.oc_id || x._raw?.oc_id;
    if (k) ocExpCount[k] = (ocExpCount[k] || 0) + 1;
  });
  const onOpenExpediente = (id) => {
    // 1) Buscar el expediente en la lista para leer su oc_id directamente.
    //    El backend devuelve oc_id como UUID en expedientes.expediente; los
    //    mocks lo emiten también. Si no hay oc_id, intentamos por compat
    //    con el shape viejo (mocks) donde la OC tenía un array `expedientes`.
    const exp = EXPEDIENTES.find(e => e.id === id);
    const ocId = exp?.oc_id
              || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(id))?.id;
    if (ocId) {
      navigate(`/expedientes/${ocId}/exp/${id}`);
      return;
    }
    // 3) Sin oc_id (expediente sin OC vinculada — caso raro): vamos al
    //    detalle directamente vía la ruta sin OC. ExpedienteDetail tolera
    //    /expedientes/none/exp/<id> y carga por el id propio.
    navigate(`/expedientes/none/exp/${id}`);
  };

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL'); // ALL | green | amber | red
  const [alertFilter, setAlertFilter] = useState('ALL');   // ALL | blocked | alerts
  const [view, setView] = useState('financial');           // financial | ops | fleet (legacy — sin toggle UI)
  // Sprint 2026-05-20 · Toggle nuevo: Tabla vs Kanban.
  // El antiguo selector Financial/Ops/Fleet se ocultó por simplificación de UX.
  const [viewMode, setViewMode] = useState('table');       // 'table' | 'kanban'
  const [expandedId, setExpandedId] = useState(null);
  // En CLIENT forzamos la vista "fleet" (origen→destino, modo, ETA, total
  // facturado como "precio") y escondemos el selector. Esa vista es la más
  // limpia y útil para el cliente, sin columnas internas de margen.
  const effectiveView = isClient ? 'fleet' : view;
  // In-memory edits of deferred price / visibility toggle
  const [deferredEdits, setDeferredEdits] = useState({});

  // ── Bulk delete (sprint 2026-05-01) ────────────────────────
  // selected: Set de UUIDs (no codigos) para llamar al API DELETE.
  // deleting: bloquea botones mientras corren las llamadas en serie.
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  // Sprint 2026-05-03 v3 · modal de confirmación (reemplaza window.confirm).
  // pendingDelete: array de uuids a borrar cuando el user confirme; null = oculto.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);

  // ── Fusión visual (sprint 2026-06-11) ──────────────────────
  // fusionOpen: Set de fusion_ids expandidos (colapsado por defecto: el
  // grupo se ve como UNA sola fila). fusing bloquea botones durante el POST.
  const [fusionOpen, setFusionOpen] = useState(() => new Set());
  const [fusing, setFusing] = useState(false);
  const [fusionErr, setFusionErr] = useState(null);

  // ── Export (sprint 2026-06-04) ─────────────────────────────
  // Modal con filtros NO obligatorios (cliente / estado / expediente) +
  // audiencia (cliente vs admin) → genera un .html resumen SKU/talla/qty.
  const [exportOpen, setExportOpen]   = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [exportErr, setExportErr]     = useState(null);
  const [clientOpts, setClientOpts]   = useState([]); // [{id, name}]
  // Sprint 2026-06-22 · catálogo de marcas para el filtro del toolbar
  // (antes venía de mockData.BRANDS). Visible para todos los roles.
  const [brandOpts, setBrandOpts]     = useState([]); // [{id, name}]

  // Catálogo de clientes para el selector del modal y el filtro del toolbar
  // (nombre legible). El filtro de clientes del toolbar es CEO-ONLY (R3),
  // pero el modal de export sí lo usa en ambos roles.
  useEffect(() => {
    let alive = true;
    clientesApi.list()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        setClientOpts(arr.map((c) => ({
          id: c.id,
          name: c.razon_social || c.nombre_comercial || c.name || c.nombre || c.id,
        })));
      })
      .catch(() => { /* degradación: selector cliente queda en "Todos" */ });
    return () => { alive = false; };
  }, []);

  // Catálogo de marcas (/api/marcas) para el filtro del toolbar.
  // brands.marca expone `nombre`; degradamos a "Todas las marcas" si falla.
  useEffect(() => {
    let alive = true;
    marcasApi.list()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        setBrandOpts(arr.map((b) => ({
          id: b.id,
          name: b.nombre || b.name || b.codigo || b.id,
        })));
      })
      .catch(() => { /* degradación: filtro marca queda en "Todas" */ });
    return () => { alive = false; };
  }, []);

  // ── Tiempos operativos REALES (Sprint 2026-06-11 · CEO) ────────────
  // GET /expedientes/phase-stats/ SIN cliente = promedio GENERAL de días
  // por fase, calculado del historial completo (EventLog + overrides
  // manuales), ponderado entre métodos de envío. Antes la card usaba el
  // time_in_phase local (casi siempre 0) — "no estaba conectada a nada".
  const [opStats, setOpStats] = useState(null);
  useEffect(() => {
    let alive = true;
    // Sprint 2026-06-11 rev2 · CLIENTE: promedios de SUS clientes
    // asignados (un fetch ?client= por legal_entity y merge ponderado).
    // ADMIN/CEO: promedio GENERAL (sin filtro).
    const collect = (isClient && Array.isArray(user?.legal_entity_ids) && user.legal_entity_ids.length)
      ? Promise.all(user.legal_entity_ids.map((cid) => loadClientStats(cid)))
      : expedientesApi.action('phase-stats').then((r) => [(r && r.phase_stats) || {}]);
    collect
      .then((list) => {
        if (!alive) return;
        const all = (list || []).filter(Boolean);
        const mergeKeys = (pred) => {
          const acc = {};
          all.forEach((buckets) => {
            Object.keys(buckets).filter(pred).forEach((k) => {
              Object.entries(buckets[k] || {}).forEach(([fase, v]) => {
                if (!v || typeof v.avg !== 'number') return;
                const a = acc[fase] || { sum: 0, n: 0 };
                a.sum += v.avg * (v.n || 1);
                a.n += (v.n || 1);
                acc[fase] = a;
              });
            });
          });
          return acc;
        };
        // Buckets con nombre (Aereo/Maritimo…) primero; los "_*" (p.ej.
        // _ALL, expedientes sin método) solo rellenan fases faltantes.
        const named = mergeKeys((k) => !k.startsWith('_'));
        const under = mergeKeys((k) => k.startsWith('_'));
        const out = {};
        const src = { ...under, ...named };
        Object.entries(src).forEach(([fase, a]) => {
          if (a.n > 0) out[fase] = { avg: a.sum / a.n, n: a.n };
        });
        setOpStats(out);
      })
      .catch(() => { /* la card cae al cálculo local */ });
    return () => { alive = false; };
  }, [isClient, user]);

  // Sprint 2026-06-10 — el "reporte" ya no genera un .html: abre el
  // Cronograma interactivo (/cronograma) en una pestaña nueva con los
  // filtros del modal como query params.
  const handleExportConfirm = useCallback((opts) => {
    setExportErr(null);
    const p = new URLSearchParams();
    if (opts.audience === "CLIENT") p.set("aud", "CLIENT");
    if (opts.expedienteUuid) {
      p.set("exp", opts.expedienteUuid);
    } else {
      if (opts.clienteId && opts.clienteId !== "ALL") p.set("cliente", opts.clienteId);
      if (opts.estado && opts.estado !== "ALL") p.set("estado", opts.estado);
    }
    window.open(`/cronograma${p.toString() ? "?" + p.toString() : ""}`, "_blank", "noopener");
    setExportOpen(false);
  }, []);

  const toggleOne = (uuid) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  // Sprint 2026-05-03 v3 · `handleBulkDelete` ahora SOLO abre el modal.
  // El borrado real corre en `confirmBulkDelete` cuando el user pulsa OK.
  const handleBulkDelete = (ids) => {
    if (!ids || ids.length === 0 || deleting) return;
    setDeleteErr(null);
    setPendingDelete(Array.from(ids));
  };

  const confirmBulkDelete = async () => {
    const ids = pendingDelete || [];
    if (ids.length === 0 || deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      // Llamadas en serie para no saturar el backend ni perder errores
      // individuales. Si una falla, las demás continúan; al final reload.
      const results = await Promise.allSettled(
        ids.map(id => expedientesApi.remove(id))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        const msg = failed[0].reason?.message || (lang === 'es' ? 'Error' : 'Error');
        setDeleteErr(
          (lang === 'es'
            ? `${failed.length} de ${ids.length} no se pudo eliminar. `
            : `${failed.length} of ${ids.length} could not be deleted. `) + msg
        );
        return;  // dejamos el modal abierto para que el user vea el error
      }
      clearSelection();
      setPendingDelete(null);
      await load();   // refrescar listado desde API
    } finally {
      setDeleting(false);
    }
  };

  // ── Fusionar / desfusionar (sprint 2026-06-11) ─────────────
  // Fusionar agrupa la selección bajo un fusion_id (agrupación SOLO
  // visual del listado). La etiqueta por defecto es la PO común entre
  // los miembros si existe (caso: una PO dividida en N expedientes).
  const handleFuse = async () => {
    if (selected.size < 2 || fusing || deleting) return;
    setFusing(true);
    setFusionErr(null);
    try {
      const ids = Array.from(selected);
      const members = EXPEDIENTES.filter(e => e.uuid && selected.has(e.uuid));
      const common = members.length
        ? ((members[0].oc_codigos || []).find(code =>
            members.every(m => (m.oc_codigos || []).includes(code))
          ) || null)
        : null;
      await expedientesApi.action('fusionar', null, {
        expediente_ids: ids,
        ...(common ? { label: common } : {}),
      });
      clearSelection();
      await load();   // refrescar listado desde API (cache invalidation)
    } catch (err) {
      setFusionErr(err?.message || String(err));
    } finally {
      setFusing(false);
    }
  };

  const handleUnfuse = async (fid) => {
    if (!fid || fusing) return;
    setFusing(true);
    setFusionErr(null);
    try {
      await expedientesApi.action('desfusionar', null, { fusion_id: fid });
      await load();
    } catch (err) {
      setFusionErr(err?.message || String(err));
    } finally {
      setFusing(false);
    }
  };

  // ── Global dataset: all expedientes ─────
  const filtered = useMemo(() => {
    return EXPEDIENTES.filter(e => {
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (brandFilter !== 'ALL'  && e.brand_id !== brandFilter) return false;
      if (clientFilter !== 'ALL' && e.client_id !== clientFilter) return false;
      if (signalFilter !== 'ALL' && e.phase_signal !== signalFilter) return false;
      if (alertFilter === 'blocked' && !e.is_blocked) return false;
      if (alertFilter === 'alerts') {
        const any = e.is_blocked || e.factory_delay || e.credit_days > 60;
        if (!any) return false;
      }
      if (q) {
        // Sprint 2026-05-30 (CEO) - buscar tambien en arrays role-aware
        // del backend (proforma_codigos, oc_codigos, sap_codigos). Esto
        // permite encontrar un expediente por su PO/PF/SAP del cliente
        // (ej. "504802" -> EXP-2026-0001).
        const pfs  = Array.isArray(e.proforma_codigos) ? e.proforma_codigos.join(' ') : '';
        const ocs  = Array.isArray(e.oc_codigos)       ? e.oc_codigos.join(' ')       : '';
        const saps = Array.isArray(e.sap_codigos)      ? e.sap_codigos.join(' ')      : '';
        const s = (
          (e.ref || '') + ' ' +
          (e.codigo || '') + ' ' +
          (e.oc_client || '') + ' ' +
          (e.sap || '') + ' ' +
          (e.proforma || '') + ' ' +
          (e.client || '') + ' ' +
          (e.brand || '') + ' ' +
          pfs + ' ' + ocs + ' ' + saps
        ).toLowerCase();
        // Tokens del query separados por espacio: TODOS deben matchear
        // (busqueda AND). Permite "sondel 2417" para acotar.
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        if (!tokens.every((t) => s.includes(t))) return false;
      }
      return true;
    });
  }, [q, statusFilter, brandFilter, clientFilter, signalFilter, alertFilter, EXPEDIENTES]);

  // ── Agrupación visual por fusión (sprint 2026-06-11) ───────
  // Miembros del mismo fusion_id se vuelven adyacentes (en la posición
  // del primero) bajo una fila padre sintética; colapsado por defecto.
  // Grupos con un solo miembro visible se pintan como fila normal.
  const fusionGroups = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      if (!e.fusion_id) continue;
      if (!map.has(e.fusion_id)) map.set(e.fusion_id, []);
      map.get(e.fusion_id).push(e);
    }
    return map;
  }, [filtered]);

  const displayRows = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const e of filtered) {
      const grp = e.fusion_id ? fusionGroups.get(e.fusion_id) : null;
      if (!grp || grp.length < 2) { out.push(e); continue; }
      if (seen.has(e.fusion_id)) continue;
      seen.add(e.fusion_id);
      out.push({ __fusionHeader: true, fid: e.fusion_id, members: grp });
      if (fusionOpen.has(e.fusion_id)) out.push(...grp);
    }
    return out;
  }, [filtered, fusionGroups, fusionOpen]);

  // ── CEO KPIs (live) ─────
  const kpi = useMemo(() => {
    const N = EXPEDIENTES.length || 1; // evitar div/0 en porcentajes
    const total_invoiced = EXPEDIENTES.reduce((a,e)=>a+(e.total_invoiced||0),0);
    const total_cost     = EXPEDIENTES.reduce((a,e)=>a+(e.total_cost||0),0);
    const total_paid     = EXPEDIENTES.reduce((a,e)=>a+(e.total_paid||0),0);

    // Sprint 2026-05-01: receivables/payables con fallback a order_value
    // calculado en load() (sum lineas con resolucion del catalogo) cuando
    // los campos persistidos del backend son 0.
    //   receivables = Σ max(balance, order_value − total_paid)
    //   payables    = Σ (total_cost − pg_verified − pg_released)  [solo costos reales]
    const receivables = EXPEDIENTES.reduce((a, e) => {
      const persisted = Number(e.balance || 0);
      if (persisted > 0) return a + persisted;
      const ov = Number(e.order_value || 0);
      const paid = Number(e.total_paid || 0);
      return a + Math.max(0, ov - paid);
    }, 0);
    // Pagos por salir: solo costos REALES persistidos en backend.
    // Si no hay (total_cost = 0), el KPI queda en $0. Antes habia un
    // estimado del 70% del valor del pedido pero confundia (parecia dato
    // real). El KPI vuelve a tener significado cuando AG-COSTOS empiece
    // a poblar expedientes.expediente.total_cost.
    const payables = EXPEDIENTES.reduce((a, e) => {
      const tc = Number(e.total_cost || 0);
      const pgVerif = Number(e.pg_verified || 0);
      const pgRel   = Number(e.pg_released || 0);
      return a + Math.max(0, tc - Math.min(tc, pgVerif + pgRel));
    }, 0);

    // Margenes ponderados — guard contra NaN cuando total_invoiced = 0.
    const weighted_real_margin = total_invoiced > 0
      ? EXPEDIENTES.reduce((a,e)=>a + (e.real_margin||0) * (e.total_invoiced||0), 0) / total_invoiced
      : 0;
    const weighted_proj_margin = total_invoiced > 0
      ? EXPEDIENTES.reduce((a,e)=>a + (e.projected_margin||0) * (e.total_invoiced||0), 0) / total_invoiced
      : 0;
    const drift = weighted_real_margin - weighted_proj_margin;

    // Reloj de credito — solo cuenta expedientes con credit_days > 60.
    // Si todos estan en 0 (recien creados), ambos counters quedan en 0
    // pero ya no son NaN.
    const credit_60 = EXPEDIENTES.filter(e => Number(e.credit_days||0) > 60 && Number(e.credit_days||0) <= 75).length;
    const credit_75 = EXPEDIENTES.filter(e => Number(e.credit_days||0) > 75).length;

    const docs_missing = EXPEDIENTES.filter(e => e.block_cause === 'docs').length;
    const factory_delayed = EXPEDIENTES.filter(e => e.factory_delay).length;
    const corrected = EXPEDIENTES.filter(e => e.cost_corrections).length;
    const pf_reviewed = EXPEDIENTES.filter(e => e.proforma_reviewed).length;
    const clean_pct = 1 - pf_reviewed / N;
    const corrected_pct = corrected / N;
    // Avg time per phase vs baseline
    const phase_stats = {};
    for (const s of STATES.slice(0, 6)) {
      const exps = EXPEDIENTES.filter(e => e.status === s);
      if (!exps.length) continue;
      const avg = exps.reduce((a,e)=>a+e.time_in_phase,0)/exps.length;
      phase_stats[s] = { avg, baseline: PHASE_BASELINE[s], count: exps.length };
    }
    return { total_invoiced, total_cost, total_paid, receivables, payables,
      weighted_real_margin, weighted_proj_margin, drift,
      credit_60, credit_75, docs_missing, factory_delayed,
      corrected, corrected_pct, clean_pct, pf_reviewed, phase_stats };
  }, [EXPEDIENTES]);

  // ── Títulos/subtítulos dependientes del viewport ──
  const pageTitle = isClient
    ? (tr(lang, 'my_orders') || 'Mis Pedidos')
    : tr(lang, 'expedientes');
  const pageSubtitle = isClient
    ? (lang === 'es'
        ? `${EXPEDIENTES.length} pedidos activos`
        : `${EXPEDIENTES.length} active orders`)
    // Sprint 2026-05-22 · copy honesto: el backend filtra por legal_entity_ids
    // para roles non-bypass; "globales" miente cuando el manager solo ve su pool.
    : `${tr(lang,'ceo_overview')} · ${EXPEDIENTES.length} ${lang==='es'?'expedientes':'files'}`;

  return (
    <div
      className="page"
      data-viewport={isClient ? 'CLIENT' : 'ADMIN'}
      data-screen-label={isClient ? 'Mis Pedidos' : 'Expedientes · CEO Dashboard'}
    >
      <div className="page-header">
        <div>
          {/* Micro-header "CEO Scope" SOLO para ADMIN. CLIENT no ve etiqueta interna. */}
          {isAdmin && (
            <div className="micro" style={{marginBottom:6, color:'var(--brand-accent-dark)'}}>
              {tr(lang,'ceo_scope')}
            </div>
          )}
          <h1 className="page-title">{pageTitle}</h1>
          <div className="page-subtitle">{pageSubtitle}</div>
        </div>
        <div className="flex gap-2">
          {/* Sprint 2026-06-10 — botón Exportar retirado: el reporte vive
              en /cronograma (vista React, item del sidebar). */}
          {/* "+ Crear Expediente" → capability create_expediente (CEO-ONLY).
              ART-01 se origina siempre desde MWT-Factory, nunca desde Portal B2B. */}
          {can('create_expediente') ? (
            <button className="btn btn-primary" onClick={() => onNavigate('wizard')}>
              <IconPlus size={14}/>{tr(lang,'new_expediente')}
            </button>
          ) : (
            /* Fable5-QA 2026-06-12 · Cliente B2B / usuario normal tambien
               puede iniciar una orden: va al wizard role-aware de
               /portal/nueva-oc (CLIENT -> 3 pasos via create-from-oc;
               nunca decimos "Crear expediente", jerga interna MWT). */
            <button className="btn btn-primary" onClick={() => navigate('/portal/nueva-oc')}>
              <IconPlus size={14}/>{lang==='es' ? 'Subir Orden de Compra' : 'Upload Purchase Order'}
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CEO-ONLY: KPIs de rentabilidad, tiempos operativos y calidad.
          Ocultos cuando el viewport efectivo es CLIENT.
          ══════════════════════════════════════════════════════════════════ */}
      {isAdmin && <>
      {/* ── Row 1: KPIs — auto-hide cuando el campo es 0 (Sprint 2026-05-17).
          R3: solo ADMIN renderea este bloque entero.
          R1: cero hex hardcodeados — se usan tokens MWT.
          Sin datos reales (todo 0) la grilla colapsa y no se muestran tarjetas
          vacías que generen falsa sensación de información. */}
      {(kpi.weighted_real_margin !== 0 ||
        kpi.weighted_proj_margin !== 0 ||
        kpi.receivables > 0 ||
        kpi.payables > 0 ||
        kpi.credit_60 > 0 ||
        kpi.credit_75 > 0) && (
      <div className="grid col-4 gap-3 mb-4">
        {(kpi.weighted_real_margin !== 0 || kpi.weighted_proj_margin !== 0) && (
          <div className="kpi-tile accent">
            <div className="k-label">{tr(lang,'live_profitability')}</div>
            <div className="k-value tabular-nums">{(kpi.weighted_real_margin*100).toFixed(1)}%</div>
            <div className="k-sub">
              <span className={`k-delta ${kpi.drift >= 0 ? 'up' : 'down'}`}
                    style={{color: kpi.drift >= 0 ? 'var(--success)' : 'var(--critical)'}}>
                {kpi.drift >= 0 ? '▲' : '▼'}{' '}
                <span className="tabular-nums">{(Math.abs(kpi.drift)*100).toFixed(1)}pp</span>
              </span>
              <span style={{opacity:0.7}}>
                {tr(lang,'vs_projected')}{' '}
                <span className="tabular-nums">{(kpi.weighted_proj_margin*100).toFixed(1)}%</span>
              </span>
            </div>
          </div>
        )}

        {kpi.receivables > 0 && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang,'receivables_total')}</div>
            <div className="k-value tabular-nums">{fmtMoney(kpi.receivables)}</div>
            <div className="k-sub">
              <IconCreditCard size={12}/>
              {tr(lang,'credit_clock_sub')}
            </div>
          </div>
        )}

        {kpi.payables > 0 && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang,'payables_total')}</div>
            <div className="k-value tabular-nums">{fmtMoney(kpi.payables)}</div>
            <div className="k-sub">
              <IconDollar size={12}/>
              {lang==='es' ? 'Por salir a fábricas y logística' : 'To factories & logistics'}
            </div>
          </div>
        )}

        {(kpi.credit_60 > 0 || kpi.credit_75 > 0) && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang,'credit_clock')}</div>
            <div className="k-value" style={{display:'flex',alignItems:'baseline',gap:8}}>
              <span className="tabular-nums" style={{color:'var(--warning)'}}>{kpi.credit_60}</span>
              <span className="caption" style={{color:'var(--text-tertiary)',fontSize:13}}>+</span>
              <span className="tabular-nums" style={{color:'var(--critical)'}}>{kpi.credit_75}</span>
            </div>
            <div className="k-sub">
              <span className="alert-chip amber">60d</span>
              <span className="alert-chip red">75d</span>
            </div>
          </div>
        )}
      </div>
      )}

      </>}
      {/* ── Fin bloque CEO-ONLY (Row 1) ─────────────────────────────────── */}

      {/* ── Row 2: Tiempos operativos (TODOS los roles · Sprint 2026-06-11)
          + Calidad del proceso (CEO-ONLY). El cliente ve los promedios de
          SUS clientes asignados (phase-stats?client=…). */}
      <div className="grid gap-3 mb-4" style={{gridTemplateColumns: isAdmin ? '1.5fr 1fr' : '1fr'}}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'operational_times')}</div>
              <div className="card-subtitle">{tr(lang,'avg_phase_time')} · {tr(lang,'vs_historical')}</div>
            </div>
          </div>
          <div style={{padding:'18px 22px'}}>
            <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap: 16}}>
              {STATES.slice(0,6).map(s => {
                // Sprint 2026-06-11 · promedio REAL del endpoint
                // phase-stats (general); el cálculo local queda como
                // fallback mientras carga o si el endpoint falla.
                const psLocal = kpi.phase_stats[s];
                const real = opStats ? opStats[s] : null;
                const ps = real
                  ? {
                      avg: real.avg,
                      baseline: (psLocal && psLocal.baseline) || real.avg,
                      n: real.n,
                    }
                  : psLocal;
                if (!ps) return (
                  <div key={s}>
                    <div className="micro" style={{marginBottom:6}}>{tr(lang,s)}</div>
                    <div className="caption">—</div>
                  </div>
                );
                const ratio = ps.avg / ps.baseline;
                const signal = ratio < 1.1 ? 'green' : ratio < 1.35 ? 'amber' : 'red';
                const color = signal === 'green' ? 'var(--success)' : signal === 'amber' ? 'var(--warning)' : 'var(--critical)';
                return (
                  <div key={s}>
                    <div className="micro" style={{marginBottom:8}}>{tr(lang,s)}</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                      <span style={{font:'800 22px/1 var(--font-display)', color, fontVariantNumeric:'tabular-nums'}}>{ps.avg.toFixed(0)}</span>
                      <span className="caption">{lang==='es'?'d':'d'}</span>
                    </div>
                    <div style={{height: 4, background:'var(--border)', borderRadius:2, marginTop:8, overflow:'hidden'}}>
                      <div style={{height:'100%', width: Math.min(100, ratio*60) + '%', background: color}}/>
                    </div>
                    <div className="caption" style={{marginTop:4, color:'var(--text-tertiary)'}}>
                      {lang==='es'?'hist.':'avg'} {Number(ps.baseline).toFixed(0)}d · {(ratio*100-100).toFixed(0)}%
                      {ps.n ? ` · ${ps.n} exp.` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Calidad del proceso — métricas internas, CEO-ONLY (R3). */}
        {isAdmin && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'process_quality')}</div>
              <div className="card-subtitle">{EXPEDIENTES.length} {lang==='es'?'expedientes':'files'} · {lang==='es'?'últimos 90 días':'last 90 days'}</div>
            </div>
          </div>
          <div style={{padding:'18px 22px'}}>
            <div className="metric-row">
              <span className="ml">{tr(lang,'proformas_clean')}</span>
              <span className="mv" style={{color:'var(--success)'}}>{(kpi.clean_pct*100).toFixed(0)}%</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'proformas_reviewed')}</span>
              <span className="mv">{kpi.pf_reviewed} / {EXPEDIENTES.length}</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'with_cost_correction')}</span>
              <span className="mv" style={{color: kpi.corrected_pct > 0.25 ? 'var(--warning)' : 'var(--text-primary)'}}>
                {(kpi.corrected_pct*100).toFixed(0)}% ({kpi.corrected})
              </span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'docs_missing')}</span>
              <span className="mv" style={{color: kpi.docs_missing > 0 ? 'var(--critical)' : 'var(--text-primary)'}}>{kpi.docs_missing}</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'factory_delay')}</span>
              <span className="mv" style={{color: kpi.factory_delayed > 0 ? 'var(--warning)' : 'var(--text-primary)'}}>{kpi.factory_delayed}</span>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ── Toolbar ───── */}
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1, maxWidth: 340 }}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" placeholder={tr(lang,'search_ph')} value={q} onChange={e=>setQ(e.target.value)} />
        </div>

        <div className="sep"/>

        <select className="select" style={{ width: 150 }} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">{lang==='es' ? 'Todos los estados' : 'All states'}</option>
          {STATES.slice(0,6).map(s => <option key={s} value={s}>{tr(lang,s)}</option>)}
        </select>

        {/* Sprint 2026-06-22 · Filtro de MARCAS (desde /api/marcas) visible
            para TODOS los roles — un cliente B2B también acota sus pedidos
            por marca. El catálogo se hidrata en brandOpts (no mock data). */}
        <select className="select" style={{ width: 140 }} value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}>
          <option value="ALL">{tr(lang,'all_brands')}</option>
          {brandOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {/* Filtro de CLIENTES (desde /api/clientes): CEO-ONLY (R3 ·
            POL_VISIBILIDAD). Un cliente B2B solo ve sus propios pedidos
            (backend lo fuerza vía ClientScopedManager) — no tiene sentido
            mostrarle el dropdown de "Todos los clientes". */}
        {isAdmin && (
          <select className="select" style={{ width: 170 }} value={clientFilter} onChange={e=>setClientFilter(e.target.value)}>
            <option value="ALL">{tr(lang,'all_clients')}</option>
            {clientOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div style={{ marginLeft:'auto' }}/>

        {/* Sprint 2026-05-20 · Toggle Tabla / Kanban.
            Reemplaza el antiguo Financial/Ops/Fleet.  Visible para todos los
            roles — CLIENT también puede ver el board (Pipeline ya está
            gobernado por ClientScopedManager y se renderiza READ-ONLY).
            La vista 'financial' del state legacy queda como default para
            las columnas de la tabla (las más informativas para CEO). */}
        <div className="ceo-chip-group">
          <button data-active={viewMode==='table'}  onClick={()=>setViewMode('table')}>
            {lang === 'es' ? 'Tabla' : 'Table'}
          </button>
          <button data-active={viewMode==='kanban'} onClick={()=>setViewMode('kanban')}>
            Kanban
          </button>
        </div>
      </div>

      {/* ── Bulk action bar (CEO-ONLY) ───── */}
      {isAdmin && selected.size > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 16px', marginBottom: 10,
            background: 'var(--brand-primary)',
            color: '#fff',
            borderRadius: 10,
            boxShadow: '0 2px 8px -2px rgba(11,30,58,0.2)',
          }}
        >
          <IconCheck size={14}/>
          <span style={{ fontWeight: 600, fontSize: 13 }} className="tabular">
            {lang === 'es'
              ? `${selected.size} seleccionado${selected.size > 1 ? 's' : ''}`
              : `${selected.size} selected`}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={deleting}
            style={{
              background: 'transparent', border: 0, color: '#fff',
              opacity: 0.85, fontSize: 12, cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}
          >
            {lang === 'es' ? 'Limpiar' : 'Clear'}
          </button>
          {fusionErr && (
            <span style={{ fontSize: 12, opacity: 0.9 }}>{fusionErr}</span>
          )}
          <div style={{ marginLeft: 'auto' }}/>
          {/* Sprint 2026-06-11 · Fusionar selección (agrupación visual).
              Requiere ≥2 expedientes; cada miembro conserva su OC, SAP,
              proforma y documentos. */}
          {selected.size >= 2 && (
            <button
              type="button"
              onClick={handleFuse}
              disabled={fusing || deleting}
              className="btn btn-sm"
              style={{
                background: 'var(--brand-accent)',
                color: '#fff', border: 0, fontWeight: 600,
                padding: '6px 14px', borderRadius: 6,
                opacity: fusing ? 0.6 : 1,
                cursor: fusing ? 'not-allowed' : 'pointer',
              }}
            >
              {fusing
                ? (lang === 'es' ? 'Fusionando…' : 'Merging…')
                : (lang === 'es'
                    ? `Fusionar ${selected.size}`
                    : `Merge ${selected.size}`)}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleBulkDelete(Array.from(selected))}
            disabled={deleting}
            className="btn btn-sm"
            style={{
              background: 'var(--critical, #DC2626)',
              color: '#fff', border: 0, fontWeight: 600,
              padding: '6px 14px', borderRadius: 6,
              opacity: deleting ? 0.6 : 1,
              cursor: deleting ? 'not-allowed' : 'pointer',
            }}
          >
            <IconTrash size={12}/>
            {deleting
              ? (lang === 'es' ? 'Eliminando…' : 'Deleting…')
              : (lang === 'es'
                  ? `Eliminar ${selected.size}`
                  : `Delete ${selected.size}`)}
          </button>
        </div>
      )}

      {/* Sprint 2026-05-20 · Render condicional según viewMode.
          'kanban' → delegamos al ScreenPipeline existente (mismo fetch, mismo
          UX). 'table' → render tradicional de la master table. */}
      {viewMode === 'kanban' ? (
        <div style={{ marginTop: 4 }}>
          <ScreenPipeline />
        </div>
      ) : (<>
      {/* ── Master table ───── */}
      <div className="table-wrap">
        <table className="table ceo-table">
          <thead>
            <tr>
              {/* Checkbox de seleccion (CEO-ONLY) */}
              {isAdmin && (
                <th style={{width:32, textAlign:'center'}}>
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 &&
                      filtered.every(e => e.uuid && selected.has(e.uuid))
                    }
                    onChange={(ev) => {
                      ev.stopPropagation();
                      const checked = ev.target.checked;
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (checked) {
                          for (const e of filtered) {
                            if (e.uuid) next.add(e.uuid);
                          }
                        } else {
                          for (const e of filtered) {
                            if (e.uuid) next.delete(e.uuid);
                          }
                        }
                        return next;
                      });
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    title={lang === 'es' ? 'Seleccionar todos' : 'Select all'}
                    style={{ accentColor: 'var(--brand-primary)', cursor: 'pointer' }}
                  />
                </th>
              )}
              <th style={{width:38}}></th>
              <th>{tr(lang,'ref')}</th>
              <th>{tr(lang,'client')}</th>
              {/* Columna MARCA quitada — el wizard simplificado no asigna
                  marca en el create, y para el listado el cliente tiene
                  más prioridad informativa que la marca por expediente. */}
              <th>{tr(lang,'status')}</th>
              {effectiveView === 'ops' && <>
                <th style={{width:210}}>{lang==='es'?'Timeline · Semáforo':'Timeline · Signal'}</th>
                <th style={{width:90, textAlign:'right'}}>{tr(lang,'time_signal')}</th>
              </>}
              {effectiveView === 'financial' && <>
                <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'real_margin')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'credit_days')}</th>
                <th style={{width: 140}}>{tr(lang,'payments_breakdown')}</th>
              </>}
              {effectiveView === 'fleet' && <>
                {/* "Origen → Destino" y "Modo" son información operativa
                    interna de MWT (rutas / freight mode). POL_VISIBILIDAD:
                    CLIENT no ve datos logísticos de back-office. */}
                {!isClient && <th>{tr(lang,'origin')} → {tr(lang,'destination')}</th>}
                {!isClient && <th style={{textAlign:'right'}}>{tr(lang,'mode')}</th>}
                {/* "Días de crédito" es una señal interna (cuántos días lleva
                    la factura sin pagar). No mostramos esto al cliente. */}
                {isAdmin && <th style={{width:90, textAlign:'right'}}>{tr(lang,'credit_days')}</th>}
                {/* Rev 2026-05-21e · CLIENT NO ve esta columna (antes se
                    mostraba como "Precio acordado"). Staff sigue viendo
                    "Facturado". */}
                {!isClient && (
                  <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
                )}
              </>}
              {/* Columna de alertas internas (bloqueos, docs faltantes,
                  retrasos de fábrica, señales de crédito): CEO-ONLY. */}
              {isAdmin && <th style={{width:110}}>{tr(lang,'alerts_blocks')}</th>}
              <th style={{width:36}}></th>
              {isAdmin && <th style={{width:36}}></th>}
            </tr>
          </thead>
          <tbody>
            {loading && displayRows.length === 0 && (
              <TableSkeletonRows rows={8} />
            )}
            {displayRows.map(e => {
              // ── Fila padre de una fusión (sprint 2026-06-11) ──────
              // Agrupación SOLO visual: click expande/colapsa los
              // miembros (filas normales debajo). Desfusionar es CEO-only.
              if (e.__fusionHeader) {
                const open = fusionOpen.has(e.fid);
                const members = e.members;
                const label = members[0].fusion_label
                  || ((members[0].oc_codigos || []).find(c =>
                        members.every(m => (m.oc_codigos || []).includes(c)))
                  || (lang === 'es' ? 'Fusión' : 'Merged'));
                const totalInv  = members.reduce((a, m) => a + (m.total_invoiced || 0), 0);
                const totalPaid = members.reduce((a, m) => a + (m.total_paid || 0), 0);
                const maxCredit = Math.max(...members.map(m => m.credit_days || 0));
                const sts = Array.from(new Set(members.map(m => m.status)));
                const toggleFusion = () => setFusionOpen(prev => {
                  const next = new Set(prev);
                  if (next.has(e.fid)) next.delete(e.fid); else next.add(e.fid);
                  return next;
                });
                // Misma estructura de celdas que una fila normal para que
                // las columnas alineen; la flecha navega al detalle fusionado.
                return (
                  <tr
                    key={`fusion-${e.fid}`}
                    data-selected={open}
                    style={{ cursor: 'pointer' }}
                    onClick={toggleFusion}
                  >
                    {isAdmin && <td style={{ borderLeft: '3px solid var(--brand-accent)' }}/>}
                    <td onClick={(ev) => { ev.stopPropagation(); toggleFusion(); }}>
                      <IconChevDown size={14} style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}/>
                    </td>
                    <td>
                      <div className="flex ai-center gap-2" style={{ flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
                        <span className="caption">
                          {lang === 'es'
                            ? `Fusión · ${members.length} expedientes`
                            : `Merged · ${members.length} expedientes`}
                        </span>
                      </div>
                      <div className="flex ai-center gap-2" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                        {/* Fable5-QA 2026-06-12 · R3: los chips de miembros
                            mostraban el codigo interno EXP- a TODOS los roles.
                            Identificacion por rol (spec de la fusion):
                            ADMIN/CEO -> numero de proforma (o SAP); CLIENT ->
                            su numero de PO. Sin valor -> el chip no se pinta;
                            duplicados (PO compartida) se deduplican. */}
                        {Array.from(new Set(members.map(m => (
                          isAdmin
                            ? ((m.proforma_codigos || [])[0] || m.proforma || m.sap || '')
                            : ((m.oc_codigos || [])[0] || '')
                        )).filter(Boolean))).map(tag => (
                          <span
                            key={tag}
                            style={{
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                              padding: '2px 8px', borderRadius: 6,
                              background: 'var(--surface-raised)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                        {isAdmin && (
                          <button
                            type="button"
                            disabled={fusing}
                            onClick={(ev) => { ev.stopPropagation(); handleUnfuse(e.fid); }}
                            style={{
                              border: 0, background: 'transparent',
                              color: 'var(--text-tertiary)', fontSize: 11,
                              textDecoration: 'underline', padding: 0,
                              cursor: fusing ? 'not-allowed' : 'pointer',
                              opacity: fusing ? 0.5 : 1,
                            }}
                          >
                            {lang === 'es' ? 'Desfusionar' : 'Unmerge'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{members[0].client || '—'}</span>
                    </td>
                    <td>
                      <div className="flex ai-center gap-2" style={{ flexWrap: 'wrap' }}>
                        {sts.map(s => <StatusBadge key={s} status={s} lang={lang}/>)}
                      </div>
                    </td>
                    {effectiveView === 'ops' && <>
                      <td><span className="caption">—</span></td>
                      <td style={{ textAlign: 'right' }}><span className="caption">—</span></td>
                    </>}
                    {effectiveView === 'financial' && <>
                      <td className="td-money">{fmtMoney(totalInv)}</td>
                      <td style={{ textAlign: 'right' }}><span className="caption">—</span></td>
                      <td className="td-num">
                        <div className="flex ai-center gap-2" style={{ justifyContent: 'flex-end' }}>
                          <CreditDot band={maxCredit > 75 ? 'RED' : maxCredit > 60 ? 'AMBER' : 'GREEN'}/>
                          <span className="tabular">{maxCredit}d</span>
                        </div>
                      </td>
                      <td>
                        <span className="caption tabular">
                          {fmtMoney(totalPaid)} / {fmtMoney(totalInv)}
                        </span>
                      </td>
                    </>}
                    {effectiveView === 'fleet' && <>
                      {!isClient && <td><span className="caption">—</span></td>}
                      {!isClient && <td style={{ textAlign: 'right' }}><span className="caption">—</span></td>}
                      {isAdmin && (
                        <td className="td-num">
                          <div className="flex ai-center gap-2" style={{ justifyContent: 'flex-end' }}>
                            <CreditDot band={maxCredit > 75 ? 'RED' : maxCredit > 60 ? 'AMBER' : 'GREEN'}/>
                            <span className="tabular">{maxCredit}d</span>
                          </div>
                        </td>
                      )}
                      {!isClient && <td className="td-money">{fmtMoney(totalInv)}</td>}
                    </>}
                    {isAdmin && <td><span className="caption">—</span></td>}
                    <td onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/expedientes/fusion/${e.fid}`);
                        }}
                        title={lang === 'es' ? 'Detalle fusionado' : 'Merged detail'}>
                      <IconChevRight size={14} style={{ color: 'var(--text-tertiary)' }}/>
                    </td>
                    {isAdmin && <td/>}
                  </tr>
                );
              }
              const brand = BRANDS.find(b => b.id === e.brand_id);
              const isOpen = expandedId === e.id;
              const driftE = e.real_margin - e.projected_margin;
              const stIdx = STATES.indexOf(e.status);
              const deferredVal = deferredEdits[e.id]?.deferred ?? e.deferred_total_price;
              const showDeferred = deferredEdits[e.id]?.show ?? e.show_deferred_to_client;
              return (
                <Fragment key={e.id}>
                  <tr data-selected={isOpen || (e.uuid && selected.has(e.uuid))} style={{ cursor:'pointer' }}
                      onClick={() => {
                        // Para CLIENT, el click directo en la fila abre el
                        // detalle de la OC (no hay expandible con data interna).
                        if (isClient) {
                          if (e.oc_id && (ocExpCount[e.oc_id] || 0) > 1) { onOpenExpediente(e.id); return; }
                          const oc = OCS.find(o => o.code === e.oc_client)
                                  || OCS.find(o => o.id === e.oc_id)
                                  || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                          if (oc) navigate(`/expedientes/${oc.id}`);
                          else if (e.oc_id) navigate(`/expedientes/${e.oc_id}`);
                          else onOpenExpediente(e.id);
                          return;
                        }
                        setExpandedId(isOpen ? null : e.id);
                      }}>
                    {isAdmin && (
                      <td
                        style={{ textAlign: 'center' }}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={!!(e.uuid && selected.has(e.uuid))}
                          disabled={!e.uuid}
                          onChange={(ev) => {
                            ev.stopPropagation();
                            if (e.uuid) toggleOne(e.uuid);
                          }}
                          onClick={(ev) => ev.stopPropagation()}
                          title={
                            !e.uuid
                              ? (lang === 'es' ? 'Sin UUID — no eliminable' : 'No UUID — not deletable')
                              : (lang === 'es' ? 'Seleccionar' : 'Select')
                          }
                          style={{ accentColor: 'var(--brand-primary)', cursor: e.uuid ? 'pointer' : 'not-allowed' }}
                        />
                      </td>
                    )}
                    <td onClick={(ev)=>{
                          ev.stopPropagation();
                          // El chevron tampoco expande en CLIENT; navega al detalle.
                          if (isClient) {
                            const oc = OCS.find(o => o.code === e.oc_client) || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                            if (oc) navigate(`/expedientes/${oc.id}`);
                            return;
                          }
                          setExpandedId(isOpen?null:e.id);
                        }}>
                      <IconChevDown size={14} style={{ color:'var(--text-tertiary)', transform: isOpen?'rotate(180deg)':'none', transition:'transform 160ms' }}/>
                    </td>
                    <td>
                      {/* Sprint 2026-05-17 · Celda REF role-aware.
                          ADMIN/CEO  → REF + chips de Proforma(s) + OC(s) + SAP(s)
                          CLIENT_*   → REF + chips de OC(s) (sus propias POs)
                          Los chips vienen del backend (R4 policy-driven). Si el
                          serializer devuelve [], el chip no se renderiza. */}
                      <RefCell
                        lang={lang}
                        isAdmin={isAdmin}
                        expediente={{
                          codigo:           e.ref,
                          is_blocked:       e.is_blocked,
                          // Fallback al string legacy si los arrays no llegaron.
                          proforma_codigos: (e.proforma_codigos && e.proforma_codigos.length)
                            ? e.proforma_codigos
                            : (e.proforma ? [e.proforma] : []),
                          oc_codigos:       (e.oc_codigos && e.oc_codigos.length)
                            ? e.oc_codigos
                            : (e.oc_client ? [e.oc_client] : []),
                          sap_codigos:      (e.sap_codigos && e.sap_codigos.length)
                            ? e.sap_codigos
                            : (e.sap ? [e.sap] : []),
                        }}
                        onClickOc={(code) => {
                          const oc = OCS.find(o => o.code === code)
                                  || OCS.find(o => o.codigo === code);
                          if (oc && onOpenOC) onOpenOC(oc.id);
                        }}
                      />
                    </td>
                    <td>
                      <div className="flex ai-center gap-2">
                        {/* CountryFlag quitado: el avión que veías era el
                            placeholder cuando no había country_iso2 en la
                            data del expediente. Ahora mostramos solo el
                            nombre del cliente, que viene hidratado desde
                            /api/clientes/<id> en el batch enrich. */}
                        <span style={{fontWeight: 500}}>{e.client || '—'}</span>
                      </div>
                      {e.destination && (
                        <div className="caption" style={{ marginTop: 2 }}>{e.destination}</div>
                      )}
                    </td>
                    {/* Columna MARCA eliminada (header y body). */}
                    <td><StatusBadge status={e.status} lang={lang}/></td>

                    {effectiveView === 'ops' && <>
                      <td>
                        <div className="mini-timeline">
                          {STATES.slice(0,6).map((s, i) => {
                            const cls = i < stIdx ? 'done' : i === stIdx ? 'cur ' + e.phase_signal : 'future';
                            return <div key={s} className={`seg ${cls}`} title={tr(lang,s)}/>;
                          })}
                        </div>
                        <div className="caption" style={{marginTop:6}}>
                          {e.time_in_phase}d / {e.baseline_days}d {tr(lang,'vs_historical')}
                        </div>
                      </td>
                      <td style={{textAlign:'right'}}>
                        <span className="signal-bar">
                          <span className={e.phase_signal==='green'?'on-green':(e.phase_signal==='amber'||e.phase_signal==='red'?'':'')}/>
                          <span className={e.phase_signal==='amber'?'on-amber':(e.phase_signal==='red'?'':'')}/>
                          <span className={e.phase_signal==='red'?'on-red':''}/>
                        </span>
                      </td>
                    </>}

                    {effectiveView === 'financial' && <>
                      <td className="td-money">{fmtMoney(e.total_invoiced)}</td>
                      <td style={{textAlign:'right'}}>
                        <span className={`margin-pill ${driftE > 0.005 ? 'up' : driftE < -0.005 ? 'down' : 'flat'}`}>
                          {(e.real_margin*100).toFixed(1)}%
                          <span style={{fontSize:10, marginLeft:2, opacity:0.8}}>
                            {driftE >= 0 ? '+' : ''}{(driftE*100).toFixed(1)}
                          </span>
                        </span>
                      </td>
                      <td className="td-num">
                        <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                          <CreditDot band={e.credit_days>75?'RED':e.credit_days>60?'AMBER':'GREEN'}/>
                          <span className="tabular">{e.credit_days}d</span>
                        </div>
                      </td>
                      <td>
                        <PayBar e={e}/>
                      </td>
                    </>}

                    {effectiveView === 'fleet' && <>
                      {/* Columnas logísticas (origen/destino + modo de
                          transporte) OCULTAS para CLIENT (POL_VISIBILIDAD). */}
                      {!isClient && (
                        <td>
                          <div className="caption">{e.origin}</div>
                          <div className="body-sm" style={{fontWeight:500}}>→ {e.destination}</div>
                        </td>
                      )}
                      {!isClient && (
                        <td style={{textAlign:'right'}}>
                          <span className="caption">{e.mode} · {e.freight_mode || '—'}</span>
                        </td>
                      )}
                      {/* "credit_days" es una señal interna (edad de la cuenta por cobrar).
                          CLIENT no ve esto. */}
                      {isAdmin && (
                        <td className="td-num">
                          <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                            <CreditDot band={e.credit_days>75?'RED':e.credit_days>60?'AMBER':'GREEN'}/>
                            <span className="tabular">{e.credit_days}d</span>
                          </div>
                        </td>
                      )}
                      {/* Rev 2026-05-21e · CLIENT ya no ve esta columna en el
                          listado. El "Precio acordado" se reservó para el detalle
                          de la OC. Staff sigue viendo "Facturado". */}
                      {!isClient && (
                        <td className="td-money">
                          {fmtMoney(e.total_invoiced)}
                        </td>
                      )}
                    </>}

                    {isAdmin && (
                      <td>
                        <AlertStack e={e} lang={lang}/>
                      </td>
                    )}
                    <td onClick={(ev)=>{
                         ev.stopPropagation();
                         // Va a la vista intermedia de la OC (PO-xxxx-xxxxx).
                         // Buscar primero por code (mocks) y luego por oc_id (real),
                         // con fallback al detalle del expediente si no hay OC.
                         // Si la OC tiene >1 expediente (split), abrir el expediente concreto.
                         if (e.oc_id && (ocExpCount[e.oc_id] || 0) > 1) { onOpenExpediente(e.id); return; }
                         const oc = OCS.find(o => o.code === e.oc_client)
                                 || OCS.find(o => o.id === e.oc_id)
                                 || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                         if (oc) navigate(`/expedientes/${oc.id}`);
                         else if (e.oc_id) navigate(`/expedientes/${e.oc_id}`);
                         else onOpenExpediente(e.id);
                       }}
                       title={tr(lang,'oc_detail')}>
                      <IconChevRight size={14} style={{ color:'var(--text-tertiary)'}}/>
                    </td>
                    {isAdmin && (
                      <td
                        style={{ textAlign: 'center' }}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (!e.uuid) {
                              alert(lang === 'es'
                                ? 'No se puede eliminar: el expediente no tiene UUID.'
                                : 'Cannot delete: file has no UUID.');
                              return;
                            }
                            handleBulkDelete([e.uuid]);
                          }}
                          disabled={!e.uuid || deleting}
                          className="icon-btn"
                          title={lang === 'es' ? 'Eliminar expediente' : 'Delete file'}
                          style={{
                            color: 'var(--critical, #DC2626)',
                            opacity: !e.uuid || deleting ? 0.4 : 1,
                            cursor: !e.uuid || deleting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <IconTrash size={14}/>
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Fila expandida con costos internos + deferred pricing: CEO-ONLY.
                      CLIENT nunca puede expandir (el click ya lo redirigió al detalle). */}
                  {isAdmin && isOpen && (
                    <tr className="expand-row">
                      <td colSpan={13}>
                        <CeoDetailRow e={e} lang={lang}
                          deferredVal={deferredVal}
                          showDeferred={showDeferred}
                          onUpdate={(patch) => setDeferredEdits(prev => ({...prev, [e.id]: {...prev[e.id], ...patch}}))}
                          onOpen={() => onOpenExpediente(e.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 && (
        <div className="card" style={{padding:40, textAlign:'center', marginTop:16}}>
          <div className="heading-md" style={{marginBottom:6}}>{lang==='es'?'Sin resultados':'No results'}</div>
          <div className="caption">{lang==='es'?'Ajusta los filtros para ver expedientes.':'Adjust filters to see files.'}</div>
        </div>
      )}
      </>)}{/* fin del bloque viewMode === 'table' */}

      {/* Sprint 2026-06-10 — modal de exportación retirado: el reporte
          vive en /cronograma (vista React). */}

      {/* Sprint 2026-05-03 v4 · Modal de confirmación de bulk delete.
          Replica el patrón exacto de Productos.jsx:
            · motion.div es hijo DIRECTO de AnimatePresence (sin portal,
              sin componente intermedio).
            · Sin createPortal: AnimatePresence + Portal rompe el mount
              en framer-motion 11.x (el modal nunca se monta cuando el
              estado de control pasa de null → array). */}
      <AnimatePresence>
        {pendingDelete && (() => {
          const count  = pendingDelete.length;
          const plural = count > 1;
          const busy   = deleting;
          const error  = deleteErr;
          const onCancel  = () => { if (!deleting) { setPendingDelete(null); setDeleteErr(null); } };
          const onConfirm = confirmBulkDelete;
          return (
            <motion.div
              key="exp-bulk-delete"
              className="modal-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !busy && onCancel()}
              style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(11,30,58,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 16,
              }}
            >
              <motion.div
                className="modal-panel"
                role="dialog" aria-modal="true"
                initial={{ y: 20, opacity: 0, scale: 0.98 }}
                animate={{ y: 0,  opacity: 1, scale: 1 }}
                exit   ={{ y: 10, opacity: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 280, damping: 28 }}
                onClick={(ev) => ev.stopPropagation()}
                style={{
                  background: 'var(--surface-raised)',
                  borderRadius: 12,
                  width: '100%', maxWidth: 460,
                  boxShadow: '0 12px 48px rgba(11,30,58,0.18)',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  padding: '20px 22px 8px 22px',
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                  <div style={{
                    flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(239,68,68,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--critical, #EF4444)',
                  }}>
                    <IconTrash size={18}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="heading-md" style={{ marginBottom: 4 }}>
                      {lang === 'es'
                        ? (plural ? `Eliminar ${count} expedientes` : 'Eliminar expediente')
                        : (plural ? `Delete ${count} files`         : 'Delete file')}
                    </div>
                    <div className="caption" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                      {lang === 'es'
                        ? (plural
                            ? <>¿Seguro que quieres eliminar <strong>{count} expedientes</strong>? Esta acción <strong>no se puede deshacer</strong> desde la UI; las OCs y cobros asociados no se borran.</>
                            : <>¿Seguro que quieres eliminar <strong>este expediente</strong>? Esta acción <strong>no se puede deshacer</strong> desde la UI; las OCs y cobros asociados no se borran.</>)
                        : (plural
                            ? <>Delete <strong>{count} files</strong>? This action <strong>cannot be undone</strong> from the UI; linked POs and payments are not removed.</>
                            : <>Delete <strong>this file</strong>? This action <strong>cannot be undone</strong> from the UI; linked POs and payments are not removed.</>)}
                    </div>
                    <div style={{
                      marginTop: 10, padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(72,30,227,0.06)',
                      border: '1px solid rgba(72,30,227,0.20)',
                      fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)',
                    }}>
                      <strong style={{ color: '#481EE3' }}>
                        {lang === 'es' ? 'Liberación de crédito · ' : 'Credit release · '}
                      </strong>
                      {lang === 'es'
                        ? <>las líneas <strong>sin SAP</strong> liberan crédito al cliente. Las líneas <strong>con SAP</strong> mantienen el crédito reservado (compromiso con fábrica).</>
                        : <>lines <strong>without SAP</strong> release credit. Lines <strong>with SAP</strong> keep credit reserved (factory commitment).</>}
                    </div>
                    {error && (
                      <div className="caption" style={{
                        color: 'var(--critical, #EF4444)', marginTop: 10,
                        background: 'rgba(239,68,68,0.08)', padding: '8px 10px',
                        borderRadius: 6, lineHeight: 1.4,
                      }}>
                        {error}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{
                  padding: '14px 22px 18px 22px',
                  display: 'flex', gap: 8, justifyContent: 'flex-end',
                }}>
                  <button
                    type="button" className="btn"
                    onClick={onCancel}
                    disabled={busy}
                  >
                    {lang === 'es' ? 'Cancelar' : 'Cancel'}
                  </button>
                  <button
                    type="button" className="btn"
                    onClick={onConfirm}
                    disabled={busy}
                    style={{
                      background: 'var(--critical, #EF4444)',
                      color: '#fff', borderColor: 'var(--critical, #EF4444)',
                      opacity: busy ? 0.7 : 1,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    {busy
                      ? (lang === 'es' ? 'Eliminando…' : 'Deleting…')
                      : (plural
                          ? (lang === 'es' ? `Eliminar ${count}` : `Delete ${count}`)
                          : (lang === 'es' ? 'Eliminar'         : 'Delete'))}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

// ── Payment breakdown inline bar ─────
function PayBar({ e }) {
  const total = e.total_invoiced || 1;
  const v = (e.pg_verified / total) * 100;
  const r = (e.pg_released / total) * 100;
  const p = (e.pg_pending  / total) * 100;
  const x = (e.pg_rejected / total) * 100;
  return (
    <div>
      <div className="pay-bar" title={`Verif ${fmtMoney(e.pg_verified)} · Lib ${fmtMoney(e.pg_released)} · Pend ${fmtMoney(e.pg_pending)} · Rech ${fmtMoney(e.pg_rejected)}`}>
        <div className="seg verified" style={{width: v+'%'}}/>
        <div className="seg released" style={{width: r+'%'}}/>
        <div className="seg pending"  style={{width: p+'%'}}/>
        <div className="seg rejected" style={{width: x+'%'}}/>
      </div>
      <div className="caption" style={{marginTop:4, display:'flex', justifyContent:'space-between'}}>
        <span>{fmtMoney(e.total_paid)} / {fmtMoney(e.total_invoiced)}</span>
        <span style={{color:'var(--text-tertiary)'}}>{((e.total_paid/e.total_invoiced)*100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Alerts column ─────
function AlertStack({ e, lang }) {
  const chips = [];
  if (e.credit_days > 75) chips.push({c:'red',   t:'75d', label: tr(lang,'credit_75')});
  else if (e.credit_days > 60) chips.push({c:'amber', t:'60d', label: tr(lang,'credit_60')});
  if (e.block_cause === 'docs') chips.push({c:'red', t:'DOC', label: tr(lang,'docs_missing')});
  if (e.factory_delay) chips.push({c:'amber', t:'FAB', label: tr(lang,'factory_delay')});
  if (!chips.length) return <span className="caption" style={{color:'var(--text-tertiary)'}}>—</span>;
  return (
    <div className="flex" style={{flexWrap:'wrap', gap:4}}>
      {chips.map((ch,i) => <span key={i} className={`alert-chip ${ch.c}`} title={ch.label}>{ch.t}</span>)}
    </div>
  );
}

// ── Expanded detail row with payments breakdown + internal costs + deferred pricing ─────
function CeoDetailRow({ e, lang, deferredVal, showDeferred, onUpdate, onOpen }) {
  const client = CLIENTS.find(c => c.id === e.client_id);
  const creditAvail = client ? client.credit_limit - client.credit_used : 0;
  const exposure    = e.balance;
  return (
    <div className="expand-inner">
      {/* Payments breakdown */}
      <div>
        <div className="micro" style={{marginBottom:10}}>{tr(lang,'payments_breakdown')}</div>
        <PayBar e={e}/>
        <div className="pay-legend">
          <div className="it"><span className="sw" style={{background:'var(--success)'}}/>{tr(lang,'pg_verified')} {fmtMoney(e.pg_verified)}</div>
          <div className="it"><span className="sw" style={{background:'var(--brand-accent)'}}/>{tr(lang,'pg_released')} {fmtMoney(e.pg_released)}</div>
          <div className="it"><span className="sw" style={{background:'var(--warning)'}}/>{tr(lang,'pg_pending')} {fmtMoney(e.pg_pending)}</div>
          <div className="it"><span className="sw" style={{background:'var(--critical)'}}/>{tr(lang,'pg_rejected')} {fmtMoney(e.pg_rejected)}</div>
        </div>
        <div style={{marginTop:16, paddingTop:14, borderTop:'1px dashed var(--divider)'}}>
          <div className="metric-row">
            <span className="ml">{tr(lang,'credit_available')} · {client?.name}</span>
            <span className="mv" style={{color: creditAvail < 20000 ? 'var(--critical)' : 'var(--text-primary)'}}>{fmtMoney(creditAvail)}</span>
          </div>
          <div className="metric-row">
            <span className="ml">{tr(lang,'exposure')}</span>
            <span className="mv">{fmtMoney(exposure)}</span>
          </div>
          <div className="metric-row">
            <span className="ml">{tr(lang,'balance')}</span>
            <span className="mv" style={{color:'var(--brand-primary)'}}>{fmtMoney(e.balance)}</span>
          </div>
        </div>
      </div>

      {/* Internal costs (CEO-ONLY) */}
      <div>
        <div className="micro" style={{marginBottom:10, color:'var(--brand-accent-dark, #0E8A6D)'}}>
          🔒 {tr(lang,'internal_costs')}
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'logistic_cost')}</span>
          <span className="mv">{fmtMoney(e.logistic_cost)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">DAI ({(e.dai_pct*100).toFixed(1)}%)</span>
          <span className="mv">{fmtMoney(e.dai_amount)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">IVA ({(e.iva_pct*100).toFixed(0)}%)</span>
          <span className="mv">{fmtMoney(e.iva_amount)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'mode_op')}</span>
          <span className="mv">{e.op_mode === 'COMISION' ? `${tr(lang,'commission')} ${(e.commission_pct*100).toFixed(1)}%` : tr(lang,'full_mode')}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'base_price_lbl')}</span>
          <span className="mv">{fmtMoney(e.base_price)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'projected_margin')}</span>
          <span className="mv" style={{color:'var(--text-secondary)'}}>{(e.projected_margin*100).toFixed(1)}%</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'real_margin')}</span>
          <span className="mv" style={{color: e.real_margin >= e.projected_margin ? 'var(--success)' : 'var(--critical)'}}>
            {(e.real_margin*100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Deferred price + visibility */}
      <div>
        <div className="micro" style={{marginBottom:10}}>{tr(lang,'deferred_price')}</div>
        <div className="caption" style={{marginBottom:10}}>{tr(lang,'deferred_price_sub')}</div>

        <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}>
          <div className="input" style={{fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15, padding:'8px 10px', background:'var(--bg-alt)', borderRadius:8, flex:1, display:'flex', alignItems:'center'}}>
            <span style={{color:'var(--text-tertiary)', marginRight:4}}>USD</span>
            <input
              type="number"
              value={deferredVal}
              onChange={(ev) => onUpdate({deferred: +ev.target.value})}
              style={{border:0, background:'transparent', outline:'none', flex:1, font:'inherit', color:'inherit'}}
            />
          </div>
        </div>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderTop:'1px dashed var(--divider)', borderBottom:'1px dashed var(--divider)'}}>
          <div>
            <div className="body-sm" style={{fontWeight:500}}>{tr(lang,'visible_to_client')}</div>
            <div className="caption">{showDeferred ? (lang==='es'?'El cliente ve este precio':'Client sees this price') : (lang==='es'?'Solo visible internamente':'Internal only')}</div>
          </div>
          <div className="switch" data-on={showDeferred} onClick={()=>onUpdate({show: !showDeferred})}/>
        </div>

        <div style={{marginTop:14, display:'flex', gap:8}}>
          <button className="btn btn-sm btn-secondary" onClick={onOpen}>
            <IconFolder size={12}/> {lang==='es'?'Abrir expediente':'Open file'}
          </button>
          <button className="btn btn-sm btn-primary">
            <IconCheck size={12}/> {tr(lang,'save')}
          </button>
        </div>
      </div>
    </div>
  );
}

