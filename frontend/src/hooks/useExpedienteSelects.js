// =====================================================================
// MWT.ONE · useExpedienteSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos del módulo Expedientes / OCs.
//   GET /api/ocs/select_estados/
//   GET /api/expedientes/select_estados/
//   GET /api/expedientes/select_modos/
//   GET /api/expedientes/select_incoterms/
//
// Devuelve:
//   { estadosOc, estadosExp, modos, incoterms, loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { ocsApi, expedientesApi } from "../lib/api.js";

export function useExpedienteSelects() {
  const [state, setState] = useState({
    estadosOc:  [],
    estadosExp: [],
    modos:      [],
    incoterms:  [],
    loading:    true,
    error:      null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [estadosOc, estadosExp, modos, incoterms] = await Promise.all([
        ocsApi.select("estados"),
        expedientesApi.select("estados"),
        expedientesApi.select("modos"),
        expedientesApi.select("incoterms"),
      ]);
      setState({
        estadosOc:  Array.isArray(estadosOc)  ? estadosOc  : [],
        estadosExp: Array.isArray(estadosExp) ? estadosExp : [],
        modos:      Array.isArray(modos)      ? modos      : [],
        incoterms:  Array.isArray(incoterms)  ? incoterms  : [],
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useExpedienteSelects;
