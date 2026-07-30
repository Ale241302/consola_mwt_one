// ─────────────────────────────────────────────────────────────
// AnalisisCharts — Tab "Análisis" del Cronograma (React)
// Sprint 2026-06-13 · Agente responsable: [AG-03 FRONTEND]
//
// Gráficos dependency-free (SVG puro, sin librerías externas):
//   1. TALLAS  — pares por talla (apilado por SKU) o por SKU (apilado por
//                talla). Filtro de SKU en carrusel + nombre de producto +
//                tooltip por expediente + campana de Gauss de demanda.
//   2. SKU × MÉTODO — multi-selección de SKU (Todos / comparar varios):
//                pares, nº de expedientes y días por fase Aéreo vs Marítimo,
//                + campana de Gauss de tallas de los SKU elegidos.
//   3. USD → BRL — serie histórica (Frankfurter/ECB) con hover por punto +
//                medidor de hoy + campana de Gauss con hover por rango.
//
// R3 POL_VISIBILIDAD: vista Cliente → desglose por OC/PO y precio cliente;
// admin/CEO → proforma y precio MWT. R5: tabular-nums en toda métrica.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_STAGES, DISPLAY_STAGE_LABELS, itemPhaseDur } from "../../lib/cronogramaData.js";
import { techStagesFor } from "../../lib/phaseDisplay.js";
import { fxApi } from "../../lib/api.js";

const NAVY = "var(--brand-primary)";
const MINT = "#13B98A";
const fInt = (n) => Number(n || 0).toLocaleString("es-CR");
const fmt1 = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("en-US");
const fmt2 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const SKU_PALETTE = [
  "#013A57", "#075A78", "#0B7E8F", "#0FA3A0", "#13B98A",
  "#3C6E91", "#5A8FB0", "#2E8B7F", "#6FB3A6", "#94A7B8",
];
const colorForSku = (sku, list) => {
  const i = Math.max(0, list.indexOf(sku));
  return SKU_PALETTE[i % SKU_PALETTE.length];
};

const SIZE_SCALE = ["#CDE7E3", "#A9D6D0", "#7FC2BC", "#4FA8A6", "#2E8B8C", "#1C6E78", "#0B5063", "#013A57"];
const colorForSize = (size, sortedSizes) => {
  const i = sortedSizes.indexOf(size);
  if (i < 0 || sortedSizes.length <= 1) return "#0B7E8F";
  const t = i / (sortedSizes.length - 1);
  return SIZE_SCALE[Math.round(t * (SIZE_SCALE.length - 1))];
};

function textOn(bg) {
  const h = String(bg || "").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#0B1E3A" : "#fff";
}

const qtyOf = (l) => Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0;

function sortSizes(sizes) {
  return [...sizes].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    const aNum = !isNaN(na), bNum = !isNaN(nb);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    return String(a).localeCompare(String(b));
  });
}

function useSkuMeta(items) {
  return useMemo(() => {
    const s = new Set(); const nm = new Map();
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      if (!l.sku) return;
      s.add(l.sku);
      if (l.product_label && !nm.has(l.sku)) nm.set(l.sku, l.product_label);
    }));
    return { skuList: Array.from(s).sort((a, b) => a.localeCompare(b)), nameBySku: nm };
  }, [items]);
}

// ═══════════════════════════════════════════════════════════════
// Subtabs
// ═══════════════════════════════════════════════════════════════
const SUBTABS = [
  { id: "TALLAS", es: "Tallas", en: "Sizes" },
  { id: "METODO", es: "SKU × Método", en: "SKU × Mode" },
  { id: "FX", es: "USD → BRL", en: "USD → BRL" },
];

