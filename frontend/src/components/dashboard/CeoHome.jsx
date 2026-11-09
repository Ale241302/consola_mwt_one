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

/** Barras por semana: dos series (entradas y salidas). SVG sin dependencias. */
function Bars({ semanas }) {
  const datos = (semanas || []).filter(Boolean);
  if (!datos.length) {
    return <div className="dash-sub" style={{ padding: "18px 2px" }}>Sin series de flujo disponibles.</div>;
  }
  const W = 640, H = 180, pad = 18;
  const max = Math.max(
    1,
    ...datos.map((s) => Math.max(Number(s.entradas_usd) || 0, Number(s.salidas_usd) || 0))
  );
  const bw = W / datos.length;
  const barra = Math.max(2, (bw - 6) / 2);
  const alto = (v) => Math.max(0, (Number(v) || 0) / max) * (H - pad - 8);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label="Entradas y salidas por semana en los próximos 90 días">
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1="0" x2={W} y1={H - pad - (H - pad - 8) * p} y2={H - pad - (H - pad - 8) * p}
                stroke="var(--border)" strokeWidth="1" />
        ))}
        {datos.map((s, i) => {
          const he = alto(s.entradas_usd);
          const hs = alto(s.salidas_usd);
          return (
            <g key={`${s.semana}-${i}`}>
              <rect x={i * bw + 2} y={H - pad - he} width={barra} height={he}
                    fill="var(--brand-accent)" rx="2" />
              <rect x={i * bw + 2 + barra} y={H - pad - hs} width={barra} height={hs}
                    fill="var(--critical)" opacity="0.55" rx="2" />
            </g>
          );
        })}
        <line x1="0" x2={W} y1={H - pad} y2={H - pad} stroke="var(--border-strong, var(--border))" strokeWidth="1" />
      </svg>
      <div className="flex jc-between micro" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
        <span>{datos[0]?.semana || ""}</span>
        <span>{datos[datos.length - 1]?.semana || ""}</span>
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
  const { conSaldo, saldoReventa, saldoComision, nReventa, saldoPorCliente } = useMemo(() => {
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
    reventa.forEach((e) => {
      const cid = e.client_id || "-";
      porCliente[cid] = (porCliente[cid] || 0) + e._saldo;
    });
    return {
      conSaldo: items,
      saldoReventa: reventa.reduce((s, e) => s + e._saldo, 0),
      saldoComision: comision.reduce((s, e) => s + e._saldo, 0),
      nReventa: reventa.length,
      saldoPorCliente: Object.entries(porCliente)
        .map(([cid, monto]) => ({ cid, monto }))
        .sort((a, b) => b.monto - a.monto),
    };
  }, [exps]);

  // ── Riesgo y finanzas ───────────────────────────────────────────────
  const salidas = rad?.proximas_salidas || [];
  const sinFecha = rad?.sin_fecha || [];
  const cambios = rad?.bloqueos?.cambios_fecha || [];
  const tareasRev = rad?.bloqueos?.tareas_revision || [];
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
            cmp={`${es ? "proyectada" : "projected"} ${dinero(comProy)} · ${comFilas.length} ${es ? "marcas" : "brands"}`}
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
            value={cambios.length + tareasRev.length}
            cmp={es ? "cambios de fecha y tareas" : "date changes and tasks"}
            src={es
              ? "Radiografía CEO: bloqueos por cambio de fecha más tareas en REQUIERE_REVISION."
              : "CEO radiography: pending date changes plus tasks awaiting review."}
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
              title={es ? "Flujo proyectado" : "Projected cash flow"}
              sub={es
                ? "Próximos 90 días por semana. Entradas: comisiones y reventas previstas. Salidas: pagos a Marluvas."
                : "Next 90 days by week. In: expected commissions and resales. Out: payments to Marluvas."}
            >
              <div className="dash-legend">
                <span><i className="dash-sw" style={{ background: "var(--brand-accent)" }} />{es ? "Entradas" : "In"}</span>
                <span><i className="dash-sw" style={{ background: "var(--critical)", opacity: 0.6 }} />{es ? "Salidas" : "Out"}</span>
                <span style={{ marginLeft: "auto" }}>
                  {es ? "Neto" : "Net"} {dinero(fl.neto_usd)}
                </span>
              </div>
              <Bars semanas={flujo?.semanas || []} />
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
              title={es ? "Clientes con saldo" : "Clients with balance"}
              sub={es ? "Solo reventa: es lo que el cliente le debe a MWT." : "Resale only: what the client owes MWT."}
            >
              {saldoPorCliente.length === 0 ? <div className="dash-sub">-</div> : (
                <table className="dash-table">
                  <tbody>
                    {saldoPorCliente.slice(0, 6).map((c) => (
                      <tr key={c.cid}>
                        <td>{clientes[c.cid] || "-"}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(c.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Comisiones por marca" : "Commissions by brand"}
              sub={es ? "Proyectada y facturada." : "Projected and invoiced."}
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
                      <th className="n">{es ? "Proyectada" : "Projected"}</th>
                      <th className="n">{es ? "Facturada" : "Invoiced"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comFilas.map((m) => (
                      <tr key={m.brand_name}>
                        <td style={{ fontWeight: 600 }}>{m.brand_name}</td>
                        <td className="n">{dinero(m.comision_proyectada)}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(m.comision_total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Total" : "Total"}</td>
                      <td className="n">{dinero(comProy)}</td>
                      <td className="n" style={{ fontWeight: 800 }}>{dinero(comTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Bloqueos por revisar" : "Blockers"}
              sub={es ? "Cambios de fecha y tareas que esperan una decisión." : "Date changes and tasks waiting on a decision."}
              right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{cambios.length + tareasRev.length}</span>}
            >
              {(cambios.length + tareasRev.length) === 0 ? (
                <div className="dash-sub" style={{ padding: "10px 2px" }}>{es ? "Sin bloqueos." : "No blockers."}</div>
              ) : (
                <table className="dash-table">
                  <tbody>
                    {cambios.slice(0, 5).map((x) => (
                      <tr key={x.extraccion_id} className="clic" onClick={() => open(x.expediente_id)}>
                        <td style={{ fontWeight: 600 }}>{x.display_id}</td>
                        <td style={{ color: "var(--warning-fg, #92400E)" }}>{es ? "Cambio de " : ""}{x.campo}</td>
                      </tr>
                    ))}
                    {tareasRev.slice(0, 5).map((x) => (
                      <tr key={x.tarea_id} className="clic" onClick={() => open(x.expediente_id)}>
                        <td style={{ fontWeight: 600 }}>{x.exp_codigo || "-"}</td>
                        <td style={{ color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.titulo}</td>
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
