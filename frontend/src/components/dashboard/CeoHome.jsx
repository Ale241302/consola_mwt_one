// =====================================================================
// MWT.ONE · Panel CEO/Admin — rediseño (Etapa 7 UI)
// Responde, en orden: (1) qué responder, (2) próximas salidas,
// (3) flujo de dinero. Luego comisiones, bloqueos y arbitraje.
// Datos reales de /api/finanzas/*. Sin mojibake, tipografía consistente.
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { finanzasApi } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const money = (v, ccy = "USD") => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("es-CR", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
};
const dinero = (v) => {
  const n = Number(v);
  return isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—";
};

const CERT = {
  RECONFIRMADA: ["var(--success-bg, #DCFCE7)", "var(--success-fg, #166534)", "Reconfirmada"],
  POR_RECONFIRMAR: ["var(--warning-bg, #FEF3C7)", "var(--warning-fg, #92400E)", "Por reconfirmar"],
  CAMBIO: ["var(--danger-bg, #FEE2E2)", "var(--danger-fg, #991B1B)", "Cambio"],
  SIN_FECHA: ["var(--surface-hover, #F1F5F9)", "var(--text-secondary, #475569)", "Sin fecha"],
};

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0 }}>
      <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ font: "800 26px/1.1 var(--font-display)", color: tone || "var(--text-primary)" }}>{value}</div>
      {sub && <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, count, right, children }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 800, letterSpacing: ".04em" }}>{title}</div>
        <div className="flex ai-center gap-2">
          {right}
          {count != null && <span className="micro" style={{ color: "var(--text-tertiary)" }}>{count}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: "18px 4px", color: "var(--text-tertiary)", fontSize: 13 }}>{children}</div>;
}

function Row({ grid, onClick, children }) {
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: grid, gap: 12, alignItems: "center",
      padding: "10px 4px", borderTop: "1px solid var(--border-subtle, #EEF2F6)",
      cursor: onClick ? "pointer" : "default", fontSize: 13,
    }}>{children}</div>
  );
}

