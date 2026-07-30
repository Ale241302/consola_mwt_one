// ─────────────────────────────────────────────────────────────
// Step2ExpedientesAssign — paso 2 del wizard de recepción cuando
// sourceType === "EXPEDIENTE_ASSIGN".
// Sprint 2026-05-11 · Fase 3.
//
// UX:
//   1. Selector multi-expediente (chips · sólo expedientes del cliente
//      activos · ordenados por código DESC para que aparezca primero el
//      más reciente).
//   2. Por cada expediente seleccionado, tabla con:
//        ☐ Expediente · SKU · Nombre · Talla · Pendiente · A asignar
//      "Pendiente" = qty_total de la línea menos lo ya asignado a otros
//      nodos. Si la fila tiene `qty_pendiente === 0` se oculta — esa fila
//      ya está completamente repartida entre nodos.
//   3. Cantidad editable (input number, 1..qty_pendiente). El checkbox
//      controla "incluir esta fila en la asignación final".
//
// Devuelve al wizard padre (via onChange) el array de items listos para
// el bulk insert:
//   [{ expediente_id, producto_id, talla, qty_asignada }]
//
// Reglas MWT:
//   R1 · cero hex hardcodeados (usa tokens CSS).
//   R2 · todos los props tipados via JSDoc.
//   R5 · tabular-nums para cantidades.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { IconCheck, IconX, IconRefresh } from "../../lib/icons.jsx";
import { nodoAssignmentsApi, expedientesApi } from "../../lib/api.js";

/**
 * Sprint 2026-05-11 fix · El paso 2 ofrecía expedientes que ya estaban
 * 100% repartidos entre nodos (qty_pendiente = 0 en cada línea). Click
 * en esos chips abría una tabla vacía. Fix: cruzar la lista de
 * expedientes con el set de IDs que devuelve
 * /inventario/expedientes-with-pending/ y filtrar los que NO aparecen.
 */

/**
 * @typedef {Object} SaldoRow
 * @property {string} expediente_id
 * @property {string} expediente_codigo
 * @property {string} producto_id
 * @property {string} sku
 * @property {string} nombre
 * @property {string|null} talla
 * @property {number} qty_total
 * @property {number} qty_asignada_total
 * @property {number} qty_asignada_a_este_nodo
 * @property {number} qty_pendiente
 */

