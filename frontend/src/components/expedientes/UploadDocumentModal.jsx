// frontend/src/components/expedientes/UploadDocumentModal.jsx
// =====================================================================
// MWT.ONE · UploadDocumentModal
// Modal para subir documentos comerciales a la OC.
//
// Sprint 2026-05-02 (AG-03): cuando kind === "OC" y existe expedienteId,
// tras subir a /api/documentos/ encadena automáticamente la extracción
// IA + matchmaker contra el catálogo de productos. El padre recibe el
// resultado vía `onAiAnalysisReady(payload, file)` y puede abrir el
// wizard de revisión para que el usuario confirme las líneas a insertar
// en "Productos OC".
// =====================================================================
import React, { useState, useRef, useEffect } from "react";
import {
  IconUpload, IconX, IconFileText, IconCheck, IconAlert, IconSparkle, IconLock,
} from "../../lib/icons.jsx";
import { documentosApi, expedientesApi, getToken, documentMatchmakerApi } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";
// Sprint 2026-06-01 · Factura comercial generada (mismo formato que la
// factura de transferencia) desde el detalle del expediente.
import { buildExpedienteFacturaFile } from "../../lib/expedienteFactura.js";

// Sprint 2026-05-10 · Tiers de pronto pago (en sync con
// proforma_renderer.PRONTO_PAGO_TIERS y CreateExpedienteWizardLite).
// Cambiar aqui REQUIERE actualizar los otros dos archivos tambien.
const PRONTO_PAGO_TIERS = [
  { days: 8,   pct: -2.75, label: "−2.75%" },
  { days: 30,  pct: -1.75, label: "−1.75%" },
  { days: 60,  pct: -1.00, label: "−1.00%" },
  { days: 90,  pct:  0.00, label: "base"   },
  { days: 120, pct: +1.00, label: "+1.00%" },
];

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

// Tipos canónicos (codigo interno + label).
const DOCUMENT_KINDS = [
  { id: "OC",        es: "OC del Cliente",        en: "Client PO",
    hint_es: "Orden de Compra original recibida del cliente.",
    hint_en: "Original purchase order received from the client.",
    aiPipeline: "ART-01_OC" },
  { id: "PROFORMA",  es: "Proforma",              en: "Proforma",
    hint_es: "Proforma emitida por MWT al cliente.",
    hint_en: "Proforma issued by MWT to the client.",
    aiPipeline: "ART-02_PROFORMA" },
  { id: "FACTURA",   es: "Factura comercial",     en: "Commercial invoice",
    hint_es: "Factura emitida al cliente o de un proveedor.",
    hint_en: "Invoice issued to client or from a supplier." },
  { id: "CONTRATO",  es: "Contrato",              en: "Contract",
    hint_es: "Acuerdo comercial firmado.",
    hint_en: "Signed commercial agreement." },
  { id: "OTRO",      es: "Otro documento",        en: "Other document",
    hint_es: "Cualquier otro documento de soporte.",
    hint_en: "Any other supporting document." },
];

