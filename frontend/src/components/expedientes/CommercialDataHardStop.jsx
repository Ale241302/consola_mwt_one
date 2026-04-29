// ─────────────────────────────────────────────────────────────
// CommercialDataHardStop — Hard Stop de datos comerciales
// Sprint Wizard Lite · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// El nuevo wizard simplificado crea expedientes en estado REGISTRO con
// modo_operacion / brand_id / moneda en NULL. El orchestrator (PLB)
// requiere esos campos para emitir la Proforma MWT (ART-02) y la
// Decisión B/C (ART-03). Por eso este componente funciona como
// "hard stop": se renderiza en el detalle del expediente y BLOQUEA
// la transición T2 (REGISTRO → PRODUCCION) hasta que se completen.
//
// Uso:
//   <CommercialDataHardStop
//       expediente={expediente}
//       onSaved={refreshExpediente}
//       lang={lang}
//   />
//
// Auto-oculta si:
//   · estado != "REGISTRO"
//   · modo_operacion, brand_id, moneda ya están todos completos
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { IconAlert, IconCheck, IconLock } from "../../lib/icons.jsx";
import { expedientesApi, marcasApi } from "../../lib/api.js";

const MODO_OPERACION = [
  { v: "FULL",     l: "Full · MWT compra y vende" },
  { v: "COMISION", l: "Comisión · solo intermedia" },
];

const FREIGHT_MODE = [
  { v: "SEA", l: "Marítimo (SEA)" },
  { v: "AIR", l: "Aéreo (AIR)" },
];

const DISPATCH_MODE = [
  { v: "FCL", l: "FCL · Container completo" },
  { v: "LCL", l: "LCL · Carga consolidada" },
];

const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CIP", "DAP", "DDP"];
const CURRENCIES = ["USD", "PEN", "MXN", "COP", "CLP", "BRL", "ARS", "EUR"];

export default function CommercialDataHardStop({ expediente, onSaved, lang = "es" }) {
  const e = expediente || {};
  const isRegistro = (e.estado || "").toUpperCase() === "REGISTRO";

  const missing = useMemo(() => {
    const m = [];
    if (!e.modo_operacion) m.push("modo_operacion");
    if (!e.brand_id)       m.push("brand_id");
    if (!e.moneda)         m.push("moneda");
    return m;
  }, [e.modo_operacion, e.brand_id, e.moneda]);

  if (!isRegistro || missing.length === 0) return null;

  return <HardStopForm expediente={e} missing={missing} onSaved={onSaved} lang={lang}/>;
}

