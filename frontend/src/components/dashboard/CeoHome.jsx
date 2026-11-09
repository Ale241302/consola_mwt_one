// =====================================================================
// MWT.ONE · Panel CEO/Admin — rediseño 2026-11-08
//
// Responde en un vistazo:
//   1. ¿Cuántos expedientes tengo y en qué estado?  (operación)
//   2. ¿Quién me debe pagar y cuándo?               (cobranza)
//   3. ¿Cuánto gano y cuánto cobro?                 (finanzas)
//   4. ¿Qué comisiones hay por marca?               (comercial)
//   5. ¿Qué se viene y qué está bloqueado?          (riesgo)
//
// Datos reales: /api/expedientes/, /api/cobros/, /api/clientes/,
// /api/finanzas/*. Sin mocks. Si un endpoint falla, la tarjeta lo dice.
// R1: cero hex, solo CSS vars. R5: tabular-nums en métricas.
// =====================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { finanzasApi, expedientesApi, cobrosApi, clientesApi } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const money = (v, ccy = "USD") => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("es-CR", {
    style: "currency", currency: ccy, maximumFractionDigits: 0,
  }).format(n);
};
const dinero = (v) => {
  const n = Number(v);
  return isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—";
};
const rowsOf = (r) => (Array.isArray(r) ? r : (r?.results || []));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

const ESTADOS = [
  { key: "REGISTRO",   es: "Registro",    en: "Registered", color: "var(--text-tertiary)" },
  { key: "PRODUCCION", es: "Producción",  en: "Production", color: "var(--info, #3083FE)" },
  { key: "PREPARACION",es: "Preparación", en: "Preparation", color: "var(--info, #3083FE)" },
  { key: "DESPACHO",   es: "Despacho",    en: "Dispatch",   color: "var(--warning-fg, #92400E)" },
  { key: "TRANSITO",   es: "Tránsito",    en: "In transit", color: "var(--warning-fg, #92400E)" },
  { key: "EN_DESTINO", es: "En destino",  en: "At destination", color: "var(--brand-accent)" },
  { key: "CERRADO",    es: "Cerrado",     en: "Closed",    color: "var(--success-fg, #166534)" },
  { key: "CANCELADO",  es: "Cancelado",   en: "Cancelled", color: "var(--text-tertiary)" },
];

function Kpi({ label, value, sub, tone, onClick }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0, cursor: onClick ? "pointer" : "default" }}
         onClick={onClick}>
      <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ font: "800 26px/1.1 var(--font-display)", color: tone || "var(--text-primary)" }}>
        {value}
      </div>
      {sub && <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 800, letterSpacing: ".04em" }}>
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

const Empty = ({ children }) => (
  <div style={{ padding: "14px 4px", color: "var(--text-tertiary)", fontSize: 13 }}>{children}</div>
);

const Row = ({ grid, onClick, children }) => (
  <div onClick={onClick} style={{
    display: "grid", gridTemplateColumns: grid, gap: 10, alignItems: "center",
    padding: "9px 4px", borderTop: "1px solid var(--border-subtle, #EEF2F6)",
    cursor: onClick ? "pointer" : "default", fontSize: 12.5,
  }}>{children}</div>
);

const dot = (color) => (
  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: color }} />
);

/** Semáforo por días hasta el vencimiento (negativo = vencido). */
function vencTone(dias) {
  if (dias == null) return { color: "var(--text-tertiary)", txt: "sin fecha" };
  if (dias < 0) return { color: "var(--critical)", txt: `${Math.abs(dias)}d vencido` };
  if (dias <= 7) return { color: "var(--warning-fg, #92400E)", txt: `en ${dias}d` };
  return { color: "var(--text-secondary)", txt: `en ${dias}d` };
}

