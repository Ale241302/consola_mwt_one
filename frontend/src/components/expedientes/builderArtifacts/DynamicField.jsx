// =====================================================================
// MWT.ONE · DynamicField — renderiza UN campo del structure_json.
// Tipos soportados (alineados con Builder Preview.jsx):
//   text · textarea · number · date · select · radio · checkbox ·
//   code · file
// =====================================================================
import React from "react";

function normalizeOptions(opts) {
  if (!Array.isArray(opts)) return [];
  return opts.map((o, i) =>
    typeof o === "string"
      ? { id: `opt-${i}`, label: o }
      : { id: o.id || `opt-${i}`, label: o.label ?? String(o) }
  );
}

export default function DynamicField({ field, value, onChange, disabled, lang = "es" }) {
  const handle = (v) => onChange?.(v);
  const ph = field.placeholder || (lang === "es" ? "" : "");

  switch (field.type) {
    case "text":
      return (
        <input
          className="input"
          type="text"
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "textarea":
      return (
        <textarea
          className="input"
          rows={4}
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <input
          className="input tabular"
          type="number"
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) =>
            handle(e.target.value === "" ? null : Number(e.target.value))
          }
          disabled={disabled}
        />
      );

    case "date":
      return (
        <input
          className="input tabular"
          type="date"
          value={value ?? ""}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "select": {
      const opts = normalizeOptions(field.options);
      return (
        <select
          className="select"
          value={value ?? ""}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        >
          <option value="">
            {lang === "es" ? "— seleccionar —" : "— select —"}
          </option>
          {opts.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    case "radio": {
      const opts = normalizeOptions(field.options);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {opts.map((o) => (
            <label
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-primary)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name={field.id}
                checked={value === o.label}
                onChange={() => handle(o.label)}
                disabled={disabled}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    case "checkbox":
      return (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--text-primary)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => handle(e.target.checked)}
            disabled={disabled}
            style={{ accentColor: "var(--brand-primary)" }}
          />
          {field.placeholder || field.label}
        </label>
      );

    case "code":
      return (
        <textarea
          className="input"
          rows={8}
          spellCheck={false}
          value={value ?? field.code ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
          style={{
            fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
      );

    case "file":
      // Upload simple: guarda el nombre del archivo en `data`. Cuando el
      // backend de uploads esté listo, reemplazar por POST a /api/uploads/.
      return (
        <input
          className="input"
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) {
              handle(null);
              return;
            }
            handle({
              file_id: `pending-${Date.now()}`,
              file_name: f.name,
              size: f.size,
              url: "",
            });
          }}
          disabled={disabled}
        />
      );

    default:
      return (
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Tipo no soportado:" : "Unsupported type:"}{" "}
          {field.type}
        </span>
      );
  }
}
