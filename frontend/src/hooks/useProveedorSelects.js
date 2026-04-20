// =====================================================================
// MWT.ONE · useProveedorSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos del formulario de Proveedores.
// Devuelve:
//   { tipos, estados, incoterms, paises, responsables,
//     loading, error, reload }
//
// Endpoints:
//   GET /api/proveedores/select_tipos/
//   GET /api/proveedores/select_estados/
//   GET /api/proveedores/select_incoterms/
//   GET /api/proveedores/select_paises/
//   GET /api/proveedores/select_responsables/
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { proveedoresApi } from "../lib/api.js";

export function useProveedorSelects() {
  const [state, setState] = useState({
    tipos: [],
    estados: [],
    incoterms: [],
    paises: [],
    responsables: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [tipos, estados, incoterms, paises, responsables] = await Promise.all([
        proveedoresApi.select("tipos"),
        proveedoresApi.select("estados"),
        proveedoresApi.select("incoterms"),
        proveedoresApi.select("paises"),
        proveedoresApi.select("responsables"),
      ]);
      setState({
        tipos:        Array.isArray(tipos)        ? tipos        : [],
        estados:      Array.isArray(estados)      ? estados      : [],
        incoterms:    Array.isArray(incoterms)    ? incoterms    : [],
        paises:       Array.isArray(paises)       ? paises       : [],
        responsables: Array.isArray(responsables) ? responsables : [],
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

export default useProveedorSelects;
