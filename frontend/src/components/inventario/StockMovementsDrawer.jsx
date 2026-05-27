// =====================================================================
// MWT.ONE · components/inventario/StockMovementsDrawer.jsx
// Agente responsable: [AG-FRONTEND]
//
// Drawer "Detalle del lote" — abierto desde la columna "Recibido" en
// /inventario. Muestra la recepción que creó la fila de stock con la
// misma riqueza que el Step 3 del wizard de inbound:
//
//   1. Header navy con producto · SKU · talla · lote · nodo · stock KPIs.
//   2. Tarjeta de cabecera de la recepción:
//        · Código (REC-YYYY-NNNN), nodo destino, tipo de origen,
//          referencia, estado, recibido_at, recibido_por.
//        · Documento de soporte (si existe document_artifact_id).
//        · Notas.
//   3. KPIs (Líneas · Productos · Unidades · Valor USD).
//   4. Tabla "Productos por talla":
//        SKU · Producto · Talla · Cantidad · Costo unit. · Total línea.
//   5. Excepciones (gaps con justificación) si has_discrepancy.
//   6. Si NO hay recepción que matche (ajuste manual / transfer), se
//      cae a un estado vacío explicando que esta fila no nació de un
//      packing list / inbound formal.
//
// Endpoint: /api/inventario-recepciones/?nodo=X&producto=Y&lote=Z&talla=T
// El backend devuelve la lista resumida; el detalle completo se pide
// con /api/inventario-recepciones/{id}/.
// =====================================================================
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { recepcionesApi } from "../../lib/api.js";

// ── Tokens MWT ─────────────────────────────────────────────
const NAVY    = "#0B1E3A";
const MINT    = "#00B286";
const VIOLET  = "#481EE3";
const BLUE    = "#3083FE";
const AMBER   = "#B45309";
const RED     = "#DC2626";
const GREY    = "#6B7280";

const SOURCE_LABELS = {
  SUPPLIER_PO:   { es: "Orden de compra a proveedor", en: "Supplier PO",   color: BLUE   },
  TRANSFER_IN:   { es: "Movimiento entrante",      en: "Transfer in",   color: VIOLET },
  BLIND_RECEIPT: { es: "Ajuste ciego (sin documento)",en: "Blind receipt", color: AMBER  },
  RETURN:        { es: "Devolución / RMA",            en: "Return / RMA",  color: GREY   },
};

