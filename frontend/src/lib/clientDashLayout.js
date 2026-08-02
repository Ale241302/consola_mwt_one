// =====================================================================
// MWT.ONE · lib/clientDashLayout.js
// Sprint 2026-08-02 · Dashboard personalizable CLIENT (B2B).
//
// Capa de layout del dashboard del cliente:
//   · DEFAULT_LAYOUT — orden + visibilidad por defecto.
//   · mergeLayout(saved, catalogIds) — mergea el layout guardado contra
//     el catálogo: ids desconocidos se ignoran, widgets del catálogo que
//     falten se agregan OCULTOS al final (así un widget nuevo aparece
//     disponible aunque el usuario tenga un layout viejo).
//   · useDashboardLayout(catalogIds) — hook: carga
//     preferences.dashboard_layout de GET /api/portal/me/ y guarda con
//     PATCH debounced (~800 ms) a /api/portal/update_preferences.
//     update_preferences hace merge JSONB SHALLOW de primer nivel, por
//     eso TODO el layout vive bajo la key `dashboard_layout`.
//     Fallback silencioso a localStorage si el fetch/PATCH falla.
//
// Shape del layout:
//   { widgets: [{ id, visible, config? }] }
//   · id de built-in: clave del registry (kpis, pipeline, ...).
//   · id de custom:   "custom:<uuid>" con config { metric, dim, chart, title }.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getToken } from "./api.js";

export const LAYOUT_PREF_KEY = "dashboard_layout";
const LS_KEY = "mwt-client-dash-layout";
const SAVE_DEBOUNCE_MS = 800;

export const DEFAULT_LAYOUT = {
  widgets: [
    { id: "kpis",      visible: true },
    { id: "pipeline",  visible: true },
    { id: "cmp_month", visible: true },
    { id: "sizes",     visible: true },
    { id: "upcoming",  visible: true },
    { id: "credit",    visible: true },
  ],
};

const isCustomId = (id) => typeof id === "string" && id.startsWith("custom:");

/** Normaliza una entrada cruda del layout guardado. */
function normalizeEntry(w, catalogSet) {
  if (!w || typeof w.id !== "string") return null;
  const known = catalogSet.has(w.id) || isCustomId(w.id);
  if (!known) return null; // widget que ya no existe → fuera
  const out = { id: w.id, visible: !!w.visible };
  if (isCustomId(w.id) && w.config && typeof w.config === "object") {
    out.config = w.config;
  }
  return out;
}

/** Mergea el layout guardado contra el catálogo actual. */
export function mergeLayout(saved, catalogIds) {
  const catalogSet = new Set(catalogIds);
  const base = (saved && Array.isArray(saved.widgets) && saved.widgets.length)
    ? saved.widgets
    : DEFAULT_LAYOUT.widgets;
  const seen = new Set();
  const widgets = [];
  base.forEach((w) => {
    const n = normalizeEntry(w, catalogSet);
    if (n && !seen.has(n.id)) { seen.add(n.id); widgets.push(n); }
  });
  // Widgets del catálogo ausentes en el layout guardado → ocultos al final.
  catalogIds.forEach((id) => {
    if (!seen.has(id)) widgets.push({ id, visible: false });
  });
  return { widgets };
}

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export function useDashboardLayout(catalogIds) {
  const [me, setMe] = useState(null);
  const [layout, setLayoutState] = useState(null); // null = cargando
  const timer = useRef(null);
  // El catálogo es estable (constante de módulo); lo fijamos por clave
  // para no re-fetchear si el caller pasa un array nuevo en cada render.
  const catalogKey = (catalogIds || []).join("|");
  const catalogRef = useRef(catalogIds);
  catalogRef.current = catalogIds;

  useEffect(() => {
    let alive = true;
    apiFetch("/portal/me/", { token: getToken() })
      .then((data) => {
        if (!alive) return;
        setMe(data || null);
        const saved = data?.preferences?.[LAYOUT_PREF_KEY] || readLocal();
        setLayoutState(mergeLayout(saved, catalogRef.current));
      })
      .catch(() => {
        // Fallback silencioso: layout local o DEFAULT.
        if (!alive) return;
        setLayoutState(mergeLayout(readLocal(), catalogRef.current));
      });
    return () => { alive = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey]);

  /** Aplica un layout nuevo: estado + localStorage + PATCH debounced. */
  const save = useCallback((next) => {
    setLayoutState(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* noop */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch("/portal/update_preferences", {
        method: "PATCH",
        body: { preferences: { [LAYOUT_PREF_KEY]: next } },
        token: getToken(),
      }).catch(() => { /* fallback silencioso: ya quedó en localStorage */ });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const reset = useCallback(() => {
    save(mergeLayout(null, catalogRef.current));
  }, [save]);

  return { me, layout, save, reset, loading: layout === null };
}
