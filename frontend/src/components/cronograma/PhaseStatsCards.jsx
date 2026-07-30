// ─────────────────────────────────────────────────────────────
// PhaseStatsCards — Tiempos promedio por fase (Cronograma React)
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
// Dos vistas conmutables:
//   · MÉTODO: secciones Aéreo / Marítimo con una card por fase
//     (jerarquía cliente → global → _ALL → estándar, badge est./n exp.).
//   · SKU: tabla por SKU con el promedio por fase de los expedientes
//     que lo contienen.
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import {
  DISPLAY_STAGES, DISPLAY_STAGE_LABELS, DISPLAY_STAGE_COLORS, avgFor,
} from "../../lib/cronogramaData.js";

const fmt1 = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("en-US");

export default function PhaseStatsCards({ avgs, skuStats = [], lang = "es", clienteLabel = "" }) {
  const [tab, setTab] = useState("METODO");
  const L = DISPLAY_STAGE_LABELS[lang] || DISPLAY_STAGE_LABELS.es;
  const fases = DISPLAY_STAGES.slice(0, 5);

  return (
    <div className="card card-pad-md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, color: "#013A57", fontSize: 13, fontWeight: 800 }}>
          {lang === "es" ? "TIEMPOS PROMEDIO POR FASE" : "AVERAGE TIME PER PHASE"}
        </h4>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[
            { id: "METODO", es: "Por método", en: "By mode" },
            { id: "SKU", es: "Por SKU", en: "By SKU" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    style={{
                      padding: "3px 13px", fontSize: 11.5, fontWeight: 700, borderRadius: 999,
                      border: tab === t.id ? "1.5px solid #013A57" : "1.5px solid var(--border-subtle, #E1E6ED)",
                      background: tab === t.id ? "#013A57" : "transparent",
                      color: tab === t.id ? "#fff" : "var(--text-secondary, #475569)",
                      cursor: "pointer",
                    }}>
              {lang === "es" ? t.es : t.en}
            </button>
          ))}
        </div>
      </div>

      {tab === "METODO" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[["Aereo", "Aéreo"], ["Maritimo", "Marítimo"]].map(([key, label]) => {
            let total = 0;
            let anyReal = false;
            const cards = fases.map((s) => {
              const a = avgFor(avgs, key, s);
              if (!a.est) anyReal = true;
              total += a.avg;
              return { s, ...a };
            });
            return (
              <div key={key} style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: "#013A57", background: "rgba(1,58,87,0.08)", padding: "2px 10px", borderRadius: 999 }}>
                    {label.toUpperCase()}
                  </span>
                  <span className="caption" style={{ color: "var(--text-secondary, #475569)" }}>
                    {lang === "es" ? "ciclo completo ≈ " : "full cycle ≈ "}
                    <b className="tabular-nums">{Math.round(total)} {lang === "es" ? "días" : "days"}</b>
                    {anyReal
                      ? (lang === "es" ? ` · estimado con el historial${clienteLabel ? " del cliente " + clienteLabel : ""}` : " · estimated from history")
                      : (lang === "es" ? " · estándar (sin historial)" : " · default (no history)")}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                  {cards.map((c) => (
                    <div key={c.s} style={{ border: "1px solid var(--border-subtle, #E1E6ED)", borderTop: `3px solid ${DISPLAY_STAGE_COLORS[c.s]}`, borderRadius: 10, padding: "8px 10px", background: "var(--surface-alt, #FBFCFE)" }}>
                      <div className="tabular-nums" style={{ fontSize: 17, fontWeight: 800, color: "#0B1E3A", display: "flex", alignItems: "baseline", gap: 4 }}>
                        {fmt1(c.avg)}<span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-tertiary)" }}>d</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "rgba(148,163,184,0.15)", color: "var(--text-tertiary, #64748B)" }}>
                          {c.est ? "est." : `est. · ${c.n} exp.`}
                        </span>
                      </div>
                      <div className="caption" style={{ color: "var(--text-secondary, #475569)", marginTop: 1 }}>{L[c.s]}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "SKU" && (
        skuStats.length === 0 ? (
          <div className="caption" style={{ color: "var(--text-tertiary)", padding: 12, textAlign: "center" }}>
            {lang === "es" ? "Sin SKUs en los expedientes cargados." : "No SKUs in loaded files."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>SKU</th>
                  <th>{lang === "es" ? "Producto" : "Product"}</th>
                  {fases.map((s) => (
                    <th key={s} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{L[s]}</th>
                  ))}
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lang === "es" ? "Ciclo" : "Cycle"}</th>
                </tr>
              </thead>
              <tbody>
                {skuStats.map((g) => {
                  let total = 0, known = 0;
                  return (
                    <tr key={g.sku}>
                      <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>{g.sku}</td>
                      <td style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={g.product}>{g.product || "—"}</td>
                      {fases.map((s) => {
                        const p = g.phases[s];
                        if (p) { total += p.avg; known++; }
                        return (
                          <td key={s} className="tabular-nums" style={{ textAlign: "right" }}>
                            {p ? (
                              <span title={`${p.n} exp.`}>{fmt1(p.avg)}d</span>
                            ) : (
                              <span style={{ color: "var(--text-tertiary, #CBD5E1)" }}>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: known ? "#00B286" : "var(--text-tertiary, #CBD5E1)" }}>
                        {known ? `${Math.round(total)}d` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
