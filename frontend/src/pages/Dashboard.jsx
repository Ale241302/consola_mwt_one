// =====================================================================
// MWT.ONE · Dashboard (Centro de Operaciones CEO)
// Rediseño 2026-05-20 — AG-03 Arquitecto Ejecutor Frontend.
// Sprint 2026-05-20 · "DEJA TODO CONECTADO" — todos los widgets cableados
// a endpoints reales del backend + selector FX USD↔BRL con localStorage.
//
// Sprint 2026-08-02 · Dashboard ADMIN/CEO PERSONALIZABLE: las 4 bandas
// estáticas se reemplazan por el grid de widgets de AdminDashboard.jsx
// (misma UX que el dashboard CLIENT: Personalizar, ocultar/reordenar,
// builder de gráficas custom) + SCOPE POR WIDGET (general / cliente /
// marca) via ScopeChip. La barra GlobalFilters se ELIMINA: su estado era
// muerto (solo `brand` filtraba 2 widgets client-side; market disabled,
// period/client/node sin consumir) — el scope por widget la reemplaza.
// La primitiva GlobalFilters queda exportada en DashboardPrimitives.jsx.
//
// Esta página conserva:
//   · Header (Nuevo expediente, FxToggle USD↔BRL, Actualizar).
//   · Routing por rol: ADMIN → grid personalizable; CLIENT → ClientDashboard.
//   · Resolución de click en expediente → detalle de su OC.
//
// REGLAS APLICADAS (CLAUDE.md §2):
//   R1 — Cero hex. Solo CSS vars MWT.
//   R3 — CEO-ONLY via useRole() + scope multitenant server-side.
//   R5 — `tabular-nums` en toda métrica.
//   POL_CERO_DEMO — Si BE no responde, EmptyState honesto. Nunca $0/NaN%.
// =====================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import OcChoiceModal from "../components/portal/OcChoiceModal.jsx";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { IconPlus, IconRefresh } from "../lib/icons.jsx";
import { useFxUsdBrl } from "../hooks/useFxUsdBrl.js";
import { useRole } from "../context/RoleContext.jsx";
import { OCS } from "../data/mockData.js";
// Sprint 2026-06-11 · resolver la OC real de un expediente para que el
// click en cualquier registro del dashboard abra el DETALLE de la OC.
import { expedientesApi } from "../lib/api.js";
// Sprint 2026-06-11 (CEO) · dashboard enriquecido para usuarios CLIENTE.
import ClientDashboard from "../components/dashboard/ClientDashboard.jsx";
// Sprint 2026-08-02 · grid personalizable ADMIN/CEO (scope por widget).
import AdminDashboard from "../components/dashboard/AdminDashboard.jsx";
import { FxToggle } from "../components/dashboard/DashboardPrimitives.jsx";

const LS_CCY = "mwt:dashboard-fx-display";

