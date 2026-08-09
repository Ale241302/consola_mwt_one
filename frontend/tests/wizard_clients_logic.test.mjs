// =====================================================================
// tests/wizard_clients_logic.test.mjs
// Contrato cubierto: pages/wizard-lite/clients.logic.js
//   · adaptClient: normaliza id/label/credito/dias.
//   · orderClientsHierarchy: padres primero, subsidiarios debajo con
//     parent_label, huérfanos al final.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptClient,
  orderClientsHierarchy,
} from "../src/pages/wizard-lite/clients.logic.js";

test("adaptClient normaliza el shape del API", () => {
  const c = adaptClient({
    id: "uuid-1",
    razon_social: "Marluvas SA",
    nombre_comercial: "Marluvas",
    tax_id: "CR-3101",
    parent_id: "uuid-0",
    contacto_email: "a@mwt.one",
    credito_aprobado: "25000",
    credito_usado: 500,
    dias_credito: 90,
  });
  assert.equal(c.id, "uuid-1");
  assert.equal(c.label, "Marluvas SA");
  assert.equal(c.credito_limit, 25000);
  assert.equal(c.credito_used, 500);
  assert.equal(c.dias_credito, 90);
});

test("adaptClient sin nombre usa nombre_comercial o fallback", () => {
  assert.equal(adaptClient({ nombre_comercial: "MWT" }).label, "MWT");
  assert.equal(adaptClient({}).label, "—");
});

test("orderClientsHierarchy: padres → subsidiarios → huérfanos", () => {
  const clients = [
    { id: "sub2", label: "Sub2", parent_id: "p1" },
    { id: "p1", label: "Padre 1", parent_id: null },
    { id: "sub1", label: "Sub1", parent_id: "p1" },
    { id: "huérfano", label: "Huerfano", parent_id: null },
  ];
  const out = orderClientsHierarchy(clients);
  // Conserva el orden original de los subsidiarios del mismo padre.
  assert.deepEqual(out.map(c => c.id), ["p1", "sub2", "sub1", "huérfano"]);
  assert.equal(out[1].parent_label, "Padre 1");
  assert.equal(out[2].parent_label, "Padre 1");
});

test("orderClientsHierarchy con lista vacía", () => {
  assert.deepEqual(orderClientsHierarchy([]), []);
});
