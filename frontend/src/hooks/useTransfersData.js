// =====================================================================
// MWT.ONE · useTransfersData
// Agente responsable: [AG-FRONTEND]
//
// Consume:
//   GET /api/transferencias/
//   GET /api/transferencias/kpis/
//   GET /api/transferencias/select_estados/
//   GET /api/transferencias/select_legal_contexts/
//
// Devuelve:
//   { transfers, kpis, estados, legalContexts, loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { transferenciasApi } from "../lib/api.js";

export function useTransfersData(params) {
  const [state, setState] = useState({
    transfers: [], kpis: null, estados: [], legalContexts: [],
    loading: true, error: null,
  });

  const key = params ? JSON.stringify(params) : "";

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [transfers, kpis, estados, legalContexts] = await Promise.all([
        transferenciasApi.list(params).catch(() => []),
        transferenciasApi.action("kpis").catch(() => null),
        transferenciasApi.select("estados").catch(() => []),
        transferenciasApi.select("legal_contexts").catch(() => []),
      ]);
      setState({
        transfers:     Array.isArray(transfers) ? transfers : (transfers?.results || []),
        kpis:          kpis || null,
        estados:       Array.isArray(estados) ? estados : [],
        legalContexts: Array.isArray(legalContexts) ? legalContexts : [],
        loading:       false,
        error:         null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useTransfersData;
