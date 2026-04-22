// =====================================================================
// MWT.ONE · pages/SizingEngine.jsx
// Agente responsable: [AG-FRONTEND]
// Sprint: SIZING ENGINE v1
//
// Vista completa del Motor de Tallas:
//   1. Dashboard / lista (badges Calzado/Plantilla, equivalencias rápidas).
//   2. Drawer ancho de creación / edición con FORM DINÁMICO.
//
// LÓGICA CONDICIONAL (Observer):
//   · Si tipo_producto === 'plantilla' → aparece la sección
//     "Especificaciones Dimensionales" (grosor antepié/talón, drop, peso).
//   · Si tipo_producto === 'calzado' (o cualquier otro)  → la sección
//     se oculta por completo y los valores físicos se mantienen
//     como NULL al guardar.
//
// REGLAS MWT respetadas:
//   · CERO datos hardcoded — todo el catálogo de tipos y sistemas
//     se consume desde GET /api/sizing/options/.
//   · NO hay validación `required` en el form — el botón "Guardar"
//     puede enviarse con campos vacíos (se mandan como null).
//   · Tokens: Navy #0B1E3A, Mint #00B286, Light #1DE394, tabular-nums.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import { tallasApi, sizingApi } from "../lib/api.js";
import {
  IconPlus, IconRefresh, IconSearch, IconX, IconCheck,
  IconPackage, IconAlert, IconTag, IconLock,
} from "../lib/icons.jsx";


// ─── Helpers de presentación ──────────────────────────────────────
const NAVY  = "#0B1E3A";
const MINT  = "#00B286";

function formatDecimal(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toFixed(2);
}

function chipForTipo(tipo) {
  if (tipo === "plantilla") return { bg: "rgba(72,30,227,0.10)",  fg: "#481EE3", border: "rgba(72,30,227,0.30)",  label: "Plantilla" };
  if (tipo === "calzado")   return { bg: "rgba(0,178,134,0.12)",  fg: MINT,      border: "rgba(0,178,134,0.30)",  label: "Calzado"   };
  return { bg: "rgba(100,116,139,0.12)", fg: "#475569", border: "rgba(100,116,139,0.25)", label: tipo || "Sin tipo" };
}


