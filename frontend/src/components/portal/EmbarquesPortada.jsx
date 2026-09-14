// =====================================================================
// MWT.ONE · Embarques (portada del cliente) — Etapa 5
// Muestra, para los expedientes del cliente: cantidades del funnel
// (pedido → producción → listas → embarcadas → entregadas), el próximo
// hito con su precisión, y un detalle expandible con salidas (destino,
// AWB/BL) y documentos vigentes. Sin datos internos (R3).
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi, apiFetch, getToken } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";

const PHASE_ORDER = ["REGISTRO", "PRODUCCION", "PREPARACION_DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO"];
const _norm = (s) => (s === "PREPARACION" || s === "DESPACHO") ? "PREPARACION_DESPACHO" : s;

const PREC = {
  EXACTA:      { es: "confirmada",        en: "confirmed" },
  MES:         { es: "estimada (mes)",     en: "estimated (month)" },
  RANGO:       { es: "estimada (rango)",   en: "estimated (range)" },
  DESCONOCIDA: { es: "sin fecha",          en: "no date" },
};

function Chip({ text, tone = "neutral" }) {
  const tones = {
    neutral: ["var(--surface-hover, #F1F5F9)", "var(--text-secondary, #475569)"],
    ok:      ["var(--success-bg, #DCFCE7)", "var(--success-fg, #166534)"],
    warn:    ["var(--warning-bg, #FEF3C7)", "var(--warning-fg, #92400E)"],
  };
  const [bg, fg] = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 10, fontWeight: 700, background: bg, color: fg, whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function Funnel({ c, es }) {
  const parts = [
    ["producción", c.en_produccion],
    ["listas", c.listas],
    ["embarcadas", c.embarcadas],
    ["entregadas", c.entregadas],
  ];
  return (
    <div className="flex ai-center" style={{ gap: 10, flexWrap: "wrap", fontSize: 11 }}>
      <span className="micro" style={{ color: "var(--text-tertiary)" }}>
        {es ? "Pedido" : "Order"}: <b className="tabular-nums">{c.pedido}</b>
      </span>
      {parts.map(([k, v]) => (
        <span key={k} style={{ color: "var(--text-secondary)" }}>
          {k}: <b className="tabular-nums">{v}</b>
        </span>
      ))}
    </div>
  );
}

export default function EmbarquesPortada({ lang = "es", clientId }) {
  const es = lang === "es";
  const navigate = useNavigate();
  const go = useCallback((it) => {
    if (it?.fusion_id) navigate(`/expedientes/fusion/${it.fusion_id}`);
    else if (it?.oc_id) navigate(`/expedientes/${it.oc_id}`);
    else if (it?.id) navigate(`/expedientes/${it.id}`);
  }, [navigate]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [detalle, setDetalle] = useState({});   // expId -> detail
  const [openId, setOpenId] = useState(null);
  const [stats, setStats] = useState(null);

  // Tiempos promedio por fase (para estimar cuando no hay fecha concreta).
  useEffect(() => {
    const q = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
    apiFetch(`/expedientes/phase-stats/${q}`, { token: getToken() })
      .then(setStats).catch(() => {});
  }, [clientId]);

  const estimar = useCallback((estado) => {
    const all = stats?.phase_stats?._ALL;
    if (!all || !estado) return null;
    const cur = PHASE_ORDER.indexOf(_norm(estado));
    if (cur < 0) return null;
    let days = 0;
    for (let i = cur + 1; i < PHASE_ORDER.length; i++) {
      const v = Number(all[PHASE_ORDER[i]]?.avg || 0);
      if (v) days += v;
    }
    if (!days) return null;
    const d = new Date(); d.setDate(d.getDate() + Math.round(days));
    return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
  }, [stats]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setItems(await portalApi.misEmbarques(clientId) || []); }
    catch (e) { setErr(e?.body?.detail || e?.message || "Error"); setItems([]); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!detalle[id]) {
      try {
        const d = await portalApi.embarque(clientId, id);
        setDetalle((prev) => ({ ...prev, [id]: d }));
      } catch (e) { setDetalle((prev) => ({ ...prev, [id]: { error: e?.body?.detail || "Error" } })); }
    }
  }, [openId, detalle, clientId]);

  const subir = useCallback(async (expId, file) => {
    try {
      await portalApi.subirDocumento(clientId, { expedienteId: expId, file, kind: "OTRO" });
      const d = await portalApi.embarque(clientId, expId);
      setDetalle((prev) => ({ ...prev, [expId]: d }));
    } catch { /* el portal muestra el detalle sin el archivo */ }
  }, [clientId]);

  if (loading) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 14 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {es ? "Cargando embarques…" : "Loading shipments…"}
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 14 }}>
        <div className="body-sm" style={{ color: "var(--critical, #B91C1C)" }}>
          {es ? "No se pudieron cargar los embarques: " : "Could not load shipments: "}{err}
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad-lg" style={{ marginBottom: 14 }} data-section="embarques">
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700 }}>
          {es ? "PRÓXIMAS LLEGADAS Y SALIDAS" : "UPCOMING ARRIVALS & DEPARTURES"}
        </div>
        <span className="micro" style={{ color: "var(--text-tertiary)" }}>
          {items.length} {es ? "embarques" : "shipments"}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "16px 4px", color: "var(--text-tertiary)", fontSize: 12 }}>
          {es ? "Sin embarques activos todavía." : "No active shipments yet."}
        </div>
      ) : items.map((it) => {
        const hito = it.proximo_hito;
        const prec = hito ? (PREC[hito.precision] || PREC.EXACTA) : null;
        const est = hito ? null : estimar(it.estado);
        const open = openId === it.id;
        const det = detalle[it.id];
        return (
          <div key={it.id} onClick={() => go(it)}
               style={{ borderTop: "1px solid var(--border-subtle, #EEF2F6)", padding: "10px 2px", cursor: "pointer" }}>
            <div className="flex ai-center jc-between" style={{ gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13 }}>
                  {it.oc_display || it.oc_codigo || it.codigo}
                </div>
                <div className="micro" style={{ color: "var(--text-tertiary)" }}>
                  {it.client_name}{it.brand_name ? ` · ${it.brand_name}` : ""}
                </div>
              </div>
              <Funnel c={it.cantidades || {}} es={es} />
              <div style={{ minWidth: 150, textAlign: "right" }}>
                {hito ? (
                  <>
                    <div className="tabular-nums" style={{ fontSize: 12, color: "var(--text-primary)" }}>
                      {hito.campo}: {hito.valor_fecha || hito.valor_raw || "—"}
                    </div>
                    <Chip text={es ? prec.es : prec.en} tone={hito.precision === "EXACTA" ? "ok" : "warn"} />
                  </>
                ) : est ? (
                  <>
                    <div className="tabular-nums" style={{ fontSize: 12, color: "var(--text-primary)" }}>≈ {est}</div>
                    <Chip text={es ? "estimada (promedio)" : "estimated (avg)"} tone="warn" />
                  </>
                ) : (
                  <Chip text={es ? "sin fecha concreta" : "no concrete date"} tone="warn" />
                )}
              </div>
              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(it.id)}>
                  {open ? (es ? "Ocultar" : "Hide") : (es ? "Archivos" : "Files")}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(it)}>
                  {es ? "Ver" : "View"}
                </button>
              </div>
            </div>

            {open && (
              <div style={{ marginTop: 10, paddingLeft: 4 }}>
                {!det && <div className="micro" style={{ color: "var(--text-tertiary)" }}>…</div>}
                {det?.error && <div className="micro" style={{ color: "var(--critical, #B91C1C)" }}>{det.error}</div>}
                {det && !det.error && (
                  <>
                    {/* Salidas */}
                    <div className="micro" style={{ color: "var(--text-tertiary)", margin: "6px 0 4px" }}>
                      {es ? "SALIDAS" : "DEPARTURES"}
                    </div>
                    {(det.salidas || []).length === 0
                      ? <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Aún sin salidas." : "No departures yet."}</div>
                      : (det.salidas || []).map((s) => (
                        <div key={s.id} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px dashed var(--border-subtle, #EEF2F6)" }}>
                          <b>{s.codigo}</b> · {s.estado} · {es ? "destino" : "to"} {s.destino_nombre || "—"}
                          {s.dispatched_at ? ` · ${es ? "salida" : "departed"} ${fmtDate(s.dispatched_at, lang)}` : ""}
                          {s.eta ? ` · ETA ${fmtDate(s.eta, lang)}` : ""}
                          {(s.bl_awb || s.awb_bl) ? ` · AWB/BL ${s.bl_awb || s.awb_bl}` : ""}
                          {s.qty != null ? ` · ${s.qty} u.` : ""}
                        </div>
                      ))}

                    {/* Documentos */}
                    <div className="micro" style={{ color: "var(--text-tertiary)", margin: "10px 0 4px" }}>
                      {es ? "DOCUMENTOS VIGENTES" : "CURRENT DOCUMENTS"}
                    </div>
                    {(det.documentos || []).length === 0
                      ? <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Sin documentos." : "No documents."}</div>
                      : (det.documentos || []).map((d) => (
                        <div key={d.id} style={{ fontSize: 12 }}>
                          {d.kind} · {d.codigo || "—"} {d.tiene_archivo ? "📎" : ""}
                        </div>
                      ))}
                    {det.awb_bl?.awb_file?.name && (
                      <div style={{ fontSize: 12 }}>
                        AWB/BL: {det.awb_bl.awb_file.name}
                        {det.awb_bl.fecha_despacho ? ` · ${es ? "despacho" : "dispatch"} ${det.awb_bl.fecha_despacho}` : ""}
                        {det.awb_bl.fecha_arrivo ? ` · ${es ? "arribo" : "arrival"} ${det.awb_bl.fecha_arrivo}` : ""}
                      </div>
                    )}

                    {/* Subir documento (cliente) */}
                    <div className="micro" style={{ color: "var(--text-tertiary)", margin: "10px 0 4px" }}>
                      {es ? "SUBIR DOCUMENTO" : "UPLOAD DOCUMENT"}
                    </div>
                    <input type="file" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) subir(it.id, f);
                      e.target.value = "";
                    }} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
