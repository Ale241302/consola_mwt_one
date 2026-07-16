// =====================================================================
// MWT.ONE · pages/CreateExpedienteWizard.jsx
// Agente responsable: [AG-FRONTEND]
//
// Wizard de Creación de Expedientes con flujo CONDICIONAL por rol:
//   · ADMIN  (CEO / staff)      → 4 pasos:  Upload+Contexto → Logística →
//                                           Productos → Review
//   · CLIENT (Portal B2B)       → 3 pasos:  Upload         → Confirmar
//                                           Productos      → Review
//
// Reglas de aislamiento estrictas (parea con views_wizard.py):
//   · El CLIENT NUNCA ve: selector de Cliente, selector de Marca,
//     selector de Modo (COMISION/FULL), freight_mode, transport_mode,
//     price_basis, credit_days, márgenes, cost_usd.
//   · El CLIENT solo envía el archivo; cliente y marca vienen del JWT.
//   · Los precios que el CLIENT ve en Paso 2 son los pre-negociados con
//     ese cliente (resueltos por /api/commercial/resolve_client_price/,
//     ya aplicado por el serializer en /api/ocr/parse-oc/).
//
// Paleta MWT: Navy #0B1E3A, Mint #00B286. Animaciones con framer-motion.
//
// NOTA: este archivo reemplaza el Wizard.jsx legacy. La ruta /expedientes/
// /nuevo ya debería apuntar acá (revisar App.jsx).
// =====================================================================
import React, { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { useRole } from "../context/RoleContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getToken, ApiError, postMultipart } from "../lib/api.js";
import { ManualLinePanel, RequestAssignmentDialog } from "../components/expedientes/ManualLineModal.jsx";

// ---------------------------------------------------------------------
// Paleta MWT (hardcoded en constantes, no en clases — permite que el
// Admin cambie colores de tema sin re-escribir todos los selectores).
// ---------------------------------------------------------------------
const COLORS = {
  navy:      "var(--text-primary)",
  mint:      "#00B286",
  mintDark:  "#008B69",
  ink:       "var(--text-primary)",
  inkSoft:   "var(--text-secondary)",
  paper:     "var(--surface)",
  border:    "var(--border)",
  danger:    "var(--critical)",
  warning:   "#E09F3E",
};

// Steps canónicos por rol (el índice es el número mostrado).
const STEPS_ADMIN = [
  { key: "upload",    label: "Subir OC + Contexto" },
  { key: "logistics", label: "Logística y Gobernanza" },
  { key: "products",  label: "Productos" },
  { key: "review",    label: "Revisar y Crear" },
];

const STEPS_CLIENT = [
  { key: "upload",    label: "Subir OC" },
  { key: "products",  label: "Confirmar Productos" },
  { key: "review",    label: "Revisar y Enviar" },
];

// Endpoints del wizard. El baseURL lo toma apiFetch de VITE_API_BASE_URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// ---------------------------------------------------------------------
// Helper: POST JSON (apiFetch.lib/api.js ya cubre uploads multipart vía
// postMultipart importado arriba; acá sólo definimos el variant JSON).
// ---------------------------------------------------------------------
async function postJSON(path, body, { token } = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!resp.ok) {
    const msg = data?.detail || data?.error || `HTTP ${resp.status}`;
    throw new ApiError(msg, resp.status, data);
  }
  return data;
}

