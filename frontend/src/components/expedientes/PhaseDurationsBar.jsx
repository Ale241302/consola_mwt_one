// ─────────────────────────────────────────────────────────────
// PhaseDurationsBar — Días por fase del expediente
// Sprint 2026-06-10 (rev2) · Agente responsable: [AG-03 FRONTEND]
//
// Se renderiza bajo el StateTimeline en el detalle del expediente.
//   · Días REALES por fase derivados del EventLog (entrada a la fase →
//     entrada a la siguiente; fase actual → hoy, marcada "en curso").
//   · ADMIN/CEO: click en el chip abre un MODAL con Fecha inicio / Fecha
//     fin (precargadas con las fechas reales del event_log cuando existen)
//     y muestra en vivo a cuántos días equivale. Al guardar, el backend
//     calcula los días (end - start) y los persiste como override
//     ({start, end, days}) — el Cronograma del Resumen de Exportación los
//     prioriza sobre la duración derivada.
//   · Clientes B2B sólo ven los días (R3 — sin edición).
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { expedientesApi } from "../../lib/api.js";

const STAGES = ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO"];
const LABELS = {
  es: { REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación", DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino", CERRADO: "Cerrado" },
  en: { REGISTRO: "Registry", PRODUCCION: "Production", PREPARACION: "Preparation", DESPACHO: "Dispatch", TRANSITO: "Transit", EN_DESTINO: "At destination", CERRADO: "Closed" },
};
const DAY_MS = 86400000;

/** Normaliza un override guardado: número legacy (días) u objeto {start, end, days}. */
function parseOverride(ov) {
  if (ov == null || ov === "") return null;
  if (typeof ov === "object") {
    const days = Number(ov.days);
    return { days: isFinite(days) ? days : null, start: ov.start || null, end: ov.end || null };
  }
  const n = Number(ov);
  return isFinite(n) ? { days: n, start: null, end: null } : null;
}

/**
 * @param {Object} props
 * @param {string} props.expedienteId  UUID backend del expediente
 * @param {string} props.currentStatus fase actual (REGISTRO…CERRADO)
 * @param {('es'|'en')} [props.lang]
 * @param {boolean} [props.canEdit]    true sólo para ADMIN/CEO
 */
