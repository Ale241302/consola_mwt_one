// =====================================================================
// MWT.ONE · OCDetail.jsx
//
// Vista de detalle de una Orden de Compra, con dos experiencias:
//
//   ADMIN (staff MWT)  → CRUD completo:
//       · Editar cantidades y precios de línea
//       · Agregar / eliminar productos
//       · "+ Agregar SAP" (ART-04 RegisterSAPConfirmation, C5)
//       · "+ Agregar Documento"
//       · Inputs deferred_qty + deferred_unit_price + toggle visibility
//       · Totales con "diferido" visible
//
//   CLIENT (Portal B2B) → Lectura + descarga:
//       · qty/precio visibles pero NO editables
//       · Sin "+ Agregar SAP" (ART-04 es estrictamente MWT-Factory)
//       · Sin "+ Agregar Documento" (cliente solo descarga via signed URL)
//       · Sin "+ Agregar producto", sin eliminar líneas
//       · Columnas deferred_qty/deferred_unit_price OCULTAS — nunca editar
//       · Si show_deferred_to_client=true en una línea → mostrar
//         "Precio acordado: $X" como lectura, NUNCA llamarlo "deferred"
//       · Credit clock KPI oculto (es interno)
//
// Fuente de autoridad: RoleContext (can, isAdmin, isClient). La protección
// real vive en el backend (apps.portal.ClientScopedManager + POL_VISIBILIDAD).
// =====================================================================
import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import { StatusBadge, CreditDot, CountryFlag } from "../components/ui/primitives.jsx";
import {
  IconChevLeft, IconChevDown, IconChevRight, IconDownload, IconPlus,
  IconFolder, IconPlane, IconShip, IconAlert, IconX, IconSearch, IconPackage,
  IconPencil, IconTrash, IconEye,
} from "../lib/icons.jsx";
import {
  OCS, CLIENTS, BRANDS, EXPEDIENTES, PRODUCTS, HERO_OC_ID,
} from "../data/mockData.js";
import AddSAPConfirmationDrawer from "../components/expedientes/AddSAPConfirmationDrawer.jsx";
import UploadDocumentModal from "../components/expedientes/UploadDocumentModal.jsx";
import DocumentMatchmakerWizard from "../components/expedientes/DocumentMatchmakerWizard.jsx";
import AddOCProductModal from "../components/expedientes/AddOCProductModal.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { ocsApi, clientesApi, marcasApi, expedientesApi, lineasApi,
         productosApi, documentosApi, storageApi } from "../lib/api.js";
import {
  MWT_OPERATING_CLIENT_ID, MWT_OPERATOR_NAME, isMwtOperated, isClientRole,
} from "../lib/operatingCompany.js";

// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-05-02 (AG-03): helpers para adaptar el shape de
// /api/documentos/ al render legacy de la card "Documentos comerciales".
// El render espera {ext, kind, code, date, size, author} y el backend
// expone {file_ext, kind, codigo, fecha, file_size_bytes, ...}.
// ─────────────────────────────────────────────────────────────────────
function _extractExt(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1) : '';
}

const _DOC_KIND_LABEL_ES = {
  OC: 'OC del Cliente',
  PROFORMA: 'Proforma',
  FACTURA: 'Factura comercial',
  CONTRATO: 'Contrato',
  OTRO: 'Otro documento',
};
const _DOC_KIND_LABEL_EN = {
  OC: 'Client PO',
  PROFORMA: 'Proforma',
  FACTURA: 'Commercial invoice',
  CONTRATO: 'Contract',
  OTRO: 'Other document',
};
function _docKindLabel(kind, lang) {
  const k = String(kind || 'OTRO').toUpperCase();
  const map = lang === 'en' ? _DOC_KIND_LABEL_EN : _DOC_KIND_LABEL_ES;
  return map[k] || (lang === 'en' ? 'Document' : 'Documento');
}

function _formatDocDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
    return dt.toISOString().slice(0, 10);
  } catch { return String(d).slice(0, 10); }
}

function _formatBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  const k = 1024;
  const i = Math.floor(Math.log(v) / Math.log(k));
  const u = ['B', 'KB', 'MB', 'GB'];
  return `${(v / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${u[Math.min(i, u.length - 1)]}`;
}

