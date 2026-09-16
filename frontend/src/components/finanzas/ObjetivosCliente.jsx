// =====================================================================
// MWT.ONE · Objetivos y evolución de clientes — Etapa 6 (CEO-only)
// Radiografía real (compras, pedidos, margen, comisiones, pagos, entregas,
// recurrencia) + metas configurables. El semáforo aparece SOLO si hay meta.
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { finanzasApi, clientesApi } from "../../lib/api.js";

const DIMS = [
  ["COMPRAS",    "Compras",    "USD"],
  ["PEDIDOS",    "Pedidos",    null],
  ["MARGEN",     "Margen",     "USD"],
  ["COMISIONES", "Comisiones", "USD"],
  ["PAGOS",      "Pagos",      "USD"],
  ["ENTREGAS",   "Entregas",   null],
];
const META = Object.fromEntries(DIMS.map((d) => [d[0], d]));

const ESTADO = {
  CUMPLIDO:  { bg: "rgba(14,138,109,0.10)", fg: "#0E8A6D", es: "cumplido",  en: "met",      bar: "#0E8A6D" },
  EN_RIESGO: { bg: "rgba(180,83,9,0.10)",   fg: "#B45309", es: "en riesgo", en: "at risk",  bar: "#B45309" },
  ATRASADO:  { bg: "rgba(220,38,38,0.10)",  fg: "#DC2626", es: "atrasado",  en: "behind",   bar: "#DC2626" },
  SIN_META:  { bg: "rgba(100,116,139,0.10)",fg: "#64748B", es: "sin meta",  en: "no goal",  bar: "#CBD5E1" },
};

const num = (v, ccy) => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return ccy
    ? new Intl.NumberFormat("es-CR", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n)
    : new Intl.NumberFormat("es-CR").format(n);
};

const selStyle = {
  padding: "5px 8px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
  fontSize: 12, fontWeight: 600, background: "var(--surface, #fff)", cursor: "pointer",
  color: "var(--text-primary, #0F172A)",
};

