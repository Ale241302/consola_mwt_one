// =====================================================================
// MWT.ONE · useAdminWidgetData
// Sprint 2026-08-02 · Dashboard personalizable ADMIN/CEO.
//
// Capa de datos POR WIDGET. Sprint 2026-09-11 · performance: en vez de
// disparar 1 request por widget (~14 endpoints → ~13s en server CPU-bound),
// ahora todos los widgets comparten UNA sola request al bundle
// `/api/analytics/dashboard_bundle/` (single-flight por scope). Cada widget
// lee su key del payload.
//
// Caché SWR (lib/swrCache.js), key `analytics:<endpoint>:<paramsKey>`:
//   · Widgets con el mismo endpoint+scope comparten fetch/cache.
//   · Siempre revalida en segundo plano (pinta lo cacheado al instante).
//   · refreshNonce (botón "Actualizar") invalida el bundle una vez.
//
// Política de errores (POL_RESILIENCIA): un endpoint caído deja data=null/[]
// — el widget pinta EmptyState honesto, nunca tumba el grid.
// =====================================================================
import { useEffect, useState } from "react";
import { analyticsApi } from "../lib/api.js";
import { readCache, writeCache } from "../lib/swrCache.js";

// Single-flight del bundle: todas las keys comparten UNA request por scope.
const _bundleInflight = new Map();  // paramsKey -> Promise
let _lastForceNonce = 0;

function fetchBundle(params, refreshNonce) {
  const paramsKey = params ? JSON.stringify(params) : "";
  if (refreshNonce && refreshNonce !== _lastForceNonce) {
    _lastForceNonce = refreshNonce;
    _bundleInflight.clear();
  }
  if (_bundleInflight.has(paramsKey)) return _bundleInflight.get(paramsKey);
  const p = analyticsApi.dashboardBundle({ params })
    .then((d) => {
      _bundleInflight.delete(paramsKey);
      return d;
    })
    .catch((e) => {
      _bundleInflight.delete(paramsKey);
      throw e;
    });
  _bundleInflight.set(paramsKey, p);
  return p;
}

export function useAdminWidgetData(endpointKey, params = null, refreshNonce = 0) {
  const paramsKey = params ? JSON.stringify(params) : "";
  const cacheKey = `analytics:${endpointKey}:${paramsKey}`;
  const [state, setState] = useState(() => {
    const cached = readCache(cacheKey);
    return { data: cached !== undefined ? cached : null, loading: cached === undefined, error: null };
  });

  useEffect(() => {
    let alive = true;
    const cached = readCache(cacheKey);
    if (cached !== undefined) {
      setState({ data: cached, loading: false, error: null });
    } else {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    const p = paramsKey ? JSON.parse(paramsKey) : null;
    fetchBundle(p, refreshNonce)
      .then((bundle) => {
        if (!alive) return;
        const data = bundle ? bundle[endpointKey] : null;
        writeCache(cacheKey, data);
        setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: err }));
      });
    return () => { alive = false; };
  }, [endpointKey, paramsKey, refreshNonce, cacheKey]);

  return state;
}

export default useAdminWidgetData;
