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

      {/* Próximas entregas — proyección real del Cronograma.
          (Sprint 2026-06-11 rev2 · "Pares por talla" retirada a pedido
          del CEO: no aportaba en el dashboard del cliente.) */}
      <UpcomingDeliveries enriched={enriched} lang={lang} labelOf={labelOf} onOpen={onOpen}/>

      {/* Pipeline por fase — dónde está cada pedido */}
      <PipelineBoard enriched={enriched} lang={lang} labelOf={labelOf} onOpen={onOpen}/>
    </div>
  );
}
