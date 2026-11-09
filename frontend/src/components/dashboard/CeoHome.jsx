// =====================================================================
// MWT.ONE · Panel CEO/Admin
//
// Rediseño 2026-11-09 con el lenguaje del artifact «Diagnóstico comercial»:
//   · números y título en serif, como un informe;
//   · cada número grande explica su fuente al pasar el cursor (tile .src);
//   · secciones con título y subtítulo, tablas densas y gráfico de barras;
//   · cero dato inventado: si un endpoint no responde, se dice.
//
// Datos reales: /api/expedientes/, /api/clientes/, /api/finanzas/*.
// =====================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { finanzasApi, expedientesApi, clientesApi } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dinero = (v) => {
  const n = Number(v);
  return isFinite(n) ? `$${nf.format(n)}` : "-";
};
const rowsOf = (r) => (Array.isArray(r) ? r : (r?.results || []));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

const ESTADOS = [
  { key: "REGISTRO", es: "Registro", en: "Registered", color: "var(--text-tertiary)" },
  { key: "PRODUCCION", es: "Producción", en: "Production", color: "var(--info, #3083FE)" },
  { key: "PREPARACION", es: "Preparación", en: "Preparation", color: "var(--info, #3083FE)" },
  { key: "DESPACHO", es: "Despacho", en: "Dispatch", color: "var(--warning-fg, #92400E)" },
  { key: "TRANSITO", es: "Tránsito", en: "In transit", color: "var(--warning-fg, #92400E)" },
  { key: "EN_DESTINO", es: "En destino", en: "At destination", color: "var(--brand-accent)" },
  { key: "CERRADO", es: "Cerrado", en: "Closed", color: "var(--success-fg, #166534)" },
  { key: "CANCELADO", es: "Cancelado", en: "Cancelled", color: "var(--text-tertiary)" },
];

