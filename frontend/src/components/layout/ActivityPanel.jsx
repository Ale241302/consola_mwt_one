// =====================================================================
// MWT.ONE · components/layout/ActivityPanel.jsx
// Agente responsable: [AG-FRONTEND]
//
// Popover de notificaciones que aparece al hacer clic en la campana 🔔
// del TopBar. Consume GET /api/activity-feed/ (con mock fallback).
//
// Estados:
//   · ALL    → lista completa (últimas 50)
//   · UNREAD → filtro `read_at IS NULL`
//
// Acciones:
//   · POST /api/activity-feed/<id>/read/       → marcar como leída
//   · POST /api/activity-feed/read-all/        → marcar todas
//   · click en deep_link                       → navigate()
//
// Design tokens: var(--navy), var(--mint). Severity badges por color.
// =====================================================================
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, getToken, ApiError } from "../../lib/api.js";

const SEVERITY_STYLES = {
  INFO:      { dot: "#3083FE", bg: "rgba(48,131,254,0.10)",  label: "Info" },
  WARN:      { dot: "#E09F3E", bg: "rgba(224,159,62,0.10)",  label: "Aviso" },
  CRITICAL:  { dot: "#D64545", bg: "rgba(214,69,69,0.10)",   label: "Crítico" },
  SUCCESS:   { dot: "#00B286", bg: "rgba(0,178,134,0.10)",   label: "OK" },
};

function timeAgo(iso, lang = "es") {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)   return lang === "es" ? "ahora" : "now";
  if (min < 60)  return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr} h`;
  const d = Math.floor(hr / 24);
  if (d < 7)     return `${d} d`;
  return new Date(iso).toLocaleDateString(lang === "es" ? "es-PE" : "en-US", { month: "short", day: "numeric" });
}


export default function ActivityPanel({ open, onClose, lang = "es" }) {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [filter, setFilter]   = useState("ALL");    // ALL | UNREAD
  const [loading, setLoading] = useState(false);

  // Fable5 · `isAlive` evita setState si el panel se cierra/desmonta antes
  // de que responda el feed (silencioso, sin cambio de UX).
  const load = useCallback(async (isAlive = () => true) => {
    setLoading(true);
    try {
      const qs = filter === "UNREAD" ? "?unread_only=true&limit=50" : "?limit=50";
      const data = await apiFetch(`/activity-feed/${qs}`, { token: getToken() });
      if (!isAlive()) return;
      setItems(Array.isArray(data) ? data : (data?.results || []));
    } catch (e) {
      if (isAlive()) setItems([]);
    } finally {
      if (isAlive()) setLoading(false);
    }
  }, [filter]);

  // Fable5 · cleanup: cancela la carga pendiente al cerrar el panel.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    load(() => alive);
    return () => { alive = false; };
  }, [open, load]);

  const markOne = useCallback(async (item) => {
    if (item.read_at) return;
    // optimista
    setItems((prev) => prev.map((it) => it.id === item.id
      ? { ...it, read_at: new Date().toISOString() }
      : it));
    try {
      await apiFetch(`/activity-feed/${item.id}/read/`,
        { method: "POST", token: getToken() });
    } catch {
      // Silencio en modo mock — la UI ya quedó actualizada.
    }
  }, []);

  const markAll = useCallback(async () => {
    setItems((prev) => prev.map((it) => ({ ...it, read_at: it.read_at || new Date().toISOString() })));
    try {
      await apiFetch(`/activity-feed/read-all/`,
        { method: "POST", token: getToken() });
    } catch {}
  }, []);

  const handleClickItem = (item) => {
    markOne(item);
    if (item.deep_link) {
      onClose?.();
      navigate(item.deep_link);
    }
  };

  const unreadCount = items.filter((i) => !i.read_at).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop invisible para capturar clicks fuera */}
          <div
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              background: "transparent",
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y:  0, scale: 1 }}
            exit={{    opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="dialog"
            aria-label={lang === "es" ? "Notificaciones" : "Notifications"}
            style={{
              position: "absolute",
              top: 52, right: 108,
              width: 380, maxHeight: 560,
              zIndex: 120,
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(11,30,58,0.18)",
              overflow: "hidden",
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                {lang === "es" ? "Notificaciones" : "Notifications"}
                {unreadCount > 0 && (
                  <span style={{
                    marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                    background: "var(--critical)", color: "#fff",
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  }}>{unreadCount}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilter(filter === "ALL" ? "UNREAD" : "ALL")}
                className="ai-btn ai-btn-ghost ai-btn-xs"
                style={{ fontSize: 11 }}
              >
                {filter === "UNREAD"
                  ? (lang === "es" ? "Ver todas" : "Show all")
                  : (lang === "es" ? "Solo no leídas" : "Unread only")}
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  className="ai-btn ai-btn-ghost ai-btn-xs"
                  style={{ fontSize: 11 }}
                  title={lang === "es" ? "Marcar todas como leídas" : "Mark all read"}
                >
                  ✓
                </button>
              )}
            </div>

            {/* List */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {loading && items.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                  {lang === "es" ? "Cargando…" : "Loading…"}
                </div>
              )}
              {!loading && items.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                  {lang === "es" ? "Sin notificaciones." : "No notifications."}
                </div>
              )}
              {items.map((it) => {
                const sev = SEVERITY_STYLES[it.severity] || SEVERITY_STYLES.INFO;
                const unread = !it.read_at;
                return (
                  <div
                    key={it.id}
                    onClick={() => handleClickItem(it)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      display: "flex", gap: 12,
                      background: unread ? "rgba(0,178,134,0.04)" : "var(--surface-raised)",
                      transition: "background 0.12s ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = unread ? "rgba(0,178,134,0.04)" : "var(--surface-raised)"}
                  >
                    <div style={{
                      flex: "0 0 6px", width: 6, borderRadius: 3,
                      background: unread ? sev.dot : "transparent",
                      alignSelf: "stretch",
                    }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: unread ? 600 : 500,
                        color: "var(--text-primary)",
                        lineHeight: 1.35, marginBottom: 2,
                      }}>
                        {it.title}
                      </div>
                      <div style={{
                        fontSize: 12, color: "var(--text-secondary)",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}>
                        {it.body}
                      </div>
                      <div style={{
                        marginTop: 6, display: "flex", gap: 6, alignItems: "center",
                        fontSize: 10, color: "var(--text-tertiary)",
                      }}>
                        <span style={{
                          padding: "1px 6px", borderRadius: 4,
                          background: sev.bg, color: sev.dot,
                          fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase",
                        }}>
                          {it.severity}
                        </span>
                        <span>·</span>
                        <span>{timeAgo(it.created_at, lang)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
