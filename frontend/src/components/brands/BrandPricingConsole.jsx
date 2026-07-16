// =====================================================================
// MWT.ONE · components/brands/BrandPricingConsole.jsx
// Agente responsable: [AG-FRONTEND]
//
// Motor de Precios por marca · rediseño sprint M3c.
//
// La vista antes tenía una tabla de "Listas de precios activas" + una
// calculadora COMEX inline. Ahora es un GRID DE CARDS CLIENTE:
//
//   ┌────────────────────────────────────┐
//   │ [bandera] Razón social       [✏] │   ← click ✏ → /clientes/:id/editar
//   │ Canal · país · tag estado          │
//   ├────────────────────────────────────┤
//   │ Días crédito        Límite crédito │
//   │ 60d                 $180,000 USD   │
//   │ Comisión pactada                   │
//   │ 8.5%  ▓▓▓▓▓░░░░░░░                 │
//   ├────────────────────────────────────┤
//   │ [Archivo activo · badge fecha_fin] │
//   └────────────────────────────────────┘
//          ↑ click body → /marcas/:brandId/clientes/:clienteId/precios
//
// POL_VISIBILIDAD: los campos límite/comisión sólo se renderean si
// isAdmin. El backend también los enmascara (defensa en dos capas).
//
// El sub-tab bar queda pero con solo "Listas de Precios" por compatibilidad.
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  IconDollar, IconSearch, IconLock, IconAlert,
  IconCheck, IconClock, IconRefresh, IconUser,
} from "../../lib/icons.jsx";

// IconPencil no está exportado en lib/icons — lo definimos inline.
const IconPencil = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
  </svg>
);
import { useRole } from "../../context/RoleContext.jsx";
import { CLIENTS } from "../../data/mockData.js";
import { apiFetch, getToken } from "../../lib/api.js";
import * as XLSX from "xlsx";
import {
  parseExcelMarluvas, defaultSkuState, buildSimSkusPayload,
} from "../../lib/marluvasPricing.js";
import { BANDAS_MARLUVAS, PLAZOS_MARLUVAS } from "../../constants/marluvas.js";

// Mapeo ISO-2 → emoji bandera (subset relevante para el grid de cards)
const FLAG_BY_ISO2 = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};

// Backend (BrandClientsSummaryView) → shape que el grid ya consume.
function adaptClientSummary(r) {
  return {
    cliente_id:        r.cliente_id || r.id,
    razon_social:      r.razon_social || '',
    nombre_comercial:  r.nombre_comercial || r.razon_social || '',
    pais_iso2:         (r.pais_iso2 || '').toUpperCase(),
    flag:              r.flag || FLAG_BY_ISO2[(r.pais_iso2 || '').toUpperCase()] || '🌐',
    canal:             (r.canal || 'DISTRIBUIDOR').toUpperCase(),
    estado:            (r.estado || 'ACTIVO').toUpperCase(),
    dias_credito:      Number(r.dias_credito || 0),
    credito_limit_usd: Number(r.credito_limit_usd ?? r.credito_aprobado ?? 0),
    comision_pct:      r.comision_pct == null ? null : Number(r.comision_pct),
    assignment:        r.assignment || null,
    // Sprint Parent-Child: el FE sangra subsidiarias bajo su padre.
    parent_id:         r.parent_id || null,
    parent_name:       null,
  };
}

// Ordena padres seguidos de sus subsidiarias para mantener jerarquia visual.
function sortClientsHierarchy(clients) {
  const out = []; const seen = new Set();
  clients.filter(c => !c.parent_id).forEach(parent => {
    out.push(parent); seen.add(parent.cliente_id);
    clients.filter(c => c.parent_id === parent.cliente_id).forEach(sub => {
      out.push({ ...sub, parent_name: parent.razon_social || parent.nombre_comercial });
      seen.add(sub.cliente_id);
    });
  });
  clients.forEach(c => { if (!seen.has(c.cliente_id)) out.push(c); });
  return out;
}

// ─── Design tokens ───────────────────────────────────────────
const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const AMBER = "#F59E0B";
const RED   = "#DC2626";
const INK   = "#334155";
const MUTED = "#64748B";
const SOFT  = "#F8FAFC";

