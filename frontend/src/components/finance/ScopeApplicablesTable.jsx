// =====================================================================
// MWT.ONE · components/finance/ScopeApplicablesTable.jsx
// Sprint Pagos v2 — Tabla multi-select de items con saldo pendiente.
//
// Encapsula el Paso 2 del RegisterPaymentWizard.
// Fetch a financePaymentsApi.listApplicables(), render tabla con
// columnas dinámicas según applicableType y operated_by_mwt.
//
// Reglas honradas:
//   R1 — Cero hex literales (solo CSS vars)
//   R3 — CLIENT_* no ven Precio MWT (useRole().isClient)
//   R5 — tabular-nums en montos y cantidades
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { financePaymentsApi } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";

// Mapa scope type → query param name para listApplicables.
const SCOPE_PARAM = {
  NODO:          "nodo_id",
  TRANSFERENCIA: "transferencia_id",
  OC:            "oc_id",
  EXPEDIENTE:    "expediente",
};

/**
 * @typedef {{
 *   id: string,
 *   applicable_type: 'COSTO'|'PRODUCTO',
 *   monto_aplicado: number,
 *   cantidad_producto?: number,
 *   _label?: string,
 *   _currency?: string,
 * }} SelectedApplicable
 */

/**
 * @param {{
 *   scope: { type: 'NODO'|'TRANSFERENCIA'|'OC'|'EXPEDIENTE', id: string, label: string } | null,
 *   applicableType: 'COSTO'|'PRODUCTO',
 *   selected: SelectedApplicable[],
 *   onChange: (newSelected: SelectedApplicable[], subtotal: number) => void,
 *   lang?: 'es'|'en',
 * }} props
 */
