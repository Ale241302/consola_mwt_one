// MWT.ONE · lib/a11y/useDialogA11y.js
// Focus trap + Escape + restauración de foco para modales, sin dependencias.
// La lógica pura del trap vive en dialogLogic.js (testeable sin React).
// Ola 3 · 3.25 · Accesibilidad.
import { useEffect, useRef } from "react";
import {
  getFocusables,
  handleTabInDialog,
  isEscape,
} from "./dialogLogic.js";

export function useDialogA11y({ open, onClose }) {
  const ref = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const node = ref.current;
    // foco inicial: primer focusable o el contenedor
    (getFocusables(node)[0] || node)?.focus?.();

    function onKeyDown(e) {
      if (isEscape(e)) { e.stopPropagation(); onClose?.(); return; }
      const action = handleTabInDialog(e, node);
      if (action === "prevent") { e.preventDefault(); return; }
      if (action === "focus-last") {
        e.preventDefault();
        getFocusables(node).at(-1)?.focus?.();
        return;
      }
      if (action === "focus-first") {
        e.preventDefault();
        getFocusables(node)[0]?.focus?.();
      }
    }
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();   // restaura foco al disparador
    };
  }, [open, onClose]);

  return ref; // spread en el contenedor del diálogo
}