// =====================================================================
// COMPONENTE PRINCIPAL
// =====================================================================
export default function ScreenDashboard() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isAdmin } = useRole();
  const [ocChoiceOpen, setOcChoiceOpen] = useState(false);
  // Sprint 2026-08-02 · el botón "Actualizar" incrementa el nonce y cada
  // widget re-fetchea su propio endpoint (cache SWR por endpoint+scope).
  const [refreshNonce, setRefreshNonce] = useState(0);

  // ── Display currency (persistido en LS) ─────
  const [displayCcy, setDisplayCcy] = useState(() => {
    try {
      const v = localStorage.getItem(LS_CCY);
      return v === "BRL" ? "BRL" : "USD";
    } catch { return "USD"; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_CCY, displayCcy); } catch {}
  }, [displayCcy]);

  // ── FX hook ─────
  const fx = useFxUsdBrl();

  const effectiveCcy = displayCcy === "BRL" && fx.rate != null ? "BRL" : "USD";

  // Helper para mostrar un monto USD en la moneda activa.
  const fmtAmount = useCallback((usd) => {
    if (usd == null) return "—";
    if (effectiveCcy === "BRL" && fx.rate != null) {
      return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-PE", {
        style: "currency", currency: "BRL", maximumFractionDigits: 0,
      }).format(Number(usd) * fx.rate);
    }
    return fmtMoney(usd);
  }, [effectiveCcy, fx.rate, lang]);

  // Construye el secondary BRL para un monto USD (para mostrar debajo del valor).
  const secondaryBrl = useCallback((usd) => {
    if (usd == null || fx.rate == null) return null;
    return {
      value: Number(usd) * fx.rate,
      currency: "BRL",
      source: fx.source,
      fetchedAt: fx.fetchedAt,
    };
  }, [fx.rate, fx.source, fx.fetchedAt]);

  // ── Navegación de drill-downs ─────
  const onOpenExpediente = useCallback(async (id) => {
    // 1) Mocks legacy (HERO scenario).
    const oc = OCS.find((o) => Array.isArray(o.expedientes) && o.expedientes.includes(id));
    if (oc) { navigate(`/expedientes/${oc.id}/exp/${id}`); return; }
    // 2) Sprint 2026-06-11 · datos reales: el click debe abrir el DETALLE
    //    de la OC del expediente (no el listado). Resolvemos oc_id en vivo.
    try {
      const exp = await expedientesApi.get(id);
      if (exp?.oc_id) { navigate(`/expedientes/${exp.oc_id}`); return; }
    } catch { /* fallthrough al listado */ }
    navigate("/expedientes");
  }, [navigate]);

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="page" data-screen-label="Dashboard">
      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            {isAdmin
              ? (lang === "en" ? "OVERVIEW" : "VISTA GENERAL")
              : (lang === "en" ? "MY ORDERS" : "MIS PEDIDOS")}
          </div>
          <h1 className="page-title">{tr(lang, "dashboard")}</h1>
          <div className="page-subtitle">
            {isAdmin
              ? (lang === "en" ? "Operating cockpit · " : "Cockpit operativo · ")
              : (lang === "en" ? "Summary · " : "Resumen · ")}
            {new Date().toLocaleDateString(lang === "en" ? "en-US" : "es-PE", {
              weekday: "long", day: "2-digit", month: "long", year: "numeric",
            })}
          </div>
        </div>
        <div className="flex gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setOcChoiceOpen(true)}
          >
            <IconPlus size={14} /> {tr(lang, "new_expediente")}
          </button>
          <FxToggle
            currency={displayCcy}
            onChange={setDisplayCcy}
            rate={fx.rate}
            source={fx.source}
            fetchedAt={fx.fetchedAt}
            loading={fx.loading}
            error={fx.error}
            onRefresh={fx.refresh}
            lang={lang}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRefreshNonce((n) => n + 1)}
            title={lang === "en" ? "Refresh data" : "Recargar datos"}
          >
            <IconRefresh size={14} />
            {tr(lang, "refresh")}
          </button>
        </div>
      </div>

      <OcChoiceModal
        open={ocChoiceOpen}
        lang={lang}
        onClose={() => setOcChoiceOpen(false)}
        onYes={() => { setOcChoiceOpen(false); navigate('/portal/nueva-oc'); }}
        onNo={() => { setOcChoiceOpen(false); navigate('/portal/nueva-oc', { state: { jumpToStep: 'products' } }); }}
      />

      {/* Sprint 2026-08-02 · ADMIN/CEO: grid personalizable con scope por
          widget. CLIENT: su dashboard propio (intacto). */}
      {isAdmin
        ? <AdminDashboard
            lang={lang}
            fmtAmount={fmtAmount}
            secondaryBrl={secondaryBrl}
            refreshNonce={refreshNonce}
            onOpenExpediente={onOpenExpediente}
          />
        : <ClientDashboard lang={lang}/>}

      {/* Footer informativo */}
      <div
        className="flex ai-center jc-between"
        style={{
          marginTop: 12, padding: "10px 14px",
          background: "var(--surface-hover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          font: "var(--caption)",
          color: "var(--text-tertiary)",
          flexWrap: "wrap", gap: 8,
        }}
      >
        <span>
          {lang === "en" ? "Live dashboard · refreshes on demand" : "Dashboard en vivo · refresco bajo demanda"}
          {" · "}
          {lang === "en" ? "Last reload:" : "Último refresco:"} {fmtDate(new Date().toISOString(), lang)}
        </span>
        <span>
          {fx.rate != null
            ? `FX ${fx.source || "MWT"} · 1 USD = R$ ${fx.rate.toFixed(4)}`
            : (lang === "en" ? "FX: pending" : "FX: pendiente")}
        </span>
      </div>
    </div>
  );
}
