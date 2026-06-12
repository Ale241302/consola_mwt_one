// =====================================================================
// tests/error_reporter.test.mjs
// Contrato cubierto: src/lib/errorReporter.js — observabilidad self-hosted.
//   · Throttle 5/min: la 6ª llamada dentro de la misma ventana NO postea.
//   · Ventana deslizante: pasados 60s vuelve a reportar.
//   · Best-effort: JAMÁS lanza, aunque fetch falle (rechazo o throw
//     síncrono) — y no deja unhandledRejection.
//   · Truncado client-side: message ≤ 2000 chars, stack ≤ 8000.
//   · path: usa window.location.pathname si el caller no manda uno.
// Date.now controlado con t.mock.timers (apis: ['Date']) para que la
// ventana de 60s sea determinista. Cada test importa una copia FRESCA
// del bundle para resetear el estado _times del módulo.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installBrowserEnv, uninstallBrowserEnv, installFetch,
  jsonResponse, freshImport, flushAsync,
} from "./helpers/env.mjs";

const BUNDLE = "../.build/errorReporter.mjs";

test("throttle 5/min: la 6ª llamada en la misma ventana no postea", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  installBrowserEnv({ auth: { access: "TKN", refresh: "R" } });
  const calls = installFetch(() => jsonResponse(200, {}));
  const er = await freshImport(BUNDLE);

  for (let i = 1; i <= 5; i++) er.reportClientError(`err ${i}`, "stack", "/p");
  await flushAsync();
  assert.equal(calls.length, 5, "los primeros 5 reportes pasan");

  er.reportClientError("err 6", "stack", "/p");
  await flushAsync();
  assert.equal(calls.length, 5, "el 6º dentro de la ventana se descarta");

  // 30s después sigue dentro de la ventana → sigue bloqueado.
  t.mock.timers.tick(30_000);
  er.reportClientError("err 7", "stack", "/p");
  await flushAsync();
  assert.equal(calls.length, 5);
  uninstallBrowserEnv();
});

test("ventana deslizante: tras 60s vuelve a reportar", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  installBrowserEnv({});
  const calls = installFetch(() => jsonResponse(200, {}));
  const er = await freshImport(BUNDLE);

  for (let i = 0; i < 5; i++) er.reportClientError("burst", "s", "/p");
  er.reportClientError("blocked", "s", "/p");
  await flushAsync();
  assert.equal(calls.length, 5);

  t.mock.timers.tick(60_001); // los 5 timestamps salen de la ventana
  er.reportClientError("recovered", "s", "/p");
  await flushAsync();
  assert.equal(calls.length, 6, "pasada la ventana, reporta de nuevo");
  const body = JSON.parse(calls[5].opts.body);
  assert.equal(body.message, "recovered");
  uninstallBrowserEnv();
});

test("best-effort: fetch que rechaza no lanza ni deja unhandledRejection", async () => {
  installBrowserEnv({});
  installFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  const er = await freshImport(BUNDLE);

  const unhandled = [];
  const trap = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", trap);
  try {
    assert.doesNotThrow(() => er.reportClientError("boom", "stack", "/p"));
    await flushAsync();
    await flushAsync(); // dos vueltas: rechazo + .catch interno
    assert.equal(unhandled.length, 0, "el .catch interno traga la falla");
  } finally {
    process.off("unhandledRejection", trap);
  }
  uninstallBrowserEnv();
});

test("best-effort: fetch que lanza síncrono tampoco rompe al caller", async () => {
  installBrowserEnv({});
  globalThis.fetch = () => { throw new Error("sin red"); };
  const er = await freshImport(BUNDLE);
  assert.doesNotThrow(() => er.reportClientError("boom", "stack", "/p"));
  await flushAsync();
  uninstallBrowserEnv();
});

test("trunca message a 2000 y stack a 8000; manda token y POST correcto", async () => {
  installBrowserEnv({ auth: { access: "TKN9", refresh: "R" } });
  const calls = installFetch(() => jsonResponse(200, {}));
  const er = await freshImport(BUNDLE);

  er.reportClientError("M".repeat(5000), "S".repeat(20000), "/crash");
  await flushAsync();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/analytics/client-errors/");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer TKN9");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.message.length, 2000);
  assert.equal(body.stack.length, 8000);
  assert.equal(body.path, "/crash");
  uninstallBrowserEnv();
});

test("sin path explícito usa window.location.pathname", async () => {
  installBrowserEnv({}); // window.location.pathname = "/test-path"
  const calls = installFetch(() => jsonResponse(200, {}));
  const er = await freshImport(BUNDLE);
  er.reportClientError("e", "s"); // sin path
  await flushAsync();
  assert.equal(JSON.parse(calls[0].opts.body).path, "/test-path");
  uninstallBrowserEnv();
});
