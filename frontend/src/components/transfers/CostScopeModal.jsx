// ─────────────────────────────────────────────────────────────
// CostScopeModal — picker de alcance para una cost-line de
// transferencia. Sprint 2026-05-13 · Fase 9.
//
// CEO (textual): "cuando registre un costo me debe preguntar para qué
// expediente o expedientes seleccionados en el paso de productos se le
// va a registrar ese costo, o incluso puede ir asociado a algunos
// productos seleccionados del expediente o a todos los productos."
//
// Estructura:
//   1. Radio: "Aplicar a todos" vs "Restringir a..."
//   2. Si restringir:
//        a) Chips de expedientes (los que ya están en transferItems).
//        b) Si el usuario selecciona "Solo algunas líneas", aparece la
//           tabla de líneas filtradas a esos expedientes con checkboxes.
//   3. Save → devuelve scope_json al padre via onSave(scope).
//
// scope_json shape:
//   null                                     → aplica a todo
//   {"applies_to_all": true}                 → idem
//   {"applies_to_all": false,
//    "expediente_ids": ["uuid",...]}         → restringido a expedientes
//   {"applies_to_all": false,
//    "expediente_ids": [...],
//    "lines": [{"expediente_id","producto_id","talla"}, ...]}  → líneas
//
// Reglas MWT: R1 tokens, R5 tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { IconCheck, IconX } from "../../lib/icons.jsx";

/**
 * @typedef {Object} TransferItem
 * @property {string} expediente_id
 * @property {string} _expediente_codigo
 * @property {string|null} _proforma_codigo
 * @property {string} producto_id
 * @property {string} _sku
 * @property {string} _nombre
 * @property {string|null} talla
 * @property {number} qty
 */

