// =====================================================================
// MWT.ONE · RefCell.jsx
//
// Celda REF de la tabla /expedientes — Sprint 2026-05-17.
//
// Muestra el EXP-YYYY-NNNN principal + chips apilados con los códigos
// asociados al expediente, role-gated según POL_VISIBILIDAD (R3):
//
//   ADMIN / CEO / staff  → REF + proformas[] + ocs[] + saps[]
//   CLIENT_* (Portal B2B)→ REF + ocs[]
//
// Reglas honradas:
//   R1 — Cero hex hardcodeados (todo en CSS vars o clases tematizadas)
//   R5 — Tipografía de precisión (font-mono + tabular-nums en chips)
//
// El componente NO decide qué chips renderiza; consume los arrays que el
// backend envía en el listado. Si el backend devuelve [], el chip no
// aparece — esto cumple R4 (policy-driven) y R3 (los datos sensibles ni
// siquiera llegan al DOM cuando el viewer es CLIENT_*).
// =====================================================================
import React from "react";

/**
 * @typedef {Object} RefCellExpediente
 * @property {string}   codigo
 * @property {string[]} [proforma_codigos]   visible solo si isAdmin
 * @property {string[]} [oc_codigos]         visible para todos los roles
 * @property {string[]} [sap_codigos]        visible solo si isAdmin
 * @property {boolean}  [is_blocked]
 */

/**
 * @typedef {Object} RefCellProps
 * @property {RefCellExpediente}       expediente
 * @property {boolean}                 isAdmin
 * @property {(code:string)=>void}     [onClickOc]   handler para abrir OC detail
 * @property {string}                  [lang]        'es' | 'en'
 */

/** Detecta si el `value` ya empieza con el prefijo del `label` —
 * en cuyo caso renderizar el label seria duplicacion visual.
 *
 * Sprint 2026-05-30 (CEO): "OC PO 504802" debe ser solo "PO 504802"
 * porque el codigo del cliente ya lleva su propio prefijo (PO/POC/PF/SAP).
 *
 * Comparamos uppercase, sin espacios. Acepta: "PO 504802", "PO-2026-001",
 * "POC 504978", "PF 2473", "SAP 263360", "SAP263360".
 */
function _labelRedundante(label, value) {
  if (!label || !value) return false;
  const v = String(value).trim().toUpperCase();
  const lbl = String(label).trim().toUpperCase();
  if (!v || !lbl) return false;
  // OC: tambien aceptar PO y POC como prefijos validos (PO Number Cliente).
  if (lbl === "OC" || lbl === "PO") {
    return v.startsWith("PO ") || v.startsWith("PO-")
        || v.startsWith("POC ") || v.startsWith("POC-")
        || v.startsWith("OC ") || v.startsWith("OC-");
  }
  // PF: directo.
  if (lbl === "PF") {
    return v.startsWith("PF ") || v.startsWith("PF-") || v.startsWith("PF_");
  }
  // SAP: directo, con o sin separador.
  if (lbl === "SAP") {
    return v.startsWith("SAP ") || v.startsWith("SAP-") || v.startsWith("SAP_") || v.startsWith("SAP");
  }
  // Caso generico
  return v.startsWith(lbl + " ") || v.startsWith(lbl + "-");
}

/** Chip individual — usa tokens MWT, cero hex literales. */
function RefChip({ kind, label, value, onClick, title }) {
  const klass = "ref-chip ref-chip--" + kind + (onClick ? " ref-chip--link" : "");
  // Sprint 2026-05-30 (CEO): si el value ya trae el prefijo del label,
  // omitir el label para evitar "OC PO 504802" -> mostrar "PO 504802".
  const showLabel = !_labelRedundante(label, value);
  return (
    <span
      className={klass}
      onClick={onClick ? (ev) => { ev.stopPropagation(); onClick(value); } : undefined}
      title={title || `${label}: ${value}`}
    >
      {showLabel && <span className="ref-chip__label">{label}</span>}
      <span className="ref-chip__value font-mono tabular-nums">{value}</span>
    </span>
  );
}

/**
 * RefCell — celda REF de la tabla de expedientes.
 *
 * @param {RefCellProps} props
 */
export function RefCell({ expediente, isAdmin, onClickOc, lang = "es" }) {
  if (!expediente) return null;
  const e         = expediente;
  const proformas = Array.isArray(e.proforma_codigos) ? e.proforma_codigos : [];
  const ocs       = Array.isArray(e.oc_codigos)       ? e.oc_codigos       : [];
  const saps      = Array.isArray(e.sap_codigos)      ? e.sap_codigos      : [];

  const labels = {
    pf:  "PF",                       // mismo en ES/EN
    oc:  lang === "es" ? "OC" : "PO",
    sap: "SAP",
  };

  const hasChips = (isAdmin && proformas.length > 0) ||
                   ocs.length > 0 ||
                   (isAdmin && saps.length > 0);

  return (
    <div className="ref-cell">
      <div className="ref-cell__head">
        {e.is_blocked && (
          <span
            className="ref-cell__lock"
            title={lang === "es" ? "Expediente bloqueado" : "File blocked"}
            aria-label="blocked"
          >🔒</span>
        )}
        <span className="ref-cell__code font-mono tabular-nums">{e.codigo}</span>
      </div>

      {hasChips && (
        <div className="ref-cell__chips">
          {/* Proformas — CEO-ONLY (R3) */}
          {isAdmin && proformas.map((c) => (
            <RefChip key={`pf-${c}`} kind="proforma" label={labels.pf} value={c} />
          ))}

          {/* OCs — visible a todos los roles */}
          {ocs.map((c) => (
            <RefChip
              key={`oc-${c}`}
              kind="oc"
              label={labels.oc}
              value={c}
              onClick={onClickOc}
            />
          ))}

          {/* SAPs — CEO-ONLY (R3) */}
          {isAdmin && saps.map((c) => (
            <RefChip key={`sap-${c}`} kind="sap" label={labels.sap} value={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export default RefCell;
