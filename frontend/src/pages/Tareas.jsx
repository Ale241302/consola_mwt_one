// ─────────────────────────────────────────────────────────────────────
// Tareas.jsx — Etapa 2 · Catálogo + agenda de tareas + mesa de trabajo.
//
//   Mesa de trabajo  → tareas abiertas de todos los expedientes con su
//                      contexto (proforma/SAP/cliente/OC) y acciones.
//   Catálogo         → plantillas reutilizables (admin/CEO).
//
// Reglas de negocio (GET /api/tareas/mesa/ y generador diario):
//   · Solicitar fecha de producción .... 15 días hábiles tras el registro.
//   · Reconfirmar producción ........... 10 días hábiles antes de la fecha.
//   · Seguimiento sin respuesta ........ 3 días hábiles tras el envío.
//   Días hábiles = lunes a viernes (sin feriados).
// ─────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tareasApi } from "../lib/api.js";
import { usePagination, TablePagination } from "../components/ui/TablePagination.jsx";
import { useRole } from "../context/RoleContext.jsx";

const ESTADOS = ["PENDIENTE", "BORRADOR_LISTO", "ESPERANDO_RESPUESTA",
                 "REQUIERE_REVISION", "RESUELTA", "CANCELADA"];
const TIPOS = ["PRODUCCION", "DOCUMENTO", "LOGISTICA", "SEGUIMIENTO", "OPERATIVO"];

const ESTADO_STYLE = {
  PENDIENTE:          { bg: "rgba(148,163,184,0.18)", color: "#475569" },
  BORRADOR_LISTO:     { bg: "rgba(48,131,254,0.14)",  color: "#1D4ED8" },
  ESPERANDO_RESPUESTA:{ bg: "rgba(180,83,9,0.16)",    color: "#92400E" },
  REQUIERE_REVISION:  { bg: "rgba(124,58,237,0.16)",  color: "#6D28D9" },
  RESUELTA:           { bg: "rgba(0,178,134,0.18)",   color: "#00734F" },
  CANCELADA:          { bg: "rgba(100,116,139,0.16)", color: "#475569" },
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const s = String(iso).slice(0, 10);
    return new Date(s + "T00:00:00").toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}
function dueTone(due, estado) {
  if (!due || estado === "RESUELTA" || estado === "CANCELADA") return {};
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return { color: "#B91C1C", fontWeight: 700 };
  if (due === today) return { color: "#B45309", fontWeight: 700 };
  return {};
}

function EstadoBadge({ estado }) {
  const s = ESTADO_STYLE[estado] || ESTADO_STYLE.PENDIENTE;
  return (
    <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6,
                   fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                   background: s.bg, color: s.color }}>
      {estado.replace("_", " ")}
    </span>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border-subtle, #E2E8F0)",
                  borderRadius: 12, padding: "14px 18px", flex: "1 1 140px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
                    color: "var(--text-tertiary, #94A3B8)" }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 24, fontWeight: 800, color: tone || "var(--brand-primary, #013A57)" }}>
        {value}
      </div>
    </div>
  );
}

