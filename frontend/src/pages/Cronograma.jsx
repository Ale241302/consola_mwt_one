// =====================================================================
// MWT.ONE · pages/Cronograma.jsx — Cronograma interactivo (React)
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
// Reemplaza al Resumen .html como vista viva dentro de la consola:
//   · Gantt con zoom/pan, fases reales (event_log + rangos manuales) y
//     proyección estimada (jerarquía cliente → global → _ALL → estándar).
//   · Agrupación: Expediente · SKU · Método de envío.
//   · Tiempos promedio por fase: por método y por SKU.
//   · Click en Proforma (admin) / PO (cliente) → modal de SKUs con
//     precios según rol (R3 POL_VISIBILIDAD).
// =====================================================================
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useRole } from "../context/RoleContext.jsx";
import GanttChart from "../components/cronograma/GanttChart.jsx";
import PhaseStatsCards from "../components/cronograma/PhaseStatsCards.jsx";
import ExpedienteSkuModal from "../components/cronograma/ExpedienteSkuModal.jsx";
import {
  KpiStrip, UpcomingDeliveries, PipelineBoard, ExpedientesTable,
  PairsTable, ReceptionSheet,
} from "../components/cronograma/CronogramaExtras.jsx";
// Sprint 2026-06-10 — Exportar HTML desde el Cronograma (mismo modal +
// generador .html interactivo: zoom/arrastre + modal de SKUs por registro).
import ExportExpedientesModal from "../components/expedientes/ExportExpedientesModal.jsx";
import { runExpedienteExport } from "../lib/expedienteExport.js";
import {
  loadCronograma, loadClientStats, buildAvgs, buildSkuStats,
  computeSegments, itemPhaseDur, projectedDelivery, dayDiff, fmtShort,
  STAGES, STAGE_LABELS,
} from "../lib/cronogramaData.js";

const fInt = (n) => Number(n || 0).toLocaleString("es-CR");

