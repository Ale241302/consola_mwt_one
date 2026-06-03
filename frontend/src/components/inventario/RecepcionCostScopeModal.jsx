// ─────────────────────────────────────────────────────────────
// RecepcionCostScopeModal — picker de alcance para una línea de
// costo de la RECEPCIÓN de inventario. Sprint 2026-06-02.
//
// Réplica funcional del CostScopeModal de /transferencias/nueva, pero
// adaptado a la recepción:
//   · Flow legacy (SUPPLIER_PO / manual): el alcance se restringe a
//     LÍNEAS (producto + talla) del lote recibido — no hay expedientes.
//   · Flow EXPEDIENTE_ASSIGN: el alcance se agrupa por expediente y,
//     dentro de cada uno, por línea (producto + talla).
//
// scope_json shape (idéntico a transfers.cost_line.scope_json):
//   null                                              → aplica a todo
//   { applies_to_all:false, lines:[{producto_id,talla,expediente_id?}] }
//   { applies_to_all:false, expediente_ids:[...] }    → todas las líneas
//                                                       de esos expedientes
//
// Reglas MWT: R1 tokens, R5 tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { IconCheck, IconX } from "../../lib/icons.jsx";

// Llave única por línea. expediente_id puede ser "" en el flow legacy.
function lineKey(l) {
  return `${l.expediente_id || ""}::${l.producto_id || l.sku || ""}::${l.talla || ""}`;
}

