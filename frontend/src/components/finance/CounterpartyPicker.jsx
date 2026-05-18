// =====================================================================
// MWT.ONE · components/finance/CounterpartyPicker.jsx
// Sprint Registrar Pago (Fase 2) — Paso 1 del wizard.
//
// Combobox unificado de contrapartes (clientes + proveedores). Filtra
// segun `direction`:
//   IN  (MWT cobra)  -> muestra clientes y distribuidores
//   OUT (MWT paga)   -> muestra proveedores, aduaneros, transportistas,
//                       agentes.
//
// Output via onChange: { id, counterparty_type, label, subtitle, _raw }
// o null cuando se deselecciona.
//
// Reglas honradas:
//   R1 — Cero hex literales (solo CSS vars)
//   R3 — Aislamiento de visibilidad: ya hay un check en el backend; en
//        el FE no exponemos campos sensibles de la contraparte, solo
//        label + subtitle (tax_id).
//   R5 — tabular-nums en tax_ids
// =====================================================================
import React, { useMemo, useState } from "react";
import { useCounterpartiesUnified } from "../../data/payments.js";
import { COUNTERPARTY_TYPE_LABELS, getEnumLabel } from "../../lib/i18n/payments.js";

/**
 * @typedef {Object} CounterpartyPickerValue
 * @property {string} id
 * @property {'CLIENTE'|'PROVEEDOR'|'ADUANERO'|'TRANSPORTISTA'|'AGENTE'|'DISTRIBUIDOR'} counterparty_type
 * @property {string} label
 * @property {string|null} subtitle
 * @property {string|null} country_iso2
 * @property {string|null} tax_id
 * @property {object} _raw
 */

/**
 * @param {{
 *   direction: 'IN'|'OUT'|null,
 *   value: CounterpartyPickerValue|null,
 *   onChange: (v: CounterpartyPickerValue|null) => void,
 *   lang?: 'es'|'en',
 *   disabled?: boolean,
 * }} props
 */
export default function CounterpartyPicker({
  direction,
  value,
  onChange,
  lang = "es",
  disabled = false,
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");

  const { data, loading, error } = useCounterpartiesUnified({ direction });

  // Filtrar por texto (search) — match en label o tax_id.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((it) => {
      const hay = `${it.label || ""} ${it.subtitle || ""} ${it.tax_id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, search]);

  // Group por counterparty_type para mostrar headers.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of filtered) {
      if (!map.has(it.counterparty_type)) map.set(it.counterparty_type, []);
      map.get(it.counterparty_type).push(it);
    }
    return Array.from(map.entries());  // [[type, items], ...]
  }, [filtered]);

  const handleSelect = (item) => {
    onChange?.(item);
    setOpen(false);
    setSearch("");
  };

  const handleClear = (ev) => {
    ev.stopPropagation();
    onChange?.(null);
  };

  return (
    <div className="cp-picker" style={{ position: "relative" }}>
      {/* Campo trigger — muestra valor seleccionado o placeholder. */}
      <button
        type="button"
        className="cp-picker__trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: disabled ? "var(--bg-alt)" : "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          font: "var(--body-md)",
          transition: "border-color 120ms ease",
        }}
      >
        {value ? (
          <>
            <span
              className="cp-picker__chip"
              style={{
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-alt)",
                border: "1px solid var(--divider)",
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--brand-primary)",
                whiteSpace: "nowrap",
              }}
            >
              {getEnumLabel(COUNTERPARTY_TYPE_LABELS, value.counterparty_type, lang)}
            </span>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0,
                           overflow: "hidden", textOverflow: "ellipsis",
                           whiteSpace: "nowrap" }}>
              {value.label}
            </span>
            {value.tax_id && (
              <span className="tabular-nums" style={{ color: "var(--text-tertiary)",
                                                       fontSize: 12 }}>
                {value.tax_id}
              </span>
            )}
            <span
              role="button"
              aria-label={lang === "es" ? "Limpiar" : "Clear"}
              onClick={handleClear}
              style={{
                marginLeft: 4,
                width: 18,
                height: 18,
                display: "inline-grid",
                placeItems: "center",
                color: "var(--text-tertiary)",
                fontSize: 14,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >×</span>
          </>
        ) : (
          <span style={{ color: "var(--text-tertiary)", flex: 1 }}>
            {direction === "IN"
              ? (lang === "es" ? "Selecciona el cliente o distribuidor que paga..."
                               : "Select the client or distributor paying...")
              : direction === "OUT"
              ? (lang === "es" ? "Selecciona el proveedor / aduanero / transportista que cobra..."
                               : "Select the supplier / customs broker / carrier collecting...")
              : (lang === "es" ? "Selecciona la dirección primero..."
                               : "Select direction first...")}
          </span>
        )}
        <span style={{ color: "var(--text-tertiary)",
                       transform: open ? "rotate(180deg)" : "rotate(0)",
                       transition: "transform 160ms ease",
                       fontSize: 10 }}>▼</span>
      </button>

      {/* Dropdown */}
      {open && !disabled && (
        <div
          className="cp-picker__dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0, right: 0,
            zIndex: 100,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 360,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search */}
          <div style={{ padding: 8, borderBottom: "1px solid var(--divider)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              placeholder={lang === "es" ? "Buscar por nombre o tax ID..."
                                         : "Search by name or tax ID..."}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                font: "var(--body-sm)",
                color: "var(--text-primary)",
                background: "var(--bg)",
                outline: "none",
              }}
            />
          </div>

          {/* Lista */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && (
              <div style={{ padding: 20, textAlign: "center",
                            color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Cargando contrapartes..." : "Loading counterparties..."}
              </div>
            )}
            {error && (
              <div style={{ padding: 20, textAlign: "center",
                            color: "var(--critical)" }}>
                {error}
              </div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: "center",
                            color: "var(--text-tertiary)" }}>
                {search
                  ? (lang === "es" ? "Sin resultados para esa búsqueda." : "No matches.")
                  : (lang === "es" ? "Sin contrapartes." : "No counterparties.")}
              </div>
            )}
            {!loading && !error && grouped.map(([type, items]) => (
              <div key={type}>
                {/* Group header */}
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                    background: "var(--bg-alt)",
                    borderBottom: "1px solid var(--divider)",
                  }}
                >
                  {getEnumLabel(COUNTERPARTY_TYPE_LABELS, type, lang)}{' '}
                  <span style={{ opacity: 0.7 }}>· {items.length}</span>
                </div>
                {items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => handleSelect(it)}
                    className="cp-picker__option"
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "transparent",
                      border: 0,
                      borderBottom: "1px solid var(--divider)",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "background 100ms ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary)",
                                    overflow: "hidden", textOverflow: "ellipsis",
                                    whiteSpace: "nowrap" }}>
                        {it.label}
                      </div>
                      {(it.subtitle || it.country_iso2) && (
                        <div className="tabular-nums"
                             style={{ color: "var(--text-tertiary)", fontSize: 11,
                                      marginTop: 2 }}>
                          {it.country_iso2 && <span>{it.country_iso2} · </span>}
                          {it.subtitle}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Footer con count */}
          {!loading && !error && filtered.length > 0 && (
            <div style={{ padding: "6px 12px", fontSize: 11,
                          color: "var(--text-tertiary)",
                          borderTop: "1px solid var(--divider)",
                          background: "var(--bg-alt)" }}>
              {filtered.length} {lang === "es"
                ? (filtered.length === 1 ? "contraparte" : "contrapartes")
                : (filtered.length === 1 ? "counterparty" : "counterparties")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
