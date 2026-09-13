// =====================================================================
// MWT.ONE · Finanzas — Comisiones por marca (ventana 10–20) + Flujo 90d (USD/CRC)
// Etapa 5. CEO-only. Datos reales de /finanzas/*. Sin ceros/NaN inventados.
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { finanzasApi } from "../../lib/api.js";

const money = (v, ccy = "USD") => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("es-CR", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);
};

function Card({ title, right, children, lang }) {
  return (
    <div className="card card-pad-lg" style={{ minWidth: 0 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 700 }}>{title}</div>
        {right}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

export default function ComisionesFlujo({ lang = "es" }) {
  const es = lang === "es";
  const [marcas, setMarcas] = useState([]);
  const [flujo, setFlujo] = useState(null);
  const [saldo, setSaldo] = useState({ USD: "", CRC: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cm, fl, si] = await Promise.all([
        finanzasApi.comisionesPorMarca(),
        finanzasApi.flujo(90),
        finanzasApi.saldoInicial(),
      ]);
      setMarcas(cm?.results || []);
      setFlujo(fl || null);
      const s = Object.fromEntries((si?.results || []).map((r) => [r.moneda, r.monto]));
      setSaldo({ USD: s.USD ?? "0", CRC: s.CRC ?? "0" });
    } catch { /* la página principal ya maneja su error */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const guardar = async () => {
    setSaving(true); setMsg(null);
    try {
      await finanzasApi.setSaldoInicial({ USD: Number(saldo.USD || 0), CRC: Number(saldo.CRC || 0) });
      setMsg(es ? "Saldo inicial guardado" : "Opening balance saved");
      await load();
    } catch (e) { setMsg(e?.body?.detail || e?.message || "Error"); }
    finally { setSaving(false); }
  };

  const t = flujo?.totales || {};
  const sf = flujo?.saldo_final_proyectado || {};

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, marginBottom: 24 }}>
      {/* Comisiones por marca */}
      <Card title={es ? "COMISIONES POR MARCA · ventana 10–20" : "COMMISSIONS BY BRAND · 10–20 window"} lang={lang}
            right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{marcas.length}</span>}>
        {marcas.length === 0 ? (
          <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>{es ? "Sin datos." : "No data."}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                <th style={{ padding: "4px 6px" }}>{es ? "Marca" : "Brand"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Proyectada" : "Projected"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Pendiente" : "Pending"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Devengada" : "Accrued"}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Total" : "Total"}</th>
                <th style={{ padding: "4px 6px" }}>{es ? "Ventanas" : "Windows"}</th>
              </tr>
            </thead>
            <tbody>
              {marcas.map((m) => (
                <tr key={m.brand_name} style={{ borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                  <td style={{ padding: "6px", fontWeight: 600 }}>{m.brand_name}</td>
                  <td className="tabular-nums" style={{ padding: "6px", textAlign: "right" }}>{money(m.comision_proyectada)}</td>
                  <td className="tabular-nums" style={{ padding: "6px", textAlign: "right" }}>{money(m.comision_pendiente)}</td>
                  <td className="tabular-nums" style={{ padding: "6px", textAlign: "right", color: "var(--success-fg, #166534)" }}>{money(m.comision_devengada)}</td>
                  <td className="tabular-nums" style={{ padding: "6px", textAlign: "right", fontWeight: 700 }}>{money(m.comision_total)}</td>
                  <td style={{ padding: "6px", color: "var(--text-tertiary)" }}>
                    {(m.ventanas || []).map((v) => `${v.mes} (${v.inicio?.slice(8)}–${v.fin?.slice(8)})`).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Flujo 90 días */}
      <Card title={es ? "FLUJO 90 DÍAS · USD + CRC" : "90-DAY FLOW · USD + CRC"} lang={lang}
            right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{flujo?.dias || 90} {es ? "días" : "days"}</span>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Entradas USD" : "In USD"}</div>
            <div className="tabular-nums" style={{ fontWeight: 700 }}>{money(t.entradas_usd)}</div>
          </div>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Salidas USD" : "Out USD"}</div>
            <div className="tabular-nums" style={{ fontWeight: 700 }}>{money(t.salidas_usd)}</div>
          </div>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Neto USD" : "Net USD"}</div>
            <div className="tabular-nums" style={{ fontWeight: 700 }}>{money(t.neto_usd)}</div>
          </div>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Neto CRC" : "Net CRC"}</div>
            <div className="tabular-nums" style={{ fontWeight: 700 }}>{money(t.neto_crc, "CRC")}</div>
          </div>
        </div>

        <div className="micro" style={{ color: "var(--text-tertiary)", margin: "8px 0 4px" }}>
          {es ? "SALDO INICIAL (declarado)" : "OPENING BALANCE (declared)"}
        </div>
        <div className="flex ai-center" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="micro">{es ? "USD" : "USD"}
            <input type="number" value={saldo.USD} onChange={(e) => setSaldo((s) => ({ ...s, USD: e.target.value }))}
                   style={{ marginLeft: 6, width: 120 }} />
          </label>
          <label className="micro">{es ? "CRC" : "CRC"}
            <input type="number" value={saldo.CRC} onChange={(e) => setSaldo((s) => ({ ...s, CRC: e.target.value }))}
                   style={{ marginLeft: 6, width: 140 }} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={guardar}>
            {saving ? "…" : (es ? "Guardar" : "Save")}
          </button>
          {msg && <span className="micro" style={{ color: "var(--text-tertiary)" }}>{msg}</span>}
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div className="micro" style={{ color: "var(--text-tertiary)" }}>
            {es ? "SALDO FINAL PROYECTADO" : "PROJECTED END BALANCE"}
          </div>
          <div className="tabular-nums">
            USD <b>{money(sf.USD)}</b> · CRC <b>{money(sf.CRC, "CRC")}</b>
          </div>
        </div>
        <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          {flujo?.nota || ""}
        </div>
      </Card>
    </div>
  );
}
