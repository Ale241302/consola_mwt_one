// =====================================================================
// MWT.ONE · components/brands/ComexCalculator.jsx
// Agente responsable: [AG-FRONTEND]
//
// Calculadora inline del Excel "Tabela de preços COMEX 2026 v6".
// Reproduce la fórmula de la celda J18 de la hoja 'Calculadora':
//
//   precio_final = precio_base_USD
//                × (1.0183 ^ (100 × comisión_pct))
//                × factor_indice_pago(dias, mercado)
//
// Inputs:
//   · SKU (combobox contra MOCK_COMEX_PRODUCTS + opcionalmente backend)
//   · Comisión (% — slider o input numérico)
//   · Plazo de pago en días (select con los 34 valores del Excel)
//   · Mercado ME / MI (default ME para COMEX)
//
// Resultado:
//   · Precio final en USD + desglose paso a paso (breakdown).
//
// En modo demo/mock:
//   · Resuelve localmente con comexResolvePriceMock() — sin red.
//   · El backend real vive en POST /api/commercial/resolve_price/.
// =====================================================================
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  MOCK_COMEX_PRODUCTS, MOCK_PAYMENT_INDEX, comexResolvePriceMock,
} from "../../data/mockData.js";
import { IconDollar, IconPercent, IconSearch } from "../../lib/icons.jsx";

const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const MUTED = "#64748B";
const SOFT  = "#F8FAFC";

