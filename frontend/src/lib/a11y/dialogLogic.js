// MWT.ONE · lib/a11y/dialogLogic.js
// Lógica pura del focus trap — sin React, testeable bajo node --test.
// Ola 3 · 3.25 · Accesibilidad.
export const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),' +
  'input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Devuelve los elementos focusables dentro de `root` (en orden de documento). */
export function getFocusables(root) {
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE));
}

/**
 * Maneja la tecla Tab dentro del diálogo y devuelve qué foco aplicar.
 * @param {KeyboardEvent} e
 * @param {Element} root
 * @returns {"prevent"|"focus-first"|"focus-last"|null} acción a aplicar
 */
export function handleTabInDialog(e, root) {
  if (e.key !== "Tab") return null;
  const f = getFocusables(root);
  if (f.length === 0) return "prevent";
  const first = f[0], last = f[f.length - 1];
  const active = e.target;
  if (e.shiftKey && active === first) return "focus-last";
  if (!e.shiftKey && active === last) return "focus-first";
  return null;
}

/** Tecla Escape: el diálogo debe cerrarse (siempre, pase lo que pase). */
export function isEscape(e) {
  return e?.key === "Escape";
}
