// =====================================================================
// MWT.ONE · useCobroSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos del módulo Cobros / Pagos.
//   GET /api/pagos/select_metodos/
//   GET /api/pagos/select_estados/
//   GET /api/pagos/select_direcciones/
//   GET /api/cobros/select_estados/
//
// Devuelve:
//   { metodos, estadosPago, estadosCobro, direcciones,
//     loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { pagosApi, cobrosApi } from "../lib/api.js";

export function useCobroSelects() {
  const [state, setState] = useState({
    metodos:      [],
    estadosPago:  [],
    estadosCobro: [],
    direcciones:  [],
    loading:      true,
    error:        null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [metodos, estadosPago, direcciones, estadosCobro] = await Promise.all([
        pagosApi.select("metodos"),
        pagosApi.select("estados"),
        pagosApi.select("direcciones"),
        cobrosApi.select("estados"),
      ]);
      setState({
        metodos:      Array.isArray(metodos)      ? metodos      : [],
        estadosPago:  Array.isArray(estadosPago)  ? estadosPago  : [],
        estadosCobro: Array.isArray(estadosCobro) ? estadosCobro : [],
        direcciones:  Array.isArray(direcciones)  ? direcciones  : [],
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

export default useCobroSelects;
