// frontend/src/pages/FusionDetail.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 (rev2) · Detalle COMBINADO de expedientes fusionados.
//
// Mismo lenguaje visual que OCDetail (kpi-tile, card, sap-group,
// doc-item, grid 1fr/340px): el usuario ve "un expediente" pero con el
// contenido de los N miembros — Líneas de la OC agrupadas por SAP,
// Productos OC, Documentos comerciales, Costos de movimientos y Pagos
// de costos logísticos — cada cosa identificada por su ORIGEN:
//   · ADMIN/CEO → número de PROFORMA del miembro (código de la OC).
//   · CLIENT_*  → número de PO del cliente (R3 · POL_VISIBILIDAD; el
//     precio MWT ni siquiera se renderiza en la rama CLIENT).
//
// READ-ONLY: la edición vive en el detalle individual de cada miembro
// ("Abrir ›" en EXPEDIENTES DE LA FUSIÓN) — no se duplica la lógica de
// mutación de OCDetail.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import {
  expedientesApi, ocsApi, lineasApi, documentosApi, clientesApi,
  productosApi, storageApi, getToken,
} from "../lib/api.js";
import { tr, fmtMoney } from "../lib/i18n.js";
import { StatusBadge, CreditDot } from "../components/ui/primitives.jsx";
import {
  IconChevLeft, IconChevDown, IconChevRight, IconFolder, IconPlane,
  IconShip, IconAlert, IconEye, IconPlus, IconPencil,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { OCPagosCard, OCTransferCostsCard } from "./OCDetail.jsx";
// Sprint 2026-06-11 · acciones sobre la fusión: el drawer C5 en modo
// multiExp (líneas de varios miembros) y el modal de documento con
// selector "Pertenece a".
import AddSAPConfirmationDrawer from "../components/expedientes/AddSAPConfirmationDrawer.jsx";
import UploadDocumentModal from "../components/expedientes/UploadDocumentModal.jsx";

// Chip de ORIGEN del miembro (proforma para staff / PO para cliente).
function OriginChip({ text }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600,
      padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap",
      background: "color-mix(in oklab, var(--brand-accent) 10%, transparent)",
      border: "1px solid color-mix(in oklab, var(--brand-accent) 35%, transparent)",
      color: "var(--brand-primary)",
    }}>
      {text}
    </span>
  );
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

function extOf(d) {
  const raw = d.file_ext || ((d.codigo || d.filename || "").split(".").pop() || "");
  return String(raw || "file").toLowerCase().replace(/^\./, "");
}

