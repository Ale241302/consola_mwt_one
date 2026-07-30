// =====================================================================
// MWT.ONE · ArtifactFillModal
// Modal que renderiza el formulario dinámico de un artefacto y permite
// crear / editar la instancia llenada. La estructura se toma del
// `structure_snapshot` cuando se edita; o del template fresco al crear.
// =====================================================================
import React, { useMemo, useRef, useState } from "react";
import { IconCheck, IconX, IconUpload, IconSparkle } from "../../../lib/icons.jsx";
import DynamicField from "./DynamicField.jsx";
import { stageLabel } from "./stages.js";
// Sprint 2026-05-11 · Fase 7 · IA · dropzone autorrellena los campos
// del template a partir de un documento (PDF/Excel/Word/txt).
import { aiDocumentExtractApi } from "../../../lib/api.js";

export default function ArtifactFillModal({
  mode,           // "create" | "edit" | "view"   (view = read-only, sprint 2026-05-11 fase 7+)
  templateTitle,
  structure,      // structure_json: { sections: [{ id, title, columns:[{ id, fields:[...] }] }] }
  stage,
  initialData,    // { [field.id]: value }
  saving,
  lang = "es",
  onCancel,
  onSubmit,
  // Sprint 2026-05-11 fase 7+ · Líneas asociadas al artefacto (read-only).
  // Cuando viene poblado, se renderiza una tabla al final del modal con
  // SKU / Nombre / Talla / Cantidad. Es informativo en cualquier modo.
  linesScope = null,   // [{sku, nombre, talla, qty, expediente_codigo?, expediente_id?}]
}) {
  const isView = mode === "view";
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

  // ── Sprint 2026-05-11 fase 7 · Autorelleno por IA ──
  // El operador sube un PDF/Excel/Word/txt; el backend llama a la API
  // de Anthropic con el structure_json del template y devuelve los
  // campos que pudo extraer. Hacemos merge: los campos ya tocados por
  // el usuario NO se sobreescriben (preserva trabajo manual).
  const fileRef = useRef(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError,   setAiError]   = useState(null);
  const [aiResult,  setAiResult]  = useState(null);  // {fieldsExtracted, model, notes}
  const [dragOver,  setDragOver]  = useState(false);

  const handleAiFile = async (file) => {
    if (!file) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const resp = await aiDocumentExtractApi.extract({
        file,
        structure,
      });
      const extracted = resp?.extracted || {};
      // Merge respetando los campos que el usuario ya tocó.
      setData((prev) => {
        const next = { ...prev };
        for (const [fid, val] of Object.entries(extracted)) {
          if (touched[fid]) continue;       // preserva edición manual
          if (val === null || val === undefined) continue;
          next[fid] = val;
        }
        return next;
      });
      const meta = resp?._meta || {};
      if (meta.error) {
        setAiError(meta.error);
      } else {
        setAiResult({
          fieldsExtracted: meta.fields_extracted ?? Object.keys(extracted).length,
          fieldsTotal:     meta.fields_in_schema ?? allFields.length,
          model:           meta.model || "—",
          kind:            meta.kind  || "—",
          notes:           resp?.notes || "",
        });
      }
    } catch (e) {
      setAiError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error al analizar" : "Analysis error"));
    } finally {
      setAiLoading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleAiFile(f);
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
                : mode === "view"
                  ? (lang === "es" ? "Ver artefacto" : "View artifact")
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
            {/* Sprint 2026-05-11 fase 7 · Dropzone IA — antes de la primera
                sección. Acepta PDF/Excel/Word/txt/imágenes; al detectar
                el archivo, llama al backend (Anthropic) y rellena los
                campos del template. Los campos que el usuario ya tocó
                NO se sobreescriben.
                Sprint 2026-05-11 fase 7+ · oculto en mode="view". */}
            {!isView && (<>
            <div
              role="button"
              tabIndex={0}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !aiLoading && fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!aiLoading) fileRef.current?.click();
                }
              }}
              style={{
                border: dragOver
                  ? "2px dashed var(--brand-accent, #0E8A6D)"
                  : "2px dashed var(--border-subtle)",
                background: dragOver
                  ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 6%, transparent)"
                  : "var(--surface-alt, rgba(11,30,58,0.02))",
                borderRadius: 12,
                padding: "18px 16px",
                textAlign: "center",
                cursor: aiLoading ? "wait" : "pointer",
                transition: "all 0.15s",
              }}
              title={lang === "es"
                ? "Suelta un documento o haz click para autorellenar con IA"
                : "Drop a document or click to autofill with AI"}
            >
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,.xlsx,.xlsm,.xls,.docx,.doc,.csv,.txt,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAiFile(f);
                  e.target.value = "";  // reset para permitir re-subir mismo file
                }}
              />
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                color: aiLoading
                  ? "var(--text-tertiary)"
                  : "var(--brand-accent, #0E8A6D)",
              }}>
                {aiLoading
                  ? <IconSparkle size={16}/>
                  : <IconUpload   size={16}/>}
                <span style={{ font: "700 13px/1 var(--font-display)" }}>
                  {aiLoading
                    ? (lang === "es" ? "Analizando con IA…" : "Analyzing with AI…")
                    : (lang === "es"
                        ? "Suelta un documento o haz click para autorellenar"
                        : "Drop a document or click to autofill")}
                </span>
              </div>
              <div className="caption" style={{
                color: "var(--text-tertiary)", marginTop: 4, fontSize: 11,
              }}>
                PDF · Excel · Word · TXT · Imagen
                {" · max 25 MB · "}
                {lang === "es"
                  ? "los campos ya editados a mano no se sobreescriben"
                  : "manually-edited fields are preserved"}
              </div>
            </div>

            {/* Feedback post-extracción */}
            {aiResult && (
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "color-mix(in oklab, var(--brand-accent, #0E8A6D) 8%, transparent)",
                color: "var(--brand-accent, #0E8A6D)",
                fontSize: 12.5, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <IconCheck size={13}/>
                {lang === "es"
                  ? `IA llenó ${aiResult.fieldsExtracted}/${aiResult.fieldsTotal} campos · modelo ${aiResult.model} · entrada ${aiResult.kind}`
                  : `AI filled ${aiResult.fieldsExtracted}/${aiResult.fieldsTotal} fields · model ${aiResult.model} · input ${aiResult.kind}`}
                {aiResult.notes && (
                  <span style={{ opacity: 0.85, fontWeight: 400,
                                 marginLeft: 6 }}>
                    · {aiResult.notes}
                  </span>
                )}
              </div>
            )}
            {aiError && (
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "#FEE2E2", color: "#991B1B",
                border: "1px solid #FCA5A5",
                fontSize: 12.5,
              }}>
                {aiError}
              </div>
            )}
            </>)}{/* fin del bloque dropzone IA (sólo visible si !isView) */}

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
                                /* Sprint 2026-05-11 fase 7+ · en mode=view el
                                   onChange queda como no-op para que React
                                   no se queje de inputs sin handler. */
                                onChange={isView ? () => {} : (v) => setField(f.id, v)}
                                disabled={saving || isView}
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

            {/* Sprint 2026-05-11 fase 7+ · Tabla read-only de líneas
                asociadas al artefacto. Informativo en cualquier modo.
                Aparece sólo si linesScope viene con datos. */}
            {Array.isArray(linesScope) && linesScope.length > 0 && (
              <section
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 12,
                  background: "var(--surface-alt, rgba(11,30,58,0.02))",
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  paddingBottom: 10,
                  borderBottom: "1px solid var(--divider, var(--border-subtle))",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "var(--brand-primary, #481EE3)",
                    flexShrink: 0,
                  }}/>
                  <span className="micro" style={{
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    fontWeight: 700, color: "var(--text-secondary)",
                  }}>
                    {lang === "es"
                      ? "Productos asociados al artefacto"
                      : "Lines associated with this artifact"}
                  </span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        {linesScope.some((l) => l.expediente_codigo) && (
                          <th style={{ width: 140 }}>
                            {lang === "es" ? "Expediente" : "Expediente"}
                          </th>
                        )}
                        <th style={{ width: 130 }}>SKU</th>
                        <th>{lang === "es" ? "Producto" : "Product"}</th>
                        <th style={{ textAlign: "center", width: 80 }}>
                          {lang === "es" ? "Talla" : "Size"}
                        </th>
                        <th style={{ textAlign: "right", width: 100 }}>
                          {lang === "es" ? "Cantidad" : "Qty"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linesScope.map((l, i) => (
                        <tr key={l.id || `${l.expediente_id || ""}-${l.producto_id || ""}-${l.talla || ""}-${i}`}>
                          {linesScope.some((x) => x.expediente_codigo) && (
                            <td>
                              <span className="mono-sm" style={{
                                fontWeight: 700, color: "var(--brand-primary)",
                              }}>
                                {l.expediente_codigo || "—"}
                              </span>
                            </td>
                          )}
                          <td>
                            <span className="mono-sm" style={{ fontWeight: 600 }}>
                              {l.sku || "—"}
                            </span>
                          </td>
                          <td>{l.nombre || "—"}</td>
                          <td style={{ textAlign: "center" }}>
                            {l.talla
                              ? <span className="size-chip">{l.talla}</span>
                              : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                          </td>
                          <td className="td-num tabular-nums"
                              style={{ fontWeight: 600 }}>
                            {Number(l.qty || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={linesScope.some((x) => x.expediente_codigo) ? 4 : 3}
                            style={{
                              textAlign: "right", fontWeight: 700,
                              color: "var(--text-secondary)",
                              textTransform: "uppercase", fontSize: 11,
                              letterSpacing: "0.08em", padding: "10px 12px",
                            }}>
                          {lang === "es" ? "Total" : "Total"}
                        </td>
                        <td className="td-num tabular-nums"
                            style={{ fontWeight: 700, padding: "10px 12px" }}>
                          {linesScope.reduce((a, l) => a + Number(l.qty || 0), 0).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="mdl-footer">
          <span
            className="caption tabular"
            style={{ color: "var(--text-tertiary)", marginRight: "auto" }}
          >
            {allFields.length} {lang === "es" ? "campos" : "fields"}
            {!isView && (
              <>
                {" · "}
                {missing.length} {lang === "es" ? "pendientes" : "missing"}
              </>
            )}
            {Array.isArray(linesScope) && linesScope.length > 0 && (
              <>
                {/* Sprint 2026-07-30 (CEO) · contar SKUs distintos, no
                    filas (varias tallas del mismo SKU = 1 línea). */}
                {" · "}{new Set(linesScope.map((l) => String(l.sku || l.nombre || ""))).size}{" "}
                {lang === "es" ? "línea(s) vinculadas" : "linked line(s)"}
              </>
            )}
          </span>
          {/* Sprint 2026-05-11 fase 7+ · en mode=view sólo "Cerrar". */}
          {isView ? (
            <button
              className="btn btn-primary"
              onClick={onCancel}
              type="button"
            >
              {lang === "es" ? "Cerrar" : "Close"}
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