function prettyBytes(n) {
  if (!n) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(n) / Math.log(k));
  const u = ["B", "KB", "MB", "GB"];
  return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`;
}

export default function UploadDocumentModal({
  open,
  onClose,
  onUploaded,           // (newDoc) => void
  onAiAnalysisReady,    // (mismatchPayload, file, documentType) => void  ← NUEVO
  lang = "es",
  ocId,
  expedienteId,
  contextLabel,
  // Sprint 2026-05-10 · `expedienteCreditDays` permite que cuando se
  // sube una Proforma, el admin pueda elegir el plazo de pronto pago
  // y se PATCHee el expediente antes del upload — así el HTML cliente
  // auto-generado refleja el descuento aplicado.
  expedienteCreditDays = 90,
}) {
  const [kind,    setKind]    = useState("OC");
  const [codigo,  setCodigo]  = useState("");
  const [file,    setFile]    = useState(null);
  const [error,   setError]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [aiPhase, setAiPhase] = useState(null); // null | 'uploading' | 'analyzing'
  const [dragOver,  setDragOver]  = useState(false);
  // Sprint 2026-05-06 · audiencia del documento. CLIENT siempre. ADMIN
  // puede elegir CLIENT (default) o MWT_INTERNAL para Proforma/Factura.
  const [audience, setAudience] = useState("CLIENT");
  // Sprint 2026-05-10 · plazo de pago seleccionado para esta proforma.
  // Default al credit_days actual del expediente. Si el admin lo
  // cambia, hacemos PATCH al expediente antes del upload.
  const [paymentDays, setPaymentDays] = useState(Number(expedienteCreditDays) || 90);
  // Cuando cambia el expediente o se abre el modal, resetear paymentDays
  // al valor actual del expediente (no al last-seen del modal previo).
  useEffect(() => {
    setPaymentDays(Number(expedienteCreditDays) || 90);
  }, [expedienteCreditDays, open]);
  const inputRef = useRef(null);

  // El selector de audiencia solo aplica a ADMIN/MWT y a Proforma/Factura.
  const { isClient: viewerIsClient, isAdmin: viewerIsAdmin } = useRole();
  const audienceApplies = !viewerIsClient && (kind === "PROFORMA" || kind === "FACTURA");

  if (!open) return null;

  const kindObj = DOCUMENT_KINDS.find(k => k.id === kind) || DOCUMENT_KINDS[0];
  const aiEligible = !!(kindObj.aiPipeline && expedienteId && onAiAnalysisReady);

  const reset = () => {
    setKind("OC"); setCodigo(""); setFile(null); setAudience("CLIENT");
    setError(null); setUploading(false); setAiPhase(null);
  };

  const validate = (f) => {
    if (!f) return "Selecciona un archivo";
    if (f.size > 20 * 1024 * 1024) {
      return lang === "es" ? "Maximo 20MB" : "Max 20MB";
    }
    const ok = /\.(pdf|png|jpe?g|xml|xlsx?|docx?)$/i.test(f.name);
    if (!ok) {
      return lang === "es"
        ? "Formato no admitido (PDF, imagen, Excel, Word, XML)"
        : "Format not allowed (PDF, image, Excel, Word, XML)";
    }
    return null;
  };

  const onPickFile = (f) => {
    const err = validate(f);
    if (err) { setError(err); return; }
    setError(null);
    setFile(f);
  };

  // Sprint 2026-05-24 · Auto-Proforma: cuando el usuario elige Proforma
  // sobre un expediente y es admin/MWT, no pide archivo — el backend
  // genera el HTML al vuelo (vista cliente SONDEL o vista interna MARLUVAS
  // segun audience) y lo persiste como documento.
  const isAutoProforma = (
    kind === "PROFORMA" && !!expedienteId && !viewerIsClient
  );
  // Sprint 2026-06-01 · Auto-Factura: la Factura comercial se GENERA (no se
  // sube archivo) con el mismo formato que la factura de transferencia,
  // ruteada por audiencia (cliente vs MWT/admin).
  const isAutoFactura = (
    kind === "FACTURA" && !!expedienteId && !viewerIsClient
  );
  const isAutoGen = isAutoProforma || isAutoFactura;

  const onSubmit = async () => {
    if (!kind) { setError(lang === "es" ? "Elige el tipo" : "Pick a type"); return; }
    if (!isAutoGen && !file) {
      setError(lang === "es" ? "Sube un archivo" : "Upload a file"); return;
    }

    // === RAMA AUTO-FACTURA (genera HTML, no sube archivo) ===
    if (isAutoFactura) {
      setUploading(true); setError(null); setAiPhase(null);
      try {
        const aud = audienceApplies ? audience : "CLIENT";
        const facturaFile = await buildExpedienteFacturaFile({
          expedienteId, audience: aud, lang,
        });
        const fd = new FormData();
        fd.append("kind", "FACTURA");
        fd.append("codigo", facturaFile.name.replace(/\.html$/i, ""));
        fd.append("file", facturaFile, facturaFile.name);
        if (ocId) fd.append("oc_id", ocId);
        fd.append("expediente_id", expedienteId);
        fd.append("audience", aud);
        const token = getToken();
        const resp = await fetch(`${API_BASE}/documentos/`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: fd,
        });
        const text = await resp.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
        if (!resp.ok) {
          throw new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
        }
        if (typeof onUploaded === "function") onUploaded(data);
        if (typeof onClose === "function") onClose();
        return;
      } catch (e) {
        setError(
          (lang === "es" ? "No se pudo generar la factura" : "Could not generate invoice") +
          ": " + (e?.message || String(e))
        );
        return;
      } finally {
        setUploading(false); setAiPhase(null);
      }
    }

    // === RAMA AUTO-PROFORMA (sin archivo) ===
    if (isAutoProforma) {
      setUploading(true); setError(null); setAiPhase(null);
      try {
        const targetExpId = expedienteId;
        const audiencePayload = audienceApplies ? audience : "CLIENT";
        const body = {
          audience: audiencePayload,
          codigo: (codigo || "").trim() || null,
          // Sprint 2026-05-24 · NO enviar payment_days. El backend ya
          // rutea segun audience: CLIENT -> expediente.credit_days,
          // MWT_INTERNAL/ADMIN_ONLY -> expediente.credit_days_mwt.
          // Mandar paymentDays aqui sobreescribia credit_days_mwt con
          // el legacy credit_days del cliente (bug visible: vista Marluvas
          // mostraba 8d activo cuando credit_days_mwt era 90).
        };
        const token = getToken();
        const resp = await fetch(
          `${API_BASE}/expedientes/${encodeURIComponent(targetExpId)}/generate-proforma/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          }
        );
        const text = await resp.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
        if (!resp.ok) {
          throw new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
        }
        if (typeof onUploaded === "function") onUploaded(data);
        if (typeof onClose === "function") onClose();
        return;
      } catch (e) {
        setError(
          (lang === "es" ? "No se pudo generar la proforma" : "Could not generate proforma") +
          ": " + (e?.message || String(e))
        );
        return;
      } finally {
        setUploading(false); setAiPhase(null);
      }
    }

    setUploading(true); setError(null); setAiPhase("uploading");
    try {
      // Sprint 2026-05-10 · si el admin cambió el plazo de pronto pago
      // para esta Proforma, PATCHear el expediente ANTES del upload.
      // Asi cuando el backend auto-genere el HTML cliente (render_proforma_html
      // dinamico), usa el nuevo credit_days y aplica el tier correcto.
      const shouldPatchPlazo = (
        kind === "PROFORMA"
        && expedienteId
        && !viewerIsClient
        && Number(paymentDays) > 0
        && Number(paymentDays) !== Number(expedienteCreditDays)
      );
      if (shouldPatchPlazo) {
        try {
          await expedientesApi.update(expedienteId, {
            credit_days: Number(paymentDays),
          });
        } catch (patchErr) {
          // No bloquea el upload del PDF — solo avisa.
          // eslint-disable-next-line no-console
          console.warn("[UploadDocumentModal] PATCH credit_days falló:", patchErr);
          setError(
            lang === "es"
              ? `No pude actualizar el plazo de pago a ${paymentDays}d. El PDF se va a subir pero el HTML cliente puede mostrar el plazo viejo.`
              : `Could not update payment terms to ${paymentDays}d. PDF will upload but client HTML may show old terms.`
          );
        }
      }

      // 1) Persistir el documento en /api/documentos/ (siempre).
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("codigo", (codigo || "").trim() || file.name);
      fd.append("file", file, file.name);
      if (ocId) fd.append("oc_id", ocId);
      if (expedienteId) fd.append("expediente_id", expedienteId);
      // Sprint 2026-05-06 · CLIENT_* siempre fuerza audience=CLIENT
      // (no expone documentos internos MWT). ADMIN/MWT respeta la
      // selección del usuario. El backend tolera el campo aunque no
      // sea Proforma/Factura (lo ignora si no aplica).
      const effectiveAudience = viewerIsClient
        ? "CLIENT"
        : (audienceApplies ? audience : "CLIENT");
      fd.append("audience", effectiveAudience);

      const token = getToken();
      const resp = await fetch(`${API_BASE}/documentos/`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });
      const text = await resp.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
      }

      // BUG FIX 2026-05-02 (AG-03): NO disparamos `onUploaded(data)` antes
      // de la IA. El padre típicamente reacciona haciendo `navigate(0)` con
      // un setTimeout(200ms), lo que aborta la promesa IA en vuelo y nunca
      // se abre el wizard de revisión. Cuando hay IA, el padre va a
      // refrescar al cerrar el wizard (vía onApplied). Cuando NO hay IA,
      // sí disparamos onUploaded al final para refrescar el listado.

      // 2) Si aplica, encadenar extracción IA + matchmaker.
      if (aiEligible) {
        setAiPhase("analyzing");
        try {
          const ai = await documentMatchmakerApi.upload(
            expedienteId, file, kindObj.aiPipeline,
          );

          // Sprint 2026-05-10 · si la IA extrajo líneas de una Proforma,
          // aplicar el tier de pronto pago a `unit_price_client` de las
          // líneas matched. Best-effort: no rompe el flujo si falla
          // (el doc ya está subido y el matchmaker wizard sigue abriéndose).
          if (kind === "PROFORMA" && !viewerIsClient && expedienteId
              && Number(paymentDays) > 0) {
            try {
              const groups = (ai?.ai_payload?.groups) || (ai?.mismatch_payload?.groups) || [];
              const pairsMap = new Map();
              for (const g of groups) {
                const lines = g?.lines || [];
                for (const ln of lines) {
                  const sku = String(ln?.sku || "").trim().toUpperCase();
                  const sizeRaw = ln?.talla ?? ln?.size ?? null;
                  const size = sizeRaw != null && sizeRaw !== ""
                    ? String(sizeRaw).trim().toUpperCase()
                    : null;
                  if (!sku) continue;
                  pairsMap.set(`${sku}|${size || ""}`, { sku, size });
                }
              }
              const coveredPairs = Array.from(pairsMap.values());

              if (coveredPairs.length > 0) {
                const token2 = getToken();
                const url = `${API_BASE}/expedientes/${encodeURIComponent(expedienteId)}/apply-pronto-pago/`;
                const respPP = await fetch(url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token2 ? { Authorization: `Bearer ${token2}` } : {}),
                  },
                  body: JSON.stringify({
                    plazo_days:    Number(paymentDays),
                    covered_pairs: coveredPairs,
                  }),
                });
                if (!respPP.ok) {
                  const errText = await respPP.text().catch(() => "");
                  // eslint-disable-next-line no-console
                  console.warn("[UploadDocumentModal] apply-pronto-pago falló:",
                               respPP.status, errText);
                } else {
                  const ppData = await respPP.json().catch(() => null);
                  // eslint-disable-next-line no-console
                  console.info("[UploadDocumentModal] apply-pronto-pago OK:",
                               `${ppData?.lines_updated || 0} líneas a ${paymentDays}d tier ${ppData?.tier_pct || 0}%`);
                }
              }
            } catch (ppErr) {
              // eslint-disable-next-line no-console
              console.warn("[UploadDocumentModal] apply-pronto-pago error:", ppErr);
            }
          }

          // Pasamos `data` al padre para que pueda hidratar el listado de
          // documentos sin esperar la recarga (mejor UX).
          onAiAnalysisReady?.(ai, file, kindObj.aiPipeline, data);
          reset();
          onClose?.();
          return;
        } catch (aiErr) {
          // Falla en IA NO debe bloquear el flujo: el doc ya se guardó.
          // Avisamos al padre del upload exitoso y mostramos el aviso.
          // eslint-disable-next-line no-console
          console.warn("[UploadDocumentModal] IA matchmaker falló:", aiErr);
          onUploaded?.(data);
          setError(
            lang === "es"
              ? "Documento subido, pero el análisis IA falló. Podés reprocesarlo desde Documentos comerciales."
              : "Document uploaded, but AI analysis failed. You can reprocess it from Commercial documents."
          );
          setUploading(false);
          setAiPhase(null);
          return;
        }
      }

      // Sin IA → fire onUploaded para que el padre refresque el listado.
      onUploaded?.(data);
      reset();
      onClose?.();
    } catch (e) {
      setError(e.message || (lang === "es" ? "Error al subir" : "Upload error"));
      setAiPhase(null);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (ev) => {
    ev.preventDefault();
    setDragOver(false);
    const f = ev.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  };

  const cta = (() => {
    if (aiPhase === "analyzing") {
      return lang === "es" ? "Analizando con IA…" : "Analyzing with AI…";
    }
    if (uploading) {
      return lang === "es" ? "Subiendo…" : "Uploading…";
    }
    if (aiEligible) {
      return lang === "es" ? "Subir y analizar con IA" : "Upload & analyze with AI";
    }
    // Sprint 2026-05-24 · Auto-Proforma: label distinto cuando no se sube archivo
    if (kind === "PROFORMA" && !!expedienteId && !viewerIsClient) {
      return lang === "es" ? "Generar proforma" : "Generate proforma";
    }
    if (kind === "FACTURA" && !!expedienteId && !viewerIsClient) {
      return lang === "es" ? "Generar factura" : "Generate invoice";
    }
    return lang === "es" ? "Subir documento" : "Upload document";
  })();

  return (
    <div
      onClick={() => !uploading && onClose?.()}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(11,30,58,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 14,
          width: "min(560px, 96vw)", maxHeight: "90vh",
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "linear-gradient(135deg, rgba(48,131,254,0.04), rgba(0,178,134,0.03))",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--brand-info, #3083FE)", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconUpload size={14}/>
            </div>
            <div>
              <div className="micro" style={{
                color: "var(--text-tertiary)", letterSpacing: 1,
              }}>
                {lang === "es" ? "DOCUMENTO COMERCIAL" : "COMMERCIAL DOCUMENT"}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>
                {lang === "es" ? "Agregar documento" : "Add document"}
                {contextLabel && (
                  <span className="caption mono-sm" style={{
                    marginLeft: 8, color: "var(--text-tertiary)",
                    fontWeight: 500, fontSize: 12,
                  }}>· {contextLabel}</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button" disabled={uploading}
            onClick={onClose}
            className="btn btn-ghost btn-sm" style={{ padding: "6px 8px" }}
          >
            <IconX size={11}/>
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: 20, display: "flex", flexDirection: "column", gap: 14,
          overflowY: "auto",
        }}>
          {/* Tipo de documento */}
          <div>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Tipo de documento" : "Document type"}{" "}
              <span style={{ color: "var(--danger, #DC2626)" }}>*</span>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
              gap: 8,
            }}>
              {DOCUMENT_KINDS.map((k) => {
                const active = kind === k.id;
                const hasAi = !!k.aiPipeline && !!expedienteId && !!onAiAnalysisReady;
                return (
                  <button
                    key={k.id} type="button"
                    onClick={() => setKind(k.id)}
                    disabled={uploading}
                    style={{
                      padding: "8px 10px",
                      border: active
                        ? "1.5px solid var(--success, #00B286)"
                        : "1px solid var(--border)",
                      borderRadius: 8,
                      background: active
                        ? "color-mix(in oklab, var(--success, #00B286) 6%, transparent)"
                        : "white",
                      cursor: uploading ? "not-allowed" : "pointer",
                      textAlign: "left",
                      fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                      display: "flex", alignItems: "center", gap: 6,
                      position: "relative",
                    }}
                  >
                    {active
                      ? <IconCheck size={12} style={{ color: "var(--success, #00B286)", flexShrink: 0 }}/>
                      : <IconFileText size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }}/>}
                    <span style={{ flex: 1 }}>{lang === "es" ? k.es : k.en}</span>
                    {hasAi && (
                      <span
                        title={lang === "es" ? "Análisis con IA disponible" : "AI analysis available"}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 6px",
                          borderRadius: 999,
                          background: "color-mix(in oklab, var(--brand-accent, #481EE3) 12%, transparent)",
                          color: "var(--brand-accent, #481EE3)",
                          letterSpacing: 0.4,
                          display: "inline-flex", alignItems: "center", gap: 3,
                        }}
                      >
                        <IconSparkle size={9}/> IA
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="caption" style={{
              marginTop: 6, fontSize: 11,
              color: "var(--text-tertiary)", lineHeight: 1.4,
            }}>
              {lang === "es" ? kindObj.hint_es : kindObj.hint_en}
              {aiEligible && (
                <>
                  {" "}
                  <span style={{ color: "var(--brand-accent, #481EE3)", fontWeight: 600 }}>
                    {lang === "es"
                      ? "· La IA leerá el documento y mapeará los productos contra el catálogo."
                      : "· AI will OCR the doc and match products against the catalog."}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Sprint 2026-05-06 · AUDIENCIA del documento. Solo se muestra
              al ADMIN/MWT y solo cuando el tipo es Proforma o Factura.
              CLIENT_* nunca lo ve — el backend fuerza CLIENT igualmente. */}
          {audienceApplies && (
            <div>
              <div className="micro" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                color: "var(--text-tertiary)", textTransform: "uppercase",
                marginBottom: 6,
              }}>
                {lang === "es" ? "Audiencia" : "Audience"}{" "}
                <span style={{ color: "var(--danger, #DC2626)" }}>*</span>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: viewerIsAdmin ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
                gap: 8,
              }}>
                {[
                  {
                    id: "CLIENT",
                    es_label: "Para el cliente",
                    en_label: "For the client",
                    es_hint: "Visible en el portal B2B del cliente.",
                    en_hint: "Visible in the client B2B portal.",
                    icon: null,
                    show: true,
                  },
                  {
                    id: "MWT_INTERNAL",
                    es_label: "Solo Muito Work Limitada",
                    en_label: "Muito Work Limitada only",
                    es_hint: "Interno · no se muestra al cliente.",
                    en_hint: "Internal · not shown to the client.",
                    icon: <IconLock size={11}/>,
                    show: true,
                  },
                  {
                    id: "ADMIN_ONLY",
                    es_label: "Solo Admin (CEO)",
                    en_label: "Admin only (CEO)",
                    es_hint: "Confidencial · solo CEO/superuser.",
                    en_hint: "Confidential · CEO/superuser only.",
                    icon: <IconLock size={11}/>,
                    show: viewerIsAdmin,
                  },
                ].filter((a) => a.show).map((a) => {
                  const active = audience === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={uploading}
                      onClick={() => setAudience(a.id)}
                      style={{
                        padding: "10px 12px", textAlign: "left",
                        border: active
                          ? "1.5px solid var(--success, #00B286)"
                          : "1px solid var(--border)",
                        borderRadius: 8,
                        background: active
                          ? "color-mix(in oklab, var(--success, #00B286) 6%, transparent)"
                          : "var(--surface-raised, #fff)",
                        cursor: uploading ? "not-allowed" : "pointer",
                        display: "flex", flexDirection: "column", gap: 4,
                      }}
                    >
                      <span style={{
                        display: "flex", alignItems: "center", gap: 6,
                        fontSize: 13, fontWeight: 700,
                        color: "var(--text-primary)",
                      }}>
                        {active && <IconCheck size={11} style={{ color: "var(--success, #00B286)" }}/>}
                        {!active && a.icon}
                        {lang === "es" ? a.es_label : a.en_label}
                      </span>
                      <span className="caption" style={{
                        fontSize: 11, color: "var(--text-tertiary)",
                      }}>
                        {lang === "es" ? a.es_hint : a.en_hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sprint 2026-05-10 · PLAZO DE PAGO (pronto pago). Solo se
              muestra cuando el admin/MWT sube una PROFORMA con expediente
              vinculado. Cambia el credit_days del expediente y por ende
              afecta el HTML cliente auto-generado (descuento aplicado).

              Sprint 2026-05-24 · REMOVIDO del UI con `false &&`. El plazo
              ahora viene del wizard Paso 3 (credit_days_mwt y
              credit_days_cliente del expediente), y unit_price_client ya
              tiene el descuento aplicado. No tiene sentido pedirlo aqui.
              Codigo conservado por si en el futuro queremos reactivar el
              campo para el caso de subir un PDF de proforma a mano. */}
          {false && kind === "PROFORMA" && expedienteId && !viewerIsClient && (
            <div>
              <div className="micro" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                color: "var(--text-tertiary)", textTransform: "uppercase",
                marginBottom: 6,
              }}>
                {lang === "es" ? "Plazo de pago (pronto pago)" : "Payment terms (early payment)"}
              </div>
              <select
                className="input"
                value={paymentDays}
                disabled={uploading}
                onChange={(e) => setPaymentDays(Number(e.target.value))}
                style={{
                  width: "100%", fontSize: 13, padding: "10px 12px",
                  border: "1px solid var(--border)", borderRadius: 8,
                  fontWeight: 700, fontFamily: "inherit",
                  background: "var(--surface-raised, #fff)",
                }}
              >
                {PRONTO_PAGO_TIERS.map((tier) => {
                  const isBase = tier.days === 90;
                  const sign = tier.pct < 0 ? "−" : tier.pct > 0 ? "+" : "";
                  const pctText = isBase
                    ? (lang === "es" ? "base" : "base")
                    : `${sign}${Math.abs(tier.pct).toFixed(2)}%`;
                  return (
                    <option key={tier.days} value={tier.days}>
                      {tier.days} {lang === "es" ? "días" : "days"} · {pctText}
                      {Number(expedienteCreditDays) === tier.days
                        ? (lang === "es" ? " · actual" : " · current")
                        : ""}
                    </option>
                  );
                })}
              </select>
              <div className="caption" style={{
                marginTop: 6, fontSize: 11, color: "var(--text-tertiary)",
                lineHeight: 1.4,
              }}>
                {lang === "es"
                  ? "Cambia el plazo del expediente y aplica el descuento/recargo a unit_price_client de los productos detectados en la proforma. Solo el precio del cliente cambia — el precio MWT queda intacto. Productos no presentes en la proforma no se modifican."
                  : "Updates the expediente's payment terms and applies the discount/surcharge to unit_price_client of products detected in the proforma. Only the client's price changes — MWT's price is preserved. Products not in the proforma stay unchanged."}
              </div>
            </div>
          )}

          {/* Numero / Codigo del documento. Oculto para Factura comercial
              auto-generada: el código sale del expediente. */}
          {!isAutoFactura && (
          <label style={{ display: "block" }}>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Numero / Codigo (opcional)" : "Number / Code (optional)"}
            </div>
            <input
              type="text" className="input mono-sm"
              value={codigo}
              disabled={uploading}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder={
                kind === "OC" ? "PO-..." :
                kind === "PROFORMA" ? "PF-..." :
                kind === "FACTURA" ? "FAC-..." :
                lang === "es" ? "Identificador (opcional)" : "Identifier (optional)"
              }
              style={{
                width: "100%", fontSize: 13, padding: "10px 12px",
                border: "1px solid var(--border)", borderRadius: 8,
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
          </label>
          )}

          {/* Drop zone (oculto cuando se auto-genera el HTML: proforma o factura) */}
          {!isAutoGen && (
          <div>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Archivo" : "File"}{" "}
              <span style={{ color: "var(--danger, #DC2626)" }}>*</span>
            </div>
            <div
              onClick={() => !uploading && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              role="button" tabIndex={0}
              style={{
                border: dragOver
                  ? "2px dashed var(--success, #00B286)"
                  : file
                    ? "1.5px solid var(--success, #00B286)"
                    : "2px dashed var(--border)",
                borderRadius: 12,
                background: dragOver
                  ? "color-mix(in oklab, var(--success, #00B286) 6%, transparent)"
                  : file ? "color-mix(in oklab, var(--success, #00B286) 4%, transparent)" : "white",
                padding: file ? "14px 16px" : "32px 20px",
                textAlign: "center",
                cursor: uploading ? "not-allowed" : "pointer",
                transition: "all 0.15s",
              }}
            >
              <input
                ref={inputRef} type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
                accept=".pdf,.png,.jpg,.jpeg,.xml,.xlsx,.xls,.docx,.doc"
              />
              {file ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  textAlign: "left",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: "color-mix(in oklab, var(--success, #00B286) 10%, transparent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--success, #00B286)", flexShrink: 0,
                  }}>
                    <IconFileText size={16}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{file.name}</div>
                    <div className="caption tabular-nums" style={{
                      fontSize: 11, color: "var(--text-tertiary)", marginTop: 2,
                    }}>
                      {prettyBytes(file.size)}
                    </div>
                  </div>
                     <button
                    type="button" disabled={uploading}
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    style={{
                      background: "transparent", border: 0,
                      color: "var(--danger, #D64545)", cursor: "pointer", padding: 6,
                    }}
                  >
                    <IconX size={12}/>
                  </button>
                </div>
              ) : (
                <>
                  <IconUpload size={28} style={{
                    color: dragOver ? "var(--success, #00B286)" : "var(--text-tertiary)",
                    marginBottom: 8,
                  }}/>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: "var(--text-primary)",
                    marginBottom: 4,
                  }}>
                    {lang === "es"
                      ? "Arrastra el archivo aqui"
                      : "Drag & drop the file here"}
                  </div>
                  <div className="caption" style={{
                    fontSize: 12, color: "var(--text-tertiary)",
                  }}>
                    {lang === "es"
                      ? "o hace click para seleccionar (max 20MB)"
                      : "or click to select (max 20MB)"}
                  </div>
                </>
              )}
            </div>
          </div>
          )}

          {/* Estado IA en curso */}
          {aiPhase === "analyzing" && (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "color-mix(in oklab, var(--brand-accent, #481EE3) 8%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-accent, #481EE3) 30%, transparent)",
              color: "var(--brand-accent, #481EE3)", fontSize: 13,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <IconSparkle size={12}/>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {lang === "es"
                    ? "La IA está leyendo el documento…"
                    : "AI is reading the document…"}
                </div>
                <div className="caption" style={{ fontSize: 11, marginTop: 2 }}>
                  {lang === "es"
                    ? "Extrayendo productos, tallas y cantidades. Tarda 5–15 s."
                    : "Extracting products, sizes and qtys. Takes 5–15 s."}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: 8,
              background: "color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)",
              color: "var(--danger, #991B1B)",
              border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 35%, transparent)",
              fontSize: 13,
              display: "flex", alignItems: "flex-start", gap: 6,
            }}>
              <IconAlert size={11} style={{ flexShrink: 0, marginTop: 3 }}/>
              <div>{error}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          background: "color-mix(in oklab, var(--text-primary) 2%, transparent)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            type="button" disabled={uploading}
            onClick={onClose}
            className="btn btn-ghost"
          >
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={uploading || !kind || (!isAutoGen && !file)}
            onClick={onSubmit}
            className="btn btn-accent"
            style={{
              fontWeight: 700, minWidth: 180,
              background: aiEligible ? "var(--brand-accent, #481EE3)" : "var(--success, #00B286)",
              borderColor: aiEligible ? "var(--brand-accent, #481EE3)" : "var(--success, #00B286)",
            }}
          >
            {aiEligible ? <IconSparkle size={12}/> : <IconCheck size={12}/>}
            <span style={{ marginLeft: 6 }}>{cta}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
