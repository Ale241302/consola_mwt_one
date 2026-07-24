// ─────────────────────────────────────────────────────────────
// ProductFormView — Alta / Edición de Producto (FULL PAGE · sin modales)
// Agente responsable: [AG-FRONTEND]
//
// Ruta /productos/nuevo            → modo crear   (single scroll)
// Ruta /productos/:productId       → modo editar (3 tabs):
//     · Tab 1 — Detalles y Especificaciones
//     · Tab 2 — Gobernanza y Precios
//     · Tab 3 — Expedientes (trazabilidad)
//
// Secciones (tarjetas blancas sobre fondo de la app):
//   A · Info Base + Media (dropzones)
//   B · 14 atributos estrictos de calzado
//     (riesgo es MULTI-CHECKBOX — no single-select)
//   C · Relaciones logísticas (Motor de Tallas + Nodos)
//   D · Gobernanza (master toggle + per-client · pricing CEO-ONLY)
//
// Tokens visuales:
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
//   Critical #DC2626 (CEO-ONLY)
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconUpload, IconCheck, IconX, IconPaperclip,
  IconPackage, IconShield, IconDollar, IconLock, IconSparkle,
  IconFileText, IconSliders, IconFolder, IconChevLeft, IconRefresh,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  BRANDS, BRAND_ATTRIBUTES, BRAND_PRODUCTS, BRAND_PRICING,
  SIZES, SIZE_SYSTEMS, PRODUCT_SIZES, PRODUCT_NODE_ASSIGNMENTS,
  PRODUCT_CLIENT_VISIBILITY, NODES, CLIENTS,
} from "../data/mockData.js";
import ProductExpedientesTab from "../components/productos/ProductExpedientesTab.jsx";
import { useRole } from "../context/RoleContext.jsx";
import {
  productosApi, marcasApi, tallasApi, nodosApi, clientesApi,
  productoAliasesApi, ncmApi, sizingApi, sizingFamiliasApi, tiposProductoCatApi, tiposProductoMatrizApi,
  attrOptionsApi,
  apiFetch, getToken,
} from "../lib/api.js";
// Sprint 2026-07-16 · drawers embebidos para crear/editar NCM y tallas sin
// salir del formulario de producto (reusa los editores de /ncm y /tallas).
import { NcmFormDrawer } from "./NcmEngine.jsx";
import { TallaFormDrawer, TipoQuickModal, FamiliaQuickModal } from "./SizingEngine.jsx";
import CreateBrandDrawer from "../components/brands/CreateBrandDrawer.jsx";

// Backend → shape lista compacta para los grids
// "Excepciones por cliente" / "Override por cliente".
//
// Sprint Parent-Child (2026-04-29): incluye parent_id y parent_name
// para que el grid pueda renderizar la jerarquía y aplicar herencia
// por defecto (la subsidiaria hereda visibilidad / precio del padre).
function adaptClienteForGrid(c) {
  return {
    id:           c.id || c.uuid,
    name:         c.nombre_comercial || c.razon_social || '—',
    parent_id:    c.parent_id || null,
    parent_name:  null,   // se rellena en orderClientsHierarchy()
  };
}

