// =====================================================================
// MWT.ONE · pages/UserFormView.jsx
// Agente responsable: [AG-FRONTEND]
//
// Vista completa de Crear/Editar usuario (admin-only). Reemplaza el
// UserDrawer slide-in de sprints anteriores — ahora es una página
// con secciones expandidas y un selector de empresa (legal_entity_id)
// que consume /api/legal-entities/ (mock fallback a CLIENTS de demo).
//
// Rutas:
//   /usuarios/nuevo       → create mode
//   /usuarios/:userId     → edit mode
//
// Secciones:
//   A · Info base        (email login, nombre, teléfono, email contacto)
//   B · Rol y acceso     (role_default + estado activo + password inicial)
//   C · Empresa asignada (legal_entity_id · autocomplete desde clientes)
//   D · Idioma + TZ
//   E · Direcciones      (default + adicionales)
//
// Acciones inline: Cancelar · Guardar · (edit) Reset password · Inactivar
// =====================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../lib/api.js";
import { ROLES_DEMO } from "../lib/usersRolesMock.js";
import {
  IconChevLeft, IconCheck, IconPlus, IconX, IconLock, IconRefresh,
} from "../lib/icons.jsx";

const EMPTY_USER = {
  email_plain: "",
  full_name: "",
  contact_email: "",
  phone: "",
  preferred_language: "es",
  timezone: "America/Lima",
  role_default: "viewer",
  legal_entity_id: null,
  is_active: true,
  addresses: [],
  password: "",
};


