// =====================================================================
// MWT.ONE · components/expedientes/ExportExpedientesModal.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Modal del botón "Exportar" en /expedientes. Todas las preguntas son
// OPCIONALES:
//   · Audiencia .......... Cliente | Admin/Interno (MWT)  → matriz de precio
//   · Cliente ............ filtra a un cliente (o Todos)
//   · Estado ............. exporta todos los expedientes en ese estado
//   · Expediente ......... exporta uno específico (anula cliente/estado)
//
// El resultado es un .html "Resumen de Exportación" (SKU · tallas ·
// cantidad por talla + precio + costos del movimiento).
//
// Patrón framer-motion (AnimatePresence + motion.div, sin portal) idéntico
// al resto de modales del repo. Tokens MWT vía CSS variables (R1). Estados
// disabled/loading (§4). tabular-nums en el contador (R5).
// =====================================================================
import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { INVOICE_AUDIENCE } from "../../lib/transferInvoiceHtml.js";
import { resolveTargets } from "../../lib/expedienteExport.js";

/**
 * @typedef {Object} ExportExpedientesModalProps
 * @property {boolean} open
 * @property {('es'|'en')} lang
 * @property {boolean} [isAdmin]                       // default audience MWT si true
 * @property {Array<{id:string,name:string}>} clients
 * @property {Array<{code:string,label:string}>} estados
 * @property {Array<{uuid:string,ref:string,status:string,client_id:string}>} expedientes
 * @property {boolean} [loading]
 * @property {(args:Object)=>void} onConfirm
 * @property {()=>void} onClose
 */

const L = (lang, es, en) => (lang === "es" ? es : en);

