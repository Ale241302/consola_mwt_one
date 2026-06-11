// frontend/src/pages/FusionDetail.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 · Detalle COMBINADO de expedientes fusionados (E3).
//
// Caso de negocio: una PO del cliente dividida en N expedientes (p.ej.
// dos operados por Muito Work Limitada y uno por el cliente). Esta vista
// READ-ONLY consolida las secciones de los N miembros:
//   · Líneas de la OC (resumen por miembro)
//   · Productos OC (tabla combinada con columna Origen)
//   · Documentos comerciales (lista combinada con Origen)
//   · Costos de movimientos (card por miembro, reutiliza OCTransferCostsCard)
//   · Pagos de costos logísticos (card por miembro, admin-only)
//
// Identificación del origen (POL_VISIBILIDAD · R3):
//   · ADMIN/CEO → número de PROFORMA del miembro (código de la OC).
//   · CLIENT_*  → número de PO del cliente (oc_codigos del listado).
//   · Precio MWT solo se renderiza para staff (la columna ni existe en
//     la rama CLIENT del render).
//
// La edición vive en el detalle individual de cada miembro (link
// "Abrir" por chip) — aquí no hay mutaciones, así no se duplica la
// lógica de OCDetail.
// ─────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import {
  expedientesApi, ocsApi, lineasApi, documentosApi, clientesApi,
  productosApi, storageApi, getToken,
} from "../lib/api.js";
import { fmtMoney } from "../lib/i18n.js";
import { StatusBadge } from "../components/ui/primitives.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { OCPagosCard, OCTransferCostsCard } from "./OCDetail.jsx";

const MONO = "JetBrains Mono, monospace";

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

