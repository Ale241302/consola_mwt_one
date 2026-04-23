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
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { useRole } from "../context/RoleContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getToken, ApiError } from "../lib/api.js";

// ---------------------------------------------------------------------
// Paleta MWT (hardcoded en constantes, no en clases — permite que el
// Admin cambie colores de tema sin re-escribir todos los selectores).
// ---------------------------------------------------------------------
const COLORS = {
  navy:      "#0B1E3A",
  mint:      "#00B286",
  mintDark:  "#008B69",
  ink:       "#1B2A45",
  inkSoft:   "#4A5A75",
  paper:     "#F7F9FC",
  border:    "#E1E6ED",
  danger:    "#D64545",
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
// Helper: POST multipart (apiFetch no soporta FormData por default).
// ---------------------------------------------------------------------
async function postMultipart(path, formData, { token } = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body:    formData,
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

  const steps   = isClient ? STEPS_CLIENT : STEPS_ADMIN;
  const [idx, setIdx] = useState(0);

  // Estado del wizard — vive acá arriba y los sub-componentes leen/escriben.
  const [state, setState] = useState(() => ({
    file:              null,            // File browser object
    fileMeta:          null,            // { name, ext, size }
    ocrPayload:        null,            // respuesta de /api/ocr/parse-oc/
    loadingOcr:        false,
    ocrError:          null,

    // Context resuelto por OCR (ADMIN puede corregir, CLIENT no lo ve)
    clientId:          null,
    clientName:        "",
    brandId:           null,
    brandName:         "",

    // Líneas (productos). CLIENT solo puede editar qty.
    lines:             [],

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
      const body = {
        ocr_payload:       state.ocrPayload,
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
        fd.append("ocr_payload",       JSON.stringify(state.ocrPayload || {}));
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
              Sube tu orden de compra y el equipo de Rana Walk la procesará en
              breve. No necesitas configurar logística — ya la tenemos acordada
              en tu contrato.
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
              <StepProducts  state={state} patch={patch} isClient={isClient} />
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
// PASO 1 · Upload (PDF / XLSX)
// =====================================================================
function StepUpload({ state, patch, isClient }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

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

    // Enviar al endpoint de parseo
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
        clientName: clientCand?.name || pl.client?.name || "",
        brandId:    brandCand?.id    || null,
        brandName:  brandCand?.name  || pl.brand?.name  || "",
        lines:      (pl.lines || []).map((l) => ({ ...l })),
      });
    } catch (e) {
      patch({
        loadingOcr: false,
        ocrError:   e?.message || "Error procesando el archivo.",
      });
    }
  }, [patch]);

  const uploadLabel = isClient
    ? "Sube tu Orden de Compra (PDF o Excel)"
    : "Subir OC del cliente (.pdf o .xlsx)";

  const uploadHint  = isClient
    ? "Arrastra aquí el archivo, o haz clic para seleccionarlo desde tu computadora."
    : "Arrastra el archivo o selecciónalo. El sistema extraerá SKUs, cantidades y PO Number automáticamente.";

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>{uploadLabel}</h2>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDrop(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          ...styles.dropzone,
          borderColor: dragOver ? COLORS.mint : COLORS.border,
          background:  dragOver ? "#E6F7F1" : "#FAFBFD",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.xlsx,.xlsm"
          style={{ display: "none" }}
          onChange={(e) => onDrop(e.target.files?.[0])}
        />
        {!state.fileMeta && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
            <p style={{ margin: 0, fontSize: 15, color: COLORS.ink }}>
              {uploadHint}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: COLORS.inkSoft }}>
              Máximo 10 MB · Formatos: .pdf, .xlsx
            </p>
          </>
        )}
        {state.fileMeta && (
          <div>
            <div style={{ fontSize: 28 }}>✅</div>
            <p style={{ margin: "8px 0 4px", fontWeight: 600, color: COLORS.ink }}>
              {state.fileMeta.name}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.inkSoft }}>
              {(state.fileMeta.size / 1024).toFixed(1)} KB
              · {state.fileMeta.ext.toUpperCase()}
            </p>
          </div>
        )}
      </div>

      {state.loadingOcr && (
        <div style={styles.loadingBar}>
          <motion.div
            style={styles.loadingBarFill}
            initial={{ width: "0%" }}
            animate={{ width: ["0%", "80%", "95%"] }}
            transition={{ duration: 4, times: [0, 0.5, 1], ease: "easeInOut" }}
          />
          <p style={{ margin: "8px 0 0", fontSize: 13, color: COLORS.inkSoft }}>
            Procesando el archivo {state.fileMeta?.ext?.toUpperCase() === "PDF" ? "con OCR" : "con el parser Excel"}…
          </p>
        </div>
      )}

      {state.ocrError && (
        <div style={styles.errorBox}>
          <strong>⚠️ {state.ocrError}</strong>
        </div>
      )}

      {/* Context summary — SOLO ADMIN */}
      {!isClient && state.ocrPayload && (
        <div style={styles.contextGrid}>
          <AdminContextEditor state={state} patch={patch} />
        </div>
      )}

      {/* CLIENT: confirmación visual mínima — ni siquiera se muestra el
          cliente, porque ya sabemos quién es y no queremos darle
          opciones. */}
      {isClient && state.ocrPayload && (
        <div style={styles.clientConfirmBox}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <strong>{state.ocrPayload.lines?.length || 0} productos detectados</strong>
            {state.ocrPayload.po?.number && (
              <span style={{ marginLeft: 8, color: COLORS.inkSoft }}>
                · OC #{state.ocrPayload.po.number}
              </span>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.inkSoft }}>
              Revisa los productos en el siguiente paso.
            </p>
          </div>
        </div>
      )}
    </section>
  );
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
function StepProducts({ state, patch, isClient }) {
  const setLine = (i, patchLine) => {
    const next = state.lines.slice();
    next[i] = { ...next[i], ...patchLine };
    patch({ lines: next });
  };
  const delLine = (i) => {
    if (isClient) return; // CLIENT no puede eliminar líneas
    patch({ lines: state.lines.filter((_, j) => j !== i) });
  };

  const subtotal = state.lines.reduce(
    (acc, l) => acc + (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
    0,
  );

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>
        {isClient ? "Confirmar Productos" : "Productos extraídos"}
      </h2>
      {isClient && (
        <p style={styles.lede}>
          Estos son los productos que leímos de tu archivo, con los precios
          pre-negociados que tienes con Rana Walk. Puedes ajustar la cantidad
          si es necesario.
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
            {!isClient && <th />}
          </tr>
        </thead>
        <tbody>
          {state.lines.map((l, i) => (
            <tr key={i} style={i % 2 ? { background: "#FAFBFD" } : null}>
              <td style={styles.td}>
                {isClient ? <code>{l.sku}</code> : (
                  <input
                    style={styles.cellInput}
                    value={l.sku || ""}
                    onChange={(e) => setLine(i, { sku: e.target.value })}
                  />
                )}
              </td>
              <td style={styles.td}>{l.descripcion || "—"}</td>
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
                {isClient ? (
                  fmtMoney(l.unit_price, state.ocrPayload?.po?.currency)
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
                {fmtMoney(
                  (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
                  state.ocrPayload?.po?.currency,
                )}
              </td>
              {!isClient && (
                <td style={styles.td}>
                  <VerdictChip verdict={l.price_verdict} moqViolated={l.moq_violated} />
                </td>
              )}
              {!isClient && (
                <td style={styles.td}>
                  <button
                    type="button"
                    onClick={() => delLine(i)}
                    style={{ ...styles.btnGhost, color: COLORS.danger }}
                    title="Eliminar línea"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
          {state.lines.length === 0 && (
            <tr>
              <td
                colSpan={isClient ? 6 : 8}
                style={{ ...styles.td, textAlign: "center", padding: 24, color: COLORS.inkSoft }}
              >
                No hay líneas. Vuelve al paso anterior y vuelve a subir el archivo.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={isClient ? 4 : 5} style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
              Subtotal
            </td>
            <td style={{ ...styles.tdRight, fontWeight: 700, color: COLORS.navy }}>
              {fmtMoney(subtotal, state.ocrPayload?.po?.currency)}
            </td>
            {!isClient && <td colSpan={2} />}
          </tr>
        </tfoot>
      </table>
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
  const linesCount = (state.lines || []).length;
  const totalUnits = (state.lines || []).reduce(
    (a, l) => a + (Number(l.qty) || 0), 0,
  );
  const subtotal = (state.lines || []).reduce(
    (a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
    0,
  );
  const currency = state.ocrPayload?.po?.currency || "USD";

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>
        {isClient ? "Revisar y Enviar" : "Revisar y Crear"}
      </h2>

      {/* KPIs arriba */}
      <div style={styles.kpiRow}>
        <Kpi label="Líneas"         value={linesCount} />
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
        <ReviewField
          label="Confianza OCR"
          value={`${Math.round((state.ocrPayload?.confidence || 0) * 100)}%`}
        />
      </div>

      {isClient && (
        <div style={{
          background: "#E6F7F1",
          border:     `1px solid ${COLORS.mint}`,
          borderRadius: 8,
          padding:    "12px 14px",
          fontSize:   13,
          color:      COLORS.ink,
          marginTop:  16,
        }}>
          <strong>📬 Próximos pasos.</strong> Al enviar, tu orden queda
          registrada en el sistema de Rana Walk y nuestro equipo comercial te
          confirmará los plazos de producción en las próximas horas hábiles.
          Recibirás confirmación por email y verás el estado en tu Portal.
        </div>
      )}
    </section>
  );
}


function SuccessView({ expediente, isClient, onGoToDetail, onNewOne }) {
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
            Estado inicial: pendiente de revisión por el equipo de Rana Walk.
          </p>
        )}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
          {!isClient && (
            <button type="button" onClick={onGoToDetail} style={styles.btnPrimary}>
              Ver expediente →
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
      background: accent ? COLORS.navy : "#FFFFFF",
      color:      accent ? "#fff"       : COLORS.ink,
      borderColor: accent ? COLORS.navy : COLORS.border,
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
    background: "#FFFFFF",
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
    background: "#fff",
    color: COLORS.ink,
    boxSizing: "border-box",
  },
  cellInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${COLORS.border}`,
    fontSize: 13,
    background: "#FFFFFF",
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
    background: "#FFFFFF",
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