/** @param {ExportExpedientesModalProps} props */
export default function ExportExpedientesModal({
  open,
  lang = "es",
  isAdmin = true,
  clients = [],
  estados = [],
  expedientes = [],
  loading = false,
  error = "",
  onConfirm,
  onClose,
}) {
  const [audience, setAudience] = useState(
    isAdmin ? INVOICE_AUDIENCE.MWT : INVOICE_AUDIENCE.CLIENT,
  );
  const [clienteId, setClienteId] = useState("ALL");
  const [estado, setEstado] = useState("ALL");
  const [expedienteUuid, setExpedienteUuid] = useState("");
  const [includeArtifacts, setIncludeArtifacts] = useState(true);

  // Reset al abrir.
  useEffect(() => {
    if (open) {
      setAudience(isAdmin ? INVOICE_AUDIENCE.MWT : INVOICE_AUDIENCE.CLIENT);
      setClienteId("ALL");
      setEstado("ALL");
      setExpedienteUuid("");
      setIncludeArtifacts(true);
    }
  }, [open, isAdmin]);

  const specific = !!expedienteUuid;

  // Expedientes disponibles para el selector "específico", respetando el
  // filtro de cliente para no abrumar.
  const expOptions = useMemo(() => {
    const rows = Array.isArray(expedientes) ? expedientes : [];
    return rows
      .filter((r) => clienteId === "ALL" || r.client_id === clienteId)
      .map((r) => ({ uuid: r.uuid || r.id, ref: r.ref || r.codigo || r.uuid }));
  }, [expedientes, clienteId]);

  // Conteo en vivo de cuántos expedientes se exportarán.
  const matchCount = useMemo(() => {
    return resolveTargets(expedientes, {
      expedienteUuid: specific ? expedienteUuid : undefined,
      clienteId: specific ? undefined : clienteId,
      estado: specific ? undefined : estado,
    }).length;
  }, [expedientes, specific, expedienteUuid, clienteId, estado]);

  const handleConfirm = () => {
    if (!onConfirm) return;
    const clienteLabel =
      clienteId !== "ALL"
        ? (clients.find((c) => c.id === clienteId) || {}).name || ""
        : "";
    const estadoLabel =
      estado !== "ALL"
        ? (estados.find((e) => e.code === estado) || {}).label || estado
        : "";
    const expedienteLabel = specific
      ? (expOptions.find((e) => e.uuid === expedienteUuid) || {}).ref || ""
      : "";
    onConfirm({
      audience,
      clienteId: specific ? undefined : clienteId,
      estado: specific ? undefined : estado,
      expedienteUuid: specific ? expedienteUuid : undefined,
      includeArtifacts,
      clienteLabel,
      estadoLabel,
      expedienteLabel,
    });
  };

  const audOptions = [
    {
      value: INVOICE_AUDIENCE.MWT,
      title: L(lang, "Admin / Interno", "Admin / Internal"),
      sub: L(lang, "Precio MWT si MWT opera; cliente si lo opera el cliente", "MWT price if MWT operates; client price otherwise"),
      tag: "MWT",
      accent: "var(--brand-primary, #013A57)",
    },
    {
      value: INVOICE_AUDIENCE.CLIENT,
      title: L(lang, "Cliente", "Client"),
      sub: L(lang, "Siempre precio de venta (unit_price_client)", "Always sale price (unit_price_client)"),
      tag: "CLIENTE",
      accent: "var(--info, #0369A1)",
    },
  ];

  const fieldStyle = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid var(--border-subtle, #E2E8F0)",
    background: "var(--surface, #FFFFFF)",
    color: "var(--text-primary, #0F172A)",
    fontSize: 13,
  };
  const labelStyle = {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-secondary, #475569)",
    marginBottom: 5,
    letterSpacing: 0.3,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={loading ? undefined : onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(2,15,30,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: "100%", maxWidth: 560,
              maxHeight: "90vh", overflowY: "auto",
              background: "var(--surface-raised, #FFFFFF)",
              borderRadius: 14,
              boxShadow: "0 24px 64px rgba(2,15,30,0.28)",
            }}
          >
            {/* Header */}
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-subtle, #E2E8F0)" }}>
              <div className="micro" style={{ color: "var(--brand-accent, #0E8A6D)", letterSpacing: 1, fontWeight: 700, marginBottom: 4 }}>
                {L(lang, "EXPORTAR EXPEDIENTES", "EXPORT FILES")}
              </div>
              <div className="heading-sm" style={{ margin: 0, color: "var(--text-primary, #0F172A)" }}>
                {L(lang, "Reporte Cronograma", "Timeline report")}
              </div>
              <div className="body-sm" style={{ color: "var(--text-secondary, #475569)", marginTop: 4 }}>
                {L(lang, "Todos los filtros son opcionales. Abre el Cronograma interactivo en una pestaña nueva.", "All filters are optional. Opens the interactive Timeline in a new tab.")}
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Audiencia — solo admin/CEO elige; cliente B2B siempre genera vista CLIENT */}
              {isAdmin && (
              <div>
                <span style={labelStyle}>{L(lang, "¿Para quién es el reporte?", "Who is the report for?")}</span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {audOptions.map((o) => {
                    const active = audience === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        disabled={loading}
                        onClick={() => setAudience(o.value)}
                        style={{
                          flex: "1 1 220px", textAlign: "left",
                          padding: "12px 14px", borderRadius: 10,
                          border: `1.5px solid ${active ? o.accent : "var(--border-subtle, #E2E8F0)"}`,
                          borderLeft: `4px solid ${o.accent}`,
                          background: active ? "var(--surface-alt, #F1F5F9)" : "var(--surface, #FFFFFF)",
                          cursor: loading ? "wait" : "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary, #0F172A)" }}>{o.title}</span>
                          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "var(--surface-alt, #F1F5F9)", color: o.accent }}>{o.tag}</span>
                        </div>
                        <div className="body-sm" style={{ color: "var(--text-secondary, #475569)", marginTop: 3, fontSize: 11 }}>{o.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Cliente + Estado */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", opacity: specific ? 0.5 : 1 }}>
                  <span style={labelStyle}>{L(lang, "Cliente (opcional)", "Client (optional)")}</span>
                  <select
                    style={fieldStyle}
                    value={clienteId}
                    disabled={loading || specific}
                    onChange={(e) => setClienteId(e.target.value)}
                  >
                    <option value="ALL">{L(lang, "Todos los clientes", "All clients")}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 220px", opacity: specific ? 0.5 : 1 }}>
                  <span style={labelStyle}>{L(lang, "Estado (opcional)", "State (optional)")}</span>
                  <select
                    style={fieldStyle}
                    value={estado}
                    disabled={loading || specific}
                    onChange={(e) => setEstado(e.target.value)}
                  >
                    <option value="ALL">{L(lang, "Todos los estados", "All states")}</option>
                    {estados.map((s) => (
                      <option key={s.code} value={s.code}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Expediente específico */}
              <div>
                <span style={labelStyle}>{L(lang, "Expediente específico (opcional · anula filtros)", "Specific file (optional · overrides filters)")}</span>
                <select
                  style={fieldStyle}
                  value={expedienteUuid}
                  disabled={loading}
                  onChange={(e) => setExpedienteUuid(e.target.value)}
                >
                  <option value="">{L(lang, "— Usar filtros de arriba —", "— Use filters above —")}</option>
                  {expOptions.map((e) => (
                    <option key={e.uuid} value={e.uuid}>{e.ref}</option>
                  ))}
                </select>
              </div>

              {/* Incluir artefactos */}
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: loading ? "default" : "pointer", fontSize: 13, color: "var(--text-primary, #0F172A)" }}>
                <input
                  type="checkbox"
                  checked={includeArtifacts}
                  disabled={loading}
                  onChange={(e) => setIncludeArtifacts(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--brand-primary, #013A57)" }}
                />
                <span>
                  {L(lang, "Incluir artefactos", "Include artifacts")}
                  <span style={{ color: "var(--text-tertiary, #94A3B8)", marginLeft: 6, fontSize: 11 }}>
                    {L(lang, "(Packing List, AWB/BL…)", "(Packing List, AWB/BL…)")}
                  </span>
                </span>
              </label>

              {/* Contador */}
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: "var(--surface-alt, #F1F5F9)",
                border: "1px solid var(--border-subtle, #E2E8F0)",
                fontSize: 12, color: "var(--text-secondary, #475569)",
              }}>
                {L(lang, "Se exportarán", "Will export")}{" "}
                <b className="num" style={{ color: "var(--brand-primary, #013A57)", fontVariantNumeric: "tabular-nums" }}>{matchCount}</b>{" "}
                {matchCount === 1 ? L(lang, "expediente", "file") : L(lang, "expedientes", "files")}.
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ margin: "0 20px 6px", padding: "9px 12px", borderRadius: 8, background: "var(--danger-soft, #FEE2E2)", color: "var(--crit, #DC2626)", fontSize: 12, fontWeight: 600 }}>
                {error}
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: "12px 22px 18px", display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid var(--border-subtle, #E2E8F0)" }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={onClose}>
                {L(lang, "Cancelar", "Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={loading || matchCount === 0}
                onClick={handleConfirm}
              >
                {loading ? L(lang, "Abriendo…", "Opening…") : L(lang, "Generar reporte", "Generate report")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
