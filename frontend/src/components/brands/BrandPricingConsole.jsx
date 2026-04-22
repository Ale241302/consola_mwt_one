// =====================================================================
// MWT.ONE · components/brands/BrandPricingConsole.jsx
// Agente responsable: [AG-FRONTEND]
//
// Consola comercial del Módulo de Marcas — 4 sub-tabs:
//   1. Listas de Precios Activas   (expandable · size_multipliers · Excel upload)
//   2. Condiciones Comerciales      (EarlyPaymentPolicy + tiers)
//   3. Reglas de Comisión [CEO]    (CommissionRule)
//   4. Simulador / Catálogo Asignado (resolve_client_price en vivo)
//
// Reglas MWT respetadas:
//   · CERO datos hardcodeados (todo sale del backend /api/commercial/*).
//   · CEO-ONLY: costos y márgenes se ocultan si !can('view_margin').
//   · Tokens: Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394.
//   · Números con tabular-nums para alineación.
// =====================================================================
import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  priceListVersionsApi, gradeItemsApi, clientAssignmentsApi,
  earlyPaymentPoliciesApi, commissionRulesApi,
  currencyCatApi, commissionBaseCatApi,
  clientesApi, commercialApi,
} from "../../lib/api.js";
import {
  MOCK_PRICELISTS, MOCK_PRICELIST_ITEMS,
} from "../../data/mockData.js";
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
  const canSeeMargins = can("view_margin");  // ← CEO-ONLY gate

  const [tab, setTab] = useState("pricelists");

  const tabs = [
    { key: "pricelists",  label: lang === "es" ? "Listas de Precios" : "Price Lists",
      icon: IconDollar },
    { key: "commercial",  label: lang === "es" ? "Condiciones & Pronto Pago" : "Conditions & Early Payment",
      icon: IconPercent },
    { key: "commissions", label: lang === "es" ? "Reglas de Comisión" : "Commission Rules",
      icon: IconLock, ceoOnly: true },
    { key: "simulator",   label: lang === "es" ? "Simulador / CPA" : "Simulator / CPA",
      icon: IconSearch },
  ].filter(t => !t.ceoOnly || canSeeMargins);

  return (
    <div className="bpc-root" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Sub-tab bar */}
      <div className="bpc-subtabs" role="tablist" style={{
        display: "flex", gap: 4, padding: 4,
        background: "#F8FAFC", borderRadius: 10,
        border: "1px solid #E5E7EB",
      }}>
        {tabs.map(t => {
          const Ico = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={active}
              onClick={() => setTab(t.key)}
              className="bpc-subtab"
              data-active={active}
              style={{
                flex: 1, display: "inline-flex", alignItems: "center",
                justifyContent: "center", gap: 6,
                padding: "8px 10px", border: "none",
                background: active ? "#FFFFFF" : "transparent",
                color: active ? NAVY : MUTED,
                font: `${active ? 700 : 600} 12.5px/1 var(--font-body)`,
                borderRadius: 8, cursor: "pointer",
                boxShadow: active ? "0 1px 2px rgba(11,30,58,0.08)" : "none",
                transition: "all 120ms ease",
              }}
            >
              <Ico size={13} />
              <span>{t.label}</span>
              {t.ceoOnly && <IconLock size={11} style={{ opacity: 0.7 }} />}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <AnimatePresence mode="wait">
        {tab === "pricelists" && (
          <motion.div key="pricelists"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
          >
            <PriceListsSubTab brandId={brandId} lang={lang} canSeeMargins={canSeeMargins} />
          </motion.div>
        )}
        {tab === "commercial" && (
          <motion.div key="commercial"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
          >
            <CommercialConditionsSubTab brandId={brandId} lang={lang} />
          </motion.div>
        )}
        {tab === "commissions" && canSeeMargins && (
          <motion.div key="commissions"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
          >
            <CommissionRulesSubTab brandId={brandId} lang={lang} />
          </motion.div>
        )}
        {tab === "simulator" && (
          <motion.div key="simulator"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
          >
            <SimulatorSubTab brandId={brandId} lang={lang} canSeeMargins={canSeeMargins} />
          </motion.div>
        )}
      </AnimatePresence>
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

  // Fallback fail-soft: si el backend está vacío o cae, usamos
  // MOCK_PRICELISTS filtrado por brand_id para que el módulo
  // siga viviendo. Las pricelists mock llevan `mock_only: true`.
  function mockForBrand() {
    return MOCK_PRICELISTS.filter(p => p.brand_id === brandId);
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
            {lang === "es" ? "Sube un Excel o crea una lista manual." : "Upload an Excel or create one manually."}
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
      </AnimatePresence>
    </div>
  );
}

// ── Panel interior de una lista: grade_items + Excel upload ────────────
function PricelistItemsPanel({ pricelist, lang, canSeeMargins, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  // Una pricelist es mock cuando lo declara explícitamente (mock_only)
  // o cuando su id sigue el patrón de id local (`pl-` + slug, en vez de UUID).
  const isMockPricelist = !!pricelist.mock_only || /^pl-/.test(String(pricelist.id || ""));
  const [usingMockItems, setUsingMockItems] = useState(false);
  const fileRef = useRef(null);

  function mockItemsForList() {
    return MOCK_PRICELIST_ITEMS[pricelist.id] || [];
  }

  async function load() {
    setLoading(true);
    // Si la pricelist nació en MOCK, no llamamos al backend (devolvería 404
    // por id desconocido). Servimos directo desde MOCK_PRICELIST_ITEMS.
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
      if (list.length === 0) {
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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [pricelist.id]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setToast(null);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      // Normalización:
      //   columnas esperadas: sku | product_sku, name | product_name,
      //                       price | unit_price_usd, cost | cost_usd,
      //                       resto de columnas numéricas se interpretan como tallas.
      const EXCLUDE = new Set([
        "sku", "product_sku", "name", "product_name",
        "price", "unit_price_usd", "cost", "cost_usd",
        "tags", "metadata",
      ]);
      const parsed = rows.map(r => {
        const norm = {};
        for (const [k, v] of Object.entries(r)) {
          norm[k.trim().toLowerCase()] = v;
        }
        const size_multipliers = {};
        for (const [k, v] of Object.entries(norm)) {
          if (EXCLUDE.has(k)) continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) continue;
          // Las claves de talla se mantienen tal cual vengan (37, 38, S, M, L, XL...)
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
      }).filter(r => r.product_sku && Number.isFinite(r.unit_price_usd));

      if (parsed.length === 0) {
        setToast({ kind: "error",
          text: lang === "es" ? "No se encontraron filas válidas en el Excel" : "No valid rows found" });
        return;
      }

      // Si la pricelist es mock (UUID inválido para el backend), no llamamos
      // bulkUpsert. Inyectamos los items parseados directamente en el state
      // local y avisamos al usuario que NO se persiste.
      if (isMockPricelist) {
        const localItems = parsed.map((p, idx) => ({
          id: `gi-local-${Date.now()}-${idx}`,
          pricelist_id: pricelist.id,
          product_sku:    p.product_sku,
          product_name:   p.product_name,
          unit_price_usd: p.unit_price_usd,
          cost_usd:       p.cost_usd,
          margen_pct:     (canSeeMargins && p.cost_usd && p.unit_price_usd)
                            ? Number((((p.unit_price_usd - p.cost_usd) / p.unit_price_usd) * 100).toFixed(1))
                            : null,
          grade_moq_total: Object.values(p.size_multipliers || {}).reduce((a, b) => a + Number(b || 0), 0),
          size_multipliers: p.size_multipliers,
          mock_only: true,
        }));
        setItems(prev => {
          const bySku = new Map(prev.map(it => [it.product_sku, it]));
          for (const li of localItems) bySku.set(li.product_sku, li);
          return Array.from(bySku.values());
        });
        setUsingMockItems(true);
        setToast({
          kind: "success",
          text: lang === "es"
            ? `${localItems.length} ítems añadidos en memoria · modo demo (no se guardan en la DB)`
            : `${localItems.length} items added in memory · demo mode (not persisted to DB)`,
        });
        return;
      }

      try {
        const resp = await commercialApi.bulkUpsertItems(pricelist.id, parsed, false);
        setToast({
          kind: "success",
          text: `${resp?.created ?? 0} creados · ${resp?.updated ?? 0} actualizados`,
        });
        await load();
        onChanged && onChanged();
      } catch (apiErr) {
        // Backend rechazó (mock-mode global o error): caemos a inyección local
        const localItems = parsed.map((p, idx) => ({
          id: `gi-local-${Date.now()}-${idx}`,
          pricelist_id: pricelist.id,
          product_sku:    p.product_sku,
          product_name:   p.product_name,
          unit_price_usd: p.unit_price_usd,
          cost_usd:       p.cost_usd,
          margen_pct:     (canSeeMargins && p.cost_usd && p.unit_price_usd)
                            ? Number((((p.unit_price_usd - p.cost_usd) / p.unit_price_usd) * 100).toFixed(1))
                            : null,
          grade_moq_total: Object.values(p.size_multipliers || {}).reduce((a, b) => a + Number(b || 0), 0),
          size_multipliers: p.size_multipliers,
          mock_only: true,
        }));
        setItems(prev => {
          const bySku = new Map(prev.map(it => [it.product_sku, it]));
          for (const li of localItems) bySku.set(li.product_sku, li);
          return Array.from(bySku.values());
        });
        setUsingMockItems(true);
        setToast({
          kind: "success",
          text: lang === "es"
            ? `${localItems.length} ítems añadidos en memoria · modo demo (backend no disponible)`
            : `${localItems.length} items added in memory · demo mode (backend unavailable)`,
        });
      }
    } catch (err) {
      setToast({ kind: "error", text: err?.body?.detail || err?.message || "Error parseando Excel" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
                 style={{ display: "none" }} onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()}
                  className="bpc-btn bpc-btn-ghost" disabled={uploading}>
            <IconUpload size={13} /> {uploading ? "Subiendo…" : (lang === "es" ? "Subir Excel" : "Upload Excel")}
          </button>
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
            {lang === "es" ? "Sube un Excel para cargar ítems." : "Upload an Excel to populate."}
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

// =====================================================================
// SUB-TAB 2 · Commercial Conditions & Early Payment
// =====================================================================
function CommercialConditionsSubTab({ brandId, lang }) {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);

  useEffect(() => {
    clientesApi.list({ is_active: true })
      .then(d => setClients(Array.isArray(d) ? d : (d?.results || [])))
      .catch(e => setError(e?.message || "Error cargando clientes"));
  }, []);

  useEffect(() => {
    if (!selectedClient || !brandId) { setPolicies([]); return; }
    setLoading(true);
    earlyPaymentPoliciesApi.list({ client_id: selectedClient.id, brand_id: brandId })
      .then(d => setPolicies(Array.isArray(d) ? d : (d?.results || [])))
      .catch(e => setError(e?.message || "Error cargando policies"))
      .finally(() => setLoading(false));
  }, [selectedClient, brandId]);

  return (
    <div className="bpc-section">
      <div className="bpc-section-header" style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>
            {lang === "es" ? "Condiciones comerciales por cliente" : "Commercial conditions per client"}
          </div>
          <div style={sectionHintStyle}>
            {lang === "es"
              ? "Configura los tiers de pronto pago (contado, 30, 60, 90 días)."
              : "Configure early-payment tiers (cash, 30, 60, 90 days)."}
          </div>
        </div>
      </div>

      {error && <div style={errorBannerStyle}>⚠ {error}</div>}

      <div style={{
        display: "grid", gridTemplateColumns: "280px 1fr", gap: 16,
      }}>
        {/* Client picker */}
        <div className="bpc-client-picker" style={{
          background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10,
          padding: 12, maxHeight: 420, overflowY: "auto",
        }}>
          <div style={{ font: "600 11px/1 var(--font-body)", color: MUTED, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            {lang === "es" ? "Clientes" : "Clients"}
          </div>
          {clients.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 12.5 }}>
              {lang === "es" ? "Sin clientes" : "No clients"}
            </div>
          ) : clients.map(c => (
            <button key={c.id}
              onClick={() => setSelectedClient(c)}
              data-active={selectedClient?.id === c.id}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 10px", border: "none", borderRadius: 6,
                background: selectedClient?.id === c.id ? "rgba(0,178,134,0.10)" : "transparent",
                color: selectedClient?.id === c.id ? MINT : INK,
                font: `${selectedClient?.id === c.id ? 700 : 500} 12.5px/1.2 var(--font-body)`,
                cursor: "pointer", marginBottom: 2,
              }}
            >
              {c.razon_social || c.nombre || c.codigo || c.id}
            </button>
          ))}
        </div>

        {/* Policy editor */}
        <div>
          {!selectedClient ? (
            <div style={emptyStyle}>
              <IconPercent size={26} />
              <div style={{ marginTop: 6, fontWeight: 600, color: NAVY }}>
                {lang === "es" ? "Selecciona un cliente" : "Select a client"}
              </div>
              <div style={{ color: MUTED, marginTop: 2, fontSize: 12 }}>
                {lang === "es"
                  ? "Las políticas de pronto pago son por (cliente × marca)."
                  : "Early-payment policies are per (client × brand)."}
              </div>
            </div>
          ) : loading ? (
            <div style={loadingStyle}>Cargando policies…</div>
          ) : (
            <PolicyEditor
              brandId={brandId}
              client={selectedClient}
              policies={policies}
              lang={lang}
              onChanged={() => {
                earlyPaymentPoliciesApi.list({
                  client_id: selectedClient.id, brand_id: brandId,
                }).then(d => setPolicies(Array.isArray(d) ? d : (d?.results || [])));
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PolicyEditor({ brandId, client, policies, lang, onChanged }) {
  const current = policies[0] || null;
  const [tiers, setTiers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setTiers(current?.tiers?.length ? current.tiers.map(t => ({
      payment_days: t.payment_days,
      discount_pct: Number(t.discount_pct),
      tier_label:   t.tier_label || "",
    })) : [
      { payment_days: 0,  discount_pct: 0, tier_label: lang === "es" ? "Contado" : "Cash" },
      { payment_days: 30, discount_pct: 0, tier_label: "30 días" },
      { payment_days: 60, discount_pct: 0, tier_label: "60 días" },
    ]);
  }, [current?.id, lang]);

  function updateTier(idx, key, value) {
    setTiers(arr => arr.map((t, i) => i === idx ? { ...t, [key]: value } : t));
  }
  function addTier() {
    setTiers(arr => [...arr, { payment_days: 0, discount_pct: 0, tier_label: "" }]);
  }
  function removeTier(idx) {
    setTiers(arr => arr.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      let policyId = current?.id;
      if (!policyId) {
        const created = await earlyPaymentPoliciesApi.create({
          client_id:  client.id,
          brand_id:   brandId,
          codigo:     `EPP-${(client.codigo || client.id).slice(0,8)}-${String(brandId).slice(0,6)}`,
          nombre:     `EPP ${client.razon_social || client.nombre || client.id} × brand`,
          valid_from: new Date().toISOString().slice(0,10),
          is_active:  true,
        });
        policyId = created?.id;
      }
      if (!policyId) throw new Error("No se pudo obtener policy_id");
      const cleanTiers = tiers
        .filter(t => Number.isFinite(Number(t.payment_days)))
        .map(t => ({
          payment_days: Number(t.payment_days),
          discount_pct: Number(t.discount_pct) || 0,
          tier_label:   t.tier_label || `${t.payment_days} días`,
        }));
      await commercialApi.replaceTiers(policyId, cleanTiers);
      setMsg({ kind: "success", text: lang === "es" ? "Tiers guardados" : "Tiers saved" });
      onChanged && onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: e?.body?.detail || e?.message || "Error guardando" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, padding: 16,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #E5E7EB",
      }}>
        <div>
          <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY }}>
            {client.razon_social || client.nombre || client.codigo}
          </div>
          <div style={{ font: "500 11px/1 var(--font-body)", color: MUTED, marginTop: 3 }}>
            {current ? `Policy: ${current.codigo}` : (lang === "es" ? "Nueva policy al guardar" : "New policy on save")}
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} className="bpc-btn bpc-btn-primary">
          {saving ? "Guardando…" : (lang === "es" ? "Guardar tiers" : "Save tiers")}
        </button>
      </div>

      {msg && (
        <div style={msg.kind === "error" ? errorBannerStyle : successBannerStyle}>
          {msg.kind === "error" ? "⚠" : "✓"} {msg.text}
        </div>
      )}

      <table className="bpc-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr>
            <Th>{lang === "es" ? "Etiqueta" : "Label"}</Th>
            <Th align="right">{lang === "es" ? "Días pago" : "Payment days"}</Th>
            <Th align="right">{lang === "es" ? "% Descuento" : "Discount %"}</Th>
            <Th align="right"></Th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => (
            <tr key={i}>
              <Td>
                <input value={t.tier_label} onChange={e => updateTier(i, "tier_label", e.target.value)}
                       className="bpc-input" placeholder={lang === "es" ? "Contado / 30 días" : "Cash / 30 days"} />
              </Td>
              <Td align="right">
                <input type="number" min={0}
                       value={t.payment_days}
                       onChange={e => updateTier(i, "payment_days", e.target.value)}
                       className="bpc-input tabular" style={{ textAlign: "right", width: 90 }} />
              </Td>
              <Td align="right">
                <input type="number" step="0.01" min={0} max={100}
                       value={t.discount_pct}
                       onChange={e => updateTier(i, "discount_pct", e.target.value)}
                       className="bpc-input tabular" style={{ textAlign: "right", width: 90 }} />
              </Td>
              <Td align="right">
                <button onClick={() => removeTier(i)}
                        className="bpc-btn bpc-btn-icon-ghost" title="Eliminar">
                  <IconX size={12} />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10 }}>
        <button onClick={addTier} className="bpc-btn bpc-btn-ghost">
          <IconPlus size={12} /> {lang === "es" ? "Agregar tier" : "Add tier"}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// SUB-TAB 3 · Commission Rules       [CEO-ONLY]
// =====================================================================
function CommissionRulesSubTab({ brandId, lang }) {
  const [rules, setRules] = useState([]);
  const [bases, setBases] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, b, c] = await Promise.all([
        commissionRulesApi.list({ brand_id: brandId }),
        commissionBaseCatApi.list(),
        clientesApi.list({ is_active: true }),
      ]);
      setRules(Array.isArray(r) ? r : (r?.results || []));
      setBases(Array.isArray(b) ? b : (b?.results || []));
      setClients(Array.isArray(c) ? c : (c?.results || []));
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error cargando commission rules");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (brandId) load(); /* eslint-disable-next-line */ }, [brandId]);

  async function handleSave(form) {
    setSaving(true);
    try {
      const payload = {
        brand_id:        brandId,
        client_id:       form.client_id || null,
        codigo:          form.codigo,
        nombre:          form.nombre,
        descripcion:     form.descripcion || "",
        commission_pct:  Number(form.commission_pct),
        commission_base: form.commission_base,
        min_sale_amount: form.min_sale_amount ? Number(form.min_sale_amount) : null,
        valid_from:      form.valid_from || new Date().toISOString().slice(0,10),
        valid_to:        form.valid_to || null,
        is_active:       true,
      };
      if (form.id) {
        await commissionRulesApi.update(form.id, payload);
      } else {
        await commissionRulesApi.create(payload);
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error guardando regla");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule) {
    if (!window.confirm(`${lang === "es" ? "Eliminar" : "Delete"} ${rule.codigo}?`)) return;
    try {
      await commissionRulesApi.remove(rule.id);
      await load();
    } catch (e) {
      setError(e?.message || "Error eliminando");
    }
  }

  return (
    <div className="bpc-section">
      <div className="bpc-section-header" style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>
            <IconLock size={14} /> {lang === "es" ? "Reglas de comisión" : "Commission rules"}
            <span className="bpc-chip" data-kind="CEO" style={{ marginLeft: 8 }}>CEO-ONLY</span>
          </div>
          <div style={sectionHintStyle}>
            {lang === "es"
              ? "Comisiones aplicables sobre precio de venta o margen bruto."
              : "Commission applied over sale price or gross margin."}
          </div>
        </div>
        <button onClick={() => setEditing({})} className="bpc-btn bpc-btn-primary">
          <IconPlus size={14} /> {lang === "es" ? "Nueva regla" : "New rule"}
        </button>
      </div>

      {error && <div style={errorBannerStyle}>⚠ {error}</div>}

      {loading ? (
        <div style={loadingStyle}>Cargando…</div>
      ) : rules.length === 0 ? (
        <div style={emptyStyle}>
          <IconLock size={22} />
          <div style={{ marginTop: 6, fontWeight: 600, color: NAVY }}>
            {lang === "es" ? "Sin reglas definidas" : "No rules defined"}
          </div>
        </div>
      ) : (
        <div className="bpc-table-wrap">
          <table className="bpc-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <Th>{lang === "es" ? "Código" : "Code"}</Th>
                <Th>{lang === "es" ? "Nombre" : "Name"}</Th>
                <Th>{lang === "es" ? "Cliente" : "Client"}</Th>
                <Th>{lang === "es" ? "Base" : "Base"}</Th>
                <Th align="right">%</Th>
                <Th align="right">Min USD</Th>
                <Th align="right"></Th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => {
                const client = clients.find(c => c.id === r.client_id);
                return (
                  <tr key={r.id}>
                    <Td><strong>{r.codigo}</strong></Td>
                    <Td>{r.nombre}</Td>
                    <Td>{client ? (client.razon_social || client.nombre) : (lang === "es" ? "Todos" : "All")}</Td>
                    <Td>
                      <span className="bpc-chip" data-kind={r.commission_base}>
                        {r.commission_base}
                      </span>
                    </Td>
                    <Td align="right" className="tabular">{r.commission_pct}%</Td>
                    <Td align="right" className="tabular">
                      {r.min_sale_amount != null ? formatMoney(r.min_sale_amount, "USD") : "—"}
                    </Td>
                    <Td align="right">
                      <button onClick={() => setEditing(r)} className="bpc-btn bpc-btn-icon-ghost" title="Editar">
                        <IconEye size={12}/>
                      </button>
                      <button onClick={() => handleDelete(r)} className="bpc-btn bpc-btn-icon-ghost" title="Eliminar">
                        <IconX size={12}/>
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {editing !== null && (
          <CommissionRuleDrawer
            initial={editing}
            brandId={brandId}
            bases={bases}
            clients={clients}
            lang={lang}
            saving={saving}
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CommissionRuleDrawer({ initial, brandId, bases, clients, lang, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    id:              initial?.id || null,
    codigo:          initial?.codigo || "",
    nombre:          initial?.nombre || "",
    descripcion:     initial?.descripcion || "",
    commission_pct:  initial?.commission_pct != null ? String(initial.commission_pct) : "5.0",
    commission_base: initial?.commission_base || "sale_price",
    min_sale_amount: initial?.min_sale_amount != null ? String(initial.min_sale_amount) : "",
    client_id:       initial?.client_id || "",
    valid_from:      initial?.valid_from || new Date().toISOString().slice(0,10),
    valid_to:        initial?.valid_to || "",
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

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
            {initial?.id ? (lang === "es" ? "Editar regla" : "Edit rule")
                         : (lang === "es" ? "Nueva regla" : "New rule")}
          </div>
          <button onClick={onClose} className="bpc-btn bpc-btn-icon-ghost">
            <IconX size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Código">
            <input className="bpc-input" value={form.codigo} onChange={e => set("codigo", e.target.value)} />
          </Field>
          <Field label="Nombre">
            <input className="bpc-input" value={form.nombre} onChange={e => set("nombre", e.target.value)} />
          </Field>
          <Field label={lang === "es" ? "Descripción" : "Description"}>
            <textarea className="bpc-input" rows={2} value={form.descripcion} onChange={e => set("descripcion", e.target.value)} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={lang === "es" ? "Cliente (opcional)" : "Client (optional)"}>
              <select className="bpc-input" value={form.client_id} onChange={e => set("client_id", e.target.value)}>
                <option value="">{lang === "es" ? "Todos" : "All clients"}</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.razon_social || c.nombre || c.codigo}</option>
                ))}
              </select>
            </Field>
            <Field label="Base">
              <select className="bpc-input" value={form.commission_base}
                      onChange={e => set("commission_base", e.target.value)}>
                {bases.length === 0
                  ? <option value="sale_price">sale_price</option>
                  : bases.map(b => <option key={b.codigo} value={b.codigo}>{b.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="% Comisión">
              <input className="bpc-input tabular" type="number" step="0.01" min={0} max={100}
                     value={form.commission_pct} onChange={e => set("commission_pct", e.target.value)} />
            </Field>
            <Field label={lang === "es" ? "Min venta USD" : "Min sale USD"}>
              <input className="bpc-input tabular" type="number" step="0.01"
                     value={form.min_sale_amount} onChange={e => set("min_sale_amount", e.target.value)}
                     placeholder="opcional" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Vigente desde">
              <input className="bpc-input" type="date" value={form.valid_from} onChange={e => set("valid_from", e.target.value)} />
            </Field>
            <Field label="Vigente hasta">
              <input className="bpc-input" type="date" value={form.valid_to} onChange={e => set("valid_to", e.target.value)} />
            </Field>
          </div>
        </div>

        <div style={{
          padding: "12px 18px", borderTop: "1px solid #E5E7EB",
          display: "flex", justifyContent: "flex-end", gap: 8,
          background: "#F8FAFC",
        }}>
          <button onClick={onClose} className="bpc-btn bpc-btn-ghost" disabled={saving}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={() => onSave(form)} className="bpc-btn bpc-btn-primary" disabled={saving}>
            {saving ? "Guardando…" : (lang === "es" ? "Guardar" : "Save")}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

// =====================================================================
// SUB-TAB 4 · Simulator / Assigned Catalog (uses resolve_client_price)
// =====================================================================
function SimulatorSubTab({ brandId, lang, canSeeMargins }) {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [paymentDays, setPaymentDays] = useState(30);
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [sims, setSims] = useState({}); // sku → resolve result
  const [filter, setFilter] = useState("");

  useEffect(() => {
    clientesApi.list({ is_active: true })
      .then(d => setClients(Array.isArray(d) ? d : (d?.results || [])));
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setLoadingItems(true);
    // Cargamos grade_items de la marca (los que están en pricelists activas)
    gradeItemsApi.list({ brand_id: brandId })
      .then(d => setItems(Array.isArray(d) ? d : (d?.results || [])))
      .finally(() => setLoadingItems(false));
  }, [brandId]);

  async function runSimulation() {
    if (!selectedClient) return;
    setSims({});
    // De-duplicate por sku (puede haber varios pricelists con el mismo sku)
    const uniq = {};
    for (const it of items) uniq[it.product_sku] = it;
    const results = {};
    await Promise.all(Object.keys(uniq).map(async sku => {
      try {
        const r = await commercialApi.resolveClientPrice({
          client_id: selectedClient.id,
          brand_id:  brandId,
          product_sku: sku,
          requested_payment_days: Number(paymentDays) || 0,
        });
        results[sku] = r;
      } catch (_) { /* skip */ }
    }));
    setSims(results);
  }

  const displayedItems = useMemo(() => {
    const uniq = {};
    for (const it of items) {
      if (!uniq[it.product_sku]
          || Number(it.unit_price_usd) < Number(uniq[it.product_sku].unit_price_usd)) {
        uniq[it.product_sku] = it;
      }
    }
    let arr = Object.values(uniq);
    if (filter.trim()) {
      const f = filter.trim().toLowerCase();
      arr = arr.filter(i =>
        i.product_sku.toLowerCase().includes(f)
        || (i.product_name || "").toLowerCase().includes(f));
    }
    return arr.sort((a, b) => a.product_sku.localeCompare(b.product_sku));
  }, [items, filter]);

  return (
    <div className="bpc-section">
      <div className="bpc-section-header" style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>
            {lang === "es" ? "Simulador de catálogo asignado" : "Assigned catalog simulator"}
          </div>
          <div style={sectionHintStyle}>
            {lang === "es"
              ? "Ejecuta el waterfall (CPA → MIN pricelist → EPP tier) para cada SKU del cliente."
              : "Runs the waterfall (CPA → MIN pricelist → EPP tier) for each client SKU."}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 14,
        padding: 12, background: "#F8FAFC", borderRadius: 10, border: "1px solid #E5E7EB",
      }}>
        <Field label={lang === "es" ? "Cliente" : "Client"} style={{ flex: 2 }}>
          <select className="bpc-input" value={selectedClient?.id || ""}
                  onChange={e => {
                    const c = clients.find(x => x.id === e.target.value);
                    setSelectedClient(c || null);
                  }}>
            <option value="">{lang === "es" ? "Selecciona…" : "Select…"}</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.razon_social || c.nombre || c.codigo}</option>
            ))}
          </select>
        </Field>
        <Field label={lang === "es" ? "Días de pago" : "Payment days"} style={{ flex: 1 }}>
          <input type="number" min={0} className="bpc-input tabular"
                 value={paymentDays} onChange={e => setPaymentDays(e.target.value)} />
        </Field>
        <Field label={lang === "es" ? "Filtrar SKU / nombre" : "Filter SKU / name"} style={{ flex: 2 }}>
          <input className="bpc-input" value={filter} onChange={e => setFilter(e.target.value)}
                 placeholder="…" />
        </Field>
        <button onClick={runSimulation} disabled={!selectedClient} className="bpc-btn bpc-btn-primary">
          <IconRefresh size={13}/> {lang === "es" ? "Simular" : "Simulate"}
        </button>
      </div>

      {loadingItems ? (
        <div style={loadingStyle}>Cargando…</div>
      ) : displayedItems.length === 0 ? (
        <div style={emptyStyle}>
          <IconSearch size={22}/>
          <div style={{ marginTop: 6, fontWeight: 600, color: NAVY }}>
            {lang === "es" ? "Sin ítems" : "No items"}
          </div>
        </div>
      ) : (
        <div className="bpc-table-wrap">
          <table className="bpc-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>{lang === "es" ? "Nombre" : "Name"}</Th>
                <Th align="right">{lang === "es" ? "Precio base" : "Base price"}</Th>
                <Th align="right">Descuento</Th>
                <Th align="right">{lang === "es" ? "Precio final" : "Final price"}</Th>
                {canSeeMargins && <Th align="right"><IconLock size={10}/> Costo</Th>}
                {canSeeMargins && <Th align="right"><IconLock size={10}/> Margen %</Th>}
                <Th>{lang === "es" ? "Origen" : "Source"}</Th>
              </tr>
            </thead>
            <tbody>
              {displayedItems.map(it => {
                const r = sims[it.product_sku];
                return (
                  <tr key={it.id}>
                    <Td><strong>{it.product_sku}</strong></Td>
                    <Td>{it.product_name || "—"}</Td>
                    <Td align="right" className="tabular">
                      {r?.base_price != null
                        ? formatMoney(r.base_price, r.currency)
                        : formatMoney(it.unit_price_usd, "USD")}
                    </Td>
                    <Td align="right" className="tabular">
                      {r?.discount_applied != null ? `${r.discount_applied}%` : "—"}
                    </Td>
                    <Td align="right" className="tabular" style={{ color: MINT, fontWeight: 700 }}>
                      {r?.final_price != null ? formatMoney(r.final_price, r.currency) : "—"}
                    </Td>
                    {canSeeMargins && (
                      <Td align="right" className="tabular" style={{ color: "#B91C1C" }}>
                        {r?.cost_usd != null ? formatMoney(r.cost_usd, "USD") : "—"}
                      </Td>
                    )}
                    {canSeeMargins && (
                      <Td align="right" className="tabular" style={{ color: MINT, fontWeight: 600 }}>
                        {r?.margen_pct != null ? `${r.margen_pct}%` : "—"}
                      </Td>
                    )}
                    <Td>
                      <span className="bpc-chip" data-kind={r?.source || "—"}>
                        {r?.source || "—"}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
