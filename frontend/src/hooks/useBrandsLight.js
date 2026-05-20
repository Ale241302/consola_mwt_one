// =====================================================================
// MWT.ONE · useBrandsLight
// Hook ligero para resolver brand_id → {nombre, slug, color} en el Dashboard.
// No persiste, no cachea entre rutas — solo evita re-fetch dentro de la vista.
//
// Shape esperado del backend (apps/brands/serializers.MarcaListSerializer):
//   { id, nombre, slug, brand_code, pais_origen_iso2, categoria_principal,
//     estado_comercial, is_active, logo_url, ... }
//
// El color NO viene del backend (la BD de marcas no tiene columna color
// estandarizada todavía). Lo derivamos de un palette MWT determinístico
// a partir del slug para que cada marca tenga un color estable visualmente.
//
// Cuando exista `marcas.color_hex` o similar en BD, reemplazar `pickColor()`
// por el campo del backend y eliminar el palette local.
// =====================================================================
import { useEffect, useState, useCallback, useMemo } from "react";
import { marcasApi } from "../lib/api.js";

// Paleta MWT — todas son CSS vars válidos (R1: cero hex hardcoded).
// El orden es estable: brand[i] → palette[i % palette.length].
const BRAND_PALETTE = [
  "var(--brand-primary)",
  "var(--brand-accent-dark)",
  "var(--warning)",
  "var(--info)",
  "var(--success)",
  "var(--brand-primary-light)",
  "var(--brand-accent)",
];

function hashSlug(slug) {
  // FNV-1a 32-bit reducido — barato y estable.
  let h = 2166136261;
  const s = String(slug || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function pickColor(slug) {
  if (!slug) return BRAND_PALETTE[0];
  return BRAND_PALETTE[hashSlug(slug) % BRAND_PALETTE.length];
}

export function useBrandsLight() {
  const [state, setState] = useState({
    brands: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await marcasApi.list().catch(() => null);
      // El endpoint puede devolver paginado {results:[...]} o array plano.
      const arr = Array.isArray(data) ? data
                : Array.isArray(data?.results) ? data.results
                : [];
      const normalized = arr.map((b) => ({
        id:        b.id,
        name:      b.nombre || b.name || b.slug || "—",
        slug:      b.slug || b.brand_code || b.id,
        code:      b.brand_code || b.slug || "",
        color:     pickColor(b.slug || b.id),
        active:    b.is_active !== false,
      }));
      setState({ brands: normalized, loading: false, error: null });
    } catch (err) {
      setState({ brands: [], loading: false, error: err });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lookup helpers (estables, no se recrean en cada render).
  const byId = useMemo(() => {
    const m = new Map();
    state.brands.forEach((b) => m.set(b.id, b));
    return m;
  }, [state.brands]);

  const resolveBrand = useCallback((idOrSlug) => {
    if (!idOrSlug) return null;
    return byId.get(idOrSlug) || state.brands.find((b) => b.slug === idOrSlug) || null;
  }, [byId, state.brands]);

  return { ...state, resolveBrand, reload: load };
}

export default useBrandsLight;
