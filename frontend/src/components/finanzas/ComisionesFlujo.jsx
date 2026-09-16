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

const _MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function mesLabel(mes) {
  if (!mes) return "—";
  const [y, m] = String(mes).split("-");
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${_MES[i]} ${y}` : mes;
}

function MiniKpi({ label, value, color }) {
  return (
    <div style={{
      background: "var(--bg-alt, #F8FAFC)", border: "1px solid var(--border-subtle, #EEF2F6)",
      borderRadius: 8, padding: "8px 10px",
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" }}>
        {label}
      </div>
      <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 800, marginTop: 2, color }}>
        {value}
      </div>
    </div>
  );
}

export default function ComisionesFlujo({ lang = "es" }) {
  const es = lang === "es";
  const [marcas, setMarcas] = useState([]);
  const [flujo, setFlujo] = useState(null);
  const [arb, setArb] = useState({ results: [], resumen: {}, nota: "" });
  const [saldo, setSaldo] = useState({ USD: "", CRC: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cm, fl, si, ar] = await Promise.all([
        finanzasApi.comisionesPorMarca(),
        finanzasApi.flujo(90),
        finanzasApi.saldoInicial(),
        finanzasApi.arbitraje(),
      ]);
      setMarcas(cm?.results || []);
      setFlujo(fl || null);
      setArb(ar || { results: [], resumen: {}, nota: "" });
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
    <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, marginBottom: 16 }}>
      {/* Comisiones por marca */}
      <Card title={es ? "COMISIONES POR MARCA · ventana 10–20" : "COMMISSIONS BY BRAND · 10–20 window"} lang={lang}
            right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>{marcas.length}</span>}>
        {marcas.length === 0 ? (
          <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>{es ? "Sin datos." : "No data."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {marcas.map((m) => (
              <div key={m.brand_name}
                   style={{ border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>{m.brand_name}</div>
                  <div className="tabular-nums" style={{ fontSize: 18, fontWeight: 800, color: "var(--brand-accent, #0E8A6D)" }}>
                    {money(m.comision_total)}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, margin: "10px 0" }}>
                  <MiniKpi label={es ? "Proyectada" : "Projected"} value={money(m.comision_proyectada)}
                           color="var(--text-secondary, #475569)" />
                  <MiniKpi label={es ? "Pendiente" : "Pending"} value={money(m.comision_pendiente)}
                           color="var(--warning, #B45309)" />
                  <MiniKpi label={es ? "Devengada" : "Accrued"} value={money(m.comision_devengada)}
                           color="var(--success-fg, #166534)" />
                </div>

                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)", marginBottom: 6 }}>
                  {es ? "Ventanas de pago · 10–20 del mes" : "Payment windows · 10–20"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(m.ventanas || []).map((v) => (
                    <span key={v.mes} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "3px 10px", borderRadius: 999,
                      background: "var(--bg-alt, #F1F5F9)", fontSize: 11, fontWeight: 600,
                      color: "var(--text-secondary, #475569)",
                    }}>
                      {mesLabel(v.mes)}
                      <span className="tabular-nums" style={{ color: "var(--brand-primary, #013A57)" }}>{money(v.monto)}</span>
                    </span>
                  ))}
                  {(!m.ventanas || m.ventanas.length === 0) && (
                    <span style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)" }}>—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
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

    {/* Arbitraje por fechas de factura */}
    <Card title={es ? "ARBITRAJE POR FECHAS DE FACTURA · MWT opera" : "ARBITRAGE BY INVOICE DATES · MWT-operated"} lang={lang}
          right={<span className="micro" style={{ color: "var(--text-tertiary)" }}>
            {es ? "Δ bruto" : "Gross Δ"}: <b>{money(arb?.resumen?.arbitraje_bruto_total)}</b>
            {" · "}{es ? "a financiar" : "to finance"}: <b>{money(arb?.resumen?.monto_requiere_financiacion)}</b>
          </span>}>
      {(arb?.results || []).length === 0 ? (
        <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>
          {es ? "Sin expedientes operados por MWT." : "No MWT-operated files."}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
              <th style={{ padding: "4px 6px" }}>{es ? "Expediente" : "File"}</th>
              <th style={{ padding: "4px 6px" }}>{es ? "Cliente" : "Client"}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Δ bruto" : "Gross Δ"}</th>
              <th style={{ padding: "4px 6px" }}>{es ? "Pago compra" : "Pay purchase"}</th>
              <th style={{ padding: "4px 6px" }}>{es ? "Cobro venta" : "Collect sale"}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{es ? "Desfase" : "Gap"}</th>
            </tr>
          </thead>
          <tbody>
            {(arb.results || []).map((r) => (
              <tr key={r.expediente_id} style={{ borderTop: "1px solid var(--border-subtle, #EEF2F6)" }}>
                <td style={{ padding: "6px", fontWeight: 600 }}>{r.display_id}</td>
                <td style={{ padding: "6px" }}>{r.cliente}{r.brand_name ? ` · ${r.brand_name}` : ""}</td>
                <td className="tabular-nums" style={{ padding: "6px", textAlign: "right", fontWeight: 700 }}>{money(r.arbitraje_bruto)}</td>
                <td className="tabular-nums" style={{ padding: "6px", color: "var(--text-secondary)" }}>
                  {r.compra_vence || "—"}{r.credit_days_mwt != null ? ` (${r.credit_days_mwt}d)` : ""}
                </td>
                <td className="tabular-nums" style={{ padding: "6px", color: "var(--text-secondary)" }}>
                  {r.venta_vence || "—"} ({r.credit_days_cliente}d)
                </td>
                <td className="tabular-nums" style={{ padding: "6px", textAlign: "right", color: r.requiere_financiacion ? "var(--warning-fg, #92400E)" : "var(--success-fg, #166534)" }}>
                  {r.desfase_dias == null ? "—" : `${r.desfase_dias}d${r.requiere_financiacion ? " ⚠" : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>{arb?.nota || ""}</div>
    </Card>
    </>
  );
}
