// =====================================================================
// tests/cronograma_data.test.mjs
// Contrato cubierto: src/lib/cronogramaData.js — matemática pura del
// cronograma de expedientes (misma semántica que el Resumen .html):
//   · parseD / addDays / dayDiff / fmtShort (fechas ancladas a 12:00).
//   · buildAvgs: jerarquía cliente[modo] → global[modo] → _ALL
//     (con TRANSITO excluido del agregado _ALL).
//   · avgFor: promedio real (est:false) o estándar DEF_DUR (est:true).
//   · computeSegments: barras reales desde el event_log, overrides
//     manuales (días y rangos exactos), cadena estimada y etaHint.
//   · itemPhaseDur / projectedDelivery / buildSkuStats.
// "Hoy" se congela con t.mock.timers (apis:['Date']) donde aplica.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
// (sin helpers: módulo puro, basta un import directo del bundle)

const BUNDLE = "./.build/cronogramaData.mjs"; // relativo a tests/ (import directo)
const C = await import(new URL(BUNDLE, import.meta.url).href);

/** yyyy-mm-dd local de un Date (las fechas del módulo viven a las 12:00). */
const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ── Fechas básicas ───────────────────────────────────────────────────
test("parseD: ISO válido → Date a las 12:00; inválido/vacío → null", () => {
  const d = C.parseD("2026-03-05");
  assert.equal(ymd(d), "2026-03-05");
  assert.equal(d.getHours(), 12, "ancla a mediodía para esquivar TZ");
  // También acepta timestamps largos (recorta a 10 chars).
  assert.equal(ymd(C.parseD("2026-03-05T23:59:59Z")), "2026-03-05");
  assert.equal(C.parseD(""), null);
  assert.equal(C.parseD(null), null);
  assert.equal(C.parseD("no-es-fecha"), null);
});

test("addDays cruza límites de mes; dayDiff redondea y nunca es negativo", () => {
  assert.equal(ymd(C.addDays(C.parseD("2026-01-30"), 3)), "2026-02-02");
  const a = C.parseD("2026-01-01"), b = C.parseD("2026-01-11");
  assert.equal(C.dayDiff(a, b), 10);
  assert.equal(C.dayDiff(b, a), 0, "diferencia negativa → 0");
});

test("fmtShort: meses ES vs EN", () => {
  const d = C.parseD("2026-01-05");
  assert.equal(C.fmtShort(d, "es"), "5 ene");
  assert.equal(C.fmtShort(d, "en"), "5 jan");
  assert.equal(C.fmtShort(null), "");
});

// ── Jerarquía de promedios ───────────────────────────────────────────
test("buildAvgs: cliente pisa a global; global cubre huecos del cliente", () => {
  const cli = { Aereo: { PRODUCCION: { avg: 12, n: 3 } } };
  const glo = { Aereo: { PRODUCCION: { avg: 20, n: 9 }, DESPACHO: { avg: 4, n: 7 } } };
  const avgs = C.buildAvgs(cli, glo);
  assert.deepEqual(avgs.Aereo.PRODUCCION, { avg: 12, n: 3 }, "stats del cliente primero");
  assert.deepEqual(avgs.Aereo.DESPACHO, { avg: 4, n: 7 }, "hueco → global del modo");
  assert.equal(avgs.Aereo.REGISTRO, null, "sin dato en ninguna fuente → null");
});

test("buildAvgs: _ALL aplica a fases no dependientes del modo, NUNCA a TRANSITO", () => {
  const glo = { _ALL: { PREPARACION: { avg: 6, n: 11 }, TRANSITO: { avg: 99, n: 50 } } };
  const avgs = C.buildAvgs(null, glo);
  assert.deepEqual(avgs.Maritimo.PREPARACION, { avg: 6, n: 11 }, "_ALL rellena PREPARACION");
  assert.equal(avgs.Maritimo.TRANSITO, null, "TRANSITO jamás cae al agregado _ALL");
});

test("avgFor: real → est:false; sin dato → DEF_DUR con est:true", () => {
  const avgs = C.buildAvgs({ Maritimo: { TRANSITO: { avg: 30, n: 4 } } }, null);
  assert.deepEqual(C.avgFor(avgs, "Maritimo", "TRANSITO"), { avg: 30, n: 4, est: false });
  // Sin stats: usa el estándar del modo (Maritimo.TRANSITO = 35).
  assert.deepEqual(C.avgFor(C.buildAvgs(null, null), "Maritimo", "TRANSITO"),
    { avg: C.DEF_DUR.Maritimo.TRANSITO, n: 0, est: true });
  // Modo desconocido → cae a Aereo.
  assert.equal(C.avgFor(C.buildAvgs(null, null), "", "PRODUCCION").avg,
    C.DEF_DUR.Aereo.PRODUCCION);
});

// ── computeSegments ──────────────────────────────────────────────────
const baseItem = (over = {}) => ({
  estado: "PRODUCCION",
  modo: "Aereo",
  etaHint: "",
  hist: [
    { s: "REGISTRO", at: "2026-01-01" },
    { s: "PRODUCCION", at: "2026-01-04" },
  ],
  phaseOver: {},
  phaseOverRange: {},
  ...over,
});

test("computeSegments: historial real encadena fechas y deja la fase actual abierta", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00").getTime() });
  const segs = C.computeSegments(baseItem(), C.buildAvgs(null, null));
  assert.equal(segs.real.length, 2);
  assert.deepEqual(
    segs.real.map((x) => [x.s, ymd(x.a), ymd(x.b), x.open]),
    [
      ["REGISTRO", "2026-01-01", "2026-01-04", false],
      ["PRODUCCION", "2026-01-04", "2026-01-10", true], // abierta hasta "hoy"
    ],
  );
});

