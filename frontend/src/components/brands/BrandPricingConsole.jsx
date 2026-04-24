// =====================================================================
// MWT.ONE · components/brands/BrandPricingConsole.jsx
// Agente responsable: [AG-FRONTEND]
//
// Consola comercial del Módulo de Marcas.
//
// DESDE 2026-04 (sprint M3-CORE + Calculadora COMEX):
//   Se simplifica a UN SOLO sub-tab "Listas de Precios" que combina:
//     · Tabla de pricelists activas (Excel upload · expand por SKU)
//     · Calculadora inline del Excel "Tabela de preços COMEX 2026":
//         precio_final = precio_base_USD
//                      × (1.0183 ^ (100 × comisión_pct))
//                      × índice_ME(días_pago)
//
// Tabs eliminadas (dead code — se removió 2026-04):
//   · Condiciones & Pronto Pago      (no la usaba el comprador, lógica
//                                     migró al payment_index)
//   · Reglas de Comisión [CEO]        (la comisión es ahora input libre
//                                     del usuario en la calculadora)
//   · Simulador / CPA                 (integrado dentro de "Listas de
//                                     Precios" como fila expandible)
//
// Reglas MWT respetadas:
//   · Tokens: Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394.
//   · Números con tabular-nums para alineación.
// =====================================================================
import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  priceListVersionsApi,
  currencyCatApi,
  commercialApi,
} from "../../lib/api.js";
import {
  MOCK_PRICELISTS, MOCK_PRICELIST_ITEMS,
} from "../../data/mockData.js";
import ComexCalculator from "./ComexCalculator.jsx";
import { useRole } from "../../context/RoleContext.jsx";
import {
  IconDollar, IconPlus, IconUpload, IconSearch, IconLock,
  IconChevRight, IconCheck, IconX, IconAlert, IconPercent,
  IconRefresh, IconEye, IconPackage,
} from "../../lib/icons.jsx";

const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const INK   = "#334155";
const MUTED = "#64748B";

export default function BrandPricingConsole({ brandId, lang = "es" }) {
  const { can } = useRole();
  const canSeeMargins = can("view_margin");  // ← CEO-ONLY gate (afecta columnas margen)

  // Sólo queda un sub-tab — preservamos la barra para no romper el visual,
  // pero ahora el componente es básicamente la tabla de pricelists con
  // calculadora inline.
  return (
    <div className="bpc-root" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="bpc-subtabs" role="tablist" style={{
        display: "flex", gap: 4, padding: 4,
        background: "#F8FAFC", borderRadius: 10,
        border: "1px solid #E5E7EB",
      }}>
        <div role="tab" aria-selected="true"
          className="bpc-subtab" data-active="true"
          style={{
            flex: 1, display: "inline-flex", alignItems: "center",
            justifyContent: "center", gap: 6,
            padding: "8px 10px", border: "none",
            background: "#FFFFFF", color: NAVY,
            font: "700 12.5px/1 var(--font-body)",
            borderRadius: 8, boxShadow: "0 1px 2px rgba(11,30,58,0.08)",
          }}
        >
          <IconDollar size={13} />
          <span>{lang === "es" ? "Listas de Precios" : "Price Lists"}</span>
        </div>
      </div>

      <PriceListsSubTab brandId={brandId} lang={lang} canSeeMargins={canSeeMargins} />

      {/* Calculadora COMEX · reproduce J18 del Excel v6 con los 20
          productos demo + 34 índices de pago sembrados en mockData.js */}
      <ComexCalculator lang={lang} />
    </div>
  );
}

