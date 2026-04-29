// ─────────────────────────────────────────────────────────────
// SubsidiaryFormModal — Modal CRUD de subsidiaria.
// Agente responsable: [AG-FRONTEND]
//
// Modos:
//   - mode="create" + parentId  → POST /api/clientes/{parentId}/subsidiarias/
//   - mode="edit"   + initial   → PATCH /api/clientes/{id}/
//
// Render: portal a document.body (overflow-safe), backdrop con
// blur, animado con framer-motion, alineado a la paleta MWT
// (Navy #0B1E3A · Mint #00B286).
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { clientesApi } from "../../lib/api.js";

const TIPOS = [
  { v: "B2B",          l: "B2B" },
  { v: "DISTRIBUIDOR", l: "Distribuidor" },
  { v: "CONSUMIDOR",   l: "Consumidor" },
];

const INCOTERMS = ["EXW", "FCA", "FOB", "CIF", "CFR", "DAP", "DDP"];

const empty = (parentDefaults = {}) => ({
  razon_social:      "",
  nombre_comercial:  "",
  tax_id:            "",
  tipo:              parentDefaults.tipo || "B2B",
  segmento:          parentDefaults.segmento || "B",
  pais_iso2:         parentDefaults.pais_iso2 || "",
  ciudad:            "",
  direccion_entrega: "",
  contacto_nombre:   "",
  contacto_email:    "",
  contacto_tel:      "",
  codigo_marluvas:   "",
  incoterm:          parentDefaults.incoterm || "FOB",
  dias_credito:      parentDefaults.dias_credito || 30,
  estado:            "ACTIVO",
});

