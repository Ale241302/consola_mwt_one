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
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconUpload, IconCheck, IconX, IconPaperclip,
  IconPackage, IconShield, IconDollar, IconLock, IconSparkle,
  IconFileText, IconSliders, IconFolder, IconChevLeft,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  BRANDS, BRAND_ATTRIBUTES, BRAND_PRODUCTS, BRAND_PRICING,
  SIZES, SIZE_SYSTEMS, PRODUCT_SIZES, PRODUCT_NODE_ASSIGNMENTS,
  PRODUCT_CLIENT_VISIBILITY, NODES, CLIENTS,
} from "../data/mockData.js";
import ProductExpedientesTab from "../components/productos/ProductExpedientesTab.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { productosApi, marcasApi, tallasApi, nodosApi, apiFetch, getToken } from "../lib/api.js";
import FileUploader from "../components/common/FileUploader.jsx";
import FilePreview  from "../components/common/FilePreview.jsx";

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
  const { lang } = useOutletContext();
  const { productId } = useParams();

  const isEdit = Boolean(productId);

  // ── Fetch real al backend en modo EDIT (antes leía BRAND_PRODUCTS mock,
  //    por eso productos creados vía API mostraban form vacío) ──
  const [existing, setExisting] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);

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

  // Atributos (Sección B)
  const [attrs, setAttrs] = useState({
    tipo_calzado:         existing?.tipo_calzado         || BRAND_ATTRIBUTES.tipo_calzado[0],
    cubrepuntera:         existing?.cubrepuntera         || 'No',
    tipo_puntera:         existing?.tipo_puntera         || 'No tiene',
    antiperforante:       existing?.antiperforante       || 'No',
    protector_metatarsal: existing?.protector_metatarsal || 'No',
    capellada:            existing?.capellada            || BRAND_ATTRIBUTES.capellada[0],
    disipativo_energia:   existing?.disipativo_energia   || 'No',
    suela:                existing?.suela                || BRAND_ATTRIBUTES.suela[0],
    normativa:            existing?.normativa            || 'No',
    cierre:               existing?.cierre               || BRAND_ATTRIBUTES.cierre[0],
    color:                existing?.color                || BRAND_ATTRIBUTES.color[0],
    segmento:             existing?.segmento             || BRAND_ATTRIBUTES.segmento[0],
    materiales_circulares:existing?.materiales_circulares|| 'No',
    plantilla_interna:    existing?.plantilla_interna    || 'No',
    ncm:                  existing?.ncm                  || '',
  });
  // Riesgo — MULTI-CHECKBOX (no single-select)
  const [riesgos, setRiesgos] = useState(
    Array.isArray(existing?.riesgo) ? existing.riesgo
      : (existing?.riesgo ? [existing.riesgo] : [])
  );

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
      disipativo_energia:   existing.disipativo_energia   || 'No',
      suela:                existing.suela                || BRAND_ATTRIBUTES.suela[0],
      normativa:            existing.normativa            || 'No',
      cierre:               existing.cierre               || BRAND_ATTRIBUTES.cierre[0],
      color:                existing.color                || BRAND_ATTRIBUTES.color[0],
      segmento:             existing.segmento             || BRAND_ATTRIBUTES.segmento[0],
      materiales_circulares: existing.materiales_circulares|| 'No',
      plantilla_interna:    existing.plantilla_interna    || 'No',
      ncm:                  existing.ncm                  || '',
    });
    setRiesgos(Array.isArray(existing.riesgo) ? existing.riesgo : []);
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

  // Toggle helper
  const toggleRiesgo = (r) => {
    setRiesgos(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
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
  useEffect(() => {
    const norm = (r) => Array.isArray(r) ? r : (r?.results || []);
    marcasApi.list().then(r => setRealBrands(norm(r))).catch(() => setRealBrands([]));
    tallasApi.list().then(r => setRealSizes(norm(r))).catch(() => setRealSizes([]));
    nodosApi.list().then(r => setRealNodes(norm(r))).catch(() => setRealNodes([]));
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
      riesgo:           riesgos,
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
    };

    try {
      if (isEdit) {
        await productosApi.update(productId, body);
      } else {
        await productosApi.create(body);
      }
      navigate('/productos');
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
        <AttrSelect label={lang==='es'?'Disipativo de energía':'Energy dissipation'} opts={BRAND_ATTRIBUTES.disipativo_energia}
                    value={attrs.disipativo_energia} onChange={v=>setAttrs({...attrs, disipativo_energia: v})}/>
        <AttrSelect label="Suela" opts={BRAND_ATTRIBUTES.suela}
                    value={attrs.suela} onChange={v=>setAttrs({...attrs, suela: v})}/>
        <AttrSelect label="Normativa" opts={BRAND_ATTRIBUTES.normativa}
                    value={attrs.normativa} onChange={v=>setAttrs({...attrs, normativa: v})}/>
        <AttrSelect label={lang==='es'?'Cierre':'Closure'} opts={BRAND_ATTRIBUTES.cierre}
                    value={attrs.cierre} onChange={v=>setAttrs({...attrs, cierre: v})}/>
        <AttrSelect label="Color" opts={BRAND_ATTRIBUTES.color}
                    value={attrs.color} onChange={v=>setAttrs({...attrs, color: v})}/>
        <AttrSelect label="Segmento" opts={BRAND_ATTRIBUTES.segmento}
                    value={attrs.segmento} onChange={v=>setAttrs({...attrs, segmento: v})}/>
        <AttrSelect label={lang==='es'?'Materiales circulares':'Circular materials'} opts={BRAND_ATTRIBUTES.materiales_circulares}
                    value={attrs.materiales_circulares} onChange={v=>setAttrs({...attrs, materiales_circulares: v})}/>
        <AttrSelect label={lang==='es'?'Plantilla interna':'Insole'} opts={BRAND_ATTRIBUTES.plantilla_interna}
                    value={attrs.plantilla_interna} onChange={v=>setAttrs({...attrs, plantilla_interna: v})}/>
        <label className="form-field">
          <span>NCM</span>
          <input className="input mono-sm" value={attrs.ncm} onChange={e=>setAttrs({...attrs, ncm: e.target.value})}
                 placeholder="6403.40.00"/>
        </label>
      </div>

      {/* Riesgo — MULTI-CHECKBOX */}
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
            {lang==='es'?'Tallas del Motor de Tallas + Nodos logísticos que operan el SKU.':'Sizing Engine sizes + logistics nodes operating the SKU.'}
          </div>
        </div>
      </div>

      <div className="form-grid-2">
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
              {CLIENTS.map(c => {
                const on = clientOverrides[c.id] === true;
                return (
                  <button type="button" key={c.id}
                          className={`client-switch ${on ? 'client-switch-on' : ''}`}
                          onClick={()=>setClientOverrides({...clientOverrides, [c.id]: !on})}>
                    <span className="client-switch-flag">{c.flag}</span>
                    <span className="client-switch-body">
                      <span className="heading-sm">{c.name}</span>
                      <span className="caption">{c.country}</span>
                    </span>
                    <span className={`mini-switch ${on ? 'mini-on' : ''}`}>
                      <span className="mini-thumb"/>
                    </span>
                  </button>
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

        <div className="caption" style={{margin:'12px 0 6px', color:'var(--text-tertiary)'}}>
          {lang==='es'?'Override por cliente':'Per-client override'}
        </div>
        <div className="client-price-grid">
          {CLIENTS.map(c => (
            <div key={c.id} className="client-price-row">
              <span className="client-price-id">
                <span>{c.flag}</span>
                <span className="heading-sm">{c.name}</span>
              </span>
              <span className="price-editor-row price-editor-sm">
                <span className="price-prefix">$</span>
                <input className="input price-input-sm tabular-nums" type="number" step="0.01"
                       value={clientPrices[c.id] ?? ''}
                       placeholder={fmtMoney(Number(listPrice)||0).replace('$','').trim()}
                       onChange={e=>{
                         const v = e.target.value;
                         setClientPrices({...clientPrices, [c.id]: v === '' ? undefined : Number(v)});
                       }}/>
              </span>
            </div>
          ))}
        </div>

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
          <button className="btn btn-sm btn-ghost" onClick={()=>navigate('/productos')} aria-label="Back">
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
          <button className="btn" onClick={()=>navigate(isClient ? '/portal' : '/productos')}>
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
