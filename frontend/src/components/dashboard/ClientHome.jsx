// =====================================================================
// MWT.ONE · Panel Cliente B2B — rediseño (Etapa 7 UI)
// Prioriza SUS embarques: próximas llegadas/salidas, estado de pedidos,
// crédito y acceso al portal. Datos scopeados por el token (portalApi).
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portalApi } from "../../lib/api.js";
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

function Kpi({ label, value, tone }) {
  return (
    <div className="card card-pad-lg">
      <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div className="tabular-nums" style={{ font: "800 26px/1.1 var(--font-display)", color: tone || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

export default function ClientHome({ lang = "es" }) {
  const es = lang !== "en";
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [exps, setExps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await portalApi.me().catch(() => null);
      setMe(m || null);
      const cid = (m?.empresas || [])[0]?.id || null;
      const e = await portalApi.misExpedientes(cid).catch(() => []);
      setExps(Array.isArray(e) ? e : (e?.results || []));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cid = (me?.empresas || [])[0]?.id || null;
  const count = (estado) => exps.filter((e) => (e.estado || "") === estado).length;
  const activos = exps.length;
  const credito = me?.empresas?.[0]?.credito_limit_usd || me?.credito_limit_usd;
  const usado = me?.empresas?.[0]?.credito_usado || me?.credito_usado;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }} data-section="client-home">
      {loading && <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>{es ? "Cargando…" : "Loading…"}</div>}

      {!loading && <>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <Kpi label={es ? "Pedidos activos" : "Active orders"} value={activos} />
          <Kpi label={es ? "En fábrica" : "In production"} value={count("PRODUCCION")} />
          <Kpi label={es ? "En tránsito" : "In transit"} value={count("TRANSITO")} />
          <Kpi label={es ? "En destino" : "At destination"} value={count("EN_DESTINO")} />
          <Kpi label={es ? "Entregados" : "Delivered"} value={count("CERRADO")} tone="var(--success-fg, #166534)" />
          {credito != null && <Kpi label={es ? "Crédito usado" : "Credit used"} value={`${Math.round((Number(usado || 0) / Number(credito || 1)) * 100)}%`} sub={`de ${Number(credito).toLocaleString("en-US")}`} />}
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
