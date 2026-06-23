// =====================================================================
// MWT.ONE · useInventarioSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos del módulo Inventario.
//   GET /api/stock/select_nodos/
//   GET /api/stock/select_productos/
//   GET /api/movimientos/select_tipos/
//   GET /api/movimientos/select_motivos/?tipo_mov=<codigo>
//
// Devuelve:
//   { nodos, productos, tipos, motivos, loading, error, reload,
//     loadMotivos(tipoMov) }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { stockApi, movimientosApi } from "../lib/api.js";

export function useInventarioSelects() {
  const [state, setState] = useState({
    nodos: [],
    productos: [],
    tipos: [],
    motivos: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async (opts = {}) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [nodos, productos, tipos, motivos] = await Promise.all([
        stockApi.select("nodos", null, opts),
        stockApi.select("productos", null, opts),
        movimientosApi.select("tipos", null, opts),
        movimientosApi.select("motivos", null, opts),
      ]);
      if (opts.signal?.aborted) return;
      setState({
        nodos:     Array.isArray(nodos)     ? nodos     : [],
        productos: Array.isArray(productos) ? productos : [],
        tipos:     Array.isArray(tipos)     ? tipos     : [],
        motivos:   Array.isArray(motivos)   ? motivos   : [],
        loading: false,
        error: null,
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  const loadMotivos = useCallback(async (tipoMov, opts = {}) => {
    try {
      const motivos = await movimientosApi.select(
        "motivos",
        { tipo_mov: tipoMov },
        opts,
      );
      if (opts.signal?.aborted) return [];
      const arr = Array.isArray(motivos) ? motivos : [];
      setState((s) => ({ ...s, motivos: arr }));
      return arr;
    } catch (err) {
      if (err?.name === "AbortError") return [];
      return [];
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load({ signal: ac.signal });
    return () => ac.abort();
  }, [load]);

  return { ...state, reload: load, loadMotivos };
}

export default useInventarioSelects;
