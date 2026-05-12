// =====================================================================
// MWT.ONE · ArtifactScopeModal
// Sprint 2026-05-11 · Fase 5
//
// Modal que captura el ALCANCE de un artefacto del nodo antes de
// elegir el template. Reemplaza el flujo previo (template → fill)
// por: scope → template → fill.
//
// Estructura:
//   1) Sección "Expedientes": chips multi-select de expedientes
//      asignados al nodo con líneas pendientes.
//   2) Sección "Líneas": tabla por (SKU, talla) con cantidad editable.
//      Si recibe `templateId`, las cantidades disponibles vienen
//      DESCONTADAS por el uso previo de instancias del mismo template
//      (excluyendo `excludeInstanceId` cuando se está editando).
//
// Modos:
//   - mode="create": template_id NO definido todavía → muestra TOTALES
//                    de cada línea sin descuento (el descuento se valida
//                    al guardar — el backend rechaza si excede).
//   - mode="edit":   recibe template_id + excludeInstanceId + initialLines
//                    → muestra disponible + lo que YA usa esta instancia.
//
// Devuelve al caller (via onSubmit) un payload:
//   {
//     expediente_ids: [...],
//     lines: [{ expediente_id, producto_id, talla, qty }],
//   }
// =====================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconX, IconRefresh } from "../../lib/icons.jsx";
import { nodoBuilderArtifactsApi } from "../../lib/api.js";

const keyOf = (r) =>
  `${r.expediente_id}::${r.producto_id}::${r.talla || ""}`;