const ESTADO_LABELS = {
  DRAFT:        { es: "Borrador",   en: "Draft",      color: GREY  },
  RECEIVED:     { es: "Recibido",   en: "Received",   color: MINT  },
  RECONCILED:   { es: "Conciliado", en: "Reconciled", color: BLUE  },
  REJECTED:     { es: "Rechazado",  en: "Rejected",   color: RED   },
  CLOSED:       { es: "Cerrado",    en: "Closed",     color: NAVY  },
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

function fmtMoney(n, currency = "USD") {
  const v = Number(n || 0);
  try {
    return v.toLocaleString(undefined, {
      style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch {
    return `$${v.toFixed(2)} ${currency}`;
  }
}

export default function StockLotDetailDrawer({ lang = "es", row, onClose }) {
  const [loading,   setLoading]   = useState(true);
  const [recepcion, setRecepcion] = useState(null);
  const [err,       setErr]       = useState(null);
  // Reservado para v2: tabs de transferencias entrantes / movimientos manuales.

  // ── Carga: encontrar recepción que matchee (nodo, producto, lote, talla) ─
  useEffect(() => {
    if (!row) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setRecepcion(null);

    (async () => {
      try {
        const params = {};
        if (row.nodeId)    params.nodo     = row.nodeId;
        if (row.productId) params.producto = row.productId;
        if (row.lot && row.lot !== "—") params.lote = row.lot;
        if (row.size)      params.talla    = row.size;

        const list = await recepcionesApi.list(params).catch(() => []);
        const items = Array.isArray(list) ? list : (list?.results || []);
        if (!items.length) {
          if (alive) { setLoading(false); setRecepcion(null); }
          return;
        }
        // Tomamos la más reciente (orden -created_at del backend).
        const head = items[0];
        // Pedimos el detalle completo (cabecera + líneas + excepciones).
        const detail = await recepcionesApi.get(head.id).catch(() => null);
        if (!alive) return;
        setRecepcion(detail || head);
      } catch (e) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [row]);

  if (!row) return null;

  // ── Cálculos derivados (cuando hay recepción) ───────────
  const lines = recepcion?.lines || [];
  const exceptions = recepcion?.exceptions || [];
  const totalUnits   = lines.reduce((a, l) => a + Number(l.received_qty || 0), 0);
  const totalValue   = lines.reduce((a, l) => a + Number(l.line_value_usd || 0), 0);
  const skuCount     = new Set(lines.map(l => l.product_sku)).size;
  const sourceMeta   = SOURCE_LABELS[(recepcion?.source_type || "").toUpperCase()]
                       || { es: recepcion?.source_type, en: recepcion?.source_type, color: GREY };
  const estadoMeta   = ESTADO_LABELS[(recepcion?.estado || "").toUpperCase()]
                       || { es: recepcion?.estado, en: recepcion?.estado, color: GREY };

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
        initial={{ x: 640, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 640, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 240 }}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 200,
          width: "min(720px, 100vw)",
          background: "#fff",
          borderLeft: "1px solid var(--border-soft, rgba(11,30,58,0.10))",
          boxShadow: "0 24px 60px -20px rgba(11,30,58,0.30)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Header navy con stock KPIs ────────────────────── */}
        <Header row={row} lang={lang} onClose={onClose} />

        {/* ── Body con scroll ───────────────────────────────── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "20px 24px 28px",
          background: "var(--bg-soft, #FAFBFC)",
        }}>
          {loading && (
            <div style={{
              padding: 32, textAlign: "center", color: GREY, fontSize: 13,
            }}>
              {lang === "es" ? "Cargando detalle de la recepción…" : "Loading reception detail…"}
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

          {!loading && !err && !recepcion && (
            <EmptyNoRecepcion lang={lang} row={row} />
          )}

          {!loading && !err && recepcion && (
            <>
              {/* Cabecera de la recepción */}
              <Section
                title={lang === "es" ? "Recepción" : "Reception"}
                code={recepcion.codigo}
              >
                <RowKV
                  label={lang === "es" ? "Nodo destino" : "Destination node"}
                  value={recepcion.destination_node_label || "—"}
                />
                <RowKV
                  label={lang === "es" ? "Tipo de origen" : "Source type"}
                  value={
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "2px 10px", borderRadius: 999,
                      background: `${sourceMeta.color}14`, color: sourceMeta.color,
                      fontSize: 12, fontWeight: 600,
                    }}>
                      {lang === "es" ? sourceMeta.es : sourceMeta.en}
                    </span>
                  }
                />
                {recepcion.reference_label && (
                  <RowKV
                    label={lang === "es" ? "Referencia" : "Reference"}
                    value={
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 12.5,
                        color: NAVY, fontWeight: 600,
                      }}>{recepcion.reference_label}</span>
                    }
                  />
                )}
                <RowKV
                  label={lang === "es" ? "Estado" : "Status"}
                  value={
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "2px 10px", borderRadius: 999,
                      background: `${estadoMeta.color}14`, color: estadoMeta.color,
                      fontSize: 12, fontWeight: 600, letterSpacing: 0.4,
                    }}>
                      ✓ {(lang === "es" ? estadoMeta.es : estadoMeta.en)?.toUpperCase()}
                    </span>
                  }
                />
                <RowKV
                  label={lang === "es" ? "Recibido" : "Received at"}
                  value={fmtDate(recepcion.received_at)}
                />
                {recepcion.received_by_name && (
                  <RowKV
                    label={lang === "es" ? "Recibido por" : "Received by"}
                    value={recepcion.received_by_name}
                  />
                )}
                {/* Documento de soporte */}
                {recepcion.document_artifact_id && (
                  <RowKV
                    label={lang === "es" ? "Documento" : "Document"}
                    value={
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        color: VIOLET, fontSize: 12.5, fontWeight: 600,
                      }}>
                        <DocIcon />
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 11,
                        }}>{String(recepcion.document_artifact_id).slice(0, 8)}…</span>
                        {(recepcion.ocr_confidence_avg != null) && (
                          <span style={{
                            marginLeft: 6, padding: "1px 8px", borderRadius: 999,
                            background: "rgba(72,30,227,0.10)", color: VIOLET,
                            fontSize: 10.5, fontWeight: 700,
                          }}>
                            OCR {Number(recepcion.ocr_confidence_avg).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    }
                  />
                )}
                {recepcion.notes && (
                  <RowKV
                    label={lang === "es" ? "Notas" : "Notes"}
                    value={
                      <div style={{
                        fontSize: 12.5, color: NAVY, lineHeight: 1.45,
                        background: "rgba(11,30,58,0.04)",
                        padding: "6px 10px", borderRadius: 6,
                      }}>{recepcion.notes}</div>
                    }
                  />
                )}
              </Section>

              {/* KPIs (líneas, productos, unidades, valor) */}
              <KpiStrip
                tiles={[
                  { label: lang === "es" ? "Líneas" : "Lines",       value: lines.length },
                  { label: lang === "es" ? "Productos" : "Products", value: skuCount },
                  { label: lang === "es" ? "Unidades" : "Units",     value: totalUnits.toLocaleString() },
                  ...(totalValue > 0 ? [{
                    label: lang === "es" ? "Valor USD" : "Value USD",
                    value: fmtMoney(totalValue),
                    accent: MINT,
                  }] : []),
                ]}
              />

              {/* Productos por talla — tabla detallada */}
              <Section title={lang === "es" ? "Productos por talla" : "Products by size"}>
                <LinesTable lines={lines} lang={lang} highlightLote={row.lot} highlightSize={row.size} />
              </Section>

              {/* Excepciones / gaps */}
              {exceptions.length > 0 && (
                <Section
                  title={lang === "es" ? "Excepciones" : "Exceptions"}
                  accent={AMBER}
                >
                  {exceptions.map((e) => (
                    <div key={e.id} style={{
                      padding: "10px 12px", borderRadius: 8, marginBottom: 8,
                      background: "rgba(180,83,9,0.06)",
                      border: "1px solid rgba(180,83,9,0.20)",
                    }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between",
                        alignItems: "center", gap: 8, marginBottom: 4,
                      }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 999,
                          background: AMBER, color: "#fff",
                          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        }}>{e.tipo}</span>
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 12,
                          color: AMBER, fontWeight: 700,
                        }}>
                          {e.delta_qty > 0 ? "+" : ""}{e.delta_qty}
                          <span style={{ color: GREY, fontWeight: 400, marginLeft: 6 }}>
                            ({e.received_qty} / {e.expected_qty})
                          </span>
                        </span>
                      </div>
                      {e.justification && (
                        <div style={{
                          fontSize: 12, color: NAVY,
                          fontStyle: "italic",
                        }}>"{e.justification}"</div>
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </motion.aside>
    </>
  );
}

// =====================================================================
// Sub-componentes
// =====================================================================

function Header({ row, lang, onClose }) {
  return (
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

      {/* KPIs del lote (stock actual) */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12, marginTop: 16,
      }}>
        <KpiTileNavy label={lang === "es" ? "Stock" : "Stock"}
                     value={(row.qty || 0).toLocaleString()} />
        <KpiTileNavy label={lang === "es" ? "Reservado" : "Reserved"}
                     value={(row.reserved || 0).toLocaleString()}
                     accent="#fbbf24" />
        <KpiTileNavy label={lang === "es" ? "Disponible" : "Available"}
                     value={((row.qty || 0) - (row.reserved || 0)).toLocaleString()}
                     accent="#7ee5c0" />
      </div>
    </div>
  );
}

function KpiTileNavy({ label, value, accent }) {
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

function Section({ title, code, accent, children }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid rgba(11,30,58,0.08)",
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 14,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 12,
      }}>
        <div style={{
          fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
          color: accent || GREY, fontWeight: 700,
        }}>{title}</div>
        {code && (
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 12,
            color: NAVY, fontWeight: 700,
          }}>{code}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function RowKV({ label, value }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "140px 1fr",
      gap: 12, padding: "5px 0",
      fontSize: 13, alignItems: "center",
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase",
        color: GREY, fontWeight: 600,
      }}>{label}</div>
      <div style={{ color: NAVY }}>{value}</div>
    </div>
  );
}

