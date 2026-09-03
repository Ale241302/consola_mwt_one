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
  productosApi, storageApi, getToken, storageUrl,
  // Sprint 2026-06-11 (rev3) · tablas combinadas de costos y pagos.
  nodoAssignmentsApi, financePaymentsApi,
} from "../lib/api.js";
import { tr, fmtMoney } from "../lib/i18n.js";
import { StatusBadge, CreditDot } from "../components/ui/primitives.jsx";
import {
  IconChevLeft, IconChevDown, IconChevRight, IconFolder, IconPlane,
  IconShip, IconAlert, IconEye, IconPlus, IconPencil, IconTrash,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
// Sprint 2026-06-11 · acciones sobre la fusión: el drawer C5 en modo
// multiExp (líneas de varios miembros) y el modal de documento con
// selector "Pertenece a".
import AddSAPConfirmationDrawer from "../components/expedientes/AddSAPConfirmationDrawer.jsx";
import UploadDocumentModal from "../components/expedientes/UploadDocumentModal.jsx";
// Sprint 2026-06-11 (rev4) · Productos OC editable también en la fusión.
import AddOCProductModal from "../components/expedientes/AddOCProductModal.jsx";

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

// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 (rev3) · Costos de movimientos COMBINADOS: una sola
// tabla con los costos de todos los miembros, con columna "Pertenece a"
// (proforma para staff / PO para cliente). sources: [{ocId, origin}].
// ─────────────────────────────────────────────────────────────────────
function FusionCostsCard({ sources, lang, navigate }) {
  const es = lang === "es";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const all = await Promise.all(sources.map(async (s) => {
          const data = await nodoAssignmentsApi.transferenciaCostosPorOC(s.ocId).catch(() => []);
          const arr = Array.isArray(data) ? data : (data?.results || []);
          return arr.map((r) => ({ ...r, __origin: s.origin }));
        }));
        if (!cancel) setRows(all.flat());
      } catch (e) {
        if (!cancel) setError(e?.message || "Error");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sources.map((s) => s.ocId))]);

  const totalUsd = rows.reduce((a, r) => a + Number(r.amount_usd || 0), 0);

  return (
    <div className="card card-pad-lg" style={{ marginTop: 16 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="heading-md" style={{ margin: 0 }}>
            {es ? "Costos de movimientos" : "Transfer costs"}
          </h3>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
            {es
              ? `Costos combinados de los ${sources.length} expedientes fusionados.`
              : `Combined costs of the ${sources.length} merged expedientes.`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.5 }}>TOTAL USD</div>
          <div className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>
            ${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "18px 0" }}>
          {es ? "Cargando…" : "Loading…"}
        </div>
      ) : error ? (
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "18px 0" }}>
          {es
            ? "No hay costos de movimientos en los expedientes fusionados."
            : "No transfer costs in the merged expedientes."}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{es ? "Pertenece a" : "Belongs to"}</th>
              <th>{es ? "Movimiento" : "Transfer"}</th>
              <th>{es ? "Expediente" : "Expediente"}</th>
              <th>{es ? "Tipo" : "Kind"}</th>
              <th>{es ? "Detalle" : "Label"}</th>
              <th style={{ textAlign: "right" }}>{es ? "Monto" : "Amount"}</th>
              <th style={{ textAlign: "center" }}>{es ? "Mon." : "Curr."}</th>
              <th style={{ textAlign: "right" }}>USD</th>
              <th style={{ textAlign: "center" }}>{es ? "Origen" : "Source"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cost_line_id}
                  onClick={() => r.transferencia_id && navigate(`/transferencias/${r.transferencia_id}`)}
                  style={{ cursor: "pointer" }}
                  title={es ? "Ver detalle del movimiento" : "Open transfer detail"}>
                <td><OriginChip text={r.__origin}/></td>
                <td className="mono-sm" style={{ color: "var(--brand-accent, #0E8A6D)", fontWeight: 700 }}>
                  {r.transferencia_codigo || "—"}
                </td>
                <td className="mono-sm" style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
                  {r.expediente_codigo || "—"}
                </td>
                <td>{r.kind_label || r.kind}</td>
                <td>{r.label || "—"}</td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>
                  {Number(r.amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td className="mono-sm" style={{ textAlign: "center" }}>{r.currency}</td>
                <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent, #0E8A6D)" }}>
                  ${Number(r.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td style={{ textAlign: "center" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                    background: r.source === "OCR_DUA" ? "rgba(0,178,134,0.12)" : "#F3F5F8",
                    color: r.source === "OCR_DUA" ? "#00B286" : "#64748B",
                  }}>
                    {r.source || "MANUAL"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 (rev3) · Pagos de costos logísticos COMBINADOS:
// una sola tabla con columna "Pertenece a". Staff-only (el padre gatea).
// ─────────────────────────────────────────────────────────────────────
function FusionPagosCard({ sources, lang }) {
  const es = lang === "es";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const all = await Promise.all(sources.map(async (s) => {
          const data = await financePaymentsApi.list({ oc_id: s.ocId }).catch(() => []);
          const arr = Array.isArray(data) ? data : (data?.results || []);
          return arr.map((p) => ({ ...p, __origin: s.origin }));
        }));
        if (!cancel) setRows(all.flat());
      } catch (e) {
        if (!cancel) setError(e?.message || "Error");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sources.map((s) => s.ocId))]);

  return (
    <div className="card card-pad-lg" style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 className="heading-md" style={{ margin: 0 }}>
          {es ? "Pagos de costos logísticos" : "Logistics cost payments"}
        </h3>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
          {es
            ? `Pagos combinados de los ${sources.length} expedientes fusionados.`
            : `Combined payments of the ${sources.length} merged expedientes.`}
        </div>
      </div>
      {loading ? (
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "18px 0" }}>
          {es ? "Cargando pagos…" : "Loading payments…"}
        </div>
      ) : error ? (
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "18px 0" }}>
          {es
            ? "Sin pagos registrados contra costos de los expedientes fusionados."
            : "No payments registered against costs of the merged expedientes."}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{es ? "Pertenece a" : "Belongs to"}</th>
              <th>{es ? "Código" : "Code"}</th>
              <th>{es ? "Fecha" : "Date"}</th>
              <th>{es ? "Dirección" : "Direction"}</th>
              <th>{es ? "Método" : "Method"}</th>
              <th>{es ? "Referencia" : "Reference"}</th>
              <th style={{ textAlign: "right" }}>{es ? "Monto" : "Amount"}</th>
              <th style={{ textAlign: "right" }}>USD</th>
              <th>{es ? "Estado" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const dir = p.direction || "OUT";
              return (
                <tr key={p.id}>
                  <td><OriginChip text={p.__origin}/></td>
                  <td className="mono-sm" style={{ fontWeight: 600 }}>
                    {p.codigo || (p.id ? String(p.id).slice(0, 8) : "—")}
                  </td>
                  <td className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {p.fecha ? new Date(p.fecha).toLocaleDateString(
                      es ? "es-PE" : "en-US",
                      { day: "2-digit", month: "short", year: "numeric" }
                    ) : "—"}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4,
                      font: "600 10px/1.4 var(--font-mono)", letterSpacing: "0.06em",
                      background: dir === "IN"
                        ? "color-mix(in oklab, var(--success) 10%, transparent)"
                        : "color-mix(in oklab, var(--warning) 10%, transparent)",
                      color: dir === "IN" ? "var(--success)" : "var(--warning)",
                    }}>
                      {dir}
                    </span>
                  </td>
                  <td>{p.metodo || "—"}</td>
                  <td className="mono-sm" style={{ fontWeight: 600 }}>{p.referencia || "—"}</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>
                    {Number(p.monto || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {" "}<span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{p.moneda || "USD"}</span>
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-accent)" }}>
                    ${Number(p.monto_usd ?? p.monto ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: "var(--bg-alt)", color: "var(--text-secondary)",
                    }}>
                      {p.estado || "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
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
  // Sprint 2026-06-11 (rev4) · edición de Productos OC en la fusión.
  const [lineDel, setLineDel] = useState(null);            // línea a eliminar
  const [lineDelBusy, setLineDelBusy] = useState(false);
  // Sprint 2026-07-30 · borrado de documentos también en la fusión
  // (mismo flujo que OCDetail: confirmación + documentosApi.remove).
  const [docDel, setDocDel] = useState(null);              // documento a eliminar
  const [docDelBusy, setDocDelBusy] = useState(false);
  const [addTargetOpen, setAddTargetOpen] = useState(false); // paso 1: ¿a qué proforma?
  const [addTargetIdx, setAddTargetIdx] = useState(0);
  const [productOpen, setProductOpen] = useState(false);     // paso 2: catálogo
  const [addErr, setAddErr] = useState(null);                // error visible del alta
  const [lineErr, setLineErr] = useState(null);              // error visible al persistir edición de línea

  // ORIGEN del miembro (R3): proforma para staff, PO para cliente.
  // OJO: NO usar m.oc.codigo — es el código interno del sistema
  // (PO-2026-00016), no un número real. Staff ve la PROFORMA
  // (2456-2026); si no hay, cae a la PO real del cliente.
  const badgeOf = (m) =>
    !isClient
      ? (m.exp.proforma_codigo
          || ((m.exp.proforma_codigos || [])[0])
          || m.oc?.proforma
          || ((m.exp.oc_codigos || [])[0])
          || m.exp.codigo)
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
          // Fable5 · WAVE D: UN request batch (?ids=) en vez de un GET
          // por producto.
          const prodResp = await productosApi
            .list({ ids: pids.join(",") })
            .catch(() => []);
          const prods = Array.isArray(prodResp)
            ? prodResp
            : (prodResp?.results || []);
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
      // Sprint 2026-06-19 · doc sin archivo real en MinIO (registro legacy).
      if (resp && resp.available === false) {
        setDocError(
          es
            ? 'Este documento no tiene archivo almacenado (registro antiguo). Vuelve a subirlo con "Agregar documento".'
            : 'This document has no stored file (legacy record). Please re-upload it via "Add document".'
        );
        return;
      }
      let url = resp?.url;
      if (!url) throw new Error(resp?.error || (es ? "URL no disponible" : "URL unavailable"));
      // Proxy HTTPS same-origin → absolutizar para window.open / <a download>.
      if (resp?.proxy === true && url.startsWith("/")) {
        url = `${window.location.origin}${url}`;
      }
      // Sprint 2026-09-03 · descargas 401 en la fusión. window.open /
      // <a download> NO envían el JWT por header, y el proxy sirve el
      // archivo con ?token=<JWT> para activos privados. Sin ese token el
      // backend responde "credenciales no provistas". Mismo fix que
      // OCDetail.handleViewDoc (storageUrl + forceToken).
      url = storageUrl(url, { forceToken: true }) || url;
      // Sprint 2026-09-03 (rev2) · HTML inline SIN blob. window.open a un
      // blob:text/html queda en blanco en Chrome; en cambio el endpoint
      // proforma-html responde text/html inline (como una página normal),
      // y como top-level nav no manda headers, le adjuntamos ?token=.
      const openInlineHtml = (target) => {
        const token = getToken() || "";
        const sep = target.includes("?") ? "&" : "?";
        window.open(`${target}${sep}token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
      };
      // Proforma dinámica (marker dynamic://proforma) → visor server-rendered.
      if (resp?.dynamic === true) {
        openInlineHtml(url);
        return;
      }
      const ext = extOf(doc);
      // Documento HTML almacenado como archivo (.html). Si es una PROFORMA
      // la abrimos por el visor dinámico (mismo render que generate-proforma,
      // inline y seguro). Otro HTML genérico → se descarga como archivo.
      if (ext === "html") {
        const kind = String(doc.kind || doc.type || "").toUpperCase();
        if (kind === "PROFORMA" && doc.expediente_id) {
          const qs = new URLSearchParams();
          if (doc.codigo) qs.set("codigo", doc.codigo);
          const q = qs.toString();
          openInlineHtml(`/api/expedientes/${doc.expediente_id}/proforma-html/${q ? `?${q}` : ""}`);
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.download = `${doc.filename || doc.codigo || `doc-${doc.id}`}.html`;
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        return;
      }
      const downloadExts = new Set(["xlsx", "xls", "xlsm", "csv", "docx", "doc", "zip"]);
      if (downloadExts.has(ext)) {
        const a = document.createElement("a");
        a.href = url;
        // Nombre de descarga con extensión real: doc.codigo no trae
        // extensión, y un Excel/Word sin .xlsx/.docx no abre al bajarse.
        // El nombre original vive en el último segmento del key MinIO.
        const storedName = String(resp?.key || "").split("/").pop() || "";
        const named = doc.filename || doc.codigo || `doc-${doc.id}`;
        a.download = storedName && storedName.includes(".")
          ? storedName
          : `${named}.${ext}`;
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

  // priceOf: precio "del viewer" (MWT para staff, cliente para CLIENT). Se
  // sigue usando para el payload de líneas (unit_price). NO se elimina.
  const priceOf = (l) => {
    if (isClient) {
      const pc = Number(l.unit_price_client ?? 0);
      return pc > 0 ? pc : Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
    }
    const pm = Number(l.unit_price_mwt ?? 0);
    return pm > 0 ? pm : Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
  };
  // Sprint 2026-06-26 (AG-03) · El Total de línea refleja el PRECIO CLIENTE
  // (valor real de la OC), no total_price (que el backend calcula con el precio
  // MWT/legacy del operador) ni priceOf (MWT para staff). El precio MWT sigue
  // en su columna dedicada. Antes 18.21×10 mostraba 154 (precio MWT) en vez de 182.10.
  const lineTotal = (l) => {
    const upc = Number(l.unit_price_client || 0);
    const unit = upc > 0 ? upc : Number(l.unit_price_for_viewer ?? l.unit_price ?? 0);
    return unit * Number(l.qty || 0);
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
        // Sprint 2026-07-18 · ocultar registros sin archivo almacenado
        // (p.ej. el documento kind='OC' que crea el wizard aunque el
        // cliente no suba la OC — existe solo para el código PO del
        // header): abrirlos siempre devolvía "documento_sin_archivo".
        // storage_url 'dynamic://proforma…' SÍ cuenta como con archivo.
        if (!String(d.storage_url || "")) return false;
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

  // Fuentes para las tablas combinadas de costos/pagos (una fila de
  // origen por miembro con OC).
  const costSources = members
    .filter((m) => m.exp.oc_id)
    .map((m) => ({ ocId: m.exp.oc_id, origin: badgeOf(m) }));

  // ── Edición in-place de Productos OC (staff · rev4) ──────────────
  // patch local optimista + persist onBlur; el backend recalcula
  // total_price y alinea unit_price legacy con el operador.
  const patchLineLocal = (lineId, patch) => {
    setMembers((prev) => prev.map((m) => ({
      ...m,
      lineas: m.lineas.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
    })));
  };
  // Sprint 2026-06-26 (AG-03) · FIX "el precio/cant editado se revertía al
  // recargar". Antes el error se TRAGABA (console.warn): el valor optimista
  // quedaba en `members` (parecía guardado) pero el reload lo revertía a BD.
  // Ahora: en ÉXITO hacemos COMMIT del valor recalculado por el backend a
  // `members` (fuente canónica); en ERROR hacemos ROLLBACK a la verdad del
  // backend (re-GET de la línea) y mostramos un banner visible.
  const persistLine = async (l, patch) => {
    try {
      const saved = await lineasApi.update(l.id, patch);
      if (saved && saved.id) patchLineLocal(l.id, saved);   // total_price/unit_price recalculados
      setLineErr(null);
    } catch (err) {
      try {
        const fresh = await lineasApi.get(l.id);            // rollback al estado real de BD
        if (fresh && fresh.id) patchLineLocal(l.id, fresh);
      } catch { /* si el re-GET falla, dejamos el banner igual */ }
      setLineErr(
        `No se pudo guardar la línea ${String(l.id).slice(0, 8)}…: el cambio NO quedó ` +
        `persistido (se revirtió al valor guardado). Reintenta. (${err?.message || "error de red"})`
      );
    }
  };
  const confirmDeleteLine = async () => {
    if (!lineDel?.id || lineDelBusy) return;
    setLineDelBusy(true);
    try {
      await lineasApi.remove(lineDel.id);
      setMembers((prev) => prev.map((m) => ({
        ...m,
        lineas: m.lineas.filter((l) => l.id !== lineDel.id),
      })));
      setLineDel(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[FusionDetail] eliminar línea falló", err);
    } finally {
      setLineDelBusy(false);
    }
  };
  // Sprint 2026-07-30 · eliminar documento comercial desde la fusión.
  // El backend hace soft-delete + borra el objeto del bucket (on_commit).
  const confirmDeleteDoc = async () => {
    if (!docDel?.id || docDelBusy) return;
    setDocDelBusy(true);
    setDocError(null);
    try {
      await documentosApi.remove(docDel.id);
      setMembers((prev) => prev.map((m) => ({
        ...m,
        docs: m.docs.filter((x) => x.id !== docDel.id),
      })));
      setDocDel(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[FusionDetail] eliminar documento falló", err);
      setDocError(
        es
          ? `No se pudo eliminar el documento: ${err?.message || "error"}`
          : `Couldn't delete document: ${err?.message || "error"}`
      );
    } finally {
      setDocDelBusy(false);
    }
  };
  // Crea las líneas del modal contra la proforma/OC elegida (paso 1).
  const addRowsToTarget = async (rows) => {
    const withOc = members.filter((m) => m.exp.oc_id);
    const t = withOc[Math.min(addTargetIdx, withOc.length - 1)];
    if (!t) { setProductOpen(false); return; }
    const arr = Array.isArray(rows) ? rows : [];
    // Creación POR FILA con error VISIBLE (sin filas fantasma).
    const failed = [];
    for (const r of arr) {
      const qty = Number(r.cantidad || 0);
      const unit = Number(r.unit_price || 0);
      try {
        await lineasApi.create({
          oc_id:             t.exp.oc_id,
          expediente_id:     t.exp.id,
          producto_id:       r.producto_id || null,
          sku:               r.sku,
          size:              r.talla != null ? String(r.talla) : null,
          qty,
          unit_price:        unit,
          unit_price_mwt:    unit,
          unit_price_client: unit,
          total_price:       +(qty * unit).toFixed(2),
          estado:            "PENDIENTE_SAP",
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[FusionDetail] crear línea falló", r, err);
        failed.push(
          `${r.sku || "—"}${r.talla != null ? ` T${r.talla}` : ""}: ${err?.body?.detail || err?.message || "error"}`
        );
      }
    }
    setAddErr(failed.length
      ? (es
          ? `No se pudo guardar ${failed.length} línea(s) — ${failed.join(" · ")}`
          : `Couldn't save ${failed.length} line(s) — ${failed.join(" · ")}`)
      : null);
    setProductOpen(false);
    setReloadKey((k) => k + 1);
  };

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
                            onClick={(ev) => { ev.stopPropagation(); g.m.exp.oc_id && navigate(`/expedientes/${g.m.exp.oc_id}/exp/${g.m.exp.id}`); }}
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
            <div className="card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div className="card-title">{es ? "Productos OC" : "PO Products"}</div>
                <div className="card-subtitle">
                  {allLines.length} {es ? "líneas" : "lines"} · {members.length} {!isClient ? (es ? "expedientes · editable" : "expedientes · editable") : (es ? "expedientes" : "expedientes")} · {fmtMoney(totalValue)} {es ? "total" : "total"}
                </div>
              </div>
              {/* + Agregar producto — pregunta primero a qué proforma/OC
                  pertenece (paso 1) y luego abre el catálogo (paso 2). */}
              {!isClient && can("add_oc_line") && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { setAddTargetIdx(0); setAddTargetOpen(true); }}
                  style={{ background: "var(--brand-primary)" }}
                >
                  <IconPlus size={14}/>{es ? "Agregar producto" : "Add product"}
                </button>
              )}
            </div>
            {/* Error visible del alta de líneas (sin filas fantasma). */}
            {addErr && (
              <div style={{
                margin: "10px 22px 0", padding: "8px 12px", borderRadius: 8,
                background: "color-mix(in oklab, var(--danger, #DC2626) 12%, transparent)",
                color: "var(--danger, #991B1B)",
                border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)",
                fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6,
              }}>
                <IconAlert size={11} style={{ flexShrink: 0, marginTop: 2 }}/>
                <div style={{ flex: 1 }}>{addErr}</div>
                <button type="button"
                        onClick={() => setAddErr(null)}
                        style={{ background: "transparent", border: 0, cursor: "pointer", color: "inherit" }}>
                  ✕
                </button>
              </div>
            )}
            {/* Error visible al persistir una edición inline (precio/cantidad). */}
            {lineErr && (
              <div style={{
                margin: "10px 22px 0", padding: "8px 12px", borderRadius: 8,
                background: "color-mix(in oklab, var(--danger, #DC2626) 12%, transparent)",
                color: "var(--danger, #991B1B)",
                border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)",
                fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6,
              }}>
                <IconAlert size={11} style={{ flexShrink: 0, marginTop: 2 }}/>
                <div style={{ flex: 1 }}>{lineErr}</div>
                <button type="button"
                        onClick={() => setLineErr(null)}
                        style={{ background: "transparent", border: 0, cursor: "pointer", color: "inherit" }}>
                  ✕
                </button>
              </div>
            )}
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
                    {/* Columna acciones (eliminar) — staff only. */}
                    {!isClient && <th style={{ width: 44 }}/>}
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
                      {/* Cant. — editable para staff (persiste onBlur). */}
                      {!isClient ? (
                        <td className="td-edit" style={{ textAlign: "right" }}>
                          <input className="edit-input tabular no-spin" type="number" min={0}
                            value={Number(l.qty ?? 0)}
                            onChange={(ev) => {
                              const v = +ev.target.value;
                              const unit = Number(l.unit_price_mwt || l.unit_price || 0);
                              patchLineLocal(l.id, { qty: v, total_price: +(v * unit).toFixed(2) });
                            }}
                            onBlur={(ev) => persistLine(l, { qty: +ev.target.value })}
                            style={{ width: "100%", minWidth: 56, maxWidth: 84, textAlign: "right" }}/>
                        </td>
                      ) : (
                        <td className="td-num" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {Number(l.qty || 0).toLocaleString()}
                        </td>
                      )}
                      {/* Precio MWT — editable (R3: la columna ni existe en CLIENT). */}
                      {!isClient && (
                        <td className="td-edit" style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "flex-end" }}>
                            <span>$</span>
                            <input className="edit-input tabular" type="number" min={0} step="0.01"
                              value={Number(l.unit_price_mwt ?? 0)}
                              onChange={(ev) => {
                                const v = +ev.target.value;
                                patchLineLocal(l.id, { unit_price_mwt: v, total_price: +(Number(l.qty || 0) * v).toFixed(2) });
                              }}
                              onBlur={(ev) => persistLine(l, { unit_price_mwt: +ev.target.value })}
                              style={{ width: "100%", minWidth: 72, maxWidth: 100, textAlign: "right" }}/>
                          </div>
                        </td>
                      )}
                      {/* Precio Cliente — editable para staff; texto para CLIENT. */}
                      {!isClient ? (
                        <td className="td-edit" style={{
                          textAlign: "right",
                          background: "color-mix(in oklab, var(--brand-accent) 4%, transparent)",
                        }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "flex-end" }}>
                            <span>$</span>
                            <input className="edit-input tabular" type="number" min={0} step="0.01"
                              value={Number(l.unit_price_client ?? 0)}
                              onChange={(ev) => patchLineLocal(l.id, { unit_price_client: +ev.target.value })}
                              onBlur={(ev) => persistLine(l, { unit_price_client: +ev.target.value })}
                              style={{ width: "100%", minWidth: 72, maxWidth: 100, textAlign: "right" }}/>
                          </div>
                        </td>
                      ) : (
                        <td className="td-num tabular-nums" style={{
                          textAlign: "right",
                          background: "color-mix(in oklab, var(--brand-accent) 4%, transparent)",
                        }}>
                          ${Number(l.unit_price_client || 0).toFixed(2)}
                        </td>
                      )}
                      <td className="td-money">{fmtMoney(lineTotal(l))}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {l.sap || (
                          <span className="caption" style={{ color: "var(--warning)" }}>
                            {tr(lang, "pending_sap")}
                          </span>
                        )}
                      </td>
                      {/* Eliminar línea — staff only. */}
                      {!isClient && (
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="icon-btn"
                            title={es ? "Eliminar línea" : "Delete line"}
                            onClick={() => setLineDel(l)}
                            style={{ color: "var(--critical, #DC2626)", border: 0, background: "transparent", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Total al estilo OCDetail (banda inferior, no fila huérfana). */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              gap: 18, padding: "14px 22px",
              borderTop: "1px solid var(--divider)",
              background: "var(--bg-alt)",
            }}>
              <span className="micro">{es ? "Total fusionado" : "Merged total"}</span>
              <span className="tabular-nums" style={{ fontWeight: 700, color: "var(--text-secondary)" }}>
                {totalUnits.toLocaleString("en-US")} u
              </span>
              <span style={{ font: "800 18px/1 var(--font-display)", fontVariantNumeric: "tabular-nums" }}>
                {fmtMoney(totalValue)}
              </span>
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
                  {/* Sprint 2026-07-30 · eliminar documento (misma regla que
                      OCDetail: staff con permiso upload_document). */}
                  {!isClient && can("upload_document") && (
                    <button
                      type="button"
                      className="icon-btn"
                      title={es ? "Eliminar documento" : "Delete document"}
                      onClick={(ev) => { ev.stopPropagation(); setDocDel(d); }}
                      style={{ color: "var(--danger, #DC2626)" }}
                    >
                      <IconTrash size={13}/>
                    </button>
                  )}
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
                onClick={() => m.exp.oc_id && navigate(`/expedientes/${m.exp.oc_id}/exp/${m.exp.id}`)}
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

      {/* ── Costos de movimientos — UNA tabla combinada con columna
          "Pertenece a" (proforma staff / PO cliente). ─────────── */}
      <FusionCostsCard sources={costSources} lang={lang} navigate={navigate}/>

      {/* ── Pagos de costos logísticos — UNA tabla combinada (staff). */}
      {isAdmin && <FusionPagosCard sources={costSources} lang={lang}/>}

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

      {/* ── Confirmación de borrado de documento (2026-07-30) ───── */}
      {docDel && (
        <div onClick={() => !docDelBusy && setDocDel(null)}
             style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(11,30,58,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(ev) => ev.stopPropagation()}
               style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: 20, width: "min(440px, 92vw)", boxShadow: "0 24px 60px rgba(11,30,58,0.35)" }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {es ? "Eliminar documento" : "Delete document"}
            </div>
            <div className="caption" style={{ marginTop: 8 }}>
              <span style={{ fontWeight: 700 }}>{docDel.kind || "—"}</span>
              {" · "}<span className="mono">{docDel.codigo || docDel.filename || "—"}</span>
            </div>
            <div className="caption" style={{ marginTop: 6, color: "var(--text-tertiary)" }}>
              {es
                ? "Se borra del expediente al que pertenece y del almacenamiento. Esta acción no se puede deshacer."
                : "It will be removed from its expediente and from storage. This action cannot be undone."}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" disabled={docDelBusy} onClick={() => setDocDel(null)}>
                {es ? "Cancelar" : "Cancel"}
              </button>
              <button className="btn" disabled={docDelBusy} onClick={confirmDeleteDoc}
                      style={{ background: "var(--critical, #DC2626)", color: "#fff", fontWeight: 700 }}>
                {docDelBusy ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar" : "Delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmación de borrado de línea (rev4) ────────────── */}
      {lineDel && (
        <div onClick={() => !lineDelBusy && setLineDel(null)}
             style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(11,30,58,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(ev) => ev.stopPropagation()}
               style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: 20, width: "min(440px, 92vw)", boxShadow: "0 24px 60px rgba(11,30,58,0.35)" }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {es ? "Eliminar línea de la OC" : "Delete OC line"}
            </div>
            <div className="caption" style={{ marginTop: 8 }}>
              <span className="mono" style={{ fontWeight: 700 }}>{lineDel.sku || "—"}</span>
              {" · "}{es ? "Talla" : "Size"} {lineDel.talla || lineDel.size || "—"}
              {" · "}{Number(lineDel.qty || 0)} u
            </div>
            <div className="caption" style={{ marginTop: 6, color: "var(--text-tertiary)" }}>
              {es
                ? "Se elimina del expediente al que pertenece (soft-delete en BD)."
                : "Removed from its expediente (soft-delete in DB)."}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" disabled={lineDelBusy} onClick={() => setLineDel(null)}>
                {es ? "Cancelar" : "Cancel"}
              </button>
              <button className="btn" disabled={lineDelBusy} onClick={confirmDeleteLine}
                      style={{ background: "var(--critical, #DC2626)", color: "#fff", fontWeight: 700 }}>
                {lineDelBusy ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar" : "Delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 1 · ¿A qué proforma/OC pertenece el producto? ──── */}
      {addTargetOpen && (
        <div onClick={() => setAddTargetOpen(false)}
             style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(11,30,58,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(ev) => ev.stopPropagation()}
               style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: 20, width: "min(440px, 92vw)", boxShadow: "0 24px 60px rgba(11,30,58,0.35)" }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {es ? "Agregar producto" : "Add product"}
            </div>
            <div className="caption" style={{ marginTop: 6 }}>
              {es
                ? "¿A qué proforma / OC pertenece el producto nuevo?"
                : "Which proforma / PO does the new product belong to?"}
            </div>
            <select className="input" value={addTargetIdx}
                    onChange={(ev) => setAddTargetIdx(Number(ev.target.value) || 0)}
                    style={{ width: "100%", marginTop: 10, fontFamily: "var(--font-mono)" }}>
              {members.filter((m) => m.exp.oc_id).map((m, i) => (
                <option key={m.exp.id} value={i}>{badgeOf(m)} · {m.exp.codigo}</option>
              ))}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setAddTargetOpen(false)}>
                {es ? "Cancelar" : "Cancel"}
              </button>
              <button className="btn btn-primary" onClick={() => { setAddTargetOpen(false); setProductOpen(true); }}>
                {es ? "Continuar" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 2 · catálogo (mismo modal que OCDetail) ────────── */}
      {productOpen && (
        <AddOCProductModal
          open={productOpen}
          lang={lang}
          clientId={members[0]?.exp.client_id || null}
          clientLabel={clientName}
          onPick={addRowsToTarget}
          onClose={() => setProductOpen(false)}
        />
      )}
    </div>
  );
}