export default function AnalisisCharts({ items = [], lang = "es", isClient = false }) {
  const [sub, setSub] = useState("TALLAS");
  const es = lang === "es";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "inline-flex", gap: 2, background: "var(--surface-alt, #E8EDF3)", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
        {SUBTABS.map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)}
                  style={{
                    padding: "6px 16px", fontSize: 12.5, fontWeight: 700, border: "none", borderRadius: 8, cursor: "pointer",
                    background: sub === t.id ? "var(--surface-raised)" : "transparent",
                    color: sub === t.id ? "var(--text-primary)" : "var(--text-secondary, #475569)",
                    boxShadow: sub === t.id ? "0 1px 4px rgba(1,58,87,0.12)" : "none", transition: "all .18s ease",
                  }}>
            {es ? t.es : t.en}
          </button>
        ))}
      </div>
      {sub === "TALLAS" && <SizesChart items={items} lang={lang} isClient={isClient} />}
      {sub === "METODO" && <SkuMethodChart items={items} lang={lang} />}
      {sub === "FX" && <FxChart items={items} lang={lang} isClient={isClient} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Carrusel de filtro de SKU — "Todos" fijo afuera + chips en una sola
// línea desplazable con flechas ‹ ›.
// ═══════════════════════════════════════════════════════════════
function SkuCarousel({ skuList, selSkus, setSelSkus, nameOf, lang }) {
  const es = lang === "es";
  const ref = useRef(null);
  const toggle = (k) => setSelSkus((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const scroll = (dir) => { const el = ref.current; if (el) el.scrollBy({ left: dir * 280, behavior: "smooth" }); };
  if (skuList.length <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <button onClick={() => setSelSkus(new Set())} style={{ ...chipStyle(selSkus.size === 0, "#64748B"), flexShrink: 0 }}>
        {es ? "Todos los SKU" : "All SKUs"}
      </button>
      <button onClick={() => scroll(-1)} aria-label="prev" style={arrowStyle()}>
        <svg width="9" height="10" viewBox="0 0 10 10"><polyline points="6.5,2 3.5,5 6.5,8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div ref={ref} style={{ flex: 1, display: "flex", gap: 6, overflowX: "hidden", whiteSpace: "nowrap", padding: "2px 0", minWidth: 0 }}>
        {skuList.map((k) => (
          <button key={k} title={nameOf(k)} onClick={() => toggle(k)} style={{ ...chipStyle(selSkus.has(k), colorForSku(k, skuList)), flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colorForSku(k, skuList), display: "inline-block", marginRight: 6 }} />
            {k}
            {nameOf(k) && <span style={{ marginLeft: 5, fontWeight: 500, opacity: 0.8 }}>· {nameOf(k)}</span>}
          </button>
        ))}
      </div>
      <button onClick={() => scroll(1)} aria-label="next" style={arrowStyle()}>
        <svg width="9" height="10" viewBox="0 0 10 10"><polyline points="3.5,2 6.5,5 3.5,8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Campana de Gauss de TALLAS — distribución de pares por talla + curva
// normal ajustada (μ, σ en espacio de talla) y hover por barra.
// ═══════════════════════════════════════════════════════════════
function SizeGauss({ dist, lang, title }) {
  const es = lang === "es";
  const [hb, setHb] = useState(null);
  const data = (dist || []).filter((d) => d.pairs > 0);
  if (data.length < 2) return null;
  const n = data.length;
  const total = data.reduce((a, d) => a + d.pairs, 0) || 1;
  const maxP = Math.max(...data.map((d) => d.pairs));
  let mu = 0; data.forEach((d, i) => { mu += i * d.pairs; }); mu /= total;
  let varr = 0; data.forEach((d, i) => { varr += d.pairs * (i - mu) * (i - mu); }); varr /= total;
  const sigma = Math.sqrt(varr) || 1e-6;
  const muSize = data[Math.max(0, Math.min(n - 1, Math.round(mu)))].size;

  const W = 720, H = 210, padL = 30, padR = 12, padT = 16, padB = 26;
  const bw = (W - padL - padR) / n;
  const xPix = (x) => padL + (x + 0.5) * bw;
  const yP = (p) => padT + (1 - p / maxP) * (H - padT - padB);
  const normal = (x) => Math.exp(-0.5 * ((x - mu) / sigma) * ((x - mu) / sigma));
  const peak = normal(mu) || 1;
  const curve = [];
  const STEPS = 120;
  for (let s = 0; s <= STEPS; s++) {
    const x = (s / STEPS) * (n - 1);
    const yy = padT + (1 - normal(x) / peak) * (H - padT - padB);
    curve.push(`${xPix(x).toFixed(1)},${yy.toFixed(1)}`);
  }
  const labelStep = Math.ceil(n / 16);

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary, #475569)", marginBottom: 2 }}>
        {title || (es ? "Curva de demanda por talla (campana de Gauss)" : "Size demand curve (Gaussian bell)")}
      </div>
      <p className="caption" style={{ margin: "0 0 6px", color: "var(--text-tertiary, #94A3B8)" }}>
        {es
          ? <>Talla central <b>μ ≈ {muSize}</b> · dispersión <b className="tabular-nums">σ ≈ {fmt1(sigma)}</b> tallas. Pasa el cursor por una barra para ver pares y %.</>
          : <>Center size <b>μ ≈ {muSize}</b> · spread <b className="tabular-nums">σ ≈ {fmt1(sigma)}</b> sizes. Hover a bar for pairs and %.</>}
      </p>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
          {data.map((d, i) => {
            const yTop = yP(d.pairs);
            const x0 = padL + i * bw;
            return (
              <g key={d.size}>
                <rect x={x0 + 1.5} y={yTop} width={Math.max(1, bw - 3)} height={(H - padB) - yTop} rx="2"
                      fill={colorForSize(d.size, data.map((x) => x.size))} opacity="0.9" />
                <rect x={x0} y={padT} width={bw} height={(H - padB) - padT} fill="transparent"
                      onMouseMove={(e) => setHb({ d, pct: Math.round((d.pairs / total) * 100), cx: e.clientX, cy: e.clientY })}
                      onMouseLeave={() => setHb(null)} style={{ cursor: "pointer" }} />
                {(i % labelStep === 0) && (
                  <text x={xPix(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#94A3B8" className="tabular-nums" pointerEvents="none">{d.size}</text>
                )}
              </g>
            );
          })}
          <polyline points={curve.join(" ")} fill="none" stroke={NAVY} strokeWidth="2.4" strokeLinejoin="round" pointerEvents="none" />
          <line x1={xPix(mu)} y1={padT} x2={xPix(mu)} y2={H - padB} stroke={MINT} strokeWidth="1.6" strokeDasharray="4 3" pointerEvents="none" />
          <text x={xPix(mu)} y={padT - 3} textAnchor="middle" fontSize="10" fill={MINT} fontWeight="800" pointerEvents="none">μ</text>
        </svg>
        {hb && (
          <div style={{
            position: "fixed", left: Math.min(hb.cx + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 170),
            top: hb.cy + 14, zIndex: 1500, pointerEvents: "none",
            background: "var(--surface-raised, #fff)", border: "1px solid var(--border-subtle, #E1E6ED)",
            borderRadius: 8, boxShadow: "0 10px 24px rgba(11,30,58,0.2)", padding: "7px 10px",
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)" }}>{es ? "Talla" : "Size"} {hb.d.size}</div>
            <div className="tabular-nums caption" style={{ color: "var(--text-secondary, #475569)" }}>
              {fInt(hb.d.pairs)} {es ? "pares" : "pairs"} · {hb.pct}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1 · TALLAS
// ═══════════════════════════════════════════════════════════════
function SizesChart({ items, lang, isClient = false }) {
  const es = lang === "es";
  const [orient, setOrient] = useState("SIZE");
  const [selSkus, setSelSkus] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const { skuList, nameBySku } = useSkuMeta(items);
  const nameOf = (k) => nameBySku.get(k) || "";

  const labelOf = (it) => {
    if (!isClient) return it.proforma || it.expCodigo || "—";
    if (!it.ocCodigo) return it.expCodigo || "—";
    return String(it.ocCodigo).toUpperCase().startsWith("PO") ? it.ocCodigo : `PO ${it.ocCodigo}`;
  };

  const activeSkus = useMemo(
    () => (selSkus.size ? skuList.filter((k) => selSkus.has(k)) : skuList),
    [skuList, selSkus]
  );

  const { sizes, sizeMap, totalsBySize, totalGeneral, skuMap, totalsBySku, skuOrder } = useMemo(() => {
    const sizeMap = new Map(); const skuMap = new Map();
    items.forEach((it) => {
      const lbl = labelOf(it);
      (it.lineas || []).forEach((l) => {
        if (!l.sku || (selSkus.size && !selSkus.has(l.sku))) return;
        const size = (l.size && String(l.size).trim()) || (es ? "s/talla" : "no size");
        const q = qtyOf(l);
        if (!q) return;
        const sm = sizeMap.get(size) || sizeMap.set(size, new Map()).get(size);
        const c1 = sm.get(l.sku) || sm.set(l.sku, { value: 0, byExp: new Map() }).get(l.sku);
        c1.value += q; c1.byExp.set(lbl, (c1.byExp.get(lbl) || 0) + q);
        const km = skuMap.get(l.sku) || skuMap.set(l.sku, new Map()).get(l.sku);
        const c2 = km.get(size) || km.set(size, { value: 0, byExp: new Map() }).get(size);
        c2.value += q; c2.byExp.set(lbl, (c2.byExp.get(lbl) || 0) + q);
      });
    });
    const sizes = sortSizes(Array.from(sizeMap.keys()));
    const totalsBySize = new Map(); let totalGeneral = 0;
    sizes.forEach((s) => { let t = 0; sizeMap.get(s).forEach((c) => { t += c.value; }); totalsBySize.set(s, t); totalGeneral += t; });
    const totalsBySku = new Map();
    skuMap.forEach((m, k) => { let t = 0; m.forEach((c) => { t += c.value; }); totalsBySku.set(k, t); });
    const skuOrder = Array.from(skuMap.keys()).sort((a, b) => (totalsBySku.get(b) || 0) - (totalsBySku.get(a) || 0));
    return { sizes, sizeMap, totalsBySize, totalGeneral, skuMap, totalsBySku, skuOrder };
  }, [items, selSkus, es, isClient]);

  const maxBar = orient === "SIZE"
    ? Math.max(1, ...sizes.map((s) => totalsBySize.get(s) || 0))
    : Math.max(1, ...skuOrder.map((k) => totalsBySku.get(k) || 0));
  const hasData = totalGeneral > 0;
  const gaussDist = sizes.map((s) => ({ size: s, pairs: totalsBySize.get(s) || 0 }));

  const mkMeta = (sku, size, cell) => ({
    sku, name: nameOf(sku), size, value: cell.value,
    byExp: Array.from(cell.byExp.entries()).map(([label, pairs]) => ({ label, pairs })).sort((a, b) => b.pairs - a.pairs),
  });
  const onHover = (meta, e) => { if (!meta) { setHover(null); return; } setHover({ meta, x: e.clientX, y: e.clientY }); };

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{es ? "PARES PEDIDOS POR TALLA" : "PAIRS ORDERED BY SIZE"}</h4>
        <span className="caption tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
          {fInt(totalGeneral)} {es ? "pares" : "pairs"} · {activeSkus.length} SKU{activeSkus.length === 1 ? "" : "s"}
        </span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[{ id: "SIZE", es: "Por talla", en: "By size" }, { id: "SKU", es: "Por SKU", en: "By SKU" }].map((o) => (
            <button key={o.id} onClick={() => setOrient(o.id)} style={pillStyle(orient === o.id)}>{es ? o.es : o.en}</button>
          ))}
        </div>
      </div>

      <p className="caption" style={{ margin: "0 0 12px", color: "var(--text-tertiary, #94A3B8)", maxWidth: 780, lineHeight: 1.4 }}>
        {orient === "SIZE"
          ? (es
              ? `Cada fila es una talla; los colores son los SKUs que la componen y el número de la derecha es el total de pares. Pasa el cursor por un segmento para ver el producto y en qué ${isClient ? "OC/PO" : "proformas"} están esos pares.`
              : `Each row is a size; colors are the SKUs that make it up. Hover a segment for the product and which ${isClient ? "POs" : "proformas"} the pairs are in.`)
          : (es
              ? `Cada fila es un SKU (con su nombre); los segmentos son sus tallas, de la más chica (claro) a la más grande (oscuro). Pasa el cursor por un segmento para ver talla, pares y en qué ${isClient ? "OC/PO" : "proformas"} están.`
              : `Each row is a SKU; segments are its sizes from small (light) to large (dark). Hover for size, pairs and which ${isClient ? "POs" : "proformas"}.`)}
      </p>

      <SkuCarousel skuList={skuList} selSkus={selSkus} setSelSkus={setSelSkus} nameOf={nameOf} lang={lang} />

      {!hasData ? (
        <EmptyState lang={lang} />
      ) : orient === "SIZE" ? (
        <StackedBars
          labelWidth={46}
          rows={sizes.map((s) => ({
            key: s, label: s, total: totalsBySize.get(s) || 0,
            segments: activeSkus.map((k) => {
              const cell = sizeMap.get(s).get(k);
              if (!cell) return null;
              return { key: k, value: cell.value, color: colorForSku(k, skuList), meta: mkMeta(k, s, cell) };
            }).filter(Boolean),
          }))}
          max={maxBar} lang={lang} onHover={onHover}
        />
      ) : (
        <StackedBars
          labelWidth={132}
          rows={skuOrder.map((k) => ({
            key: k, total: totalsBySku.get(k) || 0,
            labelNode: (
              <div style={{ lineHeight: 1.15, overflow: "hidden" }}>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, fontSize: 11.5, color: "var(--text-primary)" }}>{k}</div>
                {nameOf(k) && <div title={nameOf(k)} style={{ fontSize: 9.5, color: "var(--text-tertiary, #94A3B8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(k)}</div>}
              </div>
            ),
            segments: sortSizes(Array.from(skuMap.get(k).keys())).map((s) => {
              const cell = skuMap.get(k).get(s);
              return { key: s, label: s, value: cell.value, color: colorForSize(s, sizes), meta: mkMeta(k, s, cell) };
            }),
          }))}
          max={maxBar} lang={lang} showSegLabels onHover={onHover}
        />
      )}

      {hasData && orient === "SKU" && sizes.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <span className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{es ? "Talla" : "Size"}</span>
          <span className="caption tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>{sizes[0]}</span>
          <div style={{ height: 10, width: 180, borderRadius: 6, background: `linear-gradient(90deg, ${colorForSize(sizes[0], sizes)}, ${colorForSize(sizes[sizes.length - 1], sizes)})` }} />
          <span className="caption tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>{sizes[sizes.length - 1]}</span>
        </div>
      )}

      {hasData && <SizeGauss dist={gaussDist} lang={lang} />}

      {hover && (
        <div style={{
          position: "fixed", left: Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 286),
          top: hover.y + 14, zIndex: 1500, pointerEvents: "none", width: 264,
          background: "var(--surface-raised, #fff)", border: "1px solid var(--border-subtle, #E1E6ED)",
          borderRadius: 10, boxShadow: "0 12px 30px rgba(11,30,58,0.22)", padding: "10px 12px",
        }}>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 800, color: "var(--text-primary)", fontSize: 12.5 }}>{hover.meta.sku}</div>
          {hover.meta.name && <div style={{ fontSize: 11, color: "var(--text-secondary, #475569)", marginBottom: 5 }}>{hover.meta.name}</div>}
          <div style={{ fontSize: 11.5, color: "var(--text-primary, #0B1E3A)", marginBottom: 7 }}>
            {es ? "Talla" : "Size"} <b>{hover.meta.size}</b>{" · "}<b className="tabular-nums">{fInt(hover.meta.value)}</b> {es ? "pares" : "pairs"}
          </div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: "var(--text-tertiary, #94A3B8)", marginBottom: 4 }}>
            {(isClient ? (es ? "EN OC / PO" : "IN PO") : (es ? "EN PROFORMA" : "IN PROFORMA"))}{" · "}{hover.meta.byExp.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 168, overflowY: "auto" }}>
            {hover.meta.byExp.map((x, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11 }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary, #475569)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.label}</span>
                <span className="tabular-nums" style={{ fontWeight: 800, color: "var(--text-primary)", flexShrink: 0 }}>{fInt(x.pairs)}<span style={{ fontWeight: 500, color: "var(--text-tertiary, #94A3B8)" }}> prs</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StackedBars({ rows, max, lang, showSegLabels = false, labelWidth = 64, onHover }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: labelWidth, textAlign: r.labelNode ? "left" : "right", flexShrink: 0,
            fontSize: 12, fontWeight: 700, color: "var(--text-primary, #0B1E3A)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }} title={r.labelNode ? undefined : r.label}>
            {r.labelNode || r.label}
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", height: 22, background: "var(--surface-alt, #F1F5F9)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "flex", width: `${(r.total / max) * 100}%`, height: "100%", minWidth: 2, transition: "width .3s ease" }}>
              {r.segments.map((seg, i) => (
                <div key={seg.key + i}
                     onMouseEnter={(e) => onHover && onHover(seg.meta, e)}
                     onMouseMove={(e) => onHover && onHover(seg.meta, e)}
                     onMouseLeave={() => onHover && onHover(null)}
                     style={{
                       width: `${(seg.value / r.total) * 100}%`, height: "100%", background: seg.color,
                       borderRight: r.segments.length > 1 ? "1px solid rgba(255,255,255,0.55)" : "none",
                       display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer",
                     }}>
                  {showSegLabels && (seg.value / max) > 0.045 && (
                    <span className="tabular-nums" style={{ fontSize: 9.5, color: textOn(seg.color), fontWeight: 700 }}>{seg.label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="tabular-nums" style={{ width: 60, textAlign: "right", flexShrink: 0, fontSize: 12, fontWeight: 800, color: "var(--text-primary)" }}>{fInt(r.total)}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2 · SKU × MÉTODO
// ═══════════════════════════════════════════════════════════════
const MODES = [
  { key: "Aereo", es: "Aéreo", en: "Air", color: NAVY },
  { key: "Maritimo", es: "Marítimo", en: "Sea", color: "#0FA3A0" },
];

function SkuMethodChart({ items, lang }) {
  const es = lang === "es";
  const { skuList, nameBySku } = useSkuMeta(items);
  const nameOf = (k) => nameBySku.get(k) || "";
  const [selSkus, setSelSkus] = useState(() => new Set());
  const activeSet = useMemo(() => (selSkus.size ? selSkus : new Set(skuList)), [selSkus, skuList]);

  const fases = DISPLAY_STAGES.slice(0, 5);
  const L = DISPLAY_STAGE_LABELS[lang] || DISPLAY_STAGE_LABELS.es;

  const byMode = useMemo(() => {
    const out = {};
    MODES.forEach((m) => { out[m.key] = { items: [], pares: 0, phases: {} }; });
    items.forEach((it) => {
      const has = (it.skus || []).some((k) => activeSet.has(k));
      if (!has) return;
      const mk = it.modo === "Maritimo" ? "Maritimo" : "Aereo";
      const b = out[mk];
      b.items.push(it);
      b.pares += (it.lineas || []).filter((l) => activeSet.has(l.sku)).reduce((a, l) => a + qtyOf(l), 0);
      fases.forEach((s) => {
        techStagesFor(s).forEach((ts) => {
          const d = itemPhaseDur(it, ts);
          if (d) (b.phases[s] || (b.phases[s] = [])).push(d.days);
        });
      });
    });
    MODES.forEach((m) => {
      const b = out[m.key]; b.avg = {};
      fases.forEach((s) => { const arr = b.phases[s] || []; b.avg[s] = arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null; });
      b.ciclo = fases.reduce((a, s) => a + (b.avg[s] || 0), 0);
    });
    return out;
  }, [items, activeSet]);

  const sizeDist = useMemo(() => {
    const m = new Map();
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      if (!l.sku || !activeSet.has(l.sku)) return;
      const size = (l.size && String(l.size).trim()) || (es ? "s/talla" : "no size");
      const q = qtyOf(l); if (!q) return;
      m.set(size, (m.get(size) || 0) + q);
    }));
    return sortSizes(Array.from(m.keys())).map((s) => ({ size: s, pairs: m.get(s) }));
  }, [items, activeSet, es]);

  const maxPhase = Math.max(1, ...fases.flatMap((s) => MODES.map((m) => byMode[m.key].avg[s] || 0)));
  const anyData = MODES.some((m) => byMode[m.key].items.length);
  const onlyOne = (selSkus.size === 1) ? Array.from(selSkus)[0] : null;

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{es ? "COMPORTAMIENTO POR MÉTODO DE ENVÍO" : "BEHAVIOR BY SHIPPING MODE"}</h4>
        <span className="caption" style={{ color: "var(--text-secondary, #475569)" }}>
          {selSkus.size === 0 ? (es ? `Todos los SKU (${skuList.length})` : `All SKUs (${skuList.length})`)
            : (onlyOne ? `${onlyOne}${nameOf(onlyOne) ? " · " + nameOf(onlyOne) : ""}` : `${selSkus.size} SKU`)}
        </span>
      </div>

      <p className="caption" style={{ margin: "0 0 12px", color: "var(--text-tertiary, #94A3B8)", maxWidth: 780, lineHeight: 1.4 }}>
        {es
          ? "Compara los expedientes que contienen los SKU seleccionados según su método de envío. El bucket Aéreo incluye los expedientes sin método aún definido (aéreo supuesto). Elegí varios SKU para sumarlos, o dejá «Todos»."
          : "Compares files containing the selected SKUs by shipping mode. The Air bucket includes files with no defined mode yet (assumed air). Pick several SKUs to combine, or keep \"All\"."}
      </p>

      <SkuCarousel skuList={skuList} selSkus={selSkus} setSelSkus={setSelSkus} nameOf={nameOf} lang={lang} />

      {!anyData ? (
        <EmptyState lang={lang} text={es ? "Ningún expediente filtrado contiene los SKU seleccionados." : "No filtered file contains the selected SKUs."} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
            {MODES.map((m) => {
              const b = byMode[m.key];
              return (
                <div key={m.key} style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderLeft: `4px solid ${m.color}`, borderRadius: 10, padding: "10px 12px", background: "var(--surface-alt, #FBFCFE)" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: m.color, marginBottom: 6 }}>
                    {(es ? m.es : m.en).toUpperCase()}{m.key === "Aereo" ? (es ? " (incl. supuesto)" : " (incl. assumed)") : ""}
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <Metric label={es ? "Pares" : "Pairs"} value={fInt(b.pares)} />
                    <Metric label={es ? "Exp." : "Files"} value={fInt(b.items.length)} />
                    <Metric label={es ? "Ciclo" : "Cycle"} value={b.ciclo ? `${Math.round(b.ciclo)}d` : "—"} accent />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary, #475569)", marginBottom: 8 }}>
            {es ? "Días promedio por fase (historial real)" : "Average days per phase (real history)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {fases.map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 84, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: "var(--text-primary, #0B1E3A)" }}>{L[s]}</div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  {MODES.map((m) => {
                    const v = byMode[m.key].avg[s];
                    return (
                      <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 6, height: 13 }}>
                        <div style={{ flex: 1, height: "100%", background: "var(--surface-alt, #F1F5F9)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${((v || 0) / maxPhase) * 100}%`, height: "100%", background: m.color, minWidth: v ? 2 : 0, borderRadius: 4, transition: "width .3s ease" }} />
                        </div>
                        <div className="tabular-nums" style={{ width: 40, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: v ? m.color : "var(--text-tertiary, #CBD5E1)" }}>{v ? `${fmt1(v)}d` : "—"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
            {MODES.map((m) => (
              <span key={m.key} className="caption" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary, #475569)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />{es ? m.es : m.en}
              </span>
            ))}
          </div>

          <SizeGauss dist={sizeDist} lang={lang} title={es ? "Tallas pedidas de los SKU seleccionados (campana de Gauss)" : "Sizes ordered for selected SKUs (Gaussian bell)"} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <div className="tabular-nums" style={{ fontSize: 17, fontWeight: 800, color: accent ? MINT : "var(--text-primary)", lineHeight: 1.1 }}>{value}</div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 3 · USD → BRL
// ═══════════════════════════════════════════════════════════════
function FxChart({ items, lang, isClient }) {
  const es = lang === "es";
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const ranges = [{ days: 90, label: "90d" }, { days: 365, label: es ? "1 año" : "1y" }];

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fxApi.usdBrlHistory(days)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e?.message || "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const carteraUsd = useMemo(() => {
    let t = 0;
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      const price = isClient ? Number(l.unit_price_client) || 0 : (Number(l.unit_price_mwt) || Number(l.unit_price_client) || 0);
      t += qtyOf(l) * price;
    }));
    return t;
  }, [items, isClient]);

  const series = (data && data.series) || [];
  const stats = data && data.stats;
  const lastRate = stats ? stats.last : null;

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{es ? "DÓLAR → REAL (USD/BRL)" : "USD → BRL"}</h4>
        <span className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{data && data.source ? data.source : "Frankfurter (ECB)"}</span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {ranges.map((r) => (<button key={r.days} onClick={() => setDays(r.days)} style={pillStyle(days === r.days)}>{r.label}</button>))}
        </div>
      </div>

      {loading ? (
        <div className="caption" style={{ padding: 30, textAlign: "center", color: "var(--text-tertiary)" }}>{es ? "Cargando serie histórica…" : "Loading history…"}</div>
      ) : err || !series.length ? (
        <EmptyState lang={lang} text={es ? "No se pudo cargar la serie USD/BRL." : "Could not load USD/BRL series."} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
            <Gauge stats={stats} lang={lang} />
            <FxStat label={es ? "Mín · Máx" : "Min · Max"} value={`${fmt2(stats.min)} – ${fmt2(stats.max)}`} />
            <FxStat label={es ? "Promedio" : "Average"} value={`R$ ${fmt4(stats.avg)}`} />
            <FxStat label={es ? "Desv. est. (σ)" : "Std dev (σ)"} value={fmt4(stats.std)} />
            <FxStat label={es ? "Cartera visible → BRL" : "Visible book → BRL"} value={lastRate ? `R$ ${fInt(Math.round(carteraUsd * lastRate))}` : "—"} sub={`$ ${fInt(Math.round(carteraUsd))} USD`} />
          </div>
          <FxLine series={series} stats={stats} lang={lang} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary, #475569)", margin: "18px 0 4px" }}>{es ? "Distribución de la cotización (campana de Gauss)" : "Rate distribution (Gaussian bell)"}</div>
          <p className="caption" style={{ margin: "0 0 8px", color: "var(--text-tertiary, #94A3B8)", maxWidth: 780, lineHeight: 1.4 }}>
            {es ? "Cada barra cuenta cuántos días la cotización cayó en ese rango de precio; la curva es la normal teórica con el promedio (μ) y la desviación (±σ). Pasa el cursor por una barra para ver el rango y los días."
                : "Each bar counts how many days the rate fell in that price range; the curve is the theoretical normal with mean (μ) and deviation (±σ). Hover a bar for its range and day count."}
          </p>
          <FxGauss series={series} stats={stats} lang={lang} />
        </>
      )}
    </div>
  );
}

function FxStat({ label, value, sub }) {
  return (
    <div style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 10, padding: "9px 11px", background: "var(--surface-alt, #FBFCFE)" }}>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{value}</div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
      {sub && <div className="caption tabular-nums" style={{ color: "var(--text-tertiary, #CBD5E1)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Gauge({ stats, lang }) {
  const es = lang === "es";
  const { min, max, last } = stats;
  const span = max - min || 1;
  const frac = Math.max(0, Math.min(1, (last - min) / span));
  const R = 34, cx = 44, cy = 42;
  const ang = Math.PI + (0 - Math.PI) * frac;
  const px = cx + R * Math.cos(ang), py = cy + R * Math.sin(ang) * -1;
  const arc = (from, to, color, w) => {
    const x0 = cx + R * Math.cos(from), y0 = cy - R * Math.sin(from);
    const x1 = cx + R * Math.cos(to), y1 = cy - R * Math.sin(to);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return <path d={`M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <div style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 10, padding: "8px 11px", background: "linear-gradient(180deg, rgba(1,58,87,0.04), transparent)" }}>
      <svg viewBox="0 0 88 52" width="100%" height="46" style={{ display: "block" }}>
        {arc(Math.PI, 0, "var(--surface-alt, #E2E8F0)", 6)}
        {arc(Math.PI, Math.PI + (0 - Math.PI) * frac, MINT, 6)}
        <line x1={cx} y1={cy} x2={px} y2={py} stroke={NAVY} strokeWidth={2.2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill={NAVY} />
      </svg>
      <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", textAlign: "center", lineHeight: 1 }}>R$ {fmt4(last)}</div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)", textAlign: "center" }}>{es ? "Hoy · por US$1" : "Today · per US$1"}</div>
    </div>
  );
}

function FxLine({ series, stats, lang }) {
  const es = lang === "es";
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);
  const W = 720, H = 200, padL = 46, padR = 12, padT = 14, padB = 24;
  const min = stats.min, max = stats.max, span = (max - min) || 1;
  const n = series.length;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const areaPts = `${padL},${H - padB} ${linePts} ${x(n - 1)},${H - padB}`;
  const gridVals = [min, min + span / 2, max];
  const tickIdx = [];
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) tickIdx.push(i);
  if (tickIdx[tickIdx.length - 1] !== n - 1) tickIdx.push(n - 1);
  const fmtDate = (s) => String(s).slice(5).replace("-", "/");

  const onMove = (e) => {
    const el = svgRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    let i = Math.round(((ratio * W) - padL) / (W - padL - padR) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHi({ i, cx: e.clientX, cy: e.clientY });
  };

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id="fxgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MINT} stopOpacity="0.28" />
            <stop offset="100%" stopColor={MINT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} stroke="var(--border-subtle, #E2E8F0)" strokeWidth="1" strokeDasharray={i === 1 ? "3 3" : "0"} />
            <text x={padL - 6} y={y(gv) + 3} textAnchor="end" fontSize="10" fill="#94A3B8" className="tabular-nums">{fmt2(gv)}</text>
          </g>
        ))}
        <polygon points={areaPts} fill="url(#fxgrad)" />
        <polyline points={linePts} fill="none" stroke={NAVY} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hi && (
          <g>
            <line x1={x(hi.i)} y1={padT} x2={x(hi.i)} y2={H - padB} stroke={NAVY} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            <circle cx={x(hi.i)} cy={y(series[hi.i].rate)} r="4" fill={NAVY} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}
        <circle cx={x(n - 1)} cy={y(series[n - 1].rate)} r="3.5" fill={MINT} stroke="#fff" strokeWidth="1.5" />
        {tickIdx.map((i) => (<text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#94A3B8" className="tabular-nums">{fmtDate(series[i].date)}</text>))}
      </svg>
      {hi && (
        <div style={{
          position: "fixed", left: Math.min(hi.cx + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 180),
          top: hi.cy + 14, zIndex: 1500, pointerEvents: "none",
          background: "var(--surface-raised, #fff)", border: "1px solid var(--border-subtle, #E1E6ED)",
          borderRadius: 8, boxShadow: "0 10px 24px rgba(11,30,58,0.2)", padding: "7px 10px",
        }}>
          <div className="tabular-nums" style={{ fontSize: 11, color: "var(--text-secondary, #475569)" }}>{series[hi.i].date}</div>
          <div className="tabular-nums" style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>R$ {fmt4(series[hi.i].rate)}</div>
          <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{es ? "por US$1" : "per US$1"}</div>
        </div>
      )}
    </div>
  );
}

function FxGauss({ series, stats, lang }) {
  const es = lang === "es";
  const [hb, setHb] = useState(null);
  const vals = series.map((p) => p.rate);
  const { avg: mu, std: sigma, min, max } = stats;
  const W = 720, H = 180, padL = 30, padR = 12, padT = 10, padB = 22;
  const lo = min, hi = max, span = (hi - lo) || 1;
  const BINS = Math.min(24, Math.max(8, Math.round(Math.sqrt(vals.length))));
  const counts = new Array(BINS).fill(0);
  vals.forEach((v) => { let b = Math.floor(((v - lo) / span) * BINS); if (b >= BINS) b = BINS - 1; if (b < 0) b = 0; counts[b]++; });
  const total = vals.length || 1;
  const maxCount = Math.max(1, ...counts);
  const bw = (W - padL - padR) / BINS;
  const xVal = (v) => padL + ((v - lo) / span) * (W - padL - padR);
  const yCount = (c) => padT + (1 - c / maxCount) * (H - padT - padB);
  const normal = (v) => Math.exp(-0.5 * Math.pow((v - mu) / (sigma || 1e-6), 2));
  const peakN = normal(mu) || 1;
  const curve = [];
  for (let i = 0; i <= 80; i++) { const v = lo + (span * i) / 80; const yy = padT + (1 - normal(v) / peakN) * (H - padT - padB); curve.push(`${xVal(v).toFixed(1)},${yy.toFixed(1)}`); }

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        {counts.map((c, i) => {
          const x0 = padL + i * bw;
          const binLo = lo + (i / BINS) * span, binHi = lo + ((i + 1) / BINS) * span;
          return (
            <rect key={i} x={x0 + 1} y={padT} width={Math.max(1, bw - 2)} height={(H - padB) - padT} fill="transparent"
                  onMouseMove={(e) => setHb({ binLo, binHi, c, cx: e.clientX, cy: e.clientY })} onMouseLeave={() => setHb(null)} style={{ cursor: "pointer" }} />
          );
        })}
        {counts.map((c, i) => { const x0 = padL + i * bw; const yTop = yCount(c); return <rect key={`b${i}`} x={x0 + 1} y={yTop} width={Math.max(1, bw - 2)} height={(H - padB) - yTop} rx="2" fill={NAVY} opacity="0.18" pointerEvents="none" />; })}
        <polyline points={curve.join(" ")} fill="none" stroke={MINT} strokeWidth="2.4" strokeLinejoin="round" pointerEvents="none" />
        {[{ v: mu, c: NAVY, dash: "0", lbl: "μ" }, { v: mu - sigma, c: "#94A3B8", dash: "4 3", lbl: "−σ" }, { v: mu + sigma, c: "#94A3B8", dash: "4 3", lbl: "+σ" }].filter((m) => m.v >= lo && m.v <= hi).map((m, i) => (
          <g key={i} pointerEvents="none">
            <line x1={xVal(m.v)} y1={padT} x2={xVal(m.v)} y2={H - padB} stroke={m.c} strokeWidth="1.3" strokeDasharray={m.dash} />
            <text x={xVal(m.v)} y={padT - 1} textAnchor="middle" fontSize="10" fill={m.c} fontWeight="700">{m.lbl}</text>
          </g>
        ))}
        {[lo, mu, hi].map((v, i) => (<text key={i} x={xVal(v)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="9.5" fill="#94A3B8" className="tabular-nums" pointerEvents="none">{fmt2(v)}</text>))}
      </svg>
      {hb && (
        <div style={{
          position: "fixed", left: Math.min(hb.cx + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 190),
          top: hb.cy + 14, zIndex: 1500, pointerEvents: "none",
          background: "var(--surface-raised, #fff)", border: "1px solid var(--border-subtle, #E1E6ED)",
          borderRadius: 8, boxShadow: "0 10px 24px rgba(11,30,58,0.2)", padding: "7px 10px",
        }}>
          <div className="tabular-nums" style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)" }}>R$ {fmt2(hb.binLo)} – {fmt2(hb.binHi)}</div>
          <div className="tabular-nums caption" style={{ color: "var(--text-secondary, #475569)" }}>{fInt(hb.c)} {es ? "días" : "days"} · {Math.round((hb.c / total) * 100)}%</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers de estilo / estados
// ═══════════════════════════════════════════════════════════════
function pillStyle(active) {
  return {
    padding: "3px 13px", fontSize: 11.5, fontWeight: 700, borderRadius: 999,
    border: active ? `1.5px solid ${NAVY}` : "1.5px solid var(--border-subtle, #E1E6ED)",
    background: active ? NAVY : "transparent", color: active ? "#fff" : "var(--text-secondary, #475569)", cursor: "pointer",
  };
}
function chipStyle(active, color) {
  return {
    display: "inline-flex", alignItems: "center", padding: "3px 11px", fontSize: 11, fontWeight: 700, borderRadius: 999,
    border: `1.5px solid ${active ? color : "var(--border-subtle, #E1E6ED)"}`,
    background: active ? `${color}14` : "transparent", color: active ? color : "var(--text-secondary, #475569)",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
  };
}
function arrowStyle() {
  return {
    flexShrink: 0, width: 26, height: 26, borderRadius: 999, border: "1.5px solid var(--border-subtle, #E1E6ED)",
    background: "var(--surface, #fff)", color: "var(--text-primary)", cursor: "pointer", fontSize: 16, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}
function EmptyState({ lang, text }) {
  const es = lang === "es";
  return (<div className="caption" style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>{text || (es ? "Sin datos para los filtros actuales." : "No data for current filters.")}</div>);
}
