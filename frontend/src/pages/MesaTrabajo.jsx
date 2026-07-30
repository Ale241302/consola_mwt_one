// ─────────────────────────────────────────────────────────────────────
// MesaTrabajo.jsx — Sprint 2026-07-20 (rev2) · "Mesa de trabajo" (CEO/Admin).
//
// Expedientes que REQUIEREN ATENCIÓN (GET /api/expedientes/atencion/):
//   · stale_state      — más días en su fase que el promedio histórico.
//   · missing_proforma — sin número de proforma (PF).
//   · missing_sap      — sin número SAP.
//   · missing_oc       — sin OC asociada.
//
// El Ref principal de cada fila es el NÚMERO DE PROFORMA (no el PO ni
// el EXP). Solo admin/CEO/superadmin (ruta + sidebar + endpoint gated).
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, getToken } from "../lib/api.js";
import { DISPLAY_STAGE_LABELS } from "../lib/cronogramaData.js";
import { displayStage } from "../lib/phaseDisplay.js";
import { IconAlert, IconFileText, IconClock, IconTag, IconFolder } from "../lib/icons.jsx";

const ESTADO_LABEL = DISPLAY_STAGE_LABELS.es;

function KpiCard({ icon, label, count, color, bg }) {
  return (
    <div style={{
      flex: "1 1 150px", background: "#fff", border: "1px solid var(--border)",
      borderRadius: 12, padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        background: bg, color, display: "inline-flex",
        alignItems: "center", justifyContent: "center",
      }}>{icon}</span>
      <div>
        <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "#0B1E3A", lineHeight: 1.1 }}>
          {count}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

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

  const items = useMemo(
    () => (data && Array.isArray(data.results) ? data.results : []),
    [data]
  );
  const kpis = useMemo(() => ({
    stale:  items.filter((i) => i.stale_state).length,
    pf:     items.filter((i) => i.missing_proforma).length,
    sap:    items.filter((i) => i.missing_sap).length,
    oc:     items.filter((i) => i.missing_oc).length,
  }), [items]);

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(es ? "es-CR" : "en-US", { day: "numeric", month: "short" });
    } catch { return String(iso).slice(0, 10); }
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1180, margin: "0 auto" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, fontWeight: 700 }}>
        ADMIN · CEO
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0B1E3A", margin: "4px 0 2px" }}>
        {es ? "Mesa de trabajo" : "Workbench"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 16 }}>
        {es
          ? "Expedientes que requieren atención: estancados más allá del promedio de su fase, sin proforma (PF), sin SAP o sin OC."
          : "Files needing attention: stale beyond their phase average, missing proforma (PF), SAP or OC."}
      </p>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <KpiCard icon={<IconClock size={16}/>}  label={es ? "Estancados" : "Stale"}        count={kpis.stale} color="#DC2626" bg="rgba(220,38,38,0.10)"/>
          <KpiCard icon={<IconFileText size={16}/>} label={es ? "Falta proforma" : "No proforma"} count={kpis.pf}   color="#B45309" bg="rgba(180,83,9,0.10)"/>
          <KpiCard icon={<IconTag size={16}/>}     label={es ? "Sin SAP" : "No SAP"}          count={kpis.sap}  color="#0369A1" bg="rgba(3,105,161,0.10)"/>
          <KpiCard icon={<IconFolder size={16}/>}  label={es ? "Sin OC" : "No OC"}            count={kpis.oc}   color="#7C3AED" bg="rgba(124,58,237,0.10)"/>
        </div>
      )}

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
        <div className="card card-pad-lg" style={{ textAlign: "center", padding: 44 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
            {es ? "Nada requiere atención" : "Nothing needs attention"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
            {es
              ? "Todos los expedientes están en tiempo y con su documentación al día."
              : "All files are on time with their paperwork up to date."}
          </div>
        </div>
      )}

      {/* ── Lista ──────────────────────────────────────────────── */}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const ratio = (it.stale_state && it.avg_days)
              ? Math.min(it.days_in_state / Math.max(it.avg_days, 0.01), 3)
              : 0;
            const accent = it.stale_state ? "#DC2626" : "#B45309";
            return (
              <div
                key={it.id}
                onClick={() => it.oc_id && navigate(`/expedientes/${it.oc_id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                  background: "#fff", border: "1px solid var(--border)",
                  borderLeft: `4px solid ${accent}`,
                  borderRadius: 12, padding: "12px 16px",
                  cursor: it.oc_id ? "pointer" : "default",
                  transition: "box-shadow .15s ease, transform .15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "0 6px 18px rgba(1,58,87,0.10)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "none";
                }}
              >
                {/* Ref = número de proforma (PF) */}
                <div style={{ minWidth: 180, flex: "1 1 180px" }}>
                  {it.proforma_codigo ? (
                    <div style={{
                      fontSize: 15, fontWeight: 800, color: "#0B1E3A",
                      fontFamily: "var(--font-mono, monospace)",
                    }}>
                      {it.proforma_codigo}
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", fontStyle: "italic" }}>
                      {es ? "Sin proforma" : "No proforma"}
                    </div>
                  )}
                  <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2, fontSize: 11 }}>
                    {it.client_label || "—"}
                  </div>
                </div>

                {/* Estado */}
                <span style={{
                  padding: "4px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: "rgba(1,58,87,0.07)", color: "#013A57", whiteSpace: "nowrap",
                }}>
                  {ESTADO_LABEL[displayStage(it.estado)] || it.estado}
                </span>

                {/* Días en estado vs promedio (barra de severidad) */}
                <div style={{ minWidth: 170, flex: "0 0 auto" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span className="tabular-nums" style={{
                      fontSize: 17, fontWeight: 800,
                      color: it.stale_state ? "#DC2626" : "#0B1E3A",
                    }}>
                      {it.days_in_state}d
                    </span>
                    <span className="tabular-nums" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      {es ? "en estado" : "in stage"} · {es ? "prom." : "avg"} {it.avg_days != null ? `${it.avg_days}d` : "—"}
                    </span>
                  </div>
                  <div style={{
                    marginTop: 5, height: 4, borderRadius: 99,
                    background: "rgba(11,30,58,0.08)", overflow: "hidden", width: 150,
                  }}>
                    <div style={{
                      height: "100%", borderRadius: 99,
                      width: `${Math.max(6, Math.round(ratio * 33))}%`,
                      background: it.stale_state
                        ? "linear-gradient(90deg,#F59E0B,#DC2626)"
                        : "#0FA3A0",
                    }}/>
                  </div>
                </div>

                {/* Razones */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: "1 1 260px" }}>
                  {it.stale_state && (
                    <span style={{
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: "rgba(220,38,38,0.09)", color: "#DC2626",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}>
                      <IconAlert size={10}/> {es ? "Estancado" : "Stale"}
                    </span>
                  )}
                  {it.missing_proforma && (
                    <span style={{
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: "rgba(180,83,9,0.10)", color: "#B45309",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}>
                      <IconFileText size={10}/> {es ? "Falta proforma" : "No proforma"}
                    </span>
                  )}
                  {it.missing_sap && (
                    <span style={{
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: "rgba(3,105,161,0.09)", color: "#0369A1",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}>
                      <IconTag size={10}/> {es ? "Sin SAP" : "No SAP"}
                    </span>
                  )}
                  {it.missing_oc && (
                    <span style={{
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: "rgba(124,58,237,0.10)", color: "#7C3AED",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}>
                      <IconFolder size={10}/> {es ? "Sin OC" : "No OC"}
                    </span>
                  )}
                </div>

                {/* Creado + chevron */}
                <div style={{
                  marginLeft: "auto", display: "flex", alignItems: "center", gap: 10,
                  color: "var(--text-tertiary)", fontSize: 11.5, whiteSpace: "nowrap",
                }}>
                  {fmtDate(it.created_at)}
                  <span style={{ fontSize: 16, fontWeight: 700 }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
