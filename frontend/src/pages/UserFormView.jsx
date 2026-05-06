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
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, clientesApi, ApiError } from "../lib/api.js";
import { ROLES_DEMO } from "../lib/usersRolesMock.js";

// ── Normalización clientes → shape del selector de empresa ─────────────
// El backend de /api/clientes/ devuelve {id, razon_social, nombre_comercial,
// tax_id, pais_iso2, parent_id, …}. El selector legacy esperaba {id,
// razon_social, nombre_comercial, tax_id, country, flag}. Adaptamos aquí.
const _COMPANY_FLAG = {
  PE:"🇵🇪", CO:"🇨🇴", US:"🇺🇸", MX:"🇲🇽", AR:"🇦🇷",
  CL:"🇨🇱", BR:"🇧🇷", UY:"🇺🇾", EC:"🇪🇨", CR:"🇨🇷",
  PA:"🇵🇦", DO:"🇩🇴", GT:"🇬🇹", ES:"🇪🇸", CN:"🇨🇳",
};
function adaptClienteAsCompany(c) {
  return {
    id:               c.id,
    razon_social:     c.razon_social || c.nombre_comercial || "—",
    nombre_comercial: c.nombre_comercial || "",
    tax_id:           c.tax_id || c.codigo_marluvas || "",
    country:          (c.pais_iso2 || "").toUpperCase(),
    flag:             _COMPANY_FLAG[(c.pais_iso2 || "").toUpperCase()] || "🏢",
    parent_id:        c.parent_id || null,
    is_active:        c.is_active !== false,
  };
}
import {
  IconChevLeft, IconCheck, IconPlus, IconX, IconLock, IconRefresh,
} from "../lib/icons.jsx";
import ConfirmActionModal, { ACTION_META } from "../components/users/ConfirmActionModal.jsx";

