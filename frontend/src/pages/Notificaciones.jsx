// ─────────────────────────────────────────────────────────────
// NotificationHistoryDashboard — Historial de Notificaciones
// Agente responsable: [AG-FRONTEND]
//
// Dashboard de auditoría read-only compuesto por:
//   · 4 KPIs de cabecera (Total Enviados · Omitidos/Kill Switch ·
//                          Agotados/Fallidos · Volumen Cobranza 7d)
//   · Tabs (Transaccional · Cobranza)
//
// Tab 1 — NotificationLogTable (fila expandible con body_preview + error)
// Tab 2 — CollectionLogTable   (audit trail automático C1/C2/C3)
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconCheck, IconAlert, IconMail, IconClock, IconFileText, IconHistory,
} from "../lib/icons.jsx";
import {
  NOTIFICATION_LOGS as MOCK_NOTIFICATION_LOGS,
  COLLECTION_EMAIL_LOG as MOCK_COLLECTION_EMAIL_LOG,
} from "../data/mockData.js";
import NotificationLogTable from "../components/notificaciones/NotificationLogTable.jsx";
import CollectionLogTable   from "../components/notificaciones/CollectionLogTable.jsx";
import { useNotificationData } from "../hooks/useNotificationData.js";

// Adapter: normaliza row del backend (notifications.notification_log) → shape
// usado por NotificationLogTable/CollectionLogTable (created_at + ts + body_preview).
function mapApiLogToRow(r) {
  return {
    id:              r.id,
    ts:              r.ts,
    created_at:      r.ts || r.created_at,
    completed_at:    r.completed_at,
    expediente_id:   r.expediente_id,
    proforma_id:     r.proforma_id,
    template_key:    r.template_key,
    template_id:     r.template_id,
    recipient_email: r.recipient_email,
    subject:         r.subject,
    body_preview:    r.body_preview || '',
    trigger:         r.trigger,
    status:          r.status,
    retries:         r.retries || 0,
    attempt_count:   r.attempt_count || 1,
    error:           r.error,
    skip_reason:     r.skip_reason,
    amount_overdue:  r.amount_overdue ? Number(r.amount_overdue) : null,
    grace_days_used: r.grace_days_used,
    currency:        r.currency,
  };
}

const MS_PER_DAY = 86_400_000;

function within7Days(iso) {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return false;
  return (Date.now() - d) <= 7 * MS_PER_DAY;
}

