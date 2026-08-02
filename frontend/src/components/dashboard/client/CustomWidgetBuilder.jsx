// ─────────────────────────────────────────────────────────────────────
// CustomWidgetBuilder — Sprint 2026-08-02 · Dashboard personalizable.
//
// Modal "+ Agregar gráfica" del dashboard CLIENT:
//   1. CATÁLOGO — widgets built-in que están ocultos (botón "Agregar"
//      los vuelve a mostrar).
//   2. BUILDER — gráfica nueva: métrica × dimensión × tipo, con título
//      automático editable y preview en vivo con los datos actuales.
// Los customs entran al layout como { id: "custom:<uuid>", visible,
// config: { metric, dim, chart, title } } y se persisten en
// preferences.dashboard_layout (merge shallow → todo bajo esa key).
// ─────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import {
  WIDGETS, CustomChart, BUILDER_OPTS, autoTitle,
} from "./widgetRegistry.jsx";

const newCustomId = () => {
  const uuid = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `custom:${uuid}`;
};

const selStyle = {
  padding: "6px 10px", fontSize: 12.5, borderRadius: 8,
  border: "1px solid var(--border-subtle, #E1E6ED)",
  background: "var(--surface-raised)", color: "var(--text-primary)",
};
const lblStyle = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6,
  color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase",
};

export default function CustomWidgetBuilder({
  lang = "es", enriched, layout, onAddBuiltin, onAddCustom, onClose,
}) {
  const es = lang === "es";
  const [metric, setMetric] = useState("pares");
  const [dim, setDim] = useState("sku");
  const [chart, setChart] = useState("barras");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  const auto = useMemo(() => autoTitle({ metric, dim }, lang), [metric, dim, lang]);
  const effectiveTitle = (titleTouched ? title : "") || auto;
  const previewConfig = { metric, dim, chart, title: effectiveTitle };

  // Built-ins ocultos en el layout actual → ofrecerlos en el catálogo.
  const hiddenBuiltins = useMemo(() => {
    const vis = new Set((layout?.widgets || [])
      .filter((w) => w.visible).map((w) => w.id));
    return WIDGETS.filter((w) => !vis.has(w.id));
  }, [layout]);

  const addCustom = () => {
    onAddCustom({
      id: newCustomId(),
      visible: true,
      config: { metric, dim, chart, title: effectiveTitle },
    });
    onClose();
  };

  const optLabel = (o) => (es ? o.es : o.en);
  const select = (value, setter, opts, aria) => (
    <select value={value} onChange={(e) => setter(e.target.value)}
            aria-label={aria} style={selStyle}>
      {opts.map((o) => <option key={o.id} value={o.id}>{optLabel(o)}</option>)}
    </select>
  );

  return (
    <div role="dialog" aria-modal="true"
         style={{
           position: "fixed", inset: 0, zIndex: 1600,
           background: "rgba(11,30,58,0.45)",
           display: "grid", placeItems: "center", padding: 18,
         }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{
        width: "min(640px, 100%)", maxHeight: "88vh", overflowY: "auto",
        padding: "18px 20px", borderRadius: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>
            {es ? "Agregar gráfica" : "Add chart"}
          </h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={es ? "Cerrar" : "Close"}>✕</button>
        </div>

        {/* 1 · Catálogo de built-ins ocultos */}
        {hiddenBuiltins.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...lblStyle, marginBottom: 8 }}>
              {es ? "Del catálogo" : "From the catalog"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {hiddenBuiltins.map((w) => (
                <div key={w.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  border: "1px solid var(--border-subtle, #E1E6ED)",
                  borderRadius: 10, padding: "8px 12px",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
                      {es ? w.title_es : w.title_en}
                    </div>
                    <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                      {es ? w.sub_es : w.sub_en}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm"
                          style={{ marginLeft: "auto", flexShrink: 0 }}
                          onClick={() => { onAddBuiltin(w.id); }}>
                    {es ? "Agregar" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2 · Builder de gráfica custom */}
        <div style={{ ...lblStyle, marginBottom: 8 }}>
          {es ? "Nueva gráfica" : "New chart"}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {select(metric, (v) => { setMetric(v); }, BUILDER_OPTS.metrics, es ? "Métrica" : "Metric")}
          {select(dim, (v) => { setDim(v); }, BUILDER_OPTS.dims, es ? "Dimensión" : "Dimension")}
          {select(chart, setChart, BUILDER_OPTS.charts, es ? "Tipo" : "Type")}
          <input value={titleTouched ? title : auto}
                 onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
                 placeholder={auto} aria-label={es ? "Título" : "Title"}
                 style={{ ...selStyle, flex: 1, minWidth: 160 }}/>
        </div>

        {/* Preview en vivo con los datos actuales */}
        <div style={{
          border: "1px dashed var(--border-strong, #CBD5E1)", borderRadius: 10,
          padding: 12, marginBottom: 14, background: "var(--surface-hover)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 8 }}>
            {effectiveTitle}
          </div>
          <CustomChart config={previewConfig} enriched={enriched} lang={lang}/>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {es ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={addCustom}>
            {es ? "Agregar" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
