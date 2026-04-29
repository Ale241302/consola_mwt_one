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
import React, { useEffect, useMemo, useState } from "react";
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
export default function BrandPricingConsole({ brandId, lang = "es" }) {
  const { isAdmin } = useRole();
  const navigate = useNavigate();

  const [query,   setQuery]   = useState("");
  const [loading, setLoading] = useState(false);

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
  }, [brandId]);

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
      {/* Header con bandera + nombre + lapiz */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: SOFT, display: "grid", placeItems: "center",
          font: "28px/1 var(--font-body)", flexShrink: 0,
        }}>
          {meta.flag || (client.flag || "🌐")}
        </div>
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
