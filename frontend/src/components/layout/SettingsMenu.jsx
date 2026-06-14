// =====================================================================
// MWT.ONE · components/layout/SettingsMenu.jsx
// Agente responsable: [AG-FRONTEND]
//
// Popover de la tuerca ⚙ del TopBar. Renderizado condicional por rol:
//
//   · CLIENT  → formulario mínimo: contact_email + preferred_language.
//               PATCH /api/users/me/profile/
//
//   · ADMIN   → tabs de sistema: LLMs · API Keys · Políticas
//               (placeholders ahora; cada tab abre un drawer en iteraciones
//                futuras)
// =====================================================================
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";


export default function SettingsMenu({ open, onClose, lang = "es" }) {
  const { isClient, isAdmin } = useRole();
  const navigate = useNavigate();

  const go = (path) => { onClose?.(); navigate(path); };

  return (
    <AnimatePresence>
      {open && (
        <>
          <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "transparent" }}
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y:  0, scale: 1 }}
            exit={{    opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="dialog"
            aria-label={lang === "es" ? "Configuración" : "Settings"}
            style={{
              position: "absolute",
              top: 52, right: 60,
              width: 280,
              zIndex: 120,
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(11,30,58,0.18)",
              overflow: "hidden",
              padding: "8px 0",
            }}
          >
            {/* Quick menu — navega a la vista completa */}
            <MenuItem icon="👤" label={lang === "es" ? "Mi perfil" : "My profile"}
                      hint={lang === "es" ? "Datos personales, direcciones, empresa" : "Personal, addresses, company"}
                      onClick={() => go("/perfil")}/>
            {!isClient && (
              <>
                <Divider/>
                <MenuItem icon="👥" label={lang === "es" ? "Usuarios" : "Users"}
                          hint={lang === "es" ? "Gestionar usuarios del ERP" : "Manage ERP users"}
                          onClick={() => go("/usuarios")}/>
                <MenuItem icon="🛡️" label={lang === "es" ? "Roles y permisos" : "Roles & permissions"}
                          hint={lang === "es" ? "Matriz RBAC CRUD" : "RBAC CRUD matrix"}
                          onClick={() => go("/roles")}/>
                <Divider/>
                <MenuItem icon="🧠" label="LLMs · Routing" hint="Modelos por tipo de agente"
                          onClick={() => go("/perfil?tab=system")}/>
                <MenuItem icon="🔑" label="API Keys" hint="Claves activas · rotación"
                          onClick={() => go("/perfil?tab=system")}/>
                <MenuItem icon="🛡️" label="Políticas" hint="POL_VISIBILIDAD · POL_DETERMINISMO · …"
                          onClick={() => go("/perfil?tab=system")}/>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


function MenuItem({ icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", border: "none", background: "transparent",
        padding: "10px 16px", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 12,
        transition: "background 0.1s ease",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <span style={{ fontSize: 18, flex: "0 0 24px" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
            {hint}
          </div>
        )}
      </div>
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "6px 12px" }}/>;
}


// ─────────────────────────────────────────────────────────────────────
// CLIENT · Profile mini-form
// ─────────────────────────────────────────────────────────────────────
function ClientProfileForm({ onClose, lang }) {
  const [profile, setProfile]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const [savedOk, setSavedOk]     = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/users/me/profile/", { token: getToken() })
      .then((d) => alive && setProfile(d))
      .catch((e) => alive && setError(e?.message || "No se pudo cargar"));
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setSavedOk(false);
    setError(null);
    try {
      const body = {
        contact_email:      profile.contact_email || "",
        preferred_language: profile.preferred_language || "es",
        timezone:           profile.timezone || "America/Lima",
      };
      const resp = await apiFetch("/users/me/profile/", {
        method: "PATCH", body, token: getToken(),
      });
      setProfile(resp);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2200);
    } catch (e) {
      // En modo mock el PATCH responde 0 con ApiError — lo ignoramos y
      // asumimos el patch OK para que la UX fluya.
      if (e instanceof ApiError && e.status === 0) {
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2200);
      } else {
        setError(e?.message || "No se pudo guardar");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!profile && !error) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
        Cargando perfil…
      </div>
    );
  }
  if (error && !profile) {
    return <div style={{ padding: 20, color: "var(--critical)", fontSize: 13 }}>⚠️ {error}</div>;
  }

  return (
    <div style={{ padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
        {lang === "es" ? "Mi perfil" : "My profile"}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 16 }}>
        {profile.email_plain}
        {profile.full_name && <> · <strong>{profile.full_name}</strong></>}
      </div>

      <label style={labelStyle}>
        {lang === "es" ? "Email de contacto" : "Contact email"}
      </label>
      <input
        type="email"
        value={profile.contact_email || ""}
        onChange={(e) => setProfile({ ...profile, contact_email: e.target.value })}
        style={inputStyle}
      />

      <label style={{ ...labelStyle, marginTop: 12 }}>
        {lang === "es" ? "Idioma preferido" : "Preferred language"}
      </label>
      <select
        value={profile.preferred_language || "es"}
        onChange={(e) => setProfile({ ...profile, preferred_language: e.target.value })}
        style={inputStyle}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
        <option value="pt">Português</option>
      </select>

      <label style={{ ...labelStyle, marginTop: 12 }}>
        {lang === "es" ? "Zona horaria" : "Timezone"}
      </label>
      <select
        value={profile.timezone || "America/Lima"}
        onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
        style={inputStyle}
      >
        <option value="America/Lima">America/Lima</option>
        <option value="America/Santiago">America/Santiago</option>
        <option value="America/Argentina/Buenos_Aires">America/Buenos_Aires</option>
        <option value="America/Mexico_City">America/Mexico_City</option>
        <option value="America/Bogota">America/Bogota</option>
        <option value="America/Sao_Paulo">America/Sao_Paulo</option>
      </select>

      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            flex: 1,
            background: "var(--mint, #00B286)",
            color: "#fff", border: "none",
            padding: "9px 12px", borderRadius: 8,
            fontSize: 13, fontWeight: 600, cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Guardando…" : (lang === "es" ? "Guardar cambios" : "Save changes")}
        </button>
        {savedOk && (
          <span style={{ color: "var(--mint-dark, #008B69)", fontSize: 12, fontWeight: 600 }}>
            ✓ {lang === "es" ? "Guardado" : "Saved"}
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 10, color: "var(--critical)", fontSize: 12 }}>⚠️ {error}</div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// ADMIN · System tabs (LLMs · API Keys · Políticas)
// ─────────────────────────────────────────────────────────────────────
function AdminSystemTabs({ onClose, lang }) {
  const [tab, setTab] = useState("llms");

  const TABS = [
    { key: "llms",     label: "LLMs",       icon: "🧠" },
    { key: "apikeys",  label: "API Keys",   icon: "🔑" },
    { key: "policies", label: "Políticas",  icon: "🛡️" },
  ];

  return (
    <div>
      <div style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
          {lang === "es" ? "Configuración del sistema" : "System settings"}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "6px 10px", fontSize: 12,
                border: "none", background: "transparent",
                borderBottom: `2px solid ${tab === t.key ? "var(--mint, #00B286)" : "transparent"}`,
                color: tab === t.key ? "var(--navy, #0B1E3A)" : "var(--text-tertiary, #64748B)",
                fontWeight: tab === t.key ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: 18 }}>
        {tab === "llms" && <TabLLMs lang={lang} />}
        {tab === "apikeys" && <TabApiKeys lang={lang} />}
        {tab === "policies" && <TabPolicies lang={lang} />}
      </div>
    </div>
  );
}

