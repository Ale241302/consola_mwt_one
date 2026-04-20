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

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [nodos, productos, tipos, motivos] = await Promise.all([
        stockApi.select("nodos"),
        stockApi.select("productos"),
        movimientosApi.select("tipos"),
        movimientosApi.select("motivos"),
      ]);
      setState({
        nodos:     Array.isArray(nodos)     ? nodos     : [],
        productos: Array.isArray(productos) ? productos : [],
        tipos:     Array.isArray(tipos)     ? tipos     : [],
        motivos:   Array.isArray(motivos)   ? motivos   : [],
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  const loadMotivos = useCallback(async (tipoMov) => {
    try {
      const motivos = await movimientosApi.action(
        `select_motivos/?tipo_mov=${encodeURIComponent(tipoMov)}`
      );
      const arr = Array.isArray(motivos) ? motivos : [];
      setState((s) => ({ ...s, motivos: arr }));
      return arr;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load, loadMotivos };
}

export default useInventarioSelects;
