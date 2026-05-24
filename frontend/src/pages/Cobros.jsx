// ─────────────────────────────────────────────────────────────
// pages/Cobros.jsx — CollectionsDashboard (Centro de control)
// Agente responsable: [AG-FRONTEND]
//
// El cobro en MWT.ONE es 100% automático: un cron del backend
// (CollectionBot) evalúa diariamente los días de gracia y envía
// C1/C2/C3 deduplicados cada 7 días. Esta vista NO sirve para
// que el humano envíe correos — sirve para SUPERVISAR y GOBERNAR
// excepciones sobre lo que la IA está haciendo.
//
// Composición:
//   · KPIs de cabecera (4 tarjetas tabular-nums).
//   · Tab 1 · Cartera en mora    → OverduePortfolioTable.
//   · Tab 2 · Auditoría del bot  → AutomaticCollectionLogTable.
//   · Drawer lateral             → DebtCaseDrawer (gobernanza).
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconAlert, IconDollar, IconMail, IconShield, IconSparkle,
} from "../lib/icons.jsx";
// Sprint 2026-05-24 · CEO: pantalla Cobros migra a estado vacio mientras
// no exista hook real (hoy era 100% mock-driven). Cuando se construya
// useCobrosData(), reemplazar estos const [] por el hook.
const EXPEDIENTES = [];
const CLIENTS = [];
const NOTIFICATION_LOGS = [];
const COLLECTION_EMAIL_LOG = [];
import OverduePortfolioTable, { stageFromDays }
  from "../components/cobros/OverduePortfolioTable.jsx";
import AutomaticCollectionLogTable
  from "../components/cobros/AutomaticCollectionLogTable.jsx";
import DebtCaseDrawer from "../components/cobros/DebtCaseDrawer.jsx";

