// ─────────────────────────────────────────────────────────────
// Step3TransferAssign — paso 3 del wizard /transferencias/nueva.
// Sprint 2026-05-13 · Fase 8 del paquete Nodos + Inventario.
//
// CEO (textual): "el paso 3 debe mostrarme los expedientes y proforma
// que tiene el nodo de origen. Puedo seleccionar más de uno, luego me
// aparecen los SKU, nombre, talla y cantidad por talla. Puedo
// seleccionar qué productos y cambiar la cantidad. Si todo va al
// destino, el expediente desaparece del origen; si solo va una parte,
// queda partido en dos nodos. Idéntico patrón a /inventario/recepcion."
//
// UX (mirror exacto de Step2ExpedientesAssign):
//   1. Card 1 · chips multi-select de expedientes con stock en origen.
//   2. Card 2 · por cada expediente, tabla:
//        ☐ · SKU · Nombre · Talla · Disp. en origen · A transferir
//      qty editable acotada a (0..qty_disponible_origen). Checkbox
//      controla "incluir en la transferencia".
//
// Reporta al padre vía onItemsChange un array enriquecido:
//   [{ expediente_id, producto_id, talla, qty,
//      _sku, _nombre, _expediente_codigo, _disponible_origen }]
// El submit del wizard filtra a campos canónicos antes de POST.
//
// Reglas MWT:
//   R1 · cero hex hardcodeados (tokens CSS).
//   R2 · props tipados via JSDoc.
//   R5 · tabular-nums en cantidades.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { IconCheck, IconRefresh } from "../../lib/icons.jsx";
import { nodoAssignmentsApi } from "../../lib/api.js";

/**
 * @typedef {Object} LineaEnNodo
 * @property {string} expediente_id
 * @property {string} expediente_codigo
 * @property {string|null} proforma_codigo
 * @property {string} producto_id
 * @property {string} sku
 * @property {string} nombre
 * @property {string|null} talla
 * @property {number} qty_disponible      qty en origen para esa (exp,prod,talla)
 */