export default function Step2ExpedientesAssign({
  lang = "es",
  destinationNode,           // { id, codigo, nombre }
  onItemsChange,             // fn(items[]) → notifica al padre cuál es el payload listo
  onValidityChange,          // fn(bool)    → habilita el botón "Siguiente"
}) {
  // ── Lista de expedientes para escoger ─────────────────────────
  const [expedientes, setExpedientes] = useState([]);
  const [expLoading, setExpLoading]   = useState(true);
  const [expError, setExpError]       = useState(null);

  // ── Selección actual del usuario (chips activos) ──────────────
  const [selectedIds, setSelectedIds] = useState([]);

  // ── Saldos cargados desde el backend (1 fetch por cambio de set) ─
  /** @type {[SaldoRow[], Function]} */
  const [saldos, setSaldos] = useState([]);
  const [saldosLoading, setSaldosLoading] = useState(false);
  const [saldosError, setSaldosError]     = useState(null);

  // ── Estado por fila editable (key = exp+prod+talla) ──────────
  // state[key] = { include: bool, qty: int }
  const [rowState, setRowState] = useState({});

  // ── Fetch lista de expedientes ────────────────────────────────
  // Sprint 2026-05-11 fix · combinamos dos endpoints:
  //   1. expedientesApi.list — todos los activos.
  //   2. nodoAssignmentsApi.expedientesWithPending — set de IDs que aún
  //      tienen alguna (producto, talla) con qty_pendiente > 0.
  // Mostramos sólo la intersección. Si el endpoint de filtro falla
  // (caso degradado), caemos a mostrar todos (más permisivo que ocultar).
  useEffect(() => {
    let cancel = false;
    setExpLoading(true); setExpError(null);
    Promise.all([
      expedientesApi.list({ is_active: true }),
      nodoAssignmentsApi.expedientesWithPending().catch(() => null),
    ])
      .then(([listData, pendingData]) => {
        if (cancel) return;
        const arr = Array.isArray(listData)
          ? listData
          : (listData?.results || []);
        // Solo expedientes con código no nulo (ignoramos OCs huérfanas).
        let filtered = arr.filter((e) => e?.codigo);

        // Aplicamos el filtro de pendiente si el endpoint respondió OK.
        if (pendingData && Array.isArray(pendingData.expediente_ids)) {
          const pendingSet = new Set(pendingData.expediente_ids);
          // Caso edge: si el endpoint devuelve [] (todos asignados) y la
          // lista de expedientes tiene varios, ocultamos todos. Eso es
          // intencional — no hay nada que asignar a este nodo.
          filtered = filtered.filter((e) => pendingSet.has(String(e.id)));
        }

        // Orden DESC por updated_at o created_at para que aparezca primero
        // el más reciente — el operador rara vez asigna expedientes viejos.
        filtered.sort((a, b) =>
          String(b.updated_at || b.created_at || "")
            .localeCompare(String(a.updated_at || a.created_at || "")),
        );
        setExpedientes(filtered);
      })
      .catch((e) => setExpError(e?.message || "Error cargando expedientes"))
      .finally(() => { if (!cancel) setExpLoading(false); });
    return () => { cancel = true; };
  }, []);

  // ── Cuando cambia la selección, refrescar saldos ──────────────
  const reloadSaldos = useCallback(() => {
    if (!selectedIds.length || !destinationNode?.id) {
      setSaldos([]); setRowState({}); return;
    }
    setSaldosLoading(true); setSaldosError(null);
    nodoAssignmentsApi.saldosPorExpediente({
      expedienteIds: selectedIds,
      nodoId: destinationNode.id,
    })
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        // Filtramos sólo filas con pendiente > 0 — las completamente
        // repartidas ya no se ofrecen.
        const filtered = arr.filter((r) => Number(r.qty_pendiente || 0) > 0);
        setSaldos(filtered);
        // Re-hidratar rowState manteniendo lo que el usuario ya marcó.
        setRowState((prev) => {
          const next = {};
          for (const r of filtered) {
            const k = keyOf(r);
            next[k] = prev[k] || {
              include: false,
              qty: Number(r.qty_pendiente || 0),
            };
          }
          return next;
        });
      })
      .catch((e) => setSaldosError(e?.message || "Error cargando saldos"))
      .finally(() => setSaldosLoading(false));
  }, [selectedIds, destinationNode?.id]);

  useEffect(() => { reloadSaldos(); }, [reloadSaldos]);

  // ── Cuando cambian rowState/saldos, recalcular items+validity ──
  // Reportamos items **enriquecidos** (sku, nombre, expediente_codigo)
  // para que el paso 3 del wizard pueda renderizar un resumen humano sin
  // tener que volver al backend. El submit del wizard se encarga de
  // descartar esos campos extra antes de mandar el payload limpio al
  // endpoint /nodo-assignments/bulk/.
  useEffect(() => {
    const items = saldos
      .filter((r) => rowState[keyOf(r)]?.include)
      .map((r) => {
        const k = keyOf(r);
        const qty = Math.max(
          0,
          Math.min(Number(rowState[k]?.qty || 0), Number(r.qty_pendiente || 0)),
        );
        return {
          // Campos canónicos para el backend.
          expediente_id: r.expediente_id,
          producto_id:   r.producto_id,
          talla:         r.talla || null,
          nodo_id:       destinationNode?.id,
          qty_asignada:  qty,
          // ── Metadata para UI (paso 3 del wizard) ──
          _expediente_codigo: r.expediente_codigo,
          _sku:               r.sku,
          _nombre:            r.nombre,
        };
      })
      .filter((it) => it.qty_asignada > 0);

    onItemsChange?.(items);
    onValidityChange?.(items.length > 0);
  }, [rowState, saldos, destinationNode?.id, onItemsChange, onValidityChange]);

  // ── Helpers ─────────────────────────────────────────────────
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

  // ── Agrupar saldos por expediente para mejor lectura ─────────
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of saldos) {
      if (!map.has(r.expediente_id)) map.set(r.expediente_id, []);
      map.get(r.expediente_id).push(r);
    }
    return Array.from(map.entries()).map(([id, rows]) => ({
      expediente_id: id,
      expediente_codigo: rows[0]?.expediente_codigo,
      rows,
    }));
  }, [saldos]);

  // Acciones masivas por grupo (todo / nada).
  const includeAllOfGroup = (rows, on) =>
    setRowState((p) => {
      const next = { ...p };
      for (const r of rows) {
        const k = keyOf(r);
        next[k] = { include: !!on, qty: Number(r.qty_pendiente || 0) };
      }
      return next;
    });

  // ── Render ──────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Card 1: selector de expedientes ─────────────────── */}
      <div className="card">
        <div className="card-head" style={{ display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center" }}>
          <div>
            <div className="card-title">
              {lang === "es"
                ? "1. Selecciona los expedientes"
                : "1. Select expedientes"}
            </div>
            <div className="card-subtitle">
              {lang === "es"
                ? "Puedes asignar productos de uno o más expedientes al mismo nodo."
                : "You can assign products from one or more expedientes to the same node."}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedIds([])}
                  disabled={!selectedIds.length}>
            {lang === "es" ? "Limpiar" : "Clear"}
          </button>
        </div>
        <div style={{ padding: "12px 18px 16px" }}>
          {expLoading ? (
            <div className="caption" style={{ color: "var(--text-tertiary)" }}>
              {lang === "es" ? "Cargando expedientes…" : "Loading…"}
            </div>
          ) : expError ? (
            <div className="body-sm" style={{ color: "var(--critical)" }}>{expError}</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {expedientes.map((e) => {
                const on = selectedIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
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
                    }}
                  >
                    {on && <IconCheck size={11}/>}
                    <span className="mono-sm">{e.codigo}</span>
                    {/* Sprint 2026-05-11 fix · CEO prefiere ver la
                        proforma antes que el SAP — la proforma está más
                        a mano en la operación diaria. Caemos a SAP solo
                        si el expediente todavía no tiene proforma asignada.
                        El backend serializa el campo como `proforma_codigo`
                        (no `proforma`) — viene de un JOIN al endpoint de
                        proformas. Mantenemos los dos alias por compat. */}
                    {(e.proforma_codigo || e.proforma || e.sap) && (
                      <span style={{ opacity: 0.7 }}>
                        · {e.proforma_codigo || e.proforma || e.sap}
                      </span>
                    )}
                  </button>
                );
              })}
              {expedientes.length === 0 && (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es"
                    ? "No hay expedientes activos."
                    : "No active expedientes."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Card 2: tabla por expediente ─────────────────────── */}
      {selectedIds.length > 0 && (
        <div className="card">
          <div className="card-head" style={{ display: "flex",
                                              justifyContent: "space-between",
                                              alignItems: "center" }}>
            <div>
              <div className="card-title">
                {lang === "es"
                  ? "2. Asigna cantidades al nodo"
                  : "2. Assign quantities to node"}
              </div>
              <div className="card-subtitle">
                {destinationNode
                  ? <>{lang === "es" ? "Nodo destino: " : "Destination node: "}
                     <strong>{destinationNode.codigo} · {destinationNode.nombre}</strong></>
                  : <span style={{ color: "var(--critical)" }}>
                      {lang === "es"
                        ? "Falta nodo destino en el paso 1."
                        : "Missing destination node in step 1."}
                    </span>}
                {" · "}
                {lang === "es"
                  ? "Solo se muestran productos con cantidad pendiente por asignar."
                  : "Only products with pending quantity are shown."}
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={reloadSaldos} disabled={saldosLoading}>
              <IconRefresh size={13}/>
              {lang === "es" ? "Recargar" : "Reload"}
            </button>
          </div>

          {saldosLoading ? (
            <div style={{ padding: "24px 18px" }} className="caption">
              {lang === "es" ? "Cargando saldos…" : "Loading balances…"}
            </div>
          ) : saldosError ? (
            <div className="body-sm"
                 style={{ padding: "18px", color: "var(--critical)" }}>
              {saldosError}
            </div>
          ) : grouped.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center" }}>
              <div className="body-sm" style={{ color: "var(--text-secondary)" }}>
                {lang === "es"
                  ? "Sin pendientes — todos los productos de los expedientes seleccionados ya están repartidos entre nodos."
                  : "Nothing pending — all products from selected expedientes are already allocated."}
              </div>
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
  );
}

// ── Subcomponente: bloque por expediente ───────────────────────
function ExpedienteBlock({ grupo, rowState, setInclude, setQty,
                          onIncludeAll, lang }) {
  const allIncluded = grupo.rows.every((r) => rowState[keyOf(r)]?.include);
  const someIncluded = grupo.rows.some((r) => rowState[keyOf(r)]?.include);

  return (
    <div style={{ borderTop: "1px solid var(--divider, var(--border-subtle))" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 18px",
        background: "var(--surface-alt, rgba(0,0,0,0.02))",
      }}>
        <div className="flex ai-center gap-2">
          <input
            type="checkbox"
            checked={allIncluded}
            ref={(el) => {
              if (el) el.indeterminate = !allIncluded && someIncluded;
            }}
            onChange={(e) => onIncludeAll(e.target.checked)}
            title={lang === "es" ? "Seleccionar todo el expediente" : "Toggle all"}
          />
          <span className="mono-sm" style={{ fontWeight: 700,
                                             color: "var(--brand-primary)" }}>
            {grupo.expediente_codigo}
          </span>
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {/* Sprint 2026-07-30 (CEO) · SKUs distintos, no filas
                (varias tallas del mismo SKU = 1 línea). */}
            · {new Set(grupo.rows.map((r) => String(r.sku || r.producto_id || keyOf(r)))).size} {lang === "es" ? "líneas" : "lines"}
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
            <th style={{ width: 110, textAlign: "right" }}>
              {lang === "es" ? "Pendiente" : "Pending"}
            </th>
            <th style={{ width: 130, textAlign: "right" }}>
              {lang === "es" ? "A asignar" : "Assign"}
            </th>
          </tr>
        </thead>
        <tbody>
          {grupo.rows.map((r) => {
            const k = keyOf(r);
            const st = rowState[k] || { include: false, qty: r.qty_pendiente };
            const max = Number(r.qty_pendiente || 0);
            return (
              <tr key={k} style={{
                background: st.include
                  ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 4%, transparent)"
                  : undefined,
              }}>
                <td>
                  <input
                    type="checkbox"
                    checked={!!st.include}
                    onChange={(e) => setInclude(k, e.target.checked)}
                  />
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
                  <input
                    type="number"
                    className="input"
                    style={{
                      width: 100, textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                    min={0}
                    max={max}
                    step={1}
                    value={st.qty ?? max}
                    disabled={!st.include}
                    onChange={(e) => setQty(k, e.target.value, max)}
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

// Clave única por fila — el grupo (expediente, producto, talla) define la
// asignación. La talla puede ser null/'' → la normalizamos a string vacío.
function keyOf(r) {
  return `${r.expediente_id}::${r.producto_id}::${r.talla || ""}`;
}
