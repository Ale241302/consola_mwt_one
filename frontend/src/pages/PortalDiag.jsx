// =====================================================================
// MWT.ONE · PortalDiag · Página de diagnóstico para el Portal B2B
// Agente responsable: [AG-FRONTEND]
//
// Llama a GET /api/portal/_debug/ con el JWT del usuario y muestra el
// JSON crudo. Útil para diagnosticar por qué `mis_expedientes` viene
// vacío, qué tiene `users.mwtuser` para el usuario, qué retorna
// `_resolve_client_ids`, qué muestras de expedientes y clientes hay
// en BD, etc.
//
// Acceso: GET /portal/diag (solo staff — el backend retorna 403 si
// el rol no es admin/CEO/manager).
//
// Sprint 2026-05-21 · agregado para destrabar el bug de "Mis Órdenes
// vacío" mientras `/api/expedientes/` admin sí muestra los 5 de Sondel.
// =====================================================================
import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../lib/api.js";

export default function PortalDiag() {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await apiFetch("/portal/_debug/", { token: getToken() });
        if (alive) setData(json);
      } catch (e) {
        if (alive) setError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert("JSON copiado al portapapeles. Pegalo en el chat.");
    } catch {
      alert("No se pudo copiar — seleccioná el texto manualmente.");
    }
  };

  return (
    <div style={{
      padding: 24,
      fontFamily: "var(--font-mono, monospace)",
      color: "var(--text-primary)",
      background: "var(--surface)",
      minHeight: "100vh",
    }}>
      <h1 style={{
        font: "700 22px/1.2 var(--font-display, system-ui)",
        marginBottom: 16,
        color: "var(--brand-primary)",
      }}>
        Portal · Diagnóstico
      </h1>
      <p style={{
        color: "var(--text-secondary)",
        marginBottom: 16,
        font: "400 13px/1.4 var(--font-body, system-ui)",
      }}>
        Estado interno del resolver de empresas del Portal B2B. Útil para
        diagnosticar por qué algún endpoint devuelve vacío.
      </p>

      {loading && (
        <div style={{padding:12, color:"var(--text-tertiary)"}}>
          Cargando…
        </div>
      )}

      {error && (
        <div style={{
          padding: 12,
          background: "rgba(220, 38, 38, 0.10)",
          color: "#DC2626",
          borderRadius: 6,
          marginBottom: 12,
        }}>
          Error: {error}
        </div>
      )}

      {data && (
        <>
          <button
            onClick={onCopy}
            style={{
              padding: "8px 16px",
              background: "var(--brand-accent, #00B286)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              marginBottom: 16,
              font: "600 13px/1 var(--font-body, system-ui)",
            }}>
            📋 Copiar JSON al portapapeles
          </button>
          <pre style={{
            background: "var(--bg-alt, #F4F6F8)",
            padding: 16,
            borderRadius: 8,
            overflow: "auto",
            maxHeight: "70vh",
            border: "1px solid var(--border-subtle, #E2E8F0)",
            font: "400 12px/1.5 var(--font-mono, ui-monospace, monospace)",
            color: "var(--text-primary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
