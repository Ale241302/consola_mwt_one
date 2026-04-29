// ─────────────────────────────────────────────────────────────
// SubsidiariasTab — Tab "Subsidiarias" de la ficha de cliente.
// Agente responsable: [AG-FRONTEND]
//
// Solo se renderiza cuando el cliente actual es PADRE (is_parent).
// Muestra grid de cards con la misma estructura visual del dashboard
// /clientes (reusa .clients-grid + .client-card del CSS global).
//
// Acciones:
//   · "+ Nueva subsidiaria"   → SubsidiaryFormModal mode="create"
//   · click en card           → /clientes/:sub.id (detalle)
//   · botón Editar            → SubsidiaryFormModal mode="edit"
//   · botón Eliminar          → soft-delete vía DELETE /api/clientes/:id/
//
// Datos:
//   GET /api/clientes/{parentId}/subsidiarias/   → ClienteListSerializer
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconUser, IconMail, IconMapPin,
  IconCreditCard, IconUsers, IconRefresh, IconAlert,
} from "../../lib/icons.jsx";
import { fmtMoney } from "../../lib/i18n.js";
import { clientesApi } from "../../lib/api.js";
import SubsidiaryFormModal from "./SubsidiaryFormModal.jsx";

const COUNTRY_NAME = {
  MX: "México", PE: "Perú", CO: "Colombia", CL: "Chile", PA: "Panamá",
  BR: "Brasil", CR: "Costa Rica", US: "USA", CN: "China", EC: "Ecuador",
  AR: "Argentina", DO: "R. Dominicana", ES: "España", GT: "Guatemala",
};

const ESTADO_META = {
  ACTIVO:    { label: "Activo",    className: "badge-success" },
  PAUSADO:   { label: "Pausado",   className: "badge-warning" },
  BLOQUEADO: { label: "Bloqueado", className: "badge-danger"  },
  INACTIVO:  { label: "Inactivo",  className: "badge-outline" },
};

const CHANNEL_META = {
  directo:      { label: "Directo",      color: "#3083FE", soft: "rgba(48,131,254,0.12)" },
  distribuidor: { label: "Distribuidor", color: "#481EE3", soft: "rgba(72,30,227,0.12)"  },
};

function tipoToCanal(tipo) {
  return (tipo || "").toUpperCase() === "DISTRIBUIDOR" ? "distribuidor" : "directo";
}