export default function ArtifactScopeModal({
  nodeId,
  templateId           = null,    // null en create, valor en edit
  templateTitle        = null,    // mostrado como breadcrumb si existe
  excludeInstanceId    = null,    // UUID de la instancia que se edita
  initialLines         = [],      // [{expediente_id, producto_id, talla, qty}]
  initialExpedienteIds = [],
  // Sprint 2026-05-11 fase 5 (wizard) · cuando este modal se abre desde
  // el paso 3 del wizard de recepción, sólo deben aparecer los
  // expedientes que el operador eligió en el paso 2. Si viene, filtra
  // los chips a este set.
  restrictExpedienteIds = null,   // array | null
  // Sprint 2026-05-11 (iteración) · Si las allocations todavía están
  // en memoria (caso wizard paso 3, antes de confirmar) el backend no
  // las ve. Estos dos props permiten alimentar el modal directamente.
  // Cuando NO vienen, el modal hace fetch normal a la API.
  //   inMemoryExpedientes: [{expediente_id, expediente_codigo,
  //                          proforma_codigo?, sap?}, ...]
  //   inMemoryLines:       [{expediente_id, producto_id, sku, nombre,
  //                          talla, qty_disponible}, ...]
  inMemoryExpedientes  = null,
  inMemoryLines        = null,
  lang                 = "es",
  onCancel,
  onSubmit,             // (payload) => void
  submitLabel          = null,    // texto custom para el CTA
}) {
  // ── Estado: expedientes seleccionados ─────────────────────────
  const [expedientes, setExpedientes]   = useState([]);
  const [expLoading, setExpLoading]     = useState(true);
  const [expError, setExpError]         = useState(null);
  const [selectedExpIds, setSelectedExpIds] = useState(initialExpedienteIds);

  // ── Estado: líneas disponibles ────────────────────────────────
  const [availableLines, setAvailableLines] = useState([]);
  const [linesLoading, setLinesLoading]     = useState(false);
  const [linesError, setLinesError]         = useState(null);

  // ── Estado de selección por línea ─────────────────────────────
  // rowState[key] = { include: bool, qty: number }
  const [rowState, setRowState] = useState(() => {
    // Pre-seleccionar las líneas que el artefacto ya tenía (modo edit).
    const initial = {};
    for (const l of (initialLines || [])) {
      const k = `${l.expediente_id}::${l.producto_id}::${l.talla || ""}`;
      initial[k] = { include: true, qty: Number(l.qty || 0) };
    }
    return initial;
  });

  // ── 1) Cargar expedientes del nodo ────────────────────────────
  useEffect(() => {
    // Sprint 2026-05-11 (iteración) · Si el wizard pasó la lista en
    // memoria, la usamos directamente sin fetchear. Esto es necesario
    // porque las allocations del paso 2 aún no están persistidas en
    // BD cuando el operador abre este modal desde el paso 3.
    if (Array.isArray(inMemoryExpedientes)) {
      setExpedientes(inMemoryExpedientes);
      setExpLoading(false);
      setExpError(null);
      return;
    }

    let cancel = false;
    setExpLoading(true); setExpError(null);
    nodoBuilderArtifactsApi.expedientes(nodeId, {
      templateId, excludeInstanceId,
    })
      .then((data) => {
        if (cancel) return;
        let arr = Array.isArray(data) ? data : (data?.results || []);
        // Sprint 2026-05-11 fase 5 (wizard) · si recibimos restrictExpedienteIds
        // filtramos la lista para que solo aparezcan los chips de los
        // expedientes elegidos en el paso 2 del wizard.
        if (Array.isArray(restrictExpedienteIds) && restrictExpedienteIds.length) {
          const allowed = new Set(restrictExpedienteIds.map(String));
          arr = arr.filter((e) => allowed.has(String(e.expediente_id)));
        }
        setExpedientes(arr);
      })
      .catch((e) => {
        if (cancel) return;
        setExpError(e?.body?.detail || e?.message
          || (lang === "es" ? "Error cargando expedientes" : "Error loading expedientes"));
      })
      .finally(() => { if (!cancel) setExpLoading(false); });
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, templateId, excludeInstanceId, lang,
      // Para que el filtro `restrict` se recalcule si el wizard
      // cambia el set después de abrir el modal.
      JSON.stringify(restrictExpedienteIds || []),
      JSON.stringify(inMemoryExpedientes || null)]);

  // ── 2) Cargar líneas disponibles cuando cambia la selección ───
  const reloadLines = useCallback(() => {
    if (!nodeId || selectedExpIds.length === 0) {
      setAvailableLines([]);
      return;
    }

    // Sprint 2026-05-11 (iteración) · Si tenemos las líneas en memoria
    // las usamos directamente filtrando por expedientes seleccionados.
    if (Array.isArray(inMemoryLines)) {
      const allowedExp = new Set(selectedExpIds.map(String));
      const filtered = inMemoryLines
        .filter((r) => allowedExp.has(String(r.expediente_id)))
        .filter((r) => Number(r.qty_disponible || 0) > 0
          || rowState[keyOf(r)]?.include);
      setAvailableLines(filtered);
      setLinesLoading(false);
      setLinesError(null);
      return;
    }

    setLinesLoading(true); setLinesError(null);
    nodoBuilderArtifactsApi.availableLines(nodeId, {
      templateId,
      expedienteIds: selectedExpIds,
      excludeInstanceId,
    })
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        // Filtramos las que no tienen NADA disponible (caso edge).
        const filtered = arr.filter((r) => Number(r.qty_disponible || 0) > 0
          || rowState[keyOf(r)]?.include);
        setAvailableLines(filtered);
      })
      .catch((e) => setLinesError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error cargando líneas" : "Error loading lines")))
      .finally(() => setLinesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, templateId, excludeInstanceId, selectedExpIds, lang,
      JSON.stringify(inMemoryLines || null)]);

  useEffect(() => { reloadLines(); }, [reloadLines]);

  // ── Helpers ───────────────────────────────────────────────────
  const toggleExp = (id) => {
    setSelectedExpIds((prev) => prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id]);
  };

  const setInclude = (key, on) =>
    setRowState((p) => ({ ...p, [key]: { ...(p[key] || {}), include: !!on } }));
  const setQty = (key, q, max) => {
    const v = Math.max(0, Math.min(Number(q || 0), max));
    setRowState((p) => ({ ...p, [key]: { ...(p[key] || {}), qty: v } }));
  };

  // Agrupar por expediente para mejor lectura
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of availableLines) {
      if (!map.has(r.expediente_id)) map.set(r.expediente_id, []);
      map.get(r.expediente_id).push(r);
    }
    return Array.from(map.entries()).map(([id, rows]) => ({
      expediente_id: id,
      expediente_codigo: rows[0]?.expediente_codigo,
      rows,
    }));
  }, [availableLines]);

  const includeAllOfGroup = (rows, on) =>
    setRowState((p) => {
      const next = { ...p };
      for (const r of rows) {
        const k = keyOf(r);
        // Si activamos, qty se setea al disponible (o lo que ya estaba si era mayor).
        const max = Number(r.qty_disponible || 0);
        next[k] = {
          include: !!on,
          qty: on ? Math.max(next[k]?.qty || 0, 0) || max : (next[k]?.qty || max),
        };
        if (on && (next[k].qty <= 0 || next[k].qty > max)) next[k].qty = max;
      }
      return next;
    });

  // ── Items finales que se mandan al caller ─────────────────────
  const items = useMemo(() => {
    return availableLines
      .filter((r) => rowState[keyOf(r)]?.include)
      .map((r) => {
        const k = keyOf(r);
        const max = Number(r.qty_disponible || 0);
        const qty = Math.max(0, Math.min(Number(rowState[k]?.qty || 0), max));
        return {
          expediente_id: r.expediente_id,
          producto_id:   r.producto_id,
          talla:         r.talla || null,
          qty,
        };
      })
      .filter((it) => it.qty > 0);
  }, [availableLines, rowState]);

  const canSubmit = items.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit?.({
      expediente_ids: selectedExpIds,
      lines: items,
    });
  };

  // ── Render via portal ─────────────────────────────────────────
  return createPortal(
    <>
      <div onClick={onCancel} style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(15,27,61,0.42)", backdropFilter: "blur(2px)",
      }}/>
      <div role="dialog" aria-modal="true"
           style={{
             position: "fixed", top: "5vh", left: "50%",
             transform: "translateX(-50%)",
             width: "min(960px, 96vw)", maxHeight: "90vh", zIndex: 9001,
             background: "#FFFFFF", borderRadius: 14,
             boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
             display: "flex", flexDirection: "column",
           }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ font: "700 16px/1.3 var(--font-display)",
                          color: "var(--text-primary)" }}>
              {lang === "es" ? "Alcance del artefacto" : "Artifact scope"}
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 3 }}>
              {templateTitle
                ? <>{templateTitle}{" · "}</>
                : null}
              {lang === "es"
                ? "Elige expedientes y líneas (producto · talla · cantidad)."
                : "Pick expedientes and lines (product · size · qty)."}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <IconX size={14}/>
          </button>
        </div>

        {/* Body scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px",
                      display: "flex", flexDirection: "column", gap: 16 }}>
          {/* ── Sección 1 · Expedientes ─────────────────────── */}
          <div style={{
            border: "1px solid var(--border-subtle)", borderRadius: 12,
            padding: "14px 16px",
            background: "var(--surface-alt, rgba(11,30,58,0.02))",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="micro" style={{
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: "var(--text-secondary)", fontWeight: 700,
              }}>
                {lang === "es" ? "1. Expedientes" : "1. Expedientes"}
              </div>
              {selectedExpIds.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedExpIds([])}>
                  {lang === "es" ? "Limpiar" : "Clear"}
                </button>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              {expLoading ? (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es" ? "Cargando expedientes…" : "Loading…"}
                </div>
              ) : expError ? (
                <div className="body-sm" style={{ color: "var(--critical)" }}>{expError}</div>
              ) : expedientes.length === 0 ? (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es"
                    ? "No hay expedientes con inventario asignado a este nodo."
                    : "No expedientes with inventory allocated to this node."}
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {expedientes.map((e) => {
                    const on = selectedExpIds.includes(e.expediente_id);
                    return (
                      <button
                        type="button" key={e.expediente_id}
                        onClick={() => toggleExp(e.expediente_id)}
                        style={{
                          padding: "6px 12px", borderRadius: 999,
                          border: on
                            ? "1.5px solid var(--brand-accent, #0E8A6D)"
                            : "1px solid var(--border-subtle)",
                          background: on
                            ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 12%, transparent)"
                            : "white",
                          color: on
                            ? "var(--brand-accent, #0E8A6D)"
                            : "var(--text-primary)",
                          fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                          cursor: "pointer", transition: "all 0.15s",
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}
                      >
                        {on && <IconCheck size={11}/>}
                        <span className="mono-sm">{e.expediente_codigo}</span>
                        {(e.proforma_codigo || e.sap) && (
                          <span style={{ opacity: 0.7 }}>
                            · {e.proforma_codigo || e.sap}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Sección 2 · Líneas (producto, talla, qty) ─────── */}
          {selectedExpIds.length > 0 && (
            <div style={{
              border: "1px solid var(--border-subtle)", borderRadius: 12,
              padding: "14px 16px",
              background: "var(--surface-alt, rgba(11,30,58,0.02))",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="micro" style={{
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--text-secondary)", fontWeight: 700,
                }}>
                  {lang === "es" ? "2. Líneas (producto · talla · cantidad)" : "2. Lines (product · size · qty)"}
                </div>
                <button type="button" className="btn btn-ghost btn-sm"
                        onClick={reloadLines} disabled={linesLoading}>
                  <IconRefresh size={12}/>
                  {lang === "es" ? "Recargar" : "Reload"}
                </button>
              </div>

              {linesLoading ? (
                <div className="caption" style={{
                  color: "var(--text-tertiary)", marginTop: 10,
                }}>
                  {lang === "es" ? "Cargando líneas…" : "Loading lines…"}
                </div>
              ) : linesError ? (
                <div className="body-sm" style={{
                  color: "var(--critical)", marginTop: 10,
                }}>{linesError}</div>
              ) : grouped.length === 0 ? (
                <div className="caption" style={{
                  color: "var(--text-tertiary)", marginTop: 10,
                }}>
                  {lang === "es"
                    ? "Sin líneas disponibles en los expedientes seleccionados."
                    : "No available lines in the selected expedientes."}
                </div>
              ) : (
                grouped.map((g) => (
                  <ExpedienteBlock
                    key={g.expediente_id}
                    grupo={g}
                    rowState={rowState}
                    setInclude={setInclude}
                    setQty={setQty}
                    onIncludeAll={(on) => includeAllOfGroup(g.rows, on)}
                    lang={lang}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 22px", borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10,
        }}>
          <span className="caption tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {items.length} {lang === "es" ? "línea(s)" : "line(s)"} ·{" "}
            {items.reduce((a, it) => a + Number(it.qty || 0), 0).toLocaleString()} u
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
            <button type="button" className="btn btn-primary"
                    onClick={handleSubmit} disabled={!canSubmit}>
              <IconCheck size={13}/>
              {submitLabel
                || (lang === "es" ? "Siguiente — elegir plantilla" : "Next — pick template")}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────
// Sub-componente: bloque de líneas de un expediente
// ────────────────────────────────────────────────────────
function ExpedienteBlock({ grupo, rowState, setInclude, setQty,
                          onIncludeAll, lang }) {
  const allIncluded = grupo.rows.length > 0
    && grupo.rows.every((r) => rowState[keyOf(r)]?.include);
  const someIncluded = !allIncluded
    && grupo.rows.some((r) => rowState[keyOf(r)]?.include);

  return (
    <div style={{
      marginTop: 12,
      border: "1px solid var(--border-subtle)",
      borderRadius: 10, overflow: "hidden",
      background: "white",
    }}>
      <div style={{
        display: "flex", alignItems: "center",
        padding: "8px 12px",
        background: "var(--surface-alt, rgba(0,0,0,0.02))",
        borderBottom: "1px solid var(--border-subtle)",
        gap: 10,
      }}>
        <input
          type="checkbox"
          checked={allIncluded}
          ref={(el) => { if (el) el.indeterminate = someIncluded; }}
          onChange={(e) => onIncludeAll(e.target.checked)}
        />
        <span className="mono-sm" style={{
          fontWeight: 700, color: "var(--brand-primary)",
        }}>
          {grupo.expediente_codigo}
        </span>
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          · {grupo.rows.length} {lang === "es" ? "líneas" : "lines"}
        </span>
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th style={{ width: 130 }}>SKU</th>
            <th>{lang === "es" ? "Producto" : "Product"}</th>
            <th style={{ width: 80, textAlign: "center" }}>
              {lang === "es" ? "Talla" : "Size"}
            </th>
            <th style={{ width: 110, textAlign: "right" }}>
              {lang === "es" ? "Disponible" : "Available"}
            </th>
            <th style={{ width: 130, textAlign: "right" }}>
              {lang === "es" ? "A asignar" : "Assign"}
            </th>
          </tr>
        </thead>
        <tbody>
          {grupo.rows.map((r) => {
            const k = keyOf(r);
            const st = rowState[k] || { include: false, qty: r.qty_disponible };
            const max = Number(r.qty_disponible || 0);
            return (
              <tr key={k} style={st.include ? {
                background: "color-mix(in oklab, var(--brand-accent, #0E8A6D) 4%, transparent)",
              } : undefined}>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!st.include}
                    onChange={(e) => setInclude(k, e.target.checked)}
                  />
                </td>
                <td><span className="mono-sm" style={{ fontWeight: 600 }}>{r.sku}</span></td>
                <td>{r.nombre}</td>
                <td style={{ textAlign: "center" }}>
                  <span className="size-chip">{r.talla || "—"}</span>
                </td>
                <td className="td-num tabular-nums"
                    style={{ color: "var(--text-secondary)" }}>
                  {max}
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={max}
                    step={1}
                    value={st.qty ?? max}
                    disabled={!st.include}
                    onChange={(e) => setQty(k, e.target.value, max)}
                    style={{
                      width: 100, textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
