// Command palette — buscador del header (Cmd+K)
// Sprint 2026-06-13 · Búsqueda role-aware sobre datos reales:
//   · ADMIN/CEO/staff → busca por nº de proforma, OC o nº SAP (+ cliente).
//   · CLIENT_*/normal → busca SOLO por OC (sus propias OCs) (+ cliente).
// El listado /expedientes/ ya entrega los códigos scopeados por rol
// (al cliente solo le llegan oc_codigos; proformas/saps van []), así que
// el matching honra R3 tanto en datos como en lógica.
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { tr } from "../lib/i18n.js";
import {
  IconHome, IconFolder, IconKanban, IconDollar, IconWarehouse, IconBuilding,
  IconPlus, IconSearch,
} from "../lib/icons.jsx";
import { KEY_TO_PATH } from "./layout/Sidebar.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { expedientesApi, clientesApi } from "../lib/api.js";
import { STAGE_LABELS } from "../lib/cronogramaData.js";

const arr = (a) => (Array.isArray(a) ? a : []);
const poLabel = (oc) => (oc ? (/^po[\s_-]/i.test(String(oc)) ? oc : `PO ${oc}`) : "");

export function CommandPalette({ lang, onClose }) {
  const navigate = useNavigate();
  const { isClient } = useRole();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [exps, setExps] = useState([]);
  const [cliMap, setCliMap] = useState({});

  // Carga real de expedientes (+ nombres de cliente) al abrir el palette.
  useEffect(() => {
    const c = new AbortController();
    (async () => {
      try {
        const list = await expedientesApi.list(undefined, { signal: c.signal });
        const rows = Array.isArray(list) ? list : (list?.results || []);
        setExps(rows.filter((r) => r && r.is_active !== false));
      } catch { /* abort / red → sin expedientes */ }
      try {
        const cl = await clientesApi.list(undefined, { signal: c.signal });
        const list2 = Array.isArray(cl) ? cl : (cl?.results || []);
        const m = {};
        list2.forEach((x) => { if (x?.id) m[x.id] = x.razon_social || x.nombre || x.codigo || ""; });
        setCliMap(m);
      } catch { /* best-effort: sin nombre de cliente */ }
    })();
    return () => c.abort();
  }, []);

  const goScreen = (key) => { const path = KEY_TO_PATH[key]; if (path) navigate(path); };
  const openExpediente = (e) => {
    if (e.oc_id) navigate(`/expedientes/${e.oc_id}/exp/${e.id}`);
    else navigate(`/expedientes`);
  };

  // Etiqueta visible + tokens de búsqueda según rol.
  const codeLabel = (e) => {
    if (isClient) return poLabel(arr(e.oc_codigos)[0]) || e.codigo || "—";
    return arr(e.proforma_codigos)[0] || arr(e.sap_codigos)[0] || e.codigo || "—";
  };
  const searchOf = (e) => {
    const cli = cliMap[e.client_id] || "";
    const codes = isClient
      ? arr(e.oc_codigos)
      : [...arr(e.proforma_codigos), ...arr(e.oc_codigos), ...arr(e.sap_codigos)];
    return [...codes, cli].join(" ").toLowerCase();
  };
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;

  const navActions = useMemo(() => [
    { id: "nav-dashboard", label: tr(lang, "dashboard"), icon: <IconHome size={14} />, kind: "nav", run: () => goScreen("dashboard") },
    { id: "nav-exps", label: tr(lang, "expedientes"), icon: <IconFolder size={14} />, kind: "nav", run: () => goScreen("expedientes") },
    { id: "nav-pipe", label: tr(lang, "pipeline"), icon: <IconKanban size={14} />, kind: "nav", run: () => goScreen("pipeline") },
    { id: "nav-pagos", label: tr(lang, "financiero"), icon: <IconDollar size={14} />, kind: "nav", run: () => goScreen("pagos") },
    { id: "nav-inv", label: tr(lang, "inventario"), icon: <IconWarehouse size={14} />, kind: "nav", run: () => goScreen("inventario") },
    { id: "nav-portal", label: tr(lang, "portal"), icon: <IconBuilding size={14} />, kind: "nav", run: () => goScreen("portal") },
    { id: "act-new", label: tr(lang, "new_expediente"), icon: <IconPlus size={14} />, kind: "action", meta: "⌘N", run: () => goScreen("wizard") },
  ].map((a) => ({ ...a, search: a.label.toLowerCase() })), [lang]);

  const expActions = useMemo(() => exps.map((e) => {
    const cli = cliMap[e.client_id] || "";
    return {
      id: e.id, kind: "exp", icon: <IconFolder size={14} />,
      label: codeLabel(e) + (cli ? " · " + cli : ""),
      meta: L[String(e.estado || "").toUpperCase()] || e.estado || "",
      search: searchOf(e),
      run: () => openExpediente(e),
    };
  }), [exps, cliMap, isClient, lang]);

  const qq = q.trim().toLowerCase();
  const navFiltered = navActions.filter((a) => !qq || a.search.includes(qq));
  const expFiltered = expActions.filter((a) => a.search.includes(qq)).slice(0, qq ? 12 : 8);
  const filtered = [...navFiltered.filter((a) => a.kind === "nav"), ...navFiltered.filter((a) => a.kind === "action"), ...expFiltered];

  const grouped = {
    [lang === "es" ? "Navegación" : "Navigation"]: filtered.filter((a) => a.kind === "nav"),
    [lang === "es" ? "Acciones" : "Actions"]: filtered.filter((a) => a.kind === "action"),
    [lang === "es" ? "Expedientes" : "Files"]: filtered.filter((a) => a.kind === "exp"),
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [filtered, active, onClose]);

  const placeholder = lang === "es"
    ? (isClient ? "Busca un comando, OC o cliente…" : "Busca un comando, proforma, OC, SAP o cliente…")
    : (isClient ? "Search a command, PO or client…" : "Search a command, proforma, PO, SAP or client…");

  let idx = -1;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="cmd-modal" role="dialog">
        <div className="cmd-input-wrap">
          <IconSearch size={16} style={{ color: "var(--text-tertiary)" }} />
          <input autoFocus placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmd-list">
          {Object.entries(grouped).map(([group, gitems]) => gitems.length > 0 && (
            <div key={group}>
              <div className="cmd-section-title">{group}</div>
              {gitems.map((it) => {
                idx++;
                const myIdx = idx;
                return (
                  <div key={it.id} className="cmd-item" data-active={active === myIdx}
                       onMouseEnter={() => setActive(myIdx)}
                       onClick={() => { it.run(); onClose(); }}>
                    <span className="icon">{it.icon}</span>
                    <span>{it.label}</span>
                    {it.meta && <span className="meta">{it.meta}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty"><IconSearch size={18} />{lang === "es" ? "Sin resultados" : "No results"}</div>}
        </div>
        <div className="cmd-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> {lang === "es" ? "navegar" : "navigate"}</span>
          <span><span className="kbd">↵</span> {lang === "es" ? "abrir" : "open"}</span>
          <span><span className="kbd">ESC</span> {lang === "es" ? "cerrar" : "close"}</span>
        </div>
      </div>
    </>
  );
}
