// MWT.ONE · lib/a11y/useAutoId.js
// Id estable y único para asociar label→control (wrapper de React.useId).
// Ola 3 · 3.25 · Accesibilidad.
import { useId } from "react";

export function useAutoId(prefix = "fld") {
  const id = useId();
  return `${prefix}-${id}`;
}
