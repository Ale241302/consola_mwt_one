// =====================================================================
// tests/api_fetch.test.mjs
// Contrato cubierto: src/lib/api.js — transporte HTTP de apiFetch.
//   · Construcción de URL/headers/body (Bearer, Content-Type, merge).
//   · AbortError: se propaga tal cual, NUNCA se reintenta ni se
//     convierte en ApiError.
//   · El AbortSignal del caller se pasa al fetch nativo (opts.signal).
//   · Falla de red / status transitorios (502/503/…): retry 1x SOLO
//     para métodos idempotentes (GET); POST nunca se reintenta.
//   · Parseo de errores: detail > message > error > "HTTP <status>".
//   · getToken(): bundle mwt-auth canónico + fallbacks legacy.
// Timers controlados con t.mock.timers (el retry duerme 1000 ms).
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installBrowserEnv, uninstallBrowserEnv, installFetch,
  jsonResponse, textResponse, makeAbortError, freshImport, flushAsync,
} from "./helpers/env.mjs";

const BUNDLE = "../.build/api.real.mjs";

test("GET: URL con API_BASE, headers Bearer + custom, sin body", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, { hello: 1 }));
  const api = await freshImport(BUNDLE);

  const data = await api.apiFetch("/expedientes/?limit=5", {
    token: "T1", headers: { "X-Custom": "abc" },
  });
  assert.deepEqual(data, { hello: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/expedientes/?limit=5");
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer T1");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  assert.equal(calls[0].opts.headers["X-Custom"], "abc");
  assert.equal(calls[0].opts.body, undefined);
  uninstallBrowserEnv();
});

test("POST: body objeto → JSON.stringify; body string → tal cual", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);

  await api.apiFetch("/x/", { method: "POST", body: { a: 1 } });
  assert.equal(calls[0].opts.body, JSON.stringify({ a: 1 }));
  await api.apiFetch("/x/", { method: "POST", body: '{"raw":true}' });
  assert.equal(calls[1].opts.body, '{"raw":true}');
  uninstallBrowserEnv();
});

test("X-Viewport-Role: se manda solo con override CLIENT/ADMIN válido", async () => {
  installBrowserEnv({ roleOverride: "CLIENT" });
  let calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  await api.apiFetch("/x/", {});
  assert.equal(calls[0].opts.headers["X-Viewport-Role"], "CLIENT");

  // Valor no reconocido → no se manda header.
  installBrowserEnv({ roleOverride: "HACKER" });
  calls = installFetch(() => jsonResponse(200, {}));
  await api.apiFetch("/x/", {});
  assert.equal(calls[0].opts.headers["X-Viewport-Role"], undefined);
  uninstallBrowserEnv();
});

test("respuesta no-JSON → {raw: texto}; respuesta vacía → null", async () => {
  installBrowserEnv({});
  let n = 0;
  installFetch(() => (++n === 1 ? textResponse(200, "<html>oops</html>") : textResponse(200, "")));
  const api = await freshImport(BUNDLE);
  assert.deepEqual(await api.apiFetch("/x/", {}), { raw: "<html>oops</html>" });
  assert.equal(await api.apiFetch("/x/", {}), null);
  uninstallBrowserEnv();
});

test("AbortError se propaga idéntico: sin retry, sin convertir a ApiError", async () => {
  installBrowserEnv({});
  const abortErr = makeAbortError();
  const calls = installFetch(() => { throw abortErr; });
  const api = await freshImport(BUNDLE);

  await assert.rejects(
    () => api.apiFetch("/expedientes/", {}),
    (e) => e === abortErr && !(e instanceof api.ApiError),
    "debe ser EXACTAMENTE el mismo AbortError",
  );
  assert.equal(calls.length, 1, "un abort jamás se reintenta (ni siquiera GET)");
  uninstallBrowserEnv();
});

test("el AbortSignal del caller llega al fetch nativo (opts.signal)", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  const ctrl = new AbortController();
  await api.apiFetch("/x/", { signal: ctrl.signal });
  assert.equal(calls[0].opts.signal, ctrl.signal, "mismo signal, sin clonar");
  uninstallBrowserEnv();
});

