// ─────────────────────────────────────────────────────────────
// AnalisisCharts — Tab "Análisis" del Cronograma (React)
// Sprint 2026-06-13 · Agente responsable: [AG-03 FRONTEND]
//
// Gráficos dependency-free (SVG puro, sin librerías externas — coherente
// con GanttChart) sobre el dataset ya cargado de /cronograma:
//   1. TALLAS  — pares pedidos por talla, desglose por SKU (apilado) o
//                invertido (por SKU, sus tallas). Filtro de SKU.
//   2. SKU × MÉTODO — comporta de UN SKU en Aéreo vs Marítimo: pares
//                totales, nº de expedientes y días promedio por fase.
//   3. USD → BRL — serie histórica (Frankfurter/ECB) en línea/área +
//                medidor de hoy + campana de Gauss (histograma + normal).
//
// R3 POL_VISIBILIDAD: en vista Cliente la cartera USD usa precio cliente;
// admin/CEO usa precio MWT. R5: tabular-nums en toda métrica.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import { STAGES, STAGE_LABELS, STAGE_COLORS, itemPhaseDur } from "../../lib/cronogramaData.js";
import { fxApi } from "../../lib/api.js";

const NAVY = "#013A57";
const MINT = "#13B98A";
const fInt = (n) => Number(n || 0).toLocaleString("es-CR");
const fmt1 = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("en-US");
const fmt2 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

// Paleta cualitativa para SKUs (navy → teal → mint, marca MWT).
const SKU_PALETTE = [
  "#013A57", "#075A78", "#0B7E8F", "#0FA3A0", "#13B98A",
  "#3C6E91", "#5A8FB0", "#2E8B7F", "#6FB3A6", "#94A7B8",
];
const colorForSku = (sku, list) => {
  const i = Math.max(0, list.indexOf(sku));
  return SKU_PALETTE[i % SKU_PALETTE.length];
};

const qtyOf = (l) => Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0;

// Orden natural de tallas: numéricas primero (asc), luego alfabéticas.
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

