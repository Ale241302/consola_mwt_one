// =====================================================================
// MWT.ONE · components/clientes/ClientFormDrawer.jsx
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral de creación / edición de cliente B2B.
// Refactor Sprint Cliente M3b — 5 secciones visuales:
//
//   1. Datos Base & SAP           (razon_social, codigo_marluvas, cedula_juridica)
//   2. Ubicación y Entrega        (pais, direccion_entrega)
//   3. Contacto Principal         (contacto_nombre, tel, email)
//   4. Condiciones Comerciales    (canal cards, incoterm, medio_pago, dias_credito)
//   5. Gobernanza Financiera      [CEO-ONLY · Badge rojo]
//                                 (credito_limit_usd, comision_pct)
//
// Design tokens MWT:
//   Navy   #0B1E3A   Mint   #00B286   Amber  #F59E0B   Red    #DC2626
//   Light  #1DE394   Ink    #334155   Muted  #64748B
//
// Seguridad (POL_VISIBILIDAD):
//   · Los campos credito_limit_usd + comision_pct sólo se RENDEREAN si
//     useRole().isAdmin es true. El backend también valida — defensa
//     en dos capas.
//
// Validaciones espejo del backend:
//   · codigo_marluvas : 10 dígitos numéricos si se envía.
//   · dias_credito    : 0..180.
//   · contacto_email  : formato email.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconX, IconCheck, IconUser, IconMail, IconMapPin,
  IconCreditCard, IconShield, IconGlobe, IconLock, IconAlert,
  IconDollar, IconPercent,
} from "../../lib/icons.jsx";
import { clientesApi } from "../../lib/api.js";

// IconInfo no existe en el set del proyecto — usamos una letra "i"
// estilizada dentro de un círculo con SVG inline (misma API que los otros iconos).
const IconInfo = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
       fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 8h.01M12 11v5"/>
  </svg>
);
import { useRole } from "../../context/RoleContext.jsx";

// ─── Design tokens ───────────────────────────────────────────
const NAVY  = "var(--text-primary)";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const AMBER = "#F59E0B";
const RED   = "var(--critical)";
const INK   = "var(--text-secondary)";
const MUTED = "var(--text-tertiary)";
const SOFT  = "var(--surface)";

// ─── Catálogos (deberían venir del backend en prod) ──────────

const INCOTERMS = [
  { k: "EXW", l: "EXW · Ex Works" },
  { k: "FCA", l: "FCA · Free Carrier" },
  { k: "FOB", l: "FOB · Free On Board" },
  { k: "CFR", l: "CFR · Cost + Freight" },
  { k: "CIF", l: "CIF · Cost, Insurance, Freight" },
  { k: "CPT", l: "CPT · Carriage Paid To" },
  { k: "CIP", l: "CIP · Carriage + Insurance Paid" },
  { k: "DAP", l: "DAP · Delivered At Place" },
  { k: "DDP", l: "DDP · Delivered Duty Paid" },
];

const MEDIOS_PAGO = [
  { k: "TRANSFER_BANCARIA", l: "Transferencia bancaria" },
  { k: "CARTA_CREDITO",     l: "Carta de crédito" },
  { k: "CUENTA_CORRIENTE",  l: "Cuenta corriente" },
  { k: "CONTADO",           l: "Pago de contado" },
  { k: "CHEQUE",            l: "Cheque" },
];

const CANALES = [
  { k: "DIRECTO",
    l: "Directo",
    hint: "MWT vende directo al cliente final / corporativo. Margen completo." },
  { k: "DISTRIBUIDOR",
    l: "Distribuidor",
    hint: "Cliente re-vende en su mercado. Comisión + plazo ampliado." },
  { k: "RETAIL",
    l: "Retail",
    hint: "Red de puntos de venta físicos del cliente." },
  { k: "ECOMMERCE",
    l: "E-commerce",
    hint: "Venta online del cliente (marketplaces, web propia)." },
];