export default function UserFormView() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const { lang } = useOutletContext() || { lang: "es" };
  const isEdit = Boolean(userId) && userId !== "nuevo";

  const [user, setUser]         = useState(EMPTY_USER);
  const [loading, setLoading]   = useState(isEdit);
  const [saving, setSaving]     = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [error, setError]       = useState(null);
  const [toast, setToast]       = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);

  // ── Cargar empresas (selector) ───────────────────────────
  useEffect(() => {
    let alive = true;
    apiFetch("/legal-entities/", { token: getToken() })
      .then((d) => alive && setCompanies(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ── Cargar usuario (edit) ────────────────────────────────
  const load = useCallback(async () => {
    if (!isEdit) { setLoading(false); return; }
    setLoading(true);
    try {
      const u = await apiFetch(`/users/${userId}/`, { token: getToken() });
      setUser({ ...EMPTY_USER, ...u, password: "" });
      setDirty(false);
    } catch (e) {
      setError(e?.message || "No se pudo cargar el usuario");
    } finally {
      setLoading(false);
    }
  }, [isEdit, userId]);
  useEffect(() => { load(); }, [load]);

  const patch = (delta) => {
    setUser((u) => ({ ...u, ...(typeof delta === "function" ? delta(u) : delta) }));
    setDirty(true);
  };

  function showToast(msg, kind = "ok") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }

  // ── Guardar ─────────────────────────────────────────────
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = { ...user };
      if (isEdit && !body.password) delete body.password;

      // Normalizar addresses al shape del backend.
      // Mapeo de keys del form → modelo Django:
      //   street → address_line_1
      //   country_iso2 → country
      //   zip → zip_code
      // NINGÚN campo es obligatorio. Si quedan vacíos se mandan como null
      // y el backend los acepta (la columna es nullable a partir de A4c).
      // Los ids "locales" (addr-${ts}-...) se eliminan para que el
      // backend los trate como nuevas inserciones; los UUIDs reales se
      // preservan para que el procesador atómico haga UPDATE.
      if (Array.isArray(body.addresses)) {
        body.addresses = body.addresses.map((a) => {
          const isLocalId = typeof a.id === "string" && a.id.startsWith("addr-");
          const out = {
            label:          a.label || null,
            kind:           a.kind  || "SHIPPING",
            address_line_1: a.address_line_1 ?? a.street ?? null,
            address_line_2: a.address_line_2 ?? null,
            city:           a.city  ?? null,
            state:          a.state ?? null,
            country:        a.country ?? a.country_iso2 ?? null,
            zip_code:       a.zip_code ?? a.zip ?? null,
            is_default:     !!a.is_default,
          };
          if (!isLocalId && a.id) out.id = a.id;
          if (a._deleted) out._deleted = true;
          return out;
        });
        // No filtramos: TODAS las direcciones se mandan.
      }
      const resp = isEdit
        ? await apiFetch(`/users/${userId}/`, { method: "PATCH", body, token: getToken() })
        : await apiFetch(`/users/`,            { method: "POST",  body, token: getToken() });
      setUser({ ...EMPTY_USER, ...resp, password: "" });
      setDirty(false);
      showToast(isEdit ? "✓ Usuario actualizado" : "✓ Usuario creado");
      if (!isEdit) {
        // tras crear, navegar al modo edit del recién creado
        setTimeout(() => navigate(`/usuarios/${resp.id}`, { replace: true }), 600);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // demo — fingir éxito
        const fake = { ...user, id: user.id || `u-local-${Date.now()}` };
        setUser({ ...EMPTY_USER, ...fake, password: "" });
        setDirty(false);
        showToast(isEdit ? "(demo) Guardado" : "(demo) Creado");
      } else {
        setError(e?.message || "Error al guardar");
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Acciones inline (solo edit) ─────────────────────────
  const resetPassword = async () => {
    if (!window.confirm(`¿Enviar email de reseteo a ${user.contact_email || user.email_plain}?`)) return;
    try {
      const resp = await apiFetch(`/users/${userId}/reset-password/`, {
        method: "POST", body: { ttl_hours: 24 }, token: getToken(),
      });
      showToast(`✓ Token ····${resp?.token_preview || "????"} · email ${resp?.email_sent ? "enviado" : "encolado"}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast(`✓ (demo) Email de reseteo encolado`);
      } else {
        showToast(`⚠️ ${e?.message}`, "err");
      }
    }
  };

  const toggleActive = async () => {
    const verb = user.is_active ? "inactivar" : "reactivar";
    if (!window.confirm(`¿${verb.charAt(0).toUpperCase() + verb.slice(1)} este usuario?`)) return;
    try {
      await apiFetch(`/users/${userId}/toggle-active/`,
        { method: "POST", token: getToken() });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 0)) {
        showToast(`⚠️ ${e?.message}`, "err"); return;
      }
    }
    patch({ is_active: !user.is_active });
    showToast(`✓ ${verb.charAt(0).toUpperCase() + verb.slice(1)} OK`);
  };

  // ── Empresa seleccionada ────────────────────────────────
  const selectedCompany = useMemo(() =>
    companies.find((c) => c.id === user.legal_entity_id) || null,
    [companies, user.legal_entity_id]);

  const filteredCompanies = useMemo(() => {
    if (!companySearch.trim()) return companies;
    const needle = companySearch.toLowerCase();
    return companies.filter((c) =>
      (c.razon_social || "").toLowerCase().includes(needle) ||
      (c.nombre_comercial || "").toLowerCase().includes(needle) ||
      (c.tax_id || "").toLowerCase().includes(needle));
  }, [companies, companySearch]);

  // ── Direcciones helpers ─────────────────────────────────
  const addAddress = () => {
    const a = {
      id: `addr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: "Nueva dirección",
      street: "",
      city: "",
      country_iso2: "PE",
      zip: "",
      is_default: (user.addresses || []).length === 0,
      is_active: true,
    };
    patch({ addresses: [...(user.addresses || []), a] });
  };
  const updateAddress = (id, updates) => {
    patch({ addresses: (user.addresses || []).map((x) => x.id === id ? { ...x, ...updates } : x) });
  };
  const setAddressDefault = (id) => {
    patch({ addresses: (user.addresses || []).map((x) => ({ ...x, is_default: x.id === id })) });
  };
  const removeAddress = (id) => {
    const remaining = (user.addresses || []).filter((x) => x.id !== id);
    if (remaining.length > 0 && !remaining.some((a) => a.is_default)) {
      remaining[0].is_default = true;
    }
    patch({ addresses: remaining });
  };

  // ── Render ──────────────────────────────────────────────
  if (loading && isEdit) {
    return <div style={{ padding: 48, textAlign: "center", color: "var(--text-tertiary)" }}>Cargando usuario…</div>;
  }
  if (error && !user.email_plain) {
    return <div style={{ padding: 48, color: "#D64545" }}>⚠️ {error}</div>;
  }

  return (
    <div className="page" style={{ padding: 24, maxWidth: 1100, margin: "0 auto", paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate("/usuarios")} className="btn btn-ghost btn-sm">
          <IconChevLeft size={14}/>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)",
            letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2,
          }}>
            {isEdit ? "Editar usuario" : "Nuevo usuario"}
          </div>
          <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)", color: "var(--navy)" }}>
            {isEdit ? (user.full_name || user.email_plain || "—") : "Crear usuario"}
          </h1>
          {isEdit && user.role_default && (
            <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-tertiary)" }}>
              {user.email_plain}
              <span style={{
                marginLeft: 10,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(11,30,58,0.08)", color: "var(--navy)",
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              }}>
                {user.role_default.toUpperCase()}
              </span>
              {!user.is_active && (
                <span style={{
                  marginLeft: 6,
                  padding: "2px 8px", borderRadius: 999,
                  background: "#D64545", color: "#fff",
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                }}>
                  INACTIVO
                </span>
              )}
            </div>
          )}
        </div>
        {isEdit && (
          <>
            <button onClick={resetPassword} className="btn btn-ghost">
              <IconLock size={13}/> Reset password
            </button>
            <button
              onClick={toggleActive}
              className="btn"
              style={{
                background: user.is_active ? "rgba(214,69,69,0.10)" : "rgba(0,178,134,0.10)",
                color: user.is_active ? "#D64545" : "#00B286",
                border: "none", padding: "8px 14px", borderRadius: 6,
                fontSize: 12, fontWeight: 600,
              }}
            >
              {user.is_active ? "Inactivar" : "Activar"}
            </button>
          </>
        )}
        <button onClick={() => navigate("/usuarios")} className="btn btn-ghost">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={!user.email_plain || saving}
          style={{
            background: "var(--mint, #00B286)", color: "#fff", border: "none",
            padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: (user.email_plain && !saving) ? "pointer" : "default",
            opacity: (!user.email_plain || saving) ? 0.6 : 1,
          }}
        >
          <IconCheck size={12}/> {saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear usuario")}
        </button>
      </div>

      {error && (
        <div style={{
          background: "#FCE7E7", color: "#B83227",
          padding: "10px 14px", borderRadius: 8, fontSize: 13,
          marginBottom: 14, border: "1px solid #F0B0B0",
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* A · Info base */}
      <Section title="A · Información base"
               hint="Email de login, nombre y datos de contacto.">
        <div style={styles.grid2}>
          <Field label="Email (login) *">
            <input type="email"
                   value={user.email_plain}
                   onChange={(e) => patch({ email_plain: e.target.value.toLowerCase() })}
                   disabled={isEdit}
                   style={styles.input}/>
          </Field>
          <Field label="Nombre completo">
            <input value={user.full_name || ""}
                   onChange={(e) => patch({ full_name: e.target.value })}
                   style={styles.input}/>
          </Field>
          <Field label="Email de contacto">
            <input type="email"
                   value={user.contact_email || ""}
                   onChange={(e) => patch({ contact_email: e.target.value })}
                   style={styles.input}/>
          </Field>
          <Field label="Teléfono">
            <input value={user.phone || ""}
                   onChange={(e) => patch({ phone: e.target.value })}
                   style={styles.input}/>
          </Field>
        </div>
      </Section>

      {/* B · Rol y acceso */}
      <Section title="B · Rol y acceso"
               hint="Rol principal canónico. Define las capacidades CRUD en la matriz /roles.">
        <div style={styles.grid2}>
          <Field label="Rol principal *">
            <select value={user.role_default}
                    onChange={(e) => patch({ role_default: e.target.value })}
                    style={styles.input}>
              {ROLES_DEMO.map((r) => (
                <option key={r.slug} value={r.slug}>{r.nombre}</option>
              ))}
            </select>
          </Field>
          {!isEdit && (
            <Field label="Contraseña inicial (opcional)">
              <input type="password"
                     value={user.password || ""}
                     onChange={(e) => patch({ password: e.target.value })}
                     placeholder="Dejar vacío para enviar email de invitación"
                     style={styles.input}/>
            </Field>
          )}
        </div>
      </Section>

      {/* C · Empresa asignada */}
      <Section title="C · Empresa asignada"
               hint={
                 user.role_default === "client_b2b"
                   ? "OBLIGATORIO para rol CLIENT — el cliente solo verá expedientes/OCs/documentos de esta empresa."
                   : "Opcional. Para roles internos de MWT no asigna empresa (quedan con scope global). Los datos corporativos vienen del módulo Clientes."
               }>
        {selectedCompany ? (
          <div style={{
            padding: "12px 16px", border: "1px solid var(--mint)",
            background: "rgba(0,178,134,0.06)", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <span style={{ fontSize: 24 }}>{selectedCompany.flag || "🏢"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>
                {selectedCompany.razon_social}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                RUC/CUIT: <code>{selectedCompany.tax_id || "—"}</code>
                {selectedCompany.country && <> · {selectedCompany.country}</>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => patch({ legal_entity_id: null })}
              className="btn btn-ghost btn-sm"
              style={{ color: "#D64545" }}
            >
              <IconX size={12}/> Quitar
            </button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <input
              placeholder="Buscar empresa por razón social, RUC/CUIT o nombre comercial…"
              value={companySearch}
              onChange={(e) => { setCompanySearch(e.target.value); setCompanyOpen(true); }}
              onFocus={() => setCompanyOpen(true)}
              style={styles.input}
            />
            {companyOpen && filteredCompanies.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                background: "#fff", border: "1px solid var(--border)",
                borderRadius: 8, marginTop: 4, maxHeight: 280, overflowY: "auto",
                boxShadow: "0 8px 24px rgba(11,30,58,0.15)",
              }}>
                {filteredCompanies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      patch({ legal_entity_id: c.id });
                      setCompanyOpen(false);
                      setCompanySearch("");
                    }}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "10px 14px", border: "none",
                      borderBottom: "1px solid #F3F5F8", background: "#fff",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#F7F9FC"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                  >
                    <span style={{ fontSize: 18 }}>{c.flag || "🏢"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>
                        {c.razon_social}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        RUC/CUIT: {c.tax_id || "—"} · {c.country}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {companyOpen && filteredCompanies.length === 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                background: "#fff", border: "1px solid var(--border)",
                borderRadius: 8, marginTop: 4, padding: 14,
                fontSize: 12, color: "var(--text-tertiary)",
                boxShadow: "0 8px 24px rgba(11,30,58,0.15)",
              }}>
                Sin coincidencias. Las empresas se gestionan en el módulo Clientes.
              </div>
            )}
          </div>
        )}
      </Section>

      {/* D · Idioma + zona */}
      <Section title="D · Preferencias regionales">
        <div style={styles.grid2}>
          <Field label="Idioma preferido">
            <select value={user.preferred_language || "es"}
                    onChange={(e) => patch({ preferred_language: e.target.value })}
                    style={styles.input}>
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </Field>
          <Field label="Zona horaria">
            <select value={user.timezone || "America/Lima"}
                    onChange={(e) => patch({ timezone: e.target.value })}
                    style={styles.input}>
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

      {/* E · Direcciones */}
      <Section title="E · Direcciones del usuario"
               hint="Una dirección default (se sugiere como destino en nuevas OC) + adicionales (almacenes, sucursales)."
               action={
                 <button onClick={addAddress}
                         className="btn btn-primary"
                         style={{
                           background: "var(--mint, #00B286)", color: "#fff", border: "none",
                           padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                         }}>
                   <IconPlus size={11}/> Agregar dirección
                 </button>
               }>
        {(user.addresses || []).length === 0 ? (
          <div style={{
            padding: 28, textAlign: "center", color: "var(--text-tertiary)",
            fontSize: 13, border: "1px dashed var(--border)", borderRadius: 8,
          }}>
            Sin direcciones. Agrega una para usarla como destino default.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(user.addresses || []).map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                onUpdate={(u) => updateAddress(a.id, u)}
                onSetDefault={() => setAddressDefault(a.id)}
                onRemove={() => removeAddress(a.id)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            style={{
              position: "fixed", bottom: 24, right: 24, zIndex: 200,
              padding: "10px 16px",
              background: toast.kind === "err" ? "#D64545" : "var(--navy)",
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
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)" }}>
            {title}
          </div>
          {hint && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3, lineHeight: 1.4 }}>
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

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: 10, fontWeight: 700,
        color: "var(--text-tertiary)",
        letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4,
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function AddressRow({ address, onUpdate, onSetDefault, onRemove }) {
  return (
    <div style={{
      border: `1.5px solid ${address.is_default ? "var(--mint, #00B286)" : "var(--border)"}`,
      background: address.is_default ? "rgba(0,178,134,0.04)" : "#fff",
      borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <input
          value={address.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Etiqueta"
          style={{ ...styles.input, flex: 1, fontWeight: 600 }}
        />
        {address.is_default ? (
          <span style={{
            padding: "3px 10px", borderRadius: 999,
            background: "var(--mint, #00B286)", color: "#fff",
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          }}>
            ★ DEFAULT
          </span>
        ) : (
          <button type="button" onClick={onSetDefault}
                  className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
            Marcar default
          </button>
        )}
        <button type="button" onClick={onRemove}
                className="btn btn-ghost btn-sm" style={{ color: "#D64545" }}>
          <IconX size={12}/>
        </button>
      </div>
      <div style={styles.grid2}>
        <Field label="Calle y número">
          <input value={address.street}
                 onChange={(e) => onUpdate({ street: e.target.value })}
                 style={styles.input}/>
        </Field>
        <Field label="Ciudad">
          <input value={address.city || ""}
                 onChange={(e) => onUpdate({ city: e.target.value })}
                 style={styles.input}/>
        </Field>
        <Field label="País">
          <select value={address.country_iso2 || "PE"}
                  onChange={(e) => onUpdate({ country_iso2: e.target.value })}
                  style={styles.input}>
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
          <input value={address.zip || ""}
                 onChange={(e) => onUpdate({ zip: e.target.value })}
                 style={styles.input}/>
        </Field>
      </div>
    </div>
  );
}


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
