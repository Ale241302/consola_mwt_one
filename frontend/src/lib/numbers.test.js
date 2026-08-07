import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLocaleNumber, formatLocaleNumber, isAmbiguousNumberString } from "./numbers.js";

describe("parseLocaleNumber (es-CR)", () => {
  it("parsea 26.924,66 -> 26924.66", () => {
    assert.equal(parseLocaleNumber("26.924,66", "es-CR"), 26924.66);
  });
  it("parsea 26,924.66 (mixto) -> 26924.66", () => {
    assert.equal(parseLocaleNumber("26,924.66", "es-CR"), 26924.66);
  });
  it("parsea 26924.66 -> 26924.66", () => {
    assert.equal(parseLocaleNumber("26924.66", "es-CR"), 26924.66);
  });
  it("parsea 26924,66 -> 26924.66", () => {
    assert.equal(parseLocaleNumber("26924,66", "es-CR"), 26924.66);
  });
  it("interpreta 2.994 como 2994 (punto = miles en es-CR)", () => {
    assert.equal(parseLocaleNumber("2.994", "es-CR"), 2994);
  });
  it("interpreta 2,994 como 2.994 (coma = decimal)", () => {
    assert.equal(parseLocaleNumber("2,994", "es-CR"), 2.994);
  });
  it("limpia símbolos de moneda y espacios", () => {
    assert.equal(parseLocaleNumber("₡ 1.234,56", "es-CR"), 1234.56);
    assert.equal(parseLocaleNumber("$ 1,234.56", "es-CR"), 1234.56);
  });
  it("devuelve null para strings vacíos", () => {
    assert.equal(parseLocaleNumber(""), null);
    assert.equal(parseLocaleNumber(null), null);
    assert.equal(parseLocaleNumber(undefined), null);
  });
  it("devuelve null para NaN-like", () => {
    assert.equal(parseLocaleNumber("NaN", "es-CR"), null);
    assert.equal(parseLocaleNumber("abc", "es-CR"), null);
    assert.equal(parseLocaleNumber("1.2.3", "es-CR"), null);
  });
  it("preserva números finitos", () => {
    assert.equal(parseLocaleNumber(1234.56), 1234.56);
    assert.equal(parseLocaleNumber(Number.NaN), null);
  });
});

describe("formatLocaleNumber (es-CR)", () => {
  it("formatea 26924.66 -> 26.924,66", () => {
    assert.equal(formatLocaleNumber(26924.66, "es-CR", 2), "26.924,66");
  });
  it("formatea 2.994 -> 2,99", () => {
    assert.equal(formatLocaleNumber(2.994, "es-CR", 2), "2,99");
  });
  it("formatea negativos", () => {
    assert.equal(formatLocaleNumber(-1234.5, "es-CR", 2), "-1.234,50");
  });
  it("devuelve cadena vacía para no finitos", () => {
    assert.equal(formatLocaleNumber(Number.NaN, "es-CR"), "");
    assert.equal(formatLocaleNumber(null, "es-CR"), "");
  });
});

describe("isAmbiguousNumberString", () => {
  it("detecta 2.994 como ambiguo en es-CR", () => {
    assert.equal(isAmbiguousNumberString("2.994", "es-CR"), true);
  });
  it("no detecta 26.924,66 como ambiguo", () => {
    assert.equal(isAmbiguousNumberString("26.924,66", "es-CR"), false);
  });
});
