// =====================================================================
// MWT.ONE · Portada CEO (Etapa 5)
// Respuestas pendientes + próximas salidas de producción, anclado a
// datos reales (correo, expediente_fecha, extracciones, tareas).
// R1: solo CSS vars. R5: tabular-nums. Sin demos (POL_CERO_DEMO).
// NO muestra "saldo disponible" (fuente del saldo inicial aún no definida).
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { finanzasApi } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const CERT_STYLE = {
  RECONFIRMADA:   { bg: "var(--success-bg, #DCFCE7)", fg: "var(--success-fg, #166534)" },
  POR_RECONFIRMAR:{ bg: "var(--warning-bg, #FEF3C7)", fg: "var(--warning-fg, #92400E)" },
  CAMBIO:         { bg: "var(--danger-bg, #FEE2E2)",  fg: "var(--danger-fg, #991B1B)" },
};

function Badge({ text, style }) {
  const s = style || { bg: "var(--surface-hover, #F1F5F9)", fg: "var(--text-secondary, #475569)" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: ".02em",
      background: s.bg, color: s.fg, whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function Section({ title, count, lang, children }) {
  return (
    <div className="card card-pad-lg" style={{ marginBottom: 16 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700 }}>
          {title}
        </div>
        <span className="micro" style={{ color: "var(--text-tertiary)" }}>
          {count} {lang === "en" ? "items" : "elementos"}
        </span>
      </div>
      {children}
    </div>
  );
}

function Empty({ lang }) {
  return (
    <div style={{ padding: "18px 4px", color: "var(--text-tertiary)", fontSize: 12 }}>
      {lang === "en" ? "Nothing pending." : "Sin pendientes."}
    </div>
  );
}

function Row({ cols, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid", gridTemplateColumns: cols.grid, gap: 10, alignItems: "center",
        padding: "9px 4px", borderTop: "1px solid var(--border-subtle, #EEF2F6)",
        cursor: onClick ? "pointer" : "default", fontSize: 12,
      }}
    >
      {cols.cells}
    </div>
  );
}

