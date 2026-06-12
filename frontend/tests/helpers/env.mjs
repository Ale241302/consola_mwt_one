// =====================================================================
// tests/helpers/env.mjs
// Shims de entorno navegador (localStorage, window, fetch) para poder
// ejecutar los bundles de src/lib bajo `node --test` sin tocar src/.
// Cada test instala su propio entorno limpio (installBrowserEnv) y un
// fetch programable (installFetch) que registra todas las llamadas.
// =====================================================================

/** localStorage/sessionStorage mínimo compatible con lo que usa api.js. */
export function makeStorage(init = {}) {
  const store = new Map(Object.entries(init));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    has: (k) => store.has(k),
  };
}

/**
 * Instala window + localStorage globales.
 * @param {object} [opts]
 * @param {object} [opts.auth]   bundle {user, access, refresh} → localStorage["mwt-auth"]
 * @param {string} [opts.roleOverride] valor para sessionStorage["mwt-role-override"]
 */
export function installBrowserEnv({ auth, roleOverride } = {}) {
  const ls = makeStorage(auth ? { "mwt-auth": JSON.stringify(auth) } : {});
  const ss = makeStorage(roleOverride ? { "mwt-role-override": roleOverride } : {});
  const events = [];
  const win = {
    sessionStorage: ss,
    location: { pathname: "/test-path" },
    dispatchEvent: (ev) => { events.push(ev); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
  return { ls, ss, events, win };
}

/** Desinstala los shims (defensa entre tests del mismo proceso). */
export function uninstallBrowserEnv() {
  delete globalThis.localStorage;
  delete globalThis.window;
}

/**
 * Instala un fetch falso. `handler(url, opts, n)` decide la respuesta
 * (puede devolver promesa o lanzar). Devuelve el array de llamadas
 * registradas: [{url, opts}].
 */
export function installFetch(handler) {
  const calls = [];
  globalThis.fetch = (url, opts = {}) => {
    calls.push({ url, opts });
    // Envolver en promesa para que un throw síncrono se vuelva rechazo,
    // igual que el fetch real.
    return Promise.resolve().then(() => handler(url, opts, calls.length));
  };
  return calls;
}

/** Respuesta estilo fetch con solo lo que api.js consume (ok/status/text). */
export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

/** Respuesta con cuerpo de texto crudo (no JSON). */
export function textResponse(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** Error con name=AbortError, como el que produce AbortController. */
export function makeAbortError() {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Import con cache-busting: cada llamada devuelve una instancia FRESCA
 * del módulo (estado module-level reseteado: _refreshPromise, _times…).
 * @param {string} relPath ruta relativa a este helper.
 */
let _seq = 0;
export async function freshImport(relPath) {
  const url = new URL(relPath, import.meta.url);
  url.searchParams.set("fresh", String(++_seq));
  return import(url.href);
}

/** Deja drenar la cola de microtareas + una macrotarea (setImmediate real). */
export function flushAsync() {
  return new Promise((r) => setImmediate(r));
}
