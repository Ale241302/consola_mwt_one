// ─────────────────────────────────────────────────────────────
// CreateExpedienteWizardLite — Wizard Simplificado de 3 pasos
// Sprint Wizard Lite · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Reemplazo del CreateExpedienteWizard pesado (2000 líneas con OCR,
// marca, moneda, flete, totales). Esta versión es estrictamente:
//
//   Paso 1 · Cliente            cliente/subsidiaria + responsable
//   Paso 2 · Productos          plantilla CSV + matriz tallas + CPA
//   Paso 3 · Revisar y Crear    resumen limpio sin financiero
//
// El expediente nace en estado REGISTRO con marca/mode/currency NULL.
// El OPERATOR completa los datos comerciales en /expedientes/{id}
// antes de poder transitar T2 (REGISTRO → PRODUCCION). Esto se enforza
// con el componente CommercialDataHardStop dentro de ExpedienteDetail.
//
// Tokens: Navy #0B1E3A · Mint #00B286 · tabular-nums.
// POL_VISIBILIDAD: cero precios, cero subtotales, cero totales financieros.
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconChevRight, IconCheck, IconX, IconUpload, IconAlert,
  IconRefresh, IconUser, IconPackage, IconPlus, IconSearch, IconLock,
  IconMail, IconTrash,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import {
  clientesApi, expedientesApi, productosApi, tallasApi, apiFetch, getToken,
} from "../lib/api.js";

const STEPS = [
  { id: 1, label: "Cliente" },
  { id: 2, label: "Productos" },
  { id: 3, label: "Revisar y crear" },
];

// Plantilla compatible con Excel en locales LATAM/ES.
//
// Por qué `sep=;` en la primera línea:
//   Excel en MX/CO/PE/ES usa `;` como separador por default (porque la
//   coma `,` es separador decimal). Si el CSV usa `,`, Excel lo abre
//   todo en una sola columna. La directiva `sep=` (Microsoft) instruye
//   a Excel sobre qué separador usar, ignorando el locale.
//   Excel también respeta CSVs con `;` directamente.
//
// Por qué BOM UTF-8 (﻿):
//   Sin BOM, Excel asume Windows-1252 y rompe tildes / "ñ".
//
// El parser del backend ya hace csv.Sniffer() sobre los delimitadores
// `,;|\t` y acepta ambos transparentemente.
const TEMPLATE_CSV =
  "﻿" +
  "sep=;\n" +
  "SKU;Talla;Cantidad\n" +
  "ABC-123;M;10\n" +
  "ABC-123;L;5\n" +
  "XYZ-999;UNICA;20\n";

