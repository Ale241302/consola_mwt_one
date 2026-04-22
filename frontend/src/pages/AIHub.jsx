// =====================================================================
// MWT.ONE · pages/AIHub.jsx
// Agente: [AG-FRONTEND]
//
// Dashboard del AI Hub:
//   - Hero: gradient Indigo→Blue con CTA "Nuevo Chat".
//   - Grid de hilos del usuario (cards con título, snippet del último
//     mensaje, message_count, pinned star, fecha relativa).
//   - Acciones rápidas: pin / archive (POST /threads/<id>/pin/, etc).
//   - Botón secundario "Gobernanza" → /ai/governance.
// =====================================================================
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { aiThreadsApi, aiChatApi } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { fmtShortDate } from "../lib/i18n.js";
import { MOCK_AI_THREADS } from "../data/mockData.js";
import {
  IconBot, IconBrain, IconPlus, IconPin, IconArchive, IconRefresh,
} from "../lib/icons.jsx";

export default function AIHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.user_uuid || user?.id || user?.uuid || null;

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("ACTIVE");  // ACTIVE | PINNED | ARCHIVED
  const [usingMock, setUsingMock] = useState(false);

  // Filtra MOCK_AI_THREADS según el tab activo (ACTIVE | PINNED | ARCHIVED).
  // Patrón fail-soft: si el backend no devuelve hilos (vacío o error), caemos a
  // este dataset para que la UI tenga vida. Cualquier interacción con un
  // thread mock-* es manejada localmente por AIChat (no toca el backend).
  function mockThreadsForFilter() {
    return MOCK_AI_THREADS.filter(t => {
      if (filter === "PINNED")   return !!t.pinned_at && !t.archived_at;
      if (filter === "ARCHIVED") return !!t.archived_at;
      return !t.archived_at;  // ACTIVE
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = filter === "PINNED"   ? { pinned: true }
                   : filter === "ARCHIVED" ? { archived: true }
                   : {};
      const d = await aiThreadsApi.list(params);
      const list = Array.isArray(d) ? d : (d?.results || []);
      if (list.length > 0) {
        setThreads(list);
        setUsingMock(false);
      } else {
        setThreads(mockThreadsForFilter());
        setUsingMock(true);
      }
    } catch (e) {
      // Fail-soft: si el backend rechaza (401, 500, etc.) servimos mock
      // para que el CEO pueda seguir explorando la UI.
      setThreads(mockThreadsForFilter());
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function newChat() {
    setCreating(true);
    try {
      const created = await aiThreadsApi.create({
        titulo: "Nueva conversación",
        user_id: userId,
        is_active: true,
      });
      const id = created?.id;
      if (id) navigate(`/ai/chat/${id}`);
    } catch (e) {
      // Fallback mock: creamos un thread local y navegamos a /ai/chat/mock-th-*.
      const id = `mock-th-new-${Date.now()}`;
      navigate(`/ai/chat/${id}`);
    } finally {
      setCreating(false);
    }
  }

  // Mutación local para hilos mock — no llamamos al backend.
  function _mutateLocalThread(id, patch) {
    setThreads(arr => arr.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }
  async function togglePin(t) {
    if (t.mock_only || String(t.id || "").startsWith("mock-th-")) {
      _mutateLocalThread(t.id, { pinned_at: t.pinned_at ? null : new Date().toISOString() });
      return;
    }
    try {
      if (t.pinned_at) await aiChatApi.unpinThread(t.id);
      else             await aiChatApi.pinThread(t.id);
      await load();
    } catch (_) {
      _mutateLocalThread(t.id, { pinned_at: t.pinned_at ? null : new Date().toISOString() });
    }
  }
  async function toggleArchive(t) {
    if (t.mock_only || String(t.id || "").startsWith("mock-th-")) {
      _mutateLocalThread(t.id, { archived_at: t.archived_at ? null : new Date().toISOString() });
      return;
    }
    try {
      if (t.archived_at) await aiChatApi.unarchiveThread(t.id);
      else               await aiChatApi.archiveThread(t.id);
      await load();
    } catch (_) {
      _mutateLocalThread(t.id, { archived_at: t.archived_at ? null : new Date().toISOString() });
    }
  }

  return (
    <div className="page ai-hub-page" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero */}
      <div className="ai-hero" style={{
        position: "relative",
        padding: "28px 32px",
        borderRadius: 18,
        background: "linear-gradient(135deg, #481EE3 0%, #3083FE 60%, #1EE3D7 110%)",
        color: "#FFFFFF",
        overflow: "hidden",
        boxShadow: "0 18px 40px rgba(72,30,227,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative", zIndex: 2 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "rgba(255,255,255,0.18)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(10px)",
          }}>
            <IconBot size={28} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, font: "700 22px/1.1 var(--font-display)" }}>
              AI Hub
            </h1>
            <p style={{ margin: "6px 0 0", font: "500 13px/1.45 var(--font-body)", opacity: 0.92 }}>
              Conversa con agentes y skills de MWT.ONE. Usa <kbd style={kbdStyle}>@</kbd> para mencionar agentes,&nbsp;
              <kbd style={kbdStyle}>/</kbd> para invocar skills, y <kbd style={kbdStyle}>📎</kbd> para adjuntar PDF, imágenes o texto.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => navigate("/ai/governance")} className="ai-btn ai-btn-ghost-on-hero">
              <IconBrain size={16} /> Gobernanza
            </button>
            <button onClick={newChat} disabled={creating} className="ai-btn ai-btn-mass-primary">
              {creating ? <IconRefresh size={16} /> : <IconPlus size={16} />}
              <span>{creating ? "Creando…" : "Nuevo Chat"}</span>
            </button>
          </div>
        </div>
        {/* Decorative orbs */}
        <div aria-hidden style={{
          position: "absolute", right: -60, top: -60, width: 220, height: 220,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.20), transparent 70%)",
          zIndex: 1,
        }} />
      </div>

      {/* Filtros */}
      <div className="ai-filters" style={{ display: "flex", gap: 6 }}>
        {[
          { v: "ACTIVE",   label: "Activos" },
          { v: "PINNED",   label: "Anclados" },
          { v: "ARCHIVED", label: "Archivados" },
        ].map(f => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            data-active={filter === f.v}
            className="ai-tab"
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={load} className="ai-btn ai-btn-ghost" title="Recargar">
          <IconRefresh size={16} />
        </button>
      </div>

      {/* Estado */}
      {usingMock && !error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(180,83,9,0.10)", color: "#B45309",
          border: "1px solid rgba(180,83,9,0.20)",
          font: "500 13px/1.4 var(--font-body)",
        }}>
          <span style={{
            display: "inline-flex", width: 8, height: 8, borderRadius: 999,
            background: "#B45309", flex: "0 0 8px",
          }}/>
          <span>
            <strong>Modo demo:</strong> Mostrando un historial de conversación de ejemplo.
            Las nuevas conversaciones, anclados y archivados se mantienen sólo en este navegador.
          </span>
        </div>
      )}
      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(239,68,68,0.10)", color: "#B91C1C",
          font: "500 13px/1.4 var(--font-body)",
        }}>⚠ {error}</div>
      )}

      {/* Grid de hilos */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-tertiary)" }}>
          Cargando hilos…
        </div>
      ) : threads.length === 0 ? (
        <div style={{
          padding: 60, textAlign: "center",
          background: "var(--surface-muted, #F8FAFC)",
          borderRadius: 14, color: "var(--text-tertiary)",
        }}>
          <IconBot size={36} />
          <div style={{ marginTop: 12, font: "600 14px/1.3 var(--font-body)" }}>
            Aún no tienes conversaciones.
          </div>
          <div style={{ marginTop: 4, font: "500 12.5px/1.4 var(--font-body)" }}>
            Empieza una con el botón <strong>Nuevo Chat</strong> arriba.
          </div>
        </div>
      ) : (
        <div className="ai-thread-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}>
          {threads.map(t => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="ai-thread-card"
              onClick={() => navigate(`/ai/chat/${t.id}`)}
              style={{
                position: "relative",
                padding: 16,
                background: "var(--surface-elevated, #fff)",
                border: "1px solid var(--border-default, #E5E7EB)",
                borderRadius: 12,
                boxShadow: "0 1px 3px rgba(11,30,58,0.04)",
                cursor: "pointer",
                display: "flex", flexDirection: "column", gap: 8,
                transition: "all 140ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, borderRadius: 8,
                  background: "linear-gradient(135deg, rgba(72,30,227,0.10), rgba(48,131,254,0.10))",
                  color: "#481EE3",
                }}>
                  <IconBot size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    font: "700 14px/1.25 var(--font-body)",
                    color: "var(--text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t.titulo || "Sin título"}
                  </div>
                  <div style={{
                    font: "500 11px/1.2 var(--font-body)",
                    color: "var(--text-tertiary)",
                    marginTop: 2,
                  }}>
                    {t.message_count || 0} mensaje{(t.message_count || 0) === 1 ? "" : "s"}
                    {t.last_message_at && <> · {fmtShortDate(t.last_message_at, "es")}</>}
                  </div>
                </div>
                {t.pinned_at && (
                  <span title="Anclado" style={{ color: "#481EE3" }}>
                    <IconPin size={14} />
                  </span>
                )}
              </div>

              {t.last_user_text && (
                <div style={{
                  font: "500 12.5px/1.45 var(--font-body)",
                  color: "var(--text-secondary)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {t.last_user_text}
                </div>
              )}

              {/* Acciones (no propagar click) */}
              <div style={{
                display: "flex", gap: 4, marginTop: "auto",
                paddingTop: 8, borderTop: "1px dashed var(--border-default, #E5E7EB)",
              }} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => togglePin(t)}
                  className="ai-btn ai-btn-icon-ghost"
                  title={t.pinned_at ? "Desanclar" : "Anclar"}
                >
                  <IconPin size={14} />
                </button>
                <button
                  onClick={() => toggleArchive(t)}
                  className="ai-btn ai-btn-icon-ghost"
                  title={t.archived_at ? "Restaurar" : "Archivar"}
                >
                  <IconArchive size={14} />
                </button>
                <div style={{ flex: 1 }} />
                <span style={{
                  font: "500 10.5px/1 var(--font-mono)",
                  color: "var(--text-tertiary)",
                  alignSelf: "center",
                }}>
                  tok: {t.tokens_in_total || 0}↓ / {t.tokens_out_total || 0}↑
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

const kbdStyle = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 4,
  background: "rgba(255,255,255,0.20)",
  border: "1px solid rgba(255,255,255,0.30)",
  font: "600 11px/1 var(--font-mono)",
  margin: "0 2px",
};
