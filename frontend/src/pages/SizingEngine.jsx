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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import { tallasApi, sizingApi, sizingFamiliasApi, tiposProductoCatApi, tiposProductoMatrizApi, sistemasMedidaCatApi, marcasApi, apiFetch, getToken } from "../lib/api.js";
import { MOCK_TALLAS, MOCK_SIZING_OPTIONS } from "../data/mockData.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import CreateBrandDrawer from "../components/brands/CreateBrandDrawer.jsx";
import {
  IconPlus, IconRefresh, IconSearch, IconX, IconCheck,
  IconPackage, IconAlert, IconTag,
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
  const [usingMock, setUsingMock] = useState(false);  // banner informativo
  const [filterTipo, setFilterTipo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing]   = useState(null);    // null | {} (nuevo) | obj (edita)
  // Sprint 2026-07-16 · filtros por clasificadores
  const [filterMarca,   setFilterMarca]   = useState("");
  const [filterFamilia, setFilterFamilia] = useState("");   // id de familia
  // Sprint 2026-07-22 · catálogo real de familias (/sizing/familias/) —
  // alimenta el select Familia del toolbar (filtrable por marca).
  const [familiasCat,   setFamiliasCat]   = useState([]);

  // ── Carga inicial: opciones + tallas ──────────────────────────
  // Las opciones (catálogos) sí caen a MOCK_SIZING_OPTIONS si el
  // backend no las trae (sin ellas el form quedaría inutilizable).
  // Las TALLAS, en cambio, ya NO caen al mock — si la BD está
  // vacía mostramos empty-state real para que el usuario cree las
  // suyas. (Antes se mostraba el banner "Modo demo" que confundía.)
  const loadAll = async () => {
    setLoading(true);
    setError(null);
    let opt = null;
    let list = [];
    let listErr = null;
    try {
      opt = await sizingApi.options();
    } catch (e) { /* opciones vienen del catálogo de soporte; si fallan, usamos MOCK */ }
    try {
      const r = await tallasApi.list();
      list = Array.isArray(r?.results) ? r.results
           : Array.isArray(r)          ? r
           : [];
    } catch (e) { listErr = e; }
    try {
      const rf = await sizingFamiliasApi.list();
      setFamiliasCat(Array.isArray(rf) ? rf : (rf?.results || []));
    } catch (e) { /* el catálogo de familias es complementario al filtro */ }

    const finalOptions = (opt && Object.keys(opt).length > 0) ? opt : MOCK_SIZING_OPTIONS;
    setOptions(finalOptions);
    setTallas(list);          // si está vacío, vacío se queda
    setUsingMock(false);      // banner demo desactivado por completo
    if (listErr) setError(listErr?.message || "Error cargando tallas.");
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Tras un CRUD de marca/familia hecho desde el drawer: refresca los
  // catálogos sin recargar la lista de tallas (no cambió).
  const reloadOptions = async () => {
    try {
      const opt = await sizingApi.options();
      if (opt && Object.keys(opt).length > 0) setOptions(opt);
    } catch (e) { /* conserva las opciones actuales */ }
    try {
      const rf = await sizingFamiliasApi.list();
      setFamiliasCat(Array.isArray(rf) ? rf : (rf?.results || []));
    } catch (e) { /* conserva el catálogo actual */ }
  };

  // Si cambia la marca del toolbar y la familia elegida ya no le pertenece,
  // se limpia para no filtrar por una combinación imposible.
  useEffect(() => {
    if (!filterFamilia || !filterMarca) return;
    const fam = familiasCat.find(f => f.id === filterFamilia);
    if (fam && fam.marca_id !== filterMarca) setFilterFamilia("");
  }, [filterMarca, familiasCat, filterFamilia]);

  // ── Mapa id→nombre de marca + familias de línea distintas ──────
  // Sprint 2026-07-22 · la clasificación de la talla vive en
  // `metadata.familia` (Composite, Prime, EVA, Social, PVC All Work,
  // PVC Vulcaflex): el filtro del toolbar es por FAMILIA.
  const marcaNameById = useMemo(() => {
    const map = {};
    (options?.marcas || []).forEach(m => { map[m.id] = m.nombre; });
    return map;
  }, [options]);

  const familiasDistinct = useMemo(() => {
    const set = new Set();
    tallas.forEach(t => {
      const f = t?.metadata?.familia;
      if (f && !/dalupo/i.test(String(f))) set.add(String(f));
    });
    return [...set].sort();
  }, [tallas]);

  // ── Filtrado client-side ─────────────────────────────────────
  const filtered = useMemo(() => {
    let out = tallas;
    if (filterTipo) out = out.filter(t => (t.tipo_producto || "") === filterTipo);
    if (filterMarca) {
      out = out.filter(t => (Array.isArray(t.marca_ids) ? t.marca_ids : []).includes(filterMarca));
    }
    if (filterFamilia) {
      // Sprint 2026-07-22 · comparación por FK real (talla.familia_id).
      out = out.filter(t => t.familia_id === filterFamilia);
    }
    const ql = q.trim().toLowerCase();
    if (ql) {
      out = out.filter(t => (
        (t.talla_base || "").toLowerCase().includes(ql) ||
        (t.nombre || "").toLowerCase().includes(ql) ||
        String(t.familia_nombre ?? t?.metadata?.familia ?? "").toLowerCase().includes(ql) ||
        (Array.isArray(t.familias) ? t.familias : []).some(f => String(f).toLowerCase().includes(ql)) ||
        (Array.isArray(t.tipos) ? t.tipos : []).some(x => String(x).toLowerCase().includes(ql)) ||
        (t.eu || "").toLowerCase().includes(ql) ||
        (t.us_men || "").toLowerCase().includes(ql) ||
        (t.us_women || "").toLowerCase().includes(ql) ||
        (t.uk_men || "").toLowerCase().includes(ql) ||
        (t.br || "").toLowerCase().includes(ql) ||
        (t.cm || "").toLowerCase().includes(ql)
      ));
    }
    return out;
  }, [tallas, filterTipo, filterMarca, filterFamilia, q]);

  // ── KPIs superiores ──────────────────────────────────────────
  const kpis = useMemo(() => {
    const total      = tallas.length;
    const calzado    = tallas.filter(t => t.tipo_producto === "calzado").length;
    const plantilla  = tallas.filter(t => t.tipo_producto === "plantilla").length;
    const borradores = tallas.filter(t => !t.tipo_producto || !t.talla_base).length;
    return { total, calzado, plantilla, borradores };
  }, [tallas]);

  // ── Persistencia: create / update ────────────────────────────
  // Si el backend está en MOCK / falla, se aplica el cambio sólo
  // al state local (no se persiste). El banner "Modo demo" lo
  // hace visible para que nadie crea que se guardó.
  const handleSave = async (form) => {
    // Limpia el payload — strings vacíos → null para no contaminar la DB.
    const payload = {};
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === "string" && v.trim() === "") payload[k] = null;
      else payload[k] = v;
    });
    try {
      if (form.id) {
        await tallasApi.update(form.id, payload);
      } else {
        await tallasApi.create(payload);
      }
      setEditing(null);
      await loadAll();
    } catch (e) {
      // Antes había fallback a "mock-mode local" — quitado.
      // Ahora el error se muestra honestamente para que el usuario sepa
      // qué falló y reintente. Mantiene el form abierto para no perder edición.
      alert((lang === "es" ? "No se pudo guardar: " : "Save failed: ") + (e?.message || ""));
    }
  };

  // ── Confirmaciones unificadas vía modal MWT (no window.confirm). ──
  // pendingAction: { kind: 'deactivate'|'delete', talla }
  const [pendingAction, setPendingAction] = useState(null);
  const [actionBusy,    setActionBusy]    = useState(false);
  const [actionError,   setActionError]   = useState(null);

  const askDeactivate = (talla) => { setActionError(null); setPendingAction({ kind: 'deactivate', talla }); };
  const askDelete     = (talla) => { setActionError(null); setPendingAction({ kind: 'delete',     talla }); };

  const executeAction = async () => {
    if (!pendingAction?.talla?.id) return;
    const { kind, talla } = pendingAction;
    setActionBusy(true);
    setActionError(null);
    try {
      if (kind === 'deactivate') {
        // PATCH suave — preserva el registro pero lo oculta de listas activas.
        await tallasApi.update(talla.id, { is_active: false });
      } else if (kind === 'delete') {
        // HARD delete: query param ?hard=1 (sin él, el backend hace soft
        // por compatibilidad histórica). tallasApi.remove() no soporta
        // query params, por eso usamos apiFetch directamente.
        // NOTA: la base real del endpoint es /sizing/tallas/ (no /tallas/).
        await apiFetch(`/sizing/tallas/${talla.id}/?hard=1`, {
          method: "DELETE", token: getToken(),
        });
      }
      setPendingAction(null);
      await loadAll();
    } catch (e) {
      setActionError(e?.message || (lang === "es" ? "Operación falló" : "Operation failed"));
    } finally {
      setActionBusy(false);
    }
  };

  // Copy del modal según la acción.
  const ACTION_COPY = {
    deactivate: {
      eyebrow:  'CAMBIO DE ESTADO',
      title:    lang === "es" ? '¿Desactivar esta talla?' : 'Deactivate this size?',
      action:   lang === "es" ? 'Sí, desactivar'           : 'Yes, deactivate',
      color:    '#F59E0B',
      body:     (t) => lang === "es"
        ? <>La talla <strong>{t.nombre || t.talla_base || '—'}</strong> se marcará como inactiva. Sigue en la BD pero deja de aparecer en listas y selectores. Reversible.</>
        : <>Size <strong>{t.nombre || t.talla_base || '—'}</strong> will be marked inactive. Stays in DB but disappears from lists. Reversible.</>,
    },
    delete: {
      eyebrow:  'ACCIÓN DESTRUCTIVA',
      title:    lang === "es" ? '¿Eliminar esta talla?' : 'Delete this size?',
      action:   lang === "es" ? 'Sí, eliminar'         : 'Yes, delete',
      color:    '#DC2626',
      body:     (t) => lang === "es"
        ? <>Vas a eliminar <strong>{t.nombre || t.talla_base || '—'}</strong>. Esta acción NO es reversible desde la UI — necesitarás restaurar manualmente desde BD si te arrepientes.</>
        : <>You're about to delete <strong>{t.nombre || t.talla_base || '—'}</strong>. This action is NOT reversible from the UI.</>,
    },
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

      {/* Banner modo demo (mock fallback) */}
      {usingMock && (
        <div style={{
          marginTop: 12, padding: "8px 12px", borderRadius: 8,
          background: "rgba(180,83,9,0.10)", color: "#B45309",
          font: "600 12.5px/1.4 var(--font-body)",
          border: "1px solid rgba(180,83,9,0.20)",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          ⚠ {lang === "es"
              ? "Modo demo · mostrando datos de ejemplo (la DB de tallas está vacía o el backend no responde). Las creaciones/ediciones no se persisten."
              : "Demo mode · showing mock data (sizing DB empty or backend down). Creates/edits won't persist."}
        </div>
      )}

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
        {/* Sprint 2026-07-16 · filtros por marca y puntera */}
        <select
          className="siz-input siz-select"
          value={filterMarca}
          onChange={e => setFilterMarca(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="">{lang === "es" ? "Todas las marcas" : "All brands"}</option>
          {(options?.marcas || []).map(m => (
            <option key={m.id} value={m.id}>{m.nombre}</option>
          ))}
        </select>
        <select
          className="siz-input siz-select"
          value={filterFamilia}
          onChange={e => setFilterFamilia(e.target.value)}
          style={{ maxWidth: 200 }}
          title={lang === "es" ? "Grupo de tallas" : "Size group"}
        >
          <option value="">{lang === "es" ? "Todos los grupos" : "All groups"}</option>
          {(filterMarca ? familiasCat.filter(f => f.marca_id === filterMarca) : familiasCat).map(f => (
            <option key={f.id} value={f.id}>{f.nombre}</option>
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 14,
              padding: 4,
            }}
          >
            {filtered.map(t => {
              const chip = chipForTipo(t.tipo_producto);
              const isPlantilla = t.tipo_producto === "plantilla";
              // Sprint 2026-07-22 · marca única (FK) con fallback al array
              // legacy; familia por nombre read-only del backend.
              const marcaId    = t.marca_id || (Array.isArray(t.marca_ids) ? t.marca_ids[0] : null);
              const familiaLbl = t.familia_nombre ?? t?.metadata?.familia;
              // Sprint 2026-07-22 · fase 2 · celdas dinámicas de la grilla
              // de equivalencias (unidades del tipo, máx 6 con valor).
              const tipoCard = (options?.tipos_producto || []).find(x => x.codigo === t.tipo_producto);
              const eqCells = (() => {
                const fixed = [
                  { cod: "eu",       label: "EU",   value: t.eu },
                  { cod: "us_men",   label: "US M", value: t.us_men },
                  { cod: "us_women", label: "US W", value: t.us_women },
                  { cod: "uk_men",   label: "UK M", value: t.uk_men },
                  { cod: "br",       label: "BR",   value: t.br },
                  { cod: "cm",       label: "CM",   value: t.cm },
                ];
                const sist = Array.isArray(tipoCard?.sistemas) ? tipoCard.sistemas : [];
                if (sist.length === 0) return fixed;
                const cat = options?.sistemas_medida || [];
                const out = [];
                for (const cod of sist) {
                  const v = t.equivalencias?.[cod] ?? t[cod];
                  if (v === null || v === undefined || v === "") continue;
                  const unit = cat.find(s => s.codigo === cod);
                  out.push({ cod, label: unit?.label || String(cod).toUpperCase(), value: v });
                  if (out.length >= 6) break;
                }
                // Sin valores dinámicos (borrador) → las fijas con sus "—",
                // para que calzado se vea exactamente igual que antes.
                return out.length > 0 ? out : fixed;
              })();
              return (
                <div
                  key={t.id}
                  onClick={() => setEditing(t)}
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
                    e.currentTarget.style.borderColor = chip.border;
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)";
                    e.currentTarget.style.borderColor = "#E5E7EB";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {/* Header: chip + X */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      className="siz-chip"
                      style={{
                        background: chip.bg,
                        color: chip.fg,
                        borderColor: chip.border,
                        border: "1px solid",
                        borderRadius: 999,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {chip.label}
                    </span>
                    <div style={{ display: "inline-flex", gap: 2 }}>
                      <button
                        className="siz-btn siz-btn-icon-ghost"
                        title={lang === "es" ? "Desactivar" : "Deactivate"}
                        onClick={e => { e.stopPropagation(); askDeactivate(t); }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#F59E0B",
                          cursor: "pointer",
                          padding: 4,
                          borderRadius: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconX size={14}/>
                      </button>
                      <button
                        className="siz-btn siz-btn-icon-ghost"
                        title={lang === "es" ? "Eliminar" : "Delete"}
                        onClick={e => { e.stopPropagation(); askDelete(t); }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#DC2626",
                          cursor: "pointer",
                          padding: 4,
                          borderRadius: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          font: "700 11px/1 inherit",
                          letterSpacing: 0.5,
                        }}
                      >
                        <IconAlert size={14}/>
                      </button>
                    </div>
                  </div>

                  {/* Talla base + nombre */}
                  <div>
                    <div
                      className="mono tabular"
                      style={{
                        font: "700 28px/1.05 ui-monospace, SFMono-Regular, Menlo, monospace",
                        color: NAVY,
                        letterSpacing: -0.5,
                      }}
                    >
                      {t.talla_base || <span style={{ color: "#CBD5E1" }}>—</span>}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        color: "#475569",
                        lineHeight: 1.3,
                        minHeight: 17,
                      }}
                    >
                      {t.nombre || <span style={{ color: "#CBD5E1" }}>—</span>}
                    </div>
                    {/* Marca · Familia (Sprint 2026-07-22)
                        Marca única por FK; familia vía familia_nombre. */}
                    {(marcaId ||
                      familiaLbl ||
                      (t.tipos || []).length > 0 ||
                      (t.familias || []).length > 0) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                        {marcaId && (
                          <span style={{
                            background: "rgba(11,30,58,0.06)", color: "#0B1E3A",
                            border: "1px solid rgba(11,30,58,0.15)",
                            borderRadius: 999, padding: "2px 8px",
                            fontSize: 10.5, fontWeight: 700,
                          }}>
                            {marcaNameById[marcaId] || String(marcaId).slice(0, 8)}
                          </span>
                        )}
                        {familiaLbl && (
                          <span className="mono" style={{
                            background: "rgba(0,178,134,0.09)", color: "#008B69",
                            border: "1px solid rgba(0,178,134,0.25)",
                            borderRadius: 999, padding: "2px 8px",
                            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                          }}>
                            {familiaLbl}
                          </span>
                        )}
                        {(t.tipos || []).map(tp => (
                          <span key={tp} style={{
                            background: "rgba(72,30,227,0.07)", color: "#481EE3",
                            border: "1px solid rgba(72,30,227,0.22)",
                            borderRadius: 999, padding: "2px 8px",
                            fontSize: 10.5, fontWeight: 600,
                          }}>
                            {tp}
                          </span>
                        ))}
                        {(t.familias || []).map(f => (
                          <span key={f} className="mono" style={{
                            background: "rgba(0,178,134,0.09)", color: "#008B69",
                            border: "1px solid rgba(0,178,134,0.25)",
                            borderRadius: 999, padding: "2px 8px",
                            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
                          }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Equivalencias (Sprint 2026-07-22 · fase 2 · dinámica):
                      unidades configuradas en el tipo (en su orden) con
                      valor en equivalencias (fallback a columna legacy),
                      máx 6. Si el tipo no tiene config (o ninguna unidad
                      trae valor) → las 6 fijas de siempre. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: "8px 10px",
                      paddingTop: 10,
                      borderTop: "1px dashed #E5E7EB",
                    }}
                  >
                    {eqCells.map(eq => (
                      <div key={eq.cod || eq.label} style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600, letterSpacing: 0.5 }}>
                          {eq.label}
                        </span>
                        <span
                          className="tabular"
                          style={{
                            fontSize: 13,
                            color: eq.value ? NAVY : "#CBD5E1",
                            fontWeight: eq.value ? 600 : 400,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {eq.value || "—"}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Dimensiones (sólo plantillas) */}
                  {isPlantilla && (t.drop_mm || t.peso_g) && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: "6px 10px",
                        padding: "8px 10px",
                        background: "rgba(72,30,227,0.05)",
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 10, color: "#481EE3", fontWeight: 600, letterSpacing: 0.5 }}>
                          {lang === "es" ? "DROP (mm)" : "DROP (mm)"}
                        </span>
                        <span className="tabular" style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
                          {t.drop_mm ? formatDecimal(t.drop_mm) : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 10, color: "#481EE3", fontWeight: 600, letterSpacing: 0.5 }}>
                          {lang === "es" ? "PESO (g)" : "WEIGHT (g)"}
                        </span>
                        <span className="tabular" style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
                          {t.peso_g ? formatDecimal(t.peso_g) : "—"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Estado */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
                    {t.is_active ? (
                      <span
                        className="siz-badge siz-badge-ok"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          background: "rgba(0,178,134,0.10)",
                          color: MINT,
                          border: "1px solid rgba(0,178,134,0.25)",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <IconCheck size={11}/>
                        {lang === "es" ? "Activa" : "Active"}
                      </span>
                    ) : (
                      <span
                        className="siz-badge siz-badge-off"
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
                        {lang === "es" ? "Inactiva" : "Inactive"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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
            tallas={tallas}
            onClose={() => setEditing(null)}
            onSave={handleSave}
            onReloadOptions={reloadOptions}
          />
        )}
      </AnimatePresence>

      {/* Modal de confirmación (Desactivar / Eliminar) — vía portal */}
      {pendingAction && createPortal(
        <ConfirmModal
          eyebrow={ACTION_COPY[pendingAction.kind].eyebrow}
          title={ACTION_COPY[pendingAction.kind].title}
          body={ACTION_COPY[pendingAction.kind].body(pendingAction.talla)}
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
//   · MOTOR DINÁMICO (Sprint 2026-07-22 · fase 2): la Matriz de
//     Equivalencias se arma con las unidades configuradas en el TIPO
//     (tipos_producto.sistemas → códigos de sistemas_medida) y viaja en
//     `equivalencias` ({codigo_unidad: valor}) — las 16 columnas legacy
//     quedan espejadas por el backend, no se editan aquí. Tipo y
//     unidades tienen CRUD inline (＋/✎/×).
//   · Marca es SINGLE-select (FK marca_id) con CRUD inline; Familia es
//     FK por marca (familia_id) también con CRUD inline. El backend
//     sincroniza metadata.familia y marca_ids.
//   · Cero validación required: el botón "Guardar" siempre está activo.
// =====================================================================
export function TallaFormDrawer({ lang, options, initial, tallas, onClose, onSave,
                                  onReloadOptions = async () => {} }) {
  const isEdit = !!initial?.id;

  // Form state — arranca con un esquema vacío y rellena con `initial`.
  const blank = useMemo(() => ({
    id: null,
    is_active: true,
    tipo_producto: "",
    talla_base: "",
    nombre: "",
    descripcion: "",
    // Sprint 2026-07-22 · clasificadores por FK (single marca + familia)
    marca_id: null,
    familia_id: null,
    tipos: [],
    familias: [],
    // Sprint 2026-07-22 · fase 2 · matriz dinámica {codigo_unidad: valor}
    equivalencias: {},
  }), []);

  // Init de equivalencias: el objeto del backend; si viene vacío
  // (registro viejo sin backfill) se reconstruye desde las columnas
  // legacy usando las claves conocidas del catálogo.
  const rebuildLegacyEquivalencias = () => {
    const out = {};
    const keys = new Set([
      ...(options?.equivalence_fields || []),
      ...(options?.sistemas_medida || []).map(s => s.codigo),
    ]);
    keys.forEach(k => {
      const v = initial?.[k];
      if (v !== null && v !== undefined && v !== "") out[k] = String(v);
    });
    return out;
  };
  const initEquivalencias = () => {
    const eq = initial?.equivalencias;
    if (eq && typeof eq === "object" && !Array.isArray(eq) && Object.keys(eq).length > 0) {
      return { ...eq };
    }
    return rebuildLegacyEquivalencias();
  };

  // Merge inicial: marca cae al FK nuevo (o al primero del array legacy);
  // familia arranca del FK que mande el backend.
  const initForm = () => ({
    ...blank,
    ...initial,
    marca_id:   initial?.marca_id   || initial?.marca_ids?.[0] || null,
    familia_id: initial?.familia_id || null,
    equivalencias: initEquivalencias(),
  });

  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);

  // Ref para no pisar equivalencias editadas manualmente. Se inicializa
  // junto con el form en el efecto de apertura del drawer.
  const touchedEqRef = useRef(new Set());

  // Sprint 2026-07-22 · fix de race: el merge inicial corre UNA sola vez
  // por apertura del drawer. Antes, cuando `options` llegaba async (blank
  // cambiaba) el efecto reseteaba el form y borraba lo ya tecleado.
  // También se inicializa el set de equivalencias "tocadas" para no
  // sobreescribir valores ya guardados al cambiar la talla base.
  const mergedOnceRef = useRef(false);
  useEffect(() => {
    if (mergedOnceRef.current) return;
    mergedOnceRef.current = true;
    const eq = initEquivalencias();
    const init = new Set();
    Object.entries(eq || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") init.add(k);
    });
    touchedEqRef.current = init;
    setForm(initForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blank, initial]);

  // Backfill tardío (fase 2): si `options` llegó DESPUÉS del primer merge
  // y equivalencias sigue vacío (registro viejo), se reconstruye desde
  // las columnas legacy — una sola vez y sin pisar valores ya presentes.
  // Las claves reconstruidas se marcan como tocadas para que el auto-fill
  // no las borre al cambiar la talla base.
  const backfillEqRef = useRef(false);
  useEffect(() => {
    if (backfillEqRef.current || !options) return;
    if (Object.keys(form.equivalencias || {}).length > 0) { backfillEqRef.current = true; return; }
    const rebuilt = rebuildLegacyEquivalencias();
    if (Object.keys(rebuilt).length === 0) return;
    backfillEqRef.current = true;
    Object.keys(rebuilt).forEach(k => touchedEqRef.current.add(k));
    setForm(prev => (Object.keys(prev.equivalencias || {}).length > 0
      ? prev
      : { ...prev, equivalencias: rebuilt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const setEquivalencia = (k, v) => {
    touchedEqRef.current.add(k);
    setForm(prev => ({
      ...prev,
      equivalencias: { ...(prev.equivalencias || {}), [k]: v },
    }));
  };

  // ── Sprint 2026-07-22 · familias de la marca seleccionada ─────────
  // Fetch interno del drawer: al cambiar form.marca_id se traen las
  // familias de esa marca (normaliza results | array plano).
  const [familiasMarca, setFamiliasMarca] = useState([]);
  const reloadFamilias = async (marcaId) => {
    if (!marcaId) { setFamiliasMarca([]); return []; }
    try {
      const r = await sizingFamiliasApi.list({ marca_id: marcaId });
      const list = Array.isArray(r) ? r : (r?.results || []);
      setFamiliasMarca(list);
      return list;
    } catch (e) {
      setFamiliasMarca([]);
      return [];
    }
  };
  useEffect(() => { reloadFamilias(form.marca_id); }, [form.marca_id]);

  // Si el initial trae metadata.familia pero NO familia_id, al cargar las
  // familias de la marca se intenta matchear por nombre (case-insensitive)
  // y preseleccionar el FK correspondiente.
  useEffect(() => {
    if (form.familia_id || familiasMarca.length === 0) return;
    const metaFam = initial?.metadata?.familia;
    if (!metaFam) return;
    const hit = familiasMarca.find(f =>
      String(f.nombre || "").toLowerCase() === String(metaFam).toLowerCase());
    if (hit) setForm(prev => (prev.familia_id ? prev : { ...prev, familia_id: hit.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiasMarca]);

  // ── Sprint 2026-07-22 · CRUD inline de MARCA (CreateBrandDrawer) ────
  const [brandDrawer, setBrandDrawer] = useState(null); // null | { mode:'create' } | { mode:'edit', id, initial }
  const [brandBusy,   setBrandBusy]   = useState(false);

  const slugify = (s) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
             .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // UI (CreateBrandDrawer) → backend brands.marca. Mismo mapeo que
  // Brands.jsx / BrandDetail.jsx (incluye pf_correlativo).
  const brandBodyFromForm = (p) => ({
    nombre:              p.name || p.nombre,
    slug:                p.slug || slugify(p.name || p.nombre),
    pais_origen_iso2:    p.pais_origen_iso2 || p.country || "MX",
    categoria_principal: p.categoria_principal || p.categoria || "GENERAL",
    estado_comercial:    p.estado_comercial || p.status || "PROSPECTO",
    mercados_activos:    p.mercados_activos || p.territorios || [],
    tipo:                p.tipo || "TERCEROS",
    brand_code:          p.brand_id || p.brand_code || null,
    pf_correlativo:      (p.pf_correlativo != null && p.pf_correlativo !== "")
                           ? Number(p.pf_correlativo) : null,
  });

  const openEditBrand = async () => {
    if (!form.marca_id) return;
    setBrandBusy(true);
    try {
      const raw = await marcasApi.get(form.marca_id);
      setBrandDrawer({
        mode: "edit",
        id: form.marca_id,
        initial: {
          brand_id:         raw.brand_code || raw.slug || "",
          name:             raw.nombre || "",
          tipo:             raw.tipo || "PROPIA",
          issuing_entity:   raw.issuing_entity_id || raw.issuing_entity || null,
          mercados_activos: Array.isArray(raw.mercados_activos) ? raw.mercados_activos : [],
          status:           raw.estado_comercial || "ACTIVO",
          description:      raw.description || raw.descripcion || "",
          color:            raw.color || "#00B286",
          pf_correlativo:   raw.pf_correlativo ?? null,
        },
      });
    } catch (e) {
      alert((lang === "es" ? "No se pudo cargar la marca: " : "Could not load brand: ") + errDetail(e));
    } finally {
      setBrandBusy(false);
    }
  };

  const handleBrandCreated = async (p) => {
    const body = brandBodyFromForm(p);
    try {
      if (brandDrawer?.mode === "edit" && brandDrawer.id) {
        await marcasApi.update(brandDrawer.id, body);
        setBrandDrawer(null);
        await onReloadOptions();
      } else {
        const created = await marcasApi.create(body);
        setBrandDrawer(null);
        await onReloadOptions();
        // Selecciona la marca recién creada; la familia se limpia
        // (pertenecía — si acaso — a la marca anterior).
        setForm(prev => ({ ...prev, marca_id: created?.id || null, familia_id: null }));
      }
    } catch (e) {
      alert((lang === "es" ? "Error al guardar marca: " : "Error saving brand: ") + errDetail(e));
    }
  };

  const deleteBrand = async () => {
    if (!form.marca_id) return;
    const nombre = (options?.marcas || []).find(m => m.id === form.marca_id)?.nombre || "";
    const ok = window.confirm(lang === "es"
      ? `¿Eliminar la marca "${nombre}"? Es un borrado lógico: las tallas que la referencian conservan la referencia.`
      : `Delete brand "${nombre}"? This is a soft delete: sizes referencing it keep the reference.`);
    if (!ok) return;
    try {
      await marcasApi.remove(form.marca_id);
      await onReloadOptions();
      setForm(prev => ({ ...prev, marca_id: null, familia_id: null }));
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar la marca: " : "Could not delete brand: ") + errDetail(e));
    }
  };

  // ── Sprint 2026-07-22 · CRUD inline de FAMILIA (modal pequeño) ──────
  const [familiaModal, setFamiliaModal] = useState(null); // null | { mode:'create' } | { mode:'edit', familia }
  const [familiaBusy,  setFamiliaBusy]  = useState(false);

  const saveFamilia = async ({ nombre, descripcion }) => {
    if (!form.marca_id || !nombre) return;
    setFamiliaBusy(true);
    try {
      let saved = null;
      if (familiaModal?.mode === "edit" && familiaModal.familia?.id) {
        saved = await sizingFamiliasApi.update(familiaModal.familia.id,
                  { nombre, descripcion: descripcion || null });
      } else {
        saved = await sizingFamiliasApi.create(
                  { marca_id: form.marca_id, nombre, descripcion: descripcion || null });
      }
      const fid = saved?.id || familiaModal?.familia?.id || null;
      setFamiliaModal(null);
      await reloadFamilias(form.marca_id);
      if (fid) setForm(prev => ({ ...prev, familia_id: fid }));
      await onReloadOptions();
    } catch (e) {
      // 400 del backend (p.ej. duplicado) → alert con el detalle.
      alert((lang === "es" ? "No se pudo guardar el grupo: " : "Could not save group: ") + errDetail(e));
    } finally {
      setFamiliaBusy(false);
    }
  };

  const deleteFamilia = async () => {
    if (!form.familia_id) return;
    const fam = familiasMarca.find(f => f.id === form.familia_id);
    const ok = window.confirm(lang === "es"
      ? `¿Eliminar el grupo "${fam?.nombre || ""}"? Es un borrado lógico: las tallas que lo referencian conservan la referencia.`
      : `Delete group "${fam?.nombre || ""}"? This is a soft delete: sizes referencing it keep the reference.`);
    if (!ok) return;
    try {
      await sizingFamiliasApi.remove(form.familia_id);
      setForm(prev => ({ ...prev, familia_id: null }));
      await reloadFamilias(form.marca_id);
      await onReloadOptions();
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar el grupo: " : "Could not delete group: ") + errDetail(e));
    }
  };

  // ── Sprint 2026-07-22 · fase 2 · CRUD inline de TIPO DE PRODUCTO ────
  const [tipoModal, setTipoModal] = useState(null); // null | { mode:'create' } | { mode:'edit', tipo }
  const [tipoBusy,  setTipoBusy]  = useState(false);

  const saveTipo = async ({ label, talla_base_label, sistemas, matriz }) => {
    if (!label) return;
    setTipoBusy(true);
    try {
      let saved = null;
      const body = { label, talla_base_label: talla_base_label || null, sistemas };
      if (tipoModal?.mode === "edit" && tipoModal.tipo?.codigo) {
        saved = await tiposProductoCatApi.update(tipoModal.tipo.codigo, body);
      } else {
        // POST sin codigo — el backend lo genera del label.
        saved = await tiposProductoCatApi.create(body);
      }
      const cod = saved?.codigo || tipoModal?.tipo?.codigo || null;
      // Sprint 2026-07-23 · G23 · guardar matriz específica si aplica
      if (matriz && cod) {
        try {
          await tiposProductoMatrizApi.create({
            tipo_producto: cod,
            marca_id: matriz.marca_id || null,
            familia_id: matriz.familia_id || null,
            sistemas: matriz.sistemas || [],
          });
        } catch (e) {
          alert((lang === "es" ? "Tipo guardado, pero no se pudo guardar la matriz específica: " : "Type saved, but could not save specific matrix: ") + errDetail(e));
        }
      }
      setTipoModal(null);
      await onReloadOptions();
      if (cod) setForm(prev => ({ ...prev, tipo_producto: cod }));
    } catch (e) {
      alert((lang === "es" ? "No se pudo guardar el tipo: " : "Could not save type: ") + errDetail(e));
    } finally {
      setTipoBusy(false);
    }
  };

  const deleteTipo = async () => {
    if (!form.tipo_producto) return;
    const nombre = tipoActual?.label || form.tipo_producto;
    const ok = window.confirm(lang === "es"
      ? `¿Desactivar el tipo "${nombre}"? Las tallas que lo usan conservan su tipo — solo se desactiva (borrado lógico).`
      : `Deactivate type "${nombre}"? Sizes using it keep their type — it is only deactivated (soft delete).`);
    if (!ok) return;
    try {
      await tiposProductoCatApi.remove(form.tipo_producto);
      await onReloadOptions();
      // Si era el tipo del form, se limpia (ya no está disponible).
      setForm(prev => ({ ...prev, tipo_producto: "" }));
    } catch (e) {
      alert((lang === "es" ? "No se pudo eliminar el tipo: " : "Could not delete type: ") + errDetail(e));
    }
  };

  // ── Tipo seleccionado + unidades de su matriz (fase 2) ──────────
  const tipoActual = useMemo(() => {
    return (options?.tipos_producto || []).find(
      t => t.codigo === form.tipo_producto
    ) || null;
  }, [options, form.tipo_producto]);

  // Sprint 2026-07-23 · G23 · la matriz de equivalencias se resuelve con
  // fallback: (tipo + marca + familia) → (tipo + marca) → (tipo default).
  const matrizActual = useMemo(() => {
    const matrices = options?.tipos_producto_matriz || [];
    const tipo = form.tipo_producto;
    const marca = form.marca_id || null;
    const familia = form.familia_id || null;
    if (!tipo) return null;
    // Buscar más específica primero.
    let hit = matrices.find(m =>
      m.tipo_producto === tipo && m.marca_id === marca && m.familia_id === familia);
    if (!hit && marca) {
      hit = matrices.find(m =>
        m.tipo_producto === tipo && m.marca_id === marca && !m.familia_id);
    }
    if (!hit) {
      hit = matrices.find(m =>
        m.tipo_producto === tipo && !m.marca_id && !m.familia_id);
    }
    return hit || null;
  }, [options, form.tipo_producto, form.marca_id, form.familia_id]);

  // ── Sprint 2026-07-18/22/23 · auto-sugerir la Matriz de Equivalencias
  // Busca tallas previas de la MISMA combinación (tipo + marca + familia).
  // Si encuentra una con la misma talla base, copia su matriz completa.
  // Si no, aplica defaults de la matriz configurada (G23) y luego reglas de
  // fallback por tipo:
  //   · calzado: eu = BRA+2; cm = 21.97 + (BRA−32)·⅔;
  //              cr/gt/cop = BRA+1 cuando están en la matriz del tipo.
  // Nunca pisa campos que el usuario editó a mano.
  const lastSugRef = useRef({});
  useEffect(() => {
    const base = String(form.talla_base || "").trim();
    if (!base) { lastSugRef.current = {}; return; }
    const tipo = (options?.tipos_producto || []).find(t => t.codigo === form.tipo_producto) || null;
    const units = new Set((matrizActual?.sistemas || tipo?.sistemas || []));
    setForm(prev => {
      const prevSug = lastSugRef.current || {};
      const existing = (tallas || []).find(t => {
        const tBase = String(t?.equivalencias?.br ?? t?.br ?? t?.talla_base ?? "").trim();
        return tBase === base
          && String(t?.tipo_producto || "") === String(form.tipo_producto || "")
          && String(t?.marca_id || "") === String(form.marca_id || "")
          && String(t?.familia_id || "") === String(form.familia_id || "");
      });
      let sug = {};
      if (existing) {
        const src = (existing.equivalencias && typeof existing.equivalencias === "object"
                      && Object.keys(existing.equivalencias).length > 0)
          ? existing.equivalencias : null;
        if (src) {
          for (const [k, v] of Object.entries(src)) if (v != null && String(v) !== "") sug[k] = String(v);
        } else {
          for (const k of (options?.equivalence_fields || [])) {
            if (existing[k] != null && String(existing[k]) !== "") sug[k] = String(existing[k]);
          }
        }
      } else {
        // Sprint 2026-07-23 · G23 · defaults configurados en la matriz.
        const defaults = matrizActual?.defaults;
        if (defaults && typeof defaults === "object") {
          for (const [k, v] of Object.entries(defaults)) {
            if (v != null && String(v) !== "") sug[k] = String(v);
          }
        }
        if (form.tipo_producto === "calzado") {
          const baseNum = parseInt(base, 10);
          if (Number.isFinite(baseNum)) {
            if (units.has("eu") && !sug.eu)   sug.eu = String(baseNum + 2);
            if (units.has("cm") && !sug.cm)   sug.cm = (21.97 + (baseNum - 32) * (2 / 3)).toFixed(2);
            ["cr", "gt", "cop"].forEach(cod => {
              if (units.has(cod) && !sug[cod]) sug[cod] = String(baseNum + 1);
            });
          }
        }
      }
      const curEq = { ...(prev.equivalencias || {}) };
      const patch = {};
      for (const [k, v] of Object.entries(sug)) {
        if (touchedEqRef.current.has(k)) continue;
        const cur = curEq[k] ?? "";
        if (cur === "" || cur === prevSug[k]) patch[k] = v;
      }
      lastSugRef.current = sug;
      return Object.keys(patch).length
        ? { ...prev, equivalencias: { ...curEq, ...patch } }
        : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.talla_base, form.tipo_producto, form.marca_id, form.familia_id, tallas, options, matrizActual]);

  // Unidades de la matriz: usa la matriz resuelta; si no hay, fallback al
  // tipo base (comportamiento previo a G23).
  const unidadesMatriz = useMemo(() => {
    const cat = options?.sistemas_medida || [];
    const sist = matrizActual?.sistemas || tipoActual?.sistemas || [];
    return sist
      .map(cod => cat.find(s => s.codigo === cod))
      .filter(Boolean);
  }, [matrizActual, tipoActual, options]);

  // ── Submit (sin bloqueos) ──────────────────────────────────
  const submit = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      // Sprint 2026-07-22 · fase 2 · equivalencias viaja como REPLACE
      // completo; las claves con valor vacío se eliminan del objeto.
      // Las columnas legacy ya no se editan desde el drawer — el backend
      // las espeja desde `equivalencias`.
      const eq = {};
      Object.entries(form.equivalencias || {}).forEach(([k, v]) => {
        if (v !== null && v !== undefined && String(v).trim() !== "") eq[k] = String(v);
      });
      payload.equivalencias = eq;
      // Sprint 2026-07-22 · la clasificación viaja por FK: marca_id +
      // familia_id. El backend sincroniza metadata.familia (por eso aquí
      // NO se toca la clave) y marca_ids queda espejo de la marca única
      // por compat con consumidores legacy.
      payload.metadata  = { ...(initial?.metadata || {}) };
      payload.marca_id  = form.marca_id || null;
      payload.familia_id = form.familia_id || null;
      payload.marca_ids = form.marca_id ? [form.marca_id] : [];
      // `nombre` cae a la talla base si queda vacío (campo "Nombre
      // comercial" retirado del drawer).
      if (!payload.nombre) payload.nombre = payload.talla_base || null;
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
              {/* Sprint 2026-07-22 · fase 2 · tipo con CRUD inline: define
                  las unidades de la matriz y el label de la talla base. */}
              <Field label={
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {lang === "es" ? "Tipo de producto" : "Product type"}
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                    <CrudIconBtn
                      title={lang === "es" ? "Nuevo tipo de producto" : "New product type"}
                      color="#00B286"
                      onClick={() => setTipoModal({ mode: "create" })}
                    >＋</CrudIconBtn>
                    <CrudIconBtn
                      title={lang === "es" ? "Editar tipo seleccionado" : "Edit selected type"}
                      disabled={!form.tipo_producto}
                      onClick={() => setTipoModal({ mode: "edit", tipo: tipoActual })}
                    >✎</CrudIconBtn>
                    <CrudIconBtn
                      title={lang === "es" ? "Desactivar tipo seleccionado" : "Deactivate selected type"}
                      color="#DC2626"
                      disabled={!form.tipo_producto}
                      onClick={deleteTipo}
                    >×</CrudIconBtn>
                  </span>
                </span>
              }>
                <select
                  className="siz-input siz-select"
                  value={form.tipo_producto || ""}
                  onChange={e => set("tipo_producto", e.target.value)}
                >
                  <option value="">{lang === "es" ? "— Sin definir —" : "— Unset —"}</option>
                  {(options?.tipos_producto || []).map(t => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {/* Sprint 2026-07-22 · fase 2 · el label de la talla base
                  lo define el tipo (talla_base_label); fallback genérico. */}
              <Field label={tipoActual?.talla_base_label
                || (lang === "es" ? "Talla base" : "Base size")}>
                <input
                  className="siz-input mono"
                  placeholder={lang === "es" ? 'p.ej. "42", "S3", "M-WIDE"' : 'e.g. "42", "S3", "M-WIDE"'}
                  value={form.talla_base || ""}
                  onChange={e => set("talla_base", e.target.value)}
                />
              </Field>
              {/* Sprint 2026-07-22 · decisión CEO: fuera "Nombre comercial"
                  y "Descripción" del drawer (las columnas siguen en la DB;
                  nombre se auto-rellena con la talla base si queda vacío). */}
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
            </div>
          </Section>

          {/* SECCIÓN 1B · Marca (Sprint 2026-07-22 · single-select + CRUD)
              Una talla pertenece a UNA marca (FK marca_id; el backend
              mantiene marca_ids espejo). Los 3 botones junto al label
              permiten crear / editar / eliminar sin salir del drawer. */}
          <Section title={lang === "es" ? "Marca" : "Brand"}>
            <Field label={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {lang === "es" ? "Marca" : "Brand"}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                  <CrudIconBtn
                    title={lang === "es" ? "Nueva marca" : "New brand"}
                    color="#00B286"
                    onClick={() => setBrandDrawer({ mode: "create" })}
                  >＋</CrudIconBtn>
                  <CrudIconBtn
                    title={lang === "es" ? "Editar marca seleccionada" : "Edit selected brand"}
                    disabled={!form.marca_id || brandBusy}
                    onClick={openEditBrand}
                  >✎</CrudIconBtn>
                  <CrudIconBtn
                    title={lang === "es" ? "Eliminar marca seleccionada" : "Delete selected brand"}
                    color="#DC2626"
                    disabled={!form.marca_id}
                    onClick={deleteBrand}
                  >×</CrudIconBtn>
                </span>
              </span>
            }>
              <select
                className="siz-input siz-select"
                value={form.marca_id || ""}
                onChange={e => setForm(prev => ({
                  ...prev,
                  marca_id:   e.target.value || null,
                  familia_id: null,   // la familia pertenecía a la marca anterior
                }))}
              >
                <option value="">{lang === "es" ? "— Sin marca —" : "— No brand —"}</option>
                {(options?.marcas || []).map(m => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
              {(options?.marcas || []).length === 0 && (
                <span className="caption" style={{ color: "#94A3B8" }}>
                  {lang === "es" ? "Sin marcas en BD." : "No brands in DB."}
                </span>
              )}
            </Field>
          </Section>

          {/* SECCIÓN 1C · Grupo de tallas (Sprint 2026-07-22 · FK por marca + CRUD)
              Siempre visible; se habilita al elegir marca. Las opciones se
              fetchean dentro del drawer (sizingFamiliasApi por marca). */}
          <Section
            title={lang === "es" ? "Grupo de tallas" : "Size group"}
            hint={!form.marca_id
              ? (lang === "es"
                  ? "Elige una marca para ver y gestionar sus grupos de tallas."
                  : "Pick a brand to see and manage its size groups.")
              : undefined}
          >
            <Field label={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {lang === "es" ? "Grupo de tallas" : "Size group"}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                  <CrudIconBtn
                    title={lang === "es" ? "Nuevo grupo" : "New group"}
                    color="#00B286"
                    disabled={!form.marca_id}
                    onClick={() => setFamiliaModal({ mode: "create" })}
                  >＋</CrudIconBtn>
                  <CrudIconBtn
                    title={lang === "es" ? "Editar grupo seleccionado" : "Edit selected group"}
                    disabled={!form.familia_id}
                    onClick={() => setFamiliaModal({
                      mode: "edit",
                      familia: familiasMarca.find(f => f.id === form.familia_id) || null,
                    })}
                  >✎</CrudIconBtn>
                  <CrudIconBtn
                    title={lang === "es" ? "Eliminar grupo seleccionado" : "Delete selected group"}
                    color="#DC2626"
                    disabled={!form.familia_id}
                    onClick={deleteFamilia}
                  >×</CrudIconBtn>
                </span>
              </span>
            }>
              <select
                className="siz-input siz-select"
                disabled={!form.marca_id}
                value={form.familia_id || ""}
                onChange={e => set("familia_id", e.target.value || null)}
              >
                <option value="">{lang === "es" ? "— Sin grupo —" : "— No group —"}</option>
                {familiasMarca.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
                {familiasMarca.length === 0 && form.marca_id && (
                  <option disabled value="">
                    {lang === "es" ? "Sin grupos para esta marca" : "No groups for this brand"}
                  </option>
                )}
              </select>
              {form.marca_id && familiasMarca.length === 0 && (
                <span className="caption" style={{ color: "#94A3B8" }}>
                  {lang === "es"
                    ? "Esta marca aún no tiene grupos — crea el primero con ＋."
                    : "This brand has no groups yet — create the first one with ＋."}
                </span>
              )}
            </Field>
          </Section>

          {/* SECCIÓN 2 · Matriz de Equivalencias — sólo con tipo elegido.
              Fase 2: las unidades las define el TIPO (tipos_producto.
              sistemas), agrupadas visualmente por `grupo`. Los valores
              viven en form.equivalencias ({codigo_unidad: valor}). */}
          {Boolean(form.tipo_producto) && (
          <Section
            title={lang === "es" ? "Matriz de Equivalencias" : "Equivalence Matrix"}
            hint={lang === "es"
              ? `Unidades configuradas para ${tipoActual?.label || "este tipo"} (${unidadesMatriz.length}). Todas opcionales.`
              : `Units configured for ${tipoActual?.label || "this type"} (${unidadesMatriz.length}). All optional.`}
          >
            {unidadesMatriz.length === 0 ? (
              <div className="caption" style={{ color: "#94A3B8" }}>
                {lang === "es"
                  ? "Este tipo no tiene unidades configuradas — edítalo con ✎ para armar su matriz."
                  : "This type has no units configured — edit it with ✎ to build its matrix."}
              </div>
            ) : (
              Object.entries(
                unidadesMatriz.reduce((acc, u) => {
                  const g = u.grupo || "—";
                  (acc[g] ||= []).push(u);
                  return acc;
                }, {})
              ).map(([grupo, units]) => (
                <div key={grupo}>
                  <div className="micro" style={{ color: "#94A3B8", margin: "10px 0 6px" }}>
                    {grupo}
                  </div>
                  <div className="siz-grid-equiv">
                    {units.map(sis => (
                      <Field key={sis.codigo} label={sis.label} hint={sis.region}>
                        <input
                          className="siz-input tabular"
                          placeholder={String(sis.grupo || "").toLowerCase() === "alfa" ? "S / M / L" : "—"}
                          value={(form.equivalencias || {})[sis.codigo] || ""}
                          onChange={e => setEquivalencia(sis.codigo, e.target.value)}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              ))
            )}
          </Section>
          )}
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

      {/* CRUD de marca — CreateBrandDrawer por ENCIMA de este drawer
          (wrapper fixed con z-index mayor: .siz-drawer = 91). */}
      {brandDrawer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95 }}>
          <CreateBrandDrawer
            lang={lang}
            initial={brandDrawer.mode === "edit" ? brandDrawer.initial : null}
            onClose={() => setBrandDrawer(null)}
            onCreated={handleBrandCreated}
          />
        </div>
      )}

      {/* CRUD de familia — modal pequeño inline (nombre + descripción). */}
      {familiaModal && createPortal(
        <FamiliaQuickModal
          lang={lang}
          mode={familiaModal.mode}
          familia={familiaModal.familia}
          busy={familiaBusy}
          onClose={() => setFamiliaModal(null)}
          onSave={saveFamilia}
        />,
        document.body
      )}

      {/* CRUD de tipo de producto — modal con multi-select de unidades
          y alta inline de unidad nueva (fase 2). */}
      {tipoModal && createPortal(
        <TipoQuickModal
          lang={lang}
          mode={tipoModal.mode}
          tipo={tipoModal.tipo}
          sistemasCat={options?.sistemas_medida || []}
          options={options}
          marcaId={form.marca_id}
          familiaId={form.familia_id}
          busy={tipoBusy}
          onClose={() => setTipoModal(null)}
          onSave={saveTipo}
          onReloadOptions={onReloadOptions}
        />,
        document.body
      )}
    </>
  );
}


// Detalle de error legible: DRF 400 puede traer {detail} o {campo: [msgs]}.
function errDetail(e) {
  const b = e?.body;
  if (b && typeof b === "object") {
    if (b.detail) return String(b.detail);
    try {
      const msg = Object.entries(b)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("  ·  ");
      if (msg) return msg;
    } catch (_) { /* cae al message */ }
  }
  return e?.message || String(e);
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

// Botón icono del patrón ＋/✎/× (mismo estilo que los CRUD inline de
// atributos técnicos en ProductFormView).
function CrudIconBtn({ title, onClick, disabled = false, color = "#475569", children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 20, height: 20, borderRadius: 5, padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        border: "1px solid #E2E8F0", background: "#FFFFFF",
        color: disabled ? "#CBD5E1" : color,
        fontWeight: 800, fontSize: 12, lineHeight: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

// =====================================================================
// Modal rápido de GRUPO DE TALLAS (crear / editar) — nombre requerido,
// descripción opcional. Lo abre el drawer de talla (CRUD inline).
// =====================================================================
export function FamiliaQuickModal({ lang, mode, familia, busy, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [nombre,      setNombre]      = useState(familia?.nombre || "");
  const [descripcion, setDescripcion] = useState(familia?.descripcion || "");
  const canSave = nombre.trim().length > 0 && !busy;
  const run = () => { if (canSave) onSave({ nombre: nombre.trim(), descripcion: descripcion.trim() }); };
  return (
    <>
      <div className="siz-drawer-backdrop" style={{ zIndex: 1000 }} onClick={() => !busy && onClose()}/>
      <div role="dialog" aria-modal="true"
           style={{
             position: "fixed", top: "50%", left: "50%",
             transform: "translate(-50%, -50%)", zIndex: 1001,
             width: "min(420px, 92vw)", background: "#FFFFFF",
             borderRadius: 14, padding: 22,
             boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
           }}>
        <div className="micro" style={{ color: MINT }}>
          {isEdit ? (lang === "es" ? "EDITAR GRUPO" : "EDIT GROUP")
                  : (lang === "es" ? "NUEVO GRUPO"  : "NEW GROUP")}
        </div>
        <div className="heading-md" style={{ margin: "2px 0 12px", color: NAVY }}>
          {isEdit ? (familia?.nombre || "—")
                  : (lang === "es" ? "Crear grupo de tallas" : "Create size group")}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="siz-field">
            <span className="siz-field-label">{lang === "es" ? "Nombre *" : "Name *"}</span>
            <input className="siz-input" autoFocus value={nombre} disabled={busy}
                   onChange={e => setNombre(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); run(); } }}/>
          </label>
          <label className="siz-field">
            <span className="siz-field-label">
              {lang === "es" ? "Descripción (opcional)" : "Description (optional)"}
            </span>
            <input className="siz-input" value={descripcion} disabled={busy}
                   onChange={e => setDescripcion(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); run(); } }}/>
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="siz-btn siz-btn-ghost" onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button className="siz-btn siz-btn-primary" onClick={run} disabled={!canSave}>
            {busy ? (lang === "es" ? "Guardando…" : "Saving…")
                  : (lang === "es" ? "Guardar" : "Save")}
          </button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Modal de TIPO DE PRODUCTO (Sprint 2026-07-22 · fase 2/3 · motor dinámico)
//   · create: label requerido; el `codigo` lo genera el backend.
//   · edit:   llega el objeto tipo completo (con codigo).
//   · sistemas: multi-select de unidades del catálogo (chips con scroll,
//     agrupadas por `grupo`) + alta inline de unidad nueva — mini-form
//     label + grupo (select de grupos existentes o texto libre); el
//     codigo de la unidad también lo auto-genera el backend.
//   · Sprint 2026-07-23 · G23: en modo create permite guardar una
//     configuración específica de matriz para (marca + grupo de tallas).
// =====================================================================
export function TipoQuickModal({
  lang, mode, tipo, sistemasCat, options, marcaId, familiaId, busy, onClose, onSave, onReloadOptions,
}) {
  const isEdit = mode === "edit";
  const [label,          setLabel]          = useState(tipo?.label || "");
  const [tallaBaseLabel, setTallaBaseLabel] = useState(tipo?.talla_base_label || "");
  const [sel,            setSel]            = useState(() =>
    Array.isArray(tipo?.sistemas) ? [...tipo.sistemas] : []);
  // Sprint 2026-07-23 · G23 · configuración específica por marca/grupo
  const [matrizEspecifica, setMatrizEspecifica] = useState(false);
  const [marcaSel,         setMarcaSel]         = useState(marcaId || "");
  const [familiaSel,       setFamiliaSel]       = useState(familiaId || "");
  const [familiasMarca,    setFamiliasMarca]    = useState([]);
  // Alta inline de unidad (codigo auto).
  const [addingUnit,  setAddingUnit]  = useState(false);
  const [unitLabel,   setUnitLabel]   = useState("");
  const [unitGrupo,   setUnitGrupo]   = useState("");
  const [unitGrupoNew, setUnitGrupoNew] = useState("");
  const [unitBusy,    setUnitBusy]    = useState(false);

  const canSave = label.trim().length > 0 && !busy &&
    (!matrizEspecifica || (marcaSel && familiaSel));

  // Cargar familias de la marca seleccionada en el modal.
  useEffect(() => {
    let cancelled = false;
    if (!marcaSel) { setFamiliasMarca([]); return; }
    sizingFamiliasApi.list({ marca_id: marcaSel })
      .then(r => { if (!cancelled) setFamiliasMarca(Array.isArray(r) ? r : (r?.results || [])); })
      .catch(() => { if (!cancelled) setFamiliasMarca([]); });
    return () => { cancelled = true; };
  }, [marcaSel]);

  // Sprint 2026-07-23 · G23 · si al abrir el modal en modo CREATE ya hay
  // una matriz para la marca+grupo pre-seleccionados, autocheck y cargar
  // sus unidades. En modo EDIT se edita el tipo de producto global, no la
  // matriz específica, así que NO se toca `sel`.
  const lastMatrizKeyRef = useRef(null);
  useEffect(() => {
    if (isEdit || !marcaId || !familiaId) return;
    const matrices = options?.tipos_producto_matriz || [];
    const match = matrices.find(m => {
      const sameMarca = String(m.marca_id) === String(marcaId);
      const sameFamilia = String(m.familia_id) === String(familiaId);
      return sameMarca && sameFamilia;
    });
    if (match) {
      const key = `*|${marcaId}|${familiaId}`;
      if (lastMatrizKeyRef.current === key) return;
      setMatrizEspecifica(true);
      setMarcaSel(marcaId);
      setFamiliaSel(familiaId);
      setSel(Array.isArray(match.sistemas) ? [...match.sistemas] : []);
      lastMatrizKeyRef.current = key;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // G23 · cuando el usuario cambia marca/grupo dentro del modal, cargar la
  // matriz existente (si hay) para no perder la configuración previa.
  useEffect(() => {
    if (!matrizEspecifica || !marcaSel || !familiaSel) return;
    const matrices = options?.tipos_producto_matriz || [];
    const match = matrices.find(m => {
      const sameMarca = String(m.marca_id) === String(marcaSel);
      const sameFamilia = String(m.familia_id) === String(familiaSel);
      const sameTipo = isEdit ? String(m.tipo_producto) === String(tipo?.codigo) : true;
      return sameMarca && sameFamilia && sameTipo;
    });
    if (match) {
      const key = `${isEdit ? tipo?.codigo : '*'}|${marcaSel}|${familiaSel}`;
      if (lastMatrizKeyRef.current === key) return;
      setSel(Array.isArray(match.sistemas) ? [...match.sistemas] : []);
      lastMatrizKeyRef.current = key;
    }
  }, [matrizEspecifica, marcaSel, familiaSel, tipo, options, isEdit]);

  // Unidades agrupadas por `grupo` para el multi-select con scroll.
  const grupos = useMemo(() => {
    const g = {};
    (sistemasCat || []).forEach(s => {
      const k = s.grupo || "—";
      (g[k] ||= []).push(s);
    });
    return g;   // { EU: [...], US: [...], DIMENSIONAL: [...], ... }
  }, [sistemasCat]);
  const gruposExistentes = useMemo(() => Object.keys(grupos), [grupos]);

  const toggleUnit = (cod) => setSel(prev =>
    prev.includes(cod) ? prev.filter(x => x !== cod) : [...prev, cod]);

  const createUnidad = async () => {
    const lbl = unitLabel.trim();
    const grp = (unitGrupo === "__new__" ? unitGrupoNew : unitGrupo).trim();
    if (!lbl || !grp) return;
    setUnitBusy(true);
    try {
      // POST sin codigo — el backend hace auto-slug y lo devuelve.
      const saved = await sistemasMedidaCatApi.create({ label: lbl, grupo: grp });
      await onReloadOptions?.();
      if (saved?.codigo) {
        setSel(prev => (prev.includes(saved.codigo) ? prev : [...prev, saved.codigo]));
      }
      setAddingUnit(false);
      setUnitLabel("");
      setUnitGrupoNew("");
    } catch (e) {
      alert((lang === "es" ? "No se pudo crear la unidad: " : "Could not create unit: ") + errDetail(e));
    } finally {
      setUnitBusy(false);
    }
  };

  const run = () => {
    if (!canSave) return;
    onSave({
      label: label.trim(),
      talla_base_label: tallaBaseLabel.trim(),
      sistemas: sel,
      matriz: matrizEspecifica && !isEdit ? {
        marca_id: marcaSel || null,
        familia_id: familiaSel || null,
        sistemas: sel,
      } : null,
    });
  };

  return (
    <>
      <div className="siz-drawer-backdrop" style={{ zIndex: 1000 }} onClick={() => !busy && onClose()}/>
      <div role="dialog" aria-modal="true"
           style={{
             position: "fixed", top: "50%", left: "50%",
             transform: "translate(-50%, -50%)", zIndex: 1001,
             width: "min(520px, 94vw)", maxHeight: "88vh", overflowY: "auto",
             background: "#FFFFFF", borderRadius: 14, padding: 22,
             boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
           }}>
        <div className="micro" style={{ color: MINT }}>
          {isEdit ? (lang === "es" ? "EDITAR TIPO DE PRODUCTO" : "EDIT PRODUCT TYPE")
                  : (lang === "es" ? "NUEVO TIPO DE PRODUCTO"  : "NEW PRODUCT TYPE")}
        </div>
        <div className="heading-md" style={{ margin: "2px 0 12px", color: NAVY }}>
          {isEdit ? (tipo?.label || "—")
                  : (lang === "es" ? "Crear tipo de producto" : "Create product type")}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="siz-field">
            <span className="siz-field-label">{lang === "es" ? "Label *" : "Label *"}</span>
            <input className="siz-input" autoFocus value={label} disabled={busy}
                   placeholder={lang === "es" ? 'p.ej. "Calzado", "Camisa"' : 'e.g. "Footwear", "Shirt"'}
                   onChange={e => setLabel(e.target.value)}/>
            {isEdit && (
              <span className="siz-field-hint">
                {lang === "es" ? `código: ${tipo?.codigo}` : `code: ${tipo?.codigo}`}
              </span>
            )}
          </label>
          <label className="siz-field">
            <span className="siz-field-label">
              {lang === "es" ? "Label de la talla base (opcional)" : "Base size label (optional)"}
            </span>
            <input className="siz-input" value={tallaBaseLabel} disabled={busy}
                   placeholder={lang === "es" ? "Talla base" : "Base size"}
                   onChange={e => setTallaBaseLabel(e.target.value)}/>
          </label>

          {/* Sprint 2026-07-23 · G23 · matriz específica por marca/grupo */}
          {!isEdit && (
            <div className="siz-field">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={matrizEspecifica}
                  onChange={e => setMatrizEspecifica(e.target.checked)}
                  disabled={busy}
                />
                <span className="siz-field-label">
                  {lang === "es" ? "Configuración específica para marca + grupo de tallas" : "Specific setup for brand + size group"}
                </span>
              </label>
              {matrizEspecifica && (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <select
                    className="siz-input siz-select"
                    value={marcaSel || ""}
                    onChange={e => { setMarcaSel(e.target.value || ""); setFamiliaSel(""); }}
                    disabled={busy}
                  >
                    <option value="">{lang === "es" ? "— Marca —" : "— Brand —"}</option>
                    {(options?.marcas || []).map(m => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>
                  <select
                    className="siz-input siz-select"
                    value={familiaSel || ""}
                    onChange={e => setFamiliaSel(e.target.value || "")}
                    disabled={busy || !marcaSel}
                  >
                    <option value="">{lang === "es" ? "— Grupo de tallas —" : "— Size group —"}</option>
                    {familiasMarca.map(f => (
                      <option key={f.id} value={f.id}>{f.nombre}</option>
                    ))}
                    {marcaSel && familiasMarca.length === 0 && (
                      <option disabled value="">{lang === "es" ? "Sin grupos" : "No groups"}</option>
                    )}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Multi-select de unidades (chips con scroll, por grupo) */}
          <div className="siz-field">
            <span className="siz-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {lang === "es" ? "Unidades de la matriz" : "Matrix units"}
              <span style={{ color: "#94A3B8", fontWeight: 400 }}>
                ({sel.length} {lang === "es" ? "seleccionadas" : "selected"})
              </span>
              <span style={{ marginLeft: "auto" }}>
                <CrudIconBtn
                  title={lang === "es" ? "Nueva unidad" : "New unit"}
                  color="#00B286"
                  onClick={() => setAddingUnit(a => !a)}
                >{addingUnit ? "×" : "＋"}</CrudIconBtn>
              </span>
            </span>

            {addingUnit && (
              <div style={{
                display: "grid", gap: 6, padding: 10, margin: "6px 0",
                border: "1px dashed #CBD5E1", borderRadius: 8,
                background: "rgba(0,178,134,0.04)",
              }}>
                <input className="siz-input" autoFocus value={unitLabel} disabled={unitBusy}
                       placeholder={lang === "es" ? 'Label de la unidad (p.ej. "Pecho (cm)")' : 'Unit label (e.g. "Chest (cm)")'}
                       onChange={e => setUnitLabel(e.target.value)}/>
                <select className="siz-input siz-select" value={unitGrupo} disabled={unitBusy}
                        onChange={e => setUnitGrupo(e.target.value)}>
                  <option value="">{lang === "es" ? "— Grupo —" : "— Group —"}</option>
                  {gruposExistentes.map(g => <option key={g} value={g}>{g}</option>)}
                  <option value="__new__">{lang === "es" ? "＋ Nuevo grupo…" : "＋ New group…"}</option>
                </select>
                {unitGrupo === "__new__" && (
                  <input className="siz-input mono" value={unitGrupoNew} disabled={unitBusy}
                         placeholder={lang === "es" ? 'p.ej. "CORPORAL"' : 'e.g. "BODY"'}
                         onChange={e => setUnitGrupoNew(e.target.value.toUpperCase())}/>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                  <button type="button" className="siz-btn siz-btn-ghost"
                          onClick={() => { setAddingUnit(false); setUnitLabel(""); setUnitGrupoNew(""); }}
                          disabled={unitBusy}>
                    {lang === "es" ? "Cancelar" : "Cancel"}
                  </button>
                  <button type="button" className="siz-btn siz-btn-primary" onClick={createUnidad}
                          disabled={unitBusy || !unitLabel.trim() ||
                                    !(unitGrupo === "__new__" ? unitGrupoNew.trim() : unitGrupo)}>
                    {unitBusy ? (lang === "es" ? "Creando…" : "Creating…")
                              : (lang === "es" ? "Crear unidad" : "Create unit")}
                  </button>
                </div>
              </div>
            )}

            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6, paddingRight: 2 }}>
              {gruposExistentes.length === 0 && (
                <span className="caption" style={{ color: "#94A3B8" }}>
                  {lang === "es" ? "Sin unidades en el catálogo." : "No units in catalog."}
                </span>
              )}
              {Object.entries(grupos).map(([grupo, units]) => (
                <div key={grupo} style={{ marginBottom: 8 }}>
                  <div className="micro" style={{ color: "#94A3B8", margin: "6px 0 4px" }}>{grupo}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {units.map(u => {
                      const on = sel.includes(u.codigo);
                      return (
                        <button type="button" key={u.codigo} onClick={() => toggleUnit(u.codigo)}
                                disabled={busy}
                                style={{
                                  borderRadius: 999, padding: "4px 11px", cursor: "pointer",
                                  fontSize: 12, fontWeight: 600, lineHeight: 1.3,
                                  border: `1px solid ${on ? "rgba(0,178,134,0.45)" : "#E2E8F0"}`,
                                  background: on ? "rgba(0,178,134,0.12)" : "#FFFFFF",
                                  color: on ? "#008B69" : "#475569",
                                  transition: "all 120ms ease",
                                }}>
                          {on ? "✓ " : ""}{u.label || u.codigo}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="siz-btn siz-btn-ghost" onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button className="siz-btn siz-btn-primary" onClick={run} disabled={!canSave}>
            {busy ? (lang === "es" ? "Guardando…" : "Saving…")
                  : (lang === "es" ? "Guardar" : "Save")}
          </button>
        </div>
      </div>
    </>
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
