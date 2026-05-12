// =====================================================================
// MWT.ONE · ArtifactFillModal
// Modal que renderiza el formulario dinámico de un artefacto y permite
// crear / editar la instancia llenada. La estructura se toma del
// `structure_snapshot` cuando se edita; o del template fresco al crear.
// =====================================================================
import React, { useMemo, useState } from "react";
import { IconCheck, IconX } from "../../../lib/icons.jsx";
import DynamicField from "./DynamicField.jsx";
import { stageLabel } from "./stages.js";

export default function ArtifactFillModal({
  mode,           // "create" | "edit"
  templateTitle,
  structure,      // structure_json: { sections: [{ id, title, columns:[{ id, fields:[...] }] }] }
  stage,
  initialData,    // { [field.id]: value }
  saving,
  lang = "es",
  onCancel,
  onSubmit,
}) {
  const [data, setData] = useState(initialData || {});
  const [touched, setTouched] = useState({});

  const allFields = useMemo(() => {
    const out = [];
    for (const sec of (structure?.sections || [])) {
      for (const col of (sec?.columns || [])) {
        for (const f of (col?.fields || [])) out.push(f);
      }
    }
    return out;
  }, [structure]);

  const missing = useMemo(() => {
    return allFields
      .filter((f) => f.required)
      .filter((f) => {
        const v = data[f.id];
        if (v === null || v === undefined) return true;
        if (typeof v === "string" && v.trim() === "") return true;
        if (Array.isArray(v) && v.length === 0) return true;
        return false;
      })
      .map((f) => f.id);
  }, [allFields, data]);

  const setField = (id, v) => {
    setData((prev) => ({ ...prev, [id]: v }));
    setTouched((prev) => ({ ...prev, [id]: true }));
  };

  const handleSubmit = async () => {
    if (missing.length > 0) {
      const t = {};
      missing.forEach((id) => { t[id] = true; });
      setTouched((prev) => ({ ...prev, ...t }));
      return;
    }
    await onSubmit?.(data);
  };

  return (
    <div
      className="mdl-backdrop"
      onClick={(e) => {
        if (e.target.classList.contains("mdl-backdrop") && !saving) onCancel?.();
      }}
    >
      {/* Sprint 2026-05-11 fase 4 fix · El panel data-wide tiene
          max-width 720px definido en app.css, que aprieta secciones
          con 2+ columnas. Sobreescribimos a 980px aquí para que las
          cards de secciones del Builder respiren. */}
      <div className="mdl-panel" data-wide
           style={{ maxWidth: "min(980px, 96vw)" }}>
        <div className="mdl-head">
          <div>
            <div className="mdl-title">
              {mode === "create"
                ? (lang === "es" ? "Nuevo artefacto" : "New artifact")
                : (lang === "es" ? "Editar artefacto" : "Edit artifact")}
            </div>
            <div className="mdl-subtitle">
              {templateTitle}
              {/* Sprint 2026-05-11 fase 4 · `stage` es opcional. En el
                  caso de nodos no aplica concepto de etapa, así que sólo
                  mostramos el título de la plantilla. */}
              {stage && (
                <>
                  {" "}· {lang === "es" ? "Etapa" : "Stage"}{" "}
                  {stageLabel(lang, stage)}
                </>
              )}
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={onCancel}
            disabled={saving}
            aria-label="Cerrar"
          >
            <IconX size={14}/>
          </button>
        </div>

        <div className="mdl-body">
          {/* Sprint 2026-05-11 fase 4 fix · Render fiel al Builder.
              Cada sección es una card MWT con borde + encabezado tipo
              "● Sección N". Las secciones se apilan verticalmente
              (flex-column) para garantizar que el grid interno de
              columnas no las pegue horizontalmente, sin importar lo
              que haga .mdl-form en CSS global. */}
          <div
            className="mdl-form"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {(structure?.sections || []).map((sec, secIdx) => {
              const cols = sec.columns || [];
              const sectionTitle = (sec.title && String(sec.title).trim())
                || `${lang === "es" ? "Sección" : "Section"} ${secIdx + 1}`;
              return (
                <section
                  key={sec.id ?? `sec-${secIdx}`}
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 12,
                    background: "var(--surface-alt, rgba(11,30,58,0.02))",
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  {/* Encabezado tipo Builder: dot verde + título */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--divider, var(--border-subtle))",
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: "var(--brand-accent, #0E8A6D)",
                      flexShrink: 0,
                    }}/>
                    <span className="micro" style={{
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      color: "var(--text-secondary)",
                    }}>
                      {sectionTitle}
                    </span>
                  </div>

                  {/* Grid de columnas internas. Respeta el número de
                      columns que mande el Builder (1, 2 o más). */}
                  <div
                    style={{
                      display: "grid",
                      gap: 18,
                      gridTemplateColumns:
                        cols.length > 1
                          ? `repeat(${cols.length}, minmax(0, 1fr))`
                          : "1fr",
                    }}
                  >
                    {cols.map((col, colIdx) => (
                      <div
                        key={col.id ?? `col-${secIdx}-${colIdx}`}
                        style={{ display: "flex", flexDirection: "column", gap: 14 }}
                      >
                        {(col.fields || []).map((f) => {
                          const showError = touched[f.id] && missing.includes(f.id);
                          return (
                            <div key={f.id} className="mdl-field">
                              <label style={{
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "var(--text-secondary)",
                                marginBottom: 6,
                                display: "block",
                              }}>
                                {f.label}
                                {f.required && (
                                  <span style={{
                                    color: "var(--critical, #DC2626)",
                                    marginLeft: 4,
                                  }}>*</span>
                                )}
                              </label>
                              <DynamicField
                                field={f}
                                value={data[f.id] ?? null}
                                onChange={(v) => setField(f.id, v)}
                                disabled={saving}
                                lang={lang}
                              />
                              {f.helpText && (
                                <div
                                  className="caption"
                                  style={{ marginTop: 4, color: "var(--text-tertiary)" }}
                                >
                                  {f.helpText}
                                </div>
                              )}
                              {showError && (
                                <div
                                  className="caption"
                                  style={{
                                    marginTop: 4,
                                    color: "var(--critical, #DC2626)",
                                  }}
                                >
                                  {lang === "es"
                                    ? "Campo requerido"
                                    : "Required field"}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <div className="mdl-footer">
          <span
            className="caption tabular"
            style={{ color: "var(--text-tertiary)", marginRight: "auto" }}
          >
            {allFields.length} {lang === "es" ? "campos" : "fields"} ·{" "}
            {missing.length} {lang === "es" ? "pendientes" : "missing"}
          </span>
          <button
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || missing.length > 0}
          >
            <IconCheck size={13}/>
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : mode === "create"
                ? (lang === "es" ? "Crear artefacto" : "Create artifact")
                : (lang === "es" ? "Guardar cambios" : "Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}