export default function ScreenFusionDetail() {
  const { fusionId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isAdmin, isClient, can } = useRole();
  const es = lang === "es";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // members: [{ exp (fila del listado), oc, lineas[], docs[] }]
  const [members, setMembers] = useState([]);
  const [clientName, setClientName] = useState("");
  const [nameMap, setNameMap] = useState({});
  const [openSap, setOpenSap] = useState(null);
  const [viewingDocId, setViewingDocId] = useState(null);
  const [docError, setDocError] = useState(null);
  // Acciones de la fusión (CEO-ONLY) + re-fetch tras mutación.
  const [sapOpen, setSapOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Alias editable del grupo (fusion_label · ADMIN/CEO-only).
  const [labelEdit, setLabelEdit] = useState(null);   // string | null
  const [labelSaving, setLabelSaving] = useState(false);

  // ORIGEN del miembro (R3): proforma para staff, PO para cliente.
  const badgeOf = (m) =>
    !isClient
      ? (m.oc?.codigo || m.exp.proforma_codigo || m.exp.codigo)
      : (((m.exp.oc_codigos || [])[0]) || m.exp.codigo);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const listRaw = await expedientesApi.list();
        const arr = Array.isArray(listRaw) ? listRaw : (listRaw?.results || []);
        const exps = arr.filter((r) => String(r.fusion_id || "") === String(fusionId));
        if (!exps.length) {
          throw new Error(es ? "Fusión no encontrada" : "Fusion not found");
        }
        const loaded = await Promise.all(exps.map(async (r) => {
          if (!r.oc_id) return { exp: r, oc: null, lineas: [], docs: [] };
          const [oc, lns, docs] = await Promise.all([
            ocsApi.get(r.oc_id).catch(() => null),
            lineasApi.list({ oc: r.oc_id }).catch(() => []),
            documentosApi.list({ oc: r.oc_id }).catch(() => []),
          ]);
          return {
            exp: r,
            oc,
            lineas: Array.isArray(lns) ? lns : (lns?.results || []),
            docs: Array.isArray(docs) ? docs : (docs?.results || []),
          };
        }));
        if (cancel) return;
        setMembers(loaded);
        const cid = exps[0].client_id;
        if (cid) {
          clientesApi.get(cid)
            .then((c) => {
              if (!cancel) {
                setClientName(c?.razon_social || c?.nombre_comercial || c?.name || c?.nombre || "");
              }
            })
            .catch(() => { /* nombre opcional */ });
        }
        // Nombres reales de producto (mismo patrón que OCDetail:
        // l.product_label suele venir igual al SKU).
        const pids = Array.from(new Set(
          loaded.flatMap((m) => m.lineas.map((l) => l.producto_id)).filter(Boolean)
        ));
        if (pids.length) {
          const prods = await Promise.all(
            pids.map((pid) => productosApi.get(pid).catch(() => null))
          );
          if (!cancel) {
            const nm = {};
            for (const p of prods) {
              if (p?.id && p.nombre) nm[p.id] = p.nombre;
            }
            setNameMap(nm);
          }
        }
      } catch (e2) {
        if (!cancel) setError(e2?.message || String(e2));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fusionId, reloadKey]);

  // Ver documento — mismo flujo que OCDetail.handleViewDoc.
  const openDoc = async (doc) => {
    if (!doc?.id || viewingDocId === doc.id) return;
    setViewingDocId(doc.id);
    setDocError(null);
    try {
      const resp = await storageApi.documentSignedUrl(doc.id, 900);
      const url = resp?.url;
      if (!url) throw new Error(resp?.error || (es ? "URL no disponible" : "URL unavailable"));
      if (resp?.dynamic === true) {
        const apiBase = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";
        const fullUrl = url.startsWith("/") ? url : `${apiBase}${url}`;
        const token = getToken() || "";
        const r = await fetch(fullUrl, {
          method: "GET",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const html = await r.text();
        const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        return;
      }
      const ext = extOf(doc);
      const downloadExts = new Set(["xlsx", "xls", "xlsm", "csv", "docx", "doc", "zip"]);
      if (downloadExts.has(ext)) {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.codigo || doc.filename || `${doc.id}.${ext}`;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e2) {
      setDocError(
        es
          ? `No se pudo abrir el documento: ${e2.message || "error"}`
          : `Couldn't open document: ${e2.message || "error"}`
      );
    } finally {
      setViewingDocId(null);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "32px 0" }}>
          {es ? "Cargando detalle fusionado…" : "Loading merged detail…"}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/expedientes")}>
          <IconChevLeft size={14}/> {tr(lang, "back_to_list")}
        </button>
        <div className="body-sm" style={{ color: "var(--critical)", marginTop: 14 }}>{error}</div>
      </div>
    );
  }

  // ── Derivados (campos REALES de lineasApi: qty, talla/size,
  //    unit_price_mwt / unit_price_client, total_price, sap) ─────────
  const label = members[0]?.exp.fusion_label
    || ((members[0]?.exp.oc_codigos || []).find((c) =>
          members.every((m) => (m.exp.oc_codigos || []).includes(c)))
    || (es ? "Fusión" : "Merged"));

  const priceOf = (l) => {
    if (isClient) {
      const pc = Number(l.unit_price_client ?? 0);
      return pc > 0 ? pc : Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
    }
    const pm = Number(l.unit_price_mwt ?? 0);
    return pm > 0 ? pm : Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
  };
  const lineTotal = (l) => {
    const tp = Number(l.total_price || 0);
    return tp > 0 ? tp : priceOf(l) * Number(l.qty || 0);
  };
  const nameOf = (l) =>
    (l.producto_id && nameMap[l.producto_id]) || l.product_label || l.sku || "—";

  const allLines = members.flatMap((m) =>
    m.lineas.map((l) => ({ l, badge: badgeOf(m), m }))
  );
  const totalValue = allLines.reduce((a, { l }) => a + lineTotal(l), 0);
  const totalUnits = allLines.reduce((a, { l }) => a + Number(l.qty || 0), 0);
  const linesWithSap = allLines.filter(({ l }) => !!l.sap).length;
  const covPct = allLines.length ? linesWithSap / allLines.length : 0;
  const covColor = covPct >= 1 ? "var(--success)" : covPct >= 0.75 ? "var(--warning)" : "var(--critical)";
  const seaQty = allLines
    .filter(({ l }) => /^(MARITIMO|SEA)$/i.test(String(l.transport_mode || "").normalize("NFD").replace(/[̀-ͯ]/g, "")))
    .reduce((a, { l }) => a + Number(l.qty || 0), 0);
  const airQty = allLines
    .filter(({ l }) => /^(AEREO|AIR)$/i.test(String(l.transport_mode || "").normalize("NFD").replace(/[̀-ͯ]/g, "")))
    .reduce((a, { l }) => a + Number(l.qty || 0), 0);
  const seaPct = totalUnits > 0 ? seaQty / totalUnits : 0;
  const airPct = totalUnits > 0 ? airQty / totalUnits : 0;
  const maxCredit = Math.max(0, ...members.map((m) => Number(m.exp.credit_days) || 0));
  const creditBand = maxCredit > 75 ? "RED" : maxCredit > 60 ? "AMBER" : "GREEN";

  // Documentos visibles (filtro de audiencia idéntico a OCDetail).
  const allDocs = members.flatMap((m) =>
    m.docs
      .filter((d) => {
        const aud = String(d.audience || "CLIENT").toUpperCase();
        const isArt04 = String(d.kind || "").toUpperCase() === "ART-04";
        if (isClient) {
          if (isArt04) return false;
          return aud === "CLIENT";
        }
        return true;
      })
      .map((d) => ({ d, badge: badgeOf(m) }))
  );

  // Grupos SAP por miembro (estructura del card "Líneas de la OC").
  const sapGroups = members.flatMap((m) => {
    const by = new Map();
    for (const l of m.lineas) {
      const k = l.sap || "";
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(l);
    }
    return Array.from(by.entries()).map(([sap, lines], i) => ({
      key: `${m.exp.id}-${sap || "orphan" + i}`,
      m, sap, lines,
      qty: lines.reduce((a, l) => a + Number(l.qty || 0), 0),
      value: lines.reduce((a, l) => a + lineTotal(l), 0),
      tm: String(lines.find((l) => l.transport_mode)?.transport_mode || "").toUpperCase(),
    }));
  });

  // Líneas SIN SAP de miembros en REGISTRO — candidatas a "Agregar SAP".
  // Cada una lleva su ORIGEN (proforma admin / PO cliente) y su
  // expediente_id para que el drawer (multiExp) confirme contra el
  // miembro correcto.
  const sapCandidates = members
    .filter((m) => String(m.exp.estado || "").toUpperCase() === "REGISTRO")
    .flatMap((m) => m.lineas
      .filter((l) => !l.sap)
      .map((l) => ({
        id: l.id,
        sku: l.sku,
        size: l.talla || l.size || "",
        qty: Number(l.qty || 0),
        unit_price: priceOf(l),
        producto_id: l.producto_id || null,
        descripcion: nameOf(l),
        origin: badgeOf(m),
        expediente_id: m.exp.id,
      })));
  const firstRegistro = members.find(
    (m) => String(m.exp.estado || "").toUpperCase() === "REGISTRO"
  );

  const transportChip = (tm) => {
    const t = tm.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (t.startsWith("AER") || t === "AIR") {
      return <span className="transport-chip air"><IconPlane size={11}/> {tr(lang, "transport_air")}</span>;
    }
    if (t.startsWith("MAR") || t === "SEA") {
      return <span className="transport-chip sea"><IconShip size={11}/> {tr(lang, "transport_sea")}</span>;
    }
    return null;
  };

  return (
    <div className="page" data-screen-label="Fusion Detail">
      {/* ── Header (mismo lenguaje que OCDetail) ───────────────── */}
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <div className="flex ai-center gap-3" style={{ marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/expedientes")}>
              <IconChevLeft size={14}/> {tr(lang, "back_to_list")}
            </button>
            <span className="caption" style={{ color: "var(--text-tertiary)" }}>•</span>
            <span className="micro">
              {isClient
                ? (es ? "OC DEL CLIENTE · FUSIÓN" : "CLIENT PO · MERGED")
                : (es ? "FUSIÓN DE EXPEDIENTES" : "MERGED EXPEDIENTES")}
            </span>
          </div>
          <div className="flex ai-center gap-3" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            {labelEdit === null ? (
              <>
                <h1 className="page-title" style={{ margin: 0 }}>{label}</h1>
                {/* Lápiz — renombrar el grupo (fusion_label · CEO-ONLY).
                    El cliente también ve el nuevo nombre. */}
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title={es ? "Editar nombre visible" : "Edit display name"}
                    onClick={() => setLabelEdit(label === (es ? "Fusión" : "Merged") ? "" : label)}
                    style={{ padding: "4px 6px" }}
                  >
                    <IconPencil size={13}/>
                  </button>
                )}
              </>
            ) : (
              <div className="flex ai-center gap-2">
                <input
                  className="input"
                  autoFocus
                  value={labelEdit}
                  maxLength={64}
                  disabled={labelSaving}
                  onChange={(ev) => setLabelEdit(ev.target.value)}
                  onKeyDown={async (ev) => {
                    if (ev.key === "Escape") { setLabelEdit(null); return; }
                    if (ev.key !== "Enter" || labelSaving) return;
                    const v = String(labelEdit || "").trim().slice(0, 64);
                    setLabelSaving(true);
                    try {
                      await expedientesApi.action("fusion-label", null, {
                        fusion_id: fusionId,
                        label: v || null,
                      });
                      setLabelEdit(null);
                      setReloadKey((k) => k + 1);
                    } catch { /* mantener edición para reintentar */ }
                    setLabelSaving(false);
                  }}
                  placeholder={es ? "Nombre visible…" : "Display name…"}
                  style={{
                    font: "800 26px/1.2 var(--font-display)",
                    padding: "4px 10px", width: "auto", minWidth: 260,
                  }}
                />
                <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {labelSaving
                    ? (es ? "Guardando…" : "Saving…")
                    : (es ? "Enter guarda · Esc cancela · vacío = PO común" : "Enter saves · Esc cancels · empty = common PO")}
                </span>
              </div>
            )}
            <span className="oc-status-chip" style={{
              color: "var(--brand-primary)",
              background: "color-mix(in oklab, var(--brand-accent) 12%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-accent) 40%, transparent)",
              fontWeight: 600,
            }}>
              {es ? `Fusión · ${members.length} expedientes` : `Merged · ${members.length} expedientes`}
            </span>
          </div>
          <div className="flex ai-center gap-3 page-subtitle" style={{ flexWrap: "wrap" }}>
            {clientName && (
              <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{clientName}</span>
            )}
            {clientName && <span>·</span>}
            <span>
              {allLines.length} {tr(lang, "lines_count").toLowerCase()} · {totalUnits.toLocaleString("en-US")} u · {members.length} {tr(lang, "expedientes").toLowerCase()}
            </span>
          </div>
        </div>

        {/* Acciones de la fusión (CEO-ONLY, mismos gates que OCDetail). */}
        <div className="flex gap-2">
          {can("register_sap") && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSapOpen(true)}
              disabled={sapCandidates.length === 0}
              title={sapCandidates.length === 0
                ? (es
                    ? "No hay líneas pendientes de SAP en miembros en REGISTRO"
                    : "No pending-SAP lines in REGISTRO members")
                : ""}
              style={{ background: "var(--brand-primary)" }}
            >
              <IconPlus size={14}/>{es ? "Agregar SAP" : "Add SAP"}
            </button>
          )}
          {can("upload_document") && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setUploadOpen(true)}
            >
              <IconPlus size={14}/>{tr(lang, "add_document")}
            </button>
          )}
        </div>
      </div>

      {/* ── KPI row (paridad con OCDetail) ─────────────────────── */}
      <div className={`grid gap-3 mb-4 ${isClient ? "col-3" : "col-4"}`}>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang, "oc_coverage")}</div>
          <div className="k-value" style={{ color: covColor }}>{Math.round(covPct * 100)}%</div>
          <div className="k-sub">
            <span style={{ color: "var(--text-secondary)" }}>{linesWithSap}/{allLines.length}</span>
            <span>{tr(lang, "coverage_sub")}</span>
          </div>
          <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
            <div style={{ height: "100%", width: (covPct * 100) + "%", background: covColor }}/>
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang, "logistics_split")}</div>
          <div className="k-value" style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 28 }}>
            <span style={{ color: "var(--brand-accent)" }}>{Math.round(seaPct * 100)}%</span>
            <span className="caption" style={{ fontSize: 11 }}>{tr(lang, "transport_sea")}</span>
            <span className="caption" style={{ color: "var(--text-tertiary)", margin: "0 4px" }}>/</span>
            <span style={{ color: "var(--brand-primary)" }}>{Math.round(airPct * 100)}%</span>
            <span className="caption" style={{ fontSize: 11 }}>{tr(lang, "transport_air")}</span>
          </div>
          <div className="split-bar" style={{ marginTop: 12 }}>
            <div className="seg sea" style={{ width: (seaPct * 100) + "%" }}/>
            <div className="seg air" style={{ width: (airPct * 100) + "%" }}/>
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang, "financial_status")}</div>
          <div className="k-value" style={{ fontSize: 24, whiteSpace: "nowrap" }}>
            {fmtMoney(totalValue)}
          </div>
          <div className="k-sub">
            <span>
              {es
                ? `Valor combinado de ${members.length} expedientes`
                : `Combined value of ${members.length} expedientes`}
            </span>
          </div>
        </div>
        {isAdmin && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang, "credit_clock")}</div>
            <div className="k-value" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <CreditDot band={creditBand}/>
              <span style={{
                color: creditBand === "RED" ? "var(--critical)" : creditBand === "AMBER" ? "var(--warning)" : "var(--success)",
              }}>{maxCredit}d</span>
            </div>
            <div className="k-sub">
              <span>{es ? "Máximo entre los miembros" : "Max across members"}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Main grid: Líneas + Productos | Documentos ─────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 340px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>

          {/* Líneas de la OC — grupos SAP de TODOS los miembros */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{tr(lang, "oc_lines")}</div>
                <div className="card-subtitle">
                  {tr(lang, "grouped_by_sap")} · {allLines.length} {tr(lang, "lines_count").toLowerCase()} · {members.length} {tr(lang, "expedientes").toLowerCase()}
                </div>
              </div>
            </div>
            <div>
              {sapGroups.map((g) => {
                const isOpen = openSap === g.key;
                return (
                  <div key={g.key} className="sap-group" data-orphan={!g.sap}>
                    <div className="sap-group-head" onClick={() => setOpenSap(isOpen ? null : g.key)}>
                      <div className="flex ai-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                        <IconChevDown size={14} style={{
                          color: "var(--text-tertiary)",
                          transform: isOpen ? "none" : "rotate(-90deg)",
                          transition: "transform 160ms",
                        }}/>
                        <OriginChip text={badgeOf(g.m)}/>
                        {g.sap ? (
                          <a
                            className="sap-link"
                            onClick={(ev) => { ev.stopPropagation(); g.m.exp.oc_id && navigate(`/expedientes/${g.m.exp.oc_id}`); }}
                            title={es ? "Abrir detalle del expediente" : "Open expediente detail"}
                          >
                            <IconFolder size={12}/> {g.sap}
                          </a>
                        ) : (
                          <span className="sap-link orphan">
                            <IconAlert size={12}/> {tr(lang, "pending_sap")}
                          </span>
                        )}
                        <span className="caption" style={{ color: "var(--text-tertiary)" }}>→</span>
                        <span className="caption" style={{ fontFamily: "var(--font-mono)" }}>{g.m.exp.codigo}</span>
                        {transportChip(g.tm)}
                        <StatusBadge status={g.m.exp.estado} lang={lang}/>
                      </div>
                      <div className="flex ai-center gap-3" style={{ marginLeft: "auto" }}>
                        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                          {g.lines.length} {tr(lang, "lines_count").toLowerCase()} · {g.qty.toLocaleString()} u
                        </span>
                        <span className="td-money" style={{ minWidth: 110, textAlign: "right" }}>{fmtMoney(g.value)}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="sap-lines">
                        <div className="sap-lines-head" style={{
                          display: "grid", gridTemplateColumns: "1fr 90px 90px",
                          gap: 12, padding: "8px 14px",
                        }}>
                          <div style={{ textAlign: "left" }}>{tr(lang, "product_line")}</div>
                          <div style={{ textAlign: "center" }}>{es ? "Talla" : "Size"}</div>
                          <div style={{ textAlign: "right" }}>{es ? "Cant." : "Qty"}</div>
                        </div>
                        {g.lines.map((l) => (
                          <div key={l.id} className="sap-line" style={{
                            display: "grid", gridTemplateColumns: "1fr 90px 90px",
                            gap: 12, padding: "10px 14px", alignItems: "center",
                          }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="body-sm" style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {nameOf(l)}
                              </div>
                              <div className="caption" style={{ fontFamily: "var(--font-mono)", marginTop: 2 }}>{l.sku}</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <span className="size-chip">{l.talla || l.size || "—"}</span>
                            </div>
                            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                              {Number(l.qty || 0).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 22px", borderTop: "1px solid var(--divider)",
              background: "var(--bg-alt)",
            }}>
              <span className="micro">{es ? "Valor total fusionado" : "Merged total value"}</span>
              <span style={{ font: "800 18px/1 var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(totalValue)}</span>
            </div>
          </div>

          {/* Productos OC (combinado · read-only) */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{es ? "Productos OC" : "PO Products"}</div>
                <div className="card-subtitle">
                  {allLines.length} {es ? "líneas" : "lines"} · {members.length} {es ? "expedientes · solo lectura" : "expedientes · read-only"} · {fmtMoney(totalValue)} {es ? "total" : "total"}
                </div>
              </div>
            </div>
            <div style={{ overflowX: "auto", overflowY: "hidden" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 110, whiteSpace: "nowrap" }}>{es ? "Origen" : "Origin"}</th>
                    <th style={{ width: 120 }}>SKU</th>
                    <th style={{ whiteSpace: "nowrap" }}>{es ? "Nombre" : "Name"}</th>
                    <th style={{ width: 70, textAlign: "center" }}>{es ? "Talla" : "Size"}</th>
                    <th style={{ width: 80, textAlign: "right" }}>{es ? "Cant." : "Qty"}</th>
                    {/* R3 · la columna Precio MWT NO existe en la rama CLIENT. */}
                    {!isClient && (
                      <th style={{ width: 120, textAlign: "right", whiteSpace: "nowrap" }}>
                        {es ? "Precio MWT" : "MWT Price"}
                      </th>
                    )}
                    <th style={{
                      width: 120, textAlign: "right", whiteSpace: "nowrap",
                      background: "color-mix(in oklab, var(--brand-accent) 6%, transparent)",
                    }}>
                      {es ? "Precio Cliente" : "Client Price"}
                    </th>
                    <th style={{ width: 110, textAlign: "right" }}>Total</th>
                    <th style={{ width: 120 }}>SAP</th>
                  </tr>
                </thead>
                <tbody>
                  {allLines.map(({ l, badge }) => (
                    <tr key={l.id} data-orphan={!l.sap}>
                      <td><OriginChip text={badge}/></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{l.sku}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{nameOf(l)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="size-chip">{l.talla || l.size || "—"}</span>
                      </td>
                      <td className="td-num" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {Number(l.qty || 0).toLocaleString()}
                      </td>
                      {!isClient && (
                        <td className="td-num tabular-nums" style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                          ${Number(l.unit_price_mwt || 0).toFixed(2)}
                        </td>
                      )}
                      <td className="td-num tabular-nums" style={{
                        textAlign: "right",
                        background: "color-mix(in oklab, var(--brand-accent) 4%, transparent)",
                      }}>
                        ${Number(l.unit_price_client || 0).toFixed(2)}
                      </td>
                      <td className="td-money">{fmtMoney(lineTotal(l))}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {l.sap || (
                          <span className="caption" style={{ color: "var(--warning)" }}>
                            {tr(lang, "pending_sap")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4}>{es ? "Total fusionado" : "Merged total"}</td>
                    <td className="td-num" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {totalUnits.toLocaleString()}
                    </td>
                    {!isClient && <td/>}
                    <td/>
                    <td className="td-money">{fmtMoney(totalValue)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* ── Documents hub (combinado) ──────────────────────────── */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang, "documents_hub")}</div>
              <div className="card-subtitle">
                {allDocs.length} {es ? "archivos" : "files"} · {members.length} {es ? "expedientes" : "expedientes"}
              </div>
            </div>
          </div>
          <div style={{ padding: "8px 0" }}>
            {docError && (
              <div style={{
                margin: "0 22px 10px", padding: "8px 12px", borderRadius: 8,
                background: "color-mix(in oklab, var(--danger, #DC2626) 12%, transparent)",
                color: "var(--danger, #991B1B)",
                border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)",
                fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6,
              }}>
                <IconAlert size={11} style={{ flexShrink: 0, marginTop: 2 }}/>
                <div style={{ flex: 1 }}>{docError}</div>
              </div>
            )}
            {allDocs.length === 0 && (
              <div className="caption" style={{ padding: "12px 22px", color: "var(--text-tertiary)", textAlign: "center" }}>
                {es ? "Aún no hay documentos." : "No documents yet."}
              </div>
            )}
            {allDocs.map(({ d, badge }) => {
              const ext = extOf(d);
              const isViewing = viewingDocId === d.id;
              return (
                <div
                  key={d.id}
                  className="doc-item"
                  onClick={() => openDoc(d)}
                  style={{ cursor: "pointer", opacity: isViewing ? 0.7 : 1, transition: "opacity 0.15s" }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDoc(d); }
                  }}
                  title={es ? "Click para abrir el documento" : "Click to open document"}
                >
                  <div className={"doc-icon ext-" + ext}>{ext.toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex ai-center gap-2">
                      <div className="body-sm" style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(d.kind || "—")}
                      </div>
                      <OriginChip text={badge}/>
                    </div>
                    <div className="caption" style={{ marginTop: 2, fontFamily: "var(--font-mono)" }}>
                      {d.codigo || d.filename || "—"}
                    </div>
                    <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 3 }}>
                      {(d.fecha || d.created_at || "").slice(0, 10) || "—"} · {fmtBytes(d.file_size_bytes ?? d.file_size)} · {d.author || d.created_by_name || d.uploaded_by || "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    title={es ? "Abrir documento" : "Open document"}
                    disabled={isViewing}
                    onClick={(ev) => { ev.stopPropagation(); openDoc(d); }}
                  >
                    <IconEye size={13}/>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Expedientes de la fusión */}
          <div style={{ borderTop: "1px solid var(--divider)", padding: "16px 22px" }}>
            <div className="micro" style={{ marginBottom: 10 }}>
              {es ? "EXPEDIENTES DE LA FUSIÓN" : "MERGED EXPEDIENTES"}
            </div>
            {members.map((m) => (
              <div
                key={m.exp.id}
                className="exp-link-row"
                onClick={() => m.exp.oc_id && navigate(`/expedientes/${m.exp.oc_id}`)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex ai-center gap-2">
                    <IconFolder size={12} style={{ color: "var(--text-tertiary)" }}/>
                    <span className="body-sm" style={{ fontWeight: 600 }}>{badgeOf(m)}</span>
                    <span className="caption" style={{ fontFamily: "var(--font-mono)" }}>{m.exp.codigo}</span>
                  </div>
                  <div className="caption" style={{ marginTop: 2 }}>
                    {m.lineas.length} {tr(lang, "lines_count").toLowerCase()} · {m.lineas.reduce((a, l) => a + Number(l.qty || 0), 0).toLocaleString()} u
                  </div>
                </div>
                <StatusBadge status={m.exp.estado} lang={lang}/>
                <IconChevRight size={13} style={{ color: "var(--text-tertiary)" }}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Costos de movimientos (card por miembro) ───────────── */}
      {members.map((m) => m.exp.oc_id && (
        <div key={`cost-${m.exp.id}`}>
          <div className="flex ai-center gap-2" style={{ marginTop: 16 }}>
            <OriginChip text={badgeOf(m)}/>
            <span className="caption" style={{ fontFamily: "var(--font-mono)" }}>{m.exp.codigo}</span>
          </div>
          <OCTransferCostsCard ocId={m.exp.oc_id} lang={lang} navigate={navigate}/>
        </div>
      ))}

      {/* ── Pagos de costos logísticos (card por miembro · staff) ─ */}
      {isAdmin && members.map((m) => m.exp.oc_id && (
        <div key={`pago-${m.exp.id}`}>
          <div className="flex ai-center gap-2" style={{ marginTop: 16 }}>
            <OriginChip text={badgeOf(m)}/>
            <span className="caption" style={{ fontFamily: "var(--font-mono)" }}>{m.exp.codigo}</span>
          </div>
          <OCPagosCard ocId={m.exp.oc_id} lang={lang}/>
        </div>
      ))}

      {/* ── Drawer C5 · Agregar SAP en modo FUSIÓN ─────────────────
          Las líneas candidatas vienen de TODOS los miembros en REGISTRO
          sin SAP, con chip de origen (proforma). El drawer agrupa por
          expediente al confirmar (mismo SAP → un ART-04 por miembro). */}
      {can("register_sap") && (
        <AddSAPConfirmationDrawer
          open={sapOpen}
          onClose={() => setSapOpen(false)}
          lang={lang}
          multiExp
          oc={{
            id: firstRegistro?.exp.oc_id || members[0]?.exp.oc_id || null,
            codigo: label,
          }}
          expediente={{
            id: firstRegistro?.exp.id || members[0]?.exp.id || null,
            codigo: label,
            estado: "REGISTRO",
          }}
          lines={sapCandidates}
          onSuccess={() => {
            setSapOpen(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {/* ── Modal Agregar documento — pregunta "Pertenece a" (miembro)
          arriba del tipo; el doc queda relacionado a esa proforma/PO. */}
      {uploadOpen && can("upload_document") && (
        <UploadDocumentModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          lang={lang}
          contextLabel={label}
          targetOptions={members.map((m) => ({
            label: `${badgeOf(m)} · ${m.exp.codigo}`,
            ocId: m.exp.oc_id,
            expedienteId: m.exp.id,
            creditDays: Number(m.exp.credit_days) || 90,
          }))}
          onUploaded={() => {
            setUploadOpen(false);
            // Margen para el HTML autogenerado del backend (PROFORMA/OC).
            setTimeout(() => setReloadKey((k) => k + 1), 700);
          }}
        />
      )}
    </div>
  );
}
