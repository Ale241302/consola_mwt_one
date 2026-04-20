// =====================================================================
// MWT.ONE · useNodoSelects
// Agente responsable: [AG-FRONTEND]
//
// Hook que trae TODOS los catálogos que consume el formulario de Nodos
// desde el backend (cero hardcode). Devuelve:
//   { tipos, paises, responsables, loading, error, reload }
//
// Endpoints consumidos:
//   GET /api/nodos/select_tipos/
//   GET /api/nodos/select_paises/
//   GET /api/nodos/select_responsables/
//
// Cada item tiene forma: { codigo, label, color? }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { nodosApi } from "../lib/api.js";

export function useNodoSelects() {
  const [state, setState] = useState({
    tipos: [],
    paises: [],
    responsables: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [tipos, paises, responsables] = await Promise.all([
        nodosApi.select("tipos"),
        nodosApi.select("paises"),
        nodosApi.select("responsables"),
      ]);
      setState({
        tipos:        Array.isArray(tipos)        ? tipos        : [],
        paises:       Array.isArray(paises)       ? paises       : [],
        responsables: Array.isArray(responsables) ? responsables : [],
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

export default useNodoSelects;
