// MWT.ONE · components/ui/Field.jsx
// Cablea htmlFor/id automáticamente; el hijo recibe los props vía render-prop.
// Ola 3 · 3.25 · Accesibilidad.
import React from "react";
import { useAutoId } from "../../lib/a11y/useAutoId.js";

export default function Field({ label, hint, error, required, children }) {
  const id = useAutoId("field");
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`mwt-field${error ? " is-error" : ""}`}>
      <label htmlFor={id} className="mwt-field-label">
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, "aria-describedby": descId, "aria-invalid": !!error, required })}
      {(hint || error) && <p id={descId} className="mwt-field-hint">{error || hint}</p>}
    </div>
  );
}
