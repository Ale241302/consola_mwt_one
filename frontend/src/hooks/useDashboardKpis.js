// =====================================================================
// MWT.ONE · useDashboardKpis
// Agente responsable: [AG-FRONTEND]
//
// Consume:
//   GET /api/analytics/dashboard_kpis/
//   GET /api/analytics/cashflow/
//   GET /api/analytics/aging/
//
// Devuelve:
//   { kpis, cashflow, aging, loading, error, reload }
//
// Shape de `kpis` (tal como lo emite el backend):
//   { active, total_cost, total_invoiced, total_paid, receivables,
//     margin_pct, by_status:[{status,count}], by_brand:[...],
//     urgent:[...], cash_90:[{month,invoiced,paid}] }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { analyticsApi } from "../lib/api.js";

export function useDashboardKpis() {
  const [state, setState] = useState({
    kpis: null, cashflow: [], aging: null,
    loading: true, error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [kpis, cashflow, aging] = await Promise.all([
        analyticsApi.dashboardKpis().catch(() => null),
        analyticsApi.cashflow().catch(() => []),
        analyticsApi.aging().catch(() => null),
      ]);
      setState({
        kpis:      kpis || null,
        cashflow:  Array.isArray(cashflow) ? cashflow : [],
        aging:     aging || null,
        loading:   false,
        error:     null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useDashboardKpis;
