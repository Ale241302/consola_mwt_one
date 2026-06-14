// =====================================================================
// MWT.ONE · swrCache — caché stale-while-revalidate para lecturas GET
// Agente responsable: [AG-FRONTEND]
//
// Problema (Auditoría de carga · 2026-06-14): cada navegación a una vista
// re-fetchea desde cero y la pantalla se queda EN BLANCO 1-2 s. No había
// ninguna capa de caché de cliente (ni React Query ni SWR).
//
// Esta utilidad da una caché mínima, sin dependencias, con semántica
// stale-while-revalidate:
//   1. La vista pinta AL INSTANTE el último valor conocido (si existe).
//   2. En segundo plano revalida contra el API y actualiza cuando llega.
//
// Capas:
//   · in-memory (Map)        → instantáneo durante la sesión SPA.
//   · sessionStorage         → sobrevive recargas de pestaña (no entre
//                              pestañas distintas; se limpia al cerrarla).
//
// Scope: SOLO datos read-only no sensibles de listados/dashboard. El valor
// se serializa a JSON, así que no guardes Blobs ni instancias.
// =====================================================================

const PREFIX = "mwt-swr:";
const _mem = new Map(); // key -> { v: value, t: epochMs }

function _readSession(key) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return undefined;
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined; // modo privado / cuota / JSON corrupto → ignorar
  }
}

function _writeSession(key, entry) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* cuota llena o privacy mode → la caché en memoria sigue valiendo */
  }
}

/**
 * Lee el último valor cacheado para `key`.
 * @param {string} key
 * @param {number} [maxAgeMs] Si se pasa, descarta entradas más viejas que
 *   esto (devuelve undefined). Si se omite, devuelve el valor sin importar
 *   la edad (SWR puro: pinta lo último y deja que el caller revalide).
 * @returns {*} el valor cacheado o undefined.
 */
export function readCache(key, maxAgeMs) {
  let entry = _mem.get(key);
  if (!entry) {
    entry = _readSession(key);
    if (entry) _mem.set(key, entry); // promociona a memoria
  }
  if (!entry) return undefined;
  if (maxAgeMs != null && Date.now() - entry.t > maxAgeMs) return undefined;
  return entry.v;
}

/**
 * Guarda `value` bajo `key` en ambas capas.
 * @param {string} key
 * @param {*} value valor serializable a JSON.
 */
export function writeCache(key, value) {
  const entry = { v: value, t: Date.now() };
  _mem.set(key, entry);
  _writeSession(key, entry);
}

/**
 * Invalida una entrada concreta (tras una mutación POST/PATCH/DELETE).
 * @param {string} key
 */
export function invalidateCache(key) {
  _mem.delete(key);
  try {
    window.sessionStorage?.removeItem(PREFIX + key);
  } catch { /* ignore */ }
}

/**
 * Limpia toda la caché SWR (p.ej. en logout). No toca otras keys.
 */
export function clearCache() {
  _mem.clear();
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    const ss = window.sessionStorage;
    for (let i = ss.length - 1; i >= 0; i--) {
      const k = ss.key(i);
      if (k && k.startsWith(PREFIX)) ss.removeItem(k);
    }
  } catch { /* ignore */ }
}

// Higiene de sesión (R3): al cerrar sesión purgamos toda la caché para que
// los datos de un usuario nunca sobrevivan al siguiente en la misma máquina.
// AuthContext emite "mwt-auth-logout" en window al hacer logout/forzar salida.
try {
  if (typeof window !== "undefined") {
    window.addEventListener("mwt-auth-logout", clearCache);
  }
} catch { /* SSR → no-op */ }

export default { readCache, writeCache, invalidateCache, clearCache };
