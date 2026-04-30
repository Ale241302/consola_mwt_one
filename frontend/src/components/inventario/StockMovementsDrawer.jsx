// =====================================================================
// MWT.ONE · components/inventario/StockMovementsDrawer.jsx
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral que muestra el historial de movimientos para una fila
// de stock identificada por (nodo, producto, lote). Se abre desde la
// columna "Recibido" en /inventario.
//
// Por cada movimiento muestra:
//   · Tipo (RECEPCION verde / TRANSFER azul / SALIDA rojo / AJUSTE gris)
//   · Contexto del nodo:
//       - RECEPCION  → "Recibido en {nodo destino}"
//       - TRANSFER   → "{nodo origen} → {nodo destino}"
//       - SALIDA     → "Salida desde {nodo origen}"
//       - AJUSTE     → "Ajuste en {nodo}"
//   · Cantidad · Costo unitario USD · Notas · Fecha
//   · Link a recepción / transfer / expediente si referencia_id está
//
// Sin FK físicas — los nombres de nodo se resuelven con nodosApi.list().
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { movimientosApi, nodosApi } from "../../lib/api.js";

// ── Tokens MWT ─────────────────────────────────────────────
const NAVY    = "#0B1E3A";
const MINT    = "#00B286";
const VIOLET  = "#481EE3";
const BLUE    = "#3083FE";
const AMBER   = "#B45309";
const RED     = "#DC2626";
const GREY    = "#6B7280";

// Mapa visual por tipo de movimiento.
const TIPO_META = {
  RECEPCION: { color: MINT,   label: "Recepción",  arrow: "↓" },
  TRANSFER:  { color: BLUE,   label: "Transfer",   arrow: "→" },
  ENTRADA:   { color: MINT,   label: "Entrada",    arrow: "↓" },
  SALIDA:    { color: RED,    label: "Salida",     arrow: "↑" },
  AJUSTE:    { color: VIOLET, label: "Ajuste",     arrow: "±" },
  MERMA:     { color: RED,    label: "Merma",      arrow: "↓" },
  RETORNO:   { color: AMBER,  label: "Retorno",    arrow: "↺" },
  RESERVA:   { color: AMBER,  label: "Reserva",    arrow: "•" },
  LIBERA:    { color: GREY,   label: "Libera",     arrow: "•" },
};

function fmtDate(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(s).slice(0, 16); }
}

