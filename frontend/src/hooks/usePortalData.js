// =====================================================================
// MWT.ONE · usePortalData
// Agente responsable: [AG-FRONTEND]
//
// Consume los endpoints del Portal B2B:
//   GET /api/portal/me/
//   GET /api/portal/kpis/
//   GET /api/portal/mis_ocs/
//   GET /api/portal/mis_expedientes/
//   GET /api/portal/mis_pagos/
//   GET /api/portal/mis_cobros/
//   GET /api/portal/mis_documentos/
//
// Todos los endpoints son read-only y scopeados al client_id.
// El cliente se pasa explícitamente mientras el JWT no tenga el claim
// portal_client_id (dev fallback vía header X-Portal-Client).
//
// Devuelve:
//   { me, kpis, ocs, expedientes, pagos, cobros, documentos,
//     loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { portalApi } from "../lib/api.js";
import { readCache, writeCache } from "../lib/swrCache.js";

const EMPTY = {
  me: null, kpis: null,
  ocs: [], expedientes: [], pagos: [], cobros: [], documentos: [],
};

export function usePortalData(clientId) {
  const cacheKey = `portal:${clientId || "self"}`;

  // Stale-while-revalidate: si hay un snapshot previo en caché lo pintamos
  // AL INSTANTE (loading:false) y revalidamos en segundo plano. Así volver
  // a entrar al portal ya no deja la vista en blanco 1-2 s.
  const [state, setState] = useState(() => {
    const cached = readCache(cacheKey);
    return cached
      ? { ...cached, loading: false, error: null }
      : { ...EMPTY, loading: true, error: null };
  });

  const load = useCallback(async () => {
    // Solo mostramos el spinner cuando NO hay datos cacheados que enseñar.
    setState((s) => ({ ...s, loading: !readCache(cacheKey), error: null }));
    try {
      const [me, kpis, ocs, expedientes, pagos, cobros, documentos] =
        await Promise.all([
          // Sprint 2026-08-07 · Ola 1 F2: propagar errores en vez de
          // devolver arrays vacíos parciales. El componente Portal muestra
          // el estado de error y ofrece reintentar.
          portalApi.me(clientId),
          portalApi.kpis(clientId),
          portalApi.misOcs(clientId),
          portalApi.misExpedientes(clientId),
          portalApi.misPagos(clientId),
          portalApi.misCobros(clientId),
          portalApi.misDocumentos(clientId),
        ]);
      const fresh = {
        me:          me || null,
        kpis:        kpis || null,
        ocs:         Array.isArray(ocs)         ? ocs         : [],
        expedientes: Array.isArray(expedientes) ? expedientes : [],
        pagos:       Array.isArray(pagos)       ? pagos       : [],
        cobros:      Array.isArray(cobros)      ? cobros      : [],
        documentos:  Array.isArray(documentos)  ? documentos  : [],
      };
      writeCache(cacheKey, fresh);
      setState({ ...fresh, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, [clientId, cacheKey]);

  // Re-sembramos desde caché cuando cambia la empresa activa (clientId),
  // para que el cambio de empresa tampoco parpadee en blanco.
  useEffect(() => {
    const cached = readCache(cacheKey);
    if (cached) setState({ ...cached, loading: false, error: null });
    else setState({ ...EMPTY, loading: true, error: null });
    load();
  }, [load, cacheKey]);

  return { ...state, reload: load };
}

export default usePortalData;