export default function ComexCalculator({ lang = "es" }) {
  const [sku,       setSku]       = useState(MOCK_COMEX_PRODUCTS[3]?.sku || "");
  const [comisionPct, setComisionPct] = useState(0.08);   // 8% default
  const [diasPago,  setDiasPago]  = useState(28);
  const [mercado,   setMercado]   = useState("ME");
  const [search,    setSearch]    = useState("");

  // Productos filtrados por búsqueda (sku o nombre, case-insensitive).
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MOCK_COMEX_PRODUCTS;
    return MOCK_COMEX_PRODUCTS.filter(p =>
      p.sku.toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q),
    );
  }, [search]);

  // Cálculo reactivo.
  const result = useMemo(() => {
    if (!sku) return null;
    return comexResolvePriceMock({
      sku, comision_pct: Number(comisionPct) || 0,
      dias_pago: Number(diasPago) || 0, mercado,
    });
  }, [sku, comisionPct, diasPago, mercado]);

  const selectedProduct = MOCK_COMEX_PRODUCTS.find(p => p.sku === sku);

  return (
    <div className="comex-calc-root" style={{
      border: "1px solid #E5E7EB", borderRadius: 12,
      background: "#FFFFFF", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px",
        background: `linear-gradient(90deg, ${NAVY} 0%, #1A2F52 100%)`,
        color: "#FFFFFF",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <IconDollar size={18} />
        <div>
          <div style={{ font: "700 13.5px/1.2 var(--font-body)" }}>
            {lang === "es" ? "Calculadora COMEX 2026" : "COMEX 2026 Calculator"}
          </div>
          <div style={{ font: "400 11px/1.3 var(--font-body)", opacity: 0.75 }}>
            {lang === "es"
              ? "precio_base × (1.0183 ^ (100 × comisión)) × índice_pago"
              : "base_price × (1.0183 ^ (100 × commission)) × payment_index"}
          </div>
        </div>
      </div>

      {/* Body · inputs + resultado */}
      <div style={{
        padding: 18, display: "grid",
        gridTemplateColumns: "minmax(260px, 1.1fr) minmax(280px, 1fr)",
        gap: 18,
      }}>
        {/* ── Columna izquierda: inputs ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* SKU selector */}
          <div>
            <label style={labelStyle}>{lang === "es" ? "Código (SKU)" : "Code (SKU)"}</label>
            <div style={{ position: "relative" }}>
              <IconSearch size={13} style={{
                position: "absolute", left: 10, top: "50%",
                transform: "translateY(-50%)", color: MUTED, pointerEvents: "none",
              }}/>
              <input
                type="text"
                placeholder={lang === "es" ? "Buscar SKU o modelo…" : "Search SKU or model…"}
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 30 }}
              />
            </div>
            <select
              value={sku}
              onChange={e => setSku(e.target.value)}
              style={{ ...inputStyle, marginTop: 6, maxHeight: 160 }}
            >
              {filteredProducts.map(p => (
                <option key={p.sku} value={p.sku}>
                  {p.sku} · {p.name} · ${p.price_usd.toFixed(4)} USD
                </option>
              ))}
            </select>
            {selectedProduct && (
              <div style={{
                marginTop: 6, padding: "6px 10px", background: SOFT,
                border: "1px solid #E5E7EB", borderRadius: 6,
                font: "500 11px/1.35 var(--font-body)", color: MUTED,
              }}>
                <strong style={{ color: NAVY }}>{selectedProduct.name}</strong><br/>
                {selectedProduct.material} · {selectedProduct.bico} · NCM {selectedProduct.ncm} · CA {selectedProduct.ca}
              </div>
            )}
          </div>

          {/* Comisión */}
          <div>
            <label style={labelStyle}>
              <IconPercent size={11} style={{ display: "inline", marginRight: 4 }}/>
              {lang === "es" ? "Comisión" : "Commission"}
              <span style={{ marginLeft: 8, color: MINT, fontWeight: 700 }}>
                {(Number(comisionPct) * 100).toFixed(1)}%
              </span>
            </label>
            <input
              type="range" min={0} max={0.30} step={0.005}
              value={comisionPct}
              onChange={e => setComisionPct(Number(e.target.value))}
              style={{ width: "100%", accentColor: MINT }}
            />
            <div style={{
              display: "flex", justifyContent: "space-between",
              font: "400 10px/1 var(--font-body)", color: MUTED, marginTop: 2,
            }}>
              <span>0%</span><span>15%</span><span>30%</span>
            </div>
          </div>

          {/* Plazo de pago */}
          <div>
            <label style={labelStyle}>
              {lang === "es" ? "Plazo de pago (días)" : "Payment term (days)"}
            </label>
            <select
              value={diasPago}
              onChange={e => setDiasPago(Number(e.target.value))}
              style={inputStyle}
            >
              {MOCK_PAYMENT_INDEX.map(r => (
                <option key={r.dias} value={r.dias}>
                  {r.dias}d · ME {r.factor_me.toFixed(3)} · MI {r.factor_mi.toFixed(3)}
                </option>
              ))}
            </select>
          </div>

          {/* Mercado */}
          <div>
            <label style={labelStyle}>{lang === "es" ? "Mercado" : "Market"}</label>
            <div style={{ display: "flex", gap: 6 }}>
              {["ME", "MI"].map(m => (
                <button key={m} type="button"
                  onClick={() => setMercado(m)}
                  style={{
                    flex: 1, padding: "8px 12px",
                    border: `1px solid ${mercado === m ? MINT : "#E5E7EB"}`,
                    background: mercado === m ? `${MINT}15` : "#FFFFFF",
                    color: mercado === m ? MINT : NAVY,
                    font: "600 11.5px/1 var(--font-body)", borderRadius: 6,
                    cursor: "pointer", transition: "all 120ms ease",
                  }}
                >
                  {m === "ME"
                    ? (lang === "es" ? "Externo (COMEX)" : "External (COMEX)")
                    : (lang === "es" ? "Interno (Brasil)" : "Internal (Brazil)")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Columna derecha: resultado + breakdown ── */}
        <div style={{
          background: SOFT, borderRadius: 10, padding: 16,
          border: "1px solid #E5E7EB",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {!result ? (
            <div style={{ textAlign: "center", color: MUTED, padding: "40px 0",
              font: "500 12.5px/1 var(--font-body)" }}>
              {lang === "es" ? "Seleccioná un SKU para calcular." : "Select a SKU to calculate."}
            </div>
          ) : (
            <>
              <div>
                <div style={{ font: "500 10.5px/1 var(--font-body)", color: MUTED,
                  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                  {lang === "es" ? "Precio final" : "Final price"}
                </div>
                <motion.div key={result.price_final_usd}
                  initial={{ opacity: 0.4, scale: 0.98 }}
                  animate={{ opacity: 1,   scale: 1 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    font: "800 30px/1.1 var(--font-body)", color: MINT,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                  ${result.price_final_usd.toFixed(4)}
                  <span style={{ font: "600 13px/1 var(--font-body)",
                    color: MUTED, marginLeft: 6 }}>USD</span>
                </motion.div>
              </div>

              <hr style={{ border: "none", borderTop: "1px dashed #E5E7EB", margin: 0 }}/>

              {/* Breakdown paso a paso */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ font: "600 10.5px/1 var(--font-body)", color: MUTED,
                  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  {lang === "es" ? "Desglose" : "Breakdown"}
                </div>
                {result.breakdown.map((line, i) => (
                  <div key={i} style={{
                    font: "500 11.5px/1.4 var(--font-mono, ui-monospace)",
                    color: i === result.breakdown.length - 1 ? NAVY : "#475569",
                    fontWeight: i === result.breakdown.length - 1 ? 700 : 500,
                    padding: "2px 0",
                  }}>
                    {line}
                  </div>
                ))}
              </div>

              {/* Factores numéricos compactos */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
                marginTop: 4,
              }}>
                <MetricPill label="base USD"        value={`$${result.price_base_usd.toFixed(4)}`} />
                <MetricPill label={`comisión ${(result.commission_pct*100).toFixed(1)}%`}
                            value={`×${result.commission_factor.toFixed(4)}`} highlight={LIGHT} />
                <MetricPill label={`${result.payment_days}d ${result.payment_market}`}
                            value={`×${result.payment_factor}`} highlight={LIGHT} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricPill({ label, value, highlight }) {
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E5E7EB",
      borderRadius: 8, padding: "8px 10px",
      display: "flex", flexDirection: "column",
    }}>
      <span style={{ font: "500 9.5px/1 var(--font-body)", color: MUTED,
        textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      <span style={{ font: "700 13px/1.1 var(--font-body)", color: NAVY,
        fontVariantNumeric: "tabular-nums", marginTop: 3 }}>
        {value}
      </span>
    </div>
  );
}

const labelStyle = {
  display: "block",
  font: "600 11px/1 var(--font-body)",
  color: NAVY,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const inputStyle = {
  width: "100%", padding: "8px 10px",
  border: "1px solid #E5E7EB", borderRadius: 6,
  font: "500 13px/1.2 var(--font-body)", color: NAVY,
  background: "#FFFFFF",
  outline: "none",
};