// Ordena clientes con padres primero, seguidos de sus subsidiarias
// (sangradas). Pre-resuelve parent_name para mostrar contexto.
function orderClientsHierarchy(clients) {
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
import FileUploader from "../components/common/FileUploader.jsx";
import FilePreview  from "../components/common/FilePreview.jsx";
import PriceMatrixCompact from "../components/marluvas/PriceMatrixCompact.jsx";
import SkuSizesPanel from "../components/marluvas/SkuSizesPanel.jsx";
import { cascadeRow, computeMatrixFromInputs } from "../lib/marluvasPricing.js";
import { BANDAS_MARLUVAS, bandaForTC, FACTOR_COMISION, INDICE_ME_90 } from "../constants/marluvas.js";
import { useExchangeRateUSDBRL } from "../hooks/useExchangeRateUSDBRL.js";

// TABS canónicos del detalle de producto. La visibilidad se recorta
// dinámicamente según el rol (POL_VISIBILIDAD):
//   · 'detalles'    → PUBLIC / PARTNER_B2B / INTERNAL → todos la ven
//   · 'gobernanza'  → INTERNAL / CEO-ONLY             → solo staff
//   · 'expedientes' → INTERNAL                         → solo staff
// La whitelist para CLIENT B2B es ['detalles'].
const TABS = [
  { id:'detalles',   es:'Detalles y Especificaciones', en:'Details & Specs' },
  { id:'gobernanza', es:'Gobernanza y Precios',       en:'Governance & Pricing' },
  { id:'expedientes',es:'Expedientes',                 en:'Files' },
];
const CLIENT_VISIBLE_TABS = new Set(['detalles']);

// ── Sprint 2026-07-22 · helpers del Motor de Tallas ──────────────────
// Nueva semántica: la talla se clasifica por FK (marca_id + familia_id);
// el nombre legacy vive en metadata.familia (sincronizada por el backend).
// · esDalupo / sinDalupo → se omite cualquier valor "DALUPO".
const esDalupo = (v) => /dalupo/i.test(String(v ?? ''));
const sinDalupo = (arr) => (Array.isArray(arr) ? arr : []).filter(v => !esDalupo(v));

export default function ScreenProductFormView() {
  const navigate = useNavigate();
  // Fable5-QA 2026-06-12: si el producto se abrio desde el Portal B2B
  // (/portal/productos/:id), el boton Volver debe regresar al Portal,
  // no al catalogo interno /productos.
  const location = useLocation();
  const backTarget = location.pathname.startsWith('/portal') ? '/portal' : '/productos';
  const { lang } = useOutletContext();
  const { productId } = useParams();

  const isEdit = Boolean(productId);

  // ── Fetch real al backend en modo EDIT (antes leía BRAND_PRODUCTS mock,
  //    por eso productos creados vía API mostraban form vacío) ──
  const [existing, setExisting] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);

  // Clientes reales del backend para los grids "Excepciones por cliente"
  // y "Override por cliente". Fallback al mock CLIENTS si el endpoint
  // falla o devuelve vacío (preserva demos sin BD seedeada).
  const [realClients, setRealClients] = useState([]);
  useEffect(() => {
    let cancelled = false;
    // is_parent=all → incluye padres + subsidiarias en el mismo listado
    // (Parent-Child sprint). orderClientsHierarchy las agrupa con el
    // padre arriba y la subsidiaria sangrada debajo.
    clientesApi.list({ is_parent: "all" })
      .then(rows => {
        if (cancelled) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        const adapted = arr.map(adaptClienteForGrid);
        const ordered = orderClientsHierarchy(adapted);
        if (ordered.length > 0) setRealClients(ordered);
        else setRealClients(CLIENTS);
      })
      .catch(() => { if (!cancelled) setRealClients(CLIENTS); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isEdit) { setExisting(null); return; }
    let cancelled = false;
    setLoadingExisting(true);
    productosApi.get(productId)
      .then(p => {
        if (cancelled) return;
        // Adapter: el backend guarda los 14 atributos técnicos dentro de
        // `especificaciones` (JSON). Los promovemos al top-level del objeto
        // `existing` para que el resto del form siga leyéndolos como antes.
        const e = p.especificaciones || {};
        setExisting({
          ...p,
          tipo_calzado:         e.tipo_calzado,
          cubrepuntera:         e.cubrepuntera,
          tipo_puntera:         e.tipo_puntera,
          antiperforante:       e.antiperforante,
          protector_metatarsal: e.protector_metatarsal,
          capellada:            e.capellada,
          disipativo_energia:   e.disipativo_energia,
          suela:                e.suela,
          normativa:            e.normativa,
          cierre:               e.cierre,
          color:                e.color,
          segmento:             e.segmento,
          materiales_circulares: e.materiales_circulares,
          plantilla_interna:    e.plantilla_interna,
          ncm:                  e.ncm,
          riesgo:               e.riesgo || [],
          // Sizes vienen en p.tallas (UUIDs) o en e.sizes (mock legacy)
          // Nodes vienen en e.nodes (no hay columna dedicada)
          // Visibility/pricing en e.visibility / e.client_prices
        });
        setLoadingExisting(false);
      })
      .catch(err => {
        console.error('[productos] fetch failed:', err);
        setLoadingExisting(false);
      });
    return () => { cancelled = true; };
  }, [isEdit, productId]);

  // ── Estado del formulario ────────
  const [sku, setSku] = useState(existing?.sku || '');
  const [nombre, setNombre] = useState(existing?.nombre || '');
  // Si es edit usamos `marca_id` del backend (UUID real). Si es create
  // dejamos vacío y autoseleccionamos la primera marca real cuando carguen.
  const [brandId, setBrandId] = useState(existing?.marca_id || existing?.brand_id || '');
  // Antes guardaba File objects locales (que solo viajaban como nombres
  // y nunca se subían). Ahora guardamos las KEYS reales de MinIO que
  // devuelve el backend después de un PUT firmado.
  // - galleryKeys[0] se persiste también en `imagen_url` (compat legacy).
  // - fichaKey se persiste en `ficha_url`.
  const [galleryKeys, setGalleryKeys] = useState(() => {
    if (!existing) return [];
    const fromEspec = (existing.especificaciones?.gallery || []).filter(Boolean);
    if (fromEspec.length) return fromEspec;
    return existing.imagen_url ? [existing.imagen_url] : [];
  });
  // Soporta múltiples PDFs. Por compat legacy, si solo hay uno se persiste
  // también en `ficha_url` (string). El array completo va en
  // `especificaciones.fichas` para mantener galería de PDFs.
  const [fichaKeys, setFichaKeys] = useState(() => {
    if (!existing) return [];
    const fromEspec = (existing.especificaciones?.fichas || []).filter(Boolean);
    if (fromEspec.length) return fromEspec;
    return existing.ficha_url ? [existing.ficha_url] : [];
  });

  // Helper: normaliza un valor que puede venir del backend como string
  // (legacy single-select) o como array (nuevo multi-select). Devuelve
  // siempre un array. Útil para los 4 campos multi-select del producto.
  const asMultiArray = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v == null || v === '' || v === 'No') return [];
    return [String(v)];
  };

  // Atributos (Sección B) — single-select. disipativo_energia, normativa
  // y segmento se promovieron a multi-select y viven en estados aparte
  // (paralelos a `riesgos`) más abajo.
  const [attrs, setAttrs] = useState({
    tipo_calzado:         existing?.tipo_calzado         || BRAND_ATTRIBUTES.tipo_calzado[0],
    cubrepuntera:         existing?.cubrepuntera         || 'No',
    tipo_puntera:         existing?.tipo_puntera         || 'No tiene',
    antiperforante:       existing?.antiperforante       || 'No',
    protector_metatarsal: existing?.protector_metatarsal || 'No',
    capellada:            existing?.capellada            || BRAND_ATTRIBUTES.capellada[0],
    suela:                existing?.suela                || BRAND_ATTRIBUTES.suela[0],
    cierre:               existing?.cierre               || BRAND_ATTRIBUTES.cierre[0],
    color:                existing?.color                || BRAND_ATTRIBUTES.color[0],
    materiales_circulares:existing?.materiales_circulares|| 'No',
    plantilla_interna:    existing?.plantilla_interna    || 'No',
    ncm:                  existing?.ncm                  || '',
  });
  // ── Multi-select states ───────────────────────────────────────────
  // Sprint 2026-05-02: disipativo_energia, normativa y segmento pasaron
  // de single-select a multi-checkbox por solicitud CEO. Backward compat:
  // si el backend devuelve string (legacy) lo wrappeamos en array.
  const [riesgos,     setRiesgos]     = useState(asMultiArray(existing?.riesgo));
  const [disipativos, setDisipativos] = useState(asMultiArray(existing?.disipativo_energia));
  const [normativas,  setNormativas]  = useState(asMultiArray(existing?.normativa));
  const [segmentos,   setSegmentos]   = useState(asMultiArray(existing?.segmento));
  // Sprint 2026-07-22 · FAMILIA de línea del producto (Sección A, junto
  // a Marca). Ahora es FK real: familiaIdSel (uuid) apunta a
  // /sizing/familias/; las tallas de Sección C se filtran por
  // talla.familia_id. `familiaSel` (nombre) se conserva sólo para compat
  // de guardado (especificaciones.familia).
  const [familiaSel,   setFamiliaSel]   = useState(existing?.especificaciones?.familia || '');
  const [familiaIdSel, setFamiliaIdSel] = useState(existing?.especificaciones?.familia_id || null);
  // Sprint 2026-07-22 · fase 3 · TIPO DE PRODUCTO del producto (Sección A,
  // antes de Marca). Código de /sizing/tipos-producto/; rige — junto con
  // la familia — el filtro de tallas de la Sección C. Fallback legacy:
  // si el producto tiene tipo_calzado (atributo viejo) se asume 'calzado'.
  const [tipoSel,      setTipoSel]      = useState(
    existing?.especificaciones?.tipo_producto
    || (existing?.especificaciones?.tipo_calzado ? 'calzado' : ''));

  // ── Repuebla TODOS los campos cuando llega `existing` del fetch async ──
  // Los useState() iniciales corrieron con existing=null; ahora que tenemos
  // los datos reales del backend, sincronizamos cada campo. Sin esto, el
  // form se quedaría vacío en modo edit hasta que el usuario tocara algo.
  useEffect(() => {
    if (!existing) return;
    setSku(existing.sku || '');
    setNombre(existing.nombre || '');
    setBrandId(existing.marca_id || '');
    const espGallery = existing.especificaciones?.gallery || [];
    setGalleryKeys(espGallery.length ? espGallery
      : (existing.imagen_url ? [existing.imagen_url] : []));
    const espFichas = existing.especificaciones?.fichas || [];
    setFichaKeys(espFichas.length ? espFichas
      : (existing.ficha_url ? [existing.ficha_url] : []));
    setAttrs({
      tipo_calzado:         existing.tipo_calzado         || BRAND_ATTRIBUTES.tipo_calzado[0],
      cubrepuntera:         existing.cubrepuntera         || 'No',
      tipo_puntera:         existing.tipo_puntera         || 'No tiene',
      antiperforante:       existing.antiperforante       || 'No',
      protector_metatarsal: existing.protector_metatarsal || 'No',
      capellada:            existing.capellada            || BRAND_ATTRIBUTES.capellada[0],
      suela:                existing.suela                || BRAND_ATTRIBUTES.suela[0],
      cierre:               existing.cierre               || BRAND_ATTRIBUTES.cierre[0],
      color:                existing.color                || BRAND_ATTRIBUTES.color[0],
      materiales_circulares: existing.materiales_circulares|| 'No',
      plantilla_interna:    existing.plantilla_interna    || 'No',
      ncm:                  existing.ncm                  || '',
    });
    setRiesgos(asMultiArray(existing.riesgo));
    setDisipativos(asMultiArray(existing.disipativo_energia));
    setNormativas(asMultiArray(existing.normativa));
    setSegmentos(asMultiArray(existing.segmento));
    setFamiliaSel(existing.especificaciones?.familia || '');
    setFamiliaIdSel(existing.especificaciones?.familia_id || null);
    setTipoSel(existing.especificaciones?.tipo_producto
      || (existing.especificaciones?.tipo_calzado ? 'calzado' : ''));
    // Tallas: el backend las guarda en p.tallas (array de UUIDs o codes).
    setSelectedSizes(Array.isArray(existing.tallas)
      ? existing.tallas
      : (existing.especificaciones?.sizes || []));
    // Nodes: solo en especificaciones.nodes (no hay columna dedicada)
    setSelectedNodes(existing.especificaciones?.nodes || []);
    // Visibility + pricing
    const vis = existing.especificaciones?.visibility || {};
    if (vis.visible_to_all !== undefined) setVisibleToAll(!!vis.visible_to_all);
    setClientOverrides(vis.client_overrides || {});
    setListPrice(Number(existing.precio_lista) || 0);
    setMwtPrice(Number(existing.precio_mwt)   || 0);
    setClientPrices(existing.especificaciones?.client_prices || {});
  }, [existing]);

  // Sección C · relaciones
  const existingProductSizes = useMemo(
    () => isEdit ? (PRODUCT_SIZES.find(ps => ps.sku === existing?.sku)?.sizes || []) : [],
    [isEdit, existing]
  );
  const existingProductNodes = useMemo(
    () => isEdit ? (PRODUCT_NODE_ASSIGNMENTS.find(pn => pn.sku === existing?.sku)?.node_ids || []) : [],
    [isEdit, existing]
  );
  const [selectedSizes, setSelectedSizes] = useState(existingProductSizes);
  const [selectedNodes, setSelectedNodes] = useState(existingProductNodes);

  // Sección D · gobernanza
  const existingVisibility = useMemo(
    () => isEdit ? PRODUCT_CLIENT_VISIBILITY.find(v => v.sku === existing?.sku) : null,
    [isEdit, existing]
  );
  const [visibleToAll, setVisibleToAll] = useState(existingVisibility?.visible_to_all ?? true);
  const [clientOverrides, setClientOverrides] = useState(existingVisibility?.client_overrides || {});
  const [listPrice, setListPrice] = useState(existing?.list_price || 0);
  const [mwtPrice, setMwtPrice]   = useState(existing?.unit_cost_fob || 0);  // Precio MWT.ONE (CEO-ONLY)

  const existingPricing = useMemo(
    () => isEdit ? BRAND_PRICING.find(p => p.sku === existing?.sku) : null,
    [isEdit, existing]
  );
  const [clientPrices, setClientPrices] = useState(existingPricing?.client_prices || {});

  // Resolved-prices waterfall: cuando cargamos un producto en modo edit,
  // pedimos al backend los precios resueltos por cliente para este SKU
  // (consume /api/commercial/products/<sku>/clients-pricing/). Pre-puebla
  // los inputs de "Override por cliente" con el precio_final del waterfall
  // (lista → calculadora COMEX → modificadores BCPA del cliente).
  const [resolvedClientsPricing, setResolvedClientsPricing] = useState(null);
  useEffect(() => {
    if (!isEdit || !existing?.sku) return;
    let cancelled = false;
    apiFetch(`/commercial/products/${encodeURIComponent(existing.sku)}/clients-pricing/`,
             { token: getToken() })
      .then(res => {
        if (cancelled || !res?.clients) return;
        setResolvedClientsPricing(res);
        // Pre-pobla overrides cuando NO hay valor válido (undefined, null o 0).
        // Tratamos 0 como "sin override" porque la UI muestra el calc cuando
        // el override no es positivo — el usuario no quiere que el 0 se quede
        // pegado tras subir un Excel nuevo. Si quiere setear "$0 real" debe
        // usar otro flujo (TBD: toggle "gratis").
        setClientPrices(prev => {
          const next = { ...prev };
          for (const c of res.clients) {
            const current = next[c.cliente_id];
            const noValidOverride = (current == null) || Number(current) <= 0;
            if (noValidOverride && c.precio_final_usd) {
              next[c.cliente_id] = Number(c.precio_final_usd);
            }
          }
          return next;
        });
      })
      .catch(() => { /* sin grade_item activo aún → silencioso */ });
    return () => { cancelled = true; };
  }, [isEdit, existing?.sku]);

  // ── Matrices Marluvas por cliente para este SKU ───────────────────
  // GET /commercial/marluvas/product-clients-matrix/?sku=X&brand_id=Y
  // Devuelve { clients: [{cliente_id, razon_social, prices_matrix, ...}] }.
  // Renderizamos una matriz 12×4 editable por cada cliente debajo de
  // la sección "Override por cliente".
  const [clientMatrices, setClientMatrices] = useState([]);
  const [matricesLoading, setMatricesLoading] = useState(false);
  const [savingClient, setSavingClient] = useState(null);   // cliente_id en vuelo
  const [matrixBanner, setMatrixBanner] = useState(null);   // {type, msg, cliente_id}
  const [dirtyClients, setDirtyClients] = useState({});     // {cliente_id: true}
  // Fase 3+ · UI · Set de cliente_id con su panel de tallas expandido.
  const [expandedClients, setExpandedClients] = useState(() => new Set());
  const toggleClientExpanded = (clienteId) => setExpandedClients((prev) => {
    const n = new Set(prev);
    if (n.has(clienteId)) n.delete(clienteId); else n.add(clienteId);
    return n;
  });

  // Cotización USD/BRL en vivo → banda vigente para resaltar en cada matriz.
  // Si el endpoint FX falla, bandaVigente queda null y PriceMatrixCompact
  // simplemente no resalta ninguna banda (degradación silenciosa).
  const { tc: tcVigente } = useExchangeRateUSDBRL(getToken());
  const bandaVigente = useMemo(() => bandaForTC(tcVigente), [tcVigente]);

  useEffect(() => {
    if (!isEdit || !existing?.sku) return;
    let cancelled = false;
    setMatricesLoading(true);
    const qs = `?sku=${encodeURIComponent(existing.sku)}`
             + (brandId ? `&brand_id=${encodeURIComponent(brandId)}` : "");
    apiFetch(`/commercial/marluvas/product-clients-matrix/${qs}`, { token: getToken() })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.clients) ? res.clients : [];
        setClientMatrices(list.map((c) => ({
          cliente_id:       c.cliente_id,
          razon_social:     c.razon_social || c.nombre_comercial || "—",
          pais_iso2:        c.pais_iso2 || "",
          brl_override:     c.brl_override != null ? Number(c.brl_override) : null,
          com_pct:          Number(c.com_pct ?? 0),
          ajuste_usd:       Number(c.ajuste_usd ?? 0),
          sobreprecio_pct:  Number(c.sobreprecio_pct ?? 0),
          prices_matrix:    c.prices_matrix && Object.keys(c.prices_matrix).length > 0
            ? c.prices_matrix : {},
          // Fase 3+ · overrides de talla a nivel cliente
          sizes_pricing:    c.sizes_pricing && Object.keys(c.sizes_pricing).length > 0
            ? c.sizes_pricing : {},
          // Fase 4 · plazos custom por banda (global del cliente-marca).
          // Si la banda 1 tiene [120d,90d,60d,30d,8d] en lugar de los 4
          // por defecto, el frontend lo necesita para renderizar las
          // columnas dinámicas en PriceMatrixCompact.
          custom_plazos:    c.custom_plazos && typeof c.custom_plazos === "object"
            ? c.custom_plazos : {},
          fecha_inicio:     c.fecha_inicio,
          fecha_fin:        c.fecha_fin,
          updated_at:       c.updated_at,
        })));
        setDirtyClients({});
      })
      .catch(() => { if (!cancelled) setClientMatrices([]); })
      .finally(() => { if (!cancelled) setMatricesLoading(false); });
    return () => { cancelled = true; };
  }, [isEdit, existing?.sku, brandId]);

  // Editor de celda con dos semánticas:
  //   · Edit 90d (cualquier banda) → derrame global: recalcula sobreprecio%
  //     del cliente a partir de la celda editada y regenera la matriz
  //     completa (12 bandas × 4 plazos) con computeMatrixFromInputs. Esto
  //     mantiene la coherencia con el simulador cliente-marca, donde editar
  //     90d en una banda recalcula las otras 11.
  //   · Edit 60d / 30d / 8d → cascade lateral SOLO en esa banda (no toca
  //     las otras). Permite override puntual de descuentos pronto pago.
  const handleMatrixCellChange = (clienteId, bandaId, plazoDias, newValue) => {
    const val = Number(newValue) || 0;
    const isAnchor90 = Number(plazoDias) === 90;
    setClientMatrices((arr) => arr.map((c) => {
      if (c.cliente_id !== clienteId) return c;

      if (isAnchor90) {
        // Edit 90d en CUALQUIER banda → retro-calcula BRL para que
        // Base USD = val. Resetea ajuste y sobreprecio.
        // Fórmula inversa: nuevo_BRL = (val × div[banda]) / (1.0183^com × 1.030)
        const banda = BANDAS_MARLUVAS.find((b) => b.id === bandaId);
        if (!banda) return c;
        const com = Number(c.com_pct || 0);
        const factorCom = Math.pow(FACTOR_COMISION, com);
        const denom = factorCom * INDICE_ME_90;
        const newBrl = denom > 0
          ? Number(((val * banda.div) / denom).toFixed(4))
          : Number(c.brl_override || 0);
        const updatedInput = {
          brl:         newBrl,
          com,
          ajuste:      0,
          sobreprecio: 0,
        };
        const newMatrix = computeMatrixFromInputs(updatedInput);
        return {
          ...c,
          brl_override:    newBrl,
          ajuste_usd:      0,
          sobreprecio_pct: 0,
          prices_matrix:   newMatrix,
        };
      }

      // Cascade lateral local para 60/30/8d.
      const row = c.prices_matrix?.[String(bandaId)] || {};
      const newRow = cascadeRow(row, plazoDias, val);
      return {
        ...c,
        prices_matrix: { ...(c.prices_matrix || {}), [String(bandaId)]: newRow },
      };
    }));
    setDirtyClients((d) => ({ ...d, [clienteId]: true }));
  };

  // ─── Fase 3+ · Handlers de overrides POR TALLA a nivel cliente ────
  // Idéntica semántica que los handlers del simulador cliente-marca:
  // primera edición clona la matriz del cliente como punto de partida.
  // Materializa el override en sizes_pricing[tallaUuid].
  const setClientSizeMatrixCell = (clienteId, tallaUuid, bandaId, plazoDias, value) => {
    setClientMatrices((arr) => arr.map((c) => {
      if (c.cliente_id !== clienteId) return c;
      const sp = c.sizes_pricing || {};
      const existing = sp[tallaUuid];
      const baseMatrix = existing?.matrix
        || JSON.parse(JSON.stringify(c.prices_matrix || {}));
      const val = Number(value) || 0;
      const row = baseMatrix[String(bandaId)] || {};
      const newRow = cascadeRow(row, plazoDias, val);
      const nextMatrix = { ...baseMatrix, [String(bandaId)]: newRow };
      return {
        ...c,
        sizes_pricing: {
          ...sp,
          [tallaUuid]: {
            matrix: nextMatrix,
            ...(existing?.anchor ? { anchor: existing.anchor } : {}),
          },
        },
      };
    }));
    setDirtyClients((d) => ({ ...d, [clienteId]: true }));
  };

  const setClientSizeAnchor = (clienteId, tallaUuid, partial) => {
    setClientMatrices((arr) => arr.map((c) => {
      if (c.cliente_id !== clienteId) return c;
      const sp = c.sizes_pricing || {};
      const existing = sp[tallaUuid];
      const baseMatrix = existing?.matrix
        || JSON.parse(JSON.stringify(c.prices_matrix || {}));
      const currentAnchor = existing?.anchor || { bandaId: 1, plazoDias: 90 };
      return {
        ...c,
        sizes_pricing: {
          ...sp,
          [tallaUuid]: {
            matrix: baseMatrix,
            anchor: { ...currentAnchor, ...partial },
          },
        },
      };
    }));
    setDirtyClients((d) => ({ ...d, [clienteId]: true }));
  };

  const clearClientSizeOverride = (clienteId, tallaUuid) => {
    setClientMatrices((arr) => arr.map((c) => {
      if (c.cliente_id !== clienteId) return c;
      const sp = { ...(c.sizes_pricing || {}) };
      delete sp[tallaUuid];
      return { ...c, sizes_pricing: sp };
    }));
    setDirtyClients((d) => ({ ...d, [clienteId]: true }));
  };

  // Guardar la matriz de UN cliente via POST upsert-sku (no toca otros SKUs).
  const handleSaveClientMatrix = async (clienteId) => {
    const c = clientMatrices.find((x) => x.cliente_id === clienteId);
    if (!c || !existing?.sku || !brandId) return;
    setSavingClient(clienteId);
    setMatrixBanner(null);
    try {
      const payload = {
        brand_id:        brandId,
        cliente_id:      clienteId,
        sku:             existing.sku,
        brl_override:    c.brl_override,
        com_pct:         c.com_pct,
        ajuste_usd:      c.ajuste_usd,
        sobreprecio_pct: c.sobreprecio_pct,
        prices_matrix:   c.prices_matrix,
        // Fase 3+ · overrides por talla (opcional, omitir si vacío)
        ...(c.sizes_pricing && Object.keys(c.sizes_pricing).length > 0
            ? { sizes_pricing: c.sizes_pricing } : {}),
        fecha_inicio:    c.fecha_inicio || null,
        fecha_fin:       c.fecha_fin || null,
      };
      const resp = await apiFetch("/commercial/marluvas/upsert-sku/", {
        method: "POST", body: payload, token: getToken(),
      });
      setDirtyClients((d) => { const next = { ...d }; delete next[clienteId]; return next; });
      setMatrixBanner({
        type: "success",
        cliente_id: clienteId,
        msg: lang === "es"
          ? `Matriz guardada · ${resp?.cells ?? 48} precios congelados.`
          : `Matrix saved · ${resp?.cells ?? 48} prices frozen.`,
      });
    } catch (e) {
      setMatrixBanner({
        type: "error",
        cliente_id: clienteId,
        msg: (lang === "es" ? "Error: " : "Error: ") + (e?.body?.detail || e?.message || ""),
      });
    } finally {
      setSavingClient(null);
    }
  };

  // ── Aliases comerciales por cliente (CEO/ADMIN-only) ──────────────
  // Estado: { [clienteId]: { alias, cliente_sku?, status?, error? } }
  //   · status:  'idle' | 'saving' | 'saved' | 'error'
  //   · error:   mensaje del backend si la persistencia falló.
  // Se carga una vez en modo edit y se persiste por blur (no por cada
  // tecla, para no martillar el endpoint).
  const [clientAliases, setClientAliases] = useState({});
  useEffect(() => {
    if (!isEdit || !productId) return;
    let cancelled = false;
    productoAliasesApi.list(productId)
      .then(rows => {
        if (cancelled) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        const map = {};
        for (const r of arr) {
          if (r?.cliente_id) {
            map[r.cliente_id] = {
              alias:       r.alias || '',
              cliente_sku: r.cliente_sku || '',
              status:      'idle',
              error:       null,
            };
          }
        }
        setClientAliases(map);
      })
      .catch(() => { /* CLIENT no autorizado o BD vacía — silencioso */ });
    return () => { cancelled = true; };
  }, [isEdit, productId]);

  // Persiste el alias de un cliente. Llamada explícita on blur.
  // Si el alias quedó vacío y antes había uno persistido → DELETE.
  // En cualquier otro caso → POST upsert.
  const persistClientAlias = async (clienteId, nextAlias) => {
    if (!isEdit || !productId || !clienteId) return;
    const trimmed = (nextAlias || '').trim();
    const previous = clientAliases[clienteId];

    // Marca optimista de "guardando"
    setClientAliases(prev => ({
      ...prev,
      [clienteId]: { ...(prev[clienteId] || {}),
                      alias: trimmed,
                      status: 'saving',
                      error: null },
    }));

    try {
      if (!trimmed) {
        // Borrar alias previo (idempotente: 204 incluso si ya no existía).
        if (previous?.alias) {
          await productoAliasesApi.remove(productId, clienteId);
        }
        setClientAliases(prev => {
          const next = { ...prev };
          delete next[clienteId];
          return next;
        });
        return;
      }
      const res = await productoAliasesApi.upsert(productId, {
        cliente_id: clienteId,
        alias:      trimmed,
      });
      setClientAliases(prev => ({
        ...prev,
        [clienteId]: {
          alias:       res?.alias || trimmed,
          cliente_sku: res?.cliente_sku || '',
          status:      'saved',
          error:       null,
        },
      }));
      // Limpia el indicador "saved" después de 1.5s
      setTimeout(() => {
        setClientAliases(prev => {
          const cur = prev[clienteId];
          if (!cur || cur.status !== 'saved') return prev;
          return { ...prev, [clienteId]: { ...cur, status: 'idle' } };
        });
      }, 1500);
    } catch (e) {
      let msg = String(e?.message || e || '');
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === 'object') {
          msg = Object.values(parsed).flat().join(' · ') || msg;
        }
      } catch (_) { /* msg ya es texto */ }
      setClientAliases(prev => ({
        ...prev,
        [clienteId]: { ...(prev[clienteId] || {}),
                        alias:  trimmed,
                        status: 'error',
                        error:  msg },
      }));
    }
  };

  // ── Role-aware rendering ────────
  // isClient → ProductFormView se vuelve read-only + solo pestaña "Detalles".
  // isClient no puede editar, no puede ver gobernanza/pricing, no puede
  // ver trazabilidad de expedientes. Doble defensa: el backend tampoco
  // devuelve esos campos (ProductPortalSerializer strip-down).
  const { isClient } = useRole();
  const visibleTabs = useMemo(
    () => isClient ? TABS.filter(t => CLIENT_VISIBLE_TABS.has(t.id)) : TABS,
    [isClient],
  );

  // ── Tabs (solo modo edit) ────────
  const [activeTab, setActiveTab] = useState('detalles');

  // Si el rol cambia en caliente (tweaks panel) y el tab activo ya no es
  // visible para CLIENT, lo re-anclamos al tab permitido.
  if (isClient && !CLIENT_VISIBLE_TABS.has(activeTab)) {
    // setState durante render no es ideal; usamos una microtask.
    Promise.resolve().then(() => setActiveTab('detalles'));
  }

  // Toggle helpers — patrón consistente para todos los multi-select.
  const toggleRiesgo = (r) => {
    setRiesgos(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  };
  const toggleDisipativo = (v) => {
    setDisipativos(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };
  const toggleNormativa = (v) => {
    setNormativas(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };
  const toggleSegmento = (v) => {
    setSegmentos(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  };
  const toggleSize = (sid) => {
    setSelectedSizes(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  };
  const toggleNode = (nid) => {
    setSelectedNodes(prev => prev.includes(nid) ? prev.filter(x => x !== nid) : [...prev, nid]);
  };

  // ── Catálogos reales del backend ──
  // Antes el form usaba BRANDS / SIZES / NODES de mockData.js (datos
  // quemados que no reflejaban la BD real). Ahora cargamos los 3
  // catálogos en paralelo. Si la BD está vacía → listas vacías
  // (no fallback a mock para evitar inconsistencia FE↔BD).
  const [realBrands, setRealBrands] = useState([]);
  const [realSizes,  setRealSizes]  = useState([]);
  const [realNodes,  setRealNodes]  = useState([]);
  const [realNcms,   setRealNcms]   = useState([]);
  useEffect(() => {
    const norm = (r) => Array.isArray(r) ? r : (r?.results || []);
    marcasApi.list().then(r => setRealBrands(norm(r))).catch(() => setRealBrands([]));
    tallasApi.list().then(r => setRealSizes(norm(r))).catch(() => setRealSizes([]));
    nodosApi.list().then(r => setRealNodes(norm(r))).catch(() => setRealNodes([]));
    ncmApi.list().then(r => setRealNcms(norm(r))).catch(() => setRealNcms([]));
  }, []);

  // ── Sprint 2026-07-22 · FAMILIAS de la marca seleccionada ──
  // Catálogo real /sizing/familias/?marca_id=<uuid> — alimenta el select
  // FAMILIA de la Sección A. Se refetchea al cambiar de marca.
  const [familiasMarca, setFamiliasMarca] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!brandId) { setFamiliasMarca([]); return; }
    sizingFamiliasApi.list({ marca_id: brandId })
      .then(r => { if (!cancelled) setFamiliasMarca(Array.isArray(r) ? r : (r?.results || [])); })
      .catch(() => { if (!cancelled) setFamiliasMarca([]); });
    return () => { cancelled = true; };
  }, [brandId]);

  // Productos legacy: especificaciones.familia guarda el NOMBRE (no el
  // id). Cuando llegan las familias de la marca, se resuelve nombre → id
  // (case-insensitive) para preseleccionar el FK. No pisa una selección
  // ya hecha (por el backend o por el usuario).
  useEffect(() => {
    if (familiaIdSel || familiasMarca.length === 0) return;
    const nombreFam = existing?.especificaciones?.familia;
    if (!nombreFam) return;
    const hit = familiasMarca.find(f =>
      String(f.nombre || '').toLowerCase() === String(nombreFam).toLowerCase());
    if (hit) setFamiliaIdSel(hit.id);
  }, [familiasMarca, existing, familiaIdSel]);

  // Sprint 2026-07-22 · cambio de MARCA (acción usuario): la familia y
  // las tallas seleccionadas pertenecen a la marca anterior → se limpian.
  // (El autoselect inicial de create y la carga de `existing` NO pasan
  // por aquí — llaman setBrandId directamente.)
  const onMarcaChange = (id) => {
    setBrandId(id);
    setFamiliaIdSel(null);
    setFamiliaSel('');
    setSelectedSizes([]);
    // Sprint 2026-07-23 · si la marca tiene una sola familia, seleccionarla
    // automáticamente y, si hay tipo de producto, traer sus tallas.
    if (id) {
      sizingFamiliasApi.list({ marca_id: id }).then(r => {
        const list = Array.isArray(r) ? r : (r?.results || []);
        if (list.length === 1) {
          const fid = list[0].id;
          setFamiliaIdSel(fid);
          setFamiliaSel(list[0].nombre || '');
          if (tipoSel) {
            setSelectedSizes(realSizes
              .filter(t => t.familia_id === fid && t.tipo_producto === tipoSel)
              .map(t => t.id));
          }
        }
      }).catch(() => {});
    }
  };

  // Cambio de FAMILIA (acción usuario): auto-selecciona TODAS las tallas
  // de esa familia DEL TIPO elegido (fase 3 · doble filtro tipo+familia).
  // En la carga inicial de un producto existente NO se aplica — ahí
  // mandan las tallas guardadas (existing.tallas).
  const onFamiliaChange = (id) => {
    const fid = id || null;
    setFamiliaIdSel(fid);
    const fam = familiasMarca.find(f => f.id === fid);
    setFamiliaSel(fam?.nombre || '');
    setSelectedSizes(fid
      ? realSizes
          .filter(t => t.familia_id === fid && t.tipo_producto === tipoSel)
          .map(t => t.id)
      : []);
  };

  // ── Sprint 2026-07-16 · crear/editar NCM y tallas SIN salir del form ──
  // Botón junto al select de NCM y en el Motor de Tallas → drawer embebido.
  // Al guardar: recarga la lista en memoria y auto-selecciona el valor —
  // sin recargar la página.
  const [ncmDrawer,     setNcmDrawer]     = useState(null); // null | {} | ncmObj
  const [tallaDrawer,   setTallaDrawer]   = useState(null); // null | {} | tallaObj
  const [tallaEditMode, setTallaEditMode] = useState(false);
  const [ncmCountries,  setNcmCountries]  = useState([]);
  const [sizingOptions, setSizingOptions] = useState(null);

  const openNcmDrawer = async (initial) => {
    setNcmDrawer(initial || {});
    if (ncmCountries.length === 0) {
      try {
        const c = await productosApi.select("paises");
        setNcmCountries(Array.isArray(c) ? c : []);
      } catch { /* sin catálogo de países las tarifas quedan sin labels */ }
    }
  };
  const reloadSizingOptions = async () => {
    try { setSizingOptions(await sizingApi.options()); }
    catch { /* el form dinámico degrada a campos base */ }
  };
  // Sprint 2026-07-22 · fase 3 · el catálogo sizing también se carga al
  // montar: alimenta el select TIPO DE PRODUCTO de la Sección A (antes
  // solo se cargaba al abrir el drawer de talla).
  useEffect(() => { reloadSizingOptions(); }, []);
  const openTallaDrawer = async (initial) => {
    setTallaDrawer(initial || {});
    if (!sizingOptions) await reloadSizingOptions();
  };

  // ── Sprint 2026-07-22 · fase 3 · CRUD inline de TIPO DE PRODUCTO ────
  // Reutiliza el TipoQuickModal del Motor de Tallas (create/update/remove
  // contra tiposProductoCatApi; tras mutar se refresca sizingOptions).
  const [tipoModal, setTipoModal] = useState(null); // null | { mode:'create' } | { mode:'edit', tipo }
  const [tipoBusy,  setTipoBusy]  = useState(false);
  const tipoActualSel = useMemo(
    () => (sizingOptions?.tipos_producto || []).find(t => t.codigo === tipoSel) || null,
    [sizingOptions, tipoSel],
  );
  const saveTipo = async ({ label, talla_base_label, sistemas, matriz }) => {
    if (!label) return;
    setTipoBusy(true);
    try {
      let saved = null;
      const body = { label, talla_base_label: talla_base_label || null, sistemas };
      if (tipoModal?.mode === "edit" && tipoModal.tipo?.codigo) {
        saved = await tiposProductoCatApi.update(tipoModal.tipo.codigo, body);
      } else {
        saved = await tiposProductoCatApi.create(body);   // codigo lo genera el backend
      }
      const cod = saved?.codigo || tipoModal?.tipo?.codigo || null;
      // Sprint 2026-07-23 · G23 · guardar matriz específica si aplica
      if (matriz && cod) {
        try {
          await tiposProductoMatrizApi.create({
            tipo_producto: cod,
            marca_id: matriz.marca_id || null,
            familia_id: matriz.familia_id || null,
            sistemas: matriz.sistemas || [],
            defaults: matriz.defaults || null,
          });
        } catch (e) {
          alert((lang === "es" ? "Tipo guardado, pero no se pudo guardar la matriz específica: " : "Type saved, but could not save specific matrix: ") + (e?.body?.detail || e?.message || ""));
        }
      }
      setTipoModal(null);
      await reloadSizingOptions();
      if (cod) setTipoSel(cod);
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar el tipo: " : "Could not save type: ")
        + (e?.body?.detail || e?.message || ""));
    } finally {
      setTipoBusy(false);
    }
  };
  const deleteTipo = async () => {
    if (!tipoSel) return;
    const nombre = tipoActualSel?.label || tipoSel;
    const ok = window.confirm(lang === "es"
      ? `¿Desactivar el tipo "${nombre}"? Los productos y tallas que lo usan lo conservan — solo se desactiva (borrado lógico).`
      : `Deactivate type "${nombre}"? Products and sizes using it keep it — it is only deactivated (soft delete).`);
    if (!ok) return;
    try {
      await tiposProductoCatApi.remove(tipoSel);
      await reloadSizingOptions();
      setTipoSel('');
      setSelectedSizes([]);   // las tallas seleccionadas eran de ese tipo
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar el tipo: " : "Could not delete type: ")
        + (e?.body?.detail || e?.message || ""));
    }
  };

  // ── Sprint 2026-07-24 · CRUD inline de MARCA y GRUPO DE TALLAS ──────
  // Mismo patrón que en el Motor de Tallas: reutiliza CreateBrandDrawer y
  // FamiliaQuickModal para dar de alta/editar/eliminar sin salir del form.
  const [brandDrawer, setBrandDrawer] = useState(null); // null | { mode:'create' } | { mode:'edit', id, initial }
  const [brandBusy,   setBrandBusy]   = useState(false);
  const [familiaModal, setFamiliaModal] = useState(null); // null | { mode:'create' } | { mode:'edit', familia }
  const [familiaBusy,  setFamiliaBusy]  = useState(false);

  const reloadBrands = async () => {
    try {
      const r = await marcasApi.list();
      setRealBrands(Array.isArray(r) ? r : (r?.results || []));
    } catch { /* ignore */ }
  };

  const brandBodyFromForm = (p) => ({
    nombre:              p.name || p.nombre,
    slug:                p.slug || ((s) =>
      (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
               .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))(p.name || p.nombre),
    pais_origen_iso2:    p.pais_origen_iso2 || p.country || "MX",
    categoria_principal: p.categoria_principal || p.categoria || "GENERAL",
    estado_comercial:    p.estado_comercial || p.status || "PROSPECTO",
    mercados_activos:    p.mercados_activos || p.territorios || [],
    tipo:                p.tipo || "TERCEROS",
    brand_code:          p.brand_id || p.brand_code || null,
    pf_correlativo:      (p.pf_correlativo != null && p.pf_correlativo !== "")
                         ? Number(p.pf_correlativo) : null,
  });

  const openEditBrand = async () => {
    if (!brandId) return;
    setBrandBusy(true);
    try {
      const raw = await marcasApi.get(brandId);
      setBrandDrawer({
        mode: "edit",
        id: brandId,
        initial: {
          brand_id:         raw.brand_code || raw.slug || "",
          name:             raw.nombre || "",
          tipo:             raw.tipo || "PROPIA",
          issuing_entity:   raw.issuing_entity_id || raw.issuing_entity || null,
          mercados_activos: Array.isArray(raw.mercados_activos) ? raw.mercados_activos : [],
          status:           raw.estado_comercial || "ACTIVO",
          description:      raw.description || raw.descripcion || "",
          color:            raw.color || "#00B286",
          pf_correlativo:   raw.pf_correlativo ?? null,
        },
      });
    } catch (e) {
      alert((lang === "es" ? "No se pudo cargar la marca: " : "Could not load brand: ")
        + (e?.body?.detail || e?.message || ""));
    } finally {
      setBrandBusy(false);
    }
  };

  const handleBrandCreated = async (p) => {
    const body = brandBodyFromForm(p);
    try {
      if (brandDrawer?.mode === "edit" && brandDrawer.id) {
        await marcasApi.update(brandDrawer.id, body);
        setBrandDrawer(null);
        await reloadBrands();
      } else {
        const created = await marcasApi.create(body);
        setBrandDrawer(null);
        await reloadBrands();
        setBrandId(created?.id || null);
        setFamiliaIdSel(null);
        setFamiliaSel('');
        setSelectedSizes([]);
      }
    } catch (e) {
      alert((lang === "es" ? "Error al guardar marca: " : "Error saving brand: ")
        + (e?.body?.detail || e?.message || ""));
    }
  };

  const deleteBrand = async () => {
    if (!brandId) return;
    const nombre = realBrands.find(m => m.id === brandId)?.nombre || "";
    const ok = window.confirm(lang === "es"
      ? `¿Eliminar la marca "${nombre}"? Es un borrado lógico: las tallas que la referencian conservan la referencia.`
      : `Delete brand "${nombre}"? This is a soft delete: sizes referencing it keep the reference.`);
    if (!ok) return;
    try {
      await marcasApi.remove(brandId);
      await reloadBrands();
      setBrandId('');
      setFamiliaIdSel(null);
      setFamiliaSel('');
      setSelectedSizes([]);
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar la marca: " : "Could not delete brand: ")
        + (e?.body?.detail || e?.message || ""));
    }
  };

  const saveFamilia = async ({ nombre, descripcion }) => {
    if (!brandId || !nombre) return;
    setFamiliaBusy(true);
    try {
      let saved = null;
      if (familiaModal?.mode === "edit" && familiaModal.familia?.id) {
        saved = await sizingFamiliasApi.update(familiaModal.familia.id,
                  { nombre, descripcion: descripcion || null });
      } else {
        saved = await sizingFamiliasApi.create(
                  { marca_id: brandId, nombre, descripcion: descripcion || null });
      }
      const fid = saved?.id || familiaModal?.familia?.id || null;
      setFamiliaModal(null);
      if (fid) {
        setFamiliaIdSel(fid);
        const r = await sizingFamiliasApi.list({ marca_id: brandId });
        setFamiliasMarca(Array.isArray(r) ? r : (r?.results || []));
      }
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar el grupo: " : "Could not save group: ")
        + (e?.body?.detail || e?.message || ""));
    } finally {
      setFamiliaBusy(false);
    }
  };

  const deleteFamilia = async () => {
    if (!familiaIdSel) return;
    const fam = familiasMarca.find(f => f.id === familiaIdSel);
    const ok = window.confirm(lang === "es"
      ? `¿Eliminar el grupo "${fam?.nombre || ""}"? Es un borrado lógico: las tallas que lo referencian conservan la referencia.`
      : `Delete group "${fam?.nombre || ""}"? This is a soft delete: sizes referencing it keep the reference.`);
    if (!ok) return;
    try {
      await sizingFamiliasApi.remove(familiaIdSel);
      setFamiliaIdSel(null);
      setFamiliaSel('');
      const r = await sizingFamiliasApi.list({ marca_id: brandId });
      setFamiliasMarca(Array.isArray(r) ? r : (r?.results || []));
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar el grupo: " : "Could not delete group: ")
        + (e?.body?.detail || e?.message || ""));
    }
  };

  // Cambio de TIPO (acción usuario): limpia SOLO las tallas seleccionadas
  // (eran de otro tipo); la familia se mantiene — es por marca. NO
  // dispara auto-selección de tallas.
  const onTipoChange = (cod) => {
    const next = cod || '';
    setTipoSel(next);
    // Sprint 2026-07-23 · si hay familia elegida, traer automáticamente
    // las tallas de esa combinación.
    if (familiaIdSel && next) {
      setSelectedSizes(realSizes
        .filter(t => t.familia_id === familiaIdSel && t.tipo_producto === next)
        .map(t => t.id));
    } else {
      setSelectedSizes([]);
    }
  };

  const handleNcmSave = async (form) => {
    try {
      const payload = {
        code:        (form.code || "").trim(),
        descripcion: (form.descripcion || "").trim() || null,
        tarifas:     Array.isArray(form.tarifas) ? form.tarifas : [],
        is_active:   form.is_active !== false,
      };
      if (!payload.code) return;
      if (form.id) await ncmApi.update(form.id, payload);
      else         await ncmApi.create(payload);
      const _n = (r) => Array.isArray(r) ? r : (r?.results || []);
      const list = await ncmApi.list().then(_n).catch(() => []);
      if (list.length) setRealNcms(list);
      setAttrs(prev => ({ ...prev, ncm: payload.code }));
      setNcmDrawer(null);
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar el NCM: " : "NCM save failed: ") + (e?.message || ""));
    }
  };

  const handleTallaSave = async (form) => {
    try {
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        payload[k] = (typeof v === "string" && v.trim() === "") ? null : v;
      });
      let saved = null;
      if (form.id) saved = await tallasApi.update(form.id, payload);
      else         saved = await tallasApi.create(payload);
      const _n = (r) => Array.isArray(r) ? r : (r?.results || []);
      const list = await tallasApi.list().then(_n).catch(() => []);
      if (list.length) setRealSizes(list);
      const newId = saved?.id;
      if (!form.id && newId) {
        setSelectedSizes(prev => prev.includes(newId) ? prev : [...prev, newId]);
      }
      setTallaDrawer(null);
      setTallaEditMode(false);
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar la talla: " : "Size save failed: ") + (e?.message || ""));
    }
  };

  // ── Sprint 2026-07-16 · atributos técnicos: catálogo PERSISTIDO ──
  // Fuente de verdad: GET /api/productos/attr-options/ (tabla
  // productos.attr_opcion ∪ valores en uso). Esto hace posible ELIMINAR
  // opciones de verdad (antes el catálogo era constante FE ∪ uso y la
  // opción borrada re-aparecía al recargar). Fallback si el endpoint
  // falla: BRAND_ATTRIBUTES ∪ valores usados en productos (legacy).
  const [attrOptions, setAttrOptions] = useState(() =>
    Object.fromEntries(Object.entries(BRAND_ATTRIBUTES).map(([k, v]) => [k, [...v]])));
  const loadAttrOptions = () =>
    attrOptionsApi.list().then((cat) => {
      if (!cat || typeof cat !== "object") return;
      setAttrOptions(prev => {
        const next = { ...prev };
        Object.keys(prev).forEach(k => {
          if (Array.isArray(cat[k])) next[k] = cat[k];
        });
        return next;
      });
    });
  useEffect(() => {
    loadAttrOptions().catch(() => {
      // Legacy fallback: BRAND_ATTRIBUTES ∪ valores en uso en la BD.
      productosApi.list().then((r) => {
        const rows = Array.isArray(r) ? r : (r?.results || []);
        setAttrOptions(prev => {
          const next = { ...prev };
          const addVal = (key, val) => {
            if (typeof val !== "string") return;
            const t = val.trim();
            if (!t) return;
            if (!next[key].some(o => String(o).toLowerCase() === t.toLowerCase())) {
              next[key] = [...next[key], t];
            }
          };
          rows.forEach((p) => {
            const e = p?.especificaciones || {};
            ["tipo_calzado","cubrepuntera","tipo_puntera","antiperforante",
             "protector_metatarsal","capellada","suela","cierre","color",
             "materiales_circulares","plantilla_interna"].forEach(k => addVal(k, e[k]));
            ["disipativo_energia","normativa","segmento","riesgo"].forEach(k => {
              (Array.isArray(e[k]) ? e[k] : []).forEach(v => addVal(k, v));
            });
          });
          return next;
        });
      }).catch(() => { /* sin lista de productos: quedan las opciones base */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const addAttrOption = (key) => (val) => {
    const t = String(val || "").trim();
    if (!t) return;
    setAttrOptions(prev => prev[key].some(o => String(o).toLowerCase() === t.toLowerCase())
      ? prev
      : { ...prev, [key]: [...prev[key], t] });
    // Persistencia en el catálogo (best-effort; si falla, el valor igual
    // quedará en el catálogo al guardarse el producto que lo usa).
    attrOptionsApi.add(key, t).catch(() => {});
  };
  // Elimina la opción del catálogo persistido. El backend BLOQUEA (409)
  // si algún producto la usa — mostramos el detalle con el conteo.
  const deleteAttrOption = (key) => async (val) => {
    const t = String(val || "").trim();
    if (!t) return;
    try {
      await attrOptionsApi.remove(key, t);
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar la opción: " : "Delete failed: ")
        + (e?.body?.detail || e?.message || ""));
      return;
    }
    const nextList = (attrOptions[key] || [])
      .filter(x => String(x).toLowerCase() !== t.toLowerCase());
    const firstRemaining = nextList[0] || "";
    setAttrOptions(prev => ({ ...prev, [key]: nextList }));
    // Si el form tenía seleccionado el valor eliminado, saltamos a la
    // primera opción restante (evita un select con valor fantasma).
    setAttrs(prev => (prev[key] === t ? { ...prev, [key]: firstRemaining } : prev));
  };
  // Renombra la opción seleccionada en TODOS los productos (backend
  // attr-rename) y actualiza catálogo + valor local sin recargar.
  const editAttrOption = (key) => async (oldVal, newVal) => {
    const o = String(oldVal || "").trim();
    const n = String(newVal || "").trim();
    if (!o || !n || o === n) return;
    try {
      await apiFetch("/productos/attr-rename/", {
        method: "POST",
        body: { key, old: o, new: n },
        token: getToken(),
      });
    } catch (e) {
      alert((lang === "es" ? "No se pudo renombrar la opción: " : "Rename failed: ")
        + (e?.body?.detail || e?.message || ""));
      return;
    }
    setAttrOptions(prev => ({
      ...prev,
      [key]: prev[key].map(x => x === o ? n : x),
    }));
    setAttrs(prev => (prev[key] === o ? { ...prev, [key]: n } : prev));
  };

  // En modo CREATE, si no hay brandId seleccionado y ya cargaron las
  // marcas reales, autoselecciona la primera (mejor UX que dropdown vacío).
  useEffect(() => {
    if (!brandId && realBrands.length > 0 && !isEdit) {
      setBrandId(realBrands[0].id);
    }
  }, [realBrands, brandId, isEdit]);

  // Sprint 2026-07-23 · si tenemos tipo + familia y aún no hay tallas
  // seleccionadas, autoseleccionar las tallas de esa combinación.
  useEffect(() => {
    if (!tipoSel || !familiaIdSel || selectedSizes.length > 0) return;
    const auto = realSizes
      .filter(t => t.familia_id === familiaIdSel && t.tipo_producto === tipoSel)
      .map(t => t.id);
    if (auto.length) setSelectedSizes(auto);
  }, [realSizes, tipoSel, familiaIdSel, selectedSizes.length]);

  // ── Sprint 2026-07-16 · detección de FAMILIA por el nombre ─────────
  // (Sprint 2026-07-21: queda como FALLBACK legacy — solo aplica cuando
  // ni capellada ni tipo de puntera tienen valor; ver filtro más abajo.)
  // La familia (ej. 50B22) es un prefijo del nombre del producto. Si el
  // nombre contiene una familia conocida (la más larga gana: 50B22M
  // matchea 50B22), la Sección C muestra solo las tallas relacionadas.
  const detectedFamilia = useMemo(() => {
    const name = String(nombre || "").toUpperCase().trim();
    if (!name) return null;
    const fams = new Set();
    realSizes.forEach(t => sinDalupo(t.familias)
      .forEach(f => {
        const s = String(f).toUpperCase().trim();
        if (s.length >= 3) fams.add(s);
      }));
    let best = null;
    fams.forEach(f => {
      if (name.includes(f) && (!best || f.length > best.length)) best = f;
    });
    return best;
  }, [nombre, realSizes]);

  // ── Sprint 2026-07-22 · fase 3 · relación por TIPO + FAMILIA ───────
  // Una talla está relacionada con el producto cuando su `tipo_producto`
  // coincide con el TIPO elegido en la Sección A Y su `familia_id` con la
  // FAMILIA elegida. Sin tipo o sin familia no se muestra ninguna talla
  // (hint en su lugar); el resto se puede traer desde "Más tallas".
  const visibleSizes = useMemo(() => {
    if (!tipoSel || !familiaIdSel) return [];
    return realSizes.filter(t =>
      t.familia_id === familiaIdSel && t.tipo_producto === tipoSel);
  }, [realSizes, familiaIdSel, tipoSel]);
  // Nombre de la familia activa (para el banner y el guardado compat).
  const familiaActiva = useMemo(
    () => familiasMarca.find(f => f.id === familiaIdSel) || null,
    [familiasMarca, familiaIdSel],
  );

  // Sprint 2026-07-24 · Motor de Tallas muestra TODAS las tallas
  // seleccionadas agrupadas por (tipo + marca + familia), no solo las del
  // grupo activo. Las tallas de otros grupos aparecen en su propia sección.
  const selectedSizesObj = useMemo(
    () => realSizes.filter(t => selectedSizes.includes(t.id)),
    [realSizes, selectedSizes],
  );
  const hiddenSizesCount = realSizes.length - selectedSizes.length;

  // Modal "Más tallas" — permite traer tallas fuera del criterio activo.
  const [moreTallasOpen, setMoreTallasOpen] = useState(false);

  // Agrupa las tallas seleccionadas por (tipo_producto + marca_id + familia_id).
  const sizesGrouped = useMemo(() => {
    const groups = {};
    selectedSizesObj.forEach(t => {
      const tipo = String(t.tipo_producto || 'otro').toLowerCase().trim();
      const marca = String(t.marca_id || '');
      const familia = String(t.familia_id || '');
      const tipoNombre = (sizingOptions?.tipos_producto || [])
        .find(tp => (tp.codigo || '').toLowerCase() === tipo)?.label || tipo;
      const marcaNombre = realBrands.find(m => m.id === marca)?.nombre
        || t.marca_nombre || '';
      const familiaNombre = familiasMarca.find(f => f.id === familia)?.nombre
        || t.familia_nombre || '';
      const key = `${tipo}||${marca}||${familia}`;
      const label = `${tipoNombre} · ${marcaNombre} · ${familiaNombre}`;
      if (!groups[key]) {
        groups[key] = { label, tipo, marca, familia, tallas: [] };
      }
      groups[key].tallas.push(t);
    });
    // Orden: grupo activo primero, luego alfabético.
    return Object.values(groups).sort((a, b) => {
      const aCurrent = a.tipo === (tipoSel || '').toLowerCase()
        && a.marca === (brandId || '')
        && a.familia === (familiaIdSel || '');
      const bCurrent = b.tipo === (tipoSel || '').toLowerCase()
        && b.marca === (brandId || '')
        && b.familia === (familiaIdSel || '');
      if (aCurrent && !bCurrent) return -1;
      if (!aCurrent && bCurrent) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [selectedSizesObj, sizingOptions, realBrands, familiasMarca, tipoSel, brandId, familiaIdSel]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── Sync overrides → calculados (waterfall) para todos los clientes ──
  // Estado del botón "Actualizar precios calculados a todos los clientes":
  // - syncStatus: 'idle' | 'confirm' | 'syncing' | 'done' | 'error'
  // - syncMsg: mensaje breve para mostrar tras la operación
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncMsg, setSyncMsg]       = useState('');

  /**
   * Re-pega los precios calculados (waterfall COMEX) en `client_prices` para
   * TODOS los clientes con asignación activa, persiste el producto y
   * refresca el panel sin recargar la página.
   *
   * Útil cuando se subió un Excel nuevo y los overrides manuales del
   * detalle del producto quedaron obsoletos. El usuario puede aceptar el
   * recálculo en bloque sin tener que tocar cada input.
   */
  const handleSyncCalculatedPrices = async () => {
    if (!isEdit || !existing?.sku || !productId) return;
    setSyncStatus('syncing');
    setSyncMsg('');
    try {
      // 1. Refetch del waterfall (precios calculados frescos)
      const fresh = await apiFetch(
        `/commercial/products/${encodeURIComponent(existing.sku)}/clients-pricing/`,
        { token: getToken() },
      );
      if (!fresh?.clients?.length) {
        setSyncStatus('error');
        setSyncMsg(lang === 'es'
          ? 'No hay precios calculados disponibles para este SKU.'
          : 'No calculated prices available for this SKU.');
        return;
      }

      // 2. Construir el nuevo mapa client_prices con los precios finales del waterfall
      const newClientPrices = { ...clientPrices };
      let updatedCount = 0;
      for (const c of fresh.clients) {
        if (c.cliente_id && c.precio_final_usd != null) {
          newClientPrices[c.cliente_id] = Number(c.precio_final_usd);
          updatedCount += 1;
        }
      }

      // 3. PATCH parcial al producto: solo `especificaciones.client_prices`.
      //    Mantenemos el resto de `especificaciones` intacto.
      const currentEspec = existing?.especificaciones || {};
      const patchedEspec = { ...currentEspec, client_prices: newClientPrices };
      await productosApi.update(productId, { especificaciones: patchedEspec });

      // 4. Actualizar estados locales (sin recargar la página)
      setClientPrices(newClientPrices);
      setResolvedClientsPricing(fresh);
      setSyncStatus('done');
      setSyncMsg(lang === 'es'
        ? `${updatedCount} cliente(s) actualizados con el precio calculado.`
        : `${updatedCount} client(s) updated with calculated price.`);
      // Limpiar el mensaje a los 4s
      setTimeout(() => { setSyncStatus('idle'); setSyncMsg(''); }, 4000);
    } catch (e) {
      setSyncStatus('error');
      setSyncMsg((lang === 'es' ? 'Error al sincronizar: ' : 'Sync failed: ')
                 + (e?.message || ''));
    }
  };

  const resolveMarcaId = (idOrSlug) => {
    if (!idOrSlug) return null;
    // Si ya es un UUID (lo que el dropdown actual mete como value), úsalo directo.
    const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RX.test(idOrSlug)) return idOrSlug;
    // Fallback: matchea slug/code/nombre (compat con BRANDS mock legacy).
    if (!realBrands.length) return null;
    const needle = String(idOrSlug).toLowerCase();
    const hit = realBrands.find(b =>
      (b.slug || '').toLowerCase()      === needle ||
      (b.brand_code || '').toLowerCase() === needle ||
      (b.nombre || '').toLowerCase()    === needle
    );
    return hit?.id || null;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    // ── UI shape → backend shape ──
    // Los 14 atributos técnicos del calzado (tipo_calzado, capellada, suela…)
    // no son columnas en `productos.producto`; los empaquetamos en
    // `especificaciones` JSON. Pricing client_prices / gallery / nodes /
    // visibility tampoco tienen columna dedicada → mismo destino JSON.
    const especificaciones = {
      ...attrs,
      // Sprint 2026-07-22 · familia de línea (Sección A): FK real —
      // rige el filtro automático de tallas en la Sección C
      // (talla.familia_id). `familia` conserva el NOMBRE por compat con
      // consumidores legacy que leen especificaciones.familia.
      familia:            familiaActiva?.nombre || familiaSel || null,
      familia_id:         familiaIdSel || null,
      // Sprint 2026-07-22 · fase 3 · tipo de producto del SKU (código de
      // /sizing/tipos-producto/): rige — con la familia — el filtro de
      // tallas de la Sección C y el toggle dinámico del portal B2B.
      tipo_producto:      tipoSel || null,
      // Multi-select fields (sprint 2026-05-02): se persisten como arrays.
      // Los consumidores (BrandDetail, PricingManagerTable) leen ambas
      // formas — string legacy o array — para compat hacia atrás.
      riesgo:             riesgos,
      disipativo_energia: disipativos,
      normativa:          normativas,
      segmento:           segmentos,
      sizes:            selectedSizes,
      nodes:            selectedNodes,
      visibility: {
        visible_to_all:    visibleToAll,
        client_overrides:  clientOverrides,
      },
      client_prices:    clientPrices,
      // Galería completa de keys MinIO (no nombres). Compat con preview
      // múltiple en futuro. El "imagen principal" es galleryKeys[0].
      gallery:          galleryKeys,
      // Galería de fichas técnicas (PDFs). La "principal" es fichaKeys[0].
      fichas:           fichaKeys,
    };

    const body = {
      sku:               (sku || '').trim(),
      nombre:            (nombre || '').trim() || sku || '(sin nombre)',
      marca_id:          resolveMarcaId(brandId),
      categoria:         attrs.tipo_calzado || 'CALZADO',
      precio_lista:      Number(listPrice) || 0,
      precio_mwt:        Number(mwtPrice)  || 0,
      especificaciones,
      tallas:            selectedSizes,
      estado:            'ACTIVO',
      visibility_tier:   visibleToAll ? 'INTERNAL' : 'CEO-ONLY',
      // Archivos REALES subidos a MinIO (vía FileUploader → signed PUT).
      imagen_url:        galleryKeys[0] || null,
      ficha_url:         fichaKeys[0] || null,
      hs_code:           attrs.ncm || null,
    };

    try {
      if (isEdit) {
        await productosApi.update(productId, body);
      } else {
        await productosApi.create(body);
      }
      navigate(backTarget);
    } catch (e) {
      // Renderiza mensaje del backend si es JSON DRF
      let msg = String(e?.message || e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === 'object') {
          msg = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('  ·  ');
        }
      } catch (_) { /* msg ya es string */ }
      setSaveError(msg);
      alert((lang==='es'?'No se pudo guardar el producto: ':'Could not save product: ') + msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Renderers ────────
  const renderSectionA = () => (
    <div className="card card-pad-lg form-card">
      <div className="form-card-head">
        <IconPackage size={16} style={{color:'var(--brand-accent)'}}/>
        <div>
          <div className="heading-md">{lang==='es'?'A · Información base & media':'A · Base info & media'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'?'SKU, nombre, marca, galería de imágenes y ficha técnica.':'SKU, name, brand, image gallery and tech data sheet.'}
          </div>
        </div>
      </div>

      <div className="form-grid-3">
        <label className="form-field">
          <span>SKU</span>
          <input className="input mono-sm" value={sku} onChange={e=>setSku(e.target.value)}
                 placeholder="MLV-50S29-BLK-42"/>
        </label>
        <label className="form-field" style={{gridColumn:'span 2'}}>
          <span>{lang==='es'?'Nombre':'Name'}</span>
          <input className="input" value={nombre} onChange={e=>setNombre(e.target.value)}
                 placeholder={lang==='es'?'Ej. Bota 50S29 Plena Flor Negra':'e.g. 50S29 Full Grain Black Boot'}/>
        </label>
        {/* Sprint 2026-07-22 · fase 3 · TIPO DE PRODUCTO (antes de Marca).
            Código de /sizing/tipos-producto/ — define la matriz de tallas
            del producto (Sección C filtra por tipo + familia). CRUD
            inline con el mismo TipoQuickModal del Motor de Tallas. Se
            guarda en especificaciones.tipo_producto. */}
        <label className="form-field">
          <span style={{display:'flex', alignItems:'center', gap:8}}>
            {lang==='es'?'Tipo de producto':'Product type'}
            {!isClient && (
              <span style={{marginLeft:'auto', display:'inline-flex', gap:6}}>
                <button type="button"
                        onClick={() => setTipoModal({ mode: 'create' })}
                        title={lang==='es' ? 'Nuevo tipo de producto' : 'New product type'}
                        style={{
                          width:24, height:24, borderRadius:6, cursor:'pointer',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color:'#00B286', fontWeight:800, fontSize:14, lineHeight:1,
                        }}>＋</button>
                <button type="button"
                        disabled={!tipoSel}
                        onClick={() => setTipoModal({ mode: 'edit', tipo: tipoActualSel })}
                        title={lang==='es' ? 'Editar tipo seleccionado' : 'Edit selected type'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: tipoSel ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: tipoSel ? 'var(--text-secondary)' : 'var(--border-subtle)',
                          fontSize:12, lineHeight:1,
                        }}>✎</button>
                <button type="button"
                        disabled={!tipoSel}
                        onClick={deleteTipo}
                        title={lang==='es' ? 'Desactivar tipo seleccionado' : 'Deactivate selected type'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: tipoSel ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: tipoSel ? '#DC2626' : 'var(--border-subtle)',
                          fontWeight:800, fontSize:12, lineHeight:1,
                        }}>×</button>
              </span>
            )}
          </span>
          <select className="input" value={tipoSel} onChange={e=>onTipoChange(e.target.value)}>
            <option value="">{lang==='es'?'— Sin tipo —':'— No type —'}</option>
            {(sizingOptions?.tipos_producto || []).map(t => (
              <option key={t.codigo} value={t.codigo}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span style={{display:'flex', alignItems:'center', gap:8}}>
            {lang==='es'?'Marca':'Brand'}
            {!isClient && (
              <span style={{marginLeft:'auto', display:'inline-flex', gap:6}}>
                <button type="button"
                        onClick={() => setBrandDrawer({ mode: 'create' })}
                        title={lang==='es' ? 'Nueva marca' : 'New brand'}
                        disabled={brandBusy}
                        style={{
                          width:24, height:24, borderRadius:6, cursor:'pointer',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color:'#00B286', fontWeight:800, fontSize:14, lineHeight:1,
                        }}>＋</button>
                <button type="button"
                        disabled={!brandId || brandBusy}
                        onClick={openEditBrand}
                        title={lang==='es' ? 'Editar marca seleccionada' : 'Edit selected brand'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: brandId ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: brandId ? 'var(--text-secondary)' : 'var(--border-subtle)',
                          fontSize:12, lineHeight:1,
                        }}>✎</button>
                <button type="button"
                        disabled={!brandId || brandBusy}
                        onClick={deleteBrand}
                        title={lang==='es' ? 'Eliminar marca seleccionada' : 'Delete selected brand'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: brandId ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: brandId ? '#DC2626' : 'var(--border-subtle)',
                          fontWeight:800, fontSize:12, lineHeight:1,
                        }}>×</button>
              </span>
            )}
          </span>
          <select className="input" value={brandId} onChange={e=>onMarcaChange(e.target.value)}>
            <option value="">{lang==='es'?'— Sin marca —':'— No brand —'}</option>
            {realBrands.map(b => (
              <option key={b.id} value={b.id}>
                {b.nombre || b.brand_code || b.slug || b.id}
              </option>
            ))}
            {realBrands.length === 0 && (
              <option disabled>{lang==='es'?'(sin marcas en BD)':'(no brands in DB)'}</option>
            )}
          </select>
        </label>
        {/* Sprint 2026-07-22 · FAMILIA de línea (junto a Marca, decisión
            CEO). Ahora es FK real: las opciones son las familias de la
            marca elegida (/sizing/familias/?marca_id=) y las tallas de
            la Sección C se filtran por talla.familia_id. Se guarda en
            especificaciones.familia_id (+ nombre legacy en .familia). */}
        <label className="form-field">
          <span style={{display:'flex', alignItems:'center', gap:8}}>
            {lang==='es'?'Grupo de tallas':'Size group'}
            {!isClient && (
              <span style={{marginLeft:'auto', display:'inline-flex', gap:6}}>
                <button type="button"
                        onClick={() => setFamiliaModal({ mode: 'create' })}
                        title={lang==='es' ? 'Nuevo grupo de tallas' : 'New size group'}
                        disabled={!brandId || familiaBusy}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: brandId ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: brandId ? '#00B286' : 'var(--border-subtle)',
                          fontWeight:800, fontSize:14, lineHeight:1,
                        }}>＋</button>
                <button type="button"
                        disabled={!familiaIdSel || familiaBusy}
                        onClick={() => setFamiliaModal({ mode: 'edit', familia: familiasMarca.find(f => f.id === familiaIdSel) })}
                        title={lang==='es' ? 'Editar grupo seleccionado' : 'Edit selected group'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: familiaIdSel ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: familiaIdSel ? 'var(--text-secondary)' : 'var(--border-subtle)',
                          fontSize:12, lineHeight:1,
                        }}>✎</button>
                <button type="button"
                        disabled={!familiaIdSel || familiaBusy}
                        onClick={deleteFamilia}
                        title={lang==='es' ? 'Eliminar grupo seleccionado' : 'Delete selected group'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: familiaIdSel ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: familiaIdSel ? '#DC2626' : 'var(--border-subtle)',
                          fontWeight:800, fontSize:12, lineHeight:1,
                        }}>×</button>
              </span>
            )}
          </span>
          <select className="input" value={familiaIdSel || ''}
                  disabled={!brandId}
                  onChange={e=>onFamiliaChange(e.target.value)}>
            <option value="">{lang==='es'?'— Sin grupo —':'— No group —'}</option>
            {familiasMarca.map(f => (
              <option key={f.id} value={f.id}>{f.nombre}</option>
            ))}
            {brandId && familiasMarca.length === 0 && (
              <option disabled>{lang==='es'?'(sin grupos para esta marca)':'(no groups for this brand)'}</option>
            )}
          </select>
        </label>
      </div>

      <div className="form-grid-2" style={{marginTop:14}}>
        {/* ── Galería de imágenes (sube a MinIO de verdad) ── */}
        <div>
          <div style={{ font:'600 11px/1 inherit', color:'#0F1B3D',
                        textTransform:'uppercase', letterSpacing:0.4, marginBottom:6 }}>
            {lang==='es'?'Galería de imágenes':'Image gallery'}
          </div>
          <FileUploader
            scope={`producto/${productId || 'nuevo'}`}
            accept="image/*"
            maxSizeMb={10}
            multiple
            label={lang==='es'?'Arrastra .jpg, .png, .webp · máx 10 MB':'Drop .jpg, .png, .webp · max 10 MB'}
            onUploaded={(key) => setGalleryKeys(prev => [...prev, key])}
            onError={(msg) => console.warn('[upload imagen]', msg)}
          />
          {galleryKeys.length > 0 && (
            <div style={{ marginTop:10, display:'grid', gap:10 }}>
              {galleryKeys.map((k, i) => (
                <FilePreview
                  key={k}
                  keyOrUrl={k}
                  height={160}
                  onDelete={async () => {
                    try {
                      if (k && !k.startsWith("http://") && !k.startsWith("https://")) {
                        await apiFetch(`/storage/delete/?key=${encodeURIComponent(k)}`, {
                          method: "DELETE", token: getToken(),
                        });
                      }
                    } catch (_) { /* idempotente — seguimos */ }
                    setGalleryKeys(prev => prev.filter(x => x !== k));
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Fichas técnicas (PDFs · múltiples) ── */}
        <div>
          <div style={{ font:'600 11px/1 inherit', color:'#0F1B3D',
                        textTransform:'uppercase', letterSpacing:0.4, marginBottom:6 }}>
            {lang==='es'?'Fichas técnicas (PDFs)':'Tech data sheets (PDFs)'}
          </div>
          <FileUploader
            scope={`producto/${productId || 'nuevo'}/fichas`}
            accept="application/pdf"
            maxSizeMb={20}
            multiple
            label={lang==='es'?'Arrastra uno o más PDFs · máx 20 MB c/u':'Drop one or more PDFs · max 20 MB each'}
            onUploaded={(key) => setFichaKeys(prev => [...prev, key])}
            onError={(msg) => console.warn('[upload ficha]', msg)}
          />
          {fichaKeys.length > 0 && (
            <div style={{ marginTop:10, display:'grid', gap:10 }}>
              {fichaKeys.map((k) => (
                <FilePreview
                  key={k}
                  keyOrUrl={k}
                  mime="application/pdf"
                  height={240}
                  onDelete={async () => {
                    try {
                      if (k && !k.startsWith("http://") && !k.startsWith("https://")) {
                        await apiFetch(`/storage/delete/?key=${encodeURIComponent(k)}`, {
                          method: "DELETE", token: getToken(),
                        });
                      }
                    } catch (_) { /* idempotente */ }
                    setFichaKeys(prev => prev.filter(x => x !== k));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSectionB = () => (
    <div className="card card-pad-lg form-card">
      <div className="form-card-head">
        <IconShield size={16} style={{color:'var(--brand-blue)'}}/>
        <div>
          <div className="heading-md">{lang==='es'?'B · Atributos técnicos de calzado':'B · Footwear attributes'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'?'14 atributos estrictos — taxonomía canónica ENT_MARCA_PRODUCTOS.':'14 strict attributes — ENT_MARCA_PRODUCTOS canonical taxonomy.'}
          </div>
        </div>
      </div>

      <div className="form-grid-3">
        <AttrSelect label={lang==='es'?'Tipo de calzado':'Footwear type'} opts={attrOptions.tipo_calzado} lang={lang} onAddOption={!isClient ? addAttrOption('tipo_calzado') : undefined} onEditOption={!isClient ? editAttrOption('tipo_calzado') : undefined} onDeleteOption={!isClient ? deleteAttrOption('tipo_calzado') : undefined}
                    value={attrs.tipo_calzado} onChange={v=>setAttrs({...attrs, tipo_calzado: v})}/>
        <AttrSelect label={lang==='es'?'Cubre puntera':'Toe cap cover'} opts={attrOptions.cubrepuntera} lang={lang} onAddOption={!isClient ? addAttrOption('cubrepuntera') : undefined} onEditOption={!isClient ? editAttrOption('cubrepuntera') : undefined} onDeleteOption={!isClient ? deleteAttrOption('cubrepuntera') : undefined}
                    value={attrs.cubrepuntera} onChange={v=>setAttrs({...attrs, cubrepuntera: v})}/>
        {/* Sprint 2026-07-21 · capellada y tipo de puntera alimentan el
            filtro del Motor de Tallas (Sección C); se omiten opciones DALUPO. */}
        <AttrSelect label={lang==='es'?'Tipo de puntera':'Toe cap type'} opts={sinDalupo(attrOptions.tipo_puntera)} lang={lang} onAddOption={!isClient ? addAttrOption('tipo_puntera') : undefined} onEditOption={!isClient ? editAttrOption('tipo_puntera') : undefined} onDeleteOption={!isClient ? deleteAttrOption('tipo_puntera') : undefined}
                    value={attrs.tipo_puntera} onChange={v=>setAttrs({...attrs, tipo_puntera: v})}/>
        <AttrSelect label={lang==='es'?'Antiperforante':'Anti-perforation'} opts={attrOptions.antiperforante} lang={lang} onAddOption={!isClient ? addAttrOption('antiperforante') : undefined} onEditOption={!isClient ? editAttrOption('antiperforante') : undefined} onDeleteOption={!isClient ? deleteAttrOption('antiperforante') : undefined}
                    value={attrs.antiperforante} onChange={v=>setAttrs({...attrs, antiperforante: v})}/>
        <AttrSelect label={lang==='es'?'Protector metatarsal':'Metatarsal protector'} opts={attrOptions.protector_metatarsal} lang={lang} onAddOption={!isClient ? addAttrOption('protector_metatarsal') : undefined} onEditOption={!isClient ? editAttrOption('protector_metatarsal') : undefined} onDeleteOption={!isClient ? deleteAttrOption('protector_metatarsal') : undefined}
                    value={attrs.protector_metatarsal} onChange={v=>setAttrs({...attrs, protector_metatarsal: v})}/>
        <AttrSelect label={lang==='es'?'Capellada':'Upper'} opts={sinDalupo(attrOptions.capellada)} lang={lang} onAddOption={!isClient ? addAttrOption('capellada') : undefined} onEditOption={!isClient ? editAttrOption('capellada') : undefined} onDeleteOption={!isClient ? deleteAttrOption('capellada') : undefined}
                    value={attrs.capellada} onChange={v=>setAttrs({...attrs, capellada: v})}/>
        <AttrSelect label="Suela" opts={attrOptions.suela} lang={lang} onAddOption={!isClient ? addAttrOption('suela') : undefined} onEditOption={!isClient ? editAttrOption('suela') : undefined} onDeleteOption={!isClient ? deleteAttrOption('suela') : undefined}
                    value={attrs.suela} onChange={v=>setAttrs({...attrs, suela: v})}/>
        <AttrSelect label={lang==='es'?'Cierre':'Closure'} opts={attrOptions.cierre} lang={lang} onAddOption={!isClient ? addAttrOption('cierre') : undefined} onEditOption={!isClient ? editAttrOption('cierre') : undefined} onDeleteOption={!isClient ? deleteAttrOption('cierre') : undefined}
                    value={attrs.cierre} onChange={v=>setAttrs({...attrs, cierre: v})}/>
        <AttrSelect label="Color" opts={attrOptions.color} lang={lang} onAddOption={!isClient ? addAttrOption('color') : undefined} onEditOption={!isClient ? editAttrOption('color') : undefined} onDeleteOption={!isClient ? deleteAttrOption('color') : undefined}
                    value={attrs.color} onChange={v=>setAttrs({...attrs, color: v})}/>
        <AttrSelect label={lang==='es'?'Materiales reciclados':'Recycled materials'} opts={attrOptions.materiales_circulares} lang={lang} onAddOption={!isClient ? addAttrOption('materiales_circulares') : undefined} onEditOption={!isClient ? editAttrOption('materiales_circulares') : undefined} onDeleteOption={!isClient ? deleteAttrOption('materiales_circulares') : undefined}
                    value={attrs.materiales_circulares} onChange={v=>setAttrs({...attrs, materiales_circulares: v})}/>
        <AttrSelect label={lang==='es'?'Plantilla interna':'Insole'} opts={attrOptions.plantilla_interna} lang={lang} onAddOption={!isClient ? addAttrOption('plantilla_interna') : undefined} onEditOption={!isClient ? editAttrOption('plantilla_interna') : undefined} onDeleteOption={!isClient ? deleteAttrOption('plantilla_interna') : undefined}
                    value={attrs.plantilla_interna} onChange={v=>setAttrs({...attrs, plantilla_interna: v})}/>
        <label className="form-field">
          <span style={{display:'flex', alignItems:'center', gap:8}}>
            NCM
            {!isClient && (
              <span style={{marginLeft:'auto', display:'inline-flex', gap:6}}>
                <button type="button"
                        onClick={() => openNcmDrawer({})}
                        title={lang==='es' ? 'Crear código NCM' : 'Create NCM code'}
                        style={{
                          width:24, height:24, borderRadius:6, cursor:'pointer',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color:'#00B286', fontWeight:800, fontSize:14, lineHeight:1,
                        }}>＋</button>
                <button type="button"
                        disabled={!attrs.ncm}
                        onClick={() => {
                          const cur = realNcms.find(n => n.code === attrs.ncm);
                          if (cur) openNcmDrawer(cur);
                        }}
                        title={lang==='es' ? 'Editar NCM seleccionado' : 'Edit selected NCM'}
                        style={{
                          width:24, height:24, borderRadius:6,
                          cursor: attrs.ncm ? 'pointer' : 'not-allowed',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color: attrs.ncm ? 'var(--text-secondary)' : 'var(--border-subtle)',
                          fontSize:12, lineHeight:1,
                        }}>✎</button>
              </span>
            )}
          </span>
          <select
            className="input select mono-sm"
            value={attrs.ncm || ""}
            onChange={e => setAttrs({ ...attrs, ncm: e.target.value })}
          >
            <option value="">{lang === 'es' ? '(Sin NCM)' : '(No NCM)'}</option>
            {realNcms.map(n => (
              <option key={n.id} value={n.code}>
                {n.code}{n.descripcion ? ` - ${n.descripcion}` : ''}
              </option>
            ))}
          </select>
        </label>
        <AnimatePresence>
          {ncmDrawer !== null && (
            <NcmFormDrawer
              lang={lang}
              countries={ncmCountries}
              initial={ncmDrawer}
              onClose={() => setNcmDrawer(null)}
              onSave={handleNcmSave}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Disipativo de energía — MULTI-CHECKBOX ───────────────── */}
      <div className="form-field" style={{marginTop:18}}>
        <span style={{display:'flex', alignItems:'center', gap:8}}>
          {lang==='es'?'Disipativo de energía (multi-selección)':'Energy dissipation (multi-select)'}
          <span className="badge badge-neutral" style={{fontSize:10}}>
            {disipativos.length} {lang==='es'?'marcados':'selected'}
          </span>
        </span>
        <div className="riesgo-grid">
          {[...new Set([...attrOptions.disipativo_energia, ...disipativos])].map(v => {
            const on = disipativos.includes(v);
            return (
              <button type="button" key={v}
                      className={`riesgo-chip ${on ? 'riesgo-chip-on' : ''}`}
                      onClick={()=>toggleDisipativo(v)}>
                <span className="riesgo-box">{on && <IconCheck size={10}/>}</span>
                <span>{v}</span>
              </button>
            );
          })}
          {!isClient && <AddOptionChip lang={lang} onAdd={(v)=>{ addAttrOption('disipativo_energia')(v); toggleDisipativo(v); }}/>}
        </div>
      </div>

      {/* ── Normativa — MULTI-CHECKBOX ───────────────────────────── */}
      <div className="form-field" style={{marginTop:18}}>
        <span style={{display:'flex', alignItems:'center', gap:8}}>
          {lang==='es'?'Normativa (multi-selección)':'Norm (multi-select)'}
          <span className="badge badge-neutral" style={{fontSize:10}}>
            {normativas.length} {lang==='es'?'marcados':'selected'}
          </span>
        </span>
        <div className="riesgo-grid">
          {[...new Set([...attrOptions.normativa, ...normativas])].map(v => {
            const on = normativas.includes(v);
            return (
              <button type="button" key={v}
                      className={`riesgo-chip ${on ? 'riesgo-chip-on' : ''}`}
                      onClick={()=>toggleNormativa(v)}>
                <span className="riesgo-box">{on && <IconCheck size={10}/>}</span>
                <span>{v}</span>
              </button>
            );
          })}
          {!isClient && <AddOptionChip lang={lang} onAdd={(v)=>{ addAttrOption('normativa')(v); toggleNormativa(v); }}/>}
        </div>
      </div>

      {/* ── Segmento — MULTI-CHECKBOX ────────────────────────────── */}
      <div className="form-field" style={{marginTop:18}}>
        <span style={{display:'flex', alignItems:'center', gap:8}}>
          {lang==='es'?'Segmento (multi-selección)':'Segment (multi-select)'}
          <span className="badge badge-neutral" style={{fontSize:10}}>
            {segmentos.length} {lang==='es'?'marcados':'selected'}
          </span>
        </span>
        <div className="riesgo-grid">
          {[...new Set([...attrOptions.segmento, ...segmentos])].map(v => {
            const on = segmentos.includes(v);
            return (
              <button type="button" key={v}
                      className={`riesgo-chip ${on ? 'riesgo-chip-on' : ''}`}
                      onClick={()=>toggleSegmento(v)}>
                <span className="riesgo-box">{on && <IconCheck size={10}/>}</span>
                <span>{v}</span>
              </button>
            );
          })}
          {!isClient && <AddOptionChip lang={lang} onAdd={(v)=>{ addAttrOption('segmento')(v); toggleSegmento(v); }}/>}
        </div>
      </div>

      {/* ── Riesgo — MULTI-CHECKBOX ──────────────────────────────── */}
      <div className="form-field" style={{marginTop:18}}>
        <span style={{display:'flex', alignItems:'center', gap:8}}>
          {lang==='es'?'Riesgo (multi-selección)':'Risk (multi-select)'}
          <span className="badge badge-neutral" style={{fontSize:10}}>
            {riesgos.length} {lang==='es'?'marcados':'selected'}
          </span>
        </span>
        <div className="riesgo-grid">
          {[...new Set([...attrOptions.riesgo, ...riesgos])].map(r => {
            const on = riesgos.includes(r);
            return (
              <button type="button" key={r}
                      className={`riesgo-chip ${on ? 'riesgo-chip-on' : ''}`}
                      onClick={()=>toggleRiesgo(r)}>
                <span className="riesgo-box">{on && <IconCheck size={10}/>}</span>
                <span>{r}</span>
              </button>
            );
          })}
          {!isClient && <AddOptionChip lang={lang} onAdd={(v)=>{ addAttrOption('riesgo')(v); toggleRiesgo(v); }}/>}
        </div>
      </div>
    </div>
  );

  const renderSectionC = () => (
    <div className="card card-pad-lg form-card">
      <div className="form-card-head">
        <IconSliders size={16} style={{color:'#481EE3'}}/>
        <div>
          <div className="heading-md">{lang==='es'?'C · Relaciones logísticas':'C · Logistics relations'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'
              ? 'Tallas del Motor de Tallas disponibles para este SKU.'
              : 'Sizing Engine sizes available for this SKU.'}
          </div>
        </div>
      </div>

      {/* Motor de Tallas a ancho completo (nodos logísticos removidos). */}
      <div>
        <div>
          <div className="form-sub-title">
            <IconSliders size={13}/> {lang==='es'?'Motor de Tallas':'Sizing Engine'}
            {!isClient && (
              <span style={{marginLeft:10, display:'inline-flex', gap:6}}>
                <button type="button"
                        onClick={() => openTallaDrawer({
                          tipo_producto:  tipoSel || 'calzado',
                          marca_id:       brandId || null,
                          familia_id:     familiaIdSel || null,
                        })}
                        title={lang==='es' ? 'Crear talla nueva' : 'Create new size'}
                        style={{
                          padding:'3px 9px', borderRadius:6, cursor:'pointer',
                          border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color:'#00B286', fontWeight:700, fontSize:11, lineHeight:1.2,
                        }}>＋ {lang==='es'?'Nueva':'New'}</button>
                <button type="button"
                        onClick={() => setTallaEditMode(m => !m)}
                        title={lang==='es'
                          ? 'Modo edición: click en una talla para editarla'
                          : 'Edit mode: click a size to edit it'}
                        style={{
                          padding:'3px 9px', borderRadius:6, cursor:'pointer',
                          border:`1px solid ${tallaEditMode ? '#00B286' : 'var(--border-subtle)'}`,
                          background: tallaEditMode ? 'rgba(0,178,134,0.10)' : 'var(--surface)',
                          color: tallaEditMode ? '#008B69' : 'var(--text-secondary)',
                          fontWeight:700, fontSize:11, lineHeight:1.2,
                        }}>✎ {lang==='es'?'Editar':'Edit'}</button>
              </span>
            )}
            {tallaEditMode && !isClient && (
              <span className="caption" style={{marginLeft:8, color:'#008B69'}}>
                {lang==='es' ? 'click en una talla para editarla' : 'click a size to edit it'}
              </span>
            )}
            <span className="caption" style={{marginLeft:'auto', color:'var(--text-tertiary)'}}>
              {selectedSizes.length} {lang==='es'?'seleccionadas':'selected'}
            </span>
          </div>
          {/* Sprint 2026-07-24 · banner del criterio activo: muestra el
              TIPO + GRUPO elegidos y la cantidad de grupos de tallas
              seleccionados. El botón abre el catálogo completo. */}
          {tipoSel && familiaIdSel && realSizes.length > 0 && (
            <div style={{
              display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
              margin:'6px 0 10px', padding:'7px 10px', borderRadius:8,
              background:'rgba(0,178,134,0.07)',
              border:'1px solid rgba(0,178,134,0.20)',
            }}>
              <span className="caption" style={{color:'#008B69', fontWeight:600}}>
                <span className="mono" style={{fontWeight:800}}>
                  {`${lang==='es' ? 'Tipo' : 'Type'}: ${tipoActualSel?.label || tipoSel} · ${lang==='es' ? 'Grupo' : 'Group'}: ${(familiaActiva?.nombre || familiaSel || '').trim()}`}
                </span>
                {' — '}
                {lang==='es'
                  ? `${sizesGrouped.length} grupo(s) de tallas · ${selectedSizes.length} seleccionada(s)`
                  : `${sizesGrouped.length} size group(s) · ${selectedSizes.length} selected`}
              </span>
              <button type="button"
                      onClick={() => setMoreTallasOpen(true)}
                      style={{
                        marginLeft:'auto', padding:'3px 10px', borderRadius:6,
                        cursor:'pointer', border:'1px solid rgba(0,178,134,0.40)',
                        background:'var(--surface)', color:'#008B69',
                        fontWeight:700, fontSize:11, lineHeight:1.3,
                      }}>
                ⊞ {lang==='es'
                    ? `Más tallas (${hiddenSizesCount} no seleccionadas)`
                    : `More sizes (${hiddenSizesCount} not selected)`}
              </button>
            </div>
          )}
          <div className="size-picker">
            {realSizes.length === 0 ? (
              <div className="caption" style={{padding:'12px 0', color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'No hay tallas en BD. Crea las primeras en /tallas.'
                  : 'No sizes in DB. Create the first ones in /tallas.'}
              </div>
            ) : !tipoSel ? (
              <div className="caption" style={{padding:'12px 0', color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'Selecciona un tipo de producto para ver sus tallas.'
                  : 'Select a product type to see its sizes.'}
              </div>
            ) : !familiaIdSel ? (
              <div className="caption" style={{padding:'12px 0', color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'Selecciona una familia para ver sus tallas.'
                  : 'Select a family to see its sizes.'}
              </div>
            ) : sizesGrouped.map((group) => (
              <div key={group.label} className="size-picker-group">
                <div className="size-picker-head" style={{'--sys-color':'#481EE3'}}>
                  <span className="size-dot" style={{background:'#481EE3'}}/>
                  {group.label}
                </div>
                <div className="size-picker-row">
                  {group.tallas.map(sz => {
                    const on = selectedSizes.includes(sz.id);
                    const label = sz.talla_base || sz.eu || sz.us_men || sz.nombre || '—';
                    return (
                      <button type="button" key={sz.id}
                              className={`size-chip ${on ? 'size-chip-on' : ''}`}
                              style={tallaEditMode && !isClient ? { outline:'1px dashed #00B286', outlineOffset:1 } : undefined}
                              title={tallaEditMode && !isClient ? (lang==='es'?'Editar esta talla':'Edit this size') : undefined}
                              onClick={()=> (tallaEditMode && !isClient) ? openTallaDrawer(sz) : toggleSize(sz.id)}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {tallaDrawer !== null && !isClient && (
            <TallaFormDrawer
              lang={lang}
              options={sizingOptions}
              initial={tallaDrawer}
              tallas={realSizes}
              onClose={() => setTallaDrawer(null)}
              onSave={handleTallaSave}
              onReloadOptions={reloadSizingOptions}
            />
          )}
        </AnimatePresence>

        {/* Sprint 2026-07-21 · modal "Más tallas" — trae tallas fuera del
            criterio activo (capellada/puntera de la Sección B o, en su
            defecto, la familia legacy detectada en el nombre). */}
        {moreTallasOpen && createPortal(
          <MoreTallasModal
            lang={lang}
            tallas={realSizes}
            selected={selectedSizes}
            onToggle={toggleSize}
            currentTipo={tipoSel}
            currentMarca={brandId}
            currentFamilia={familiaIdSel}
            tipos={sizingOptions?.tipos_producto || []}
            marcas={realBrands}
            familias={familiasMarca}
            onClose={() => setMoreTallasOpen(false)}
          />,
          document.body
        )}

        {/* Sprint 2026-07-22 · fase 3 · CRUD de TIPO DE PRODUCTO — mismo
            modal del Motor de Tallas; el catálogo de unidades viene de
            sizingOptions y cada mutación lo refresca. */}
        {tipoModal && createPortal(
          <TipoQuickModal
            lang={lang}
            mode={tipoModal.mode}
            tipo={tipoModal.tipo}
            sistemasCat={sizingOptions?.sistemas_medida || []}
            options={sizingOptions}
            marcaId={brandId}
            familiaId={familiaIdSel}
            busy={tipoBusy}
            onClose={() => setTipoModal(null)}
            onSave={saveTipo}
            onReloadOptions={reloadSizingOptions}
          />,
          document.body
        )}

        {/* Sprint 2026-07-24 · CRUD de MARCA — CreateBrandDrawer reutilizado
            de Brands.jsx / Motor de Tallas. */}
        {brandDrawer && (
          <div style={{ position: "fixed", inset: 0, zIndex: 95 }}>
            <CreateBrandDrawer
              lang={lang}
              initial={brandDrawer.mode === 'edit' ? brandDrawer.initial : null}
              onClose={() => setBrandDrawer(null)}
              onCreated={handleBrandCreated}
            />
          </div>
        )}

        {/* Sprint 2026-07-24 · CRUD de GRUPO DE TALLAS — modal pequeño inline. */}
        {familiaModal && createPortal(
          <FamiliaQuickModal
            lang={lang}
            mode={familiaModal.mode}
            familia={familiaModal.familia}
            busy={familiaBusy}
            onClose={() => setFamiliaModal(null)}
            onSave={saveFamilia}
          />,
          document.body
        )}
      </div>
    </div>
  );

  const renderSectionD = () => (
    <div className="card card-pad-lg form-card">
      <div className="form-card-head">
        <IconLock size={16} style={{color:'var(--critical)'}}/>
        <div>
          <div className="heading-md">{lang==='es'?'D · Gobernanza y precios':'D · Governance & pricing'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'?'Visibilidad por cliente, precios de lista y precios MWT.ONE (CEO-ONLY).':'Per-client visibility, list prices, and MWT.ONE prices (CEO-ONLY).'}
          </div>
        </div>
      </div>

      {/* Master toggle */}
      <div className="gov-master">
        <div>
          <div className="heading-sm">
            {lang==='es'?'Visible para todos los clientes':'Visible to all clients'}
          </div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'
              ? 'Si se desactiva, define explícitamente por cliente.'
              : 'If off, define per-client explicitly.'}
          </div>
        </div>
        <button type="button"
                className={`toggle-lg ${visibleToAll ? 'toggle-on' : 'toggle-off'}`}
                onClick={()=>setVisibleToAll(!visibleToAll)}>
          <span className="toggle-thumb"/>
          <span className="toggle-label">{visibleToAll ? (lang==='es'?'ACTIVADO':'ON') : (lang==='es'?'DESACTIVADO':'OFF')}</span>
        </button>
      </div>

      {/* Per-client switches */}
      <AnimatePresence initial={false}>
        {!visibleToAll && (
          <motion.div
            initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="form-sub-title">
              {lang==='es'?'Excepciones por cliente':'Per-client exceptions'}
            </div>
            <div className="client-switch-grid">
              {realClients.map(c => {
                const isSubsidiary = !!c.parent_id;
                const hasExplicit = c.id in clientOverrides;
                const inherited = isSubsidiary && !hasExplicit
                  ? clientOverrides[c.parent_id] === true
                  : null;
                const on = hasExplicit
                  ? clientOverrides[c.id] === true
                  : (inherited === true);
                const isInherited = isSubsidiary && !hasExplicit;
                // Alias state · persistimos cuando el toggle está ON y
                // el producto ya existe (productId presente).
                const aliasState  = clientAliases[c.id] || {};
                const aliasValue  = aliasState.alias || '';
                const aliasStatus = aliasState.status;
                const aliasError  = aliasState.error;
                return (
                  <div key={c.id}
                       className={`client-switch-cell ${on ? 'client-switch-cell-on' : ''}`}
                       style={{display:'flex', flexDirection:'column', gap:0}}>
                    <button type="button"
                            className={`client-switch ${on ? 'client-switch-on' : ''}`}
                            data-subsidiary={isSubsidiary || undefined}
                            data-inherited={isInherited || undefined}
                            onClick={()=>setClientOverrides({...clientOverrides, [c.id]: !on})}
                            style={isSubsidiary ? { paddingLeft: 22 } : undefined}>
                      <span className="client-switch-body" style={{flex:1}}>
                        <span className="heading-sm">
                          {isSubsidiary && (
                            <span style={{
                              display:'inline-block', marginRight:6,
                              color:'var(--brand-accent, #00B286)', fontWeight:700,
                            }} title={lang==='es'?'Subsidiaria':'Subsidiary'}>↳</span>
                          )}
                          {c.name}
                        </span>
                        {isSubsidiary && c.parent_name && (
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>
                            {isInherited
                              ? (lang==='es'
                                  ? `Hereda de ${c.parent_name}`
                                  : `Inherits from ${c.parent_name}`)
                              : (lang==='es'
                                  ? `Hijo de ${c.parent_name} · override propio`
                                  : `Child of ${c.parent_name} · own override`)}
                          </span>
                        )}
                      </span>
                      {isSubsidiary && hasExplicit && (
                        <span
                          title={lang==='es'?'Volver a heredar del padre':'Revert to parent inheritance'}
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = { ...clientOverrides };
                            delete next[c.id];
                            setClientOverrides(next);
                          }}
                          style={{
                            fontSize: 10, padding: '2px 6px',
                            borderRadius: 4, marginRight: 6,
                            background: 'color-mix(in oklab, var(--brand-accent, #00B286), transparent 90%)',
                            color: 'var(--brand-accent, #00B286)', fontWeight: 600,
                            cursor: 'pointer',
                          }}>
                          ↺ {lang==='es'?'heredar':'inherit'}
                        </span>
                      )}
                      <span className={`mini-switch ${on ? 'mini-on' : ''}`}
                            style={isInherited ? { opacity: 0.55 } : undefined}>
                        <span className="mini-thumb"/>
                      </span>
                    </button>

                    {/* Alias del producto para este cliente. Solo visible
                        cuando el toggle está ON y el producto ya existe
                        (en modo creación no podemos persistir hasta tener
                        productId). */}
                    {on && isEdit && productId && (
                      <div
                        className="client-alias-row"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display:'flex', alignItems:'center', gap:8,
                          padding:'8px 12px 10px',
                          background:'var(--surface-alt, var(--bg-alt))',
                          borderTop:'1px solid var(--border-subtle, var(--divider))',
                          borderRadius:'0 0 8px 8px',
                        }}>
                        <span
                          className="caption"
                          style={{
                            color:'var(--text-tertiary)',
                            fontSize:10, fontWeight:600,
                            letterSpacing:0.4, textTransform:'uppercase',
                            whiteSpace:'nowrap',
                          }}>
                          {lang==='es' ? 'Alias para este cliente' : 'Alias for this client'}
                        </span>
                        <input
                          type="text"
                          className="input client-alias-input tabular-nums"
                          value={aliasValue}
                          maxLength={255}
                          placeholder={lang==='es'
                            ? 'Ej. SKU interno del cliente'
                            : 'E.g. client internal SKU'}
                          onChange={(e) => {
                            const v = e.target.value;
                            setClientAliases(prev => ({
                              ...prev,
                              [c.id]: { ...(prev[c.id] || {}),
                                         alias: v, status: 'editing', error: null },
                            }));
                          }}
                          onBlur={(e) => persistClientAlias(c.id, e.target.value)}
                          style={{
                            flex:1, height:30, fontSize:13,
                            background:'var(--surface-raised, var(--surface))',
                          }}
                        />
                        {aliasStatus === 'saving' && (
                          <span className="caption" style={{
                            color:'var(--text-tertiary)', fontSize:11, whiteSpace:'nowrap',
                          }}>
                            {lang==='es'?'Guardando…':'Saving…'}
                          </span>
                        )}
                        {aliasStatus === 'saved' && (
                          <span className="caption" style={{
                            color:'var(--success, #00B286)', fontSize:11, whiteSpace:'nowrap',
                            fontWeight:600,
                          }}>
                            {lang==='es'?'Guardado':'Saved'}
                          </span>
                        )}
                        {aliasStatus === 'error' && (
                          <span className="caption" style={{
                            color:'var(--critical, #E5484D)', fontSize:11, whiteSpace:'nowrap',
                            fontWeight:600,
                          }} title={aliasError || ''}>
                            {lang==='es'?'Error':'Error'}
                          </span>
                        )}
                      </div>
                    )}
                    {on && !isEdit && (
                      <div
                        className="caption"
                        style={{
                          padding:'6px 12px 10px',
                          color:'var(--text-tertiary)',
                          fontSize:11, fontStyle:'italic',
                        }}>
                        {lang==='es'
                          ? 'Guarda el producto para poder asignar un alias por cliente.'
                          : 'Save the product to assign a per-client alias.'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pricing table */}
      <div className="form-sub-title" style={{marginTop:20}}>
        <IconDollar size={13}/> {lang==='es'?'Precios':'Pricing'}
      </div>
      <div className="pricing-editor-wrap">
        <div className="pricing-editor-head">
          <div>
            <div className="caption">{lang==='es'?'Precio de Lista':'List Price'}</div>
            <div className="price-editor-row">
              <span className="price-prefix">$</span>
              <input className="input price-input tabular-nums" type="number" step="0.01"
                     value={listPrice} onChange={e=>setListPrice(e.target.value)}/>
            </div>
          </div>
          <div>
            <div className="caption" style={{display:'flex', alignItems:'center', gap:6}}>
              {lang==='es'?'Precio MWT.ONE':'MWT.ONE Price'}
              <span className="ceo-chip">CEO-ONLY</span>
            </div>
            <div className="price-editor-row price-editor-ceo">
              <span className="price-prefix">$</span>
              <input className="input price-input tabular-nums" type="number" step="0.01"
                     value={mwtPrice} onChange={e=>setMwtPrice(e.target.value)}/>
            </div>
          </div>
        </div>

        {/* OCULTO · Sección "Override por cliente" (precio único + alias).
            Reemplazada por la "Matriz de precios USD por par · por cliente
            habilitado" (12 bandas × 4 plazos = 48 precios por SKU) que da
            granularidad completa por banda cambial y plazo de pago.
            Mantenemos el JSX bajo {false && (<>...</>)} para preservar los
            hooks (clientPrices, clientAliases, resolvedClientsPricing,
            syncStatus, etc.) y poder reactivar la vista si se necesita
            como auditoría o fallback legacy. */}
        {false && (<>
        <div className="caption" style={{margin:'12px 0 6px', color:'var(--text-tertiary)',
                                          display:'flex', alignItems:'center', gap:8,
                                          flexWrap:'wrap'}}>
          {lang==='es'?'Override por cliente':'Per-client override'}
          {resolvedClientsPricing?.count > 0 && (
            <span style={{background:'#1DE39422', color:'#00B286',
                          padding:'2px 8px', borderRadius:6,
                          fontSize:10, fontWeight:600}}>
              {lang==='es'
                ? `${resolvedClientsPricing.count} calculados (waterfall COMEX)`
                : `${resolvedClientsPricing.count} resolved (COMEX waterfall)`}
            </span>
          )}
          {/* Botón: aplicar precio calculado a todos los clientes */}
          {isEdit && resolvedClientsPricing?.count > 0 && (
            <button
              type="button"
              onClick={() => setSyncStatus('confirm')}
              disabled={syncStatus === 'syncing'}
              style={{
                marginLeft:'auto',
                display:'inline-flex', alignItems:'center', gap:6,
                padding:'4px 10px',
                fontSize:11, fontWeight:600,
                color:'#fff',
                background: syncStatus === 'syncing' ? '#9CA3AF' : '#00B286',
                border:'none', borderRadius:6,
                cursor: syncStatus === 'syncing' ? 'wait' : 'pointer',
                transition:'background 0.18s',
              }}
              title={lang==='es'
                ? 'Sobreescribe los inputs de override con los precios calculados (waterfall COMEX)'
                : 'Overwrite override inputs with calculated prices (COMEX waterfall)'}
            >
              <IconRefresh size={11}/>
              {syncStatus === 'syncing'
                ? (lang==='es'?'Actualizando…':'Updating…')
                : (lang==='es'?'Actualizar todos los clientes':'Update all clients')}
            </button>
          )}
          {/* Banner de feedback */}
          {syncStatus === 'done' && syncMsg && (
            <span style={{color:'#065F46', background:'#1DE39422',
                          padding:'2px 8px', borderRadius:6,
                          fontSize:10, fontWeight:600,
                          width:'100%', marginTop:4}}>
              ✓ {syncMsg}
            </span>
          )}
          {syncStatus === 'error' && syncMsg && (
            <span style={{color:'#991B1B', background:'#FEE2E2',
                          padding:'2px 8px', borderRadius:6,
                          fontSize:10, fontWeight:600,
                          width:'100%', marginTop:4}}>
              ⚠ {syncMsg}
            </span>
          )}
        </div>

        {/* Modal de confirmación para actualizar todos los clientes */}
        {syncStatus === 'confirm' && (
          <div
            onClick={() => setSyncStatus('idle')}
            style={{
              position:'fixed', inset:0, zIndex:1000,
              background:'rgba(11,30,58,0.45)',
              display:'flex', alignItems:'center', justifyContent:'center',
              padding:16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background:'#fff', borderRadius:12, width:'100%', maxWidth:440,
                padding:'20px 22px',
                boxShadow:'0 12px 48px rgba(11,30,58,0.18)',
              }}
            >
              <div style={{display:'flex', alignItems:'flex-start', gap:14, marginBottom:8}}>
                <div style={{
                  flexShrink:0, width:40, height:40, borderRadius:'50%',
                  background:'rgba(0,178,134,0.12)', color:'#00B286',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <IconRefresh size={18}/>
                </div>
                <div>
                  <div className="heading-md" style={{marginBottom:4}}>
                    {lang==='es'?'Actualizar todos los clientes':'Update all clients'}
                  </div>
                  <div className="caption" style={{color:'var(--text-tertiary)', lineHeight:1.5}}>
                    {lang==='es'
                      ? <>Se sobreescribirán los <strong>{resolvedClientsPricing?.count}</strong> overrides manuales con los precios calculados por el waterfall COMEX. Esta acción guarda el producto inmediatamente.</>
                      : <>The <strong>{resolvedClientsPricing?.count}</strong> manual overrides will be overwritten with the prices calculated by the COMEX waterfall. This saves the product immediately.</>}
                  </div>
                </div>
              </div>
              <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:14}}>
                <button className="btn" onClick={() => setSyncStatus('idle')}>
                  {lang==='es'?'Cancelar':'Cancel'}
                </button>
                <button
                  className="btn"
                  onClick={handleSyncCalculatedPrices}
                  style={{background:'#00B286', color:'#fff', borderColor:'#00B286'}}
                >
                  {lang==='es'?'Actualizar y guardar':'Update and save'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Encabezado de las 3 columnas */}
        <div className="client-price-head">
          <span>{lang==='es'?'Cliente':'Client'}</span>
          <span title={lang==='es'
                  ? 'Nombre que el cliente usa para este producto (aparece en proformas y OCs)'
                  : 'Name the client uses for this product (shows on proformas and POs)'}>
            {lang==='es'?'Alias del cliente':'Client alias'}
          </span>
          <span style={{textAlign:'right'}}>
            {lang==='es'?'Precio override':'Override price'}
          </span>
        </div>
        <div className="client-price-grid">
          {realClients.map(c => {
            const resolved = resolvedClientsPricing?.clients?.find(
              r => r.cliente_id === c.id
            );
            // Parent-Child: si es subsidiaria sin precio explícito,
            // hereda del padre (clientPrices[parent_id]) o, en su
            // ausencia, del precio de lista. Ese es el "default".
            const isSubsidiary  = !!c.parent_id;
            const hasOwnPrice   = clientPrices[c.id] != null && Number(clientPrices[c.id]) > 0;
            const parentPrice   = isSubsidiary
              && clientPrices[c.parent_id] != null
              && Number(clientPrices[c.parent_id]) > 0
                ? Number(clientPrices[c.parent_id])
                : null;
            const isInherited   = isSubsidiary && !hasOwnPrice;
            const inheritedFrom = isInherited ? parentPrice : null;
            const inputValue = hasOwnPrice
              ? clientPrices[c.id]
              : (resolved
                  ? Number(resolved.precio_final_usd).toFixed(2)
                  : '');
            const placeholder = inheritedFrom != null
              ? Number(inheritedFrom).toFixed(2)
              : (resolved
                  ? Number(resolved.precio_final_usd).toFixed(2)
                  : fmtMoney(Number(listPrice)||0).replace('$','').trim());

            // Alias por cliente (CEO/ADMIN-only). isEdit es requisito —
            // en modo create todavía no existe productId al cual asociar.
            const aliasState  = clientAliases[c.id] || {};
            const aliasValue  = aliasState.alias ?? '';
            const aliasStatus = aliasState.status || 'idle';
            const aliasError  = aliasState.error || null;

            return (
              <div key={c.id} className="client-price-row"
                   data-subsidiary={isSubsidiary || undefined}
                   data-inherited={isInherited || undefined}
                   style={isSubsidiary ? { paddingLeft: 22 } : undefined}>
                <span className="client-price-id">
                  {isSubsidiary && (
                    <span style={{color:'var(--brand-accent)', fontWeight:700, marginRight:2}}
                          title={lang==='es'?'Subsidiaria':'Subsidiary'}>↳</span>
                  )}
                  <span className="heading-sm">{c.name}</span>
                  {isSubsidiary && c.parent_name && (
                    <span className="caption"
                          style={{color:'var(--text-tertiary)', marginLeft:8}}
                          title={lang==='es'?'Cliente padre':'Parent client'}>
                      ({c.parent_name}{isInherited
                        ? (lang==='es' ? ' · hereda precio' : ' · inherits price')
                        : (lang==='es' ? ' · precio propio' : ' · own price')})
                    </span>
                  )}
                </span>
                {/* Alias del producto para este cliente — persiste on blur.
                    Disponible solo en modo edit (necesita productId). */}
                <span style={{display:'inline-flex', alignItems:'center',
                              gap:6, position:'relative'}}
                      title={aliasError
                        ? aliasError
                        : (lang==='es'
                            ? 'Cómo conoce este cliente el producto (proformas / OCs)'
                            : 'How this client refers to the product (proformas / POs)')}>
                  <input
                    className="input client-alias-input tabular-nums"
                    type="text"
                    maxLength={255}
                    value={aliasValue}
                    placeholder={isEdit
                      ? (lang==='es' ? 'Sin alias' : 'No alias')
                      : (lang==='es' ? 'Guarda el producto primero' : 'Save product first')}
                    disabled={!isEdit}
                    data-saving={aliasStatus === 'saving' || undefined}
                    data-error={aliasStatus === 'error' || undefined}
                    onChange={e => {
                      const v = e.target.value;
                      setClientAliases(prev => ({
                        ...prev,
                        [c.id]: { ...(prev[c.id] || {}),
                                   alias: v,
                                   status: 'idle',
                                   error: null },
                      }));
                    }}
                    onBlur={e => persistClientAlias(c.id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                    }}
                  />
                  {aliasStatus === 'saving' && (
                    <span className="caption"
                          style={{position:'absolute', right:6, top:'50%',
                                  transform:'translateY(-50%)',
                                  color:'var(--brand-accent)', fontSize:10,
                                  pointerEvents:'none'}}>…</span>
                  )}
                  {aliasStatus === 'saved' && (
                    <span className="caption"
                          style={{position:'absolute', right:6, top:'50%',
                                  transform:'translateY(-50%)',
                                  color:'var(--brand-accent)', fontSize:10,
                                  pointerEvents:'none'}}>✓</span>
                  )}
                </span>
                <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
                  {isSubsidiary && hasOwnPrice && (
                    <button type="button"
                            title={lang==='es'?'Volver a heredar precio del padre':'Revert to parent price'}
                            onClick={() => {
                              const next = { ...clientPrices };
                              delete next[c.id];
                              setClientPrices(next);
                            }}
                            style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: 'rgba(0,178,134,0.10)', color: '#00B286',
                              fontWeight: 600, border: 'none', cursor: 'pointer',
                            }}>
                      ↺ {lang==='es'?'heredar':'inherit'}
                    </button>
                  )}
                  <span className="price-editor-row price-editor-sm"
                        title={resolved?.breakdown
                          ? JSON.stringify(resolved.breakdown, null, 2)
                          : (isInherited
                              ? (lang==='es'?'Hereda precio del cliente padre':'Inherits price from parent client')
                              : (lang==='es'?'Precio calculado por waterfall COMEX':'Price calculated by COMEX waterfall'))}
                        style={isInherited
                          ? { background:'rgba(0,178,134,0.04)', border:'1px dashed rgba(0,178,134,0.30)' }
                          : undefined}>
                    <span className="price-prefix">$</span>
                    <input className="input price-input-sm tabular-nums" type="number" step="0.01"
                           value={inputValue}
                           placeholder={placeholder}
                           onChange={e=>{
                             const v = e.target.value;
                             setClientPrices({...clientPrices, [c.id]: v === '' ? undefined : Number(v)});
                           }}/>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        </>)}
        {/* fin · bloque "Override por cliente" oculto */}

        {/* ── Matriz de precios Marluvas · 12 bandas × 4 plazos por cliente ── */}
        {/* Wrapper "container query"-style: width:0 forzado por flex/grid,
            min-width:0 permite que el contenido respete el flex item,
            overflow:hidden corta lo que sobra. El truco de `width:0` con
            `flex-basis` no es necesario porque ya estamos dentro de un
            block container — pero box-sizing:border-box garantiza que el
            padding no agregue ancho. */}
        {isEdit && (
          <div style={{
            marginTop: 22,
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}>
            <div className="form-sub-title" style={{
              marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <span>
                <IconDollar size={13}/> {lang === 'es'
                  ? 'Matriz de precios · USD por par · por cliente habilitado'
                  : 'Price matrix · USD per pair · per enabled client'}
              </span>
              {/* Chip de TC vigente + banda activa (FX en vivo desde backend). */}
              {tcVigente != null && bandaVigente && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', borderRadius: 12,
                  background: 'rgba(245, 158, 11, 0.10)',
                  color: '#92400E',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  font: '600 10.5px/1.2 var(--font-body)',
                  fontVariantNumeric: 'tabular-nums',
                }}
                  title={lang === 'es'
                    ? 'Cotización USD/BRL en vivo y banda cambial vigente'
                    : 'Live USD/BRL rate and active FX band'}>
                  <span>● USD/BRL</span>
                  <strong style={{ fontWeight: 700 }}>{tcVigente.toFixed(4)}</strong>
                  <span style={{ opacity: 0.6 }}>·</span>
                  <span>{lang === 'es' ? 'Banda' : 'Band'} #{bandaVigente.id}</span>
                  <strong style={{ fontWeight: 700 }}>{bandaVigente.rango}</strong>
                </span>
              )}
            </div>
            <div className="caption" style={{
              color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5,
            }}>
              {lang === 'es'
                ? <>Precios congelados por contrato (12 bandas cambiales × 4 plazos = 48 precios). Editar una celda <strong>90d</strong> recalcula 60/30/8d con factores originales; editar <strong>60d</strong> recalcula 30/8d sin tocar 90d; <strong>30d</strong> recalcula 8d; <strong>8d</strong> es terminal.</>
                : <>Prices frozen as contract (12 FX bands × 4 terms = 48 prices). Editing <strong>90d</strong> recalculates 60/30/8d; <strong>60d</strong> recalculates 30/8d; <strong>30d</strong> recalculates 8d; <strong>8d</strong> is terminal.</>}
            </div>

            {matricesLoading && (
              <div style={{
                padding: 24, textAlign: 'center', color: 'var(--text-tertiary)',
                fontSize: 12, background: 'var(--surface-raised)', border: '1px dashed var(--border)',
                borderRadius: 8,
              }}>
                {lang === 'es' ? 'Cargando matrices…' : 'Loading matrices…'}
              </div>
            )}

            {!matricesLoading && clientMatrices.length === 0 && (
              <div style={{
                padding: 20, color: 'var(--text-tertiary)', fontSize: 12,
                background: 'var(--surface-raised)', border: '1px dashed var(--border)', borderRadius: 8,
                lineHeight: 1.5,
              }}>
                {lang === 'es'
                  ? <>Aún no hay matrices guardadas para este SKU. Las matrices se crean desde el simulador del cliente-marca: <strong>Marcas → [marca] → Motor de Precios → [cliente]</strong>.</>
                  : <>No matrices saved yet for this SKU. Matrices are created from the client-brand simulator.</>}
              </div>
            )}

            {!matricesLoading && clientMatrices.map((c) => {
              const isDirty = !!dirtyClients[c.cliente_id];
              const isSaving = savingClient === c.cliente_id;
              const showBanner = matrixBanner && matrixBanner.cliente_id === c.cliente_id;
              return (
                // Card del cliente. display:grid + grid-template-columns:
                // minmax(0, 1fr) fuerza al hijo (PriceMatrixCompact) a
                // respetar el ancho del card sin importar lo ancho que sea
                // su contenido natural (matriz de 12 bandas ≈ 2800px).
                // Esta es la técnica bulletproof — más confiable que
                // overflow:hidden + min-width:0 que dependen de contexto
                // del padre flex/grid.
                <div key={c.cliente_id} style={{
                  marginBottom: 18, padding: 14,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 10,
                  width: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* Chevron expandir panel de tallas */}
                      <button type="button"
                        onClick={() => toggleClientExpanded(c.cliente_id)}
                        style={{
                          width: 24, height: 24, borderRadius: 4,
                          border: '1px solid var(--border)', background: 'var(--surface-raised)',
                          color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'transform 140ms ease',
                          transform: expandedClients.has(c.cliente_id) ? 'rotate(90deg)' : 'rotate(0deg)',
                          font: '700 12px/1 var(--font-body)',
                          flexShrink: 0,
                        }}
                        title={lang === 'es'
                          ? 'Ver/editar precios por talla para este cliente'
                          : 'View/edit per-size pricing for this client'}>
                        ▶
                      </button>
                      <div>
                      <div style={{
                        font: '700 13px/1.2 var(--font-body)', color: 'var(--text-primary)',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}>
                        {c.razon_social}
                        {(() => {
                          const ovc = Object.keys(c.sizes_pricing || {}).length;
                          if (ovc === 0) return null;
                          return (
                            <span style={{
                              padding: '2px 7px', borderRadius: 10,
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: '#92400E',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              font: '700 9px/1 var(--font-body)',
                              textTransform: 'uppercase', letterSpacing: 0.4,
                            }} title={lang === 'es'
                                ? `${ovc} talla(s) con override`
                                : `${ovc} size(s) with override`}>
                              {ovc} {lang === 'es' ? 'tallas' : 'sizes'}
                            </span>
                          );
                        })()}
                      </div>
                      <div style={{
                        font: '500 10.5px/1.3 var(--font-body)', color: 'var(--text-tertiary)',
                        marginTop: 2,
                      }}>
                        {c.pais_iso2 && <>{c.pais_iso2} · </>}
                        {lang === 'es' ? 'BRL base:' : 'BRL base:'}
                        <strong style={{ color: 'var(--text-primary)', marginLeft: 4 }}>
                          {c.brl_override != null ? Number(c.brl_override).toFixed(2) : '—'}
                        </strong>
                        {' · Com '}
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {Number(c.com_pct).toFixed(2)}%
                        </strong>
                        {Number(c.ajuste_usd) > 0 && <>{' · Ajuste $'}<strong style={{ color: 'var(--text-primary)' }}>{Number(c.ajuste_usd).toFixed(2)}</strong></>}
                        {Number(c.sobreprecio_pct) > 0 && <>{' · Sobreprec '}<strong style={{ color: 'var(--text-primary)' }}>{(Number(c.sobreprecio_pct) * 100).toFixed(2)}%</strong></>}
                        {c.updated_at && <>{' · '}<span title={c.updated_at}>{new Date(c.updated_at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US')}</span></>}
                      </div>
                      </div>{/* cierre del nuevo wrapper razon+info */}
                    </div>{/* cierre del flex wrapper con chevron */}
                    <button type="button"
                      onClick={() => handleSaveClientMatrix(c.cliente_id)}
                      disabled={!isDirty || isSaving}
                      style={{
                        padding: '7px 14px',
                        background: (!isDirty || isSaving) ? '#94A3B8' : '#00B286',
                        color: '#FFFFFF', border: 'none', borderRadius: 6,
                        font: '700 11.5px/1 var(--font-body)',
                        cursor: (!isDirty || isSaving) ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}>
                      {isSaving
                        ? (lang === 'es' ? 'Guardando…' : 'Saving…')
                        : isDirty
                          ? (lang === 'es' ? 'Guardar cambios' : 'Save changes')
                          : (lang === 'es' ? 'Sin cambios' : 'No changes')}
                    </button>
                  </div>

                  {showBanner && (
                    <div style={{
                      padding: '8px 12px', marginBottom: 10,
                      background: matrixBanner.type === 'success' ? 'rgba(0,178,134,0.10)' : 'rgba(220,38,38,0.10)',
                      color: matrixBanner.type === 'success' ? '#065F46' : '#991B1B',
                      border: `1px solid ${matrixBanner.type === 'success' ? 'rgba(0,178,134,0.35)' : 'rgba(220,38,38,0.35)'}`,
                      borderRadius: 6, font: '500 11.5px/1.4 var(--font-body)',
                    }}>
                      {matrixBanner.msg}
                    </div>
                  )}

                  {/* PriceMatrixCompact ya trae overflow-x:auto en su
                      wrapper interno. No envolvemos en `overflow: hidden`
                      porque eso bloquearía el scroll-X. El card padre
                      contiene el ancho (width:100%) y la matriz hace su
                      propio scroll cuando la tabla excede ese ancho. */}
                  <PriceMatrixCompact
                    matrix={c.prices_matrix}
                    onCellChange={(bandaId, plazoDias, newValue) =>
                      handleMatrixCellChange(c.cliente_id, bandaId, plazoDias, newValue)}
                    bandaVigente={bandaVigente}
                    customPlazos={c.custom_plazos}
                    maxHeight="40vh"
                  />

                  {/* Fase 3+ · Panel de overrides POR TALLA para este cliente.
                      Se expande al click del chevron en el header de la card. */}
                  {expandedClients.has(c.cliente_id) && (
                    <div style={{ marginTop: 12 }}>
                      <SkuSizesPanel
                        sku={{
                          sku:           existing?.sku || '',
                          matrix:        c.prices_matrix,
                          sizes_pricing: c.sizes_pricing,
                          anchor:        { bandaId: 1, plazoDias: 90 },
                        }}
                        skuIdx={0}
                        bandaVigente={bandaVigente}
                        globalAnchor={{ bandaId: 1, plazoDias: 90 }}
                        customPlazos={c.custom_plazos}
                        onSizeMatrixCell={(_, tallaUuid, bandaId, plazoDias, value) =>
                          setClientSizeMatrixCell(c.cliente_id, tallaUuid, bandaId, plazoDias, value)}
                        onSizeAnchor={(_, tallaUuid, partial) =>
                          setClientSizeAnchor(c.cliente_id, tallaUuid, partial)}
                        onSizeReset={(_, tallaUuid) =>
                          clearClientSizeOverride(c.cliente_id, tallaUuid)}
                        lang={lang}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="ceo-footnote" style={{marginTop:18}}>
          <IconLock size={12}/> {lang==='es'
            ? 'Las columnas marcadas CEO son visibles sólo para el rol CEO. Nunca se indexan en pgvector ni se exponen al Portal B2B.'
            : 'CEO-marked columns are visible only to the CEO role. Never indexed in pgvector or exposed in the B2B Portal.'}
        </div>
      </div>
    </div>
  );

  // Contenido por tab (modo edit) o full scroll (modo create)
  return (
    <div className="page page-form">
      <div className="page-header">
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <button className="btn btn-sm btn-ghost" onClick={()=>navigate(backTarget)} aria-label="Back">
            <IconChevLeft size={14}/>
          </button>
          <div>
            <div className="micro" style={{marginBottom:4}}>
              {isEdit ? (lang==='es'?'EDITAR PRODUCTO':'EDIT PRODUCT') : (lang==='es'?'NUEVO PRODUCTO':'NEW PRODUCT')}
            </div>
            <h1 className="page-title">
              {isEdit ? (existing?.nombre || '—') : (lang==='es'?'Crear producto':'Create product')}
            </h1>
            {isEdit && (
              <div className="page-subtitle mono-sm" style={{color:'var(--text-tertiary)'}}>
                {existing?.sku}
              </div>
            )}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn" onClick={()=>navigate(isClient ? '/portal' : backTarget)}>
            {lang==='es'?(isClient?'Volver':'Cancelar'):(isClient?'Back':'Cancel')}
          </button>
          {/* CLIENT no puede editar → botón Save oculto. Doble defensa:
              aunque el CSS lo mostrara, el fieldset disabled bloquearía
              el onClick. Aun así — tercera defensa: el backend rechaza
              PATCH/PUT con 403 (PortalProductViewSet._forbidden_write). */}
          {!isClient && (
            <button className="btn btn-accent" onClick={handleSave}>
              <IconCheck size={13}/> {isEdit ? (lang==='es'?'Guardar cambios':'Save changes') : (lang==='es'?'Crear producto':'Create product')}
            </button>
          )}
          {isClient && (
            <span
              className="caption"
              style={{fontSize:12, color:'var(--text-tertiary, #64748B)',
                      padding:'6px 10px', background:'#F3F5F8', borderRadius:6}}
              title={lang==='es'?'Vista de solo lectura':'Read-only view'}
            >
              🔒 {lang==='es'?'Vista solo lectura':'Read-only'}
            </span>
          )}
        </div>
      </div>

      {isEdit && (
        <div className="tab-bar">
          {visibleTabs.map(t => (
            <button key={t.id}
                    className={`tab-btn ${activeTab===t.id ? 'tab-btn-on' : ''}`}
                    onClick={()=>setActiveTab(t.id)}>
              {lang==='es' ? t.es : t.en}
              {t.id === 'expedientes' && existing && (
                <span className="tab-count">
                  {BRAND_PRODUCTS.length > 0 ? '·' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Create → single scroll · Edit → per-tab.
          Si isClient → todos los inputs/selects/buttons del árbol bajo
          el fieldset se desactivan nativamente (atributo HTML `disabled`
          del fieldset propaga a sus descendientes). Esto es defensa
          de UX — el verdadero bloqueo está en el backend. */}
      <fieldset
        disabled={isClient}
        style={{border:'none', padding:0, margin:0, minInlineSize:'auto'}}
      >
      {!isEdit ? (
        <div className="form-stack">
          <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.25}}>
            {renderSectionA()}
          </motion.div>
          <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.25, delay:0.05}}>
            {renderSectionB()}
          </motion.div>
          <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.25, delay:0.1}}>
            {renderSectionC()}
          </motion.div>
          {/* Gobernanza es CEO-ONLY → oculto para CLIENT incluso en modo create */}
          {!isClient && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.25, delay:0.15}}>
              {renderSectionD()}
            </motion.div>
          )}
        </div>
      ) : (
        <div className="tab-panel">
          <AnimatePresence mode="wait">
            {activeTab === 'detalles' && (
              <motion.div key="t1"
                initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
                transition={{duration:0.22}}
                className="form-stack">
                {renderSectionA()}
                {renderSectionB()}
                {renderSectionC()}
              </motion.div>
            )}
            {/* Gobernanza y Expedientes — ESTRICTAMENTE OCULTAS para CLIENT.
                El guard `!isClient` es redundante con `visibleTabs` (el CLIENT
                no puede llegar acá porque el tab-bar no renderiza esas opciones),
                pero lo mantenemos como defensa en profundidad #2. */}
            {!isClient && activeTab === 'gobernanza' && (
              <motion.div key="t2"
                initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
                transition={{duration:0.22}}
                className="form-stack">
                {renderSectionD()}
              </motion.div>
            )}
            {!isClient && activeTab === 'expedientes' && existing && (
              <motion.div key="t3"
                initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
                transition={{duration:0.22}}>
                <ProductExpedientesTab lang={lang} sku={existing.sku}/>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      </fieldset>
    </div>
  );
}

// ────────────────────────────────────────────────
// MoreTallasModal — selector de tallas de TODO el catálogo
// ────────────────────────────────────────────────
// Sprint 2026-07-24 · Agrupa por (tipo de producto + marca + grupo de tallas)
// usando los FK reales de cada talla. El grupo activo del producto se muestra
// primero y con un banner de título. Las tallas seleccionadas fuera del grupo
// activo quedan visibles en su grupo correspondiente.
function MoreTallasModal({
  lang='es',
  tallas,
  selected,
  onToggle,
  onClose,
  currentTipo,
  currentMarca,
  currentFamilia,
  tipos,
  marcas,
  familias,
}) {
  const [q, setQ] = useState("");

  const tipoLabel = useMemo(() => {
    return (tipos.find(t => t.codigo === currentTipo)?.label)
      || currentTipo
      || (lang === 'es' ? 'Sin tipo' : 'No type');
  }, [tipos, currentTipo, lang]);

  const marcaLabel = useMemo(() => {
    return (marcas.find(m => m.id === currentMarca)?.nombre)
      || (lang === 'es' ? 'Sin marca' : 'No brand');
  }, [marcas, currentMarca, lang]);

  const familiaLabel = useMemo(() => {
    return (familias.find(f => f.id === currentFamilia)?.nombre)
      || (lang === 'es' ? 'Sin grupo' : 'No group');
  }, [familias, currentFamilia, lang]);

  const selectedLabels = useMemo(() => {
    return tallas
      .filter(t => selected.includes(t.id))
      .map(t => t.talla_base || t.eu || t.us_men || t.nombre || '—')
      .join(', ');
  }, [tallas, selected]);

  const groups = useMemo(() => {
    const ql = q.trim().toUpperCase();
    const map = {};
    const sinGrupo = [];
    tallas.forEach(t => {
      const tipo = String(t.tipo_producto || '').trim() || '—';
      const marca = String(t.marca_id || '').trim() || '—';
      const familia = String(t.familia_id || '').trim() || '—';
      const tipoNombre = (tipos.find(tp => tp.codigo === tipo)?.label) || tipo;
      const marcaNombre = (marcas.find(m => m.id === marca)?.nombre)
        || (t.marca_nombre || marca);
      const familiaNombre = (familias.find(f => f.id === familia)?.nombre)
        || (t.familia_nombre || familia);
      const label = t.talla_base || t.eu || t.us_men || t.nombre || '—';
      const groupKey = `${tipo}||${marca}||${familia}`;
      const groupLabel = `${tipoNombre} · ${marcaNombre} · ${familiaNombre}`;
      const hit = !ql
        || String(label).toUpperCase().includes(ql)
        || groupLabel.toUpperCase().includes(ql);
      if (!hit) return;
      if (!t.tipo_producto || !t.marca_id || !t.familia_id) {
        sinGrupo.push(t);
        return;
      }
      if (!map[groupKey]) {
        map[groupKey] = { label: groupLabel, tipo, marca, familia, tallas: [] };
      }
      map[groupKey].tallas.push(t);
    });
    const ordered = Object.values(map).sort((a, b) => {
      const aCurrent = a.tipo === currentTipo && a.marca === currentMarca && a.familia === currentFamilia;
      const bCurrent = b.tipo === currentTipo && b.marca === currentMarca && b.familia === currentFamilia;
      if (aCurrent && !bCurrent) return -1;
      if (!aCurrent && bCurrent) return 1;
      return a.label.localeCompare(b.label);
    });
    if (sinGrupo.length) {
      ordered.push({
        label: lang === 'es' ? 'Sin clasificación completa' : 'Incomplete classification',
        tipo: '—', marca: '—', familia: '—',
        tallas: sinGrupo,
      });
    }
    return ordered;
  }, [tallas, q, tipos, marcas, familias, currentTipo, currentMarca, currentFamilia, lang]);

  return (
    <>
      <div onClick={onClose}
           style={{ position:'fixed', inset:0, zIndex:1000,
                    background:'rgba(11,30,58,0.45)', backdropFilter:'blur(2px)' }}/>
      <div role="dialog" aria-modal="true"
           style={{
             position:'fixed', top:'50%', left:'50%',
             transform:'translate(-50%, -50%)', zIndex:1001,
             width:'min(760px, 96vw)', maxHeight:'86vh',
             display:'flex', flexDirection:'column',
             background:'var(--surface, #FFFFFF)', borderRadius:14,
             boxShadow:'0 24px 60px rgba(15,23,42,0.30)', overflow:'hidden',
           }}>
        {/* Head */}
        <div style={{ display:'flex', alignItems:'center', gap:10,
                      padding:'16px 18px', borderBottom:'1px solid var(--border-subtle, #E5E7EB)' }}>
          <div style={{ flex:1 }}>
            <div className="micro" style={{ color:'#00B286' }}>
              {lang==='es' ? 'MOTOR DE TALLAS' : 'SIZING ENGINE'}
            </div>
            <div className="heading-md">
              {lang==='es' ? 'Todas las tallas del catálogo' : 'All sizes in catalog'}
            </div>
            <div className="caption" style={{ color:'var(--text-tertiary)' }}>
              {lang==='es'
                ? 'Selecciona tallas de cualquier tipo, marca y grupo para este producto.'
                : 'Select sizes from any type, brand and group for this product.'}
            </div>
          </div>
          <button type="button" onClick={onClose}
                  title={lang==='es' ? 'Cerrar' : 'Close'}
                  style={{ border:'1px solid var(--border-subtle)', background:'var(--surface)',
                           borderRadius:8, width:30, height:30, cursor:'pointer',
                           fontWeight:800, fontSize:14, color:'var(--text-secondary)' }}>×</button>
        </div>

        {/* Current selection banner */}
        <div style={{ margin:'12px 18px 0', padding:'10px 12px', borderRadius:8,
                      background:'rgba(0,178,134,0.07)', border:'1px solid rgba(0,178,134,0.20)' }}>
          <div className="caption" style={{ color:'#008B69', fontWeight:600 }}>
            <span className="mono" style={{ fontWeight:800 }}>
              {lang==='es' ? 'Selección activa' : 'Active selection'}:
            </span>{' '}
            {lang==='es' ? 'Tipo' : 'Type'}: {tipoLabel} ·
            {' '}{lang==='es' ? 'Marca' : 'Brand'}: {marcaLabel} ·
            {' '}{lang==='es' ? 'Grupo' : 'Group'}: {familiaLabel}
          </div>
          {selected.length > 0 && (
            <div className="caption" style={{ marginTop:6, color:'var(--text-secondary)' }}>
              <span style={{ fontWeight:700 }}>
                {selected.length}{lang==='es' ? ' tallas seleccionadas' : ' sizes selected'}
              </span>
              {selectedLabels && (
                <span style={{ marginLeft:8 }}>({selectedLabels})</span>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border-subtle, #E5E7EB)' }}>
          <input className="input" autoFocus value={q}
                 onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'
                   ? 'Buscar por talla, tipo, marca o grupo…'
                   : 'Search by size, type, brand or group…'}
                 style={{ width:'100%' }}/>
        </div>

        {/* Body */}
        <div style={{ padding:'12px 18px', overflowY:'auto' }}>
          {groups.length === 0 ? (
            <div className="caption" style={{ color:'var(--text-tertiary)', padding:'16px 0' }}>
              {lang==='es' ? 'Sin resultados.' : 'No results.'}
            </div>
          ) : groups.map((g) => (
            <div key={g.label} style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <span className="mono" style={{
                        fontSize:12, fontWeight:800, letterSpacing:0.4,
                        color: (g.tipo === currentTipo && g.marca === currentMarca && g.familia === currentFamilia)
                          ? '#008B69' : 'var(--text-secondary)' }}>
                  {g.label}
                </span>
                {(g.tipo === currentTipo && g.marca === currentMarca && g.familia === currentFamilia) && (
                  <span className="caption" style={{
                          background:'rgba(0,178,134,0.10)', color:'#008B69',
                          border:'1px solid rgba(0,178,134,0.30)',
                          borderRadius:999, padding:'1px 8px', fontSize:10, fontWeight:700 }}>
                    {lang==='es' ? 'selección actual' : 'current selection'}
                  </span>
                )}
                <span className="caption" style={{ marginLeft:'auto', color:'var(--text-tertiary)' }}>
                  {g.tallas.filter(t => selected.includes(t.id)).length}/{g.tallas.length}{' '}
                  {lang==='es' ? 'seleccionadas' : 'selected'}
                </span>
              </div>
              <div className="size-picker-row" style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {g.tallas.map(t => {
                  const on = selected.includes(t.id);
                  const label = t.talla_base || t.eu || t.us_men || t.nombre || '—';
                  return (
                    <button type="button" key={`${g.label}-${t.id}`}
                            className={`size-chip ${on ? 'size-chip-on' : ''}`}
                            onClick={() => onToggle(t.id)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Foot */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8,
                      padding:'12px 18px', borderTop:'1px solid var(--border-subtle, #E5E7EB)' }}>
          <button type="button" onClick={onClose}
                  style={{ padding:'8px 16px', borderRadius:8, cursor:'pointer',
                           border:'none', background:'#00B286', color:'#fff', fontWeight:700 }}>
            {lang==='es' ? 'Listo' : 'Done'}
          </button>
        </div>
      </div>
    </>
  );
}
// ────────────────────────────────────────────────
// AttrSelect — small select field
// ────────────────────────────────────────────────
// Sprint 2026-07-16 · AttrSelect con alta inline de opciones ("＋"), edición
// (✎ → renombra en todos los productos vía attr-rename), ELIMINACIÓN
// (🗑 → attr-delete; el backend bloquea con 409 si la opción está en uso)
// y merge del valor actual (si el producto trae un valor fuera del
// catálogo, se muestra igual en el select en vez de perderse).
function AttrSelect({ label, opts, value, onChange, onAddOption, onEditOption, onDeleteOption, lang='es' }) {
  // mode: null | 'add' | 'edit' | 'delete'
  //   'edit'   renombra la opción seleccionada en TODOS los productos.
  //   'delete' pide confirmación inline y la elimina del catálogo.
  const [mode, setMode]   = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy]   = useState(false);
  const merged = (value && !opts.includes(value)) ? [...opts, value] : opts;
  const confirmIt = async () => {
    if (mode === 'delete') {
      setBusy(true);
      try { await onDeleteOption?.(value); }
      finally { setBusy(false); setMode(null); }
      return;
    }
    const v = draft.trim();
    if (!v) { setMode(null); return; }
    if (mode === 'add') {
      onAddOption?.(v);
      onChange(v);
      setDraft(""); setMode(null);
    } else if (mode === 'edit') {
      setBusy(true);
      try { await onEditOption?.(value, v); }
      finally { setBusy(false); setDraft(""); setMode(null); }
    }
  };
  const iconBtn = (active) => ({
    width:20, height:20, borderRadius:5, cursor:'pointer',
    border:`1px solid ${active ? '#00B286' : 'var(--border-subtle)'}`,
    background: active ? 'rgba(0,178,134,0.10)' : 'var(--surface)',
    fontWeight:800, fontSize:12, lineHeight:1,
  });
  return (
    <label className="form-field">
      <span style={{display:'flex', alignItems:'center', gap:6}}>
        {label}
        {(onAddOption || onEditOption) && (
          <span style={{marginLeft:'auto', display:'inline-flex', gap:4}}>
            {onAddOption && (
              <button type="button"
                      onClick={()=>{ setMode(m => m==='add' ? null : 'add'); setDraft(""); }}
                      title={lang==='es'?'Agregar opción nueva':'Add new option'}
                      style={{ ...iconBtn(mode==='add'), color:'#00B286' }}>
                {mode==='add' ? '×' : '＋'}
              </button>
            )}
            {onEditOption && (
              <button type="button"
                      disabled={!value}
                      onClick={()=>{ setMode(m => m==='edit' ? null : 'edit'); setDraft(value || ""); }}
                      title={lang==='es'
                        ? 'Editar la opción seleccionada (se renombra en todos los productos)'
                        : 'Edit selected option (renamed across all products)'}
                      style={{ ...iconBtn(mode==='edit'),
                               cursor: value ? 'pointer' : 'not-allowed',
                               color: value ? 'var(--text-secondary)' : 'var(--border-subtle)' }}>
                {mode==='edit' ? '×' : '✎'}
              </button>
            )}
            {onDeleteOption && (
              <button type="button"
                      disabled={!value}
                      onClick={()=>{ setMode(m => m==='delete' ? null : 'delete'); setDraft(""); }}
                      title={lang==='es'
                        ? 'Eliminar la opción seleccionada del catálogo (bloqueado si algún producto la usa)'
                        : 'Delete selected option from catalog (blocked if any product uses it)'}
                      style={{ ...iconBtn(mode==='delete'),
                               cursor: value ? 'pointer' : 'not-allowed',
                               borderColor: mode==='delete' ? '#DC2626' : undefined,
                               background: mode==='delete' ? 'rgba(220,38,38,0.08)' : undefined,
                               color: value ? '#DC2626' : 'var(--border-subtle)' }}>
                ×
              </button>
            )}
          </span>
        )}
      </span>
      {mode === 'delete' ? (
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          <span className="caption" style={{
                  flex:1, color:'#DC2626', fontWeight:600,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
            {lang==='es' ? `¿Eliminar "${value}"?` : `Delete "${value}"?`}
          </span>
          <button type="button" onClick={confirmIt} disabled={busy}
                  title={lang==='es'?'Sí, eliminar':'Yes, delete'}
                  style={{border:'none', background:'#DC2626', color:'#fff', borderRadius:6,
                          width:34, height:26, cursor: busy ? 'wait' : 'pointer', fontWeight:800}}>
            {busy ? '…' : '✓'}
          </button>
          <button type="button" onClick={()=>setMode(null)} disabled={busy}
                  title={lang==='es'?'Cancelar':'Cancel'}
                  style={{border:'1px solid var(--border-subtle)', background:'var(--surface)',
                          color:'var(--text-secondary)', borderRadius:6,
                          width:26, height:26, cursor:'pointer', fontWeight:800}}>×</button>
        </div>
      ) : mode ? (
        <div style={{display:'flex', gap:6}}>
          <input className="input" autoFocus value={draft} disabled={busy}
                 onChange={e=>setDraft(e.target.value)}
                 onKeyDown={e=>{
                   if (e.key==='Enter'){ e.preventDefault(); confirmIt(); }
                   if (e.key==='Escape'){ setDraft(''); setMode(null); }
                 }}
                 placeholder={mode==='add'
                   ? (lang==='es'?'Nueva opción…':'New option…')
                   : (lang==='es'?'Nuevo nombre…':'New name…')}/>
          <button type="button" onClick={confirmIt} disabled={busy}
                  style={{border:'none', background:'#00B286', color:'#fff', borderRadius:6,
                          width:34, cursor: busy ? 'wait' : 'pointer', fontWeight:800}}>
            {busy ? '…' : '✓'}
          </button>
        </div>
      ) : (
        <select className="input" value={value} onChange={e=>onChange(e.target.value)}>
          {merged.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </label>
  );
}

// Chip "＋ Agregar opción" para los grupos multi-selección (staff only).
function AddOptionChip({ lang='es', onAdd }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft]   = useState("");
  const confirmAdd = () => {
    const v = draft.trim();
    if (v) onAdd(v);
    setDraft(""); setAdding(false);
  };
  if (!adding) return (
    <button type="button" className="riesgo-chip"
            style={{borderStyle:'dashed', color:'#008B69'}}
            onClick={()=>setAdding(true)}>
      <span>＋ {lang==='es'?'Agregar opción':'Add option'}</span>
    </button>
  );
  return (
    <span className="riesgo-chip" style={{display:'inline-flex', gap:6, alignItems:'center'}}>
      <input className="input" autoFocus value={draft}
             onChange={e=>setDraft(e.target.value)}
             onKeyDown={e=>{
               if (e.key==='Enter'){ e.preventDefault(); confirmAdd(); }
               if (e.key==='Escape'){ setDraft(''); setAdding(false); }
             }}
             placeholder={lang==='es'?'Nueva opción…':'New option…'}
             style={{height:26, fontSize:12, padding:'2px 8px', width:150}}/>
      <button type="button" onClick={confirmAdd}
              style={{border:'none', background:'#00B286', color:'#fff', borderRadius:5,
                      width:22, height:22, cursor:'pointer', fontWeight:800}}>✓</button>
    </span>
  );
}

// ────────────────────────────────────────────────
// MediaDropzone — multi-stage dropzone
// ────────────────────────────────────────────────
function MediaDropzone({ kind='gallery', lang='es', files, onChange, label, hint, multiple=false }) {
  const inputRef = useRef(null);
  const [hover, setHover] = useState(false);

  const handleFiles = (list) => {
    const arr = Array.from(list).map(f => ({ name: f.name, size: f.size, type: f.type }));
    onChange?.(multiple ? [...files, ...arr] : arr.slice(0,1));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setHover(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => {
    const next = files.filter((_, i) => i !== idx);
    onChange?.(next);
  };

  return (
    <div className="media-dropzone-wrap">
      <div className="form-field" style={{marginBottom:8}}>
        <span>{label}</span>
      </div>
      <div
        className={`media-dropzone ${hover ? 'media-dropzone-hover' : ''} ${files.length > 0 ? 'media-dropzone-full' : ''}`}
        onDragOver={(e)=>{ e.preventDefault(); setHover(true); }}
        onDragLeave={()=>setHover(false)}
        onDrop={onDrop}
        onClick={()=>inputRef.current?.click()}
      >
        {files.length === 0 ? (
          <>
            {kind === 'gallery'
              ? <IconUpload size={22} style={{color:'var(--brand-accent)'}}/>
              : <IconFileText size={22} style={{color:'var(--brand-blue)'}}/>}
            <div className="heading-sm">
              {lang==='es' ? 'Arrastra y suelta' : 'Drag & drop'}
            </div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>{hint}</div>
          </>
        ) : (
          <div className="media-file-list" onClick={(e)=>e.stopPropagation()}>
            {files.map((f, i) => (
              <div key={i} className="media-file-row">
                <IconPaperclip size={12} style={{color:'var(--text-tertiary)'}}/>
                <span className="media-file-name">{f.name}</span>
                <button className="btn-icon-xs" onClick={(e)=>{ e.stopPropagation(); removeFile(i); }}>
                  <IconX size={10}/>
                </button>
              </div>
            ))}
            {multiple && (
              <div className="caption" style={{color:'var(--text-tertiary)', marginTop:6}}>
                + {lang==='es'?'Click para añadir más':'Click to add more'}
              </div>
            )}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        style={{display:'none'}}
        multiple={multiple}
        accept={kind === 'gallery' ? 'image/*' : 'application/pdf'}
        onChange={(e)=>{ if (e.target.files) handleFiles(e.target.files); }}
      />
    </div>
  );
}