// ─────────────────────────────────────────────────────────────
export default function CreateExpedienteWizardLite() {
  const navigate = useNavigate();
  const { lang = "es" } = useOutletContext() || {};
  const [step, setStep]   = useState(1);
  const [error, setError] = useState(null);

  // ── Estado global ──
  const [clients, setClients]   = useState([]);
  const [users,   setUsers]     = useState([]);
  const [selClient, setSelClient]       = useState(null);   // {id, label, parent_id, …}
  const [selResponsable, setSelResp]    = useState(null);

  const [orderLines, setOrderLines]     = useState([]);     // [{tmpId, sku, talla, cantidad, producto_id, product_label, is_assigned, unassigned_request_sent}]
  const [parsing, setParsing]           = useState(false);
  const [manualOpen, setManualOpen]     = useState(false);
  const [reqDialog, setReqDialog]       = useState(null);   // {sku} cuando solicita asignación
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  // ── Sprint 2026-05-01: precios y proyeccion de credito ─────────
  // Mapa { producto_id -> unit_price } resuelto desde el catalogo de
  // productos para el cliente actual (especificaciones.client_prices
  // [client_id] || precio_lista). Lo usa el ADMIN para ver el valor
  // total del pedido y el impacto en el credito disponible. CLIENT
  // no ve precios (POL_VISIBILIDAD).
  const { isAdmin } = useRole();
  const [priceMap, setPriceMap] = useState({});

  useEffect(() => {
    // Reset cuando cambia el cliente: el override de precio depende
    // de client_id, asi que no podemos reusar el map anterior.
    setPriceMap({});
  }, [selClient?.id]);

  useEffect(() => {
    if (!selClient?.id) return;
    const uniquePidIds = Array.from(new Set(
      orderLines.map(l => l.producto_id).filter(Boolean)
    ));
    // Solo fetch los que aun no tenemos
    const missing = uniquePidIds.filter(pid => !(pid in priceMap));
    if (missing.length === 0) return;
    let cancel = false;
    Promise.all(
      missing.map(pid => productosApi.get(pid).catch(() => null))
    ).then(prods => {
      if (cancel) return;
      const next = { ...priceMap };
      for (const p of prods) {
        if (!p?.id) continue;
        const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
        const override = Number(cliMap[selClient.id] || 0);
        const lista    = Number(p.precio_lista || 0);
        next[p.id] = override > 0 ? override : lista;
      }
      setPriceMap(next);
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selClient?.id, orderLines]);

  // Total del pedido segun precios resueltos
  const orderTotalValue = useMemo(() => {
    return orderLines.reduce((acc, l) => {
      const unit = Number(priceMap[l.producto_id] || 0);
      return acc + Number(l.cantidad || 0) * unit;
    }, 0);
  }, [orderLines, priceMap]);

  // Proyeccion de credito post-pedido
  const creditProjection = useMemo(() => {
    if (!selClient) return null;
    const limit = Number(selClient.credito_limit || 0);
    const used  = Number(selClient.credito_used || 0);
    const available = Math.max(0, limit - used);
    const afterUsed = used + orderTotalValue;
    const afterAvailable = limit - afterUsed;
    const exceedsLimit = limit > 0 && afterUsed > limit;
    const utilPctAfter = limit > 0 ? Math.round((afterUsed / limit) * 100) : 0;
    return {
      limit, used, available,
      orderValue:  orderTotalValue,
      afterUsed,
      afterAvailable,
      exceedsLimit,
      utilPctAfter,
    };
  }, [selClient, orderTotalValue]);

  // ── Cargar catálogos ──
  useEffect(() => {
    clientesApi.list({ is_parent: "all" }).then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      setClients(orderClientsHierarchy(arr.map(adaptClient)));
    }).catch(() => setClients([]));

    apiFetch("/users/?role=admin&include_inactive=false", { token: getToken() })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setUsers(arr.filter((u) => u.is_active !== false));
      })
      .catch(() => setUsers([]));
  }, []);

  // ── Validación de step ──
  const canAdvance = useMemo(() => {
    if (step === 1) return !!selClient;
    if (step === 2) return orderLines.length > 0
                       && orderLines.every((l) => l.is_assigned !== false && l.cantidad > 0);
    return true;
  }, [step, selClient, orderLines]);

  // ── Submit ──
  const submit = useCallback(async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      // Agrupar líneas por (sku, talla) duplicadas — sumar cantidades.
      const grouped = {};
      orderLines.forEach((l) => {
        const k = `${l.sku}|${l.talla || ""}`;
        if (!grouped[k]) {
          grouped[k] = { ...l, cantidad: 0 };
        }
        grouped[k].cantidad += Number(l.cantidad || 0);
      });

      // Payload mínimo — el orchestrator legacy soporta crear con NULLs.
      const payload = {
        client_id:         selClient.id,
        responsable_id:    selResponsable?.id || null,
        responsable_name:  selResponsable?.full_name || null,
        // Esto NO va: marca, mode, freight_mode, currency.
        // El backend ya las marca como required=False.
        estado:            "REGISTRO",
        notas:             null,
        lines: Object.values(grouped).map((l) => ({
          sku:           l.sku,
          talla:         l.talla || null,
          cantidad:      Number(l.cantidad) || 0,
          producto_id:   l.producto_id || null,
          product_label: l.product_label || null,
        })),
      };

      const resp = await expedientesApi.create(payload);
      // Redirect al detalle del expediente recién creado.
      // La ruta canónica es /expedientes/<oc_id_or_none>/exp/<expediente_uuid>.
      // Como el wizard simplificado no crea OC, usamos "none" como placeholder
      // (ExpedienteDetail tolera ese valor — solo usa expedienteId).
      const expId = resp?.id;
      const ocId  = resp?.oc_id || resp?.oc?.id || "none";
      if (expId) {
        navigate(`/expedientes/${encodeURIComponent(ocId)}/exp/${encodeURIComponent(expId)}`);
      } else {
        navigate("/expedientes");
      }
    } catch (e) {
      const msg = e?.body?.detail || e?.message || "Error al crear el expediente";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [saving, orderLines, selClient, selResponsable, navigate]);

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      {/* ── Header ─────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/expedientes")}>
            <IconChevLeft size={12}/> {lang === "es" ? "Volver" : "Back"}
          </button>
          <div className="micro" style={{ marginTop: 8, marginBottom: 4 }}>
            {lang === "es" ? "EXPEDIENTES · INGRESO DE PEDIDO" : "FILES · ORDER INTAKE"}
          </div>
          <h1 className="page-title">
            {lang === "es" ? "Nuevo expediente" : "New file"}
          </h1>
          <div className="page-subtitle">
            {lang === "es"
              ? "Ingreso puro de pedido. Datos comerciales y logísticos se completan después en el detalle."
              : "Pure order intake. Commercial/logistics data is filled later in the detail view."}
          </div>
        </div>
      </div>

      {/* ── Stepper ─────────────────────── */}
      <Stepper step={step} onJump={(s) => s < step && setStep(s)} lang={lang}/>

      {/* ── Contenido ────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0,  transition: { duration: 0.22 } }}
          exit   ={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}>
          {step === 1 && (
            <Step1Cliente
              lang={lang}
              clients={clients}
              users={users}
              selClient={selClient}     setSelClient={setSelClient}
              selResp={selResponsable}  setSelResp={setSelResp}
            />
          )}
          {step === 2 && (
            <Step2Productos
              lang={lang}
              clientId={selClient?.id}
              clientLabel={selClient?.label}
              orderLines={orderLines} setOrderLines={setOrderLines}
              parsing={parsing} setParsing={setParsing}
              manualOpen={manualOpen} setManualOpen={setManualOpen}
              setReqDialog={setReqDialog}
              setToast={setToast}
              priceMap={priceMap}
              creditProjection={creditProjection}
              isAdmin={isAdmin}
            />
          )}
          {step === 3 && (
            <Step3Resumen
              lang={lang}
              client={selClient}
              responsable={selResponsable}
              orderLines={orderLines}
              priceMap={priceMap}
              creditProjection={creditProjection}
              isAdmin={isAdmin}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Footer sticky ───────────────── */}
      <div className="card card-pad-md" style={{
        marginTop: 18, position: "sticky", bottom: 16, zIndex: 5,
        boxShadow: "0 8px 24px rgba(15,27,61,0.08)",
      }}>
        {error && (
          <div style={{
            padding: "10px 14px", marginBottom: 12, borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5",
            color: "#991B1B", fontSize: 13,
          }}>
            <IconAlert size={12} style={{ verticalAlign: -1, marginRight: 6 }}/> {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button className="btn btn-ghost"
                  disabled={step === 1}
                  onClick={() => setStep((s) => Math.max(1, s - 1))}>
            <IconChevLeft size={12}/> {lang === "es" ? "Anterior" : "Back"}
          </button>
          {step < 3 ? (
            <button className="btn btn-accent"
                    disabled={!canAdvance}
                    onClick={() => setStep((s) => Math.min(3, s + 1))}
                    style={{ minWidth: 180 }}>
              {lang === "es" ? "Siguiente" : "Next"} <IconChevRight size={12}/>
            </button>
          ) : (
            <button
              className="btn btn-accent"
              disabled={saving || orderLines.length === 0}
              onClick={submit}
              style={{
                minWidth: 240, fontWeight: 700,
                background: "var(--btn-primary, #00B286)",
                borderColor: "var(--btn-primary, #00B286)",
              }}>
              {saving
                ? (lang === "es" ? "Creando…" : "Creating…")
                : <>{lang === "es" ? "Crear expediente" : "Create file"} <IconCheck size={12}/></>
              }
            </button>
          )}
        </div>
      </div>

      {/* ── Diálogo solicitud asignación ── */}
      {reqDialog && (
        <RequestAssignmentDialog
          lang={lang}
          sku={reqDialog.sku}
          clientId={selClient?.id}
          clientEmail={selClient?.contacto_email}
          onClose={() => setReqDialog(null)}
          onSent={(payload) => {
            setReqDialog(null);
            setToast({
              kind: "ok",
              msg: (lang === "es"
                ? `Solicitud enviada a ${payload.sent_to}.`
                : `Request sent to ${payload.sent_to}.`),
            });
            // Marcar línea como request_sent para deshabilitar reintento
            setOrderLines((prev) => prev.map((l) =>
              l.sku === reqDialog.sku ? { ...l, unassigned_request_sent: true } : l));
          }}
          onError={(msg) => setToast({ kind: "err", msg })}
        />
      )}

      {/* ── Toast ── */}
      {toast && <Toast {...toast} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEPPER
// ═════════════════════════════════════════════════════════════
function Stepper({ step, onJump, lang }) {
  return (
    <div className="card card-pad-md" style={{ marginBottom: 18 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap",
      }}>
        {STEPS.map((s, idx) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <React.Fragment key={s.id}>
              <button type="button"
                      onClick={() => onJump?.(s.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 14px", borderRadius: 999,
                        border: active ? "1.5px solid #00B286" : "1px solid var(--border, #E1E6ED)",
                        background: active ? "rgba(0,178,134,0.06)" : (done ? "rgba(0,178,134,0.10)" : "#fff"),
                        color: active ? "#0B1E3A" : (done ? "#00B286" : "var(--text-secondary)"),
                        fontWeight: 600, fontSize: 13,
                        cursor: s.id < step ? "pointer" : "default",
                      }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 99,
                  background: active ? "#00B286" : (done ? "#00B286" : "#E1E6ED"),
                  color: (active || done) ? "#fff" : "#64748B",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}>
                  {done ? <IconCheck size={11}/> : s.id}
                </span>
                <span>{s.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <span style={{ flex: 1, height: 1, background: "#E1E6ED", maxWidth: 60 }}/>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 1 · CLIENTE
// ═════════════════════════════════════════════════════════════
function Step1Cliente({ lang, clients, users, selClient, setSelClient, selResp, setSelResp }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 100);
    return clients.filter((c) =>
      [c.label, c.razon_social, c.tax_id, c.parent_label].join(" ").toLowerCase().includes(q)
    ).slice(0, 100);
  }, [clients, search]);

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 1 · Cliente" : "Step 1 · Client"}
      </h2>

      {/* Selector de cliente */}
      <Field label={lang === "es" ? "Cliente / Subsidiaria *" : "Client / Subsidiary *"}>
        {selClient ? (
          <SelectedClientCard client={selClient} onClear={() => setSelClient(null)} lang={lang}/>
        ) : (
          <div ref={ref} style={{ position: "relative" }}>
            <input
              className="input"
              placeholder={lang === "es" ? "Buscar por razón social, RUC o subsidiaria…" : "Search…"}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
            />
            {open && filtered.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                background: "#fff", border: "1px solid var(--border)",
                borderRadius: 8, marginTop: 4, maxHeight: 320, overflowY: "auto",
                boxShadow: "0 8px 24px rgba(11,30,58,0.15)",
              }}>
                {filtered.map((c) => (
                  <button key={c.id} type="button"
                          onClick={() => { setSelClient(c); setOpen(false); setSearch(""); }}
                          style={{
                            width: "100%", textAlign: "left",
                            padding: "10px 14px",
                            paddingLeft: c.parent_id ? 28 : 14,
                            border: "none",
                            borderBottom: "1px solid #F3F5F8", background: "#fff",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#F7F9FC"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}>
                    {c.parent_id && (
                      <span style={{ color: "#00B286", fontWeight: 700 }} title="Subsidiaria">↳</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "#0B1E3A", fontSize: 13 }}>
                        {c.label}
                      </div>
                      <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                        {c.tax_id && <code className="mono-sm">{c.tax_id}</code>}
                        {c.parent_label && (
                          <> · <span style={{ color: "#00B286" }}>hija de {c.parent_label}</span></>
                        )}
                      </div>
                    </div>
                    {c.credito_limit > 0 && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: "#00B286",
                        background: "rgba(0,178,134,0.10)", padding: "2px 8px",
                        borderRadius: 999, fontVariantNumeric: "tabular-nums",
                      }}>
                        ${(c.credito_limit / 1000).toFixed(0)}k
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>

      {/* Selector de responsable (opcional) */}
      <div style={{ marginTop: 18 }}>
        <Field label={lang === "es" ? "Responsable" : "Responsible"}>
          <select className="input" value={selResp?.id || ""}
                  onChange={(e) => {
                    const u = users.find((x) => String(x.id) === e.target.value);
                    setSelResp(u || null);
                  }}>
            <option value="">— {lang === "es" ? "Sin asignar" : "Unassigned"} —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email_plain || u.email}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function SelectedClientCard({ client, onClear, lang }) {
  const utilPct = client.credito_limit > 0
    ? Math.round((client.credito_used / client.credito_limit) * 100) : 0;
  const disponible = Math.max(0, client.credito_limit - client.credito_used);
  return (
    <div style={{
      padding: "16px 18px",
      border: "2px solid #00B286",
      background: "rgba(0,178,134,0.05)",
      borderRadius: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0B1E3A",
                        display: "flex", alignItems: "center", gap: 8 }}>
            {client.parent_id && (
              <span style={{ color: "#00B286", fontWeight: 800 }} title="Subsidiaria">↳</span>
            )}
            {client.label}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
            {client.tax_id && <code className="mono-sm">{client.tax_id}</code>}
            {client.parent_label && (
              <> · <span style={{ color: "#00B286" }}>hija de {client.parent_label}</span></>
            )}
          </div>
          {client.credito_limit > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                            fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                <span>{lang === "es" ? "Crédito disponible (pool)" : "Available credit (pool)"}</span>
                <span className="tabular-nums" style={{ fontWeight: 700, color: "#0B1E3A" }}>
                  ${disponible.toLocaleString()} / ${client.credito_limit.toLocaleString()}
                </span>
              </div>
              <div style={{ height: 6, background: "#E1E6ED", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, utilPct)}%`,
                  background: utilPct >= 85 ? "#DC2626" : utilPct >= 70 ? "#F59E0B" : "#00B286",
                  transition: "width 0.18s ease",
                }}/>
              </div>
            </div>
          )}
        </div>
        <button onClick={onClear} className="btn btn-ghost btn-sm" style={{ color: "#D64545" }}>
          <IconX size={12}/>
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 2 · PRODUCTOS
// ═════════════════════════════════════════════════════════════
function Step2Productos({
  lang, clientId, clientLabel,
  orderLines, setOrderLines,
  parsing, setParsing,
  manualOpen, setManualOpen,
  setReqDialog, setToast,
  priceMap = {}, creditProjection, isAdmin = false,
}) {
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file || !clientId) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("client_id", clientId);
      const res = await fetch("/api/expedientes/parse-template/", {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      const newLines = (payload.lines || []).map((l, i) => ({
        tmpId:         `pl-${Date.now()}-${i}`,
        sku:           l.sku,
        talla:         l.talla,
        cantidad:      l.cantidad,
        producto_id:   l.producto_id,
        product_label: l.product_label,
        is_assigned:   l.is_assigned !== false,
      }));
      setOrderLines((prev) => [...prev, ...newLines]);
      const unass = payload.summary?.unassigned_rows || 0;
      setToast({
        kind: unass > 0 ? "warn" : "ok",
        msg: lang === "es"
          ? `${payload.summary?.valid_rows || 0} líneas cargadas` + (unass ? ` · ${unass} sin asignar` : "")
          : `${payload.summary?.valid_rows || 0} lines loaded` + (unass ? ` · ${unass} unassigned` : ""),
      });
    } catch (e) {
      setToast({ kind: "err", msg: e?.message || (lang === "es" ? "Error procesando archivo" : "Parse error") });
    } finally {
      setParsing(false);
    }
  }, [clientId, setOrderLines, setParsing, setToast, lang]);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla_expediente.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const removeLine = (tmpId) =>
    setOrderLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  const updateLine = (tmpId, patch) =>
    setOrderLines((prev) => prev.map((l) => l.tmpId === tmpId ? { ...l, ...patch } : l));

  const totalUnits = orderLines.reduce((a, l) => a + Number(l.cantidad || 0), 0);
  const unassignedCount = orderLines.filter((l) => l.is_assigned === false).length;

  return (
    <div className="card card-pad-lg">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h2 className="heading-md">
          {lang === "es" ? "Paso 2 · Productos" : "Step 2 · Products"}
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
            ⬇ {lang === "es" ? "Descargar plantilla" : "Download template"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setManualOpen(true)}>
            <IconPlus size={11}/> {lang === "es" ? "Agregar línea manual" : "Add manual line"}
          </button>
        </div>
      </div>

      {/* Dropzone CSV/Excel */}
      <div ref={dropRef}
           onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
           onDragLeave={() => setDragOver(false)}
           onDrop={(e) => {
             e.preventDefault(); setDragOver(false);
             const f = e.dataTransfer.files?.[0];
             if (f) handleFile(f);
           }}
           style={{
             border: `2px dashed ${dragOver ? "#00B286" : "#CBD5E1"}`,
             borderRadius: 12,
             padding: 22, textAlign: "center",
             background: dragOver ? "rgba(0,178,134,0.04)" : "#FAFBFD",
             marginBottom: 18,
           }}>
        {parsing ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <IconRefresh size={18} style={{ color: "#00B286", animation: "spin 1.2s linear infinite" }}/>
            <strong style={{ color: "#0B1E3A" }}>
              {lang === "es" ? "Validando contra catálogo del cliente…" : "Validating against client catalog…"}
            </strong>
          </div>
        ) : (
          <div>
            <IconUpload size={26} style={{ color: "#3083FE", margin: "0 auto 8px", display: "block" }}/>
            <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
              {lang === "es"
                ? "Arrastra el CSV / Excel con tu pedido o:"
                : "Drag the CSV / Excel here or:"}
            </div>
            <label className="btn btn-ghost" style={{ marginTop: 12, cursor: "pointer" }}>
              {lang === "es" ? "Seleccionar archivo" : "Pick a file"}
              <input type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xls"
                     style={{ display: "none" }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}/>
            </label>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
              {lang === "es" ? "Columnas: " : "Columns: "}
              <code>SKU · Talla · Cantidad</code>
            </div>
          </div>
        )}
      </div>

      {/* Resumen */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8,
        padding: "10px 14px", borderRadius: 8,
        background: "rgba(0,178,134,0.06)",
      }}>
        <div className="caption" style={{ color: "#0B1E3A", fontWeight: 600 }}>
          {orderLines.length} {lang === "es" ? "líneas" : "lines"} · <strong className="tabular-nums">{totalUnits}</strong> {lang === "es" ? "unidades" : "units"}
          {unassignedCount > 0 && (
            <span style={{ color: "#B45309", marginLeft: 12, fontWeight: 700 }}>
              ⚠ {unassignedCount} {lang === "es" ? "sin asignar" : "unassigned"}
            </span>
          )}
        </div>
        {clientLabel && (
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Cliente:" : "Client:"} <strong style={{ color: "#0B1E3A" }}>{clientLabel}</strong>
          </div>
        )}
      </div>

      {/* Tabla */}
      {orderLines.length === 0 ? (
        <div className="empty" style={{ padding: 36 }}>
          <IconPackage size={22} style={{ color: "var(--text-tertiary)" }}/>
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Sin líneas todavía. Sube el CSV o agrega manual." : "No lines yet. Upload CSV or add manually."}
          </div>
        </div>
      ) : (
        <div className="card card-pad-0">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{lang === "es" ? "Producto" : "Product"}</th>
                <th>{lang === "es" ? "Talla" : "Size"}</th>
                <th style={{ textAlign: "right", paddingRight: 24 }}>
                  {lang === "es" ? "Cantidad" : "Qty"}
                </th>
                {isAdmin && <th style={{ textAlign: "right" }}>{lang === "es" ? "P. unit." : "Unit price"}</th>}
                {isAdmin && <th style={{ textAlign: "right" }}>{lang === "es" ? "Subtotal" : "Subtotal"}</th>}
                <th>{lang === "es" ? "Estado" : "Status"}</th>
                <th style={{ width: 56, textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {orderLines.map((l) => {
                const unassigned = l.is_assigned === false;
                return (
                  <tr key={l.tmpId}
                      style={unassigned ? { background: "#FEF3C7" } : null}>
                    <td className="mono-sm">{l.sku}</td>
                    <td>{l.product_label || "—"}</td>
                    <td>{l.talla || "—"}</td>
                    <td style={{ textAlign: "right", paddingRight: 24 }}>
                      <input className="input tabular-nums" type="number" min="1"
                             value={l.cantidad}
                             onChange={(e) => updateLine(l.tmpId, { cantidad: Number(e.target.value) })}
                             style={{ width: 90, textAlign: "right",
                                      display: "inline-block" }}/>
                    </td>
                    {isAdmin && (
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {(() => {
                          const u = Number(priceMap[l.producto_id] || 0);
                          if (u > 0) return `$${u.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
                        })()}
                      </td>
                    )}
                    {isAdmin && (
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600, color: "#0B1E3A" }}>
                        {(() => {
                          const u = Number(priceMap[l.producto_id] || 0);
                          const sub = u * Number(l.cantidad || 0);
                          if (sub > 0) return `$${sub.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          return <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>—</span>;
                        })()}
                      </td>
                    )}
                    <td>
                      {unassigned ? (
                        l.unassigned_request_sent ? (
                          <span className="caption" style={{ color: "#00B286", fontWeight: 600 }}>
                            ✓ {lang === "es" ? "Solicitud enviada" : "Request sent"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setReqDialog({ sku: l.sku, talla: l.talla, cantidad: l.cantidad })}
                            style={{
                              padding: "4px 10px", fontSize: 11,
                              color: "#B45309", border: "1px solid rgba(180,83,9,0.40)",
                              background: "rgba(180,83,9,0.06)",
                            }}>
                            <IconMail size={10}/> {lang === "es" ? "Solicitar asignación" : "Request assignment"}
                          </button>
                        )
                      ) : (
                        <span className="caption" style={{ color: "#00B286", fontWeight: 600 }}>
                          ✓ {lang === "es" ? "Asignado" : "Assigned"}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", width: 56 }}>
                      <button className="btn btn-ghost btn-sm"
                              onClick={() => removeLine(l.tmpId)}
                              title={lang === "es" ? "Eliminar línea" : "Remove line"}
                              style={{
                                color: "#D64545",
                                padding: "6px 8px",
                                borderRadius: 6,
                              }}>
                        <IconTrash size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Sprint 2026-05-01: Proyeccion de credito (CEO-only) ── */}
      {isAdmin && creditProjection && creditProjection.limit > 0 && orderLines.length > 0 && (
        <CreditProjectionCard cp={creditProjection} lang={lang}/>
      )}

      {manualOpen && (
        <ManualLinePanel
          lang={lang}
          clientId={clientId}
          onClose={() => setManualOpen(false)}
          onAdd={(rows) => {
            setOrderLines((prev) => [
              ...prev,
              ...rows.map((r, i) => ({
                tmpId: `pl-m-${Date.now()}-${i}`,
                ...r,
              })),
            ]);
          }}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// MANUAL LINE PANEL — buscar SKU + matriz tallas
// ═════════════════════════════════════════════════════════════
function ManualLinePanel({ lang, clientId, onClose, onAdd }) {
  const [search, setSearch]     = useState("");
  const [results, setResults]   = useState([]);
  const [picked, setPicked]     = useState(null);   // {sku, label, tallas:[{talla, qty}]}
  const [loading, setLoading]   = useState(false);
  const [cpaSet, setCpaSet]     = useState(new Set()); // skus asignados al cliente
  // Catálogo del Motor de Tallas con TODAS las equivalencias.
  // Sprint 2026-05-01: antes solo guardaba { label, sistema }; ahora
  // guarda tambien { equiv: { EU, US_M, US_W, UK_M, BR, CM, ALFA, ... } }
  // para que el modal pueda mostrar la talla en el sistema que el user
  // elija via toggle.
  const [sizingMap, setSizingMap] = useState({});
  // Sistema de medida elegido para mostrar la talla.
  const [displaySystem, setDisplaySystem] = useState("BASE");

  // Cargar CPA del cliente una vez
  useEffect(() => {
    if (!clientId) return;
    apiFetch(`/commercial/client-assignments/?client=${clientId}`, { token: getToken() })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setCpaSet(new Set(arr.map((a) => (a.brand_sku || "").toUpperCase()).filter(Boolean)));
      })
      .catch(() => {});
  }, [clientId]);

  // Cargar catálogo de tallas (Motor de Tallas) con TODAS las equivalencias
  useEffect(() => {
    tallasApi.list({ limit: 500 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        const map = {};
        for (const sz of arr) {
          const base = sz.talla_base || sz.nombre || sz.codigo || "—";
          map[String(sz.id)] = {
            base,
            tipo: sz.tipo_producto || null,
            equiv: {
              BASE: base,
              EU:   sz.eu       || null,
              US_M: sz.us_men   || null,
              US_W: sz.us_women || null,
              US_Y: sz.us_youth || null,
              UK_M: sz.uk_men   || null,
              UK_W: sz.uk_women || null,
              BR:   sz.br       || null,
              MX:   sz.mx       || null,
              AR:   sz.ar       || null,
              JP:   sz.jp       || null,
              CN:   sz.cn       || null,
              KR:   sz.kr       || null,
              CM:   sz.cm       || null,
              ALFA: sz.alfa     || null,
            },
          };
        }
        setSizingMap(map);
      })
      .catch(() => setSizingMap({}));
  }, []);

  // Buscar productos
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    productosApi.list({ q })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setResults(arr.slice(0, 30));
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [search]);

  const pick = async (p) => {
    const sku = (p.sku || "").toUpperCase();
    const isAssigned = cpaSet.size === 0 || cpaSet.has(sku);

    // El list serializer (ProductoListSerializer) NO incluye `tallas`,
    // así que necesitamos un retrieve para conseguir el array de UUIDs
    // de tallas asignadas en el Motor de Tallas. Si el GET falla, caemos
    // a "ÚNICA" en vez de inventar XS-XXL (esa lista no aplica al SKU).
    let tallaIds = [];
    let tempPicked = {
      sku,
      product_label: p.nombre || p.product_label || sku,
      producto_id:   p.id,
      is_assigned:   isAssigned,
      loading_sizes: true,
      tallas: [],
    };
    setPicked(tempPicked);

    try {
      const full = await productosApi.get(p.id);
      tallaIds = Array.isArray(full?.tallas) ? full.tallas : [];
    } catch {
      tallaIds = [];
    }

    const seen = new Set();
    const tallas = [];
    for (const t of tallaIds) {
      let entry = null;
      if (typeof t === "object" && t) {
        const base = t.talla_base || t.nombre || t.codigo || null;
        if (base) {
          entry = {
            base,
            equiv: {
              BASE: base,
              EU:   t.eu       || null,
              US_M: t.us_men   || null,
              US_W: t.us_women || null,
              US_Y: t.us_youth || null,
              UK_M: t.uk_men   || null,
              UK_W: t.uk_women || null,
              BR:   t.br       || null,
              MX:   t.mx       || null,
              AR:   t.ar       || null,
              JP:   t.jp       || null,
              CN:   t.cn       || null,
              KR:   t.kr       || null,
              CM:   t.cm       || null,
              ALFA: t.alfa     || null,
            },
          };
        }
      } else {
        const m = sizingMap[String(t)];
        if (m?.base) entry = { base: m.base, equiv: m.equiv };
      }
      if (entry && !seen.has(entry.base)) {
        seen.add(entry.base);
        tallas.push({ ...entry, qty: 0 });
      }
    }
    if (tallas.length === 0) {
      tallas.push({ base: "ÚNICA", equiv: { BASE: "ÚNICA" }, qty: 0 });
    }

    setPicked({
      ...tempPicked,
      loading_sizes: false,
      tallas,
    });
  };

  const addToOrder = () => {
    if (!picked) return;
    const rows = picked.tallas
      .filter((t) => Number(t.qty || 0) > 0)
      .map((t) => ({
        sku:           picked.sku,
        // Sprint 2026-05-01: persistimos siempre la talla BASE; el
        // displaySystem es solo de presentacion en el modal.
        talla:         t.base === "ÚNICA" ? null : t.base,
        cantidad:      Number(t.qty),
        producto_id:   picked.producto_id,
        product_label: picked.product_label,
        is_assigned:   picked.is_assigned,
      }));
    if (rows.length === 0) return;
    onAdd(rows);
    setPicked(null);
    setSearch("");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(11,30,58,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             background: "#fff", borderRadius: 14, width: "min(720px, 96vw)", maxHeight: "86vh",
             padding: 0, display: "flex", flexDirection: "column", overflow: "hidden",
             boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
           }}>
        <header style={{
          padding: "16px 22px", borderBottom: "1px solid #F1F4F9",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
              {lang === "es" ? "AGREGAR LÍNEA MANUAL" : "ADD MANUAL LINE"}
            </div>
            <div style={{ font: "700 18px/1.2 inherit", color: "#0B1E3A" }}>
              {picked ? picked.product_label : (lang === "es" ? "Buscar producto" : "Search product")}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </header>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {!picked ? (
            <>
              <div style={{ position: "relative", marginBottom: 14 }}>
                <IconSearch size={14} style={{ position: "absolute", top: 12, left: 12, color: "#64748B" }}/>
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder={lang === "es" ? "Buscar por SKU o nombre…" : "Search by SKU or name…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              {loading && <div className="caption" style={{ color: "var(--text-tertiary)" }}>Cargando…</div>}
              {!loading && results.length === 0 && search.length >= 2 && (
                <div className="caption" style={{ color: "var(--text-tertiary)", padding: 12 }}>
                  {lang === "es" ? "Sin resultados." : "No results."}
                </div>
              )}
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {results.map((p) => {
                  const sku = (p.sku || "").toUpperCase();
                  const isAssigned = cpaSet.size === 0 || cpaSet.has(sku);
                  return (
                    <button key={p.id || sku} type="button"
                            onClick={() => pick(p)}
                            style={{
                              width: "100%", textAlign: "left",
                              padding: "10px 14px", border: "1px solid var(--border)",
                              borderRadius: 8, marginBottom: 6,
                              background: "#fff", cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                      <IconPackage size={14} style={{ color: "#3083FE", flexShrink: 0 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "#0B1E3A" }}>
                          <span className="mono-sm">{sku}</span>
                          {!isAssigned && (
                            <span style={{
                              marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                              background: "rgba(180,83,9,0.10)", color: "#B45309",
                              fontSize: 10, fontWeight: 700,
                            }}>
                              ⚠ {lang === "es" ? "NO ASIGNADO" : "NOT ASSIGNED"}
                            </span>
                          )}
                        </div>
                        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                          {p.nombre || p.product_label || ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {!picked.is_assigned && (
                <div style={{
                  padding: "12px 14px", borderRadius: 8,
                  background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.30)",
                  color: "#92400E", marginBottom: 14, fontSize: 13,
                }}>
                  ⚠ {lang === "es"
                       ? "Este SKU NO está asignado al cliente. No vas a poder confirmar el pedido hasta que se asigne. Volvé al listado y usá 'Solicitar asignación'."
                       : "This SKU is NOT assigned to the client. The order can't be confirmed until assignment. Go back and use 'Request assignment'."}
                </div>
              )}

              <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 8 }}>
                {lang === "es" ? "Ingresá la cantidad por talla:" : "Enter quantity per size:"}
              </div>
              {picked.loading_sizes ? (
                <div className="caption" style={{
                  padding: 18, textAlign: "center", color: "var(--text-tertiary)",
                  background: "rgba(11,30,58,0.03)", borderRadius: 8, marginBottom: 14,
                }}>
                  {lang === "es" ? "Cargando tallas asignadas…" : "Loading assigned sizes…"}
                </div>
              ) : picked.tallas.length === 1 && picked.tallas[0].base === "ÚNICA" ? (
                <div className="caption" style={{
                  padding: "10px 12px", marginBottom: 14, borderRadius: 8,
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.20)", color: "#92400E",
                  fontSize: 12,
                }}>
                  ⚠ {lang === "es"
                       ? "Este SKU no tiene tallas asignadas en el Motor de Tallas. Usá talla ÚNICA o asigná tallas en el detalle del producto."
                       : "This SKU has no sizes assigned in the Sizing Engine. Use SINGLE size or assign sizes in the product detail."}
                </div>
              ) : null}

              {/* Sprint 2026-05-01: toggle de sistema de medida.
                  Solo aparecen los sistemas con AL MENOS 1 valor entre las
                  tallas del producto (BASE siempre presente). */}
              {!picked.loading_sizes && picked.tallas.length > 1 && (() => {
                const allSystems = ["BASE","EU","US_M","US_W","UK_M","BR","CM","ALFA"];
                const systemsWithData = allSystems.filter((s) =>
                  s === "BASE" || picked.tallas.some((t) => !!(t.equiv && t.equiv[s]))
                );
                const labels = {
                  BASE: lang === "es" ? "Base" : "Base",
                  EU: "EU", US_M: "US M", US_W: "US W",
                  UK_M: "UK", BR: "BR", CM: "CM",
                  ALFA: lang === "es" ? "Letras" : "Letter",
                };
                if (systemsWithData.length <= 1) return null;
                return (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    marginBottom: 10, justifyContent: "flex-end",
                  }}>
                    <span className="caption" style={{ fontSize: 11,
                      color: "var(--text-tertiary)", fontWeight: 600,
                    }}>
                      {lang === "es" ? "Mostrar talla en:" : "Show size as:"}
                    </span>
                    <div style={{
                      display: "inline-flex",
                      background: "rgba(11,30,58,0.04)",
                      padding: 3, borderRadius: 8, gap: 2,
                    }}>
                      {systemsWithData.map((s) => (
                        <button
                          key={s} type="button"
                          onClick={() => setDisplaySystem(s)}
                          style={{
                            padding: "4px 10px", borderRadius: 6,
                            border: 0, cursor: "pointer",
                            background: displaySystem === s ? "white" : "transparent",
                            color: displaySystem === s ? "#0B1E3A" : "var(--text-tertiary)",
                            fontSize: 11, fontWeight: 700,
                            boxShadow: displaySystem === s
                              ? "0 1px 2px rgba(11,30,58,0.10)" : "none",
                          }}
                        >{labels[s]}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 10, marginBottom: 14,
              }}>
                {!picked.loading_sizes && picked.tallas.map((t, idx) => {
                  const showLabel = (t.equiv && t.equiv[displaySystem]) || t.base || "—";
                  const isFallback = displaySystem !== "BASE"
                    && (!t.equiv || !t.equiv[displaySystem])
                    && !!t.base;
                  return (
                    <div key={t.base} style={{
                      border: "1px solid var(--border)", borderRadius: 8,
                      padding: "10px 12px", background: "#fff",
                    }}>
                      <div style={{
                        textAlign: "center", marginBottom: 4,
                        fontWeight: 700, letterSpacing: 0.5,
                        fontSize: 13,
                        color: isFallback ? "#92400E" : "var(--text-tertiary)",
                      }}
                      title={isFallback
                        ? (lang === "es"
                            ? `${displaySystem} no definido — mostrando base`
                            : `${displaySystem} not set — showing base`)
                        : undefined}
                      >{showLabel}</div>
                      {/* Equivalencia base como subtitulo cuando display != BASE */}
                      {displaySystem !== "BASE" && t.base !== showLabel && (
                        <div className="caption" style={{
                          fontSize: 9, textAlign: "center",
                          color: "var(--text-tertiary)",
                          marginBottom: 4,
                          fontFamily: "var(--font-mono, monospace)",
                        }}>= {t.base}</div>
                      )}
                      <input className="input tabular-nums" type="number" min="0"
                             value={t.qty}
                             onChange={(e) => {
                               const v = Math.max(0, Number(e.target.value) || 0);
                               setPicked((p) => {
                                 const tallas = p.tallas.slice();
                                 tallas[idx] = { ...tallas[idx], qty: v };
                                 return { ...p, tallas };
                               });
                             }}
                             style={{ textAlign: "center" }}/>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setPicked(null)}>
                  ← {lang === "es" ? "Cambiar SKU" : "Pick another"}
                </button>
                <button className="btn btn-accent"
                        disabled={!picked.is_assigned || picked.tallas.every((t) => Number(t.qty || 0) <= 0)}
                        onClick={addToOrder}
                        style={{ minWidth: 180,
                                 background: "var(--btn-primary, #00B286)",
                                 borderColor: "var(--btn-primary, #00B286)",
                                 fontWeight: 700 }}>
                  {lang === "es" ? "Añadir al pedido" : "Add to order"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// REQUEST ASSIGNMENT DIALOG
// ═════════════════════════════════════════════════════════════
function RequestAssignmentDialog({ lang, sku, clientId, clientEmail, onClose, onSent, onError }) {
  const [talla, setTalla] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/request-assignment/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          client_id: clientId, sku, talla, cantidad: Number(cantidad) || 0,
          client_email: clientEmail,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      onSent(payload);
    } catch (e) {
      onError(e?.message || "Request failed");
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 110,
      background: "rgba(11,30,58,0.55)", padding: 20,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             background: "#fff", borderRadius: 14, width: "min(440px, 96vw)",
             padding: 26, boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
           }}>
        <div className="micro" style={{ color: "#B45309", letterSpacing: 1, marginBottom: 6 }}>
          {lang === "es" ? "SOLICITUD DE ASIGNACIÓN" : "ASSIGNMENT REQUEST"}
        </div>
        <div style={{ font: "700 18px/1.3 inherit", color: "#0B1E3A", marginBottom: 8 }}>
          SKU <code className="mono-sm">{sku}</code>
        </div>
        <div className="caption" style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          {lang === "es"
            ? "Indicá la talla y cantidad deseadas. Enviaremos un email al Account Manager del cliente para que apruebe la asignación."
            : "Tell us size and quantity. We'll email the client's Account Manager."}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <Field label={lang === "es" ? "Talla" : "Size"}>
            <input className="input" value={talla} onChange={(e) => setTalla(e.target.value.toUpperCase())} placeholder="40 / M / XL"/>
          </Field>
          <Field label={lang === "es" ? "Cantidad" : "Quantity"}>
            <input className="input tabular-nums" type="number" min="1" value={cantidad}
                   onChange={(e) => setCantidad(e.target.value)}/>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button className="btn btn-accent" onClick={submit} disabled={busy}
                  style={{ minWidth: 180,
                           background: "var(--btn-primary, #00B286)",
                           borderColor: "var(--btn-primary, #00B286)",
                           fontWeight: 700 }}>
            {busy ? (lang === "es" ? "Enviando…" : "Sending…")
                  : (lang === "es" ? "Enviar solicitud" : "Send request")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 3 · RESUMEN (sin financiero)
// ═════════════════════════════════════════════════════════════
function Step3Resumen({ lang, client, responsable, orderLines, priceMap = {}, creditProjection, isAdmin = false }) {
  const totalUnits = orderLines.reduce((a, l) => a + Number(l.cantidad || 0), 0);
  // Agrupar por SKU para el resumen + acumular subtotales por SKU
  const bySku = {};
  orderLines.forEach((l) => {
    if (!bySku[l.sku]) {
      bySku[l.sku] = {
        sku: l.sku, label: l.product_label, tallas: [],
        producto_id: l.producto_id, subtotalValue: 0,
      };
    }
    bySku[l.sku].tallas.push({ talla: l.talla, cantidad: l.cantidad });
    const u = Number(priceMap[l.producto_id] || 0);
    bySku[l.sku].subtotalValue += u * Number(l.cantidad || 0);
  });
  const groups = Object.values(bySku);
  const totalValue = groups.reduce((a, g) => a + g.subtotalValue, 0);

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 3 · Revisar y crear" : "Step 3 · Review & create"}
      </h2>

      {/* Cliente */}
      <div style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 14 }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 6 }}>
          {lang === "es" ? "CLIENTE" : "CLIENT"}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0B1E3A",
                      display: "flex", alignItems: "center", gap: 8 }}>
          {client?.parent_id && (
            <span style={{ color: "#00B286", fontWeight: 800 }}>↳</span>
          )}
          {client?.label}
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
          {client?.tax_id && <>RUC/CUIT <code className="mono-sm">{client.tax_id}</code></>}
          {client?.parent_label && (
            <> · <span style={{ color: "#00B286" }}>hija de {client.parent_label}</span></>
          )}
          {responsable && (
            <> · {lang === "es" ? "Responsable:" : "Responsible:"} <strong>{responsable.full_name || responsable.email_plain}</strong></>
          )}
        </div>
      </div>

      {/* Productos */}
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 8 }}>
        {lang === "es" ? "PRODUCTOS" : "PRODUCTS"} · {orderLines.length} {lang === "es" ? "líneas" : "lines"} · <strong>{totalUnits}</strong> {lang === "es" ? "unidades" : "units"}
      </div>
      <div className="card card-pad-0">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>{lang === "es" ? "Producto" : "Product"}</th>
              <th>{lang === "es" ? "Tallas y cantidades" : "Sizes & quantities"}</th>
              <th style={{ textAlign: "right" }}>{lang === "es" ? "Total uds." : "Total qty"}</th>
              {isAdmin && <th style={{ textAlign: "right" }}>{lang === "es" ? "Valor" : "Value"}</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const totalSku = g.tallas.reduce((a, t) => a + Number(t.cantidad || 0), 0);
              return (
                <tr key={g.sku}>
                  <td className="mono-sm">{g.sku}</td>
                  <td>{g.label || "—"}</td>
                  <td>
                    {g.tallas.map((t, i) => (
                      <span key={i} style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 999,
                        background: "rgba(0,178,134,0.08)", color: "#0B1E3A",
                        fontSize: 11, fontWeight: 600, marginRight: 4, marginBottom: 4,
                      }}>
                        {t.talla || "—"}: <strong className="tabular-nums">{t.cantidad}</strong>
                      </span>
                    ))}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#0B1E3A" }}>
                    {totalSku}
                  </td>
                  {isAdmin && (
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#0B1E3A" }}>
                      {g.subtotalValue > 0
                        ? `$${g.subtotalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {isAdmin && totalValue > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: "right", paddingRight: 16,
                                          color: "var(--text-tertiary)", fontWeight: 600,
                                          textTransform: "uppercase", fontSize: 11, letterSpacing: 0.6 }}>
                  {lang === "es" ? "Valor total del pedido" : "Order total value"}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 800,
                                                       color: "#00B286", fontSize: 16 }}>
                  ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Sprint 2026-05-01: Impacto en credito (CEO-only) ── */}
      {isAdmin && creditProjection && creditProjection.limit > 0 && orderLines.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <CreditProjectionCard cp={creditProjection} lang={lang}/>
        </div>
      )}

      {/* Aviso de qué falta */}
      <div style={{
        marginTop: 18, padding: "12px 14px", borderRadius: 8,
        background: "rgba(48,131,254,0.06)", border: "1px solid rgba(48,131,254,0.20)",
        fontSize: 13, color: "#0B1E3A",
      }}>
        <IconLock size={11} style={{ verticalAlign: -1, marginRight: 6, color: "#3083FE" }}/>
        {lang === "es"
          ? "Este expediente nacerá en estado REGISTRO. Marca, moneda y modo de operación se completarán después en el detalle (operativa/comercial)."
          : "This file will start in REGISTRO. Brand, currency and operation mode are filled later in the detail view."}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════
function adaptClient(c) {
  return {
    id:              c.id,
    label:           c.razon_social || c.nombre_comercial || "—",
    razon_social:    c.razon_social,
    tax_id:          c.tax_id,
    parent_id:       c.parent_id || null,
    parent_label:    null,
    contacto_email:  c.contacto_email,
    credito_limit:   Number(c.credito_aprobado || c.credito_limit_usd || 0),
    credito_used:    Number(c.credito_usado || 0),
  };
}

function orderClientsHierarchy(clients) {
  const out = []; const seen = new Set();
  clients.filter((c) => !c.parent_id).forEach((parent) => {
    out.push(parent); seen.add(parent.id);
    clients.filter((c) => c.parent_id === parent.id).forEach((sub) => {
      out.push({ ...sub, parent_label: parent.label });
      seen.add(sub.id);
    });
  });
  clients.forEach((c) => { if (!seen.has(c.id)) out.push(c); });
  return out;
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: 11, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.4,
        textTransform: "uppercase", marginBottom: 6,
      }}>{label}</span>
      {children}
    </label>
  );
}

// ═════════════════════════════════════════════════════════════
// CREDIT PROJECTION CARD — visualizacion del impacto del pedido en
// el credito disponible del cliente. Sprint 2026-05-01.
// ═════════════════════════════════════════════════════════════
function CreditProjectionCard({ cp, lang }) {
  const tone = cp.exceedsLimit ? "red"
             : cp.utilPctAfter >= 85 ? "red"
             : cp.utilPctAfter >= 70 ? "amber" : "green";
  const colorMap = {
    green: { bar: "#00B286", text: "#0B1E3A", bg: "rgba(0,178,134,0.06)", border: "rgba(0,178,134,0.30)" },
    amber: { bar: "#F59E0B", text: "#92400E", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.40)" },
    red:   { bar: "#DC2626", text: "#991B1B", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.40)" },
  };
  const c = colorMap[tone];
  const fmt = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{
      marginTop: 14,
      padding: "14px 16px",
      borderRadius: 10,
      background: c.bg,
      border: `1px solid ${c.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                     marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <div className="micro" style={{ color: c.text, letterSpacing: 1, fontWeight: 700 }}>
          {lang === "es" ? "IMPACTO EN CRÉDITO DEL CLIENTE" : "CLIENT CREDIT IMPACT"}
        </div>
        {cp.exceedsLimit && (
          <span style={{
            padding: "3px 10px", borderRadius: 999,
            background: "#DC2626", color: "#fff",
            fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
          }}>
            {lang === "es" ? "EXCEDE LÍMITE" : "EXCEEDS LIMIT"}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        <Stat label={lang === "es" ? "Límite total" : "Total limit"} value={fmt(cp.limit)}/>
        <Stat label={lang === "es" ? "Uso actual" : "Current used"} value={fmt(cp.used)}/>
        <Stat label={lang === "es" ? "Valor del pedido" : "Order value"} value={fmt(cp.orderValue)} accent="#00B286"/>
        <Stat
          label={lang === "es" ? "Disponible después" : "After order"}
          value={fmt(cp.afterAvailable)}
          accent={cp.afterAvailable < 0 ? "#DC2626" : c.text}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between",
                       fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
          <span>
            {lang === "es" ? "Utilización proyectada" : "Projected utilization"}
          </span>
          <span className="tabular-nums" style={{ fontWeight: 700, color: c.text }}>
            {cp.utilPctAfter}% {cp.exceedsLimit && "(>100%)"}
          </span>
        </div>
        <div style={{ height: 8, background: "#E1E6ED", borderRadius: 4, overflow: "hidden", position: "relative" }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, cp.utilPctAfter)}%`,
            background: c.bar,
            transition: "width 0.18s ease",
          }}/>
          {cp.exceedsLimit && (
            <div style={{
              position: "absolute", top: 0, right: 0, height: "100%",
              width: 4, background: "#7F1D1D",
            }}/>
          )}
        </div>
      </div>

      {cp.exceedsLimit && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#991B1B", fontWeight: 600 }}>
          ⚠ {lang === "es"
              ? "Este pedido excede el límite de crédito del cliente. Revisa con CEO antes de continuar."
              : "This order exceeds the client credit limit. Review with CEO before continuing."}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.6,
        textTransform: "uppercase", marginBottom: 4,
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 15, fontWeight: 700,
        color: accent || "#0B1E3A",
      }}>{value}</div>
    </div>
  );
}

function Toast({ kind = "ok", msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  const colors = {
    ok:   { bg: "rgba(0,178,134,0.10)",  border: "rgba(0,178,134,0.40)", color: "#00B286" },
    warn: { bg: "rgba(180,83,9,0.10)",   border: "rgba(180,83,9,0.40)",  color: "#92400E" },
    err:  { bg: "rgba(214,69,69,0.10)",  border: "rgba(214,69,69,0.40)", color: "#991B1B" },
  };
  const s = colors[kind] || colors.ok;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 200,
      padding: "12px 18px", borderRadius: 10,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.color, fontWeight: 600, fontSize: 13,
      boxShadow: "0 10px 30px rgba(11,30,58,0.20)",
      maxWidth: 380,
    }}>{msg}</div>
  );
}
