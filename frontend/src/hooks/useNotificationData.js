// =====================================================================
// MWT.ONE · useNotificationData
// Agente responsable: [AG-FRONTEND]
//
// Consume:
//   GET /api/notification-logs/
//   GET /api/notification-logs/kpis/
//   GET /api/collection-logs/
//   GET /api/collection-logs/kpis/
//
// Devuelve:
//   { logs, logsKpis, collectionLogs, collectionKpis,
//     loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { notificationLogsApi, collectionLogsApi } from "../lib/api.js";

export function useNotificationData(params) {
  const [state, setState] = useState({
    logs: [], logsKpis: null,
    collectionLogs: [], collectionKpis: null,
    loading: true, error: null,
  });

  const key = params ? JSON.stringify(params) : "";

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [logs, logsKpis, collectionLogs, collectionKpis] = await Promise.all([
        notificationLogsApi.list(params).catch(() => []),
        notificationLogsApi.action("kpis").catch(() => null),
        collectionLogsApi.list(params).catch(() => []),
        collectionLogsApi.action("kpis").catch(() => null),
      ]);
      setState({
        logs:            Array.isArray(logs) ? logs : (logs?.results || []),
        logsKpis:        logsKpis || null,
        collectionLogs:  Array.isArray(collectionLogs) ? collectionLogs : (collectionLogs?.results || []),
        collectionKpis:  collectionKpis || null,
        loading:         false,
        error:           null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useNotificationData;