const EMPTY_USER = {
  email_plain: "",
  full_name: "",
  contact_email: "",
  phone: "",
  preferred_language: "es",
  timezone: "America/Lima",
  role_default: "viewer",
  legal_entity_id: null,
  legal_entity_ids: [],
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
  const companyBoxRef = useRef(null);

  // Click fuera del selector cierra el dropdown.
  useEffect(() => {
    if (!companyOpen) return;
    const onDocClick = (e) => {
      if (!companyBoxRef.current) return;
      if (!companyBoxRef.current.contains(e.target)) setCompanyOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [companyOpen]);

  // ── Cargar empresas (selector) ───────────────────────────
  // Fuente: /api/clientes/?is_parent=all  (incluye padres + subsidiarias).
  // Antes usaba /api/legal-entities/ (mock). Sprint Parent-Child 2026-04-29:
  // el módulo Clientes es la fuente única de verdad de las empresas.
  // Fallback a /legal-entities/ si el primario falla (preserva demos).
  useEffect(() => {
    let alive = true;
    clientesApi.list({ is_parent: "all" })
      .then((d) => {
        if (!alive) return;
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setCompanies(arr.map(adaptClienteAsCompany));
      })
      .catch(() => {
        // Fallback: endpoint legacy / mock
        apiFetch("/legal-entities/", { token: getToken() })
          .then((d) => alive && setCompanies(Array.isArray(d) ? d : (d?.results || [])))
          .catch(() => {});
      });
    return () => { alive = false; };
  }, []);

  // ── Cargar usuario (edit) ────────────────────────────────
  const load = useCallback(async () => {
    if (!isEdit) { setLoading(false); return; }
    setLoading(true);
    try {
      const u = await apiFetch(`/users/${userId}/`, { token: getToken() });
      // Normalizar legal_entity_ids: si el backend solo devuelve el singular,
      // construimos el array; si está vacío y hay singular, lo incluimos.
      const ids = Array.isArray(u.legal_entity_ids) ? u.legal_entity_ids.slice() : [];
      if (u.legal_entity_id && !ids.includes(u.legal_entity_id)) ids.unshift(u.legal_entity_id);
      setUser({ ...EMPTY_USER, ...u, legal_entity_ids: ids, password: "" });
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

  // ── Acciones inline (solo edit) — vía ConfirmActionModal ─────────
  // pendingAction: { kind: 'reset'|'toggleOn'|'toggleOff'|'delete' }
  const [pendingAction, setPendingAction] = useState(null);
  const [actionBusy,    setActionBusy]    = useState(false);
  const [actionError,   setActionError]   = useState(null);

  const askResetPassword = () => { setActionError(null); setPendingAction({ kind: 'reset' }); };
  const askToggleActive  = () => { setActionError(null); setPendingAction({ kind: user.is_active ? 'toggleOff' : 'toggleOn' }); };
  const askDelete        = () => { setActionError(null); setPendingAction({ kind: 'delete' }); };

  const executeAction = async () => {
    if (!pendingAction) return;
    const { kind } = pendingAction;
    setActionBusy(true);
    setActionError(null);
    try {
      if (kind === 'reset') {
        const resp = await apiFetch(`/users/${userId}/reset-password/`, {
          method: "POST", body: { ttl_hours: 24 }, token: getToken(),
        });
        showToast(`✓ Email enviado · ····${resp?.token_preview || "????"}`);
      } else if (kind === 'toggleOff' || kind === 'toggleOn') {
        await apiFetch(`/users/${userId}/toggle-active/`, { method: "POST", token: getToken() });
        patch({ is_active: !user.is_active });
        showToast(`✓ ${kind === 'toggleOff' ? 'Inactivado' : 'Reactivado'} OK`);
      } else if (kind === 'delete') {
        await apiFetch(`/users/${userId}/`, { method: "DELETE", token: getToken() });
        showToast('✓ Usuario eliminado');
        // Salir del editor — el usuario ya no existe
        setTimeout(() => navigate("/usuarios", { replace: true }), 600);
      }
      setPendingAction(null);
    } catch (e) {
      if (kind === 'reset' && e instanceof ApiError && e.status === 0) {
        showToast(`✓ (demo) Email de reseteo encolado`);
        setPendingAction(null);
      } else {
        setActionError(e?.message || 'Operación falló');
      }
    } finally {
      setActionBusy(false);
    }
  };

  // ── Empresas seleccionadas (multi · sprint Usuarios M-Empresa) ──
  // legal_entity_ids es la fuente canónica. Compat: si solo hay
  // legal_entity_id (singular legacy), lo derivamos.
  const selectedIds = useMemo(() => {
    const ids = Array.isArray(user.legal_entity_ids) ? user.legal_entity_ids.slice() : [];
    if (user.legal_entity_id && !ids.includes(user.legal_entity_id)) ids.unshift(user.legal_entity_id);
    return ids;
  }, [user.legal_entity_ids, user.legal_entity_id]);

  // Sprint 2026-05-06 · validación R3: para roles CLIENT_* es
  // OBLIGATORIO al menos una empresa asignada (de lo contrario el
  // backend filtra todo a 0 expedientes y el portal queda vacío).
  const isClientRoleSelected = String(user.role_default || '').toLowerCase().startsWith('client');
  const companyMissing = isClientRoleSelected && selectedIds.length === 0;
  const selectedCompanies = useMemo(
    () => selectedIds.map((id) => companies.find((c) => c.id === id)).filter(Boolean),
    [selectedIds, companies]
  );

  // Helper: sincroniza legal_entity_ids + legal_entity_id (primero del array).
  const setLegalEntityIds = (next) => {
    const arr = Array.from(new Set(next.filter(Boolean)));
    patch({ legal_entity_ids: arr, legal_entity_id: arr[0] || null });
  };
  const toggleCompany = (id) => {
    setLegalEntityIds(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  };

  const filteredCompanies = useMemo(() => {
    // 1. Filtrado por búsqueda (razón social / comercial / RUC).
    const needle = companySearch.trim().toLowerCase();
    const matches = !needle
      ? companies
      : companies.filter((c) =>
          (c.razon_social || "").toLowerCase().includes(needle) ||
          (c.nombre_comercial || "").toLowerCase().includes(needle) ||
          (c.tax_id || "").toLowerCase().includes(needle));

    // 2. Ordenar con padres seguidos de sus subsidiarias (jerarquía visible).
    //    Si una subsidiaria matchea pero el padre no, mostramos el padre
    //    como contexto (clickeable) además de la subsidiaria.
    const byId = new Map(companies.map((c) => [c.id, c]));
    const matchedIds = new Set(matches.map((c) => c.id));
    const out = [];
    const pushed = new Set();
    const pushOnce = (c) => {
      if (!c || pushed.has(c.id)) return;
      out.push(c);
      pushed.add(c.id);
    };
    // Primero los padres top-level que matchearon (o cuyas hijas matchearon).
    companies
      .filter((c) => !c.parent_id)
      .forEach((parent) => {
        const subs = companies.filter((s) => s.parent_id === parent.id);
        const parentMatch = matchedIds.has(parent.id);
        const anySubMatch = subs.some((s) => matchedIds.has(s.id));
        if (parentMatch || anySubMatch) {
          pushOnce(parent);
          subs.forEach((s) => {
            if (!needle || matchedIds.has(s.id) || parentMatch) pushOnce(s);
          });
        }
      });
    // Subsidiarias huérfanas (padre fuera del dataset).
    matches.forEach((c) => {
      if (c.parent_id && !byId.has(c.parent_id)) pushOnce(c);
    });
    return out;
  }, [companies, companySearch]);

  // ── Direcciones helpers ─────────────────────────────────
  // Usa nombres canónicos del backend (address_line_1, country, zip_code).
  const addAddress = () => {
    const a = {
      id: `addr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: "Nueva dirección",
      address_line_1: "",
      city: "",
      country: "PE",
      zip_code: "",
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
            <button onClick={askResetPassword} className="btn btn-ghost">
              <IconLock size={13}/> Reset password
            </button>
            <button
              onClick={askToggleActive}
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
            <button
              onClick={askDelete}
              className="btn"
              style={{
                background: "transparent",
                color: "#DC2626",
                border: "1px solid rgba(220,38,38,0.30)",
                padding: "8px 14px", borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              Eliminar
            </button>
          </>
        )}
        <button onClick={() => navigate("/usuarios")} className="btn btn-ghost">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={!user.email_plain || saving || companyMissing}
          title={companyMissing
            ? "Asigna al menos una empresa para roles CLIENT_*"
            : undefined}
          style={{
            background: "var(--mint, #00B286)", color: "#fff", border: "none",
            padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: (user.email_plain && !saving && !companyMissing) ? "pointer" : "default",
            opacity: (!user.email_plain || saving || companyMissing) ? 0.6 : 1,
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

      {/* C · Empresa(s) asignada(s) — multi-empresa.
          Sprint 2026-05-06 · la primera empresa se persiste tambien como
          legal_entity_id (singular) por retrocompat con codigo legacy. */}
      <Section title="C · Empresas asignadas"
               hint={
                 isClientRoleSelected
                   ? "OBLIGATORIO para rol CLIENT — el cliente solo verá expedientes/OCs/documentos de las empresas asignadas. La primera es la empresa primaria."
                   : "Opcional. Para roles internos de MWT no asigna empresa (quedan con scope global). Los datos corporativos vienen del módulo Clientes."
               }>
        {companyMissing && (
          <div style={{
            padding: "8px 12px", borderRadius: 6, marginBottom: 10,
            background: "rgba(220,38,38,0.08)",
            color: "#991B1B",
            border: "1px solid rgba(220,38,38,0.30)",
            fontSize: 12, fontWeight: 600,
          }}>
            Para guardar un usuario CLIENT_* debes asignarle al menos una empresa.
          </div>
        )}
        {/* Chips de empresas seleccionadas — multi-empresa (sprint M-Empresa) */}
        {selectedCompanies.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10,
          }}>
            {selectedCompanies.map((c) => {
              const isSub = !!c.parent_id;
              const parent = isSub ? companies.find((p) => p.id === c.parent_id) : null;
              return (
                <span key={c.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "6px 8px 6px 12px",
                  background: "rgba(0,178,134,0.08)",
                  border: "1px solid rgba(0,178,134,0.30)",
                  borderRadius: 999, fontSize: 12,
                }}>
                  {isSub && (
                    <span style={{ color: "#00B286", fontWeight: 700 }}
                          title="Subsidiaria">↳</span>
                  )}
                  <span style={{ fontWeight: 600, color: "var(--navy)" }}>
                    {c.razon_social}
                  </span>
                  {isSub && parent && (
                    <span style={{ color: "#00B286", fontSize: 11 }}>
                      · hija de {parent.razon_social}
                    </span>
                  )}
                  <button type="button"
                          onClick={() => toggleCompany(c.id)}
                          aria-label="Quitar empresa"
                          style={{
                            padding: "2px 6px", border: "none", background: "transparent",
                            color: "#64748B", cursor: "pointer",
                            borderRadius: 999, lineHeight: 1,
                          }}
                          onMouseOver={(e) => e.currentTarget.style.background = "rgba(214,69,69,0.10)"}
                          onMouseOut ={(e) => e.currentTarget.style.background = "transparent"}>
                    <IconX size={11}/>
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Buscador + dropdown — siempre visible (multi-empresa). Click fuera cierra. */}
        <div style={{ position: "relative" }} ref={companyBoxRef}>
          <input
            placeholder={selectedCompanies.length > 0
              ? "Agregar otra empresa…"
              : "Buscar empresa por razón social, RUC/CUIT o nombre comercial…"}
            value={companySearch}
            onChange={(e) => { setCompanySearch(e.target.value); setCompanyOpen(true); }}
            onFocus={() => setCompanyOpen(true)}
            style={styles.input}
          />
          {companyOpen && filteredCompanies.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
              background: "#fff", border: "1px solid var(--border)",
              borderRadius: 8, marginTop: 4, maxHeight: 320, overflowY: "auto",
              boxShadow: "0 8px 24px rgba(11,30,58,0.15)",
            }}>
              {filteredCompanies.map((c) => {
                const isSubsidiary = !!c.parent_id;
                const parent = isSubsidiary
                  ? companies.find((p) => p.id === c.parent_id)
                  : null;
                const isSelected = selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { toggleCompany(c.id); setCompanySearch(""); }}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "10px 14px", paddingLeft: isSubsidiary ? 32 : 14,
                      border: "none",
                      borderBottom: "1px solid #F3F5F8",
                      background: isSelected ? "rgba(0,178,134,0.06)" : "#fff",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background =
                      isSelected ? "rgba(0,178,134,0.12)" : "#F7F9FC"}
                    onMouseLeave={(e) => e.currentTarget.style.background =
                      isSelected ? "rgba(0,178,134,0.06)" : "#fff"}
                  >
                    {isSubsidiary && (
                      <span style={{ color: "#00B286", fontWeight: 700, marginRight: -4 }}
                            title="Subsidiaria">↳</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>
                        {c.razon_social}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        RUC/CUIT: {c.tax_id || "—"}
                        {isSubsidiary && parent && (
                          <> · <span style={{ color: "#00B286" }}>
                            hija de {parent.razon_social}
                          </span></>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <IconCheck size={14} style={{ color: "#00B286", flexShrink: 0 }}/>
                    )}
                  </button>
                );
              })}
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

      {/* Modal de confirmación unificado — vía portal a body */}
      {pendingAction && createPortal(
        <ConfirmActionModal
          meta={ACTION_META[pendingAction.kind]}
          user={user}
          busy={actionBusy}
          error={actionError}
          lang={lang}
          onCancel={() => { if (!actionBusy) { setPendingAction(null); setActionError(null); } }}
          onConfirm={executeAction}
        />,
        document.body
      )}
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
      {/* Usamos los mismos nombres de campo que el backend
          (address_line_1 / country / zip_code) para que cargar y
          guardar sean simétricos. Acepta `street/country_iso2/zip`
          como fallback para compat con datos viejos en memoria. */}
      <div style={styles.grid2}>
        <Field label="Calle y número">
          <input value={address.address_line_1 ?? address.street ?? ""}
                 onChange={(e) => onUpdate({ address_line_1: e.target.value })}
                 style={styles.input}/>
        </Field>
        <Field label="Ciudad">
          <input value={address.city || ""}
                 onChange={(e) => onUpdate({ city: e.target.value })}
                 style={styles.input}/>
        </Field>
        <Field label="País">
          <select value={address.country ?? address.country_iso2 ?? "PE"}
                  onChange={(e) => onUpdate({ country: e.target.value })}
                  style={styles.input}>
            <option value="PE">🇵🇪 Perú</option>
            <option value="CL">🇨🇱 Chile</option>
            <option value="AR">🇦🇷 Argentina</option>
            <option value="CO">🇨🇴 Colombia</option>
            <option value="MX">🇲🇽 México</option>
            <option value="BR">🇧🇷 Brasil</option>
            <option value="EC">🇪🇨 Ecuador</option>
            <option value="UY">🇺🇾 Uruguay</option>
            <option value="US">🇺🇸 USA</option>
            <option value="DO">🇩🇴 R. Dominicana</option>
            <option value="PA">🇵🇦 Panamá</option>
            <option value="CR">🇨🇷 Costa Rica</option>
          </select>
        </Field>
        <Field label="Código postal">
          <input value={address.zip_code ?? address.zip ?? ""}
                 onChange={(e) => onUpdate({ zip_code: e.target.value })}
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
