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
import { IconCheck, IconRefresh } from "../lib/icons.jsx";

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

  // Cargar roles
  useEffect(() => {
    let alive = true;
    apiFetch("/permissions/roles/", { token: getToken() })
      .then((d) => alive && setRoles(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

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
        ? { ...c, can_create: value, can_read: value, can_update: value, can_delete: value }
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
          module:     c.module,
          can_create: c.can_create, can_read:   c.can_read,
          can_update: c.can_update, can_delete: c.can_delete,
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

  const CAT_ORDER = ["CORE","OPERACIONAL","CATALOGOS","COMERCIAL","FINANCIERO","AI","B2B","INFRA","OTROS"];
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
        {roleMeta && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>
            <span style={{
              display: "inline-block", width: 10, height: 10, borderRadius: 5,
              background: roleMeta.color, marginRight: 6, verticalAlign: "middle",
            }}/>
            {roleMeta.descripcion}
          </div>
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
          <IconCheck size={12}/> {saving ? (lang === "es" ? "Guardando…" : "Saving…")
                                         : (lang === "es" ? "Guardar matriz" : "Save matrix")}
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
                  onToggleAll={(v) => toggleRowAll(c.module, v)}
                  lang={lang}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

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


// ─────────────────────────────────────────────────────────────────────
// Matrix header + row
// ─────────────────────────────────────────────────────────────────────
const COLS = "minmax(200px, 2fr) 80px 80px 80px 80px 80px";

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
      <HeaderCol label={L("Crear","Create")}    onToggle={(v) => onColToggle("can_create", v)}/>
      <HeaderCol label={L("Leer","Read")}       onToggle={(v) => onColToggle("can_read",   v)}/>
      <HeaderCol label={L("Actualizar","Update")}onToggle={(v) => onColToggle("can_update", v)}/>
      <HeaderCol label={L("Eliminar","Delete")}  onToggle={(v) => onColToggle("can_delete", v)}/>
      <span style={{ textAlign: "center" }}>{L("Toggle row","Toggle row")}</span>
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

function MatrixRow({ cell, onToggle, onToggleAll, lang }) {
  const allOn = cell.can_create && cell.can_read && cell.can_update && cell.can_delete;
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
      <span style={{ textAlign: "center" }}>
        <button
          onClick={() => onToggleAll(!allOn)}
          className="ai-btn ai-btn-ghost ai-btn-xs"
          style={{ fontSize: 10 }}
          title={allOn ? "Disable all" : "Enable all"}
        >
          {allOn ? "✗" : "✓"}
        </button>
      </span>
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
