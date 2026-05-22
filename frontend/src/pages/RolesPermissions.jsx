// =====================================================================
// MWT.ONE · pages/RolesPermissions.jsx
// Agente responsable: [AG-FRONTEND]
//
// Matriz RBAC. Dropdown para elegir rol + tabla (filas=módulos,
// columnas=Crear/Leer/Actualizar/Eliminar) con checkboxes.
//
// Endpoints:
//   GET   /api/permissions/roles/
//   GET   /api/permissions/groups/<slug>/        → matriz del rol
//   PATCH /api/permissions/groups/<slug>/        → guarda la matriz
// =====================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../lib/api.js";
import { IconCheck, IconRefresh, IconPlus, IconX, IconAlert, IconLock } from "../lib/icons.jsx";

// Iconos no presentes en lib/icons — definidos inline.
const IconTrash = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
  </svg>
);
const IconSave = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
);

export default function RolesPermissions() {
  const { lang } = useOutletContext() || { lang: "es" };

  const [roles, setRoles]           = useState([]);
  const [selectedRole, setSelRole]  = useState("manager");
  const [matrix, setMatrix]         = useState([]);
  const [roleMeta, setRoleMeta]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [dirty, setDirty]           = useState(false);
  const [toast, setToast]           = useState(null);
  // CRUD de roles
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);   // role obj a eliminar
  const [crudBusy, setCrudBusy]     = useState(false);

  // Cargar roles
  const loadRoles = useCallback(async () => {
    try {
      const d = await apiFetch("/permissions/roles/", { token: getToken() });
      const arr = Array.isArray(d) ? d : (d?.results || []);
      setRoles(arr);
      return arr;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // ── Crear nuevo rol ──────────────────────────────────────
  const createRole = async (form) => {
    setCrudBusy(true);
    try {
      const created = await apiFetch("/roles/", {
        method: "POST",
        body: {
          slug:        form.slug,
          nombre:      form.nombre,
          descripcion: form.descripcion || "",
          color:       form.color || "#64748B",
          orden:       Number(form.orden || 100),
          is_active:   true,
        },
        token: getToken(),
      });
      await loadRoles();
      setShowCreate(false);
      // Auto-selecciona el rol recién creado
      if (created?.slug) setSelRole(created.slug);
      setToast(lang === "es" ? "✓ Rol creado" : "✓ Role created");
    } catch (e) {
      const msg = e?.payload?.detail || e?.payload?.slug?.[0] || e?.message || "Error";
      setToast(`⚠️ ${msg}`);
    } finally {
      setCrudBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  // ── Eliminar rol ─────────────────────────────────────────
  const deleteRole = async (slug) => {
    setCrudBusy(true);
    try {
      await apiFetch(`/roles/${slug}/`, { method: "DELETE", token: getToken() });
      const fresh = await loadRoles();
      // Si el rol borrado era el seleccionado, mover a otro disponible
      if (slug === selectedRole) {
        const next = fresh.find(r => r.is_active) || fresh[0];
        if (next) setSelRole(next.slug);
      }
      setConfirmDel(null);
      setToast(lang === "es" ? "✓ Rol eliminado (soft)" : "✓ Role removed (soft)");
    } catch (e) {
      const msg = e?.payload?.detail || e?.message || "Error";
      setToast(`⚠️ ${msg}`);
    } finally {
      setCrudBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  // Cargar matriz al cambiar de rol
  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/permissions/groups/${selectedRole}/`, { token: getToken() });
      setRoleMeta(data?.role || null);
      setMatrix(Array.isArray(data?.matrix) ? data.matrix : []);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [selectedRole]);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  // ── Toggle celda ─────────────────────────────────────────
  const toggle = (moduleSlug, key) => {
    setMatrix((prev) => prev.map((c) =>
      c.module === moduleSlug ? { ...c, [key]: !c[key] } : c));
    setDirty(true);
  };

  const toggleRowAll = (moduleSlug, value) => {
    setMatrix((prev) => prev.map((c) =>
      c.module === moduleSlug
        ? {
            ...c,
            can_create:       value, can_read:         value,
            can_update:       value, can_delete:       value,
            can_upload_doc:   value, can_download_doc: value,
            can_view_doc:     value,
          }
        : c));
    setDirty(true);
  };

  const toggleColAll = (key, value) => {
    setMatrix((prev) => prev.map((c) => ({ ...c, [key]: value })));
    setDirty(true);
  };

  // ── Guardar ─────────────────────────────────────────────
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const body = {
        matrix: matrix.map((c) => ({
          module:           c.module,
          can_create:       c.can_create,       can_read:         c.can_read,
          can_update:       c.can_update,       can_delete:       c.can_delete,
          can_upload_doc:   !!c.can_upload_doc,
          can_download_doc: !!c.can_download_doc,
          can_view_doc:     !!c.can_view_doc,
        })),
      };
      await apiFetch(`/permissions/groups/${selectedRole}/`, {
        method: "PATCH", body, token: getToken(),
      });
      setToast(lang === "es" ? "✓ Matriz guardada" : "✓ Matrix saved");
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setToast(lang === "es" ? "✓ (demo) Matriz simulada guardada" : "✓ (demo) saved");
        setDirty(false);
      } else {
        setToast(`⚠️ ${e?.message || "Error"}`);
      }
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3200);
    }
  };

  // Agrupar por categoría para mejor UX
  const grouped = useMemo(() => {
    const out = {};
    for (const c of matrix) {
      const cat = c.categoria || "OTROS";
      if (!out[cat]) out[cat] = [];
      out[cat].push(c);
    }
    return out;
  }, [matrix]);

  // Sprint 2026-05-21 · A5 RBAC redesign: categorias alineadas al sidebar.
  // Orden: CORE → COMERCIAL → ALMACEN → COMUNICACIONES → SOPORTE → ADMINISTRACION.
  const CAT_ORDER = ["CORE","COMERCIAL","ALMACEN","COMUNICACIONES","SOPORTE","ADMINISTRACION","OTROS"];
  const orderedCats = CAT_ORDER.filter((c) => grouped[c]?.length > 0);

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)", color: "var(--navy)" }}>
            {lang === "es" ? "Roles y Permisos" : "Roles & Permissions"}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-tertiary)" }}>
            {lang === "es"
              ? "Matriz RBAC de MWT.ONE. Define qué operaciones CRUD puede hacer cada rol sobre cada módulo del ERP."
              : "RBAC matrix. Define which CRUD operations each role can perform on each ERP module."}
          </p>
        </div>
        <button onClick={loadMatrix} className="btn btn-ghost" title="Recargar">
          <IconRefresh size={14}/>
        </button>
      </div>

      {/* Selector de rol */}
      <div style={{
        display: "flex", gap: 16, alignItems: "center",
        padding: "14px 18px",
        background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: 0.5, textTransform: "uppercase" }}>
          {lang === "es" ? "Rol" : "Role"}
        </div>
        <select
          value={selectedRole}
          onChange={(e) => setSelRole(e.target.value)}
          className="select"
          style={{ minWidth: 220 }}
        >
          {roles.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.nombre} {r.is_system ? "· sistema" : ""}
            </option>
          ))}
        </select>
        {/* Marcador de color del rol seleccionado · descripción en tooltip */}
        {roleMeta && (
          <div
            title={roleMeta.descripcion || ""}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px",
              background: `${roleMeta.color}1A`,
              border: `1px solid ${roleMeta.color}55`,
              borderRadius: 999,
              fontSize: 11, fontWeight: 600,
              color: roleMeta.color,
              flexShrink: 0,
            }}
          >
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: roleMeta.color,
            }}/>
            {roleMeta.is_system
              ? (lang === "es" ? "SISTEMA" : "SYSTEM")
              : (lang === "es" ? "PERSONALIZADO" : "CUSTOM")}
          </div>
        )}

        {/* spacer */}
        <div style={{ flex: 1 }}/>

        {/* CRUD de roles · iconos compactos */}
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          title={lang === "es" ? "Crear nuevo rol" : "Create new role"}
          style={{
            background: "transparent",
            color: "var(--mint, #00B286)",
            border: "1.5px solid var(--mint, #00B286)",
            padding: "8px 14px", borderRadius: 8,
            fontSize: 12.5, fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5,
            whiteSpace: "nowrap",
          }}
        >
          <IconPlus size={12}/> {lang === "es" ? "Nuevo rol" : "New role"}
        </button>

        {/* Eliminar · solo icono trash */}
        <button
          type="button"
          onClick={() => roleMeta && setConfirmDel(roleMeta)}
          disabled={!roleMeta || roleMeta.is_system}
          aria-label={lang === "es" ? "Eliminar rol" : "Delete role"}
          title={
            !roleMeta ? "" :
            roleMeta.is_system
              ? (lang === "es"
                  ? "No se puede eliminar un rol del sistema"
                  : "Cannot delete a system role")
              : (lang === "es" ? "Eliminar este rol (soft delete)" : "Delete this role (soft delete)")
          }
          style={{
            background: roleMeta?.is_system ? "#F8FAFC" : "transparent",
            color: roleMeta?.is_system ? "#CBD5E1" : "#DC2626",
            border: `1.5px solid ${roleMeta?.is_system ? "#E5E7EB" : "#DC262633"}`,
            padding: 8, borderRadius: 8,
            cursor: roleMeta?.is_system ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 38, height: 38,
          }}
        >
          {roleMeta?.is_system ? <IconLock size={14}/> : <IconTrash size={14}/>}
        </button>

        {/* Guardar matriz · solo icono save */}
        <button
          onClick={save}
          disabled={!dirty || saving}
          aria-label={lang === "es" ? "Guardar matriz" : "Save matrix"}
          title={
            saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : !dirty
                ? (lang === "es" ? "No hay cambios sin guardar" : "No unsaved changes")
                : (lang === "es" ? "Guardar matriz" : "Save matrix")
          }
          style={{
            background: dirty ? "var(--mint, #00B286)" : "#E1E6ED",
            color: dirty ? "#fff" : "var(--text-tertiary)",
            border: "none",
            padding: 8, borderRadius: 8,
            cursor: (dirty && !saving) ? "pointer" : "default",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 38, height: 38,
            transition: "background 130ms ease",
          }}
        >
          <IconSave size={14}/>
        </button>
      </div>

      {/* Matriz */}
      {loading && matrix.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
          {lang === "es" ? "Cargando matriz…" : "Loading matrix…"}
        </div>
      ) : (
        <div style={{
          background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
          overflow: "hidden",
        }}>
          <MatrixHeader onColToggle={toggleColAll} lang={lang}/>
          {orderedCats.map((cat) => (
            <React.Fragment key={cat}>
              <div style={{
                padding: "8px 14px",
                background: "#F7F9FC",
                fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
                letterSpacing: 0.8, textTransform: "uppercase",
                borderBottom: "1px solid var(--border)",
              }}>
                {cat}  ·  {grouped[cat].length} {lang === "es" ? "módulos" : "modules"}
              </div>
              {grouped[cat].map((c) => (
                <MatrixRow
                  key={c.module}
                  cell={c}
                  onToggle={(k) => toggle(c.module, k)}
                  lang={lang}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Modal · Crear nuevo rol */}
      <AnimatePresence>
        {showCreate && (
          <CreateRoleModal
            lang={lang}
            existingSlugs={roles.map(r => r.slug)}
            busy={crudBusy}
            onClose={() => setShowCreate(false)}
            onCreate={createRole}
          />
        )}
      </AnimatePresence>

      {/* Modal · Confirmar eliminación */}
      <AnimatePresence>
        {confirmDel && (
          <ConfirmDeleteModal
            lang={lang}
            role={confirmDel}
            busy={crudBusy}
            onClose={() => setConfirmDel(null)}
            onConfirm={() => deleteRole(confirmDel.slug)}
          />
        )}
      </AnimatePresence>

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
              background: "var(--navy, #0B1E3A)",
              color: "#fff", borderRadius: 8, fontSize: 13,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// CreateRoleModal · drawer compacto centrado
// ═════════════════════════════════════════════════════════════
function CreateRoleModal({ lang, existingSlugs, busy, onClose, onCreate }) {
  const [form, setForm] = useState({
    slug: "",
    nombre: "",
    descripcion: "",
    color: "#3083FE",
    orden: 100,
  });
  const upd = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const slugOk = /^[a-z][a-z0-9_-]{1,30}$/.test(form.slug);
  const slugDup = existingSlugs.includes(form.slug);
  const nameOk = (form.nombre || "").trim().length >= 3;
  const canSubmit = slugOk && !slugDup && nameOk && !busy;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(11,30,58,0.45)", zIndex: 100,
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(480px, 92vw)",
          background: "#fff", borderRadius: 12,
          boxShadow: "0 20px 60px -12px rgba(11,30,58,0.35)",
          zIndex: 101,
          overflow: "hidden",
        }}
      >
        <header style={{
          padding: "18px 22px",
          background: "linear-gradient(135deg, #0B1E3A 0%, #1A2A5C 100%)",
          color: "#fff",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <IconPlus size={16}/>
          <div style={{ flex: 1 }}>
            <div style={{ font: "500 10.5px/1 var(--font-body)", opacity: 0.7,
              textTransform: "uppercase", letterSpacing: 0.6 }}>
              {lang === "es" ? "Nuevo rol" : "New role"}
            </div>
            <div style={{ font: "700 16px/1.2 var(--font-body)", marginTop: 3 }}>
              {lang === "es" ? "Definir rol RBAC" : "Define RBAC role"}
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "rgba(255,255,255,0.10)", color: "#fff",
              border: "none", borderRadius: 6, padding: 6, cursor: "pointer" }}>
            <IconX size={14}/>
          </button>
        </header>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Slug */}
          <div>
            <ModalLabel>Slug · ID técnico</ModalLabel>
            <input
              value={form.slug}
              onChange={e => upd("slug", e.target.value.toLowerCase().trim())}
              placeholder="ej: marketing, gerente_cl"
              style={modalInput}
            />
            <div style={{ font: "500 10.5px/1.4 var(--font-body)",
              color: !form.slug ? "#94A3B8" : (slugOk && !slugDup) ? "#00B286" : "#DC2626",
              marginTop: 4 }}>
              {!form.slug
                ? "Sólo minúsculas, números, _ y -. No se puede cambiar después."
                : !slugOk
                  ? "Inválido. Debe empezar con letra · 2-31 chars · sólo a-z 0-9 _ -"
                  : slugDup
                    ? "Ya existe un rol con ese slug."
                    : "✓ Disponible"}
            </div>
          </div>

          {/* Nombre */}
          <div>
            <ModalLabel>Nombre visible</ModalLabel>
            <input
              value={form.nombre}
              onChange={e => upd("nombre", e.target.value)}
              placeholder="ej: Marketing"
              style={modalInput}
            />
          </div>

          {/* Descripción */}
          <div>
            <ModalLabel>Descripción</ModalLabel>
            <textarea
              value={form.descripcion}
              onChange={e => upd("descripcion", e.target.value)}
              placeholder="Para qué se usa este rol…"
              rows={2}
              style={{ ...modalInput, resize: "vertical" }}
            />
          </div>

          {/* Color + orden en fila */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12 }}>
            <div>
              <ModalLabel>Color</ModalLabel>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  value={form.color}
                  onChange={e => upd("color", e.target.value)}
                  style={{
                    width: 40, height: 38, padding: 2, border: "1px solid #E5E7EB",
                    borderRadius: 6, cursor: "pointer", background: "#fff",
                  }}
                />
                <input
                  value={form.color}
                  onChange={e => upd("color", e.target.value)}
                  placeholder="#3083FE"
                  style={{ ...modalInput, font: "500 12px/1.2 ui-monospace, monospace" }}
                />
              </div>
            </div>
            <div>
              <ModalLabel>Orden</ModalLabel>
              <input
                type="number"
                value={form.orden}
                onChange={e => upd("orden", e.target.value)}
                min={1}
                max={999}
                style={{ ...modalInput, fontVariantNumeric: "tabular-nums" }}
              />
            </div>
          </div>
        </div>

        <footer style={{
          padding: "14px 22px",
          background: "#F8FAFC",
          borderTop: "1px solid #E5E7EB",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              padding: "8px 16px", background: "transparent",
              border: "1px solid #E5E7EB", color: "#334155",
              font: "600 12.5px/1 var(--font-body)",
              borderRadius: 8, cursor: busy ? "not-allowed" : "pointer",
            }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button"
            onClick={() => onCreate(form)}
            disabled={!canSubmit}
            style={{
              padding: "8px 18px",
              background: canSubmit ? "var(--mint, #00B286)" : "#94A3B8",
              color: "#fff", border: "none",
              font: "700 12.5px/1 var(--font-body)",
              borderRadius: 8,
              cursor: canSubmit ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
            <IconCheck size={12}/>
            {busy
              ? (lang === "es" ? "Creando…" : "Creating…")
              : (lang === "es" ? "Crear rol" : "Create role")}
          </button>
        </footer>
      </motion.div>
    </>
  );
}


// ═════════════════════════════════════════════════════════════
// ConfirmDeleteModal
// ═════════════════════════════════════════════════════════════
function ConfirmDeleteModal({ lang, role, busy, onClose, onConfirm }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(11,30,58,0.45)", zIndex: 100,
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.16 }}
        style={{
          position: "fixed",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(420px, 92vw)",
          background: "#fff", borderRadius: 12,
          boxShadow: "0 20px 60px -12px rgba(11,30,58,0.35)",
          zIndex: 101, overflow: "hidden",
        }}
      >
        <div style={{ padding: "22px 24px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "rgba(220,38,38,0.10)",
              color: "#DC2626",
              display: "grid", placeItems: "center",
            }}>
              <IconAlert size={20}/>
            </div>
            <div>
              <div style={{ font: "700 15px/1.2 var(--font-body)", color: "#0B1E3A" }}>
                {lang === "es" ? "Eliminar rol" : "Delete role"}
              </div>
              <div style={{ font: "500 12px/1.4 var(--font-body)", color: "#64748B", marginTop: 2 }}>
                {lang === "es" ? "Esta acción es soft-delete (is_active=false)." : "Soft delete (is_active=false)."}
              </div>
            </div>
          </div>
          <div style={{
            padding: 12, background: "#F8FAFC", borderRadius: 8, marginBottom: 12,
            font: "500 13px/1.5 var(--font-body)", color: "#334155",
          }}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: 4,
              background: role.color, marginRight: 6, verticalAlign: "middle",
            }}/>
            <strong>{role.nombre}</strong>{" "}
            <span style={{ color: "#94A3B8", font: "500 11px/1 ui-monospace, monospace" }}>
              ({role.slug})
            </span>
          </div>
          <div style={{ font: "500 12.5px/1.5 var(--font-body)", color: "#475569" }}>
            {lang === "es"
              ? "Los usuarios con este rol mantendrán el acceso hasta que les asignes otro. Puedes reactivarlo más tarde con toggle-active."
              : "Users with this role keep access until you reassign them. You can reactivate later via toggle-active."}
          </div>
        </div>
        <footer style={{
          padding: "14px 22px",
          background: "#F8FAFC",
          borderTop: "1px solid #E5E7EB",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{
              padding: "8px 16px", background: "transparent",
              border: "1px solid #E5E7EB", color: "#334155",
              font: "600 12.5px/1 var(--font-body)",
              borderRadius: 8, cursor: busy ? "not-allowed" : "pointer",
            }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            style={{
              padding: "8px 18px",
              background: busy ? "#94A3B8" : "#DC2626",
              color: "#fff", border: "none",
              font: "700 12.5px/1 var(--font-body)",
              borderRadius: 8,
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
            <IconX size={12}/>
            {busy
              ? (lang === "es" ? "Eliminando…" : "Deleting…")
              : (lang === "es" ? "Sí, eliminar" : "Yes, delete")}
          </button>
        </footer>
      </motion.div>
    </>
  );
}


// ─── Helpers visuales del modal ───
function ModalLabel({ children }) {
  return (
    <label style={{
      display: "block",
      font: "600 11px/1 var(--font-body)", color: "#0B1E3A",
      marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4,
    }}>
      {children}
    </label>
  );
}

const modalInput = {
  width: "100%", padding: "9px 11px",
  border: "1px solid #E5E7EB", borderRadius: 6,
  font: "500 13px/1.2 var(--font-body)", color: "#0B1E3A",
  background: "#fff", outline: "none",
  boxSizing: "border-box",
};


// ─────────────────────────────────────────────────────────────────────
// Matrix header + row
// ─────────────────────────────────────────────────────────────────────
// Modulo + 4 CRUD + 3 doc actions (sin la columna "Toggle row" obsoleta).
const COLS = "minmax(220px, 2.5fr) 70px 70px 70px 70px 90px 90px 90px";

function MatrixHeader({ onColToggle, lang }) {
  const L = (es, en) => lang === "es" ? es : en;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: COLS, gap: 4,
      padding: "10px 14px", background: "#EEF2F7",
      borderBottom: "1px solid var(--border)",
      fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
      letterSpacing: 0.5, textTransform: "uppercase", alignItems: "center",
    }}>
      <span>{L("Módulo","Module")}</span>
      <HeaderCol label={L("Crear","Create")}       onToggle={(v) => onColToggle("can_create", v)}/>
      <HeaderCol label={L("Leer","Read")}          onToggle={(v) => onColToggle("can_read",   v)}/>
      <HeaderCol label={L("Actualizar","Update")}   onToggle={(v) => onColToggle("can_update", v)}/>
      <HeaderCol label={L("Eliminar","Delete")}     onToggle={(v) => onColToggle("can_delete", v)}/>
      <HeaderCol label={L("Subir docs","Upload docs")}     onToggle={(v) => onColToggle("can_upload_doc", v)}/>
      <HeaderCol label={L("Bajar docs","Download docs")}   onToggle={(v) => onColToggle("can_download_doc", v)}/>
      <HeaderCol label={L("Ver docs","View docs")}         onToggle={(v) => onColToggle("can_view_doc", v)}/>
    </div>
  );
}

function HeaderCol({ label, onToggle }) {
  return (
    <span style={{ textAlign: "center" }}>
      <div>{label}</div>
      <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 3 }}>
        <button onClick={() => onToggle(true)}  className="ai-btn ai-btn-ghost ai-btn-xs"
                style={{ padding: "1px 6px", fontSize: 9 }} title="All on">✓</button>
        <button onClick={() => onToggle(false)} className="ai-btn ai-btn-ghost ai-btn-xs"
                style={{ padding: "1px 6px", fontSize: 9 }} title="All off">✗</button>
      </div>
    </span>
  );
}

function MatrixRow({ cell, onToggle, lang }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: COLS, gap: 4,
      padding: "8px 14px",
      borderBottom: "1px solid var(--border)",
      fontSize: 13, alignItems: "center",
    }}>
      <span style={{ fontWeight: 500, color: "var(--navy)" }}>
        {cell.module_label}
        <code style={{
          marginLeft: 6,
          fontSize: 10, color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}>
          {cell.module}
        </code>
      </span>
      <Cell checked={cell.can_create} onChange={() => onToggle("can_create")}/>
      <Cell checked={cell.can_read}   onChange={() => onToggle("can_read")}/>
      <Cell checked={cell.can_update} onChange={() => onToggle("can_update")}/>
      <Cell checked={cell.can_delete} onChange={() => onToggle("can_delete")} danger/>
      {/* Sprint 2026-05-21 · A5 RBAC redesign · gestion documental */}
      <Cell checked={cell.can_upload_doc}   onChange={() => onToggle("can_upload_doc")}/>
      <Cell checked={cell.can_download_doc} onChange={() => onToggle("can_download_doc")}/>
      <Cell checked={cell.can_view_doc}     onChange={() => onToggle("can_view_doc")}/>
    </div>
  );
}

function Cell({ checked, onChange, danger = false }) {
  return (
    <label style={{
      display: "inline-flex", justifyContent: "center", alignItems: "center",
      cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={onChange}
        style={{
          width: 16, height: 16,
          accentColor: danger ? "#D64545" : "var(--mint, #00B286)",
          cursor: "pointer",
        }}
      />
    </label>
  );
}
