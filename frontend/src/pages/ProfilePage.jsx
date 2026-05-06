// =====================================================================
// MWT.ONE · pages/ProfilePage.jsx
// Agente responsable: [AG-FRONTEND]
//
// Vista completa del perfil del usuario autenticado (la que abre la
// tuerca ⚙ del header).
//
// Tabs:
//   1. Datos personales   · nombre, email, teléfono, idioma, zona horaria
//                           → CLIENT: read-only en todo excepto contact_email,
//                                     preferred_language y timezone (política
//                                     MWT — son los únicos campos que puede
//                                     auto-modificar un B2B)
//                           → ADMIN:  editable
//   2. Direcciones        · default + múltiples · editable por el propio user
//                           (CRUD in-memory; persist en preferences.addresses)
//   3. Mi empresa         · SOLO si user.legal_entity_id — muestra la ficha
//                           completa de la empresa (razón social, RUC/tax_id,
//                           email, phone, país, dirección fiscal). SIEMPRE
//                           read-only — si el CLIENT quiere cambiar algo,
//                           debe contactar a su Account Manager.
//   4. Sistema (admin)    · LLMs + API Keys + Políticas (atajos)
//
// Endpoints:
//   GET   /api/users/me/profile/
//   PATCH /api/users/me/profile/
//   GET   /api/legal-entities/<id>/
// =====================================================================
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";
import {
  IconChevLeft, IconCheck, IconPlus, IconX, IconLock, IconRefresh,
} from "../lib/icons.jsx";

const TABS = [
  { key: "personal",  label: "Datos personales", icon: "👤" },
  { key: "addresses", label: "Direcciones",      icon: "📍" },
  { key: "company",   label: "Mi empresa",       icon: "🏢" },
  { key: "system",    label: "Sistema",          icon: "⚙️" },  // admin only
];


