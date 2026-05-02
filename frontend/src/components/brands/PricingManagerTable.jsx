// ─────────────────────────────────────────────────────────────
// PricingManagerTable — Motor de precios con gobernanza CEO-ONLY
// Agente responsable: [AG-FRONTEND]
//
// Governance model (tres capas):
//   · base_price      → Precio de Lista (público)
//   · client_prices   → Overrides por cliente (B2B / distribución)
//   · internal_cost   → Costo MWT.ONE (CEO-ONLY · aislado)
//
// Reglas:
//   - internal_cost solo visible si `isCeo` = true (toggle o rol)
//   - La columna CEO se resalta visualmente (banda roja)
//   - Permite cargar masivo Excel (botón placeholder)
//   - Permite editar inline precio cliente seleccionado
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconLock, IconEye, IconUpload, IconDownload, IconDollar,
  IconSearch, IconCheck, IconAlert,
} from "../../lib/icons.jsx";
import { fmtMoneyDetail } from "../../lib/i18n.js";
import { BRAND_PRICING, BRAND_PRODUCTS, CLIENTS } from "../../data/mockData.js";

export default function PricingManagerTable({
  lang = 'es',
  brandId,            // id de marca (ej. 'mlv')
  isCeo = true,       // default true en el mock; en prod viene del role
  onMassUpload,       // handler opcional para el botón de masivo
}) {
  /* ── Data slice ── */
  const rows = useMemo(
    () => BRAND_PRICING.filter(r => r.brand_id === brandId),
    [brandId]
  );

  const productsIx = useMemo(() => {
    const map = {};
    BRAND_PRODUCTS.filter(p => p.brand_id === brandId).forEach(p => {
      map[p.sku] = p;
    });
    return map;
  }, [brandId]);

  /* Clientes que al menos tienen un override en esta marca (para el selector) */
  const clientsWithPricing = useMemo(() => {
    const ids = new Set();
    rows.forEach(r => Object.keys(r.client_prices || {}).forEach(cid => ids.add(cid)));
    return CLIENTS.filter(c => ids.has(c.id));
  }, [rows]);

  /* ── State ── */
  const [q, setQ] = useState('');
  const [selectedClient, setSelectedClient] = useState(
    clientsWithPricing[0]?.id || null
  );
  const [showInternal, setShowInternal] = useState(isCeo);

  // Sprint 2026-05-02: `normativa` puede venir como array (nuevo
  // multi-select) o como string (legacy). Normalizamos para el join.
  const asText = (v) => Array.isArray(v) ? v.filter(Boolean).join(' ') : (v || '');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => {
      const p = productsIx[r.sku];
      const hay = [r.sku, p?.nombre, p?.capellada, asText(p?.normativa)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, productsIx]);

  /* ── Derived KPIs ── */
  const kpis = useMemo(() => {
    const n = rows.length;
    if (!n) return { n, avgList: 0, avgCost: 0, avgMarginPct: 0, minMargin: 0, maxMargin: 0 };
    const avgList = rows.reduce((a, r) => a + r.base_price, 0) / n;
    const avgCost = rows.reduce((a, r) => a + r.internal_cost, 0) / n;
    const margins = rows.map(r => (r.base_price - r.internal_cost) / r.base_price);
    return {
      n,
      avgList, avgCost,
      avgMarginPct: margins.reduce((a,b)=>a+b,0) / n,
      minMargin: Math.min(...margins),
      maxMargin: Math.max(...margins),
    };
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconDollar size={22} style={{ color: 'var(--text-tertiary)' }}/>
        <div className="heading-md">
          {lang === 'es' ? 'Sin precios registrados' : 'No prices recorded'}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
          {lang === 'es'
            ? 'Carga masiva Excel o añade precios al crear productos.'
            : 'Bulk-upload Excel or add prices when creating products.'}
        </div>
      </div>
    );
  }

  return (
    <div className="pricing-mgr">
      {/* ── Toolbar ────────────────── */}
      <div className="pricing-toolbar">
        <div className="search-box" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang === 'es' ? 'Buscar SKU o nombre…' : 'Search SKU or name…'}
            value={q} onChange={e => setQ(e.target.value)}
          />
        </div>

        {clientsWithPricing.length > 0 && (
          <div className="pricing-client-picker">
            <span className="caption" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'es' ? 'Precio por cliente:' : 'Client pricing:'}
            </span>
            <select
              className="select select-sm"
              value={selectedClient || ''}
              onChange={e => setSelectedClient(e.target.value || null)}
            >
              <option value="">
                — {lang === 'es' ? 'ninguno' : 'none'} —
              </option>
              {clientsWithPricing.map(c => (
                <option key={c.id} value={c.id}>
                  {c.flag || ''} {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isCeo && (
          <button
            type="button"
            className={`btn btn-sm ${showInternal ? 'btn-danger-soft' : 'btn-ghost'}`}
            onClick={() => setShowInternal(v => !v)}
            title={lang === 'es' ? 'Mostrar/ocultar costo interno' : 'Show/hide internal cost'}
          >
            <IconLock size={12}/>
            {showInternal
              ? (lang === 'es' ? 'Ocultar costo CEO' : 'Hide CEO cost')
              : (lang === 'es' ? 'Ver costo CEO' : 'Show CEO cost')}
          </button>
        )}

        <button type="button" className="btn btn-ghost btn-sm">
          <IconDownload size={12}/>
          {lang === 'es' ? 'Plantilla' : 'Template'}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onMassUpload && onMassUpload()}
        >
          <IconUpload size={12}/>
          {lang === 'es' ? 'Cargar precios (Excel)' : 'Upload prices (Excel)'}
        </button>
      </div>

      {/* ── KPIs de precio ────────────── */}
      <div className="pricing-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang === 'es' ? 'SKUs con precio' : 'Priced SKUs'}</div>
          <div className="k-value tabular-nums">{kpis.n}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang === 'es' ? 'Precio lista promedio' : 'Avg list price'}</div>
          <div className="k-value tabular-nums">{fmtMoneyDetail(kpis.avgList)}</div>
        </div>
        {showInternal && (
          <motion.div
            className="kpi-tile kpi-ceo"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="k-label">
              <IconLock size={10} style={{ marginRight: 4, verticalAlign:'-1px' }}/>
              {lang === 'es' ? 'Costo promedio MWT.ONE' : 'Avg MWT.ONE cost'}
            </div>
            <div className="k-value tabular-nums">{fmtMoneyDetail(kpis.avgCost)}</div>
            <div className="k-sub" style={{ color: 'var(--critical)' }}>CEO-ONLY</div>
          </motion.div>
        )}
        {showInternal && (
          <motion.div
            className="kpi-tile kpi-ceo"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="k-label">
              <IconLock size={10} style={{ marginRight: 4, verticalAlign:'-1px' }}/>
              {lang === 'es' ? 'Margen promedio global' : 'Avg global margin'}
            </div>
            <div className="k-value tabular-nums">{(kpis.avgMarginPct * 100).toFixed(1)}%</div>
            <div className="k-sub" style={{ color: 'var(--critical)' }}>CEO-ONLY</div>
          </motion.div>
        )}
      </div>

      {/* ── Tabla ───────────────────── */}
      <div className="card card-pad-0 pricing-table-wrap">
        <table className="table pricing-table">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>SKU</th>
              <th>{lang === 'es' ? 'Producto' : 'Product'}</th>
              <th style={{ textAlign: 'right', width: 130 }}>
                {lang === 'es' ? 'Precio de Lista' : 'List Price'}
              </th>
              <th style={{ textAlign: 'right', width: 160 }}>
                {lang === 'es' ? 'Precio Cliente' : 'Client Price'}
              </th>
              <AnimatePresence initial={false}>
                {showInternal && (
                  <motion.th
                    key="ceo-col"
                    className="th-ceo"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ textAlign: 'right', width: 150 }}
                  >
                    <span className="ceo-chip">
                      <IconLock size={10}/> CEO
                    </span>
                    <br/>
                    <span className="mono-sm" style={{ fontWeight: 500 }}>
                      {lang === 'es' ? 'Costo MWT.ONE' : 'MWT.ONE cost'}
                    </span>
                  </motion.th>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {showInternal && (
                  <motion.th
                    key="margin-col"
                    className="th-ceo"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ textAlign: 'right', width: 110 }}
                  >
                    <span className="ceo-chip">
                      <IconLock size={10}/> CEO
                    </span>
                    <br/>
                    <span className="mono-sm" style={{ fontWeight: 500 }}>
                      {lang === 'es' ? 'Margen' : 'Margin'}
                    </span>
                  </motion.th>
                )}
              </AnimatePresence>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const product = productsIx[r.sku];
              const clientOverride = selectedClient ? r.client_prices[selectedClient] : null;
              const effectivePrice = clientOverride ?? r.base_price;
              const discountPct = clientOverride != null
                ? ((r.base_price - clientOverride) / r.base_price)
                : 0;
              const marginPct = (r.base_price - r.internal_cost) / r.base_price;
              const marginBand =
                marginPct >= 0.55 ? 'ok' :
                marginPct >= 0.35 ? 'warning' : 'critical';

              return (
                <motion.tr
                  key={r.sku}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.02 } }}
                >
                  <td className="mono-sm">{r.sku}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{product?.nombre || '—'}</div>
                    {product && (
                      <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
                        {product.tipo_calzado} · {product.color} · {asText(product.normativa)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }} className="tabular-nums">
                    {fmtMoneyDetail(r.base_price)}
                  </td>
                  <td style={{ textAlign: 'right' }} className="tabular-nums">
                    {selectedClient ? (
                      clientOverride != null ? (
                        <span className="price-override">
                          <span>{fmtMoneyDetail(clientOverride)}</span>
                          {discountPct > 0 && (
                            <span className="discount-chip">
                              −{(discountPct * 100).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="price-neutral">
                          {fmtMoneyDetail(r.base_price)}
                          <span className="caption" style={{ color:'var(--text-tertiary)', marginLeft: 6 }}>
                            ({lang === 'es' ? 'lista' : 'list'})
                          </span>
                        </span>
                      )
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <AnimatePresence initial={false}>
                    {showInternal && (
                      <motion.td
                        key={`cost-${r.sku}`}
                        className="td-ceo"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ textAlign: 'right' }}
                      >
                        <span className="ceo-cost tabular-nums">
                          {fmtMoneyDetail(r.internal_cost)}
                        </span>
                      </motion.td>
                    )}
                  </AnimatePresence>
                  <AnimatePresence initial={false}>
                    {showInternal && (
                      <motion.td
                        key={`margin-${r.sku}`}
                        className="td-ceo"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ textAlign: 'right' }}
                      >
                        <span className={`margin-pill margin-${marginBand}`}>
                          {(marginPct * 100).toFixed(1)}%
                        </span>
                      </motion.td>
                    )}
                  </AnimatePresence>
                </motion.tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showInternal ? 6 : 4}
                    style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--text-tertiary)' }}>
                  <IconAlert size={14} style={{ verticalAlign: '-2px', marginRight: 6 }}/>
                  {lang === 'es' ? 'Sin resultados para la búsqueda.' : 'No results for your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer governance note ────────────── */}
      {showInternal && (
        <motion.div
          className="ceo-footnote"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <IconLock size={11}/>
          <span>
            {lang === 'es'
              ? 'Las columnas marcadas CEO son visibles sólo para el rol CEO. Nunca se indexan en pgvector ni se exponen al Portal B2B.'
              : 'CEO-marked columns are visible only to the CEO role. Never indexed in pgvector nor exposed in the B2B Portal.'}
          </span>
        </motion.div>
      )}
    </div>
  );
}
