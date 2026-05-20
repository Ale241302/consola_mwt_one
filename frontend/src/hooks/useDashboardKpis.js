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
//
// Devuelve un bundle único con TODO el estado del dashboard:
//   { kpis, cashflow, aging, exposicion, margenMarcas, byStatus, urgent,
//     creditClock, r1Ratio, byStatusByBrand, inventoryByNode, topSkus,
//     marginScatter, loading, error, reload }
//
// Política de errores parciales (POL_RESILIENCIA):
//   Cada endpoint se cachea con .catch(null/[]) — un widget caído NUNCA
//   tumba el dashboard. El consumidor decide cómo renderizar el estado
//   vacío con <EmptyState/>.
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { analyticsApi } from "../lib/api.js";

const emptyArray = () => [];
const emptyObj   = () => null;

export function useDashboardKpis() {
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
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        kpis, cashflow, aging,
        exposicion, margenMarcas, byStatus, urgent,
        creditClock, r1Ratio, byStatusByBrand,
        inventoryByNode, topSkus, marginScatter,
        sizeMarket,
      ] = await Promise.all([
        analyticsApi.dashboardKpis().catch(emptyObj),
        analyticsApi.cashflow().catch(emptyArray),
        analyticsApi.aging().catch(emptyObj),
        analyticsApi.exposicionClientes().catch(emptyArray),
        analyticsApi.margenMarcas().catch(emptyArray),
        analyticsApi.byStatus().catch(emptyArray),
        analyticsApi.urgent().catch(emptyArray),
        analyticsApi.creditClockAvg().catch(emptyObj),
        analyticsApi.r1CorrectionRatio().catch(emptyObj),
        analyticsApi.byStatusByBrand().catch(emptyArray),
        analyticsApi.inventoryCoverageByNode().catch(emptyArray),
        analyticsApi.topSkusMargen().catch(emptyArray),
        analyticsApi.expedienteMarginScatter().catch(emptyArray),
        analyticsApi.sizeMarketDistribution().catch(emptyObj),
      ]);
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
        loading:         false,
        error:           null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useDashboardKpis;
