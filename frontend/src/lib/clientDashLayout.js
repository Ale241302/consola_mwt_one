// =====================================================================
// MWT.ONE · lib/clientDashLayout.js
// Sprint 2026-08-02 · Dashboard personalizable CLIENT (B2B).
// Sprint 2026-08-02 (rev ADMIN) · generalizado: el hook acepta opciones
// { prefKey, lsKey, catalogIds, defaultLayout } para reutilizar la misma
// maquinaria en el dashboard ADMIN/CEO (keys distintas por viewport:
// `dashboard_layout` CLIENT vs `dashboard_layout_admin` ADMIN).
//
// Capa de layout del dashboard del cliente:
//   · DEFAULT_LAYOUT — orden + visibilidad por defecto (CLIENT).
//   · mergeLayout(saved, catalogIds, defaultLayout) — mergea el layout
//     guardado contra el catálogo: ids desconocidos se ignoran, widgets
//     del catálogo que falten se agregan OCULTOS al final (así un widget
//     nuevo aparece disponible aunque el usuario tenga un layout viejo).
//   · useDashboardLayout(catalogIds | opts) — hook: carga
//     preferences[prefKey] de GET /api/portal/me/ y guarda con
//     PATCH debounced (~800 ms) a /api/portal/update_preferences.
//     update_preferences hace merge JSONB SHALLOW de primer nivel, por
//     eso TODO el layout vive bajo una sola key de preferences.
//     Fallback silencioso a localStorage si el fetch/PATCH falla.
//
// Shape del layout:
//   { widgets: [{ id, visible, config? }] }
//   · id de built-in: clave del registry (kpis, pipeline, ...).
//   · id de custom:   "custom:<uuid>" con config { metric, dim, chart, title }.
//   · config en built-in (ADMIN): { scope: "general" | "cliente:<id>" | "marca:<id>" }.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getToken } from "./api.js";

// Defaults CLIENT (compat: useDashboardLayout(CATALOG_IDS) sin opciones).
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
  // config se conserva en customs (metric/dim/chart) y en built-ins con
  // scope (ADMIN) — una entrada sin config simplemente no la trae.
  if (w.config && typeof w.config === "object") {
    out.config = w.config;
  }
  return out;
}

/** Mergea el layout guardado contra el catálogo actual. */
export function mergeLayout(saved, catalogIds, defaultLayout = DEFAULT_LAYOUT) {
  const catalogSet = new Set(catalogIds);
  const base = (saved && Array.isArray(saved.widgets) && saved.widgets.length)
    ? saved.widgets
    : defaultLayout.widgets;
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

const readLocal = (lsKey) => {
  try {
    const raw = localStorage.getItem(lsKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export function useDashboardLayout(catalogIdsOrOpts) {
  // Compat CLIENT: array plano = catalogIds con los defaults de siempre.
  const opts = Array.isArray(catalogIdsOrOpts)
    ? { catalogIds: catalogIdsOrOpts }
    : (catalogIdsOrOpts || {});
  const {
    prefKey = LAYOUT_PREF_KEY,
    lsKey = LS_KEY,
    catalogIds = [],
    defaultLayout = DEFAULT_LAYOUT,
  } = opts;

  const [me, setMe] = useState(null);
  const [layout, setLayoutState] = useState(null); // null = cargando
  const timer = useRef(null);
  // El catálogo es estable (constante de módulo); lo fijamos por clave
  // para no re-fetchear si el caller pasa un array nuevo en cada render.
  const catalogKey = (catalogIds || []).join("|");
  const catalogRef = useRef(catalogIds);
  catalogRef.current = catalogIds;
  const defaultRef = useRef(defaultLayout);
  defaultRef.current = defaultLayout;

  useEffect(() => {
    let alive = true;
    apiFetch("/portal/me/", { token: getToken() })
      .then((data) => {
        if (!alive) return;
        setMe(data || null);
        const saved = data?.preferences?.[prefKey] || readLocal(lsKey);
        setLayoutState(mergeLayout(saved, catalogRef.current, defaultRef.current));
      })
      .catch(() => {
        // Fallback silencioso: layout local o DEFAULT.
        if (!alive) return;
        setLayoutState(mergeLayout(readLocal(lsKey), catalogRef.current, defaultRef.current));
      });
    return () => { alive = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey, prefKey, lsKey]);

  /** Aplica un layout nuevo: estado + localStorage + PATCH debounced. */
  const save = useCallback((next) => {
    setLayoutState(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch { /* noop */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch("/portal/update_preferences", {
        method: "PATCH",
        body: { preferences: { [prefKey]: next } },
        token: getToken(),
      }).catch(() => { /* fallback silencioso: ya quedó en localStorage */ });
    }, SAVE_DEBOUNCE_MS);
  }, [prefKey, lsKey]);

  const reset = useCallback(() => {
    save(mergeLayout(null, catalogRef.current, defaultRef.current));
  }, [save]);

  return { me, layout, save, reset, loading: layout === null };
}
