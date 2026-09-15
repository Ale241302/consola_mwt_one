// frontend/src/components/finanzas/ComisionesHistoricas.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-09 · Tarjeta "Comisiones históricas (FE)".
// Consume GET /api/finanzas/comisiones-historicas/ — el histórico de
// comisiones facturadas por MWT a Marluvas (FE-XXXX), conciliadas contra
// los cobros reales. Cubre periodos con PFs 2024/2025 que no tienen
// expediente operativo, registrados en finance.comision_historica.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { finanzasApi } from "../../lib/api.js";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function periodoLabel(periodo) {
  if (!periodo || periodo === "—") return "—";
  const [y, m] = String(periodo).split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MESES[idx]} ${y}` : periodo;
}

export default function ComisionesHistoricas({ lang }) {
  const es = lang === "es";
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState("0");
  const [porPeriodo, setPorPeriodo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    finanzasApi
      .comisionesHistoricas()
      .then((d) => {
        if (cancel) return;
        setRows(d?.comisiones || []);
        setTotal(d?.total_usd || "0");
        setPorPeriodo(d?.por_periodo || []);
      })
      .catch((e) => {
        if (!cancel) setError(e?.message || "Error");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div
      style={{
        marginTop: 16,
        background: "#fff",
        border: "1px solid var(--border, #E2E8F0)",
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>
            {es ? "Comisiones históricas (FE)" : "Historical commissions (invoices)"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #475569)", marginTop: 2, maxWidth: 640 }}>
            {es
              ? "Facturas de comisión de MWT a Marluvas (FE) conciliadas contra los cobros reales. Incluye periodos con PFs 2024/2025 sin expediente operativo."
              : "MWT→Marluvas commission invoices (FE) reconciled against actual collections."}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#94A3B8" }}>
            TOTAL USD
          </div>
          <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "var(--brand-accent, #0E8A6D)" }}>
            ${fmt(total)}
          </div>
        </div>
      </div>

      {porPeriodo.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {porPeriodo.map((p) => (
            <span
              key={p.periodo}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 10px", borderRadius: 999,
                background: "var(--bg-alt, #F1F5F9)",
                fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #475569)",
              }}
            >
              {periodoLabel(p.periodo)}
              <span className="tabular-nums" style={{ color: "var(--brand-primary, #013A57)" }}>
                ${fmt(p.comision_usd)}
              </span>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: 13, padding: "18px 0" }}>
          {es ? "Cargando comisiones…" : "Loading commissions…"}
        </div>
      ) : error ? (
        <div style={{ color: "var(--critical, #DC2626)", fontSize: 13 }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: 13, padding: "18px 0" }}>
          {es ? "Sin comisiones históricas registradas." : "No historical commissions recorded."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>FE</th>
                <th>Cliente</th>
                <th>PF</th>
                <th style={{ textAlign: "right" }}>{es ? "Cobro" : "Collected"}</th>
                <th style={{ textAlign: "right" }}>%</th>
                <th style={{ textAlign: "right" }}>{es ? "Comisión" : "Commission"}</th>
                <th>{es ? "Expediente" : "File"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono-sm" style={{ fontWeight: 600 }}>{periodoLabel(r.periodo)}</td>
                  <td className="mono-sm">{r.fe_codigo || "—"}</td>
                  <td>{r.cliente_nombre || "—"}</td>
                  <td className="mono-sm">{r.pf_ref || "—"}</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {r.monto_cobrado_usd != null ? `$${fmt(r.monto_cobrado_usd)}` : "—"}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {r.comision_pct != null ? `${(Number(r.comision_pct) * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}
                  >
                    ${fmt(r.comision_usd)}
                    {r.tipo === "PREMIO" && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-tertiary, #94A3B8)" }}>
                        {es ? "premio" : "bonus"}
                      </span>
                    )}
                  </td>
                  <td className="mono-sm" style={{ color: "var(--brand-primary, #013A57)" }}>
                    {r.expediente_codigo || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