// =====================================================================
// Componente principal
// =====================================================================
export default function CreateExpedienteWizard() {
  const { isClient, isAdmin, user: roleUser } = useRole();
  const auth   = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const steps   = isClient ? STEPS_CLIENT : STEPS_ADMIN;

  // Sprint 2026-07-15 · scope del cliente B2B: client_id del JWT
  // (legal_entity). Se usa en el Paso 2 para el buscador de productos
  // (visibilidad + precios pre-negociados). R3: el backend igualmente
  // fuerza el client_id del JWT en todos los endpoints.
  const clientScopeId = isClient
    ? (auth?.user?.legal_entity_id
        || (Array.isArray(auth?.user?.legal_entity_ids)
              ? auth.user.legal_entity_ids[0] : null)
        || null)
    : null;

  // ── Pre-seed desde el carrito del catálogo ────────────────────
  // Si el cliente llegó acá con location.state.cartItems (desde
  // ProductCatalogGrid · "Procesar Pedido"), armamos un ocrPayload
  // sintético con esas líneas para saltar al Paso "products" sin
  // necesidad de subir un PDF/XLSX.
  //
  // Shape de cada cartItem (set por ProductCatalogGrid.handleProcessOrder):
  //   { sku, descripcion, size, qty, unit_price, producto_id, currency }
  const cartSeed = useMemo(() => {
    const cart = location.state?.cartItems;
    if (!Array.isArray(cart) || cart.length === 0) return null;
    const lines = cart.map((it) => ({
      sku:          it.sku,
      descripcion:  it.descripcion || null,
      size:         it.size || null,
      qty:          Number(it.qty) || 1,
      unit_price:   Number(it.unit_price) || 0,
      producto_id:  it.producto_id || null,
      confidence:   0.99,     // datos seleccionados por el cliente, no OCR
      price_verdict: "OK",
    }));
    const currency = cart[0]?.currency || "USD";
    return {
      lines,
      ocr_engine:  "portal-cart",
      confidence:  0.99,
      po: { number: null, date: null, currency, total: null },
      client: { name: null, tax_id: null, _candidates: [] },
      brand:  { name: null, brand_code: null, _candidates: [] },
      raw_text_preview: null,
    };
  }, [location.state]);

  // Índice inicial: si hay carrito pre-seed y el wizard pidió saltar
  // (location.state.jumpToStep === 'products'), entramos directo al
  // Paso 2 (índice del step key='products' en el array de pasos).
  const initialIdx = useMemo(() => {
    // Sprint 2026-07-16 · el salto a un paso puede venir con carrito pre-seed
    // o sin él (cliente que eligió "No tengo OC" arma el pedido a mano en el
    // Paso 2). Por eso ya no exigimos cartSeed para honrar jumpToStep.
    const jumpTo = location.state?.jumpToStep;
    if (jumpTo) {
      const i = steps.findIndex((s) => s.key === jumpTo);
      if (i >= 0) return i;
    }
    return 0;
  }, [cartSeed, location.state, steps]);

  const [idx, setIdx] = useState(initialIdx);

  // Estado del wizard — vive acá arriba y los sub-componentes leen/escriben.
  const [state, setState] = useState(() => ({
    file:              null,            // File browser object
    fileMeta:          null,            // { name, ext, size }
    ocrPayload:        cartSeed || null, // si hay carrito, ya viene con lines
    loadingOcr:        false,
    ocrError:          null,

    // Context resuelto por OCR (ADMIN puede corregir, CLIENT no lo ve)
    clientId:          null,
    clientName:        "",
    brandId:           null,
    brandName:         "",

    // Líneas (productos). CLIENT solo puede editar qty.
    lines:             cartSeed ? cartSeed.lines.map((l) => ({ ...l })) : [],

    // Logística (ADMIN only)
    mode:              null,            // COMISION | FULL
    priceBasis:        "FOB",
    freightMode:       "SEA",
    transportMode:     "MARITIMO",
    creditClockRule:   "ON_PROFORMA",
    creditDays:        45,

    // Flags de submit
    submitting:        false,
    submitError:       null,
    createdExpediente: null,

    // Metadatos de origen (audit)
    entrySource:       location.state?.entrySource || "wizard_upload",
  }));

  // Patch state helper
  const patch = useCallback((delta) => {
    setState((s) => ({ ...s, ...(typeof delta === "function" ? delta(s) : delta) }));
  }, []);

  // Idempotence token generado una sola vez por montaje del wizard.
  const idempotenceToken = useMemo(() => {
    try {
      return (crypto && crypto.randomUUID && crypto.randomUUID())
        || `wiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    } catch {
      return `wiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }, []);

  // -------------------------------------------------------------------
  // Submit final — POST /api/expedientes/create-from-oc/
  // -------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    patch({ submitting: true, submitError: null });
    try {
      const token = getToken();
      // Sprint 2026-07-15 · payload efectivo: SIEMPRE las líneas del estado
      // (incluye ediciones de qty del Paso 2 y líneas agregadas manualmente).
      // Si el cliente no subió archivo, armamos un payload sintético
      // (flujo "sin OC" — la subida del archivo es OPCIONAL para CLIENT).
      const effectiveLines = (state.lines || []).map((l) => ({
        client_part_number: l.client_part_number || l.sku || "",
        sku:          l.sku,
        descripcion:  l.descripcion || l.product_label || null,
        size:         l.size || null,
        qty:          Number(l.qty) || 0,
        unit_price:   Number(l.unit_price) || 0,
        producto_id:  l.producto_id || null,
      }));
      const ocrPayloadOut = {
        ...(state.ocrPayload || {
          ocr_engine: "portal-manual",
          confidence: 1,
          po:     { number: null, date: null, currency: "USD", total: null },
          client: { name: null, tax_id: null, _candidates: [] },
          brand:  { name: null, brand_code: null, _candidates: [] },
          raw_text_preview: null,
        }),
        lines: effectiveLines,
      };
      const body = {
        ocr_payload:       ocrPayloadOut,
        idempotence_token: idempotenceToken,
      };
      if (isAdmin) {
        // El CEO puede corregir cliente/marca si el OCR los matcheó mal.
        Object.assign(body, {
          client_id:                 state.clientId,
          brand_id:                  state.brandId,
          mode:                      state.mode,
          price_basis:               state.priceBasis,
          freight_mode:              state.freightMode,
          transport_mode:            state.transportMode,
          credit_clock_start_rule:   state.creditClockRule,
          credit_days:               state.creditDays,
        });
      }
      // Si hay archivo, reenviarlo en multipart para registrarlo como ART-01.
      let resp;
      if (state.file) {
        const fd = new FormData();
        fd.append("file", state.file);
        fd.append("ocr_payload",       JSON.stringify(ocrPayloadOut));
        fd.append("idempotence_token", idempotenceToken);
        if (isAdmin) {
          Object.entries(body).forEach(([k, v]) => {
            if (v !== null && v !== undefined && k !== "ocr_payload"
                                              && k !== "idempotence_token") {
              fd.append(k, String(v));
            }
          });
        }
        resp = await postMultipart("/expedientes/create-from-oc/", fd, { token });
      } else {
        resp = await postJSON("/expedientes/create-from-oc/", body, { token });
      }
      patch({ createdExpediente: resp?.expediente || null, submitting: false });
    } catch (e) {
      patch({ submitting: false, submitError: e?.message || "Error inesperado" });
    }
  }, [isAdmin, state, idempotenceToken, patch]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  // Si ya se creó el expediente → pantalla de éxito + CTA a ExpedienteDetail.
  if (state.createdExpediente) {
    return (
      <SuccessView
        expediente={state.createdExpediente}
        isClient={isClient}
        onGoToDetail={() =>
          navigate(`/expedientes/${state.createdExpediente.id}`)}
        onMyOrders={() => navigate("/expedientes")}
        onNewOne={() => {
          // Reset + nuevo token
          setIdx(0);
          patch({
            file: null, fileMeta: null, ocrPayload: null,
            clientId: null, clientName: "",
            brandId:  null, brandName:  "",
            lines: [], mode: null,
            createdExpediente: null, submitError: null,
          });
          window.location.reload(); // regenera idempotence_token
        }}
      />
    );
  }

  const currentStep = steps[idx];
  const canNext = stepIsComplete(currentStep.key, state, isClient);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.h1}>
            {isClient ? "Enviar Orden de Compra" : "Crear Expediente desde OC"}
          </h1>
          {isClient && (
            <p style={styles.lede}>
              Sube tu orden de compra (opcional) o agrega tus productos
              manualmente en el siguiente paso. Nuestro equipo comercial
              procesará tu pedido en breve. No necesitas configurar logística —
              ya la tenemos acordada en tu contrato.
            </p>
          )}
          {isAdmin && (
            <p style={styles.lede}>
              Carga la OC del cliente y completa la logística y governance del
              expediente. El sistema auto-llena cliente y marca desde el OCR.
            </p>
          )}
        </div>
        <Stepper steps={steps} current={idx} />
      </header>

      <main style={styles.main}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y:  0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {currentStep.key === "upload"    && (
              <StepUpload    state={state} patch={patch} isClient={isClient} />
            )}
            {currentStep.key === "logistics" && (
              <StepLogistics state={state} patch={patch} />
            )}
            {currentStep.key === "products"  && (
              <StepProducts  state={state} patch={patch} isClient={isClient}
                             clientId={isClient ? clientScopeId : state.clientId} />
            )}
            {currentStep.key === "review"    && (
              <StepReview    state={state} patch={patch} isClient={isClient} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer style={styles.footer}>
        <div>
          {idx > 0 && (
            <button
              type="button"
              onClick={() => setIdx(idx - 1)}
              style={styles.btnSecondary}
              disabled={state.submitting}
            >
              ← Atrás
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {state.submitError && (
            <span style={{ color: COLORS.danger, fontSize: 13 }}>
              {state.submitError}
            </span>
          )}
          {idx < steps.length - 1 && (
            <button
              type="button"
              onClick={() => setIdx(idx + 1)}
              style={{
                ...styles.btnPrimary,
                opacity: canNext ? 1 : 0.5,
                cursor:  canNext ? "pointer" : "not-allowed",
              }}
              disabled={!canNext}
            >
              Continuar →
            </button>
          )}
          {idx === steps.length - 1 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={state.submitting || !canNext}
              style={{
                ...styles.btnPrimary,
                opacity: (state.submitting || !canNext) ? 0.65 : 1,
                cursor:  (state.submitting || !canNext) ? "wait" : "pointer",
              }}
            >
              {state.submitting
                ? "Enviando…"
                : isClient ? "Enviar Orden de Compra" : "Crear Expediente"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}


// =====================================================================
// Validación por paso — define cuándo habilitar "Continuar"
// =====================================================================
function stepIsComplete(stepKey, s, isClient) {
  switch (stepKey) {
    case "upload":
      // Sprint 2026-07-15 · para CLIENT subir la OC es OPCIONAL: puede
      // continuar sin archivo y agregar sus productos manualmente en el
      // Paso 2. Solo bloqueamos mientras el OCR está leyendo.
      if (isClient) return !s.loadingOcr;
      return Boolean(s.ocrPayload && (s.ocrPayload.lines || []).length > 0);
    case "logistics":
      // ADMIN only. Mode es obligatorio para continuar.
      return Boolean(s.mode);
    case "products":
      return (s.lines || []).length > 0
          && s.lines.every((l) => Number(l.qty) > 0);
    case "review":
      if (isClient) return true;
      return Boolean(s.clientId && s.mode);
    default:
      return true;
  }
}


// =====================================================================
// Stepper (header de progreso)
// =====================================================================
function Stepper({ steps, current }) {
  return (
    <ol style={styles.stepper}>
      {steps.map((st, i) => {
        const isDone    = i <  current;
        const isCurrent = i === current;
        return (
          <li key={st.key} style={styles.stepperItem}>
            <div
              style={{
                ...styles.stepperDot,
                background: isCurrent ? COLORS.mint
                          : isDone    ? COLORS.mintDark
                                      : "#D6DCE6",
                color: (isCurrent || isDone) ? "#fff" : COLORS.inkSoft,
              }}
            >
              {isDone ? "✓" : i + 1}
            </div>
            <span
              style={{
                ...styles.stepperLabel,
                color: isCurrent ? COLORS.navy
                     : isDone    ? COLORS.ink
                                 : COLORS.inkSoft,
                fontWeight: isCurrent ? 600 : 500,
              }}
            >
              {st.label}
            </span>
            {i < steps.length - 1 && (
              <span
                style={{
                  ...styles.stepperLine,
                  background: isDone ? COLORS.mintDark : "#D6DCE6",
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}


// =====================================================================
// PASO 1 · Upload (PDF / XLSX) — OCR-FIRST
//
// Flujo (ADMIN):
//   1. Dropzone masivo, ocupa todo el ancho del card.
//   2. Usuario suelta archivo → animación de escaneo (barra horizontal
//      que recorre el área del archivo).
//   3. Cuando OCR responde → muestra "Contexto detectado" con chips
//      auto-rellenados (Cliente + credit_days + credit_limit, Marca, PO
//      Number). Todo READ-ONLY por default.
//   4. Botón discreto "Llenar manualmente (Fallback)" revela editores
//      de UUID si el OCR falló en identificar cliente/marca.
//
// Flujo (CLIENT): idéntico pero sin la sección de "Contexto detectado"
// — el cliente no ve quién es su propio ID (ya lo sabe el sistema).
// =====================================================================
function StepUpload({ state, patch, isClient }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // Fallback manual oculto por default — POL_UX: no mostramos inputs
  // de edición a menos que el OCR falle o el usuario los pida.
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const onDrop = useCallback(async (file) => {
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    const isSupported = name.endsWith(".pdf") || name.endsWith(".xlsx") || name.endsWith(".xlsm");
    if (!isSupported) {
      patch({ ocrError: "Formato no soportado. Solo PDF o XLSX." });
      return;
    }
    patch({
      file:       file,
      fileMeta:   { name: file.name, size: file.size, ext: name.split(".").pop() },
      loadingOcr: true,
      ocrError:   null,
    });

    // Enviar al endpoint de parseo (en mock mode queda interceptado por
    // lib/api.js → ocrMock.js y devuelve un fixture demo).
    try {
      const token = getToken();
      const fd = new FormData();
      fd.append("file", file);
      const resp = await postMultipart("/ocr/parse-oc/", fd, { token });
      if (!resp?.ok) {
        patch({
          loadingOcr: false,
          ocrError:   resp?.hint || resp?.error || "OCR no pudo extraer datos del archivo.",
        });
        // Si el OCR falló, abrimos el fallback manual automáticamente
        // para que el CEO no quede bloqueado.
        setFallbackOpen(true);
        return;
      }
      const pl = resp.payload || {};
      const clientCand = (pl.client?._candidates || [])[0];
      const brandCand  = (pl.brand?._candidates  || [])[0];
      patch({
        loadingOcr: false,
        ocrPayload: pl,
        ocrError:   null,
        clientId:   clientCand?.id   || null,
        clientName: clientCand?.razon_social || clientCand?.name || pl.client?.name || "",
        brandId:    brandCand?.id    || null,
        brandName:  brandCand?.nombre || brandCand?.name || pl.brand?.name || "",
        lines:      (pl.lines || []).map((l) => ({ ...l })),
      });
      // Resolver líneas contra el catálogo: alias del cliente → SKU/nombre
      // real + precio de la banda vigente (base 90d) o flag "no asignado".
      // R3: para CLIENT el backend fuerza el client_id del JWT (ignora éste).
      try {
        const rr = await postJSON(
          "/expedientes/resolve-oc-preview/",
          { lines: (pl.lines || []).map((l) => ({ ...l })), client_id: clientCand?.id || undefined },
          { token },
        );
        if (rr?.ok && Array.isArray(rr.lines)) {
          patch({ lines: rr.lines.map((l) => ({
            ...l,
            descripcion: l.product_label || l.descripcion || "",
            unit_price:  l.unit_price != null ? l.unit_price : 0,
          })) });
        }
      } catch { /* best-effort: si falla, quedan las líneas crudas del OCR */ }
    } catch (e) {
      patch({
        loadingOcr: false,
        ocrError:   e?.message || "Error procesando el archivo.",
      });
      setFallbackOpen(true);
    }
  }, [patch]);

  const uploadLabel = isClient
    ? "Sube tu Orden de Compra"
    : "Subir Orden de Compra del cliente";

  const uploadHint  = isClient
    ? "Arrastra aquí tu PDF o Excel, o haz clic para seleccionarlo."
    : "Arrastra el archivo o selecciónalo. El sistema lee automáticamente cliente, marca, número de OC y productos.";

  // Candidato principal de cliente (si el OCR lo resolvió)
  const clientCand = state.ocrPayload?.client?._candidates?.[0] || null;
  const brandCand  = state.ocrPayload?.brand?._candidates?.[0]  || null;
  const po         = state.ocrPayload?.po || {};
  const confidence = state.ocrPayload?.confidence;

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>{uploadLabel}</h2>
      <p style={{ ...styles.lede, marginBottom: 12 }}>
        {uploadHint}
      </p>

      {/* ── Dropzone ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDrop(f);
        }}
        onClick={() => !state.loadingOcr && inputRef.current?.click()}
        style={{
          ...styles.dropzone,
          borderColor: dragOver ? COLORS.mint : (state.ocrPayload ? COLORS.mint : COLORS.border),
          background:  dragOver ? "#E6F7F1" : (state.ocrPayload ? "#F4FBF8" : "var(--surface-raised)"),
          position:    "relative",
          overflow:    "hidden",
          cursor:      state.loadingOcr ? "wait" : "pointer",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.xlsx,.xlsm"
          style={{ display: "none" }}
          onChange={(e) => onDrop(e.target.files?.[0])}
        />

        {/* Animación de escaneo: línea horizontal que barre el dropzone */}
        {state.loadingOcr && (
          <motion.div
            aria-hidden="true"
            initial={{ y: "-100%", opacity: 0.9 }}
            animate={{ y: "100%",  opacity: 0.9 }}
            transition={{
              duration: 1.6,
              ease:     "easeInOut",
              repeat:   Infinity,
              repeatType: "loop",
            }}
            style={{
              position: "absolute",
              left: 0, right: 0,
              height: 3,
              background: `linear-gradient(90deg, transparent 0%, ${COLORS.mint} 20%, ${COLORS.mint} 80%, transparent 100%)`,
              boxShadow: `0 0 8px ${COLORS.mint}`,
              zIndex: 2,
            }}
          />
        )}

        {!state.fileMeta && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
            <p style={{ margin: 0, fontSize: 15, color: COLORS.ink, fontWeight: 500 }}>
              Arrastra aquí tu archivo
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: COLORS.inkSoft }}>
              Máximo 10 MB · Formatos aceptados: .pdf, .xlsx
            </p>
          </>
        )}
        {state.fileMeta && (
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 28 }}>
              {state.loadingOcr ? "🔎" : "✅"}
            </div>
            <p style={{ margin: "8px 0 4px", fontWeight: 600, color: COLORS.ink }}>
              {state.fileMeta.name}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.inkSoft }}>
              {(state.fileMeta.size / 1024).toFixed(1)} KB
              · {state.fileMeta.ext.toUpperCase()}
              {state.loadingOcr && " · Leyendo documento…"}
            </p>
          </div>
        )}
      </div>

      {/* ── Loading caption (abajo del dropzone) ── */}
      {state.loadingOcr && (
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ margin: "12px 0 0", fontSize: 13, color: COLORS.inkSoft, textAlign: "center" }}
        >
          Reconociendo {state.fileMeta?.ext?.toUpperCase() === "PDF" ? "texto del PDF" : "celdas del Excel"}
          {" · "}detectando cliente, marca y productos…
        </motion.p>
      )}

      {state.ocrError && (
        <div style={styles.errorBox}>
          <strong>⚠️ {state.ocrError}</strong>
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Puedes completar los datos manualmente más abajo.
          </div>
        </div>
      )}

      {/* ── CLIENT: la OC es OPCIONAL ── */}
      {isClient && !state.ocrPayload && !state.loadingOcr && (
        <p style={{ margin: "14px 0 0", fontSize: 13, color: COLORS.inkSoft, textAlign: "center" }}>
          ¿No tienes el archivo de tu orden de compra? No hay problema — subirlo
          es opcional. Presiona <strong>Continuar</strong> y agrega tus
          productos manualmente en el siguiente paso.
        </p>
      )}

      {/* ── CONTEXTO DETECTADO (ADMIN) ── auto-fill card con chips ── */}
      {!isClient && state.ocrPayload && !state.ocrError && (
        <OcrDetectedPanel
          clientCand={clientCand}
          brandCand={brandCand}
          po={po}
          confidence={confidence}
          linesCount={(state.lines || []).length}
        />
      )}

      {/* ── CLIENT: confirmación mínima (sin cliente ni marca) ── */}
      {isClient && state.ocrPayload && (
        <div style={styles.clientConfirmBox}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <strong>{new Set((state.ocrPayload.lines || []).map((l) => String(l.sku || "—").toUpperCase())).size} SKUs detectados</strong>
            {state.ocrPayload.po?.number && (
              <span style={{ marginLeft: 8, color: COLORS.inkSoft }}>
                · OC #{state.ocrPayload.po.number}
              </span>
            )}
            <span style={{ marginLeft: 8, color: COLORS.inkSoft }}>
              · {state.ocrPayload.lines?.length || 0} línea(s)
            </span>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.inkSoft }}>
              Revisa los productos en el siguiente paso.
            </p>
          </div>
        </div>
      )}

      {/* ── Botón discreto "Llenar manualmente (Fallback)" — SOLO ADMIN.
            · Si el OCR falló → abierto automáticamente (fallbackOpen=true).
            · Si el OCR acertó → el admin puede abrirlo para corregir el UUID
              del cliente o la marca (en caso raro de matcheo ambiguo).
            · El CLIENT nunca ve esta sección — no tiene autoridad para
              reasignar su propio client_id ni la marca. */}
      {!isClient && (
        <div style={{ marginTop: 18, borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
          <button
            type="button"
            onClick={() => setFallbackOpen((v) => !v)}
            style={{
              background:  "transparent",
              border:      "none",
              color:       COLORS.inkSoft,
              fontSize:    12,
              textDecoration: "underline dotted",
              cursor:      "pointer",
              padding:     "4px 0",
            }}
          >
            {fallbackOpen
              ? "Ocultar edición manual"
              : "Llenar manualmente (Fallback)"}
          </button>
          <AnimatePresence initial={false}>
            {fallbackOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{    opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                style={{ overflow: "hidden" }}
              >
                <div style={{ ...styles.contextGrid, marginTop: 12 }}>
                  <AdminContextEditor state={state} patch={patch} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}


// =====================================================================
// OcrDetectedPanel · tarjeta "Contexto detectado" del Paso 1
//
// Muestra el resultado del OCR como chips read-only:
//   [Cliente: ACME Industrial S.R.L. · 45 días · $150,000]
//   [Marca: Rana Walk]
//   [OC: OC-ACME-2026-001  ·  15 mar 2026]
//   [4 productos detectados · Confianza OCR 94%]
// =====================================================================
function OcrDetectedPanel({ clientCand, brandCand, po, confidence, linesCount }) {
  const clientName  = clientCand?.razon_social || clientCand?.name || "—";
  const creditDays  = clientCand?.credit_days;
  const creditLimit = clientCand?.credit_limit_usd;
  const brandName   = brandCand?.nombre || brandCand?.name || "—";
  const confPct     = Math.round((Number(confidence) || 0) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      style={{
        marginTop: 18,
        background: "#F4FBF8",
        border: `1px solid ${COLORS.mint}`,
        borderRadius: 10,
        padding: "14px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <strong style={{ color: COLORS.navy, fontSize: 14 }}>
            Contexto detectado automáticamente
          </strong>
        </div>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#fff",
          background: confPct >= 80 ? COLORS.mintDark : COLORS.warning,
          padding: "3px 10px",
          borderRadius: 999,
          letterSpacing: 0.4,
        }}>
          CONFIANZA OCR {confPct}%
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Cliente */}
        <OcrChipField label="CLIENTE">
          <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.navy }}>{clientName}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {creditDays != null && (
              <span style={chipStyle()}>{creditDays} días crédito</span>
            )}
            {creditLimit != null && creditLimit > 0 && (
              <span style={chipStyle(true)}>Límite {fmtMoneyCompact(creditLimit)}</span>
            )}
          </div>
        </OcrChipField>

        {/* Marca */}
        <OcrChipField label="MARCA">
          <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.navy }}>{brandName}</div>
          {brandCand?.brand_code && (
            <div style={{ marginTop: 6 }}>
              <span style={chipStyle()}>{brandCand.brand_code}</span>
            </div>
          )}
        </OcrChipField>

        {/* OC + líneas */}
        <OcrChipField label="OC DEL CLIENTE">
          <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: COLORS.navy }}>
            {po.number || "—"}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {po.date && <span style={chipStyle()}>{po.date}</span>}
            <span style={chipStyle(true)}>{linesCount} productos</span>
          </div>
        </OcrChipField>
      </div>
    </motion.div>
  );
}

function OcrChipField({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: COLORS.inkSoft,
        letterSpacing: 0.5,
        marginBottom: 4,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function chipStyle(accent = false) {
  return {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 500,
    background: accent ? COLORS.mint : "var(--surface-raised)",
    color:      accent ? "#fff"      : COLORS.ink,
    border:     accent ? "none"      : `1px solid ${COLORS.border}`,
    padding:    "3px 8px",
    borderRadius: 999,
  };
}

function fmtMoneyCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}


// ---------------------------------------------------------------------
// Sub-componente (ADMIN) — editor de cliente + marca si OCR falló
// ---------------------------------------------------------------------
function AdminContextEditor({ state, patch }) {
  // Para prototipo: el CEO puede corregir manualmente el UUID del cliente
  // si el OCR no matcheó. En producción esto debería ser un select tipo
  // Autocomplete contra /api/clientes/?q=… (ya existe), pero mantenemos
  // el input simple por parsimonia y porque el 95% del tiempo el OCR acierta.
  return (
    <>
      <div>
        <label style={styles.label}>Cliente (detectado por OCR)</label>
        <input
          type="text"
          value={state.clientName}
          onChange={(e) => patch({ clientName: e.target.value })}
          placeholder="Nombre del cliente"
          style={styles.input}
        />
        <input
          type="text"
          value={state.clientId || ""}
          onChange={(e) => patch({ clientId: e.target.value })}
          placeholder="UUID (o déjalo auto-detectado)"
          style={{ ...styles.input, fontFamily: "monospace", fontSize: 12, marginTop: 6 }}
        />
      </div>
      <div>
        <label style={styles.label}>Marca (detectada por OCR)</label>
        <input
          type="text"
          value={state.brandName}
          onChange={(e) => patch({ brandName: e.target.value })}
          placeholder="Nombre de la marca"
          style={styles.input}
        />
        <input
          type="text"
          value={state.brandId || ""}
          onChange={(e) => patch({ brandId: e.target.value })}
          placeholder="UUID (o déjalo auto-detectado)"
          style={{ ...styles.input, fontFamily: "monospace", fontSize: 12, marginTop: 6 }}
        />
      </div>
    </>
  );
}


// =====================================================================
// PASO 2 (ADMIN) · Logística y Gobernanza
// =====================================================================
function StepLogistics({ state, patch }) {
  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>Logística y Gobernanza</h2>
      <p style={styles.lede}>
        Configura el modelo comercial y las variables logísticas del expediente.
        Estos campos son CEO-ONLY y definen la estructura de márgenes.
      </p>

      <div style={styles.grid2}>
        <div>
          <label style={styles.label}>Modo Comercial *</label>
          <select
            value={state.mode || ""}
            onChange={(e) => patch({ mode: e.target.value || null })}
            style={styles.select}
          >
            <option value="">— Seleccionar —</option>
            <option value="COMISION">Modo Comisión</option>
            <option value="FULL">Modo Full</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Price Basis (Incoterm)</label>
          <select
            value={state.priceBasis}
            onChange={(e) => patch({ priceBasis: e.target.value })}
            style={styles.select}
          >
            <option value="FOB">FOB · Free on Board</option>
            <option value="CIF">CIF · Cost+Insurance+Freight</option>
            <option value="EXW">EXW · Ex Works</option>
            <option value="DDP">DDP · Delivered Duty Paid</option>
            <option value="CFR">CFR · Cost & Freight</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Freight Mode</label>
          <select
            value={state.freightMode}
            onChange={(e) => patch({ freightMode: e.target.value })}
            style={styles.select}
          >
            <option value="SEA">Marítimo</option>
            <option value="AIR">Aéreo</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Transport Mode</label>
          <select
            value={state.transportMode}
            onChange={(e) => patch({ transportMode: e.target.value })}
            style={styles.select}
          >
            <option value="MARITIMO">Marítimo</option>
            <option value="AEREO">Aéreo</option>
            <option value="TERRESTRE">Terrestre</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Regla de Inicio del Reloj de Crédito</label>
          <select
            value={state.creditClockRule}
            onChange={(e) => patch({ creditClockRule: e.target.value })}
            style={styles.select}
          >
            <option value="ON_PROFORMA">Desde emisión de proforma</option>
            <option value="ON_BL">Desde emisión del BL</option>
            <option value="ON_ETA">Desde ETA de arribo</option>
            <option value="ON_ARRIVAL">Desde arribo real al warehouse</option>
            <option value="ON_INVOICE">Desde emisión de factura fiscal</option>
          </select>
        </div>

        <div>
          <label style={styles.label}>Días de Crédito</label>
          <input
            type="number"
            min="0"
            max="180"
            value={state.creditDays}
            onChange={(e) => patch({ creditDays: Number(e.target.value) })}
            style={styles.input}
          />
        </div>
      </div>

      <small style={{ color: COLORS.inkSoft, fontSize: 12 }}>
        * Mode es obligatorio. Puedes dejar los demás con sus defaults.
      </small>
    </section>
  );
}


// =====================================================================
// PASO 3 · Productos
//   · ADMIN  → tabla editable con SKU, size, qty, unit_price, verdict
//   · CLIENT → tabla read-only excepto qty. Precios pre-negociados.
// =====================================================================
function StepProducts({ state, patch, isClient, clientId }) {
  const setLine = (i, patchLine) => {
    const next = state.lines.slice();
    next[i] = { ...next[i], ...patchLine };
    patch({ lines: next });
  };
  const delLine = (i) => {
    // Sprint 2026-07-15 · el CLIENT puede quitar CUALQUIER línea del pedido
    // (detectada por OCR o agregada manualmente), igual que la vista admin.
    patch({ lines: state.lines.filter((_, j) => j !== i) });
  };

  const cur = state.ocrPayload?.po?.currency || "USD";
  const [reqLine, setReqLine] = useState(null);
  const [reqDone, setReqDone] = useState({});   // sku -> true (solicitud enviada)
  const [manualOpen, setManualOpen] = useState(false);
  // Una línea está "asignada" si el preview lo marcó así; si no vino del
  // preview (flujo admin / OCR crudo) asumimos asignada (precio editable).
  const isAssigned = (l) => (l.assigned === undefined ? true : !!l.assigned);
  const subtotal = state.lines.reduce(
    (acc, l) => acc + (isAssigned(l) ? (Number(l.qty) || 0) * (Number(l.unit_price) || 0) : 0),
    0,
  );

  // ── Alta manual de productos (CLIENT) — Sprint 2026-07-15 ──────
  // Mismo componente que la vista admin (ManualLinePanel): buscar por
  // nombre/SKU → matriz de tallas → cantidades. Tras agregar, resolvemos
  // los precios pre-negociados vía resolve-oc-preview (best-effort; el
  // backend re-deriva los precios del motor canónico al crear).
  const addManualRows = async (rows) => {
    const mapped = rows.map((r) => ({
      sku:                r.sku,
      client_part_number: r.sku,
      descripcion:        r.product_label || r.sku,
      product_label:      r.product_label || r.sku,
      size:               r.talla || null,
      qty:                Number(r.cantidad) || 0,
      unit_price:         0,
      producto_id:        r.producto_id || null,
      assigned:           !!r.is_assigned,
      manual:             true,
    }));
    const merged = [...(state.lines || []), ...mapped];
    patch({ lines: merged });
    try {
      const token = getToken();
      const rr = await postJSON(
        "/expedientes/resolve-oc-preview/",
        { lines: merged.map((l) => ({ ...l })), client_id: clientId || undefined },
        { token },
      );
      if (rr?.ok && Array.isArray(rr.lines) && rr.lines.length === merged.length) {
        patch({
          lines: rr.lines.map((l, i) => ({
            ...merged[i],
            ...l,
            descripcion: l.product_label || merged[i].descripcion || "",
            unit_price:  l.unit_price != null ? l.unit_price : 0,
          })),
        });
      }
    } catch { /* best-effort: quedan qty/talla; el backend re-deriva precios */ }
  };

  return (
    <section style={styles.card}>
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <h2 style={{ ...styles.h2, margin: 0 }}>
          {isClient ? "Confirmar Productos" : "Productos extraídos"}
        </h2>
        {isClient && (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            style={{
              background: COLORS.mint,
              color: "#FFFFFF",
              border: "none",
              padding: "9px 18px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 2px 6px rgba(0,178,134,0.25)",
              transition: "background 140ms ease, transform 140ms ease, box-shadow 140ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.mintDark;
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,178,134,0.35)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.mint;
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,178,134,0.25)";
            }}
            title="Busca por nombre o SKU, elige tallas y cantidades."
          >
            ＋ Agregar producto
          </button>
        )}
      </div>
      {isClient && (
        <p style={styles.lede}>
          Estos son los productos que leímos de tu archivo, resueltos contra el
          catálogo con tus precios pre-negociados. Los que aún no tienes
          asignados aparecen sin precio: pedí su asignación con un clic. Puedes
          ajustar cantidades, quitar líneas con la ✕ o agregar más productos.
        </p>
      )}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>SKU</th>
            <th style={styles.th}>Descripción</th>
            <th style={styles.th}>Talla</th>
            <th style={styles.thRight}>Qty</th>
            <th style={styles.thRight}>Precio Unit.</th>
            <th style={styles.thRight}>Subtotal</th>
            {!isClient && <th style={styles.th}>Veredicto</th>}
            <th style={styles.th} aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {state.lines.map((l, i) => {
            const assigned = isAssigned(l);
            const sent = !!(l.unassigned_request_sent || reqDone[l.sku]);
            return (
            <tr key={i} style={i % 2 ? { background: "var(--bg-alt)" } : null}>
              <td style={styles.td}>
                {isClient ? <code>{l.sku}</code> : (
                  <input
                    style={styles.cellInput}
                    value={l.sku || ""}
                    onChange={(e) => setLine(i, { sku: e.target.value })}
                  />
                )}
              </td>
              <td style={styles.td}>{l.product_label || l.descripcion || "—"}</td>
              <td style={styles.td}>{l.size || "—"}</td>
              <td style={styles.tdRight}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  style={{ ...styles.cellInput, textAlign: "right", maxWidth: 80 }}
                  value={l.qty || 0}
                  onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                />
              </td>
              <td style={styles.tdRight}>
                {!assigned ? (
                  <span style={{ color: COLORS.inkSoft }}>—</span>
                ) : isClient ? (
                  fmtMoney(l.unit_price, cur)
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    style={{ ...styles.cellInput, textAlign: "right", maxWidth: 100 }}
                    value={l.unit_price || 0}
                    onChange={(e) => setLine(i, { unit_price: Number(e.target.value) })}
                  />
                )}
              </td>
              <td style={styles.tdRight}>
                {assigned ? (
                  fmtMoney((Number(l.qty) || 0) * (Number(l.unit_price) || 0), cur)
                ) : sent ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#0E9F6E" }}>
                    Solicitud enviada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReqLine({ sku: l.sku, talla: l.size, cantidad: l.qty })}
                    style={{
                      padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      borderRadius: 8, whiteSpace: "nowrap",
                      color: "#B45309", border: "1px solid rgba(180,83,9,0.40)",
                      background: "rgba(180,83,9,0.06)",
                    }}
                    title="Pedir que MWT te asigne este producto"
                  >
                    Solicitar asignación
                  </button>
                )}
              </td>
              {!isClient && (
                <td style={styles.td}>
                  <VerdictChip verdict={l.price_verdict} moqViolated={l.moq_violated} />
                </td>
              )}
              <td style={styles.td}>
                <button
                  type="button"
                  onClick={() => delLine(i)}
                  style={{ ...styles.btnGhost, color: COLORS.danger }}
                  title="Quitar línea"
                >
                  ✕
                </button>
              </td>
            </tr>
            );
          })}
          {state.lines.length === 0 && (
            <tr>
              <td
                colSpan={isClient ? 7 : 8}
                style={{ ...styles.td, textAlign: "center", padding: 24, color: COLORS.inkSoft }}
              >
                {isClient
                  ? "No hay líneas todavía. Usa “＋ Agregar producto” para armar tu pedido, o vuelve al paso anterior y sube tu OC."
                  : "No hay líneas. Vuelve al paso anterior y vuelve a subir el archivo."}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
              Subtotal
            </td>
            <td style={{ ...styles.tdRight, fontWeight: 700, color: COLORS.navy }}>
              {fmtMoney(subtotal, cur)}
            </td>
            {!isClient ? <td colSpan={2} /> : <td />}
          </tr>
        </tfoot>
      </table>

      {manualOpen && (
        <ManualLinePanel
          lang="es"
          clientId={clientId}
          onClose={() => setManualOpen(false)}
          onAdd={(rows) => { addManualRows(rows); setManualOpen(false); }}
        />
      )}

      {reqLine && (
        <RequestAssignmentDialog
          lang="es"
          sku={reqLine.sku}
          clientId={state.clientId}
          clientEmail={state.clientEmail || ""}
          onClose={() => setReqLine(null)}
          onSent={() => { setReqDone((p) => ({ ...p, [reqLine.sku]: true })); setReqLine(null); }}
          onError={() => setReqLine(null)}
        />
      )}
    </section>
  );
}