function HardStopForm({ expediente, missing, onSaved, lang }) {
  const [form, setForm] = useState({
    modo_operacion: expediente.modo_operacion || "",
    brand_id:       expediente.brand_id || "",
    moneda:         expediente.moneda || "",
    incoterm:       expediente.incoterm || "",
    freight_mode:   expediente.freight_mode || "",
    dispatch_mode:  expediente.dispatch_mode || "",
  });
  const [brands, setBrands] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    marcasApi.list({ is_active: "true" }).then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      setBrands(arr);
    }).catch(() => setBrands([]));
  }, []);

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const completed = (k) => !!form[k] && form[k] !== "";

  const requiredOk = completed("modo_operacion") && completed("brand_id") && completed("moneda");

  const submit = async () => {
    if (!requiredOk || saving) return;
    setSaving(true); setError(null);
    try {
      await expedientesApi.update(expediente.id || expediente._backend_id, {
        modo_operacion: form.modo_operacion,
        brand_id:       form.brand_id,
        moneda:         form.moneda,
        incoterm:       form.incoterm || null,
        freight_mode:   form.freight_mode || null,
        dispatch_mode:  form.dispatch_mode || null,
      });
      onSaved?.();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      style={{
        margin: "16px 0",
        border: "2px solid #F59E0B",
        background: "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0.02) 100%)",
        borderRadius: 14, overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        background: "rgba(245,158,11,0.10)",
        padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid rgba(245,158,11,0.20)",
      }}>
        <IconAlert size={16} style={{ color: "#92400E" }}/>
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ color: "#92400E", letterSpacing: 1 }}>
            ⛔ {lang === "es" ? "HARD STOP · COMPLETAR DATOS COMERCIALES" : "HARD STOP · COMPLETE COMMERCIAL DATA"}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0B1E3A", marginTop: 2 }}>
            {lang === "es"
              ? "Este expediente no puede avanzar a PRODUCCIÓN hasta completar marca, moneda y modo de operación."
              : "This file can't move to PRODUCTION until brand, currency and mode are filled."}
          </div>
        </div>
        <span style={{
          padding: "4px 10px", borderRadius: 999,
          background: "#FEF3C7", color: "#92400E",
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
        }}>
          {missing.length} {lang === "es" ? "faltantes" : "missing"}
        </span>
      </div>

      {/* Form */}
      <div style={{ padding: 18 }}>
        <div className="caption" style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 12 }}>
          <IconLock size={10} style={{ verticalAlign: -1, marginRight: 4 }}/>
          {lang === "es"
            ? "Estos datos son obligatorios para emitir la Proforma MWT (ART-02) y la Decisión B/C (ART-03). Sin ellos el orchestrator bloquea T2."
            : "These fields are required to issue the MWT Proforma (ART-02) and B/C Decision (ART-03). Without them the orchestrator blocks T2."}
        </div>

        {/* Obligatorios */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <Field
            label={lang === "es" ? "Modo de operación *" : "Operation mode *"}
            ok={completed("modo_operacion")}
          >
            <select className="input" value={form.modo_operacion}
                    onChange={(e) => setF("modo_operacion", e.target.value)}>
              <option value="">— {lang === "es" ? "Selecciona" : "Select"} —</option>
              {MODO_OPERACION.map((m) => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </select>
          </Field>

          <Field
            label={lang === "es" ? "Marca *" : "Brand *"}
            ok={completed("brand_id")}
          >
            <select className="input" value={form.brand_id}
                    onChange={(e) => setF("brand_id", e.target.value)}>
              <option value="">— {lang === "es" ? "Selecciona" : "Select"} —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.nombre || b.brand_code}</option>
              ))}
            </select>
          </Field>

          <Field
            label={lang === "es" ? "Moneda *" : "Currency *"}
            ok={completed("moneda")}
          >
            <select className="input mono-sm" value={form.moneda}
                    onChange={(e) => setF("moneda", e.target.value)}>
              <option value="">— USD / PEN / … —</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {/* Opcionales (recomendados) */}
        <div className="caption" style={{
          color: "var(--text-tertiary)", marginTop: 18, marginBottom: 8,
          textTransform: "uppercase", letterSpacing: 0.6, fontSize: 11, fontWeight: 700,
        }}>
          {lang === "es" ? "Logística (opcional pero recomendado)" : "Logistics (optional but recommended)"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <Field label="Incoterm">
            <select className="input" value={form.incoterm}
                    onChange={(e) => setF("incoterm", e.target.value)}>
              <option value="">—</option>
              {INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label={lang === "es" ? "Modo flete" : "Freight mode"}>
            <select className="input" value={form.freight_mode}
                    onChange={(e) => setF("freight_mode", e.target.value)}>
              <option value="">—</option>
              {FREIGHT_MODE.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </Field>
          <Field label={lang === "es" ? "Modo despacho" : "Dispatch mode"}>
            <select className="input" value={form.dispatch_mode}
                    onChange={(e) => setF("dispatch_mode", e.target.value)}>
              <option value="">—</option>
              {DISPATCH_MODE.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </Field>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5",
            color: "#991B1B", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/> {error}
          </div>
        )}

        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={submit}
            disabled={!requiredOk || saving}
            className="btn btn-accent"
            style={{
              minWidth: 240, fontWeight: 700,
              background: requiredOk ? "var(--btn-primary, #00B286)" : "#94A3B8",
              borderColor: requiredOk ? "var(--btn-primary, #00B286)" : "#94A3B8",
            }}
          >
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : <><IconCheck size={12}/> {lang === "es" ? "Completar y desbloquear" : "Complete & unlock"}</>}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Field({ label, ok, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.4,
        textTransform: "uppercase", marginBottom: 6,
      }}>
        {ok && <IconCheck size={10} style={{ color: "#00B286" }}/>}
        {label}
      </span>
      {children}
    </label>
  );
}
