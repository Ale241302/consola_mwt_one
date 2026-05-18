// =====================================================================
// MWT.ONE · hooks/useExchangeRateUSDBRL.js
// Agente responsable: [AG-03 FRONTEND]
//
// Hook compartido que consume el endpoint backend
//   GET /api/commercial/exchange-rate/usd-brl/
// (proxy con fallback en cadena: AwesomeAPI BR → Frankfurter → cache).
//
// Devuelve { tc, loading, error, ts, source, cached, reload }.
//   · tc       Número (5.0392) o null si todos los upstreams fallaron.
//   · ts       Timestamp del rate (depende del proveedor).
//   · source   "AwesomeAPI BR" | "Frankfurter (ECB)" | "none".
//   · reload   Función para forzar un re-fetch (skip cache).
//
// Usado en:
//   · pages/BrandClientPricingForm.jsx (simulador cliente-marca)
//   · pages/ProductFormView.jsx        (matriz por cliente en detalle producto)
// =====================================================================
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";

export function useExchangeRateUSDBRL(accessToken) {
  const [data, setData] = useState({
    tc: null, loading: true, error: null,
    ts: null, source: null, cached: false,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true }));

    const qs = reloadKey > 0 ? "?refresh=1" : "";
    apiFetch(`/commercial/exchange-rate/usd-brl/${qs}`, { token: accessToken })
      .then((r) => {
        if (cancelled) return;
        const tc = Number(r?.rate ?? r?.bid ?? r?.value);
        setData({
          tc:     Number.isFinite(tc) ? tc : null,
          loading: false,
          error:  r?.error || null,
          ts:     r?.timestamp || r?.create_date || new Date().toISOString(),
          source: r?.source || "unknown",
          cached: !!r?.cached,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setData({
          tc: null, loading: false,
          error: e?.message || String(e),
          ts: null, source: null, cached: false,
        });
      });

    return () => { cancelled = true; };
  }, [accessToken, reloadKey]);

  return { ...data, reload: () => setReloadKey((k) => k + 1) };
}

export default useExchangeRateUSDBRL;
