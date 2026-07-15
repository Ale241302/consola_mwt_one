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

/** Sprint 2026-07-15 (CEO) · normaliza códigos de OC mal registrados:
 * "POC 504978" → "PO 504978". El prefijo canónico del PO del cliente es
 * "PO"; algunos registros históricos entraron con "POC" (typo/OCR). */
function _normalizeOcCode(value) {
  return String(value ?? "").replace(/^\s*POC(?=[\s\-_.]|\d)/i, "PO");
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
  const ocs       = (Array.isArray(e.oc_codigos)      ? e.oc_codigos       : [])
    .map(_normalizeOcCode);
  const saps      = Array.isArray(e.sap_codigos)      ? e.sap_codigos      : [];

  const labels = {
    pf:  "PF",                       // mismo en ES/EN
    oc:  lang === "es" ? "OC" : "PO",
    sap: "SAP",
  };

  // Sprint 2026-06-04 (CEO) · el título PRINCIPAL es role-aware (R3):
  //   ADMIN / CEO → la Proforma (PF) del expediente.
  //   CLIENT_*    → su PO (oc_codigos[0]).
  // Fallbacks: si falta el principal, PO → EXP-. Los demás códigos bajan a
  // chips y nunca se duplican con el head.
  const primaryPf = proformas.length > 0 ? proformas[0] : null;
  const primaryOc = ocs.length > 0 ? ocs[0] : null;

  let headRaw, headKind;
  if (isAdmin && primaryPf) {
    headRaw = primaryPf; headKind = "pf";
  } else if (primaryOc) {
    headRaw = primaryOc; headKind = "oc";
  } else {
    headRaw = e.codigo; headKind = "exp";
  }
  // La proforma se persiste como "2454-2026" (sin prefijo); el head debe
  // leerse "PF 2454-2026". El PO ya trae su propio prefijo en el valor.
  const headValue = headKind === "pf" && !/^pf[\s_-]/i.test(String(headRaw))
    ? `PF ${headRaw}`
    : headRaw;

  // Chips: todos los códigos menos el que ya ocupa el head.
  const pfChips = (isAdmin ? proformas : []).filter((c) => !(headKind === "pf" && c === headRaw));
  const ocChips = ocs.filter((c) => !(headKind === "oc" && c === headRaw));
  // Sprint 2026-06-11 (CEO) · el código EXP interno NO se muestra al
  // cliente (R3): su referencia es la PO. Staff lo sigue viendo.
  const showExpChip = isAdmin && headKind !== "exp";

  const hasChips = showExpChip ||
                   pfChips.length > 0 ||
                   ocChips.length > 0 ||
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
        <span className="ref-cell__code font-mono tabular-nums">{headValue}</span>
      </div>

      {hasChips && (
        <div className="ref-cell__chips">
          {/* EXP interno — chip salvo que el head ya sea el EXP. */}
          {showExpChip && (
            <RefChip kind="exp" label="EXP" value={e.codigo} />
          )}

          {/* Proformas — CEO-ONLY (R3). Excluye la que ocupa el head. */}
          {pfChips.map((c) => (
            <RefChip key={`pf-${c}`} kind="proforma" label={labels.pf} value={c} />
          ))}

          {/* OCs — visible a todos los roles. Excluye la que ocupa el head. */}
          {ocChips.map((c) => (
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
