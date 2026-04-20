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

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [categorias, subcategorias, unidades, estados, marcas, proveedores, paises] =
        await Promise.all([
          productosApi.select("categorias"),
          productosApi.select("subcategorias"),
          productosApi.select("unidades"),
          productosApi.select("estados"),
          productosApi.select("marcas"),
          productosApi.select("proveedores"),
          productosApi.select("paises"),
        ]);
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
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  // Sub-select: cuando cambia la categoría seleccionada en el FE.
  const loadSubcategorias = useCallback(async (categoriaCode) => {
    try {
      const subs = await productosApi.action(
        `select_subcategorias/?categoria=${encodeURIComponent(categoriaCode)}`
      );
      const arr = Array.isArray(subs) ? subs : [];
      setState((s) => ({ ...s, subcategorias: arr }));
      return arr;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load, loadSubcategorias };
}

export default useProductoSelects;