export default function ScopeApplicablesTable({
  scope,
  applicableType,
  selected = [],
  onChange,
  lang = "es",
}) {
  const { isClient } = useRole();

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // ── Fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!scope?.id) return;

    let cancel = false;
    setLoading(true);
    setError(null);
    setItems([]);

    const paramName = SCOPE_PARAM[scope.type];
    if (!paramName) {
      setError(lang === "es"
        ? `Tipo de alcance no soportado: ${scope.type}`
        : `Unsupported scope type: ${scope.type}`);
      setLoading(false);
      return;
    }

    const query = { [paramName]: scope.id, type: applicableType };
    financePaymentsApi.listApplicables(query)
      .then((resp) => {
        if (cancel) return;
        const arr = Array.isArray(resp)
          ? resp
          : Array.isArray(resp?.applicables)
          ? resp.applicables
          : [];
        setItems(arr);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || (lang === "es" ? "Error al cargar" : "Load error"));
      })
      .finally(() => { if (!cancel) setLoading(false); });

    return () => { cancel = true; };
  }, [scope?.id, scope?.type, applicableType, lang]);

  // ── Selection helpers ───────────────────────────────────────────
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const subtotal = useMemo(() =>
    selected.reduce((sum, a) => sum + Number(a.monto_aplicado || 0), 0),
  [selected]);

  // Sprint 2026-05-25 - sync de monto_aplicado cuando items se refresca.
  // El backend recalcula saldo_usd con FX real (CRC -> USD). Si el
  // selected array tiene monto_aplicado stale (de un fetch anterior),
  // el subtotal y el Step 4 mostrarian montos incorrectos. Aqui
  // reescribimos monto_aplicado, cantidad_producto y _currency con
  // los valores frescos de items[id] cuando items cambia.
  useEffect(() => {
    if (!Array.isArray(items) || items.length === 0) return;
    if (!Array.isArray(selected) || selected.length === 0) return;
    const itemMap = new Map(items.map((i) => [i.id, i]));
    let changed = false;
    const updated = selected.map((s) => {
      const fresh = itemMap.get(s.id);
      if (!fresh) return s;
      const newMonto = applicableType === "COSTO"
        ? Number(fresh.saldo_usd || 0)
        : Number(fresh.subtotal_pendiente_usd || 0);
      const newCcy = fresh.currency || s._currency || "USD";
      const newQty = applicableType === "PRODUCTO"
        ? Number(fresh.saldo_qty || 0)
        : undefined;
      const newExpId = fresh.expediente_id || s._expediente_id || null;
      const newScopeIds = Array.isArray(fresh.scope_json && fresh.scope_json.expediente_ids)
        ? fresh.scope_json.expediente_ids
        : (Array.isArray(fresh.expediente_ids) ? fresh.expediente_ids : s._scope_expediente_ids || []);
      if (
        newMonto !== s.monto_aplicado ||
        newCcy !== s._currency ||
        newExpId !== s._expediente_id ||
        (newQty !== undefined && newQty !== s.cantidad_producto)
      ) {
        changed = true;
        return {
          ...s,
          monto_aplicado: newMonto,
          _currency:      newCcy,
          _expediente_id: newExpId,
          _scope_expediente_ids: newScopeIds,
          ...(applicableType === "PRODUCTO" ? { cantidad_producto: newQty } : {}),
        };
      }
      return s;
    });
    if (changed) {
      const newSub = updated.reduce(
        (sum, a) => sum + Number(a.monto_aplicado || 0),
        0,
      );
      onChange(updated, newSub);
    }
    // onChange NO es estable entre renders del padre; lo omitimos a
    // proposito de dependencies para evitar loop infinito. items + type
    // son lo que dispara el sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, applicableType]);

  function toggleItem(item) {
    if (selectedIds.has(item.id)) {
      // Deselect
      const next = selected.filter((s) => s.id !== item.id);
      const nextSub = next.reduce((s, a) => s + Number(a.monto_aplicado || 0), 0);
      onChange(next, nextSub);
    } else {
      // Select — compute monto_aplicado and label from item shape.
      const montoAplicado = applicableType === "COSTO"
        ? Number(item.saldo_usd || 0)
        : Number(item.subtotal_pendiente_usd || 0);

      const labelParts = applicableType === "COSTO"
        ? [item.kind, item.label].filter(Boolean).join(" · ")
        : [item.sku, item.talla, item.nombre].filter(Boolean).join(" · ");

      const entry = {
        id:                item.id,
        applicable_type:   applicableType,
        monto_aplicado:    montoAplicado,
        _label:            labelParts || item.id,
        _currency:         item.currency || "USD",
        // Sprint 2026-05-25 - guardar expediente_id derivable
        // para que el wizard arme bien el POST.
        _expediente_id:    item.expediente_id || null,
        _scope_expediente_ids: Array.isArray(item.scope_json && item.scope_json.expediente_ids)
          ? item.scope_json.expediente_ids
          : (Array.isArray(item.expediente_ids) ? item.expediente_ids : []),
        ...(applicableType === "PRODUCTO"
          ? { cantidad_producto: Number(item.saldo_qty || 0) }
          : {}),
      };
      const next = [...selected, entry];
      const nextSub = next.reduce((s, a) => s + Number(a.monto_aplicado || 0), 0);
      onChange(next, nextSub);
    }
  }

  function toggleAll(on) {
    if (!on) {
      onChange([], 0);
    } else {
      const next = items.map((item) => {
        const montoAplicado = applicableType === "COSTO"
          ? Number(item.saldo_usd || 0)
          : Number(item.subtotal_pendiente_usd || 0);
        const labelParts = applicableType === "COSTO"
          ? [item.kind, item.label].filter(Boolean).join(" · ")
          : [item.sku, item.talla, item.nombre].filter(Boolean).join(" · ");
        return {
          id:              item.id,
          applicable_type: applicableType,
          monto_aplicado:  montoAplicado,
          _label:          labelParts || item.id,
          _currency:       item.currency || "USD",
          _expediente_id:  item.expediente_id || null,
          _scope_expediente_ids: Array.isArray(item.scope_json && item.scope_json.expediente_ids)
            ? item.scope_json.expediente_ids
            : (Array.isArray(item.expediente_ids) ? item.expediente_ids : []),
          ...(applicableType === "PRODUCTO"
            ? { cantidad_producto: Number(item.saldo_qty || 0) }
            : {}),
        };
      });
      const nextSub = next.reduce((s, a) => s + Number(a.monto_aplicado || 0), 0);
      onChange(next, nextSub);
    }
  }

  const allChecked  = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const someChecked = !allChecked && items.some((i) => selectedIds.has(i.id));

  // ── Loading / error / empty states ─────────────────────────────
  if (loading) {
    return (
      <div style={{
        padding: "24px 0", textAlign: "center",
        color: "var(--text-tertiary)", fontSize: 13,
      }}>
        {lang === "es" ? "Cargando items disponibles…" : "Loading available items…"}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: "16px", borderRadius: "var(--radius-md)",
        background: "color-mix(in oklab, var(--critical) 6%, transparent)",
        border: "1px solid color-mix(in oklab, var(--critical) 26%, transparent)",
        color: "var(--critical)", fontSize: 13,
      }}>
        {error}
      </div>
    );
  }

  if (!scope?.id) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center",
                    color: "var(--text-tertiary)", fontSize: 13 }}>
        {lang === "es"
          ? "Sin alcance definido — el wizard debe pasar preselectedScope."
          : "No scope defined — wizard must pass preselectedScope."}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{
        padding: "24px 0", textAlign: "center",
        color: "var(--text-tertiary)", fontSize: 13,
      }}>
        {lang === "es"
          ? "No hay items con saldo pendiente en este alcance."
          : "No items with pending balance in this scope."}
      </div>
    );
  }

  // ── Detectar si es PRODUCTO operated_by_mwt ────────────────────
  // Se inspecciona el primer item para saber qué columnas mostrar.
  // Si operated_by_mwt es null/undefined, tratamos como false.
  const isMwtProducto = applicableType === "PRODUCTO"
    && items[0]?.operated_by_mwt === true;

  // ── Render tabla ────────────────────────────────────────────────
  return (
    <div>
      <div className="card card-pad" style={{ border: "1px solid var(--border-subtle)" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                {/* Checkbox select-all */}
                <th style={{ width: 36, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    title={lang === "es" ? "Seleccionar todo" : "Select all"}
                  />
                </th>

                {applicableType === "COSTO" && (
                  <>
                    <th style={{ fontSize: 11 }}>{lang === "es" ? "Tipo" : "Kind"}</th>
                    <th style={{ fontSize: 11 }}>{lang === "es" ? "Detalle" : "Detail"}</th>
                    <th style={{ fontSize: 11 }}>
                      {lang === "es" ? "Transferencia" : "Transfer"}
                    </th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Saldo USD" : "Balance USD"}
                    </th>
                  </>
                )}

                {applicableType === "PRODUCTO" && isMwtProducto && (
                  <>
                    <th style={{ fontSize: 11 }}>SKU</th>
                    <th style={{ fontSize: 11 }}>{lang === "es" ? "Talla" : "Size"}</th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Cant. saldo" : "Pending qty"}
                    </th>
                    {/* R3: isClient no ve Precio MWT */}
                    {!isClient && (
                      <th style={{ textAlign: "right", fontSize: 11 }}>
                        {lang === "es" ? "Precio MWT" : "MWT Price"}
                      </th>
                    )}
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Precio Cliente" : "Client Price"}
                    </th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Subtotal USD" : "Subtotal USD"}
                    </th>
                  </>
                )}

                {applicableType === "PRODUCTO" && !isMwtProducto && (
                  <>
                    <th style={{ fontSize: 11 }}>SKU</th>
                    <th style={{ fontSize: 11 }}>{lang === "es" ? "Talla" : "Size"}</th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Cant. saldo" : "Pending qty"}
                    </th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Precio unit." : "Unit price"}
                    </th>
                    <th style={{ fontSize: 11 }}>
                      {lang === "es" ? "Moneda" : "Currency"}
                    </th>
                    <th style={{ textAlign: "right", fontSize: 11 }}>
                      {lang === "es" ? "Subtotal USD" : "Subtotal USD"}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    onClick={() => toggleItem(item)}
                    style={{
                      cursor: "pointer",
                      background: isChecked
                        ? "color-mix(in oklab, var(--brand-primary) 5%, transparent)"
                        : undefined,
                    }}
                  >
                    {/* Checkbox cell */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleItem(item)}
                      />
                    </td>

                    {/* ── COSTO columns ── */}
                    {applicableType === "COSTO" && (
                      <>
                        <td>
                          <span style={{
                            padding: "2px 8px", borderRadius: 4,
                            fontSize: 10, fontWeight: 700,
                            textTransform: "uppercase", letterSpacing: "0.04em",
                            background: "var(--bg-alt)",
                            color: "var(--text-secondary)",
                          }}>
                            {item.kind || "—"}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{item.label || "—"}</td>
                        <td>
                          {item.transferencia_codigo ? (
                            <span className="mono-sm" style={{ fontWeight: 600,
                                                               color: "var(--brand-accent)" }}>
                              {item.transferencia_codigo}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{
                          textAlign: "right", fontWeight: 700,
                          color: "var(--brand-accent)",
                        }}>
                          ${Number(item.saldo_usd || 0).toLocaleString("en-US", {
                            minimumFractionDigits: 2, maximumFractionDigits: 2,
                          })}
                        </td>
                      </>
                    )}

                    {/* ── PRODUCTO (operated_by_mwt=true) columns ── */}
                    {applicableType === "PRODUCTO" && isMwtProducto && (
                      <>
                        <td style={{
                          fontFamily: "var(--font-mono)", fontSize: 12,
                          fontWeight: 600, color: "var(--interactive)",
                        }}>
                          {item.sku || "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {item.talla ? (
                            <span style={{
                              display: "inline-block", padding: "2px 8px",
                              borderRadius: 999,
                              background: "color-mix(in oklab, var(--brand-primary) 12%, transparent)",
                              color: "var(--brand-primary)",
                              fontSize: 11, fontWeight: 700,
                              fontFamily: "var(--font-mono)",
                            }}>
                              {item.talla}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                          {Number(item.saldo_qty || 0).toLocaleString("en-US")}
                        </td>
                        {/* R3: isClient no ve Precio MWT */}
                        {!isClient && (
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            ${Number(item.precio_mwt || 0).toLocaleString("en-US", {
                              minimumFractionDigits: 2, maximumFractionDigits: 2,
                            })}
                          </td>
                        )}
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          ${Number(item.precio_cliente || 0).toLocaleString("en-US", {
                            minimumFractionDigits: 2, maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="tabular-nums" style={{
                          textAlign: "right", fontWeight: 700,
                          color: "var(--brand-accent)",
                        }}>
                          ${Number(item.subtotal_pendiente_usd || 0).toLocaleString("en-US", {
                            minimumFractionDigits: 2, maximumFractionDigits: 2,
                          })}
                        </td>
                      </>
                    )}

                    {/* ── PRODUCTO (operated_by_mwt=false o null) columns ── */}
                    {applicableType === "PRODUCTO" && !isMwtProducto && (
                      <>
                        <td style={{
                          fontFamily: "var(--font-mono)", fontSize: 12,
                          fontWeight: 600, color: "var(--interactive)",
                        }}>
                          {item.sku || "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {item.talla ? (
                            <span style={{
                              display: "inline-block", padding: "2px 8px",
                              borderRadius: 999,
                              background: "color-mix(in oklab, var(--brand-primary) 12%, transparent)",
                              color: "var(--brand-primary)",
                              fontSize: 11, fontWeight: 700,
                              fontFamily: "var(--font-mono)",
                            }}>
                              {item.talla}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>
                          {Number(item.saldo_qty || 0).toLocaleString("en-US")}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          ${Number(item.precio_unitario || 0).toLocaleString("en-US", {
                            minimumFractionDigits: 2, maximumFractionDigits: 2,
                          })}
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {item.currency || "USD"}
                        </td>
                        <td className="tabular-nums" style={{
                          textAlign: "right", fontWeight: 700,
                          color: "var(--brand-accent)",
                        }}>
                          ${Number(item.subtotal_pendiente_usd || 0).toLocaleString("en-US", {
                            minimumFractionDigits: 2, maximumFractionDigits: 2,
                          })}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen de selección */}
      <div style={{
        marginTop: 12,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        background: "var(--surface-raised, var(--surface))",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
        fontSize: 13,
      }}>
        <span style={{ color: "var(--text-secondary)" }}>
          {selected.length === 0
            ? (lang === "es" ? "Ningún item seleccionado" : "No items selected")
            : `${selected.length} ${lang === "es"
                ? (selected.length === 1 ? "item seleccionado" : "items seleccionados")
                : (selected.length === 1 ? "item selected" : "items selected")}`}
        </span>
        {selected.length > 0 && (
          <span>
            <span style={{ color: "var(--text-secondary)", marginRight: 6 }}>
              Total USD:
            </span>
            <span className="tabular-nums" style={{ fontWeight: 700,
                                                     color: "var(--brand-accent)" }}>
              ${subtotal.toLocaleString("en-US", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
