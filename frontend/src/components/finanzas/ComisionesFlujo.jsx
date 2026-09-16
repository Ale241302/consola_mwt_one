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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <MiniKpi label={es ? "Entradas USD" : "In USD"} value={money(t.entradas_usd)} color="#0E8A6D" />
          <MiniKpi label={es ? "Salidas USD" : "Out USD"} value={money(t.salidas_usd)} color="#DC2626" />
          <MiniKpi label={es ? "Neto USD" : "Net USD"} value={money(t.neto_usd)} color="var(--brand-primary, #013A57)" />
          <MiniKpi label={es ? "Neto CRC" : "Net CRC"} value={money(t.neto_crc, "CRC")} color="var(--brand-primary, #013A57)" />
        </div>

        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)", marginBottom: 6 }}>
          {es ? "Saldo inicial (declarado)" : "Opening balance (declared)"}
        </div>
        <div className="flex ai-center" style={{ gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            USD
            <input type="number" value={saldo.USD} onChange={(e) => setSaldo((s) => ({ ...s, USD: e.target.value }))}
                   style={{ width: 120, padding: "5px 8px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6, fontSize: 12 }} />
          </label>
          <label style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            CRC
            <input type="number" value={saldo.CRC} onChange={(e) => setSaldo((s) => ({ ...s, CRC: e.target.value }))}
                   style={{ width: 140, padding: "5px 8px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6, fontSize: 12 }} />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={guardar}>
            {saving ? "…" : (es ? "Guardar" : "Save")}
          </button>
          {msg && <span className="micro" style={{ color: "var(--text-tertiary)" }}>{msg}</span>}
        </div>

        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: 10,
          background: "var(--bg-alt, #F8FAFC)", border: "1px solid var(--border-subtle, #EEF2F6)",
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-tertiary, #94A3B8)" }}>
            {es ? "Saldo final proyectado" : "Projected end balance"}
          </div>
          <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, color: "var(--brand-primary, #013A57)", marginTop: 2 }}>
            USD {money(sf.USD)} <span style={{ color: "var(--text-tertiary, #94A3B8)", fontWeight: 400 }}>·</span> CRC {money(sf.CRC, "CRC")}
          </div>
        </div>
        <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          {flujo?.nota || ""}
        </div>
      </Card>
    </div>

    {/* Arbitraje por fechas de factura — operado por Muito Work Limitada */}
    <Card title={es ? "ARBITRAJE POR FECHAS DE FACTURA · Muito Work Limitada opera"
                    : "ARBITRAGE BY INVOICE DATES · operated by Muito Work Limitada"} lang={lang}>
      {(arb?.results || []).length === 0 ? (
        <div style={{ padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>
          {es ? "Sin expedientes operados por Muito Work Limitada." : "No files operated by Muito Work Limitada."}
        </div>
      ) : (
        <>
          {/* Chips resumen */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0E8A6D", background: "rgba(14,138,109,0.10)", padding: "2px 9px", borderRadius: 999 }}>
                {es ? "Δ Bruto" : "Gross Δ"}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
                {money(arb?.resumen?.arbitraje_bruto_total)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#B45309", background: "rgba(180,83,9,0.10)", padding: "2px 9px", borderRadius: 999 }}>
                {es ? "A financiar" : "To finance"}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
                {money(arb?.resumen?.monto_requiere_financiacion)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-subtle, #EEF2F6)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#334155", background: "rgba(51,65,85,0.08)", padding: "2px 9px", borderRadius: 999 }}>
                {es ? "Expedientes" : "Files"}
              </span>
              <span className="tabular-nums" style={{ fontWeight: 800, color: "var(--brand-primary, #013A57)" }}>
                {(arb.results || []).length}
              </span>
            </div>
          </div>

          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>{es ? "Expediente" : "File"}</th>
                <th>{es ? "Cliente" : "Client"}</th>
                <th style={{ textAlign: "right" }}>{es ? "Δ Bruto" : "Gross Δ"}</th>
                <th>{es ? "Pago compra (real)" : "Pay purchase (actual)"}</th>
                <th>{es ? "Cobro venta (real)" : "Collect sale (actual)"}</th>
                <th style={{ textAlign: "right" }}>{es ? "Desfase" : "Gap"}</th>
              </tr>
            </thead>
            <tbody>
              {(arb.results || []).map((r) => (
                <tr key={r.expediente_id}>
                  <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>
                    {r.display_id || "—"}
                  </td>
                  <td>{r.cliente}{r.brand_name ? ` · ${r.brand_name}` : ""}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>
                    {money(r.arbitraje_bruto)}
                  </td>
                  <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
                    {r.compra_real
                      ? r.compra_real
                      : <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>{es ? "sin dato" : "no data"}</span>}
                  </td>
                  <td className="tabular-nums" style={{ color: "var(--text-secondary, #475569)" }}>
                    {r.venta_real
                      ? r.venta_real
                      : <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>{es ? "sin dato" : "no data"}</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {r.desfase_real_dias == null ? (
                      <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>{es ? "sin dato" : "no data"}</span>
                    ) : r.desfase_real_dias > 0 ? (
                      <span style={{
                        display: "inline-block", padding: "2px 9px", borderRadius: 999,
                        fontSize: 11, fontWeight: 700, color: "#B45309", background: "rgba(180,83,9,0.10)",
                      }}>
                        {r.desfase_real_dias}d {es ? "financia MWT" : "MWT finances"}
                      </span>
                    ) : (
                      <span style={{
                        display: "inline-block", padding: "2px 9px", borderRadius: 999,
                        fontSize: 11, fontWeight: 700, color: "#0E8A6D", background: "rgba(14,138,109,0.10)",
                      }}>
                        {r.desfase_real_dias}d
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 11, color: "var(--text-tertiary, #94A3B8)", marginTop: 10 }}>
            {es
              ? "Δ Bruto = precio cliente − precio MWT (dato real). 'Pago compra' y 'Cobro venta' son FECHAS REALES de comprobantes confirmados (OUT = MWT pagó al proveedor · IN = el cliente pagó a MWT). Si no hay comprobante registrado, dice 'sin dato' (no se inventa fecha). 'Desfase' = cobro − pago real: > 0 significa que MWT pagó al proveedor antes de cobrar al cliente (financiación temporal)."
              : "Gross Δ is real. Purchase/sale dates are ACTUAL dates from confirmed payment receipts; 'no data' when none."}
          </div>
        </>
      )}
    </Card>
    </>
  );
}