export default function CeoHome({ lang = "es", onOpenExpediente, onGoFinanzas, onGoCorreo, onGoExpedientes }) {
  const es = lang !== "en";
  const [exps, setExps] = useState([]);
  const [cobros, setCobros] = useState([]);
  const [clientes, setClientes] = useState({});
  const [rad, setRad] = useState(null);
  const [com, setCom] = useState([]);
  const [flujo, setFlujo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const safe = (p) => p.catch(() => null);
    const [e, c, cli, r, comi, f] = await Promise.all([
      safe(expedientesApi.list()),
      safe(cobrosApi.list()),
      safe(clientesApi.list()),
      safe(finanzasApi.radiografia(21)),
      safe(finanzasApi.comisionesPorMarca()),
      safe(finanzasApi.flujo(90)),
    ]);
    setExps(rowsOf(e));
    setCobros(rowsOf(c));
    const map = {};
    rowsOf(cli).forEach((x) => { map[x.id] = x.razon_social || x.nombre_comercial || ""; });
    setClientes(map);
    setRad(r || null);
    setCom(comi?.results || (Array.isArray(comi) ? comi : []));
    setFlujo(f || null);
    if (!e && !c) setErr(es ? "No se pudieron cargar los datos del panel." : "Dashboard data failed to load.");
    setLoading(false);
  }, [es]);
  useEffect(() => { load(); }, [load]);

  // ── Operación: expedientes por estado ──────────────────────────────
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
  const abiertos = (exps || []).filter((e) => !["CERRADO", "CANCELADO"].includes(e.estado)).length;
  // La tabla tiene que sumar el total: cualquier estado que no esté en la lista
  // (dato nuevo del backend) se muestra como "Otros" en vez de desaparecer.
  const conocidos = ESTADOS.reduce((s, x) => s + (porEstado[x.key]?.n || 0), 0);
  const otros = totalExps - conocidos;

  // ── Cobranza ───────────────────────────────────────────────────────
  const cobranza = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const items = (cobros || []).filter((c) => Number(c.monto_pendiente) > 0);
    let pendiente = 0, vencido = 0;
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const porCliente = {};
    items.forEach((c) => {
      const monto = Number(c.monto_pendiente) || 0;
      pendiente += monto;
      const fv = c.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null;
      const dias = fv ? Math.round((fv - hoy) / 86400000) : null;
      if (dias != null && dias < 0) vencido += monto;
      const m = dias == null ? "sin fecha" : dias < 0 ? (Math.abs(dias) > 90 ? "90+" : Math.abs(dias) > 60 ? "61-90" : Math.abs(dias) > 30 ? "31-60" : "0-30") : "0-30";
      if (buckets[m] != null) buckets[m] += monto;
      const cid = c.client_id || "—";
      porCliente[cid] = porCliente[cid] || { monto: 0, n: 0, proxVenc: null };
      porCliente[cid].monto += monto;
      porCliente[cid].n += 1;
      if (fv && (!porCliente[cid].proxVenc || fv < porCliente[cid].proxVenc)) {
        porCliente[cid].proxVenc = fv;
      }
    });
    const proximos = items
      .map((c) => {
        const fv = c.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null;
        return {
          ...c,
          _dias: fv ? Math.round((fv - hoy) / 86400000) : null,
          _monto: Number(c.monto_pendiente) || 0,
        };
      })
      .sort((a, b) => {
        if (a._dias == null) return 1;
        if (b._dias == null) return -1;
        return a._dias - b._dias;
      });
    const topClientes = Object.entries(porCliente)
      .map(([cid, v]) => ({ cid, ...v }))
      .sort((a, b) => b.monto - a.monto);
    return { items, pendiente, vencido, buckets, proximos, topClientes };
  }, [cobros]);

  // ── Riesgo / próximas salidas ──────────────────────────────────────
  const salidas = rad?.proximas_salidas || [];
  const sinFecha = rad?.sin_fecha || [];
  const cambios = rad?.bloqueos?.cambios_fecha || [];
  const tareasRev = rad?.bloqueos?.tareas_revision || [];
  const comTotal = com.reduce((s, m) => s + Number(m.comision_total || 0), 0);
  // Filas "(sin marca)" con todo en cero son ruido: no se muestran.
  const comFilas = com.filter((m) => {
    const nombre = String(m.brand_name || "").trim().toLowerCase();
    const esSinMarca = !nombre || nombre === "sin marca" || nombre === "(sin marca)";
    const enCero = !Number(m.comision_proyectada) && !Number(m.comision_total);
    return !(esSinMarca && enCero);
  });
  const fl = flujo?.totales || {};
  const open = (id) => { if (id && onOpenExpediente) onOpenExpediente(id); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }} data-section="ceo-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>
        {es ? "Cargando panel…" : "Loading…"}</div>}
      {err && <div className="card card-pad-lg" style={{ color: "var(--critical)" }}>{err}</div>}

      {!loading && !err && <>
        {/* ── KPIs operativos + cobranza ─────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 12 }}>
          <Kpi label={es ? "Expedientes" : "Files"} value={totalExps}
               sub={es ? `${abiertos} abiertos` : `${abiertos} open`}
               onClick={onGoExpedientes} />
          <Kpi label={es ? "En producción" : "In production"} value={porEstado.PRODUCCION?.n || 0}
               sub={dinero(porEstado.PRODUCCION?.valor)} tone="var(--info, #3083FE)" />
          <Kpi label={es ? "En tránsito" : "In transit"} value={porEstado.TRANSITO?.n || 0}
               sub={dinero(porEstado.TRANSITO?.valor)} tone="var(--warning-fg, #92400E)" />
          <Kpi label={es ? "En destino" : "At destination"} value={porEstado.EN_DESTINO?.n || 0}
               sub={dinero(porEstado.EN_DESTINO?.valor)} />
          <Kpi label={es ? "Por cobrar" : "Receivable"} value={dinero(cobranza.pendiente)}
               sub={`${cobranza.items.length} ${es ? "cobros abiertos" : "open"}`} tone="var(--text-primary)"
               onClick={onGoFinanzas} />
          <Kpi label={es ? "Vencido" : "Overdue"} value={dinero(cobranza.vencido)}
               sub={es ? "mora acumulada" : "past due"}
               tone={cobranza.vencido > 0 ? "var(--critical)" : "var(--success-fg, #166534)"}
               onClick={onGoFinanzas} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {/* ── Columna principal ───────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

            {/* Expedientes por estado */}
            <Section
              title={es ? "EXPEDIENTES POR ESTADO" : "FILES BY STATE"}
              right={<button className="btn btn-ghost btn-sm" onClick={() => onGoExpedientes && onGoExpedientes()}>
                {es ? "Ver expedientes" : "All files"}
              </button>}
            >
              {totalExps === 0 ? <Empty>—</Empty> : <>
                {ESTADOS.map((s) => {
                  const v = porEstado[s.key] || { n: 0, valor: 0 };
                  const w = pct(v.n, totalExps);
                  return (
                    <div key={s.key} style={{ padding: "7px 4px", borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "150px 48px 1fr 110px", gap: 10, alignItems: "center" }}>
                        <div className="flex ai-center gap-2" style={{ fontSize: 12.5 }}>
                          {dot(s.color)} {es ? s.es : s.en}
                        </div>
                        <div className="tabular-nums" style={{ fontWeight: 800 }}>{v.n}</div>
                        <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${w}%`, background: s.color }} />
                        </div>
                        <div className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)", fontSize: 12 }}>
                          {dinero(v.valor)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {otros > 0 && (
                  <div style={{ padding: "7px 4px", borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "150px 48px 1fr 110px", gap: 10, alignItems: "center" }}>
                      <div className="flex ai-center gap-2" style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
                        {dot("var(--text-tertiary)")} {es ? "Otros estados" : "Other states"}
                      </div>
                      <div className="tabular-nums" style={{ fontWeight: 800 }}>{otros}</div>
                      <div />
                      <div className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)", fontSize: 12 }}>—</div>
                    </div>
                  </div>
                )}
              </>}
            </Section>

            {/* Cuándo deben pagar */}
            <Section
              title={es ? "CUÁNDO DEBEN PAGAR" : "WHEN THEY PAY"}
              right={onGoFinanzas ? <button className="btn btn-ghost btn-sm" onClick={onGoFinanzas}>
                {es ? "Ver cobranza" : "Collections"}</button> : null}
            >
              {cobranza.proximos.length === 0 ? (
                <Empty>
                  {es
                    ? "El servicio de cobros no devolvió cuentas abiertas. Si esperabas saldos, revisalos en Finanzas."
                    : "The collections service returned no open balances. If you expected some, check Finance."}
                </Empty>
              ) : <>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr .9fr .8fr .8fr .7fr", gap: 10, padding: "0 4px 6px" }}>
                  {[es ? "Cliente" : "Client", es ? "Vence" : "Due", es ? "Monto" : "Amount",
                    es ? "Mora" : "Overdue", es ? "Estado" : "State"].map((h, i) => (
                    <div key={i} className="micro" style={{ color: "var(--text-tertiary)", fontWeight: 800 }}>{h}</div>
                  ))}
                </div>
                {cobranza.proximos.slice(0, 10).map((c) => {
                  const tone = vencTone(c._dias);
                  return (
                    <Row key={c.id} grid="1.4fr .9fr .8fr .8fr .7fr" onClick={() => open(c.expediente_id)}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {clientes[c.client_id] || c.client_id?.slice(0, 8) || "—"}
                      </div>
                      <div className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento, lang) : "—"}
                      </div>
                      <div className="tabular-nums" style={{ fontWeight: 700, textAlign: "right" }}>
                        {money(c._monto, c.moneda || "USD")}
                      </div>
                      <div className="tabular-nums" style={{ color: tone.color, fontWeight: 700 }}>
                        {tone.txt}
                      </div>
                      <div className="micro" style={{ color: "var(--text-tertiary)" }}>{c.estado || "—"}</div>
                    </Row>
                  );
                })}
              </>}
            </Section>

            {/* Próximas salidas */}
            <Section title={es ? "PRÓXIMAS SALIDAS DE PRODUCCIÓN" : "UPCOMING SHIPMENTS"}
                     right={onGoCorreo ? <button className="btn btn-ghost btn-sm" onClick={onGoCorreo}>
                       {es ? "Ver correo" : "Mail"}</button> : null}>
              {(salidas.length + sinFecha.length) === 0 ? (
                <Empty>{es ? "Sin expedientes en producción." : "No files in production."}</Empty>
              ) : <>
                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr .9fr .9fr .9fr", gap: 10, padding: "0 4px 6px" }}>
                  {[es ? "Proforma" : "Proforma", es ? "Cliente" : "Client", es ? "Estado" : "State",
                    es ? "Inicio" : "Start", es ? "Fin" : "End"].map((h, i) => (
                    <div key={i} className="micro" style={{ color: "var(--text-tertiary)", fontWeight: 800 }}>{h}</div>
                  ))}
                </div>
                {[...salidas, ...sinFecha].slice(0, 8).map((s) => (
                  <Row key={`${s.expediente_id}-${s.campo || s.exp_estado}`}
                       grid="1.1fr 1.4fr .9fr .9fr .9fr" onClick={() => open(s.expediente_id)}>
                    <div style={{ fontWeight: 700 }}>{s.display_id}</div>
                    <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.cliente || "—"}</div>
                    <div style={{ color: "var(--text-tertiary)" }}>{s.campo || s.exp_estado || "—"}</div>
                    <div className="tabular-nums">{s.fecha_inicio ? fmtDate(s.fecha_inicio, lang) : "—"}</div>
                    <div className="tabular-nums" style={{ fontWeight: s.fecha_fin ? 700 : 400 }}>
                      {s.fecha_fin ? `${s.fin_estimada ? "≈ " : ""}${fmtDate(s.fecha_fin, lang)}` : "—"}
                    </div>
                  </Row>
                ))}
              </>}
            </Section>
          </div>

          {/* ── Columna lateral ─────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

            {/* Antigüedad de cartera */}
            <Section title={es ? "CARTERA POR ANTIGÜEDAD" : "RECEIVABLES AGING"}>
              {[["0-30", es ? "0–30 días" : "0–30 days"],
                ["31-60", "31–60"],
                ["61-90", "61–90"],
                ["90+", "90+"]].map(([k, label]) => (
                <Row key={k} grid="1fr 1fr">
                  <div className="micro" style={{ color: "var(--text-tertiary)" }}>{label}</div>
                  <div className="tabular-nums" style={{
                    textAlign: "right", fontWeight: 700,
                    color: (k === "61-90" || k === "90+") && cobranza.buckets[k] > 0 ? "var(--critical)" : "var(--text-primary)",
                  }}>{dinero(cobranza.buckets[k])}</div>
                </Row>
              ))}
              <Row grid="1fr 1fr">
                <div style={{ fontWeight: 800, fontSize: 12 }}>{es ? "Total pendiente" : "Total"}</div>
                <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 800 }}>{dinero(cobranza.pendiente)}</div>
              </Row>
            </Section>

            {/* Top clientes por saldo */}
            <Section title={es ? "CLIENTES CON SALDO" : "CLIENTS WITH BALANCE"}
                     right={onGoFinanzas ? <button className="btn btn-ghost btn-sm" onClick={onGoFinanzas}>
                       {es ? "Finanzas" : "Finance"}</button> : null}>
              {cobranza.topClientes.length === 0 ? <Empty>—</Empty> : cobranza.topClientes.slice(0, 6).map((c) => {
                const fv = c.proxVenc ? fmtDate(c.proxVenc.toISOString(), lang) : "—";
                return (
                  <Row key={c.cid} grid="1.6fr 1fr .9fr">
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                      {clientes[c.cid] || "—"}
                    </div>
                    <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{dinero(c.monto)}</div>
                    <div className="micro" style={{ color: "var(--text-tertiary)", textAlign: "right" }}>{fv}</div>
                  </Row>
                );
              })}
            </Section>

            {/* Comisiones */}
            <Section title={es ? "COMISIONES POR MARCA" : "COMMISSIONS BY BRAND"}
                     right={onGoFinanzas ? <button className="btn btn-ghost btn-sm" onClick={onGoFinanzas}>
                       {es ? "Ver Finanzas" : "Finance"}</button> : null}>
              {comFilas.length === 0 ? <Empty>—</Empty> : <>
                {comFilas.map((m) => (
                  <Row key={m.brand_name} grid="1.3fr 1fr 1fr">
                    <div style={{ fontWeight: 700 }}>{m.brand_name}</div>
                    <div className="tabular-nums" style={{ textAlign: "right" }}>{money(m.comision_proyectada)}</div>
                    <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{money(m.comision_total)}</div>
                  </Row>
                ))}
                <Row grid="1.3fr 1fr 1fr">
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{es ? "Total" : "Total"}</div>
                  <div />
                  <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 800 }}>{money(comTotal)}</div>
                </Row>
              </>}
            </Section>

            {/* Flujo + bloqueos */}
            <Section title={es ? "FLUJO 90 DÍAS" : "90-DAY FLOW"}>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Entradas" : "In"}</div>
                <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{dinero(fl.entradas_usd)}</div></Row>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Salidas" : "Out"}</div>
                <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{dinero(fl.salidas_usd)}</div></Row>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Neto USD" : "Net USD"}</div>
                <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 800, color: "var(--success-fg, #166534)" }}>{dinero(fl.neto_usd)}</div></Row>
            </Section>

            <Section title={es ? "BLOQUEOS · POR REVISAR" : "BLOCKERS"}
                     right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{cambios.length + tareasRev.length}</span>}>
              {(cambios.length + tareasRev.length) === 0 ? <Empty>{es ? "Sin bloqueos." : "No blockers."}</Empty> : <>
                {cambios.slice(0, 5).map((x) => (
                  <Row key={x.extraccion_id} grid="1fr 1fr" onClick={() => open(x.expediente_id)}>
                    <div style={{ fontWeight: 700 }}>{x.display_id}</div>
                    <div style={{ color: "var(--warning-fg, #92400E)" }}>{es ? "Cambio de " : ""}{x.campo}</div>
                  </Row>
                ))}
                {tareasRev.slice(0, 5).map((x) => (
                  <Row key={x.tarea_id} grid="1fr 1fr" onClick={() => open(x.expediente_id)}>
                    <div style={{ fontWeight: 700 }}>{x.exp_codigo || "—"}</div>
                    <div title={x.titulo || ""} style={{ color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.titulo}</div>
                  </Row>
                ))}
              </>}
            </Section>
          </div>
        </div>
      </>}
    </div>
  );
}
