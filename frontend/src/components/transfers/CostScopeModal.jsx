// ─────────────────────────────────────────────────────────────
// CostScopeModal — picker de alcance para una cost-line de
// transferencia. Sprint 2026-05-13 · Fase 9.1.
//
// CEO (textual): "cuando le de en + Agregar costo me debe preguntar
// qué expediente o expedientes de los seleccionados en el paso 2 le
// quiero agregar el costo, luego a qué producto o productos de cada
// expediente, y allí sí el tipo, monto, moneda, valor. Es decir, solo
// algunos expedientes y solo a líneas específicas son una única
// opción no separadas — porque al seleccionar el expediente o
// expedientes me muestra los productos que seleccioné en el paso 2."
//
// Estructura (Fase 9.1 — modos fusionados):
//   1. Radio · 2 opciones:
//        a) "Aplicar a TODA la transferencia"
//        b) "Restringir a expedientes/líneas"
//   2. Si restringir → chips de expedientes del paso 2.
//      Al seleccionar al menos uno, aparece la tabla de líneas
//      (filtradas a esos expedientes), TODAS marcadas por defecto.
//      El usuario puede desmarcar las que no quiera.
//   3. Save → onSave(scope_json).
//
// scope_json shape:
//   null                                                  → aplica a todo
//   {"applies_to_all": false, "expediente_ids":[...]}     → todos los productos
//                                                           de esos expedientes
//   {"applies_to_all": false, "expediente_ids":[...],
//    "lines":[{"expediente_id","producto_id","talla"}...]}→ solo esas líneas
//
// Si el usuario deja todas las líneas marcadas (no desmarca ninguna),
// emitimos sólo expediente_ids — semánticamente equivalente a "todas
// las líneas de estos expedientes". Si desmarca alguna, emitimos la
// lista explícita de las que quedaron marcadas.
//
// Reglas MWT: R1 tokens, R5 tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { IconCheck, IconX } from "../../lib/icons.jsx";
import { lineasApi } from "../../lib/api.js";
import { isMwtOperated } from "../../lib/operatingCompany.js";

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
 * @property {string|null} [_operating_company_id]
 * @property {string|null} [_linea_id_expediente]
 * @property {number|null} [_unit_price_mwt]
 * @property {number|null} [_unit_price_client]
 */

