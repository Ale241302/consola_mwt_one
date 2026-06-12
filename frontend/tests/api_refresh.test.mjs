// =====================================================================
// tests/api_refresh.test.mjs
// Contrato cubierto: src/lib/api.js — refresh silencioso del JWT.
//   · 401 → UN refresh → retry de la request original UNA sola vez.
//   · El retry nunca encadena un segundo refresh (_isRetry).
//   · Refresh fallido → emitForcedLogout (borra mwt-auth + evento).
//   · Single-flight: N llamadas simultáneas con 401 → UN solo POST
//     a /auth/refresh/ (_refreshPromise compartida).
//   · Sin refresh token (o sesión dev-local) → no se intenta refrescar.
//   · Las rutas /auth/* jamás disparan refresh (anti-bucle).
// El módulo se carga como bundle esbuild (tests/.build/api.real.mjs)
// porque api.js usa import.meta.env (Vite).
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installBrowserEnv, uninstallBrowserEnv, installFetch,
  jsonResponse, freshImport, flushAsync,
} from "./helpers/env.mjs";

const BUNDLE = "../.build/api.real.mjs";
const AUTH = { user: { id: 1 }, access: "OLD_ACCESS", refresh: "REFRESH_OK" };

test("401 → refresh → retry exitoso con el access nuevo (una sola vez)", async () => {
  const { ls, events } = installBrowserEnv({ auth: AUTH });
  const calls = installFetch((url, opts) => {
    if (url === "/api/auth/refresh/") return jsonResponse(200, { access: "NEW_ACCESS" });
    // La request original: 401 con el token viejo, 200 con el nuevo.
    if (opts.headers.Authorization === "Bearer NEW_ACCESS") return jsonResponse(200, { ok: true });
    return jsonResponse(401, { detail: "token expirado" });
  });
  const api = await freshImport(BUNDLE);

  const data = await api.apiFetch("/expedientes/", { token: "OLD_ACCESS" });
  assert.deepEqual(data, { ok: true });

  const refreshCalls = calls.filter((c) => c.url === "/api/auth/refresh/");
  const origCalls = calls.filter((c) => c.url === "/api/expedientes/");
  assert.equal(refreshCalls.length, 1, "exactamente un refresh");
  assert.equal(origCalls.length, 2, "original + un retry");
  assert.equal(origCalls[1].opts.headers.Authorization, "Bearer NEW_ACCESS");

  // El access nuevo quedó persistido en el bundle mwt-auth…
  const bundle = JSON.parse(ls.getItem("mwt-auth"));
  assert.equal(bundle.access, "NEW_ACCESS");
  // …y se notificó al AuthContext vía evento.
  assert.ok(events.some((e) => e.type === "mwt-auth-refreshed"));
  uninstallBrowserEnv();
});

test("retry que vuelve a dar 401 NO encadena un segundo refresh", async () => {
  installBrowserEnv({ auth: AUTH });
  const calls = installFetch((url) => {
    if (url === "/api/auth/refresh/") return jsonResponse(200, { access: "NEW_ACCESS" });
    return jsonResponse(401, { detail: "sigue sin permiso" }); // siempre 401
  });
  const api = await freshImport(BUNDLE);

  await assert.rejects(
    () => api.apiFetch("/expedientes/", { token: "OLD_ACCESS" }),
    (e) => e instanceof api.ApiError && e.status === 401,
  );
  assert.equal(calls.filter((c) => c.url === "/api/auth/refresh/").length, 1);
  assert.equal(calls.filter((c) => c.url === "/api/expedientes/").length, 2);
  uninstallBrowserEnv();
});

test("refresh fallido → forced logout: borra mwt-auth y emite evento", async () => {
  const { ls, events } = installBrowserEnv({ auth: AUTH });
  const calls = installFetch((url) => {
    if (url === "/api/auth/refresh/") return jsonResponse(401, { detail: "refresh expirado" });
    return jsonResponse(401, { detail: "token expirado" });
  });
  const api = await freshImport(BUNDLE);

  await assert.rejects(
    () => api.apiFetch("/expedientes/", { token: "OLD_ACCESS" }),
    (e) => e instanceof api.ApiError && e.status === 401,
  );
  assert.equal(ls.getItem("mwt-auth"), null, "el bundle de auth fue borrado");
  assert.ok(events.some((e) => e.type === "mwt-auth-logout"), "evento de logout emitido");
  // La request original NO se reintenta (no hubo access nuevo).
  assert.equal(calls.filter((c) => c.url === "/api/expedientes/").length, 1);
  uninstallBrowserEnv();
});

