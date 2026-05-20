// =====================================================================
// MWT.ONE · hooks/useSkuTallas.js
// Agente responsable: [AG-03 FRONTEND]
//
// Carga las tallas asignadas a un SKU del Marluvas simulator. Estrategia:
//
//   1. Resolver sku → productoId via productosApi.list({ q: sku }).
//   2. Resolver productoId → producto.tallas (UUIDs) via productosApi.get().
//   3. Hidratar UUIDs → {talla_base, tipo_producto} desde tallasApi.list()
//      (cache module-level compartido entre todos los SKUs).
//
// Devuelve { loading, tallas: [{uuid, label, tipo}], error }.
//
// Caches module-level (no localStorage — viven mientras el módulo está cargado):
//   · SIZE_META_PROMISE   Promise<Map<uuid, meta>>  · single-shot global
//   · SKU_TO_PID_CACHE    Map<sku, productoId>      · por SKU resuelto
//   · PID_TO_TALLAS_CACHE Map<pid, uuid[]>          · por producto resuelto
// =====================================================================
import { useEffect, useState } from "react";
import { productosApi, tallasApi } from "../lib/api.js";

let SIZE_META_PROMISE = null;          // singleton Promise<Map>
const SKU_TO_PID_CACHE = new Map();    // sku -> productoId | null
const PID_TO_TALLAS_CACHE = new Map(); // pid -> uuid[]

function loadSizeMeta() {
  if (SIZE_META_PROMISE) return SIZE_META_PROMISE;
  SIZE_META_PROMISE = tallasApi.list({ limit: 500 })
    .then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      const m = new Map();
      for (const sz of arr) {
        const label = sz.talla_base || sz.eu || sz.us_men || sz.nombre || sz.codigo || "—";
        m.set(String(sz.id), {
          uuid:           String(sz.id),
          label,
          tipo_producto:  sz.tipo_producto || null,
        });
      }
      return m;
    })
    .catch(() => new Map());
  return SIZE_META_PROMISE;
}

async function resolveProductoId(sku) {
  const key = String(sku);
  if (SKU_TO_PID_CACHE.has(key)) return SKU_TO_PID_CACHE.get(key);
  try {
    const d = await productosApi.list({ q: key });
    const arr = Array.isArray(d) ? d : (d?.results || []);
    const hit = arr.find((p) => String(p.sku || "").toUpperCase() === key.toUpperCase());
    const pid = hit?.id || null;
    SKU_TO_PID_CACHE.set(key, pid);
    return pid;
  } catch {
    SKU_TO_PID_CACHE.set(key, null);
    return null;
  }
}

async function resolveTallaUuids(productoId) {
  if (!productoId) return [];
  if (PID_TO_TALLAS_CACHE.has(productoId)) return PID_TO_TALLAS_CACHE.get(productoId);
  try {
    const full = await productosApi.get(productoId);
    const raw = Array.isArray(full?.tallas) ? full.tallas : [];
    // Las tallas pueden venir como UUID strings o como objetos {id,...}.
    const uuids = raw
      .map((t) => (typeof t === "object" && t ? String(t.id || "") : String(t || "")))
      .filter(Boolean);
    PID_TO_TALLAS_CACHE.set(productoId, uuids);
    return uuids;
  } catch {
    PID_TO_TALLAS_CACHE.set(productoId, []);
    return [];
  }
}

/**
 * @param {string} sku       SKU Marluvas (7xxxxx / 8xxxxx).
 * @param {boolean} enabled  Si false, no dispara la carga (lazy hook).
 * @returns {{ loading: boolean, error: string|null,
 *             tallas: Array<{uuid:string, label:string, tipo:string|null}> }}
 */
export function useSkuTallas(sku, enabled = true) {
  const [state, setState] = useState({ loading: false, error: null, tallas: [] });

  useEffect(() => {
    if (!enabled || !sku) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all([loadSizeMeta(), resolveProductoId(sku)])
      .then(async ([meta, pid]) => {
        if (cancelled) return;
        if (!pid) {
          setState({ loading: false, error: "PRODUCT_NOT_FOUND", tallas: [] });
          return;
        }
        const uuids = await resolveTallaUuids(pid);
        if (cancelled) return;
        const tallas = uuids.map((u) => {
          const m = meta.get(String(u));
          return {
            uuid:  String(u),
            label: m?.label || String(u).slice(0, 6),
            tipo:  m?.tipo_producto || null,
          };
        });
        setState({ loading: false, error: null, tallas });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({ loading: false, error: String(e?.message || e), tallas: [] });
        }
      });

    return () => { cancelled = true; };
  }, [sku, enabled]);

  return state;
}

export default useSkuTallas;
