// =====================================================================
// MWT.ONE · Panel Cliente B2B — rediseño (Etapa 7 UI)
// Prioriza SUS embarques: próximas llegadas/salidas, estado de pedidos,
// crédito y acceso al portal. Datos scopeados por el token (portalApi).
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi } from "../../lib/api.js";
import { fmtDate } from "../../lib/i18n.js";
import EmbarquesPortada from "../portal/EmbarquesPortada.jsx";

const ESTADOS = [
  ["REGISTRO", "Por recibir"],
  ["PRODUCCION", "En fábrica"],
  ["PREPARACION", "Preparación"],
  ["DESPACHO", "Despacho"],
  ["TRANSITO", "En tránsito"],
  ["EN_DESTINO", "En destino"],
  ["CERRADO", "Cerrado"],
];

function Kpi({ label, value, tone, sub }) {
  return (
    <div className="card card-pad-lg">
      <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ font: "800 26px/1.1 var(--font-display)", color: tone || "var(--text-primary)" }}>{value}</div>
      {sub && <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function ClientHome({ lang = "es" }) {
  const es = lang !== "en";
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [exps, setExps] = useState([]);
  const [cobros, setCobros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await portalApi.me().catch(() => null);
      setMe(m || null);
      if (!m) {
        setError(es
          ? "No pudimos cargar tu cuenta. Volvé a intentar en un momento."
          : "We couldn't load your account. Try again in a moment.");
        return;
      }
      const cid = null;  // todas las empresas del usuario: scopea el backend por JWT
      const [e, c] = await Promise.all([
        portalApi.misExpedientes(cid).catch(() => []),
        portalApi.misCobros(cid).catch(() => []),
      ]);
      setExps(Array.isArray(e) ? e : (e?.results || []));
      setCobros(Array.isArray(c) ? c : (c?.results || []));
    } finally { setLoading(false); }
  }, [es]);
  useEffect(() => { load(); }, [load]);

  const cid = null;  // grupo completo; el detalle de embarque también se scopea por JWT
  const count = (estado) => exps.filter((e) => (e.estado || "") === estado).length;
  // "Activos" es lo que está en curso: un pedido cerrado o cancelado no lo está.
  const activos = exps.filter((e) => !["CERRADO", "CANCELADO"].includes(e.estado || "")).length;
  const cerrados = count("CERRADO");
  const empresas = me?.empresas || [];
  const limiteGrupo = empresas.reduce(
    (m, e) => Math.max(m, Number(e.credito_limit_usd ?? e.credito_limite ?? 0)), 0);
  const usadoGrupo = empresas.reduce(
    (s, e) => s + Number(e.credito_usado ?? e.credito_usado_propio ?? 0), 0);
  const credito = limiteGrupo || me?.credito_limit_usd;
  const usado = usadoGrupo || me?.credito_usado;

  // Cobranza del cliente: qué debe pagar y cuándo (lo que más consulta).
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const pendientes = (cobros || [])
    .filter((c) => Number(c.monto_pendiente) > 0)
    .map((c) => {
      const fv = c.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null;
      return {
        ...c,
        _monto: Number(c.monto_pendiente) || 0,
        _dias: fv ? Math.round((fv - hoy) / 86400000) : null,
      };
    })
    .sort((a, b) => (a._dias == null ? 1 : b._dias == null ? -1 : a._dias - b._dias));
  const saldo = pendientes.reduce((s, c) => s + c._monto, 0);
  const vencido = pendientes.filter((c) => c._dias != null && c._dias < 0)
    .reduce((s, c) => s + c._monto, 0);
  const proximo = pendientes[0] || null;
  const fmtMonto = (v, moneda = "USD") => new Intl.NumberFormat("es-CR", {
    style: "currency", currency: moneda, maximumFractionDigits: 0,
  }).format(Number(v) || 0);

  const porEstado = ESTADOS.map(([k, label]) => [k, label, count(k)])
    .filter(([, , n]) => n > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }} data-section="client-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>{es ? "Cargando…" : "Loading…"}</div>}
      {!loading && error && (
        <div className="card card-pad-lg" role="alert" style={{ color: "var(--critical)" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{es ? "No se pudo cargar el panel" : "Dashboard unavailable"}</div>
          <div className="micro" style={{ color: "var(--text-secondary)" }}>{error}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={load}>
            {es ? "Reintentar" : "Retry"}
          </button>
        </div>
      )}

      {!loading && !error && <>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <Kpi label={es ? "Pedidos activos" : "Active orders"} value={activos} />
          <Kpi label={es ? "En fábrica" : "In production"} value={count("PRODUCCION")} />
          <Kpi label={es ? "En tránsito" : "In transit"} value={count("TRANSITO")} />
          <Kpi label={es ? "En destino" : "At destination"} value={count("EN_DESTINO")} />
          <Kpi label={es ? "Entregados" : "Delivered"} value={cerrados} tone="var(--success-fg, #166534)" />
          <Kpi label={es ? "Saldo por pagar" : "Balance due"} value={fmtMonto(saldo)}
               tone={vencido > 0 ? "var(--critical)" : "var(--text-primary)"}
               sub={vencido > 0 ? `${fmtMonto(vencido)} ${es ? "vencido" : "overdue"}` : null} />
          {Number(credito) > 0 && <Kpi label={es ? "Crédito usado" : "Credit used"} value={`${Math.round((Number(usado || 0) / Number(credito || 1)) * 100)}%`} sub={`de ${Number(credito).toLocaleString("en-US")}`} />}
        </div>

        {/* Próximo pago + pedidos por estado (lo que antes no se veía) */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          <div className="card card-pad-lg">
            <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 800, letterSpacing: ".04em", marginBottom: 10 }}>
              {es ? "PRÓXIMO PAGO" : "NEXT PAYMENT"}
            </div>
            {!proximo ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>{es ? "Sin pagos pendientes." : "No pending payments."}</div>
            ) : (
              <>
                <div className="tabular-nums" style={{ font: "800 26px/1.1 var(--font-display)" }}>
                  {fmtMonto(proximo._monto, proximo.moneda || "USD")}
                </div>
                <div className="micro" style={{ color: proximo._dias < 0 ? "var(--critical)" : "var(--text-secondary)", marginTop: 4 }}>
                  {proximo.fecha_vencimiento
                    ? `${es ? "vence" : "due"} ${fmtDate(proximo.fecha_vencimiento, lang)}`
                    : (es ? "sin fecha de vencimiento" : "no due date")}
                  {proximo._dias != null && ` · ${proximo._dias < 0
                    ? `${Math.abs(proximo._dias)}d ${es ? "vencido" : "overdue"}`
                    : `${es ? "en" : "in"} ${proximo._dias}d`}`}
                </div>
                {pendientes.length > 1 && (
                  <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
                    {es ? `+ ${pendientes.length - 1} cuotas más · total ${fmtMonto(saldo)}`
                        : `+ ${pendientes.length - 1} more · total ${fmtMonto(saldo)}`}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card card-pad-lg">
            <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 800, letterSpacing: ".04em", marginBottom: 10 }}>
              {es ? "MIS PEDIDOS POR ESTADO" : "MY ORDERS BY STATE"}
            </div>
            {porEstado.length === 0 ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>—</div>
            ) : porEstado.map(([k, label, n]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 34px 1fr", gap: 10, alignItems: "center", padding: "4px 0" }}>
                <div style={{ fontSize: 12.5 }}>{es ? label : k}</div>
                <div className="tabular-nums" style={{ fontWeight: 800, textAlign: "right" }}>{n}</div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((n / activos) * 100)}%`, background: "var(--brand-accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Embarques (lo más importante para el cliente) */}
        <EmbarquesPortada lang={lang} clientId={cid} />

        {/* Accesos rápidos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <button type="button" className="card card-pad-lg" onClick={() => navigate("/portal")}
                  style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{es ? "Mis pedidos y documentos" : "My orders & documents"}</div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Órdenes, proformas, facturas" : "Orders, proformas, invoices"}</div>
          </button>
          <button type="button" className="card card-pad-lg" onClick={() => navigate("/tickets")}
                  style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{es ? "Soporte" : "Support"}</div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Abrir y ver tus tickets" : "Open and view your tickets"}</div>
          </button>
          <button type="button" className="card card-pad-lg" onClick={() => navigate("/portal/nueva-oc")}
                  style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{es ? "Subir orden de compra" : "Upload purchase order"}</div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "Crea un nuevo pedido" : "Create a new order"}</div>
          </button>
        </div>
      </>}
    </div>
  );
}