export default function Cronograma() {
  const { lang } = useOutletContext();
  const { isClient: roleIsClient, user } = useRole();
  // Query params del modal "Generar reporte" (/expedientes y /portal):
  //   ?cliente=<uuid> · ?estado=<FASE> · ?exp=<uuid> · ?aud=CLIENT
  const [params] = useSearchParams();
  const qpExp = params.get("exp") || "";
  // Vista dual (R3 POL_VISIBILIDAD): ADMIN/CEO alterna Vista MWT ↔ Vista
  // Cliente; los usuarios CLIENT_* siempre quedan en vista Cliente (sólo
  // precio de venta). aud=CLIENT del modal inicia en vista Cliente.
  const [vista, setVista] = useState(
    roleIsClient || params.get("aud") === "CLIENT" ? "CLIENT" : "MWT"
  );
  const isClient = roleIsClient || vista === "CLIENT";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [statsGlobal, setStatsGlobal] = useState(null);
  const [cliStats, setCliStats] = useState(null);
  const [groupBy, setGroupBy] = useState("EXPEDIENTE");
  const [tab, setTab] = useState("GANTT");
  const [clienteId, setClienteId] = useState(params.get("cliente") || "ALL");
  const [estado, setEstado] = useState((params.get("estado") || "ALL").toUpperCase());
  // Sprint 2026-06-11 — filtro de proformas/PO concretas (multi-selección).
  // Set de ids de expediente; vacío = todas.
  const [selProformas, setSelProformas] = useState(() => new Set());
  const [profOpen, setProfOpen] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    loadCronograma()
      .then(({ items: its, statsGlobal: glo }) => {
        if (!alive) return;
        setItems(its); setStatsGlobal(glo);
      })
      .catch((e) => { if (alive) setError(e?.message || "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Stats del cliente filtrado (los clientes B2B ya llegan scopeados).
  useEffect(() => {
    let alive = true;
    if (clienteId === "ALL") { setCliStats(null); return undefined; }
    loadClientStats(clienteId).then((v) => { if (alive) setCliStats(v); });
    return () => { alive = false; };
  }, [clienteId]);

  // Entidades legales asignadas al usuario (users.mwtuser.legal_entity_ids):
  // un usuario normal sólo ve SUS clientes — defensa extra sobre el scope
  // del backend (R3 POL_VISIBILIDAD). Admin/CEO ve todos.
  const allowedEntities = useMemo(() => new Set(
    Array.isArray(user?.legal_entity_ids) && user.legal_entity_ids.length
      ? user.legal_entity_ids
      : (user?.legal_entity_id ? [user.legal_entity_id] : [])
  ), [user]);

  const scopedItems = useMemo(() => (
    roleIsClient && allowedEntities.size
      ? items.filter((it) => it.clienteId && allowedEntities.has(it.clienteId))
      : items
  ), [items, roleIsClient, allowedEntities]);

  const clientes = useMemo(() => {
    const map = new Map();
    scopedItems.forEach((it) => {
      if (it.clienteId && it.cliente) map.set(it.clienteId, it.cliente);
    });
    return Array.from(map, ([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scopedItems]);

  const visibles = useMemo(
    () => scopedItems.filter((it) =>
      (qpExp ? it.id === qpExp : true)
      && (clienteId === "ALL" || it.clienteId === clienteId)
      && (estado === "ALL" || it.estado === estado)
      && (selProformas.size === 0 || selProformas.has(it.id))
    ),
    [scopedItems, clienteId, estado, qpExp, selProformas]
  );

  // Filas para runExpedienteExport (forma del listado de /expedientes),
  // construidas desde las filas crudas ya cargadas — sin re-fetchear.
  const exportRows = useMemo(() => scopedItems.map((it) => ({
    ...(it._row || {}),
    uuid: it.id,
    ref: it.proforma || it.expCodigo || "",
    status: it.estado,
    client_id: it.clienteId,
  })), [scopedItems]);

  const handleExportHtml = useCallback(async (opts) => {
    setExporting(true);
    setExportErr(null);
    try {
      await runExpedienteExport({
        expedientes: exportRows,
        audience: roleIsClient ? "CLIENT" : opts.audience,
        lang,
        filters: opts,
      });
      setExportOpen(false);
    } catch (e) {
      setExportErr(e?.message || String(e));
    } finally {
      setExporting(false);
    }
  }, [exportRows, roleIsClient, lang]);

  const avgs = useMemo(() => buildAvgs(cliStats, statsGlobal), [cliStats, statsGlobal]);
  const skuStats = useMemo(() => buildSkuStats(visibles), [visibles]);

  // Orden cronológico del Gantt: el expediente que arranca antes va arriba
  // (el listado de la API viene "más reciente primero"). Vive DESPUÉS de
  // `avgs` — referenciarlo antes dispara TDZ en producción.
  const ordered = useMemo(() => {
    const startTs = (it) => {
      const segs = computeSegments(it, avgs);
      const first = segs.real[0] || segs.est[0];
      return first ? first.a.getTime() : Infinity;
    };
    return [...visibles].sort((a, b) => startTs(a) - startTs(b));
  }, [visibles, avgs]);
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;

  const labelOf = useCallback((it) => {
    if (!isClient) return it.proforma || it.expCodigo;
    if (!it.ocCodigo) return it.expCodigo;
    // El código de OC puede venir YA con prefijo "PO" — no duplicarlo.
    return String(it.ocCodigo).toUpperCase().startsWith("PO")
      ? it.ocCodigo
      : `PO ${it.ocCodigo}`;
  }, [isClient]);

  // Opciones del filtro de proformas/PO — etiqueta role-aware (proforma
  // para staff, PO para cliente) + EXP como pista secundaria.
  const proformaOpts = useMemo(
    () => scopedItems
      .map((it) => ({ id: it.id, label: labelOf(it), sub: it.expCodigo }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    [scopedItems, labelOf]
  );
  const toggleProforma = (id) => setSelProformas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Fila de expediente (con sub-filas por fase) — reutilizada por los 3 modos.
  const expedienteRow = useCallback((it, keyPrefix = "") => {
    const segs = computeSegments(it, avgs);
    const all = [
      ...segs.real.map((b) => ({ ...b, est: false })),
      ...segs.est.map((b) => ({ ...b, est: true })),
    ];
    const phaseChildren = all.map((b, i) => {
      const known = itemPhaseDur(it, b.s);
      const days = b.est
        ? dayDiff(b.a, b.b)
        : (known ? Math.round(known.days * 10) / 10 : dayDiff(b.a, b.b));
      const tag = b.est
        ? "est."
        : (known && known.manual ? "manual" : (b.open ? (lang === "es" ? "en curso" : "ongoing") : "real"));
      return {
        key: `${keyPrefix}${it.id}-ph-${b.s}-${i}`,
        label: L[b.s],
        sub: `${days}d · ${tag}`,
        bars: [{ ...b, tip: `${L[b.s]}${b.est ? " (est.)" : ""}: ${fmtShort(b.a, lang)} → ${fmtShort(b.b, lang)} · ${days}d` }],
      };
    });
    // Barra resumen del padre: UNA sola barra continua y delgada (un solo
    // color: mint si entregado, navy si en proceso). Las fases por color
    // viven en las sub-filas al desglosar.
    const spanA = all.length ? all[0].a : null;
    const spanB = all.length ? all[all.length - 1].b : null;
    const delivered = it.estado === "EN_DESTINO" || it.estado === "CERRADO";
    return {
      key: `${keyPrefix}${it.id}`,
      label: labelOf(it),
      labelTip: lang === "es" ? "Ver SKUs y precios" : "View SKUs & prices",
      sub: [
        it.expCodigo !== labelOf(it) ? it.expCodigo : null,
        `${fInt(it.volumen)} prs`,
        it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client"),
        it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)"),
      ].filter(Boolean).join(" · "),
      bars: spanA ? [{
        s: it.estado,
        a: spanA,
        b: spanB,
        color: delivered ? "#13B98A" : "#013A57",
        est: false,
        tip: `${labelOf(it)}: ${fmtShort(spanA, lang)} → ${fmtShort(spanB, lang)}`
          + (segs.est.length ? (lang === "es" ? " · llegada estimada" : " · estimated arrival") : ""),
      }] : [],
      summary: true,
      onLabelClick: () => setModalItem(it),
      children: phaseChildren,
    };
  }, [avgs, labelOf, lang, L]);

  const rows = useMemo(() => {
    if (groupBy === "EXPEDIENTE") {
      return ordered.map((it) => expedienteRow(it));
    }
    if (groupBy === "SKU") {
      const map = new Map();
      ordered.forEach((it) => it.skus.forEach((sku) => {
        (map.get(sku) || map.set(sku, []).get(sku)).push(it);
      }));
      return Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([sku, list]) => {
          const product = ((list[0].lineas || []).find((l) => l.sku === sku) || {}).product_label || "";
          const spans = list.map((it) => {
            const segs = computeSegments(it, avgs);
            const allSegs = [...segs.real, ...segs.est];
            if (!allSegs.length) return null;
            return {
              s: it.estado === "EN_DESTINO" || it.estado === "CERRADO" ? "EN_DESTINO" : "PREPARACION",
              a: allSegs[0].a,
              b: allSegs[allSegs.length - 1].b,
              est: segs.est.length > 0,
              tip: `${labelOf(it)} · ${fmtShort(allSegs[0].a, lang)} → ${fmtShort(allSegs[allSegs.length - 1].b, lang)}`,
            };
          }).filter(Boolean);
          return {
            key: `sku-${sku}`,
            label: sku,
            sub: `${product ? product + " · " : ""}${list.length} exp.`,
            bars: spans,
            summary: true,
            children: list.map((it) => expedienteRow(it, `sku-${sku}-`)),
          };
        });
    }
    // MÉTODO
    const buckets = new Map();
    ordered.forEach((it) => {
      const k = it.modo || (lang === "es" ? "Aéreo (supuesto)" : "Air (assumed)");
      (buckets.get(k) || buckets.set(k, []).get(k)).push(it);
    });
    return Array.from(buckets.entries()).map(([modo, list]) => ({
      key: `modo-${modo}`,
      label: modo,
      sub: `${list.length} exp. · ${fInt(list.reduce((a, x) => a + x.volumen, 0))} prs`,
      bars: list.map((it) => {
        const segs = computeSegments(it, avgs);
        const allSegs = [...segs.real, ...segs.est];
        if (!allSegs.length) return null;
        return {
          s: it.estado === "EN_DESTINO" || it.estado === "CERRADO" ? "EN_DESTINO" : "TRANSITO",
          a: allSegs[0].a,
          b: allSegs[allSegs.length - 1].b,
          est: segs.est.length > 0,
          tip: labelOf(it),
        };
      }).filter(Boolean),
      summary: true,
      children: list.map((it) => expedienteRow(it, `modo-${modo}-`)),
    }));
  }, [ordered, groupBy, avgs, expedienteRow, labelOf, lang]);

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
          {lang === "es" ? "SUPPLY CHAIN · LÍNEA DE TIEMPO" : "SUPPLY CHAIN · TIMELINE"}
        </div>
        <h1 className="page-title" style={{ margin: 0 }}>
          {lang === "es" ? "Cronograma" : "Timeline"}
        </h1>
      </div>

      {/* Filtros — a la IZQUIERDA y en línea (no apilados) */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        {/* Agrupar */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "EXPEDIENTE", es: "Expediente", en: "File" },
            { id: "SKU", es: "SKU", en: "SKU" },
            { id: "METODO", es: "Método", en: "Mode" },
          ].map((g) => (
            <button key={g.id} onClick={() => setGroupBy(g.id)}
                    style={{
                      padding: "4px 14px", fontSize: 11.5, fontWeight: 700, borderRadius: 999,
                      border: groupBy === g.id ? "1.5px solid #013A57" : "1.5px solid var(--border-subtle, #E1E6ED)",
                      background: groupBy === g.id ? "#013A57" : "transparent",
                      color: groupBy === g.id ? "#fff" : "var(--text-secondary, #475569)",
                      cursor: "pointer",
                    }}>
              {lang === "es" ? g.es : g.en}
            </button>
          ))}
        </div>
        {/* Estado */}
        <select className="input" value={estado}
                onChange={(e) => setEstado(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12.5, width: "auto", minWidth: 150 }}>
          <option value="ALL">{lang === "es" ? "Todos los estados" : "All states"}</option>
          {STAGES.map((s) => <option key={s} value={s}>{L[s]}</option>)}
        </select>
        {/* Cliente — admin ve todos; usuario normal SOLO sus entidades
            asignadas (legal_entity_ids); con una sola, no hay selector. */}
        {clientes.length > (roleIsClient ? 1 : 0) && (
          <select className="input" value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  style={{ padding: "5px 10px", fontSize: 12.5, width: "auto", minWidth: 170, maxWidth: 240 }}>
            <option value="ALL">
              {roleIsClient
                ? (lang === "es" ? "Todos mis clientes" : "All my clients")
                : (lang === "es" ? "Todos los clientes" : "All clients")}
            </option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        {/* Proformas/PO concretas — multi-selección (vacío = todas).
            Filtra el Gantt, las stats y las demás tabs. */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="input"
            onClick={() => setProfOpen((o) => !o)}
            style={{
              padding: "5px 10px", fontSize: 12.5, width: "auto", minWidth: 160,
              textAlign: "left", cursor: "pointer",
              border: selProformas.size > 0 ? "1.5px solid #013A57" : undefined,
            }}
          >
            {selProformas.size === 0
              ? (isClient
                  ? (lang === "es" ? "Todas las PO" : "All POs")
                  : (lang === "es" ? "Todas las proformas" : "All proformas"))
              : `${isClient ? "PO" : (lang === "es" ? "Proformas" : "Proformas")} · ${selProformas.size}`}
            <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>▾</span>
          </button>
          {profOpen && (
            <>
              {/* overlay: click fuera cierra */}
              <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setProfOpen(false)}/>
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41,
                background: "var(--surface, #fff)",
                border: "1px solid var(--border-subtle, #E1E6ED)",
                borderRadius: 10, boxShadow: "0 8px 24px -8px rgba(15,27,61,0.18)",
                minWidth: 250, maxHeight: 300, overflowY: "auto", padding: 6,
              }}>
                <button
                  type="button"
                  onClick={() => setSelProformas(new Set())}
                  style={{
                    width: "100%", textAlign: "left", border: 0, background: "transparent",
                    padding: "6px 8px", fontSize: 12, cursor: "pointer",
                    color: "var(--text-secondary, #475569)", fontWeight: 600,
                    borderBottom: "1px solid var(--border-subtle, #E1E6ED)", marginBottom: 4,
                  }}
                >
                  {lang === "es" ? "Limpiar selección (todas)" : "Clear selection (all)"}
                </button>
                {proformaOpts.map((o) => (
                  <label
                    key={o.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                      fontSize: 12.5,
                      background: selProformas.has(o.id) ? "var(--surface-alt, #E8EDF3)" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selProformas.has(o.id)}
                      onChange={() => toggleProforma(o.id)}
                      style={{ accentColor: "#013A57", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                      {o.label}
                    </span>
                    <span style={{ color: "var(--text-tertiary, #94A3B8)", fontSize: 10.5, marginLeft: "auto", fontFamily: "JetBrains Mono, monospace" }}>
                      {o.sub}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Exportar HTML — abre el modal de siempre y genera el .html
            interactivo (zoom/arrastre + modal de SKUs por registro). */}
        <button className="btn btn-secondary"
                onClick={() => { setExportErr(null); setExportOpen(true); }}
                style={{ padding: "5px 14px", fontSize: 12 }}>
          {lang === "es" ? "Exportar HTML" : "Export HTML"}
        </button>
        {/* Vista dual MWT/Cliente — sólo ADMIN/CEO (R3) */}
        {!roleIsClient && (
          <div style={{ display: "flex", gap: 2, marginLeft: "auto", background: "var(--surface-alt, #E8EDF3)", borderRadius: 999, padding: 3 }}>
            {[
              { id: "MWT", label: lang === "es" ? "Vista MWT" : "MWT view" },
              { id: "CLIENT", label: lang === "es" ? "Vista Cliente" : "Client view" },
            ].map((v) => (
              <button key={v.id} onClick={() => setVista(v.id)}
                      style={{
                        padding: "4px 14px", fontSize: 11.5, fontWeight: 700, borderRadius: 999,
                        border: "none", cursor: "pointer",
                        background: vista === v.id ? "#013A57" : "transparent",
                        color: vista === v.id ? "#fff" : "var(--text-secondary, #475569)",
                        transition: "all .18s ease",
                      }}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="card card-pad-md" style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando expedientes, historial de fases y promedios…" : "Loading files, phase history and averages…"}
        </div>
      )}
      {!loading && error && (
        <div className="card card-pad-md" style={{ color: "#D64545" }}>
          {(lang === "es" ? "No se pudo cargar el cronograma: " : "Could not load the timeline: ") + error}
        </div>
      )}

      {!loading && !error && (() => {
        // Dataset enriquecido compartido por todas las vistas.
        const enriched = visibles.map((it) => {
          const segs = computeSegments(it, avgs);
          return { it, segs, delivery: projectedDelivery(it, segs) };
        });
        const TABS = [
          { id: "GANTT", es: "Cronograma", en: "Timeline" },
          { id: "ENTREGAS", es: "Próximas entregas", en: "Upcoming" },
          { id: "PIPELINE", es: "Pipeline", en: "Pipeline" },
          { id: "PARES", es: "Entrada de pares", en: "Pairs intake" },
          { id: "RECEPCION", es: "Hoja de recepción", en: "Reception sheet" },
          { id: "TABLA", es: "Expedientes", en: "Files" },
        ];
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <KpiStrip enriched={enriched} lang={lang}/>

            {/* Tabs */}
            <div style={{ display: "inline-flex", gap: 2, background: "var(--surface-alt, #E8EDF3)", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                        style={{
                          position: "relative", padding: "6px 16px", fontSize: 12.5, fontWeight: 700,
                          border: "none", borderRadius: 8, cursor: "pointer",
                          background: tab === t.id ? "#fff" : "transparent",
                          color: tab === t.id ? "#013A57" : "var(--text-secondary, #475569)",
                          boxShadow: tab === t.id ? "0 1px 4px rgba(1,58,87,0.12)" : "none",
                          transition: "all .18s ease",
                        }}>
                  {lang === "es" ? t.es : t.en}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={tab}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}>
                {tab === "GANTT" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="card card-pad-md">
                      <h4 style={{ margin: "0 0 10px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                        {lang === "es"
                          ? `CRONOGRAMA — FASES REALES Y PROYECCIÓN (${visibles.length} EXPEDIENTES)`
                          : `TIMELINE — REAL PHASES & PROJECTION (${visibles.length} FILES)`}
                      </h4>
                      <GanttChart rows={rows} lang={lang}/>
                    </div>
                    <PhaseStatsCards
                      avgs={avgs}
                      skuStats={skuStats}
                      lang={lang}
                      clienteLabel={clienteId !== "ALL" ? (clientes.find((c) => c.id === clienteId) || {}).label || "" : ""}/>
                  </div>
                )}
                {tab === "ENTREGAS" && (
                  <div className="card card-pad-md">
                    <h4 style={{ margin: "0 0 12px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                      {lang === "es" ? "PRÓXIMAS ENTREGAS" : "UPCOMING DELIVERIES"}
                    </h4>
                    <UpcomingDeliveries enriched={enriched} lang={lang} labelOf={labelOf} onOpen={setModalItem}/>
                  </div>
                )}
                {tab === "PIPELINE" && (
                  <div className="card card-pad-md">
                    <h4 style={{ margin: "0 0 12px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                      {lang === "es" ? "PIPELINE POR ESTADO" : "PIPELINE BY STATE"}
                    </h4>
                    <PipelineBoard enriched={enriched} lang={lang} labelOf={labelOf} onOpen={setModalItem}/>
                  </div>
                )}
                {tab === "PARES" && (
                  <div className="card card-pad-md">
                    <h4 style={{ margin: "0 0 12px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                      {lang === "es" ? "ENTRADA DE PARES" : "PAIRS INTAKE"}
                    </h4>
                    <PairsTable enriched={enriched} lang={lang} labelOf={labelOf}/>
                  </div>
                )}
                {tab === "RECEPCION" && (
                  <div className="card card-pad-md">
                    <h4 style={{ margin: "0 0 12px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                      {lang === "es" ? "HOJA DE RECEPCIÓN" : "RECEPTION SHEET"}
                    </h4>
                    <ReceptionSheet enriched={enriched} lang={lang} labelOf={labelOf} onOpen={setModalItem}/>
                  </div>
                )}
                {tab === "TABLA" && (
                  <div className="card card-pad-md">
                    <h4 style={{ margin: "0 0 12px", color: "#013A57", fontSize: 13, fontWeight: 800 }}>
                      {lang === "es" ? "EXPEDIENTES" : "FILES"}
                    </h4>
                    <ExpedientesTable enriched={enriched} lang={lang} labelOf={labelOf} onOpen={setModalItem} isClient={isClient}/>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        );
      })()}

      {modalItem && (
        <ExpedienteSkuModal item={modalItem} isClient={isClient} lang={lang}
                            onClose={() => setModalItem(null)}/>
      )}

      <ExportExpedientesModal
        open={exportOpen}
        lang={lang}
        isAdmin={!roleIsClient}
        clients={clientes.map((c) => ({ id: c.id, name: c.label }))}
        estados={STAGES.map((s) => ({ code: s, label: L[s] }))}
        expedientes={exportRows}
        loading={exporting}
        error={exportErr || ""}
        onConfirm={handleExportHtml}
        onClose={() => { if (!exporting) { setExportOpen(false); setExportErr(null); } }}
      />
    </div>
  );
}