// ─── Mapeo país → bandera + label ────────────────────────────
const COUNTRY_META = {
  PE: { flag: "🇵🇪", label: "Perú" },
  CL: { flag: "🇨🇱", label: "Chile" },
  AR: { flag: "🇦🇷", label: "Argentina" },
  MX: { flag: "🇲🇽", label: "México" },
  CO: { flag: "🇨🇴", label: "Colombia" },
  BR: { flag: "🇧🇷", label: "Brasil" },
  CR: { flag: "🇨🇷", label: "Costa Rica" },
  EC: { flag: "🇪🇨", label: "Ecuador" },
  DO: { flag: "🇩🇴", label: "R. Dominicana" },
  PA: { flag: "🇵🇦", label: "Panamá" },
  US: { flag: "🇺🇸", label: "USA" },
};

// ─── ESTADO visual del cliente en la card ────────────────────
const ESTADO_COLORS = {
  ACTIVO:    { bg: `${MINT}15`,  color: MINT,  dot: MINT  },
  PAUSADO:   { bg: `${AMBER}15`, color: AMBER, dot: AMBER },
  BLOQUEADO: { bg: `${RED}15`,   color: RED,   dot: RED   },
  INACTIVO:  { bg: "#F1F5F9",    color: MUTED, dot: MUTED },
};


// ═════════════════════════════════════════════════════════════
// Componente raíz
// ═════════════════════════════════════════════════════════════
// -- estilos compartidos del panel de carga masiva --
const _bulkLbl = {
  display: "block", font: "600 10px/1.3 var(--font-body)", color: MUTED,
  textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4,
};
const _bulkInp = {
  width: "100%", padding: "7px 9px", border: "1px solid #E5E7EB",
  borderRadius: 7, font: "500 12.5px/1 var(--font-body)", color: NAVY,
  background: "#FFFFFF", outline: "none", boxSizing: "border-box",
};