// ---------------------------------------------------------------------
// Chip de veredicto (ADMIN only)
// ---------------------------------------------------------------------
function VerdictChip({ verdict, moqViolated }) {
  if (!verdict && !moqViolated) return null;
  const map = {
    "OK":                { bg: "#E6F7F1", color: COLORS.mintDark, label: "OK" },
    "WARN_BELOW_SYSTEM": { bg: "#FFF3E0", color: COLORS.warning,  label: "⚠ Bajo sistema" },
    "WARN_ABOVE_SYSTEM": { bg: "#FFF3E0", color: COLORS.warning,  label: "⚠ Sobre sistema" },
    "ERROR":             { bg: "#FCE7E7", color: COLORS.danger,   label: "✕ Error" },
  };
  const v = map[verdict] || { bg: "#EAEEF3", color: COLORS.inkSoft, label: verdict || "-" };
  return (
    <span style={{
      background: moqViolated ? "#FCE7E7" : v.bg,
      color:      moqViolated ? COLORS.danger : v.color,
      padding:    "3px 8px",
      borderRadius: 12,
      fontSize:   11,
      fontWeight: 600,
    }}>
      {moqViolated ? "⚠ MOQ" : v.label}
    </span>
  );
}


// =====================================================================
// PASO 4 (ADMIN) / PASO 3 (CLIENT) · Review & Submit
// =====================================================================
function StepReview({ state, isClient }) {
  const totalUnits = (state.lines || []).reduce(
    (a, l) => a + (Number(l.qty) || 0), 0,
  );
  const subtotal = (state.lines || []).reduce(
    (a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
    0,
  );
  const currency = state.ocrPayload?.po?.currency || "USD";

  // Sprint 2026-07-15 (CEO) · las "líneas" del wizard son filas por talla;
  // en el Review se agrupan por SKU: cada grupo muestra SKU + descripción
  // y debajo cada talla con su cantidad. El KPI cuenta SKUs, no filas.
  const skuGroups = [];
  {
    const bySku = new Map();
    for (const l of state.lines || []) {
      const key = String(l.sku || "—").toUpperCase();
      if (!bySku.has(key)) {
        const g = {
          sku:         l.sku || "—",
          descripcion: l.product_label || l.descripcion || "",
          sizes:       new Map(),   // talla -> qty (merge de filas repetidas)
          units:       0,
          subtotal:    0,
        };
        bySku.set(key, g);
        skuGroups.push(g);
      }
      const g   = bySku.get(key);
      const qty = Number(l.qty) || 0;
      const sz  = l.size || "ÚNICA";
      g.sizes.set(sz, (g.sizes.get(sz) || 0) + qty);
      g.units    += qty;
      g.subtotal += qty * (Number(l.unit_price) || 0);
      if (!g.descripcion && (l.product_label || l.descripcion)) {
        g.descripcion = l.product_label || l.descripcion;
      }
    }
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>
        {isClient ? "Revisar y Enviar" : "Revisar y Crear"}
      </h2>

      {/* KPIs arriba */}
      <div style={styles.kpiRow}>
        <Kpi label="SKUs"           value={skuGroups.length} />
        <Kpi label="Unidades"       value={totalUnits.toLocaleString()} />
        <Kpi label={`Total ${currency}`} value={fmtMoney(subtotal, currency)} accent />
      </div>

      {/* Detalle contextual */}
      <div style={styles.reviewGrid}>
        {!isClient && (
          <>
            <ReviewField label="Cliente" value={state.clientName || "(sin detectar)"} />
            <ReviewField label="Marca"   value={state.brandName  || "(sin detectar)"} />
            <ReviewField label="Modo comercial" value={state.mode || "—"} highlight={!state.mode} />
            <ReviewField label="Price basis"   value={state.priceBasis} />
            <ReviewField label="Freight mode"  value={state.freightMode} />
            <ReviewField label="Transport"     value={state.transportMode} />
            <ReviewField label="Regla crédito" value={state.creditClockRule} />
            <ReviewField label="Días crédito"  value={`${state.creditDays} días`} />
          </>
        )}
        <ReviewField
          label="OC (PO Number)"
          value={state.ocrPayload?.po?.number || "(auto-generado)"}
        />
      </div>

      {/* ── Desglose por SKU · descripción + talla/cantidad ── */}
      <div style={{ marginTop: 28 }}>
        <h3 style={{
          fontSize: 14, fontWeight: 600, color: COLORS.navy,
          margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          Productos por SKU
        </h3>
        {skuGroups.map((g) => (
          <div
            key={g.sku}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 10,
              background: "var(--surface-raised)",
            }}
          >
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "baseline", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ minWidth: 0 }}>
                <code style={{ fontWeight: 700, color: COLORS.navy }}>{g.sku}</code>
                <span style={{ marginLeft: 10, color: COLORS.ink, fontSize: 14 }}>
                  {g.descripcion || "—"}
                </span>
              </div>
              <div style={{
                fontSize: 13, color: COLORS.inkSoft,
                fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
              }}>
                {g.units.toLocaleString()} unidades ·{" "}
                <strong style={{ color: COLORS.navy }}>{fmtMoney(g.subtotal, currency)}</strong>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {Array.from(g.sizes.entries()).map(([sz, qty]) => (
                <span
                  key={sz}
                  style={{
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    padding: "4px 10px",
                    fontSize: 12,
                    background: COLORS.paper,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ color: COLORS.inkSoft }}>Talla {sz}</span>{" "}
                  <strong style={{ color: COLORS.navy }}>× {qty.toLocaleString()}</strong>
                </span>
              ))}
            </div>
          </div>
        ))}
        {skuGroups.length === 0 && (
          <p style={{ fontSize: 13, color: COLORS.inkSoft }}>
            No hay productos. Vuelve al paso anterior.
          </p>
        )}
      </div>

    </section>
  );
}