export default function ScreenOCDetail() {
  const navigate = useNavigate();
  const { ocId: paramOcId } = useParams();
  const { lang } = useOutletContext();
  // Viewport efectivo + capability gates (ver POL_VISIBILIDAD).
  const { isAdmin, isClient, can } = useRole();
  const ocId = paramOcId || HERO_OC_ID;
  const onBack = () => navigate('/expedientes');
  const onOpenExpediente = (expedienteId) => {
    if (!expedienteId) return;
    // Estamos dentro de OCDetail, así que el ocId del URL es el padre.
    // Esto reemplaza el lookup en OCS (mocks) que fallaba para datos
    // reales del API y caía a /expedientes (back al listado).
    const ocIdParam = ocId || OCS.find(o => Array.isArray(o.expedientes)
                              && o.expedientes.includes(expedienteId))?.id
                          || 'none';
    navigate(`/expedientes/${ocIdParam}/exp/${expedienteId}`);
  };

  // ── ⚠ ORDEN DE HOOKS ⚠ ──────────────────────────────────────
  // Todos los useState/useEffect deben estar ANTES de cualquier
  // early return (loading / not-found). React error #310 ocurre si
  // el número de hooks invocados varía entre renders. Por eso:
  //   1. Declarar todos los hooks aquí, en orden estable
  //   2. Hacer los returns condicionales DESPUÉS de los hooks
  // ─────────────────────────────────────────────────────────────

  // Lookup en mocks primero (HERO scenario). Si no está, fetch al API.
  const ocFromMock = OCS.find(o => o.id === ocId);
  const [apiOc,         setApiOc]         = useState(null);
  const [apiOcClient,   setApiOcClient]   = useState(null);
  const [apiOcBrand,    setApiOcBrand]    = useState(null);
  const [apiOcExpedientes, setApiOcExpedientes] = useState([]);
  const [apiOcLines,    setApiOcLines]    = useState([]);
  // Sprint 2026-05-02 (AG-03): documentos comerciales reales del backend.
  // Antes el adapter ponía `docs: []` hardcodeado y la sección
  // "Documentos comerciales" siempre mostraba "0 archivos".
  const [apiOcDocs,     setApiOcDocs]     = useState([]);
  const [ocLoading,     setOcLoading]     = useState(!ocFromMock);
  const [ocNotFound,    setOcNotFound]    = useState(false);
  // Mapa { producto_id → precio_cliente } leído de
  // producto.especificaciones.client_prices[oc.client_id]. Si el cliente
  // no tiene override, fallback a precio_lista del producto.
  const [cpaPriceMap,   setCpaPriceMap]   = useState({});
  // Sprint 2026-05-02 (AG-03): mapa producto_id → nombre real.
  // El campo product_label de expedientes.linea suele venir igual al
  // SKU (porque al crear la línea no se persiste el nombre completo).
  // Para mostrar el nombre canónico en la columna "Nombre" hacemos un
  // lookup vía productosApi.get cuando cargamos la OC.
  const [productNameMap, setProductNameMap] = useState({});

  // Hooks que estaban más abajo (causaban React error #310 al venir
  // después de early returns). Subidos al tope para garantizar orden
  // estable en todos los renders.
  const [lineEdits, setLineEdits]                 = useState({});
  const [extraLines, setExtraLines]               = useState([]);
  const [removedLineIds, setRemovedLineIds]       = useState(new Set());
  const [showOrphansOnly, setShowOrphansOnly]     = useState(false);
  const [openSap, setOpenSap]                     = useState(null);
  const [showAddProduct, setShowAddProduct]       = useState(false);
  const [sapDrawerOpen, setSapDrawerOpen]         = useState(false);
  const [sapDrawerExp, setSapDrawerExp]           = useState(null);
  // Sprint 2026-05-01: si se esta editando un SAP existente, este state
  // contiene los datos pre-poblados para el drawer. Si null, el drawer
  // entra en modo "agregar" estandar.
  const [editingSapInfo, setEditingSapInfo]       = useState(null);
  // Sprint 2026-05-01: modal subir documento comercial (OC, Proforma, etc.)
  const [uploadDocOpen, setUploadDocOpen]         = useState(false);
  // Sprint 2026-05-02 (AG-03): cuando el upload modal completa el OCR IA,
  // guardamos el resultado aquí y abrimos el wizard de revisión.
  // Shape: { result, file, documentType }
  const [aiReview, setAiReview]                   = useState(null);
  // Sprint 2026-05-02: gestión de docs comerciales — view + delete.
  // confirmDeleteDoc: doc pendiente de confirmación de borrado.
  // viewingDocId: id del doc cuya signed URL estamos pidiendo (loading state).
  const [confirmDeleteDoc, setConfirmDeleteDoc]   = useState(null);
  const [viewingDocId, setViewingDocId]           = useState(null);
  const [deletingDoc, setDeletingDoc]             = useState(false);
  const [docError, setDocError]                   = useState(null);
  // Sprint 2026-05-02: eliminación de líneas de OC con confirmación.
  // confirmDeleteLine: línea persistida pendiente de DELETE al API.
  const [confirmDeleteLine, setConfirmDeleteLine] = useState(null);
  const [deletingLine, setDeletingLine]           = useState(false);
  const [lineError, setLineError]                 = useState(null);

  useEffect(() => {
    if (ocFromMock) return;
    let cancel = false;
    setOcLoading(true); setOcNotFound(false);
    // ocsApi.get tolera UUID o codigo (por compat similar a expedientes)
    ocsApi.get(ocId)
      .then(async (o) => {
        if (cancel) return;
        setApiOc(o);
        const [cli, br, exps, lns, docs] = await Promise.all([
          o.client_id ? clientesApi.get(o.client_id).catch(() => null) : Promise.resolve(null),
          o.brand_id  ? marcasApi.get(o.brand_id).catch(() => null)    : Promise.resolve(null),
          expedientesApi.list({ oc: o.id }).catch(() => ({ results: [] })),
          lineasApi.list({ oc: o.id }).catch(() => ({ results: [] })),
          // Sprint 2026-05-02 (AG-03): documentos comerciales reales del API.
          // Endpoint canónico: GET /api/documentos/?oc=<oc_id>.
          documentosApi.list({ oc: o.id }).catch(() => ({ results: [] })),
        ]);
        if (cancel) return;
        setApiOcClient(cli);
        setApiOcBrand(br);
        setApiOcExpedientes(Array.isArray(exps) ? exps : (exps?.results || []));
        const lineasArr = Array.isArray(lns) ? lns : (lns?.results || []);
        setApiOcLines(lineasArr);
        setApiOcDocs(Array.isArray(docs) ? docs : (docs?.results || []));

        // ── Resolver precio cliente desde productos ──────────────
        // El precio override por cliente vive en
        // producto.especificaciones.client_prices[client_id].
        // Si no hay override, usamos producto.precio_lista.
        // Hacemos un fetch por producto_id único y construimos el mapa.
        if (o.client_id && lineasArr.length > 0) {
          const uniquePidIds = Array.from(new Set(
            lineasArr.map(l => l.producto_id).filter(Boolean)
          ));
          if (uniquePidIds.length > 0) {
            try {
              const prods = await Promise.all(
                uniquePidIds.map(pid => productosApi.get(pid).catch(() => null))
              );
              if (cancel) return;
              const map = {};
              const nameMap = {};
              for (const p of prods) {
                if (!p?.id) continue;
                const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
                const override = Number(cliMap[o.client_id] || 0);
                const lista    = Number(p.precio_lista || 0);
                map[p.id] = override > 0 ? override : lista;
                // Sprint 2026-05-02 (AG-03): cacheamos el nombre real
                // para mostrar en la columna "Nombre" de la tabla.
                if (p.nombre) nameMap[p.id] = p.nombre;
              }
              setCpaPriceMap(map);
              setProductNameMap(nameMap);
            } catch { /* swallow */ }
          }
        }
      })
      .catch(() => { if (!cancel) setOcNotFound(true); })
      .finally(() => { if (!cancel) setOcLoading(false); });
    return () => { cancel = true; };
  }, [ocId, ocFromMock]);

  // Mapper API → shape del UI mock-based.
  // ⚠ CRITICAL: NO hacer ...mockOcFallback aquí — eso contamina la
  // vista con datos seed (Andes Retail Co., Goliath, 3 documentos
  // falsos, 76d crédito, etc.). Construimos el objeto desde cero con
  // defaults explícitos para cada campo que el render lee.
  const mockOcFallback = OCS[0];   // se mantiene SOLO para HERO scenario
  const oc = ocFromMock || (apiOc ? {
    id:           apiOc.id,
    code:         apiOc.codigo,
    codigo:       apiOc.codigo,
    client_id:    apiOc.client_id,
    brand_id:     apiOc.brand_id,
    estado:       apiOc.estado,
    status:       (apiOc.estado || "").toLowerCase() === "emitida"
                    ? "in_progress" : "in_progress",
    moneda:       apiOc.moneda || "USD",
    issued_at:    apiOc.issued_at || apiOc.created_at || null,
    total_value:  Number(apiOc.total_value || 0),
    total_invoiced: Number(apiOc.total_invoiced || 0),
    total_paid:   Number(apiOc.total_paid || 0),
    balance:      Number(apiOc.balance || 0),
    coverage_pct: Number(apiOc.coverage_pct || 0),
    lines_count:  apiOc.lines_count || 0,
    lines_with_sap: apiOc.lines_with_sap || 0,
    air_pct:      Number(apiOc.air_pct || 0),
    sea_pct:      Number(apiOc.sea_pct || 0),
    expedientes:  apiOcExpedientes.map(e => e.id),
    // Sprint 2026-05-02 (AG-03): documentos comerciales reales,
    // poblados desde GET /api/documentos/?oc=<id>. El render de la card
    // (línea ~1075) lee el shape legacy {id, ext, kind, code, date,
    // size, author}, así que adaptamos el DocumentoSerializer del
    // backend a esa forma. Defensivo: cualquier campo faltante cae a
    // '' para no romper `.toUpperCase()` ni concatenaciones.
    docs:         apiOcDocs.map(d => ({
      id:     d.id,
      ext:    String(d.file_ext || _extractExt(d.codigo || d.filename) || 'file').toLowerCase(),
      kind:   _docKindLabel(d.kind, lang),
      code:   d.codigo || d.filename || '—',
      date:   _formatDocDate(d.fecha || d.created_at),
      size:   _formatBytes(d.file_size_bytes ?? d.file_size ?? 0),
      author: d.author || d.created_by_name || d.uploaded_by || '—',
      url:    d.storage_url || null,
      // Sprint 2026-05-06 · audiencia (CLIENT vs MWT_INTERNAL).
      // El backend ya filtra MWT_INTERNAL para CLIENT_*, aqui lo
      // exponemos para que el render aplique badge/filtro defensivo.
      audience: (d.audience || 'CLIENT').toUpperCase(),
      // Conservamos el shape backend por si otro consumidor lo necesita
      _raw:   d,
    })),
    // Líneas reales del API (con merge de unit_price del CPA en
    // el render — ver useEffect de cpaPrices más abajo).
    lines:        apiOcLines.map(l => {
      const sku = String(l.sku || "").toUpperCase();
      const qty = Number(l.qty || 0);
      // Precio: PRIORIZAMOS el unit_price persistido en DB (frozen al
      // momento de crear el expediente). Esto preserva el histórico —
      // si mañana cambia el precio del cliente, esta OC mantiene el
      // precio del día de creación. Solo si la línea histórica tiene
      // unit_price=0 (líneas creadas antes del fix), caemos al lookup
      // live como mejor esfuerzo de backfill visual.
      // Sprint 2026-05-06 · backend devuelve unit_price_for_viewer
      // resuelto por rol: Admin/MWT → unit_price_mwt, CLIENT_* →
      // unit_price_client. Si no llegó (compat) caemos a unit_price.
      const persistedPrice = Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
      const livePrice      = l.producto_id ? Number(cpaPriceMap[l.producto_id] || 0) : 0;
      const unit = persistedPrice > 0 ? persistedPrice : livePrice;
      // Sprint 2026-05-02 (AG-03): para el campo "Nombre" priorizamos
      // el nombre real de productos.producto (vía lookup en
      // productNameMap), porque el l.product_label del API suele venir
      // igual al SKU. Sólo si nada matchea, caemos al SKU como fallback.
      const realName = (l.producto_id && productNameMap[l.producto_id])
                       || l.product_label
                       || l.sku;
      return {
        id:             l.id,
        sku:            l.sku,
        talla:          l.talla || l.size || "",
        size:           l.talla || l.size || "",
        qty:            qty,
        product_label:  realName,
        product:        realName,
        producto_id:    l.producto_id || null,
        unit_price:     unit,
        total_price:    Number(l.total_price || (qty * unit)),
        sap:            l.sap || null,
        expediente_id:  l.expediente_id,
        exp_id:         l.expediente_id,
        // Sprint 2026-05-01: campos que faltaban en el mapper.
        // production_date alimenta el chip "Fecha de produccion" y
        // transport_mode alimenta el chip MARITIMO/AEREO/Pendiente.
        // estado lo necesita el filtro del SAP picker (SAP_CONFIRMADO).
        production_date: l.production_date || null,
        transport_mode:  l.transport_mode || null,
        estado:          l.estado || "PENDIENTE_SAP",
        status:         (l.estado || "PENDIENTE_SAP"),
        deferred_qty:   0,
        deferred_unit_price: 0,
        show_deferred_to_client: false,
        // Marca el origen del precio para futura UX (tooltip).
        //   FROZEN  → unit_price persistido en BD al crear el expediente
        //   LIVE    → backfill best-effort vía lookup en cpaPriceMap
        //   NONE    → ninguna fuente (línea sin producto_id resuelto)
        _price_source:  persistedPrice > 0
                          ? "FROZEN"
                          : (livePrice > 0 ? "LIVE" : "NONE"),
      };
    }),
    // Campos del header / KPIs que NO aplican a una OC recién creada
    // por el wizard simplificado (no hay split logístico, ni reloj
    // de crédito real hasta que se emita factura). Se ponen en cero
    // o se hidratan desde el cliente más abajo.
    air_qty: 0, sea_qty: 0,
    sap_count_total: 0, sap_count_assigned: 0,
    credit_days_max: null,   // se llena con client.credit_days
    max_credit_days: 0,      // alias usado por el render del Reloj
    credit_band: null,
    is_blocked: false,
    block_reason: null,
    // Banderas legacy del UI (datos seed, irrelevantes para el wizard nuevo)
    brand: "",            // queda vacío → render esconde la pill de marca
    client: "",           // se hidrata más abajo con apiOcClient
  } : mockOcFallback);

  // Hidratar credit_days desde el cliente del API para el reloj
  // (el campo viene como `dias_credito` o similar; defensivo).
  if (apiOcClient && oc) {
    const cd = Number(
      apiOcClient.dias_credito
      ?? apiOcClient.credit_days
      ?? apiOcClient.credito_dias
      ?? 0
    );
    oc.max_credit_days = cd > 0 ? cd : 0;
    oc.credit_days_max = oc.max_credit_days;
  }
  if (apiOcBrand && oc && !oc.brand) {
    oc.brand = apiOcBrand.nombre || apiOcBrand.brand_code || "";
  }
  if (apiOcClient && oc && !oc.client) {
    oc.client = apiOcClient.razon_social || apiOcClient.nombre || apiOcClient.codigo || "";
    oc.client_country = apiOcClient.pais_iso2 || "";
  }

  // NOTA: los early returns de loading/notFound se mueven al FINAL de
  // la lista de hooks (antes del return principal). React error #310
  // ocurre si retornas antes de invocar todos los useMemo/useState
  // declarados después.
  // Hidratamos cliente/marca: API primero (mock-shape), fallback mocks
  const mockClientForOc = CLIENTS.find(c => c.id === oc.client_id);
  const client = apiOcClient ? {
    ...(mockClientForOc || {}),
    id:      apiOcClient.id,
    name:    apiOcClient.razon_social || apiOcClient.nombre || apiOcClient.codigo || "—",
    code:    apiOcClient.codigo || apiOcClient.rut || "",
    country: apiOcClient.pais_iso2 || (mockClientForOc?.country || ""),
    contact: apiOcClient.contacto_nombre || apiOcClient.contacto_email
            || (mockClientForOc?.contact || ""),
  } : mockClientForOc;
  const brand  = apiOcBrand ? {
    ...(BRANDS.find(b => b.id === oc.brand_id) || BRANDS[0]),
    id:    apiOcBrand.id,
    name:  apiOcBrand.nombre || apiOcBrand.brand_code || "—",
    color: apiOcBrand.color || (BRANDS[0]?.color || "#0B1E3A"),
  } : BRANDS.find(b => b.id === oc.brand_id);

  // Detecta el primer expediente en estado REGISTRO ligado a esta OC.
  // Bug previo: sólo buscaba en el array MOCK `EXPEDIENTES`, dejando el
  // botón "Agregar SAP" disabled para todas las OCs reales del API.
  // Ahora prioriza apiOcExpedientes (API) y cae al mock como fallback.
  const sapEligibleExp = useMemo(() => {
    // 1) Buscar en los expedientes del API (con sus campos reales)
    if (Array.isArray(apiOcExpedientes) && apiOcExpedientes.length > 0) {
      const inRegistro = apiOcExpedientes.find(e =>
        ((e.estado || "REGISTRO").toUpperCase()) === "REGISTRO"
      );
      return inRegistro || apiOcExpedientes[0] || null;
    }
    // 2) Fallback a mocks (HERO scenario)
    const expIds = oc.expedientes || [];
    const expObjs = expIds
      .map(eid => EXPEDIENTES.find(e => e.id === eid))
      .filter(Boolean);
    const inRegistro = expObjs.find(e =>
      (e.estado || e.status || "REGISTRO").toUpperCase() === "REGISTRO"
    );
    return inRegistro || expObjs[0] || null;
  }, [oc, apiOcExpedientes]);

  const openSapDrawer = () => {
    setSapDrawerExp(sapEligibleExp);
    setSapDrawerOpen(true);
  };

  // Líneas que pertenecen al expediente del drawer (para conciliación).
  // Sprint 2026-05-01: se excluyen lineas YA confirmadas con un SAP
  // (estado='SAP_CONFIRMADO' + sap truthy) para que el usuario no
  // pueda asignar dos veces la misma cantidad. Estas lineas no
  // aparecen en el buscador del drawer.
  const sapDrawerLines = useMemo(() => {
    if (!sapDrawerExp) return [];
    const expId = sapDrawerExp.id;
    const isEdit = !!editingSapInfo;
    return (oc.lines || [])
      .filter(l => l.exp_id === expId || l.expediente_id === expId || !l.exp_id)
      .filter(l => {
        // En modo EDIT pasamos TODAS las lineas (las que estan confirmadas
        // con este SAP llegan pre-seleccionadas; las pendientes pueden
        // agregarse al SAP). En modo CREATE filtramos las que ya tienen
        // otro SAP confirmado.
        if (isEdit) return true;
        const estado = String(l.estado || l.status || '').toUpperCase();
        const hasSap = !!l.sap;
        if (hasSap && estado === 'SAP_CONFIRMADO') return false;
        return true;
      })
      .map(l => ({
        id:           l.id,
        sku:          l.sku,
        size:         l.size,
        qty:          Number(l.qty || 0),
        unit_price:   Number(l.unit_price || 0),
        producto_id:  l.producto_id || null,
        descripcion:  l.product || l.descripcion || "",
      }));
  }, [oc, sapDrawerExp, editingSapInfo]);

  const updateLine = (lineId, patch) => {
    setLineEdits(prev => ({ ...prev, [lineId]: { ...(prev[lineId]||{}), ...patch } }));
  };
  const readLine = (line) => {
    const edits = lineEdits[line.id] || {};
    const merged = { ...line, ...edits };
    // Recompute total_price when qty or unit_price was edited
    if ('qty' in edits || 'unit_price' in edits) {
      merged.total_price = merged.qty * merged.unit_price;
    }
    return merged;
  };

  // Effective line list = baseline (minus removed) + extras, all with edits applied
  const allLines = useMemo(() => {
    const base = (oc?.lines || []).filter(l => !removedLineIds.has(l.id));
    return [...base, ...extraLines].map(readLine);
  }, [oc?.lines, extraLines, removedLineIds, lineEdits]);

  // Sprint 2026-05-01: AddOCProductModal devuelve un array de rows con
  // { sku, talla, cantidad, producto_id, product_label, unit_price } —
  // una row por talla con qty > 0. addProduct las inserta como extraLines.
  const addProduct = (rows) => {
    const arr = Array.isArray(rows)
      ? rows
      : [{
          sku: rows?.sku,
          talla: null,
          cantidad: 1,
          producto_id: rows?.id || null,
          product_label: rows?.name || rows?.sku,
          unit_price: 0,
        }];
    const newLines = arr.map((r, i) => {
      const qty = Number(r.cantidad || 0);
      const unit = Number(r.unit_price || 0);
      return {
        id: `L-NEW-${Date.now()}-${i}-${Math.random().toString(36).slice(2,5)}`,
        sku: r.sku,
        product: r.product_label || r.sku,
        product_label: r.product_label || r.sku,
        producto_id: r.producto_id || null,
        size: r.talla || '—',
        talla: r.talla || null,
        qty,
        unit_price: unit,
        total_price: +(qty * unit).toFixed(2),
        sap: null,
        exp_id: null,
        transport_mode: null,
        production_date: null,
        estado: 'PENDIENTE_SAP',
        status: 'PENDIENTE_SAP',
        deferred_qty: 0,
        deferred_unit_price: 0,
        show_deferred_to_client: false,
      };
    });
    setExtraLines(prev => [...prev, ...newLines]);
    setShowAddProduct(false);
  };

  const removeLine = (lineId) => {
    // Líneas locales (agregadas vía "Agregar producto" y aún no persistidas):
    // se quitan del state directo, sin API call.
    if (extraLines.some(l => l.id === lineId)) {
      setExtraLines(prev => prev.filter(l => l.id !== lineId));
      return;
    }
    // Líneas persistidas: abrimos modal de confirmación. La llamada al API
    // se ejecuta en confirmDeleteLineAction. Sprint 2026-05-02 (AG-03):
    // antes solo se ocultaba la fila vía removedLineIds, así que al
    // recargar la página la línea reaparecía.
    const lineFromApi = apiOcLines.find(l => l.id === lineId);
    const lineFromOc  = (oc.lines || []).find(l => l.id === lineId);
    const lineSnapshot = lineFromApi || lineFromOc || { id: lineId };
    setLineError(null);
    setConfirmDeleteLine(lineSnapshot);
  };

  const confirmDeleteLineAction = async () => {
    if (!confirmDeleteLine?.id || deletingLine) return;
    setDeletingLine(true);
    setLineError(null);
    try {
      await lineasApi.remove(confirmDeleteLine.id);
      // Quitamos del state en caliente para que la UI refleje el cambio
      // sin recargar la página.
      setApiOcLines(prev => prev.filter(l => l.id !== confirmDeleteLine.id));
      // También quitamos cualquier edit pendiente para esa línea.
      setLineEdits(prev => {
        const next = { ...prev };
        delete next[confirmDeleteLine.id];
        return next;
      });
      setRemovedLineIds(prev => {
        const n = new Set(prev);
        n.delete(confirmDeleteLine.id);
        return n;
      });
      setConfirmDeleteLine(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[OCDetail] delete linea falló:', e);
      setLineError(
        lang === 'es'
          ? `No se pudo eliminar la línea: ${e?.message || 'error'}`
          : `Couldn't delete line: ${e?.message || 'error'}`
      );
    } finally {
      setDeletingLine(false);
    }
  };

  // ── Sprint 2026-05-02: ver / eliminar documentos comerciales ─────
  // handleViewDoc: pide signed URL al backend (TTL 15 min) y abre en
  //   nueva pestaña. La URL ya viene firmada de MinIO, así que el
  //   browser puede renderear el PDF inline sin más auth.
  const handleViewDoc = async (doc) => {
    if (!doc?.id || viewingDocId === doc.id) return;
    setViewingDocId(doc.id);
    setDocError(null);
    try {
      const resp = await storageApi.documentSignedUrl(doc.id, 900);
      const url = resp?.url;
      if (!url) {
        throw new Error(resp?.error || 'URL no disponible');
      }
      // Sprint 2026-05-06 · si el archivo es Excel/CSV/Word/Zip → forzar
      // download (esos formatos no se renderean inline en el browser y
      // window.open abre una pestaña vacía). PDF/imagenes siguen abriendo
      // en pestaña nueva como antes.
      const ext = String(doc.ext || doc.file_ext || '').toLowerCase().replace(/^\./, '');
      const downloadExts = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'docx', 'doc', 'zip']);
      if (downloadExts.has(ext)) {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.code || doc.codigo || doc.filename || `${doc.id}.${ext}`;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[OCDetail] view doc falló:', e);
      setDocError(
        lang === 'es'
          ? `No se pudo abrir el documento: ${e.message || 'error'}`
          : `Couldn't open document: ${e.message || 'error'}`
      );
    } finally {
      setViewingDocId(null);
    }
  };

  // handleDeleteDoc: dispara el modal de confirmación. La eliminación
  //   real se ejecuta en confirmDeleteDocAction al pulsar "Eliminar".
  const handleDeleteDoc = (doc) => {
    if (!doc?.id || deletingDoc) return;
    setDocError(null);
    setConfirmDeleteDoc(doc);
  };

  const confirmDeleteDocAction = async () => {
    if (!confirmDeleteDoc?.id || deletingDoc) return;
    setDeletingDoc(true);
    setDocError(null);
    try {
      // El factory resource() expone `.remove()` (no `.delete()` — `delete`
      // es palabra reservada en JS y se evita en la API pública).
      await documentosApi.remove(confirmDeleteDoc.id);
      // Quitamos del listado en caliente sin recargar la página.
      setApiOcDocs(prev => prev.filter(x => x.id !== confirmDeleteDoc.id));
      setConfirmDeleteDoc(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[OCDetail] delete doc falló:', e);
      setDocError(
        lang === 'es'
          ? `No se pudo eliminar el documento: ${e.message || 'error'}`
          : `Couldn't delete document: ${e.message || 'error'}`
      );
    } finally {
      setDeletingDoc(false);
    }
  };

  // ── Editar el número SAP de un grupo ─────────────────────────
  // Sprint 2026-05-01: en lugar de un modal compacto, abrimos el
  // mismo drawer lateral de "Agregar SAP" pero en modo EDIT con los
  // datos pre-cargados. Esto unifica el UX: una sola fuente de verdad
  // para crear y editar SAPs.
  const openEditSapModal = (oldSap, expId, lineIds) => {
    if (!expId) return;
    const ids = Array.isArray(lineIds) ? lineIds : [];
    const groupLines = (oc.lines || []).filter(l => ids.includes(l.id));
    const expObj = (apiOcExpedientes || []).find(e => e.id === expId)
                || (oc.expedientes_full || []).find(e => e.id === expId);
    const firstDate = groupLines.find(l => l.production_date)?.production_date
                   || expObj?.fecha_produccion_estimada
                   || '';
    // Setear el expediente del drawer y los datos del SAP a editar.
    setSapDrawerExp(expObj || { id: expId, codigo: groupLines[0]?.codigo, estado: 'PRODUCCION' });
    setEditingSapInfo({
      sap_id:            oldSap || '',
      fecha_fabricacion: firstDate || new Date().toISOString().slice(0, 10),
      line_ids:          ids,
    });
    setSapDrawerOpen(true);
  };
  // Totals computed from edited lines
  const computedTotal = allLines.reduce((a, l) => a + (l.qty * l.unit_price), 0);
  const computedDeferred = allLines.reduce((a, l) => a + ((l.deferred_qty||0) * (l.deferred_unit_price||0)), 0);

  // Group edited lines by SAP (null → orphan bucket)
  const sapGroups = useMemo(() => {
    const map = new Map();
    for (const l of allLines) {
      const key = l.sap || '__ORPHAN__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return Array.from(map.entries()).map(([sap, lines]) => ({
      sap: sap === '__ORPHAN__' ? null : sap,
      lines,
      exp_id: lines[0].exp_id,
      transport_mode: lines[0].transport_mode,
      production_date: lines[0].production_date,
      status: lines[0].status,
      total_value: lines.reduce((a,l)=>a+(l.qty*l.unit_price), 0),
      total_qty:   lines.reduce((a,l)=>a+l.qty, 0),
    }));
  }, [allLines]);

  const filteredGroups = showOrphansOnly ? sapGroups.filter(g => !g.sap) : sapGroups;

  const statusLabel = oc.status === 'CERRADO' ? tr(lang,'oc_state_closed')
                    : oc.status === 'EN_EJECUCION' ? tr(lang,'oc_state_active')
                    : tr(lang,'oc_state_partial');
  const statusColor = oc.status === 'CERRADO' ? 'var(--text-tertiary)'
                    : oc.status === 'EN_EJECUCION' ? 'var(--success)'
                    : 'var(--warning)';

  // ── Early returns DESPUÉS de todos los hooks (rules-of-hooks)
  if (ocLoading) {
    return (
      <div className="page" style={{ maxWidth: 1500, padding: 32 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando OC…" : "Loading OC…"}
        </div>
      </div>
    );
  }
  if (ocNotFound) {
    return (
      <div className="page" style={{ maxWidth: 1500, padding: 32 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/expedientes')}
                style={{ marginBottom: 14 }}>
          <IconChevLeft size={14}/> {lang === "es" ? "Volver" : "Back"}
        </button>
        <div className="card card-pad-lg" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#0B1E3A" }}>
            {lang === "es" ? "OC no encontrada" : "OC not found"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 6 }}>
            {lang === "es"
              ? `No existe una OC con id ${ocId}.`
              : `No OC with id ${ocId}.`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" data-screen-label="OC Detail">
      {/* ── Header ───── */}
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <div className="flex ai-center gap-3" style={{marginBottom: 10}}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              <IconChevLeft size={14}/> {tr(lang,'back_to_list')}
            </button>
            <span className="caption" style={{color:'var(--text-tertiary)'}}>•</span>
            <span className="micro">{tr(lang,'po_number')}</span>
          </div>

          <div className="flex ai-center gap-3" style={{marginBottom: 6, flexWrap: 'wrap'}}>
            <h1 className="page-title" style={{margin: 0}}>{oc.code}</h1>
            <span className="oc-status-chip" style={{
              color: statusColor, background: 'color-mix(in oklab,' + statusColor + ' 14%, transparent)',
              border: '1px solid color-mix(in oklab,' + statusColor + ' 36%, transparent)',
            }}>● {statusLabel}</span>
            {/* Sprint 2026-05-06 · si la OC está operada por Muito Work Limitada
                (operating_company_id en cualquiera de sus expedientes), mostramos
                un chip explícito. Visible para todos los roles (es información
                contractual: el cliente final también debe saber que MWT opera). */}
            {(() => {
              const opId = (apiOcExpedientes || []).find(e => e?.operating_company_id)?.operating_company_id;
              if (!isMwtOperated(opId)) return null;
              return (
                <span className="oc-status-chip" style={{
                  color: 'var(--brand-primary, #0B1E3A)',
                  background: 'color-mix(in oklab, var(--brand-accent, #00B286) 12%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--brand-accent, #00B286) 40%, transparent)',
                  fontWeight: 600,
                }}
                title={lang === 'es' ? 'El expediente lo opera Muito Work Limitada' : 'Operated by Muito Work Limitada'}>
                  {lang === 'es' ? `Operado por ${MWT_OPERATOR_NAME}` : `Operated by ${MWT_OPERATOR_NAME}`}
                </span>
              );
            })()}
          </div>

          <div className="flex ai-center gap-3 page-subtitle" style={{flexWrap:'wrap'}}>
            {/* Cliente: solo render si hay nombre real (oculta el placeholder
                cuando el wizard simplificado no eligió cliente). */}
            {oc.client && (
              <div className="flex ai-center gap-2">
                {oc.client_country && <CountryFlag country={oc.client_country}/>}
                <span style={{fontWeight: 500, color:'var(--text-primary)'}}>{oc.client}</span>
              </div>
            )}
            {/* Marca: solo render si está asignada. El wizard simplificado
                NO pide marca (queda en NULL hasta la transición T2 vía
                CommercialDataHardStop). */}
            {oc.brand && (
              <>
                {oc.client && <span>·</span>}
                <div className="flex ai-center gap-2">
                  <span style={{ width:8, height:8, background: brand?.color, borderRadius: 2, display:'inline-block' }}/>
                  <span>{oc.brand}</span>
                </div>
              </>
            )}
            {(oc.client || oc.brand) && <span>·</span>}
            <span>{tr(lang,'issued_date')} {oc.issued}</span>
            <span>·</span>
            <span>{oc.lines_count} {tr(lang,'lines_count').toLowerCase()} · {oc.expedientes.length} {tr(lang,'expedientes').toLowerCase()}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          {/* "+ Agregar SAP" → register_sap (CEO-ONLY).
              Cero validaciones de datos comerciales: el botón queda
              habilitado siempre que haya un expediente elegible (en
              REGISTRO). NINGÚN campo del expediente es obligatorio
              para registrar SAP — decisión CEO. */}
          {can('register_sap') && (
            <button
              className="btn btn-primary"
              onClick={openSapDrawer}
              disabled={!sapEligibleExp}
              title={!sapEligibleExp
                ? (lang === 'es' ? 'No hay expediente en REGISTRO para confirmar' : 'No expediente in REGISTRO to confirm')
                : ''}
              style={{ background: '#0B1E3A' }}
            >
              <IconPlus size={14}/>{lang === 'es' ? 'Agregar SAP' : 'Add SAP'}
            </button>
          )}
          {/* "+ Agregar Documento" → upload_document (CEO-ONLY).
              El cliente solo descarga documentos publicados via signed URL. */}
          {can('upload_document') && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setUploadDocOpen(true)}
            >
              <IconPlus size={14}/>{tr(lang,'add_document')}
            </button>
          )}
        </div>
      </div>

      {/* Drawer · Comando C5 RegisterSAPConfirmation — SOLO si el usuario
          puede registrar SAP (CEO-ONLY). Para CLIENT ni se monta. */}
      {can('register_sap') && (
        <AddSAPConfirmationDrawer
          open={sapDrawerOpen}
          onClose={() => {
            setSapDrawerOpen(false);
            setEditingSapInfo(null);
          }}
          lang={lang}
          oc={{ id: oc.id, codigo: oc.code || oc.codigo }}
          expediente={sapDrawerExp && {
            id:     sapDrawerExp.id,
            codigo: sapDrawerExp.codigo || sapDrawerExp.code || sapDrawerExp.id,
            estado: (sapDrawerExp.estado || sapDrawerExp.status || 'REGISTRO').toUpperCase(),
          }}
          lines={sapDrawerLines}
          existingSap={editingSapInfo}
          onSuccess={() => {
            setSapDrawerOpen(false);
            setEditingSapInfo(null);
            setTimeout(() => navigate(0), 200);
          }}
        />
      )}

      {/* Modal compacto Editar SAP eliminado (sprint 2026-05-01).
          Editar SAP ahora abre el AddSAPConfirmationDrawer en modo edit. */}

      {/* Modal subir documento comercial (OC, Proforma, etc.)
          Sprint 2026-05-02: si kind=OC y hay expediente vinculado, el modal
          encadena la extracción IA y nos devuelve el mismatch_payload via
          onAiAnalysisReady → abrimos el wizard de revisión. */}
      {uploadDocOpen && can('upload_document') && (
        <UploadDocumentModal
          open={uploadDocOpen}
          onClose={() => setUploadDocOpen(false)}
          lang={lang}
          ocId={oc?.id}
          expedienteId={
            // Preferimos los expedientes del API; fallback al primer ID del mock.
            (Array.isArray(apiOcExpedientes) && apiOcExpedientes[0]?.id)
            || (Array.isArray(oc?.expedientes) && oc.expedientes[0])
            || null
          }
          contextLabel={oc?.code || oc?.codigo}
          onUploaded={(doc) => {
            // BUG FIX 2026-05-02 (AG-03): hidratamos el listado de
            // documentos en caliente (sin recargar la página). El doc que
            // viene del backend ya trae id/kind/codigo/storage_url.
            if (doc?.id) {
              setApiOcDocs(prev => [doc, ...prev]);
            }
            setUploadDocOpen(false);
            // Sólo recargamos si NO hay flujo IA pendiente (la IA dispara
            // su propia ruta vía onAiAnalysisReady → wizard → onApplied).
            if (!aiReview) {
              // refetch ligero de líneas — por si el backend creó algo
              // (en general al subir doc no, pero defensivo).
              if (apiOc?.id) {
                lineasApi.list({ oc: apiOc.id })
                  .then(r => setApiOcLines(Array.isArray(r) ? r : (r?.results || [])))
                  .catch(() => {});
              }
            }
          }}
          onAiAnalysisReady={(result, file, documentType, docData) => {
            // El modal ya cerró por su cuenta; abrimos el wizard.
            // Sprint 2026-05-02: agregamos el doc subido al listado en
            // caliente para que aparezca en "Documentos comerciales"
            // mientras el wizard está abierto.
            if (docData?.id) {
              setApiOcDocs(prev => [docData, ...prev]);
            }
            setUploadDocOpen(false);
            setAiReview({ result, file, documentType });
          }}
        />
      )}

      {/* Wizard de revisión post-OCR — sólo cuando hay resultado IA pendiente. */}
      {aiReview && can('upload_document') && (
        <DocumentMatchmakerWizard
          expedienteId={
            (Array.isArray(apiOcExpedientes) && apiOcExpedientes[0]?.id)
            || (Array.isArray(oc?.expedientes) && oc.expedientes[0])
            || null
          }
          lang={lang}
          initialFile={aiReview.file}
          initialDocumentType={aiReview.documentType}
          initialResult={aiReview.result}
          onClose={() => setAiReview(null)}
          onApplied={() => {
            setAiReview(null);
            // Re-fetch para que aparezcan las nuevas líneas en Productos OC.
            setTimeout(() => navigate(0), 200);
          }}
        />
      )}

      {/* Sprint 2026-05-02: modal de confirmación para eliminar documento */}
      {confirmDeleteDoc && (
        <div
          onClick={() => !deletingDoc && setConfirmDeleteDoc(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 220,
            background: 'rgba(11,30,58,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 14,
              width: 'min(440px, 96vw)',
              boxShadow: '0 30px 60px -20px rgba(15,27,61,0.55)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)',
                color: 'var(--danger, #DC2626)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <IconTrash size={14}/>
              </div>
              <div>
                <div className="micro" style={{
                  color: 'var(--text-tertiary)', letterSpacing: 1,
                }}>
                  {lang === 'es' ? 'CONFIRMAR ELIMINACIÓN' : 'CONFIRM DELETION'}
                </div>
                <div style={{fontWeight: 800, fontSize: 15, color: 'var(--text-primary, #0B1E3A)'}}>
                  {lang === 'es' ? 'Eliminar documento' : 'Delete document'}
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 12}}>
              <div style={{fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary, #475569)'}}>
                {lang === 'es'
                  ? '¿Querés eliminar este documento? Se va a borrar de la lista y del almacenamiento. Esta acción no se puede deshacer.'
                  : 'Delete this document? It will be removed from the list and the storage bucket. This action cannot be undone.'}
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'color-mix(in oklab, var(--text-primary, #0B1E3A) 4%, transparent)',
                border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div className={'doc-icon ext-' + (confirmDeleteDoc.ext || 'file')}
                     style={{flexShrink: 0}}>
                  {String(confirmDeleteDoc.ext || 'file').toUpperCase()}
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="body-sm" style={{fontWeight: 600, color: 'var(--text-primary, #0B1E3A)'}}>
                    {confirmDeleteDoc.kind || '—'}
                  </div>
                  <div className="caption mono-sm" style={{color: 'var(--text-tertiary)', marginTop: 2}}>
                    {confirmDeleteDoc.code || '—'} · {confirmDeleteDoc.size || '—'}
                  </div>
                </div>
              </div>
              {docError && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: 'color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)',
                  color: 'var(--danger, #991B1B)',
                  border: '1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)',
                  fontSize: 12,
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <IconAlert size={11} style={{flexShrink: 0, marginTop: 2}}/>
                  <div>{docError}</div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklab, var(--text-primary, #0B1E3A) 2%, transparent)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                type="button"
                disabled={deletingDoc}
                onClick={() => setConfirmDeleteDoc(null)}
                className="btn btn-ghost"
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingDoc}
                onClick={confirmDeleteDocAction}
                className="btn"
                style={{
                  fontWeight: 700, minWidth: 120,
                  background: 'var(--danger, #DC2626)',
                  borderColor: 'var(--danger, #DC2626)',
                  color: 'white',
                }}
              >
                {deletingDoc
                  ? (lang === 'es' ? 'Eliminando…' : 'Deleting…')
                  : (lang === 'es' ? 'Eliminar' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sprint 2026-05-02: modal de confirmación para eliminar línea OC */}
      {confirmDeleteLine && (
        <div
          onClick={() => !deletingLine && setConfirmDeleteLine(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 220,
            background: 'rgba(11,30,58,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 14,
              width: 'min(440px, 96vw)',
              boxShadow: '0 30px 60px -20px rgba(15,27,61,0.55)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)',
                color: 'var(--danger, #DC2626)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <IconTrash size={14}/>
              </div>
              <div>
                <div className="micro" style={{
                  color: 'var(--text-tertiary)', letterSpacing: 1,
                }}>
                  {lang === 'es' ? 'CONFIRMAR ELIMINACIÓN' : 'CONFIRM DELETION'}
                </div>
                <div style={{fontWeight: 800, fontSize: 15, color: 'var(--text-primary, #0B1E3A)'}}>
                  {lang === 'es' ? 'Eliminar línea de la OC' : 'Delete OC line'}
                </div>
              </div>
            </div>

            <div style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 12}}>
              <div style={{fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary, #475569)'}}>
                {lang === 'es'
                  ? '¿Querés eliminar esta línea? Se va a soft-deletear (is_active=false) en BD. Para revertir, contactá a sistemas.'
                  : 'Delete this line? It will be soft-deleted (is_active=false) in DB. To revert, contact ops.'}
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'color-mix(in oklab, var(--text-primary, #0B1E3A) 4%, transparent)',
                border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 14,
                fontFamily: 'var(--font-mono)',
              }}>
                <div className="mono-sm" style={{fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #0B1E3A)'}}>
                  {confirmDeleteLine.sku || confirmDeleteLine.product_label || '—'}
                </div>
                <span style={{color: 'var(--text-tertiary)'}}>·</span>
                <div className="caption">
                  {lang === 'es' ? 'Talla' : 'Size'}{' '}
                  <strong style={{color: 'var(--text-primary, #0B1E3A)'}}>
                    {confirmDeleteLine.talla || confirmDeleteLine.size || '—'}
                  </strong>
                </div>
                <span style={{color: 'var(--text-tertiary)'}}>·</span>
                <div className="caption tabular-nums">
                  {lang === 'es' ? 'Cant.' : 'Qty'}{' '}
                  <strong style={{color: 'var(--text-primary, #0B1E3A)'}}>
                    {confirmDeleteLine.qty || 0}
                  </strong>
                </div>
              </div>
              {lineError && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: 'color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)',
                  color: 'var(--danger, #991B1B)',
                  border: '1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)',
                  fontSize: 12,
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <IconAlert size={11} style={{flexShrink: 0, marginTop: 2}}/>
                  <div>{lineError}</div>
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklab, var(--text-primary, #0B1E3A) 2%, transparent)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                type="button"
                disabled={deletingLine}
                onClick={() => setConfirmDeleteLine(null)}
                className="btn btn-ghost"
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingLine}
                onClick={confirmDeleteLineAction}
                className="btn"
                style={{
                  fontWeight: 700, minWidth: 120,
                  background: 'var(--danger, #DC2626)',
                  borderColor: 'var(--danger, #DC2626)',
                  color: 'white',
                }}
              >
                {deletingLine
                  ? (lang === 'es' ? 'Eliminando…' : 'Deleting…')
                  : (lang === 'es' ? 'Eliminar' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI row ─────
          Para CLIENT ocultamos el "Credit clock" (días de crédito gastados)
          porque es métrica interna de cobranza. Dejamos coverage, logistics
          split y financial status — el cliente sí ve su propia factura. */}
      <div className={`grid gap-3 mb-4 ${isClient ? 'col-3' : 'col-4'}`}>
        {/* Coverage — Sprint 2026-05-01: derivamos cobertura desde las
            lineas en vivo. oc.coverage_pct/lines_with_sap del backend NO
            se actualizan automaticamente al confirmar SAP, asi que
            quedaban en 0%. Usamos max(persistido, calculado_live). */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'oc_coverage')}</div>
          {(() => {
            const allLs = (oc.lines || []).filter(l => l.is_active !== false);
            const linesTotal = Math.max(oc.lines_count || 0, allLs.length);
            const linesWithSapLive = allLs.filter(l => !!l.sap).length;
            const linesWithSap = Math.max(oc.lines_with_sap || 0, linesWithSapLive);
            const persistedPct = Number(oc.coverage_pct || 0);
            const livePct = linesTotal > 0 ? linesWithSap / linesTotal : 0;
            const pct = persistedPct > 0 ? persistedPct : livePct;
            const color = pct >= 1 ? 'var(--success)'
                       : pct >= 0.75 ? 'var(--warning)'
                       : 'var(--critical)';
            return (
              <>
                <div className="k-value" style={{ color }}>
                  {Math.round(pct * 100)}%
                </div>
                <div className="k-sub">
                  <span style={{color:'var(--text-secondary)'}}>{linesWithSap}/{linesTotal}</span>
                  <span>{tr(lang,'coverage_sub')}</span>
                </div>
                <div style={{
                  height: 3, background:'var(--border)', borderRadius: 2,
                  marginTop: 10, overflow:'hidden',
                }}>
                  <div style={{
                    height:'100%', width: (pct*100)+'%',
                    background: color,
                  }}/>
                </div>
              </>
            );
          })()}
        </div>

        {/* Logistics split — Sprint 2026-05-01: si los persistidos
            (oc.sea_pct/oc.air_pct) vienen en 0, derivamos del
            transport_mode de las lineas en vivo. */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'logistics_split')}</div>
          {(() => {
            const lns = (oc.lines || []).filter(l => l.is_active !== false);
            const totalQty = lns.reduce((a, l) => a + Number(l.qty || 0), 0);
            const seaQty = lns
              .filter(l => /^(MARITIMO|SEA)$/i.test(String(l.transport_mode || "")))
              .reduce((a, l) => a + Number(l.qty || 0), 0);
            const airQty = lns
              .filter(l => /^(AEREO|AIR)$/i.test(String(l.transport_mode || "")))
              .reduce((a, l) => a + Number(l.qty || 0), 0);
            const liveSea = totalQty > 0 ? seaQty / totalQty : 0;
            const liveAir = totalQty > 0 ? airQty / totalQty : 0;
            const persistedSea = Number(oc.sea_pct || 0);
            const persistedAir = Number(oc.air_pct || 0);
            const seaPct = persistedSea > 0 ? persistedSea : liveSea;
            const airPct = persistedAir > 0 ? persistedAir : liveAir;
            return (
              <>
                <div className="k-value" style={{display:'flex', alignItems:'baseline', gap:6, fontSize: 28}}>
                  <span style={{color:'var(--brand-accent)'}}>{Math.round(seaPct*100)}%</span>
                  <span className="caption" style={{fontSize:11}}>{tr(lang,'transport_sea')}</span>
                  <span className="caption" style={{color:'var(--text-tertiary)', margin:'0 4px'}}>/</span>
                  <span style={{color:'var(--brand-primary)'}}>{Math.round(airPct*100)}%</span>
                  <span className="caption" style={{fontSize:11}}>{tr(lang,'transport_air')}</span>
                </div>
                <div className="split-bar" style={{marginTop:12}}>
                  <div className="seg sea" style={{width: (seaPct*100)+'%'}}/>
                  <div className="seg air" style={{width: (airPct*100)+'%'}}/>
                </div>
              </>
            );
          })()}
        </div>

        {/* Financial — Sprint 2026-05-01: si total_invoiced/balance vienen
            en 0 (OC recien creada, sin factura emitida), mostramos el valor
            real del pedido derivado de las lineas (sum unit_price * qty) y
            calculamos pendiente = orderValue - total_paid. Si ya hay
            facturacion, priorizamos los campos persistidos del backend. */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'financial_status')}</div>
          {(() => {
            const invoiced     = Number(oc.total_invoiced || 0);
            const paid         = Number(oc.total_paid || 0);
            const persistedBal = Number(oc.balance || 0);
            const linesValue = (oc.lines || []).reduce((acc, l) => {
              const tp = Number(l.total_price || 0);
              if (tp > 0) return acc + tp;
              return acc + Number(l.qty || 0) * Number(l.unit_price || 0);
            }, 0);
            // Headline: prioriza facturado real > valor del pedido.
            const headline = invoiced > 0 ? invoiced : linesValue;
            // Pendiente: si hay balance persistido > 0, ese gana.
            // Si no, derivamos como headline - paid.
            const pendiente = persistedBal > 0 ? persistedBal : Math.max(0, headline - paid);
            return (
              <>
                <div className="k-value" style={{fontSize: 24, whiteSpace:'nowrap'}}>
                  {fmtMoney(headline)}
                </div>
                <div className="k-sub" style={{display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2}}>
                  <span><span style={{color:'var(--success)'}}>{fmtMoney(paid)}</span> {tr(lang,'paid_lbl').toLowerCase()}</span>
                  <span><span style={{color:'var(--brand-primary)'}}>{fmtMoney(pendiente)}</span> {tr(lang,'pending').toLowerCase()}</span>
                </div>
              </>
            );
          })()}
        </div>

        {/* Credit clock — métrica interna de cobranza: CEO-ONLY. */}
        {isAdmin && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang,'credit_clock')}</div>
            <div className="k-value" style={{display:'flex', alignItems:'baseline', gap:6}}>
              <CreditDot band={oc.credit_band}/>
              <span style={{
                color: oc.credit_band === 'RED' ? 'var(--critical)' : oc.credit_band === 'AMBER' ? 'var(--warning)' : 'var(--success)'
              }}>{oc.max_credit_days}d</span>
            </div>
            <div className="k-sub">
              {oc.max_credit_days > 0
                ? <span>{tr(lang,'credit_triggered')}</span>
                : <span>{lang==='es'?'Sin facturas activas':'No active invoices'}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Main content: Lines table + Docs sidebar ───── */}
      <div className="grid gap-3" style={{gridTemplateColumns: '1fr 340px', alignItems:'start'}}>
        {/* Lines grouped by SAP */}
        <div className="card">
          <div className="card-head" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
            <div>
              <div className="card-title">{tr(lang,'oc_lines')}</div>
              <div className="card-subtitle">{tr(lang,'grouped_by_sap')} · {oc.lines_count} {tr(lang,'lines_count').toLowerCase()}</div>
            </div>
            <div className="ceo-chip-group" style={{marginLeft:'auto'}}>
              <button data-active={!showOrphansOnly} onClick={()=>setShowOrphansOnly(false)}>
                {lang==='es'?'Todas':'All'}
              </button>
              <button data-active={showOrphansOnly} onClick={()=>setShowOrphansOnly(true)}>
                {tr(lang,'line_status_orphan')}
              </button>
            </div>
          </div>

          <div>
            {filteredGroups.map((g, gi) => {
              const exp = g.exp_id ? EXPEDIENTES.find(e => e.id === g.exp_id) : null;
              const isOpen = openSap === (g.sap || '__orphan_'+gi);
              const key = g.sap || '__orphan_'+gi;
              return (
                <div key={key} className="sap-group" data-orphan={!g.sap}>
                  {/* Group header = SAP chip */}
                  <div className="sap-group-head" onClick={() => setOpenSap(isOpen ? null : key)}>
                    <div className="flex ai-center gap-3" style={{flex: 1, minWidth: 0}}>
                      <IconChevDown size={14} style={{
                        color:'var(--text-tertiary)',
                        transform: isOpen ? 'none' : 'rotate(-90deg)',
                        transition: 'transform 160ms'
                      }}/>
                      {g.sap ? (
                        <>
                          <a
                            className="sap-link"
                            onClick={(e)=>{ e.stopPropagation(); onOpenExpediente(g.exp_id); }}
                            title={tr(lang,'open_expediente')}
                          >
                            <IconFolder size={12}/> {g.sap}
                          </a>
                          {/* Pencil — editar número SAP del grupo. CEO-ONLY. */}
                          {can('register_sap') && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title={lang === 'es' ? 'Editar número SAP' : 'Edit SAP number'}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditSapModal(
                                  g.sap,
                                  g.exp_id,
                                  (g.lines || []).map(l => l.id),
                                );
                              }}
                              style={{
                                padding: '2px 6px', color: '#481EE3',
                                background: 'transparent', border: 0,
                                cursor: 'pointer',
                              }}
                            >
                              <IconPencil size={11}/>
                            </button>
                          )}
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>→</span>
                          <span className="caption">{exp?.ref}</span>
                          {/* Sprint 2026-05-01: transport_mode = null no implica
                              MARITIMO (era el default antes). Si la linea aun
                              no tiene modo definido (ningun artefacto AR-04 lo
                              seteo), mostramos "Modo pendiente" con borde
                              dashed en lugar de asumir transporte por defecto. */}
                          {(() => {
                            const tm = (g.transport_mode || '').toUpperCase();
                            if (tm === 'AEREO' || tm === 'AIR') {
                              return (
                                <span className="transport-chip air">
                                  <IconPlane size={11}/>
                                  {tr(lang,'transport_air')}
                                </span>
                              );
                            }
                            if (tm === 'MARITIMO' || tm === 'SEA') {
                              return (
                                <span className="transport-chip sea">
                                  <IconShip size={11}/>
                                  {tr(lang,'transport_sea')}
                                </span>
                              );
                            }
                            return (
                              <span
                                className="caption"
                                style={{
                                  color: 'var(--text-tertiary)',
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  border: '1px dashed var(--border)',
                                  fontSize: 10,
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.4,
                                }}
                                title={lang === 'es'
                                  ? 'Definir modo en el artefacto AR-04 (Confirmacion SAP)'
                                  : 'Set mode in AR-04 artifact (SAP Confirmation)'}
                              >
                                {lang === 'es' ? 'Modo pendiente' : 'Mode pending'}
                              </span>
                            );
                          })()}
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>
                            {tr(lang,'prod_date')}: <span className="tabular">{g.production_date}</span>
                          </span>
                          {exp && <StatusBadge status={exp.status} lang={lang}/>}
                        </>
                      ) : (
                        <>
                          <span className="sap-link orphan">
                            <IconAlert size={12}/> {tr(lang,'line_status_orphan')}
                          </span>
                          <span className="caption" style={{color:'var(--warning)'}}>
                            {tr(lang,'pending_sap')}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex ai-center gap-3" style={{marginLeft:'auto'}}>
                      <span className="caption" style={{color:'var(--text-tertiary)'}}>
                        {g.lines.length} {tr(lang,'lines_count').toLowerCase()} · {g.total_qty.toLocaleString()} u
                      </span>
                      <span className="td-money" style={{minWidth:110, textAlign:'right'}}>{fmtMoney(g.total_value)}</span>
                    </div>
                  </div>

                  {/* Lines — vista resumida del grupo SAP.
                      Sólo PRODUCTO, TALLA, CANTIDAD. La gestión completa
                      (precios, diferido, etc.) vive en "Productos OC"
                      más abajo, así esta sección queda limpia. */}
                  {isOpen && (
                    <div className="sap-lines">
                      <div className="sap-lines-head" style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 90px 90px',
                        gap: 12,
                        padding: '8px 14px',
                      }}>
                        <div style={{ textAlign: 'left' }}>
                          {tr(lang,'product_line')}
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          {lang==='es' ? 'Talla' : 'Size'}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {lang==='es' ? 'Cant.' : 'Qty'}
                        </div>
                      </div>
                      {g.lines.map(l => (
                        <div key={l.id} className="sap-line" style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 90px 90px',
                          gap: 12,
                          padding: '10px 14px',
                          alignItems: 'center',
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="body-sm" style={{
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>{l.product}</div>
                            <div className="caption" style={{
                              fontFamily: 'var(--font-mono)', marginTop: 2,
                            }}>{l.sku}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <span className="size-chip">{l.size}</span>
                          </div>
                          <div style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                          }}>
                            {Number(l.qty || 0).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Totals row */}
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'14px 22px', borderTop:'1px solid var(--divider)',
            background:'var(--bg-alt)',
          }}>
            <span className="micro">{lang==='es'?'Valor total de la Orden':'Total order value'}</span>
            <span style={{font:'800 18px/1 var(--font-display)', fontVariantNumeric:'tabular-nums'}}>{fmtMoney(computedTotal)}</span>
          </div>
        </div>

        {/* Documents hub */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'documents_hub')}</div>
              <div className="card-subtitle">{oc.docs.length} {lang==='es'?'archivos':'files'}</div>
            </div>
          </div>
          <div style={{padding:'8px 0'}}>
            {docError && (
              <div style={{
                margin: '0 22px 10px',
                padding: '8px 12px',
                borderRadius: 8,
                background: 'color-mix(in oklab, var(--danger, #DC2626) 12%, transparent)',
                color: 'var(--danger, #991B1B)',
                border: '1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)',
                fontSize: 12,
                display: 'flex', alignItems: 'flex-start', gap: 6,
              }}>
                <IconAlert size={11} style={{flexShrink: 0, marginTop: 2}}/>
                <div style={{flex: 1}}>{docError}</div>
                <button
                  type="button"
                  onClick={() => setDocError(null)}
                  style={{background:'transparent', border:0, cursor:'pointer', color:'inherit'}}
                >
                  <IconX size={10}/>
                </button>
              </div>
            )}
            {oc.docs.length === 0 && (
              <div className="caption" style={{
                padding: '12px 22px',
                color: 'var(--text-tertiary)',
                textAlign: 'center',
              }}>
                {lang === 'es' ? 'Aún no hay documentos.' : 'No documents yet.'}
              </div>
            )}
            {oc.docs.map(d => {
              // Defensivo: cualquier campo faltante cae a un valor seguro
              // para no romper la UI con docs legacy o shape inesperado.
              const ext = String(d.ext || 'file').toLowerCase();
              const isViewing = viewingDocId === d.id;
              const canMutate = !isClient && can('upload_document');
              return (
                <div
                  key={d.id}
                  className="doc-item"
                  onClick={() => handleViewDoc(d)}
                  style={{
                    cursor: 'pointer',
                    opacity: isViewing ? 0.7 : 1,
                    transition: 'opacity 0.15s',
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleViewDoc(d);
                    }
                  }}
                  title={lang === 'es' ? 'Click para abrir el documento' : 'Click to open document'}
                >
                  <div className={'doc-icon ext-' + ext}>
                    {ext.toUpperCase()}
                  </div>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="body-sm" style={{fontWeight: 500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {d.kind || '—'}
                    </div>
                    <div className="caption" style={{marginTop: 2, fontFamily:'var(--font-mono)'}}>
                      {d.code || '—'}
                    </div>
                    <div className="caption" style={{color:'var(--text-tertiary)', marginTop: 3}}>
                      {d.date || '—'} · {d.size || '—'} · {d.author || '—'}
                    </div>
                  </div>
                  <div style={{display:'flex', gap: 4, alignItems:'center'}}>
                    <button
                      type="button"
                      className="icon-btn"
                      title={lang === 'es' ? 'Abrir documento' : 'Open document'}
                      disabled={isViewing}
                      onClick={(e) => { e.stopPropagation(); handleViewDoc(d); }}
                    >
                      <IconEye size={13}/>
                    </button>
                    {canMutate && (
                      <button
                        type="button"
                        className="icon-btn"
                        title={lang === 'es' ? 'Eliminar documento' : 'Delete document'}
                        onClick={(e) => { e.stopPropagation(); handleDeleteDoc(d); }}
                        style={{color: 'var(--danger, #DC2626)'}}
                      >
                        <IconTrash size={13}/>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expedientes pill list */}
          <div style={{borderTop:'1px solid var(--divider)', padding: '16px 22px'}}>
            <div className="micro" style={{marginBottom: 10}}>{tr(lang,'expedientes_in_oc')}</div>
            {oc.expedientes.map(eid => {
              const e = EXPEDIENTES.find(x => x.id === eid);
              if (!e) return null;
              return (
                <div key={eid} className="exp-link-row" onClick={()=>onOpenExpediente(eid)}>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="flex ai-center gap-2">
                      <IconFolder size={12} style={{color:'var(--text-tertiary)'}}/>
                      <span className="body-sm" style={{fontWeight: 600}}>{e.ref}</span>
                      {e.sap && <span className="caption" style={{fontFamily:'var(--font-mono)'}}>{e.sap}</span>}
                    </div>
                    <div className="caption" style={{marginTop: 2}}>
                      {e.origin} → {e.destination}
                    </div>
                  </div>
                  <StatusBadge status={e.status} lang={lang}/>
                  <IconChevRight size={13} style={{color:'var(--text-tertiary)'}}/>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          Tabla plana "Productos OC":
            · ADMIN → tabla completa editable con columnas diferido + eliminar
            · CLIENT → tabla de solo-lectura, sin diferido, sin eliminar
          ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{marginTop: 14}}>
        <div className="card-head" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div className="card-title">{lang==='es'?'Productos OC':'PO Products'}</div>
            <div className="card-subtitle">
              {allLines.length} {lang==='es'?'líneas':'lines'}
              {isAdmin && <> · {lang==='es'?'editable':'editable'}</>}
              {' '}· {fmtMoney(computedTotal)} {lang==='es'?'total':'total'}
              {/* El "diferido" es concepto interno — nunca se muestra a CLIENT. */}
              {isAdmin && computedDeferred > 0 && <> · <span style={{color:'var(--brand-accent-dark,#0E8A6D)'}}>🔒 {fmtMoney(computedDeferred)} {lang==='es'?'diferido':'deferred'}</span></>}
            </div>
          </div>
          {/* "+ Agregar producto" → add_oc_line (CEO-ONLY). */}
          {can('add_oc_line') && (
            <button className="btn btn-primary" onClick={()=>setShowAddProduct(true)}>
              <IconPlus size={14}/> {lang==='es'?'Agregar producto':'Add product'}
            </button>
          )}
        </div>
        <div style={{overflowX:'auto'}}>
          <table className="oc-products-table" data-viewport={isClient ? 'CLIENT' : 'ADMIN'}>
            <thead>
              <tr>
                <th style={{width:140}}>SKU</th>
                <th>{lang==='es'?'Nombre':'Name'}</th>
                <th style={{width:70, textAlign:'center'}}>{lang==='es'?'Talla':'Size'}</th>
                <th style={{width:80, textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
                <th style={{width:140, textAlign:'right'}}>{lang==='es'?'Precio':'Price'}</th>
                <th style={{width:120, textAlign:'right'}}>{lang==='es'?'Total':'Total'}</th>
                <th style={{width:140}}>SAP</th>
                {/* Columnas deferred qty/price: CEO-ONLY. */}
                {isAdmin && (
                  <th style={{width:90, textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Cant. dif.':'Def. qty'}
                  </th>
                )}
                {isAdmin && (
                  <th style={{width:120, textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Precio dif.':'Def. price'}
                  </th>
                )}
                {/* Columna acciones (botón eliminar): requiere delete_oc_line. */}
                {can('delete_oc_line') && <th style={{width:44}}></th>}
              </tr>
            </thead>
            <tbody>
              {allLines.map(l => (
                <tr key={l.id} data-orphan={!l.sap}>
                  <td className="mono" style={{fontSize:11.5}}>{l.sku}</td>
                  <td>{l.product}</td>
                  <td style={{textAlign:'center'}}>
                    <span className="size-chip">{l.size}</span>
                  </td>
                  {/* Qty editable → capability edit_oc_line_qty. */}
                  {can('edit_oc_line_qty') ? (
                    <td className="td-edit" style={{textAlign:'right'}}>
                      <input className="edit-input tabular" type="number" min={0}
                        value={l.qty}
                        onChange={e=>updateLine(l.id, { qty: +e.target.value })}/>
                    </td>
                  ) : (
                    <td className="td-num" style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                      {l.qty.toLocaleString()}
                    </td>
                  )}
                  {/* Precio unitario editable → capability edit_oc_line_unit_price. */}
                  {can('edit_oc_line_unit_price') ? (
                    <td className="td-edit" style={{textAlign:'right'}}>
                      <div className="edit-input-money" style={{
                        // Prevenir que el input se recorte: que ocupe todo
                        // el ancho disponible de la celda y los dígitos no
                        // queden cortados (síntoma reportado: "$ 14,9_").
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        width: '100%', justifyContent: 'flex-end',
                      }}>
                        <span>$</span>
                        <input className="edit-input tabular" type="number" min={0} step="0.01"
                          value={l.unit_price}
                          onChange={e=>updateLine(l.id, { unit_price: +e.target.value })}
                          style={{
                            width: '100%', minWidth: 80, maxWidth: 110,
                            textAlign: 'right',
                          }}/>
                      </div>
                    </td>
                  ) : (
                    <td className="td-num" style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color:'var(--text-secondary)'}}>
                      ${l.unit_price.toFixed(2)}
                    </td>
                  )}
                  <td className="td-money">{fmtMoney(l.qty * l.unit_price)}</td>
                  <td>
                    {l.sap ? (
                      <a className="sap-link sap-link-inline" onClick={()=>l.exp_id && onOpenExpediente(l.exp_id)} title={tr(lang,'open_expediente')}>
                        <IconFolder size={11}/> {l.sap}
                      </a>
                    ) : (
                      <span className="caption" style={{color:'var(--warning)', display:'inline-flex', alignItems:'center', gap:4}}>
                        <IconAlert size={11}/> {tr(lang,'line_status_orphan')}
                      </span>
                    )}
                  </td>
                  {/* Inputs deferred qty / deferred price: CEO-ONLY. */}
                  {isAdmin && (
                    <td className="td-edit" style={{textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 4%, transparent)'}}>
                      <input className="edit-input tabular" type="number" min={0} max={l.qty}
                        value={l.deferred_qty || 0}
                        onChange={e=>updateLine(l.id, { deferred_qty: +e.target.value })}
                        style={{ width: '100%', minWidth: 60, textAlign: 'right' }}/>
                    </td>
                  )}
                  {isAdmin && (
                    <td className="td-edit" style={{textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 4%, transparent)'}}>
                      <div className="edit-input-money" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        width: '100%', justifyContent: 'flex-end',
                      }}>
                        <span>$</span>
                        <input className="edit-input tabular" type="number" min={0} step="0.01"
                          value={l.deferred_unit_price || 0}
                          onChange={e=>updateLine(l.id, { deferred_unit_price: +e.target.value })}
                          style={{
                            width: '100%', minWidth: 70, maxWidth: 90,
                            textAlign: 'right',
                          }}/>
                      </div>
                    </td>
                  )}
                  {/* Botón eliminar → delete_oc_line (CEO-ONLY). */}
                  {can('delete_oc_line') && (
                    <td style={{textAlign:'center'}}>
                      <button className="icon-btn" title={lang==='es'?'Eliminar':'Remove'}
                        onClick={()=>removeLine(l.id)}
                        style={{width:26, height:26, color:'var(--text-tertiary)'}}>
                        <IconX size={12}/>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {allLines.length === 0 && (
                <tr><td colSpan={isAdmin ? 10 : 7} style={{textAlign:'center', padding:'32px', color:'var(--text-tertiary)'}}>
                  {lang==='es'
                    ? (isClient ? 'Sin productos en esta orden.' : 'Sin productos. Agrega el primero.')
                    : (isClient ? 'No products in this order.' : 'No products yet. Add your first.')}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{textAlign:'right', fontWeight:600, padding:'14px 12px'}}>
                  {lang==='es'?'Total orden':'Order total'}
                </td>
                <td className="td-money" style={{fontSize:15, fontWeight:700}}>{fmtMoney(computedTotal)}</td>
                {/* Totales de "diferido" en el tfoot: CEO-ONLY. */}
                {isAdmin && (
                  <td colSpan={2} style={{textAlign:'right', fontWeight:600, color:'var(--brand-accent-dark,#0E8A6D)', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Total diferido':'Deferred total'}
                  </td>
                )}
                {isAdmin && (
                  <td className="td-money" style={{fontWeight:700, color:'var(--brand-accent-dark,#0E8A6D)', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    {fmtMoney(computedDeferred)}
                  </td>
                )}
                {/* Celda vacía para alinear con la columna de acciones (solo ADMIN). */}
                {can('delete_oc_line') && (
                  <td style={{background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}/>
                )}
                {/* CLIENT: no tiene columnas deferred ni acciones → el colspan ya cuadra. */}
                {isClient && <td/>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modal "Agregar producto" solo se monta si ADMIN puede agregar línea. */}
      {can('add_oc_line') && showAddProduct && (
        <AddOCProductModal
          open={showAddProduct}
          lang={lang}
          clientId={oc?.client_id || apiOcClient?.id || null}
          clientLabel={apiOcClient?.razon_social
                    || apiOcClient?.nombre
                    || apiOcClient?.codigo
                    || oc?.client
                    || ""}
          onPick={addProduct}
          onClose={()=>setShowAddProduct(false)}
        />
      )}
    </div>
  );
}