export default function SubsidiariasTab({ parent, lang = "es" }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);   // { mode, data? }
  const [confirm, setConfirm] = useState(null); // sub a eliminar

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await clientesApi.action("subsidiarias", parent.id);
      setItems(Array.isArray(data) ? data : (data?.results || []));
    } catch (e) {
      setErr(e?.message || "fetch_failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [parent.id]);

  useEffect(() => { load(); }, [load]);

  const total = items.length;

  // KPI sub-strip: pool del parent
  const summary = useMemo(() => {
    const totalCredUsado = items.reduce((a, s) => a + Number(s.credito_usado || 0), 0);
    const totalExp = items.reduce((a, s) => a + Number(s.expedientes_activos || 0), 0);
    const activos = items.filter((s) => s.estado === "ACTIVO").length;
    return { totalCredUsado, totalExp, activos };
  }, [items]);

  if (loading) {
    return (
      <div className="card card-pad-lg empty">
        <IconRefresh size={18}
          style={{ color: "var(--brand-accent)", animation: "spin 1.2s linear infinite" }} />
        <div className="caption">{lang === "es" ? "Cargando subsidiarias…" : "Loading subsidiaries…"}</div>
      </div>
    );
  }

  if (err && !items.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconAlert size={20} style={{ color: "var(--text-tertiary)" }} />
        <div className="heading-md">
          {lang === "es" ? "No se pudieron cargar las subsidiarias" : "Couldn't load subsidiaries"}
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>{err}</div>
        <button className="btn btn-ghost" onClick={load}>
          <IconRefresh size={12} /> {lang === "es" ? "Reintentar" : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar ─────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div className="heading-md" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconUsers size={14} style={{ color: "var(--brand-accent, #00B286)" }} />
            <span>{total} {lang === "es" ? "subsidiaria" : "subsidiary"}{total !== 1 ? (lang === "es" ? "s" : "ies") : ""}</span>
          </div>
          {total > 0 && (
            <>
              <span className="caption" style={{ color: "var(--text-tertiary)" }}>·</span>
              <span className="caption">
                <strong>{summary.activos}</strong> {lang === "es" ? "activas" : "active"}
              </span>
              <span className="caption">·</span>
              <span className="caption">
                <strong className="mono-sm">{fmtMoney(summary.totalCredUsado)}</strong>{" "}
                {lang === "es" ? "consumido del pool" : "used from pool"}
              </span>
              <span className="caption">·</span>
              <span className="caption">
                <strong>{summary.totalExp}</strong> {lang === "es" ? "expedientes activos" : "active files"}
              </span>
            </>
          )}
        </div>
        <button className="btn btn-accent"
                onClick={() => setModal({ mode: "create" })}>
          <IconPlus size={14} />
          {lang === "es" ? "Nueva subsidiaria" : "New subsidiary"}
        </button>
      </div>

      {/* ── Empty state ─────────────────── */}
      {total === 0 && (
        <div className="card card-pad-lg empty" style={{ padding: 36 }}>
          <IconUsers size={26} style={{ color: "var(--text-tertiary)" }} />
          <div className="heading-md">
            {lang === "es" ? "Sin subsidiarias registradas" : "No subsidiaries yet"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", maxWidth: 460, textAlign: "center" }}>
            {lang === "es"
              ? "Las subsidiarias comparten el pool de crédito del cliente padre y tienen su propio código SAP, dirección de entrega y expedientes."
              : "Subsidiaries share the parent credit pool and own their SAP code, delivery address and files."}
          </div>
          <button className="btn btn-accent" onClick={() => setModal({ mode: "create" })}>
            <IconPlus size={12} /> {lang === "es" ? "Crear la primera" : "Create the first one"}
          </button>
        </div>
      )}

      {/* ── Grid de cards ───────────────── */}
      {total > 0 && (
        <div className="clients-grid">
          <AnimatePresence mode="popLayout">
            {items.map((s, idx) => {
              const canal   = tipoToCanal(s.tipo);
              const channel = CHANNEL_META[canal];
              const estado  = ESTADO_META[s.estado] || ESTADO_META.ACTIVO;
              const limit   = Number(s.credito_aprobado || 0);
              const used    = Number(s.credito_usado || 0);
              const utilPct = limit > 0 ? Math.round((used / limit) * 100) : 0;
              const creditBand = utilPct >= 100 ? "critical" : utilPct >= 85 ? "warning" : "ok";
              const country = COUNTRY_NAME[s.pais_iso2] || s.pais_iso2 || "—";

              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0,
                             transition: { delay: idx * 0.04, duration: 0.26, ease: "easeOut" } }}
                  exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                  whileHover={{ y: -3 }}
                  className="client-card"
                  data-estado={s.estado}
                  onClick={() => navigate(`/clientes/${s.id}`)}
                  style={{ cursor: "pointer",
                           "--channel-color": channel.color,
                           "--channel-soft":  channel.soft }}
                >
                  <div className="client-card-accent" />

                  <div className="client-card-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="client-name" title={s.razon_social}>
                        {s.nombre_comercial || s.razon_social || "—"}
                      </div>
                      <div className="client-loc">
                        <IconMapPin size={11} />
                        <span>{country}</span>
                      </div>
                    </div>
                    <span className={`badge ${estado.className}`}>
                      <span className="dot" />{estado.label}
                    </span>
                  </div>

                  <div className="client-card-meta">
                    <div className="sap-code" title="Código SAP (Marluvas)">
                      <span className="sap-label">SAP</span>
                      <span className="mono-sm">{s.codigo_marluvas || "—"}</span>
                    </div>
                    <span className="channel-badge">
                      <span className="channel-dot" style={{ background: channel.color }} />
                      {channel.label}
                    </span>
                  </div>

                  <div className="client-contact">
                    <div className="cc-row">
                      <IconUser size={11} />
                      <span className="cc-v" title={s.contacto_nombre}>
                        {s.contacto_nombre || "—"}
                      </span>
                    </div>
                    <div className="cc-row">
                      <IconMail size={11} />
                      <span className="cc-v mono-sm" title={s.contacto_email}>
                        {s.contacto_email || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="client-credit">
                    <div className="credit-line">
                      <span className="caption">
                        <IconCreditCard size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />
                        {lang === "es" ? "Pool padre" : "Parent pool"}
                      </span>
                      <span className={`credit-pct band-${creditBand}`}>{utilPct}%</span>
                    </div>
                    <div className={`credit-bar band-${creditBand}`}>
                      <span style={{ width: `${Math.min(100, utilPct)}%` }} />
                    </div>
                    <div className="caption" style={{ marginTop: 4,
                                                       display: "flex",
                                                       justifyContent: "space-between" }}>
                      <span>{fmtMoney(used)} {lang === "es" ? "consumido" : "used"}</span>
                      <span style={{ color: "var(--text-tertiary)" }}>{s.dias_credito || 0}d</span>
                    </div>
                  </div>

                  <div className="client-card-foot">
                    <span className="footstat">
                      <strong>{s.expedientes_activos || 0}</strong>
                      <span className="caption">
                        {lang === "es" ? "expedientes activos" : "active files"}
                      </span>
                    </span>
                    <span className="incoterm-pill" title={`Incoterm · ${s.incoterm || "—"}`}>
                      {s.incoterm || "—"}
                    </span>
                  </div>

                  {/* Barra de acciones — se queda al pie, no propaga click a la card */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      marginTop: 8, paddingTop: 10,
                      borderTop: "1px solid var(--border, #EAEEF5)",
                      display: "flex", justifyContent: "flex-end", gap: 6,
                    }}
                  >
                    <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => setModal({ mode: "edit", data: s })}>
                      {lang === "es" ? "Editar" : "Edit"}
                    </button>
                    <button className="btn btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 12, color: "#DC2626" }}
                            onClick={() => setConfirm(s)}>
                      {lang === "es" ? "Eliminar" : "Delete"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── Modal CRUD ──────────────────── */}
      {modal && (
        <SubsidiaryFormModal
          mode={modal.mode}
          parentId={parent.id}
          parentName={parent.razon_social || parent.nombre_comercial || parent.name}
          parentDefaults={{
            tipo:         parent.tipo,
            segmento:     parent.segmento,
            pais_iso2:    parent.pais_iso2,
            incoterm:     parent.incoterm,
            dias_credito: parent.dias_credito,
          }}
          initial={modal.data}
          lang={lang}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {/* ── Confirmación de eliminación ─── */}
      {confirm && (
        <ConfirmDelete
          name={confirm.razon_social || confirm.nombre_comercial}
          lang={lang}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await clientesApi.remove(confirm.id);
              setConfirm(null);
              load();
            } catch (e) {
              alert((lang === "es" ? "Error: " : "Error: ") + (e?.message || ""));
            }
          }}
        />
      )}
    </div>
  );
}

// ── Mini-modal de confirmación ──
function ConfirmDelete({ name, lang, onCancel, onConfirm }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 95,
        background: "rgba(15,27,61,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()}
           style={{
             background: "#FFFFFF", borderRadius: 14, padding: 24,
             width: "min(420px, 92vw)",
             boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
             fontFamily: "inherit",
           }}>
        <div style={{
          font: "600 11px/1 inherit", color: "#DC2626",
          letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
        }}>
          {lang === "es" ? "Acción destructiva" : "Destructive action"}
        </div>
        <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 8 }}>
          {lang === "es" ? "¿Eliminar esta subsidiaria?" : "Delete this subsidiary?"}
        </div>
        <div style={{ font: "500 13.5px/1.5 inherit", color: "#3D4A6B", marginBottom: 20 }}>
          {lang === "es"
            ? <>Vas a desactivar <strong>{name}</strong>. Es soft-delete: queda inactiva en BD pero el historial se conserva.</>
            : <>You're about to deactivate <strong>{name}</strong>. Soft-delete: history is preserved.</>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={onConfirm}
                  style={{
                    padding: "10px 16px", borderRadius: 9,
                    background: "#DC2626", color: "#FFFFFF", border: "none",
                    cursor: "pointer", font: "700 13.5px/1 inherit",
                  }}>
            {lang === "es" ? "Sí, eliminar" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
