// frontend/src/lib/errorReporter.js
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 · Auditoría Fable5 (WAVE C) — Observabilidad
// self-hosted (equivalente Sentry, sin dependencia externa).
// Reporta crashes de render (ErrorBoundary) y errores globales
// (window.onerror / unhandledrejection) a
// POST /api/analytics/client-errors/ → analytics.client_error_log (E6).
//
// Garantías: best-effort (jamás lanza), throttled (máx 5 reportes por
// minuto para no inundar ante un error en loop) y truncado server-side.
// ─────────────────────────────────────────────────────────────────────
import { apiFetch, getToken } from "./api.js";

let _times = [];

export function reportClientError(message, stack, path) {
  try {
    const now = Date.now();
    _times = _times.filter((t) => now - t < 60000);
    if (_times.length >= 5) return;   // throttle 5/min
    _times.push(now);
    apiFetch("/analytics/client-errors/", {
      method: "POST",
      token: getToken(),
      body: {
        message: String(message || "").slice(0, 2000),
        stack: String(stack || "").slice(0, 8000),
        path: path || (typeof window !== "undefined" ? window.location.pathname : ""),
      },
    }).catch(() => { /* best-effort */ });
  } catch { /* nunca romper al caller */ }
}
