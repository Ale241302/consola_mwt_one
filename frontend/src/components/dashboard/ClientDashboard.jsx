// frontend/src/components/dashboard/ClientDashboard.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 (CEO) · Dashboard ENRIQUECIDO para usuarios CLIENTE.
// Sprint 2026-08-02 · Dashboard PERSONALIZABLE: grid de widgets con
// mostrar/ocultar, reorden (↑↓, robusto en touch — sin drag-drop),
// catálogo + builder de gráficas custom (métrica × dimensión × tipo) y
// layout persistido POR USUARIO en portal.mwt_user.preferences
// (key `dashboard_layout`; fallback silencioso a localStorage).
//
// Antes el cliente B2B solo veía "Expedientes activos" + Acciones
// urgentes. Ahora ve SU operación completa, scoped a los clientes
// asignados al usuario (legal_entity_ids — el backend ya scopea
// server-side; aquí se filtra defensivamente):
//   · KPIs: expedientes, entregados, en tránsito, por salir, pares.
//   · Pipeline por fase (cards nuevas primero en cada columna).
//   · Comparaciones (pedidos vs entregados, USD por fase, pares por
//     SKU), crédito, tallas, tiempos por fase, tablas… según el layout.
//
// R3 · POL_VISIBILIDAD: todo se etiqueta con la PO del cliente; el
// código EXP interno y los precios MWT nunca llegan a este render.
// Todos los datos derivan de endpoints ya scopeados por rol
// (timeline-bundle + portal/me) — cero endpoints nuevos.
// Reutiliza la capa de datos del Cronograma (batching + retry 429).
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  loadCronograma, buildAvgs, computeSegments, projectedDelivery, buildSkuStats,
} from "../../lib/cronogramaData.js";
import { useRole } from "../../context/RoleContext.jsx";
import { useDashboardLayout } from "../../lib/clientDashLayout.js";
import {
  CATALOG_IDS, widgetById, titleOf, subtitleOf, CustomChart,
} from "./client/widgetRegistry.jsx";
import CustomWidgetBuilder from "./client/CustomWidgetBuilder.jsx";
import { DashboardCard } from "./DashboardPrimitives.jsx";

// Grid de 12 columnas: tamaño del widget → columnas que ocupa.
const SPAN = { sm: 4, md: 6, lg: 8, full: 12 };

export default function ClientDashboard({ lang = "es" }) {
  const es = lang === "es";
  const navigate = useNavigate();
  const { user } = useRole();
  const [items, setItems] = useState([]);
  const [statsGlobal, setStatsGlobal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const { me, layout, save, reset } = useDashboardLayout(CATALOG_IDS);

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
  const skuStats = useMemo(() => buildSkuStats(scoped), [scoped]);

  // Referencia del cliente = su PO (el EXP interno no se muestra — R3).
  const labelOf = (it) => {
    if (!it.ocCodigo) return it.expCodigo;
    return /^po[\s_-]/i.test(String(it.ocCodigo)) ? it.ocCodigo : `PO ${it.ocCodigo}`;
  };
  const onOpen = (it) => {
    const ocId = it._row?.oc_id;
    if (ocId) navigate(`/expedientes/${ocId}`);
  };

  // ── Operaciones sobre el layout (cada una dispara save debounced) ──
  const move = (id, dir) => {
    const ws = [...layout.widgets];
    const i = ws.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ws.length) return;
    [ws[i], ws[j]] = [ws[j], ws[i]];
    save({ widgets: ws });
  };
  const toggleVisible = (id) => save({
    widgets: layout.widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
  });
  const removeCustom = (id) => save({
    widgets: layout.widgets.filter((w) => w.id !== id),
  });
  const addCustom = (entry) => save({ widgets: [...layout.widgets, entry] });

  if (loading || !layout) {
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

  const ctx = { enriched, items: scoped, avgs, skuStats, me, lang, labelOf, onOpen };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
      {/* Toolbar de personalización (modo normal / modo editar) */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {customizing ? (
          <>
            <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setBuilderOpen(true)}>
              {es ? "+ Agregar gráfica" : "+ Add chart"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
              {es ? "Restablecer" : "Reset"}
            </button>
            <button type="button" className="btn btn-primary btn-sm"
                    onClick={() => setCustomizing(false)}>
              {es ? "Listo" : "Done"}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => setCustomizing(true)}>
            {es ? "Personalizar" : "Customize"}
          </button>
        )}
      </div>

      {/* Grid de widgets según el layout del usuario */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 14,
      }}>
        {layout.widgets.map((entry, idx) => {
          const def = widgetById(entry.id);
          const isCustom = entry.id.startsWith("custom:");
          if (!def && !isCustom) return null; // layout viejo con id desconocido
          // Sprint 2026-08-02 rev2 · los ocultos NO se renderizan (ni
          // atenuados en modo editar): salen de la vista y vuelven al
          // catálogo del modal "Agregar gráfica".
          if (!entry.visible) return null;
          const span = SPAN[isCustom ? "md" : def.size] || 12;
          const body = isCustom
            ? <CustomChart config={entry.config} enriched={enriched} lang={lang}/>
            : def.render(ctx);

          return (
            <div key={entry.id} style={{
              gridColumn: `span ${span}`, position: "relative", minWidth: 0,
              outline: customizing ? "1.5px dashed var(--border-strong, #CBD5E1)" : "none",
              outlineOffset: 3, borderRadius: 12,
            }}>
              {/* Chrome de personalización: reorden ↑↓, mostrar/ocultar,
                  eliminar (customs). Sin drag-drop (más robusto en touch). */}
              {customizing && (
                <div style={{
                  position: "absolute", top: 6, right: 6, zIndex: 20,
                  display: "flex", gap: 4,
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle, #E1E6ED)",
                  borderRadius: 8, padding: 3, boxShadow: "var(--shadow-md)",
                }}>
                  <button type="button" className="btn btn-ghost btn-sm" title={es ? "Subir" : "Move up"}
                          disabled={idx === 0} onClick={() => move(entry.id, -1)}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" title={es ? "Bajar" : "Move down"}
                          disabled={idx === layout.widgets.length - 1} onClick={() => move(entry.id, 1)}>↓</button>
                  <button type="button" className="btn btn-ghost btn-sm"
                          title={entry.visible ? (es ? "Ocultar" : "Hide") : (es ? "Mostrar" : "Show")}
                          onClick={() => toggleVisible(entry.id)}>
                    {entry.visible ? (es ? "Ocultar" : "Hide") : (es ? "Mostrar" : "Show")}
                  </button>
                  {isCustom && (
                    <button type="button" className="btn btn-ghost btn-sm"
                            title={es ? "Eliminar gráfica" : "Delete chart"}
                            onClick={() => removeCustom(entry.id)}>✕</button>
                  )}
                </div>
              )}

              {(!isCustom && def.bare) ? body : (
                <DashboardCard
                  title={isCustom ? (entry.config?.title || "Custom") : titleOf(entry, lang)}
                  subtitle={isCustom ? "" : subtitleOf(entry, lang)}>
                  {body}
                </DashboardCard>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal catálogo + builder de gráficas custom */}
      {builderOpen && (
        <CustomWidgetBuilder
          lang={lang}
          enriched={enriched}
          layout={layout}
          onAddBuiltin={toggleVisible}
          onAddCustom={addCustom}
          onClose={() => setBuilderOpen(false)}
        />
      )}
    </div>
  );
}
