// =====================================================================
// MWT.ONE · useDashboardKpis  (Centro de Operaciones · 2026-05-20)
// Agente responsable: [AG-FRONTEND / AG-03]
//
// Consume (TODO viene del backend — cero fallback a mock):
//   GET /api/analytics/dashboard_kpis/
//   GET /api/analytics/cashflow/
//   GET /api/analytics/aging/
//   GET /api/analytics/exposicion_clientes/
//   GET /api/analytics/margen_marcas/
//   GET /api/analytics/by_status/
//   GET /api/analytics/urgent/
//   GET /api/analytics/credit_clock_avg/            (Sprint 2026-05-20)
//   GET /api/analytics/r1_correction_ratio/         (Sprint 2026-05-20)
//   GET /api/analytics/by_status_by_brand/          (Sprint 2026-05-20)
//   GET /api/analytics/inventory_coverage_by_node/  (Sprint 2026-05-20)
//   GET /api/analytics/top_skus_margen/             (Sprint 2026-05-20)
//   GET /api/analytics/expediente_margin_scatter/   (Sprint 2026-05-20)
//   GET /api/analytics/tacos_fba_us/                (Sprint dashboard 2026-05-21)
//
// Devuelve un bundle único con TODO el estado del dashboard:
//   { kpis, cashflow, aging, exposicion, margenMarcas, byStatus, urgent,
//     creditClock, r1Ratio, byStatusByBrand, inventoryByNode, topSkus,
//     marginScatter, tacosFba, loading, error, reload }
//
// Política de errores parciales (POL_RESILIENCIA):
//   Cada endpoint se cachea con .catch(null/[]) — un widget caído NUNCA
//   tumba el dashboard. El consumidor decide cómo renderizar el estado
//   vacío con <EmptyState/>.
// =====================================================================
import { useEffect, useState, useCallback, useRef } from "react";
import { analyticsApi } from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";

const emptyArrayUnlessAbort = (err) => {
  if (err?.name === "AbortError") throw err;
  return [];
};
const emptyObjUnlessAbort = (err) => {
  if (err?.name === "AbortError") throw err;
  return null;
};

export function useDashboardKpis() {
  const { isAdmin } = useRole();
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const [state, setState] = useState({
    kpis: null,
    cashflow: [],
    aging: null,
    exposicion: [],
    margenMarcas: [],
    byStatus: [],
    urgent: [],
    creditClock: null,
    r1Ratio: null,
    byStatusByBrand: [],
    inventoryByNode: [],
    topSkus: [],
    marginScatter: [],
    sizeMarket: null,
    tacosFba: null,
    loading: isAdmin,
    error: null,
  });

  // Carga admin-only: clientes no disparan endpoints de analytics CEO.
  // Cada carga tiene AbortController propio y requestId para evitar carreras.
  const load = useCallback(async () => {
    if (!isAdmin) {
      controllerRef.current?.abort();
      setState((s) => ({ ...s, loading: false, error: null }));
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const opts = { signal: controller.signal };
    const isCurrent = () => (
      !controller.signal.aborted && requestIdRef.current === requestId
    );

    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        kpis, cashflow, aging,
        exposicion, margenMarcas, byStatus, urgent,
        creditClock, r1Ratio, byStatusByBrand,
        inventoryByNode, topSkus, marginScatter,
        sizeMarket, tacosFba,
      ] = await Promise.all([
        analyticsApi.dashboardKpis(opts).catch(emptyObjUnlessAbort),
        analyticsApi.cashflow(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.aging(opts).catch(emptyObjUnlessAbort),
        analyticsApi.exposicionClientes(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.margenMarcas(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.byStatus(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.urgent(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.creditClockAvg(opts).catch(emptyObjUnlessAbort),
        analyticsApi.r1CorrectionRatio(opts).catch(emptyObjUnlessAbort),
        analyticsApi.byStatusByBrand(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.inventoryCoverageByNode(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.topSkusMargen(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.expedienteMarginScatter(opts).catch(emptyArrayUnlessAbort),
        analyticsApi.sizeMarketDistribution(opts).catch(emptyObjUnlessAbort),
        analyticsApi.tacosFbaUs(opts).catch(emptyObjUnlessAbort),
      ]);
      if (!isCurrent()) return;
      setState({
        kpis:            kpis || null,
        cashflow:        Array.isArray(cashflow)        ? cashflow        : [],
        aging:           aging || null,
        exposicion:      Array.isArray(exposicion)      ? exposicion      : [],
        margenMarcas:    Array.isArray(margenMarcas)    ? margenMarcas    : [],
        byStatus:        Array.isArray(byStatus)        ? byStatus        : [],
        urgent:          Array.isArray(urgent)          ? urgent          : [],
        creditClock:     creditClock || null,
        r1Ratio:         r1Ratio || null,
        byStatusByBrand: Array.isArray(byStatusByBrand) ? byStatusByBrand : [],
        inventoryByNode: Array.isArray(inventoryByNode) ? inventoryByNode : [],
        topSkus:         Array.isArray(topSkus)         ? topSkus         : [],
        marginScatter:   Array.isArray(marginScatter)   ? marginScatter   : [],
        sizeMarket:      sizeMarket || null,
        tacosFba:        tacosFba || null,
        loading:         false,
        error:           null,
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (!isCurrent()) return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, [isAdmin]);

  // Cleanup en desmontaje: cancela HTTP real y evita setState tard?o.
  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);

  // No exponer load directamente como onClick: React pasar?a el evento.
  const reload = useCallback(() => load(), [load]);

  return { ...state, reload };
}

export default useDashboardKpis;
