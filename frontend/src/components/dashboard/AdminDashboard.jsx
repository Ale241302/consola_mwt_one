// frontend/src/components/dashboard/AdminDashboard.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-08-02 · Dashboard PERSONALIZABLE ADMIN/CEO.
//
// Misma UX que el dashboard CLIENT (ClientDashboard.jsx): grid 12 col,
// modo Personalizar (ocultar → vuelve al modal, reorden ↑↓, builder de
// gráficas custom), layout persistido POR USUARIO en preferences bajo la
// key `dashboard_layout_admin` (fallback localStorage
// `mwt-admin-dash-layout`) — separado del layout CLIENT.
//
// Diferencia admin: cada widget built-in tiene SCOPE por widget
// ("general" | "cliente:<id>" | "marca:<id>") persistido en
// entry.config.scope y seleccionable con el ScopeChip del header de la
// card. Datos por widget vía useAdminWidgetData (cache SWR
// `analytics:<endpoint>:<params>`) — reemplaza el bundle monolítico
// useDashboardKpis.
//
// Las gráficas custom (builder) se computan con buildCustomSeries sobre
// loadCronograma() (admin = scope completo de la operación) con dims
// extra cliente/marca. El cronograma solo se carga si hay customs
// visibles o se abre el builder (no encarece el dashboard base).
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadCronograma, buildAvgs, computeSegments, projectedDelivery } from "../../lib/cronogramaData.js";
import { useDashboardLayout } from "../../lib/clientDashLayout.js";
import { useAdminWidgetData } from "../../hooks/useAdminWidgetData.js";
import { useBrandsLight } from "../../hooks/useBrandsLight.js";
import {
  ADMIN_WIDGETS, ADMIN_CATALOG_IDS, ADMIN_DEFAULT_LAYOUT,
  adminWidgetById, adminTitleOf, adminSubtitleOf, ScopeChip, SHIMMER_KEYFRAMES,
} from "./admin/widgetRegistry.jsx";
import { CustomChart } from "./client/widgetRegistry.jsx";
import CustomWidgetBuilder from "./client/CustomWidgetBuilder.jsx";
import { DashboardCard, SafeWidget } from "./DashboardPrimitives.jsx";

// Grid de 12 columnas: tamaño del widget → columnas que ocupa.
// xs = 2 → las 6 KPI cards caben en UNA fila como en la BANDA 1 vieja.
const SPAN = { xs: 2, sm: 4, md: 6, lg: 8, full: 12 };

// Dims extra del builder ADMIN (el builder CLIENT no las ve).
const ADMIN_EXTRA_DIMS = [
  { id: "cliente", es: "Cliente", en: "Client" },
  { id: "marca",   es: "Marca",   en: "Brand" },
];

