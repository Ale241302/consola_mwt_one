// =====================================================================
// tests/product_clients_logic.test.mjs
// Contrato cubierto: pages/product-form/clients.logic.js
//   · adaptClienteForGrid: normaliza id/name/parent.
//   · orderClientsHierarchy: padres → subsidiarias con parent_name,
//     huérfanas al final (sin padre en la lista).
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptClienteForGrid,
  orderClientsHierarchy,
} from "../src/pages/product-form/clients.logic.js";

test("adaptClienteForGrid normaliza el shape", () => {
  const c = adaptClienteForGrid({ id: "x", nombre_comercial: "MWT", parent_id: "p" });
  assert.deepEqual(c, { id: "x", name: "MWT", parent_id: "p", parent_name: null });
});

test("orderClientsHierarchy: padres primero, subsidiarias con parent_name", () => {
  const clients = [
    adaptClienteForGrid({ id: "sub", parent_id: "p", nombre_comercial: "Sub" }),
    adaptClienteForGrid({ id: "p", nombre_comercial: "Padre" }),
  ];
  const out = orderClientsHierarchy(clients);
  assert.deepEqual(out.map(c => c.id), ["p", "sub"]);
  assert.equal(out[1].parent_name, "Padre");
});

test("orderClientsHierarchy: huérfanas al final", () => {
  const clients = [
    adaptClienteForGrid({ id: "orfa", parent_id: "no-existe", nombre_comercial: "Orfa" }),
    adaptClienteForGrid({ id: "p", nombre_comercial: "Padre" }),
  ];
  const out = orderClientsHierarchy(clients);
  assert.deepEqual(out.map(c => c.id), ["p", "orfa"]);
});
