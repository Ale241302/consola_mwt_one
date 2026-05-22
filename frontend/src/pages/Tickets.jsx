// =====================================================================
// MWT.ONE · Tickets — Listado + Dashboard (LOTE_SM_TICKETS)
// Agente responsable: [AG-03 · AG-FRONTEND]
//
// Vista unificada para usuarios y admin:
//   - Usuario estandar: lista de SUS tickets, boton eliminar
//     (deshabilitado si Finalizado).
//   - Admin: tabla general + dashboard de KPIs + filtros + dropdown
//     de transicion de estado en cada fila (incluye 'Finalizar').
//
// El backend ya filtra por rol (R3 · POL_VISIBILIDAD).
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, Link } from "react-router-dom";

import { useRole } from "../context/RoleContext.jsx";
import { ticketsApi } from "../lib/api.js";

const REASON_LABELS = {
  MEJORA:      { es: "Mejora",       en: "Improvement"     },
  BUG:         { es: "Bug",          en: "Bug"             },
  SOPORTE_OP:  { es: "Operativo",    en: "Operational"     },
  FACTURACION: { es: "Facturacion",  en: "Billing"         },
  OTRO:        { es: "Otro",         en: "Other"           },
};

const STATUS_LABELS = {
  ABIERTO:     { es: "Abierto",     en: "Open",       color: "amber" },
  EN_REVISION: { es: "En revision", en: "In review",  color: "blue"  },
  RESUELTO:    { es: "Resuelto",    en: "Resolved",   color: "green" },
  FINALIZADO:  { es: "Finalizado",  en: "Finalized",  color: "gray"  },
};