export default function CostScopeModal({
  open,
  onClose,
  onSave,
  lang = "es",
  /** Texto a mostrar como subtitle (kind o label del costo). */
  costLabel = "",
  /** Items seleccionados en el paso 2 (Productos). */
  transferItems = [],
  /** Scope actual del cost-line (null si nuevo o "aplica a todo"). */
  initialScope = null,
}) {
  // ── Modo: 'all' | 'specific' ─────────────────────────────
  const [mode, setMode] = useState("all");
  const [selExpIds, setSelExpIds] = useState([]);
  // selLineKeys: estado por línea (true = incluida).
  const [selLineKeys, setSelLineKeys] = useState({});

  // ── Sprint 2026-05-17 · State de precios editables. ──────
  // Map por linea_id_expediente → {mwt, client}. Inicializa desde
  // transferItems al abrir; persiste via lineasApi.bulkUpdatePrices
  // con replicacion por SKU al onBlur.
  const [priceByLineaId, setPriceByLineaId] = useState({});
  const [savingPrices, setSavingPrices] = useState(false);
  useEffect(() => {
    if (!open) return;
    const seed = {};
    for (const it of transferItems) {
      if (it._linea_id_expediente) {
        seed[it._linea_id_expediente] = {
          mwt:    it._unit_price_mwt    != null ? Number(it._unit_price_mwt)    : 0,
          client: it._unit_price_client != null ? Number(it._unit_price_client) : 0,
        };
      }
    }
    setPriceByLineaId(seed);
  }, [open, transferItems]);

  // ¿La transferencia tiene al menos un expediente operado por MWT?
  // Determina si mostramos columna "Precio MWT" en el modal.
  const isMwtOpAny = useMemo(
    () => transferItems.some(it => isMwtOperated(it._operating_company_id)),
    [transferItems],
  );

  /**
   * Persiste un cambio de precio en TODAS las lineas del mismo SKU
   * (mismo producto_id) dentro del mismo expediente_id. Estrategia:
   *   1. Filtrar transferItems por (expediente_id, producto_id) del item.
   *   2. Extraer linea_id_expediente de cada match.
   *   3. POST /api/lineas/bulk-update-prices/ con {linea_id, mwt?/client?}.
   *   4. Actualizar state local priceByLineaId tras 200 OK.
   *
   * @param {TransferItem} item — item editado
   * @param {'mwt'|'client'} which — qué columna cambió
   * @param {number} newPrice
   */
  const replicatePrice = async (item, which, newPrice) => {
    if (!item?.expediente_id || !item?.producto_id) return;
    // Encontrar todas las lineas del MISMO SKU dentro del MISMO expediente.
    const siblings = transferItems.filter(
      (s) => s.expediente_id === item.expediente_id
          && s.producto_id   === item.producto_id
          && s._linea_id_expediente
    );
    if (siblings.length === 0) return;
    const field = which === "mwt" ? "unit_price_mwt" : "unit_price_client";
    const updates = siblings.map((s) => ({
      linea_id: s._linea_id_expediente,
      [field]: newPrice,
    }));
    setSavingPrices(true);
    try {
      await lineasApi.bulkUpdatePrices(updates);
      // Actualizar state local para feedback inmediato.
      setPriceByLineaId((prev) => {
        const next = { ...prev };
        for (const s of siblings) {
          const cur = next[s._linea_id_expediente] || { mwt: 0, client: 0 };
          next[s._linea_id_expediente] = { ...cur, [which]: newPrice };
        }
        return next;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[CostScopeModal] bulkUpdatePrices fallo:", err);
    } finally {
      setSavingPrices(false);
    }
  };

  // ── Expedientes únicos derivados de transferItems ────────
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

  // ── Hidratar desde initialScope cuando se abre ───────────
  useEffect(() => {
    if (!open) return;
    if (!initialScope || initialScope.applies_to_all === true) {
      setMode("all");
      setSelExpIds([]);
      // Por defecto, si el usuario cambia a "Específico", todas las
      // líneas de los expedientes elegidos quedarán marcadas (lo
      // gestiona el effect de auto-check más abajo).
      setSelLineKeys({});
      return;
    }
    const ids = Array.isArray(initialScope.expediente_ids)
      ? initialScope.expediente_ids
      : [];
    setSelExpIds(ids);
    setMode("specific");
    if (Array.isArray(initialScope.lines) && initialScope.lines.length > 0) {
      const k = {};
      for (const l of initialScope.lines) {
        k[lineKey(l)] = true;
      }
      setSelLineKeys(k);
    } else {
      // Sin lista explícita = "todas las líneas de estos expedientes"
      // → marcamos todas en UI para que el usuario las vea checked
      // y pueda desmarcar las que no quiera.
      const k = {};
      const setIds = new Set(ids);
      for (const it of transferItems) {
        if (setIds.has(it.expediente_id)) k[lineKey(it)] = true;
      }
      setSelLineKeys(k);
    }
  }, [open, initialScope, transferItems]);

  // ── Auto-check de líneas cuando se selecciona un expediente ──
  // Si el usuario marca un expediente nuevo, todas sus líneas se
  // marcan automáticamente. Si lo desmarca, se "limpian" sus líneas.
  useEffect(() => {
    if (mode !== "specific") return;
    setSelLineKeys((prev) => {
      const next = { ...prev };
      const setIds = new Set(selExpIds);
      // 1) Marcar líneas de nuevos expedientes (las que aún no tienen
      //    estado registrado).
      for (const it of transferItems) {
        const k = lineKey(it);
        if (setIds.has(it.expediente_id) && next[k] === undefined) {
          next[k] = true;
        }
      }
      // 2) Limpiar líneas de expedientes que ya no están seleccionados.
      for (const k of Object.keys(next)) {
        const expId = k.split("::")[0];
        if (!setIds.has(expId)) delete next[k];
      }
      return next;
    });
  }, [selExpIds, mode, transferItems]);

  // ── Líneas filtradas a los expedientes seleccionados ─────
  const expedientesSeleccionados = useMemo(
    () => expedientes.filter((e) => selExpIds.includes(e.id)),
    [expedientes, selExpIds],
  );

  // ── Helpers ─────────────────────────────────────────────
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

  // ── Stats para el botón "Guardar" + chip resumen ────────
  // total_lines_seleccionados = líneas check=true en expedientes seleccionados.
  // total_lines_posibles      = líneas de los expedientes seleccionados.
  const { totalLinesSel, totalLinesPosibles, allLinesChecked } = useMemo(() => {
    const setIds = new Set(selExpIds);
    let totalSel = 0, totalPos = 0;
    for (const it of transferItems) {
      if (!setIds.has(it.expediente_id)) continue;
      totalPos += 1;
      if (selLineKeys[lineKey(it)]) totalSel += 1;
    }
    return {
      totalLinesSel:      totalSel,
      totalLinesPosibles: totalPos,
      allLinesChecked:    totalPos > 0 && totalSel === totalPos,
    };
  }, [selExpIds, selLineKeys, transferItems]);

  // ── Guardar ─────────────────────────────────────────────
  const handleSave = () => {
    if (mode === "all") {
      onSave?.(null);
      onClose?.();
      return;
    }
    const scope = {
      applies_to_all: false,
      expediente_ids: selExpIds.slice(),
    };
    // Si NO están todas marcadas, emitimos la lista explícita.
    // Si SÍ están todas marcadas, omitimos `lines` (semántica = "todas
    // las líneas de estos expedientes").
    if (!allLinesChecked) {
      const lines = [];
      for (const it of transferItems) {
        if (!selExpIds.includes(it.expediente_id)) continue;
        if (selLineKeys[lineKey(it)]) {
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

  // ── canSave: validación del botón ───────────────────────
  const canSave = mode === "all"
    || (selExpIds.length > 0 && totalLinesSel > 0);

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
        width: "min(880px, 100%)", maxHeight: "88vh",
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
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <IconX size={13}/>
          </button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto" }}>
          {/* Modo · 2 opciones (Fase 9.1 — fusionado) */}
          <ModeRadio
            value={mode} onChange={setMode}
            options={[
              { id: "all",
                title: lang === "es" ? "Aplicar a TODA la transferencia" : "Apply to whole transfer",
                desc:  lang === "es"
                  ? "El costo se prorratea sobre todas las líneas del batch."
                  : "Cost is prorated across all lines in the batch." },
              { id: "specific",
                title: lang === "es"
                  ? "Restringir a expedientes / líneas específicas"
                  : "Restrict to specific expedientes / lines",
                desc:  lang === "es"
                  ? "Elige los expedientes; al seleccionarlos verás sus líneas y podrás desmarcar las que no apliquen."
                  : "Pick the expedientes; lines appear so you can uncheck non-applicable ones." },
            ]}
          />

          {mode === "specific" && (
            <>
              <div style={{ marginTop: 18 }}>
                <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.5, marginBottom: 8 }}>
                  {lang === "es" ? "1. EXPEDIENTES" : "1. EXPEDIENTES"}
                </div>
                {expedientes.length === 0 ? (
                  <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                    {lang === "es"
                      ? "Sin expedientes seleccionados en el paso 2 (Productos)."
                      : "No expedientes selected in step 2 (Products)."}
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
                          <span style={{
                            marginLeft: 4, opacity: 0.7, fontWeight: 600,
                          }}>
                            ({e.lines.length})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tabla de líneas — aparece sólo cuando hay ≥1 expediente seleccionado */}
              {selExpIds.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="micro" style={{
                    color: "var(--text-tertiary)", letterSpacing: 0.5,
                    marginBottom: 8,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span>{lang === "es" ? "2. PRODUCTOS" : "2. PRODUCTS"}</span>
                    <span className="caption" style={{
                      color: allLinesChecked
                        ? "var(--brand-accent, #0E8A6D)"
                        : "var(--text-tertiary)",
                      letterSpacing: 0.3, textTransform: "none",
                    }}>
                      {lang === "es"
                        ? `${totalLinesSel} / ${totalLinesPosibles} líneas`
                        : `${totalLinesSel} / ${totalLinesPosibles} lines`}
                    </span>
                  </div>
                  {expedientesSeleccionados.map((e) => (
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
            </>
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
                  disabled={!canSave}>
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
            <th style={{ width: 130 }}>SKU</th>
            <th>{lang === "es" ? "Nombre" : "Name"}</th>
            <th style={{ width: 70, textAlign: "center" }}>
              {lang === "es" ? "Talla" : "Size"}
            </th>
            <th style={{ width: 70, textAlign: "right" }}>
              {lang === "es" ? "Qty" : "Qty"}
            </th>
            {/* Sprint 2026-05-17 · Columnas de precio editables.
                Si la transferencia tiene algun expediente operado por
                MWT → mostramos Precio MWT + Precio Cliente.
                Si todos los expedientes son operados por el cliente →
                solo Precio Cliente. */}
            {isMwtOpAny && (
              <th style={{ width: 120, textAlign: "right",
                           background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)" }}>
                {lang === "es" ? "Precio MWT" : "MWT price"}
              </th>
            )}
            <th style={{ width: 120, textAlign: "right",
                         background: "color-mix(in oklab, var(--brand-accent, #00B286) 6%, transparent)" }}>
              {lang === "es" ? "Precio Cliente" : "Client price"}
            </th>
          </tr>
        </thead>
        <tbody>
          {exp.lines.map((it) => {
            const k = lineKey(it);
            const on = !!selLineKeys[k];
            const lid = it._linea_id_expediente;
            const localPrices = (lid && priceByLineaId[lid]) || { mwt: 0, client: 0 };
            const itemIsMwtOp = isMwtOperated(it._operating_company_id);
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
                {/* Sprint 2026-05-17 · celda Precio MWT.
                    Si la transferencia tiene al menos un MWT-op expediente
                    mostramos la columna; pero si ESTA linea pertenece a un
                    expediente operado por cliente, mostramos '—' en gris. */}
                {isMwtOpAny && (
                  <td className="td-edit" style={{ textAlign: "right" }}>
                    {itemIsMwtOp && lid ? (
                      <input
                        type="number" min={0} step="0.01"
                        className="edit-input tabular-nums"
                        value={localPrices.mwt ?? 0}
                        disabled={savingPrices}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setPriceByLineaId((prev) => ({
                            ...prev,
                            [lid]: { ...(prev[lid] || { client: 0 }), mwt: v },
                          }));
                        }}
                        onBlur={(e) => {
                          const v = +e.target.value;
                          replicatePrice(it, "mwt", v);
                        }}
                        style={{ width: 96, textAlign: "right" }}
                      />
                    ) : (
                      <span style={{ color: "var(--text-tertiary)" }}>—</span>
                    )}
                  </td>
                )}
                {/* Celda Precio Cliente — siempre presente, editable. */}
                <td className="td-edit" style={{ textAlign: "right" }}>
                  {lid ? (
                    <input
                      type="number" min={0} step="0.01"
                      className="edit-input tabular-nums"
                      value={localPrices.client ?? 0}
                      disabled={savingPrices}
                      onChange={(e) => {
                        const v = +e.target.value;
                        setPriceByLineaId((prev) => ({
                          ...prev,
                          [lid]: { ...(prev[lid] || { mwt: 0 }), client: v },
                        }));
                      }}
                      onBlur={(e) => {
                        const v = +e.target.value;
                        replicatePrice(it, "client", v);
                      }}
                      style={{ width: 96, textAlign: "right" }}
                    />
                  ) : (
                    <span style={{ color: "var(--text-tertiary)" }}>—</span>
                  )}
                </td>
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
