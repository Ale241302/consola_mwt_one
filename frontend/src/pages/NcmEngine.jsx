// =====================================================================
// MWT.ONE · pages/NcmEngine.jsx
// Agente responsable: [AG-FRONTEND]
// Sprint: NCM ENGINE v1
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import { ncmApi, productosApi, apiFetch, getToken } from "../lib/api.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import {
  IconPlus, IconRefresh, IconSearch, IconX, IconCheck,
  IconAlert, IconTag, IconSliders, IconTrash,
} from "../lib/icons.jsx";

const NAVY = "#0B1E3A";
const MINT = "#00B286";

export default function ScreenNcmEngine() {
  const ctx = useOutletContext?.() || {};
  const lang = ctx.lang || "es";

  const [ncms, setNcms] = useState([]);
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // null | {} (nuevo) | obj (edita)

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ncmList, countryList] = await Promise.all([
        ncmApi.list(),
        productosApi.select("paises").catch(() => []),
      ]);
      setNcms(Array.isArray(ncmList) ? ncmList : (ncmList?.results || []));
      setCountries(Array.isArray(countryList) ? countryList : []);
    } catch (e) {
      setError(e?.message || (lang === "es" ? "Error cargando datos." : "Error loading data."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const countryMap = useMemo(() => {
    const m = {};
    countries.forEach(c => {
      m[c.codigo] = c.label;
    });
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return ncms;
    return ncms.filter(n => (
      (n.code || "").toLowerCase().includes(ql) ||
      (n.descripcion || "").toLowerCase().includes(ql)
    ));
  }, [ncms, q]);

  const kpis = useMemo(() => {
    const total = ncms.length;
    const active = ncms.filter(n => n.is_active).length;
    const withTariffs = ncms.filter(n => Array.isArray(n.tarifas) && n.tarifas.length > 0).length;
    let productsCount = 0;
    ncms.forEach(n => {
      if (n.is_active && Array.isArray(n.productos_asociados)) {
        productsCount += n.productos_asociados.length;
      }
    });
    return { total, active, withTariffs, productsCount };
  }, [ncms]);

  const handleSave = async (form) => {
    if (!form.code || !form.code.trim()) {
      alert(lang === "es" ? "El código NCM es obligatorio." : "NCM code is required.");
      return;
    }

    const payload = {
      code: form.code.trim(),
      descripcion: (form.descripcion || "").trim() || null,
      tarifas: Array.isArray(form.tarifas) ? form.tarifas : [],
      is_active: form.is_active !== false,
    };

    try {
      if (form.id) {
        await ncmApi.update(form.id, payload);
      } else {
        await ncmApi.create(payload);
      }
      setEditing(null);
      await loadAll();
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar: " : "Save failed: ") + (e?.message || ""));
    }
  };

  // Confirmación desactivar/eliminar
  const [pendingAction, setPendingAction] = useState(null); // { kind: 'deactivate'|'delete', ncm }
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const askDeactivate = (ncm) => {
    setActionError(null);
    setPendingAction({ kind: 'deactivate', ncm });
  };
  const askDelete = (ncm) => {
    setActionError(null);
    setPendingAction({ kind: 'delete', ncm });
  };

  const executeAction = async () => {
    if (!pendingAction?.ncm?.id) return;
    const { kind, ncm } = pendingAction;
    setActionBusy(true);
    setActionError(null);
    try {
      if (kind === 'deactivate') {
        await ncmApi.update(ncm.id, { is_active: false });
      } else if (kind === 'delete') {
        await ncmApi.remove(ncm.id);
      }
      setPendingAction(null);
      await loadAll();
    } catch (e) {
      setActionError(e?.message || (lang === "es" ? "Operación falló" : "Operation failed"));
    } finally {
      setActionBusy(false);
    }
  };

  const ACTION_COPY = {
    deactivate: {
      eyebrow: 'CAMBIO DE ESTADO',
      title: lang === "es" ? '¿Desactivar este código NCM?' : 'Deactivate this NCM code?',
      action: lang === "es" ? 'Sí, desactivar' : 'Yes, deactivate',
      color: '#F59E0B',
      body: (n) => lang === "es"
        ? <>El código NCM <strong>{n.code}</strong> se marcará como inactivo. Sigue en la BD pero deja de aparecer en listas y selectores. Reversible.</>
        : <>NCM code <strong>{n.code}</strong> will be marked inactive. Stays in DB but disappears from lists. Reversible.</>,
    },
    delete: {
      eyebrow: 'ACCIÓN DESTRUCTIVA',
      title: lang === "es" ? '¿Eliminar este código NCM?' : 'Delete this NCM code?',
      action: lang === "es" ? 'Sí, eliminar' : 'Yes, delete',
      color: '#DC2626',
      body: (n) => lang === "es"
        ? <>Vas a eliminar <strong>{n.code}</strong>. Esta acción NO es reversible desde la UI — necesitarás restaurar manualmente desde BD si te arrepientes.</>
        : <>You're about to delete <strong>{n.code}</strong>. This action is NOT reversible from the UI.</>,
    },
  };

  return (
    <div className="page siz-root" style={{ color: NAVY }}>
      {/* Hero */}
      <div className="siz-hero">
        <div>
          <div className="micro" style={{ color: MINT }}>NCM ENGINE · v1</div>
          <h1 className="page-title" style={{ margin: "2px 0" }}>
            {lang === "es" ? "Motor de NCM" : "NCM Engine"}
          </h1>
          <div className="caption" style={{ color: "#64748B" }}>
            {lang === "es"
              ? "Catálogo maestro de clasificaciones arancelarias NCM/HS y sus tasas impositivas por país de origen/destino."
              : "Master catalog of customs classifications NCM/HS and their tax rates by country of origin/destination."}
          </div>
        </div>
        <div className="siz-hero-actions">
          <button onClick={loadAll} className="siz-btn siz-btn-ghost" title="Recargar">
            <IconRefresh size={14}/> {lang === "es" ? "Recargar" : "Refresh"}
          </button>
          <button onClick={() => setEditing({ tarifas: [], is_active: true })} className="siz-btn siz-btn-primary">
            <IconPlus size={14}/> {lang === "es" ? "Nuevo NCM" : "New NCM"}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="siz-kpis">
        <KpiTile label={lang === "es" ? "Total NCMs" : "Total NCMs"} value={kpis.total} hint={lang === "es" ? "registrados en el catálogo" : "registered in catalog"}/>
        <KpiTile label={lang === "es" ? "Activos" : "Active"} value={kpis.active} hint={lang === "es" ? "disponibles para asignar" : "available for assignment"} accent={MINT}/>
        <KpiTile label={lang === "es" ? "Con tarifas" : "With tariffs"} value={kpis.withTariffs} hint={lang === "es" ? "reglas de importación definidas" : "defined import rules"} accent="#481EE3"/>
        <KpiTile label={lang === "es" ? "Prod. asociados" : "Assoc. products"} value={kpis.productsCount} hint={lang === "es" ? "vinculados en el catálogo" : "linked in catalog"} accent="#94A3B8"/>
      </div>

      {/* Toolbar */}
      <div className="siz-toolbar">
        <div className="siz-search" style={{ maxWidth: 460 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="siz-input"
            placeholder={lang === "es" ? "Buscar por código NCM o descripción..." : "Search by NCM code or description..."}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Card Grid */}
      <div className="siz-card">
        {loading ? (
          <div className="siz-empty"><IconRefresh size={18}/> {lang === "es" ? "Cargando…" : "Loading…"}</div>
        ) : error ? (
          <div className="siz-empty siz-empty-error">
            <IconAlert size={18}/> {error}
            <button className="siz-btn siz-btn-ghost" onClick={loadAll}>{lang === "es" ? "Reintentar" : "Retry"}</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="siz-empty">
            <IconTag size={20}/>
            <div className="heading-md" style={{ color: NAVY }}>
              {lang === "es" ? "Sin códigos NCM" : "No NCM codes"}
            </div>
            <div className="caption" style={{ color: "#64748B" }}>
              {lang === "es" ? "Crea el primero con el botón “Nuevo NCM”." : "Create the first one with the “New NCM” button."}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
              padding: 4,
            }}
          >
            {filtered.map(n => {
              return (
                <div
                  key={n.id}
                  onClick={() => setEditing(n)}
                  className="siz-talla-card"
                  style={{
                    position: "relative",
                    background: "#FFFFFF",
                    border: "1px solid #E5E7EB",
                    borderRadius: 14,
                    padding: 16,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                    transition: "box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,23,42,0.10)";
                    e.currentTarget.style.borderColor = n.is_active ? MINT : "#E5E7EB";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)";
                    e.currentTarget.style.borderColor = "#E5E7EB";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {/* Card Head */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      className="mono"
                      style={{
                        font: "700 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
                        color: NAVY,
                        letterSpacing: -0.5,
                      }}
                    >
                      {n.code}
                    </span>
                    <div style={{ display: "inline-flex", gap: 2 }} onClick={e => e.stopPropagation()}>
                      <button
                        className="siz-btn siz-btn-icon-ghost"
                        title={lang === "es" ? "Desactivar" : "Deactivate"}
                        onClick={() => askDeactivate(n)}
                        style={{ background: "transparent", border: "none", color: "#F59E0B", cursor: "pointer", padding: 4 }}
                      >
                        <IconX size={14}/>
                      </button>
                      <button
                        className="siz-btn siz-btn-icon-ghost"
                        title={lang === "es" ? "Eliminar" : "Delete"}
                        onClick={() => askDelete(n)}
                        style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", padding: 4 }}
                      >
                        <IconTrash size={14}/>
                      </button>
                    </div>
                  </div>

                  {/* Descripcion */}
                  <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.4, minHeight: 36 }}>
                    {n.descripcion || <span style={{ color: "#CBD5E1", fontStyle: "italic" }}>{lang === "es" ? "Sin descripción" : "No description"}</span>}
                  </div>

                  {/* Tarifas */}
                  <div style={{ borderTop: "1px dashed #E5E7EB", paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                      {lang === "es" ? "Tasas arancelarias" : "Import tariffs"}
                    </div>
                    {Array.isArray(n.tarifas) && n.tarifas.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {n.tarifas.map((t, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                            <span style={{ color: "#334155", fontWeight: 500 }}>
                              {countryMap[t.origin_iso2] || t.origin_iso2} ➔ {countryMap[t.destination_iso2] || t.destination_iso2}
                            </span>
                            <span className="mono" style={{ color: MINT, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                              {t.rate_pct}%
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: "#94A3B8", fontStyle: "italic" }}>
                        {lang === "es" ? "Sin reglas arancelarias" : "No tariff rules defined"}
                      </div>
                    )}
                  </div>

                  {/* Productos Asociados */}
                  <div style={{ borderTop: "1px dashed #E5E7EB", paddingTop: 10, marginTop: "auto" }}>
                    <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                      {lang === "es" ? "Productos asociados" : "Associated products"}
                    </div>
                    {Array.isArray(n.productos_asociados) && n.productos_asociados.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {n.productos_asociados.map((p, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: 11.5,
                              background: "rgba(11,30,58,0.05)",
                              color: NAVY,
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontWeight: 500,
                            }}
                            title={p.nombre}
                          >
                            {p.sku}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: "#94A3B8", fontStyle: "italic" }}>
                        {lang === "es" ? "Sin productos vinculados" : "No linked products"}
                      </div>
                    )}
                  </div>

                  {/* Estado */}
                  <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
                    {n.is_active ? (
                      <span
                        style={{
                          background: "rgba(0,178,134,0.10)",
                          color: MINT,
                          border: "1px solid rgba(0,178,134,0.25)",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <IconCheck size={11}/>
                        {lang === "es" ? "Activo" : "Active"}
                      </span>
                    ) : (
                      <span
                        style={{
                          background: "rgba(100,116,139,0.10)",
                          color: "#64748B",
                          border: "1px solid rgba(100,116,139,0.25)",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {lang === "es" ? "Inactivo" : "Inactive"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {editing !== null && (
          <NcmFormDrawer
            lang={lang}
            countries={countries}
            initial={editing}
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>

      {/* Modal Confirm */}
      {pendingAction && createPortal(
        <ConfirmModal
          eyebrow={ACTION_COPY[pendingAction.kind].eyebrow}
          title={ACTION_COPY[pendingAction.kind].title}
          body={ACTION_COPY[pendingAction.kind].body(pendingAction.ncm)}
          actionLabel={ACTION_COPY[pendingAction.kind].action}
          actionColor={ACTION_COPY[pendingAction.kind].color}
          cancelLabel={lang === "es" ? "Cancelar" : "Cancel"}
          busy={actionBusy}
          error={actionError}
          onCancel={() => { if (!actionBusy) { setPendingAction(null); setActionError(null); } }}
          onConfirm={executeAction}
        />,
        document.body
      )}
    </div>
  );
}

function KpiTile({ label, value, hint, accent = MINT }) {
  return (
    <div className="siz-kpi">
      <div className="siz-kpi-label">{label}</div>
      <div className="siz-kpi-value tabular" style={{ color: NAVY }}>
        {value}
        <span style={{ display: "inline-block", marginLeft: 8, width: 6, height: 6, borderRadius: 999, background: accent }}/>
      </div>
      <div className="siz-kpi-hint">{hint}</div>
    </div>
  );
}

function NcmFormDrawer({ lang, countries, initial, onClose, onSave }) {
  const isEdit = !!initial?.id;

  const [form, setForm] = useState({
    id: null,
    code: "",
    descripcion: "",
    tarifas: [],
    is_active: true,
    ...initial,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Tarifas handlers
  const handleAddTarifa = () => {
    const defaultOrigin = countries[0]?.codigo || "";
    const defaultDest = countries.find(c => c.codigo === "CR" || c.label.toLowerCase().includes("costa rica"))?.codigo || countries[0]?.codigo || "";
    
    set("tarifas", [
      ...form.tarifas,
      { origin_iso2: defaultOrigin, destination_iso2: defaultDest, rate_pct: 0 },
    ]);
  };

  const handleRemoveTarifa = (idx) => {
    set("tarifas", form.tarifas.filter((_, i) => i !== idx));
  };

  const handleTarifaChange = (idx, field, value) => {
    const next = [...form.tarifas];
    next[idx] = {
      ...next[idx],
      [field]: field === "rate_pct" ? (value === "" ? 0 : Number(value)) : value,
    };
    set("tarifas", next);
  };

  const submit = async () => {
    if (!form.code || !form.code.trim()) {
      alert(lang === "es" ? "El código NCM es obligatorio." : "NCM code is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="siz-drawer-backdrop" onClick={onClose}/>
      <motion.aside
        className="siz-drawer"
        role="dialog"
        aria-modal="true"
        initial={{ x: 640, opacity: 0.5 }}
        animate={{ x: 0, opacity: 1, transition: { type: "spring", stiffness: 240, damping: 28 } }}
        exit={{ x: 640, opacity: 0, transition: { duration: 0.18 } }}
      >
        <div className="siz-drawer-head">
          <div>
            <div className="micro" style={{ color: MINT }}>
              {isEdit ? (lang === "es" ? "EDITAR NCM" : "EDIT NCM")
                      : (lang === "es" ? "NUEVO NCM" : "NEW NCM")}
            </div>
            <div className="heading-md">
              {form.code || (lang === "es" ? "Borrador sin guardar" : "Unsaved draft")}
            </div>
          </div>
          <button onClick={onClose} className="siz-btn siz-btn-icon-ghost" title="Cerrar">
            <IconX size={16}/>
          </button>
        </div>

        <div className="siz-drawer-body">
          {/* Clasificacion */}
          <section className="siz-section">
            <div className="siz-section-title">
              <IconTag size={12} style={{ marginRight: 6, color: MINT }}/>
              {lang === "es" ? "Información General" : "General Information"}
            </div>
            <div className="siz-grid-2">
              <div className="siz-field" style={{ gridColumn: "span 2" }}>
                <label className="siz-field-label">{lang === "es" ? "Código NCM / HS Code" : "NCM / HS Code"} <span style={{ color: "red" }}>*</span></label>
                <input
                  className="siz-input mono"
                  placeholder="p.ej. 6403.40.00"
                  value={form.code}
                  onChange={e => set("code", e.target.value)}
                  disabled={isEdit} // No permitir cambiar el código de una clasificación existente para mantener integridad
                />
              </div>

              <div className="siz-field" style={{ gridColumn: "span 2" }}>
                <label className="siz-field-label">{lang === "es" ? "Descripción" : "Description"}</label>
                <textarea
                  rows={2}
                  className="siz-input"
                  placeholder={lang === "es" ? "Nombre arancelario o descripción comercial..." : "Tariff description or commercial notes..."}
                  value={form.descripcion || ""}
                  onChange={e => set("descripcion", e.target.value)}
                />
              </div>

              <div className="siz-field">
                <label className="siz-field-label">{lang === "es" ? "Activo" : "Active"}</label>
                <label className="siz-toggle">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={e => set("is_active", e.target.checked)}
                  />
                  <span/>
                </label>
              </div>
            </div>
          </section>

          {/* Matriz de Tarifas */}
          <section className="siz-section" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="siz-section-title">
                <IconSliders size={12} style={{ marginRight: 6, color: MINT }}/>
                {lang === "es" ? "Matriz de Tarifas por País" : "Tariff Matrix by Country"}
              </div>
              <button
                type="button"
                className="siz-btn siz-btn-ghost"
                onClick={handleAddTarifa}
                style={{ padding: "4px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <IconPlus size={12}/>
                {lang === "es" ? "Agregar tasa" : "Add rate"}
              </button>
            </div>
            
            <div className="caption" style={{ color: "#64748B", marginBottom: 12 }}>
              {lang === "es"
                ? "Define porcentajes arancelarios de importación según el origen y destino."
                : "Define customs tariff percentages depending on origin and destination."}
            </div>

            {form.tarifas.length === 0 ? (
              <div style={{
                border: "1px dashed #E5E7EB", borderRadius: 10, padding: 20, textAlign: "center", color: "#64748B"
              }}>
                {lang === "es" ? "Sin tasas registradas. Haz click en 'Agregar tasa'." : "No rates defined. Click 'Add rate'."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {form.tarifas.map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 100px 32px",
                      gap: 8,
                      alignItems: "center",
                      background: "rgba(11,30,58,0.02)",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    <div>
                      <select
                        className="siz-input siz-select"
                        style={{ height: 34, padding: "4px 8px", fontSize: 12.5 }}
                        value={t.origin_iso2}
                        onChange={e => handleTarifaChange(idx, "origin_iso2", e.target.value)}
                      >
                        {countries.map(c => (
                          <option key={c.codigo} value={c.codigo}>{c.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <select
                        className="siz-input siz-select"
                        style={{ height: 34, padding: "4px 8px", fontSize: 12.5 }}
                        value={t.destination_iso2}
                        onChange={e => handleTarifaChange(idx, "destination_iso2", e.target.value)}
                      >
                        {countries.map(c => (
                          <option key={c.codigo} value={c.codigo}>{c.label}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        className="siz-input mono"
                        style={{ height: 34, padding: "4px 8px", fontSize: 12.5, textAlign: "right" }}
                        placeholder="%"
                        value={t.rate_pct}
                        onChange={e => handleTarifaChange(idx, "rate_pct", e.target.value)}
                      />
                      <span style={{ fontSize: 13, color: "#475569" }}>%</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveTarifa(idx)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#DC2626",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 32,
                        padding: 0,
                      }}
                      title={lang === "es" ? "Eliminar tasa" : "Delete rate"}
                    >
                      <IconTrash size={14}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="siz-drawer-foot">
          <button onClick={onClose} className="siz-btn siz-btn-ghost" disabled={saving}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={submit} className="siz-btn siz-btn-primary" disabled={saving}>
            <IconCheck size={14}/> {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Guardar" : "Save")}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
