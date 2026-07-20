// ─────────────────────────────────────────────────────────────────────
// MesaTrabajo.jsx — Sprint 2026-07-20 · "Mesa de trabajo" (CEO/Admin).
//
// Lista los expedientes que REQUIEREN ATENCIÓN según el backend
// (GET /api/expedientes/atencion/):
//   · stale_state      — más días en su estado actual que el promedio
//                        histórico de esa fase (phase-stats).
//   · missing_proforma — el expediente no tiene ninguna PROFORMA activa
//                        (ej. OC recién creada por el cliente sin la PF).
//
// Solo admin/CEO/superadmin: la ruta va envuelta en CeoAdminOnlyRoute
// (App.jsx) y el item del sidebar lleva adminOnly.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, getToken } from "../lib/api.js";
import { IconAlert, IconFileText, IconClock, IconFolder } from "../lib/icons.jsx";

const ESTADO_LABEL = {
  REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación",
  DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino",
  CERRADO: "Cerrado",
};

export default function MesaTrabajo({ lang = "es" }) {
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

  const items = (data && Array.isArray(data.results)) ? data.results : [];
  const fmtMoney = (v, mon) => {
    const n = Number(v || 0);
    return `${mon === "USD" ? "$" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };
  const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(es ? "es-CR" : "en-US", { day: "numeric", month: "short" });
    } catch { return String(iso).slice(0, 10); }
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, fontWeight: 700 }}>
        ADMIN · CEO
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0B1E3A", margin: "4px 0 2px" }}>
        {es ? "Mesa de trabajo" : "Workbench"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 18 }}>
        {es
          ? "Expedientes que requieren atención: estancados más allá del promedio de su fase o sin proforma generada."
          : "Files needing attention: stale beyond their phase average or missing a proforma."}
      </p>

      {loading && (
        <div className="card card-pad-lg">
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {es ? "Cargando…" : "Loading…"}
          </div>
        </div>
      )}
      {error && (
        <div className="card card-pad-lg">
          <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="card card-pad-lg" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
            {es ? "Nada requiere atención" : "Nothing needs attention"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
            {es
              ? "Todos los expedientes están en tiempo y con su proforma al día."
              : "All files are on time with their proforma up to date."}
          </div>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{
            padding: "10px 16px", borderBottom: "1px solid var(--border)",
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            color: "var(--text-tertiary)", textTransform: "uppercase",
          }}>
            {es ? `${items.length} expediente(s) requieren atención` : `${items.length} file(s) need attention`}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "rgba(11,30,58,0.03)", textAlign: "left" }}>
                {[es ? "Ref" : "Ref", es ? "Cliente" : "Client", es ? "Estado" : "Stage",
                  es ? "Días en estado" : "Days in stage", es ? "Promedio" : "Average",
                  es ? "Razón" : "Reason", "Total", es ? "Creado" : "Created", ""].map((h, i) => (
                  <th key={i} style={{
                    padding: "8px 10px", fontSize: 10, fontWeight: 700,
                    letterSpacing: 0.5, color: "var(--text-tertiary)",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const ref = it.oc_codigo || it.codigo || "—";
                const refLabel = /^po[\s_-]/i.test(String(ref)) ? ref : `PO ${ref}`;
                return (
                  <tr key={it.id}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      onClick={() => it.oc_id && navigate(`/expedientes/${it.oc_id}`)}>
                    <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 800, color: "#0B1E3A", fontSize: 13 }}>
                        {it.oc_codigo ? refLabel : (it.codigo || "—")}
                      </div>
                      <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 10.5, fontFamily: "var(--font-mono, monospace)" }}>
                        {it.codigo}
                      </div>
                    </td>
                    <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{it.client_label || "—"}</td>
                    <td style={{ padding: "10px" }}>
                      <span style={{
                        padding: "3px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                        background: "rgba(1,58,87,0.07)", color: "#013A57", whiteSpace: "nowrap",
                      }}>
                        {ESTADO_LABEL[it.estado] || it.estado}
                      </span>
                    </td>
                    <td className="tabular-nums" style={{ padding: "10px", textAlign: "right" }}>
                      <span style={{
                        fontWeight: 800, fontSize: 13,
                        color: it.stale_state ? "#DC2626" : "var(--text-primary)",
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}>
                        <IconClock size={11}/>
                        {it.days_in_state}d
                      </span>
                    </td>
                    <td className="tabular-nums" style={{ padding: "10px", textAlign: "right", color: "var(--text-tertiary)" }}>
                      {it.avg_days != null ? `${it.avg_days}d` : "—"}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {it.stale_state && (
                          <span style={{
                            padding: "3px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                            background: "rgba(220,38,38,0.09)", color: "#DC2626",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                            <IconAlert size={10}/> {es ? "Estancado" : "Stale"}
                          </span>
                        )}
                        {it.missing_proforma && (
                          <span style={{
                            padding: "3px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                            background: "rgba(180,83,9,0.10)", color: "#B45309",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                            <IconFileText size={10}/> {es ? "Falta proforma" : "No proforma"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="tabular-nums" style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>
                      {fmtMoney(it.total_cost, it.moneda)}
                    </td>
                    <td style={{ padding: "10px", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                      {fmtDate(it.created_at)}
                    </td>
                    <td style={{ padding: "10px", color: "var(--text-tertiary)" }}>
                      <IconFolder size={13}/>
                    </td>
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
