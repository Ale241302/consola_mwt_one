// =====================================================================
// tests/api_mock_mode.test.mjs
// Contrato cubierto: src/lib/api.js — kill-switch VITE_USE_MOCKS=1.
//   · /auth/* siempre pega al backend real (login/refresh/me/logout).
//   · GET con fixture registrado → payload con shape del backend.
//   · GET sin fixture → [] (fallback de las vistas).
//   · Escrituras (POST/PATCH/DELETE) → ApiError honesta con
//     body.mock_mode=true, sin tocar la red.
// Usa el bundle compilado con --define:VITE_USE_MOCKS="1"
// (tests/.build/api.mock.mjs).
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installBrowserEnv, uninstallBrowserEnv, installFetch,
  jsonResponse, freshImport,
} from "./helpers/env.mjs";

const BUNDLE = "../.build/api.mock.mjs";

test("MOCKS_ENABLED queda en true con VITE_USE_MOCKS=1", async () => {
  installBrowserEnv({});
  installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  assert.equal(api.MOCKS_ENABLED, true);
  uninstallBrowserEnv();
});

test("GET sin fixture registrado → [] sin tocar la red", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, { never: true }));
  const api = await freshImport(BUNDLE);
  assert.deepEqual(await api.apiFetch("/ruta/inexistente/", {}), []);
  assert.equal(calls.length, 0, "cero fetch en modo mock");
  uninstallBrowserEnv();
});

test("GET /portal/products/ → fixture paginado con shape DRF", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  const page = await api.apiFetch("/portal/products/?limit=5&offset=0", {});
  assert.equal(calls.length, 0);
  // Mismo shape que el backend real: {count, limit, offset, results}.
  assert.equal(typeof page.count, "number");
  assert.equal(page.limit, 5);
  assert.equal(page.offset, 0);
  assert.ok(Array.isArray(page.results));
  assert.ok(page.results.length <= 5, "respeta el limit pedido");
  uninstallBrowserEnv();
});

test("GET /permissions/roles → fixture de roles (lista no vacía)", async () => {
  installBrowserEnv({});
  installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  const roles = await api.apiFetch("/permissions/roles/", {});
  assert.ok(Array.isArray(roles) && roles.length > 0);
  uninstallBrowserEnv();
});

test("POST en modo mock → ApiError con body.mock_mode, sin red", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = await freshImport(BUNDLE);
  await assert.rejects(
    () => api.apiFetch("/expedientes/", { method: "POST", body: { x: 1 } }),
    (e) => e instanceof api.ApiError
      && e.status === 0
      && e.body?.mock_mode === true
      && e.body?.method === "POST",
    "una escritura fantasma sería un bug: debe fallar honesto",
  );
  assert.equal(calls.length, 0);
  uninstallBrowserEnv();
});

test("/auth/login/ atraviesa el kill-switch y pega al backend real", async () => {
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, { access: "A", refresh: "R" }));
  const api = await freshImport(BUNDLE);
  const data = await api.authApi.login("ceo", "secreta");
  assert.deepEqual(data, { access: "A", refresh: "R" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/login/");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { usuario: "ceo", password: "secreta" });
  uninstallBrowserEnv();
});
