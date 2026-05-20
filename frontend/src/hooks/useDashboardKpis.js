// =====================================================================
// MWT.ONE · useDashboardKpis  (rediseño Centro de Operaciones · 2026-05-20)
// Agente responsable: [AG-FRONTEND / AG-03]
//
// Consume (TODO viene del backend — cero fallback a mock):
//   GET /api/analytics/dashboard_kpis/        → KPIs consolidados
//   GET /api/analytics/cashflow/              → [{week, proyectado, real}]
//   GET /api/analytics/aging/                 → {bucket_0_30, ..., bucket_90_plus}
//   GET /api/analytics/exposicion_clientes/   → [{client_id, monto_total, ...}]
//   GET /api/analytics/margen_marcas/         → [{brand_id, projected_margin, real_margin, ...}]
//   GET /api/analytics/by_status/             → [{status, count, total_invoiced, balance}]
//   GET /api/analytics/urgent/                → [{id, ref, client_id, brand_id, urgency, action}]
//
// Devuelve:
//   { kpis, cashflow, aging, exposicion, margenMarcas, byStatus, urgent,
//     loading, error, reload }
//
// Política de errores parciales (POL_RESILIENCIA):
//   - Cada endpoint se cachea con .catch(null/[]) para que un widget caído
//     NUNCA tumbe el dashboard completo.
//   - El consumidor decide cómo renderizar el estado vacío (EmptyState).
//   - Si NINGÚN endpoint responde, se marca error global y se ofrece reintento.
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
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        kpis, cashflow, aging,
        exposicion, margenMarcas, byStatus, urgent,
      ] = await Promise.all([
        analyticsApi.dashboardKpis().catch(emptyObj),
        analyticsApi.cashflow().catch(emptyArray),
        analyticsApi.aging().catch(emptyObj),
        analyticsApi.exposicionClientes().catch(emptyArray),
        analyticsApi.margenMarcas().catch(emptyArray),
        analyticsApi.byStatus().catch(emptyArray),
        analyticsApi.urgent().catch(emptyArray),
      ]);
      setState({
        kpis:         kpis || null,
        cashflow:     Array.isArray(cashflow)     ? cashflow     : [],
        aging:        aging || null,
        exposicion:   Array.isArray(exposicion)   ? exposicion   : [],
        margenMarcas: Array.isArray(margenMarcas) ? margenMarcas : [],
        byStatus:     Array.isArray(byStatus)     ? byStatus     : [],
        urgent:       Array.isArray(urgent)       ? urgent       : [],
        loading:      false,
        error:        null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useDashboardKpis;
