// =====================================================================
// MWT.ONE · useEmailTemplates
// Agente responsable: [AG-FRONTEND]
//
// Consume:
//   GET /api/email-templates/
//   GET /api/email-templates/kpis/
//   GET /api/email-templates/select_languages/
//   GET /api/email-templates/select_keys/
//
// Devuelve:
//   { templates, kpis, languages, keys, loading, error, reload }
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { emailTemplatesApi } from "../lib/api.js";

export function useEmailTemplates(params) {
  const [state, setState] = useState({
    templates: [], kpis: null, languages: [], keys: [],
    loading: true, error: null,
  });

  const key = params ? JSON.stringify(params) : "";

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [templates, kpis, languages, keys] = await Promise.all([
        emailTemplatesApi.list(params).catch(() => []),
        emailTemplatesApi.action("kpis").catch(() => null),
        emailTemplatesApi.select("languages").catch(() => []),
        emailTemplatesApi.select("keys").catch(() => []),
      ]);
      setState({
        templates: Array.isArray(templates) ? templates : (templates?.results || []),
        kpis:      kpis || null,
        languages: Array.isArray(languages) ? languages : [],
        keys:      Array.isArray(keys) ? keys : [],
        loading:   false,
        error:     null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export default useEmailTemplates;