function DimCard({ dim, d, draft, onDraft, onCommit, es }) {
  const st = ESTADO[d.estado] || ESTADO.SIN_META;
  const [, label, ccy] = META[dim] || [dim, dim, null];
  const pct = d.pct != null ? Math.max(0, Math.min(150, d.pct)) : null;
  return (
    <div style={{
      border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: 12,
      background: "#fff", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)", fontSize: 12.5 }}>{label}</div>
        <span style={{ padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: st.bg, color: st.fg }}>
          {es ? st.es : st.en}
        </span>
      </div>

      <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
        {num(d.real, ccy)}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)", fontWeight: 600 }}>
          {es ? "Meta" : "Goal"}
        </span>
        <input type="number" value={draft ?? ""}
               onChange={(e) => onDraft(e.target.value)}
               onBlur={onCommit}
               placeholder="—"
               style={{
                 width: 110, textAlign: "right", padding: "4px 8px",
                 border: "1px solid var(--border, #CBD5E1)", borderRadius: 6, fontSize: 12,
               }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--bg-alt, #F1F5F9)", overflow: "hidden" }}>
          <div style={{ width: `${pct != null ? Math.min(100, pct) : 0}%`, height: "100%", background: st.bar, transition: "width .3s" }} />
        </div>
        <span className="tabular-nums" style={{ fontSize: 11.5, fontWeight: 700, color: st.fg, minWidth: 42, textAlign: "right" }}>
          {d.pct != null ? `${d.pct}%` : "—"}
        </span>
      </div>
    </div>
  );
}

export default function ObjetivosCliente({ lang = "es" }) {
  const es = lang !== "en";
  const [clientes, setClientes] = useState([]);
  const [cid, setCid] = useState("");
  const [tipo, setTipo] = useState("ANIO");
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    clientesApi.list({ limit: 200 }).then((d) => {
      const rs = Array.isArray(d) ? d : (d?.results || []);
      setClientes(rs);
      setCid((prev) => prev || (rs[0] ? String(rs[0].id) : ""));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!cid) return;
    try {
      const d = await finanzasApi.clienteObjetivos(cid, tipo);
      setData(d);
      const dr = {};
      (d?.dimensiones || []).forEach((x) => { dr[x.dimension] = x.meta ?? ""; });
      setDrafts(dr);
    } catch { setData(null); }
  }, [cid, tipo]);
  useEffect(() => { load(); }, [load]);

  const guardar = async (dim) => {
    const v = drafts[dim];
    const periodo = data?.periodo;
    if (v === "" || v == null || !periodo) return;
    setMsg(null);
    try {
      await finanzasApi.metaClienteSet({
        client_id: cid, dimension: dim, periodo_tipo: tipo, periodo, monto: Number(v),
      });
      setMsg(es ? "Meta guardada" : "Goal saved");
      await load();
    } catch (e) { setMsg(e?.body?.detail || "Error"); }
  };

  const rec = data?.recurrencia || {};
  const series = data?.series || [];

  return (
    <div className="card card-pad-lg" style={{ marginBottom: 24 }}>
      <div className="flex ai-center jc-between" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700 }}>
            {es ? "OBJETIVOS Y EVOLUCIÓN DE CLIENTES" : "CLIENT GOALS & EVOLUTION"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #475569)", marginTop: 2 }}>
            {es ? "Avance real vs meta por dimensión. El semáforo aparece solo si hay meta." : "Actual vs goal per dimension."}
          </div>
        </div>
        <div className="flex ai-center" style={{ flexWrap: "wrap", gap: 8 }}>
          <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ ...selStyle, maxWidth: 260 }}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.razon_social || c.nombre_comercial || c.id}</option>
            ))}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={selStyle}>
            <option value="MES">{es ? "Mensual" : "Monthly"}</option>
            <option value="TRIMESTRE">{es ? "Trimestral" : "Quarterly"}</option>
            <option value="ANIO">{es ? "Anual" : "Annual"}</option>
          </select>
        </div>
      </div>

      {msg && <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 8 }}>{msg}</div>}

      {!cid ? (
        <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>
          {es ? "Sin clientes." : "No clients."}
        </div>
      ) : !data ? (
        <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>…</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <span style={{ padding: "3px 10px", borderRadius: 999, background: "var(--bg-alt, #F1F5F9)", fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary, #475569)" }}>
              {es ? "Periodo" : "Period"}: <b>{data.periodo || "—"}</b>
            </span>
            <span style={{ padding: "3px 10px", borderRadius: 999, background: "var(--bg-alt, #F1F5F9)", fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary, #475569)" }}>
              {es ? "Recurrencia" : "Recurrence"}: <b>{rec.pct != null ? `${rec.pct}%` : "—"}</b>
              {rec.meses_con_pedidos != null ? ` (${rec.meses_con_pedidos}/${rec.meses_con_actividad} ${es ? "meses" : "mo"})` : ""}
            </span>
          </div>

          {/* Metas por dimensión (tarjetas) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginBottom: 18 }}>
            {(data.dimensiones || []).map((d) => (
              <DimCard key={d.dimension} dim={d.dimension} d={d} es={es}
                       draft={drafts[d.dimension]}
                       onDraft={(v) => setDrafts((s) => ({ ...s, [d.dimension]: v }))}
                       onCommit={() => guardar(d.dimension)} />
            ))}
          </div>

          {/* Evolución */}
          <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700, marginBottom: 8 }}>
            {es ? "EVOLUCIÓN" : "EVOLUTION"}
          </div>
          {series.length === 0 ? (
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Sin actividad." : "No activity."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>{es ? "Periodo" : "Period"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Pedidos" : "Orders"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Compras" : "Purchases"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Margen" : "Margin"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Comisiones" : "Commissions"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Pagos" : "Payments"}</th>
                    <th style={{ textAlign: "right" }}>{es ? "Entregas" : "Deliveries"}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.periodo}>
                      <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>{s.periodo}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{s.pedidos}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{num(s.compras, "USD")}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{num(s.margen, "USD")}</td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>{num(s.comisiones, "USD")}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{num(s.pagos, "USD")}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{s.entregas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>{data.nota}</div>
        </>
      )}
    </div>
  );
}
