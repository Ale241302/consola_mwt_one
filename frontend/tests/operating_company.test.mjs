// =====================================================================
// tests/operating_company.test.mjs
// Contrato cubierto: src/lib/operatingCompany.js — helpers puros de
// visibilidad por rol (R3 POL_VISIBILIDAD) y empresa operadora.
//   · isMwtOperated: match case-insensitive contra el UUID real de MWT.
//   · isInternalRole / isClientRole / isAdminRole: clasificación de
//     roles (CLIENT_* jamás es interno; staff/ops no son admin).
//   · DOCUMENT_AUDIENCES congelado (nadie puede mutar las audiencias).
// Módulo puro sin import.meta ni deps → se importa directo de src/.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MWT_OPERATING_CLIENT_ID, DOCUMENT_AUDIENCES,
  isMwtOperated, isInternalRole, isClientRole, isAdminRole,
} from "../src/lib/operatingCompany.js";

test("isMwtOperated: UUID de MWT en cualquier casing; otros UUID/null → false", () => {
  assert.equal(isMwtOperated(MWT_OPERATING_CLIENT_ID), true);
  assert.equal(isMwtOperated(MWT_OPERATING_CLIENT_ID.toUpperCase()), true, "case-insensitive");
  assert.equal(isMwtOperated("61a3763d-75fb-461d-af4c-e17cbea880f0"), false, "el placeholder viejo NO es MWT");
  assert.equal(isMwtOperated(null), false);
  assert.equal(isMwtOperated(undefined), false);
  assert.equal(isMwtOperated(""), false);
});

test("isInternalRole: admin/ceo/staff/ops y superuser son internos", () => {
  assert.equal(isInternalRole({ role_default: "ADMIN" }), true);
  assert.equal(isInternalRole({ role: "ceo" }), true);
  assert.equal(isInternalRole({ role_default: "staff" }), true);
  assert.equal(isInternalRole({ role_default: "ops" }), true);
  assert.equal(isInternalRole({ is_superuser: true, role_default: "client_admin" }), true,
    "superuser pisa cualquier rol");
  // Rol desconocido que no es client_*/viewer → interno por defecto.
  assert.equal(isInternalRole({ role_default: "finanzas" }), true);
});

test("isInternalRole: CLIENT_*, client, viewer y null NO son internos", () => {
  assert.equal(isInternalRole({ role_default: "CLIENT_ADMIN" }), false);
  assert.equal(isInternalRole({ role_default: "client_viewer" }), false);
  assert.equal(isInternalRole({ role_default: "client" }), false);
  assert.equal(isInternalRole({ role_default: "viewer" }), false);
  assert.equal(isInternalRole(null), false);
});

test("isClientRole: solo roles client/CLIENT_*; superuser nunca es cliente", () => {
  assert.equal(isClientRole({ role_default: "CLIENT_ADMIN" }), true);
  assert.equal(isClientRole({ role: "client_ops" }), true);
  assert.equal(isClientRole({ role_default: "client" }), true);
  assert.equal(isClientRole({ role_default: "admin" }), false);
  assert.equal(isClientRole({ is_superuser: true, role_default: "client_admin" }), false,
    "R3: un superuser jamás cae en la rama CLIENT");
  assert.equal(isClientRole(null), false);
});

test("isAdminRole: estricto — staff/ops NO cuentan como admin", () => {
  assert.equal(isAdminRole({ role_default: "admin" }), true);
  assert.equal(isAdminRole({ role_default: "CEO" }), true);
  assert.equal(isAdminRole({ is_superuser: true }), true);
  assert.equal(isAdminRole({ role_default: "staff" }), false, "audiencia ADMIN_ONLY excluye staff");
  assert.equal(isAdminRole({ role_default: "ops" }), false);
  assert.equal(isAdminRole({ role_default: "client_admin" }), false);
  assert.equal(isAdminRole(null), false);
});

test("isAdminRole prefiere role_default sobre role legacy", () => {
  assert.equal(isAdminRole({ role_default: "admin", role: "client" }), true);
  assert.equal(isAdminRole({ role_default: "client", role: "admin" }), false);
});

test("DOCUMENT_AUDIENCES: valores canónicos y objeto congelado", () => {
  assert.deepEqual(DOCUMENT_AUDIENCES, {
    CLIENT: "CLIENT", MWT_INTERNAL: "MWT_INTERNAL", ADMIN_ONLY: "ADMIN_ONLY",
  });
  assert.ok(Object.isFrozen(DOCUMENT_AUDIENCES));
  assert.throws(() => { "use strict"; DOCUMENT_AUDIENCES.CLIENT = "HACK"; },
    /Cannot assign/, "mutar audiencias debe fallar (frozen)");
});
