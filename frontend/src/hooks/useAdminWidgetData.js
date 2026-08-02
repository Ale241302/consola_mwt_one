// =====================================================================
// MWT.ONE · useAdminWidgetData
// Sprint 2026-08-02 · Dashboard personalizable ADMIN/CEO.
//
// Capa de datos POR WIDGET: cada widget del grid admin fetchea su propio
// endpoint de analytics con sus propios params de scope
// ({ client_id, brand_id }) en vez del bundle monolítico de
// useDashboardKpis (que este hook reemplaza — Dashboard.jsx era su único
// consumidor).
//
// Caché SWR (lib/swrCache.js), key `analytics:<endpoint>:<paramsKey>`:
//   · Widgets con el mismo endpoint+scope comparten fetch/cache (p.ej.
//     los filtrados client-side piden scope general una sola vez).
//   · Siempre revalida en segundo plano: pinta lo cacheado al instante
//     y actualiza cuando llega la respuesta fresca.
//   · refreshNonce (botón "Actualizar" del header) fuerza re-fetch de
//     todos los widgets montados.
//
// Política de errores (POL_RESILIENCIA): un endpoint caído deja
// data=null/[] y error seteado — el widget pinta EmptyState honesto,
// nunca tumba el grid.
// =====================================================================
import { useEffect, useState } from "react";
import { analyticsApi } from "../lib/api.js";
import { readCache, writeCache } from "../lib/swrCache.js";

// endpointKey → método de analyticsApi.
const METHODS = {
  kpis:             "dashboardKpis",
  cashflow:         "cashflow",
  aging:            "aging",
  exposicion:       "exposicionClientes",
  margen_marcas:    "margenMarcas",
  urgent:           "urgent",
  credit_clock:     "creditClockAvg",
  r1:               "r1CorrectionRatio",
  by_status_brand:  "byStatusByBrand",
  inventory_nodes:  "inventoryCoverageByNode",
  top_skus:         "topSkusMargen",
  margin_scatter:   "expedienteMarginScatter",
  size_market:      "sizeMarketDistribution",
  tacos:            "tacosFbaUs",
};

export function useAdminWidgetData(endpointKey, params = null, refreshNonce = 0) {
  const paramsKey = params ? JSON.stringify(params) : "";
  const cacheKey = `analytics:${endpointKey}:${paramsKey}`;
  const [state, setState] = useState(() => {
    const cached = readCache(cacheKey);
    return { data: cached !== undefined ? cached : null, loading: cached === undefined, error: null };
  });

  useEffect(() => {
    const method = METHODS[endpointKey];
    if (!method) return undefined;
    let alive = true;
    const params = paramsKey ? JSON.parse(paramsKey) : undefined;
    const cached = readCache(cacheKey);
    if (cached !== undefined) {
      setState({ data: cached, loading: false, error: null });
    } else {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    analyticsApi[method]({ params })
      .then((d) => {
        if (!alive) return;
        writeCache(cacheKey, d);
        setState({ data: d, loading: false, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: err }));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointKey, paramsKey, refreshNonce]);

  return state;
}

export default useAdminWidgetData;
