// ─────────────────────────────────────────────────────────────────────
// AtencionExpedientes.jsx — Etapa 2 · "Atención": expedientes que
// requieren atención (fusión de la antigua /mesa-trabajo).
//   stale_state | missing_proforma | missing_sap | missing_oc
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, getToken } from "../../lib/api.js";
import { DISPLAY_STAGE_LABELS } from "../../lib/cronogramaData.js";
import { displayStage } from "../../lib/phaseDisplay.js";

export default function AtencionExpedientes({ lang = "es" }) {
  const es = lang === "es";
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/expedientes/atencion/", { token: getToken() })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e?.message || "Error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const items = Array.isArray(data?.results) ? data.results : [];
  const kpis = useMemo(() => ({
    stale: items.filter((i) => i.stale_state).length,
    pf:    items.filter((i) => i.missing_proforma).length,
    sap:   items.filter((i) => i.missing_sap).length,
    oc:    items.filter((i) => i.missing_oc).length,
  }), [items]);

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch { return iso; }
  };
  const flag = (on, label) => on ? (
    <span style={{ display: "inline-block", marginRight: 4, padding: "2px 7px", borderRadius: 6,
                   fontSize: 10, fontWeight: 700, background: "rgba(180,83,9,0.14)", color: "#92400E" }}>
      {label}
    </span>) : null;

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {[["stale", es ? "Estancados" : "Stale", kpis.stale, "#B45309"],
          ["pf", es ? "Sin proforma" : "No proforma", kpis.pf, "#B91C1C"],
          ["sap", "Sin SAP", kpis.sap, "#B91C1C"],
          ["oc", es ? "Sin OC" : "No OC", kpis.oc, "#B91C1C"]].map(([k, label, v, tone]) => (
          <div key={k} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border-subtle, #E2E8F0)",
                                borderRadius: 12, padding: "14px 18px", flex: "1 1 140px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
                          color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
            <div className="tabular-nums" style={{ fontSize: 24, fontWeight: 800, color: tone }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="table-scroll" style={{ background: "var(--surface, #fff)",
                                             border: "1px solid var(--border-subtle, #E2E8F0)", borderRadius: 12 }}>
        <table className="table-sticky" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface-alt, #F1F5F9)", borderBottom: "2px solid var(--border, #CBD5E1)" }}>
              <th style={Th}>{es ? "Referencia" : "Reference"}</th>
              <th style={Th}>{es ? "Cliente" : "Client"}</th>
              <th style={Th}>{es ? "Estado" : "Status"}</th>
              <th style={Th}>{es ? "Días" : "Days"}</th>
              <th style={Th}>{es ? "Atención" : "Attention"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>…</td></tr>}
            {!loading && error && <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "#B91C1C" }}>{error}</td></tr>}
            {!loading && !error && items.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>
                {es ? "Nada requiere atención." : "Nothing needs attention."}
              </td></tr>
            )}
            {items.map((it, i) => (
              <tr key={it.id || i} onClick={() => it.oc_id && navigate(`/expedientes/${it.oc_id}`)}
                  style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle, #F1F5F9)",
                           background: i % 2 ? "rgba(241,245,249,0.4)" : "transparent" }}>
                <td style={Td}><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{it.proforma_codigo || it.codigo || "—"}</span></td>
                <td style={Td}>{it.client_label || "—"}</td>
                <td style={Td}>{DISPLAY_STAGE_LABELS?.[es ? "es" : "en"]?.[displayStage(it.estado)] || it.estado}</td>
                <td style={Td} className="tabular-nums">{it.days_in_state ?? "—"}</td>
                <td style={Td}>
                  {flag(it.stale_state, es ? "Estancado" : "Stale")}
                  {flag(it.missing_proforma, es ? "Sin PF" : "No PF")}
                  {flag(it.missing_sap, "SAP")}
                  {flag(it.missing_oc, "OC")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const Th = { padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
             color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase", whiteSpace: "nowrap" };
const Td = { padding: "9px 12px", verticalAlign: "top" };
