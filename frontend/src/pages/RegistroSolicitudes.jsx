// =====================================================================
// MWT.ONE · pages/RegistroSolicitudes.jsx
// Cola de aprobación del onboarding MCP (Fase 2) — ADMIN/CEO.
//
//   GET  /api/onboarding/solicitudes?estado=…
//   POST /api/onboarding/solicitudes/<id>/aprobar
//   POST /api/onboarding/solicitudes/<id>/rechazar   {motivo}
//
// Al aprobar, el backend activa la cuenta y envía al solicitante el email
// con sus credenciales MCP (.json/.md). Al rechazar queda con motivo.
// =====================================================================
import React, { useEffect, useState, useCallback } from "react";
import { apiFetch, getToken } from "../lib/api.js";

const TABS = [
  ["PENDIENTE", "Pendientes"],
  ["APROBADO", "Aprobadas"],
  ["RECHAZADO", "Rechazadas"],
];

const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" });
};

export default function RegistroSolicitudes() {
  const [tab, setTab] = useState("PENDIENTE");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);   // id a aprobar
  const [rejecting, setRejecting] = useState(null);     // {id, motivo}
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`/onboarding/solicitudes?estado=${tab}`, { token: getToken() });
      setRows(Array.isArray(data) ? data : (data?.results || []));
    } catch (e) {
      setError(e?.payload?.detail || e?.message || "No se pudo cargar");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (id, action) => {
    setBusy(true);
    setError("");
    try {
      const body = action === "rechazar" ? { motivo: (rejecting?.motivo || "").trim() } : {};
      const res = await apiFetch(`/onboarding/solicitudes/${id}/${action}`, {
        method: "POST", body, token: getToken(),
      });
      setToast(res?.detail || (action === "aprobar" ? "Solicitud aprobada" : "Solicitud rechazada"));
      setConfirming(null);
      setRejecting(null);
      await load();
    } catch (e) {
      setError(e?.payload?.detail || e?.message || "Operación falló");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)", color: "var(--text-primary)" }}>
            Solicitudes MCP
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-tertiary)" }}>
            Altas públicas del registro MCP. Al aprobar se activa la cuenta y se envían las credenciales.
          </p>
        </div>
        <button onClick={load} className="btn btn-ghost" title="Recargar">⟳ Recargar</button>
      </div>

      {toast && (
        <div className="badge badge-mint" style={{ padding: "8px 12px", fontSize: 13 }}>{toast}</div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8 }}>
        {TABS.map(([key, label]) => (
          <button key={key}
                  className={`btn ${tab === key ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="card-alert card-alert-critical" style={{ padding: "10px 14px", fontSize: 13 }}>{error}</div>}

      {/* Tabla */}
      <div style={{
        background: "var(--surface-raised)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 12,
                         textTransform: "uppercase", letterSpacing: ".05em",
                         borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px 14px" }}>Solicitante</th>
              <th style={{ padding: "10px 14px" }}>Empresa</th>
              <th style={{ padding: "10px 14px" }}>Teléfono</th>
              <th style={{ padding: "10px 14px" }}>Recibida</th>
              <th style={{ padding: "10px 14px" }}>Estado</th>
              <th style={{ padding: "10px 14px" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>Cargando…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>
                No hay solicitudes {tab.toLowerCase()}s.
              </td></tr>
            )}
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.full_name || "—"}</span>
                      {r.tipo === "reactivacion" && (
                        <span className="badge badge-warning" style={{ fontSize: 10.5 }}>Reactivación</span>
                      )}
                    </div>
                    <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{r.email}</div>
                    {r.tipo === "reactivacion" && r.motivo && (
                      <div style={{ color: "var(--text-tertiary)", fontSize: 11.5, marginTop: 3, maxWidth: 280 }}>
                        Motivo: {r.motivo}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{r.cliente_razon || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{r.phone || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{fmtDate(r.created_at)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span className={`badge ${r.estado === "PENDIENTE" ? "badge-warning"
                      : r.estado === "APROBADO" ? "badge-success" : "badge-critical"}`}>{r.estado}</span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {r.estado === "PENDIENTE" && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {confirming !== r.id ? (
                          <button className="btn btn-primary btn-sm" disabled={busy}
                                  onClick={() => setConfirming(r.id)}>Aprobar</button>
                        ) : (
                          <>
                            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>¿Crear cuenta y enviar credenciales?</span>
                            <button className="btn btn-primary btn-sm" disabled={busy}
                                    onClick={() => run(r.id, "aprobar")}>Sí, aprobar</button>
                            <button className="btn btn-ghost btn-sm" disabled={busy}
                                    onClick={() => setConfirming(null)}>Cancelar</button>
                          </>
                        )}
                        {rejecting?.id === r.id ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <input className="input" style={{ width: 180, minHeight: 30 }}
                                   placeholder="Motivo (opcional)" value={rejecting.motivo}
                                   onChange={(e) => setRejecting({ id: r.id, motivo: e.target.value })} />
                            <button className="btn btn-danger btn-sm" disabled={busy}
                                    onClick={() => run(r.id, "rechazar")}>Rechazar</button>
                            <button className="btn btn-ghost btn-sm" disabled={busy}
                                    onClick={() => setRejecting(null)}>Cancelar</button>
                          </div>
                        ) : (
                          confirming !== r.id && (
                            <button className="btn btn-danger-soft btn-sm" disabled={busy}
                                    onClick={() => setRejecting({ id: r.id, motivo: "" })}>Rechazar</button>
                          )
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