test("computeSegments: cadena estimada con DEF_DUR Aereo y entrega proyectada", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00").getTime() });
  const item = baseItem();
  const segs = C.computeSegments(item, C.buildAvgs(null, null));
  // Desde hoy (01-10): PREPARACION 5d → DESPACHO 2d → TRANSITO 10d → EN_DESTINO 5d.
  assert.deepEqual(
    segs.est.map((x) => [x.s, ymd(x.a), ymd(x.b)]),
    [
      ["PREPARACION", "2026-01-10", "2026-01-15"],
      ["DESPACHO", "2026-01-15", "2026-01-17"],
      ["TRANSITO", "2026-01-17", "2026-01-27"],
      ["EN_DESTINO", "2026-01-27", "2026-02-01"],
    ],
  );
  const pd = C.projectedDelivery(item, segs);
  assert.equal(ymd(pd.date), "2026-01-27", "entrega proyectada = inicio de EN_DESTINO");
  assert.equal(pd.est, true);
  assert.equal(pd.done, false);
});

test("computeSegments: override de días reconstruye la cascada manual", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00").getTime() });
  const item = baseItem({ phaseOver: { PRODUCCION: 10 } });
  const segs = C.computeSegments(item, C.buildAvgs(null, null));
  const prod = segs.real.find((x) => x.s === "PRODUCCION");
  assert.equal(ymd(prod.a), "2026-01-04");
  assert.equal(ymd(prod.b), "2026-01-14", "10 días manuales desde el inicio real");
  assert.equal(prod.open, true, "sigue siendo la fase vigente");
  // La estimación arranca tras el override (01-14), no tras "hoy".
  assert.equal(ymd(segs.est[0].a), "2026-01-14");
});

test("computeSegments: rango manual {start,end} posiciona la barra en fechas exactas", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00").getTime() });
  const item = baseItem({
    phaseOver: { PRODUCCION: 7 },
    phaseOverRange: { PRODUCCION: { a: "2026-01-05", b: "2026-01-12" } },
  });
  const segs = C.computeSegments(item, C.buildAvgs(null, null));
  const prod = segs.real.find((x) => x.s === "PRODUCCION");
  assert.equal(ymd(prod.a), "2026-01-05", "usa el start exacto del rango");
  assert.equal(ymd(prod.b), "2026-01-12", "usa el end exacto del rango");
});

test("computeSegments: etaHint estira TRANSITO si no hay override", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00").getTime() });
  const item = baseItem({ etaHint: "2026-02-20" });
  const segs = C.computeSegments(item, C.buildAvgs(null, null));
  const transito = segs.est.find((x) => x.s === "TRANSITO");
  assert.equal(ymd(transito.b), "2026-02-20", "el ETA conocido manda sobre el promedio");
});

test("computeSegments: expediente entregado no genera estimaciones", () => {
  const item = baseItem({
    estado: "EN_DESTINO",
    hist: [
      { s: "REGISTRO", at: "2026-01-01" },
      { s: "PRODUCCION", at: "2026-01-04" },
      { s: "TRANSITO", at: "2026-01-15" },
      { s: "EN_DESTINO", at: "2026-01-28" },
    ],
  });
  const segs = C.computeSegments(item, C.buildAvgs(null, null));
  assert.deepEqual(segs.est, [], "delivered → cero barras estimadas");
  const pd = C.projectedDelivery(item, segs);
  assert.equal(ymd(pd.date), "2026-01-28", "fecha real de entrada a EN_DESTINO");
  assert.deepEqual([pd.est, pd.done], [false, true]);
});

test("computeSegments: sin historial parseable → vacío", () => {
  const segs = C.computeSegments(baseItem({ hist: [] }), C.buildAvgs(null, null));
  assert.deepEqual(segs, { real: [], est: [] });
});

// ── itemPhaseDur / buildSkuStats ─────────────────────────────────────
test("itemPhaseDur: override manual > transición cerrada > null", () => {
  const item = baseItem({
    phaseOver: { REGISTRO: 9 },
    hist: [
      { s: "REGISTRO", at: "2026-01-01" },
      { s: "PRODUCCION", at: "2026-01-04" },
    ],
  });
  assert.deepEqual(C.itemPhaseDur(item, "REGISTRO"), { days: 9, manual: true });
  // Sin override: REGISTRO→PRODUCCION duró 3 días reales… pero REGISTRO
  // tiene override; probamos con un item limpio.
  const clean = baseItem();
  assert.deepEqual(C.itemPhaseDur(clean, "REGISTRO"), { days: 3, manual: false });
  assert.equal(C.itemPhaseDur(clean, "PRODUCCION"), null, "fase abierta → sin duración");
  assert.equal(C.itemPhaseDur(clean, "TRANSITO"), null, "fase nunca alcanzada → null");
});

test("buildSkuStats: promedia por SKU entre expedientes y ordena alfabético", () => {
  const mk = (regDays, skus) => baseItem({
    phaseOver: { REGISTRO: regDays },
    skus,
    lineas: skus.map((s) => ({ sku: s, product_label: `Prod ${s}` })),
  });
  const stats = C.buildSkuStats([mk(2, ["B-SKU", "A-SKU"]), mk(6, ["A-SKU"])]);
  assert.deepEqual(stats.map((g) => g.sku), ["A-SKU", "B-SKU"], "orden alfabético");
  const a = stats[0];
  assert.equal(a.n, 2, "A-SKU aparece en 2 expedientes");
  assert.deepEqual(a.phases.REGISTRO, { avg: 4, n: 2 }, "(2+6)/2 = 4 días");
  assert.equal(a.phases.TRANSITO, null, "fase sin datos → null");
  assert.equal(stats[1].phases.REGISTRO.avg, 2);
});
