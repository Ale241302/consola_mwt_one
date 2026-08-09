// =====================================================================
// tests/liquidation_logic.test.mjs
// Contrato cubierto: features/transfers/liquidation/liquidation.logic.js
//   · taxRatesForNcm: devuelve tasas por NCM y el default ante unknown.
//   · isCapitalizable: IVA NO capitaliza; DAI/FLETE/OTRO sí.
//   · prorateExtras: excluye IVA del landed cost; suma por qty share.
//   · NCM_TAX_RATES: la constante tiene los NCM conocidos + _default.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NCM_TAX_RATES,
  taxRatesForNcm,
  KIND_FREIGHT,
  KIND_INSURANCE,
  DEFAULT_TIMBRES,
  COST_KINDS_FALLBACK,
  isCapitalizable,
  prorateExtras,
} from "../src/features/transfers/liquidation/liquidation.logic.js";

test("taxRatesForNcm devuelve tasas por NCM y default ante unknown", () => {
  assert.deepEqual(taxRatesForNcm("6403.99.90"), NCM_TAX_RATES["6403.99.90"]);
  assert.deepEqual(taxRatesForNcm("6403.40.00"), NCM_TAX_RATES["6403.40.00"]);
  assert.deepEqual(taxRatesForNcm("9999.99.99"), NCM_TAX_RATES._default);
  assert.deepEqual(taxRatesForNcm(undefined), NCM_TAX_RATES._default);
  assert.equal(taxRatesForNcm("6403.99.90").iva, 0.13);
});

test("KIND_FREIGHT/KIND_INSURANCE reconocen variantes", () => {
  assert.equal(KIND_FREIGHT.has("FLETE"), true);
  assert.equal(KIND_FREIGHT.has("CONSOLIDACION"), true);
  assert.equal(KIND_INSURANCE.has("SEGURO"), true);
  assert.equal(KIND_INSURANCE.has("INSURANCE"), true);
});

test("DEFAULT_TIMBRES y COST_KINDS_FALLBACK son los catálogos canónicos", () => {
  assert.ok(DEFAULT_TIMBRES.some(t => t.concept === "PROCOMER"));
  const iv = COST_KINDS_FALLBACK.find(k => k.codigo === "IVA");
  assert.ok(iv, "IVA presente");
  assert.equal(iv.is_fiscal, true);
});

test("isCapitalizable: IVA no capitaliza, el resto sí", () => {
  assert.equal(isCapitalizable("IVA"), false);
  assert.equal(isCapitalizable("DAI"), true);
  assert.equal(isCapitalizable("FLETE"), true);
  assert.equal(isCapitalizable("OTRO"), true);
  assert.equal(isCapitalizable(undefined), true);
});

test("prorateExtras excluye IVA del landed cost (alineado d7d21b2)", () => {
  const costs = [
    { kind: "DAI",    amount: 100, fx_to_usd: 1 },
    { kind: "IVA",    amount: 200, fx_to_usd: 1 },
    { kind: "FLETE",  amount: 50,  fx_to_usd: 1 },
  ];
  const res = prorateExtras(costs, [{ qty: 10 }]);
  assert.equal(res.capitalizable, 150, "DAI+FLETE capitalizan");
  assert.equal(res.nonCapitalizable, 200, "IVA no capitaliza");
  assert.equal(res.total, 350);
});

test("prorateExtras con qty total 0 no divide por cero", () => {
  const costs = [{ kind: "DAI", amount: 100, fx_to_usd: 1 }];
  const res = prorateExtras(costs, [{ qty: 0 }]);
  assert.deepEqual(res, { capitalizable: 0, nonCapitalizable: 0, total: 0 });
});

test("prorateExtras con fx_to_usd convierte la moneda", () => {
  const costs = [{ kind: "FLETE", amount: 100, fx_to_usd: 2 }];
  const res = prorateExtras(costs, [{ qty: 5 }]);
  assert.equal(res.capitalizable, 200);
});
