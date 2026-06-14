// =====================================================================
// MWT.ONE · pages/BrandClientPricingForm.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Ruta: /marcas/:brandId/clientes/:clienteId/precios
//
// Simulador de Precios — Marluvas v7
//   · Upload de Excel COMEX 2026 v7 (xlsx) → parsea SKUs en vivo.
//   · Vigencia (fecha inicio + fecha fin, opcional indefinida).
//   · Cotización USD/BRL en vivo (proxy backend con cache 15min) y
//     resaltado de la banda cambial vigente.
//   · Editor por SKU: toggle activo, comisión, ajuste USD, lista techo,
//     % sobreprecio derivado.
//   · Matriz 12 bandas × 4 plazos (90/60/30/8 días) calculada en vivo.
//   · Guardar: persiste la asignación + sube el Excel al backend
//     (reusa el endpoint POST /commercial/brand-client-pricing/ + upload-file/).
//
// POL_VISIBILIDAD:
//   · La sección de "Snapshot financiero" (comisión, días, límite) y la
//     matriz interna sólo se ven para isAdmin (rol CEO/admin).
//   · Por ahora la página entera es CEO-ONLY (es la consola interna).
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  IconChevLeft, IconUpload, IconCheck, IconAlert, IconLock,
  IconDollar, IconX, IconRefresh, IconTrash,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch, clientesApi, marcasApi } from "../lib/api.js";
import { CLIENTS, BRANDS } from "../data/mockData.js";
import {
  BANDAS_MARLUVAS, PLAZOS_MARLUVAS, bandaForTC, fmtUSD, fmtPct,
  FACTOR_COMISION, INDICE_ME_90,
} from "../constants/marluvas.js";
import {
  calcSKU, parseExcelMarluvas, defaultSkuState,
  computeMatrixFromInputs, cascadeRow, anchorPrice,
} from "../lib/marluvasPricing.js";
import { useExchangeRateUSDBRL } from "../hooks/useExchangeRateUSDBRL.js";
import SkuSizesPanel from "../components/marluvas/SkuSizesPanel.jsx";
import PlazoFormModal from "../components/marluvas/PlazoFormModal.jsx";
import { getBandPlazos, materializeDefaultPlazos } from "../lib/marluvasPricing.js";

// ─── Helpers backend → shape interno ──────────────────────────
const _FLAG_ISO2 = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};
function _adaptCliente(c) {
  if (!c) return null;
  const iso = (c.pais_iso2 || c.country_code || '').toUpperCase();
  const limite = c.credito_aprobado ?? c.credito_limit_usd ?? c.credito_limit;
  const dias   = c.dias_credito ?? c.credito_dias;
  return {
    id:                c.id || c.uuid,
    name:              c.razon_social || c.nombre_comercial || c.name || '—',
    razon_social:      c.razon_social,
    country:           c.pais || c.country,
    pais_iso2:         iso,
    flag:              c.flag || _FLAG_ISO2[iso] || '🌐',
    comision_pct:      c.comision_pct,
    dias_credito:      dias,
    credito_dias:      dias,
    credito_aprobado:  limite,
    credito_limit:     limite,
    credito_limit_usd: limite,
  };
}

// ─── Design tokens ───────────────────────────────────────────
const NAVY  = "var(--text-primary)";
const NAVY2 = "#1A2F52";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const AMBER = "#F59E0B";
const RED   = "var(--critical)";
const INK   = "var(--text-secondary)";
const MUTED = "var(--text-tertiary)";
const SOFT  = "var(--bg-alt)";
const TECHO = "#FCE4D6";
const TECHO_STRONG = "#F5B895";

// ═════════════════════════════════════════════════════════════
// Storage local del simulador (por brand+cliente).
// Persiste SKUs y ajustes mientras el operador modela; al guardar
// se sincroniza al backend.
// ═════════════════════════════════════════════════════════════
const lsKey = (brandId, clienteId) => `mwt:marluvas-sim:${brandId}:${clienteId}`;