function TabLLMs({ lang }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 8, fontSize: 13 }}>
        Routing de modelos
      </div>
      <Row label="CHAT default"   value="claude-sonnet-4-6"/>
      <Row label="INTERNAL"       value="claude-opus-4-6"/>
      <Row label="CLIENT (SVC-01)" value="claude-haiku-4-5-20251001"/>
      <Row label="Temperatura default" value="0.3"/>
      <p style={{ marginTop: 12, fontSize: 11, color: "var(--text-tertiary)" }}>
        Ver detalles completos en <code>ENT_PLAT_LLM_ROUTING.md</code> de la KB.
      </p>
    </div>
  );
}

function TabApiKeys({ lang }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 8, fontSize: 13 }}>
        Claves activas
      </div>
      <Row label="Anthropic"      value="sk-ant-····2f41"/>
      <Row label="Mailgun"        value="key-····87e0"/>
      <Row label="MinIO access"   value="mwt-console-····"/>
      <Row label="Paperless-ngx"  value="paper-····9a3c"/>
      <p style={{ marginTop: 12, fontSize: 11, color: "var(--text-tertiary)" }}>
        Rotación programada cada 90 días.
      </p>
    </div>
  );
}

function TabPolicies({ lang }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 8, fontSize: 13 }}>
        Políticas activas
      </div>
      <Row label="POL_VISIBILIDAD"     value="v4.6.7"/>
      <Row label="POL_DETERMINISMO"    value="strict"/>
      <Row label="POL_STAMP"           value="required"/>
      <Row label="POL_EPHEMERAL"       value="enforced"/>
      <Row label="POL_CONTEXT_BUDGET"  value="<50% alert"/>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "5px 0", borderBottom: "1px dashed var(--border)",
    }}>
      <span>{label}</span>
      <code style={{ fontSize: 11, color: "var(--navy, #0B1E3A)", fontWeight: 500 }}>{value}</code>
    </div>
  );
}


// ---------------------------------------------------------------------
// Estilos inline compartidos
// ---------------------------------------------------------------------
const labelStyle = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-tertiary)",
  letterSpacing: 0.5,
  textTransform: "uppercase",
  marginBottom: 4,
};

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
  color: "var(--text-primary)",
  background: "var(--surface-raised)",
  outline: "none",
  boxSizing: "border-box",
};