export default function RecepcionCostScopeModal({
  open,
  onClose,
  onSave,
  lang = "es",
  /** Texto a mostrar como subtitle (kind o label del costo). */
  costLabel = "",
  /** Líneas del lote normalizadas: [{expediente_id?, expediente_codigo?,
   *  producto_id, sku, nombre, talla, qty}] */
  items = [],
  /** Scope actual (null = nuevo o "aplica a todo"). */
  initialScope = null,
  /** true → agrupa por expediente (flow EXPEDIENTE_ASSIGN). */
  groupByExpediente = false,
}) {
  const [mode, setMode] = useState("all");
  const [selExpIds, setSelExpIds] = useState([]);
  const [selLineKeys, setSelLineKeys] = useState({});

  // Expedientes únicos derivados de items (solo flow assign).
  const expedientes = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const eid = it.expediente_id || "";
      if (!map.has(eid)) {
        map.set(eid, { id: eid, codigo: it.expediente_codigo || "—", lines: [] });
      }
      map.get(eid).lines.push(it);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.codigo || "").localeCompare(String(b.codigo || "")));
  }, [items]);

  // Hidratar desde initialScope al abrir.
  useEffect(() => {
    if (!open) return;
    if (!initialScope || initialScope.applies_to_all === true) {
      setMode("all"); setSelExpIds([]); setSelLineKeys({});
      return;
    }
    setMode("specific");
    const ids = Array.isArray(initialScope.expediente_ids) ? initialScope.expediente_ids : [];
    setSelExpIds(ids);
    if (Array.isArray(initialScope.lines) && initialScope.lines.length > 0) {
      const k = {};
      for (const l of initialScope.lines) k[lineKey(l)] = true;
      setSelLineKeys(k);
    } else if (groupByExpediente) {
      const k = {}; const setIds = new Set(ids);
      for (const it of items) if (setIds.has(it.expediente_id || "")) k[lineKey(it)] = true;
      setSelLineKeys(k);
    } else {
      const k = {}; for (const it of items) k[lineKey(it)] = true;
      setSelLineKeys(k);
    }
  }, [open, initialScope, items, groupByExpediente]);

  // Al pasar a "specific" en flow plano (legacy), marcar todas las líneas.
  useEffect(() => {
    if (mode !== "specific" || groupByExpediente) return;
    setSelLineKeys((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const k = {}; for (const it of items) k[lineKey(it)] = true;
      return k;
    });
  }, [mode, groupByExpediente, items]);

  // Auto-check de líneas al seleccionar expediente (flow assign).
  useEffect(() => {
    if (mode !== "specific" || !groupByExpediente) return;
    setSelLineKeys((prev) => {
      const next = { ...prev };
      const setIds = new Set(selExpIds);
      for (const it of items) {
        const k = lineKey(it);
        if (setIds.has(it.expediente_id || "") && next[k] === undefined) next[k] = true;
      }
      for (const k of Object.keys(next)) {
        const expId = k.split("::")[0];
        if (!setIds.has(expId)) delete next[k];
      }
      return next;
    });
  }, [selExpIds, mode, groupByExpediente, items]);

  const toggleExp = (id) =>
    setSelExpIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleLine = (k) => setSelLineKeys((p) => ({ ...p, [k]: !p[k] }));
  const toggleAllExpLines = (expId, on) => setSelLineKeys((p) => {
    const next = { ...p };
    for (const it of items) if ((it.expediente_id || "") === expId) next[lineKey(it)] = !!on;
    return next;
  });

  // Líneas visibles para el flow plano (legacy).
  const flatLines = items;

  // ¿Todas las líneas (en alcance) están marcadas?
  const { totalSel, totalPos } = useMemo(() => {
    let sel = 0, pos = 0;
    const setIds = new Set(selExpIds);
    for (const it of items) {
      if (groupByExpediente && !setIds.has(it.expediente_id || "")) continue;
      pos += 1;
      if (selLineKeys[lineKey(it)]) sel += 1;
    }
    return { totalSel: sel, totalPos: pos };
  }, [items, selLineKeys, selExpIds, groupByExpediente]);
  const allLinesChecked = totalPos > 0 && totalSel === totalPos;

  const handleSave = () => {
    if (mode === "all") { onSave?.(null); onClose?.(); return; }
    const scope = { applies_to_all: false };
    if (groupByExpediente) scope.expediente_ids = selExpIds.slice();
    if (!allLinesChecked) {
      const lines = [];
      for (const it of items) {
        if (groupByExpediente && !selExpIds.includes(it.expediente_id || "")) continue;
        if (selLineKeys[lineKey(it)]) {
          lines.push({
            expediente_id: it.expediente_id || null,
            producto_id:   it.producto_id || null,
            talla:         it.talla || "",
          });
        }
      }
      scope.lines = lines;
    }
    onSave?.(scope);
    onClose?.();
  };

  const canSave = mode === "all" || totalSel > 0;

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.32)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface, #fff)", borderRadius: 14,
        width: "min(820px, 100%)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
      }}>
        <div style={{
          padding: "16px 22px", borderBottom: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.6 }}>
              {lang === "es" ? "ALCANCE DEL COSTO" : "COST SCOPE"}
            </div>
            <h3 className="heading-md" style={{ marginTop: 2 }}>
              {costLabel || (lang === "es" ? "¿A qué se aplica este costo?" : "What does this cost apply to?")}
            </h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><IconX size={13}/></button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto" }}>
          <ModeRadio
            value={mode} onChange={setMode}
            options={[
              { id: "all",
                title: lang === "es" ? "Aplicar a TODO el lote" : "Apply to whole batch",
                desc:  lang === "es"
                  ? "El costo se prorratea sobre todas las líneas del lote recibido."
                  : "Cost is prorated across all received lines." },
              { id: "specific",
                title: lang === "es"
                  ? (groupByExpediente
                      ? "Restringir a expedientes / líneas específicas"
                      : "Restringir a líneas específicas")
                  : "Restrict to specific lines",
                desc:  lang === "es"
                  ? "Elige las líneas a las que aplica; se prorratea solo entre ellas."
                  : "Pick the lines it applies to; prorated only across them." },
            ]}
          />

          {mode === "specific" && groupByExpediente && (
            <>
              <div style={{ marginTop: 18 }}>
                <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8 }}>
                  {lang === "es" ? "1. EXPEDIENTES" : "1. EXPEDIENTES"}
                </div>
                {expedientes.length === 0 ? (
                  <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                    {lang === "es" ? "Sin expedientes en el paso 2." : "No expedientes in step 2."}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {expedientes.map((e) => {
                      const on = selExpIds.includes(e.id);
                      return (
                        <button key={e.id} type="button" onClick={() => toggleExp(e.id)}
                                style={{
                                  padding: "6px 12px", borderRadius: 999,
                                  border: on ? "1.5px solid var(--brand-accent, #0E8A6D)" : "1px solid var(--border-subtle)",
                                  background: on ? "rgba(14,138,109,0.12)" : "var(--surface, white)",
                                  color: on ? "var(--brand-accent, #0E8A6D)" : "var(--text-primary)",
                                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                }}>
                          {on && <IconCheck size={11}/>}
                          <span className="mono-sm">{e.codigo}</span>
                          <span style={{ marginLeft: 4, opacity: 0.7 }}>({e.lines.length})</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {selExpIds.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="micro" style={{
                    color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>{lang === "es" ? "2. LÍNEAS" : "2. LINES"}</span>
                    <span className="caption" style={{ textTransform: "none" }}>
                      {totalSel} / {totalPos} {lang === "es" ? "líneas" : "lines"}
                    </span>
                  </div>
                  {expedientes.filter((e) => selExpIds.includes(e.id)).map((e) => (
                    <LinesBlock key={e.id} exp={e} selLineKeys={selLineKeys}
                                toggleLine={toggleLine}
                                onSelectAll={(on) => toggleAllExpLines(e.id, on)}
                                lang={lang}/>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "specific" && !groupByExpediente && (
            <div style={{ marginTop: 18 }}>
              <div className="micro" style={{
                color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>{lang === "es" ? "LÍNEAS DEL LOTE" : "BATCH LINES"}</span>
                <span className="caption" style={{ textTransform: "none" }}>
                  {totalSel} / {totalPos} {lang === "es" ? "líneas" : "lines"}
                </span>
              </div>
              {flatLines.length === 0 ? (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es"
                    ? "Sin líneas en el paso 2 (Reconciliación)."
                    : "No lines in step 2 (Reconcile)."}
                </div>
              ) : (
                <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
                  <table className="table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}/>
                        <th style={{ width: 140 }}>SKU</th>
                        <th>{lang === "es" ? "Nombre" : "Name"}</th>
                        <th style={{ width: 70, textAlign: "center" }}>{lang === "es" ? "Talla" : "Size"}</th>
                        <th style={{ width: 70, textAlign: "right" }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatLines.map((it) => {
                        const k = lineKey(it);
                        const on = !!selLineKeys[k];
                        return (
                          <tr key={k} style={{ background: on ? "rgba(14,138,109,0.05)" : undefined }}>
                            <td><input type="checkbox" checked={on} onChange={() => toggleLine(k)}/></td>
                            <td><span className="mono-sm" style={{ fontWeight: 600 }}>{it.sku || "—"}</span></td>
                            <td>{it.nombre || "—"}</td>
                            <td style={{ textAlign: "center" }}>{it.talla || "—"}</td>
                            <td className="tabular-nums" style={{ textAlign: "right" }}>{it.qty}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{
          padding: "12px 22px", borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "flex-end", gap: 10,
        }}>
          <button className="btn btn-ghost" onClick={onClose}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button className="btn btn-accent" onClick={handleSave} disabled={!canSave}>
            <IconCheck size={12}/> {lang === "es" ? "Guardar alcance" : "Save scope"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeRadio({ value, onChange, options }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <label key={o.id} style={{
            display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px",
            borderRadius: 10,
            border: on ? "1.5px solid var(--brand-accent, #0E8A6D)" : "1px solid var(--border-subtle)",
            background: on ? "rgba(14,138,109,0.06)" : "var(--surface, white)",
            cursor: "pointer", transition: "all 0.15s",
          }}>
            <input type="radio" checked={on} onChange={() => onChange(o.id)} style={{ marginTop: 3 }}/>
            <div>
              <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13 }}>{o.title}</div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>{o.desc}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function LinesBlock({ exp, selLineKeys, toggleLine, onSelectAll, lang }) {
  const all = exp.lines.every((it) => selLineKeys[lineKey(it)]);
  const some = exp.lines.some((it) => selLineKeys[lineKey(it)]);
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        background: "var(--surface-alt, rgba(0,0,0,0.02))",
      }}>
        <input type="checkbox" checked={all}
               ref={(el) => { if (el) el.indeterminate = !all && some; }}
               onChange={(e) => onSelectAll(e.target.checked)}/>
        <span className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary)" }}>{exp.codigo}</span>
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          · {exp.lines.length} {lang === "es" ? "líneas" : "lines"}
        </span>
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}/>
            <th style={{ width: 130 }}>SKU</th>
            <th>{lang === "es" ? "Nombre" : "Name"}</th>
            <th style={{ width: 70, textAlign: "center" }}>{lang === "es" ? "Talla" : "Size"}</th>
            <th style={{ width: 70, textAlign: "right" }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {exp.lines.map((it) => {
            const k = lineKey(it);
            const on = !!selLineKeys[k];
            return (
              <tr key={k} style={{ background: on ? "rgba(14,138,109,0.05)" : undefined }}>
                <td><input type="checkbox" checked={on} onChange={() => toggleLine(k)}/></td>
                <td><span className="mono-sm" style={{ fontWeight: 600 }}>{it.sku || "—"}</span></td>
                <td>{it.nombre || "—"}</td>
                <td style={{ textAlign: "center" }}>{it.talla || "—"}</td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>{it.qty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
