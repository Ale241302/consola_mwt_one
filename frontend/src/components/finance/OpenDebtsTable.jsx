// =====================================================================
// MWT.ONE · components/finance/OpenDebtsTable.jsx
// Sprint Registrar Pago (Fase 2) — Paso 2 del wizard.
//
// Tabla de obligaciones abiertas de una contraparte, filtrada por
// payment_target_type (PRODUCT o COST — decision H.7 del §6).
//
// REQUISITOS CRITICOS (Brief CEO Fase 2):
//   1) Recibe payment_target_type como prop. Solo muestra obligaciones
//      compatibles con ese tipo. PRODUCT -> applicable_type IN
//      (PROFORMA, FACTURA, PRODUCTO). COST -> applicable_type='COSTO'.
//      Si la tabla mezcla los dos tipos, la decision arquitectonica
//      fallo (assertion en consola dev para detectarlo temprano).
//   2) Cada fila exhibe los flags `is_operated_by_mwt` y `payment_terms`
//      del expediente como chips visuales. Sin esto el usuario tilda
//      a ciegas y la matriz §2 queda implicita.
//   3) Subtotal + contador de lineas tildadas reaccionan en tiempo
//      real. El Paso 4 consume ambos para el dry-run.
//
// Reglas honradas:
//   R1 — Cero hex literales (solo CSS vars)
//   R5 — tabular-nums en monto y balance
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useOpenDebts } from "../../data/payments.js";
import {
  PAYMENT_APPLICABLE_TYPE_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";

// Map payment_target_type -> applicable_types permitidos.
// PRODUCT engloba PROFORMA + FACTURA + PRODUCTO (todo lo que es
// producto del expediente). COST = solo COSTO (DUA, flete, etc).
const TARGET_TO_APPLICABLES = {
  PRODUCT: new Set(["PROFORMA", "FACTURA", "PRODUCTO"]),
  COST:    new Set(["COSTO"]),
};

// fmt money — minimal, sin libs externas.
const _fmtMoney = (n, currency = "USD") => {
  const v = Number(n || 0);
  return `${currency} ${v.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/**
 * @param {{
 *   payment_target_type: 'PRODUCT'|'COST',
 *   counterparty_type: string|null,
 *   counterparty_id: string|null,
 *   value: string[],                                  // obligation_ids seleccionados
 *   onChange: (ids: string[], subtotal: number) => void,
 *   lang?: 'es'|'en',
 * }} props
 */
export default function OpenDebtsTable({
  payment_target_type,
  counterparty_type,
  counterparty_id,
  value = [],
  onChange,
  lang = "es",
}) {
  // Filtros internos.
  const [filterApplicableType, setFilterApplicableType] = useState(null);
  const [searchExpediente, setSearchExpediente]         = useState("");

  // Fetch desde backend. Pasamos applicable_type al backend cuando el
  // usuario aplica filtro adicional (PROFORMA solo, FACTURA solo, etc).
  // Si no, traemos todo y filtramos en memoria por target.
  const { data, loading, error } = useOpenDebts({
    counterparty_type,
    counterparty_id,
    applicable_type: filterApplicableType,
    enabled: !!(counterparty_type && counterparty_id),
  });

  // Set de applicable_types compatibles con payment_target_type.
  const compatibleTypes = TARGET_TO_APPLICABLES[payment_target_type] || new Set();

  // Filtrar por target_type + search + filtro user.
  const rows = useMemo(() => {
    const compat = data.filter((r) =>
      compatibleTypes.size === 0 || compatibleTypes.has(r.applicable_type)
    );
    if (!searchExpediente.trim()) return compat;
    const q = searchExpediente.trim().toLowerCase();
    return compat.filter((r) => {
      const hay = `${r.expediente_codigo || ""} ${r.proforma_codigo || ""} ${r.concepto || ""} ${r.sku || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, compatibleTypes, searchExpediente]);

  // Assertion dev: si rows incluye applicable_types fuera del set
  // compatible, algo se rompio (backend devuelve algo no esperado).
  useEffect(() => {
    if (process?.env?.NODE_ENV !== "production" && rows.length > 0 && compatibleTypes.size) {
      const violator = rows.find((r) => !compatibleTypes.has(r.applicable_type));
      if (violator) {
        // eslint-disable-next-line no-console
        console.warn(
          "[OpenDebtsTable] payment_target_type =", payment_target_type,
          "pero recibimos una obligacion con applicable_type =",
          violator.applicable_type, "— posible bug de filtrado backend o prop drift."
        );
      }
    }
  }, [rows, compatibleTypes, payment_target_type]);

  // Agrupar por expediente_id para visualizacion.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const k = r.expediente_id;
      if (!map.has(k)) {
        map.set(k, {
          expediente_id:        r.expediente_id,
          expediente_codigo:    r.expediente_codigo,
          proforma_codigo:      r.proforma_codigo,
          is_operated_by_mwt:   r.is_operated_by_mwt,
          payment_terms:        r.payment_terms,
          lines:                [],
        });
      }
      map.get(k).lines.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  // Subtotal + contador reactivos (Requisito 3).
  const { subtotal, selectedCount } = useMemo(() => {
    const selectedSet = new Set(value);
    let sub = 0;
    let cnt = 0;
    for (const r of rows) {
      if (selectedSet.has(r.obligation_id)) {
        sub += Number(r.balance || 0);
        cnt += 1;
      }
    }
    return { subtotal: sub, selectedCount: cnt };
  }, [rows, value]);

  // Currency dominante (la del primer item — si hay mezcla, mostramos USD).
  const dominantCurrency = useMemo(() => {
    const selectedSet = new Set(value);
    const found = rows.find((r) => selectedSet.has(r.obligation_id));
    return found?.currency || "USD";
  }, [rows, value]);

  // Toggle individual.
  const toggleRow = (obligation_id) => {
    const next = value.includes(obligation_id)
      ? value.filter((x) => x !== obligation_id)
      : [...value, obligation_id];
    // Recalcular subtotal nuevo y propagarlo al padre.
    const selectedSet = new Set(next);
    const newSub = rows.reduce(
      (a, r) => a + (selectedSet.has(r.obligation_id) ? Number(r.balance || 0) : 0),
      0,
    );
    onChange?.(next, newSub);
  };

  // Toggle group (todas las líneas de un expediente).
  const toggleGroup = (group) => {
    const ids = group.lines.map((l) => l.obligation_id);
    const allOn = ids.every((id) => value.includes(id));
    const next = allOn
      ? value.filter((id) => !ids.includes(id))
      : Array.from(new Set([...value, ...ids]));
    const selectedSet = new Set(next);
    const newSub = rows.reduce(
      (a, r) => a + (selectedSet.has(r.obligation_id) ? Number(r.balance || 0) : 0),
      0,
    );
    onChange?.(next, newSub);
  };

  // Estados de carga / vacio.
  if (!counterparty_type || !counterparty_id) {
    return (
      <div className="open-debts-empty"
           style={{ padding: 32, textAlign: "center",
                    color: "var(--text-tertiary)" }}>
        {lang === "es"
          ? "Selecciona una contraparte en el Paso 1 para ver sus obligaciones abiertas."
          : "Select a counterparty in Step 1 to see its open debts."}
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)" }}>
        {lang === "es" ? "Cargando obligaciones..." : "Loading debts..."}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--critical)" }}>
        {error}
      </div>
    );
  }

  return (
    <div className="open-debts-table">
      {/* Toolbar: filtros + contador */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 0 14px", flexWrap: "wrap",
      }}>
        <input
          type="text"
          value={searchExpediente}
          onChange={(e) => setSearchExpediente(e.target.value)}
          placeholder={lang === "es"
            ? "Buscar por expediente, proforma, SKU o concepto..."
            : "Search by file, proforma, SKU or concept..."}
          style={{
            flex: 1, minWidth: 240,
            padding: "7px 10px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            font: "var(--body-sm)",
            background: "var(--surface)",
            outline: "none",
          }}
        />
        {/* Filtro por applicable_type (subtipos del target). */}
        {compatibleTypes.size > 1 && (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              data-active={filterApplicableType === null}
              onClick={() => setFilterApplicableType(null)}
              style={_chipBtnStyle(filterApplicableType === null)}
            >
              {lang === "es" ? "Todas" : "All"}
            </button>
            {Array.from(compatibleTypes).map((t) => (
              <button
                key={t}
                type="button"
                data-active={filterApplicableType === t}
                onClick={() => setFilterApplicableType(t)}
                style={_chipBtnStyle(filterApplicableType === t)}
              >
                {getEnumLabel(PAYMENT_APPLICABLE_TYPE_LABELS, t, lang)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cuerpo: tabla agrupada por expediente */}
      {grouped.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)",
                      border: "1px dashed var(--border)",
                      borderRadius: "var(--radius-md)" }}>
          {lang === "es"
            ? "Esta contraparte no tiene obligaciones abiertas del tipo seleccionado."
            : "This counterparty has no open debts of the selected type."}
        </div>
      ) : (
        <div className="card card-pad-0" style={{ overflow: "hidden" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>{lang === "es" ? "Expediente / Producto" : "File / Product"}</th>
                <th style={{ width: 110 }}>
                  {lang === "es" ? "Tipo" : "Type"}
                </th>
                <th style={{ width: 200 }}>
                  {lang === "es" ? "Flags" : "Flags"}
                </th>
                <th style={{ textAlign: "right", width: 130 }}>
                  {lang === "es" ? "Balance" : "Balance"}
                </th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => {
                const groupIds = group.lines.map((l) => l.obligation_id);
                const allOn   = groupIds.every((id) => value.includes(id));
                const someOn  = !allOn && groupIds.some((id) => value.includes(id));
                return (
                  <React.Fragment key={group.expediente_id}>
                    {/* Group header */}
                    <tr style={{ background: "var(--bg-alt)" }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => { if (el) el.indeterminate = someOn; }}
                          onChange={() => toggleGroup(group)}
                        />
                      </td>
                      <td colSpan={4} style={{ padding: "8px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span className="font-mono tabular-nums"
                                style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
                            {group.proforma_codigo || group.expediente_codigo || "—"}
                          </span>
                          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                            {group.lines.length} {lang === "es"
                              ? (group.lines.length === 1 ? "obligación" : "obligaciones")
                              : (group.lines.length === 1 ? "debt" : "debts")}
                          </span>
                          {/* Requisito 2: chips de operating + terms */}
                          <ExpedienteFlagsChips
                            is_operated_by_mwt={group.is_operated_by_mwt}
                            payment_terms={group.payment_terms}
                            lang={lang}
                          />
                        </div>
                      </td>
                    </tr>
                    {/* Lines */}
                    {group.lines.map((row) => {
                      const checked = value.includes(row.obligation_id);
                      return (
                        <tr key={row.obligation_id}
                            style={{
                              background: checked
                                ? "color-mix(in oklab, var(--brand-accent) 6%, transparent)"
                                : undefined,
                              cursor: "pointer",
                            }}
                            onClick={() => toggleRow(row.obligation_id)}>
                          <td onClick={(e) => e.stopPropagation()}
                              style={{ paddingLeft: 24 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRow(row.obligation_id)}
                            />
                          </td>
                          <td>
                            <div className="font-mono tabular-nums"
                                 style={{ fontSize: 12, fontWeight: 500 }}>
                              {row.sku || "—"}
                            </div>
                            <div className="caption"
                                 style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                              {row.concepto}
                            </div>
                          </td>
                          <td>
                            <span style={{
                              padding: "2px 7px",
                              borderRadius: "var(--radius-sm)",
                              background: "var(--bg-alt)",
                              border: "1px solid var(--divider)",
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: "var(--text-secondary)",
                            }}>
                              {getEnumLabel(
                                PAYMENT_APPLICABLE_TYPE_LABELS,
                                row.applicable_type, lang,
                              )}
                            </span>
                          </td>
                          <td>{/* flags ya van en el group header */}</td>
                          <td className="td-money tabular-nums"
                              style={{ textAlign: "right" }}>
                            {_fmtMoney(row.balance, row.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
            {/* Footer: subtotal reactivo (Requisito 3) */}
            <tfoot>
              <tr style={{ background: "var(--surface-hover)",
                           borderTop: "2px solid var(--border-strong)" }}>
                <td colSpan={4} style={{ padding: "12px 16px", textAlign: "right" }}>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {lang === "es" ? "Líneas seleccionadas:" : "Selected lines:"}
                  </span>{" "}
                  <span className="tabular-nums" style={{ fontWeight: 700 }}>
                    {selectedCount}
                  </span>
                  {" / "}
                  <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {rows.length}
                  </span>
                </td>
                <td className="td-money tabular-nums"
                    style={{ textAlign: "right", fontWeight: 700, fontSize: 15,
                             padding: "12px 16px",
                             color: selectedCount > 0 ? "var(--success)" : "var(--text-tertiary)" }}>
                  {_fmtMoney(subtotal, dominantCurrency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Subcomponente: chips de matriz §2 visibles ───────────────────────
function ExpedienteFlagsChips({ is_operated_by_mwt, payment_terms, lang }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {/* Operador */}
      <span
        title={is_operated_by_mwt
          ? (lang === "es" ? "Operado por Muito Work Limitada" : "Operated by Muito Work Limitada")
          : (lang === "es" ? "Operado por el cliente" : "Operated by the client")}
        style={{
          padding: "2px 7px",
          borderRadius: "var(--radius-sm)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          background: is_operated_by_mwt
            ? "color-mix(in oklab, var(--brand-primary) 12%, transparent)"
            : "var(--bg-alt)",
          color: is_operated_by_mwt
            ? "var(--brand-primary)"
            : "var(--text-tertiary)",
          border: `1px solid ${is_operated_by_mwt
            ? "color-mix(in oklab, var(--brand-primary) 30%, transparent)"
            : "var(--divider)"}`,
        }}
      >
        {is_operated_by_mwt
          ? (lang === "es" ? "MWT op." : "MWT op.")
          : (lang === "es" ? "Cliente op." : "Client op.")}
      </span>
      {/* Payment terms */}
      {payment_terms && (
        <span
          title={lang === "es"
            ? `Forma de pago: ${payment_terms}`
            : `Payment terms: ${payment_terms}`}
          style={{
            padding: "2px 7px",
            borderRadius: "var(--radius-sm)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            background: payment_terms === "CREDITO"
              ? "color-mix(in oklab, var(--warning) 14%, transparent)"
              : "color-mix(in oklab, var(--success) 14%, transparent)",
            color: payment_terms === "CREDITO"
              ? "var(--warning)"
              : "var(--success)",
            border: `1px solid ${payment_terms === "CREDITO"
              ? "color-mix(in oklab, var(--warning) 36%, transparent)"
              : "color-mix(in oklab, var(--success) 36%, transparent)"}`,
          }}
        >
          {payment_terms}
        </span>
      )}
      {/* Si no hay payment_terms — banderita de alerta */}
      {!payment_terms && (
        <span
          title={lang === "es"
            ? "Expediente sin forma de pago definida — bloquea liberación de crédito"
            : "File without payment terms — credit release will block"}
          style={{
            padding: "2px 7px",
            borderRadius: "var(--radius-sm)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            background: "color-mix(in oklab, var(--critical) 14%, transparent)",
            color: "var(--critical)",
            border: "1px solid color-mix(in oklab, var(--critical) 36%, transparent)",
          }}
        >
          {lang === "es" ? "sin terms" : "no terms"}
        </span>
      )}
    </span>
  );
}


// ── Style helper ─────────────────────────────────────────────────────
function _chipBtnStyle(active) {
  return {
    padding: "5px 10px",
    borderRadius: "999px",
    border: `1px solid ${active ? "var(--brand-primary)" : "var(--border)"}`,
    background: active ? "var(--brand-primary)" : "var(--surface)",
    color: active ? "var(--text-on-navy)" : "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 120ms ease",
  };
}
