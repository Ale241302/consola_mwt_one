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

export function usePortalData(clientId) {
  const [state, setState] = useState({
    me: null, kpis: null,
    ocs: [], expedientes: [], pagos: [], cobros: [], documentos: [],
    loading: true, error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [me, kpis, ocs, expedientes, pagos, cobros, documentos] =
        await Promise.all([
          portalApi.me(clientId).catch(() => null),
          portalApi.kpis(clientId).catch(() => null),
          portalApi.misOcs(clientId).catch(() => []),
          portalApi.misExpedientes(clientId).catch(() => []),
          portalApi.misPagos(clientId).catch(() => []),
          portalApi.misCobros(clientId).catch(() => []),
          portalApi.misDocumentos(clientId).catch(() => []),
        ]);
      setState({
        me:          me || null,
        kpis:        kpis || null,
        ocs:         Array.isArray(ocs)         ? ocs         : [],
        expedientes: Array.isArray(expedientes) ? expedientes : [],
        pagos:       Array.isArray(pagos)       ? pagos       : [],
        cobros:      Array.isArray(cobros)      ? cobros      : [],
        documentos:  Array.isArray(documentos)  ? documentos  : [],
        loading:     false,
        error:       null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default usePortalData;