// -------------------------------------------------------------
// BulkPriceUploadPanel - Sprint 2026-07-16
// Sube el Excel COMEX UNA vez a nivel de marca. Parsea client-side y
// genera+guarda la matriz de precios para TODOS los clientes activos,
// aplicando la comision pactada de cada uno. Usa el endpoint bulk
// (save-simulation-bulk) que persiste el snapshot por cliente y upserta
// su asignacion (BCPA) con la metadata del archivo + vigencia.
// -------------------------------------------------------------
function BulkPriceUploadPanel({ brandId, clients, lang = "es", onDone }) {
  const [file, setFile]             = useState(null);
  const [parsing, setParsing]       = useState(false);
  const [parsedSkus, setParsedSkus] = useState([]);
  const [error, setError]           = useState(null);
  const _today = new Date().toISOString().slice(0, 10);
  const [fechaInicio, setFechaInicio]     = useState(_today);
  const [fechaFin, setFechaFin]           = useState("");
  const [fechaFinIndef, setFechaFinIndef] = useState(true);
  const [anchorBandaId, setAnchorBandaId] = useState(1);
  const [anchorPlazoDias, setAnchorPlazoDias] = useState(90);
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState(null);
  const fileInputRef = useRef(null);

  const activeClients = useMemo(
    () => (clients || []).filter(
      (c) => String(c.estado || "ACTIVO").toUpperCase() === "ACTIVO"),
    [clients],
  );

  const handleFile = async (f) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name || "")) {
      setError(lang === "es" ? "Formato no soportado. Usa .xlsx o .xls." : "Unsupported format.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError(lang === "es" ? "Maximo 15 MB." : "Max 15 MB.");
      return;
    }
    setError(null); setResult(null); setFile(f); setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseExcelMarluvas(buf, { XLSX });
      if (!parsed.length) {
        setError(lang === "es"
          ? "No se detectaron SKUs Marluvas (7xxxxx / 8xxxxx) en el Excel."
          : "No Marluvas SKUs detected.");
        setParsedSkus([]);
      } else {
        setParsedSkus(parsed);
      }
    } catch (e) {
      setError((lang === "es" ? "Error parseando Excel: " : "Excel parse error: ") + (e?.message || ""));
      setParsedSkus([]);
    } finally {
      setParsing(false);
    }
  };

  const generate = async () => {
    if (!parsedSkus.length || !activeClients.length || running) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const anchor = { bandaId: Number(anchorBandaId), plazoDias: Number(anchorPlazoDias) };
      const clientsPayload = activeClients.map((c) => {
        const com = c.comision_pct != null ? Number(c.comision_pct) * 100 : 0;
        const skusState = parsedSkus.map((p) => defaultSkuState(p, { com }));
        const skus = buildSimSkusPayload(skusState, anchor, null);
        return {
          cliente_id: c.cliente_id,
          notas: `[Marluvas v7 bulk - ${parsedSkus.length} SKUs - com ${com}%]`,
          skus,
        };
      });
      const body = {
        brand_id:        brandId,
        fecha_inicio:    fechaInicio || null,
        fecha_fin:       fechaFinIndef ? null : (fechaFin || null),
        banda_vigente_id: Number(anchorBandaId),
        file_name:       file?.name || null,
        file_size_bytes: file?.size || null,
        clients:         clientsPayload,
      };
      const resp = await apiFetch("/commercial/marluvas/save-simulation-bulk/", {
        method: "POST", body, token: getToken(),
      });
      setResult(resp || { saved_clients: clientsPayload.length });
      if (Array.isArray(resp?.results)) {
        const failed = resp.results.filter((r) => r && r.ok === false);
        if (failed.length) console.warn("[BulkPriceUpload] clientes con error:", failed);
      }
      if (typeof onDone === "function") onDone();
    } catch (e) {
      setError(String(e?.body?.detail || e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const btnDisabled = !parsedSkus.length || !activeClients.length || running;

  return (
    <div style={{
      background: "#FFFFFF", border: `1px solid ${MINT}44`,
      borderRadius: 12, padding: 18, boxShadow: "0 1px 2px rgba(11,30,58,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: `${MINT}18`,
          display: "grid", placeItems: "center", color: MINT, flexShrink: 0,
        }}>
          <IconDollar size={17}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY }}>
            {lang === "es" ? "Carga masiva de precios - todos los clientes" : "Bulk price upload - all clients"}
          </div>
          <div style={{ font: "500 12px/1.4 var(--font-body)", color: MUTED, marginTop: 2 }}>
            {lang === "es"
              ? "Sube el Excel COMEX una sola vez. Se generan y guardan los precios para cada cliente activo usando su comision pactada."
              : "Upload the COMEX Excel once. Prices are generated and saved for every active client using its agreed commission."}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? MINT : "#E5E7EB"}`,
            background: file ? `${MINT}08` : SOFT,
            borderRadius: 10, padding: 20, textAlign: "center",
            cursor: parsing ? "wait" : "pointer", transition: "all 160ms ease",
          }}
        >
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden
                 onChange={(e) => handleFile(e.target.files?.[0])}/>
          {parsing ? (
            <div style={{ color: MUTED, font: "500 12px/1.3 var(--font-body)" }}>
              {lang === "es" ? "Procesando Excel..." : "Parsing Excel..."}
            </div>
          ) : file ? (
            <div>
              <IconCheck size={20} style={{ color: MINT, marginBottom: 6 }}/>
              <div style={{ font: "700 13px/1.2 var(--font-body)", color: NAVY }}>{file.name}</div>
              <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: MUTED, marginTop: 3 }}>
                {(file.size / 1024).toFixed(1)} KB - {parsedSkus.length} SKUs
              </div>
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null); setParsedSkus([]); setResult(null); }}
                style={{
                  marginTop: 8, padding: "3px 9px", border: "1px solid #E5E7EB",
                  background: "#FFFFFF", color: MUTED, borderRadius: 6, cursor: "pointer",
                  font: "500 10.5px/1 var(--font-body)",
                }}>
                {lang === "es" ? "Cambiar archivo" : "Change file"}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ font: "700 20px/1 var(--font-body)", color: MUTED, marginBottom: 6 }}>&#8593;</div>
              <div style={{ font: "700 13px/1.2 var(--font-body)", color: NAVY }}>
                {lang === "es" ? "Arrastra el Excel o click" : "Drag the Excel or click"}
              </div>
              <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: MUTED, marginTop: 3 }}>
                .xlsx - .xls - max 15 MB
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={_bulkLbl}>{lang === "es" ? "Vigencia - inicio" : "Validity - start"}</label>
            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} style={_bulkInp}/>
          </div>
          <div>
            <label style={_bulkLbl}>{lang === "es" ? "Vigencia - fin" : "Validity - end"}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="date" value={fechaFin} disabled={fechaFinIndef}
                     onChange={(e) => setFechaFin(e.target.value)}
                     style={{ ..._bulkInp, opacity: fechaFinIndef ? 0.45 : 1 }}/>
              <button type="button"
                onClick={() => { const n = !fechaFinIndef; setFechaFinIndef(n); if (n) setFechaFin(""); }}
                style={{
                  padding: "0 10px", borderRadius: 6, whiteSpace: "nowrap", cursor: "pointer",
                  border: `1.5px solid ${fechaFinIndef ? MINT : "#E5E7EB"}`,
                  background: fechaFinIndef ? `${MINT}10` : "#FFFFFF",
                  color: fechaFinIndef ? MINT : INK, font: "600 11px/1 var(--font-body)",
                }}>
                {lang === "es" ? "Indef." : "Indef."}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={_bulkLbl}>{lang === "es" ? "Ancla - banda" : "Anchor - band"}</label>
              <select value={anchorBandaId} onChange={(e) => setAnchorBandaId(Number(e.target.value))} style={_bulkInp}>
                {BANDAS_MARLUVAS.map((b) => (
                  <option key={b.id} value={b.id}>#{b.id} - {b.rango}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={_bulkLbl}>{lang === "es" ? "Ancla - plazo" : "Anchor - term"}</label>
              <select value={anchorPlazoDias} onChange={(e) => setAnchorPlazoDias(Number(e.target.value))} style={_bulkInp}>
                {PLAZOS_MARLUVAS.map((p) => (
                  <option key={p.dias} value={p.dias}>{p.dias}d</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: "9px 12px", borderRadius: 8,
          background: `${RED}10`, border: `1px solid ${RED}55`, color: "#7F1D1D",
          font: "500 12px/1.4 var(--font-body)", display: "flex", alignItems: "center", gap: 6,
        }}>
          <IconAlert size={13}/>{error}
        </div>
      )}

      {result && (
        <div style={{
          marginTop: 12, padding: "9px 12px", borderRadius: 8,
          background: `${MINT}12`, border: `1px solid ${MINT}55`, color: "#065F46",
          font: "500 12px/1.4 var(--font-body)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        }}>
          <IconCheck size={13}/>
          {lang === "es"
            ? `Precios generados para ${result.saved_clients ?? 0} de ${result.total_clients ?? activeClients.length} clientes activos.`
            : `Prices generated for ${result.saved_clients ?? 0} of ${result.total_clients ?? activeClients.length} active clients.`}
          {Array.isArray(result.results) && result.results.some((r) => r && r.ok === false) && (
            <span style={{ color: AMBER }}>
              {lang === "es" ? "- algunos fallaron (ver consola)" : "- some failed (see console)"}
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ font: "500 12px/1.4 var(--font-body)", color: MUTED }}>
          {parsedSkus.length > 0
            ? (lang === "es"
                ? `${parsedSkus.length} SKUs x ${activeClients.length} clientes activos - cada uno con su comision`
                : `${parsedSkus.length} SKUs x ${activeClients.length} active clients - each with its commission`)
            : (lang === "es" ? "Sube un Excel para empezar." : "Upload an Excel to start.")}
        </div>
        <button type="button" onClick={generate} disabled={btnDisabled}
          style={{
            padding: "9px 18px", borderRadius: 9, border: "none",
            background: btnDisabled ? "#CBD5E1" : MINT, color: "#FFFFFF",
            font: "700 13px/1 var(--font-body)",
            cursor: btnDisabled ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 7,
          }}>
          {running
            ? (lang === "es" ? "Generando..." : "Generating...")
            : (lang === "es" ? `Generar para ${activeClients.length} clientes activos` : `Generate for ${activeClients.length} active clients`)}
        </button>
      </div>
    </div>
  );
}


export default function BrandPricingConsole({ brandId, lang = "es" }) {
  const { isAdmin } = useRole();
  const navigate = useNavigate();

  const [query,   setQuery]   = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Clientes reales del backend con asignaciones de pricing por marca.
  // Endpoint: GET /api/commercial/brands/<brandId>/clients_summary/
  // Fallback al mock CLIENTS solo si backend falla o devuelve vacío
  // (preserva la experiencia de demos sin BD seedeada).
  const [clients, setClients] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!brandId) { setClients([]); return; }
    setLoading(true);
    apiFetch(`/commercial/brands/${brandId}/clients_summary/`, { token: getToken() })
      .then(rows => {
        if (cancelled) return;
        // El backend devuelve {brand_id, is_admin, count, clients: [...]}
        // pero también soportamos respuesta directa como array por compatibilidad.
        const list = Array.isArray(rows)
          ? rows
          : (Array.isArray(rows?.clients) ? rows.clients : []);
        const real = sortClientsHierarchy(list.map(adaptClientSummary));
        if (real.length > 0) setClients(real);
        else setClients(CLIENTS.map(c => ({
          cliente_id:        c.id || c.uuid,
          razon_social:      c.razon_social || c.cliente || c.name,
          nombre_comercial:  c.nombre_comercial || c.name,
          pais_iso2:         (c.country_code || c.pais_iso2 || "").toUpperCase(),
          flag:              c.flag,
          canal:             (c.canal || "DISTRIBUIDOR").toUpperCase(),
          estado:            (c.estado || "ACTIVO").toUpperCase(),
          dias_credito:      c.credito_dias ?? c.dias_credito ?? 0,
          credito_limit_usd: c.credito_limit_usd ?? c.credito_limit ?? c.credito_aprobado ?? 0,
          comision_pct:      c.comision_pct ?? null,
          assignment:        null,
        })));
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[BrandPricingConsole] clients_summary failed, fallback al mock:', err);
        setClients(CLIENTS.map(c => ({
          cliente_id:        c.id || c.uuid,
          razon_social:      c.razon_social || c.cliente || c.name,
          nombre_comercial:  c.nombre_comercial || c.name,
          pais_iso2:         (c.country_code || c.pais_iso2 || "").toUpperCase(),
          flag:              c.flag,
          canal:             (c.canal || "DISTRIBUIDOR").toUpperCase(),
          estado:            (c.estado || "ACTIVO").toUpperCase(),
          dias_credito:      c.credito_dias ?? c.dias_credito ?? 0,
          credito_limit_usd: c.credito_limit_usd ?? c.credito_limit ?? c.credito_aprobado ?? 0,
          comision_pct:      c.comision_pct ?? null,
          assignment:        null,
        })));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brandId, reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      (c.razon_social || "").toLowerCase().includes(q)
      || (c.nombre_comercial || "").toLowerCase().includes(q)
      || (c.pais_iso2 || "").toLowerCase().includes(q),
    );
  }, [clients, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Sub-tab bar mantenida para no alterar el resto del BrandDetail */}
      <div style={{
        display: "flex", gap: 4, padding: 4,
        background: SOFT, borderRadius: 10, border: "1px solid #E5E7EB",
      }}>
        <div role="tab" aria-selected="true" style={{
          flex: 1, display: "inline-flex", alignItems: "center",
          justifyContent: "center", gap: 6,
          padding: "8px 10px",
          background: "#FFFFFF", color: NAVY,
          font: "700 12.5px/1 var(--font-body)",
          borderRadius: 8, boxShadow: "0 1px 2px rgba(11,30,58,0.08)",
        }}>
          <IconDollar size={13}/>
          <span>{lang === "es" ? "Listas de Precios" : "Price Lists"}</span>
        </div>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ font: "700 15px/1.1 var(--font-body)", color: NAVY }}>
            {lang === "es" ? "Precios por cliente" : "Pricing per client"}
          </div>
          <div style={{ font: "500 12px/1.4 var(--font-body)", color: MUTED, marginTop: 2 }}>
            {lang === "es"
              ? `Selecciona un cliente para asignar/actualizar su lista de precios, descuentos y vigencia.`
              : "Select a client to assign/update its price list, discounts and validity."}
            {!isAdmin && (
              <span style={{ marginLeft: 8, color: RED, display: "inline-flex",
                alignItems: "center", gap: 4 }}>
                <IconLock size={11}/>
                {lang === "es"
                  ? "Límite y comisión ocultos · role no-admin."
                  : "Credit limit and commission hidden · non-admin role."}
              </span>
            )}
          </div>
        </div>

        {/* Buscador */}
        <div style={{ position: "relative", minWidth: 260 }}>
          <IconSearch size={13} style={{
            position: "absolute", left: 10, top: "50%",
            transform: "translateY(-50%)", color: MUTED, pointerEvents: "none",
          }}/>
          <input
            type="text"
            placeholder={lang === "es" ? "Buscar cliente…" : "Search client…"}
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: "100%", padding: "8px 10px 8px 30px",
              border: "1px solid #E5E7EB", borderRadius: 8,
              font: "500 13px/1 var(--font-body)", color: NAVY,
              background: "#FFFFFF", outline: "none",
            }}
          />
        </div>
      </div>

      {isAdmin && (
        <BulkPriceUploadPanel
          brandId={brandId}
          clients={clients}
          lang={lang}
          onDone={() => setReloadKey((k) => k + 1)}
        />
      )}

            {/* Grid de cards */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 40, textAlign: "center",
          background: SOFT, borderRadius: 10, border: "1px dashed #E5E7EB",
          color: MUTED, font: "500 13px/1.4 var(--font-body)",
        }}>
          <IconUser size={22} style={{ opacity: 0.4, marginBottom: 8 }}/>
          <div>{lang === "es"
            ? "No hay clientes que coincidan con la búsqueda."
            : "No clients match the search."}
          </div>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}>
          {filtered.map((c, i) => (
            <ClientPricingCard
              key={c.cliente_id}
              client={c}
              lang={lang}
              isAdmin={isAdmin}
              index={i}
              onOpen={() => navigate(`/marcas/${brandId}/clientes/${c.cliente_id}/precios`)}
              onEdit={() => navigate(`/clientes/${c.cliente_id}/editar`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Card individual
// ═════════════════════════════════════════════════════════════
function ClientPricingCard({ client, lang, isAdmin, onOpen, onEdit, index = 0 }) {
  const meta = COUNTRY_META[client.pais_iso2] || { flag: "🌐", label: client.pais_iso2 };
  const estadoStyle = ESTADO_COLORS[client.estado] || ESTADO_COLORS.ACTIVO;
  const hasAssignment = !!client.assignment;
  const isSubsidiary = !!client.parent_id;

  const comisionPctNum = client.comision_pct != null ? Number(client.comision_pct) * 100 : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.3) }}
      whileHover={{ y: -3, boxShadow: "0 10px 24px -12px rgba(11,30,58,0.20)" }}
      onClick={onOpen}
      role="button" tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && onOpen()}
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        // Subsidiarias: borde izquierdo Mint + sangria.
        borderLeft: isSubsidiary ? `4px solid ${MINT}` : "1px solid #E5E7EB",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex", flexDirection: "column",
        transition: "box-shadow 160ms ease, transform 160ms ease",
        marginLeft: isSubsidiary ? 18 : 0,
      }}
    >
      {/* Header con nombre + lapiz (chip de pais removido a pedido del CEO) */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            font: "700 14px/1.2 var(--font-body)", color: NAVY,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {isSubsidiary && (
              <span style={{ color: MINT, fontWeight: 800 }} title="Subsidiaria">↳</span>
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {client.razon_social}
            </span>
          </div>
          {isSubsidiary && client.parent_name && (
            <div style={{
              font: "600 10px/1.3 var(--font-body)", color: MINT,
              marginTop: 1, letterSpacing: 0.2,
            }}>
              {lang === "es" ? "Hija de " : "Child of "}{client.parent_name}
            </div>
          )}
          <div style={{
            font: "500 11px/1.3 var(--font-body)", color: MUTED,
            marginTop: 2,
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          }}>
            <span>{client.canal}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{meta.label}</span>
            <span style={{
              marginLeft: 2,
              padding: "2px 7px",
              background: estadoStyle.bg,
              color: estadoStyle.color,
              borderRadius: 10,
              font: "700 9.5px/1 var(--font-body)",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: 3,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: estadoStyle.dot,
              }}/>
              {client.estado}
            </span>
          </div>
        </div>

        {/* Botón lápiz — esquina superior derecha */}
        <motion.button type="button"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          onClick={e => { e.stopPropagation(); onEdit(); }}
          title={lang === "es" ? "Editar datos del cliente" : "Edit client details"}
          aria-label={lang === "es" ? "Editar cliente" : "Edit client"}
          style={{
            background: SOFT,
            border: "1px solid #E5E7EB",
            color: NAVY,
            borderRadius: 8,
            width: 32, height: 32,
            display: "grid", placeItems: "center",
            cursor: "pointer", flexShrink: 0,
          }}
        >
          <IconPencil size={13}/>
        </motion.button>
      </div>

      {/* Body · métricas */}
      <div style={{ padding: "4px 16px 14px",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
        {/* Días de crédito */}
        <div>
          <div style={metricLabel}>{lang === "es" ? "Días crédito" : "Credit days"}</div>
          <div style={{ ...metricValue, color: NAVY }}>
            {client.dias_credito ?? 0}d
          </div>
        </div>

        {/* Límite crédito · CEO-ONLY */}
        <div>
          <div style={metricLabel}>
            {lang === "es" ? "Límite crédito" : "Credit limit"}
            {isAdmin && <IconLock size={8} style={{ marginLeft: 4, color: RED, opacity: 0.6 }}/>}
          </div>
          {isAdmin ? (
            <div style={{ ...metricValue, color: MINT, fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(client.credito_limit_usd)}
            </div>
          ) : (
            <div style={{ ...metricValue, color: "#CBD5E1",
              letterSpacing: 2, fontSize: 14 }}>
              • • •
            </div>
          )}
        </div>

        {/* Comisión pactada · CEO-ONLY · full row */}
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ ...metricLabel, display: "flex", alignItems: "center",
            justifyContent: "space-between" }}>
            <span>
              {lang === "es" ? "Comisión pactada" : "Agreed commission"}
              {isAdmin && <IconLock size={8} style={{ marginLeft: 4, color: RED, opacity: 0.6 }}/>}
            </span>
            {isAdmin && comisionPctNum != null && (
              <span style={{
                color: commissionColor(comisionPctNum),
                fontVariantNumeric: "tabular-nums",
                font: "700 12px/1 var(--font-body)",
              }}>
                {comisionPctNum.toFixed(2)}%
              </span>
            )}
          </div>
          {isAdmin && comisionPctNum != null ? (
            <div style={{
              marginTop: 5, height: 6, borderRadius: 999,
              background: "#E5E7EB", overflow: "hidden",
            }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (comisionPctNum / 30) * 100)}%` }}
                transition={{ duration: 0.5, delay: 0.1 }}
                style={{
                  height: "100%",
                  background: commissionColor(comisionPctNum),
                }}
              />
            </div>
          ) : !isAdmin ? (
            <div style={{ marginTop: 5, color: "#CBD5E1",
              letterSpacing: 2, font: "700 14px/1 var(--font-body)" }}>
              • • •
            </div>
          ) : (
            <div style={{ marginTop: 4, font: "500 11px/1 var(--font-body)", color: MUTED }}>
              {lang === "es" ? "Sin comisión definida" : "No commission defined"}
            </div>
          )}
        </div>
      </div>

      {/* Footer · estado de asignación */}
      <div style={{
        padding: "10px 16px",
        background: hasAssignment ? `${MINT}08` : SOFT,
        borderTop: "1px solid #E5E7EB",
        display: "flex", alignItems: "center", gap: 6,
        font: "600 11px/1.3 var(--font-body)",
        color: hasAssignment ? MINT : MUTED,
      }}>
        {hasAssignment ? (
          <>
            <IconCheck size={12}/>
            <span>
              {lang === "es" ? "Precios asignados" : "Prices assigned"}
              {client.assignment?.fecha_fin && (
                <span style={{ color: MUTED, fontWeight: 500, marginLeft: 6 }}>
                  · {lang === "es" ? "hasta" : "until"} {client.assignment.fecha_fin}
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <IconAlert size={12} style={{ opacity: 0.7 }}/>
            <span>{lang === "es" ? "Sin precios asignados — click para configurar" : "No prices assigned — click to configure"}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}


// ═════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════
function commissionColor(pct) {
  if (pct >= 20) return RED;
  if (pct >= 10) return AMBER;
  return MINT;
}

function fmtMoney(n) {
  const v = Number(n || 0);
  if (!v) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " USD";
}

const metricLabel = {
  font: "600 10px/1 var(--font-body)",
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 3,
};

const metricValue = {
  font: "700 15px/1.1 var(--font-body)",
  marginTop: 2,
};
