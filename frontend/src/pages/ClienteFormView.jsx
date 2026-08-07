// =====================================================================
// MWT.ONE · pages/ClienteFormView.jsx
// Agente responsable: [AG-FRONTEND]
//
// Vista full-page de creación / edición de cliente B2B.
// Reemplaza el antiguo ClientFormDrawer (drawer lateral) por una
// página completa con breadcrumb + scroll natural.
//
// Rutas:
//   /clientes/nuevo             → modo CREAR
//   /clientes/:clienteId/editar → modo EDITAR
//
// 5 secciones visuales (spec sprint Cliente M3b):
//   1. Datos Base & SAP
//   2. Ubicación y Entrega      (layout expandido · país + ciudad + dirección en 3 filas)
//   3. Contacto Principal
//   4. Condiciones Comerciales  (canal cards + incoterm + medio_pago + días de crédito)
//   5. Gobernanza Financiera    [CEO-ONLY]
//                               · Límite de crédito USD (input con affix)
//                               · Comisión pactada (SLIDER 0..30% + input numérico sincronizado)
//
// POL_VISIBILIDAD: sección 5 + payload filtrado si !isAdmin.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconX, IconCheck, IconUser, IconMapPin, IconCreditCard, IconShield,
  IconLock, IconAlert, IconDollar, IconPercent, IconChevLeft,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { CLIENTS } from "../data/mockData.js";
import { clientesApi, apiFetch, getToken, storageUrl } from "../lib/api.js";
import FileUploader from "../components/common/FileUploader.jsx";
import FilePreview  from "../components/common/FilePreview.jsx";

// ─── Design tokens ───────────────────────────────────────────
const NAVY  = "var(--text-primary)";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const AMBER = "#F59E0B";
const RED   = "var(--critical)";
const INK   = "var(--text-secondary)";
const MUTED = "var(--text-tertiary)";
const SOFT  = "var(--surface)";

// ─── Catálogos ──────────────────────────────────────────────

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

const ESTADOS = [
  { k: "ACTIVO",    l: "Activo",    color: MINT,  hint: "Operación normal." },
  { k: "PAUSADO",   l: "Pausado",   color: AMBER, hint: "Operación suspendida temporalmente (revisión comercial)." },
  { k: "INACTIVO",  l: "Inactivo",  color: MUTED, hint: "Cliente fuera de operación — no aparece en buscadores." },
  { k: "BLOQUEADO", l: "Bloqueado", color: RED,   hint: "Cliente bloqueado — sin nuevas OCs." },
];

// ─── Validación regex ───────────────────────────────────────
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODIGO_MARLUVAS_RX = /^\d{10}$/;

// IconInfo (letra "i" en círculo)
const IconInfo = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
       fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 8h.01M12 11v5"/>
  </svg>
);