export default function Step3TransferAssign({
  lang = "es",
  /** Nodo origen seleccionado en paso 1 — { id, codigo, nombre } */
  originNode,
  /** Nodo destino seleccionado en paso 1 — { id, codigo, nombre } */
  destinationNode,
  /** fn(items[]) — items enriquecidos para que el resumen del paso 4 los muestre */
  onItemsChange,
  /** fn(boolean) — habilita el botón "Siguiente" del wizard */
  onValidityChange,
}) {
  // ── Catálogo de líneas con stock en el nodo origen ──────────
  /** @type {[LineaEnNodo[], Function]} */
  const [lineas, setLineas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Set de expedientes seleccionados (chips) ────────────────
  const [selectedIds, setSelectedIds] = useState([]);

  // ── Estado por fila editable: state[key] = { include, qty } ─
  const [rowState, setRowState] = useState({});

  // ── Cargar líneas al cambiar el nodo origen ─────────────────
  const reload = useCallback(() => {
    if (!originNode?.id) {
      setLineas([]); setRowState({}); setLoading(false); return;
    }
    setLoading(true); setError(null);
    nodoAssignmentsApi.lineasEnNodo({ nodoId: originNode.id })
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        const filtered = arr.filter((r) => Number(r.qty_disponible || 0) > 0);
        setLineas(filtered);
        // Re-hidratar rowState preservando lo que el usuario marcó.
        setRowState((prev) => {
          const next = {};
          for (const r of filtered) {
            const k = keyOf(r);
            next[k] = prev[k] || {
              include: false,
              qty:     Number(r.qty_disponible || 0),
            };
          }
          return next;
        });
      })
      .catch((e) => setError(e?.message || "Error cargando líneas del nodo"))
      .finally(() => setLoading(false));
  }, [originNode?.id]);

  useEffect(() => { reload(); }, [reload]);

  // ── Expedientes únicos con stock (para los chips) ───────────
  const expedientesConStock = useMemo(() => {
    const map = new Map();
    for (const r of lineas) {
      if (!map.has(r.expediente_id)) {
        map.set(r.expediente_id, {
          id:               r.expediente_id,
          codigo:           r.expediente_codigo,
          proforma_codigo:  r.proforma_codigo,
          lines_count:      0,
          qty_total:        0,
        });
      }
      const e = map.get(r.expediente_id);
      e.lines_count += 1;
      e.qty_total   += Number(r.qty_disponible || 0);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(b.codigo || "").localeCompare(String(a.codigo || "")));
  }, [lineas]);

  // ── Líneas filtradas a los expedientes seleccionados ────────
  const lineasFiltradas = useMemo(() => {
    if (!selectedIds.length) return [];
    const setIds = new Set(selectedIds);
    return lineas.filter((r) => setIds.has(r.expediente_id));
  }, [lineas, selectedIds]);

  // Agrupado por expediente para el render.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of lineasFiltradas) {
      if (!map.has(r.expediente_id)) map.set(r.expediente_id, []);
      map.get(r.expediente_id).push(r);
    }
    return Array.from(map.entries()).map(([id, rows]) => ({
      expediente_id:    id,
      expediente_codigo: rows[0]?.expediente_codigo,
      proforma_codigo:   rows[0]?.proforma_codigo,
      rows,
    }));
  }, [lineasFiltradas]);

  // ── Reportar items + validez al padre ───────────────────────
  useEffect(() => {
    const items = lineasFiltradas
      .filter((r) => rowState[keyOf(r)]?.include)
      .map((r) => {
        const k   = keyOf(r);
        const max = Number(r.qty_disponible || 0);
        const qty = Math.max(0, Math.min(Number(rowState[k]?.qty || 0), max));
        return {
          // Canónicos para POST /transfer/.
          expediente_id: r.expediente_id,
          producto_id:   r.producto_id,
          talla:         r.talla || null,
          qty,
          // Metadata para resumen UI (paso 4 del wizard).
          _expediente_codigo: r.expediente_codigo,
          _proforma_codigo:   r.proforma_codigo,
          _sku:               r.sku,
          _nombre:            r.nombre,
          _disponible_origen: max,
        };
      })
      .filter((it) => it.qty > 0);

    onItemsChange?.(items);
    onValidityChange?.(items.length > 0);
  }, [rowState, lineasFiltradas, onItemsChange, onValidityChange]);

  // ── Helpers ────────────────────────────────────────────────
  const toggleExp = (expId) => {
    setSelectedIds((prev) => prev.includes(expId)
      ? prev.filter((x) => x !== expId)
      : [...prev, expId]);
  };
  const setInclude = (key, on) =>
    setRowState((p) => ({ ...p, [key]: { ...(p[key] || {}), include: !!on } }));
  const setQty = (key, q, max) => {
    const v = Math.max(0, Math.min(Number(q || 0), max));
    setRowState((p) => ({ ...p, [key]: { ...(p[key] || {}), qty: v } }));
  };
  const includeAllOfGroup = (rows, on) =>
    setRowState((p) => {
      const next = { ...p };
      for (const r of rows) {
        const k = keyOf(r);
        next[k] = { include: !!on, qty: Number(r.qty_disponible || 0) };
      }
      return next;
    });

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Card 1: chips de expedientes con stock en origen ── */}
      <div className="card">
        <div className="card-head" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div className="card-title">
              {lang === "es"
                ? "1. Selecciona los expedientes en origen"
                : "1. Select expedientes at origin"}
            </div>
            <div className="card-subtitle">
              {originNode
                ? <>{lang === "es" ? "Nodo origen: " : "Origin node: "}
                    <strong>{originNode.codigo} · {originNode.nombre}</strong>
                  </>
                : <span style={{ color: "var(--critical)" }}>
                    {lang === "es"
                      ? "Falta nodo origen en el paso 1."
                      : "Missing origin node in step 1."}
                  </span>}
              {" · "}
              {lang === "es"
                ? "Solo expedientes con stock asignado al nodo origen."
                : "Only expedientes with stock allocated at origin."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedIds([])}
                    disabled={!selectedIds.length}>
              {lang === "es" ? "Limpiar" : "Clear"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={reload} disabled={loading}>
              <IconRefresh size={13}/>
              {lang === "es" ? "Recargar" : "Reload"}
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 18px 16px" }}>
          {loading ? (
            <div className="caption" style={{ color: "var(--text-tertiary)" }}>
              {lang === "es" ? "Cargando expedientes…" : "Loading…"}
            </div>
          ) : error ? (
            <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
          ) : expedientesConStock.length === 0 ? (
            <div className="caption" style={{ color: "var(--text-tertiary)" }}>
              {lang === "es"
                ? "Sin expedientes con stock en este nodo."
                : "No expedientes with stock at this node."}
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {expedientesConStock.map((e) => {
                const on = selectedIds.includes(e.id);
                return (
                  <button key={e.id} type="button"
                          onClick={() => toggleExp(e.id)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: on
                              ? "1.5px solid var(--brand-accent, #0E8A6D)"
                              : "1px solid var(--border-subtle)",
                            background: on
                              ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 12%, transparent)"
                              : "var(--surface, white)",
                            color: on ? "var(--brand-accent, #0E8A6D)" : "var(--text-primary)",
                            fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                            cursor: "pointer", transition: "all 0.15s",
                            display: "inline-flex", alignItems: "center", gap: 6,
                          }}>
                    {on && <IconCheck size={11}/>}
                    <span className="mono-sm">{e.codigo}</span>
                    {e.proforma_codigo && (
                      <span style={{ opacity: 0.7 }}>· {e.proforma_codigo}</span>
                    )}
                    <span style={{
                      marginLeft: 6, opacity: 0.7, fontWeight: 600,
                    }} className="tabular-nums">
                      ({e.qty_total}u)
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Card 2: tabla por expediente ────────────────────── */}
      {selectedIds.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              {lang === "es"
                ? "2. Cantidad a transferir al destino"
                : "2. Quantity to transfer to destination"}
            </div>
            <div className="card-subtitle">
              {destinationNode
                ? <>{lang === "es" ? "Nodo destino: " : "Destination: "}
                    <strong>{destinationNode.codigo} · {destinationNode.nombre}</strong>
                  </>
                : <span style={{ color: "var(--critical)" }}>
                    {lang === "es"
                      ? "Falta nodo destino en el paso 1."
                      : "Missing destination in step 1."}
                  </span>}
              {" · "}
              {lang === "es"
                ? "Las líneas no marcadas quedarán en el origen."
                : "Unchecked lines stay at origin."}
            </div>
          </div>

          {grouped.map((g) => (
            <ExpedienteBlock
              key={g.expediente_id}
              grupo={g}
              rowState={rowState}
              setInclude={setInclude}
              setQty={setQty}
              onIncludeAll={(on) => includeAllOfGroup(g.rows, on)}
              lang={lang}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponente: bloque por expediente ──────────────────────
function ExpedienteBlock({ grupo, rowState, setInclude, setQty,
                          onIncludeAll, lang }) {
  const allIncluded  = grupo.rows.every((r) => rowState[keyOf(r)]?.include);
  const someIncluded = grupo.rows.some((r) => rowState[keyOf(r)]?.include);

  return (
    <div style={{ borderTop: "1px solid var(--divider, var(--border-subtle))" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 18px",
        background: "var(--surface-alt, rgba(0,0,0,0.02))",
      }}>
        <div className="flex ai-center gap-2">
          <input type="checkbox"
                 checked={allIncluded}
                 ref={(el) => { if (el) el.indeterminate = !allIncluded && someIncluded; }}
                 onChange={(e) => onIncludeAll(e.target.checked)}
                 title={lang === "es" ? "Seleccionar todo el expediente" : "Toggle all"}/>
          <span className="mono-sm" style={{ fontWeight: 700,
                                             color: "var(--brand-primary)" }}>
            {grupo.expediente_codigo}
          </span>
          {grupo.proforma_codigo && (
            <span className="caption" style={{ color: "var(--text-tertiary)" }}>
              · {grupo.proforma_codigo}
            </span>
          )}
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            · {grupo.rows.length} {lang === "es" ? "líneas" : "lines"}
          </span>
        </div>
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th style={{ width: 140 }}>SKU</th>
            <th>{lang === "es" ? "Nombre" : "Name"}</th>
            <th style={{ width: 90, textAlign: "center" }}>
              {lang === "es" ? "Talla" : "Size"}
            </th>
            <th style={{ width: 120, textAlign: "right" }}>
              {lang === "es" ? "Disp. origen" : "Avail. origin"}
            </th>
            <th style={{ width: 130, textAlign: "right" }}>
              {lang === "es" ? "A transferir" : "Transfer"}
            </th>
          </tr>
        </thead>
        <tbody>
          {grupo.rows.map((r) => {
            const k   = keyOf(r);
            const st  = rowState[k] || { include: false, qty: r.qty_disponible };
            const max = Number(r.qty_disponible || 0);
            return (
              <tr key={k} style={{
                background: st.include
                  ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 4%, transparent)"
                  : undefined,
              }}>
                <td>
                  <input type="checkbox"
                         checked={!!st.include}
                         onChange={(e) => setInclude(k, e.target.checked)}/>
                </td>
                <td>
                  <span className="mono-sm" style={{ fontWeight: 600 }}>{r.sku}</span>
                </td>
                <td>{r.nombre}</td>
                <td style={{ textAlign: "center" }}>
                  <span className="size-chip">{r.talla || "—"}</span>
                </td>
                <td className="td-num tabular-nums"
                    style={{ color: "var(--text-secondary)" }}>
                  {max}
                </td>
                <td className="td-num" style={{ textAlign: "right" }}>
                  <input type="number" className="input"
                         style={{ width: 100, textAlign: "right",
                                  fontVariantNumeric: "tabular-nums" }}
                         min={0} max={max} step={1}
                         value={st.qty ?? max}
                         disabled={!st.include}
                         onChange={(e) => setQty(k, e.target.value, max)}/>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Clave única por (expediente, producto, talla).
function keyOf(r) {
  return `${r.expediente_id}::${r.producto_id}::${r.talla || ""}`;
}
