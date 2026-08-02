// =====================================================================
// tests/client_dash_metrics.test.mjs
// Contrato cubierto: src/lib/clientDashMetrics.js — métricas puras del
// dashboard personalizable CLIENT (Sprint 2026-08-02):
//   · pairsByMonth: pares pedidos (created_at) vs entregados (delivery
//     real) en buckets mensuales (últimos N meses).
//   · usdByPhase: USD cliente por fase visual (PREPARACION+DESPACHO
//     fusionadas vía displayStage).
//   · pairsBySku: top SKUs por pares, con límite.
//   · buildCustomSeries: métrica × dimensión (núcleo del builder).
// "Hoy" se congela con t.mock.timers (apis:['Date']) donde aplica.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";

const BUNDLE = "./.build/clientDashMetrics.mjs"; // relativo a tests/ (import directo)
const M = await import(new URL(BUNDLE, import.meta.url).href);

/** Fabrica una entrada `enriched` mínima: { it, segs, delivery }. */
const mk = ({
  estado = "PRODUCCION",
  created = "2026-06-10",
  lineas = [],
  delivery = null,
} = {}) => ({
  it: {
    estado,
    lineas,
    volumen: lineas.reduce((a, l) => a + (Number(l.qty_planned ?? l.qty) || 0), 0),
    _row: { created_at: created },
  },
  segs: { real: [], est: [] },
  delivery: delivery || { date: null, done: false, est: false },
});

const L = (sku, qty, size = "40", upc = 0) =>
  ({ sku, qty_planned: qty, size, unit_price_client: upc });

// ── pairsByMonth ─────────────────────────────────────────────────────
test("pairsByMonth: pedidos por created_at y entregados por delivery real", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-15T12:00:00").getTime() });
  const enriched = [
    mk({ created: "2026-06-03", lineas: [L("A", 100)] }),
    mk({ created: "2026-07-20", lineas: [L("A", 50), L("B", 25)] }),
    mk({
      created: "2026-08-01", lineas: [L("B", 40)],
      delivery: { date: new Date("2026-08-10T12:00:00"), done: true, est: false },
    }),
    mk({ // entrega estimada (no real) NO cuenta como entregado
      created: "2026-08-02", lineas: [L("C", 60)],
      delivery: { date: new Date("2026-08-20T12:00:00"), done: false, est: true },
    }),
  ];
  const r = M.pairsByMonth(enriched, { months: 3, lang: "es" });
  assert.deepEqual(r.labels, ["jun", "jul", "ago"]);
  assert.deepEqual(r.pedidos, [100, 75, 100]);
  assert.deepEqual(r.entregados, [0, 0, 40]);
});

test("pairsByMonth: meses fuera de rango y filas sin fecha se ignoran", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-15T12:00:00").getTime() });
  const enriched = [
    mk({ created: "2025-01-10", lineas: [L("A", 999)] }),
    mk({ created: "", lineas: [L("A", 5)] }),
  ];
  const r = M.pairsByMonth(enriched, { months: 2 });
  assert.deepEqual(r.pedidos, [0, 0]);
  assert.equal(r.labels.length, 2);
});

// ── usdByPhase ───────────────────────────────────────────────────────
test("usdByPhase: suma qty × unit_price_client por fase visual fusionada", () => {
  const enriched = [
    mk({ estado: "PREPARACION", lineas: [L("A", 10, "40", 50)] }),   // 500
    mk({ estado: "DESPACHO",    lineas: [L("B", 4, "41", 100)] }),   // 400 → misma fase visual
    mk({ estado: "TRANSITO",    lineas: [L("A", 2, "40", 25)] }),    // 50
  ];
  const r = M.usdByPhase(enriched, "es");
  assert.equal(r.labels.length, 6, "6 fases visuales");
  const iPrep = r.labels.findIndex((x) => /prepar/i.test(x));
  assert.equal(r.values[iPrep], 900, "PREPARACION+DESPACHO fusionadas");
  const iTrans = r.labels.findIndex((x) => /tránsito|transito/i.test(x));
  assert.equal(r.values[iTrans], 50);
  assert.equal(r.values.reduce((a, v) => a + v, 0), 950);
});

// ── pairsBySku ───────────────────────────────────────────────────────
test("pairsBySku: orden desc por pares y respeta el límite", () => {
  const enriched = [
    mk({ lineas: [L("SKU1", 30), L("SKU2", 10)] }),
    mk({ lineas: [L("SKU1", 20), L("SKU3", 90)] }),
    mk({ lineas: [{ qty_planned: 7, size: "40" }] }), // sin sku → se ignora
  ];
  const r = M.pairsBySku(enriched, 2);
  assert.deepEqual(r.labels, ["SKU3", "SKU1"]);
  assert.deepEqual(r.values, [90, 50]);
});

// ── buildCustomSeries ────────────────────────────────────────────────
test("buildCustomSeries: metric=pares dim=talla agrega por talla", () => {
  const enriched = [
    mk({ lineas: [L("A", 12, "40"), L("A", 8, "41")] }),
    mk({ lineas: [L("B", 6, "40")] }),
  ];
  const r = M.buildCustomSeries(enriched, { metric: "pares", dim: "talla" });
  assert.deepEqual(r.labels, ["40", "41"]);
  assert.deepEqual(r.values, [18, 8]);
});