// ── helpers ─────────────────────────────────────────────────
function fmtMoney(v, cur = "USD") {
  if (v == null || isNaN(v)) return "—";
  return `${cur} ${Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
// Hash determinístico simple (string → 0..N-1) — para reproducibilidad
// del days_overdue por expediente sin tener que reescribir el seed SQL.
function seedFromId(id, mod) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % mod;
}

// Construye el universo de "casos en mora" partiendo de EXPEDIENTES
// con balance > 0; usa CLIENTS.credito_dias como payment_grace_days
// (proxy mientras el campo no llegue de backend).
function buildOverdueCases(expedientes, clients, notificationLogs) {
  const clientById = new Map(clients.map(c => [c.id, c]));

  // Index por expediente_id de las acciones automáticas más recientes
  const lastByExp = new Map();
  notificationLogs.forEach(n => {
    if (!["C1","C2","C3"].includes(n.trigger)) return;
    if (!n.expediente_id) return;
    const cur = lastByExp.get(n.expediente_id);
    if (!cur || (n.ts || "").localeCompare(cur.ts || "") > 0) {
      lastByExp.set(n.expediente_id, n);
    }
  });

  return expedientes
    .filter(e => Number(e.balance) > 0 && !e.is_blocked && e.status !== "CERRADO")
    .map(e => {
      const cli = clientById.get(e.client_id) || {};
      const grace = Number(cli.credito_dias) || 30;
      // days_overdue determinístico (0..70) — sale en mora cuando >0
      const synthDays = seedFromId(e.id, 71); // 0..70
      const daysOverdue = Math.max(0, synthDays - 5); // ~7% de los expedientes quedan en 0
      const stage = stageFromDays(daysOverdue);
      const lastAct = lastByExp.get(e.id);

      // case_state derivado:
      //   bloqueado por el sistema → blocked
      //   T3 + sin pago hace mucho → escalated
      //   resto                    → active
      let caseState = "active";
      if (cli.estado === "BLOQUEADO") caseState = "blocked";
      else if (stage.key === "T3" && seedFromId(e.id + "esc", 5) === 0) caseState = "escalated";
      else if (seedFromId(e.id + "pause", 11) === 0) caseState = "paused";

      return {
        id:                  "case-" + e.id,
        expediente_id:       e.id,
        expediente_code:     e.ref || e.id,
        proforma_id:         e.proforma || null,
        client_id:           e.client_id,
        client_name:         e.client || cli.name || "—",
        amount_overdue:      Number(e.balance) || 0,
        total_invoiced:      Number(e.total_invoiced) || 0,
        total_paid:          Number(e.total_paid) || 0,
        currency:            e.currency || "USD",
        days_overdue:        daysOverdue,
        stage,
        payment_grace_days:  grace,
        grace_extra_days:    0,
        case_state:          caseState,
        pause_reason:        "",
        last_action_at:      lastAct?.ts || null,
        last_action_template:lastAct?.template_key || null,
      };
    })
    .filter(c => c.days_overdue > 0); // solo los realmente vencidos
}

// Selecciona los eventos del CollectionBot relevantes a un caso.
function timelineFor(caseData, allCollectionLogs) {
  if (!caseData) return [];
  return allCollectionLogs.filter(c => c.expediente_id === caseData.expediente_id);
}

// Calcula los KPIs de cabecera a partir de cases + logs
function computeKpis(cases, collectionLogs) {
  const totalExposure = cases.reduce((a, c) => a + (c.amount_overdue || 0), 0);
  const overdueCount  = cases.length;

  const sevenDaysAgo  = Date.now() - 7 * 86400 * 1000;
  const lastWeekLogs  = collectionLogs.filter(c => {
    const t = new Date(c.created_at || c.ts).getTime();
    return !isNaN(t) && t >= sevenDaysAgo;
  });
  const sentLastWeek  = lastWeekLogs.filter(c => c.status === "Sent").length;

  // Recuperación: aproximación con monto recuperado en últimos 7 días.
  // Sumamos el amount_overdue de los logs cuyo expediente está al día
  // hoy (no aparece en cases). Es una heurística — en producción viene
  // del endpoint /cobros/recovery_window/.
  const overdueIds = new Set(cases.map(c => c.expediente_id));
  const recovered = lastWeekLogs
    .filter(c => !overdueIds.has(c.expediente_id))
    .reduce((a, c) => a + (c.amount_overdue || 0), 0);

  return { totalExposure, overdueCount, sentLastWeek, recovered };
}

// ── KPI card ────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, accent = "navy" }) {
  return (
    <div className="card cobros-kpi" data-accent={accent}>
      <div className="cobros-kpi-icon" data-accent={accent}>
        <Icon size={16}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="micro">{label}</div>
        <div className="cobros-kpi-value tabular-nums">{value}</div>
        {sub && <div className="caption" style={{ marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────
export default function ScreenCobros() {
  const { lang } = useOutletContext();
  const [tab, setTab]             = useState("portfolio");
  const [activeCase, setActiveCase] = useState(null);
  // patches en memoria por caso (mock; en prod sería onUpdate → API)
  const [patches, setPatches]     = useState({});

  // Construcción base
  const baseCases = useMemo(
    () => buildOverdueCases(EXPEDIENTES, CLIENTS, NOTIFICATION_LOGS),
    []
  );

  // Aplicar patches del usuario (pause / escalated / grace_extra_days)
  const cases = useMemo(() => baseCases.map(c => {
    const p = patches[c.id];
    if (!p) return c;
    const merged = { ...c, ...p };
    // Recalcular stage si el grace extra tira al expediente "out of mora"
    const effectiveDays = Math.max(0, merged.days_overdue - (merged.grace_extra_days || 0));
    if (effectiveDays !== merged.days_overdue) {
      merged.stage = stageFromDays(effectiveDays);
    }
    return merged;
  }), [baseCases, patches]);

  const kpis = useMemo(
    () => computeKpis(cases, COLLECTION_EMAIL_LOG),
    [cases]
  );

  const drawerTimeline = useMemo(
    () => timelineFor(activeCase, COLLECTION_EMAIL_LOG),
    [activeCase]
  );

  function applyPatch(patch) {
    if (!activeCase) return;
    setPatches(prev => ({
      ...prev,
      [activeCase.id]: { ...(prev[activeCase.id] || {}), ...patch },
    }));
    setActiveCase(prev => prev ? { ...prev, ...patch } : prev);
  }

  return (
    <div className="page">
      {/* ── Header ─────────────── */}
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            {lang === "es" ? "MÓDULO" : "MODULE"}
          </div>
          <h1 className="page-title">
            {lang === "es" ? "Cobros" : "Collections"}
          </h1>
          <div className="page-subtitle" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              className="cobros-bot-pill"
              title={lang === "es" ? "El sistema cobra solo · vos supervisás" : "System collects autonomously · you supervise"}
            >
              <IconSparkle size={11}/>
              {lang === "es" ? "CollectionBot · activo" : "CollectionBot · active"}
            </span>
            <span style={{ color: "var(--text-tertiary)" }}>
              {lang === "es"
                ? "Centro de control: monitoreo, auditoría y gobernanza de excepciones."
                : "Control center: monitoring, audit and exception governance."}
            </span>
          </div>
        </div>
      </div>

      {/* ── KPIs ─────────────── */}
      <motion.div
        className="cobros-kpi-grid mb-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <KpiCard
          icon={IconAlert}
          label={lang === "es" ? "EXPOSICIÓN TOTAL EN MORA" : "TOTAL OVERDUE EXPOSURE"}
          value={fmtMoney(kpis.totalExposure)}
          sub={lang === "es"
            ? `${kpis.overdueCount} expediente${kpis.overdueCount === 1 ? "" : "s"} con balance pendiente`
            : `${kpis.overdueCount} file${kpis.overdueCount === 1 ? "" : "s"} with open balance`}
          accent="warning"
        />
        <KpiCard
          icon={IconDollar}
          label={lang === "es" ? "EXPEDIENTES VENCIDOS" : "OVERDUE FILES"}
          value={kpis.overdueCount}
          sub={lang === "es"
            ? "Superaron sus payment_grace_days"
            : "Exceeded payment_grace_days"}
          accent="critical"
        />
        <KpiCard
          icon={IconMail}
          label={lang === "es" ? "COBROS NOTIFICADOS · 7d" : "COLLECTIONS NOTIFIED · 7d"}
          value={kpis.sentLastWeek}
          sub={lang === "es"
            ? "Correos automáticos enviados con éxito"
            : "Automatic emails successfully sent"}
          accent="blue"
        />
        <KpiCard
          icon={IconShield}
          label={lang === "es" ? "RECUPERACIÓN · 7d" : "RECOVERED · 7d"}
          value={fmtMoney(kpis.recovered)}
          sub={lang === "es"
            ? "Pagos verificados tras gestión"
            : "Verified payments after collection"}
          accent="success"
        />
      </motion.div>

      {/* ── Tabs ─────────────── */}
      <div className="tabs mb-4">
        {[
          { k: "portfolio", es: "Cartera en mora",       en: "Overdue portfolio" },
          { k: "audit",     es: "Auditoría del bot",     en: "Bot audit log"     },
        ].map(t => (
          <button
            key={t.k}
            className="tab"
            data-active={tab === t.k}
            onClick={() => setTab(t.k)}
          >
            {lang === "es" ? t.es : t.en}
          </button>
        ))}
      </div>

      {/* ── Tab body ─────────────── */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {tab === "portfolio" && (
          <OverduePortfolioTable
            lang={lang}
            cases={cases}
            onOpenCase={setActiveCase}
          />
        )}
        {tab === "audit" && (
          <AutomaticCollectionLogTable
            lang={lang}
            logs={COLLECTION_EMAIL_LOG}
          />
        )}
      </motion.div>

      {/* ── Drawer ─────────────── */}
      <AnimatePresence>
        {activeCase && (
          <DebtCaseDrawer
            key={activeCase.id}
            lang={lang}
            caseData={activeCase}
            timeline={drawerTimeline}
            onClose={() => setActiveCase(null)}
            onUpdate={applyPatch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