export default function StockMovementsDrawer({ lang = "es", row, onClose }) {
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);
  const [movs, setMovs]         = useState([]);
  const [nodeMap, setNodeMap]   = useState({});
  const [err, setErr]           = useState(null);

  // ── Carga inicial: movimientos + nodos para resolver nombres ────
  useEffect(() => {
    if (!row) return;
    let alive = true;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        // El backend acepta filter por producto + lote (sprint 2026-04-30).
        // El nodo se filtra client-side porque queremos OR entre origen/destino.
        const params = { limit: 500 };
        if (row.productId) params.producto = row.productId;
        if (row.lot && row.lot !== "—") params.lote = row.lot;
        const [movRes, nodoRes] = await Promise.all([
          movimientosApi.list(params).catch(() => []),
          nodosApi.list().catch(() => []),
        ]);
        if (!alive) return;

        const movItems = Array.isArray(movRes) ? movRes : (movRes?.results || []);
        const nodoItems = Array.isArray(nodoRes) ? nodoRes : (nodoRes?.results || []);

        // Mapa id → {codigo, nombre} para resolver origen/destino.
        const nm = {};
        nodoItems.forEach(n => {
          nm[String(n.id)] = {
            codigo: n.codigo || "",
            nombre: n.nombre || n.codigo || "—",
          };
        });
        if (alive) setNodeMap(nm);

        // Filtro: lote igual + el nodo de la fila aparece como origen
        // o destino. Así obtenemos: la RECEPCION que creó el lote, y
        // todas las TRANSFERs que entraron o salieron de ese nodo.
        const wantLote = (row.lot || "").trim();
        const wantNode = String(row.nodeId || "");
        const filtered = movItems.filter(m => {
          const lote = (m.lote || "").trim();
          if (lote !== wantLote) return false;
          if (!wantNode) return true;
          return String(m.nodo_origen_id || "") === wantNode
              || String(m.nodo_destino_id || "") === wantNode;
        });

        // Orden descendente por fecha.
        filtered.sort((a, b) => {
          const da = new Date(a.created_at || 0).getTime();
          const db = new Date(b.created_at || 0).getTime();
          return db - da;
        });

        if (alive) setMovs(filtered);
      } catch (e) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [row]);

  // ── Utilidades de render ────────────────────────────────
  const resolveNode = (id) => {
    if (!id) return null;
    const n = nodeMap[String(id)];
    if (!n) return { codigo: String(id).slice(0, 6), nombre: "—" };
    return n;
  };

  // Línea de contexto del nodo según tipo de movimiento.
  function NodeContextLine({ m }) {
    const tipo = (m.tipo || "").toUpperCase();
    const origen  = resolveNode(m.nodo_origen_id);
    const destino = resolveNode(m.nodo_destino_id);

    const wrapper = {
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 13, color: NAVY, marginTop: 4,
    };
    const chip = (label, color) => (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 999,
        background: `${color}14`, color, border: `1px solid ${color}33`,
        fontSize: 11.5, fontWeight: 600,
      }}>{label}</span>
    );
    const arrow = (
      <span style={{ color: GREY, fontWeight: 700 }}>→</span>
    );

    if (tipo === "RECEPCION" || tipo === "ENTRADA") {
      return (
        <div style={wrapper}>
          <span style={{ color: GREY, fontSize: 11 }}>
            {lang === "es" ? "Recibido en" : "Received at"}
          </span>
          {chip(destino?.nombre || "—", MINT)}
        </div>
      );
    }
    if (tipo === "TRANSFER") {
      return (
        <div style={wrapper}>
          {chip(origen?.nombre || "—", BLUE)}
          {arrow}
          {chip(destino?.nombre || "—", MINT)}
        </div>
      );
    }
    if (tipo === "SALIDA") {
      return (
        <div style={wrapper}>
          <span style={{ color: GREY, fontSize: 11 }}>
            {lang === "es" ? "Salida desde" : "Out from"}
          </span>
          {chip(origen?.nombre || "—", RED)}
        </div>
      );
    }
    if (tipo === "AJUSTE") {
      return (
        <div style={wrapper}>
          <span style={{ color: GREY, fontSize: 11 }}>
            {lang === "es" ? "Ajuste en" : "Adjusted at"}
          </span>
          {chip((destino?.nombre || origen?.nombre || "—"), VIOLET)}
        </div>
      );
    }
    return (
      <div style={wrapper}>
        {origen && chip(origen.nombre, GREY)}
        {origen && destino && arrow}
        {destino && chip(destino.nombre, GREY)}
      </div>
    );
  }

  // Link a la entidad referenciada por el movimiento (recepcion / transfer)
  function ReferenceLink({ m }) {
    const tipoRef = (m.referencia_tipo || "").toUpperCase();
    const id      = m.referencia_id;
    if (!id) return null;
    let label = null;
    let go = null;
    if (tipoRef === "RECEPCION") {
      label = lang === "es" ? "Ver recepción" : "View reception";
      // (cuando exista ruta dedicada → /inventario/recepcion/:id)
      go = () => navigate(`/inventario/recepcion?id=${id}`);
    } else if (tipoRef === "TRANSFER" || tipoRef === "TRANSFERENCIA") {
      label = lang === "es" ? "Ver transferencia" : "View transfer";
      go = () => navigate(`/transferencias/${id}`);
    } else if (tipoRef === "EXPEDIENTE") {
      label = lang === "es" ? "Ver expediente" : "View file";
      go = () => navigate(`/expedientes/${id}`);
    } else {
      return null;
    }
    return (
      <button
        type="button"
        onClick={go}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: "transparent", border: "none",
          color: VIOLET, fontSize: 11.5, fontWeight: 600,
          cursor: "pointer", padding: 0, marginTop: 6,
        }}
      >
        {label} ↗
      </button>
    );
  }

  if (!row) return null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 199,
          background: "rgba(11,30,58,0.42)",
        }}
      />
      {/* Drawer */}
      <motion.aside
        initial={{ x: 480, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 240 }}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 200,
          width: "min(560px, 100vw)",
          background: "#fff",
          borderLeft: "1px solid var(--border-soft, rgba(11,30,58,0.10))",
          boxShadow: "0 24px 60px -20px rgba(11,30,58,0.30)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          background: `linear-gradient(135deg, ${NAVY} 0%, #1a2f54 100%)`,
          color: "#fff",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
                color: "rgba(255,255,255,0.62)", marginBottom: 6, fontWeight: 600,
              }}>
                {lang === "es" ? "DETALLE DEL LOTE" : "LOT DETAIL"}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700, lineHeight: 1.25,
              }}>
                {row.product || row.sku}
              </div>
              <div style={{
                marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap",
                fontFamily: "var(--font-mono)", fontSize: 11.5,
              }}>
                <span style={{
                  padding: "3px 10px", borderRadius: 999,
                  background: "rgba(0,178,134,0.20)", color: "#7ee5c0",
                  fontWeight: 600,
                }}>{row.sku}</span>
                {row.size && (
                  <span style={{
                    padding: "3px 10px", borderRadius: 999,
                    background: "rgba(72,30,227,0.30)", color: "#cfc1ff",
                    fontWeight: 700,
                  }}>{row.size}</span>
                )}
                <span style={{
                  padding: "3px 10px", borderRadius: 999,
                  background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.86)",
                }}>{lang === "es" ? "Lote " : "Lot "}{row.lot}</span>
                <span style={{
                  padding: "3px 10px", borderRadius: 999,
                  background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.86)",
                }}>{row.node}</span>
              </div>
            </div>
            <button
              type="button" onClick={onClose}
              aria-label={lang === "es" ? "Cerrar" : "Close"}
              style={{
                background: "rgba(255,255,255,0.10)", border: "none",
                color: "#fff", borderRadius: 8,
                width: 32, height: 32, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18,
              }}
            >×</button>
          </div>

          {/* KPIs del lote */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12, marginTop: 16,
          }}>
            <KpiTile label={lang === "es" ? "Stock" : "Stock"}
                     value={(row.qty || 0).toLocaleString()} />
            <KpiTile label={lang === "es" ? "Reservado" : "Reserved"}
                     value={(row.reserved || 0).toLocaleString()}
                     accent="#fbbf24" />
            <KpiTile label={lang === "es" ? "Disponible" : "Available"}
                     value={((row.qty || 0) - (row.reserved || 0)).toLocaleString()}
                     accent="#7ee5c0" />
          </div>
        </div>

        {/* Body — timeline de movimientos */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "20px 24px",
          background: "var(--bg-soft, #FAFBFC)",
        }}>
          <div style={{
            fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
            color: GREY, fontWeight: 600, marginBottom: 12,
          }}>
            {lang === "es" ? "Historial de movimientos" : "Movement history"}
            <span style={{ marginLeft: 8, color: NAVY }}>· {movs.length}</span>
          </div>

          {loading && (
            <div style={{ color: GREY, fontSize: 13, padding: 24, textAlign: "center" }}>
              {lang === "es" ? "Cargando movimientos…" : "Loading movements…"}
            </div>
          )}

          {!loading && err && (
            <div style={{
              padding: 12, borderRadius: 8,
              background: "rgba(220,38,38,0.08)", color: RED, fontSize: 13,
            }}>
              {err}
            </div>
          )}

          {!loading && !err && movs.length === 0 && (
            <div style={{
              padding: 24, textAlign: "center", color: GREY,
              fontSize: 13, border: "1px dashed rgba(11,30,58,0.18)",
              borderRadius: 10, background: "#fff",
            }}>
              {lang === "es"
                ? "Sin movimientos registrados para este lote en este nodo."
                : "No movements recorded for this lot at this node."}
            </div>
          )}

          {!loading && !err && movs.map((m, idx) => {
            const tipo = (m.tipo || "").toUpperCase();
            const meta = TIPO_META[tipo] || { color: GREY, label: tipo, arrow: "•" };
            const tipoNode = String(m.nodo_destino_id || "") === String(row.nodeId)
              ? "DESTINO" : "ORIGEN";
            const sign = (tipo === "RECEPCION" || tipo === "ENTRADA"
                          || (tipo === "TRANSFER" && tipoNode === "DESTINO"))
              ? "+" : (tipo === "SALIDA" || (tipo === "TRANSFER" && tipoNode === "ORIGEN"))
                       ? "−" : "±";
            return (
              <div
                key={m.id || idx}
                style={{
                  position: "relative",
                  background: "#fff",
                  border: "1px solid rgba(11,30,58,0.08)",
                  borderRadius: 10,
                  padding: "12px 14px 12px 18px",
                  marginBottom: 10,
                  // Borde izquierdo del color del tipo
                  boxShadow: `inset 4px 0 0 0 ${meta.color}`,
                }}
              >
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Tipo + motivo */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      flexWrap: "wrap",
                    }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "3px 10px", borderRadius: 999,
                        background: `${meta.color}14`, color: meta.color,
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                      }}>
                        <span>{meta.arrow}</span>
                        {meta.label.toUpperCase()}
                      </span>
                      {m.motivo && (
                        <span style={{
                          fontSize: 11, color: GREY, fontFamily: "var(--font-mono)",
                        }}>{m.motivo}</span>
                      )}
                    </div>

                    {/* Contexto del nodo */}
                    <NodeContextLine m={m} />

                    {/* Notas */}
                    {m.notas && (
                      <div style={{
                        marginTop: 6, fontSize: 12, color: NAVY,
                        background: "rgba(11,30,58,0.04)", padding: "6px 8px",
                        borderRadius: 6,
                      }}>
                        {m.notas}
                      </div>
                    )}

                    <ReferenceLink m={m} />
                  </div>

                  {/* Cantidad + costo + fecha (lado derecho) */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{
                      fontSize: 18, fontWeight: 700, color: meta.color,
                      fontFamily: "var(--font-mono)",
                    }}>
                      {sign}{Math.abs(Number(m.cantidad || 0)).toLocaleString()}
                    </div>
                    {Number(m.costo_unitario_usd || 0) > 0 && (
                      <div style={{
                        fontSize: 11, color: GREY,
                        fontFamily: "var(--font-mono)", marginTop: 2,
                      }}>
                        ${Number(m.costo_unitario_usd).toFixed(2)} / u
                      </div>
                    )}
                    <div style={{
                      fontSize: 10.5, color: GREY, marginTop: 4,
                    }}>
                      {fmtDate(m.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.aside>
    </>
  );
}

// ── Sub-component: KPI tile dentro del header del drawer ─────────
function KpiTile({ label, value, accent }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8,
      padding: "8px 10px",
    }}>
      <div style={{
        fontSize: 10, color: "rgba(255,255,255,0.62)",
        textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontSize: 17, fontWeight: 700, color: accent || "#fff",
        fontFamily: "var(--font-mono)", marginTop: 2,
      }}>{value}</div>
    </div>
  );
}