test("buildCustomSeries: metric=usd dim=sku usa unit_price_client", () => {
  const enriched = [mk({ lineas: [L("A", 10, "40", 30), L("B", 5, "40", 100)] })];
  const r = M.buildCustomSeries(enriched, { metric: "usd", dim: "sku" });
  assert.deepEqual(r.labels, ["B", "A"]);
  assert.deepEqual(r.values, [500, 300]);
});

test("buildCustomSeries: metric=pedidos dim=fase cuenta expedientes en orden pipeline", () => {
  const enriched = [
    mk({ estado: "REGISTRO" }),
    mk({ estado: "PRODUCCION" }),
    mk({ estado: "PRODUCCION" }),
  ];
  const r = M.buildCustomSeries(enriched, { metric: "pedidos", dim: "fase", lang: "es" });
  assert.equal(r.labels.length, 6);
  assert.deepEqual(r.values.slice(0, 2), [1, 2], "REGISTRO=1, PRODUCCION=2");
});

test("buildCustomSeries: dim=mes usa created_at en buckets mensuales", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-15T12:00:00").getTime() });
  const enriched = [
    mk({ created: "2026-07-05", lineas: [L("A", 10)] }),
    mk({ created: "2026-07-28", lineas: [L("B", 5)] }),
    mk({ created: "2026-08-02", lineas: [L("C", 3)] }),
  ];
  const r = M.buildCustomSeries(enriched, { metric: "pares", dim: "mes" });
  assert.equal(r.labels.length, 8);
  assert.equal(r.labels[6], "jul");
  assert.equal(r.values[6], 15);
  assert.equal(r.values[7], 3);
});

test("buildCustomSeries: input vacío → series vacías sin explotar", () => {
  assert.deepEqual(M.buildCustomSeries([], { dim: "sku" }), { labels: [], values: [] });
  const r = M.buildCustomSeries(null, { dim: "fase", metric: "pedidos" });
  assert.deepEqual(r.values, [0, 0, 0, 0, 0, 0]);
});

// ── dims ADMIN (Sprint 2026-08-02): cliente / marca ──────────────────
test("buildCustomSeries: dim=cliente agrega por nombre de cliente (nivel expediente)", () => {
  const enriched = [
    { ...mk({ lineas: [L("A", 10, "40", 50)] }), it: { ...mk({ lineas: [L("A", 10, "40", 50)] }).it, cliente: "ACME", clienteId: "c1" } },
    { ...mk({ lineas: [L("B", 4, "41", 100)] }), it: { ...mk({ lineas: [L("B", 4, "41", 100)] }).it, cliente: "ACME", clienteId: "c1" } },
    { ...mk({ lineas: [L("C", 6, "40", 25)] }), it: { ...mk({ lineas: [L("C", 6, "40", 25)] }).it, cliente: "Beta SA", clienteId: "c2" } },
  ];
  const r = M.buildCustomSeries(enriched, { metric: "usd", dim: "cliente" });
  assert.deepEqual(r.labels, ["ACME", "Beta SA"]);
  assert.deepEqual(r.values, [900, 150]);
});

test("buildCustomSeries: dim=cliente cae a clienteId si no hay nombre; filas sin cliente se ignoran", () => {
  const base = mk({ lineas: [L("A", 5)] });
  const enriched = [
    { ...base, it: { ...base.it, cliente: "", clienteId: "c9" } },
    mk({ lineas: [L("B", 99)] }), // sin cliente ni clienteId → fuera
  ];
  const r = M.buildCustomSeries(enriched, { metric: "pares", dim: "cliente" });
  assert.deepEqual(r.labels, ["c9"]);
  assert.deepEqual(r.values, [5]);
});

test("buildCustomSeries: dim=marca usa _row.brand_id y brandNameOf para el label", () => {
  const a = mk({ lineas: [L("A", 12)] });
  const b = mk({ lineas: [L("B", 8)] });
  const sinMarca = mk({ lineas: [L("C", 999)] }); // _row sin brand_id → fuera
  const enriched = [
    { ...a, it: { ...a.it, _row: { ...a.it._row, brand_id: "m1" } } },
    { ...b, it: { ...b.it, _row: { ...b.it._row, brand_id: "m2" } } },
    sinMarca,
  ];
  const r = M.buildCustomSeries(enriched, {
    metric: "pares", dim: "marca",
    brandNameOf: (id) => ({ m1: "Marca Uno", m2: "Marca Dos" })[id],
  });
  assert.deepEqual(r.labels, ["Marca Uno", "Marca Dos"]);
  assert.deepEqual(r.values, [12, 8]);
});

test("buildCustomSeries: dim=marca sin brandNameOf usa el brand_id crudo", () => {
  const a = mk({ lineas: [L("A", 3)] });
  const enriched = [{ ...a, it: { ...a.it, _row: { ...a.it._row, brand_id: "m1" } } }];
  const r = M.buildCustomSeries(enriched, { metric: "pares", dim: "marca" });
  assert.deepEqual(r.labels, ["m1"]);
  assert.deepEqual(r.values, [3]);
});
