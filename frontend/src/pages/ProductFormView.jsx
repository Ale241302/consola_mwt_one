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
  productoAliasesApi, ncmApi,
  apiFetch, getToken,
} from "../lib/api.js";

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

  // En modo CREATE, si no hay brandId seleccionado y ya cargaron las
  // marcas reales, autoselecciona la primera (mejor UX que dropdown vacío).
  useEffect(() => {
    if (!brandId && realBrands.length > 0 && !isEdit) {
      setBrandId(realBrands[0].id);
    }
  }, [realBrands, brandId, isEdit]);

  // Agrupa tallas por sistema (`tipo_producto` o `sistema_medida`) para
  // el render. Si solo hay tallas "calzado", todas caen en un grupo.
  const sizesGrouped = useMemo(() => {
    const groups = {};
    realSizes.forEach(t => {
      const sys = (t.tipo_producto || 'otro').toLowerCase();
      (groups[sys] ||= []).push(t);
    });
    return groups;   // {calzado: [...], plantilla: [...]}
  }, [realSizes]);

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
        <label className="form-field">
          <span>{lang==='es'?'Marca':'Brand'}</span>
          <select className="input" value={brandId} onChange={e=>setBrandId(e.target.value)}>
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
                      await apiFetch(`/storage/delete/?key=${encodeURIComponent(k)}`, {
                        method: "DELETE", token: getToken(),
                      });
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
                      await apiFetch(`/storage/delete/?key=${encodeURIComponent(k)}`, {
                        method: "DELETE", token: getToken(),
                      });
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
        <AttrSelect label={lang==='es'?'Tipo de calzado':'Footwear type'} opts={BRAND_ATTRIBUTES.tipo_calzado}
                    value={attrs.tipo_calzado} onChange={v=>setAttrs({...attrs, tipo_calzado: v})}/>
        <AttrSelect label={lang==='es'?'Cubre puntera':'Toe cap cover'} opts={BRAND_ATTRIBUTES.cubrepuntera}
                    value={attrs.cubrepuntera} onChange={v=>setAttrs({...attrs, cubrepuntera: v})}/>
        <AttrSelect label={lang==='es'?'Tipo de puntera':'Toe cap type'} opts={BRAND_ATTRIBUTES.tipo_puntera}
                    value={attrs.tipo_puntera} onChange={v=>setAttrs({...attrs, tipo_puntera: v})}/>
        <AttrSelect label={lang==='es'?'Antiperforante':'Anti-perforation'} opts={BRAND_ATTRIBUTES.antiperforante}
                    value={attrs.antiperforante} onChange={v=>setAttrs({...attrs, antiperforante: v})}/>
        <AttrSelect label={lang==='es'?'Protector metatarsal':'Metatarsal protector'} opts={BRAND_ATTRIBUTES.protector_metatarsal}
                    value={attrs.protector_metatarsal} onChange={v=>setAttrs({...attrs, protector_metatarsal: v})}/>
        <AttrSelect label={lang==='es'?'Capellada':'Upper'} opts={BRAND_ATTRIBUTES.capellada}
                    value={attrs.capellada} onChange={v=>setAttrs({...attrs, capellada: v})}/>
        <AttrSelect label="Suela" opts={BRAND_ATTRIBUTES.suela}
                    value={attrs.suela} onChange={v=>setAttrs({...attrs, suela: v})}/>
        <AttrSelect label={lang==='es'?'Cierre':'Closure'} opts={BRAND_ATTRIBUTES.cierre}
                    value={attrs.cierre} onChange={v=>setAttrs({...attrs, cierre: v})}/>
        <AttrSelect label="Color" opts={BRAND_ATTRIBUTES.color}
                    value={attrs.color} onChange={v=>setAttrs({...attrs, color: v})}/>
        <AttrSelect label={lang==='es'?'Materiales circulares':'Circular materials'} opts={BRAND_ATTRIBUTES.materiales_circulares}
                    value={attrs.materiales_circulares} onChange={v=>setAttrs({...attrs, materiales_circulares: v})}/>
        <AttrSelect label={lang==='es'?'Plantilla interna':'Insole'} opts={BRAND_ATTRIBUTES.plantilla_interna}
                    value={attrs.plantilla_interna} onChange={v=>setAttrs({...attrs, plantilla_interna: v})}/>
        <label className="form-field">
          <span>NCM</span>
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
          {BRAND_ATTRIBUTES.disipativo_energia.map(v => {
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
          {BRAND_ATTRIBUTES.normativa.map(v => {
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
          {BRAND_ATTRIBUTES.segmento.map(v => {
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
          {BRAND_ATTRIBUTES.riesgo.map(r => {
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
            {isClient
              ? (lang==='es'?'Tallas del Motor de Tallas disponibles para este SKU.':'Sizing Engine sizes available for this SKU.')
              : (lang==='es'?'Tallas del Motor de Tallas + Nodos logísticos que operan el SKU.':'Sizing Engine sizes + logistics nodes operating the SKU.')}
          </div>
        </div>
      </div>

      {/* CLIENT B2B no ve la columna de Nodos Logísticos (información operativa
          interna de MWT). En portal renderizamos solo Motor de Tallas a
          ancho completo; staff ve 2 columnas (tallas + nodos). */}
      <div className={isClient ? '' : 'form-grid-2'}
           style={isClient ? { display: 'block' } : undefined}>
        <div>
          <div className="form-sub-title">
            <IconSliders size={13}/> {lang==='es'?'Motor de Tallas':'Sizing Engine'}
            <span className="caption" style={{marginLeft:'auto', color:'var(--text-tertiary)'}}>
              {selectedSizes.length} {lang==='es'?'seleccionadas':'selected'}
            </span>
          </div>
          <div className="size-picker">
            {realSizes.length === 0 ? (
              <div className="caption" style={{padding:'12px 0', color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'No hay tallas en BD. Crea las primeras en /tallas.'
                  : 'No sizes in DB. Create the first ones in /tallas.'}
              </div>
            ) : Object.entries(sizesGrouped).map(([sys, sysSizes]) => (
              <div key={sys} className="size-picker-group">
                <div className="size-picker-head" style={{'--sys-color':'#481EE3'}}>
                  <span className="size-dot" style={{background:'#481EE3'}}/>
                  {sys.toUpperCase()}
                </div>
                <div className="size-picker-row">
                  {sysSizes.map(sz => {
                    const on = selectedSizes.includes(sz.id);
                    const label = sz.talla_base || sz.eu || sz.us_men || sz.nombre || '—';
                    return (
                      <button type="button" key={sz.id}
                              className={`size-chip ${on ? 'size-chip-on' : ''}`}
                              onClick={()=>toggleSize(sz.id)}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Nodos Logísticos: OCULTO para CLIENT B2B (POL_VISIBILIDAD).
            Solo staff (admin/CEO/manager) ve qué nodos operan el SKU. */}
        {!isClient && (
          <div>
            <div className="form-sub-title">
              <IconFolder size={13}/> {lang==='es'?'Nodos logísticos':'Logistics nodes'}
              <span className="caption" style={{marginLeft:'auto', color:'var(--text-tertiary)'}}>
                {selectedNodes.length} {lang==='es'?'seleccionados':'selected'}
              </span>
            </div>
            <div className="node-picker">
              {realNodes.length === 0 ? (
                <div className="caption" style={{padding:'12px 0', color:'var(--text-tertiary)'}}>
                  {lang==='es'
                    ? 'No hay nodos logísticos en BD. Crea el primero en /nodos.'
                    : 'No logistics nodes in DB. Create the first one in /nodos.'}
                </div>
              ) : realNodes.map(n => {
                const on = selectedNodes.includes(n.id);
                const code  = n.codigo || n.node_id || n.id?.slice(0, 8) || '—';
                const name  = n.nombre || n.name   || '—';
                const flag  = n.flag   || (n.pais_iso2 ? `[${n.pais_iso2}]` : '🌐');
                return (
                  <button type="button" key={n.id}
                          className={`node-pick ${on ? 'node-pick-on' : ''}`}
                          onClick={()=>toggleNode(n.id)}>
                    <span className="node-pick-flag">{flag}</span>
                    <span className="node-pick-body">
                      <span className="mono-sm">{code}</span>
                      <span className="caption">{name}</span>
                    </span>
                    <span className="node-pick-check">
                      {on ? <IconCheck size={12}/> : <IconPlus size={12} style={{opacity:0.4}}/>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSectionD = () => (
    <div className="card card-pad-lg form-card">
      <div className="form-card-head">
        <IconLock size={16} style={{color:'#DC2626'}}/>
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
                fontSize: 12, background: '#F8FAFC', border: '1px dashed #CBD5E1',
                borderRadius: 8,
              }}>
                {lang === 'es' ? 'Cargando matrices…' : 'Loading matrices…'}
              </div>
            )}

            {!matricesLoading && clientMatrices.length === 0 && (
              <div style={{
                padding: 20, color: 'var(--text-tertiary)', fontSize: 12,
                background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 8,
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
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0', borderRadius: 10,
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
                          border: '1px solid #E5E7EB', background: '#FFFFFF',
                          color: '#64748B', cursor: 'pointer', padding: 0,
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
                        font: '700 13px/1.2 var(--font-body)', color: '#0B1E3A',
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
                        font: '500 10.5px/1.3 var(--font-body)', color: '#64748B',
                        marginTop: 2,
                      }}>
                        {c.pais_iso2 && <>{c.pais_iso2} · </>}
                        {lang === 'es' ? 'BRL base:' : 'BRL base:'}
                        <strong style={{ color: '#0B1E3A', marginLeft: 4 }}>
                          {c.brl_override != null ? Number(c.brl_override).toFixed(2) : '—'}
                        </strong>
                        {' · Com '}
                        <strong style={{ color: '#0B1E3A' }}>
                          {Number(c.com_pct).toFixed(2)}%
                        </strong>
                        {Number(c.ajuste_usd) > 0 && <>{' · Ajuste $'}<strong style={{ color: '#0B1E3A' }}>{Number(c.ajuste_usd).toFixed(2)}</strong></>}
                        {Number(c.sobreprecio_pct) > 0 && <>{' · Sobreprec '}<strong style={{ color: '#0B1E3A' }}>{(Number(c.sobreprecio_pct) * 100).toFixed(2)}%</strong></>}
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
// AttrSelect — small select field
// ────────────────────────────────────────────────
function AttrSelect({ label, opts, value, onChange }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select className="input" value={value} onChange={e=>onChange(e.target.value)}>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
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