test("falla de red en GET → retry 1x tras 1s y devuelve el 2º intento", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installBrowserEnv({});
  let n = 0;
  const calls = installFetch(() => {
    if (++n === 1) throw new TypeError("Failed to fetch");
    return jsonResponse(200, { recovered: true });
  });
  const api = await freshImport(BUNDLE);

  const p = api.apiFetch("/expedientes/", {});
  await flushAsync();            // 1ª falla procesada → _sleep(1000) agendado
  t.mock.timers.tick(1000);      // despertar el retry
  assert.deepEqual(await p, { recovered: true });
  assert.equal(calls.length, 2);
  uninstallBrowserEnv();
});

test("falla de red x2 en GET → ApiError status 0, exactamente 2 intentos", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installBrowserEnv({});
  const calls = installFetch(() => { throw new TypeError("Failed to fetch"); });
  const api = await freshImport(BUNDLE);

  const p = api.apiFetch("/expedientes/", {}).then(() => null, (e) => e);
  await flushAsync();
  t.mock.timers.tick(1000);
  const err = await p;
  assert.ok(err instanceof api.ApiError);
  assert.equal(err.status, 0);
  assert.equal(err.message, "No se pudo contactar al servidor");
  assert.equal(calls.length, 2, "solo UN retry transitorio");
  uninstallBrowserEnv();
});

test("falla de red en POST → NO se reintenta (no idempotente)", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => { throw new TypeError("Failed to fetch"); });
  const api = await freshImport(BUNDLE);
  await assert.rejects(
    () => api.apiFetch("/x/", { method: "POST", body: {} }),
    (e) => e instanceof api.ApiError && e.status === 0,
  );
  assert.equal(calls.length, 1, "una mutación jamás se duplica por retry");
  uninstallBrowserEnv();
});

test("503 (deploy en curso) en GET → retry 1x y éxito", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installBrowserEnv({});
  let n = 0;
  const calls = installFetch(() =>
    (++n === 1 ? jsonResponse(503, { detail: "upstream down" }) : jsonResponse(200, { up: true })));
  const api = await freshImport(BUNDLE);

  const p = api.apiFetch("/expedientes/", {});
  await flushAsync();
  t.mock.timers.tick(1000);
  assert.deepEqual(await p, { up: true });
  assert.equal(calls.length, 2);
  uninstallBrowserEnv();
});

test("503 persistente en GET → ApiError 503 tras el único retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(503, { detail: "still down" }));
  const api = await freshImport(BUNDLE);

  const p = api.apiFetch("/expedientes/", {}).then(() => null, (e) => e);
  await flushAsync();
  t.mock.timers.tick(1000);
  const err = await p;
  assert.ok(err instanceof api.ApiError);
  assert.equal(err.status, 503);
  assert.equal(calls.length, 2);
  uninstallBrowserEnv();
});

test("503 en POST → ApiError inmediato, sin retry", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(503, { detail: "down" }));
  const api = await freshImport(BUNDLE);
  await assert.rejects(
    () => api.apiFetch("/x/", { method: "POST", body: {} }),
    (e) => e instanceof api.ApiError && e.status === 503,
  );
  assert.equal(calls.length, 1);
  uninstallBrowserEnv();
});

test("mensaje de error: detail > message > error > 'HTTP <status>'", async () => {
  installBrowserEnv({});
  const bodies = [
    [{ detail: "D", message: "M", error: "E" }, "D"],
    [{ message: "M", error: "E" }, "M"],
    [{ error: "E" }, "E"],
    [{}, "HTTP 422"],
  ];
  let i = 0;
  installFetch(() => jsonResponse(422, bodies[i++][0]));
  const api = await freshImport(BUNDLE);
  for (const [, expected] of bodies) {
    await assert.rejects(
      () => api.apiFetch("/x/", { method: "POST", body: {} }),
      (e) => e instanceof api.ApiError && e.message === expected && e.status === 422,
    );
  }
  uninstallBrowserEnv();
});

test("getToken: bundle canónico, bundle corrupto y fallbacks legacy", async () => {
  const { ls } = installBrowserEnv({ auth: { access: "ACC1", refresh: "R" } });
  const api = await freshImport(BUNDLE);
  assert.equal(api.getToken(), "ACC1", "camino canónico: mwt-auth.access");

  ls.setItem("mwt-auth", JSON.stringify({ token: "TOK2" }));
  assert.equal(api.getToken(), "TOK2", "shape alterno: .token");

  ls.setItem("mwt-auth", "{corrupto");
  ls.setItem("mwt_access", "LEG3");
  assert.equal(api.getToken(), "LEG3", "JSON corrupto → fallback legacy");

  ls.clear();
  assert.equal(api.getToken(), null, "sin nada → null");
  uninstallBrowserEnv();
});
