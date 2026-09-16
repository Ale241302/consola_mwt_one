// frontend/src/components/finanzas/ComisionesCalendario.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-09 · "Calendario de comisiones".
// Responde: ¿cuándo la recibí?, ¿cuándo la debería recibir?, ¿qué está
// pendiente / vencido / en tránsito?  Tabla con filtros (estado, cliente,
// periodo, vence/esparada, recibida, días) + paginación (20 por defecto).
// Consume GET /api/finanzas/comisiones-calendario/
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useMemo } from "react";
import { finanzasApi } from "../../lib/api.js";
import { usePagination, TablePagination } from "../ui/TablePagination.jsx";

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
      type="button" onClick={onClick}
      style={{
        textAlign: "left", cursor: "pointer",
        background: active ? color : "#fff", color: active ? "#fff" : "inherit",
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

const selStyle = {
  padding: "5px 8px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
  fontSize: 12, fontWeight: 600, background: "var(--surface, #fff)", cursor: "pointer",
  color: "var(--text-primary, #0F172A)",
};
const lblStyle = {
  fontSize: 11, display: "flex", flexDirection: "column", gap: 2,
  color: "var(--text-tertiary, #94A3B8)", fontWeight: 600,
};

export default function ComisionesCalendario({ lang }) {
  const es = lang === "es";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState({ estado: "", concepto: "", importador: "", periodo: "", desde: "", hasta: "", recibida: "", dias: "" });
  const set = (k, v) => setQ((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let cancel = false;
    setLoading(true); setError(null);
    finanzasApi.comisionesCalendario()
      .then((d) => { if (!cancel) setData(d); })
      .catch((e) => { if (!cancel) setError(e?.message || "Error"); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const items = data?.items || [];
  const resumen = data?.resumen || {};

  const importadores = useMemo(
    () => [...new Set(items.map((i) => i.importador).filter(Boolean))].sort(),
    [items]);
  const periodos = useMemo(
    () => [...new Set(items.map((i) => i.periodo).filter((p) => p && p !== "—"))].sort().reverse(),
    [items]);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (q.estado && r.estado !== q.estado) return false;
      if (q.concepto && (r.concepto || "COMISION") !== q.concepto) return false;
      if (q.importador && (r.importador || r.cliente) !== q.importador) return false;
      if (q.periodo && r.periodo !== q.periodo) return false;
      const f = r.fecha_esperada ? String(r.fecha_esperada).slice(0, 10) : "";
      if (q.desde && (!f || f < q.desde)) return false;
      if (q.hasta && (!f || f > q.hasta)) return false;
      if (q.recibida === "SI" && !r.fecha_recibida) return false;
      if (q.recibida === "NO" && r.fecha_recibida) return false;
      if (q.dias) {
        const d = r.dias;
        if (d === null || d === undefined) return false;
        if (q.dias === "atraso" && d >= 0) return false;
        if (q.dias === "0-15" && !(d >= 0 && d <= 15)) return false;
        if (q.dias === "16-30" && !(d > 15 && d <= 30)) return false;
        if (q.dias === "31-60" && !(d > 30 && d <= 60)) return false;
        if (q.dias === "60+" && !(d > 60)) return false;
      }
      return true;
    });
  }, [items, q]);

  const pg = usePagination(filtered, { defaultPerPage: 20 });
  const hayFiltro = Object.values(q).some(Boolean);

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
          {/* Tiles = filtro rápido por estado */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
            <Tile title={es ? "Recibidas" : "Received"} n={resumen?.recibidas?.n || 0}
                  monto={resumen?.recibidas?.monto_usd} color={ESTADOS.RECIBIDA.color}
                  active={q.estado === "RECIBIDA"} onClick={() => set("estado", q.estado === "RECIBIDA" ? "" : "RECIBIDA")} />
            <Tile title={es ? "En tránsito" : "In transit"} n={resumen?.en_transito?.n || 0}
                  monto={resumen?.en_transito?.monto_usd} color={ESTADOS.EN_TRANSITO.color}
                  active={q.estado === "EN_TRANSITO"} onClick={() => set("estado", q.estado === "EN_TRANSITO" ? "" : "EN_TRANSITO")} />
            <Tile title={es ? "Por recibir" : "To receive"} n={resumen?.por_recibir?.n || 0}
                  monto={resumen?.por_recibir?.monto_usd} color={ESTADOS.POR_RECIBIR.color}
                  active={q.estado === "POR_RECIBIR"} onClick={() => set("estado", q.estado === "POR_RECIBIR" ? "" : "POR_RECIBIR")} />
            <Tile title={es ? "Vencidas" : "Overdue"} n={resumen?.vencidas?.n || 0}
                  monto={resumen?.vencidas?.monto_usd} color={ESTADOS.VENCIDA.color}
                  active={q.estado === "VENCIDA"} onClick={() => set("estado", q.estado === "VENCIDA" ? "" : "VENCIDA")} />
          </div>

          {/* Totales por concepto (comisión vs arbitraje) */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            {[
              { k: "comision",  label: es ? "Comisión" : "Commission", color: "#334155", bg: "rgba(51,65,85,0.08)" },
              { k: "arbitraje", label: es ? "Arbitraje · MWT opera" : "Arbitrage · MWT operates", color: "#6D28D9", bg: "rgba(109,40,217,0.10)" },
            ].map((c) => {
              const d = data?.por_concepto?.[c.k] || {};
              return (
                <div key={c.k} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: "8px 12px",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, padding: "2px 9px", borderRadius: 999 }}>
                    {c.label}
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
                    ${fmt(d.monto_usd)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)" }}>
                    {d.n || 0}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Filtros */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end",
            padding: "10px 0 14px", borderBottom: "1px solid var(--border, #E2E8F0)", marginBottom: 12,
          }}>
            <label style={lblStyle}>{es ? "Estado" : "Status"}
              <select style={selStyle} value={q.estado} onChange={(e) => set("estado", e.target.value)}>
                <option value="">{es ? "Todos" : "All"}</option>
                {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label style={lblStyle}>{es ? "Concepto" : "Concept"}
              <select style={selStyle} value={q.concepto} onChange={(e) => set("concepto", e.target.value)}>
                <option value="">{es ? "Todos" : "All"}</option>
                <option value="COMISION">{es ? "Comisión" : "Commission"}</option>
                <option value="ARBITRAJE">{es ? "Arbitraje (MWT opera)" : "Arbitrage (MWT operates)"}</option>
              </select>
            </label>
            <label style={lblStyle}>{es ? "Importador" : "Importer"}
              <select style={selStyle} value={q.importador} onChange={(e) => set("importador", e.target.value)}>
                <option value="">{es ? "Todos" : "All"}</option>
                {importadores.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={lblStyle}>{es ? "Periodo" : "Period"}
              <select style={selStyle} value={q.periodo} onChange={(e) => set("periodo", e.target.value)}>
                <option value="">{es ? "Todos" : "All"}</option>
                {periodos.map((p) => <option key={p} value={p}>{periodoLabel(p)}</option>)}
              </select>
            </label>
            <label style={lblStyle}>{es ? "Vence desde" : "Due from"}
              <input type="date" style={selStyle} value={q.desde} onChange={(e) => set("desde", e.target.value)} />
            </label>
            <label style={lblStyle}>{es ? "Vence hasta" : "Due to"}
              <input type="date" style={selStyle} value={q.hasta} onChange={(e) => set("hasta", e.target.value)} />
            </label>
            <label style={lblStyle}>{es ? "Recibida" : "Received"}
              <select style={selStyle} value={q.recibida} onChange={(e) => set("recibida", e.target.value)}>
                <option value="">{es ? "Todas" : "All"}</option>
                <option value="SI">{es ? "Sí" : "Yes"}</option>
                <option value="NO">{es ? "No" : "No"}</option>
              </select>
            </label>
            <label style={lblStyle}>{es ? "Días" : "Days"}
              <select style={selStyle} value={q.dias} onChange={(e) => set("dias", e.target.value)}>
                <option value="">{es ? "Todos" : "All"}</option>
                <option value="atraso">{es ? "Atrasadas" : "Late"}</option>
                <option value="0-15">0–15</option>
                <option value="16-30">16–30</option>
                <option value="31-60">31–60</option>
                <option value="60+">60+</option>
              </select>
            </label>
            {hayFiltro && (
              <button type="button" onClick={() => setQ({ estado: "", concepto: "", importador: "", periodo: "", desde: "", hasta: "", recibida: "", dias: "" })}
                style={{ ...selStyle, color: "var(--brand-primary, #013A57)" }}>
                {es ? "Limpiar" : "Clear"}
              </button>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>{es ? "Estado" : "Status"}</th>
                  <th>{es ? "Concepto" : "Concept"}</th>
                  <th>{es ? "Importador" : "Importer"}</th>
                  <th>PF</th>
                  <th>{es ? "Expediente" : "File"}</th>
                  <th>{es ? "Periodo" : "Period"}</th>
                  <th style={{ textAlign: "right" }}>{es ? "Monto USD" : "Amount"}</th>
                  <th>{es ? "Vence / esperada" : "Due / expected"}</th>
                  <th>{es ? "Recibida" : "Received"}</th>
                  <th style={{ textAlign: "right" }}>{es ? "Días" : "Days"}</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r, i) => {
                  const dias = r.dias;
                  let dTxt = "—", dColor = "var(--text-secondary, #475569)";
                  if (dias !== null && dias !== undefined) {
                    if (dias < 0) { dTxt = `${Math.abs(dias)}d ${es ? "atraso" : "late"}`; dColor = "#DC2626"; }
                    else { dTxt = `${es ? "en" : "in"} ${dias}d`; dColor = dias <= 15 ? "#B45309" : "var(--text-secondary, #475569)"; }
                  }
                  return (
                    <tr key={i}>
                      <td><Chip estado={r.estado} /></td>
                      <td>
                        <span style={{
                          display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                          color: (r.concepto || "COMISION") === "ARBITRAJE" ? "#6D28D9" : "#334155",
                          background: (r.concepto || "COMISION") === "ARBITRAJE" ? "rgba(109,40,217,0.10)" : "rgba(51,65,85,0.08)",
                        }}>
                          {(r.concepto || "COMISION") === "ARBITRAJE" ? (es ? "Arbitraje" : "Arbitrage") : (es ? "Comisión" : "Commission")}
                        </span>
                      </td>
                      <td>{r.importador || r.cliente || "—"}</td>
                      <td className="mono-sm">{r.pf || "—"}</td>
                      <td className="mono-sm" style={{ color: "var(--brand-primary, #013A57)" }}>{r.expediente || "—"}</td>
                      <td className="mono-sm">{periodoLabel(r.periodo)}</td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>${fmt(r.monto_usd)}</td>
                      <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>{fdate(r.fecha_esperada)}</td>
                      <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>{r.fecha_recibida ? fdate(r.fecha_recibida) : "—"}</td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600, color: dColor }}>{dTxt}</td>
                    </tr>
                  );
                })}
                {pg.pageItems.length === 0 && (
                  <tr><td colSpan={10} style={{ color: "var(--text-tertiary, #94A3B8)", padding: "16px 0" }}>
                    {es ? "Sin comisiones para los filtros aplicados." : "No commissions match the filters."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={pg.page} totalPages={pg.totalPages} perPage={pg.perPage}
            setPerPage={pg.setPerPage} setPage={pg.setPage} total={pg.total} lang={lang}
          />
        </>
      )}
    </div>
  );
}