// ═══════════════════════════════════════════════════════════════
// Subtabs internos
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
                    padding: "6px 16px", fontSize: 12.5, fontWeight: 700,
                    border: "none", borderRadius: 8, cursor: "pointer",
                    background: sub === t.id ? "#fff" : "transparent",
                    color: sub === t.id ? NAVY : "var(--text-secondary, #475569)",
                    boxShadow: sub === t.id ? "0 1px 4px rgba(1,58,87,0.12)" : "none",
                    transition: "all .18s ease",
                  }}>
            {es ? t.es : t.en}
          </button>
        ))}
      </div>

      {sub === "TALLAS" && <SizesChart items={items} lang={lang} />}
      {sub === "METODO" && <SkuMethodChart items={items} lang={lang} />}
      {sub === "FX" && <FxChart items={items} lang={lang} isClient={isClient} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1 · TALLAS — pares por talla, desglose por SKU (apilado) / por SKU
// ═══════════════════════════════════════════════════════════════
function SizesChart({ items, lang }) {
  const es = lang === "es";
  const [orient, setOrient] = useState("SIZE");      // SIZE | SKU
  const [selSkus, setSelSkus] = useState(() => new Set());

  // SKUs presentes en las líneas de los expedientes visibles.
  const skuList = useMemo(() => {
    const s = new Set();
    items.forEach((it) => (it.lineas || []).forEach((l) => l.sku && s.add(l.sku)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const activeSkus = useMemo(
    () => (selSkus.size ? skuList.filter((k) => selSkus.has(k)) : skuList),
    [skuList, selSkus]
  );

  // Agregación talla × sku (sólo SKUs activos).
  const { sizes, bySize, totalsBySize, totalGeneral } = useMemo(() => {
    const bySize = new Map();      // size -> Map(sku -> qty)
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      if (!l.sku || (selSkus.size && !selSkus.has(l.sku))) return;
      const size = (l.size && String(l.size).trim()) || (es ? "s/talla" : "no size");
      const q = qtyOf(l);
      if (!q) return;
      const m = bySize.get(size) || bySize.set(size, new Map()).get(size);
      m.set(l.sku, (m.get(l.sku) || 0) + q);
    }));
    const sizes = sortSizes(Array.from(bySize.keys()));
    const totalsBySize = new Map();
    let totalGeneral = 0;
    sizes.forEach((s) => {
      let t = 0; bySize.get(s).forEach((v) => { t += v; });
      totalsBySize.set(s, t); totalGeneral += t;
    });
    return { sizes, bySize, totalsBySize, totalGeneral };
  }, [items, selSkus, es]);

  // Agregación por SKU (para orient=SKU): sku -> Map(size->qty), total.
  const { bySku, totalsBySku, skuOrder } = useMemo(() => {
    const bySku = new Map();
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      if (!l.sku || (selSkus.size && !selSkus.has(l.sku))) return;
      const size = (l.size && String(l.size).trim()) || (es ? "s/talla" : "no size");
      const q = qtyOf(l);
      if (!q) return;
      const m = bySku.get(l.sku) || bySku.set(l.sku, new Map()).get(l.sku);
      m.set(size, (m.get(size) || 0) + q);
    }));
    const totalsBySku = new Map();
    bySku.forEach((m, k) => { let t = 0; m.forEach((v) => { t += v; }); totalsBySku.set(k, t); });
    const skuOrder = Array.from(bySku.keys()).sort((a, b) => (totalsBySku.get(b) || 0) - (totalsBySku.get(a) || 0));
    return { bySku, totalsBySku, skuOrder };
  }, [items, selSkus, es]);

  const toggleSku = (k) => setSelSkus((prev) => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const maxBar = orient === "SIZE"
    ? Math.max(1, ...sizes.map((s) => totalsBySize.get(s) || 0))
    : Math.max(1, ...skuOrder.map((k) => totalsBySku.get(k) || 0));

  const hasData = totalGeneral > 0;

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: NAVY, fontSize: 13, fontWeight: 800 }}>
          {es ? "PARES PEDIDOS POR TALLA" : "PAIRS ORDERED BY SIZE"}
        </h4>
        <span className="caption tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
          {fInt(totalGeneral)} {es ? "pares" : "pairs"} · {activeSkus.length} SKU{activeSkus.length === 1 ? "" : "s"}
        </span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[
            { id: "SIZE", es: "Por talla", en: "By size" },
            { id: "SKU", es: "Por SKU", en: "By SKU" },
          ].map((o) => (
            <button key={o.id} onClick={() => setOrient(o.id)}
                    style={pillStyle(orient === o.id)}>
              {es ? o.es : o.en}
            </button>
          ))}
        </div>
      </div>

      {/* Chips de SKU (filtro multiselección) */}
      {skuList.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <button onClick={() => setSelSkus(new Set())} style={chipStyle(selSkus.size === 0, "#64748B")}>
            {es ? "Todos los SKU" : "All SKUs"}
          </button>
          {skuList.map((k) => (
            <button key={k} onClick={() => toggleSku(k)} style={chipStyle(selSkus.has(k), colorForSku(k, skuList))}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorForSku(k, skuList), display: "inline-block", marginRight: 6 }} />
              {k}
            </button>
          ))}
        </div>
      )}

      {!hasData ? (
        <EmptyState lang={lang} />
      ) : orient === "SIZE" ? (
        <StackedBars
          rows={sizes.map((s) => ({
            key: s, label: s, total: totalsBySize.get(s) || 0,
            segments: activeSkus
              .map((k) => ({ key: k, value: bySize.get(s).get(k) || 0, color: colorForSku(k, skuList) }))
              .filter((seg) => seg.value > 0),
          }))}
          max={maxBar} lang={lang} unitNumeric
        />
      ) : (
        <StackedBars
          rows={skuOrder.map((k) => ({
            key: k, label: k, total: totalsBySku.get(k) || 0, mono: true,
            segments: sortSizes(Array.from(bySku.get(k).keys()))
              .map((s) => ({ key: s, value: bySku.get(k).get(s) || 0, color: NAVY })),
          }))}
          max={maxBar} lang={lang} showSegLabels
        />
      )}

      {/* Leyenda de SKUs (sólo apilado por talla) */}
      {hasData && orient === "SIZE" && activeSkus.length > 1 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          {activeSkus.map((k) => (
            <span key={k} className="caption" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary, #475569)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorForSku(k, skuList) }} />
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{k}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Barras horizontales apiladas reutilizables.
function StackedBars({ rows, max, lang, unitNumeric = false, showSegLabels = false, mono = false }) {
  const es = lang === "es";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 64, textAlign: "right", flexShrink: 0,
            fontSize: 12, fontWeight: 700, color: "var(--text-primary, #0B1E3A)",
            fontFamily: r.mono ? "JetBrains Mono, monospace" : undefined,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }} title={r.label}>{r.label}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", height: 22, background: "var(--surface-alt, #F1F5F9)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "flex", width: `${(r.total / max) * 100}%`, height: "100%", minWidth: 2, transition: "width .3s ease" }}>
              {r.segments.map((seg, i) => (
                <div key={seg.key + i}
                     title={`${seg.key}: ${fInt(seg.value)} ${es ? "prs" : "prs"}`}
                     style={{
                       width: `${(seg.value / r.total) * 100}%`, height: "100%",
                       background: seg.color,
                       borderRight: r.segments.length > 1 ? "1px solid rgba(255,255,255,0.5)" : "none",
                       display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                     }}>
                  {showSegLabels && (seg.value / max) > 0.05 && (
                    <span className="tabular-nums" style={{ fontSize: 9.5, color: "#fff", fontWeight: 700 }}>{seg.key}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="tabular-nums" style={{ width: 60, textAlign: "right", flexShrink: 0, fontSize: 12, fontWeight: 800, color: NAVY }}>
            {fInt(r.total)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2 · SKU × MÉTODO — Aéreo vs Marítimo para un SKU
// ═══════════════════════════════════════════════════════════════
const MODES = [
  { key: "Aereo", es: "Aéreo", en: "Air", color: NAVY },
  { key: "Maritimo", es: "Marítimo", en: "Sea", color: "#0FA3A0" },
];

function SkuMethodChart({ items, lang }) {
  const es = lang === "es";
  const skuList = useMemo(() => {
    const s = new Set();
    items.forEach((it) => (it.skus || []).forEach((k) => s.add(k)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const [sku, setSku] = useState("");
  const activeSku = sku && skuList.includes(sku) ? sku : (skuList[0] || "");

  const fases = STAGES.slice(0, 6);
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;

  // Para cada modo: expedientes con el SKU, pares totales y días promedio
  // por fase (modo desconocido se asume Aéreo, coherente con la app).
  const byMode = useMemo(() => {
    const out = {};
    MODES.forEach((m) => { out[m.key] = { items: [], pares: 0, phases: {} }; });
    items.forEach((it) => {
      if (!(it.skus || []).includes(activeSku)) return;
      const mk = it.modo === "Maritimo" ? "Maritimo" : "Aereo";
      const bucket = out[mk];
      bucket.items.push(it);
      bucket.pares += (it.lineas || [])
        .filter((l) => l.sku === activeSku)
        .reduce((a, l) => a + qtyOf(l), 0);
      fases.forEach((s) => {
        const d = itemPhaseDur(it, s);
        if (d) (bucket.phases[s] || (bucket.phases[s] = [])).push(d.days);
      });
    });
    MODES.forEach((m) => {
      const b = out[m.key];
      b.avg = {};
      fases.forEach((s) => {
        const arr = b.phases[s] || [];
        b.avg[s] = arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
      });
      b.ciclo = fases.reduce((a, s) => a + (b.avg[s] || 0), 0);
    });
    return out;
  }, [items, activeSku]);

  const maxPhase = Math.max(1, ...fases.flatMap((s) => MODES.map((m) => byMode[m.key].avg[s] || 0)));
  const anyData = MODES.some((m) => byMode[m.key].items.length);

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: NAVY, fontSize: 13, fontWeight: 800 }}>
          {es ? "COMPORTAMIENTO POR MÉTODO DE ENVÍO" : "BEHAVIOR BY SHIPPING MODE"}
        </h4>
        <select className="input" value={activeSku} onChange={(e) => setSku(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12.5, width: "auto", minWidth: 200, marginLeft: "auto", fontFamily: "JetBrains Mono, monospace" }}>
          {skuList.length === 0 && <option value="">{es ? "Sin SKUs" : "No SKUs"}</option>}
          {skuList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {!anyData ? (
        <EmptyState lang={lang} text={es ? "Este SKU no aparece en los expedientes filtrados." : "This SKU is not in the filtered files."} />
      ) : (
        <>
          {/* KPIs por modo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
            {MODES.map((m) => {
              const b = byMode[m.key];
              return (
                <div key={m.key} style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderLeft: `4px solid ${m.color}`, borderRadius: 10, padding: "10px 12px", background: "var(--surface-alt, #FBFCFE)" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: m.color, marginBottom: 6 }}>
                    {(es ? m.es : m.en).toUpperCase()}
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

          {/* Días promedio por fase — barras agrupadas Aéreo vs Marítimo */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary, #475569)", marginBottom: 8 }}>
            {es ? "Días promedio por fase" : "Average days per phase"}
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
                        <div className="tabular-nums" style={{ width: 40, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: v ? m.color : "var(--text-tertiary, #CBD5E1)" }}>
                          {v ? `${fmt1(v)}d` : "—"}
                        </div>
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
                <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />
                {es ? m.es : m.en}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <div className="tabular-nums" style={{ fontSize: 17, fontWeight: 800, color: accent ? MINT : "#0B1E3A", lineHeight: 1.1 }}>{value}</div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 3 · USD → BRL — serie histórica + medidor + campana de Gauss
// ═══════════════════════════════════════════════════════════════
const FX_RANGES = [
  { days: 90, label: "90d" },
  { days: 180, label: "180d" },
  { days: 365, label: "1a" },
];

function FxChart({ items, lang, isClient }) {
  const es = lang === "es";
  const [days, setDays] = useState(180);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fxApi.usdBrlHistory(days)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e?.message || "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  // Cartera USD de los expedientes visibles (R3: precio cliente vs MWT).
  const carteraUsd = useMemo(() => {
    let t = 0;
    items.forEach((it) => (it.lineas || []).forEach((l) => {
      const price = isClient
        ? Number(l.unit_price_client) || 0
        : (Number(l.unit_price_mwt) || Number(l.unit_price_client) || 0);
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
        <h4 style={{ margin: 0, color: NAVY, fontSize: 13, fontWeight: 800 }}>
          {es ? "DÓLAR → REAL (USD/BRL)" : "USD → BRL"}
        </h4>
        <span className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>
          {data && data.source ? data.source : "Frankfurter (ECB)"}
        </span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {FX_RANGES.map((r) => (
            <button key={r.days} onClick={() => setDays(r.days)} style={pillStyle(days === r.days)}>{r.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="caption" style={{ padding: 30, textAlign: "center", color: "var(--text-tertiary)" }}>
          {es ? "Cargando serie histórica…" : "Loading history…"}
        </div>
      ) : err || !series.length ? (
        <EmptyState lang={lang} text={es ? "No se pudo cargar la serie USD/BRL." : "Could not load USD/BRL series."} />
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
            <Gauge stats={stats} lang={lang} />
            <FxStat label={es ? "Mín · Máx" : "Min · Max"} value={`${fmt2(stats.min)} – ${fmt2(stats.max)}`} />
            <FxStat label={es ? "Promedio" : "Average"} value={`R$ ${fmt4(stats.avg)}`} />
            <FxStat label={es ? "Desv. est. (σ)" : "Std dev (σ)"} value={fmt4(stats.std)} />
            <FxStat
              label={es ? "Cartera visible → BRL" : "Visible book → BRL"}
              value={lastRate ? `R$ ${fInt(Math.round(carteraUsd * lastRate))}` : "—"}
              sub={`$ ${fInt(Math.round(carteraUsd))} USD`}
            />
          </div>

          {/* Línea / área de la serie */}
          <FxLine series={series} stats={stats} lang={lang} />

          {/* Campana de Gauss: histograma de tasas + curva normal */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary, #475569)", margin: "18px 0 8px" }}>
            {es ? "Distribución de la cotización (campana de Gauss)" : "Rate distribution (Gaussian bell)"}
          </div>
          <Gauss series={series} stats={stats} lang={lang} />
        </>
      )}
    </div>
  );
}

function FxStat({ label, value, sub }) {
  return (
    <div style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 10, padding: "9px 11px", background: "var(--surface-alt, #FBFCFE)" }}>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 800, color: "#0B1E3A", whiteSpace: "nowrap" }}>{value}</div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
      {sub && <div className="caption tabular-nums" style={{ color: "var(--text-tertiary, #CBD5E1)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// Medidor radial simple de la tasa de hoy dentro del rango [min,max].
function Gauge({ stats, lang }) {
  const es = lang === "es";
  const { min, max, last } = stats;
  const span = max - min || 1;
  const frac = Math.max(0, Math.min(1, (last - min) / span));
  const R = 34, cx = 44, cy = 42;
  const a0 = Math.PI, a1 = 0;                       // semicírculo superior
  const ang = a0 + (a1 - a0) * frac;
  const px = cx + R * Math.cos(ang), py = cy + R * Math.sin(ang) * -1;
  const arc = (from, to, color, w) => {
    const x0 = cx + R * Math.cos(from), y0 = cy - R * Math.sin(from);
    const x1 = cx + R * Math.cos(to), y1 = cy - R * Math.sin(to);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return <path d={`M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <div style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 10, padding: "8px 11px", background: "linear-gradient(180deg, rgba(1,58,87,0.04), transparent)", gridColumn: "span 1" }}>
      <svg viewBox="0 0 88 52" width="100%" height="46" style={{ display: "block" }}>
        {arc(Math.PI, 0, "var(--surface-alt, #E2E8F0)", 6)}
        {arc(Math.PI, Math.PI + (0 - Math.PI) * frac, MINT, 6)}
        <line x1={cx} y1={cy} x2={px} y2={py} stroke={NAVY} strokeWidth={2.2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill={NAVY} />
      </svg>
      <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, color: NAVY, textAlign: "center", lineHeight: 1 }}>
        R$ {fmt4(last)}
      </div>
      <div className="caption" style={{ color: "var(--text-tertiary, #94A3B8)", textAlign: "center" }}>
        {es ? "Hoy · por US$1" : "Today · per US$1"}
      </div>
    </div>
  );
}

// Gráfica de línea/área de la serie temporal (SVG responsivo por viewBox).
function FxLine({ series, stats, lang }) {
  const W = 720, H = 200, padL = 46, padR = 12, padT = 14, padB = 24;
  const min = stats.min, max = stats.max, span = (max - min) || 1;
  const n = series.length;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const areaPts = `${padL},${H - padB} ${linePts} ${x(n - 1)},${H - padB}`;
  const gridVals = [min, min + span / 2, max];
  // Ticks de fecha: ~6 etiquetas.
  const tickIdx = [];
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) tickIdx.push(i);
  if (tickIdx[tickIdx.length - 1] !== n - 1) tickIdx.push(n - 1);
  const fmtDate = (s) => { const d = String(s).slice(5); return d.replace("-", "/"); };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
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
      <circle cx={x(n - 1)} cy={y(series[n - 1].rate)} r="3.5" fill={MINT} stroke="#fff" strokeWidth="1.5" />
      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#94A3B8" className="tabular-nums">{fmtDate(series[i].date)}</text>
      ))}
    </svg>
  );
}

// Histograma + curva normal (media μ ± σ marcadas).
function Gauss({ series, stats, lang }) {
  const es = lang === "es";
  const vals = series.map((p) => p.rate);
  const { avg: mu, std: sigma, min, max } = stats;
  const W = 720, H = 180, padL = 30, padR = 12, padT = 10, padB = 22;
  const lo = min, hi = max, span = (hi - lo) || 1;
  const BINS = Math.min(24, Math.max(8, Math.round(Math.sqrt(vals.length))));
  const counts = new Array(BINS).fill(0);
  vals.forEach((v) => {
    let b = Math.floor(((v - lo) / span) * BINS);
    if (b >= BINS) b = BINS - 1; if (b < 0) b = 0;
    counts[b]++;
  });
  const maxCount = Math.max(1, ...counts);
  const bw = (W - padL - padR) / BINS;
  const xVal = (v) => padL + ((v - lo) / span) * (W - padL - padR);
  const yCount = (c) => padT + (1 - c / maxCount) * (H - padT - padB);

  // Curva normal escalada al pico del histograma.
  const normal = (v) => Math.exp(-0.5 * Math.pow((v - mu) / (sigma || 1e-6), 2));
  const peakN = normal(mu) || 1;
  const curve = [];
  const STEPS = 80;
  for (let i = 0; i <= STEPS; i++) {
    const v = lo + (span * i) / STEPS;
    const yy = padT + (1 - normal(v) / peakN) * (H - padT - padB);
    curve.push(`${xVal(v).toFixed(1)},${yy.toFixed(1)}`);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {/* histograma */}
      {counts.map((c, i) => {
        const x0 = padL + i * bw;
        const yTop = yCount(c);
        return <rect key={i} x={x0 + 1} y={yTop} width={Math.max(1, bw - 2)} height={(H - padB) - yTop} rx="2" fill={NAVY} opacity="0.18" />;
      })}
      {/* curva normal */}
      <polyline points={curve.join(" ")} fill="none" stroke={MINT} strokeWidth="2.4" strokeLinejoin="round" />
      {/* μ y ±σ */}
      {[
        { v: mu, c: NAVY, dash: "0", lbl: "μ" },
        { v: mu - sigma, c: "#94A3B8", dash: "4 3", lbl: "−σ" },
        { v: mu + sigma, c: "#94A3B8", dash: "4 3", lbl: "+σ" },
      ].filter((m) => m.v >= lo && m.v <= hi).map((m, i) => (
        <g key={i}>
          <line x1={xVal(m.v)} y1={padT} x2={xVal(m.v)} y2={H - padB} stroke={m.c} strokeWidth="1.3" strokeDasharray={m.dash} />
          <text x={xVal(m.v)} y={padT - 1} textAnchor="middle" fontSize="10" fill={m.c} fontWeight="700">{m.lbl}</text>
        </g>
      ))}
      {/* eje x: lo, μ, hi */}
      {[lo, mu, hi].map((v, i) => (
        <text key={i} x={xVal(v)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="9.5" fill="#94A3B8" className="tabular-nums">{fmt2(v)}</text>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers de estilo / estados
// ═══════════════════════════════════════════════════════════════
function pillStyle(active) {
  return {
    padding: "3px 13px", fontSize: 11.5, fontWeight: 700, borderRadius: 999,
    border: active ? `1.5px solid ${NAVY}` : "1.5px solid var(--border-subtle, #E1E6ED)",
    background: active ? NAVY : "transparent",
    color: active ? "#fff" : "var(--text-secondary, #475569)",
    cursor: "pointer",
  };
}
function chipStyle(active, color) {
  return {
    display: "inline-flex", alignItems: "center",
    padding: "3px 11px", fontSize: 11, fontWeight: 700, borderRadius: 999,
    border: `1.5px solid ${active ? color : "var(--border-subtle, #E1E6ED)"}`,
    background: active ? `${color}14` : "transparent",
    color: active ? color : "var(--text-secondary, #475569)",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
  };
}
function EmptyState({ lang, text }) {
  const es = lang === "es";
  return (
    <div className="caption" style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>
      {text || (es ? "Sin datos para los filtros actuales." : "No data for current filters.")}
    </div>
  );
}
