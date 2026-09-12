// =====================================================================
// MWT.ONE · components/clientes/ComisionesFamiliaSection.jsx
// K2 · Comisiones por Marca y Familia (multi-%).
// CEO/ADMIN-only. Editor controlado: value=[{brand_id, familia, commission_pct}]
// =====================================================================
import React, { useEffect, useState } from "react";
import { marcasApi } from "../../lib/api.js";
import { IconPlus, IconTrash } from "../../lib/icons.jsx";

const MUTED = "var(--text-tertiary)";
const BORDER = "var(--border)";

export default function ComisionesFamiliaSection({ value = [], onChange, lang = "es" }) {
  const [brands, setBrands] = useState([]);

  useEffect(() => {
    let cancel = false;
    marcasApi.list()
      .then((d) => { if (!cancel) setBrands(Array.isArray(d) ? d : (d?.results || [])); })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  const rows = Array.isArray(value) ? value : [];
  const patch = (i, k, v) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r));
    onChange(next);
  };
  const addRow = () => onChange([...rows, { brand_id: null, familia: "", commission_pct: 0 }]);
  const delRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  const es = lang === "es";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="caption" style={{ color: MUTED }}>
        {es
          ? "Define el % por Marca y/o Familia (la familia sale del modelo del producto, ej. 70B22). Si dejas Marca/Familia vacías, aplica a todo."
          : "Set the % by Brand and/or Family (family = product model, e.g. 70B22). Empty Brand/Family = applies to all."}
      </div>

      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>{es ? "Marca" : "Brand"}</th>
            <th>{es ? "Familia" : "Family"}</th>
            <th style={{ width: 120, textAlign: "right" }}>%</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="caption" style={{ color: MUTED, padding: "10px 12px" }}>
                {es ? "Sin reglas. Agrega una." : "No rules. Add one."}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select
                  value={r.brand_id || ""}
                  onChange={(e) => patch(i, "brand_id", e.target.value || null)}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${BORDER}`, borderRadius: 8 }}
                >
                  <option value="">{es ? "Todas las marcas" : "All brands"}</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.nombre || b.codigo || b.id}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={r.familia || ""}
                  placeholder={es ? "Todas (ej. 50B19)" : "All (e.g. 50B19)"}
                  onChange={(e) => patch(i, "familia", e.target.value.toUpperCase())}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: "var(--font-mono)" }}
                />
              </td>
              <td>
                <input
                  type="number" step="0.01" min={0} max={100}
                  value={r.commission_pct != null ? Number(r.commission_pct) * 100 : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch(i, "commission_pct", v === "" ? 0 : Number(v) / 100);
                  }}
                  style={{ width: "100%", padding: "6px 8px", textAlign: "right", border: `1px solid ${BORDER}`, borderRadius: 8 }}
                />
              </td>
              <td>
                <button type="button" className="icon-btn" title={es ? "Eliminar" : "Delete"}
                        onClick={() => delRow(i)}>
                  <IconTrash size={13}/>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
          <IconPlus size={13}/> {es ? "Agregar regla" : "Add rule"}
        </button>
      </div>
    </div>
  );
}