// ═════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════
export default function ScreenClienteFormView() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext() || { lang: "es" };
  const { isAdmin } = useRole();

  const isEdit  = !!clienteId && clienteId !== "nuevo";

  const [paises, setPaises] = useState([]);
  useEffect(() => {
    clientesApi.select("paises").then(setPaises).catch(()=>{});
  }, []);

  // Initial — fetch real al backend cuando es modo edit; cae a mock si el
  // ID solo existe en mockData (compat con onboarding/screenshots viejos).
  // En modo "nuevo" arranca con form vacío (defaults).
  const [initial, setInitial] = useState(null);
  const [loadingInitial, setLoadingInitial] = useState(false);

  useEffect(() => {
    if (!isEdit) { setInitial(null); return; }
    let cancelled = false;
    setLoadingInitial(true);
    clientesApi.get(clienteId)
      .then(data => { if (!cancelled) { setInitial(data); setLoadingInitial(false); } })
      .catch(() => {
        if (cancelled) return;
        const mockMatch = CLIENTS.find(c => c.id === clienteId || c.uuid === clienteId) || null;
        setInitial(mockMatch);
        setLoadingInitial(false);
      });
    return () => { cancelled = true; };
  }, [clienteId, isEdit]);

  const [form, setForm] = useState(() => defaultsFrom(null));
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  // Repobla el form cada vez que cambia `initial` (después del fetch).
  useEffect(() => { setForm(defaultsFrom(initial)); }, [initial]);

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const blur   = (k)    => setTouched(p => ({ ...p, [k]: true }));

  // ─── Validación en vivo ─────────────────
  // Por decisión de producto: NINGÚN campo es requerido al crear cliente.
  // Solo validamos *formato* cuando el usuario ya escribió algo — así
  // evitamos bloquear el guardado por campos vacíos. Los faltantes se
  // pueden completar desde el detalle (modo edición) más adelante.
  const liveErrors = useMemo(() => {
    const e = {};
    if (form.codigo_marluvas && !CODIGO_MARLUVAS_RX.test(String(form.codigo_marluvas).trim())) {
      e.codigo_marluvas = lang === "es"
        ? "Debe ser exactamente 10 dígitos numéricos."
        : "Must be exactly 10 numeric digits.";
    }
    if (form.contacto_email && !EMAIL_RX.test(form.contacto_email)) {
      e.contacto_email = lang === "es" ? "Email no válido." : "Invalid email.";
    }
    if (form.dias_credito !== "" && form.dias_credito != null) {
      const d = Number(form.dias_credito);
      if (Number.isNaN(d) || d < 0 || d > 180) {
        e.dias_credito = lang === "es" ? "Entre 0 y 180." : "Between 0 and 180.";
      }
    }
    if (isAdmin && form.comision_pct != null && form.comision_pct !== "") {
      const c = Number(form.comision_pct);
      if (Number.isNaN(c) || c < 0 || c > 0.9999) {
        e.comision_pct = "0..0.9999 (0.085 = 8.5%).";
      }
    }
    if (isAdmin && form.credito_limit_usd != null && form.credito_limit_usd !== "") {
      const l = Number(form.credito_limit_usd);
      if (Number.isNaN(l) || l < 0) e.credito_limit_usd = lang === "es" ? "Debe ser ≥ 0." : "Must be ≥ 0.";
    }
    return e;
  }, [form, isAdmin, lang]);

  const isValid   = Object.keys(liveErrors).length === 0;
  const showError = (k) => (submitted || touched[k]) && liveErrors[k];
  const estadoMeta = ESTADOS.find(s => s.k === form.estado) || ESTADOS[0];

  // ─── Submit ─────────────────────────────
  const save = async () => {
    setSubmitted(true);
    if (!isValid) {
      setBanner({
        type: "error",
        msg: lang === "es"
          ? "Corrige los errores marcados antes de guardar."
          : "Fix the highlighted errors before saving.",
      });
      return;
    }

    setSaving(true);
    setBanner(null);

    // Defensa en profundidad: remover CEO-ONLY del payload si no admin.
    const payload = { ...form };
    if (!isAdmin) {
      delete payload.credito_limit_usd;
      delete payload.comision_pct;
    }

    try {
      // POST/PATCH real al backend (antes era mock con setTimeout).
      // Nota: comision_pct viene como decimal 0..1 desde el slider del FE
      // (ej. 0.0975). El backend acepta así (NUMERIC(5,4) en clientes.cliente).
      const saved = isEdit
        ? await clientesApi.update(clienteId, payload)
        : await clientesApi.create(payload);
      setBanner({
        type: "success",
        msg: isEdit
          ? (lang === "es" ? "Cambios guardados correctamente." : "Changes saved successfully.")
          : (lang === "es" ? "Cliente creado correctamente." : "Client created successfully."),
      });
      // Si es nuevo y backend devolvió id, redirige al detalle del recién creado;
      // si es edición, vuelve al detalle existente.
      const targetId = isEdit ? clienteId : (saved?.id || saved?.uuid);
      setTimeout(() => {
        navigate(targetId ? `/clientes/${targetId}` : "/clientes", { replace: false });
      }, 700);
    } catch (err) {
      // El error puede venir como objeto de DRF: {"campo": ["msg"]}
      let msg = String(err?.message || err);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object") {
          msg = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("  ·  ");
        }
      } catch (_) { /* msg ya es string plano */ }
      setBanner({ type: "error", msg });
    } finally {
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="page" style={{ paddingBottom: 120 }}>
      {/* ─── Breadcrumb ─── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm"
                onClick={() => navigate(isEdit ? `/clientes/${clienteId}` : "/clientes")}>
          <IconChevLeft size={13}/>
          {lang === "es" ? "Volver" : "Back"}
        </button>
        <span style={{ color: MUTED, fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {lang === "es" ? "Clientes" : "Clients"}
        </span>
        <span style={{ color: MUTED, fontSize: 12 }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
          {isEdit
            ? (form.nombre_comercial || form.razon_social || (lang === "es" ? "Editar" : "Edit"))
            : (lang === "es" ? "Nuevo cliente" : "New client")}
        </span>
      </div>

      {/* ─── Header card ─── */}
      <div style={{
        background: `linear-gradient(135deg, var(--brand-primary) 0%, #1A2F52 100%)`,
        color: "#FFFFFF", padding: "20px 24px", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
        marginBottom: 22,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12,
          background: `${MINT}26`, color: LIGHT,
          display: "grid", placeItems: "center",
          flexShrink: 0,
          overflow: "hidden",
        }}>
          {form.logo_url ? (
            <img
              src={storageUrl(form.logo_url)}
              alt="logo"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <span style={{ font: "700 22px/1 var(--font-body)" }}>
              {(form.nombre_comercial || form.razon_social || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ font: "500 10.5px/1 var(--font-body)", opacity: 0.65,
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            {isEdit
              ? (lang === "es" ? "Editar cliente B2B" : "Edit B2B client")
              : (lang === "es" ? "Nuevo cliente B2B" : "New B2B client")}
          </div>
          <div style={{ font: "700 22px/1.2 var(--font-body)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 520,
          }}>
            {form.nombre_comercial || form.razon_social || (lang === "es" ? "Sin nombre" : "Untitled")}
          </div>
          {form.nombre_comercial && form.razon_social && (
            <div style={{
              font: "500 12px/1.3 var(--font-body)", opacity: 0.75,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520,
            }}>
              {form.razon_social}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ESTADOS.map(s => {
              const active = form.estado === s.k;
              return (
                <motion.button key={s.k} type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => update("estado", s.k)}
                  title={s.hint}
                  style={{
                    padding: "6px 14px",
                    border: `1.5px solid ${active ? s.color : "rgba(255,255,255,0.22)"}`,
                    background: active ? s.color : "transparent",
                    color: active ? "#FFFFFF" : "rgba(255,255,255,0.75)",
                    font: "700 11px/1 var(--font-body)",
                    borderRadius: 22, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                    transition: "all 130ms ease",
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
      </div>

      {/* ─── Banner estado guardado ─── */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              padding: "10px 14px", marginBottom: 16,
              background: banner.type === "success" ? `${MINT}15` : `${RED}15`,
              color: banner.type === "success" ? "#065F46" : "#991B1B",
              border: `1px solid ${banner.type === "success" ? `${MINT}55` : `${RED}55`}`,
              borderRadius: 8,
              font: "500 12.5px/1.4 var(--font-body)",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {banner.type === "success" ? <IconCheck size={14}/> : <IconAlert size={14}/>}
            {banner.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ FORM BODY ═══ */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 22,
        maxWidth: 1100,
      }}>
        {/* ─── Sección 1 · Datos Base & SAP ─── */}
        <Section
          icon={<IconShield size={14}/>}
          title={lang === "es" ? "Datos Base & SAP" : "Base Data & SAP"}
          subtitle={lang === "es"
            ? "Identificación legal, imagen corporativa y códigos del ERP origen."
            : "Legal identification, corporate image and upstream ERP codes."}
        >
          <Grid cols={2}>
            <Field label={lang === "es" ? "Nombre de la empresa" : "Company name"}
                   hint={lang === "es" ? "Nombre comercial o marca pública del cliente." : "Commercial name or public brand."}>
              <Input value={form.nombre_comercial || ""}
                     onChange={v => update("nombre_comercial", v)}
                     placeholder={lang === "es" ? "Ej. Sondel" : "e.g. Sondel"}/>
            </Field>

            <Field label={lang === "es" ? "Razón social" : "Legal name"} required
                   error={showError("razon_social") ? liveErrors.razon_social : null}>
              <Input value={form.razon_social || ""}
                     onChange={v => update("razon_social", v)}
                     onBlur={() => blur("razon_social")}
                     placeholder={lang === "es" ? "Ej. Sondel S.A." : "e.g. Sondel Inc."}/>
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
                   hint={lang === "es"
                     ? "Se mantiene por compatibilidad con registros legacy."
                     : "Kept for legacy compat."}>
              <Input value={form.tax_id || ""}
                     onChange={v => update("tax_id", v)}
                     mono/>
            </Field>
          </Grid>

          {/* Logo corporativo · subida a MinIO igual que productos */}
          <div style={{ marginTop: 18 }}>
            <Field label={lang === "es" ? "Logo del cliente" : "Customer logo"}
                   hint={lang === "es" ? "Imagen .png/.jpg/.webp · máx 10 MB." : "Image .png/.jpg/.webp · max 10 MB."}>
              <FileUploader
                scope={`cliente/${clienteId || "nuevo"}`}
                accept="image/*"
                maxSizeMb={10}
                label={lang === "es" ? "Arrastra el logo o haz clic para seleccionar" : "Drop logo or click to select"}
                onUploaded={(key) => update("logo_url", key)}
                onError={(msg) => console.warn("[upload logo]", msg)}
              />
              {form.logo_url && (
                <div style={{ marginTop: 10, maxWidth: 320 }}>
                  <FilePreview
                    keyOrUrl={form.logo_url}
                    height={160}
                    onDelete={async () => {
                      try {
                        if (form.logo_url && !form.logo_url.startsWith("http://") && !form.logo_url.startsWith("https://")) {
                          await apiFetch(`/storage/delete/?key=${encodeURIComponent(form.logo_url)}`, {
                            method: "DELETE", token: getToken(),
                          });
                        }
                      } catch (_) { /* idempotente — seguimos */ }
                      update("logo_url", "");
                    }}
                  />
                </div>
              )}
            </Field>
          </div>
        </Section>

        {/* ─── Sección 2 · Ubicación y Entrega (LAYOUT EXPANDIDO) ─── */}
        <Section
          icon={<IconMapPin size={14}/>}
          title={lang === "es" ? "Ubicación y Entrega" : "Location & Delivery"}
          subtitle={lang === "es"
            ? "País operativo y dirección física para despachos."
            : "Operating country and physical shipping address."}
        >
          {/* País + Ciudad en 2 columnas propias · mejora el spacing */}
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

          {/* Dirección en fila propia con separación visual */}
          <div style={{ marginTop: 14 }}>
            <Field label={lang === "es" ? "Dirección de entrega" : "Delivery address"}>
              <Textarea value={form.direccion_entrega || ""}
                        onChange={v => update("direccion_entrega", v)}
                        rows={3}
                        placeholder={lang === "es"
                          ? "Calle, número, colonia/distrito, ciudad, estado, código postal…"
                          : "Street, number, district, city, state, ZIP…"}/>
            </Field>
          </div>
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
          {/* Cards de canal */}
          <div style={{ marginBottom: 18 }}>
            <Label>{lang === "es" ? "Canal de venta" : "Sales channel"}</Label>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10, marginTop: 8,
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
                    <div style={{ font: "500 11px/1.4 var(--font-body)",
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
            {/* Sprint 2026-07-18 (G3) · correlativo de OC: último número
                usado de la serie del cliente. El wizard del portal
                auto-numera la próxima OC sin PO como este valor + 1
                (o el mayor PO numérico previo + 1, lo que sea mayor). */}
            <Field label={lang === "es" ? "Correlativo OC" : "OC sequence"}
                   hint={lang === "es"
                     ? "Último usado · la próxima OC sin PO será este + 1"
                     : "Last used · next PO-less OC will be this + 1"}>
              <Input type="number"
                     value={form.oc_correlativo ?? ""}
                     onChange={v => update("oc_correlativo", v === "" ? null : Number(v))}
                     min={0}
                     mono/>
            </Field>
          </Grid>
        </Section>

        {/* ─── Sección 5 · Gobernanza Financiera [CEO-ONLY] ─── */}
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
                  {/* Límite de crédito USD */}
                  <Field label={lang === "es" ? "Límite de crédito (USD)" : "Credit limit (USD)"}
                         error={showError("credito_limit_usd") ? liveErrors.credito_limit_usd : null}>
                    <InputAffixed affixLeft="$" affixRight="USD" mono tabular
                                  type="number" step="0.01" min={0}
                                  value={form.credito_limit_usd ?? ""}
                                  onChange={v => update("credito_limit_usd", v === "" ? null : Number(v))}
                                  onBlur={() => blur("credito_limit_usd")}/>
                  </Field>

                  {/* Comisión pactada · SLIDER + input sincronizado */}
                  <CommissionSlider
                    value={form.comision_pct}
                    onChange={v => update("comision_pct", v)}
                    error={showError("comision_pct") ? liveErrors.comision_pct : null}
                    lang={lang}
                  />
                </Grid>

                <div style={{
                  marginTop: 14, padding: "8px 12px",
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
      </div>

      {/* ─── Footer sticky ─── */}
      <div style={{
        position: "sticky", bottom: 0, zIndex: 4,
        marginTop: 24, padding: "14px 20px",
        background: "var(--surface-raised)",
        backdropFilter: "blur(6px)",
        borderTop: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        boxShadow: "0 -4px 14px -8px rgba(11,30,58,0.10)",
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center",
          font: "500 11px/1 var(--font-body)", color: MUTED }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: estadoMeta.color,
          }}/>
          {lang === "es" ? "Estado" : "Status"}: <strong style={{ color: estadoMeta.color }}>{estadoMeta.l}</strong>
          {!isValid && (
            <span style={{ color: RED, marginLeft: 14,
              display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconAlert size={11}/>
              {Object.keys(liveErrors).length}{" "}
              {lang === "es" ? "error(es)" : "error(s)"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button"
            onClick={() => navigate(isEdit ? `/clientes/${clienteId}` : "/clientes")}
            disabled={saving}
            style={{
              padding: "9px 18px", background: "transparent",
              border: "1px solid var(--border)", color: INK,
              font: "600 12.5px/1 var(--font-body)",
              borderRadius: 8, cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" onClick={save}
            disabled={!isValid || saving}
            style={{
              padding: "9px 22px",
              background: !isValid || saving ? "#94A3B8" : MINT,
              color: "#FFFFFF", border: "none",
              font: "700 12.5px/1 var(--font-body)",
              borderRadius: 8,
              cursor: !isValid || saving ? "not-allowed" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
              transition: "background 130ms ease",
            }}
          >
            <IconCheck size={13}/>
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : isEdit
                ? (lang === "es" ? "Guardar cambios" : "Save changes")
                : (lang === "es" ? "Crear cliente"   : "Create client")}
          </button>
        </div>
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// CommissionSlider · barra 0–30% + input numérico sincronizado
// ═════════════════════════════════════════════════════════════
function CommissionSlider({ value, onChange, error, lang }) {
  // Interno: trabajamos con porcentaje 0..30 (más intuitivo que decimal 0..1).
  // value esperado: decimal (0.085 = 8.5%).
  const pctNum  = value === null || value === undefined || value === ""
    ? 0
    : Number(value) * 100;

  const setByPercent = (pctStr) => {
    const p = Number(pctStr);
    const dec = Number((p / 100).toFixed(4));   // 0.085
    onChange(dec);
  };

  const setByDecimal = (decStr) => {
    if (decStr === "" || decStr === null) { onChange(null); return; }
    const n = Number(decStr);
    if (Number.isNaN(n)) return;
    onChange(Number(n.toFixed(4)));
  };

  // Color según severidad: <10% verde · 10-20% amber · >20% rojo.
  const sliderColor = pctNum >= 20 ? RED : pctNum >= 10 ? AMBER : MINT;

  return (
    <div>
      <Label>
        <IconPercent size={11} style={{ display: "inline", marginRight: 4 }}/>
        {lang === "es" ? "Comisión pactada" : "Agreed commission"}
        <span style={{ marginLeft: "auto", color: sliderColor, fontWeight: 700,
          fontVariantNumeric: "tabular-nums" }}>
          {pctNum.toFixed(2)}%
        </span>
      </Label>

      {/* Slider */}
      <input
        type="range"
        min={0} max={30} step={0.25}
        value={pctNum}
        onChange={e => setByPercent(e.target.value)}
        style={{
          width: "100%",
          accentColor: sliderColor,
          marginTop: 4, marginBottom: 2,
          cursor: "pointer",
        }}
      />
      <div style={{
        display: "flex", justifyContent: "space-between",
        font: "500 9.5px/1 var(--font-body)", color: MUTED,
        marginTop: 2, marginBottom: 10,
      }}>
        <span>0%</span>
        <span style={{ color: MINT }}>10%</span>
        <span style={{ color: AMBER }}>20%</span>
        <span style={{ color: RED }}>30%</span>
      </div>

      {/* Input numérico sincronizado (para tipear valor exacto en decimal) */}
      <InputAffixed
        affixLeft={<IconPercent size={11}/>}
        affixRight="decimal"
        type="number" step="0.0005" min={0} max={0.9999}
        value={value ?? ""}
        onChange={v => setByDecimal(v)}
        mono tabular
      />

      {error ? (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)",
          color: RED, marginTop: 4, display: "inline-flex",
          alignItems: "center", gap: 3 }}>
          <IconAlert size={10}/>
          {error}
        </div>
      ) : (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)",
          color: MUTED, marginTop: 4 }}>
          {lang === "es"
            ? "Decimal: 0.085 = 8.5%. Usa la barra o tipea el valor."
            : "Decimal: 0.085 = 8.5%. Use slider or type the value."}
        </div>
      )}
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Helper: defaults + coerción de shape
// ═════════════════════════════════════════════════════════════
function defaultsFrom(initial) {
  const i = initial || {};
  return {
    razon_social:      i.razon_social      || i.name            || "",
    nombre_comercial:  i.nombre_comercial  || i.nombre_empresa  || i.commercial_name || "",
    logo_url:          i.logo_url          || i.logo            || "",
    codigo_marluvas:   i.codigo_marluvas   || "",
    cedula_juridica:   i.cedula_juridica   || "",
    tax_id:            i.tax_id            || "",
    pais_iso2:         (i.pais_iso2 || i.country_code || i.country || "MX").toUpperCase().slice(0, 2),
    ciudad:            i.ciudad            || i.city            || "",
    direccion_entrega: i.direccion_entrega || i.address         || "",
    contacto_nombre:   i.contacto_nombre   || "",
    contacto_tel:      i.contacto_tel      || i.phone           || "",
    contacto_email:    i.contacto_email    || i.email           || "",
    canal:             (i.canal            || "DISTRIBUIDOR").toUpperCase(),
    incoterm:          i.incoterm          || "CIF",
    medio_pago:        (i.medio_pago       || "TRANSFER_BANCARIA").toUpperCase().replace(/\s+/g, "_"),
    dias_credito:      (i.dias_credito ?? i.credito_dias ?? 60),
    oc_correlativo:    i.oc_correlativo ?? null,
    credito_limit_usd: i.credito_limit_usd ?? i.credito_limit ?? i.credito_aprobado ?? null,
    comision_pct:      i.comision_pct ?? null,
    estado:            (i.estado || i.estado_operativo || "ACTIVO").toUpperCase(),
  };
}


// ═════════════════════════════════════════════════════════════
// Primitivas de UI
// ═════════════════════════════════════════════════════════════
function Section({ icon, title, subtitle, badge, highlight, children }) {
  return (
    <section style={{
      padding: "18px 20px",
      background: "var(--surface-raised)",
      border: `1px solid ${highlight ? `${highlight}33` : "var(--border)"}`,
      borderLeft: highlight ? `3px solid ${highlight}` : `1px solid var(--border)`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: highlight ? `${highlight}15` : `${MINT}15`,
          color: highlight || MINT,
          display: "grid", placeItems: "center",
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY,
            display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {badge && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "3px 8px", borderRadius: 12,
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
            <div style={{ font: "500 12px/1.4 var(--font-body)",
              color: MUTED, marginTop: 3 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 14,
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

function Field({ label, required, error, hint, tooltip, children }) {
  return (
    <div>
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
        width: "100%", padding: "9px 11px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: `500 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
        color: NAVY, background: "var(--surface-raised)", outline: "none",
        fontVariantNumeric: tabular ? "tabular-nums" : undefined,
        transition: "border 120ms ease",
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
          padding: "8px 11px", background: SOFT,
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
          flex: 1, minWidth: 0, padding: "9px 11px",
          border: "none", outline: "none",
          font: `600 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
          color: NAVY,
          fontVariantNumeric: tabular ? "tabular-nums" : undefined,
        }}
      />
      {affixRight && (
        <span style={{
          padding: "8px 11px", background: SOFT,
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
        width: "100%", padding: "9px 11px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: "500 13px/1.2 var(--font-body)", color: NAVY,
        background: "var(--surface-raised)", outline: "none",
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
        width: "100%", padding: "10px 11px",
        border: "1px solid var(--border)", borderRadius: 6,
        font: "500 13px/1.5 var(--font-body)", color: NAVY,
        background: "var(--surface-raised)", outline: "none",
        resize: "vertical",
      }}
    />
  );
}
