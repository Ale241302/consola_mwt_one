// =====================================================================
// MWT.ONE · pages/Users.jsx
// Agente responsable: [AG-FRONTEND]
//
// Módulo de usuarios (ADMIN-only). Tabla de alta densidad + modal
// crear/editar + acciones "Inactivar" y "Reset Password".
//
// Endpoints:
//   GET    /api/users/?q=…&role=…&include_inactive=true
//   POST   /api/users/
//   PATCH  /api/users/<uuid>/
//   DELETE /api/users/<uuid>/              (soft-delete)
//   POST   /api/users/<uuid>/reset-password/
//   POST   /api/users/<uuid>/toggle-active/
// =====================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../lib/api.js";
import { ROLES_DEMO } from "../lib/usersRolesMock.js";
import { IconPlus, IconRefresh, IconLock, IconX, IconCheck } from "../lib/icons.jsx";
import ConfirmActionModal, { ACTION_META } from "../components/users/ConfirmActionModal.jsx";
// Ola 3 · 3.25 · Accesibilidad — Field compartido (cablea htmlFor/id).
import { Field } from "../components/ui/index.js";

export default function Users() {
  const { lang } = useOutletContext() || { lang: "es" };
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [drawer, setDrawer] = useState({ open: false, user: null });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (roleFilter) params.set("role", roleFilter);
      if (includeInactive) params.set("include_inactive", "true");
      const data = await apiFetch(`/users/?${params.toString()}`, { token: getToken() });
      setUsers(Array.isArray(data) ? data : (data?.results || []));
    } catch (e) {
      setError(e?.message || "No se pudo cargar");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [q, roleFilter, includeInactive]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  // ── Acciones ─────────────────────────────────────────────
  // Navegan a /usuarios/nuevo o /usuarios/:id — la vista completa vive
  // en UserFormView.jsx.
  const openCreate = () => navigate("/usuarios/nuevo");
  const openEdit   = (u) => navigate(`/usuarios/${u.id}`);
  const closeDrawer = () => setDrawer({ open: false, user: null });

  // ── Confirmación unificada vía modal (reemplaza window.confirm) ──
  // pendingAction: { kind: 'reset'|'toggleOn'|'toggleOff'|'delete', user: {...} }
  const [pendingAction, setPendingAction] = useState(null);
  const [actionBusy,    setActionBusy]    = useState(false);
  const [actionError,   setActionError]   = useState(null);

  const askResetPassword = (u) => { setActionError(null); setPendingAction({ kind: 'reset', user: u }); };
  const askToggleActive  = (u) => { setActionError(null); setPendingAction({ kind: u.is_active ? 'toggleOff' : 'toggleOn', user: u }); };
  const askDelete        = (u) => { setActionError(null); setPendingAction({ kind: 'delete', user: u }); };

  const executeAction = async () => {
    if (!pendingAction) return;
    const { kind, user: u } = pendingAction;
    setActionBusy(true);
    setActionError(null);
    try {
      if (kind === 'reset') {
        const resp = await apiFetch(`/users/${u.id}/reset-password/`, {
          method: "POST", body: { ttl_hours: 24 }, token: getToken(),
        });
        showToast(`Email enviado · ····${resp?.token_preview || "????"} · ${u.contact_email || u.email_plain}`);
      } else if (kind === 'toggleOff' || kind === 'toggleOn') {
        await apiFetch(`/users/${u.id}/toggle-active/`, { method: "POST", token: getToken() });
        const verb = kind === 'toggleOff' ? 'inactivado' : 'reactivado';
        showToast(`${u.full_name || u.email_plain} · ${verb}`);
        setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
      } else if (kind === 'delete') {
        await apiFetch(`/users/${u.id}/`, { method: "DELETE", token: getToken() });
        showToast(`${u.full_name || u.email_plain} eliminado`);
        // remueve de la lista (o marca inactivo según preferencia visual)
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
      }
      setPendingAction(null);
    } catch (e) {
      // mock-mode (status=0) cuenta como "OK simulado" para reset
      if (kind === 'reset' && e instanceof ApiError && e.status === 0) {
        showToast(`(demo) Email de reseteo encolado para ${u.contact_email || u.email_plain}`);
        setPendingAction(null);
      } else {
        setActionError(e?.message || 'Operación falló');
      }
    } finally {
      setActionBusy(false);
    }
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)", color: "var(--text-primary)" }}>
            {lang === "es" ? "Usuarios" : "Users"}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-tertiary)" }}>
            {lang === "es"
              ? "Gestión de usuarios del ERP: staff interno + clientes B2B del portal."
              : "ERP user management: internal staff + B2B portal clients."}
          </p>
        </div>
        <button onClick={load} className="btn btn-ghost" title="Recargar">
          <IconRefresh size={14}/>
        </button>
        <button onClick={openCreate} className="btn btn-primary"
                style={{ background: "var(--mint, #00B286)", color: "#fff", border: "none",
                         padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          <IconPlus size={13}/> {lang === "es" ? "Nuevo usuario" : "New user"}
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          className="input"
          aria-label={lang === "es" ? "Buscar usuarios" : "Search users"}
          placeholder={lang === "es" ? "Buscar por email o nombre…" : "Search by email or name…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220, maxWidth: 400 }}
        />
        <select className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">{lang === "es" ? "Todos los roles" : "All roles"}</option>
          {ROLES_DEMO.map((r) => <option key={r.slug} value={r.slug}>{r.nombre}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          {lang === "es" ? "Incluir inactivos" : "Include inactive"}
        </label>
      </div>

      {/* Tabla */}
      <div style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}>
        <TableHeader lang={lang}/>
        {loading && users.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
            {lang === "es" ? "Cargando…" : "Loading…"}
          </div>
        )}
        {!loading && users.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
            {error ? `⚠️ ${error}` : (lang === "es" ? "No hay usuarios." : "No users.")}
          </div>
        )}
        {users.map((u) => (
          <UserRow key={u.id} user={u}
                   onEdit={() => openEdit(u)}
                   onToggleActive={() => askToggleActive(u)}
                   onResetPassword={() => askResetPassword(u)}
                   onDelete={() => askDelete(u)}
                   lang={lang}/>
        ))}
      </div>

      {/* Modal de confirmación unificado — vía portal a body */}
      {pendingAction && createPortal(
        <ConfirmActionModal
          meta={ACTION_META[pendingAction.kind]}
          user={pendingAction.user}
          busy={actionBusy}
          error={actionError}
          lang={lang}
          onCancel={() => { if (!actionBusy) { setPendingAction(null); setActionError(null); } }}
          onConfirm={executeAction}
        />,
        document.body
      )}

      {/* Modal Create/Edit */}
      <UserDrawer
        open={drawer.open}
        user={drawer.user}
        onClose={closeDrawer}
        onSaved={(u) => {
          if (drawer.user) {
            setUsers((prev) => prev.map((x) => x.id === u.id ? u : x));
            showToast(`${u.full_name || u.email_plain} actualizado`);
          } else {
            setUsers((prev) => [u, ...prev]);
            showToast(`${u.full_name || u.email_plain} creado`);
          }
          closeDrawer();
        }}
        lang={lang}
      />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            style={{
              position: "fixed", bottom: 24, right: 24, zIndex: 200,
              padding: "10px 16px",
              background: toast.kind === "err" ? "var(--critical)" : "var(--brand-primary)",
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


// ─────────────────────────────────────────────────────────────────────
// TableHeader + UserRow
// ─────────────────────────────────────────────────────────────────────
const COL_TEMPLATE = "minmax(200px, 2fr) minmax(180px, 1.4fr) 140px 140px 100px 150px 160px";

function TableHeader({ lang }) {
  const headers = [
    lang === "es" ? "Nombre" : "Name",
    lang === "es" ? "Email" : "Email",
    lang === "es" ? "Rol" : "Role",
    lang === "es" ? "Idioma · Zona" : "Language · TZ",
    lang === "es" ? "Estado" : "Status",
    lang === "es" ? "Último login" : "Last login",
    lang === "es" ? "Acciones" : "Actions",
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: COL_TEMPLATE, gap: 8,
      padding: "10px 14px", background: "var(--bg-alt)",
      borderBottom: "1px solid var(--border)",
      fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
      letterSpacing: 0.5, textTransform: "uppercase",
    }}>
      {headers.map((h, i) => <span key={i}>{h}</span>)}
    </div>
  );
}

function UserRow({ user, onEdit, onToggleActive, onResetPassword, onDelete, lang }) {
  const role = ROLES_DEMO.find((r) => r.slug === user.role_default)
    || { nombre: user.role_default, color: "#64748B" };
  const fmtDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(lang === "es" ? "es-PE" : "en-US", { dateStyle: "short", timeStyle: "short" }); }
    catch { return iso; }
  };

  return (
    <div style={{
      display: "grid", gridTemplateColumns: COL_TEMPLATE, gap: 8,
      padding: "10px 14px",
      borderBottom: "1px solid var(--border)",
      fontSize: 13, alignItems: "center",
      background: user.is_active ? "var(--surface-raised)" : "var(--bg-alt)",
      opacity: user.is_active ? 1 : 0.65,
    }}>
      <span style={{ fontWeight: 600, color: "var(--text-primary)" }} onClick={onEdit}>
        {user.full_name || "(sin nombre)"}
      </span>
      <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
        {user.email_plain}
      </span>
      <span>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 999,
          background: `${role.color}1A`, color: role.color,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
        }}>
          {role.nombre}
        </span>
      </span>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {user.preferred_language?.toUpperCase() || "—"} · {user.timezone || "—"}
      </span>
      <span>
        {user.is_active ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 11, color: "#00B286", fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "#00B286" }}/>
            {lang === "es" ? "Activo" : "Active"}
          </span>
        ) : (
          <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 999,
            background: "var(--critical)", color: "#fff",
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          }}>
            {lang === "es" ? "INACTIVO" : "INACTIVE"}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        {fmtDate(user.last_login_at)}
      </span>
      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button onClick={onEdit} className="ai-btn ai-btn-ghost ai-btn-xs">
          {lang === "es" ? "Editar" : "Edit"}
        </button>
        <button onClick={onResetPassword} className="ai-btn ai-btn-ghost ai-btn-xs"
                title={lang === "es" ? "Enviar reseteo de contraseña" : "Send password reset"}>
          <IconLock size={10}/> {lang === "es" ? "Reset" : "Reset"}
        </button>
        <button onClick={onToggleActive}
                className="ai-btn ai-btn-xs"
                style={{
                  background: user.is_active ? "rgba(214,69,69,0.10)" : "rgba(0,178,134,0.10)",
                  color: user.is_active ? "var(--critical)" : "#00B286",
                  border: "none", padding: "3px 8px", borderRadius: 4,
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}>
          {user.is_active
            ? (lang === "es" ? "Inactivar" : "Deactivate")
            : (lang === "es" ? "Activar"   : "Activate")}
        </button>
        <button onClick={onDelete}
                className="ai-btn ai-btn-xs"
                title={lang === "es" ? "Eliminar usuario (soft-delete)" : "Delete user (soft-delete)"}
                style={{
                  background: "transparent",
                  color: "var(--critical)",
                  border: "1px solid rgba(220,38,38,0.25)",
                  padding: "3px 8px", borderRadius: 4,
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}>
          {lang === "es" ? "Eliminar" : "Delete"}
        </button>
      </span>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// UserDrawer · Create/Edit
// ─────────────────────────────────────────────────────────────────────
function UserDrawer({ open, user, onClose, onSaved, lang }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email_plain: "", full_name: "", contact_email: "",
    phone: "", preferred_language: "es", timezone: "America/Lima",
    role_default: "viewer", is_active: true,
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(isEdit ? {
        email_plain:        user.email_plain || "",
        full_name:          user.full_name || "",
        contact_email:      user.contact_email || "",
        phone:              user.phone || "",
        preferred_language: user.preferred_language || "es",
        timezone:           user.timezone || "America/Lima",
        role_default:       user.role_default || "viewer",
        is_active:          user.is_active ?? true,
        password:           "",
      } : {
        email_plain: "", full_name: "", contact_email: "",
        phone: "", preferred_language: "es", timezone: "America/Lima",
        role_default: "viewer", is_active: true, password: "",
      });
      setError(null);
    }
  }, [open, isEdit, user]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = { ...form };
      if (isEdit && !body.password) delete body.password;
      const resp = isEdit
        ? await apiFetch(`/users/${user.id}/`, { method: "PATCH", body, token: getToken() })
        : await apiFetch(`/users/`,              { method: "POST",  body, token: getToken() });
      onSaved(resp || { ...body, id: `u-local-${Date.now()}`, created_at: new Date().toISOString(), last_login_at: null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // mock mode — simulamos save
        const local = {
          ...form,
          id: user?.id || `u-local-${Date.now()}`,
          created_at: user?.created_at || new Date().toISOString(),
          last_login_at: user?.last_login_at || null,
          is_superuser: user?.is_superuser || false,
        };
        onSaved(local);
      } else {
        setError(e?.message || "Error inesperado");
      }
    } finally { setSaving(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.38)", zIndex: 200 }}
          />
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: 460, maxWidth: "92vw",
              background: "var(--surface-raised)", zIndex: 210,
              boxShadow: "-8px 0 32px rgba(0,0,0,0.20)",
              display: "flex", flexDirection: "column",
            }}
          >
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: 0.4, textTransform: "uppercase" }}>
                  {isEdit ? (lang === "es" ? "Editar usuario" : "Edit user") : (lang === "es" ? "Nuevo usuario" : "New user")}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
                  {isEdit ? (form.full_name || form.email_plain) : (lang === "es" ? "Crear nuevo" : "Create new")}
                </div>
              </div>
              <button onClick={onClose} className="btn btn-ghost" aria-label="close">
                <IconX size={16}/>
              </button>
            </div>

            <div style={{ padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label={lang === "es" ? "Email (login)" : "Email (login)"} required>
                {({ id }) => (
                  <input id={id} className="input" type="email" value={form.email_plain}
                         onChange={(e) => setForm({ ...form, email_plain: e.target.value.toLowerCase() })}
                         disabled={isEdit}/>
                )}
              </Field>
              <Field label={lang === "es" ? "Nombre completo" : "Full name"}>
                {({ id }) => (
                  <input id={id} className="input" value={form.full_name}
                         onChange={(e) => setForm({ ...form, full_name: e.target.value })}/>
                )}
              </Field>
              <Field label={lang === "es" ? "Email de contacto" : "Contact email"}>
                {({ id }) => (
                  <input id={id} className="input" type="email" value={form.contact_email}
                         onChange={(e) => setForm({ ...form, contact_email: e.target.value })}/>
                )}
              </Field>
              <Field label={lang === "es" ? "Teléfono" : "Phone"}>
                {({ id }) => (
                  <input id={id} className="input" value={form.phone || ""}
                         onChange={(e) => setForm({ ...form, phone: e.target.value })}/>
                )}
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={lang === "es" ? "Idioma" : "Language"}>
                  {({ id }) => (
                    <select id={id} className="select" value={form.preferred_language}
                            onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}>
                      <option value="es">Español</option>
                      <option value="en">English</option>
                      <option value="pt">Português</option>
                    </select>
                  )}
                </Field>
                <Field label={lang === "es" ? "Zona horaria" : "Timezone"}>
                  {({ id }) => (
                    <select id={id} className="select" value={form.timezone}
                            onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                      <option>America/Lima</option>
                      <option>America/Santiago</option>
                      <option>America/Argentina/Buenos_Aires</option>
                      <option>America/Mexico_City</option>
                      <option>America/Bogota</option>
                      <option>America/Sao_Paulo</option>
                    </select>
                  )}
                </Field>
              </div>
              <Field label={lang === "es" ? "Rol principal" : "Primary role"}>
                {({ id }) => (
                  <select id={id} className="select" value={form.role_default}
                          onChange={(e) => setForm({ ...form, role_default: e.target.value })}>
                    {ROLES_DEMO.map((r) => <option key={r.slug} value={r.slug}>{r.nombre}</option>)}
                  </select>
                )}
              </Field>
              {!isEdit && (
                <Field label={lang === "es" ? "Contraseña inicial (opcional)" : "Initial password (optional)"}>
                  {({ id }) => (
                    <input id={id} className="input" type="password" value={form.password}
                           onChange={(e) => setForm({ ...form, password: e.target.value })}
                           placeholder={lang === "es" ? "Dejar vacío para enviar invitación" : "Leave empty to send invitation"}/>
                  )}
                </Field>
              )}
              {error && <div style={{ color: "var(--critical)", fontSize: 12 }}>⚠️ {error}</div>}
            </div>

            <div style={{
              padding: "12px 20px", borderTop: "1px solid var(--border)",
              display: "flex", justifyContent: "flex-end", gap: 10,
            }}>
              <button onClick={onClose} className="btn btn-ghost">
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                onClick={save}
                disabled={saving || !form.email_plain}
                style={{
                  background: "var(--mint, #00B286)", color: "#fff", border: "none",
                  padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  opacity: (!form.email_plain || saving) ? 0.6 : 1,
                }}
              >
                <IconCheck size={12}/> {saving ? (lang === "es" ? "Guardando…" : "Saving…")
                                    : (isEdit ? (lang === "es" ? "Guardar cambios" : "Save changes")
                                              : (lang === "es" ? "Crear usuario" : "Create user"))}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ConfirmActionModal vive en components/users/ConfirmActionModal.jsx
// (compartido con UserFormView para mantener el copy + estilos en un solo lugar).