export default function ScreenFusionDetail() {
  const { fusionId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isAdmin, isClient } = useRole();
  const es = lang === "es";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // members: [{ exp (fila del listado), oc, lineas[], docs[] }]
  const [members, setMembers] = useState([]);
  const [clientName, setClientName] = useState("");
  const [nameMap, setNameMap] = useState({});
  const [viewingDocId, setViewingDocId] = useState(null);
  const [docError, setDocError] = useState(null);

  // Origen del miembro: proforma (OC code) para staff, PO para cliente.
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
        // Nombres reales de producto (mismo patrón que OCDetail).
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
  }, [fusionId]);

  // Ver documento — mismo flujo que OCDetail.handleViewDoc (signed URL,
  // HTML dinámico via fetch+Blob, Office fuerza download).
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
      const ext = String(doc.file_ext || "").toLowerCase().replace(/^\./, "");
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
        <button
          type="button"
          onClick={() => navigate("/expedientes")}
          style={{ border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", padding: 0, marginBottom: 12 }}
        >
          ‹ {es ? "Volver a Expedientes" : "Back to Expedientes"}
        </button>
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
      </div>
    );
  }

  const label = members[0]?.exp.fusion_label
    || ((members[0]?.exp.oc_codigos || []).find((c) =>
          members.every((m) => (m.exp.oc_codigos || []).includes(c)))
    || (es ? "Fusión" : "Merged"));
  const allLines = members.flatMap((m) =>
    m.lineas.map((l) => ({ l, badge: badgeOf(m) }))
  );
  const priceOf = (l) => (isClient
    ? Number(l.unit_price_client ?? l.unit_price ?? 0)
    : Number(l.unit_price_mwt ?? l.unit_price ?? 0));
  const totalValue = allLines.reduce(
    (a, { l }) => a + priceOf(l) * (Number(l.cantidad) || 0), 0
  );
  const totalUnits = allLines.reduce((a, { l }) => a + (Number(l.cantidad) || 0), 0);
  const allDocs = members.flatMap((m) =>
    m.docs.map((d) => ({ d, badge: badgeOf(m) }))
  );

  const thStyle = { whiteSpace: "nowrap" };
  const originChip = (text) => (
    <span style={{
      fontFamily: MONO, fontSize: 11, padding: "2px 8px", borderRadius: 6,
      background: "var(--surface-raised)", border: "1px solid var(--border-subtle)",
      whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );

  return (
    <div className="page">
      {/* ── Cabecera ───────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate("/expedientes")}
        style={{ border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", padding: 0, marginBottom: 10 }}
      >
        ‹ {es ? "Volver a Expedientes" : "Back to Expedientes"}
      </button>
      <div className="micro" style={{ color: "var(--brand-accent)", letterSpacing: 1 }}>
        {es ? "EXPEDIENTES · FUSIÓN" : "EXPEDIENTES · MERGED"}
      </div>
      <div className="flex ai-center gap-3" style={{ flexWrap: "wrap", marginTop: 4 }}>
        <h1 className="heading-xl" style={{ margin: 0, fontFamily: MONO }}>{label}</h1>
        <span className="caption">
          {es
            ? `Fusión · ${members.length} expedientes`
            : `Merged · ${members.length} expedientes`}
        </span>
      </div>
      <div className="caption" style={{ marginTop: 4 }}>
        {clientName || "—"} · {allLines.length} {es ? "líneas" : "lines"} · {totalUnits.toLocaleString("en-US")} u · <span className="tabular">{fmtMoney(totalValue)}</span>
      </div>

      {/* Chips de miembros: identificación + estado + abrir detalle real */}
      <div className="flex ai-center gap-2" style={{ flexWrap: "wrap", marginTop: 12 }}>
        {members.map((m) => (
          <div
            key={m.exp.id}
            className="flex ai-center gap-2"
            style={{
              padding: "6px 10px", borderRadius: 8,
              background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>{badgeOf(m)}</span>
            <span className="caption" style={{ fontFamily: MONO }}>{m.exp.codigo}</span>
            <StatusBadge status={m.exp.estado} lang={lang}/>
            {m.exp.oc_id && (
              <button
                type="button"
                onClick={() => navigate(`/expedientes/${m.exp.oc_id}`)}
                style={{ border: 0, background: "transparent", color: "var(--brand-accent)", cursor: "pointer", fontSize: 12, padding: 0 }}
              >
                {es ? "Abrir ›" : "Open ›"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Líneas de la OC (resumen por miembro) ──────────────── */}
      <div className="card card-pad-lg" style={{ marginTop: 16 }}>
        <h3 className="heading-md" style={{ margin: 0 }}>
          {es ? "Líneas de la OC" : "OC lines"}
        </h3>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
          {es
            ? "Resumen por expediente fusionado — cada miembro conserva su propia OC."
            : "Summary per merged expediente — each member keeps its own OC."}
        </div>
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th style={thStyle}>{es ? "Origen" : "Origin"}</th>
              <th style={thStyle}>EXP</th>
              <th style={thStyle}>SAP</th>
              <th style={thStyle}>{es ? "Estado" : "Status"}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Líneas" : "Lines"}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Unidades" : "Units"}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const units = m.lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);
              const tot = m.lineas.reduce((a, l) => a + priceOf(l) * (Number(l.cantidad) || 0), 0);
              const saps = Array.from(new Set(m.lineas.map((l) => l.sap).filter(Boolean)));
              return (
                <tr key={m.exp.id} style={{ cursor: m.exp.oc_id ? "pointer" : "default" }}
                    onClick={() => m.exp.oc_id && navigate(`/expedientes/${m.exp.oc_id}`)}>
                  <td>{originChip(badgeOf(m))}</td>
                  <td style={{ fontFamily: MONO, fontSize: 12 }}>{m.exp.codigo}</td>
                  <td style={{ fontFamily: MONO, fontSize: 12 }}>
                    {saps.length ? saps.join(", ") : (es ? "Pendiente SAP" : "Pending SAP")}
                  </td>
                  <td><StatusBadge status={m.exp.estado} lang={lang}/></td>
                  <td className="tabular" style={{ textAlign: "right" }}>{m.lineas.length}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{units.toLocaleString("en-US")}</td>
                  <td className="td-money tabular">{fmtMoney(tot)}</td>
                </tr>
              );
            })}
            <tr style={{ fontWeight: 600 }}>
              <td colSpan={4}>{es ? "VALOR TOTAL FUSIONADO" : "MERGED TOTAL VALUE"}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{allLines.length}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{totalUnits.toLocaleString("en-US")}</td>
              <td className="td-money tabular">{fmtMoney(totalValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Productos OC (combinado) ───────────────────────────── */}
      <div className="card card-pad-lg" style={{ marginTop: 16 }}>
        <h3 className="heading-md" style={{ margin: 0 }}>
          {es ? "Productos OC (combinado)" : "OC products (combined)"}
        </h3>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
          {es
            ? `${allLines.length} líneas de ${members.length} expedientes · solo lectura — edita en el detalle de cada uno.`
            : `${allLines.length} lines from ${members.length} expedientes · read-only — edit in each detail.`}
        </div>
        <div style={{ overflowX: "auto", overflowY: "hidden", marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={thStyle}>{es ? "Origen" : "Origin"}</th>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>{es ? "Nombre" : "Name"}</th>
                <th style={thStyle}>{es ? "Talla" : "Size"}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Cant." : "Qty"}</th>
                {/* R3 · POL_VISIBILIDAD: la columna Precio MWT NO existe en
                    la rama CLIENT del render. */}
                {!isClient && <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Precio MWT" : "MWT price"}</th>}
                <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Precio Cliente" : "Client price"}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                <th style={thStyle}>SAP</th>
              </tr>
            </thead>
            <tbody>
              {allLines.map(({ l, badge }, i) => (
                <tr key={l.id || i}>
                  <td>{originChip(badge)}</td>
                  <td style={{ fontFamily: MONO, fontSize: 12 }}>{l.sku || "—"}</td>
                  <td>{nameMap[l.producto_id] || l.sku || "—"}</td>
                  <td className="tabular">{l.talla || "—"}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{Number(l.cantidad) || 0}</td>
                  {!isClient && (
                    <td className="tabular" style={{ textAlign: "right" }}>
                      $ {Number(l.unit_price_mwt ?? 0).toFixed(2)}
                    </td>
                  )}
                  <td className="tabular" style={{ textAlign: "right" }}>
                    $ {Number(l.unit_price_client ?? 0).toFixed(2)}
                  </td>
                  <td className="td-money tabular">
                    {fmtMoney(priceOf(l) * (Number(l.cantidad) || 0))}
                  </td>
                  <td style={{ fontFamily: MONO, fontSize: 12 }}>{l.sap || (es ? "Pendiente" : "Pending")}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={isClient ? 4 : 5}>{es ? "Total fusionado" : "Merged total"}</td>
                <td className="tabular" style={{ textAlign: "right" }}>{totalUnits.toLocaleString("en-US")}</td>
                {!isClient && <td/>}
                <td className="td-money tabular">{fmtMoney(totalValue)}</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Documentos comerciales (combinado) ─────────────────── */}
      <div className="card card-pad-lg" style={{ marginTop: 16 }}>
        <h3 className="heading-md" style={{ margin: 0 }}>
          {es ? "Documentos comerciales (combinado)" : "Commercial documents (combined)"}
        </h3>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
          {es
            ? `${allDocs.length} archivos de ${members.length} expedientes.`
            : `${allDocs.length} files from ${members.length} expedientes.`}
        </div>
        {docError && (
          <div className="body-sm" style={{ color: "var(--critical)", marginTop: 8 }}>{docError}</div>
        )}
        {allDocs.length === 0 ? (
          <div className="caption" style={{ color: "var(--text-tertiary)", padding: "14px 0" }}>
            {es ? "Sin documentos." : "No documents."}
          </div>
        ) : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th style={thStyle}>{es ? "Origen" : "Origin"}</th>
                <th style={thStyle}>{es ? "Tipo" : "Kind"}</th>
                <th style={thStyle}>{es ? "Código / archivo" : "Code / file"}</th>
                <th style={thStyle}>{es ? "Fecha" : "Date"}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{es ? "Tamaño" : "Size"}</th>
                <th style={{ width: 60 }}/>
              </tr>
            </thead>
            <tbody>
              {allDocs.map(({ d, badge }) => (
                <tr key={d.id}>
                  <td>{originChip(badge)}</td>
                  <td>
                    <span className="caption" style={{ textTransform: "uppercase" }}>
                      {String(d.kind || "OTRO")}
                    </span>
                  </td>
                  <td style={{ fontFamily: MONO, fontSize: 12 }}>{d.codigo || d.filename || "—"}</td>
                  <td className="tabular">
                    {(d.fecha || d.created_at || "").slice(0, 10) || "—"}
                  </td>
                  <td className="tabular" style={{ textAlign: "right" }}>
                    {fmtBytes(d.file_size_bytes ?? d.file_size)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={viewingDocId === d.id}
                      onClick={() => openDoc(d)}
                      title={es ? "Ver documento" : "View document"}
                      style={{
                        cursor: viewingDocId === d.id ? "wait" : "pointer",
                        opacity: viewingDocId === d.id ? 0.5 : 1,
                        border: "1px solid var(--border-subtle)",
                        background: "transparent", borderRadius: 6,
                        padding: "3px 10px", fontSize: 12,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {viewingDocId === d.id ? "…" : (es ? "Ver" : "View")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Costos de movimientos (por miembro) ────────────────── */}
      <div style={{ marginTop: 20 }}>
        <h3 className="heading-md" style={{ margin: 0 }}>
          {es ? "Costos de movimientos" : "Transfer costs"}
        </h3>
        {members.map((m) => m.exp.oc_id && (
          <div key={`cost-${m.exp.id}`} style={{ marginTop: 10 }}>
            <div className="flex ai-center gap-2">
              {originChip(badgeOf(m))}
              <span className="caption" style={{ fontFamily: MONO }}>{m.exp.codigo}</span>
            </div>
            <OCTransferCostsCard ocId={m.exp.oc_id} lang={lang} navigate={navigate}/>
          </div>
        ))}
      </div>

      {/* ── Pagos de costos logísticos (por miembro · staff) ──── */}
      {isAdmin && (
        <div style={{ marginTop: 20 }}>
          <h3 className="heading-md" style={{ margin: 0 }}>
            {es ? "Pagos de costos logísticos" : "Logistics cost payments"}
          </h3>
          {members.map((m) => m.exp.oc_id && (
            <div key={`pago-${m.exp.id}`} style={{ marginTop: 10 }}>
              <div className="flex ai-center gap-2">
                {originChip(badgeOf(m))}
                <span className="caption" style={{ fontFamily: MONO }}>{m.exp.codigo}</span>
              </div>
              <OCPagosCard ocId={m.exp.oc_id} lang={lang}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