export default function ProfilePage() {
  const navigate = useNavigate();
  const { isClient, isAdmin } = useRole();

  const [profile, setProfile] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("personal");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Sprint 2026-05-06 · todas las empresas asociadas al usuario.
  // Primera = empresa primaria (legal_entity_id legacy / lehgal_entity_ids[0]).
  const [companies, setCompanies] = useState([]);

  // ── Cargar perfil + empresa(s) (si aplica) ─────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiFetch("/users/me/profile/", { token: getToken() });
      setProfile(me);
      // Resolver el array completo legal_entity_ids; compat con singular.
      const ids = Array.isArray(me?.legal_entity_ids) ? me.legal_entity_ids.slice() : [];
      if (me?.legal_entity_id && !ids.includes(me.legal_entity_id)) {
        ids.unshift(me.legal_entity_id);
      }
      if (ids.length === 0) {
        setCompany(null);
        setCompanies([]);
        return;
      }
      // Empresa primaria → tab "Mi empresa" (compat existente).
      try {
        const co = await apiFetch(`/legal-entities/${ids[0]}/`,
          { token: getToken() });
        setCompany(co);
      } catch { setCompany(null); }
      // Lista completa para mostrar todas las asociadas (read-only).
      try {
        const all = await Promise.all(
          ids.map((id) => apiFetch(`/legal-entities/${id}/`, { token: getToken() }).catch(() => null))
        );
        setCompanies(all.filter(Boolean));
      } catch { setCompanies([]); }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Filtrar tabs visibles por rol + si tiene empresa
  const visibleTabs = TABS.filter((t) => {
    if (t.key === "system")  return isAdmin;                 // admin-only
    if (t.key === "company") return !!profile?.legal_entity_id;
    return true;
  });

  // Si el activeTab queda fuera de los visibles, re-anclamos.
  useEffect(() => {
    if (!visibleTabs.find((t) => t.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || "personal");
    }
  }, [visibleTabs, activeTab]);

  // ── Helpers ─────────────────────────────────────────────
  const patch = (delta) => {
    setProfile((p) => ({ ...p, ...(typeof delta === "function" ? delta(p) : delta) }));
    setDirty(true);
  };

  const save = async () => {
    if (!dirty || !profile) return;
    setSaving(true);
    try {
      const body = {
        contact_email:      profile.contact_email || "",
        preferred_language: profile.preferred_language || "es",
        timezone:           profile.timezone || "America/Lima",
        // Direcciones viajan dentro de preferences (JSONB libre)
        preferences: { ...(profile.preferences || {}), addresses: profile.addresses || [] },
      };
      // Admin puede cambiar más cosas
      if (!isClient) {
        body.full_name = profile.full_name || "";
        body.phone     = profile.phone || "";
      }
      const updated = await apiFetch("/users/me/profile/", {
        method: "PATCH", body, token: getToken(),
      });
      setProfile((p) => ({ ...p, ...updated }));
      setDirty(false);
      showToast(`✓ Cambios guardados`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // mock mode
        setDirty(false);
        showToast(`✓ (demo) Cambios simulados`);
      } else {
        showToast(`⚠️ ${e?.message || "Error"}`, "err");
      }
    } finally {
      setSaving(false);
    }
  };

  function showToast(msg, kind = "ok") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }

  if (loading && !profile) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--text-tertiary)" }}>
        Cargando perfil…
      </div>
    );
  }
  if (!profile) {
    return (
      <div style={{ padding: 48, color: "#D64545" }}>
        ⚠️ No se pudo resolver tu perfil. Intenta recargar.
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" aria-label="back">
          <IconChevLeft size={14}/>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)",
            letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2,
          }}>
            Mi perfil
          </div>
          <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)", color: "var(--navy, #0B1E3A)" }}>
            {profile.full_name || profile.email_plain}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 2 }}>
            {profile.email_plain}
            {profile.role_default && (
              <span style={{
                marginLeft: 10,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(11,30,58,0.08)", color: "var(--navy)",
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              }}>
                {profile.role_default.toUpperCase()}
              </span>
            )}
          </div>
        </div>
        {dirty && (
          <button onClick={() => { load(); setDirty(false); }} className="btn btn-ghost btn-sm">
            <IconRefresh size={13}/> Descartar
          </button>
        )}
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            background: dirty ? "var(--mint, #00B286)" : "#E1E6ED",
            color: dirty ? "#fff" : "var(--text-tertiary)",
            border: "none", padding: "9px 18px", borderRadius: 8,
            fontSize: 13, fontWeight: 600,
            cursor: (dirty && !saving) ? "pointer" : "default",
          }}
        >
          <IconCheck size={12}/> {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, marginTop: 20, marginBottom: 18,
        borderBottom: "1px solid var(--border, #E1E6ED)",
      }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "10px 16px", border: "none", background: "transparent",
              borderBottom: `2px solid ${activeTab === t.key ? "var(--mint, #00B286)" : "transparent"}`,
              color: activeTab === t.key ? "var(--navy)" : "var(--text-tertiary)",
              fontWeight: activeTab === t.key ? 600 : 500,
              fontSize: 13, cursor: "pointer",
              marginBottom: -1,
            }}
          >
            <span style={{ marginRight: 6 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      {activeTab === "personal"  && <PersonalTab profile={profile} patch={patch} isClient={isClient}/>}
      {activeTab === "addresses" && <AddressesTab profile={profile} patch={patch}/>}
      {activeTab === "company"   && <CompanyTab   company={company} companies={companies} primaryId={profile?.legal_entity_id}/>}
      {activeTab === "system" && isAdmin && <SystemTab/>}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            style={{
              position: "fixed", bottom: 24, right: 24, zIndex: 200,
              padding: "10px 16px",
              background: toast.kind === "err" ? "#D64545" : "var(--navy, #0B1E3A)",
              color: "#fff", borderRadius: 8, fontSize: 13,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// =====================================================================
// Tabs
// =====================================================================
function PersonalTab({ profile, patch, isClient }) {
  // CLIENT puede modificar: contact_email, preferred_language, timezone.
  // ADMIN puede modificar TODO (incluyendo full_name + phone).
  // email_plain es SIEMPRE read-only (es el login — cambiarlo rompería auth).
  return (
    <Section
      title="Datos personales"
      hint={isClient
        ? "Tu email de login, nombre y rol los gestiona tu Account Manager. Puedes actualizar tu email de contacto, idioma y zona horaria."
        : "Información de tu cuenta en MWT.ONE."}
    >
      <div style={styles.grid2}>
        <Field label="Email (login)" readOnly>
          <input type="email" value={profile.email_plain} disabled style={styles.input}/>
        </Field>
        <Field label="Rol principal" readOnly>
          <input value={profile.role_default} disabled style={styles.input}/>
        </Field>

        <Field label="Nombre completo" readOnly={isClient}>
          <input
            value={profile.full_name || ""}
            onChange={(e) => patch({ full_name: e.target.value })}
            disabled={isClient}
            style={styles.input}
          />
        </Field>
        <Field label="Teléfono" readOnly={isClient}>
          <input
            value={profile.phone || ""}
            onChange={(e) => patch({ phone: e.target.value })}
            disabled={isClient}
            style={styles.input}
          />
        </Field>

        <Field label="Email de contacto">
          <input
            type="email"
            value={profile.contact_email || ""}
            onChange={(e) => patch({ contact_email: e.target.value })}
            style={styles.input}
          />
        </Field>
        <Field label="Idioma preferido">
          <select
            value={profile.preferred_language || "es"}
            onChange={(e) => patch({ preferred_language: e.target.value })}
            style={styles.input}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
          </select>
        </Field>

        <Field label="Zona horaria">
          <select
            value={profile.timezone || "America/Lima"}
            onChange={(e) => patch({ timezone: e.target.value })}
            style={styles.input}
          >
            <option>America/Lima</option>
            <option>America/Santiago</option>
            <option>America/Argentina/Buenos_Aires</option>
            <option>America/Mexico_City</option>
            <option>America/Bogota</option>
            <option>America/Sao_Paulo</option>
          </select>
        </Field>
      </div>
    </Section>
  );
}


function AddressesTab({ profile, patch }) {
  const addresses = Array.isArray(profile.addresses) ? profile.addresses : [];

  const addAddress = () => {
    const newAddr = {
      id: `addr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "Nueva dirección",
      street: "",
      city: "",
      country_iso2: "PE",
      zip: "",
      is_default: addresses.length === 0,
      is_active: true,
    };
    patch({ addresses: [...addresses, newAddr] });
  };

  const updateAddress = (id, updates) => {
    patch({
      addresses: addresses.map((a) => a.id === id ? { ...a, ...updates } : a),
    });
  };

  const setDefault = (id) => {
    patch({
      addresses: addresses.map((a) => ({ ...a, is_default: a.id === id })),
    });
  };

  const removeAddress = (id) => {
    if (!window.confirm("¿Eliminar esta dirección?")) return;
    const remaining = addresses.filter((a) => a.id !== id);
    // Si borramos la default, hacer default al primero que queda
    if (remaining.length > 0 && !remaining.some((a) => a.is_default)) {
      remaining[0].is_default = true;
    }
    patch({ addresses: remaining });
  };

  return (
    <Section
      title="Direcciones"
      hint="Puedes tener una dirección por defecto y varias adicionales (almacenes, sucursales, entregas). La default se usa como destino sugerido en nuevas OC."
      action={
        <button onClick={addAddress} className="btn btn-primary"
                style={{
                  background: "var(--mint, #00B286)", color: "#fff", border: "none",
                  padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                }}>
          <IconPlus size={11}/> Agregar dirección
        </button>
      }
    >
      {addresses.length === 0 ? (
        <div style={{
          padding: 32, textAlign: "center",
          color: "var(--text-tertiary)", fontSize: 13,
          border: "1px dashed var(--border)", borderRadius: 8,
        }}>
          No tienes direcciones guardadas. Agrega una para que sea tu destino de entrega por defecto.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {addresses.map((a) => (
            <div key={a.id} style={{
              border: `1.5px solid ${a.is_default ? "var(--mint, #00B286)" : "var(--border)"}`,
              background: a.is_default ? "rgba(0,178,134,0.04)" : "#fff",
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <input
                  value={a.label}
                  onChange={(e) => updateAddress(a.id, { label: e.target.value })}
                  placeholder="Etiqueta (Casa, Oficina, Almacén…)"
                  style={{ ...styles.input, flex: 1, fontWeight: 600 }}
                />
                {a.is_default ? (
                  <span style={{
                    padding: "3px 10px", borderRadius: 999,
                    background: "var(--mint, #00B286)", color: "#fff",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  }}>
                    ★ DEFAULT
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDefault(a.id)}
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                  >
                    Marcar default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeAddress(a.id)}
                  className="btn btn-ghost btn-sm"
                  style={{ color: "#D64545" }}
                  title="Eliminar"
                >
                  <IconX size={12}/>
                </button>
              </div>

              <div style={styles.grid2}>
                <Field label="Calle y número" className="span-2">
                  <input
                    value={a.street}
                    onChange={(e) => updateAddress(a.id, { street: e.target.value })}
                    style={styles.input}
                    placeholder="Av. Javier Prado 2450, piso 8"
                  />
                </Field>
                <Field label="Ciudad">
                  <input
                    value={a.city || ""}
                    onChange={(e) => updateAddress(a.id, { city: e.target.value })}
                    style={styles.input}
                  />
                </Field>
                <Field label="País">
                  <select
                    value={a.country_iso2 || "PE"}
                    onChange={(e) => updateAddress(a.id, { country_iso2: e.target.value })}
                    style={styles.input}
                  >
                    <option value="PE">🇵🇪 Perú</option>
                    <option value="CL">🇨🇱 Chile</option>
                    <option value="AR">🇦🇷 Argentina</option>
                    <option value="CO">🇨🇴 Colombia</option>
                    <option value="MX">🇲🇽 México</option>
                    <option value="BR">🇧🇷 Brasil</option>
                    <option value="EC">🇪🇨 Ecuador</option>
                    <option value="UY">🇺🇾 Uruguay</option>
                  </select>
                </Field>
                <Field label="Código postal">
                  <input
                    value={a.zip || ""}
                    onChange={(e) => updateAddress(a.id, { zip: e.target.value })}
                    style={styles.input}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}


/**
 * @typedef {Object} CompanyTabProps
 * @property {object|null} company — empresa primaria (compat singular).
 * @property {Array<object>} [companies] — todas las empresas asociadas.
 * @property {string|null} [primaryId] — id de la empresa primaria.
 */
/** @param {CompanyTabProps} props */
function CompanyTab({ company, companies = [], primaryId = null }) {
  if (!company) {
    return (
      <Section title="Mi empresa" hint="Este perfil no está asociado a ninguna empresa cliente.">
        <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
          Staff interno de MWT · sin empresa asignada.
        </div>
      </Section>
    );
  }
  return (
    <Section
      title="Mis empresas"
      hint={
        <>
          <IconLock size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>
          Datos corporativos administrados por tu Account Manager. Para cambios, contacta a
          soporte@mwt.one con tu RUC/CUIT como referencia.
        </>
      }
    >
      {/* Sprint 2026-05-06 · si hay más de 1 empresa, mostramos la lista
          arriba con la primaria marcada. La empresa primaria se sigue
          renderizando con detalle en la card de abajo. */}
      {companies && companies.length > 1 && (
        <div style={{
          marginBottom: 14,
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
            letterSpacing: 0.5, textTransform: "uppercase",
          }}>
            Empresas asociadas ({companies.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {companies.map((c) => {
              const isPrimary = c.id === primaryId;
              return (
                <span key={c.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "5px 10px",
                  background: isPrimary ? "rgba(0,178,134,0.10)" : "rgba(11,30,58,0.04)",
                  border: isPrimary ? "1px solid rgba(0,178,134,0.40)" : "1px solid var(--border)",
                  borderRadius: 999, fontSize: 12,
                  fontWeight: isPrimary ? 700 : 500,
                  color: "var(--navy, #0B1E3A)",
                }}>
                  {isPrimary && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                      color: "var(--mint, #00B286)",
                    }}>★ PRIMARIA</span>
                  )}
                  <span>{c.razon_social || c.nombre_comercial || "—"}</span>
                  {c.tax_id && (
                    <code className="mono-sm" style={{
                      fontSize: 10, color: "var(--text-tertiary)",
                    }}>{c.tax_id}</code>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div style={{
        padding: 20, border: "1px solid var(--border)", borderRadius: 10,
        background: "#FAFBFD",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 22 }}>{company.flag || "🏢"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)" }}>
              {company.razon_social}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {company.nombre_comercial && company.nombre_comercial !== company.razon_social
                ? `${company.nombre_comercial} · `
                : ""}
              {company.country || "—"}
            </div>
          </div>
          {company.band && (
            <span style={{
              padding: "3px 10px", borderRadius: 999,
              background: `${bandColor(company.band)}22`, color: bandColor(company.band),
              fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            }}>
              {company.band}
            </span>
          )}
        </div>

        <div style={styles.grid2}>
          <ReadOnlyField label="RUC / CUIT / Tax ID" value={company.tax_id}/>
          <ReadOnlyField label="País"                 value={company.country || "—"}/>
          <ReadOnlyField label="Email corporativo"    value={company.email || "—"}/>
          <ReadOnlyField label="Teléfono"             value={company.phone || "—"}/>
          <div style={{ gridColumn: "1 / span 2" }}>
            <ReadOnlyField label="Dirección fiscal"   value={company.direccion_fiscal || "—"}/>
          </div>
          <ReadOnlyField label="Contacto comercial"   value={company.contacto_nombre || "—"}/>
          <ReadOnlyField
            label="Condiciones"
            value={`${company.credito_dias ?? "—"} días · límite ${company.credito_limit ? "$" + Number(company.credito_limit).toLocaleString("en-US") : "—"}`}
          />
        </div>
      </div>
    </Section>
  );
}


function SystemTab() {
  return (
    <Section
      title="Configuración del sistema"
      hint="Accesos rápidos a los ajustes globales de MWT.ONE. Solo visibles para administradores."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <SystemCard icon="🧠" title="LLMs · Routing"
          body="Modelo por tipo de agente (chat, internal, client). Temperatura por default."
          meta={["CHAT: sonnet-4-6","INTERNAL: opus-4-6","CLIENT (SVC-01): haiku-4-5"]}/>
        <SystemCard icon="🔑" title="API Keys"
          body="Claves activas + rotación programada cada 90 días."
          meta={["Anthropic: sk-····2f41","Mailgun: key-····87e0","MinIO: mwt-console-····"]}/>
        <SystemCard icon="🛡️" title="Políticas activas"
          body="Normativas transversales aplicadas al sistema."
          meta={["POL_VISIBILIDAD v4.6.7","POL_DETERMINISMO strict","POL_STAMP required"]}/>
      </div>
    </Section>
  );
}


// =====================================================================
// Primitivos
// =====================================================================
function Section({ title, hint, action, children }) {
  return (
    <section style={{
      background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
      padding: "18px 22px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: "var(--navy)",
          }}>
            {title}
          </div>
          {hint && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.5 }}>
              {hint}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, readOnly, children, className }) {
  return (
    <label className={className} style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: 10, fontWeight: 700,
        color: "var(--text-tertiary, #64748B)",
        letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4,
      }}>
        {label} {readOnly && <IconLock size={10} style={{ verticalAlign: -1, marginLeft: 4 }}/>}
      </span>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
        letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--navy)", fontWeight: 500 }}>
        {value || "—"}
      </div>
    </div>
  );
}

function SystemCard({ icon, title, body, meta }) {
  return (
    <div style={{
      padding: 14, border: "1px solid var(--border)", borderRadius: 10,
      background: "#FAFBFD",
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, lineHeight: 1.4 }}>
        {body}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 11 }}>
        {(meta || []).map((m, i) => (
          <li key={i} style={{ color: "var(--text-secondary)", padding: "3px 0", borderBottom: "1px dashed #EEF2F7" }}>
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

function bandColor(band) {
  return band === "GREEN"  ? "#00B286"
       : band === "AMBER"  ? "#E09F3E"
       : band === "RED"    ? "#D64545"
       : "#64748B";
}


// =====================================================================
// Estilos compartidos
// =====================================================================
const styles = {
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid var(--border, #E1E6ED)",
    borderRadius: 8,
    fontSize: 13,
    color: "var(--navy, #0B1E3A)",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  },
};
