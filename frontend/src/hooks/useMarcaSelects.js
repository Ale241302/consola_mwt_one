// =====================================================================
// MWT.ONE · useMarcaSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos que alimentan el formulario de Marcas (brands).
// Devuelve:
//   { categorias, estados, paises, responsables, loading, error, reload }
//
// Endpoints consumidos:
//   GET /api/marcas/select_categorias/
//   GET /api/marcas/select_estados/
//   GET /api/marcas/select_paises/
//   GET /api/marcas/select_responsables/
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { marcasApi } from "../lib/api.js";

export function useMarcaSelects() {
  const [state, setState] = useState({
    categorias: [],
    estados: [],
    paises: [],
    responsables: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [categorias, estados, paises, responsables] = await Promise.all([
        marcasApi.select("categorias"),
        marcasApi.select("estados"),
        marcasApi.select("paises"),
        marcasApi.select("responsables"),
      ]);
      setState({
        categorias:   Array.isArray(categorias)   ? categorias   : [],
        estados:      Array.isArray(estados)      ? estados      : [],
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

export default useMarcaSelects;
