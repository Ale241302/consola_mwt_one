// =====================================================================
// MWT.ONE · useProductoSelects
// Agente responsable: [AG-FRONTEND]
//
// Catálogos del formulario de Productos.
// Devuelve:
//   { categorias, subcategorias, unidades, estados, marcas, proveedores,
//     paises, loading, error, reload, loadSubcategorias(categoria) }
//
// Endpoints:
//   GET /api/productos/select_categorias/
//   GET /api/productos/select_subcategorias/?categoria=<codigo>
//   GET /api/productos/select_unidades/
//   GET /api/productos/select_estados/
//   GET /api/productos/select_marcas/
//   GET /api/productos/select_proveedores/
//   GET /api/productos/select_paises/
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { productosApi } from "../lib/api.js";

export function useProductoSelects() {
  const [state, setState] = useState({
    categorias: [],
    subcategorias: [],
    unidades: [],
    estados: [],
    marcas: [],
    proveedores: [],
    paises: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async (opts = {}) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [categorias, subcategorias, unidades, estados, marcas, proveedores, paises] =
        await Promise.all([
          productosApi.select("categorias", null, opts),
          productosApi.select("subcategorias", null, opts),
          productosApi.select("unidades", null, opts),
          productosApi.select("estados", null, opts),
          productosApi.select("marcas", null, opts),
          productosApi.select("proveedores", null, opts),
          productosApi.select("paises", null, opts),
        ]);
      if (opts.signal?.aborted) return;
      setState({
        categorias:    Array.isArray(categorias)    ? categorias    : [],
        subcategorias: Array.isArray(subcategorias) ? subcategorias : [],
        unidades:      Array.isArray(unidades)      ? unidades      : [],
        estados:       Array.isArray(estados)       ? estados       : [],
        marcas:        Array.isArray(marcas)        ? marcas        : [],
        proveedores:   Array.isArray(proveedores)   ? proveedores   : [],
        paises:        Array.isArray(paises)        ? paises        : [],
        loading: false,
        error: null,
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  // Sub-select: cuando cambia la categoría seleccionada en el FE.
  const loadSubcategorias = useCallback(async (categoriaCode, opts = {}) => {
    try {
      const subs = await productosApi.select(
        "subcategorias",
        { categoria: categoriaCode },
        opts,
      );
      if (opts.signal?.aborted) return [];
      const arr = Array.isArray(subs) ? subs : [];
      setState((s) => ({ ...s, subcategorias: arr }));
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

  return { ...state, reload: load, loadSubcategorias };
}

export default useProductoSelects;
