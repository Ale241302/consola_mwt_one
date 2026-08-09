// =====================================================================
// tests/a11y_modal.test.mjs
// Contrato cubierto: lib/a11y/dialogLogic.js — focus trap puro.
//   · getFocusables: devuelve solo elementos focusables (no disabled,
//     no hidden), en orden de documento.
//   · Tab sin shift en el último → vuelve al primero.
//   · Tab con shift en el primero → va al último.
//   · Sin focusables → la acción es "prevent".
//   · Tecla que no es Tab → null (no interviene).
//   · Escape → isEscape true.
// Se usa linkedom (DOM ligero) para montar un diálogo simulado.
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  getFocusables,
  handleTabInDialog,
  isEscape,
} from "../src/lib/a11y/dialogLogic.js";

function makeDialog() {
  const { document } = parseHTML(
    `<div id="dlg" role="dialog" tabindex="-1">
       <button id="btn1">Cerrar</button>
       <input id="inp1" placeholder="nombre" />
       <input id="inp2" type="text" />
       <button id="btn2" disabled>Deshabilitado</button>
       <input id="hidden" type="hidden" />
       <a id="link" href="#">Enlace</a>
       <textarea id="ta">x</textarea>
       <select id="sel"><option>a</option></select>
     </div>`
  );
  return document.getElementById("dlg");
}

function keyEvent(el, opts) {
  return {
    key: opts.key,
    shiftKey: !!opts.shiftKey,
    target: el,
    preventDefault() { this._prevented = true; },
    stopPropagation() { this._stopped = true; },
  };
}

test("getFocusables: ignora disabled/hidden y respeta orden de documento", () => {
  const dlg = makeDialog();
  const f = getFocusables(dlg).map((el) => el.id);
  // btn2 (disabled), hidden (type=hidden) y el contenedor tabindex=-1 quedan fuera.
  assert.deepEqual(f, ["btn1", "inp1", "inp2", "link", "ta", "sel"]);
});

test("Tab sin shift en el último elemento → foco al primero", () => {
  const dlg = makeDialog();
  const f = getFocusables(dlg);
  const ev = keyEvent(f[f.length - 1], { key: "Tab", shiftKey: false });
  assert.equal(handleTabInDialog(ev, dlg), "focus-first");
});

test("Tab con shift en el primer elemento → foco al último", () => {
  const dlg = makeDialog();
  const f = getFocusables(dlg);
  const ev = keyEvent(f[0], { key: "Tab", shiftKey: true });
  assert.equal(handleTabInDialog(ev, dlg), "focus-last");
});

test("Tab en un elemento intermedio → no interviene (null)", () => {
  const dlg = makeDialog();
  const f = getFocusables(dlg);
  const ev = keyEvent(f[1], { key: "Tab", shiftKey: false });
  assert.equal(handleTabInDialog(ev, dlg), null);
});

test("Sin focusables → prevent (no hay dónde escapar)", () => {
  const { document } = parseHTML(`<div id="dlg" tabindex="-1"></div>`);
  const ev = keyEvent(document.getElementById("dlg"), { key: "Tab" });
  assert.equal(handleTabInDialog(ev, document.getElementById("dlg")), "prevent");
});

test("Tecla que no es Tab → null (no interfiere)", () => {
  const dlg = makeDialog();
  const ev = keyEvent(dlg, { key: "Enter" });
  assert.equal(handleTabInDialog(ev, dlg), null);
});

test("Escape se detecta siempre", () => {
  assert.equal(isEscape({ key: "Escape" }), true);
  assert.equal(isEscape({ key: "Tab" }), false);
});