function KpiStrip({ tiles }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
      gap: 10, marginBottom: 14,
    }}>
      {tiles.map((t, i) => (
        <div key={i} style={{
          background: "#fff",
          border: "1px solid rgba(11,30,58,0.08)",
          borderRadius: 10,
          padding: "10px 12px",
        }}>
          <div style={{
            fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase",
            color: GREY, fontWeight: 600, marginBottom: 4,
          }}>{t.label}</div>
          <div style={{
            fontSize: 17, fontWeight: 700,
            color: t.accent || NAVY,
            fontFamily: "var(--font-mono)",
          }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

function LinesTable({ lines, lang, highlightLote, highlightSize }) {
  if (!lines.length) {
    return (
      <div style={{ color: GREY, fontSize: 13, padding: 12 }}>
        {lang === "es" ? "Sin líneas registradas." : "No lines recorded."}
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%", borderCollapse: "separate", borderSpacing: 0,
        fontSize: 12.5,
      }}>
        <thead>
          <tr style={{
            color: GREY, fontSize: 10.5, letterSpacing: 0.5,
            textTransform: "uppercase", fontWeight: 700,
            background: "rgba(11,30,58,0.03)",
          }}>
            <th style={th()}>SKU</th>
            <th style={th()}>{lang === "es" ? "Producto" : "Product"}</th>
            <th style={{ ...th(), textAlign: "center" }}>{lang === "es" ? "Talla" : "Size"}</th>
            <th style={{ ...th(), textAlign: "center" }}>{lang === "es" ? "Lote" : "Lot"}</th>
            <th style={{ ...th(), textAlign: "right" }}>{lang === "es" ? "Cantidad" : "Qty"}</th>
            <th style={{ ...th(), textAlign: "right" }}>{lang === "es" ? "Costo" : "Cost"}</th>
            <th style={{ ...th(), textAlign: "right" }}>{lang === "es" ? "Total" : "Total"}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const isHighlight =
              (highlightLote && (l.lote_code || "") === highlightLote) &&
              (!highlightSize || (l.talla || "").toUpperCase() === highlightSize.toUpperCase());
            return (
              <tr key={l.id}
                  style={{
                    background: isHighlight ? "rgba(0,178,134,0.06)" : "transparent",
                    borderTop: "1px solid rgba(11,30,58,0.06)",
                  }}>
                <td style={{ ...td(), fontFamily: "var(--font-mono)", color: VIOLET, fontWeight: 600 }}>
                  {l.product_sku || "—"}
                </td>
                <td style={{ ...td(), color: NAVY }}>{l.product_label || "—"}</td>
                <td style={{ ...td(), textAlign: "center" }}>
                  {l.talla
                    ? <span style={{
                        padding: "2px 8px", borderRadius: 999,
                        background: "rgba(72,30,227,0.10)", color: VIOLET,
                        fontSize: 11, fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                      }}>{l.talla}</span>
                    : <span style={{ color: GREY }}>—</span>}
                </td>
                <td style={{
                  ...td(), textAlign: "center",
                  fontFamily: "var(--font-mono)", color: GREY, fontSize: 11.5,
                }}>{l.lote_code || "—"}</td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {Number(l.received_qty || 0).toLocaleString()}
                  {l.expected_qty != null && l.received_qty != null
                    && Number(l.expected_qty) !== Number(l.received_qty) && (
                    <span style={{
                      display: "inline-block", marginLeft: 4,
                      fontSize: 10, color: AMBER, fontWeight: 700,
                    }}>
                      ({Number(l.received_qty) - Number(l.expected_qty) > 0 ? "+" : ""}
                      {Number(l.received_qty) - Number(l.expected_qty)})
                    </span>
                  )}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "var(--font-mono)", color: GREY }}>
                  {l.unit_cost_usd != null
                    ? fmtMoney(l.unit_cost_usd)
                    : <span style={{ color: GREY }}>—</span>}
                </td>
                <td style={{ ...td(), textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: MINT }}>
                  {l.line_value_usd != null
                    ? fmtMoney(l.line_value_usd)
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyNoRecepcion({ lang, row }) {
  return (
    <div style={{
      padding: "32px 20px", textAlign: "center",
      background: "#fff", border: "1px dashed rgba(11,30,58,0.18)",
      borderRadius: 12,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        background: "rgba(72,30,227,0.08)", color: VIOLET,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 12, fontSize: 22,
      }}>📦</div>
      <div style={{
        fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 6,
      }}>
        {lang === "es"
          ? "Esta fila de stock no nació de una recepción formal."
          : "This stock row was not created by a formal reception."}
      </div>
      <div style={{
        fontSize: 12.5, color: GREY, lineHeight: 1.5, maxWidth: 420, margin: "0 auto",
      }}>
        {lang === "es"
          ? "Probablemente fue creada por un movimiento interna, un ajuste manual o un import de stock inicial. Cuando registres la entrada con el wizard de recepción, aquí verás el packing list, las líneas, los costos y las excepciones."
          : "It was probably created by an internal transfer, a manual adjustment or an initial stock import. When you register inbound through the reception wizard, you'll see the packing list, lines, costs and exceptions here."}
      </div>
      <div style={{
        marginTop: 16, padding: "8px 12px",
        background: "rgba(11,30,58,0.04)", borderRadius: 8,
        fontSize: 11.5, color: GREY,
        display: "inline-flex", alignItems: "center", gap: 8,
        fontFamily: "var(--font-mono)",
      }}>
        <span>Stock actual:</span>
        <strong style={{ color: NAVY }}>{(row.qty || 0).toLocaleString()} u</strong>
        <span>·</span>
        <span>{row.size || "ÚNICA"}</span>
        <span>·</span>
        <span>{row.lot || "—"}</span>
      </div>
    </div>
  );
}

// ── Estilos compartidos ──────────────────────────────────────
function th() {
  return { padding: "8px 8px", textAlign: "left" };
}
function td() {
  return { padding: "10px 8px", textAlign: "left", verticalAlign: "middle" };
}

function DocIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M5.5 8h5M5.5 10.5h5M5.5 13h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