// ── Modal crear tarea ──────────────────────────────────────────────
function TareaModal({ lang, catalogo, onClose, onSaved }) {
  const es = lang === "es";
  const [form, setForm] = useState({
    catalogo_codigo: "", titulo: "", descripcion: "",
    tipo: "OPERATIVO", prioridad: "MEDIA", due_date: "", expediente_id: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const onPickCatalogo = (codigo) => {
    const cat = catalogo.find((c) => c.codigo === codigo);
    setForm((f) => ({
      ...f, catalogo_codigo: codigo,
      titulo: cat ? cat.nombre : f.titulo,
      descripcion: cat ? (cat.descripcion || "") : f.descripcion,
      tipo: cat ? cat.tipo : f.tipo,
    }));
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = { ...form };
      if (!body.catalogo_codigo) delete body.catalogo_codigo;
      if (!body.expediente_id) delete body.expediente_id;
      if (!body.due_date) delete body.due_date;
      if (!body.titulo) { setError(es ? "El título es obligatorio." : "Title is required."); setSaving(false); return; }
      await tareasApi.create(body);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error");
    } finally { setSaving(false); }
  };

  const inp = { padding: "7px 10px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
                fontSize: 13, width: "100%", background: "var(--surface, #fff)" };
  const lbl = { fontSize: 11, fontWeight: 700, color: "var(--text-tertiary, #94A3B8)",
                textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "var(--surface, #fff)", borderRadius: 12, width: 560, maxWidth: "100%",
                    maxHeight: "90vh", overflow: "auto", padding: 22 }}>
        <h3 style={{ margin: "0 0 14px", color: "var(--brand-primary, #013A57)" }}>
          {es ? "Nueva tarea" : "New task"}
        </h3>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={lbl}>{es ? "Plantilla" : "Template"}</label>
            <select style={inp} value={form.catalogo_codigo} onChange={(e) => onPickCatalogo(e.target.value)}>
              <option value="">{es ? "Libre / manual" : "Free / manual"}</option>
              {catalogo.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>{es ? "Título" : "Title"}</label>
            <input style={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl}>{es ? "Tipo" : "Type"}</label>
              <select style={inp} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>{es ? "Prioridad" : "Priority"}</label>
              <select style={inp} value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })}>
                <option value="ALTA">ALTA</option><option value="MEDIA">MEDIA</option><option value="BAJA">BAJA</option>
              </select>
            </div>
            <div>
              <label style={lbl}>{es ? "Vence" : "Due"}</label>
              <input type="date" style={inp} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={lbl}>{es ? "Expediente (UUID, opcional)" : "File (UUID, optional)"}</label>
            <input style={inp} value={form.expediente_id} placeholder="00000000-0000-0000-0000-000000000000"
                   onChange={(e) => setForm({ ...form, expediente_id: e.target.value })} />
          </div>
          <div>
            <label style={lbl}>{es ? "Descripción" : "Description"}</label>
            <textarea style={{ ...inp, minHeight: 70 }} value={form.descripcion}
                      onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>
        </div>
        {error && <div style={{ marginTop: 12, color: "#B91C1C", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "…" : (es ? "Crear tarea" : "Create task")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Tareas() {
  const { lang = "es" } = useOutletContext() || {};
  const es = lang === "es";
  const navigate = useNavigate();
  const { isAdmin } = useRole();

  const [view, setView] = useState("mesa");        // mesa | catalogo
  const [mesa, setMesa] = useState({ kpis: {}, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [catalogo, setCatalogo] = useState([]);

  // filtros
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");

  const loadMesa = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (q) params.q = q;
      if (fEstado) params.estado = fEstado;
      if (fTipo) params.tipo = fTipo;
      const d = await tareasApi.mesa(params);
      setMesa({ kpis: d?.kpis || {}, items: Array.isArray(d?.items) ? d.items : [] });
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error");
    } finally { setLoading(false); }
  }, [q, fEstado, fTipo]);

  useEffect(() => { loadMesa(); }, [loadMesa]);
  useEffect(() => { tareasApi.catalogo.list().then((d) => setCatalogo(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const {
    pageItems, page, setPage, perPage, setPerPage, totalPages, total,
  } = usePagination(mesa.items, { defaultPerPage: 20 });
  useEffect(() => { setPage(1); }, [q, fEstado, fTipo, setPage]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const act = async (fn, ok) => {
    try { await fn(); flash(ok); await loadMesa(); }
    catch (e) { flash(e?.body?.detail || e?.message || "Error"); }
  };

  const reprogramar = (t) => {
    const today = new Date().toISOString().slice(0, 10);
    const val = window.prompt(es ? "Nueva fecha (YYYY-MM-DD):" : "New due date (YYYY-MM-DD):", t.due_date || today);
    if (!val) return;
    act(() => tareasApi.reprogramar(t.id, { due_date: val }), es ? "Reprogramada" : "Rescheduled");
  };

  const generar = async () => {
    try { const r = await tareasApi.generar({}); flash((es ? "Generadas: " : "Generated: ") + (r?.creadas ?? 0)); await loadMesa(); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };

  const k = mesa.kpis || {};

  const selStyle = { padding: "6px 10px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
                     fontSize: 12, fontWeight: 600, background: "var(--surface, #fff)" };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>OPERACIÓN · TAREAS</div>
          <h1 className="page-title">{es ? "Mesa de trabajo" : "Workbench"}</h1>
          <div className="page-subtitle">
            {es ? "Catálogo, agenda por expediente y pendientes de todos los expedientes."
                : "Catalog, per-file agenda and pending items across files."}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <div className="seg">
            <button data-active={view === "mesa"} onClick={() => setView("mesa")}>{es ? "Mesa" : "Workbench"}</button>
            <button data-active={view === "catalogo"} onClick={() => setView("catalogo")}>{es ? "Catálogo" : "Catalog"}</button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            + {es ? "Nueva tarea" : "New task"}
          </button>
          {isAdmin && (
            <button className="btn btn-ghost" onClick={generar} title={es ? "Regenerar tareas automáticas" : "Regenerate auto tasks"}>
              {es ? "Generar" : "Generate"}
            </button>
          )}
        </div>
      </div>

      {view === "mesa" && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
            <Kpi label={es ? "Vencidas" : "Overdue"} value={k.vencidas || 0} tone="#B91C1C" />
            <Kpi label={es ? "Hoy" : "Today"} value={k.hoy || 0} tone="#B45309" />
            <Kpi label={es ? "Próximas" : "Upcoming"} value={k.proximas || 0} />
            <Kpi label={es ? "Sin fecha" : "No date"} value={k.sin_fecha || 0} />
            <Kpi label={es ? "Esperando respuesta" : "Awaiting reply"} value={k.esperando || 0} tone="#B45309" />
            <Kpi label={es ? "Requiere revisión" : "Needs review"} value={k.revision || 0} tone="#6D28D9" />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder={es ? "Buscar tarea…" : "Search task…"}
                   style={{ ...selStyle, fontWeight: 400, minWidth: 240 }} />
            <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={selStyle}>
              <option value="">{es ? "Estado: todos" : "Status: all"}</option>
              {ESTADOS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={selStyle}>
              <option value="">{es ? "Tipo: todos" : "Type: all"}</option>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary, #94A3B8)", alignSelf: "center" }}>
              {mesa.items.length} {es ? "tareas" : "tasks"}
            </span>
          </div>

          <div className="table-scroll" style={{ background: "var(--surface, #fff)",
                                                 border: "1px solid var(--border-subtle, #E2E8F0)", borderRadius: 12 }}>
            <table className="table-sticky" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-alt, #F1F5F9)", borderBottom: "2px solid var(--border, #CBD5E1)" }}>
                  <Th>{es ? "Vence" : "Due"}</Th>
                  <Th>{es ? "Tarea" : "Task"}</Th>
                  <Th>{es ? "Tipo" : "Type"}</Th>
                  <Th>{es ? "Expediente" : "File"}</Th>
                  <Th>{es ? "Estado" : "Status"}</Th>
                  <Th right>{es ? "Acciones" : "Actions"}</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>
                    {es ? "Cargando tareas…" : "Loading tasks…"}
                  </td></tr>
                )}
                {!loading && error && (
                  <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#B91C1C" }}>{error}</td></tr>
                )}
                {!loading && !error && pageItems.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "var(--text-tertiary, #94A3B8)" }}>
                    {es ? "No hay tareas con estos filtros." : "No tasks match these filters."}
                  </td></tr>
                )}
                {pageItems.map((t, i) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle, #F1F5F9)",
                                          background: i % 2 === 1 ? "rgba(241,245,249,0.4)" : "transparent" }}>
                    <Td>
                      <span className="tabular-nums" style={dueTone(t.due_date, t.estado)}>
                        {fmtDate(t.due_date)}{t.is_override ? " *" : ""}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600, color: "var(--text-primary, #0F172A)" }}>{t.titulo}</div>
                      <div style={{ fontSize: 10, color: "var(--text-tertiary, #94A3B8)", marginTop: 2 }}>
                        {t.catalogo_codigo || "MANUAL"}{t.origen === "AUTO" ? " · automática" : ""}
                      </div>
                    </Td>
                    <Td>{t.tipo}</Td>
                    <Td>
                      {t.proforma || t.expediente_codigo ? (
                        <button type="button" onClick={() => t.expediente_id && navigate(`/expedientes/${t.expediente_id}`)}
                                style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0,
                                         fontWeight: 600, color: "var(--interactive, #0369A1)", fontFamily: "monospace" }}>
                          {t.proforma || t.expediente_codigo}
                        </button>
                      ) : <span style={{ color: "var(--text-tertiary, #94A3B8)" }}>—</span>}
                      <div style={{ fontSize: 10, color: "var(--text-tertiary, #94A3B8)", marginTop: 2 }}>
                        {t.cliente || "—"}{t.sap ? ` · SAP ${t.sap}` : ""}
                      </div>
                    </Td>
                    <Td><EstadoBadge estado={t.estado} /></Td>
                    <Td right>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {t.estado !== "ESPERANDO_RESPUESTA" && (
                          <button className="btn btn-sm" onClick={() => act(() => tareasApi.enviar(t.id), es ? "Marcada enviada" : "Sent")}>
                            {es ? "Enviar" : "Send"}
                          </button>
                        )}
                        {t.estado === "ESPERANDO_RESPUESTA" && (
                          <button className="btn btn-sm" onClick={() => act(() => tareasApi.responder(t.id), es ? "Respuesta registrada" : "Reply logged")}>
                            {es ? "Respondió" : "Replied"}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={() => reprogramar(t)}>{es ? "Reprog." : "Resch."}</button>
                        <button className="btn btn-sm" onClick={() => act(() => tareasApi.completar(t.id), es ? "Resuelta" : "Done")}>
                          {es ? "Completar" : "Complete"}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => act(() => tareasApi.cancelar(t.id, {}), es ? "Cancelada" : "Cancelled")}>
                          {es ? "Cancelar" : "Cancel"}
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePagination page={page} totalPages={totalPages} perPage={perPage}
                           setPerPage={setPerPage} setPage={setPage} total={total} lang={lang} />
        </>
      )}

      {view === "catalogo" && (
        <CatalogoPanel lang={lang} catalogo={catalogo} isAdmin={isAdmin}
                       reload={() => tareasApi.catalogo.list().then((d) => setCatalogo(Array.isArray(d) ? d : []))} />
      )}

      {showNew && (
        <TareaModal lang={lang} catalogo={catalogo}
                    onClose={() => setShowNew(false)}
                    onSaved={() => flash(es ? "Tarea creada" : "Task created")} />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1200, background: "#0F172A", color: "#fff",
                      padding: "10px 16px", borderRadius: 8, fontSize: 13 }}>{toast}</div>
      )}
    </div>
  );
}