// =====================================================================
// SUB-TAB 1 · Price Lists (expandable rows + Excel upload)
// =====================================================================
function PriceListsSubTab({ brandId, lang, canSeeMargins }) {
  const [versions, setVersions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [usingMock, setUsingMock] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showNew,  setShowNew]  = useState(false);
  const [showExcel, setShowExcel] = useState(false);
  // Items cargados vía Excel a pricelists mock/locales (no en BD). Mapa id→items.
  const [mockItemsByList, setMockItemsByList] = useState({});

  // Fallback fail-soft: si el backend está vacío o cae, usamos
  // MOCK_PRICELISTS filtrado por brand_id para que el módulo
  // siga viviendo. Las pricelists mock llevan `mock_only: true`.
  function mockForBrand() {
    return MOCK_PRICELISTS.filter(p => p.brand_id === brandId);
  }

  // Añade ítems locales a una pricelist. Usado por el drawer de carga masiva
  // de Excel a nivel marca cuando la pricelist destino es mock o el backend
  // rechaza el bulkUpsert.
  function addMockItemsToList(pricelistId, items) {
    setMockItemsByList(prev => {
      const existing = prev[pricelistId] || [];
      const bySku = new Map(existing.map(it => [it.product_sku, it]));
      for (const li of items) bySku.set(li.product_sku, li);
      const merged = Array.from(bySku.values());
      // Sincronizar items_count en el row correspondiente
      setVersions(vs => vs.map(v =>
        v.id === pricelistId ? { ...v, items_count: merged.length } : v
      ));
      return { ...prev, [pricelistId]: merged };
    });
    setUsingMock(true);
    setExpandedId(pricelistId);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await priceListVersionsApi.list({ brand_id: brandId });
      const list = Array.isArray(d) ? d : (d?.results || []);
      if (list.length === 0) {
        setVersions(mockForBrand());
        setUsingMock(true);
      } else {
        setVersions(list);
        setUsingMock(false);
      }
    } catch (e) {
      // Backend no disponible / mock-mode: caemos a MOCK directamente
      setVersions(mockForBrand());
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (brandId) load(); /* eslint-disable-next-line */ }, [brandId]);

  // Handler de creación local (cuando el backend rechaza POST porque
  // está en mock-mode o porque la lista que creamos vive sólo en FE).
  function handleLocalCreate(payload) {
    const fakeId = `pl-local-${Date.now()}`;
    const newPL = {
      id: fakeId,
      brand_id: brandId,
      codigo: payload.codigo,
      nombre: payload.nombre,
      descripcion: payload.descripcion,
      currency: payload.currency,
      valid_from: payload.valid_from,
      valid_to: payload.valid_to,
      source: payload.source,
      is_active: true,
      items_count: 0,
      mock_only: true,
    };
    setVersions(prev => [newPL, ...prev]);
    setUsingMock(true);
    setShowNew(false);
  }

  return (
    <div className="bpc-section">
      <div className="bpc-section-header" style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>
            {lang === "es" ? "Listas de precios activas" : "Active price lists"}
          </div>
          <div style={sectionHintStyle}>
            {lang === "es"
              ? "Múltiples listas pueden coexistir. El precio de cliente se resuelve con MIN(unit_price_usd)."
              : "Multiple active lists coexist. Client price resolves to MIN(unit_price_usd)."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} className="bpc-btn bpc-btn-ghost" title="Recargar">
            <IconRefresh size={14} />
          </button>
          <button onClick={() => setShowExcel(true)} className="bpc-btn bpc-btn-ghost"
                  title={lang === "es"
                    ? "Un único Excel por marca. Todos los productos en una pasada."
                    : "One Excel per brand. All products at once."}>
            <IconUpload size={14} />
            {lang === "es" ? "Subir Excel de la marca" : "Upload brand Excel"}
          </button>
          <button onClick={() => setShowNew(true)} className="bpc-btn bpc-btn-primary">
            <IconPlus size={14} />
            {lang === "es" ? "Nueva lista" : "New list"}
          </button>
        </div>
      </div>

      {error && (
        <div style={errorBannerStyle}>⚠ {error}</div>
      )}

      {usingMock && !loading && versions.length > 0 && (
        <div style={{
          padding: "8px 12px", borderRadius: 8,
          background: "rgba(180,83,9,0.10)", color: "#B45309",
          font: "500 12.5px/1.4 var(--font-body)", marginBottom: 10,
          border: "1px solid rgba(180,83,9,0.20)",
        }}>
          ⚠ {lang === "es"
              ? "Modo demo · listas de ejemplo (la DB de pricelists está vacía o el backend no responde). Las creaciones / Excel no se persisten."
              : "Demo mode · sample lists (pricelists DB is empty or backend not responding). Creations / Excel won't persist."}
        </div>
      )}

      {loading ? (
        <div style={loadingStyle}>Cargando…</div>
      ) : versions.length === 0 ? (
        <div style={emptyStyle}>
          <IconDollar size={28} />
          <div style={{ marginTop: 8, fontWeight: 600, color: NAVY }}>
            {lang === "es" ? "Aún no hay listas de precios" : "No price lists yet"}
          </div>
          <div style={{ color: MUTED, marginTop: 2, fontSize: 12.5 }}>
            {lang === "es" ? "Sube el Excel de la marca o crea una lista manual." : "Upload the brand Excel or create a list manually."}
          </div>
        </div>
      ) : (
        <div className="bpc-table-wrap">
          <table className="bpc-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <Th>{lang === "es" ? "Código" : "Code"}</Th>
                <Th>{lang === "es" ? "Nombre" : "Name"}</Th>
                <Th>{lang === "es" ? "Moneda" : "Currency"}</Th>
                <Th>{lang === "es" ? "Vigencia" : "Valid from"}</Th>
                <Th>{lang === "es" ? "Origen" : "Source"}</Th>
                <Th align="right">{lang === "es" ? "Ítems" : "Items"}</Th>
                <Th align="right"></Th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => {
                const isOpen = expandedId === v.id;
                return (
                  <React.Fragment key={v.id}>
                    <tr className="bpc-row"
                        onClick={() => setExpandedId(isOpen ? null : v.id)}
                        style={{ cursor: "pointer" }}>
                      <Td><strong>{v.codigo}</strong></Td>
                      <Td>{v.nombre}</Td>
                      <Td className="tabular">{v.currency}</Td>
                      <Td className="tabular">{v.valid_from}{v.valid_to ? ` → ${v.valid_to}` : ""}</Td>
                      <Td>
                        <span className="bpc-chip" data-kind={v.source}>
                          {v.source}
                        </span>
                      </Td>
                      <Td align="right" className="tabular">{v.items_count ?? "—"}</Td>
                      <Td align="right">
                        <IconChevRight size={14}
                          style={{
                            transform: isOpen ? "rotate(90deg)" : "none",
                            transition: "transform 140ms ease",
                            color: MUTED,
                          }} />
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: "#F8FAFC" }}>
                          <PricelistItemsPanel
                            pricelist={v}
                            lang={lang}
                            canSeeMargins={canSeeMargins}
                            mockOverride={mockItemsByList[v.id] || null}
                            onChanged={load}
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
      )}

      <AnimatePresence>
        {showNew && (
          <NewPriceListDrawer
            brandId={brandId}
            lang={lang}
            onClose={() => setShowNew(false)}
            onCreated={() => { setShowNew(false); load(); }}
            onLocalFallback={handleLocalCreate}
          />
        )}
        {showExcel && (
          <BrandExcelUploadDrawer
            brandId={brandId}
            lang={lang}
            versions={versions}
            canSeeMargins={canSeeMargins}
            onClose={() => setShowExcel(false)}
            onUploaded={() => { setShowExcel(false); load(); }}
            onLocalCreate={handleLocalCreate}
            onLocalAddItems={addMockItemsToList}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Panel interior de una lista: grade_items (read-only view) ──────────
// NOTA: La carga de Excel NO vive aquí. Existe UN único punto de entrada
// por marca (botón "Subir Excel de la marca" en el header del sub-tab).
function PricelistItemsPanel({ pricelist, lang, canSeeMargins, mockOverride, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  // Una pricelist es mock cuando lo declara explícitamente (mock_only)
  // o cuando su id sigue el patrón de id local (`pl-` + slug, en vez de UUID).
  const isMockPricelist = !!pricelist.mock_only || /^pl-/.test(String(pricelist.id || ""));
  const [usingMockItems, setUsingMockItems] = useState(false);

  // Fuente de items mock: override del padre (Excel cargado en esta sesión)
  // tiene precedencia sobre los seeds estáticos de MOCK_PRICELIST_ITEMS.
  function mockItemsForList() {
    if (Array.isArray(mockOverride) && mockOverride.length > 0) return mockOverride;
    return MOCK_PRICELIST_ITEMS[pricelist.id] || [];
  }

  async function load() {
    setLoading(true);
    // Si la pricelist nació en MOCK, no llamamos al backend (devolvería 404
    // por id desconocido). Servimos directo desde mock/override.
    if (isMockPricelist) {
      const mockList = mockItemsForList();
      setItems(mockList);
      setUsingMockItems(true);
      setLoading(false);
      return;
    }
    try {
      const d = await commercialApi.listItemsOfPricelist(pricelist.id);
      const list = Array.isArray(d) ? d : (d?.results || []);
      // Si el override tiene items (Excel subido esta sesión sobre una lista
      // cuyo bulkUpsert cayó en fail-soft), los mergeamos encima del backend.
      if (Array.isArray(mockOverride) && mockOverride.length > 0) {
        const bySku = new Map(list.map(it => [it.product_sku, it]));
        for (const ov of mockOverride) bySku.set(ov.product_sku, ov);
        setItems(Array.from(bySku.values()));
        setUsingMockItems(true);
      } else if (list.length === 0) {
        const mockList = mockItemsForList();
        setItems(mockList);
        setUsingMockItems(mockList.length > 0);
      } else {
        setItems(list);
        setUsingMockItems(false);
      }
    } catch (e) {
      const mockList = mockItemsForList();
      if (mockList.length > 0) {
        setItems(mockList);
        setUsingMockItems(true);
      } else {
        setToast({ kind: "error", text: e?.message || "Error cargando items" });
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [pricelist.id, mockOverride]);

  return (
    <div style={{ padding: "14px 18px", borderTop: "1px solid #E5E7EB" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ font: "700 13px/1.2 var(--font-body)", color: NAVY }}>
          {lang === "es" ? "Ítems del grade" : "Grade items"}{" "}
          <span className="tabular" style={{ color: MUTED, fontWeight: 500 }}>
            · {items.length}
          </span>
          <span style={{
            marginLeft: 8, font: "500 11px/1 var(--font-body)", color: MUTED, fontStyle: "italic",
          }}>
            {lang === "es"
              ? "(vista de sólo lectura · usa «Subir Excel de la marca» para cargar)"
              : "(read-only · use \"Upload brand Excel\" to load)"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={load} className="bpc-btn bpc-btn-ghost" title="Recargar">
            <IconRefresh size={13} />
          </button>
        </div>
      </div>

      {toast && (
        <div style={toast.kind === "error" ? errorBannerStyle : successBannerStyle}>
          {toast.kind === "error" ? "⚠" : "✓"} {toast.text}
        </div>
      )}

      {usingMockItems && items.length > 0 && (
        <div style={{
          padding: "8px 12px", borderRadius: 8,
          background: "rgba(180,83,9,0.10)", color: "#B45309",
          font: "500 12.5px/1.4 var(--font-body)", marginBottom: 10,
          border: "1px solid rgba(180,83,9,0.20)",
        }}>
          ⚠ {lang === "es"
              ? "Modo demo · ítems de ejemplo (la lista no existe en la DB o el backend no responde). El Excel se carga en memoria, no se persiste."
              : "Demo mode · sample items (list is not in DB or backend not responding). Excel uploads stay in memory, not persisted."}
        </div>
      )}

      {loading ? (
        <div style={loadingStyle}>Cargando ítems…</div>
      ) : items.length === 0 ? (
        <div style={{ ...emptyStyle, padding: 24 }}>
          <IconPackage size={22} />
          <div style={{ marginTop: 6, fontWeight: 600, color: NAVY }}>
            {lang === "es" ? "Lista vacía" : "Empty list"}
          </div>
          <div style={{ color: MUTED, marginTop: 2, fontSize: 12 }}>
            {lang === "es"
              ? "Sube el Excel de la marca para poblar ítems (botón arriba)."
              : "Upload the brand Excel to populate (button above)."}
          </div>
        </div>
      ) : (
        <div style={{
          background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8,
          overflow: "hidden",
        }}>
          <table className="bpc-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>{lang === "es" ? "Nombre" : "Name"}</Th>
                <Th align="right">{lang === "es" ? "Precio" : "Price"}</Th>
                {canSeeMargins && <Th align="right"><IconLock size={11}/> Costo</Th>}
                {canSeeMargins && <Th align="right"><IconLock size={11}/> Margen %</Th>}
                <Th align="right">Grade MOQ</Th>
                <Th>{lang === "es" ? "Curva de tallas" : "Size curve"}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <Td><strong>{it.product_sku}</strong></Td>
                  <Td>{it.product_name || "—"}</Td>
                  <Td align="right" className="tabular">
                    {formatMoney(it.unit_price_usd, pricelist.currency)}
                  </Td>
                  {canSeeMargins && (
                    <Td align="right" className="tabular" style={{ color: "#B91C1C" }}>
                      {it.cost_usd != null ? formatMoney(it.cost_usd, pricelist.currency) : "—"}
                    </Td>
                  )}
                  {canSeeMargins && (
                    <Td align="right" className="tabular" style={{ color: MINT, fontWeight: 600 }}>
                      {it.margen_pct != null ? `${it.margen_pct}%` : "—"}
                    </Td>
                  )}
                  <Td align="right" className="tabular">{it.grade_moq_total ?? 0}</Td>
                  <Td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {Object.entries(it.size_multipliers || {}).map(([s, q]) => (
                        <span key={s} className="bpc-size-chip">
                          {s}·{q}
                        </span>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// (Sub-tabs eliminadas en 2026-04: CommercialConditionsSubTab,
//  CommissionRulesSubTab, SimulatorSubTab. La calculadora COMEX
//  vive ahora dentro de PriceListsSubTab — fila expandible.)


// =====================================================================
// Drawer · Nueva lista de precios
// =====================================================================
function NewPriceListDrawer({ brandId, lang, onClose, onCreated, onLocalFallback }) {
  const [form, setForm] = useState({
    codigo: "",
    nombre: "",
    descripcion: "",
    currency: "USD",
    valid_from: new Date().toISOString().slice(0,10),
    valid_to: "",
    source: "MANUAL",
  });
  const [currencies, setCurrencies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    currencyCatApi.list()
      .then(d => setCurrencies(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setCurrencies([]));
  }, []);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        brand_id: brandId,
        codigo:   form.codigo.trim(),
        nombre:   form.nombre.trim(),
        descripcion: form.descripcion,
        currency: form.currency,
        valid_from: form.valid_from,
        valid_to:   form.valid_to || null,
        source:     form.source,
        is_active:  true,
      };
      if (!payload.codigo || !payload.nombre) {
        setError(lang === "es" ? "Código y nombre son obligatorios" : "Code and name are required");
        setSaving(false);
        return;
      }
      try {
        await priceListVersionsApi.create(payload);
        onCreated && onCreated();
      } catch (apiErr) {
        // Backend rechazó (mock-mode o fallo): caemos a creación local
        if (typeof onLocalFallback === "function") {
          onLocalFallback(payload);
        } else {
          throw apiErr;
        }
      }
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.30)", zIndex: 100 }} />
      <motion.aside initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
        transition={{ duration: 0.22, ease: [0.32,0.72,0,1] }}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100vw",
          background: "#FFFFFF", zIndex: 101, display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 32px rgba(11,30,58,0.18)",
        }}
      >
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid #E5E7EB",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ font: "700 15px/1.2 var(--font-body)", color: NAVY }}>
            {lang === "es" ? "Nueva lista de precios" : "New price list"}
          </div>
          <button onClick={onClose} className="bpc-btn bpc-btn-icon-ghost"><IconX size={14}/></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Código">
            <input className="bpc-input" value={form.codigo} onChange={e => set("codigo", e.target.value)}
                   placeholder="SS26-MAYORISTA" />
          </Field>
          <Field label="Nombre">
            <input className="bpc-input" value={form.nombre} onChange={e => set("nombre", e.target.value)} />
          </Field>
          <Field label="Descripción">
            <textarea className="bpc-input" rows={2} value={form.descripcion}
                      onChange={e => set("descripcion", e.target.value)} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Moneda">
              <select className="bpc-input" value={form.currency} onChange={e => set("currency", e.target.value)}>
                {currencies.length === 0
                  ? <option value="USD">USD</option>
                  : currencies.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </Field>
            <Field label="Origen">
              <select className="bpc-input" value={form.source} onChange={e => set("source", e.target.value)}>
                <option value="UPLOAD">UPLOAD</option>
                <option value="MANUAL">MANUAL</option>
                <option value="API">API</option>
                <option value="MIGRATION">MIGRATION</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Vigente desde">
              <input className="bpc-input" type="date" value={form.valid_from}
                     onChange={e => set("valid_from", e.target.value)} />
            </Field>
            <Field label="Vigente hasta">
              <input className="bpc-input" type="date" value={form.valid_to}
                     onChange={e => set("valid_to", e.target.value)} />
            </Field>
          </div>
          {error && <div style={errorBannerStyle}>⚠ {error}</div>}
        </div>

        <div style={{
          padding: "12px 18px", borderTop: "1px solid #E5E7EB", background: "#F8FAFC",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} disabled={saving} className="bpc-btn bpc-btn-ghost">
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={handleSave} disabled={saving} className="bpc-btn bpc-btn-primary">
            {saving ? "Guardando…" : (lang === "es" ? "Crear" : "Create")}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

// =====================================================================
// Drawer · Carga masiva de Excel a nivel MARCA
//
// Un único botón por marca. Dispara este drawer que pide:
//   1. Lista destino (dropdown con existentes + "Crear nueva…")
//   2. Archivo Excel
//
// Luego parsea + hace bulkUpsert. Fail-soft en mock-mode: si la lista
// es local o el backend rechaza, los ítems quedan en memoria y el
// sub-tab los ve vía el prop mockOverride.
// =====================================================================
function BrandExcelUploadDrawer({
  brandId, lang, versions, canSeeMargins,
  onClose, onUploaded, onLocalCreate, onLocalAddItems,
}) {
  const [target, setTarget] = useState(
    versions.length > 0 ? versions[0].id : "__new__"
  );
  const [newCodigo, setNewCodigo]     = useState(`EXCEL-${new Date().toISOString().slice(0,10)}`);
  const [newNombre, setNewNombre]     = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [file, setFile]               = useState(null);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);
  const [success, setSuccess]         = useState(null);
  const fileRef = useRef(null);

  async function handleSubmit() {
    if (!file) {
      setError(lang === "es" ? "Selecciona un archivo Excel." : "Pick an Excel file.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const parsed = parseRowsToItems(rows, canSeeMargins);
      if (parsed.length === 0) {
        setError(lang === "es"
          ? "Sin filas válidas en el Excel. Revisa columnas: sku, name, price, (cost), y tallas numéricas."
          : "No valid rows. Check columns: sku, name, price, (cost), numeric size columns.");
        setBusy(false);
        return;
      }

      // Decidir pricelist destino
      let pricelistId = target;
      let isMockTarget = false;
      let createdMockList = null;

      if (target === "__new__") {
        const newPayload = {
          brand_id:    brandId,
          codigo:      newCodigo.trim() || `EXCEL-${Date.now()}`,
          nombre:      newNombre.trim() || newCodigo.trim() || "Lista desde Excel",
          descripcion: "",
          currency:    newCurrency,
          valid_from:  new Date().toISOString().slice(0,10),
          valid_to:    null,
          source:      "UPLOAD",
          is_active:   true,
        };
        try {
          const created = await priceListVersionsApi.create(newPayload);
          pricelistId = created?.id;
        } catch (apiErr) {
          // Fail-soft: creamos la pricelist en memoria
          pricelistId = `pl-local-${Date.now()}`;
          isMockTarget = true;
          createdMockList = { ...newPayload, id: pricelistId, items_count: parsed.length, mock_only: true };
        }
      } else {
        const tgt = versions.find(v => v.id === target);
        isMockTarget = !!(tgt?.mock_only) || /^pl-/.test(String(target));
      }

      if (isMockTarget) {
        const localItems = makeLocalItems(parsed, pricelistId, canSeeMargins);
        if (createdMockList) onLocalCreate && onLocalCreate(createdMockList);
        onLocalAddItems && onLocalAddItems(pricelistId, localItems);
        setSuccess(lang === "es"
          ? `${localItems.length} ítems añadidos en memoria · modo demo (no se persisten).`
          : `${localItems.length} items added in memory · demo mode (not persisted).`);
        setTimeout(onClose, 1300);
        return;
      }

      // Lista real: bulkUpsert vs fail-soft
      try {
        const resp = await commercialApi.bulkUpsertItems(pricelistId, parsed, false);
        setSuccess(lang === "es"
          ? `${resp?.created ?? 0} ítems creados · ${resp?.updated ?? 0} actualizados.`
          : `${resp?.created ?? 0} created · ${resp?.updated ?? 0} updated.`);
        onUploaded && onUploaded();
        setTimeout(onClose, 1300);
      } catch (apiErr) {
        const localItems = makeLocalItems(parsed, pricelistId, canSeeMargins);
        onLocalAddItems && onLocalAddItems(pricelistId, localItems);
        setSuccess(lang === "es"
          ? `${localItems.length} ítems añadidos en memoria · backend rechazó (modo demo).`
          : `${localItems.length} items added in memory · backend rejected (demo mode).`);
        setTimeout(onClose, 1300);
      }
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.30)", zIndex: 100 }} />
      <motion.aside initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
        transition={{ duration: 0.22, ease: [0.32,0.72,0,1] }}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100vw",
          background: "#FFFFFF", zIndex: 101, display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 32px rgba(11,30,58,0.18)",
        }}
      >
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid #E5E7EB",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ font: "700 15px/1.2 var(--font-body)", color: NAVY }}>
            {lang === "es" ? "Subir Excel · toda la marca" : "Upload Excel · full brand"}
          </div>
          <button onClick={onClose} className="bpc-btn bpc-btn-icon-ghost"><IconX size={14}/></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            padding: "10px 12px", borderRadius: 8,
            background: "rgba(0,178,134,0.06)", color: INK,
            border: "1px solid rgba(0,178,134,0.18)",
            font: "500 12px/1.5 var(--font-body)",
          }}>
            {lang === "es"
              ? "Un único Excel cubre TODOS los productos de la marca. Columnas esperadas: sku, name, price"
              : "One Excel covers ALL brand products. Expected columns: sku, name, price"}
            {canSeeMargins && (lang === "es" ? ", cost" : ", cost")}
            {lang === "es"
              ? ". El resto de columnas numéricas se interpretan como tallas (37, 38, S, M, L, XL…)."
              : ". Remaining numeric columns are read as sizes (37, 38, S, M, L, XL…)."}
          </div>

          <Field label={lang === "es" ? "Lista destino" : "Target list"}>
            <select className="bpc-input" value={target} onChange={e => setTarget(e.target.value)}>
              {versions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.codigo} — {v.nombre} ({v.currency}){v.mock_only ? " · demo" : ""}
                </option>
              ))}
              <option value="__new__">
                {lang === "es" ? "✨ Crear nueva lista…" : "✨ Create new list…"}
              </option>
            </select>
          </Field>

          {target === "__new__" && (
            <div style={{
              padding: 12, background: "#F8FAFC", borderRadius: 8,
              border: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 10,
            }}>
              <Field label={lang === "es" ? "Código de la nueva lista" : "New list code"}>
                <input className="bpc-input" value={newCodigo}
                       onChange={e => setNewCodigo(e.target.value)} />
              </Field>
              <Field label={lang === "es" ? "Nombre" : "Name"}>
                <input className="bpc-input" value={newNombre}
                       onChange={e => setNewNombre(e.target.value)}
                       placeholder={lang === "es" ? "Lista desde Excel" : "List from Excel"} />
              </Field>
              <Field label={lang === "es" ? "Moneda" : "Currency"}>
                <select className="bpc-input" value={newCurrency}
                        onChange={e => setNewCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="ARS">ARS</option>
                  <option value="BRL">BRL</option>
                  <option value="MXN">MXN</option>
                </select>
              </Field>
            </div>
          )}

          <Field label={lang === "es" ? "Archivo Excel (.xlsx / .xls / .csv)" : "Excel file"}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
                   onChange={e => setFile(e.target.files?.[0] || null)}
                   style={{ font: "500 12px/1.4 var(--font-body)" }} />
            {file && (
              <div style={{ marginTop: 6, font: "500 11.5px/1.4 var(--font-body)", color: MUTED }}>
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </Field>

          {error   && <div style={errorBannerStyle}>⚠ {error}</div>}
          {success && <div style={successBannerStyle}>✓ {success}</div>}
        </div>

        <div style={{
          padding: "12px 18px", borderTop: "1px solid #E5E7EB", background: "#F8FAFC",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} disabled={busy} className="bpc-btn bpc-btn-ghost">
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={handleSubmit} disabled={busy || !file} className="bpc-btn bpc-btn-primary">
            {busy
              ? (lang === "es" ? "Procesando…" : "Processing…")
              : (lang === "es" ? "Subir y aplicar" : "Upload & apply")}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

// =====================================================================
// Helpers UI
// =====================================================================
function Th({ children, align }) {
  return (
    <th style={{
      padding: "10px 12px",
      textAlign: align || "left",
      font: "600 11px/1 var(--font-body)",
      color: MUTED,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      borderBottom: "1px solid #E5E7EB",
      background: "#F8FAFC",
      position: "sticky", top: 0,
    }}>{children}</th>
  );
}
function Td({ children, align, className, style }) {
  return (
    <td className={className} style={{
      padding: "10px 12px",
      textAlign: align || "left",
      font: "500 12.5px/1.35 var(--font-body)",
      color: INK,
      borderBottom: "1px solid #F1F5F9",
      ...(style || {}),
    }}>{children}</td>
  );
}
function Field({ label, children, style }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, ...(style || {}) }}>
      <span style={{
        font: "600 11px/1 var(--font-body)",
        color: MUTED,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}>{label}</span>
      {children}
    </label>
  );
}

// Parsea filas de Excel a items de pricelist.
// Reglas:
//   · sku | product_sku → product_sku
//   · name | product_name → product_name
//   · price | unit_price_usd → unit_price_usd
//   · cost | cost_usd → cost_usd (sólo si canSeeMargins)
//   · cualquier otra columna numérica > 0 → entrada en size_multipliers
const _EXCEL_EXCLUDE = new Set([
  "sku", "product_sku", "name", "product_name",
  "price", "unit_price_usd", "cost", "cost_usd",
  "tags", "metadata",
]);

function parseRowsToItems(rows, canSeeMargins) {
  return rows.map(r => {
    const norm = {};
    for (const [k, v] of Object.entries(r)) {
      norm[String(k).trim().toLowerCase()] = v;
    }
    const size_multipliers = {};
    for (const [k, v] of Object.entries(norm)) {
      if (_EXCEL_EXCLUDE.has(k)) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      size_multipliers[String(k).trim()] = Math.round(n);
    }
    return {
      product_sku:    String(norm.sku || norm.product_sku || "").trim(),
      product_name:   String(norm.name || norm.product_name || "").trim(),
      unit_price_usd: Number(norm.price || norm.unit_price_usd || 0),
      cost_usd:       canSeeMargins && (norm.cost !== "" || norm.cost_usd !== "")
                        ? Number(norm.cost || norm.cost_usd || 0)
                        : null,
      size_multipliers,
    };
  }).filter(r => r.product_sku && Number.isFinite(r.unit_price_usd) && r.unit_price_usd > 0);
}

// Convierte items parseados a forma "rendereable" en la tabla (con id local,
// margen_pct calculado y grade_moq_total agregado).
function makeLocalItems(parsed, pricelistId, canSeeMargins) {
  const stamp = Date.now();
  return parsed.map((p, idx) => ({
    id: `gi-local-${stamp}-${idx}`,
    pricelist_id:    pricelistId,
    product_sku:     p.product_sku,
    product_name:    p.product_name,
    unit_price_usd:  p.unit_price_usd,
    cost_usd:        p.cost_usd,
    margen_pct:      (canSeeMargins && p.cost_usd && p.unit_price_usd)
                       ? Number((((p.unit_price_usd - p.cost_usd) / p.unit_price_usd) * 100).toFixed(1))
                       : null,
    grade_moq_total: Object.values(p.size_multipliers || {}).reduce((a, b) => a + Number(b || 0), 0),
    size_multipliers: p.size_multipliers,
    mock_only:       true,
  }));
}

function formatMoney(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  try {
    return n.toLocaleString("en-US", {
      style: "currency", currency: currency || "USD",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

const sectionHeaderStyle = {
  display: "flex", alignItems: "flex-end", justifyContent: "space-between",
  gap: 12, marginBottom: 12,
};
const sectionTitleStyle = {
  display: "inline-flex", alignItems: "center", gap: 6,
  font: "700 14px/1.2 var(--font-body)", color: NAVY,
};
const sectionHintStyle = {
  font: "500 12px/1.4 var(--font-body)", color: MUTED, marginTop: 4,
};
const errorBannerStyle = {
  padding: "8px 12px", borderRadius: 8,
  background: "rgba(239,68,68,0.10)", color: "#B91C1C",
  font: "500 12.5px/1.4 var(--font-body)", marginBottom: 10,
};
const successBannerStyle = {
  padding: "8px 12px", borderRadius: 8,
  background: "rgba(0,178,134,0.10)", color: MINT,
  font: "500 12.5px/1.4 var(--font-body)", marginBottom: 10,
};
const loadingStyle = {
  padding: 30, textAlign: "center", color: MUTED,
  font: "500 13px/1.4 var(--font-body)",
};
const emptyStyle = {
  padding: 36, textAlign: "center",
  background: "#F8FAFC", borderRadius: 10,
  border: "1px dashed #E5E7EB", color: MUTED,
};