export default function CostScopeModal({
  open,
  onClose,
  onSave,
  lang = "es",
  /** Cost-line en edición — solo para el título. */
  costLabel = "",
  /** Items seleccionados en el paso 2 (Productos). */
  transferItems = [],
  /** Scope actual del cost-line (puede ser null). */
  initialScope = null,
}) {
  // ── Modo: 'all' | 'expedientes' | 'lines' ────────────────────
  const [mode, setMode] = useState("all");
  const [selExpIds, setSelExpIds] = useState([]);
  const [selLineKeys, setSelLineKeys] = useState({});

  // ── Hidratar desde initialScope cuando se abre ───────────────
  useEffect(() => {
    if (!open) return;
    if (!initialScope || initialScope.applies_to_all === true) {
      setMode("all");
      setSelExpIds([]);
      setSelLineKeys({});
      return;
    }
    const ids = Array.isArray(initialScope.expediente_ids)
      ? initialScope.expediente_ids
      : [];
    setSelExpIds(ids);
    if (Array.isArray(initialScope.lines) && initialScope.lines.length > 0) {
      setMode("lines");
      const k = {};
      for (const l of initialScope.lines) {
        k[lineKey(l)] = true;
      }
      setSelLineKeys(k);
    } else {
      setMode("expedientes");
      setSelLineKeys({});
    }
  }, [open, initialScope]);

  // ── Expedientes únicos derivados de transferItems ────────────
  const expedientes = useMemo(() => {
    const map = new Map();
    for (const it of transferItems) {
      if (!map.has(it.expediente_id)) {
        map.set(it.expediente_id, {
          id:               it.expediente_id,
          codigo:           it._expediente_codigo,
          proforma_codigo:  it._proforma_codigo,
          lines:            [],
        });
      }
      map.get(it.expediente_id).lines.push(it);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.codigo || "").localeCompare(String(b.codigo || "")));
  }, [transferItems]);

  // Líneas filtradas a los expedientes seleccionados (para el modo 'lines').
  const lineasFiltradas = useMemo(() => {
    if (mode !== "lines" || selExpIds.length === 0) return [];
    const setIds = new Set(selExpIds);
    return transferItems.filter((it) => setIds.has(it.expediente_id));
  }, [transferItems, selExpIds, mode]);

  // ── Helpers ─────────────────────────────────────────────────
  const toggleExp = (id) => {
    setSelExpIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  };
  const toggleLine = (k) =>
    setSelLineKeys((p) => ({ ...p, [k]: !p[k] }));
  const toggleAllExpLines = (expId, on) => {
    setSelLineKeys((p) => {
      const next = { ...p };
      for (const it of transferItems) {
        if (it.expediente_id === expId) {
          next[lineKey(it)] = !!on;
        }
      }
      return next;
    });
  };

  // ── Guardar ─────────────────────────────────────────────────
  const handleSave = () => {
    if (mode === "all") {
      onSave?.(null);  // null = aplica a todo el batch
      onClose?.();
      return;
    }
    const scope = {
      applies_to_all: false,
      expediente_ids: selExpIds.slice(),
    };
    if (mode === "lines") {
      const lines = [];
      for (const it of transferItems) {
        const k = lineKey(it);
        if (selLineKeys[k] && selExpIds.includes(it.expediente_id)) {
          lines.push({
            expediente_id: it.expediente_id,
            producto_id:   it.producto_id,
            talla:         it.talla || "",
          });
        }
      }
      scope.lines = lines;
    }
    onSave?.(scope);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" style={{
      position: "fixed", inset: 0, zIndex: 60,
      background: "rgba(0,0,0,0.32)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
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
              {costLabel || (lang === "es" ? "Aplicar costo a..." : "Apply cost to...")}
            </h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <IconX size={13}/>
          </button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto" }}>
          {/* Modo */}
          <ModeRadio
            value={mode} onChange={setMode}
            options={[
              { id: "all",
                title: lang === "es" ? "Aplicar a TODA la transferencia" : "Apply to whole transfer",
                desc:  lang === "es"
                  ? "El costo se prorratea sobre todas las líneas del batch."
                  : "Cost is prorated across all lines in the batch." },
              { id: "expedientes",
                title: lang === "es" ? "Solo a algunos EXPEDIENTES" : "Only some EXPEDIENTES",
                desc:  lang === "es"
                  ? "El costo aplica solo a las líneas de los expedientes elegidos."
                  : "Cost applies only to the chosen expedientes' lines." },
              { id: "lines",
                title: lang === "es" ? "Solo a LÍNEAS específicas" : "Only specific LINES",
                desc:  lang === "es"
                  ? "Marca SKU/talla precisos. Útil para fletes por producto."
                  : "Pick exact SKU/size. Useful for per-product freight." },
            ]}
          />

          {mode !== "all" && (
            <div style={{ marginTop: 16 }}>
              <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8 }}>
                {lang === "es" ? "EXPEDIENTES" : "EXPEDIENTES"}
              </div>
              {expedientes.length === 0 ? (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es"
                    ? "Sin expedientes seleccionados en el paso de productos."
                    : "No expedientes selected in the products step."}
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {expedientes.map((e) => {
                    const on = selExpIds.includes(e.id);
                    return (
                      <button key={e.id} type="button"
                              onClick={() => toggleExp(e.id)}
                              style={{
                                padding: "6px 12px", borderRadius: 999,
                                border: on
                                  ? "1.5px solid var(--brand-accent, #0E8A6D)"
                                  : "1px solid var(--border-subtle)",
                                background: on
                                  ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 12%, transparent)"
                                  : "var(--surface, white)",
                                color: on ? "var(--brand-accent, #0E8A6D)" : "var(--text-primary)",
                                fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                                cursor: "pointer",
                                display: "inline-flex", alignItems: "center", gap: 6,
                              }}>
                        {on && <IconCheck size={11}/>}
                        <span className="mono-sm">{e.codigo}</span>
                        {e.proforma_codigo && (
                          <span style={{ opacity: 0.7 }}>· {e.proforma_codigo}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {mode === "lines" && selExpIds.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8 }}>
                {lang === "es" ? "LÍNEAS" : "LINES"}
              </div>
              {expedientes
                .filter((e) => selExpIds.includes(e.id))
                .map((e) => (
                  <LinesBlock
                    key={e.id}
                    exp={e}
                    selLineKeys={selLineKeys}
                    toggleLine={toggleLine}
                    onSelectAll={(on) => toggleAllExpLines(e.id, on)}
                    lang={lang}
                  />
                ))}
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
          <button className="btn btn-accent" onClick={handleSave}
                  disabled={
                    (mode === "expedientes" && selExpIds.length === 0) ||
                    (mode === "lines"
                      && (selExpIds.length === 0
                          || Object.values(selLineKeys).every((v) => !v)))
                  }>
            <IconCheck size={12}/>
            {lang === "es" ? "Guardar alcance" : "Save scope"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponente: radio de modos ─────────────────────────────
function ModeRadio({ value, onChange, options }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <label key={o.id} style={{
            display: "flex", gap: 12, alignItems: "flex-start",
            padding: "12px 14px",
            borderRadius: 10,
            border: on
              ? "1.5px solid var(--brand-accent, #0E8A6D)"
              : "1px solid var(--border-subtle)",
            background: on
              ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 6%, transparent)"
              : "var(--surface, white)",
            cursor: "pointer", transition: "all 0.15s",
          }}>
            <input type="radio" checked={on}
                   onChange={() => onChange(o.id)}
                   style={{ marginTop: 3 }}/>
            <div>
              <div style={{ fontWeight: 700,
                            color: "var(--text-primary)",
                            fontSize: 13 }}>
                {o.title}
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                {o.desc}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ── Subcomponente: tabla de líneas por expediente ─────────────
function LinesBlock({ exp, selLineKeys, toggleLine, onSelectAll, lang }) {
  const all = exp.lines.every((it) => selLineKeys[lineKey(it)]);
  const some = exp.lines.some((it) => selLineKeys[lineKey(it)]);

  return (
    <div style={{
      border: "1px solid var(--border-subtle)",
      borderRadius: 10, marginBottom: 10, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px",
        background: "var(--surface-alt, rgba(0,0,0,0.02))",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={all}
                 ref={(el) => { if (el) el.indeterminate = !all && some; }}
                 onChange={(e) => onSelectAll(e.target.checked)}/>
          <span className="mono-sm" style={{ fontWeight: 700,
                                             color: "var(--brand-primary)" }}>
            {exp.codigo}
          </span>
          {exp.proforma_codigo && (
            <span className="caption" style={{ color: "var(--text-tertiary)" }}>
              · {exp.proforma_codigo}
            </span>
          )}
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            · {exp.lines.length} {lang === "es" ? "líneas" : "lines"}
          </span>
        </div>
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th style={{ width: 140 }}>SKU</th>
            <th>{lang === "es" ? "Nombre" : "Name"}</th>
            <th style={{ width: 80, textAlign: "center" }}>
              {lang === "es" ? "Talla" : "Size"}
            </th>
            <th style={{ width: 80, textAlign: "right" }}>
              {lang === "es" ? "Qty" : "Qty"}
            </th>
          </tr>
        </thead>
        <tbody>
          {exp.lines.map((it) => {
            const k = lineKey(it);
            const on = !!selLineKeys[k];
            return (
              <tr key={k} style={{
                background: on
                  ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 4%, transparent)"
                  : undefined,
              }}>
                <td>
                  <input type="checkbox" checked={on}
                         onChange={() => toggleLine(k)}/>
                </td>
                <td>
                  <span className="mono-sm" style={{ fontWeight: 600 }}>{it._sku}</span>
                </td>
                <td>{it._nombre}</td>
                <td style={{ textAlign: "center" }}>
                  <span className="size-chip">{it.talla || "—"}</span>
                </td>
                <td className="td-num tabular-nums">{it.qty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Llave única por línea (talla puede ser null/'' → string vacío).
function lineKey(l) {
  return `${l.expediente_id}::${l.producto_id}::${l.talla || ""}`;
}
