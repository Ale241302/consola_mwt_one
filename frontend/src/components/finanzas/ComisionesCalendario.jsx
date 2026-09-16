// frontend/src/components/finanzas/ComisionesCalendario.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-09 · "Calendario de comisiones".
// Responde de un vistazo: ¿cuándo la recibí?, ¿cuándo la debería recibir?,
// ¿qué está pendiente / vencido / en tránsito?
// Consume GET /api/finanzas/comisiones-calendario/
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useMemo } from "react";
import { finanzasApi } from "../../lib/api.js";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function periodoLabel(p) {
  if (!p || p === "—") return "—";
  const [y, m] = String(p).split("-");
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${MESES[i]} ${y}` : p;
}

function fdate(s) {
  if (!s) return "—";
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return String(s).slice(0, 10);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

const ESTADOS = {
  RECIBIDA:    { label: "Recibida",    color: "#0E8A6D", bg: "rgba(14,138,109,0.10)" },
  EN_TRANSITO: { label: "En tránsito", color: "#1D6FB8", bg: "rgba(29,111,184,0.10)" },
  POR_RECIBIR: { label: "Por recibir", color: "#6B7280", bg: "rgba(107,114,128,0.10)" },
  VENCIDA:     { label: "Vencida",     color: "#DC2626", bg: "rgba(220,38,38,0.10)" },
};

function Chip({ estado }) {
  const c = ESTADOS[estado] || ESTADOS.POR_RECIBIR;
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, color: c.color, background: c.bg,
    }}>{c.label}</span>
  );
}

function Tile({ title, n, monto, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left", cursor: "pointer",
        background: active ? color : "#fff",
        color: active ? "#fff" : "inherit",
        border: `1.5px solid ${active ? color : "var(--border, #E2E8F0)"}`,
        borderRadius: 12, padding: "12px 14px", transition: "all .12s",
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
        color: active ? "rgba(255,255,255,0.85)" : "var(--text-tertiary, #94A3B8)",
        textTransform: "uppercase",
      }}>{title}</div>
      <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: active ? "#fff" : color }}>
        ${fmt(monto)}
      </div>
      <div style={{ fontSize: 11, marginTop: 2, color: active ? "rgba(255,255,255,0.85)" : "var(--text-secondary, #475569)" }}>
        {n} comisión{n === 1 ? "" : "es"}
      </div>
    </button>
  );
}

export default function ComisionesCalendario({ lang }) {
  const es = lang === "es";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState(null); // null = todas

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    finanzasApi
      .comisionesCalendario()
      .then((d) => { if (!cancel) setData(d); })
      .catch((e) => { if (!cancel) setError(e?.message || "Error"); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const items = data?.items || [];
  const resumen = data?.resumen || {};
  const visibles = useMemo(
    () => (filtro ? items.filter((i) => i.estado === filtro) : items),
    [items, filtro]
  );

  return (
    <div style={{
      marginTop: 16, background: "#fff", border: "1px solid var(--border, #E2E8F0)",
      borderRadius: 12, padding: 18,
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
          {es ? "Calendario de comisiones" : "Commission calendar"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary, #475569)", marginTop: 2 }}>
          {es
            ? "¿Cuándo la recibí, cuándo la debería recibir y qué está pendiente o vencido? Ordenado por urgencia."
            : "When it was received, when it should arrive, and what is pending or overdue."}
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: 13, padding: "18px 0" }}>
          {es ? "Cargando calendario…" : "Loading…"}
        </div>
      ) : error ? (
        <div style={{ color: "var(--critical, #DC2626)", fontSize: 13 }}>{error}</div>
      ) : (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))",
            gap: 10, marginBottom: 14,
          }}>
            <Tile title={es ? "Recibidas" : "Received"} n={resumen?.recibidas?.n || 0}
                  monto={resumen?.recibidas?.monto_usd} color={ESTADOS.RECIBIDA.color}
                  active={filtro === "RECIBIDA"} onClick={() => setFiltro(filtro === "RECIBIDA" ? null : "RECIBIDA")} />
            <Tile title={es ? "En tránsito" : "In transit"} n={resumen?.en_transito?.n || 0}
                  monto={resumen?.en_transito?.monto_usd} color={ESTADOS.EN_TRANSITO.color}
                  active={filtro === "EN_TRANSITO"} onClick={() => setFiltro(filtro === "EN_TRANSITO" ? null : "EN_TRANSITO")} />
            <Tile title={es ? "Por recibir" : "To receive"} n={resumen?.por_recibir?.n || 0}
                  monto={resumen?.por_recibir?.monto_usd} color={ESTADOS.POR_RECIBIR.color}
                  active={filtro === "POR_RECIBIR"} onClick={() => setFiltro(filtro === "POR_RECIBIR" ? null : "POR_RECIBIR")} />
            <Tile title={es ? "Vencidas" : "Overdue"} n={resumen?.vencidas?.n || 0}
                  monto={resumen?.vencidas?.monto_usd} color={ESTADOS.VENCIDA.color}
                  active={filtro === "VENCIDA"} onClick={() => setFiltro(filtro === "VENCIDA" ? null : "VENCIDA")} />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>{es ? "Estado" : "Status"}</th>
                  <th>{es ? "Cliente" : "Client"}</th>
                  <th>PF</th>
                  <th>{es ? "Expediente" : "File"}</th>
                  <th>{es ? "Periodo" : "Period"}</th>
                  <th style={{ textAlign: "right" }}>{es ? "Monto USD" : "Amount USD"}</th>
                  <th>{es ? "Vence / esperada" : "Due / expected"}</th>
                  <th>{es ? "Recibida" : "Received"}</th>
                  <th style={{ textAlign: "right" }}>{es ? "Días" : "Days"}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r, i) => {
                  const dias = r.dias;
                  let dTxt = "—", dColor = "var(--text-secondary, #475569)";
                  if (dias !== null && dias !== undefined) {
                    if (dias < 0) { dTxt = `${Math.abs(dias)}d ${es ? "atraso" : "late"}`; dColor = "#DC2626"; }
                    else { dTxt = `${es ? "en" : "in"} ${dias}d`; dColor = dias <= 15 ? "#B45309" : "var(--text-secondary, #475569)"; }
                  }
                  return (
                    <tr key={i}>
                      <td><Chip estado={r.estado} /></td>
                      <td>{r.cliente || "—"}</td>
                      <td className="mono-sm">{r.pf || "—"}</td>
                      <td className="mono-sm" style={{ color: "var(--brand-primary, #013A57)" }}>{r.expediente || "—"}</td>
                      <td className="mono-sm">{periodoLabel(r.periodo)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>
                        ${fmt(r.monto_usd)}
                      </td>
                      <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
                        {fdate(r.fecha_esperada)}
                      </td>
                      <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
                        {r.fecha_recibida ? fdate(r.fecha_recibida) : "—"}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600, color: dColor }}>
                        {dTxt}
                      </td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={9} style={{ color: "var(--text-tertiary, #94A3B8)", padding: "16px 0" }}>
                    {es ? "Sin comisiones en este estado." : "No commissions in this status."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