export default function AdminDashboard({
  lang = "es",
  fmtAmount,
  secondaryBrl,
  refreshNonce = 0,
  onOpenExpediente,
}) {
  const es = lang === "es";
  const navigate = useNavigate();
  const [customizing, setCustomizing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const { layout, save, reset } = useDashboardLayout({
    prefKey: "dashboard_layout_admin",
    lsKey: "mwt-admin-dash-layout",
    catalogIds: ADMIN_CATALOG_IDS,
    defaultLayout: ADMIN_DEFAULT_LAYOUT,
  });

  // Listas para el ScopeChip: clientes del dataset exposición (scope
  // general — comparte cache SWR con el widget top_clients) y marcas del
  // hook ligero de siempre.
  const { data: exposicion } = useAdminWidgetData("exposicion", null, refreshNonce);
  const { brands, resolveBrand } = useBrandsLight();

  const clients = useMemo(() => {
    const rows = Array.isArray(exposicion) ? exposicion : [];
    const seen = new Set();
    const out = [];
    rows.forEach((r) => {
      const id = r?.client_id;
      if (!id || seen.has(String(id))) return;
      seen.add(String(id));
      out.push({ id, name: r.client_name || id });
    });
    return out;
  }, [exposicion]);

  const resolveClient = useMemo(() => (id) => {
    const rows = Array.isArray(exposicion) ? exposicion : [];
    const hit = rows.find((e) => e.client_id === id);
    if (hit?.client_name) return { name: hit.client_name, country: hit.country };
    return null;
  }, [exposicion]);

  const brandNameOf = useMemo(
    () => (id) => resolveBrand(id)?.name || null,
    [resolveBrand]
  );

  // ── Cronograma (solo para gráficas custom del builder) ──
  const [cron, setCron] = useState({ items: null, statsGlobal: null });
  const hasCustoms = (layout?.widgets || [])
    .some((w) => w.id.startsWith("custom:") && w.visible);
  const needsCron = builderOpen || hasCustoms;
  useEffect(() => {
    if (!needsCron || cron.items) return undefined;
    let alive = true;
    loadCronograma()
      .then(({ items, statsGlobal }) => {
        if (alive) setCron({ items: items || [], statsGlobal: statsGlobal || null });
      })
      .catch(() => { if (alive) setCron({ items: [], statsGlobal: null }); });
    return () => { alive = false; };
  }, [needsCron, cron.items]);

  const avgs = useMemo(
    () => (cron.items ? buildAvgs(null, cron.statsGlobal) : null),
    [cron]
  );
  const enriched = useMemo(() => {
    if (!cron.items) return [];
    return cron.items.map((it) => {
      const segs = computeSegments(it, avgs);
      return { it, segs, delivery: projectedDelivery(it, segs) };
    });
  }, [cron, avgs]);

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
  const setScope = (id, scope) => save({
    widgets: layout.widgets.map((w) => (w.id === id
      ? { ...w, config: { ...(w.config || {}), scope } }
      : w)),
  });

  if (!layout) {
    return (
      <div className="card card-pad-lg" style={{ marginBottom: 24 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {es ? "Cargando tablero…" : "Loading dashboard…"}
        </div>
      </div>
    );
  }

  const ctx = {
    lang, refreshNonce, fmtAmount, secondaryBrl,
    resolveBrand, resolveClient, onOpenExpediente,
    onOpenNode: (id) => navigate(`/nodos/${id}`),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
      <style>{SHIMMER_KEYFRAMES}</style>

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
          const def = adminWidgetById(entry.id);
          const isCustom = entry.id.startsWith("custom:");
          if (!def && !isCustom) return null; // layout viejo con id desconocido
          // Los ocultos NO se renderizan: salen de la vista y vuelven al
          // catálogo del modal "Agregar gráfica".
          if (!entry.visible) return null;
          const span = SPAN[isCustom ? "md" : def.size] || 12;
          const scope = entry.config?.scope || "general";
          const body = isCustom
            ? <CustomChart config={{ ...entry.config, brandNameOf }} enriched={enriched} lang={lang}/>
            : def.render({ ...ctx, scope });
          // El chip cede la esquina al chrome de edición en modo Personalizar.
          const chip = (!isCustom && !customizing) ? (
            <ScopeChip
              scope={scope}
              scopeable={def.scopeable}
              clients={clients}
              brands={brands}
              lang={lang}
              onChange={(s) => setScope(entry.id, s)}
            />
          ) : null;

          return (
            <div key={entry.id} style={{
              gridColumn: `span ${span}`, position: "relative", minWidth: 0,
              outline: customizing ? "1.5px dashed var(--border-strong, #CBD5E1)" : "none",
              outlineOffset: 3, borderRadius: 12,
            }}>
              {/* Chrome de personalización: reorden ↑↓, ocultar,
                  eliminar (customs). Sin drag-drop (robusto en touch). */}
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
                          title={es ? "Ocultar" : "Hide"}
                          onClick={() => toggleVisible(entry.id)}>
                    {es ? "Ocultar" : "Hide"}
                  </button>
                  {isCustom && (
                    <button type="button" className="btn btn-ghost btn-sm"
                            title={es ? "Eliminar gráfica" : "Delete chart"}
                            onClick={() => removeCustom(entry.id)}>✕</button>
                  )}
                </div>
              )}

              {(!isCustom && def.bare) ? (
                <>
                  {/* KPI cards son "bare" (traen su propia card): el chip
                      flota en la esquina superior derecha. */}
                  {chip && (
                    <div style={{ position: "absolute", top: 6, right: 6, zIndex: 10 }}>
                      {chip}
                    </div>
                  )}
                  <SafeWidget lang={lang} endpoint={def.endpoint}>{body}</SafeWidget>
                </>
              ) : (
                <DashboardCard
                  title={isCustom ? (entry.config?.title || "Custom") : adminTitleOf(entry, lang)}
                  subtitle={isCustom ? "" : adminSubtitleOf(entry, lang)}
                  action={chip}>
                  <SafeWidget lang={lang} endpoint={isCustom ? undefined : def.endpoint}>
                    {body}
                  </SafeWidget>
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
          widgets={ADMIN_WIDGETS}
          extraDims={ADMIN_EXTRA_DIMS}
          onAddBuiltin={toggleVisible}
          onAddCustom={addCustom}
          onClose={() => setBuilderOpen(false)}
        />
      )}
    </div>
  );
}
