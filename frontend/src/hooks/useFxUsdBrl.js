// =====================================================================
// MWT.ONE · useFxUsdBrl
// Hook que provee tasa de cambio USD→BRL para display en el Dashboard.
//
// Comportamiento:
//   1. Lee localStorage `mwt:dashboard-fx-usd-brl` (cache cliente). Si la
//      tasa cacheada tiene < 60 minutos, la usa sin pegarle al backend.
//   2. Pide /api/commercial/exchange-rate/usd-brl/ (cadena AwesomeAPI →
//      Frankfurter → Redis). Cuando responde, actualiza localStorage.
//   3. NUNCA inventa una tasa. Si la API falla y no hay cache, retorna
//      { rate: null, error: "..." } y el UI muestra
//      "[PENDIENTE — FX no disponible]" (mandato R1 del prompt CEO).
//
// API local:
//   const fx = useFxUsdBrl();
//   fx.rate          // number | null
//   fx.source        // string | null
//   fx.fetchedAt     // ISO string | null
//   fx.loading       // boolean
//   fx.error         // string | null
//   fx.refresh()     // fuerza re-fetch (?refresh=1)
//   fx.convert(usd)  // usd * rate || null si no hay tasa
//
// Patrón coherente con BrandClientPricingForm (`mwt:marluvas-sim:*`)
// pero con clave dashboard-específica para no chocar.
// =====================================================================
import { useCallback, useEffect, useState } from "react";
import { fxApi } from "../lib/api.js";

const LS_KEY = "mwt:dashboard-fx-usd-brl";
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 min — espejo del Redis del backend

function readCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.rate !== "number") return null;
    return obj;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceeded o entorno sin storage — silencioso, no es crítico.
  }
}

export function useFxUsdBrl({ autoLoad = true } = {}) {
  const cached = readCache();
  const [state, setState] = useState({
    rate:      cached?.rate ?? null,
    bid:       cached?.bid ?? null,
    ask:       cached?.ask ?? null,
    source:    cached?.source ?? null,
    fetchedAt: cached?.fetchedAt ?? null,
    loading:   false,
    error:     null,
  });

  const fetchRate = useCallback(async (forceRefresh = false) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fxApi.usdBrl(forceRefresh);
      // Respuesta esperada: { rate, bid, ask, timestamp, source, cached, error }
      if (!r || r.error || r.rate == null) {
        setState((s) => ({
          ...s,
          loading: false,
          error: r?.error || "FX upstream sin respuesta",
        }));
        return null;
      }
      const next = {
        rate:      Number(r.rate),
        bid:       r.bid != null ? Number(r.bid) : null,
        ask:       r.ask != null ? Number(r.ask) : null,
        source:    r.source || "MWT FX",
        fetchedAt: r.timestamp || new Date().toISOString(),
        loading:   false,
        error:     null,
      };
      writeCache(next);
      setState(next);
      return next;
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message || "FX network error",
      }));
      return null;
    }
  }, []);

  // Auto-load on mount, respetando cache TTL.
  useEffect(() => {
    if (!autoLoad) return;
    const c = readCache();
    if (c?.fetchedAt) {
      const age = Date.now() - new Date(c.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        // Cache fresco — no pegamos al backend.
        return;
      }
    }
    fetchRate(false);
  }, [autoLoad, fetchRate]);

  const refresh = useCallback(() => fetchRate(true), [fetchRate]);

  const convert = useCallback((usd) => {
    if (usd == null || state.rate == null) return null;
    return Number(usd) * state.rate;
  }, [state.rate]);

  return { ...state, refresh, convert };
}

export default useFxUsdBrl;