function SuccessView({ expediente, isClient, onGoToDetail, onNewOne, onMyOrders }) {
  return (
    <div style={{ ...styles.page, paddingTop: 60 }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1,   opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        style={{ ...styles.card, textAlign: "center", maxWidth: 560, margin: "0 auto" }}
      >
        <div style={{ fontSize: 64 }}>🎉</div>
        <h2 style={{ ...styles.h2, justifyContent: "center" }}>
          {isClient ? "Orden enviada con éxito" : "Expediente creado"}
        </h2>
        <p style={styles.lede}>
          Código: <code style={{ fontWeight: 600 }}>{expediente.codigo}</code>
        </p>
        {isClient && (
          <p style={{ ...styles.lede, color: COLORS.inkSoft }}>
            Estado inicial: pendiente de revisión por nuestro equipo comercial.
          </p>
        )}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
          {!isClient && (
            <button type="button" onClick={onGoToDetail} style={styles.btnPrimary}>
              Ver expediente →
            </button>
          )}
          {isClient && (
            <button type="button" onClick={onMyOrders} style={styles.btnPrimary}>
              Mis pedidos →
            </button>
          )}
          <button type="button" onClick={onNewOne} style={styles.btnSecondary}>
            {isClient ? "Enviar otra OC" : "Crear otro expediente"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------
function Kpi({ label, value, accent }) {
  return (
    <div style={{
      ...styles.kpi,
      background: accent ? "var(--brand-primary)" : "var(--surface-raised)",
      color:      accent ? "#fff"       : COLORS.ink,
      borderColor: accent ? "var(--brand-primary)" : COLORS.border,
    }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function ReviewField({ label, value, highlight }) {
  return (
    <div style={styles.reviewField}>
      <div style={styles.reviewFieldLabel}>{label}</div>
      <div style={{
        ...styles.reviewFieldValue,
        color: highlight ? COLORS.danger : COLORS.ink,
        fontWeight: highlight ? 600 : 500,
      }}>
        {value}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------
function fmtMoney(n, currency = "USD") {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style:                 "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}


// =====================================================================
// Estilos inline (para no depender de app.css en este componente nuevo)
// =====================================================================
const styles = {
  page: {
    minHeight: "100%",
    background: COLORS.paper,
    padding: "32px 40px 120px",
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif",
    color: COLORS.ink,
  },
  header: { maxWidth: 1120, margin: "0 auto 24px" },
  headerInner: { marginBottom: 24 },
  h1: {
    fontSize: 28,
    fontWeight: 700,
    color: COLORS.navy,
    margin: "0 0 8px",
    letterSpacing: -0.3,
  },
  lede: {
    fontSize: 14,
    color: COLORS.inkSoft,
    margin: 0,
    maxWidth: 720,
    lineHeight: 1.5,
  },
  main: { maxWidth: 1120, margin: "0 auto" },
  footer: {
    maxWidth: 1120,
    margin: "32px auto 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 20,
    borderTop: `1px solid ${COLORS.border}`,
  },

  // Stepper
  stepper: {
    display: "flex",
    listStyle: "none",
    padding: 0,
    margin: 0,
    gap: 0,
  },
  stepperItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    position: "relative",
  },
  stepperDot: {
    width: 32, height: 32,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    transition: "all 0.2s ease",
    flexShrink: 0,
  },
  stepperLabel: { fontSize: 13, whiteSpace: "nowrap" },
  stepperLine: {
    flex: 1, height: 2, marginLeft: 10,
    transition: "background 0.2s ease",
  },

  // Card
  card: {
    background: "var(--surface-raised)",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "28px 32px",
    boxShadow: "0 1px 2px rgba(11, 30, 58, 0.04)",
  },
  h2: {
    fontSize: 20,
    fontWeight: 600,
    color: COLORS.navy,
    margin: "0 0 8px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  // Dropzone
  dropzone: {
    marginTop: 16,
    border: `2px dashed ${COLORS.border}`,
    borderRadius: 12,
    padding: "48px 24px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },

  // Loading
  loadingBar: {
    marginTop: 16,
    height: 6,
    background: "#EEF2F7",
    borderRadius: 4,
    position: "relative",
    overflow: "hidden",
  },
  loadingBarFill: {
    height: "100%",
    background: COLORS.mint,
    borderRadius: 4,
  },

  // Error
  errorBox: {
    marginTop: 16,
    background: "#FCE7E7",
    border: `1px solid ${COLORS.danger}`,
    color: COLORS.danger,
    padding: "12px 14px",
    borderRadius: 8,
    fontSize: 13,
  },

  // Context
  contextGrid: {
    marginTop: 24,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  },
  clientConfirmBox: {
    marginTop: 20,
    background: "#E6F7F1",
    border: `1px solid ${COLORS.mint}`,
    borderRadius: 10,
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    gap: 14,
  },

  // Forms
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.inkSoft,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${COLORS.border}`,
    fontSize: 14,
    color: COLORS.ink,
    outline: "none",
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${COLORS.border}`,
    fontSize: 14,
    background: "var(--surface-raised)",
    color: COLORS.ink,
    boxSizing: "border-box",
  },
  cellInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${COLORS.border}`,
    fontSize: 13,
    background: "var(--surface-raised)",
    boxSizing: "border-box",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    margin: "20px 0 12px",
  },

  // Table
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 18,
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "#F3F5F8",
    color: COLORS.inkSoft,
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  thRight: {
    textAlign: "right",
    padding: "10px 12px",
    background: "#F3F5F8",
    color: COLORS.inkSoft,
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`,
    color: COLORS.ink,
    verticalAlign: "middle",
  },
  tdRight: {
    padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`,
    color: COLORS.ink,
    textAlign: "right",
    verticalAlign: "middle",
  },

  // KPIs
  kpiRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
    margin: "16px 0 24px",
  },
  kpi: {
    border: "1px solid",
    borderRadius: 10,
    padding: "14px 18px",
    minWidth: 120,
  },

  // Review
  reviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 16,
  },
  reviewField: {
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: 8,
  },
  reviewFieldLabel: {
    fontSize: 11,
    color: COLORS.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewFieldValue: {
    fontSize: 14,
  },

  // Buttons
  btnPrimary: {
    background: COLORS.mint,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  btnSecondary: {
    background: "var(--surface-raised)",
    color: COLORS.ink,
    border: `1px solid ${COLORS.border}`,
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  btnGhost: {
    background: "transparent",
    border: "none",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 14,
  },
};
