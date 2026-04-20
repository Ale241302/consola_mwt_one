// =====================================================================
// MWT.ONE · useClienteSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos que alimentan el formulario de Clientes.
// Devuelve:
//   { tipos, estados, segmentos, paises, nodos, responsables,
//     loading, error, reload }
//
// Endpoints consumidos:
//   GET /api/clientes/select_tipos/
//   GET /api/clientes/select_estados/
//   GET /api/clientes/select_segmentos/
//   GET /api/clientes/select_paises/
//   GET /api/clientes/select_nodos/
//   GET /api/clientes/select_responsables/
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { clientesApi } from "../lib/api.js";

export function useClienteSelects() {
  const [state, setState] = useState({
    tipos: [],
    estados: [],
    segmentos: [],
    paises: [],
    nodos: [],
    responsables: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [tipos, estados, segmentos, paises, nodos, responsables] =
        await Promise.all([
          clientesApi.select("tipos"),
          clientesApi.select("estados"),
          clientesApi.select("segmentos"),
          clientesApi.select("paises"),
          clientesApi.select("nodos"),
          clientesApi.select("responsables"),
        ]);
      setState({
        tipos:        Array.isArray(tipos)        ? tipos        : [],
        estados:      Array.isArray(estados)      ? estados      : [],
        segmentos:    Array.isArray(segmentos)    ? segmentos    : [],
        paises:       Array.isArray(paises)       ? paises       : [],
        nodos:        Array.isArray(nodos)        ? nodos        : [],
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

export default useClienteSelects;
