// =====================================================================
// MWT.ONE · Objetivos y evolución de clientes — Etapa 6 (CEO-only)
// Radiografía real (compras, pedidos, margen, comisiones, pagos, entregas,
// recurrencia) + metas configurables. El semáforo aparece SOLO si hay meta.
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { finanzasApi, clientesApi } from "../../lib/api.js";

const DIMS = [
  ["COMPRAS",    "Compras"],
  ["PEDIDOS",    "Pedidos"],
  ["MARGEN",     "Margen"],
  ["COMISIONES", "Comisiones"],
  ["PAGOS",      "Pagos"],
  ["ENTREGAS",   "Entregas"],
];
const ESTADO = {
  CUMPLIDO:  { bg: "var(--success-bg, #DCFCE7)", fg: "var(--success-fg, #166534)", es: "cumplido", en: "met" },
  EN_RIESGO: { bg: "var(--warning-bg, #FEF3C7)", fg: "var(--warning-fg, #92400E)", es: "en riesgo", en: "at risk" },
  ATRASADO:  { bg: "var(--danger-bg, #FEE2E2)",  fg: "var(--danger-fg, #991B1B)",  es: "atrasado", en: "behind" },
  SIN_META:  { bg: "var(--surface-hover, #F1F5F9)", fg: "var(--text-tertiary, #64748B)", es: "sin meta", en: "no goal" },
};

const num = (v, ccy) => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return ccy
    ? new Intl.NumberFormat("es-CR", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n)
    : new Intl.NumberFormat("es-CR").format(n);
};

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
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700 }}>
          {es ? "OBJETIVOS Y EVOLUCIÓN DE CLIENTES" : "CLIENT GOALS & EVOLUTION"}
        </div>
        <div className="flex ai-center gap-2" style={{ flexWrap: "wrap" }}>
          <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ fontSize: 12, maxWidth: 260 }}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.razon_social || c.nombre_comercial || c.id}</option>
            ))}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ fontSize: 12 }}>
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
          <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
            {es ? "Periodo evaluado" : "Evaluated period"}: <b>{data.periodo || "—"}</b>
            {" · "}{es ? "recurrencia" : "recurrence"}: <b>{rec.pct != null ? `${rec.pct}%` : "—"}</b>
            {rec.meses_con_pedidos != null ? ` (${rec.meses_con_pedidos}/${rec.meses_con_actividad} ${es ? "meses" : "mo"})` : ""}
          </div>

          {/* Metas por dimensión */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                <th style={{ padding: "4px 6px" }}>{es ? "Dimensión" : "Dimension"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Real" : "Actual"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Meta" : "Goal"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>%</th>
                <th style={{ padding: "4px 6px" }}>{es ? "Estado" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {(data.dimensiones || []).map((d) => {
                const st = ESTADO[d.estado] || ESTADO.SIN_META;
                const ccy = ["COMPRAS", "MARGEN", "COMISIONES", "PAGOS"].includes(d.dimension) ? "USD" : null;
                return (
                  <tr key={d.dimension} style={{ borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                    <td style={{ padding: "6px", fontWeight: 600 }}>
                      {(DIMS.find((x) => x[0] === d.dimension) || [d.dimension, d.dimension])[1]}
                    </td>
                    <td className="tabular-nums" style={{ padding: "6px", textAlign: "right" }}>{num(d.real, ccy)}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>
                      <input type="number" value={drafts[d.dimension] ?? ""}
                             onChange={(e) => setDrafts((s) => ({ ...s, [d.dimension]: e.target.value }))}
                             onBlur={() => guardar(d.dimension)}
                             placeholder="—" style={{ width: 110, textAlign: "right" }} />
                    </td>
                    <td className="tabular-nums" style={{ padding: "6px", textAlign: "right" }}>
                      {d.pct != null ? `${d.pct}%` : "—"}
                    </td>
                    <td style={{ padding: "6px" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10,
                        fontWeight: 700, background: st.bg, color: st.fg,
                      }}>{es ? st.es : st.en}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Evolución */}
          <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
            {es ? "EVOLUCIÓN" : "EVOLUTION"}
          </div>
          {series.length === 0 ? (
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Sin actividad." : "No activity."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                    <th style={{ padding: "4px 6px" }}>{es ? "Periodo" : "Period"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Pedidos" : "Orders"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Compras" : "Purchases"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Margen" : "Margin"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Comisiones" : "Commissions"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Pagos" : "Payments"}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Entregas" : "Deliveries"}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.periodo} style={{ borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                      <td style={{ padding: "5px", fontWeight: 600 }}>{s.periodo}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{s.pedidos}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{num(s.compras, "USD")}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{num(s.margen, "USD")}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{num(s.comisiones, "USD")}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{num(s.pagos, "USD")}</td>
                      <td className="tabular-nums" style={{ padding: "5px", textAlign: "right" }}>{s.entregas}</td>
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
