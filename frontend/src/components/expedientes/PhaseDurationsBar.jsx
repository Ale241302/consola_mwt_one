// ─────────────────────────────────────────────────────────────
// PhaseDurationsBar — Días por fase del expediente
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
// Se renderiza bajo el StateTimeline en el detalle del expediente.
//   · Días REALES por fase derivados del EventLog (entrada a la fase →
//     entrada a la siguiente; fase actual → hoy, marcada "en curso").
//   · ADMIN/CEO puede fijar un valor manual por fase (override) con click
//     en el chip → input inline → Enter/✓. El override viaja al backend
//     (PATCH /expedientes/{id}/phase-durations/) y el Cronograma del
//     Resumen de Exportación lo prioriza sobre la duración derivada.
//   · Clientes B2B sólo ven los días (R3 — sin edición).
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { expedientesApi } from "../../lib/api.js";

const STAGES = ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO"];
const LABELS = {
  es: { REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación", DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino", CERRADO: "Cerrado" },
  en: { REGISTRO: "Registry", PRODUCCION: "Production", PREPARACION: "Preparation", DESPACHO: "Dispatch", TRANSITO: "Transit", EN_DESTINO: "At destination", CERRADO: "Closed" },
};
const DAY_MS = 86400000;

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
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      let real = null, open = false;
      if (i >= 0) {
        const a = new Date(entry[s] + "T12:00:00");
        const nxt = present[i + 1];
        if (nxt) {
          real = Math.max(0, Math.round((new Date(entry[nxt] + "T12:00:00") - a) / DAY_MS));
        } else {
          real = Math.max(0, Math.round((today - a) / DAY_MS));
          open = s === currentStatus && s !== "CERRADO";
        }
      }
      const ov = overrides[s];
      out[s] = { entry: entry[s] || null, real, open, override: ov != null && ov !== "" ? Number(ov) : null };
    });
    return out;
  }, [events, overrides, currentStatus]);

  // Evita doble envío (blur + click en ✓) y permite que Escape cancele
  // sin disparar el guardado del blur.
  const savingRef = useRef(false);
  const skipBlurRef = useRef(false);

  const save = useCallback(async (stage, value) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try {
      const body = {}; body[stage] = (value === "" || value == null) ? null : Number(value);
      const r = await expedientesApi.action("phase-durations", expedienteId, body);
      setOverrides((r && r.phase_durations) || {});
      setEditing(null);
    } catch (e) {
      setError(e?.body?.detail || e?.message || "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [expedienteId]);

  if (!events) return null;
  const L = LABELS[lang] || LABELS.es;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 4, marginTop: 4 }}>
        {STAGES.map((s) => {
          const info = phaseInfo[s] || {};
          const has = info.real != null || info.override != null;
          const shown = info.override != null ? info.override : info.real;
          const isEd = editing === s;
          const tip = [
            L[s],
            info.entry ? ((lang === "es" ? "desde " : "since ") + info.entry) : null,
            info.real != null ? ((lang === "es" ? "real: " : "actual: ") + info.real + "d") : null,
            info.override != null ? ((lang === "es" ? "manual: " : "manual: ") + info.override + "d") : null,
            canEdit ? (lang === "es" ? "(click para fijar manual)" : "(click to set manual)") : null,
          ].filter(Boolean).join(" · ");
          return (
            <div key={s} style={{ textAlign: "center" }}>
              {isEd ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <input className="input tabular-nums" type="number" min="0" max="365" step="0.5" autoFocus
                         value={draft}
                         onChange={(ev) => setDraft(ev.target.value)}
                         onKeyDown={(ev) => {
                           if (ev.key === "Enter") { skipBlurRef.current = true; save(s, draft); }
                           if (ev.key === "Escape") { skipBlurRef.current = true; setEditing(null); }
                         }}
                         onBlur={() => {
                           // Persistir SIEMPRE al perder foco (click en otra
                           // fase, recarga, tab) — antes el valor se perdía
                           // si no se presionaba Enter/✓.
                           if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                           save(s, draft);
                         }}
                         disabled={saving}
                         style={{ width: 54, padding: "1px 4px", fontSize: 11, textAlign: "right", height: "auto" }}/>
                  <button className="btn btn-ghost btn-xs" disabled={saving}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => save(s, draft)}
                          title={lang === "es" ? "Guardar" : "Save"}
                          style={{ padding: "1px 5px", fontSize: 10, color: "var(--brand-accent, #00B286)" }}>✓</button>
                  {info.override != null && (
                    <button className="btn btn-ghost btn-xs" disabled={saving}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => { skipBlurRef.current = true; save(s, null); }}
                            title={lang === "es" ? "Quitar manual (volver al real)" : "Clear manual"}
                            style={{ padding: "1px 4px", fontSize: 10, color: "#D64545" }}>✕</button>
                  )}
                </span>
              ) : (
                <button
                  type="button"
                  className="tabular-nums"
                  title={tip}
                  onClick={canEdit ? () => { setEditing(s); setDraft(shown != null ? String(shown) : ""); setError(""); } : undefined}
                  style={{
                    padding: "1px 9px", fontSize: 10.5, fontWeight: 700, borderRadius: 999,
                    border: info.override != null
                      ? "1.5px solid var(--brand-accent, #00B286)"
                      : "1px solid var(--border-subtle, #E1E6ED)",
                    background: info.open ? "rgba(0,178,134,0.08)" : "transparent",
                    color: has ? "var(--text-secondary, #475569)" : "var(--text-tertiary, #94A3B8)",
                    cursor: canEdit ? "pointer" : "default", lineHeight: "16px",
                  }}>
                  {has ? `${shown}d` : "—"}
                  {info.open && <span style={{ color: "var(--brand-accent, #00B286)", fontWeight: 600 }}>{lang === "es" ? " · en curso" : " · ongoing"}</span>}
                  {info.override != null && <span title={lang === "es" ? "Valor manual" : "Manual value"}> ✎</span>}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="caption" style={{ color: "#D64545", marginTop: 4, textAlign: "center" }}>{error}</div>
      )}
    </div>
  );
}
