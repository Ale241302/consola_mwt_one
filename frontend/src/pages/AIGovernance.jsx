// =====================================================================
// MWT.ONE · pages/AIGovernance.jsx
// Agente: [AG-FRONTEND]
//
// Vista de gobernanza del AI Hub: catálogos de Agents, Skills,
// Instructions con CRUD completo (crear/editar/desactivar).
//
//   /api/ai/agents/        → AgentDrawer
//   /api/ai/skills/        → SkillDrawer
//   /api/ai/instructions/  → InstructionDrawer
//
// La acción "eliminar" hace soft-delete (PATCH is_active=false) — los
// registros existentes en hilos siguen visibles pero ya no se sugieren.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  aiAgentsApi, aiSkillsApi, aiInstructionsApi,
} from "../lib/api.js";
import {
  IconChevLeft, IconPlus, IconRefresh, IconBrain, IconBot,
  IconSparkle, IconFileText, IconX, IconSearch,
} from "../lib/icons.jsx";
import AgentDrawer       from "../components/ai/AgentDrawer.jsx";
import SkillDrawer       from "../components/ai/SkillDrawer.jsx";
import InstructionDrawer from "../components/ai/InstructionDrawer.jsx";

const TABS = [
  { key: "agents",       label: "Agentes",     icon: <IconBot size={16}/>,      color: "#481EE3" },
  { key: "skills",       label: "Skills",      icon: <IconSparkle size={16}/>,  color: "#00B286" },
  { key: "instructions", label: "Instrucciones", icon: <IconFileText size={16}/>, color: "#1EE3D7" },
];

