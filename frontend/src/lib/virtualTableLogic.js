// MWT.ONE · lib/virtualTableLogic.js
// Regla de decisión pura de VirtualTable — testeable sin DOM.
// Ola 3 · 3.27 · Virtualización.
export const DEFAULT_THRESHOLD = 60;

/** ¿Debe virtualizarse? Solo si hay suficientes filas y no estamos imprimiendo. */
export function shouldVirtualize(rowsLength, threshold = DEFAULT_THRESHOLD, printing = false) {
  return Number(rowsLength) >= Number(threshold) && !printing;
}