export default function ScreenTickets() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isAdmin } = useRole();

  const [tickets, setTickets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [errMsg, setErrMsg]     = useState(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [q, setQ]               = useState("");
  const [dashboard, setDash]    = useState(null);

  const load = async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const arr = await ticketsApi.list();
      const list = Array.isArray(arr) ? arr : (arr?.results || []);
      setTickets(list);
    } catch (e) {
      setErrMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    if (!isAdmin) return;
    try {
      const d = await ticketsApi.dashboard();
      setDash(d);
    } catch { setDash(null); }
  };

  useEffect(() => { load(); loadDashboard(); /* eslint-disable-next-line */ }, []);

  // Filtros locales (en server podrias filtrar via query, pero el listado
  // suele ser corto y el filter local es instantaneo).
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (reasonFilter !== "ALL" && t.reason !== reasonFilter) return false;
      if (q) {
        const needle = q.toLowerCase();
        const hay =
          (t.description || "") + " " +
          (t.user_email || "") + " " + (t.user_full_name || "");
        if (!hay.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [tickets, statusFilter, reasonFilter, q]);

  // ── Acciones ───────────────────────────────────────────
  const onDelete = async (t) => {
    if (t.is_finalized) return;
    const ok = window.confirm(lang === "es"
      ? `¿Eliminar el ticket #${String(t.id).slice(0,8)}?`
      : `Delete ticket #${String(t.id).slice(0,8)}?`);
    if (!ok) return;
    try {
      await ticketsApi.remove(t.id);
      await load();
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const onTransition = async (t, status) => {
    if (t.is_finalized) return;
    if (status === "FINALIZADO") {
      const ok = window.confirm(lang === "es"
        ? `Finalizar ticket #${String(t.id).slice(0,8)}? Esta accion es irreversible.`
        : `Finalize ticket #${String(t.id).slice(0,8)}? This action is irreversible.`);
      if (!ok) return;
    }
    try {
      await ticketsApi.transition(t.id, status);
      await load();
      await loadDashboard();
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  return (
    <div className="page" data-screen-label="Tickets">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {isAdmin
              ? (lang === "es" ? "ADMIN · GESTOR DE TICKETS" : "ADMIN · TICKETS MANAGER")
              : (lang === "es" ? "MIS TICKETS"               : "MY TICKETS")}
          </div>
          <h1 className="page-title">
            {lang === "es" ? "Gestor de Tickets" : "Tickets Manager"}
          </h1>
          <div className="page-subtitle">
            {isAdmin
              ? (lang === "es"
                  // Sprint 2026-05-22 · solo superadmin/admin (BYPASS_ROLES) ven
                  // tickets globales; el resto cae al subtitulo de user normal.
                  ? "Cambia el estado o entra al hilo para responder."
                  : "Update the state or open the thread to reply.")
              : (lang === "es"
                  ? "Tus solicitudes a soporte. Haz click en una para ver el hilo."
                  : "Your support requests. Click any to open the chat thread.")}
          </div>
        </div>
      </div>

      {/* Dashboard admin */}
      {isAdmin && (
        <DashboardCards dashboard={dashboard} lang={lang}/>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <input
          className="input"
          style={{maxWidth:280}}
          placeholder={lang === "es" ? "Buscar (descripcion / usuario)…" : "Search (description / user)…"}
          value={q}
          onChange={e=>setQ(e.target.value)}
        />
        <select className="select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">{lang === "es" ? "Todos los estados" : "All statuses"}</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v[lang] || v.es}</option>
          ))}
        </select>
        <select className="select" value={reasonFilter} onChange={e=>setReasonFilter(e.target.value)}>
          <option value="ALL">{lang === "es" ? "Todos los motivos" : "All reasons"}</option>
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v[lang] || v.es}</option>
          ))}
        </select>
        <div style={{marginLeft:"auto"}}>
          <button className="btn btn-secondary" onClick={() => { load(); loadDashboard(); }}>
            {lang === "es" ? "Actualizar" : "Refresh"}
          </button>
        </div>
      </div>

      {errMsg && (
        <div className="card card-pad" style={{borderColor:"var(--state-critical)", color:"var(--state-critical)"}}>
          {errMsg}
        </div>
      )}

      <div className="card card-pad-lg" style={{marginTop:14}}>
        {loading ? (
          <div style={{padding:30, color:"var(--text-tertiary)"}}>
            {lang === "es" ? "Cargando tickets…" : "Loading tickets…"}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState lang={lang} isAdmin={isAdmin}/>
        ) : (
          <div className="tickets-table-wrap">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Ref." : "Ref."}</th>
                  {isAdmin && <th>{lang === "es" ? "Usuario" : "User"}</th>}
                  <th>{lang === "es" ? "Motivo" : "Reason"}</th>
                  <th>{lang === "es" ? "Descripcion" : "Description"}</th>
                  <th>{lang === "es" ? "Estado" : "Status"}</th>
                  <th>{lang === "es" ? "Vista" : "Screen"}</th>
                  <th className="ta-right">{lang === "es" ? "Creado" : "Created"}</th>
                  <th className="ta-right">{lang === "es" ? "Acciones" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <TicketRow
                    key={t.id}
                    t={t}
                    lang={lang}
                    isAdmin={isAdmin}
                    onOpen={() => navigate(`/tickets/${t.id}`)}
                    onDelete={() => onDelete(t)}
                    onTransition={onTransition}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard 4-card row ─────────────────────────────────
function DashboardCards({ dashboard, lang }) {
  const items = [
    { key: "abiertos",    label: lang === "es" ? "Abiertos"     : "Open",         color: "amber" },
    { key: "en_revision", label: lang === "es" ? "En revision"  : "In review",    color: "blue"  },
    { key: "resueltos",   label: lang === "es" ? "Resueltos"    : "Resolved",     color: "green" },
    { key: "cerrados",    label: lang === "es" ? "Finalizados"  : "Finalized",    color: "gray"  },
  ];
  const value = (k) => (dashboard ? (dashboard[k] ?? 0) : "—");
  return (
    <div className="tickets-dash">
      {items.map(it => (
        <div key={it.key} className="tickets-dash-card" data-color={it.color}>
          <div className="micro">{it.label}</div>
          <div className="heading-xl tabular-nums">{value(it.key)}</div>
        </div>
      ))}
      <div className="tickets-dash-card" data-color="accent">
        <div className="micro">
          {lang === "es" ? "Tiempo de respuesta" : "Response time"}
        </div>
        <div className="heading-md tabular-nums">
          {dashboard?.avg_response_human ?? "—"}
        </div>
        <div className="caption" style={{color:"var(--text-tertiary)"}}>
          {lang === "es" ? "Promedio · primera respuesta" : "Avg · first response"}
        </div>
      </div>
    </div>
  );
}

function TicketRow({ t, lang, isAdmin, onOpen, onDelete, onTransition }) {
  const status = STATUS_LABELS[t.status] || STATUS_LABELS.ABIERTO;
  const reason = REASON_LABELS[t.reason] || REASON_LABELS.OTRO;
  const finalized = !!t.is_finalized;
  const created = t.created_at ? new Date(t.created_at) : null;

  return (
    <tr className="tickets-row" data-finalized={finalized || undefined}>
      <td>
        <Link to={`/tickets/${t.id}`} className="mono-sm">
          #{String(t.id).slice(0, 8)}
        </Link>
      </td>
      {isAdmin && (
        <td>
          <div className="heading-sm" style={{fontSize:12}}>
            {t.user_full_name || t.user_email || "—"}
          </div>
          <div className="caption" style={{color:"var(--text-tertiary)"}}>
            {t.user_email}
          </div>
        </td>
      )}
      <td>
        <span className="ticket-pill ticket-pill-reason">
          {reason[lang] || reason.es}
        </span>
      </td>
      <td>
        <div className="ticket-row-desc truncate">
          {t.description}
        </div>
        {(t.message_count > 0) && (
          <span className="caption" style={{color:"var(--text-tertiary)"}}>
            {t.message_count} {lang === "es" ? "mensajes" : "messages"}
          </span>
        )}
      </td>
      <td>
        <span className="ticket-pill" data-color={status.color}>
          {status[lang] || status.es}
        </span>
      </td>
      <td>
        <code className="mono-sm" title={t.context_url || ""}>
          {(t.context_url || "—").length > 28
            ? (t.context_url.slice(0, 25) + "…")
            : (t.context_url || "—")}
        </code>
      </td>
      <td className="ta-right tabular-nums">
        {created ? created.toLocaleString(lang === "es" ? "es-MX" : "en-US",
          { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—"}
      </td>
      <td className="ta-right">
        <div style={{display:"inline-flex", gap:6, alignItems:"center"}}>
          {isAdmin && !finalized && (
            <select
              className="select select-sm"
              value={t.status}
              onChange={(e) => onTransition(t, e.target.value)}
              title={lang === "es" ? "Cambiar estado" : "Change status"}
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v[lang] || v.es}</option>
              ))}
            </select>
          )}
          <button className="btn btn-sm btn-ghost" onClick={onOpen}>
            {lang === "es" ? "Abrir" : "Open"}
          </button>
          <button
            className="btn btn-sm btn-danger"
            disabled={finalized}
            title={finalized
              ? (lang === "es" ? "No se puede eliminar un ticket finalizado" : "Cannot delete finalized ticket")
              : (lang === "es" ? "Eliminar" : "Delete")}
            onClick={onDelete}
          >
            {lang === "es" ? "Eliminar" : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState({ lang, isAdmin }) {
  return (
    <div style={{padding:36, textAlign:"center", color:"var(--text-tertiary)"}}>
      <div className="heading-md" style={{marginBottom:6, color:"var(--text-secondary)"}}>
        {lang === "es" ? "Aun no hay tickets" : "No tickets yet"}
      </div>
      <div className="caption">
        {isAdmin
          ? (lang === "es"
              ? "Cuando un usuario abra un ticket aparecera aqui."
              : "Tickets opened by users will show up here.")
          : (lang === "es"
              ? "Usa el boton flotante de soporte (esquina inferior derecha) para abrir uno."
              : "Use the floating support button (bottom-right) to open one.")}
      </div>
    </div>
  );
}