function loadLocal(brandId, clienteId) {
  try {
    const raw = localStorage.getItem(lsKey(brandId, clienteId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveLocal(brandId, clienteId, data) {
  try { localStorage.setItem(lsKey(brandId, clienteId), JSON.stringify(data)); }
  catch { /* quota o privado */ }
}

// ═════════════════════════════════════════════════════════════
// Hook · SKUs habilitados del cliente (parseado del BCPA previo).
// Si el cliente nunca tuvo BCPA, devuelve `{ skus: Set(), source: 'empty' }`
// y el frontend muestra todos los SKUs del Excel sin filtrar.
// ═════════════════════════════════════════════════════════════
function useClientEnabledSkus(clienteId, brandId, accessToken) {
  const [data, setData] = useState({ skus: new Set(), source: "empty", loading: true });
  useEffect(() => {
    let cancelled = false;
    if (!clienteId) { setData({ skus: new Set(), source: "empty", loading: false }); return; }
    setData((d) => ({ ...d, loading: true }));
    const qs = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : "";
    apiFetch(`/commercial/clients/${clienteId}/enabled-skus/${qs}`, { token: accessToken })
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r?.skus) ? r.skus : [];
        setData({ skus: new Set(list.map(String)), source: r?.source || "empty", loading: false });
      })
      .catch(() => { if (!cancelled) setData({ skus: new Set(), source: "empty", loading: false }); });
    return () => { cancelled = true; };
  }, [clienteId, brandId, accessToken]);
  return data;
}

// (useExchangeRateUSDBRL ahora vive en hooks/useExchangeRateUSDBRL.js
//  para poder compartirse con ProductFormView — ver bloque de imports.)

// ═════════════════════════════════════════════════════════════
// Hook · carga simulación persistida desde backend.
// GET /commercial/marluvas/load-simulation/?brand_id=&cliente_id=
// Devuelve SkuInput[] hidratable + fechas + source.
// Si source === "empty" → skus=[] (fallback a localStorage en el caller).
// ═════════════════════════════════════════════════════════════
function useLoadSimulation(clienteId, brandId, accessToken) {
  const [data, setData] = useState({
    skus: [], fechaInicio: null, fechaFin: null,
    loading: true, source: "empty", cells: 0,
  });
  useEffect(() => {
    let cancelled = false;
    if (!clienteId || !brandId) {
      setData({ skus: [], fechaInicio: null, fechaFin: null, loading: false, source: "empty", cells: 0 });
      return;
    }
    setData((d) => ({ ...d, loading: true }));
    const qs = `?brand_id=${encodeURIComponent(brandId)}&cliente_id=${encodeURIComponent(clienteId)}`;
    apiFetch(`/commercial/marluvas/load-simulation/${qs}`, { token: accessToken })
      .then((r) => {
        if (cancelled) return;
        const rawSkus = Array.isArray(r?.skus) ? r.skus : [];
        const skus = rawSkus.map((s) => {
          const inputs = {
            sku:         String(s.sku),
            ref:         "",  // la ref viene del Excel
            brl:         s.brl_override != null ? Number(s.brl_override) : 0,
            com:         Number(s.com_pct ?? 0),
            ajuste:      Number(s.ajuste_usd ?? 0),
            sobreprecio: Number(s.sobreprecio_pct ?? 0),
            activo:      s.activo !== false,
          };
          // Hidratar matrix desde lo persistido (preserva overrides manuales).
          // Si el snapshot venía sin matrix (legacy), calculamos desde inputs.
          const frozen = s.prices_matrix && Object.keys(s.prices_matrix).length > 0
            ? Object.fromEntries(
                Object.entries(s.prices_matrix).map(([bandaId, row]) => [
                  String(bandaId),
                  Object.fromEntries(
                    Object.entries(row || {}).map(([dias, price]) => [String(dias), Number(price)])
                  ),
                ])
              )
            : computeMatrixFromInputs(inputs);
          return {
            ...inputs,
            matrix: frozen,
            // Fase 3 · hidratar overrides por talla si vinieron del backend
            ...(s.sizes_pricing && typeof s.sizes_pricing === "object"
                && Object.keys(s.sizes_pricing).length > 0
                ? { sizes_pricing: s.sizes_pricing } : {}),
          };
        });
        setData({
          skus,
          fechaInicio: r?.fecha_inicio || null,
          fechaFin:    r?.fecha_fin || null,
          loading: false,
          source: r?.source || "empty",
          cells:  Number(r?.cells || 0),
          // Fase 4 · custom_plazos viene top-level del response
          customPlazos: (r?.custom_plazos && typeof r.custom_plazos === "object")
            ? r.custom_plazos : {},
        });
      })
      .catch(() => {
        if (!cancelled) {
          setData({
            skus: [], fechaInicio: null, fechaFin: null,
            loading: false, source: "empty", cells: 0,
            customPlazos: {},
          });
        }
      });
    return () => { cancelled = true; };
  }, [clienteId, brandId, accessToken]);
  return data;
}

// ═════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════
export default function ScreenBrandClientPricingForm() {
  const { brandId, clienteId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext() || { lang: "es" };
  const { isAdmin } = useRole();
  const { accessToken } = useAuth();

  // ── Lookup cliente + marca ──
  const [client, setClient] = useState(null);
  const [brand,  setBrand]  = useState(null);
  const [lookupLoading, setLookupLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!clienteId) { setClient(null); setLookupLoading(false); return; }
    setLookupLoading(true);
    clientesApi.get(clienteId)
      .then(c => { if (!cancelled) setClient(_adaptCliente(c)); })
      .catch(() => {
        const mockHit = CLIENTS.find(c => (c.id || c.uuid) === clienteId);
        if (!cancelled) setClient(mockHit ? _adaptCliente(mockHit) : null);
      })
      .finally(() => { if (!cancelled) setLookupLoading(false); });
    return () => { cancelled = true; };
  }, [clienteId]);

  useEffect(() => {
    let cancelled = false;
    if (!brandId) { setBrand(null); return; }
    marcasApi.get(brandId)
      .then(b => { if (!cancelled) setBrand(b); })
      .catch(() => {
        const mockHit = BRANDS.find(b => b.id === brandId);
        if (!cancelled) setBrand(mockHit || null);
      });
    return () => { cancelled = true; };
  }, [brandId]);

  // ── Estado del simulador ──
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [skus, setSkus] = useState([]);          // SkuInput[]
  const [fechaInicio, setFechaInicio] = useState(today());
  const [fechaFin, setFechaFin] = useState("");
  const [fechaFinIndef, setFechaFinIndef] = useState(true);
  const [vista, setVista] = useState("editor");  // 'editor' | 'matriz'
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingFinTerm, setSavingFinTerm] = useState(null);
  const [banner, setBanner] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showAllSkus, setShowAllSkus] = useState(false);  // override del filtro enabled-skus
  const [filterStats, setFilterStats] = useState(null);   // {parsed, kept, filtered} para banda informativa
  const [bandFilter, setBandFilter] = useState("essentials");  // "essentials" | "current" | "all"
  // Ancla del editor (banda × plazo). Default = banda techo 90d (comportamiento legacy).
  // Persiste por (brand, cliente) en localStorage; no toca backend.
  const [anchor, setAnchor] = useState({ bandaId: 1, plazoDias: 90 });
  // Fase 4 · plazos custom por banda — global por (brand, cliente).
  // Shape: { "<bandaId>": [{dias, factor}] }
  // Bandas sin entrada usan defaults [90/60/30/8]. Bandas con entrada
  // usan SOLO esa lista (materialización lazy al agregar/quitar).
  const [customPlazos, setCustomPlazos] = useState({});
  // Modal de agregar/editar plazo: { open, contextBandaId, initial }
  const [plazoModal, setPlazoModal] = useState({
    open: false, contextBandaId: null, initial: null,
  });
  // Modal genérico de confirmación destructiva (reemplaza window.confirm).
  // Shape: null | { eyebrow, title, body, actionLabel, actionColor, onConfirm }
  const [confirmDialog, setConfirmDialog] = useState(null);
  const closeConfirm = () => setConfirmDialog(null);
  const runConfirm = () => {
    if (confirmDialog?.onConfirm) confirmDialog.onConfirm();
    setConfirmDialog(null);
  };

  // Fase 3 · Set de SKUs con su panel de tallas expandido. No persiste
  // (es estado de UI volátil, no de datos comerciales).
  const [expandedSkus, setExpandedSkus] = useState(() => new Set());
  const toggleExpanded = (sku) => setExpandedSkus((prev) => {
    const n = new Set(prev);
    if (n.has(sku)) n.delete(sku); else n.add(sku);
    return n;
  });
  const fileInputRef = useRef(null);

  const { tc, loading: tcLoading, error: tcError, ts: tcTs, source: tcSource, reload: reloadTC } =
    useExchangeRateUSDBRL(accessToken);
  const bandaVigente = useMemo(() => bandaForTC(tc), [tc]);

  // SKUs habilitados del cliente (Producto.especificaciones.visibility).
  const enabled = useClientEnabledSkus(clienteId, brandId, accessToken);

  // Simulación persistida en backend (precedencia sobre localStorage).
  const loaded = useLoadSimulation(clienteId, brandId, accessToken);
  const hydratedRef = useRef(false);

  // Bandas filtradas para la matriz · reduce densidad visual sin perder info.
  const filteredBands = useMemo(() => {
    if (bandFilter === "all") return BANDAS_MARLUVAS;
    if (bandFilter === "current") {
      return bandaVigente ? [bandaVigente] : [BANDAS_MARLUVAS[0]];
    }
    // essentials: techo + vigente (si no coincide con techo/piso) + piso
    const out = [BANDAS_MARLUVAS[0]];
    if (bandaVigente && bandaVigente.id !== 1 && bandaVigente.id !== 12) {
      out.push(bandaVigente);
    }
    out.push(BANDAS_MARLUVAS[11]);
    return out;
  }, [bandFilter, bandaVigente]);

  // Comisión por defecto = la del cliente (* 100). Si no existe, 0.
  const comDefault = useMemo(() => {
    if (!client || client.comision_pct == null) return 0;
    const pct = Number(client.comision_pct) * 100;
    return Number.isFinite(pct) ? Number(pct.toFixed(2)) : 0;
  }, [client]);

  // ── Hidratar estado: backend > localStorage ──
  // Esperamos a que enabled-skus y load-simulation hayan resuelto.
  // Corremos UNA sola vez por brand+cliente para no pisar ediciones
  // del operador en cada re-render.
  useEffect(() => {
    if (!brandId || !clienteId) return;
    if (enabled.loading || loaded.loading) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    // 1) Backend tiene simulación previa → hidratar desde ahí.
    if (loaded.source === "db" && loaded.skus.length > 0) {
      // Respetar enabled-skus salvo que el cliente no tenga lista (source empty).
      const useFilter = enabled.source !== "empty" && enabled.skus.size > 0;
      const filtered = useFilter
        ? loaded.skus.filter((s) => enabled.skus.has(String(s.sku)))
        : loaded.skus;
      setSkus(filtered);
      if (loaded.fechaInicio) setFechaInicio(loaded.fechaInicio);
      if (loaded.fechaFin) {
        setFechaFin(loaded.fechaFin);
        setFechaFinIndef(false);
      } else {
        setFechaFinIndef(true);
      }
      return;
    }

    // 2) Backend vacío → fallback a localStorage (flow original).
    const saved = loadLocal(brandId, clienteId);
    if (saved) {
      if (Array.isArray(saved.skus)) setSkus(saved.skus);
      if (saved.fechaInicio) setFechaInicio(saved.fechaInicio);
      if (saved.fechaFin) setFechaFin(saved.fechaFin);
      if (typeof saved.fechaFinIndef === "boolean") setFechaFinIndef(saved.fechaFinIndef);
      if (saved.anchor && typeof saved.anchor === "object"
          && Number.isFinite(saved.anchor.bandaId)
          && Number.isFinite(saved.anchor.plazoDias)) {
        setAnchor(saved.anchor);
      }
      // Fase 4 · hidratar customPlazos desde localStorage
      if (saved.customPlazos && typeof saved.customPlazos === "object") {
        setCustomPlazos(saved.customPlazos);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, clienteId, enabled.loading, loaded.loading]);

  // Fase 4 · hidratar customPlazos desde backend cuando llega el load.
  // Si el backend tiene una versión y localStorage no, usamos backend.
  useEffect(() => {
    if (loaded.loading) return;
    const fromBackend = loaded.customPlazos;
    if (fromBackend && typeof fromBackend === "object"
        && Object.keys(fromBackend).length > 0) {
      setCustomPlazos(fromBackend);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.loading]);

  // Reset del flag si cambia el par brand+cliente (navegación entre clientes).
  useEffect(() => { hydratedRef.current = false; }, [brandId, clienteId]);

  // ── Persistir cambios a localStorage (debounced trivial) ──
  useEffect(() => {
    if (!brandId || !clienteId) return;
    const id = setTimeout(() => {
      saveLocal(brandId, clienteId, {
        skus, fechaInicio, fechaFin, fechaFinIndef, anchor, customPlazos,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [brandId, clienteId, skus, fechaInicio, fechaFin, fechaFinIndef, anchor, customPlazos]);

  // ── Excel handler ──
  // `opts.showAll` permite forzar el override del filtro enabled-skus sin
  // depender del state `showAllSkus` (que puede no haberse propagado todavía
  // cuando este handler se invoca desde un onClick que también hace setState).
  const handleFile = async (f, opts = {}) => {
    if (!f) return;
    const ok = /\.(xlsx|xls)$/i.test(f.name || "");
    if (!ok) {
      setFileError(lang === "es" ? "Formato no soportado. Usa .xlsx o .xls." : "Unsupported format.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setFileError(lang === "es" ? "Máximo 15 MB." : "Max 15 MB.");
      return;
    }
    setFileError(null);
    setFile(f);
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseExcelMarluvas(buf, { XLSX });
      if (parsed.length === 0) {
        setBanner({ type: "error", msg: lang === "es"
          ? "No se detectaron SKUs Marluvas (formato 7xxxxx / 8xxxxx) en el Excel."
          : "No Marluvas SKUs detected in the file." });
        return;
      }

      // Filtro: SOURCE OF TRUTH = ClientAssignment.is_active=True (los toggles
      // "Excepciones por cliente" del detalle de cada producto).
      // - Si NO hay override "Mostrar todos del Excel" → solo SKUs habilitados.
      // - Si sí hay override → todos los SKUs del Excel.
      // Si el cliente no tiene ningún ClientAssignment, el resultado filtrado es
      // [] y el banner advierte que hay que configurarlos en cada producto.
      const useShowAll = opts.showAll ?? showAllSkus;
      const filteredParsed = useShowAll
        ? parsed
        : parsed.filter((p) => enabled.skus.has(String(p.sku)));

      // Merge: si ya había SKUs en estado, conservamos sus toggles/com/ajuste.
      // Si el BRL del Excel cambió respecto al state, regeneramos la matriz
      // (los overrides manuales por celda se pierden cuando cambia el BRL base).
      const prevBySku = new Map(skus.map((s) => [s.sku, s]));
      const merged = filteredParsed.map((p) => {
        const prev = prevBySku.get(p.sku);
        if (prev) {
          const next = { ...prev, brl: p.brl, ref: p.ref || prev.ref };
          if (Number(prev.brl) !== Number(p.brl) || !prev.matrix) {
            next.matrix = computeMatrixFromInputs(next);
          }
          return next;
        }
        return defaultSkuState(p, { com: comDefault });
      });
      setSkus(merged);
      setFilterStats({
        parsed: parsed.length,
        kept: merged.length,
        filtered: parsed.length - merged.length,
        applied: !useShowAll,
        enabledCount: enabled.skus.size,
      });
      // Banner contextual: empty list / filtered / show-all.
      let bannerMsg;
      if (!useShowAll && enabled.skus.size === 0) {
        bannerMsg = lang === "es"
          ? `Este cliente no tiene SKUs habilitados en Marluvas. Activá las excepciones en el detalle de cada producto.`
          : `This client has no enabled SKUs in Marluvas. Enable them in each product's detail.`;
      } else if (!useShowAll) {
        bannerMsg = lang === "es"
          ? `${merged.length} de ${parsed.length} SKUs (filtrados por habilitados del cliente).`
          : `${merged.length} of ${parsed.length} SKUs (filtered by client enabled list).`;
      } else {
        bannerMsg = lang === "es"
          ? `${merged.length} SKUs detectados desde ${f.name}.`
          : `${merged.length} SKUs detected from ${f.name}.`;
      }
      setBanner({
        type: (!useShowAll && enabled.skus.size === 0) ? "error" : "success",
        msg: bannerMsg,
      });
    } catch (e) {
      setBanner({ type: "error", msg: (lang === "es" ? "Error parseando Excel: " : "Excel parse error: ") + (e?.message || "") });
    } finally {
      setParsing(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Mutadores por SKU ──
  // Si el patch toca cualquier input bulk (brl, com, ajuste, sobreprecio),
  // REGENERAMOS la matriz desde la fórmula maestra. Los overrides manuales
  // por celda se pierden — es lo más predecible (el editor de la izquierda
  // se usa para modelar en bulk, la matriz para ajustes finos posteriores).
  const BULK_FIELDS = ["brl", "com", "ajuste", "sobreprecio"];
  const patchSku = (idx, patch) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== idx) return s;
      const merged = { ...s, ...patch };
      const touchesBulk = BULK_FIELDS.some((k) => k in patch);
      if (touchesBulk) {
        merged.matrix = computeMatrixFromInputs(merged, customPlazos);
      }
      return merged;
    }));
  };
  // Edición de UNA celda de la matriz.
  //
  // Dos semánticas según el plazo editado:
  //
  //   · Edit 90d (cualquier banda) → es el "precio ancla" → recalcular
  //     sobreprecio% global y regenerar TODA la matriz + editor refleja
  //     el nuevo valor. Esto sincroniza editor ↔ matriz para que sean
  //     dos vistas de los mismos datos.
  //
  //   · Edit 60d / 30d / 8d → cascade lateral SOLO en esa banda
  //     (recalcula los plazos más cortos con ratios relativos al nuevo
  //     valor). NO toca el editor ni otras bandas — el operador está
  //     rompiendo intencionalmente los descuentos default por esa banda.
  //
  // Fórmula del derrame 90d:
  //   nuevo_sobreprecio% = (P_90d_edited − P_base[banda] − Ajuste$) / P_base[banda]
  //   donde P_base[banda] = (BRL / div[banda]) × 1.0183^com × 1.030
  // Luego computeMatrixFromInputs regenera las 12 bandas con ese sobreprecio%.
  const patchCell = (idx, bandaId, plazoDias, newValue) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== idx) return s;
      const val = Number(newValue) || 0;
      const isAnchor90 = Number(plazoDias) === 90;

      if (isAnchor90) {
        // Edit 90d → retro-calcula BRL inverso, resetea ajuste/sobreprecio.
        const banda = BANDAS_MARLUVAS.find((b) => b.id === bandaId);
        if (!banda) return s;
        const factorCom = Math.pow(FACTOR_COMISION, Number(s.com || 0));
        const denom = factorCom * INDICE_ME_90;
        const newBrl = denom > 0
          ? Number(((val * banda.div) / denom).toFixed(4))
          : Number(s.brl || 0);
        const updated = {
          ...s,
          brl:         newBrl,
          ajuste:      0,
          sobreprecio: 0,
        };
        updated.matrix = computeMatrixFromInputs(updated, customPlazos);
        return updated;
      }

      // Cascade lateral local — Fase 4: respeta plazos efectivos de la banda.
      const matrix = s.matrix || computeMatrixFromInputs(s, customPlazos);
      const row = matrix[String(bandaId)] || {};
      const bandPlazos = getBandPlazos(bandaId, customPlazos);
      const newRow = cascadeRow(row, plazoDias, val, bandPlazos);
      return { ...s, matrix: { ...matrix, [String(bandaId)]: newRow } };
    }));
  };
  const toggleSku = (idx) => patchSku(idx, { activo: !skus[idx].activo });

  // ── Ancla por SKU (Fase 2) ──
  // Cada SKU puede tener su propia ancla {bandaId, plazoDias}. Si no la tiene,
  // hereda la del editor (state `anchor` global). Útil cuando distintos SKUs
  // de un cliente se cotizan con distintas perspectivas (palmilha siempre
  // en banda piso, bota siempre en vigente, etc.).
  const resolvedAnchor = (s) => {
    if (s.anchor
        && Number.isFinite(s.anchor.bandaId)
        && Number.isFinite(s.anchor.plazoDias)) {
      return s.anchor;
    }
    return anchor;
  };
  const patchSkuAnchor = (idx, partial) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== idx) return s;
      const current = s.anchor || anchor;
      return { ...s, anchor: { ...current, ...partial } };
    }));
  };
  const clearSkuAnchor = (idx) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== idx) return s;
      // Remueve `anchor` para que el SKU vuelva a usar el ancla global.
      // eslint-disable-next-line no-unused-vars
      const { anchor: _drop, ...rest } = s;
      return rest;
    }));
  };
  const clearAllSkuAnchors = () => {
    setSkus((arr) => arr.map((s) => {
      if (!s.anchor) return s;
      // eslint-disable-next-line no-unused-vars
      const { anchor: _drop, ...rest } = s;
      return rest;
    }));
  };

  // ─── Fase 3 · Overrides de precio por TALLA dentro de un SKU ──────
  //
  // Cada SKU puede tener sizes_pricing[tallaUuid] = { matrix, anchor }.
  // La PRIMERA edición de una celda de una talla SIN override clona la
  // matriz del SKU como punto de partida — así editás solo lo que cambia.
  // Edit 90d se trata como cascade lateral (no retro-calcula BRL: el
  // override de talla es LOCAL a esa talla, no propaga al SKU base).

  const setSkuSizeMatrixCell = (skuIdx, tallaUuid, bandaId, plazoDias, value) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== skuIdx) return s;
      const sp = s.sizes_pricing || {};
      const existing = sp[tallaUuid];
      // Materializar override si no existe — clonamos la matriz del SKU.
      const baseMatrix = existing?.matrix
        || JSON.parse(JSON.stringify(s.matrix || computeMatrixFromInputs(s)));
      const val = Number(value) || 0;
      const row = baseMatrix[String(bandaId)] || {};
      const newRow = cascadeRow(row, plazoDias, val);
      const nextMatrix = { ...baseMatrix, [String(bandaId)]: newRow };
      return {
        ...s,
        sizes_pricing: {
          ...sp,
          [tallaUuid]: {
            matrix: nextMatrix,
            ...(existing?.anchor ? { anchor: existing.anchor } : {}),
          },
        },
      };
    }));
  };

  const setSkuSizeAnchor = (skuIdx, tallaUuid, partial) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== skuIdx) return s;
      const sp = s.sizes_pricing || {};
      const existing = sp[tallaUuid];
      // Si la talla no tiene override aún, lo materializamos clonando matrix.
      const baseMatrix = existing?.matrix
        || JSON.parse(JSON.stringify(s.matrix || computeMatrixFromInputs(s)));
      const currentAnchor = existing?.anchor || (s.anchor || anchor);
      return {
        ...s,
        sizes_pricing: {
          ...sp,
          [tallaUuid]: {
            matrix: baseMatrix,
            anchor: { ...currentAnchor, ...partial },
          },
        },
      };
    }));
  };

  // ─── Fase 4 · Handlers de plazos personalizados por banda ─────────
  // Materialización lazy: agregar/quitar UNA vez en una banda copia
  // los defaults [90/60/30/8] a esa banda en customPlazos.
  // Quitar todos los plazos de una banda no la elimina del map — el
  // operador debe usar onResetBandPlazos para volver a defaults.

  const openAddPlazoModal  = (contextBandaId = null) => {
    setPlazoModal({ open: true, contextBandaId, initial: null });
  };
  const closeAddPlazoModal = () => {
    setPlazoModal({ open: false, contextBandaId: null, initial: null });
  };

  /**
   * Aplica un plazo (dias + factor) a una lista de bandas.
   * Materializa cada banda con defaults + el nuevo plazo si no estaba.
   * Si la banda ya tenía el mismo `dias`, reemplaza el factor.
   */
  const applyPlazoToBandas = ({ dias, factor, bandasIds }) => {
    setCustomPlazos((prev) => {
      const next = { ...prev };
      for (const bid of bandasIds) {
        const key = String(bid);
        const current = Array.isArray(next[key]) && next[key].length > 0
          ? next[key]
          : materializeDefaultPlazos();
        const filtered = current.filter((p) => Number(p.dias) !== Number(dias));
        filtered.push({ dias: Number(dias), factor: Number(factor) });
        filtered.sort((a, b) => b.dias - a.dias);
        next[key] = filtered;
      }
      return next;
    });
    // Regenerar las matrices de todos los SKUs con los nuevos plazos.
    setSkus((arr) => arr.map((s) => ({
      ...s,
      matrix: computeMatrixFromInputs(s, applyNextCustomPlazos({ dias, factor, bandasIds }, customPlazos)),
    })));
  };

  /** Helper sincrónico para calcular el nextCustomPlazos sin esperar setState. */
  const applyNextCustomPlazos = ({ dias, factor, bandasIds }, prev) => {
    const next = { ...prev };
    for (const bid of bandasIds) {
      const key = String(bid);
      const current = Array.isArray(next[key]) && next[key].length > 0
        ? next[key]
        : materializeDefaultPlazos();
      const filtered = current.filter((p) => Number(p.dias) !== Number(dias));
      filtered.push({ dias: Number(dias), factor: Number(factor) });
      filtered.sort((a, b) => b.dias - a.dias);
      next[key] = filtered;
    }
    return next;
  };

  /** Quita UN plazo de UNA banda. Si la banda no tenía custom todavía,
   *  la materializa con defaults y luego quita ese plazo. */
  const removePlazoFromBanda = (bandaId, plazoDias) => {
    setCustomPlazos((prev) => {
      const next = { ...prev };
      const key = String(bandaId);
      const current = Array.isArray(next[key]) && next[key].length > 0
        ? next[key]
        : materializeDefaultPlazos();
      const filtered = current.filter((p) => Number(p.dias) !== Number(plazoDias));
      next[key] = filtered;
      return next;
    });
    // Regenerar las matrices de todos los SKUs.
    setSkus((arr) => arr.map((s) => {
      const nextCp = (() => {
        const next = { ...customPlazos };
        const key = String(bandaId);
        const current = Array.isArray(next[key]) && next[key].length > 0
          ? next[key]
          : materializeDefaultPlazos();
        next[key] = current.filter((p) => Number(p.dias) !== Number(plazoDias));
        return next;
      })();
      return { ...s, matrix: computeMatrixFromInputs(s, nextCp) };
    }));
  };

  /** Resetea UNA banda a defaults: quita su entrada de customPlazos. */
  const resetBandaPlazos = (bandaId) => {
    setCustomPlazos((prev) => {
      const next = { ...prev };
      delete next[String(bandaId)];
      return next;
    });
    setSkus((arr) => arr.map((s) => {
      const nextCp = { ...customPlazos };
      delete nextCp[String(bandaId)];
      return { ...s, matrix: computeMatrixFromInputs(s, nextCp) };
    }));
  };

  const clearSkuSizeOverride = (skuIdx, tallaUuid) => {
    setSkus((arr) => arr.map((s, i) => {
      if (i !== skuIdx) return s;
      const sp = { ...(s.sizes_pricing || {}) };
      delete sp[tallaUuid];
      if (Object.keys(sp).length === 0) {
        // eslint-disable-next-line no-unused-vars
        const { sizes_pricing: _drop, ...rest } = s;
        return rest;
      }
      return { ...s, sizes_pricing: sp };
    }));
  };

  // ── Derivados ──
  const skusActivos = useMemo(() => skus.filter((s) => s.activo), [skus]);
  const calcs = useMemo(() => skus.map((s) => calcSKU(s)), [skus]);

  const resumen = useMemo(() => {
    const n = skusActivos.length;
    if (n === 0) return { n: 0, spAvg: null, comAvg: null, total90: 0, total8: 0 };
    let sumaSP = 0, sumaCom = 0, sum90 = 0, sum8 = 0;
    skus.forEach((s, i) => {
      if (!s.activo) return;
      const c = calcs[i];
      // El sobreprecio promedio que mostramos es el EFECTIVO (Ajuste $ + Sobreprecio %)
      // sobre la base — útil para medir el uplift comercial real.
      sumaSP += c.sobreprecioEfectivo;
      sumaCom += s.com;
      sum90 += c.listaTecho;
      sum8  += c.listaTecho * 0.9725;
    });
    return {
      n,
      spAvg:  sumaSP / n,
      comAvg: sumaCom / n,
      total90: sum90,
      total8:  sum8,
    };
  }, [skus, skusActivos, calcs]);

  // ── Save (asignación + upload Excel si existe) ──
  const save = async () => {
    setSaving(true);
    setBanner(null);
    try {
      // La habilitación SKU↔cliente vive en `pricing.client_assignment`
      // (toggles "Excepciones por cliente" del detalle del producto). El BCPA
      // sólo almacena el archivo + modificadores globales del cliente-marca.
      const notasPayload = `[Marluvas v7 sim · ${skusActivos.length} SKUs activos]`;

      const payload = {
        brand_id:   brandId,
        cliente_id: clienteId,
        fecha_inicio: fechaInicio || undefined,
        fecha_fin:    fechaFinIndef ? null : (fechaFin || null),
        sobre_precio_pct: resumen.spAvg != null
          ? Number(resumen.spAvg.toFixed(4))
          : null,
        pronto_pago_dias: null,
        pronto_pago_pct:  null,
        volumen_min_units: null,
        volumen_pct: null,
        notas: notasPayload,
      };
      const created = await apiFetch("/commercial/brand-client-pricing/", {
        method: "POST",
        body: payload,
        token: accessToken,
      });

      if (file && created?.id) {
        const fd = new FormData();
        fd.append("file", file);
        const API_BASE = import.meta.env.VITE_API_BASE || "/api";
        const resp = await fetch(
          `${API_BASE}/commercial/brand-client-pricing/${created.id}/upload-file/`,
          { method: "POST",
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: fd },
        );
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data?.detail || `HTTP ${resp.status}`);
        }
      }

      // Persistir la simulación granular (SKU × modificadores + matriz 12×4).
      // Mandamos TODOS los SKUs del state (incluso los inactivos) para que el
      // backend pueda restaurar la lista completa al re-hidratar.
      // La matriz que persistimos es la del state actual (s.matrix), que puede
      // incluir overrides manuales por celda — esos son intencionales y deben
      // congelarse como contrato.
      const simPayload = {
        brand_id:     brandId,
        cliente_id:   clienteId,
        fecha_inicio: fechaInicio || null,
        fecha_fin:    fechaFinIndef ? null : (fechaFin || null),
        // Fase 4 · plazos custom (top-level, vale para todos los SKUs)
        ...(customPlazos && Object.keys(customPlazos).length > 0
            ? { custom_plazos: customPlazos } : {}),
        // F6.1 · 2026-05-21 · Banda vigente (según TC del día) al
        // momento del save. El backend la persiste en
        // marluvas_price_history_event.banda_vigente_id para que el
        // visor del historial pinte correctamente VIGENTE/NEUTRAL en
        // "Todas las bandas". Si por algún motivo el TC no resolvió
        // banda (raro), omitimos el campo y el backend deja NULL.
        ...(Number.isFinite(Number(bandaVigente?.id))
            ? { banda_vigente_id: Number(bandaVigente.id) } : {}),
        skus: skus.map((s) => {
          // F6.2 · 2026-05-20 · Reconstrucción de la matriz garantizando
          // shape canónico: para CADA banda (1..12), incluir EXACTAMENTE
          // los plazos efectivos (defaults + custom_plazos[banda]). Si el
          // operador editó manualmente alguna celda, esa edición gana.
          // Las celdas con plazos que ya no existen (plazo eliminado) se
          // descartan — el snapshot refleja la grilla viva del momento
          // del save.
          //
          // Bug fix: antes la matriz se persistía "tal cual" desde s.matrix,
          // pero s.matrix podía no reflejar el último estado de customPlazos
          // (ej. si el usuario agregaba 120d a banda 1 y luego cambiaba el
          // BRL — el patchSku regenera la matriz con customPlazos sí, pero
          // si por algún edge case s.matrix se quedaba viejo, el snapshot
          // guardaba plazos defaults [90/60/30/8] y el visor mostraba "—"
          // en el plazo custom).
          const baseMatrix = computeMatrixFromInputs(s, customPlazos);
          const userMatrix = (s.matrix && typeof s.matrix === "object") ? s.matrix : {};
          const prices_matrix = {};
          for (const banda of BANDAS_MARLUVAS) {
            const bid = String(banda.id);
            const baseRow = baseMatrix[bid] || {};
            const userRow = userMatrix[bid] || {};
            const plazos  = getBandPlazos(banda.id, customPlazos);
            const plazosObj = {};
            for (const p of plazos) {
              const dKey = String(p.dias);
              // Prioridad: override manual del operador (userRow) > cálculo base (baseRow).
              const candidate = Number.isFinite(Number(userRow[dKey]))
                ? Number(userRow[dKey])
                : Number(baseRow[dKey]);
              if (Number.isFinite(candidate)) {
                plazosObj[dKey] = Number(candidate.toFixed(4));
              }
            }
            // Persistir incluso si la banda no tiene celdas (caso degenerado).
            prices_matrix[bid] = plazosObj;
          }
          // F6 · Ancla efectiva por SKU para el snapshot histórico.
          // Si el SKU tiene override (s.anchor), usa ese; si no, hereda
          // del ancla global del editor (anchor). El backend lo guarda
          // sólo en marluvas_price_history_sku.anchor — la tabla viva
          // (marluvas_client_sku_pricing) lo ignora.
          const effectiveAnchor = (s.anchor
              && Number.isFinite(Number(s.anchor.bandaId))
              && Number.isFinite(Number(s.anchor.plazoDias)))
            ? { bandaId: Number(s.anchor.bandaId), plazoDias: Number(s.anchor.plazoDias) }
            : (Number.isFinite(Number(anchor?.bandaId)) && Number.isFinite(Number(anchor?.plazoDias))
                ? { bandaId: Number(anchor.bandaId), plazoDias: Number(anchor.plazoDias) }
                : null);
          return {
            sku:             String(s.sku),
            brl_override:    Number.isFinite(Number(s.brl)) ? Number(s.brl) : null,
            com_pct:         Number(s.com || 0),
            ajuste_usd:      Number(s.ajuste || 0),
            sobreprecio_pct: Number(s.sobreprecio || 0),
            prices_matrix,
            // F6 · Ancla congelada por SKU (snapshot histórico only).
            ...(effectiveAnchor ? { anchor: effectiveAnchor } : {}),
            // Fase 3 · overrides por talla (opcional, omitir si vacío)
            ...(s.sizes_pricing && Object.keys(s.sizes_pricing).length > 0
                ? { sizes_pricing: s.sizes_pricing } : {}),
            activo:          !!s.activo,
          };
        }),
      };
      const simResp = await apiFetch("/commercial/marluvas/save-simulation/", {
        method: "POST",
        body: simPayload,
        token: accessToken,
      });
      const savedCount = Number(simResp?.saved ?? skusActivos.length);
      const savedCells = Number(simResp?.cells ?? savedCount * 48);

      setBanner({ type: "success", msg: lang === "es"
        ? `Lista guardada · ${savedCount} SKUs · ${savedCells} precios congelados (12 bandas × 4 plazos).`
        : `Price list saved · ${savedCount} SKUs · ${savedCells} prices frozen (12 bands × 4 terms).` });
    } catch (err) {
      setBanner({ type: "error",
        msg: String(err?.body?.detail || err?.message || err) });
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───
  if (lookupLoading) {
    return (
      <div className="page">
        <div style={emptyCard}>
          <div style={{ color: MUTED, fontSize: 13 }}>
            {lang === "es" ? "Cargando cliente…" : "Loading client…"}
          </div>
        </div>
      </div>
    );
  }
  if (!client) {
    return (
      <div className="page">
        <div style={emptyCard}>
          <IconAlert size={22} style={{ color: MUTED, marginBottom: 8 }}/>
          <div>{lang === "es" ? "Cliente no encontrado." : "Client not found."}</div>
          <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>ID: {clienteId}</div>
          <button onClick={() => navigate("/marcas")} style={{ ...btnGhost, marginTop: 14 }}>
            {lang === "es" ? "Volver" : "Back"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: 120 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button onClick={() => navigate(`/marcas/${brandId}`)} style={btnGhost}>
          <IconChevLeft size={13}/>
          {lang === "es" ? "Volver" : "Back"}
        </button>
        <span style={{ color: MUTED, fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12, color: MUTED }}>{lang === "es" ? "Marcas" : "Brands"}</span>
        <span style={{ color: MUTED }}>/</span>
        <span style={{ fontSize: 12, color: NAVY }}>{brand?.nombre || brandId}</span>
        <span style={{ color: MUTED }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
          {lang === "es" ? "Motor de Precios — " : "Pricing Engine — "}{client.razon_social || client.name}
        </span>
      </div>

      {/* Header · cliente + snapshot financiero */}
      <div style={{
        background: `linear-gradient(135deg, var(--brand-primary) 0%, ${NAVY2} 100%)`,
        color: "#FFFFFF", padding: "18px 22px", borderRadius: 12,
        marginBottom: 16,
        display: "grid",
        gridTemplateColumns: isAdmin ? "1fr auto" : "1fr",
        gap: 18, alignItems: "center",
      }}>
        <div>
          <div style={{ font: "500 10.5px/1 var(--font-body)", opacity: 0.65,
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            {lang === "es" ? "Simulador de Precios" : "Pricing Simulator"} · Marluvas v7
          </div>
          <div style={{ font: "700 20px/1.2 var(--font-body)" }}>
            {client.razon_social || client.name}
          </div>
          <div style={{ font: "500 11.5px/1.4 var(--font-body)", opacity: 0.75, marginTop: 4 }}>
            {brand?.nombre || "—"} · {client.country || client.pais_iso2} · 12 bandas × 4 plazos
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <SnapshotBadge
              label={lang === "es" ? "Comisión" : "Commission"}
              value={client.comision_pct != null ? `${(Number(client.comision_pct) * 100).toFixed(2)}%` : "—"}
              color={LIGHT}
              editable
              rawValue={client.comision_pct != null ? Number((Number(client.comision_pct) * 100).toFixed(4)) : null}
              suffix="%"
              parse={(s) => { const n = Number(String(s).replace(",", ".")); return Number.isNaN(n) ? null : n; }}
              saving={savingFinTerm === "comision"}
              onSave={async (newPct) => {
                if (newPct < 0 || newPct > 100) {
                  setBanner({ type: "error", msg: lang === "es" ? "Comisión 0–100%." : "Commission 0-100%." });
                  return;
                }
                setSavingFinTerm("comision");
                try {
                  const fraction = Number((newPct / 100).toFixed(4));
                  await clientesApi.update(clienteId, { comision_pct: fraction });
                  setClient((c) => c ? { ...c, comision_pct: fraction } : c);
                  setBanner({ type: "success", msg: lang === "es" ? "Comisión actualizada." : "Updated." });
                } catch (e) {
                  setBanner({ type: "error", msg: (lang === "es" ? "Error: " : "Error: ") + (e?.message || "") });
                } finally { setSavingFinTerm(null); }
              }}
            />
            <SnapshotBadge
              label={lang === "es" ? "Días crédito" : "Credit days"}
              value={`${client.credito_dias ?? client.dias_credito ?? 0}d`}
              color="#FFFFFF"
              editable
              rawValue={client.credito_dias ?? client.dias_credito ?? 0}
              suffix="d"
              parse={(s) => { const n = parseInt(String(s).trim(), 10); return Number.isNaN(n) ? null : n; }}
              saving={savingFinTerm === "dias"}
              onSave={async (newDias) => {
                if (newDias < 0 || newDias > 365) {
                  setBanner({ type: "error", msg: lang === "es" ? "Días 0–365." : "Days 0-365." });
                  return;
                }
                setSavingFinTerm("dias");
                try {
                  await clientesApi.update(clienteId, { dias_credito: newDias });
                  setClient((c) => c ? { ...c, dias_credito: newDias, credito_dias: newDias } : c);
                  setBanner({ type: "success", msg: lang === "es" ? "Días actualizados." : "Updated." });
                } catch (e) {
                  setBanner({ type: "error", msg: (lang === "es" ? "Error: " : "Error: ") + (e?.message || "") });
                } finally { setSavingFinTerm(null); }
              }}
            />
            <SnapshotBadge
              label={lang === "es" ? "Límite" : "Limit"}
              value={fmtMoney(client.credito_limit_usd ?? client.credito_limit)}
              color="#FFFFFF"
            />
          </div>
        )}
      </div>

      {/* Banda cambial en vivo + control de vista */}
      <ExchangeRateBar
        tc={tc} loading={tcLoading} error={tcError} ts={tcTs} source={tcSource}
        bandaVigente={bandaVigente}
        vista={vista} onVistaChange={setVista}
        onReload={reloadTC} lang={lang}
      />

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{
              padding: "10px 14px", marginBottom: 14,
              background: banner.type === "success" ? `${MINT}15` : `${RED}15`,
              color: banner.type === "success" ? "#065F46" : "#991B1B",
              border: `1px solid ${banner.type === "success" ? `${MINT}55` : `${RED}55`}`,
              borderRadius: 8,
              font: "500 12.5px/1.4 var(--font-body)",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {banner.type === "success" ? <IconCheck size={14}/> : <IconAlert size={14}/>}
            {banner.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Banner contextual del filtro enabled-skus */}
      {filterStats && filterStats.applied && filterStats.enabledCount === 0 && (
        <div style={{
          padding: "11px 14px", marginBottom: 14,
          background: `${RED}10`, border: `1px solid ${RED}55`, borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          font: "500 12px/1.4 var(--font-body)", color: "#7F1D1D",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconAlert size={13}/>
            {lang === "es"
              ? <>El cliente <strong>{client?.razon_social || client?.name}</strong> no tiene SKUs de {brand?.nombre || "esta marca"} habilitados. Activá las excepciones desde el detalle de cada producto (tab <em>Gobernanza y precios</em>).</>
              : <>This client has no enabled SKUs for {brand?.nombre || "this brand"}. Enable them in each product's detail (<em>Governance & Prices</em> tab).</>}
          </div>
          <button type="button"
            onClick={() => {
              setShowAllSkus(true);
              if (file) handleFile(file, { showAll: true });
            }}
            style={{
              padding: "5px 11px", background: "var(--surface-raised)",
              border: `1px solid ${RED}`, color: "#7F1D1D",
              font: "600 11px/1 var(--font-body)",
              borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            {lang === "es" ? "Mostrar todos (preview)" : "Show all (preview)"}
          </button>
        </div>
      )}
      {filterStats && filterStats.applied && filterStats.enabledCount > 0 && filterStats.filtered > 0 && (
        <div style={{
          padding: "9px 14px", marginBottom: 14,
          background: `${MINT}10`, border: `1px solid ${MINT}55`, borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          font: "500 12px/1.4 var(--font-body)", color: "#065F46",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconCheck size={12}/>
            {lang === "es"
              ? <>Mostrando <strong>{filterStats.kept}</strong> de <strong>{filterStats.parsed}</strong> SKUs · filtrados por <strong>{filterStats.enabledCount}</strong> habilitados para este cliente. <strong>{filterStats.filtered}</strong> ocultos.</>
              : <>Showing <strong>{filterStats.kept}</strong> of <strong>{filterStats.parsed}</strong> SKUs · filtered by <strong>{filterStats.enabledCount}</strong> enabled for this client.</>}
          </div>
          <button type="button"
            onClick={() => {
              setShowAllSkus(true);
              if (file) handleFile(file, { showAll: true });
            }}
            style={{
              padding: "5px 11px", background: "var(--surface-raised)",
              border: `1px solid ${MINT}`, color: "#065F46",
              font: "600 11px/1 var(--font-body)",
              borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            {lang === "es" ? "Mostrar todos del Excel" : "Show all"}
          </button>
        </div>
      )}
      {filterStats && !filterStats.applied && (
        <div style={{
          padding: "9px 14px", marginBottom: 14,
          background: SOFT, border: "1px solid var(--border)", borderRadius: 8,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          font: "500 12px/1.4 var(--font-body)", color: MUTED,
        }}>
          <div>
            {lang === "es"
              ? <>Override activo · mostrando los <strong>{filterStats.kept}</strong> SKUs del Excel (sin filtrar por habilitados).</>
              : <>Override on · showing all <strong>{filterStats.kept}</strong> SKUs from the Excel.</>}
          </div>
          {filterStats.enabledCount > 0 && (
            <button type="button"
              onClick={() => {
                setShowAllSkus(false);
                if (file) handleFile(file, { showAll: false });
              }}
              style={{
                padding: "5px 11px", background: "var(--surface-raised)",
                border: "1px solid var(--border)", color: INK,
                font: "600 11px/1 var(--font-body)",
                borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
              }}>
              {lang === "es" ? `Filtrar por ${filterStats.enabledCount} habilitados` : `Filter to ${filterStats.enabledCount} enabled`}
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── 1 · Archivo Excel + Vigencia (lado a lado) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14 }}>
          <Section
            title={lang === "es" ? "Archivo de precios Marluvas v7" : "Marluvas v7 price file"}
            subtitle={lang === "es"
              ? "Sube el Excel COMEX 2026 v7. Detecta SKUs Marluvas (7xxxxx / 8xxxxx) y carga el precio BRL base."
              : "Upload the COMEX 2026 v7 Excel."}
            badge={skus.length ? { label: `${skus.length} SKUS`, color: NAVY, bg: `${MINT}22` } : null}
          >
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? MINT : file ? MINT : "var(--border)"}`,
                background: dragOver ? `${MINT}0D` : file ? `${MINT}06` : SOFT,
                borderRadius: 10,
                padding: 22, textAlign: "center",
                cursor: parsing ? "wait" : "pointer",
                transition: "all 160ms ease",
              }}
            >
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden
                     onChange={e => handleFile(e.target.files?.[0])}/>
              {parsing ? (
                <div style={{ color: MUTED, font: "500 12px/1.3 var(--font-body)" }}>
                  {lang === "es" ? "Procesando Excel…" : "Parsing Excel…"}
                </div>
              ) : file ? (
                <div>
                  <IconCheck size={22} style={{ color: MINT, marginBottom: 6 }}/>
                  <div style={{ font: "700 13px/1.2 var(--font-body)", color: NAVY }}>{file.name}</div>
                  <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: MUTED, marginTop: 3 }}>
                    {(file.size / 1024).toFixed(1)} KB · {skus.length} SKUs
                  </div>
                  <button type="button"
                    onClick={e => { e.stopPropagation(); setFile(null); }}
                    style={{
                      marginTop: 8, padding: "3px 9px",
                      border: "1px solid var(--border)", background: "var(--surface-raised)",
                      color: MUTED, borderRadius: 6, cursor: "pointer",
                      font: "500 10.5px/1 var(--font-body)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                    <IconX size={10}/>{lang === "es" ? "Cambiar" : "Change"}
                  </button>
                </div>
              ) : (
                <div>
                  <IconUpload size={22} style={{ color: dragOver ? MINT : MUTED, marginBottom: 8 }}/>
                  <div style={{ font: "700 13px/1.2 var(--font-body)", color: NAVY }}>
                    {lang === "es" ? "Arrastra el Excel o click" : "Drag the Excel or click"}
                  </div>
                  <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: MUTED, marginTop: 3 }}>
                    .xlsx · .xls · max 15 MB
                  </div>
                </div>
              )}
            </div>
            {fileError && (
              <div style={{
                marginTop: 8, font: "500 11px/1.3 var(--font-body)", color: RED,
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <IconAlert size={11}/>{fileError}
              </div>
            )}
          </Section>

          <Section
            title={lang === "es" ? "Vigencia" : "Validity"}
            subtitle={lang === "es" ? "Período activo de esta lista." : "Active period."}
          >
            <Field label={lang === "es" ? "Inicio" : "Start"}>
              <Input type="date" value={fechaInicio} onChange={setFechaInicio}/>
            </Field>
            <div style={{ marginTop: 10 }}>
              <Label>{lang === "es" ? "Fin" : "End"}</Label>
              <div style={{ display: "flex", gap: 6 }}>
                <Input type="date" value={fechaFin} onChange={setFechaFin}
                       disabled={fechaFinIndef}
                       style={{ opacity: fechaFinIndef ? 0.45 : 1 }}/>
                <motion.button type="button" whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    const next = !fechaFinIndef;
                    setFechaFinIndef(next);
                    if (next) setFechaFin("");
                  }}
                  style={{
                    padding: "0 12px",
                    border: `1.5px solid ${fechaFinIndef ? MINT : "var(--border)"}`,
                    background: fechaFinIndef ? `${MINT}10` : "var(--surface-raised)",
                    color: fechaFinIndef ? MINT : INK,
                    font: "600 11px/1 var(--font-body)",
                    borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
                  }}>
                  {fechaFinIndef && <IconCheck size={10}/>}
                  {lang === "es" ? " Indef." : " Indef."}
                </motion.button>
              </div>
            </div>
          </Section>
        </div>

        {/* ── 2 · Editor SKUs · ancla configurable ── */}
        {vista === "editor" && skus.length > 0 && (() => {
          // Banda + plazo del ancla — se usa en headers, celdas y resumen.
          const anchorBanda = BANDAS_MARLUVAS.find((b) => b.id === anchor.bandaId) || BANDAS_MARLUVAS[0];
          const anchorPlazo = PLAZOS_MARLUVAS.find((p) => p.dias === anchor.plazoDias) || PLAZOS_MARLUVAS[0];
          const anchorLabel = `${anchorBanda.rango} · ${anchorPlazo.dias}d`;
          const isAnchorTecho   = !!anchorBanda.techo;
          const isAnchorPiso    = !!anchorBanda.piso;
          const isAnchorVigente = bandaVigente?.id === anchorBanda.id;
          const anchorTag = isAnchorTecho ? "TECHO"
                          : isAnchorPiso  ? "PISO"
                          : isAnchorVigente ? "VIGENTE"
                          : `#${anchorBanda.id}`;
          // Colores del ancla — heredan del tipo de banda (techo crema, piso verde, etc.)
          const anchorBg = isAnchorTecho ? TECHO
                         : isAnchorPiso  ? "#D1FAE5"
                         : isAnchorVigente ? "#FEF3C7"
                         : `${MINT}15`;
          const anchorFg = isAnchorTecho ? "#9A4A1D"
                         : isAnchorPiso  ? "#065F46"
                         : isAnchorVigente ? "#92400E"
                         : NAVY;
          return (
          <Section
            title={lang === "es"
              ? `SKUs · Anclado a ${anchorLabel}`
              : `SKUs · Anchored to ${anchorLabel}`}
            subtitle={lang === "es"
              ? "Base USD y Lista USD muestran la banda + plazo seleccionados como ancla. Editar Ajuste $ o Sobreprecio % en el editor regenera la matriz completa con el modelo aditivo: Lista = Base + Ajuste + Base × Sobreprecio."
              : "Base USD and List USD reflect the selected anchor (band + term). Edit Adj. $ or Markup % to regenerate the full matrix: List = Base + Adj. + Base × Markup."}
            badge={{ label: `${skusActivos.length}/${skus.length} ACTIVOS`, color: NAVY, bg: `${MINT}22` }}
          >
            {/* Toolbar selector de ancla (banda + plazo) */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              marginBottom: 14, padding: "10px 14px",
              background: SOFT, border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <span style={{ font: "700 10px/1 var(--font-body)", color: MUTED,
                textTransform: "uppercase", letterSpacing: 0.5 }}>
                {lang === "es" ? "Anclar editor a" : "Anchor editor to"}
              </span>
              <select
                value={anchor.bandaId}
                onChange={(e) => setAnchor({ ...anchor, bandaId: Number(e.target.value) })}
                style={{
                  padding: "5px 8px", borderRadius: 5,
                  border: "1px solid var(--border)", background: "var(--surface-raised)",
                  font: "600 11.5px/1 var(--font-body)", color: NAVY,
                  cursor: "pointer", outline: "none",
                  fontVariantNumeric: "tabular-nums",
                }}>
                {BANDAS_MARLUVAS.map((b) => {
                  const tag = b.techo ? " · TECHO"
                            : b.piso  ? " · PISO"
                            : bandaVigente?.id === b.id ? " · VIGENTE" : "";
                  return (
                    <option key={b.id} value={b.id}>
                      #{b.id} · {b.rango} · ÷{b.div.toFixed(2)}{tag}
                    </option>
                  );
                })}
              </select>
              <select
                value={anchor.plazoDias}
                onChange={(e) => setAnchor({ ...anchor, plazoDias: Number(e.target.value) })}
                style={{
                  padding: "5px 8px", borderRadius: 5,
                  border: "1px solid var(--border)", background: "var(--surface-raised)",
                  font: "600 11.5px/1 var(--font-body)", color: NAVY,
                  cursor: "pointer", outline: "none",
                  fontVariantNumeric: "tabular-nums",
                }}>
                {/* Fase 4 · plazos efectivos de la banda anclada del editor global. */}
                {getBandPlazos(anchor.bandaId, customPlazos).map((p) => (
                  <option key={p.dias} value={p.dias}>
                    {p.dias}d · {p.sub}
                  </option>
                ))}
              </select>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 9px", borderRadius: 12,
                background: anchorBg, color: anchorFg,
                font: "700 9.5px/1.2 var(--font-body)",
                textTransform: "uppercase", letterSpacing: 0.5,
                border: `1px solid ${anchorFg}55`,
              }}>
                {anchorTag} · ÷{anchorBanda.div.toFixed(2)}
              </span>
              {/* Contador de SKUs con override individual + acción "limpiar todos" */}
              {(() => {
                const overriddenCount = skus.filter((s) => !!s.anchor).length;
                return overriddenCount > 0 ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "3px 9px", borderRadius: 12,
                    background: `${AMBER}15`, color: "#92400E",
                    font: "700 9.5px/1.2 var(--font-body)",
                    border: `1px solid ${AMBER}55`,
                    textTransform: "uppercase", letterSpacing: 0.4,
                  }}
                    title={lang === "es"
                      ? "Cada SKU puede tener su propia ancla — override por fila"
                      : "Each SKU can have its own anchor"}>
                    {overriddenCount} {lang === "es" ? "SKUs con ancla propia" : "SKUs with own anchor"}
                    <button type="button"
                      onClick={() => {
                        setConfirmDialog({
                          tone: "warning",
                          title: lang === "es"
                            ? `¿Resetear el ancla individual de ${overriddenCount} SKU(s)?`
                            : `Reset individual anchor of ${overriddenCount} SKU(s)?`,
                          body: lang === "es"
                            ? (<>Los <strong>{overriddenCount} SKU(s)</strong> volverán a usar el ancla global definida arriba. Sus overrides individuales se descartarán.</>)
                            : (<>The <strong>{overriddenCount} SKU(s)</strong> will revert to the global anchor defined above. Their individual overrides will be discarded.</>),
                          actionLabel: lang === "es" ? "Resetear anclas" : "Reset anchors",
                          onConfirm: () => clearAllSkuAnchors(),
                        });
                      }}
                      style={{
                        marginLeft: 4, padding: "0 5px", borderRadius: 3,
                        border: "1px solid " + AMBER + "55", background: "var(--surface-raised)",
                        color: "#92400E", cursor: "pointer",
                        font: "700 10px/1 var(--font-body)",
                      }}
                      title={lang === "es"
                        ? "Limpiar anclas individuales de todos los SKUs"
                        : "Clear individual anchors of all SKUs"}>
                      ↺
                    </button>
                  </span>
                ) : null;
              })()}
              <button type="button"
                onClick={() => setAnchor({ bandaId: 1, plazoDias: 90 })}
                disabled={anchor.bandaId === 1 && anchor.plazoDias === 90}
                style={{
                  marginLeft: "auto",
                  padding: "5px 10px", borderRadius: 5,
                  border: "1px solid var(--border)", background: "var(--surface-raised)", color: MUTED,
                  font: "600 10.5px/1 var(--font-body)", cursor: "pointer",
                  opacity: (anchor.bandaId === 1 && anchor.plazoDias === 90) ? 0.4 : 1,
                }}
                title={lang === "es"
                  ? "Resetear ancla global a banda techo 90d (default)"
                  : "Reset global anchor to top band 90d"}>
                {lang === "es" ? "Resetear global" : "Reset global"}
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={tblSku}>
                <thead>
                  <tr>
                    <th style={{ ...thSku, width: 28 }}></th>
                    <th style={{ ...thSku, width: 36 }}></th>
                    <th style={{ ...thSku, textAlign: "left", paddingLeft: 12 }}>SKU</th>
                    <th style={{ ...thSku, textAlign: "left" }}>{lang === "es" ? "Referencia" : "Reference"}</th>
                    <th style={thSku}>BRL</th>
                    <th style={thSku}>Com %</th>
                    <th style={thSku}>
                      {lang === "es" ? "Ancla SKU" : "SKU anchor"}<br/>
                      <small style={{ opacity: 0.7, fontWeight: 500 }}>
                        {lang === "es" ? "override del global" : "global override"}
                      </small>
                    </th>
                    <th style={thSku}>
                      Base USD<br/>
                      <small style={{ opacity: 0.7, fontWeight: 500 }}>
                        {lang === "es" ? "ancla del SKU" : "SKU anchor"}
                      </small>
                    </th>
                    <th style={thSku}>
                      {lang === "es" ? "Ajuste $" : "Adj. $"}
                    </th>
                    <th style={thSku}>{lang === "es" ? "Sobreprecio" : "Markup"}</th>
                    <th style={thSku}>
                      {lang === "es" ? "Lista USD" : "List USD"}<br/>
                      <small style={{ opacity: 0.7, fontWeight: 500 }}>
                        {lang === "es" ? "ancla del SKU" : "SKU anchor"}
                      </small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s, i) => {
                    const c = calcs[i];
                    // Cada SKU resuelve su propia ancla (override > global).
                    const sAnchor = resolvedAnchor(s);
                    const ap = anchorPrice(s, sAnchor);
                    const hasOverride = !!s.anchor;
                    const sBanda = BANDAS_MARLUVAS.find((b) => b.id === sAnchor.bandaId) || BANDAS_MARLUVAS[0];
                    // Colores específicos del ancla de este SKU
                    const sBg = sBanda.techo ? TECHO
                              : sBanda.piso  ? "#D1FAE5"
                              : bandaVigente?.id === sBanda.id ? "#FEF3C7"
                              : `${MINT}15`;
                    const sFg = sBanda.techo ? "#9A4A1D"
                              : sBanda.piso  ? "#065F46"
                              : bandaVigente?.id === sBanda.id ? "#92400E"
                              : NAVY;
                    return (
                      <React.Fragment key={s.sku}>
                      <tr style={{ opacity: s.activo ? 1 : 0.4 }}>
                        {/* Chevron expandir panel de tallas */}
                        <td style={tdSku}>
                          <button type="button"
                            onClick={() => toggleExpanded(s.sku)}
                            style={{
                              width: 22, height: 22, borderRadius: 4,
                              border: "1px solid var(--border)", background: "var(--surface-raised)",
                              color: MUTED, cursor: "pointer", padding: 0,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              transition: "transform 140ms ease",
                              transform: expandedSkus.has(s.sku) ? "rotate(90deg)" : "rotate(0deg)",
                              font: "700 11px/1 var(--font-body)",
                            }}
                            title={lang === "es"
                              ? "Ver/editar overrides por talla"
                              : "View/edit per-size overrides"}>
                            ▶
                          </button>
                        </td>
                        <td style={tdSku}>
                          <button type="button" onClick={() => toggleSku(i)}
                            style={{
                              width: 20, height: 20, borderRadius: 5,
                              border: `1.5px solid ${s.activo ? MINT : "var(--border)"}`,
                              background: s.activo ? MINT : "var(--surface-raised)",
                              cursor: "pointer", display: "inline-flex",
                              alignItems: "center", justifyContent: "center",
                            }}>
                            {s.activo && <IconCheck size={12} style={{ color: "#FFFFFF" }}/>}
                          </button>
                        </td>
                        <td style={{ ...tdSku, textAlign: "left", paddingLeft: 12, color: MUTED, fontSize: 10 }}>{s.sku}</td>
                        <td style={{ ...tdSku, textAlign: "left", fontFamily: "var(--font-body)", fontWeight: 600, color: NAVY, fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.ref}>
                          {s.ref}
                          {(() => {
                            const ovc = Object.keys(s.sizes_pricing || {}).length;
                            if (ovc === 0) return null;
                            return (
                              <span style={{
                                marginLeft: 6, padding: "2px 6px", borderRadius: 8,
                                background: `${AMBER}18`, color: "#92400E",
                                font: "700 8.5px/1 var(--font-body)",
                                border: `1px solid ${AMBER}55`,
                                textTransform: "uppercase", letterSpacing: 0.4,
                                verticalAlign: "middle",
                              }} title={lang === "es"
                                  ? `${ovc} talla(s) con override`
                                  : `${ovc} size(s) with override`}>
                                {ovc} {lang === "es" ? "tallas" : "sizes"}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={tdSku}>
                          <input type="number" min={0} step={0.01}
                            value={Number(s.brl).toFixed(2)}
                            onChange={(e) => patchSku(i, { brl: Math.max(0, Number(e.target.value) || 0) })}
                            onFocus={(e) => e.target.select()}
                            style={inpMono(82)}
                            title={lang === "es"
                              ? "Precio BRL del Excel — editable para overrides puntuales"
                              : "BRL price from Excel — editable for ad-hoc overrides"}/>
                        </td>
                        <td style={tdSku}>
                          <input type="number" min={0} max={100} step={0.5}
                            value={s.com}
                            onChange={(e) => patchSku(i, { com: Math.max(0, Number(e.target.value) || 0) })}
                            onFocus={(e) => e.target.select()}
                            style={inpMono(48)}
                            title={lang === "es"
                              ? "Comisión % (base exponencial 1.0183^com). Default = comisión pactada del cliente."
                              : "Commission % (exponential base 1.0183^com)."}/>
                        </td>
                        {/* Ancla por SKU — dropdowns compactos + indicador override */}
                        <td style={tdSku}>
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                          }}>
                            <select
                              value={sAnchor.bandaId}
                              onChange={(e) => patchSkuAnchor(i, { bandaId: Number(e.target.value) })}
                              style={{
                                padding: "3px 4px", borderRadius: 4,
                                border: `1px solid ${hasOverride ? sFg + "55" : "var(--border)"}`,
                                background: hasOverride ? `${sBg}55` : "var(--surface-raised)",
                                color: hasOverride ? sFg : NAVY,
                                font: "600 10px/1 var(--font-body)",
                                cursor: "pointer", outline: "none",
                                fontVariantNumeric: "tabular-nums",
                              }}
                              title={lang === "es" ? "Banda ancla del SKU" : "SKU anchor band"}>
                              {BANDAS_MARLUVAS.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.rango}{b.techo ? " · TECHO" : b.piso ? " · PISO" : ""}
                                </option>
                              ))}
                            </select>
                            <select
                              value={sAnchor.plazoDias}
                              onChange={(e) => patchSkuAnchor(i, { plazoDias: Number(e.target.value) })}
                              style={{
                                padding: "3px 4px", borderRadius: 4,
                                border: `1px solid ${hasOverride ? sFg + "55" : "var(--border)"}`,
                                background: hasOverride ? `${sBg}55` : "var(--surface-raised)",
                                color: hasOverride ? sFg : NAVY,
                                font: "600 10px/1 var(--font-body)",
                                cursor: "pointer", outline: "none",
                                fontVariantNumeric: "tabular-nums",
                              }}
                              title={lang === "es" ? "Plazo ancla del SKU" : "SKU anchor term"}>
                              {/* Fase 4 · plazos efectivos de la banda anclada (puede incluir custom). */}
                              {getBandPlazos(sAnchor.bandaId, customPlazos).map((p) => (
                                <option key={p.dias} value={p.dias}>{p.dias}d</option>
                              ))}
                            </select>
                            {hasOverride && (
                              <button type="button"
                                onClick={() => clearSkuAnchor(i)}
                                style={{
                                  width: 18, height: 18, borderRadius: 3,
                                  border: "1px solid var(--border)", background: "var(--surface-raised)",
                                  color: MUTED, cursor: "pointer", padding: 0,
                                  font: "700 11px/1 var(--font-body)",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                }}
                                title={lang === "es"
                                  ? "Volver al ancla global"
                                  : "Revert to global anchor"}>↺</button>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tdSku, background: `${sBg}99` }}>{fmtUSD(ap.base)}</td>
                        <td style={{ ...tdSku, background: `${sBg}99` }}>
                          <input type="number" min={0} step={0.25}
                            value={Number(s.ajuste).toFixed(2)}
                            onChange={(e) => patchSku(i, { ajuste: Math.max(0, Number(e.target.value) || 0) })}
                            onFocus={(e) => e.target.select()}
                            style={{ ...inpMono(70), background: sBg, borderColor: sFg + "55", fontWeight: 700 }}/>
                        </td>
                        <td style={tdSku}>
                          <input type="number" min={0} max={500} step={0.5}
                            value={(Number(s.sobreprecio || 0) * 100).toFixed(2)}
                            onChange={(e) => {
                              const nuevoPct = Math.max(0, Number(e.target.value) || 0) / 100;
                              patchSku(i, { sobreprecio: nuevoPct });
                            }}
                            onFocus={(e) => e.target.select()}
                            style={{ ...inpMono(58), color: AMBER, fontWeight: 700 }}
                            title={lang === "es"
                              ? "% sobre la base — independiente del Ajuste $"
                              : "% over base — independent from Adj. $"}/>
                          <span style={{ color: AMBER, fontWeight: 700, fontSize: 9, marginLeft: 2 }}>%</span>
                        </td>
                        <td style={{ ...tdSku, background: `${sBg}99`, fontWeight: 700, color: NAVY }}>
                          {fmtUSD(ap.lista)}
                        </td>
                      </tr>
                      {expandedSkus.has(s.sku) && (
                        <tr>
                          {/* colSpan = 11 (chevron + toggle + sku + ref + brl + com + ancla + base + ajuste + sobrepre + lista) */}
                          <td colSpan={11} style={{ padding: 0, background: "var(--bg-alt)" }}>
                            <SkuSizesPanel
                              sku={s}
                              skuIdx={i}
                              bandaVigente={bandaVigente}
                              globalAnchor={anchor}
                              customPlazos={customPlazos}
                              onSizeMatrixCell={setSkuSizeMatrixCell}
                              onSizeAnchor={setSkuSizeAnchor}
                              onSizeReset={clearSkuSizeOverride}
                              lang={lang}
                            />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Resumen de fila — totales reflejan el ancla seleccionada */}
            {(() => {
              // Cada SKU suma con SU ancla resuelta (override por-SKU o global).
              const totalAncla = skusActivos.reduce(
                (acc, s) => acc + anchorPrice(s, resolvedAnchor(s)).lista, 0);
              const avgAncla = skusActivos.length > 0
                ? totalAncla / skusActivos.length : 0;
              return (
                <div style={{
                  marginTop: 12, display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)", gap: 10,
                  padding: 12, background: SOFT, borderRadius: 8,
                  border: "1px solid var(--border)",
                }}>
                  <KPI label={lang === "es" ? "Activos" : "Active"} value={`${resumen.n}/${skus.length}`}/>
                  <KPI label={lang === "es" ? "Sobreprecio promedio" : "Avg markup"}
                    value={resumen.spAvg != null ? (resumen.spAvg * 100).toFixed(1) + "%" : "—"}
                    hi/>
                  <KPI label={lang === "es" ? "Comisión promedio" : "Avg commission"}
                    value={resumen.comAvg != null ? resumen.comAvg.toFixed(1) + "%" : "—"}/>
                  <KPI label={lang === "es" ? `Total ancla (${anchorLabel})` : `Anchor total (${anchorLabel})`}
                    value={fmtUSD(totalAncla)}/>
                  <KPI label={lang === "es" ? `Promedio ancla` : `Anchor avg`}
                    value={fmtUSD(avgAncla)}/>
                </div>
              );
            })()}
          </Section>
          );
        })()}

        {/* ── 3 · Matriz de precios — rediseño UX ── */}
        {skusActivos.length > 0 && (
          <Section
            title={lang === "es" ? "Matriz de precios · USD por par" : "Price matrix · USD per pair"}
          >
            {/* Toolbar de alcance */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14, gap: 12, flexWrap: "wrap",
            }}>
              <div style={{
                display: "inline-flex", gap: 2, padding: 3,
                background: SOFT, borderRadius: 8, border: "1px solid var(--border)",
              }}>
                {[
                  { v: "essentials", l: lang === "es" ? "Esenciales" : "Essentials", t: lang === "es" ? "Techo · vigente · piso" : "Top · current · floor" },
                  { v: "current",    l: lang === "es" ? "Vigente"    : "Current",    t: lang === "es" ? "Solo banda activa" : "Active band only" },
                  { v: "all",        l: lang === "es" ? "12 bandas"  : "12 bands",   t: lang === "es" ? "Matriz completa"   : "Full matrix" },
                ].map((opt) => {
                  const on = bandFilter === opt.v;
                  return (
                    <button key={opt.v} type="button"
                      onClick={() => setBandFilter(opt.v)}
                      title={opt.t}
                      style={{
                        padding: "6px 14px",
                        background: on ? "var(--surface-raised)" : "transparent",
                        border: on ? "1px solid var(--border)" : "1px solid transparent",
                        color: on ? NAVY : MUTED,
                        font: `${on ? 700 : 600} 11px/1 var(--font-body)`,
                        borderRadius: 6, cursor: "pointer",
                        boxShadow: on ? "0 1px 2px rgba(11,30,58,0.06)" : "none",
                        transition: "all 120ms ease",
                      }}>{opt.l}</button>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10,
                font: "500 11px/1.4 var(--font-body)", color: MUTED,
                flexWrap: "wrap",
              }}>
                {(() => {
                  const totalPlazos = filteredBands.reduce(
                    (acc, b) => acc + getBandPlazos(b.id, customPlazos).length, 0);
                  return (
                    <span>
                      <strong style={{ color: NAVY, fontWeight: 700 }}>{filteredBands.length}</strong> {lang === "es" ? "bandas" : "bands"} ·
                      <strong style={{ color: NAVY, fontWeight: 700, marginLeft: 4 }}>{totalPlazos}</strong> {lang === "es" ? "plazos" : "terms"} ·
                      <strong style={{ color: NAVY, fontWeight: 700, marginLeft: 4 }}>{skusActivos.length}</strong> SKUs
                    </span>
                  );
                })()}
                {bandaVigente && (
                  <span style={{
                    padding: "3px 9px", borderRadius: 12,
                    background: `${AMBER}15`, color: "#92400E",
                    font: "700 10px/1.2 var(--font-body)",
                    border: `1px solid ${AMBER}55`,
                  }}>● {lang === "es" ? "Banda activa" : "Active"} #{bandaVigente.id}</span>
                )}
                <button type="button"
                  onClick={() => openAddPlazoModal(null)}
                  title={lang === "es"
                    ? "Agregar un plazo personalizado (ej. 120d a +2%)"
                    : "Add a custom term (e.g. 120d at +2%)"}
                  style={{
                    padding: "5px 11px", borderRadius: 6,
                    background: MINT, color: "#FFFFFF",
                    border: "none",
                    font: "700 11px/1 var(--font-body)",
                    cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}>
                  + {lang === "es" ? "Agregar plazo" : "Add term"}
                </button>
                {Object.keys(customPlazos).length > 0 && (
                  <button type="button"
                    onClick={() => {
                      setConfirmDialog({
                        tone: "danger",
                        title: lang === "es"
                          ? "¿Resetear todos los plazos custom a [90/60/30/8]?"
                          : "Reset all custom terms to [90/60/30/8]?",
                        body: lang === "es"
                          ? (<>Se descartarán los plazos personalizados de <strong>todas las bandas</strong> y volverán a los valores por defecto. Esta acción no se puede deshacer.</>)
                          : (<>Custom terms across <strong>all bands</strong> will be discarded and reset to defaults. This action cannot be undone.</>),
                        actionLabel: lang === "es" ? "Resetear plazos" : "Reset terms",
                        onConfirm: () => {
                          setCustomPlazos({});
                          setSkus((arr) => arr.map((s) => ({
                            ...s, matrix: computeMatrixFromInputs(s, {}),
                          })));
                        },
                      });
                    }}
                    title={lang === "es" ? "Resetear todos los plazos a defaults" : "Reset all terms to defaults"}
                    style={{
                      padding: "5px 9px", borderRadius: 6,
                      background: "var(--surface-raised)", color: INK,
                      border: "1px solid var(--border)",
                      font: "600 10.5px/1 var(--font-body)",
                      cursor: "pointer",
                    }}>
                    ↺ {lang === "es" ? "Reset todo" : "Reset all"}
                  </button>
                )}
              </div>
            </div>

            {/* Leyenda mini */}
            <div style={{
              display: "flex", gap: 16, flexWrap: "wrap",
              marginBottom: 10, font: "500 10.5px/1.3 var(--font-body)", color: MUTED,
            }}>
              <LegendDot color="#F5B895" label={lang === "es" ? "Banda techo (USD↑)" : "Top band"}/>
              <LegendDot color="#34D399" label={lang === "es" ? "Banda piso (USD↓)" : "Floor band"}/>
              <LegendDot color={AMBER}    label={lang === "es" ? "Banda vigente (TC del día)" : "Active band"}/>
              <span>· <strong style={{ color: NAVY }}>{lang === "es" ? "base" : "base"}</strong> {lang === "es" ? "es el precio ancla" : "is the anchor price"} · {lang === "es"
                ? "los demás plazos son ± % sobre la base"
                : "other terms are ± % over base"} · <button type="button"
                  onClick={() => openAddPlazoModal(null)}
                  style={{
                    background: "transparent", border: "none", padding: 0,
                    color: MINT, font: "700 10.5px/1.3 var(--font-body)",
                    cursor: "pointer", textDecoration: "underline",
                  }}>
                  + {lang === "es" ? "agregar plazo" : "add term"}
                </button>
              </span>
            </div>

            {/* Tabla */}
            <div style={{
              overflowX: "auto", maxHeight: "72vh",
              border: "1px solid var(--border)", borderRadius: 8,
              background: "var(--surface-raised)",
            }}>
              <table style={tblMtx2}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...stickyTh(0, 56), borderRight: "none" }}>SKU</th>
                    <th rowSpan={2} style={stickyTh(56, 180)}>
                      {lang === "es" ? "Referencia" : "Reference"}
                    </th>
                    {filteredBands.map((b) => {
                      const isCurrent = bandaVigente?.id === b.id;
                      const bandPlazos = getBandPlazos(b.id, customPlazos);
                      const hasCustom = Array.isArray(customPlazos[String(b.id)])
                        && customPlazos[String(b.id)].length >= 0
                        && Object.prototype.hasOwnProperty.call(customPlazos, String(b.id));
                      return (
                        <th key={b.id} colSpan={Math.max(bandPlazos.length, 1)}
                            style={bandHeaderStyle(b, isCurrent)}>
                          <div style={{ font: "700 11.5px/1.2 var(--font-body)" }}>{b.rango}</div>
                          <div style={{ font: "500 9.5px/1 var(--font-mono, ui-monospace)",
                            opacity: 0.75, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                            ÷{b.div.toFixed(2)}
                          </div>
                          {(b.techo || b.piso || isCurrent) && (
                            <div style={{
                              display: "inline-block", marginTop: 4,
                              padding: "2px 7px", borderRadius: 10,
                              background: "rgba(255,255,255,0.55)",
                              font: "700 8.5px/1 var(--font-body)",
                              textTransform: "uppercase", letterSpacing: 0.6,
                            }}>
                              {b.techo ? (lang === "es" ? "techo" : "top")
                                : b.piso ? (lang === "es" ? "piso" : "floor")
                                : (lang === "es" ? "vigente" : "active")}
                            </div>
                          )}
                          <div style={{
                            marginTop: 5, display: "inline-flex", gap: 3,
                            justifyContent: "center",
                          }}>
                            <button type="button"
                              onClick={() => openAddPlazoModal(b.id)}
                              title={lang === "es"
                                ? `Agregar plazo a banda ${b.id}`
                                : `Add term to band ${b.id}`}
                              style={bandHdrBtn}>
                              +
                            </button>
                            {hasCustom && (
                              <button type="button"
                                onClick={() => resetBandaPlazos(b.id)}
                                title={lang === "es"
                                  ? `Resetear banda ${b.id} a [90/60/30/8]`
                                  : `Reset band ${b.id} to defaults`}
                                style={bandHdrBtn}>
                                ↺
                              </button>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    {filteredBands.flatMap((b) => {
                      const isCurrent = bandaVigente?.id === b.id;
                      const bandPlazos = getBandPlazos(b.id, customPlazos);
                      if (bandPlazos.length === 0) {
                        // Banda con custom_plazos = [] (sin plazos). Mostramos celda vacía.
                        return [(
                          <th key={`${b.id}-empty`}
                              style={plazoHeaderStyle(b, isCurrent, false)}>
                            <div style={{
                              font: "500 9.5px/1.2 var(--font-body)",
                              color: MUTED, fontStyle: "italic",
                            }}>
                              {lang === "es" ? "— sin plazos —" : "— no terms —"}
                            </div>
                          </th>
                        )];
                      }
                      return bandPlazos.map((p) => {
                        const isBase = Math.abs(p.factor - 1) < 0.0001;
                        return (
                          <th key={`${b.id}-${p.dias}`}
                              style={plazoHeaderStyle(b, isCurrent, isBase)}>
                            <div style={{
                              display: "flex", alignItems: "center",
                              justifyContent: "center", gap: 3,
                            }}>
                              <div style={{ font: "700 10.5px/1 var(--font-body)" }}>{p.dias}d</div>
                              <button type="button"
                                onClick={() => {
                                  setConfirmDialog({
                                    tone: "danger",
                                    title: lang === "es"
                                      ? `¿Quitar el plazo ${p.dias}d de la banda ${b.id}?`
                                      : `Remove term ${p.dias}d from band ${b.id}?`,
                                    body: lang === "es"
                                      ? (<>El plazo <strong>{p.dias}d</strong> dejará de calcularse en la <strong>banda #{b.id}</strong>. Puedes volver a agregarlo desde <em>+ Agregar plazo</em>.</>)
                                      : (<>The term <strong>{p.dias}d</strong> will stop being calculated for <strong>band #{b.id}</strong>. You can re-add it from <em>+ Add term</em>.</>),
                                    actionLabel: lang === "es" ? "Quitar plazo" : "Remove term",
                                    onConfirm: () => removePlazoFromBanda(b.id, p.dias),
                                  });
                                }}
                                title={lang === "es"
                                  ? `Quitar ${p.dias}d de banda ${b.id}`
                                  : `Remove ${p.dias}d from band ${b.id}`}
                                style={plazoHdrXBtn}>
                                ✕
                              </button>
                            </div>
                            <div style={{ font: `${isBase ? 600 : 500} 8.5px/1 var(--font-body)`,
                              opacity: 0.7, marginTop: 2 }}>
                              {isBase ? (lang === "es" ? "base" : "base") : p.sub}
                            </div>
                          </th>
                        );
                      });
                    })}
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s, i) => {
                    if (!s.activo) return null;
                    // Fuente del precio: s.matrix (state principal). Fallback al
                    // cálculo derivado si todavía no se inicializó.
                    const matrix = s.matrix || computeMatrixFromInputs(s, customPlazos);
                    return (
                      <tr key={s.sku} className="mtx-row">
                        <td style={stickyTd(0, 56, { color: MUTED, fontSize: 9.5, borderRight: "none" })}>{s.sku}</td>
                        <td style={stickyTd(56, 180, { color: NAVY, fontSize: 10.5, fontWeight: 600, body: true })} title={s.ref}>
                          {s.ref}
                        </td>
                        {filteredBands.flatMap((b) => {
                          const isCurrent = bandaVigente?.id === b.id;
                          const row = matrix[String(b.id)] || {};
                          const bandPlazos = getBandPlazos(b.id, customPlazos);
                          if (bandPlazos.length === 0) {
                            return [(
                              <td key={`${b.id}-empty`}
                                  style={{
                                    ...plazoCellStyle(b, isCurrent, false),
                                    color: MUTED, fontStyle: "italic", fontSize: 10,
                                  }}>
                                —
                              </td>
                            )];
                          }
                          // Precio base (factor=1) — necesario para recalcular
                          // celdas de plazos custom que aún no están en matrix.
                          const baseEntry = bandPlazos.find((q) => Math.abs(q.factor - 1) < 0.0001);
                          const basePrice = baseEntry
                            ? Number(row[String(baseEntry.dias)] ?? 0)
                            : Number(row["90"] ?? 0);
                          return bandPlazos.map((p) => {
                            const isBase = Math.abs(p.factor - 1) < 0.0001;
                            // Si la celda no existe en matrix (plazo custom recién
                            // agregado), la derivamos on-the-fly desde base × factor.
                            const stored = row[String(p.dias)];
                            const price = stored != null
                              ? Number(stored)
                              : Number((basePrice * Number(p.factor)).toFixed(4));
                            return (
                              <td key={`${b.id}-${p.dias}`}
                                  style={plazoCellStyle(b, isCurrent, isBase)}>
                                <MtxCellInput
                                  value={price}
                                  onCommit={(newVal) => patchCell(i, b.id, p.dias, newVal)}
                                  isBase={isBase}
                                  title={lang === "es"
                                    ? (isBase
                                        ? `Banda ${b.id} · ${p.dias}d (ancla) · editar recalcula plazos más cortos`
                                        : `Banda ${b.id} · ${p.dias}d · editar recalcula plazos más cortos`)
                                    : ""}
                                />
                              </td>
                            );
                          });
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Empty state si no hay SKUs */}
        {skus.length === 0 && (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            background: SOFT, borderRadius: 10, border: "1px dashed var(--border)",
            color: MUTED, font: "500 13px/1.5 var(--font-body)",
          }}>
            <IconDollar size={28} style={{ color: MUTED, marginBottom: 10 }}/>
            <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
              {lang === "es" ? "Aún no hay SKUs en este simulador" : "No SKUs yet"}
            </div>
            <div>{lang === "es"
              ? "Subí el Excel COMEX 2026 v7 para empezar a modelar precios."
              : "Upload the COMEX 2026 v7 Excel to start modeling prices."}
            </div>
          </div>
        )}
      </div>

      {/* Footer sticky */}
      <div style={{
        position: "sticky", bottom: 0, zIndex: 5,
        marginTop: 18, padding: "12px 18px",
        background: "var(--surface-raised)", backdropFilter: "blur(6px)",
        borderTop: "1px solid var(--border)", borderRadius: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        boxShadow: "0 -4px 14px -8px rgba(11,30,58,0.10)",
      }}>
        <div style={{ font: "500 11.5px/1.4 var(--font-body)", color: MUTED }}>
          {lang === "es"
            ? "Los términos financieros del cliente se congelan al guardar (snapshot)."
            : "Client financial terms are frozen on save."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => navigate(`/marcas/${brandId}`)}
                  disabled={saving}
                  style={{
                    padding: "9px 18px", background: "transparent",
                    border: "1px solid var(--border)", color: INK,
                    font: "600 12.5px/1 var(--font-body)",
                    borderRadius: 8, cursor: saving ? "not-allowed" : "pointer",
                  }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" onClick={save}
                  disabled={saving || skusActivos.length === 0}
                  style={{
                    padding: "9px 22px",
                    background: (saving || skusActivos.length === 0) ? "#94A3B8" : MINT,
                    color: "#FFFFFF", border: "none",
                    font: "700 12.5px/1 var(--font-body)",
                    borderRadius: 8,
                    cursor: (saving || skusActivos.length === 0) ? "not-allowed" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
            <IconCheck size={13}/>
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? `Guardar (${skusActivos.length} SKUs)` : `Save (${skusActivos.length} SKUs)`)}
          </button>
        </div>
      </div>

      {/* Fase 4 · Modal para agregar/editar plazos custom por banda. */}
      <PlazoFormModal
        open={plazoModal.open}
        onClose={closeAddPlazoModal}
        onSubmit={applyPlazoToBandas}
        contextBandaId={plazoModal.contextBandaId}
        bandaVigente={bandaVigente}
        initial={plazoModal.initial}
        lang={lang}
      />

      {/* Modal de confirmación destructiva — patrón inline (mismo estilo
          que Productos.jsx). Reemplaza window.confirm para acciones como
          quitar plazo, resetear plazos custom o limpiar anclas por SKU. */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div
            key="bcp-confirm-modal"
            className="modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeConfirm}
            style={{
              position: "fixed", inset: 0, zIndex: 1000,
              background: "rgba(11,30,58,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 16,
            }}
          >
            <motion.div
              className="modal-panel"
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0,  opacity: 1, scale: 1 }}
              exit={{ y: 10, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--surface-raised)", borderRadius: 12,
                width: "100%", maxWidth: 440,
                boxShadow: "0 12px 48px rgba(11,30,58,0.18)",
                overflow: "hidden",
              }}
            >
              <div style={{
                padding: "20px 22px 8px 22px",
                display: "flex", alignItems: "flex-start", gap: 14,
              }}>
                <div style={{
                  flexShrink: 0, width: 40, height: 40, borderRadius: "50%",
                  background: confirmDialog.tone === "warning"
                    ? "rgba(245,158,11,0.12)"
                    : "rgba(239,68,68,0.10)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: confirmDialog.tone === "warning"
                    ? "var(--warning, #F59E0B)"
                    : "var(--critical, #EF4444)",
                }}>
                  {confirmDialog.tone === "warning"
                    ? <IconAlert size={18}/>
                    : <IconTrash size={18}/>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    font: "700 16px/1.3 var(--font-body)",
                    color: NAVY, marginBottom: 6,
                  }}>
                    {confirmDialog.title}
                  </div>
                  {confirmDialog.body && (
                    <div style={{
                      font: "500 13px/1.5 var(--font-body)",
                      color: MUTED,
                    }}>
                      {confirmDialog.body}
                    </div>
                  )}
                </div>
              </div>
              <div style={{
                padding: "14px 22px 18px 22px",
                display: "flex", gap: 8, justifyContent: "flex-end",
              }}>
                <button type="button"
                  onClick={closeConfirm}
                  style={{
                    padding: "8px 16px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--surface-raised)",
                    color: INK, font: "600 12.5px/1 var(--font-body)",
                    cursor: "pointer",
                  }}>
                  {lang === "es" ? "Cancelar" : "Cancel"}
                </button>
                <button type="button"
                  onClick={runConfirm}
                  autoFocus
                  style={{
                    padding: "8px 18px", borderRadius: 8,
                    border: "none",
                    background: confirmDialog.tone === "warning"
                      ? "var(--warning, #F59E0B)"
                      : "var(--critical, #DC2626)",
                    color: "#FFFFFF",
                    font: "700 12.5px/1 var(--font-body)",
                    cursor: "pointer",
                    boxShadow: confirmDialog.tone === "warning"
                      ? "0 4px 10px rgba(245,158,11,0.30)"
                      : "0 4px 10px rgba(220,38,38,0.30)",
                  }}>
                  {confirmDialog.actionLabel || (lang === "es" ? "Eliminar" : "Delete")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Sub-componentes
// ═════════════════════════════════════════════════════════════
function ExchangeRateBar({ tc, loading, error, ts, source, bandaVigente, vista, onVistaChange, onReload, lang }) {
  return (
    <div style={{
      background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "10px 14px", marginBottom: 14,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 14, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ font: "700 9.5px/1 var(--font-body)", color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>
            {lang === "es" ? "Cotización USD/BRL" : "USD/BRL FX"}
          </div>
          {loading ? (
            <div style={{ font: "500 12px/1 var(--font-body)", color: MUTED }}>
              {lang === "es" ? "Obteniendo…" : "Fetching…"}
            </div>
          ) : error ? (
            <div style={{ font: "600 12px/1 var(--font-body)", color: RED, display: "flex", alignItems: "center", gap: 4 }}>
              <IconAlert size={11}/>{lang === "es" ? "API no disponible" : "FX API down"}
            </div>
          ) : tc != null ? (
            <div style={{ font: "700 18px/1 var(--font-body)", color: NAVY, fontVariantNumeric: "tabular-nums" }}>
              R$ {tc.toFixed(4)}
            </div>
          ) : (
            <div style={{ font: "500 12px/1 var(--font-body)", color: MUTED }}>—</div>
          )}
        </div>

        {bandaVigente && (
          <div style={{
            padding: "6px 12px", borderRadius: 8,
            background: bandaVigente.techo ? TECHO : bandaVigente.piso ? "#D1FAE5" : "#E0F2FE",
            color: bandaVigente.techo ? "#9A4A1D" : bandaVigente.piso ? "#065F46" : "#075985",
            border: `1px solid ${bandaVigente.techo ? TECHO_STRONG : bandaVigente.piso ? "#34D399" : "#7DD3FC"}`,
          }}>
            <div style={{ font: "700 9px/1 var(--font-body)", textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.75 }}>
              {lang === "es" ? "Banda vigente" : "Active band"}
            </div>
            <div style={{ font: "700 13px/1.2 var(--font-body)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              #{bandaVigente.id} · {bandaVigente.rango} · ÷{bandaVigente.div.toFixed(2)}
              {bandaVigente.techo && " ◆ techo"}
              {bandaVigente.piso  && " ◆ piso"}
            </div>
          </div>
        )}

        {ts && !error && (
          <div style={{ font: "500 10px/1.3 var(--font-body)", color: MUTED }}>
            {source} · {new Date(ts).toLocaleString(lang === "es" ? "es-CR" : "en-US", { hour12: false })}
          </div>
        )}

        <button type="button" onClick={onReload}
          disabled={loading}
          style={{
            padding: "6px 10px", background: "var(--surface-raised)",
            border: "1px solid var(--border)", color: INK,
            font: "600 11px/1 var(--font-body)",
            borderRadius: 6, cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
          <IconRefresh size={11}/>
          {lang === "es" ? "Actualizar" : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {[
          { v: "editor", l: lang === "es" ? "Editor + Matriz" : "Editor + Matrix" },
          { v: "matriz", l: lang === "es" ? "Solo Matriz" : "Matrix only" },
        ].map((opt) => (
          <button key={opt.v} type="button" onClick={() => onVistaChange(opt.v)}
            style={{
              padding: "6px 12px",
              background: vista === opt.v ? "var(--brand-primary)" : "var(--surface-raised)",
              color: vista === opt.v ? "#FFFFFF" : INK,
              border: `1px solid ${vista === opt.v ? "var(--brand-primary)" : "var(--border)"}`,
              font: "600 11px/1 var(--font-body)",
              borderRadius: 6, cursor: "pointer",
            }}>
            {opt.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function KPI({ label, value, hi }) {
  return (
    <div>
      <div style={{ font: "600 9.5px/1 var(--font-body)", color: MUTED,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{
        font: `700 ${hi ? 15 : 13}px/1 var(--font-body)`,
        color: hi ? AMBER : NAVY,
        fontVariantNumeric: "tabular-nums",
      }}>{value}</div>
    </div>
  );
}

function SnapshotBadge({ label, value, color, editable, rawValue, suffix, parse, onSave, saving }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const startEdit = () => {
    if (!editable || saving) return;
    setDraft(rawValue == null || Number.isNaN(rawValue) ? "" : String(rawValue));
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select?.(), 0);
  };

  const commit = async () => {
    if (!editable) return;
    const parsed = (parse || ((s) => Number(s)))(draft);
    setIsEditing(false);
    if (parsed != null && !Number.isNaN(parsed) && parsed !== rawValue) {
      try { await onSave?.(parsed); } catch { /* parent maneja banner */ }
    }
  };

  return (
    <div style={{
      padding: "7px 12px",
      background: "rgba(255,255,255,0.08)",
      borderRadius: 10, minWidth: 88,
      cursor: editable && !isEditing ? "pointer" : "default",
      transition: "background 0.18s",
    }}
      onClick={!isEditing ? startEdit : undefined}
      title={editable && !isEditing ? "Click para editar" : undefined}>
      <div style={{
        font: "500 9px/1 var(--font-body)", opacity: 0.65,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3,
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        {editable
          ? <span style={{ width: 7, height: 7, borderRadius: 4, background: LIGHT }} />
          : <IconLock size={8}/>}
        {label}
      </div>
      {isEditing ? (
        <input
          ref={inputRef} type="number" step="any" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setIsEditing(false); }
          }}
          disabled={saving}
          style={{
            width: 70, font: "700 14px/1 var(--font-body)",
            color: "#FFFFFF", background: "rgba(0,0,0,0.25)",
            border: `1px solid ${LIGHT}`, borderRadius: 5,
            padding: "3px 6px", outline: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        />
      ) : (
        <div style={{ font: "700 14px/1 var(--font-body)", color, fontVariantNumeric: "tabular-nums",
          display: "inline-flex", alignItems: "baseline", gap: 3 }}>
          {value}
          {suffix && <span style={{ font: "500 9.5px/1 var(--font-body)", opacity: 0.7 }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, badge, children }) {
  // `badge` puede ser:
  //   · null/undefined → no renderiza nada
  //   · ReactNode (JSX) → renderiza tal cual
  //   · objeto { label, color, bg } → renderiza chip estilizado
  // Render directo de un objeto plano dispara React error #31.
  const renderBadge = () => {
    if (!badge) return null;
    if (typeof badge !== "object" || React.isValidElement(badge)) return badge;
    if (!badge.label) return null;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "3px 8px", borderRadius: 12,
        background: badge.bg || badge.color,
        color: badge.bg ? badge.color : "#FFFFFF",
        font: "700 9px/1 var(--font-body)",
        letterSpacing: 0.4, textTransform: "uppercase",
        fontVariantNumeric: "tabular-nums",
      }}>{badge.label}</span>
    );
  };
  return (
    <section style={{
      background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12,
      padding: "16px 18px 18px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div>
          <div style={{ font: "700 13.5px/1.1 var(--font-body)", color: NAVY,
            display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {renderBadge()}
          </div>
          {subtitle && (
            <div style={{ font: "500 11px/1.3 var(--font-body)", color: MUTED, marginTop: 3 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function Label({ children }) {
  return <label style={{
    display: "block", font: "600 10.5px/1 var(--font-body)", color: NAVY,
    marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4,
  }}>{children}</label>;
}

function Field({ label, children }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = "text", style, ...rest }) {
  return (
    <input type={type} value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      {...rest}
      style={{
        width: "100%", padding: "8px 10px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: "500 12.5px/1.2 var(--font-body)", color: NAVY,
        background: "var(--surface-raised)", outline: "none",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}/>
  );
}

// ─── Estilos de tablas ───
const tblSku = {
  width: "100%", borderCollapse: "collapse", fontSize: 11,
};
const thSku = {
  font: "700 9px/1 var(--font-body)", color: MUTED,
  padding: "8px 6px", textAlign: "center",
  textTransform: "uppercase", letterSpacing: 0.5,
  borderBottom: "1px solid var(--border)", background: SOFT,
};
const tdSku = {
  padding: "7px 6px", fontSize: 11, textAlign: "center",
  borderBottom: "1px solid #F1F5F9",
  fontFamily: "var(--font-mono, ui-monospace)",
  fontVariantNumeric: "tabular-nums",
  verticalAlign: "middle",
};

// ─── Estilos de la matriz rediseñada ───
const tblMtx2 = {
  width: "100%", borderCollapse: "separate", borderSpacing: 0,
};

const BAND_BG_TECHO   = "#FEF3E7";
const BAND_BG_PISO    = "#ECFDF5";
const BAND_BG_CURRENT = "#FEF3C7";
const BAND_BG_NEUTRAL = "var(--surface-raised)";

const BAND_FG_TECHO   = "#9A4A1D";
const BAND_FG_PISO    = "#065F46";
const BAND_FG_CURRENT = "#92400E";

function bandColors(b, isCurrent) {
  if (b.techo) return { bg: BAND_BG_TECHO,   fg: BAND_FG_TECHO   };
  if (b.piso)  return { bg: BAND_BG_PISO,    fg: BAND_FG_PISO    };
  if (isCurrent) return { bg: BAND_BG_CURRENT, fg: BAND_FG_CURRENT };
  return { bg: BAND_BG_NEUTRAL, fg: NAVY };
}

function stickyTh(left, minWidth) {
  return {
    position: "sticky", left, top: 0, zIndex: 5,
    background: "var(--surface-raised)",
    textAlign: "left", padding: "10px 10px 10px 12px",
    font: "700 9.5px/1 var(--font-body)", color: MUTED,
    textTransform: "uppercase", letterSpacing: 0.5,
    minWidth, maxWidth: minWidth,
    borderRight: left > 0 ? "1px solid var(--border)" : "none",
    borderBottom: "1px solid var(--border)",
    boxShadow: left > 0 ? "4px 0 6px -3px rgba(11,30,58,0.07)" : "none",
  };
}

function stickyTd(left, minWidth, opts) {
  return {
    position: "sticky", left, zIndex: 2,
    background: "var(--surface-raised)",
    textAlign: "left", padding: "9px 10px 9px 12px",
    color: opts.color || INK,
    fontSize: opts.fontSize || 11,
    fontWeight: opts.fontWeight || 500,
    fontFamily: opts.body ? "var(--font-body)" : "var(--font-mono, ui-monospace)",
    fontVariantNumeric: "tabular-nums",
    minWidth, maxWidth: minWidth,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    borderRight: left > 0 ? "1px solid var(--border)" : (opts.borderRight === "none" ? "none" : undefined),
    borderBottom: "1px solid #F1F5F9",
    boxShadow: left > 0 ? "4px 0 6px -3px rgba(11,30,58,0.07)" : "none",
  };
}

function bandHeaderStyle(b, isCurrent) {
  const { bg, fg } = bandColors(b, isCurrent);
  return {
    position: "sticky", top: 0, zIndex: 4,
    background: bg, color: fg,
    padding: "10px 8px 8px 8px",
    textAlign: "center",
    borderLeft: `2px solid ${isCurrent ? AMBER : "var(--border)"}`,
    borderBottom: "1px solid var(--border)",
  };
}

function plazoHeaderStyle(b, isCurrent, isBase) {
  const { bg } = bandColors(b, isCurrent);
  return {
    position: "sticky", top: 60, zIndex: 4,
    background: isBase ? bg : "var(--surface-raised)",
    color: NAVY,
    padding: "6px 4px 7px 4px",
    textAlign: "center",
    minWidth: 64,
    borderLeft: isBase ? `2px solid ${isCurrent ? AMBER : "var(--border)"}` : "1px solid transparent",
    borderBottom: "1px solid var(--border)",
  };
}

function plazoCellStyle(b, isCurrent, isBase) {
  return {
    padding: "8px 8px",
    textAlign: "right",
    fontFamily: "var(--font-mono, ui-monospace)",
    fontVariantNumeric: "tabular-nums",
    fontSize: 11,
    fontWeight: isBase ? 700 : 500,
    color: isBase ? NAVY : "var(--text-secondary)",
    background: isBase ? "var(--surface-raised)" : "var(--bg-alt)",
    borderLeft: isBase ? `2px solid ${isCurrent ? AMBER : "var(--border)"}` : "1px solid transparent",
    borderBottom: "1px solid #F1F5F9",
  };
}

// Fase 4 · Botones inline en headers de banda (↺/+) y plazo (✕).
const bandHdrBtn = {
  padding: "1px 6px", borderRadius: 8,
  background: "rgba(255,255,255,0.7)",
  color: NAVY, border: "1px solid rgba(11,30,58,0.18)",
  font: "700 9.5px/1 var(--font-body)",
  cursor: "pointer", lineHeight: 1.1,
};
const plazoHdrXBtn = {
  padding: 0, width: 14, height: 14, borderRadius: 7,
  background: "transparent", color: MUTED,
  border: "1px solid var(--border)",
  font: "700 8.5px/1 var(--font-body)",
  cursor: "pointer", lineHeight: 1,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

/** Formato compacto de celda de matriz: enteros con coma si ≥ 1000, 2 dec si menor. */
function fmtMtxCell(n) {
  const v = Number(n || 0);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

/**
 * Input editable de una celda de la matriz. Muestra el precio formateado
 * cuando está en blur (`$45.45` o `45.45`), permite editar al focus y
 * commitea con Enter/blur. Visualmente plano (sin borde) hasta el hover.
 */
function MtxCellInput({ value, onCommit, isBase, title }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const display = formatCellValue(value);

  const startEdit = () => {
    setDraft(Number(value || 0).toFixed(4).replace(/\.?0+$/, ""));
    setEditing(true);
    setTimeout(() => inputRef.current?.select?.(), 0);
  };
  const commit = () => {
    const n = Number(String(draft).replace(",", "."));
    setEditing(false);
    if (Number.isFinite(n) && Math.abs(n - Number(value)) > 0.001) {
      onCommit(n);
    }
  };
  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number" step="0.01" min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        title={title}
        style={{
          width: "100%", padding: "3px 4px",
          border: `1.5px solid ${"#00B286"}`,
          borderRadius: 4, outline: "none",
          background: "var(--surface-raised)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono, ui-monospace)",
          fontVariantNumeric: "tabular-nums",
          fontSize: 11, fontWeight: isBase ? 700 : 500,
          textAlign: "right",
        }}/>
    );
  }
  return (
    <button type="button" onClick={startEdit} title={title}
      style={{
        width: "100%", padding: "3px 4px",
        border: "1px solid transparent",
        background: "transparent",
        color: "inherit", cursor: "text",
        fontFamily: "var(--font-mono, ui-monospace)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 11, fontWeight: isBase ? 700 : 500,
        textAlign: "right", borderRadius: 4,
        transition: "background 100ms, border 100ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0,176,134,0.06)";
        e.currentTarget.style.border = "1px solid rgba(0,176,134,0.25)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.border = "1px solid transparent";
      }}>
      {display}
    </button>
  );
}

function formatCellValue(n) {
  const v = Number(n || 0);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{
        width: 11, height: 11, borderRadius: 3,
        background: color, border: "1px solid rgba(0,0,0,0.08)",
        display: "inline-block",
      }}/>
      {label}
    </span>
  );
}

const inpMono = (w) => ({
  width: w, padding: "4px 6px", borderRadius: 5,
  border: "1px solid var(--border)", background: "var(--surface-raised)", color: NAVY,
  fontFamily: "var(--font-mono, ui-monospace)",
  fontSize: 11, fontWeight: 600, textAlign: "center",
  outline: "none", fontVariantNumeric: "tabular-nums",
});

// ─── Utilidades ───
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function fmtMoney(n) {
  const v = Number(n || 0);
  if (!v) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const btnGhost = {
  padding: "6px 10px", background: "transparent",
  border: "1px solid var(--border)", color: INK,
  font: "600 11px/1 var(--font-body)",
  borderRadius: 6, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 4,
};

const emptyCard = {
  padding: 40, textAlign: "center",
  background: SOFT, borderRadius: 10, border: "1px dashed var(--border)",
  color: MUTED, font: "500 13px/1.4 var(--font-body)",
  maxWidth: 420, margin: "60px auto",
};