export default function PhaseDurationsBar({ expedienteId, currentStatus, lang = "es", canEdit = false }) {
  const [events, setEvents] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [modal, setModal] = useState(null);   // fase en edición o null
  const [mStart, setMStart] = useState("");
  const [mEnd, setMEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    if (!expedienteId) return undefined;
    let alive = true;
    (async () => {
      try {
        const evs = await expedientesApi.action("events", expedienteId);
        if (alive) setEvents(Array.isArray(evs) ? evs : (evs?.results || []));
      } catch {
        if (alive) setEvents([]);
      }
      try {
        const pd = await expedientesApi.action("phase-durations", expedienteId);
        if (alive) setOverrides((pd && pd.phase_durations) || {});
      } catch {
        /* sin overrides aún */
      }
    })();
    return () => { alive = false; };
  }, [expedienteId]);

  // Entrada a cada fase (primer evento con phase_to = fase). REGISTRO cae
  // al evento más antiguo si no hay phase_to explícito (creación).
  const phaseInfo = useMemo(() => {
    const entry = {};
    let minEv = null;
    (events || []).forEach((ev) => {
      if (!ev || !ev.created_at) return;
      const d = String(ev.created_at).slice(0, 10);
      if (!minEv || d < minEv) minEv = d;
      const st = String(ev.phase_to || "").toUpperCase();
      if (STAGES.indexOf(st) >= 0 && (!entry[st] || d < entry[st])) entry[st] = d;
    });
    if (!entry.REGISTRO && minEv) entry.REGISTRO = minEv;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const present = STAGES.filter((s) => entry[s]);
    const out = {};
    STAGES.forEach((s) => {
      const i = present.indexOf(s);
      let real = null, open = false, exit = null;
      if (i >= 0) {
        const a = new Date(entry[s] + "T12:00:00");
        const nxt = present[i + 1];
        if (nxt) {
          exit = entry[nxt];
          real = Math.max(0, Math.round((new Date(entry[nxt] + "T12:00:00") - a) / DAY_MS));
        } else {
          real = Math.max(0, Math.round((today - a) / DAY_MS));
          open = s === currentStatus && s !== "CERRADO";
        }
      }
      out[s] = { entry: entry[s] || null, exit, real, open, override: parseOverride(overrides[s]) };
    });
    return out;
  }, [events, overrides, currentStatus]);

  const save = useCallback(async (stage, value) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try {
      const body = {}; body[stage] = value;
      const r = await expedientesApi.action("phase-durations", expedienteId, body);
      setOverrides((r && r.phase_durations) || {});
      setModal(null);
    } catch (e) {
      setError(e?.body?.detail || e?.message || "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [expedienteId]);

  // Abre el modal precargando: rango manual guardado → fechas del event_log
  // (inicio = entrada a la fase; fin = entrada a la siguiente, u hoy).
  const openModal = useCallback((s) => {
    const info = phaseInfo[s] || {};
    const ov = info.override;
    const todayIso = new Date().toISOString().slice(0, 10);
    setMStart((ov && ov.start) || info.entry || "");
    setMEnd((ov && ov.end) || info.exit || (info.entry ? todayIso : ""));
    setError("");
    setModal(s);
  }, [phaseInfo]);

  // Días equivalentes del rango del modal (en vivo).
  const modalDays = useMemo(() => {
    if (!mStart || !mEnd) return null;
    const a = new Date(mStart + "T12:00:00");
    const b = new Date(mEnd + "T12:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return null;
    return Math.round((b - a) / DAY_MS);
  }, [mStart, mEnd]);

  if (!events) return null;
  const L = LABELS[lang] || LABELS.es;
  const mInfo = modal ? (phaseInfo[modal] || {}) : {};

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 4, marginTop: 4 }}>
        {STAGES.map((s) => {
          const info = phaseInfo[s] || {};
          const ov = info.override;
          const has = info.real != null || (ov && ov.days != null);
          const shown = ov && ov.days != null ? ov.days : info.real;
          const rangeTxt = ov && ov.start
            ? ((lang === "es" ? "del " : "from ") + ov.start + (lang === "es" ? " al " : " to ") + ov.end)
            : (info.entry
                ? ((lang === "es" ? "del " : "from ") + info.entry
                   + (info.exit ? ((lang === "es" ? " al " : " to ") + info.exit) : (lang === "es" ? " a hoy" : " to today")))
                : null);
          const tip = [
            L[s],
            rangeTxt,
            info.real != null ? ((lang === "es" ? "real: " : "actual: ") + info.real + "d") : null,
            ov && ov.days != null ? ((lang === "es" ? "manual: " : "manual: ") + ov.days + "d") : null,
            canEdit ? (lang === "es" ? "(click para fijar fechas)" : "(click to set dates)") : null,
          ].filter(Boolean).join(" · ");
          return (
            <div key={s} style={{ textAlign: "center" }}>
              <button
                type="button"
                className="tabular-nums"
                title={tip}
                onClick={(has || info.entry || canEdit) ? () => openModal(s) : undefined}
                style={{
                  padding: "1px 9px", fontSize: 10.5, fontWeight: 700, borderRadius: 999,
                  border: ov
                    ? "1.5px solid var(--brand-accent, #00B286)"
                    : "1px solid var(--border-subtle, #E1E6ED)",
                  background: info.open ? "rgba(0,178,134,0.08)" : "transparent",
                  color: has ? "var(--text-secondary, #475569)" : "var(--text-tertiary, #94A3B8)",
                  cursor: (has || info.entry || canEdit) ? "pointer" : "default", lineHeight: "16px",
                }}>
                {has ? `${shown}d` : "—"}
                {info.open && <span style={{ color: "var(--brand-accent, #00B286)", fontWeight: 600 }}>{lang === "es" ? " · en curso" : " · ongoing"}</span>}
                {/* ADMIN/CEO: lápiz cuando hay valor manual (editable). */}
                {canEdit && ov && (
                  <span title={lang === "es" ? "Valor manual (editar)" : "Manual value (edit)"}> ✎</span>
                )}
                {/* Cliente/normal (R3): icono OJO → modal de SOLO LECTURA. */}
                {!canEdit && (has || info.entry) && (
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"
                       style={{ marginLeft: 3, verticalAlign: "-1px" }}
                       fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Modal: fechas de inicio/fin de la fase → días equivalentes */}
      {modal && createPortal(
        <div onClick={() => setModal(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.45)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: "var(--surface-raised, #fff)", borderRadius: 14, width: "min(440px, 94vw)", boxShadow: "0 24px 60px rgba(11,30,58,0.35)", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)" }}>
              <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 4 }}>
                {lang === "es" ? "DÍAS EN FASE" : "DAYS IN PHASE"}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0B1E3A" }}>{L[modal]}</div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                {mInfo.entry
                  ? (lang === "es"
                      ? `Automático: entró el ${mInfo.entry}${mInfo.exit ? ` · salió el ${mInfo.exit}` : " · aún en esta fase"}`
                      : `Automatic: entered ${mInfo.entry}${mInfo.exit ? ` · left ${mInfo.exit}` : " · still in this phase"}`)
                  : (canEdit
                      ? (lang === "es" ? "Sin registro automático — fija el rango manualmente." : "No automatic record — set the range manually.")
                      : (lang === "es" ? "Sin registro de fechas para esta fase." : "No date record for this phase."))}
              </div>
            </div>
            <div style={{ padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="caption" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--text-secondary, #475569)", fontWeight: 600 }}>
                {lang === "es" ? "Fecha inicio" : "Start date"}
                <input className="input tabular-nums" type="date" value={mStart}
                       onChange={(ev) => setMStart(ev.target.value)} disabled={saving || !canEdit}
                       style={{ padding: "6px 8px", fontSize: 13 }}/>
              </label>
              <label className="caption" style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--text-secondary, #475569)", fontWeight: 600 }}>
                {lang === "es" ? "Fecha fin" : "End date"}
                <input className="input tabular-nums" type="date" value={mEnd}
                       onChange={(ev) => setMEnd(ev.target.value)} disabled={saving || !canEdit}
                       style={{ padding: "6px 8px", fontSize: 13 }}/>
              </label>
              <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "8px 0", borderRadius: 10, background: "rgba(0,178,134,0.07)", border: "1px solid rgba(0,178,134,0.25)" }}>
                <span className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "#0B1E3A" }}>
                  {modalDays != null ? modalDays : "—"}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary, #475569)", marginLeft: 6 }}>
                  {lang === "es" ? "días en esta fase" : "days in this phase"}
                </span>
                {modalDays == null && (mStart || mEnd) && (
                  <div className="caption" style={{ color: "#D64545", marginTop: 2 }}>
                    {lang === "es" ? "Rango inválido — fin debe ser ≥ inicio" : "Invalid range — end must be ≥ start"}
                  </div>
                )}
              </div>
              {error && (
                <div className="caption" style={{ gridColumn: "1 / -1", color: "#D64545", textAlign: "center" }}>{error}</div>
              )}
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1.5px solid var(--border-subtle, #E1E6ED)", display: "flex", justifyContent: canEdit ? "space-between" : "flex-end", alignItems: "center", gap: 8 }}>
              {!canEdit ? (
                // Cliente/normal (R3): solo lectura — únicamente "Cerrar".
                <button className="btn btn-ghost" onClick={() => setModal(null)} style={{ fontSize: 13 }}>
                  {lang === "es" ? "Cerrar" : "Close"}
                </button>
              ) : (
                <>
                  {mInfo.override ? (
                    <button className="btn btn-ghost btn-xs" disabled={saving}
                            onClick={() => save(modal, null)}
                            style={{ color: "#D64545", fontSize: 12 }}>
                      {lang === "es" ? "Quitar manual" : "Clear manual"}
                    </button>
                  ) : <span/>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" disabled={saving} onClick={() => setModal(null)} style={{ fontSize: 13 }}>
                      {lang === "es" ? "Cancelar" : "Cancel"}
                    </button>
                    <button className="btn"
                            disabled={saving || modalDays == null}
                            onClick={() => save(modal, { start: mStart, end: mEnd })}
                            style={{
                              fontSize: 13, fontWeight: 700, padding: "6px 16px", borderRadius: 8,
                              background: "#0B1E3A", color: "#fff", border: "1.5px solid #0B1E3A",
                              opacity: saving || modalDays == null ? 0.6 : 1,
                              cursor: saving || modalDays == null ? "not-allowed" : "pointer",
                            }}>
                      {saving ? (lang === "es" ? "Guardando…" : "Saving…") : (lang === "es" ? "Guardar" : "Save")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