test("single-flight: 3 apiFetch con 401 simultáneos → UN solo refresh", async () => {
  installBrowserEnv({ auth: AUTH });
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = installFetch(async (url, opts) => {
    if (url === "/api/auth/refresh/") {
      await gate; // mantener el refresh "en vuelo" hasta que los 3 caigan
      return jsonResponse(200, { access: "NEW_ACCESS" });
    }
    if (opts.headers.Authorization === "Bearer NEW_ACCESS") {
      return jsonResponse(200, { path: url });
    }
    return jsonResponse(401, { detail: "expirado" });
  });
  const api = await freshImport(BUNDLE);

  const ps = [
    api.apiFetch("/a/", { token: "OLD_ACCESS" }),
    api.apiFetch("/b/", { token: "OLD_ACCESS" }),
    api.apiFetch("/c/", { token: "OLD_ACCESS" }),
  ];
  await flushAsync(); // los tres 401 ya se procesaron y esperan el refresh
  release();
  const res = await Promise.all(ps);

  assert.equal(calls.filter((c) => c.url === "/api/auth/refresh/").length, 1,
    "N requests con 401 comparten UN único refresh");
  assert.deepEqual(res.map((r) => r.path).sort(), ["/api/a/", "/api/b/", "/api/c/"]);
  uninstallBrowserEnv();
});

test("refreshAccessToken: llamadas concurrentes comparten la misma promesa", async () => {
  installBrowserEnv({ auth: AUTH });
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = installFetch(async () => { await gate; return jsonResponse(200, { access: "X" }); });
  const api = await freshImport(BUNDLE);

  const p1 = api.refreshAccessToken();
  const p2 = api.refreshAccessToken();
  const p3 = api.refreshAccessToken();
  assert.equal(p1, p2, "misma promesa single-flight");
  assert.equal(p2, p3, "misma promesa single-flight");
  release();
  assert.deepEqual(await Promise.all([p1, p2, p3]), ["X", "X", "X"]);
  assert.equal(calls.length, 1, "un solo POST /auth/refresh/");

  // Tras resolverse, la promesa se libera: una nueva llamada re-dispara.
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  installFetch(async () => { await gate2; return jsonResponse(200, { access: "Y" }); });
  const p4 = api.refreshAccessToken();
  assert.notEqual(p4, p1, "nueva ronda → nueva promesa");
  release2();
  assert.equal(await p4, "Y");
  uninstallBrowserEnv();
});

test("sin refresh token → resuelve null sin tocar la red", async () => {
  installBrowserEnv({ auth: { user: {}, access: "A" } }); // sin .refresh
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  assert.equal(await api.refreshAccessToken(), null);
  assert.equal(calls.length, 0);
  uninstallBrowserEnv();
});

test("sesión DEV-fallback (refresh 'dev-local…') → null sin red", async () => {
  installBrowserEnv({ auth: { user: {}, access: "A", refresh: "dev-local-123" } });
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  assert.equal(await api.refreshAccessToken(), null);
  assert.equal(calls.length, 0);
  uninstallBrowserEnv();
});

test("401 en rutas /auth/* nunca dispara refresh (anti-bucle)", async () => {
  installBrowserEnv({ auth: AUTH });
  const calls = installFetch(() => jsonResponse(401, { detail: "credenciales inválidas" }));
  const api = await freshImport(BUNDLE);
  await assert.rejects(
    () => api.apiFetch("/auth/me/", { token: "OLD_ACCESS" }),
    (e) => e instanceof api.ApiError && e.status === 401,
  );
  assert.equal(calls.length, 1, "ni refresh ni retry para /auth/*");
  uninstallBrowserEnv();
});