// =====================================================================
// COMPONENTE PRINCIPAL
// =====================================================================
export default function ScreenSizingEngine() {
  // Algunos layouts pasan { lang } por context; soportamos ambos casos.
  const ctx  = useOutletContext?.() || {};
  const lang = ctx.lang || "es";

  const [options,  setOptions]  = useState(null);    // /sizing/options/
  const [tallas,   setTallas]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filterTipo, setFilterTipo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing]   = useState(null);    // null | {} (nuevo) | obj (edita)

  // ── Carga inicial: opciones + tallas ──────────────────────────
  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [opt, list] = await Promise.all([
        sizingApi.options(),
        tallasApi.list(),
      ]);
      setOptions(opt);
      setTallas(Array.isArray(list?.results) ? list.results
                : Array.isArray(list)        ? list
                : []);
    } catch (e) {
      setError(e?.message || "Error cargando tallas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ── Filtrado client-side ─────────────────────────────────────
  const filtered = useMemo(() => {
    let out = tallas;
    if (filterTipo) out = out.filter(t => (t.tipo_producto || "") === filterTipo);
    const ql = q.trim().toLowerCase();
    if (ql) {
      out = out.filter(t => (
        (t.talla_base || "").toLowerCase().includes(ql) ||
        (t.nombre || "").toLowerCase().includes(ql) ||
        (t.eu || "").toLowerCase().includes(ql) ||
        (t.us_men || "").toLowerCase().includes(ql) ||
        (t.us_women || "").toLowerCase().includes(ql) ||
        (t.uk_men || "").toLowerCase().includes(ql) ||
        (t.br || "").toLowerCase().includes(ql) ||
        (t.cm || "").toLowerCase().includes(ql)
      ));
    }
    return out;
  }, [tallas, filterTipo, q]);

  // ── KPIs superiores ──────────────────────────────────────────
  const kpis = useMemo(() => {
    const total      = tallas.length;
    const calzado    = tallas.filter(t => t.tipo_producto === "calzado").length;
    const plantilla  = tallas.filter(t => t.tipo_producto === "plantilla").length;
    const borradores = tallas.filter(t => !t.tipo_producto || !t.talla_base).length;
    return { total, calzado, plantilla, borradores };
  }, [tallas]);

  // ── Persistencia: create / update ────────────────────────────
  const handleSave = async (form) => {
    // Limpia el payload — strings vacíos → null para no contaminar la DB.
    const payload = {};
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === "string" && v.trim() === "") payload[k] = null;
      else payload[k] = v;
    });
    if (form.id) {
      await tallasApi.update(form.id, payload);
    } else {
      await tallasApi.create(payload);
    }
    setEditing(null);
    await loadAll();
  };

  const handleSoftDelete = async (talla) => {
    if (!talla?.id) return;
    if (!window.confirm(lang === "es" ? "¿Desactivar esta talla?" : "Deactivate this size?")) return;
    await tallasApi.remove(talla.id);
    await loadAll();
  };


  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div className="page siz-root" style={{ color: NAVY }}>
      {/* Hero */}
      <div className="siz-hero">
        <div>
          <div className="micro" style={{ color: MINT }}>SIZING ENGINE · v1</div>
          <h1 className="page-title" style={{ margin: "2px 0" }}>
            {lang === "es" ? "Motor de Tallas" : "Sizing Engine"}
          </h1>
          <div className="caption" style={{ color: "#64748B" }}>
            {lang === "es"
              ? "Catálogo maestro de tallas para calzado y plantillas. Cero campos obligatorios — guarda borradores cuando quieras."
              : "Master catalog of sizes for footwear and insoles. No required fields — save drafts at any time."}
          </div>
        </div>
        <div className="siz-hero-actions">
          <button onClick={loadAll} className="siz-btn siz-btn-ghost" title="Recargar">
            <IconRefresh size={14}/> {lang === "es" ? "Recargar" : "Refresh"}
          </button>
          <button onClick={() => setEditing({})} className="siz-btn siz-btn-primary">
            <IconPlus size={14}/> {lang === "es" ? "Nueva talla" : "New size"}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="siz-kpis">
        <KpiTile label={lang === "es" ? "Total tallas"  : "Total sizes"}  value={kpis.total}      hint={lang === "es" ? "registradas en el catálogo" : "in the catalog"}/>
        <KpiTile label={lang === "es" ? "Calzado"       : "Footwear"}     value={kpis.calzado}    hint={lang === "es" ? "sin dimensiones físicas"     : "no physical dimensions"} accent={MINT}/>
        <KpiTile label={lang === "es" ? "Plantillas"    : "Insoles"}      value={kpis.plantilla}  hint={lang === "es" ? "con grosor / drop / peso"    : "with thickness / drop / weight"} accent="#481EE3"/>
        <KpiTile label={lang === "es" ? "Borradores"    : "Drafts"}       value={kpis.borradores} hint={lang === "es" ? "incompletas / sin tipo"      : "incomplete / typeless"} accent="#94A3B8"/>
      </div>

      {/* Toolbar */}
      <div className="siz-toolbar">
        <div className="siz-search">
          <IconSearch size={14} className="search-icon"/>
          <input
            className="siz-input"
            placeholder={lang === "es" ? "Buscar por talla base, nombre o equivalencia (42, M, 9.5…)" : "Search by base size, name or equivalence"}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <select
          className="siz-input siz-select"
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="">{lang === "es" ? "Todos los tipos" : "All types"}</option>
          {(options?.tipos_producto || []).map(t => (
            <option key={t.codigo} value={t.codigo}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
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
            <IconPackage size={20}/>
            <div className="heading-md" style={{ color: NAVY }}>
              {lang === "es" ? "Sin tallas que mostrar" : "No sizes to show"}
            </div>
            <div className="caption" style={{ color: "#64748B" }}>
              {lang === "es" ? "Crea la primera con el botón “Nueva talla”." : "Create the first one with the “New size” button."}
            </div>
          </div>
        ) : (
          <div className="siz-table-wrap">
            <table className="siz-table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Tipo" : "Type"}</th>
                  <th>{lang === "es" ? "Talla base" : "Base"}</th>
                  <th>{lang === "es" ? "Nombre" : "Name"}</th>
                  <th className="ar">EU</th>
                  <th className="ar">US M</th>
                  <th className="ar">US W</th>
                  <th className="ar">UK M</th>
                  <th className="ar">BR</th>
                  <th className="ar">CM</th>
                  <th className="ar">{lang === "es" ? "Drop" : "Drop"}</th>
                  <th className="ar">{lang === "es" ? "Peso" : "Weight"}</th>
                  <th>{lang === "es" ? "Estado" : "Status"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const chip = chipForTipo(t.tipo_producto);
                  return (
                    <tr key={t.id}
                        className="siz-row"
                        onClick={() => setEditing(t)}
                        style={{ cursor: "pointer" }}>
                      <td>
                        <span className="siz-chip" style={{
                          background: chip.bg, color: chip.fg, borderColor: chip.border,
                        }}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="mono"><strong>{t.talla_base || <span style={{ color:"#94A3B8" }}>—</span>}</strong></td>
                      <td>{t.nombre || <span style={{ color:"#94A3B8" }}>—</span>}</td>
                      <td className="ar tabular">{t.eu       || "—"}</td>
                      <td className="ar tabular">{t.us_men   || "—"}</td>
                      <td className="ar tabular">{t.us_women || "—"}</td>
                      <td className="ar tabular">{t.uk_men   || "—"}</td>
                      <td className="ar tabular">{t.br       || "—"}</td>
                      <td className="ar tabular">{t.cm       || "—"}</td>
                      <td className="ar tabular">{t.drop_mm  ? formatDecimal(t.drop_mm)  : "—"}</td>
                      <td className="ar tabular">{t.peso_g   ? formatDecimal(t.peso_g)   : "—"}</td>
                      <td>
                        {t.is_active
                          ? <span className="siz-badge siz-badge-ok">{lang === "es" ? "Activa" : "Active"}</span>
                          : <span className="siz-badge siz-badge-off">{lang === "es" ? "Inactiva" : "Inactive"}</span>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          className="siz-btn siz-btn-icon-ghost"
                          title={lang === "es" ? "Desactivar" : "Deactivate"}
                          onClick={() => handleSoftDelete(t)}
                        >
                          <IconX size={14}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer de creación / edición */}
      <AnimatePresence>
        {editing !== null && (
          <TallaFormDrawer
            lang={lang}
            options={options}
            initial={editing}
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


// =====================================================================
// KPI tile
// =====================================================================
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


// =====================================================================
// DRAWER · Form dinámico (creación / edición)
//
//   · LÓGICA CONDICIONAL OBSERVER:
//       form.tipo_producto === 'plantilla'  → muestra "Especificaciones
//       Dimensionales".  Cualquier otro valor (incluyendo null/empty
//       o 'calzado') la oculta.
//   · Cero validación required: el botón "Guardar" siempre está activo.
// =====================================================================
function TallaFormDrawer({ lang, options, initial, onClose, onSave }) {
  const isEdit = !!initial?.id;

  // Form state — arranca con un esquema vacío y rellena con `initial`.
  const blank = useMemo(() => {
    const eqFields  = (options?.equivalence_fields || []).reduce((acc, k) => ({ ...acc, [k]: "" }), {});
    const dimFields = (options?.dimension_fields   || []).reduce((acc, d) => ({ ...acc, [d.key]: "" }), {});
    return {
      id: null,
      is_active: true,
      tipo_producto: "",
      talla_base: "",
      nombre: "",
      descripcion: "",
      ...eqFields,
      ...dimFields,
    };
  }, [options]);

  const [form, setForm] = useState({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);

  // Cuando cambian las opciones (asíncrono) o el initial → re-merge.
  useEffect(() => {
    setForm({ ...blank, ...initial });
  }, [blank, initial]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // ── Determinante de la lógica condicional ──────────────────
  const tipoMeta = useMemo(() => {
    return (options?.tipos_producto || []).find(
      t => t.codigo === form.tipo_producto
    ) || null;
  }, [options, form.tipo_producto]);

  const showDimensionales = tipoMeta?.requiere_dimensiones === true;

  // ── Submit (sin bloqueos) ──────────────────────────────────
  const submit = async () => {
    setSaving(true);
    try {
      // Si el tipo no requiere dimensiones, los reseteamos a null.
      const payload = { ...form };
      if (!showDimensionales) {
        (options?.dimension_fields || []).forEach(d => { payload[d.key] = null; });
      }
      await onSave(payload);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert((lang === "es" ? "Error guardando: " : "Save error: ") + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        className="siz-drawer-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="siz-drawer"
        role="dialog" aria-modal="true"
        initial={{ x: 640, opacity: 0.5 }}
        animate={{ x: 0,   opacity: 1, transition: { type: "spring", stiffness: 240, damping: 28 } }}
        exit={{    x: 640, opacity: 0, transition: { duration: 0.18 } }}
      >
        {/* Head */}
        <div className="siz-drawer-head">
          <div>
            <div className="micro" style={{ color: MINT }}>
              {isEdit ? (lang === "es" ? "EDITAR TALLA" : "EDIT SIZE")
                      : (lang === "es" ? "NUEVA TALLA"  : "NEW SIZE")}
            </div>
            <div className="heading-md">
              {form.nombre || form.talla_base || (lang === "es" ? "Borrador sin guardar" : "Unsaved draft")}
            </div>
            <div className="caption" style={{ color: "#64748B", marginTop: 2 }}>
              {lang === "es"
                ? "Ningún campo es obligatorio — puedes guardar este borrador con sólo abrirlo."
                : "No fields are required — you can save this draft just by opening it."}
            </div>
          </div>
          <button onClick={onClose} className="siz-btn siz-btn-icon-ghost" title="Cerrar">
            <IconX size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="siz-drawer-body">
          {/* SECCIÓN 1 · Clasificación */}
          <Section title={lang === "es" ? "Clasificación" : "Classification"}>
            <div className="siz-grid-2">
              <Field label={lang === "es" ? "Tipo de producto" : "Product type"}>
                <select
                  className="siz-input siz-select"
                  value={form.tipo_producto || ""}
                  onChange={e => set("tipo_producto", e.target.value)}
                >
                  <option value="">{lang === "es" ? "— Sin definir —" : "— Unset —"}</option>
                  {(options?.tipos_producto || []).map(t => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.label}{t.requiere_dimensiones ? "  (mide dimensiones)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={lang === "es" ? "Talla base" : "Base size"}>
                <input
                  className="siz-input mono"
                  placeholder={lang === "es" ? 'p.ej. "42", "S3", "M-WIDE"' : 'e.g. "42", "S3", "M-WIDE"'}
                  value={form.talla_base || ""}
                  onChange={e => set("talla_base", e.target.value)}
                />
              </Field>
              <Field label={lang === "es" ? "Nombre comercial" : "Commercial name"}>
                <input
                  className="siz-input"
                  placeholder={lang === "es" ? "Bota seguridad EU 42" : "Safety boot EU 42"}
                  value={form.nombre || ""}
                  onChange={e => set("nombre", e.target.value)}
                />
              </Field>
              <Field label={lang === "es" ? "Activa" : "Active"}>
                <label className="siz-toggle">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={e => set("is_active", e.target.checked)}
                  />
                  <span/>
                </label>
              </Field>
              <Field label={lang === "es" ? "Descripción" : "Description"} span={2}>
                <textarea
                  rows={2}
                  className="siz-input"
                  placeholder={lang === "es" ? "Notas internas, contexto, fuente…" : "Internal notes, context, source…"}
                  value={form.descripcion || ""}
                  onChange={e => set("descripcion", e.target.value)}
                />
              </Field>
            </div>
          </Section>

          {/* SECCIÓN 2 · Matriz de Equivalencias */}
          <Section
            title={lang === "es" ? "Matriz de Equivalencias" : "Equivalence Matrix"}
            hint={lang === "es"
              ? `Mapea esta talla a los ${(options?.sistemas_medida || []).length} sistemas internacionales soportados. Todos opcionales.`
              : `Map this size to the ${(options?.sistemas_medida || []).length} supported international systems. All optional.`}
          >
            <div className="siz-grid-equiv">
              {(options?.sistemas_medida || []).map(sis => (
                <Field key={sis.codigo} label={sis.label} hint={sis.region}>
                  <input
                    className="siz-input tabular"
                    placeholder={sis.grupo === "alfa" ? "S / M / L" : "—"}
                    value={form[sis.codigo] || ""}
                    onChange={e => set(sis.codigo, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </Section>

          {/* SECCIÓN 3 · DINÁMICA — sólo plantillas */}
          <AnimatePresence initial={false}>
            {showDimensionales && (
              <motion.section
                key="dim"
                className="siz-section siz-section-dim"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                exit={{    opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22 }}
              >
                <div className="siz-section-head">
                  <div className="siz-section-title">
                    <IconLock size={12} style={{ marginRight: 6, color: "#481EE3" }}/>
                    {lang === "es" ? "Especificaciones Dimensionales" : "Dimensional Specifications"}
                  </div>
                  <div className="caption" style={{ color: "#64748B" }}>
                    {lang === "es"
                      ? "Sólo aplica a plantillas. Todos los valores son opcionales."
                      : "Applies to insoles only. All values optional."}
                  </div>
                </div>
                <div className="siz-grid-dim">
                  {(options?.dimension_fields || []).map(d => (
                    <Field key={d.key} label={d.label} hint={d.unit}>
                      <input
                        type="number"
                        step={d.step ?? 0.1}
                        min={d.min ?? 0}
                        max={d.max}
                        className="siz-input tabular"
                        placeholder={d.unit}
                        value={form[d.key] ?? ""}
                        onChange={e => set(d.key, e.target.value === "" ? null : e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Foot */}
        <div className="siz-drawer-foot">
          <button onClick={onClose} className="siz-btn siz-btn-ghost" disabled={saving}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={submit} className="siz-btn siz-btn-primary" disabled={saving}>
            <IconCheck size={14}/> {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Guardar borrador" : "Save draft")}
          </button>
        </div>
      </motion.aside>
    </>
  );
}


// =====================================================================
// Subcomponentes UI
// =====================================================================
function Section({ title, hint, children }) {
  return (
    <section className="siz-section">
      <div className="siz-section-head">
        <div className="siz-section-title"><IconTag size={12} style={{ marginRight: 6, color: MINT }}/> {title}</div>
        {hint && <div className="caption" style={{ color: "#64748B" }}>{hint}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, span = 1, children }) {
  return (
    <div className="siz-field" style={{ gridColumn: `span ${span}` }}>
      <label className="siz-field-label">
        {label}
        {hint && <span className="siz-field-hint"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}
