// =====================================================================
// tests/virtual_table_threshold.test.mjs
// Contrato cubierto: lib/virtualTableLogic.js — regla de decisión pura.
//   · rows < threshold → NO virtualizar.
//   · rows >= threshold → virtualizar.
//   · printing=true → NO virtualizar aunque haya muchas filas (print
//     muestra todas).
//   · threshold por defecto = 60.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldVirtualize,
  DEFAULT_THRESHOLD,
} from "../src/lib/virtualTableLogic.js";

test("threshold por defecto es 60", () => {
  assert.equal(DEFAULT_THRESHOLD, 60);
});

test("bajo umbral → tabla normal", () => {
  assert.equal(shouldVirtualize(0), false);
  assert.equal(shouldVirtualize(10), false);
  assert.equal(shouldVirtualize(59), false);
});

test("en el umbral o por encima → virtualiza", () => {
  assert.equal(shouldVirtualize(60), true);
  assert.equal(shouldVirtualize(61), true);
  assert.equal(shouldVirtualize(500), true);
});

test("imprimiendo → nunca virtualiza (print completo)", () => {
  assert.equal(shouldVirtualize(500, DEFAULT_THRESHOLD, true), false);
  assert.equal(shouldVirtualize(60, DEFAULT_THRESHOLD, true), false);
  assert.equal(shouldVirtualize(5000, DEFAULT_THRESHOLD, true), false);
});

test("threshold custom se respeta", () => {
  assert.equal(shouldVirtualize(5, 10), false);
  assert.equal(shouldVirtualize(10, 10), true);
  assert.equal(shouldVirtualize(20, 10), true);
});

test("valores no numéricos fallan cerrado (no virtualiza)", () => {
  assert.equal(shouldVirtualize(undefined), false);
  assert.equal(shouldVirtualize(null), false);
  assert.equal(shouldVirtualize("abc"), false);
});