export default function AIGovernance() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("agents");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  // Drawers
  const [drawer, setDrawer] = useState({ kind: null, id: null });

  const apiFor = useMemo(() => ({
    agents:       aiAgentsApi,
    skills:       aiSkillsApi,
    instructions: aiInstructionsApi,
  }), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFor[tab].list({ ordering: tab === "instructions" ? "-priority" : "nombre" });
      setItems(Array.isArray(d) ? d : (d?.results || []));
    } catch (e) {
      setError(e?.body?.detail || e?.message || "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  function openNew() {
    setDrawer({ kind: tab, id: null });
  }
  function openEdit(id) {
    setDrawer({ kind: tab, id });
  }
  function closeDrawer() { setDrawer({ kind: null, id: null }); }
  function onSaved() { load(); }

  async function softDelete(item) {
    const label = item.nombre || item.titulo || item.slug || item.id;
    if (!window.confirm(`¿Desactivar "${label}"? (se podrá restaurar editando is_active)`)) return;
    try {
      await apiFor[tab].update(item.id, { is_active: false });
      await load();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "No se pudo desactivar");
    }
  }

  const filtered = items.filter(it => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const hay = `${it.nombre || it.titulo || ""} ${it.slug || ""} ${it.description || it.body || ""}`.toLowerCase();
    return hay.includes(needle);
  });

  const activeTab = TABS.find(t => t.key === tab) || TABS[0];

  return (
    <div className="page ai-gov-page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate("/ai")} className="ai-btn ai-btn-icon-ghost" title="Volver">
          <IconChevLeft size={16} />
        </button>
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, borderRadius: 10,
          background: "linear-gradient(135deg, rgba(72,30,227,0.10), rgba(0,178,134,0.10))",
          color: "#481EE3",
        }}>
          <IconBrain size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, font: "700 18px/1.1 var(--font-display)", color: "var(--text-primary)" }}>
            Gobernanza del AI Hub
          </h1>
          <div style={{ font: "500 12px/1 var(--font-body)", color: "var(--text-tertiary)", marginTop: 4 }}>
            Catálogos canónicos: agentes, skills, instrucciones globales.
          </div>
        </div>
        <button onClick={load} className="ai-btn ai-btn-ghost" title="Recargar">
          <IconRefresh size={16} />
        </button>
        <button onClick={openNew} className="ai-btn ai-btn-primary">
          <IconPlus size={14} /> Nuevo {activeTab.label.slice(0, -1).toLowerCase()}
        </button>
      </div>

      {/* Tabs */}
      <div className="ai-tabs" style={{ display: "flex", gap: 4 }}>
        {TABS.map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key)}
            data-active={tab === t.key}
            className="ai-tab"
            style={{
              "--tab-accent": t.color,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.icon} {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "var(--surface-elevated, #fff)",
        border: "1px solid var(--border-default, #E5E7EB)",
        borderRadius: 10, padding: "6px 12px",
        maxWidth: 360,
      }}>
        <IconSearch size={14} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Filtrar ${activeTab.label.toLowerCase()}…`}
          style={{ flex: 1, border: "none", outline: "none", background: "transparent",
                   font: "500 12.5px/1.2 var(--font-body)", color: "var(--text-primary)" }}
        />
        {q && (
          <button onClick={() => setQ("")} style={{
            background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)",
          }}>
            <IconX size={12} />
          </button>
        )}
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(239,68,68,0.10)", color: "#B91C1C",
          font: "500 13px/1.4 var(--font-body)",
        }}>⚠ {error}</div>
      )}

      {/* Tabla / lista */}
      <div className="ai-table-wrap" style={{
        background: "var(--surface-elevated, #fff)",
        border: "1px solid var(--border-default, #E5E7EB)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>
            Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>
            {q ? "Sin resultados para esa búsqueda." : "No hay registros aún. Crea el primero."}
          </div>
        ) : tab === "agents" ? (
          <AgentTable items={filtered} onEdit={openEdit} onDelete={softDelete} />
        ) : tab === "skills" ? (
          <SkillTable items={filtered} onEdit={openEdit} onDelete={softDelete} />
        ) : (
          <InstructionTable items={filtered} onEdit={openEdit} onDelete={softDelete} />
        )}
      </div>

      {/* Drawers */}
      <AgentDrawer
        open={drawer.kind === "agents"}
        agentId={drawer.kind === "agents" ? drawer.id : null}
        onClose={closeDrawer}
        onSaved={onSaved}
      />
      <SkillDrawer
        open={drawer.kind === "skills"}
        skillId={drawer.kind === "skills" ? drawer.id : null}
        onClose={closeDrawer}
        onSaved={onSaved}
      />
      <InstructionDrawer
        open={drawer.kind === "instructions"}
        instructionId={drawer.kind === "instructions" ? drawer.id : null}
        onClose={closeDrawer}
        onSaved={onSaved}
      />
    </div>
  );
}

// ─── Tablas ──────────────────────────────────────────────────────────
function HeaderRow({ cols }) {
  return (
    <div className="ai-tr ai-tr-head" style={{
      display: "grid",
      gridTemplateColumns: cols.template,
      gap: 8,
      padding: "10px 14px",
      background: "var(--surface-muted, #F8FAFC)",
      borderBottom: "1px solid var(--border-default, #E5E7EB)",
      font: "600 11px/1 var(--font-body)",
      color: "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    }}>
      {cols.headers.map((h, i) => <span key={i}>{h}</span>)}
    </div>
  );
}
function Row({ children, template, onClick }) {
  return (
    <div
      onClick={onClick}
      className="ai-tr"
      style={{
        display: "grid", gridTemplateColumns: template, gap: 8,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-default, #E5E7EB)",
        font: "500 13px/1.3 var(--font-body)",
        color: "var(--text-primary)",
        cursor: onClick ? "pointer" : "default",
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}

function AgentTable({ items, onEdit, onDelete }) {
  const cols = {
    template: "minmax(180px, 1.5fr) minmax(140px, 1fr) 100px 110px 110px 80px 110px",
    headers: ["Nombre", "Slug", "Rol", "Autonomía", "Modelo", "Global", "Acciones"],
  };
  return (
    <div>
      <HeaderRow cols={cols} />
      {items.map(a => (
        <Row key={a.id} template={cols.template} onClick={() => onEdit(a.id)}>
          <span style={{ fontWeight: 600 }}>{a.nombre}</span>
          <span style={{ font: "500 12px/1 var(--font-mono)", color: "var(--text-tertiary)" }}>{a.slug}</span>
          <span><AgentBadge value={a.role} /></span>
          <span><AgentBadge value={a.autonomy} kind="autonomy" /></span>
          <span style={{ font: "500 11.5px/1 var(--font-mono)", color: "var(--text-secondary)" }}>
            {a.default_model || "—"}
          </span>
          <span>{a.is_global ? "✓" : "—"}</span>
          <span onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onEdit(a.id)} className="ai-btn ai-btn-ghost ai-btn-xs">Editar</button>
            <button onClick={() => onDelete(a)} className="ai-btn ai-btn-danger-ghost ai-btn-xs">×</button>
          </span>
        </Row>
      ))}
    </div>
  );
}
function SkillTable({ items, onEdit, onDelete }) {
  const cols = {
    template: "minmax(180px, 1.5fr) minmax(140px, 1fr) 110px 110px minmax(180px, 2fr) 80px 110px",
    headers: ["Nombre", "Slug (/)", "Scope", "Autonomía", "Tags", "Global", "Acciones"],
  };
  return (
    <div>
      <HeaderRow cols={cols} />
      {items.map(s => (
        <Row key={s.id} template={cols.template} onClick={() => onEdit(s.id)}>
          <span style={{ fontWeight: 600 }}>{s.nombre}</span>
          <span style={{ font: "500 12px/1 var(--font-mono)", color: "var(--text-tertiary)" }}>/{s.slug}</span>
          <span><AgentBadge value={s.scope} kind="scope" /></span>
          <span><AgentBadge value={s.autonomy} kind="autonomy" /></span>
          <span style={{
            display: "flex", flexWrap: "wrap", gap: 4,
            font: "500 11px/1 var(--font-body)", color: "var(--text-secondary)",
          }}>
            {(s.tags || []).slice(0, 3).map(t => (
              <span key={t} style={{
                background: "rgba(0,178,134,0.10)", color: "#00B286",
                padding: "1px 6px", borderRadius: 999,
              }}>{t}</span>
            ))}
            {(s.tags || []).length > 3 && <span>+{s.tags.length - 3}</span>}
          </span>
          <span>{s.is_global ? "✓" : "—"}</span>
          <span onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onEdit(s.id)} className="ai-btn ai-btn-ghost ai-btn-xs">Editar</button>
            <button onClick={() => onDelete(s)} className="ai-btn ai-btn-danger-ghost ai-btn-xs">×</button>
          </span>
        </Row>
      ))}
    </div>
  );
}
function InstructionTable({ items, onEdit, onDelete }) {
  const cols = {
    template: "minmax(220px, 2fr) minmax(140px, 1fr) 80px 80px 80px 110px",
    headers: ["Título", "Slug", "Prioridad", "Global", "Auto", "Acciones"],
  };
  return (
    <div>
      <HeaderRow cols={cols} />
      {items.map(i => (
        <Row key={i.id} template={cols.template} onClick={() => onEdit(i.id)}>
          <span style={{ fontWeight: 600 }}>{i.titulo}</span>
          <span style={{ font: "500 12px/1 var(--font-mono)", color: "var(--text-tertiary)" }}>{i.slug}</span>
          <span className="tabular">{i.priority ?? 0}</span>
          <span>{i.is_global ? "✓" : "—"}</span>
          <span>{i.auto_inject ? "✓" : "—"}</span>
          <span onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
            <button onClick={() => onEdit(i.id)} className="ai-btn ai-btn-ghost ai-btn-xs">Editar</button>
            <button onClick={() => onDelete(i)} className="ai-btn ai-btn-danger-ghost ai-btn-xs">×</button>
          </span>
        </Row>
      ))}
    </div>
  );
}

const BADGE_COLORS = {
  // role
  CHAT:        { color: "#481EE3", bg: "rgba(72,30,227,0.10)" },
  INTERNAL:    { color: "#3083FE", bg: "rgba(48,131,254,0.10)" },
  CONNECTOR:   { color: "#00B286", bg: "rgba(0,178,134,0.10)" },
  TOOL:        { color: "#1EE3D7", bg: "rgba(30,227,215,0.10)" },
  // autonomy
  READ_ONLY:   { color: "#475569", bg: "rgba(71,85,105,0.10)" },
  SUGGEST:     { color: "#3083FE", bg: "rgba(48,131,254,0.10)" },
  EXECUTE:     { color: "#00B286", bg: "rgba(0,178,134,0.10)" },
  AUTO:        { color: "#481EE3", bg: "rgba(72,30,227,0.10)" },
  // scope
  READ:        { color: "#3083FE", bg: "rgba(48,131,254,0.10)" },
  WRITE:       { color: "#00B286", bg: "rgba(0,178,134,0.10)" },
  DESTRUCTIVE: { color: "#EF4444", bg: "rgba(239,68,68,0.10)" },
  EXTERNAL:    { color: "#481EE3", bg: "rgba(72,30,227,0.10)" },
};
function AgentBadge({ value }) {
  const tk = BADGE_COLORS[value] || { color: "#475569", bg: "rgba(71,85,105,0.10)" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      background: tk.bg,
      color: tk.color,
      font: "600 10.5px/1 var(--font-body)",
      letterSpacing: "0.04em",
    }}>{value || "—"}</span>
  );
}