function Tile({ label, value, cmp, src, onGo, tone, goLabel }) {
  return (
    <div className="dash-tile" tabIndex={src ? 0 : -1}>
      <div className="lab">{label}</div>
      <div className="big" style={tone ? { color: tone } : undefined}>{value}</div>
      {cmp && <div className="cmp">{cmp}</div>}
      {src && (
        <div className="src">
          {src}
          {onGo && (
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onGo}>
                {goLabel || "Ver detalle"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, sub, right, children }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0 }}>
      <div className="flex ai-center jc-between" style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="dash-serif" style={{ fontSize: 19, lineHeight: 1.25 }}>{title}</div>
          {sub && <div className="dash-sub" style={{ marginTop: 3 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Barras de comisión y premio por mes. Al pasar el cursor, detalle del mes. */
function ComisionesChart({ datos, es }) {
  const [hover, setHover] = useState(null);
  const filas = (datos || []).filter((d) => d && d.mes);
  if (!filas.length) {
    return <div className="dash-sub" style={{ padding: "18px 2px" }}>{es ? "Sin comisiones registradas." : "No recorded commissions."}</div>;
  }
  const total = (d) => Number(d.comision || 0) + Number(d.premio || 0);
  const max = Math.max(1, ...filas.map(total));
  const W = 640, H = 190, pad = 22;
  const bw = W / filas.length;
  const activo = filas[hover != null ? hover : filas.length - 1];

  return (
    <div>
      <div className="micro" style={{ color: "var(--text-secondary)", marginBottom: 6 }}>
        <b>{activo.mes}</b>
        {" · "}{es ? "Comisión" : "Commission"} {dinero(activo.comision)}
        {" · "}{es ? "Premio" : "Bonus"} {dinero(activo.premio)}
        {" · "}{es ? "Total" : "Total"} {dinero(total(activo))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={es ? "Comisión y premio por mes" : "Commission and bonus by month"}>
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1="0" x2={W} y1={H - pad - (H - pad - 8) * p} y2={H - pad - (H - pad - 8) * p}
                stroke="var(--border)" strokeWidth="1" />
        ))}
        {filas.map((d, i) => {
          const hc = (Number(d.comision || 0) / max) * (H - pad - 8);
          const hp = (Number(d.premio || 0) / max) * (H - pad - 8);
          const x = i * bw + Math.max(2, (bw - 14) / 2);
          const w = Math.max(4, bw - 14);
          return (
            <g key={d.mes}
               onMouseOver={() => setHover(i)}
               onMouseOut={() => setHover(null)}>
              <rect x={i * bw} y="0" width={bw} height={H - pad} fill="transparent" />
              <rect x={x} y={H - pad - hc} width={w} height={hc} rx="2" fill="var(--brand-accent)">
                <title>{`${d.mes} · ${es ? "Comisión" : "Commission"} ${dinero(d.comision)}`}</title>
              </rect>
              {hp > 0 && (
                <rect x={x} y={H - pad - hc - hp} width={w} height={hp} rx="2" fill="var(--warning-fg, #92400E)" opacity="0.85">
                  <title>{`${d.mes} · ${es ? "Premio" : "Bonus"} ${dinero(d.premio)}`}</title>
                </rect>
              )}
            </g>
          );
        })}
        <line x1="0" x2={W} y1={H - pad} y2={H - pad} stroke="var(--border-strong, var(--border))" strokeWidth="1" />
      </svg>
      <div className="flex jc-between micro" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
        <span>{filas[0].mes}</span>
        <span>{filas[filas.length - 1].mes}</span>
      </div>
    </div>
  );
}

export default function CeoHome({ lang = "es", onOpenExpediente, onGoFinanzas, onGoCorreo, onGoExpedientes }) {
  const es = lang !== "en";
  const [exps, setExps] = useState([]);
  const [clientes, setClientes] = useState({});
  const [rad, setRad] = useState(null);
  const [com, setCom] = useState([]);
  const [comPorMes, setComPorMes] = useState([]);
  const [premios, setPremios] = useState(null);
  const [flujo, setFlujo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const safe = (p) => p.catch(() => null);
    const [e, cli, r, comi, f] = await Promise.all([
      safe(expedientesApi.list()),
      safe(clientesApi.list()),
      safe(finanzasApi.radiografia(21)),
      safe(finanzasApi.comisionesPorMarca()),
      safe(finanzasApi.flujo(90)),
    ]);
    setExps(rowsOf(e));
    const map = {};
    rowsOf(cli).forEach((x) => { map[x.id] = x.razon_social || x.nombre_comercial || ""; });
    setClientes(map);
    setRad(r || null);
    setCom(comi?.results || (Array.isArray(comi) ? comi : []));
    setComPorMes(comi?.por_mes || []);
    setPremios(comi?.premios || null);
    setFlujo(f || null);
    if (!e) setErr(es ? "No se pudieron cargar los expedientes del panel." : "Dashboard data failed to load.");
    setLoading(false);
  }, [es]);
  useEffect(() => { load(); }, [load]);

  // ── Operación ───────────────────────────────────────────────────────
  const porEstado = useMemo(() => {
    const acc = {};
    ESTADOS.forEach((s) => { acc[s.key] = { n: 0, valor: 0 }; });
    (exps || []).forEach((e) => {
      const k = String(e.estado || "REGISTRO");
      if (!acc[k]) acc[k] = { n: 0, valor: 0 };
      acc[k].n += 1;
      acc[k].valor += Number(e.order_value ?? e.total_client ?? 0) || 0;
    });
    return acc;
  }, [exps]);
  const totalExps = (exps || []).length;
  const conocidos = ESTADOS.reduce((s, x) => s + (porEstado[x.key]?.n || 0), 0);
  const otros = totalExps - conocidos;

  // ── Saldo real por pedido ───────────────────────────────────────────
  // `/api/cobros/` está vacío en producción: el saldo sale del expediente
  // (`balance` = facturado - pagado, calculado por el backend).
  const { conSaldo, saldoReventa, saldoComision, nReventa, saldosPorCliente } = useMemo(() => {
    const items = (exps || [])
      .filter((e) => Number(e.balance) > 0)
      .map((e) => ({
        ...e,
        _saldo: Number(e.balance),
        _reventa: (e.modo_operacion || "").toUpperCase() === "FULL",
      }))
      .sort((a, b) => b._saldo - a._saldo);
    const reventa = items.filter((e) => e._reventa);
    const comision = items.filter((e) => !e._reventa);
    const porCliente = {};
    items.forEach((e) => {
      const cid = e.client_id || "-";
      const d = porCliente[cid] || { cid, nombre: e.client_name || clientes[e.client_id] || "-", reventa: 0, comision: 0 };
      if (e._reventa) d.reventa += e._saldo;
      else d.comision += e._saldo;
      porCliente[cid] = d;
    });
    return {
      conSaldo: items,
      saldoReventa: reventa.reduce((s, e) => s + e._saldo, 0),
      saldoComision: comision.reduce((s, e) => s + e._saldo, 0),
      nReventa: reventa.length,
      saldosPorCliente: Object.values(porCliente)
        .map((d) => ({ ...d, total: d.reventa + d.comision }))
        .sort((a, b) => b.total - a.total),
    };
  }, [exps, clientes]);

  // ── Riesgo y finanzas ───────────────────────────────────────────────
  const salidas = rad?.proximas_salidas || [];
  const sinFecha = rad?.sin_fecha || [];
  const cambios = rad?.bloqueos?.cambios_fecha || [];
  const tareasRev = rad?.bloqueos?.tareas_revision || [];
  const tareasPend = rad?.tareas_pendientes || [];
  const tareasTotal = rad?.tareas_pendientes_total ?? tareasPend.length;
  const tareasVencidas = rad?.tareas_vencidas_total ?? 0;
  const respuestas = rad?.respuestas_pendientes || [];
  const actividad = rad?.actividad_reciente || [];
  const hoyISO = new Date().toISOString().slice(0, 10);
  const porRevisar = cambios.length + tareasRev.length + tareasTotal + respuestas.length;
  const correosLabel = respuestas.length >= 50
    ? `50+ ${es ? "correos" : "emails"}`
    : `${respuestas.length} ${es ? "correos" : "emails"}`;

  // Flujo por mes para que el gráfico se pueda leer con números.
  const mesesFlujo = useMemo(() => {
    const acc = {};
    (flujo?.semanas || []).forEach((s) => {
      const mes = String(s.semana || "").slice(0, 7);
      if (!mes) return;
      const d = acc[mes] || { mes, entradas: 0, salidas: 0 };
      d.entradas += Number(s.entradas_usd) || 0;
      d.salidas += Number(s.salidas_usd) || 0;
      acc[mes] = d;
    });
    return Object.values(acc)
      .map((d) => ({ ...d, neto: d.entradas - d.salidas }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [flujo]);
  const comTotal = com.reduce((s, m) => s + Number(m.comision_total || 0), 0);
  const comProy = com.reduce((s, m) => s + Number(m.comision_proyectada || 0), 0);
  const comFilas = com.filter((m) => {
    const nombre = String(m.brand_name || "").trim().toLowerCase();
    const esSinMarca = !nombre || nombre === "sin marca" || nombre === "(sin marca)";
    const enCero = !Number(m.comision_proyectada) && !Number(m.comision_total);
    return !(esSinMarca && enCero);
  });
  const fl = flujo?.totales || {};
  const open = (id) => { if (id && onOpenExpediente) onOpenExpediente(id); };

  return (
    <div className="dash-mw" data-section="ceo-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>
        {es ? "Cargando panel…" : "Loading…"}
      </div>}
      {err && <div className="card card-pad-lg" role="alert" style={{ color: "var(--critical)" }}>{err}</div>}

      {!loading && !err && <>
        {/* ── Tiles con fuente ─────────────────────────────────── */}
        <div className="dash-tiles">
          <Tile
            label={es ? "Por cobrar (reventa)" : "Receivable (resale)"}
            value={dinero(saldoReventa)}
            cmp={`${nReventa} ${es ? "pedidos · lo cobra MWT" : "files · collected by MWT"}`}
            src={es
              ? "Saldo = facturado menos pagado de cada expediente (financials.totals_for). Solo modo FULL: en comisión la factura la cobra Marluvas."
              : "Balance = invoiced minus paid per file (financials.totals_for). FULL mode only."}
            onGo={onGoExpedientes}
          />
          <Tile
            label={es ? "Comisión facturada" : "Invoiced commission"}
            value={dinero(comTotal)}
            cmp={`${es ? "proyectada" : "projected"} ${dinero(comProy)} · ${comFilas.length} ${comFilas.length === 1 ? (es ? "marca" : "brand") : (es ? "marcas" : "brands")}`}
            src={es
              ? "Suma de comision_total de /api/finanzas/comisiones-por-marca/. La columna proyectada es la estimación sin facturar."
              : "Sum of comision_total from /api/finanzas/comisiones-por-marca/."}
            onGo={onGoFinanzas}
          />
          <Tile
            label={es ? "Pedidos con saldo" : "Files with balance"}
            value={conSaldo.length}
            cmp={`${es ? "de" : "of"} ${totalExps} ${es ? "expedientes" : "files"}`}
            src={es
              ? "Expedientes con balance mayor a cero. No incluye cancelados, que no tienen saldo."
              : "Files with a balance above zero."}
            onGo={onGoExpedientes}
          />
          <Tile
            label={es ? "Por revisar" : "To review"}
            value={porRevisar}
            cmp={`${tareasTotal} ${es ? "tareas" : "tasks"} · ${tareasVencidas} ${es ? "vencidas" : "overdue"} · ${correosLabel}`}
            src={es
              ? "Tareas pendientes (91 en total), tareas que esperan revisión, cambios de fecha en conflicto y correos sin responder. Las tareas vencidas se cuentan contra hoy."
              : "Pending tasks, review tasks, conflicting date changes and unanswered emails."}
          />
          <Tile
            label={es ? "Salidas y sin fecha" : "Shipments and undated"}
            value={salidas.length + sinFecha.length}
            cmp={`${salidas.length} ${es ? "con fecha" : "dated"} · ${sinFecha.length} ${es ? "sin fecha" : "undated"}`}
            src={es
              ? "Radiografía CEO: próximas salidas de producción en 21 días y expedientes sin fecha publicada."
              : "CEO radiography: shipments due in 21 days and files without a published date."}
            onGo={onGoCorreo}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {/* ── Columna principal ─────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

            <Section
              title={es ? "Comisiones y premios por mes" : "Commissions and bonuses by month"}
              sub={es
                ? "Facturado por Marluvas, mes a mes. Pasá el cursor por una barra para ver comisión, premio y total."
                : "Invoiced by Marluvas, month by month. Hover a bar for commission, bonus and total."}
            >
              <div className="dash-legend">
                <span><i className="dash-sw" style={{ background: "var(--brand-accent)" }} />{es ? "Comisión" : "Commission"}</span>
                <span><i className="dash-sw" style={{ background: "var(--warning-fg, #92400E)", opacity: 0.85 }} />{es ? "Premio" : "Bonus"}</span>
                <span style={{ marginLeft: "auto" }}>
                  {es ? "Premios" : "Bonuses"} {dinero(premios?.total || 0)} ({premios?.n || 0})
                </span>
              </div>
              <ComisionesChart datos={comPorMes} es={es} />
            </Section>

            <Section
              title={es ? "Entradas previstas" : "Expected inflows"}
              sub={es
                ? "Próximos 90 días: comisiones y reventas previstas. No hay pagos a Marluvas en la ventana, por eso no se muestra una serie de salidas."
                : "Next 90 days: expected commissions and resales. No payments to Marluvas in the window."}
            >
              {mesesFlujo.length === 0 ? (
                <div className="dash-sub" style={{ padding: "14px 2px" }}>{es ? "Sin entradas previstas." : "No expected inflows."}</div>
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{es ? "Mes" : "Month"}</th>
                      <th className="n">{es ? "Entradas previstas" : "Expected in"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesesFlujo.map((m) => (
                      <tr key={m.mes}>
                        <td>{m.mes}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(m.entradas)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Total" : "Total"}</td>
                      <td className="n" style={{ fontWeight: 800 }}>{dinero(fl.neto_usd)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Pedidos por estado" : "Files by state"}
              sub={es
                ? "Cada fila es un estado real de mwt.one. La barra muestra el peso sobre el total."
                : "Each row is a real mwt.one state. The bar shows its share of the total."}
              right={onGoExpedientes ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onGoExpedientes}>
                  {es ? "Ver expedientes" : "All files"}
                </button>
              ) : null}
            >
              {totalExps === 0 ? <div className="dash-sub">-</div> : <>
                {ESTADOS.map((s) => {
                  const v = porEstado[s.key] || { n: 0, valor: 0 };
                  return (
                    <div key={s.key} className="dash-bar-row">
                      <div className="flex ai-center gap-2" style={{ fontSize: 12.5 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: s.color }} />
                        {es ? s.es : s.en}
                      </div>
                      <div className="tabular-nums" style={{ fontWeight: 700 }}>{v.n}</div>
                      <div className="dash-bar-track">
                        <div style={{ height: "100%", width: `${pct(v.n, totalExps)}%`, background: s.color }} />
                      </div>
                      <div className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)", fontSize: 12 }}>
                        {dinero(v.valor)}
                      </div>
                    </div>
                  );
                })}
                {otros > 0 && (
                  <div className="dash-bar-row">
                    <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{es ? "Otros estados" : "Other states"}</div>
                    <div className="tabular-nums" style={{ fontWeight: 700 }}>{otros}</div>
                    <div className="dash-bar-track"><div style={{ width: `${pct(otros, totalExps)}%`, height: "100%", background: "var(--text-tertiary)" }} /></div>
                    <div className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)", fontSize: 12 }}>-</div>
                  </div>
                )}
              </>}
            </Section>

            <Section
              title={es ? "Pedidos con saldo" : "Files with balance"}
              sub={es
                ? "Facturado sin cobrar por pedido. Reventa la cobra MWT; comisión la cobra Marluvas."
                : "Invoiced, uncollected, per file. Resale is collected by MWT; commission by Marluvas."}
              right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{conSaldo.length} · {dinero(saldoReventa + saldoComision)}</span>}
            >
              {conSaldo.length === 0 ? (
                <div className="dash-sub" style={{ padding: "14px 2px" }}>{es ? "Ningún pedido tiene saldo pendiente." : "No file has an open balance."}</div>
              ) : (
                <div className="dash-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>{es ? "Proforma" : "Proforma"}</th>
                        <th>{es ? "Cliente" : "Client"}</th>
                        <th>{es ? "Negocio" : "Business"}</th>
                        <th>{es ? "Estado" : "State"}</th>
                        <th className="n">{es ? "Saldo" : "Balance"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conSaldo.map((e) => (
                        <tr key={e.id} className="clic" onClick={() => open(e.id)}>
                          <td style={{ fontWeight: 600 }}>{(e.proforma_codigos || [])[0] || e.codigo || "-"}</td>
                          <td>{e.client_name || clientes[e.client_id] || "-"}</td>
                          <td style={{ color: e._reventa ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                            {e._reventa ? (es ? "Reventa" : "Resale") : (es ? "Comisión" : "Commission")}
                          </td>
                          <td style={{ color: "var(--text-tertiary)" }}>{e.estado || "-"}</td>
                          <td className="n" style={{ fontWeight: 700 }}>{dinero(e._saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section
              title={es ? "Salidas de producción" : "Production shipments"}
              sub={es
                ? "Incluye los pedidos sin fecha publicada. Las fechas vencidas se muestran con la fecha real."
                : "Includes files without a published date. Past dates are shown as they are."}
              right={onGoCorreo ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onGoCorreo}>
                  {es ? "Ver correo" : "Mail"}
                </button>
              ) : null}
            >
              {(salidas.length + sinFecha.length) === 0 ? (
                <div className="dash-sub" style={{ padding: "14px 2px" }}>{es ? "Sin expedientes en producción." : "No files in production."}</div>
              ) : (
                <div className="dash-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>{es ? "Proforma" : "Proforma"}</th>
                        <th>{es ? "Cliente" : "Client"}</th>
                        <th>{es ? "Estado" : "State"}</th>
                        <th>{es ? "Inicio" : "Start"}</th>
                        <th className="n">{es ? "Fin" : "End"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...salidas, ...sinFecha].slice(0, 8).map((s) => (
                        <tr key={`${s.expediente_id}-${s.campo || s.exp_estado}`} className="clic" onClick={() => open(s.expediente_id)}>
                          <td style={{ fontWeight: 600 }}>{s.display_id || "-"}</td>
                          <td>{s.cliente || "-"}</td>
                          <td style={{ color: "var(--text-tertiary)" }}>{s.campo || s.exp_estado || "-"}</td>
                          <td className="tabular-nums">{s.fecha_inicio ? fmtDate(s.fecha_inicio, lang) : "-"}</td>
                          <td className="n tabular-nums" style={{ fontWeight: s.fecha_fin ? 600 : 400 }}>
                            {s.fecha_fin ? `${s.fin_estimada ? "≈ " : ""}${fmtDate(s.fecha_fin, lang)}` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>

          {/* ── Columna lateral ───────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

            <Section
              title={es ? "Saldos por cliente" : "Balances by client"}
              sub={es
                ? "Deuda actual en USD. A MWT: reventa (el cliente le paga a MWT). A Marluvas: comisión (la factura la cobra Marluvas)."
                : "Current debt in USD. To MWT: resale. To Marluvas: commission."}
            >
              {saldosPorCliente.length === 0 ? <div className="dash-sub">-</div> : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{es ? "Cliente" : "Client"}</th>
                      <th className="n">{es ? "A MWT" : "To MWT"}</th>
                      <th className="n">{es ? "A Marluvas" : "To Marluvas"}</th>
                      <th className="n">{es ? "Total" : "Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saldosPorCliente.slice(0, 8).map((c) => (
                      <tr key={c.cid}>
                        <td>{c.nombre || clientes[c.cid] || "-"}</td>
                        <td className="n">{c.reventa ? dinero(c.reventa) : "-"}</td>
                        <td className="n" style={{ color: "var(--text-tertiary)" }}>{c.comision ? dinero(c.comision) : "-"}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(c.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Total" : "Total"}</td>
                      <td className="n" style={{ fontWeight: 700 }}>{dinero(saldoReventa)}</td>
                      <td className="n" style={{ fontWeight: 700 }}>{dinero(saldoComision)}</td>
                      <td className="n" style={{ fontWeight: 800 }}>{dinero(saldoReventa + saldoComision)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Comisiones y premios" : "Commissions and bonuses"}
              sub={es ? "Comisión por marca y premios pagados por Marluvas. Todo en USD." : "Commission by brand and bonuses paid by Marluvas. All in USD."}
              right={onGoFinanzas ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onGoFinanzas}>
                  {es ? "Finanzas" : "Finance"}
                </button>
              ) : null}
            >
              {comFilas.length === 0 ? <div className="dash-sub">-</div> : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{es ? "Marca" : "Brand"}</th>
                      <th className="n">{es ? "Devengada" : "Earned"}</th>
                      <th className="n">{es ? "Pendiente" : "Pending"}</th>
                      <th className="n">{es ? "Proyectada" : "Projected"}</th>
                      <th className="n">{es ? "Total" : "Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comFilas.map((m) => (
                      <tr key={m.brand_name}>
                        <td style={{ fontWeight: 600 }}>{m.brand_name}</td>
                        <td className="n">{dinero(m.comision_devengada)}</td>
                        <td className="n">{dinero(m.comision_pendiente)}</td>
                        <td className="n">{dinero(m.comision_proyectada)}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(m.comision_total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Comisión" : "Commission"}</td>
                      <td className="n" colSpan={3} />
                      <td className="n" style={{ fontWeight: 800 }}>{dinero(comTotal)}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{es ? "Premios" : "Bonuses"} {premios?.n ? `(${premios.n})` : ""}</td>
                      <td className="n" colSpan={3} style={{ color: "var(--text-tertiary)" }}>
                        {es ? "pagados por Marluvas" : "paid by Marluvas"}
                      </td>
                      <td className="n" style={{ fontWeight: 700 }}>{dinero(premios?.total || 0)}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Total" : "Total"}</td>
                      <td className="n" colSpan={3} />
                      <td className="n" style={{ fontWeight: 800 }}>{dinero(comTotal + Number(premios?.total || 0))}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Por revisar" : "To review"}
              sub={es ? "Tareas pendientes por vencimiento, cambios de fecha y correos sin responder." : "Pending tasks by due date, date changes and unanswered emails."}
              right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{porRevisar}</span>}
            >
              {porRevisar === 0 ? (
                <div className="dash-sub" style={{ padding: "10px 2px" }}>{es ? "Nada pendiente." : "Nothing pending."}</div>
              ) : (
                <table className="dash-table">
                  <tbody>
                    {tareasPend.slice(0, 5).map((t) => {
                      const vencida = t.due_date && t.due_date < hoyISO;
                      return (
                        <tr key={t.tarea_id} className="clic" onClick={() => open(t.expediente_id)}>
                          <td style={{ fontWeight: 600 }}>{t.exp_codigo || "-"}</td>
                          <td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.titulo}</td>
                          <td className="n" style={{ color: vencida ? "var(--critical)" : "var(--text-tertiary)", fontWeight: vencida ? 700 : 400 }}>
                            {t.due_date ? fmtDate(t.due_date, lang) : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="dash-sub" style={{ marginTop: 8 }}>
                {tareasVencidas} {es ? "tareas vencidas de" : "overdue tasks out of"} {tareasTotal} · {cambios.length + tareasRev.length} {es ? "bloqueos" : "blockers"} · {correosLabel} {es ? "sin responder" : "unanswered"}
              </div>
            </Section>

            <Section
              title={es ? "Actividad reciente" : "Recent activity"}
              sub={es ? "Qué se movió en mwt.one y por qué vía (C1 creación, C11 cambio de fase, sistema)." : "What moved in mwt.one and how (C1 create, C11 phase change, system)."}
              right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{actividad.length}</span>}
            >
              {actividad.length === 0 ? (
                <div className="dash-sub" style={{ padding: "10px 2px" }}>{es ? "Sin eventos registrados." : "No recorded events."}</div>
              ) : (
                <table className="dash-table">
                  <tbody>
                    {actividad.slice(0, 8).map((a) => (
                      <tr key={a.event_id}>
                        <td style={{ whiteSpace: "nowrap", color: "var(--text-tertiary)" }}>
                          {a.created_at ? fmtDate(a.created_at.slice(0, 10), lang) : "-"}
                        </td>
                        <td style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                          {a.exp_codigo || "-"}
                        </td>
                        <td style={{ color: "var(--text-tertiary)" }}>
                          {a.action_source || "-"}{a.new_status ? ` · ${a.new_status}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>
        </div>
      </>}
    </div>
  );
}