export default function CeoHome({ lang = "es", onOpenExpediente, onGoFinanzas, onGoCorreo }) {
  const es = lang !== "en";
  const [rad, setRad] = useState(null);
  const [com, setCom] = useState([]);
  const [flujo, setFlujo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [r, c, f] = await Promise.all([
        finanzasApi.radiografia(21), finanzasApi.comisionesPorMarca(), finanzasApi.flujo(90),
      ]);
      setRad(r || null);
      setCom(c?.results || []);
      setFlujo(f || null);
    } catch (e) { setErr(e?.body?.detail || e?.message || "Error"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (id) => { if (id && onOpenExpediente) onOpenExpediente(id); };
  const resp = rad?.respuestas_pendientes || [];
  // El panel prioriza correos LIGADOS a un expediente; el resto es ruido.
  const respOp = resp.filter((r) => r.expediente_id);
  const salidas = rad?.proximas_salidas || [];
  const sinFecha = rad?.sin_fecha || [];
  // "Próximas salidas" = fechas publicadas + expedientes en registro/producción sin fecha.
  const salidasAll = [
    ...salidas,
    ...sinFecha.map((s) => ({
      expediente_id: s.expediente_id, display_id: s.display_id, cliente: s.cliente,
      campo: s.exp_estado, valor_fecha: null, estado_fecha: "SIN_FECHA",
    })),
  ];
  const cambios = rad?.bloqueos?.cambios_fecha || [];
  const tareasRev = rad?.bloqueos?.tareas_revision || [];
  const t = flujo?.totales || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }} data-section="ceo-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>{es ? "Cargando panel…" : "Loading…"}</div>}
      {err && <div className="card card-pad-lg" style={{ color: "var(--danger-fg, #991B1B)" }}>{err}</div>}

      {!loading && !err && <>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
          <Kpi label={es ? "Respuestas pendientes" : "Pending replies"} value={respOp.length}
               sub={resp.length > respOp.length ? `${resp.length - respOp.length} ${es ? "sin vincular" : "unlinked"}` : null} />
          <Kpi label={es ? "Borradores por revisar" : "Drafts to review"} value={(rad?.borradores_por_revisar || []).length} />
          <Kpi label={es ? `Próximas salidas (${rad?.window_days || 21}d)` : `Upcoming (${rad?.window_days || 21}d)`} value={salidasAll.length} />
          <Kpi label={es ? "Sin fecha concreta" : "No date"} value={(rad?.sin_fecha || []).length} />
          <Kpi label={es ? "Neto USD (90d)" : "Net USD (90d)"} value={dinero(t.neto_usd)} tone="var(--success-fg, #166534)" />
          <Kpi label={es ? "Comisión devengable" : "Accruable commission"} value={money(com.reduce((s, m) => s + Number(m.comision_total || 0), 0))} />
        </div>

        {/* 2 columnas */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* Columna principal */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Section title={es ? "PENDIENTES DE RESPONDER" : "TO REPLY"} count={respOp.length}
                     right={(resp.length > respOp.length && onGoCorreo) ? (
                       <button className="btn btn-ghost btn-sm" onClick={onGoCorreo}>
                         {es ? `Ver correo (${resp.length - respOp.length})` : `Mail (${resp.length - respOp.length})`}
                       </button>
                     ) : null}>
              {respOp.length === 0 ? <Empty>{es ? "Sin correos de expedientes pendientes." : "No pending file replies."}</Empty> : respOp.slice(0, 12).map((r) => (
                <Row key={r.mensaje_id} grid="1.1fr 2fr 1fr" onClick={() => open(r.expediente_id)}>
                  <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{r.display_id}</div>
                  <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject || "—"}</div>
                  <div className="tabular-nums" style={{ color: "var(--text-tertiary)", textAlign: "right" }}>{r.fecha ? fmtDate(r.fecha, lang) : "—"}</div>
                </Row>
              ))}
            </Section>

            <Section title={es ? "PRÓXIMAS SALIDAS DE PRODUCCIÓN" : "UPCOMING SHIPMENTS"} count={salidasAll.length}>
              {salidasAll.length === 0 ? <Empty>{es ? "Sin expedientes en producción." : "No files in production."}</Empty> : salidasAll.slice(0, 12).map((s) => {
                const c = CERT[s.estado_fecha] || CERT.POR_RECONFIRMAR;
                return (
                  <Row key={`${s.expediente_id}-${s.campo}`} grid="1.1fr 1fr .8fr 1fr 1fr" onClick={() => open(s.expediente_id)}>
                    <div style={{ fontWeight: 700 }}>{s.display_id}</div>
                    <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.cliente || "—"}</div>
                    <div style={{ color: "var(--text-tertiary)" }}>{s.campo}</div>
                    <div className="tabular-nums">{s.valor_fecha || "—"}</div>
                    <div><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: c[0], color: c[1] }}>{c[2]}</span></div>
                  </Row>
                );
              })}
            </Section>

            <Section title={es ? "COMISIONES POR MARCA · ventana 10–20" : "COMMISSIONS BY BRAND"} count={com.length}
                     right={onGoFinanzas ? <button className="btn btn-ghost btn-sm" onClick={onGoFinanzas}>{es ? "Ver Finanzas" : "Finance"}</button> : null}>
              {com.length === 0 ? <Empty>—</Empty> : com.map((m) => (
                <Row key={m.brand_name} grid="1.2fr .8fr .8fr .8fr">
                  <div style={{ fontWeight: 700 }}>{m.brand_name}</div>
                  <div className="tabular-nums" style={{ textAlign: "right" }}>{money(m.comision_proyectada)}</div>
                  <div className="tabular-nums" style={{ textAlign: "right" }}>{money(m.comision_pendiente)}</div>
                  <div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{money(m.comision_total)}</div>
                </Row>
              ))}
            </Section>
          </div>

          {/* Columna lateral */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Section title={es ? "FLUJO 90 DÍAS" : "90-DAY FLOW"}>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Entradas" : "In"}</div><div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{dinero(t.entradas_usd)}</div></Row>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Salidas" : "Out"}</div><div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{dinero(t.salidas_usd)}</div></Row>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Neto USD" : "Net USD"}</div><div className="tabular-nums" style={{ textAlign: "right", fontWeight: 800, color: "var(--success-fg, #166534)" }}>{dinero(t.neto_usd)}</div></Row>
              <Row grid="1fr 1fr"><div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Neto CRC" : "Net CRC"}</div><div className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{money(t.neto_crc, "CRC")}</div></Row>
              <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>{flujo?.nota || ""}</div>
            </Section>

            <Section title={es ? "BLOQUEOS · POR REVISAR" : "BLOCKERS"} count={cambios.length + tareasRev.length}>
              {(cambios.length + tareasRev.length) === 0 ? <Empty>{es ? "Sin bloqueos." : "No blockers."}</Empty> : <>
                {cambios.slice(0, 6).map((x) => (
                  <Row key={x.extraccion_id} grid="1fr .9fr" onClick={() => open(x.expediente_id)}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{x.display_id}</div>
                    <div style={{ color: "var(--warning-fg, #92400E)", fontSize: 12 }}>{es ? "Cambio de " : ""}{x.campo}</div>
                  </Row>
                ))}
                {tareasRev.slice(0, 6).map((x) => (
                  <Row key={x.tarea_id} grid="1fr .9fr" onClick={() => open(x.expediente_id)}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{x.exp_codigo || "—"}</div>
                    <div style={{ color: "var(--text-tertiary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.titulo}</div>
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