export default function SubsidiaryFormModal({
  mode = "create",        // "create" | "edit"
  parentId,               // requerido en create
  parentName,             // para mostrar contexto
  parentDefaults = {},    // hereda valores del padre en create
  initial,                // requerido en edit
  lang = "es",
  onClose,
  onSaved,
}) {
  const [form, setForm]   = useState(() => initial
    ? mapInitialToForm(initial)
    : empty(parentDefaults)
  );
  const [busy, setBusy]   = useState(false);
  const [errs, setErrs]   = useState(null);

  useEffect(() => {
    if (initial) setForm(mapInitialToForm(initial));
  }, [initial]);

  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrs(null);
    try {
      const payload = {
        razon_social:      form.razon_social,
        nombre_comercial:  form.nombre_comercial || form.razon_social,
        tax_id:            form.tax_id,
        tipo:              form.tipo,
        segmento:          form.segmento,
        pais_iso2:         (form.pais_iso2 || "").toUpperCase().slice(0, 2),
        ciudad:            form.ciudad,
        direccion_entrega: form.direccion_entrega,
        contacto_nombre:   form.contacto_nombre,
        contacto_email:    form.contacto_email,
        contacto_tel:      form.contacto_tel,
        codigo_marluvas:   form.codigo_marluvas || null,
        incoterm:          form.incoterm,
        dias_credito:      Number(form.dias_credito) || 0,
        estado:            form.estado || "ACTIVO",
      };
      if (mode === "create") {
        await clientesApi.action("subsidiarias", parentId, payload);
      } else {
        await clientesApi.update(initial.id, payload);
      }
      onSaved?.();
    } catch (err) {
      setErrs(err?.body || { detail: err?.message || "Error desconocido" });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 90,
          background: "rgba(15,27,61,0.45)",
          backdropFilter: "blur(2px)",
        }}
      />
      <motion.div
        key="modal"
        initial={{ opacity: 0, y: -16, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.2 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "8vh", left: "50%",
          width: "min(640px, 94vw)", maxHeight: "84vh",
          zIndex: 91,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          overflow: "hidden", display: "flex", flexDirection: "column",
          fontFamily: "inherit",
        }}
      >
        <header style={{
          padding: "18px 22px",
          borderBottom: "1px solid #F1F4F9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              font: "600 11px/1 inherit", color: "#00B286",
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6,
            }}>
              {mode === "create"
                ? (lang === "es" ? "Nueva subsidiaria" : "New subsidiary")
                : (lang === "es" ? "Editar subsidiaria" : "Edit subsidiary")}
            </div>
            <div style={{ font: "700 17px/1.2 inherit", color: "#0F1B3D" }}>
              {parentName
                ? <>{lang === "es" ? "Cliente padre: " : "Parent: "} <strong>{parentName}</strong></>
                : (form.razon_social || (lang === "es" ? "Sin nombre" : "Untitled"))}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy}
                  className="btn btn-ghost"
                  style={{ padding: "6px 10px" }}>
            ✕
          </button>
        </header>

        <form onSubmit={submit} style={{ overflowY: "auto", padding: "20px 22px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}>
            <Field label={lang === "es" ? "Razón social" : "Legal name"} required full>
              <input className="input" value={form.razon_social}
                     onChange={(e) => setF("razon_social", e.target.value)}
                     required />
            </Field>
            <Field label={lang === "es" ? "Nombre comercial" : "Trade name"}>
              <input className="input" value={form.nombre_comercial}
                     onChange={(e) => setF("nombre_comercial", e.target.value)} />
            </Field>
            <Field label="Tax ID (RUC/RFC/CIF)" required>
              <input className="input" value={form.tax_id}
                     onChange={(e) => setF("tax_id", e.target.value)}
                     required />
            </Field>
            <Field label="Tipo">
              <select className="input" value={form.tipo}
                      onChange={(e) => setF("tipo", e.target.value)}>
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </Field>
            <Field label={lang === "es" ? "País (ISO-2)" : "Country (ISO-2)"} required>
              <input className="input" value={form.pais_iso2}
                     onChange={(e) => setF("pais_iso2", e.target.value.toUpperCase())}
                     maxLength={2} required />
            </Field>
            <Field label={lang === "es" ? "Ciudad" : "City"}>
              <input className="input" value={form.ciudad}
                     onChange={(e) => setF("ciudad", e.target.value)} />
            </Field>
            <Field label="Código SAP (10 dígitos)">
              <input className="input mono-sm" value={form.codigo_marluvas}
                     onChange={(e) => setF("codigo_marluvas", e.target.value.replace(/\D/g, "").slice(0, 10))}
                     placeholder="1234567890" />
            </Field>
            <Field label={lang === "es" ? "Dirección de entrega" : "Delivery address"} full>
              <input className="input" value={form.direccion_entrega}
                     onChange={(e) => setF("direccion_entrega", e.target.value)} />
            </Field>
            <Field label={lang === "es" ? "Contacto (nombre)" : "Contact (name)"}>
              <input className="input" value={form.contacto_nombre}
                     onChange={(e) => setF("contacto_nombre", e.target.value)} />
            </Field>
            <Field label={lang === "es" ? "Contacto (email)" : "Contact (email)"}>
              <input className="input" type="email" value={form.contacto_email}
                     onChange={(e) => setF("contacto_email", e.target.value)} />
            </Field>
            <Field label={lang === "es" ? "Contacto (teléfono)" : "Contact (phone)"}>
              <input className="input" value={form.contacto_tel}
                     onChange={(e) => setF("contacto_tel", e.target.value)} />
            </Field>
            <Field label="Incoterm">
              <select className="input" value={form.incoterm}
                      onChange={(e) => setF("incoterm", e.target.value)}>
                {INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label={lang === "es" ? "Plazo (días)" : "Term (days)"}>
              <input className="input mono-sm" type="number" min={0} max={180}
                     value={form.dias_credito}
                     onChange={(e) => setF("dias_credito", e.target.value)} />
            </Field>
          </div>

          <div style={{
            marginTop: 16, padding: "10px 12px", borderRadius: 8,
            background: "rgba(0,178,134,0.08)", border: "1px solid rgba(0,178,134,0.18)",
            color: "#0F1B3D", font: "500 12px/1.5 inherit",
          }}>
            ⓘ{" "}
            {lang === "es"
              ? <>La subsidiaria <strong>comparte el pool de crédito</strong> del cliente padre. No se asigna límite individual.</>
              : <>The subsidiary <strong>shares the parent credit pool</strong>. No individual limit is set.</>
            }
          </div>

          {errs && (
            <div style={{
              marginTop: 14, padding: "10px 12px", borderRadius: 8,
              background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
              font: "500 12.5px/1.5 inherit",
            }}>
              {Object.entries(errs).map(([k, v]) => (
                <div key={k}><strong>{k}:</strong> {Array.isArray(v) ? v.join(", ") : String(v)}</div>
              ))}
            </div>
          )}
        </form>

        <footer style={{
          padding: "14px 22px",
          borderTop: "1px solid #F1F4F9",
          display: "flex", justifyContent: "flex-end", gap: 10,
        }}>
          <button type="button" className="btn btn-ghost"
                  onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" className="btn btn-accent"
                  onClick={submit} disabled={busy}>
            {busy
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (mode === "create"
                  ? (lang === "es" ? "Crear subsidiaria" : "Create subsidiary")
                  : (lang === "es" ? "Guardar cambios" : "Save changes"))}
          </button>
        </footer>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ── Helpers ──
function Field({ label, required, full, children }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <label style={{
        display: "block",
        font: "600 11px/1 inherit",
        color: "#6B7894",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 6,
      }}>
        {label} {required && <span style={{ color: "#DC2626" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function mapInitialToForm(init) {
  return {
    razon_social:      init.razon_social      || "",
    nombre_comercial:  init.nombre_comercial  || "",
    tax_id:            init.tax_id            || "",
    tipo:              init.tipo              || "B2B",
    segmento:          init.segmento          || "B",
    pais_iso2:         init.pais_iso2         || "",
    ciudad:            init.ciudad            || "",
    direccion_entrega: init.direccion_entrega || init.direccion || "",
    contacto_nombre:   init.contacto_nombre   || "",
    contacto_email:    init.contacto_email    || "",
    contacto_tel:      init.contacto_tel      || "",
    codigo_marluvas:   init.codigo_marluvas   || "",
    incoterm:          init.incoterm          || "FOB",
    dias_credito:      init.dias_credito      || 30,
    estado:            init.estado            || "ACTIVO",
  };
}