function CatalogoPanel({ lang, catalogo, isAdmin, reload }) {
  const es = lang === "es";
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const codigo = window.prompt(es ? "Código de la plantilla:" : "Template code:");
    if (!codigo) return;
    const nombre = window.prompt(es ? "Nombre:" : "Name:");
    if (!nombre) return;
    setBusy(true);
    try { await tareasApi.catalogo.create({ codigo, nombre, tipo: "OPERATIVO" }); await reload(); }
    catch (e) { window.alert(e?.body?.detail || "Error"); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!window.confirm(es ? "¿Desactivar plantilla?" : "Deactivate template?")) return;
    try { await tareasApi.catalogo.remove(id); await reload(); } catch (e) { window.alert(e?.body?.detail || "Error"); }
  };
  return (
    <div className="card card-pad-lg" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="heading-sm">{es ? "Catálogo de tareas" : "Task catalog"}</div>
        {isAdmin && <button className="btn btn-sm" disabled={busy} onClick={create}>+ {es ? "Nueva plantilla" : "New template"}</button>}
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <Th>{es ? "Código" : "Code"}</Th><Th>{es ? "Nombre" : "Name"}</Th>
            <Th>{es ? "Tipo" : "Type"}</Th><Th>{es ? "Regla" : "Rule"}</Th><Th right>{es ? "Acciones" : "Actions"}</Th>
          </tr>
        </thead>
        <tbody>
          {catalogo.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid var(--border-subtle, #F1F5F9)" }}>
              <Td mono>{c.codigo}</Td>
              <Td>{c.nombre}</Td>
              <Td>{c.tipo}</Td>
              <Td>{c.offset_dias_habiles != null
                    ? `${c.offset_dias_habiles > 0 ? "+" : ""}${c.offset_dias_habiles} d.h. · ${c.offset_ref || "—"}`
                    : "—"}</Td>
              <Td right>{isAdmin && <button className="btn btn-sm btn-ghost" onClick={() => remove(c.id)}>{es ? "Desactivar" : "Disable"}</button>}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, right }) {
  return <th style={{ padding: "10px 12px", textAlign: right ? "right" : "left", fontSize: 10,
                      fontWeight: 700, letterSpacing: 0.5, color: "var(--text-tertiary, #94A3B8)",
                      textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children, right, mono }) {
  return <td style={{ padding: "9px 12px", textAlign: right ? "right" : "left",
                      fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
                      verticalAlign: "top", whiteSpace: mono ? "nowrap" : undefined }}>{children}</td>;
}