export default function ScreenNotificaciones() {
  const { lang } = useOutletContext();
  const navigate = useNavigate();

  const [tab, setTab] = useState('trans'); // trans | collect

  // ── Backend data (fallback a mock si está vacío) ───────────────
  const {
    logs: apiLogs, collectionLogs: apiCollLogs,
    logsKpis: apiLogsKpis, collectionKpis: apiCollKpis,
    loading: loadingLogs,
  } = useNotificationData();

  const NOTIFICATION_LOGS = useMemo(() => {
    if (!loadingLogs && Array.isArray(apiLogs) && apiLogs.length > 0) {
      return apiLogs.map(mapApiLogToRow);
    }
    // Sprint 2026-05-24 · CEO: apagar fallback a mock.
    return [];
  }, [apiLogs, loadingLogs]);

  const COLLECTION_EMAIL_LOG = useMemo(() => {
    if (!loadingLogs && Array.isArray(apiCollLogs) && apiCollLogs.length > 0) {
      return apiCollLogs.map(mapApiLogToRow);
    }
    // Sprint 2026-05-24 · CEO: apagar fallback a mock.
    return [];
  }, [apiCollLogs, loadingLogs]);

  // ── KPIs (scope: dataset completo) ──────────────────
  const kpis = useMemo(() => {
    // Preferir KPIs del backend si están disponibles
    if (apiLogsKpis) {
      return {
        sent:         (apiLogsKpis.sent || 0) + (apiLogsKpis.delivered || 0),
        omitted:      apiLogsKpis.skipped || 0,
        exhausted:    (apiLogsKpis.exhausted || 0) + (apiLogsKpis.failed || 0),
        collections7d: apiCollKpis ? (apiCollKpis.total || 0) : 0,
      };
    }
    let sent = 0, omitted = 0, exhausted = 0, collections7d = 0;
    for (const n of NOTIFICATION_LOGS) {
      if (n.status === 'Sent')                                    sent++;
      if (n.status === 'Skipped' || n.status === 'Disabled')      omitted++;
      if (n.status === 'Exhausted' || n.status === 'Failed')      exhausted++;
    }
    for (const c of COLLECTION_EMAIL_LOG) {
      if (within7Days(c.created_at || c.ts)) collections7d++;
    }
    return { sent, omitted, exhausted, collections7d };
  }, [NOTIFICATION_LOGS, COLLECTION_EMAIL_LOG, apiLogsKpis, apiCollKpis]);

  const tabs = [
    { id:'trans',   icon: IconFileText, label: lang==='es'?'Historial transaccional':'Transactional history', count: NOTIFICATION_LOGS.length },
    { id:'collect', icon: IconMail,     label: lang==='es'?'Auditoría de cobranza':'Collection audit',         count: COLLECTION_EMAIL_LOG.length },
  ];

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'COMUNICACIONES · HISTORIAL':'COMMS · HISTORY'}
          </div>
          <h1 className="page-title">
            {lang==='es'?'Historial de notificaciones':'Notification history'}
          </h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Registro inmutable de envíos transaccionales y de cobranza automática. Sólo lectura.'
              : 'Immutable record of transactional and automated collection emails. Read-only.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-ghost" onClick={() => navigate('/templates')}>
            <IconFileText size={14}/> {lang==='es'?'Plantillas':'Templates'}
          </button>
        </div>
      </div>

      {/* ── KPIs ─── */}
      <motion.div
        className="nh-kpi-row"
        initial={{ opacity:0, y:8 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:0.35, ease:'easeOut' }}
      >
        <KpiTile
          icon={IconCheck}
          color="#0E8A6D"
          label={lang==='es'?'Total enviados':'Total sent'}
          value={kpis.sent}
          sub={lang==='es'?'Correos entregados con éxito':'Successfully delivered'}
        />
        <KpiTile
          icon={IconClock}
          color="#B45309"
          label={lang==='es'?'Omitidos · Kill switch':'Skipped · Kill switch'}
          value={kpis.omitted}
          sub={lang==='es'?'Sin email o plantilla apagada':'No email or template disabled'}
          alert={kpis.omitted > 0}
        />
        <KpiTile
          icon={IconAlert}
          color="#DC2626"
          label={lang==='es'?'Agotados · Fallidos':'Exhausted · Failed'}
          value={kpis.exhausted}
          sub={lang==='es'?'Reintentos agotados por Celery':'Celery retries exhausted'}
          alert={kpis.exhausted > 0}
        />
        <KpiTile
          icon={IconMail}
          color="#3083FE"
          label={lang==='es'?'Volumen cobranza (7 días)':'Collection volume (7d)'}
          value={kpis.collections7d}
          sub={lang==='es'?'Correos C1 / C2 / C3 automáticos':'Automatic C1 / C2 / C3 emails'}
        />
      </motion.div>

      {/* ── Tabs ─── */}
      <div className="nh-tabs">
        {tabs.map(t => {
          const Ic = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`nh-tab ${active ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Ic size={14}/>
              <span className="nh-tab-label">{t.label}</span>
              <span className="nh-tab-count tabular-nums">{t.count}</span>
              {active && (
                <motion.span
                  layoutId="nh-tab-underline"
                  className="nh-tab-underline"
                  transition={{ type:'spring', stiffness:320, damping:28 }}
                />
              )}
            </button>
          );
        })}
        <div className="nh-tabs-aside">
          <IconHistory size={12}/>
          <span className="micro">{lang==='es'?'Registro inmutable':'Immutable log'}</span>
        </div>
      </div>

      {/* ── Tab content ─── */}
      <AnimatePresence mode="wait">
        {tab === 'trans' && (
          <motion.div
            key="trans"
            initial={{ opacity:0, y:6 }}
            animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, y:-4 }}
            transition={{ duration:0.22 }}
          >
            <NotificationLogTable lang={lang} logs={NOTIFICATION_LOGS}/>
          </motion.div>
        )}
        {tab === 'collect' && (
          <motion.div
            key="collect"
            initial={{ opacity:0, y:6 }}
            animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, y:-4 }}
            transition={{ duration:0.22 }}
          >
            <CollectionLogTable lang={lang} logs={COLLECTION_EMAIL_LOG}/>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── KPI tile ────────────────────
function KpiTile({ icon: Icon, color, label, value, sub, alert }) {
  return (
    <div className={`nh-kpi ${alert ? 'nh-kpi-alert' : ''}`} style={{ '--kpi-color': color }}>
      <div className="nh-kpi-icon" style={{ background: `${color}1a`, color }}>
        <Icon size={16}/>
      </div>
      <div className="nh-kpi-body">
        <div className="nh-kpi-label">{label}</div>
        <div className="nh-kpi-value tabular-nums">{(value || 0).toLocaleString('en-US')}</div>
        <div className="nh-kpi-sub micro">{sub}</div>
      </div>
    </div>
  );
}