// ACTIVO (Mint) · PAUSADO (Amber) · BLOQUEADO (Red)
const ESTADOS = [
  { k: "ACTIVO",    l: "Activo",    color: MINT,  bg: `${MINT}15`,  hint: "Operación normal." },
  { k: "PAUSADO",   l: "Pausado",   color: AMBER, bg: `${AMBER}15`, hint: "Operación suspendida temporalmente (revisión comercial)." },
  { k: "BLOQUEADO", l: "Bloqueado", color: RED,   bg: `${RED}15`,   hint: "Cliente bloqueado — sin nuevas OCs." },
];

// ─── Helpers ────────────────────────────────────────────────
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODIGO_MARLUVAS_RX = /^\d{10}$/;

// ═════════════════════════════════════════════════════════════
// Componente
// ═════════════════════════════════════════════════════════════
export default function ClientFormDrawer({ lang = "es", initial = null, onClose, onCreated }) {
  const { isAdmin } = useRole();
  const isEdit = !!initial;

  const [paises, setPaises] = useState([]);
  useEffect(() => {
    clientesApi.select("paises").then(setPaises).catch(()=>{});
  }, []);

  // El initial viene de un listado donde los campos pueden tener
  // distintos nombres (mock vs API). Normalizamos en el defaults.
  const [form, setForm] = useState(() => defaultsFrom(initial));
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);

  // Re-hydrate si cambia el initial desde afuera.
  useEffect(() => { setForm(defaultsFrom(initial)); }, [initial]);

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const blur   = (k)    => setTouched(p => ({ ...p, [k]: true }));

  // ─── Validación ──────────────────────────────
  const validate = (f) => {
    const e = {};
    if (!f.razon_social || f.razon_social.trim().length < 3) {
      e.razon_social = "Mínimo 3 caracteres.";
    }
    if (f.codigo_marluvas && !CODIGO_MARLUVAS_RX.test(String(f.codigo_marluvas).trim())) {
      e.codigo_marluvas = "Debe ser exactamente 10 dígitos numéricos.";
    }
    if (!f.contacto_email || !EMAIL_RX.test(f.contacto_email)) {
      e.contacto_email = "Email no válido.";
    }
    const dias = Number(f.dias_credito);
    if (Number.isNaN(dias) || dias < 0 || dias > 180) {
      e.dias_credito = "Debe estar entre 0 y 180.";
    }
    if (isAdmin && f.comision_pct != null && f.comision_pct !== "") {
      const c = Number(f.comision_pct);
      if (Number.isNaN(c) || c < 0 || c > 0.9999) {
        e.comision_pct = "0..0.9999 (0.085 = 8.5%).";
      }
    }
    if (isAdmin && f.credito_limit_usd != null && f.credito_limit_usd !== "") {
      const l = Number(f.credito_limit_usd);
      if (Number.isNaN(l) || l < 0) e.credito_limit_usd = "Debe ser ≥ 0.";
    }
    return e;
  };

  const liveErrors = useMemo(() => validate(form), [form, isAdmin]);
  const isValid = Object.keys(liveErrors).length === 0;

  const showError = (k) => (submitted || touched[k]) && liveErrors[k];

  const submit = (e) => {
    e && e.preventDefault();
    setSubmitted(true);
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // Defensa en profundidad: si el caller no es admin, quitamos CEO-ONLY
    // del payload antes de enviarlo al backend (el BE también los filtra).
    const payload = { ...form };
    if (!isAdmin) {
      delete payload.credito_limit_usd;
      delete payload.comision_pct;
    }
    onCreated && onCreated(payload);
  };

  const estadoMeta = ESTADOS.find(s => s.k === form.estado) || ESTADOS[0];

  // ════════════════════════════════════════════════════════════
  return (
    <>
      <motion.div
        className="drawer-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.45)", zIndex: 98 }}
      />
      <motion.aside
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(820px, 100vw)", background: "var(--surface-raised)",
          boxShadow: "-24px 0 60px -20px rgba(11,30,58,0.28)",
          display: "flex", flexDirection: "column",
          zIndex: 99, overflow: "hidden",
        }}
      >
        {/* ════ HEADER ════ */}
        <header style={{
          padding: "18px 24px",
          background: `linear-gradient(135deg, var(--brand-primary) 0%, #1A2F52 100%)`,
          color: "#FFFFFF",
          display: "flex", alignItems: "flex-start", gap: 14,
        }}>
          <div style={{
            width: 46, height: 46, borderRadius: 10,
            background: `${MINT}26`, color: LIGHT,
            display: "grid", placeItems: "center",
            font: "700 18px/1 var(--font-body)",
          }}>
            {(form.razon_social || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "500 10.5px/1 var(--font-body)", opacity: 0.7,
              textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>
              {isEdit
                ? (lang === "es" ? "Editar cliente B2B" : "Edit B2B client")
                : (lang === "es" ? "Nuevo cliente B2B" : "New B2B client")}
            </div>
            <div style={{ font: "700 18px/1.2 var(--font-body)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {form.razon_social || (lang === "es" ? "Sin nombre" : "Untitled")}
            </div>

            {/* Selector de estado con badge dinámico */}
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ESTADOS.map(s => {
                const active = form.estado === s.k;
                return (
                  <motion.button key={s.k} type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => update("estado", s.k)}
                    title={s.hint}
                    style={{
                      padding: "5px 12px",
                      border: `1.5px solid ${active ? s.color : "rgba(255,255,255,0.25)"}`,
                      background: active ? s.color : "transparent",
                      color: active ? "#FFFFFF" : "rgba(255,255,255,0.75)",
                      font: "700 11px/1 var(--font-body)",
                      borderRadius: 20, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", gap: 4,
                      transition: "all 120ms ease",
                      letterSpacing: 0.4, textTransform: "uppercase",
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: active ? "#FFFFFF" : s.color,
                    }}/>
                    {s.l}
                  </motion.button>
                );
              })}
            </div>
          </div>

          <button type="button" onClick={onClose}
            aria-label={lang === "es" ? "Cerrar" : "Close"}
            style={{
              background: "rgba(255,255,255,0.10)", color: "#FFFFFF",
              border: "none", borderRadius: 8, padding: 8, cursor: "pointer",
              display: "grid", placeItems: "center",
            }}
          >
            <IconX size={16}/>
          </button>
        </header>

        {/* ════ FORM BODY ════ */}
        <form onSubmit={submit} style={{ flex: 1, overflowY: "auto",
          padding: "20px 24px", display: "flex", flexDirection: "column", gap: 22,
        }}>
          {/* ─── Sección 1 · Datos Base & SAP ─── */}
          <Section
            icon={<IconShield size={14}/>}
            title={lang === "es" ? "Datos Base & SAP" : "Base Data & SAP"}
            subtitle={lang === "es"
              ? "Identificación legal y códigos del ERP origen."
              : "Legal identification and upstream ERP codes."}
          >
            <Grid cols={2}>
              <Field label={lang === "es" ? "Razón social" : "Legal name"} required
                     error={showError("razon_social") ? liveErrors.razon_social : null}>
                <Input value={form.razon_social || ""}
                       onChange={v => update("razon_social", v)}
                       onBlur={() => blur("razon_social")}/>
              </Field>

              <Field label="Código Marluvas (SAP)"
                     tooltip={lang === "es"
                       ? "Identificador SAP de 10 dígitos — obligatorio para órdenes COMEX."
                       : "10-digit SAP identifier — required for COMEX orders."}
                     error={showError("codigo_marluvas") ? liveErrors.codigo_marluvas : null}>
                <Input value={form.codigo_marluvas || ""}
                       onChange={v => update("codigo_marluvas", v)}
                       onBlur={() => blur("codigo_marluvas")}
                       placeholder="1234567890"
                       maxLength={10}
                       mono/>
              </Field>

              <Field label={lang === "es" ? "Cédula jurídica / RUC" : "Tax ID"}
                     tooltip={lang === "es"
                       ? "RUC, RFC, CIF, cédula jurídica o equivalente legal del país."
                       : "Country-specific legal tax identifier."}>
                <Input value={form.cedula_juridica || ""}
                       onChange={v => update("cedula_juridica", v)}
                       mono/>
              </Field>

              <Field label="Tax ID (alternate)"
                     hint={lang === "es" ? "Se mantiene por compatibilidad con registros legacy." : "Kept for legacy compat."}>
                <Input value={form.tax_id || ""}
                       onChange={v => update("tax_id", v)}
                       mono/>
              </Field>
            </Grid>
          </Section>

          {/* ─── Sección 2 · Ubicación y Entrega ─── */}
          <Section
            icon={<IconMapPin size={14}/>}
            title={lang === "es" ? "Ubicación y Entrega" : "Location & Delivery"}
            subtitle={lang === "es"
              ? "País operativo y dirección física para despachos."
              : "Operating country and physical shipping address."}
          >
            <Grid cols={2}>
              <Field label={lang === "es" ? "País" : "Country"}>
                <Select value={form.pais_iso2 || "MX"}
                        onChange={v => update("pais_iso2", v)}
                        options={paises.map(c => ({ k: c.codigo, l: `${c.label} (${c.codigo})` }))}/>
              </Field>
              <Field label={lang === "es" ? "Ciudad" : "City"}>
                <Input value={form.ciudad || ""}
                       onChange={v => update("ciudad", v)}/>
              </Field>
            </Grid>
            <Field label={lang === "es" ? "Dirección de entrega" : "Delivery address"}
                   fullWidth>
              <Textarea value={form.direccion_entrega || ""}
                        onChange={v => update("direccion_entrega", v)}
                        rows={3}
                        placeholder={lang === "es"
                          ? "Calle, número, ciudad, estado, código postal…"
                          : "Street, number, city, state, ZIP…"}/>
            </Field>
          </Section>

          {/* ─── Sección 3 · Contacto Principal ─── */}
          <Section
            icon={<IconUser size={14}/>}
            title={lang === "es" ? "Contacto Principal" : "Primary Contact"}
            subtitle={lang === "es"
              ? "Persona de referencia para OCs y cobranza."
              : "Reference person for POs and collections."}
          >
            <Grid cols={3}>
              <Field label={lang === "es" ? "Nombre" : "Name"}>
                <Input value={form.contacto_nombre || ""}
                       onChange={v => update("contacto_nombre", v)}/>
              </Field>
              <Field label={lang === "es" ? "Teléfono" : "Phone"}>
                <Input value={form.contacto_tel || ""}
                       onChange={v => update("contacto_tel", v)}
                       mono/>
              </Field>
              <Field label="Email" required
                     error={showError("contacto_email") ? liveErrors.contacto_email : null}>
                <Input type="email"
                       value={form.contacto_email || ""}
                       onChange={v => update("contacto_email", v)}
                       onBlur={() => blur("contacto_email")}
                       mono/>
              </Field>
            </Grid>
          </Section>

          {/* ─── Sección 4 · Condiciones Comerciales ─── */}
          <Section
            icon={<IconCreditCard size={14}/>}
            title={lang === "es" ? "Condiciones Comerciales" : "Commercial Conditions"}
            subtitle={lang === "es"
              ? "Canal de venta, términos logísticos y crédito."
              : "Sales channel, logistics terms and credit."}
          >
            {/* Cards de canal — selector visual */}
            <div style={{ marginBottom: 14 }}>
              <Label>{lang === "es" ? "Canal de venta" : "Sales channel"}</Label>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 8, marginTop: 6,
              }}>
                {CANALES.map(c => {
                  const active = form.canal === c.k;
                  return (
                    <motion.button key={c.k} type="button"
                      whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
                      onClick={() => update("canal", c.k)}
                      style={{
                        padding: "12px 14px", textAlign: "left",
                        border: `1.5px solid ${active ? MINT : "var(--border)"}`,
                        background: active ? `${MINT}10` : "var(--surface-raised)",
                        borderRadius: 10, cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                    >
                      <div style={{
                        font: "700 13px/1.1 var(--font-body)",
                        color: active ? MINT : NAVY,
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        {active && <IconCheck size={12}/>}
                        {c.l}
                      </div>
                      <div style={{ font: "500 11px/1.35 var(--font-body)",
                        color: MUTED, marginTop: 4 }}>
                        {c.hint}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <Grid cols={3}>
              <Field label="Incoterm">
                <Select value={form.incoterm || "CIF"}
                        onChange={v => update("incoterm", v)}
                        options={INCOTERMS}/>
              </Field>
              <Field label={lang === "es" ? "Medio de pago" : "Payment method"}>
                <Select value={form.medio_pago || "TRANSFER_BANCARIA"}
                        onChange={v => update("medio_pago", v)}
                        options={MEDIOS_PAGO}/>
              </Field>
              <Field label={lang === "es" ? "Días de crédito" : "Credit days"}
                     error={showError("dias_credito") ? liveErrors.dias_credito : null}
                     hint="0 — 180">
                <Input type="number"
                       value={form.dias_credito ?? 0}
                       onChange={v => update("dias_credito", v === "" ? "" : Number(v))}
                       onBlur={() => blur("dias_credito")}
                       min={0} max={180}
                       mono/>
              </Field>
            </Grid>
          </Section>

          {/* ─── Sección 5 · Gobernanza Financiera (CEO-ONLY) ─── */}
          <AnimatePresence>
            {isAdmin ? (
              <motion.div
                key="ceo-section"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                style={{ overflow: "hidden" }}
              >
                <Section
                  icon={<IconDollar size={14}/>}
                  title={lang === "es" ? "Gobernanza Financiera" : "Financial Governance"}
                  subtitle={lang === "es"
                    ? "Límite de crédito y comisión pactada. Visible sólo para CEO / Admin."
                    : "Credit limit and commission pact. CEO / Admin only."}
                  badge={{ label: "CEO-ONLY", color: RED, icon: <IconLock size={9}/> }}
                  highlight={RED}
                >
                  <Grid cols={2}>
                    <Field label={lang === "es" ? "Límite de crédito (USD)" : "Credit limit (USD)"}
                           error={showError("credito_limit_usd") ? liveErrors.credito_limit_usd : null}>
                      <InputAffixed affixLeft="$" affixRight="USD" mono tabular
                                    type="number" step="0.01" min={0}
                                    value={form.credito_limit_usd ?? ""}
                                    onChange={v => update("credito_limit_usd", v === "" ? null : Number(v))}
                                    onBlur={() => blur("credito_limit_usd")}/>
                    </Field>

                    <Field label={lang === "es" ? "Comisión pactada (%)" : "Agreed commission (%)"}
                           error={showError("comision_pct") ? liveErrors.comision_pct : null}
                           hint={lang === "es"
                             ? "Decimal: 0.085 = 8.5%."
                             : "Decimal: 0.085 = 8.5%."}>
                      <InputAffixed affixLeft={<IconPercent size={11}/>} affixRight="pct" mono tabular
                                    type="number" step="0.0005" min={0} max={0.9999}
                                    value={form.comision_pct ?? ""}
                                    onChange={v => update("comision_pct", v === "" ? null : Number(v))}
                                    onBlur={() => blur("comision_pct")}/>
                    </Field>
                  </Grid>

                  <div style={{
                    marginTop: 10, padding: "8px 12px",
                    background: `${RED}0D`, border: `1px solid ${RED}33`,
                    borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 8,
                    font: "500 11px/1.4 var(--font-body)", color: "#991B1B",
                  }}>
                    <IconAlert size={12} style={{ marginTop: 2, flexShrink: 0 }}/>
                    <span>
                      {lang === "es"
                        ? "Estos campos son sensibles. El backend los rechaza si el caller no es superadmin/admin, aunque se envíen en el payload."
                        : "These fields are sensitive. The backend rejects them if the caller is not superadmin/admin, even if sent in the payload."}
                    </span>
                  </div>
                </Section>
              </motion.div>
            ) : (
              <motion.div
                key="ceo-locked"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{
                  padding: "14px 16px", background: SOFT,
                  border: `1px dashed var(--border)`, borderRadius: 10,
                  display: "flex", alignItems: "center", gap: 10,
                  color: MUTED, font: "500 12px/1.4 var(--font-body)",
                }}
              >
                <IconLock size={14}/>
                <span>
                  {lang === "es"
                    ? "Los campos de gobernanza financiera (límite de crédito y comisión) sólo están disponibles para roles CEO / Admin."
                    : "Financial governance fields (credit limit and commission) are only available for CEO / Admin roles."}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </form>

        {/* ════ FOOTER ════ */}
        <footer style={{
          padding: "14px 24px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-raised)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center",
            font: "500 11px/1 var(--font-body)", color: MUTED }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: estadoMeta.color,
            }}/>
            {lang === "es" ? "Estado" : "Status"}: <strong style={{ color: estadoMeta.color }}>{estadoMeta.l}</strong>
            {!isValid && (
              <span style={{ color: RED, marginLeft: 10,
                display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconAlert size={11}/>
                {Object.keys(liveErrors).length}{" "}
                {lang === "es" ? "error(es)" : "error(s)"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose}
              className="btn btn-ghost"
              style={{
                padding: "8px 16px", background: "transparent",
                border: "1px solid var(--border)", color: INK,
                font: "600 12.5px/1 var(--font-body)",
                borderRadius: 8, cursor: "pointer",
              }}
            >
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
            <button type="button" onClick={submit}
              disabled={!isValid}
              style={{
                padding: "8px 20px",
                background: isValid ? MINT : "#94A3B8",
                color: "#FFFFFF", border: "none",
                font: "700 12.5px/1 var(--font-body)",
                borderRadius: 8,
                cursor: isValid ? "pointer" : "not-allowed",
                display: "inline-flex", alignItems: "center", gap: 6,
                transition: "background 120ms ease",
              }}
            >
              <IconCheck size={13}/>
              {isEdit
                ? (lang === "es" ? "Guardar cambios" : "Save changes")
                : (lang === "es" ? "Crear cliente"   : "Create client")}
            </button>
          </div>
        </footer>
      </motion.aside>
    </>
  );
}

// =====================================================================
// Helper: defaults + coerción de shape entre mock y API real
// =====================================================================
function defaultsFrom(initial) {
  const i = initial || {};
  return {
    // Sección 1
    razon_social:      i.razon_social      || i.name            || "",
    codigo_marluvas:   i.codigo_marluvas   || "",
    cedula_juridica:   i.cedula_juridica   || "",
    tax_id:            i.tax_id            || "",
    // Sección 2
    pais_iso2:         i.pais_iso2         || i.country_code    || i.country || "MX",
    ciudad:            i.ciudad            || i.city            || "",
    direccion_entrega: i.direccion_entrega || i.address         || "",
    // Sección 3
    contacto_nombre:   i.contacto_nombre   || "",
    contacto_tel:      i.contacto_tel      || i.phone           || "",
    contacto_email:    i.contacto_email    || i.email           || "",
    // Sección 4
    canal:             i.canal             || "DISTRIBUIDOR",
    incoterm:          i.incoterm          || "CIF",
    medio_pago:        i.medio_pago        || "TRANSFER_BANCARIA",
    dias_credito:      (i.dias_credito ?? i.credito_dias ?? 60),
    // Sección 5 · CEO-ONLY
    credito_limit_usd: i.credito_limit_usd ?? i.credito_limit ?? i.credito_aprobado ?? null,
    comision_pct:      i.comision_pct ?? null,
    // Header
    estado:            (i.estado || "ACTIVO").toUpperCase(),
  };
}


// =====================================================================
// Primitivas de UI — Section, Field, Input, Select, etc.
// =====================================================================
function Section({ icon, title, subtitle, children, badge, highlight }) {
  return (
    <section style={{
      padding: 16,
      background: "var(--surface-raised)",
      border: `1px solid ${highlight ? `${highlight}33` : "var(--border)"}`,
      borderLeft: highlight ? `3px solid ${highlight}` : `1px solid var(--border)`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: highlight ? `${highlight}15` : `${MINT}15`,
          color: highlight || MINT,
          display: "grid", placeItems: "center",
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "700 13.5px/1.2 var(--font-body)", color: NAVY,
            display: "flex", alignItems: "center", gap: 6 }}>
            {title}
            {badge && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 7px", borderRadius: 10,
                background: badge.color,
                color: "#FFFFFF",
                font: "700 9.5px/1 var(--font-body)",
                letterSpacing: 0.4, textTransform: "uppercase",
              }}>
                {badge.icon}
                {badge.label}
              </span>
            )}
          </div>
          {subtitle && (
            <div style={{ font: "500 11.5px/1.35 var(--font-body)",
              color: MUTED, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 12,
    }}>
      {children}
    </div>
  );
}

function Label({ children, required, tooltip }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 4,
      font: "600 11px/1 var(--font-body)", color: NAVY,
      marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4,
    }}>
      {children}
      {required && <span style={{ color: RED }}>*</span>}
      {tooltip && (
        <span title={tooltip} style={{
          display: "inline-flex", width: 13, height: 13, borderRadius: "50%",
          background: "var(--bg-alt)", color: MUTED, alignItems: "center",
          justifyContent: "center", cursor: "help",
          font: "700 9px/1 var(--font-body)",
        }}>
          <IconInfo size={9}/>
        </span>
      )}
    </label>
  );
}

function Field({ label, required, error, hint, tooltip, fullWidth, children }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <Label required={required} tooltip={tooltip}>{label}</Label>
      {children}
      {error ? (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)",
          color: RED, marginTop: 4, display: "inline-flex",
          alignItems: "center", gap: 3 }}>
          <IconAlert size={10}/>
          {error}
        </div>
      ) : hint ? (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)",
          color: MUTED, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Input({ value, onChange, onBlur, type = "text", mono, tabular, ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      onBlur={onBlur}
      {...rest}
      style={{
        width: "100%", padding: "8px 10px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: `${mono ? "500" : "500"} 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
        color: NAVY, background: "var(--surface-raised)", outline: "none",
        transition: "border 120ms ease",
        fontVariantNumeric: tabular ? "tabular-nums" : undefined,
      }}
      onFocus={e => (e.target.style.borderColor = MINT)}
      onBlurCapture={e => (e.target.style.borderColor = "var(--border)")}
    />
  );
}

function InputAffixed({ affixLeft, affixRight, value, onChange, onBlur, type = "text", mono, tabular, ...rest }) {
  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      border: "1px solid var(--border)", borderRadius: 6,
      overflow: "hidden", background: "var(--surface-raised)",
    }}>
      {affixLeft && (
        <span style={{
          padding: "8px 10px", background: SOFT,
          color: MUTED, font: "600 12px/1 var(--font-body)",
          borderRight: "1px solid var(--border)",
          display: "grid", placeItems: "center",
        }}>
          {affixLeft}
        </span>
      )}
      <input
        type={type}
        value={value ?? ""}
        onChange={e => onChange && onChange(e.target.value)}
        onBlur={onBlur}
        {...rest}
        style={{
          flex: 1, minWidth: 0, padding: "8px 10px",
          border: "none", outline: "none",
          font: `600 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
          color: NAVY,
          fontVariantNumeric: tabular ? "tabular-nums" : undefined,
        }}
      />
      {affixRight && (
        <span style={{
          padding: "8px 10px", background: SOFT,
          color: MUTED, font: "500 10.5px/1 var(--font-body)",
          borderLeft: "1px solid var(--border)",
          display: "grid", placeItems: "center",
          textTransform: "uppercase", letterSpacing: 0.4,
        }}>
          {affixRight}
        </span>
      )}
    </div>
  );
}

function Select({ value, onChange, options, ...rest }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      {...rest}
      style={{
        width: "100%", padding: "8px 10px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: "500 13px/1.2 var(--font-body)", color: NAVY,
        background: "var(--surface-raised)", outline: "none",
        transition: "border 120ms ease",
        cursor: "pointer",
      }}
    >
      {options.map(o => <option key={o.k} value={o.k}>{o.l}</option>)}
    </select>
  );
}

function Textarea({ value, onChange, rows = 3, ...rest }) {
  return (
    <textarea
      value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      rows={rows}
      {...rest}
      style={{
        width: "100%", padding: "8px 10px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: "500 13px/1.4 var(--font-body)", color: NAVY,
        background: "var(--surface-raised)", outline: "none",
        transition: "border 120ms ease", resize: "vertical",
      }}
    />
  );
}
