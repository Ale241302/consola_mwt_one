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
import { finanzasApi, expedientesApi, clientesApi, apiFetch, getToken } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dinero = (v) => {
  const n = Number(v);
  return isFinite(n) ? `$${nf.format(n)}` : "-";
};
const rowsOf = (r) => (Array.isArray(r) ? r : (r?.results || []));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
// Año del pedido: primero la proforma (2472-2026), después el código.
const anioDe = (e) => {
  const fuente = (e.proforma_codigos || [])[0] || e.codigo || e.created_at || "";
  const m = String(fuente).match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
};

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

﻿/** Barras de comisión y premio por mes, con detalle fijo debajo (sin tooltip flotante). */
function ComisionesChart({ datos, detalle, es }) {
  const [hover, setHover] = useState(null);
  const filas = (datos || []).filter((d) => d && d.mes);
  if (!filas.length) {
    return <div className="dash-sub" style={{ padding: "18px 2px" }}>{es ? "Sin comisiones registradas." : "No recorded commissions."}</div>;
  }
  const com = (d) => Number(d.comision || 0);
  const pre = (d) => Number(d.premio || 0);
  const maxPos = Math.max(1, ...filas.map((d) => com(d) + Math.max(0, pre(d))));
  const maxNeg = Math.max(0, ...filas.map((d) => Math.max(0, -pre(d))));

  const W = 640, H = 220, top = 14, bottom = 34;
  const alto = H - top - bottom;
  const posH = maxNeg > 0 ? alto * (maxPos / (maxPos + maxNeg)) : alto;
  const negH = alto - posH;
  const baseY = top + posH;
  const bw = W / filas.length;
  const activo = filas[hover != null ? hover : filas.length - 1];
  const filasDetalle = detalle?.[activo.mes] || [];

  return (
    <div>
      <div className="flex ai-center jc-between" style={{ marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <div className="micro" style={{ color: "var(--text-secondary)" }}>
          <b>{activo.mes}</b>
          {" · "}{es ? "Comisión" : "Commission"} {dinero(activo.comision)}
          {" · "}{es ? "Premio" : "Bonus"} {dinero(activo.premio)}
        </div>
        <div className="micro" style={{ color: "var(--text-tertiary)" }}>
          {es ? "máx" : "max"} {dinero(maxPos)}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={es ? "Comisión y premio por mes" : "Commission and bonus by month"}>
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1="0" x2={W} y1={top + posH * (1 - p)} y2={top + posH * (1 - p)}
                stroke="var(--border)" strokeWidth="1" />
        ))}
        <line x1="0" x2={W} y1={baseY} y2={baseY} stroke="var(--border-strong, var(--border))" strokeWidth="1" />
        {filas.map((d, i) => {
          const hc = (com(d) / maxPos) * posH;
          const p = pre(d);
          const hp = maxNeg > 0 ? (Math.abs(p) / Math.max(maxNeg, 1)) * negH : 0;
          const w = Math.max(6, bw * 0.58);
          const x = i * bw + (bw - w) / 2;
          const atenuada = hover != null && hover !== i;
          const estilo = { opacity: atenuada ? 0.45 : 1, transition: "opacity .18s ease" };
          return (
            <g key={d.mes}
               onMouseOver={() => setHover(i)}
               onMouseOut={() => setHover(null)}>
              <rect x={i * bw} y="0" width={bw} height={H} fill="transparent" />
              <rect x={x} y={baseY - hc} width={w} height={hc} rx="3"
                    fill="var(--brand-accent-dark, var(--brand-accent))" style={estilo} />
              {p !== 0 && (
                <rect
                  x={x}
                  y={p > 0 ? baseY - hc - hp : baseY}
                  width={w}
                  height={Math.max(2, hp)}
                  rx="3"
                  fill={p > 0 ? "var(--warning-fg, #92400E)" : "var(--critical)"}
                  style={estilo}
                />
              )}
              <text x={i * bw + bw / 2} y={H - 10} textAnchor="middle"
                    fill="var(--text-tertiary)" fontSize="10">
                {d.mes.slice(2)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Detalle del mes activo, debajo del gráfico: no tapa las barras. */}
      <div style={{
        marginTop: 6, padding: "8px 10px", minHeight: 46,
        background: "var(--surface-hover)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", fontSize: 11, lineHeight: 1.5,
      }}>
        {filasDetalle.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)" }}>
            {es ? "Sin facturas detalladas para este mes." : "No invoices detailed for this month."}
          </div>
        ) : filasDetalle.slice(0, 4).map((f, idx) => (
          <div key={idx} style={{ color: "var(--text-secondary)" }}>
            {f.tipo === "PREMIO" ? (es ? "Premio" : "Bonus") : (es ? "Comisión" : "Commission")}
            {" · "}{f.pf ? `PF ${f.pf}` : (f.fe || "-")}
            {f.oc ? ` · OC ${f.oc}` : ""}
            {" · "}{dinero(f.monto)}
            {f.cliente ? ` · ${f.cliente}` : ""}
          </div>
        ))}
        {filasDetalle.length > 4 && (
          <div style={{ color: "var(--text-tertiary)" }}>
            +{filasDetalle.length - 4} {es ? "más. Pasá el cursor por otra barra." : "more. Hover another bar."}
          </div>
        )}
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
  const [porClienteCom, setPorClienteCom] = useState([]);
  const [porMesDetalle, setPorMesDetalle] = useState({});
  const [proximas, setProximas] = useState([]);
  const [premios, setPremios] = useState(null);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [premioOpen, setPremioOpen] = useState(false);
  const [premioPeriodo, setPremioPeriodo] = useState(new Date().toISOString().slice(0, 7));
  const [premioMonto, setPremioMonto] = useState("");
  const [premioNota, setPremioNota] = useState("");
  const [premioMsg, setPremioMsg] = useState(null);
  const [premioSaving, setPremioSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const safe = (p) => p.catch(() => null);
    const [e, cli, r, comi] = await Promise.all([
      safe(expedientesApi.list()),
      safe(clientesApi.list()),
      safe(finanzasApi.radiografia(21)),
      safe(finanzasApi.comisionesPorMarca()),
    ]);
    setExps(rowsOf(e));
    const map = {};
    rowsOf(cli).forEach((x) => { map[x.id] = x.razon_social || x.nombre_comercial || ""; });
    setClientes(map);
    setRad(r || null);
    setCom(comi?.results || (Array.isArray(comi) ? comi : []));
    setComPorMes(comi?.por_mes || []);
    setPorClienteCom(comi?.por_cliente || []);
    setPorMesDetalle(comi?.por_mes_detalle || {});
    setProximas(comi?.proximas_entradas || []);
    setPremios(comi?.premios || null);
    if (!e) setErr(es ? "No se pudieron cargar los expedientes del panel." : "Dashboard data failed to load.");
    setLoading(false);
  }, [es]);
  useEffect(() => { load(); }, [load]);

  const guardarPremio = useCallback(async () => {
    setPremioSaving(true);
    setPremioMsg(null);
    try {
      await apiFetch("/finanzas/premios/", {
        method: "POST",
        token: getToken(),
        body: {
          periodo: premioPeriodo,
          monto_usd: Number(premioMonto),
          nota: premioNota || undefined,
        },
      });
      setPremioMsg(es ? "Premio registrado." : "Bonus saved.");
      setPremioMonto("");
      setPremioNota("");
      await load();
    } catch (e) {
      setPremioMsg(e?.body?.detail || e?.message || (es ? "No se pudo registrar." : "Could not save."));
    } finally {
      setPremioSaving(false);
    }
  }, [premioPeriodo, premioMonto, premioNota, es, load]);

  // ── Operación (filtrada por año) ────────────────────────────────────
  const expsAnio = useMemo(
    () => (exps || []).filter((e) => anio === "todos" || anioDe(e) === anio),
    [exps, anio]
  );
  const porEstado = useMemo(() => {
    const acc = {};
    ESTADOS.forEach((s) => { acc[s.key] = { n: 0, valor: 0 }; });
    (expsAnio || []).forEach((e) => {
      const k = String(e.estado || "REGISTRO");
      if (!acc[k]) acc[k] = { n: 0, valor: 0 };
      acc[k].n += 1;
      acc[k].valor += Number(e.order_value ?? e.total_client ?? 0) || 0;
    });
    return acc;
  }, [expsAnio]);
  const totalExps = (expsAnio || []).length;
  const conocidos = ESTADOS.reduce((s, x) => s + (porEstado[x.key]?.n || 0), 0);
  const otros = totalExps - conocidos;

  // ── Saldo real por pedido ───────────────────────────────────────────
  // `/api/cobros/` está vacío en producción: el saldo sale del expediente
  // (`balance` = facturado - pagado, calculado por el backend).
  const { conSaldo, saldoReventa, saldoComision, nReventa, saldosPorCliente } = useMemo(() => {
    const items = (expsAnio || [])
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
  }, [expsAnio, clientes]);

  // Año del gráfico de comisiones.
  const comPorMesAnio = useMemo(
    () => (anio === "todos" ? comPorMes : comPorMes.filter((m) => String(m.mes).startsWith(String(anio)))),
    [comPorMes, anio]
  );

  // Cliente | Saldo (deuda con Marluvas) | Comisión (lo que gana MWT).
  // No se suman: son dos cosas distintas.
  const clientesTabla = useMemo(() => {
    const map = {};
    saldosPorCliente.forEach((c) => {
      map[c.cid] = { cid: c.cid, nombre: c.nombre, saldo: c.total, comision: 0 };
    });
    porClienteCom.forEach((c) => {
      const clave = c.client_id || "-";
      const d = map[clave] || { cid: clave, nombre: c.cliente, saldo: 0, comision: 0 };
      d.comision = Number(c.comision) || 0;
      map[clave] = d;
    });
    return Object.values(map)
      .filter((c) => c.saldo > 0 || c.comision > 0)
      .sort((a, b) => (b.saldo + b.comision) - (a.saldo + a.comision));
  }, [saldosPorCliente, porClienteCom]);

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

  const comTotal = com.reduce((s, m) => s + Number(m.comision_total || 0), 0);
  const comProy = com.reduce((s, m) => s + Number(m.comision_proyectada || 0), 0);
  const comFilas = com.filter((m) => {
    const nombre = String(m.brand_name || "").trim().toLowerCase();
    const esSinMarca = !nombre || nombre === "sin marca" || nombre === "(sin marca)";
    const enCero = !Number(m.comision_proyectada) && !Number(m.comision_total);
    return !(esSinMarca && enCero);
  });
  const open = (id) => { if (id && onOpenExpediente) onOpenExpediente(id); };

  return (
    <div className="dash-mw" data-section="ceo-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>
        {es ? "Cargando panel…" : "Loading…"}
      </div>}
      {err && <div className="card card-pad-lg" role="alert" style={{ color: "var(--critical)" }}>{err}</div>}

      {!loading && !err && <>
        {/* ── Selector de año ──────────────────────────────────── */}
        <div className="flex ai-center jc-between" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="micro" style={{ color: "var(--text-tertiary)" }}>
            {es ? "AÑO" : "YEAR"}
          </div>
          <div className="flex" style={{ gap: 4, flexWrap: "wrap" }}>
            {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2,
              new Date().getFullYear() - 3, "todos"].map((y) => (
              <button
                key={y}
                type="button"
                className={anio === y ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
                onClick={() => setAnio(y)}
              >
                {y === "todos" ? (es ? "Todos" : "All") : y}
              </button>
            ))}
          </div>
        </div>

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
                ? `Facturado por Marluvas en ${anio === "todos" ? "todos los años" : anio}. Pasá el cursor por una barra para ver comisión, premio y total.`
                : `Invoiced by Marluvas in ${anio === "todos" ? "all years" : anio}. Hover a bar for commission, bonus and total.`}
            >
              <div className="dash-legend">
                <span><i className="dash-sw" style={{ background: "var(--brand-accent)" }} />{es ? "Comisión" : "Commission"}</span>
                <span><i className="dash-sw" style={{ background: "var(--warning-fg, #92400E)", opacity: 0.85 }} />{es ? "Premio" : "Bonus"}</span>
                <span style={{ marginLeft: "auto" }}>
                  {es ? "Premios" : "Bonuses"} {dinero(premios?.total || 0)} ({premios?.n || 0})
                </span>
              </div>
              <ComisionesChart datos={comPorMesAnio} detalle={porMesDetalle} es={es} />
            </Section>

            <Section
              title={es ? "Comisiones por cobrar" : "Commissions to collect"}
              sub={es
                ? "Qué entra, de qué pedido y cuándo: fecha exacta y días restantes. Son comisiones; los premios van en la tabla de arriba."
                : "What comes in, from which order, and when: exact date and days left. Commissions only; bonuses are in the table above."}
              right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{proximas.length}</span>}
            >
              {proximas.length === 0 ? (
                <div className="dash-sub" style={{ padding: "14px 2px" }}>{es ? "Sin comisiones por cobrar con fecha." : "No dated commissions to collect."}</div>
              ) : (
                <div className="dash-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>{es ? "Fecha" : "Date"}</th>
                        <th className="n">{es ? "Días" : "Days"}</th>
                        <th>{es ? "Cliente" : "Client"}</th>
                        <th>{es ? "Pedido" : "Order"}</th>
                        <th className="n">{es ? "Monto" : "Amount"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proximas.slice(0, 10).map((p, i) => (
                        <tr key={`${p.fecha}-${i}`}>
                          <td className="tabular-nums">{fmtDate(p.fecha, lang)}</td>
                          <td className="n" style={{ color: p.dias <= 7 ? "var(--warning-fg, #92400E)" : "var(--text-tertiary)" }}>
                            {p.dias}
                          </td>
                          <td>{p.cliente}</td>
                          <td style={{ color: "var(--text-tertiary)" }}>
                            {p.proforma || "-"}{p.oc ? ` · OC ${p.oc}` : ""}
                          </td>
                          <td className="n" style={{ fontWeight: 700 }}>{dinero(p.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              title={es ? "Saldo y comisión por cliente" : "Balance and commission by client"}
              sub={es
                ? "Saldo: facturado por Marluvas sin cobrar, en USD. El crédito del cliente es directo con Marluvas. Comisión: lo que MWT gana con ese cliente. No se suman."
                : "Balance: invoiced by Marluvas, uncollected, in USD. The client's credit is with Marluvas. Commission: what MWT earns. They are not added."}
            >
              {clientesTabla.length === 0 ? <div className="dash-sub">-</div> : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{es ? "Cliente" : "Client"}</th>
                      <th className="n">{es ? "Saldo (Marluvas)" : "Balance (Marluvas)"}</th>
                      <th className="n">{es ? "Comisión (MWT)" : "Commission (MWT)"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientesTabla.slice(0, 10).map((c) => (
                      <tr key={c.cid}>
                        <td>{clientes[c.cid] || (c.nombre && !/^[0-9a-f-]{36}$/i.test(c.nombre) ? c.nombre : (es ? "Cliente sin nombre" : "Unnamed client"))}</td>
                        <td className="n">{c.saldo ? dinero(c.saldo) : "-"}</td>
                        <td className="n" style={{ color: "var(--text-tertiary)" }}>{c.comision ? dinero(c.comision) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title={es ? "Comisiones y premios" : "Commissions and bonuses"}
              sub={es ? "Comisión por marca y premios pagados por Marluvas. Todo en USD." : "Commission by brand and bonuses paid by Marluvas. All in USD."}
              right={
                <div className="flex ai-center" style={{ gap: 6 }}>
                  <span className="micro" style={{ color: "var(--text-tertiary)" }}>
                    {premios?.n || 0} {es ? "premios" : "bonuses"}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPremioOpen((v) => !v)}>
                    {premioOpen ? (es ? "Cerrar" : "Close") : (es ? "+ Premio" : "+ Bonus")}
                  </button>
                </div>
              }
            >
              {premioOpen && (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 10, marginBottom: 10 }}>
                  <div className="flex" style={{ gap: 6, flexWrap: "wrap" }}>
                    <input
                      type="month"
                      className="input"
                      value={premioPeriodo}
                      onChange={(e) => setPremioPeriodo(e.target.value)}
                      style={{ width: 140 }}
                    />
                    <input
                      type="number"
                      className="input"
                      placeholder={es ? "Monto USD" : "Amount USD"}
                      value={premioMonto}
                      onChange={(e) => setPremioMonto(e.target.value)}
                      style={{ width: 120 }}
                    />
                    <input
                      className="input"
                      placeholder={es ? "Nota (opcional)" : "Note (optional)"}
                      value={premioNota}
                      onChange={(e) => setPremioNota(e.target.value)}
                      style={{ minWidth: 150 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!premioPeriodo || !premioMonto || premioSaving}
                      onClick={guardarPremio}
                    >
                      {premioSaving ? (es ? "Guardando…" : "Saving…") : (es ? "Registrar" : "Save")}
                    </button>
                  </div>
                  {premioMsg && (
                    <div className="micro" style={{ marginTop: 6, color: premioMsg.includes("registrado") || premioMsg.includes("saved") ? "var(--success-fg, #166534)" : "var(--critical)" }}>
                      {premioMsg}
                    </div>
                  )}
                </div>
              )}
              {comFilas.length === 0 ? <div className="dash-sub">-</div> : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{es ? "Marca" : "Brand"}</th>
                      <th className="n">{es ? "Devengada" : "Earned"}</th>
                      <th className="n">{es ? "Pendiente" : "Pending"}</th>
                      <th className="n">{es ? "Proyectada" : "Projected"}</th>
                      <th className="n">{es ? "Premio" : "Bonus"}</th>
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
                        <td className="n">{dinero(m.premio)}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{dinero(Number(m.comision_total || 0) + Number(m.premio || 0))}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{es ? "Total" : "Total"}</td>
                      <td className="n" colSpan={4} />
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
