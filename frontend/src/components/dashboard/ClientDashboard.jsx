// frontend/src/components/dashboard/ClientDashboard.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 (CEO) · Dashboard ENRIQUECIDO para usuarios CLIENTE.
//
// Antes el cliente B2B solo veía "Expedientes activos" + Acciones
// urgentes. Ahora ve SU operación completa, scoped a los clientes
// asignados al usuario (legal_entity_ids — el backend ya scopea
// server-side; aquí se filtra defensivamente):
//   · KPIs: expedientes, entregados, en tránsito, por salir, pares.
//   · Próximas entregas (proyección real del Cronograma).
//   · Pares por talla (distribución de sus pedidos activos).
//   · Pipeline por fase.
//
// R3 · POL_VISIBILIDAD: todo se etiqueta con la PO del cliente; el
// código EXP interno y los precios MWT nunca llegan a este render.
// Reutiliza la capa de datos del Cronograma (batching + retry 429).
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  loadCronograma, buildAvgs, computeSegments, projectedDelivery,
} from "../../lib/cronogramaData.js";
import {
  KpiStrip, UpcomingDeliveries, PipelineBoard,
} from "../cronograma/CronogramaExtras.jsx";
import { useRole } from "../../context/RoleContext.jsx";

export default function ClientDashboard({ lang = "es" }) {
  const es = lang === "es";
  const navigate = useNavigate();
  const { user } = useRole();
  const [items, setItems] = useState([]);
  const [statsGlobal, setStatsGlobal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadCronograma()
      .then(({ items: its, statsGlobal: glo }) => {
        if (!alive) return;
        setItems(its);
        setStatsGlobal(glo);
      })
      .catch((e) => { if (alive) setError(e?.message || "Error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Scope defensivo: solo los clientes asignados al usuario.
  const allowed = useMemo(() => new Set(
    (user?.legal_entity_ids || []).map((x) => String(x))
  ), [user]);
  const scoped = useMemo(
    () => (allowed.size
      ? items.filter((it) => it.clienteId && allowed.has(String(it.clienteId)))
      : items),
    [items, allowed]
  );

  const avgs = useMemo(() => buildAvgs(null, statsGlobal), [statsGlobal]);
  const enriched = useMemo(() => scoped.map((it) => {
    const segs = computeSegments(it, avgs);
    return { it, segs, delivery: projectedDelivery(it, segs) };
  }), [scoped, avgs]);

  // Referencia del cliente = su PO (el EXP interno no se muestra — R3).
  const labelOf = (it) => {
    if (!it.ocCodigo) return it.expCodigo;
    return /^po[\s_-]/i.test(String(it.ocCodigo)) ? it.ocCodigo : `PO ${it.ocCodigo}`;
  };
  const onOpen = (it) => {
    const ocId = it._row?.oc_id;
    if (ocId) navigate(`/expedientes/${ocId}`);
  };

  // Distribución de pares por talla en sus expedientes activos.
  const tallas = useMemo(() => {
    const map = new Map();
    scoped.forEach((it) => (it.lineas || []).forEach((l) => {
      const t = String(l.talla || l.size || "");
      if (!t) return;
      const q = Number(l.cantidad ?? l.qty ?? 0);
      map.set(t, (map.get(t) || 0) + q);
    }));
    return Array.from(map.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [scoped]);
  const maxTalla = Math.max(1, ...tallas.map(([, q]) => q));

  if (loading) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 24 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {es ? "Cargando tu operación…" : "Loading your operation…"}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 24 }}>
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
      </div>
    );
  }
  if (!scoped.length) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 24 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {es ? "Sin expedientes activos todavía." : "No active files yet."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
      {/* KPIs de SU operación (expedientes/entregados/tránsito/pares) */}
      <KpiStrip enriched={enriched} lang={lang}/>

      <div className="grid gap-3" style={{ gridTemplateColumns: "1.4fr 1fr", alignItems: "start" }}>
        {/* Próximas entregas — proyección real del Cronograma */}
        <UpcomingDeliveries enriched={enriched} lang={lang} labelOf={labelOf} onOpen={onOpen}/>

        {/* Pares por talla */}
        <div className="card card-pad-lg">
          <div className="card-title">{es ? "Pares por talla" : "Pairs by size"}</div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
            {es
              ? "Unidades pedidas en tus expedientes activos"
              : "Units ordered across your active files"}
          </div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {tallas.length === 0 && (
              <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                {es ? "Sin líneas activas." : "No active lines."}
              </div>
            )}
            {tallas.map(([t, q]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono-sm" style={{ width: 32, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{t}</span>
                <div style={{ flex: 1, height: 10, background: "var(--bg-alt, #EEF2F6)", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.max(2, Math.round((q / maxTalla) * 100))}%`,
                    background: "var(--brand-accent, #0FA3A0)",
                    borderRadius: 5,
                  }}/>
                </div>
                <span className="caption tabular-nums" style={{ width: 60, textAlign: "right", fontWeight: 600 }}>
                  {q.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline por fase — dónde está cada pedido */}
      <PipelineBoard enriched={enriched} lang={lang} labelOf={labelOf} onOpen={onOpen}/>
    </div>
  );
}