export default function PortadaCEO({ lang = "es", onOpenExpediente }) {
  const es = lang !== "en";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [windowDays, setWindowDays] = useState(21);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await finanzasApi.radiografia(windowDays)); }
    catch (e) { setErr(e?.body?.detail || e?.message || "Error"); setData(null); }
    finally { setLoading(false); }
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);

  const open = useCallback((id) => { if (id && onOpenExpediente) onOpenExpediente(id); }, [onOpenExpediente]);

  const resp = data?.respuestas_pendientes || [];
  const borr = data?.borradores_por_revisar || [];
  const salidas = data?.proximas_salidas || [];
  const sinFecha = data?.sin_fecha || [];
  const cambios = data?.bloqueos?.cambios_fecha || [];
  const tareasRev = data?.bloqueos?.tareas_revision || [];

  return (
    <div style={{ marginBottom: 20 }} data-section="portada-ceo">
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, font: "var(--title-sm)", color: "var(--text-primary)" }}>
          {es ? "Portada CEO" : "CEO Overview"}
        </h2>
        <div className="flex ai-center gap-2" style={{ flexWrap: "wrap" }}>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="input-select"
            style={{ fontSize: 12 }}
          >
            <option value={14}>{es ? "14 días" : "14 days"}</option>
            <option value={21}>{es ? "21 días" : "21 days"}</option>
            <option value={28}>{es ? "28 días" : "28 days"}</option>
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            {es ? "Actualizar" : "Refresh"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
          {es ? "Cargando portada…" : "Loading overview…"}
        </div>
      )}
      {err && !loading && (
        <div className="card card-pad-lg" style={{ color: "var(--danger-fg, #991B1B)", fontSize: 13 }}>
          {es ? "No se pudo cargar la portada: " : "Could not load overview: "}{err}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12, marginBottom: 16,
          }}>
            {[
              { k: es ? "Respuestas pendientes" : "Pending replies", v: resp.length },
              { k: es ? "Borradores por revisar" : "Drafts to review", v: borr.length },
              { k: es ? "Próximas salidas" : "Upcoming shipments", v: salidas.length },
              { k: es ? "Sin fecha concreta" : "No concrete date", v: sinFecha.length },
              { k: es ? "Cambios por revisar" : "Changes to review", v: cambios.length + tareasRev.length },
            ].map((c) => (
              <div key={c.k} className="card card-pad-lg">
                <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>{c.k}</div>
                <div className="tabular-nums" style={{ font: "var(--title-md)", color: "var(--text-primary)" }}>{c.v}</div>
              </div>
            ))}
          </div>

          <Section title={es ? "RESPUESTAS PENDIENTES" : "PENDING REPLIES"} count={resp.length} lang={lang}>
            {resp.length === 0 ? <Empty lang={lang} /> : resp.map((r) => (
              <Row key={r.mensaje_id} onClick={() => open(r.expediente_id)} cols={{
                grid: "1.1fr 2fr 1.4fr 0.9fr",
                cells: (
                  <>
                    <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{r.display_id}</div>
                    <div title={r.subject || ""} style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.subject || "—"}
                    </div>
                    <div title={r.from_name || r.from_email || ""} style={{ color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.from_name || r.from_email || "—"}
                    </div>
                    <div className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {r.fecha ? fmtDate(r.fecha, lang) : "—"}
                    </div>
                  </>
                ),
              }} />
            ))}
          </Section>

          <Section title={es ? `PRÓXIMAS SALIDAS DE PRODUCCIÓN (${windowDays} días)` : `UPCOMING SHIPMENTS (${windowDays} days)`} count={salidas.length} lang={lang}>
            {salidas.length === 0 ? <Empty lang={lang} /> : salidas.map((s) => (
              <Row key={`${s.expediente_id}-${s.campo}`} onClick={() => open(s.expediente_id)} cols={{
                grid: "1.1fr 1fr 0.9fr 1fr 1fr",
                cells: (
                  <>
                    <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{s.display_id}</div>
                    <div style={{ color: "var(--text-secondary)" }}>{s.cliente || "—"}</div>
                    <div style={{ color: "var(--text-tertiary)" }}>{s.campo}</div>
                    <div className="tabular-nums" style={{ color: "var(--text-primary)" }}>{s.valor_fecha}</div>
                    <div><Badge text={s.estado_fecha} style={CERT_STYLE[s.estado_fecha]} /></div>
                  </>
                ),
              }} />
            ))}
          </Section>

          {(cambios.length > 0 || tareasRev.length > 0) && (
            <Section title={es ? "BLOQUEOS · CAMBIOS POR REVISAR" : "BLOCKERS · CHANGES TO REVIEW"} count={cambios.length + tareasRev.length} lang={lang}>
              {cambios.map((x) => (
                <Row key={x.extraccion_id} onClick={() => open(x.expediente_id)} cols={{
                  grid: "1.1fr 1fr 1fr 1.2fr",
                  cells: (
                    <>
                      <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{x.display_id}</div>
                      <div style={{ color: "var(--text-secondary)" }}>{x.cliente || "—"}</div>
                      <div style={{ color: "var(--text-tertiary)" }}>{x.campo} · {x.valor_fecha || "—"}</div>
                      <div><Badge text={es ? "CAMBIO DE FECHA" : "DATE CHANGE"} style={CERT_STYLE.CAMBIO} /></div>
                    </>
                  ),
                }} />
              ))}
              {tareasRev.map((t) => (
                <Row key={t.tarea_id} onClick={() => open(t.expediente_id)} cols={{
                  grid: "1.1fr 1fr 1fr 1.2fr",
                  cells: (
                    <>
                      <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{t.exp_codigo || "—"}</div>
                      <div style={{ color: "var(--text-secondary)" }}>{t.cliente || "—"}</div>
                      <div style={{ color: "var(--text-tertiary)" }}>{t.titulo}</div>
                      <div className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {t.due_date ? fmtDate(t.due_date, lang) : (es ? "sin fecha" : "no date")}
                      </div>
                    </>
                  ),
                }} />
              ))}
            </Section>
          )}

          {borr.length > 0 && (
            <Section title={es ? "BORRADORES POR REVISAR" : "DRAFTS TO REVIEW"} count={borr.length} lang={lang}>
              {borr.map((b) => (
                <Row key={b.envio_id} onClick={() => open(b.expediente_id)} cols={{
                  grid: "1.1fr 1.4fr 2fr 0.9fr",
                  cells: (
                    <>
                      <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{b.display_id}</div>
                      <div style={{ color: "var(--text-secondary)" }}>{b.cliente || "—"}</div>
                      <div title={b.subject || (Array.isArray(b.destinatarios) ? b.destinatarios.join(", ") : "")} style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.subject || (Array.isArray(b.destinatarios) ? b.destinatarios.join(", ") : "—")}
                      </div>
                      <div className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {b.updated_at ? fmtDate(b.updated_at, lang) : "—"}
                      </div>
                    </>
                  ),
                }} />
              ))}
            </Section>
          )}

          {sinFecha.length > 0 && (
            <Section title={es ? "SIN FECHA CONCRETA (registro / producción)" : "NO CONCRETE DATE (registration / production)"} count={sinFecha.length} lang={lang}>
              {sinFecha.map((s) => (
                <Row key={s.expediente_id} onClick={() => open(s.expediente_id)} cols={{
                  grid: "1.1fr 1.4fr 1fr",
                  cells: (
                    <>
                      <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>{s.display_id}</div>
                      <div style={{ color: "var(--text-secondary)" }}>{s.cliente || "—"}</div>
                      <div><Badge text={s.exp_estado} /></div>
                    </>
                  ),
                }} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
