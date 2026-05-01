// =====================================================================
// MWT.ONE · ArtifactsSummaryCard
// Reemplaza el card "Detalles" de la pestaña Resumen por un resumen
// real: cuántos artefactos hay por etapa del expediente, último
// editado y un click-through al tab "Documentos".
//
// Los datos vienen del endpoint:
//   GET /api/expedientes/{id}/artifacts/
// Mismo que el board del tab Documentos — el resumen es derived view.
// =====================================================================
import React, { useEffect, useState } from "react";
import { IconFileText, IconArrow, IconSparkle } from "../../../lib/icons.jsx";
import { builderArtifactsApi } from "../../../lib/api.js";
import {
  STAGE_ORDER, STAGE_COLOR, stageLabel,
} from "./stages.js";

function relTime(iso, lang) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1)   return lang === "es" ? "ahora" : "just now";
  if (m < 60)  return lang === "es" ? `hace ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24)  return lang === "es" ? `hace ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  return lang === "es" ? `hace ${d} d` : `${d} d ago`;
}

export default function ArtifactsSummaryCard({
  expedienteId,
  currentStage,
  lang = "es",
  onOpenTab,        // () => setTab('artifacts')
}) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!expedienteId) return;
    let cancel = false;
    setLoading(true);
    builderArtifactsApi.list(expedienteId)
      .then((data) => {
        if (cancel) return;
        const list = Array.isArray(data) ? data : (data?.results || []);
        setItems(list);
        setLoading(false);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || "Error");
        setLoading(false);
      });
    return () => { cancel = true; };
  }, [expedienteId]);

  // Agrupar por etapa
  const grouped = STAGE_ORDER.reduce((acc, s) => {
    acc[s] = items.filter((it) => it.stage === s);
    return acc;
  }, {});

  // Métricas
  const total = items.length;
  const totalEtapas = STAGE_ORDER.filter((s) => grouped[s].length > 0).length;
  const last = items.length > 0
    ? items.reduce((a, b) =>
        new Date(a.updated_at || a.created_at) >
        new Date(b.updated_at || b.created_at) ? a : b
      )
    : null;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          {lang === "es" ? "Artefactos del expediente" : "File artifacts"}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onOpenTab}
        >
          {lang === "es" ? "Ver todos" : "View all"}{" "}
          <IconArrow size={12}/>
        </button>
      </div>

      <div className="card-pad-lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* KPIs compactos */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 18,
          }}
        >
          <SummaryStat
            label={lang === "es" ? "Total" : "Total"}
            value={total}
            sub={lang === "es" ? "artefactos" : "artifacts"}
            tone="primary"
          />
          <SummaryStat
            label={lang === "es" ? "Etapas con datos" : "Stages with data"}
            value={`${totalEtapas}/${STAGE_ORDER.length}`}
            sub={lang === "es" ? "del flujo" : "of the flow"}
            tone="neutral"
          />
          <SummaryStat
            label={lang === "es" ? "Última edición" : "Last edit"}
            value={last ? relTime(last.updated_at || last.created_at, lang) : "—"}
            sub={last ? (last.template_title || "").slice(0, 22) : ""}
            tone="success"
          />
        </div>

        {/* Loading / error / empty */}
        {loading && (
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Cargando artefactos…" : "Loading artifacts…"}
          </div>
        )}

        {!loading && error && (
          <div
            className="caption"
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "var(--critical-bg, rgba(220,38,38,0.06))",
              color: "var(--critical, #DC2626)",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && total === 0 && (
          <EmptyState lang={lang} onOpenTab={onOpenTab} currentStage={currentStage}/>
        )}

        {/* Distribución por etapa */}
        {!loading && !error && total > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              className="micro"
              style={{ marginBottom: 4, color: "var(--text-secondary)" }}
            >
              {lang === "es" ? "DISTRIBUCIÓN POR ETAPA" : "DISTRIBUTION BY STAGE"}
            </div>
            {STAGE_ORDER.map((s) => {
              const list  = grouped[s];
              const count = list.length;
              if (count === 0) return null;
              const isCurrent = s === currentStage;
              return (
                <div
                  key={s}
                  onClick={onOpenTab}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: isCurrent
                      ? "var(--brand-accent-soft, rgba(0,178,134,0.08))"
                      : "transparent",
                    border: isCurrent
                      ? "1px solid var(--brand-accent, #00B286)"
                      : "1px solid transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "var(--bg-alt)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: STAGE_COLOR[s], flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {stageLabel(lang, s)}
                  </span>
                  <span
                    className="tabular"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: "var(--surface)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {count}
                  </span>
                  <span
                    className="caption"
                    style={{
                      color: "var(--text-tertiary)",
                      fontSize: 11,
                      minWidth: 70,
                      textAlign: "right",
                    }}
                  >
                    {relTime(
                      list.reduce((a, b) =>
                        new Date(a.updated_at) > new Date(b.updated_at) ? a : b
                      ).updated_at,
                      lang
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────
function SummaryStat({ label, value, sub, tone }) {
  const colorMap = {
    primary: "var(--brand-primary, #0B1E3A)",
    success: "var(--success, #00B286)",
    neutral: "var(--text-primary, #0B1E3A)",
  };
  return (
    <div>
      <div className="micro" style={{ marginBottom: 4 }}>{label}</div>
      <div
        className="tabular"
        style={{
          font: "700 22px/1.1 var(--font-mono)",
          color: colorMap[tone] || colorMap.neutral,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="caption"
          style={{ marginTop: 2, color: "var(--text-tertiary)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function EmptyState({ lang, onOpenTab, currentStage }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: "20px 12px",
        textAlign: "center",
        background: "var(--bg-alt)",
        borderRadius: 8,
      }}
    >
      <IconSparkle size={20} style={{ color: "var(--brand-accent)" }}/>
      <div
        className="heading-sm"
        style={{ color: "var(--text-primary)" }}
      >
        {lang === "es"
          ? "Aún no hay artefactos"
          : "No artifacts yet"}
      </div>
      <div
        className="caption"
        style={{
          maxWidth: 360,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {lang === "es"
          ? `Los datos del expediente (modo, ETA, contenedores, origen, destino, …) se registran como artefactos en la pestaña Documentos. El expediente está en ${currentStage || "REGISTRO"}; se pueden agregar artefactos a esa etapa y a las anteriores.`
          : `File data (mode, ETA, containers, origin, destination, …) are recorded as artifacts in the Documents tab. The file is in ${currentStage || "REGISTRO"}; artifacts can be added to that stage or earlier.`}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={onOpenTab}
        style={{ marginTop: 4 }}
      >
        <IconFileText size={12}/>
        {lang === "es" ? "Ir a Documentos" : "Go to Documents"}
      </button>
    </div>
  );
}
