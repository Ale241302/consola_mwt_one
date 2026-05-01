// =====================================================================
// MWT.ONE · AddOCProductModal
// Modal para agregar productos a una OC. Reemplaza al mock-only que
// venia con OCDetail. Flujo:
//   1. Trae productos via /api/productos/ (list).
//   2. Filtra por visibilidad para el cliente:
//      · especificaciones.client_visibility[client_id] === true  → visible
//      · ningun client_visibility seteado                         → visible a todos
//   3. Buscador por SKU / nombre / marca.
//   4. Click en un producto → modal "step 2" con matriz de tallas
//      y una sola columna de cantidad. Resuelve precio del cliente
//      via especificaciones.client_prices[client_id] || precio_lista.
//   5. Submit → llama onPick(rows) con {sku, talla, cantidad, producto_id,
//      product_label, unit_price} por cada talla con qty > 0.
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IconX, IconSearch, IconPackage, IconPlus, IconCheck, IconAlert,
} from "../../lib/icons.jsx";
import { productosApi, tallasApi } from "../../lib/api.js";

const NAVY = "#0B1E3A";
const MINT = "#00B286";
const BLUE = "#3083FE";

function fmtMoney(v) {
  const n = Number(v || 0);
  if (n <= 0) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isVisibleForClient(p, clientId) {
  // Sin clientId no podemos filtrar; mostramos todos activos.
  if (!clientId) return true;
  const esp = p.especificaciones || {};
  const cv  = esp.client_visibility || null;
  // Si NO existe el mapa client_visibility, asumimos visible a todos.
  if (!cv || typeof cv !== "object") return true;
  // Si existe, requerimos entrada explicita true.
  return cv[clientId] === true;
}

function resolveUnitPrice(p, clientId) {
  const esp = p.especificaciones || {};
  const cliMap = esp.client_prices || {};
  const override = Number(cliMap[clientId] || 0);
  const lista = Number(p.precio_lista || 0);
  return override > 0 ? override : lista;
}

export default function AddOCProductModal({
  open,
  onClose,
  onPick,        // (rows[]) => void  — emite las líneas listas para insertar
  lang = "es",
  clientId,      // UUID del cliente del OC
  clientLabel,   // nombre del cliente (para mostrar)
}) {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState(null);

  // Step 2: producto seleccionado + matriz de tallas
  const [picked, setPicked] = useState(null); // { p, tallas:[{label, qty}], unit_price }
  const [loadingPicked, setLoadingPicked] = useState(false);

  // Catalogo de tallas con TODAS las equivalencias (no solo el label).
  // Permite mostrar la talla en cualquier sistema (EU/US/UK/CM/...).
  const [sizingMap, setSizingMap] = useState({});

  // Sistema de medida elegido para mostrar la talla.
  // "BASE" = la columna talla_base (canonica registrada en /tallas).
  const [displaySystem, setDisplaySystem] = useState("BASE");

  // ── Cargar productos al abrir
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoadingList(true);
    setError(null);
    productosApi.list()
      .then((d) => {
        if (cancel) return;
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setProducts(arr);
        setLoadingList(false);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || (lang === "es" ? "Error al cargar" : "Load error"));
        setLoadingList(false);
      });
    return () => { cancel = true; };
  }, [open]); // eslint-disable-line

  // Cargar catalogo de tallas una sola vez con TODAS las equivalencias
  useEffect(() => {
    if (!open) return;
    if (Object.keys(sizingMap).length > 0) return;
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
      .catch(() => {});
  }, [open]); // eslint-disable-line

  // ── Productos visibles para el cliente
  const visible = useMemo(() => {
    return (products || [])
      .filter((p) => p.is_active !== false)
      .filter((p) => isVisibleForClient(p, clientId));
  }, [products, clientId]);

  // ── Filtrado por busqueda
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return visible;
    return visible.filter((p) => {
      const sku    = String(p.sku || "").toLowerCase();
      const name   = String(p.nombre || "").toLowerCase();
      const marca  = String(p.marca_nombre || "").toLowerCase();
      const cat    = String(p.categoria || "").toLowerCase();
      return sku.includes(k) || name.includes(k) || marca.includes(k) || cat.includes(k);
    });
  }, [visible, q]);

  // ── Pick: cargar detalle + tallas (con todas las equivalencias)
  const pick = async (p) => {
    const unit = resolveUnitPrice(p, clientId);
    setPicked({ p, unit_price: unit, loading_sizes: true, tallas: [] });
    setLoadingPicked(true);
    try {
      const full = await productosApi.get(p.id);
      const tallaIds = Array.isArray(full?.tallas) ? full.tallas : [];
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
        tallas.push({ base: "UNICA", equiv: { BASE: "UNICA" }, qty: 0 });
      }
      setPicked({ p, unit_price: unit, loading_sizes: false, tallas });
    } catch {
      setPicked({
        p, unit_price: unit, loading_sizes: false,
        tallas: [{ base: "UNICA", equiv: { BASE: "UNICA" }, qty: 0 }],
      });
    } finally {
      setLoadingPicked(false);
    }
  };

  const updateTallaQty = (idx, qty) => {
    setPicked((prev) => {
      if (!prev) return prev;
      const next = { ...prev, tallas: prev.tallas.map((t, i) =>
        i === idx ? { ...t, qty } : t) };
      return next;
    });
  };

  const submit = () => {
    if (!picked) return;
    const rows = picked.tallas
      .filter((t) => Number(t.qty || 0) > 0)
      .map((t) => ({
        sku:           picked.p.sku,
        // Persistimos siempre la talla BASE (canonica). El display
        // elegido es solo de presentacion.
        talla:         t.base === "UNICA" ? null : t.base,
        cantidad:      Number(t.qty),
        producto_id:   picked.p.id,
        product_label: picked.p.nombre || picked.p.sku,
        unit_price:    Number(picked.unit_price || 0),
      }));
    if (rows.length === 0) return;
    onPick?.(rows);
    setPicked(null);
    setQ("");
  };

  if (!open) return null;

  const totalQty = picked?.tallas.reduce((a, t) => a + Number(t.qty || 0), 0) || 0;
  const totalValue = picked
    ? picked.tallas.reduce((a, t) => a + Number(t.qty || 0), 0) * Number(picked.unit_price || 0)
    : 0;

  return (
    <div
      onClick={onClose}
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
          width: "min(680px, 96vw)", maxHeight: "90vh",
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
          gap: 12, flexWrap: "wrap",
        }}>
          <div>
            <div className="micro" style={{
              color: "var(--text-tertiary)", letterSpacing: 1,
            }}>
              {lang === "es" ? "AGREGAR PRODUCTO A LA OC" : "ADD PRODUCT TO PO"}
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, color: NAVY }}>
              {picked
                ? (picked.p.nombre || picked.p.sku)
                : (lang === "es" ? "Buscar producto" : "Search product")}
            </div>
            {clientLabel && (
              <div className="caption" style={{
                color: "var(--text-tertiary)", marginTop: 2, fontSize: 12,
              }}>
                {lang === "es" ? "Cliente: " : "Client: "}
                <strong style={{ color: NAVY }}>{clientLabel}</strong>
              </div>
            )}
          </div>
          <button
            type="button" onClick={onClose}
            className="btn btn-ghost btn-sm" style={{ padding: "6px 8px" }}
          >
            <IconX size={11}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {/* Step 1: lista */}
          {!picked && (
            <>
              <div style={{
                position: "relative", display: "flex",
                alignItems: "center", gap: 8,
                border: "1px solid var(--border)", borderRadius: 10,
                padding: "8px 12px", background: "white",
                marginBottom: 14,
              }}>
                <IconSearch size={14} style={{ color: "var(--text-tertiary)" }}/>
                <input
                  autoFocus
                  value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={lang === "es"
                    ? "Buscar por SKU, nombre, marca…"
                    : "Search by SKU, name, brand…"}
                  style={{
                    flex: 1, border: 0, outline: "none",
                    background: "transparent", fontSize: 14,
                  }}
                />
                <span className="caption tabular-nums" style={{
                  color: "var(--text-tertiary)", fontSize: 12,
                }}>
                  {filtered.length} / {visible.length}
                </span>
              </div>

              {error && (
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "#FEE2E2", color: "#991B1B",
                  border: "1px solid #FCA5A5", fontSize: 13,
                  marginBottom: 12,
                }}>
                  <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/>
                  {error}
                </div>
              )}

              {loadingList && (
                <div className="caption" style={{
                  textAlign: "center", padding: 20,
                  color: "var(--text-tertiary)",
                }}>
                  {lang === "es" ? "Cargando productos…" : "Loading…"}
                </div>
              )}

              {!loadingList && filtered.length === 0 && (
                <div style={{
                  padding: 24, textAlign: "center",
                  color: "var(--text-tertiary)", fontSize: 13,
                }}>
                  <IconPackage size={24} style={{
                    opacity: 0.3, marginBottom: 8,
                  }}/>
                  <div>
                    {lang === "es"
                      ? clientId
                          ? "No hay productos visibles para este cliente con esos criterios."
                          : "Sin coincidencias."
                      : clientId
                          ? "No products visible to this client matching."
                          : "No matches."}
                  </div>
                </div>
              )}

              {!loadingList && filtered.length > 0 && (
                <div style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 10, overflow: "hidden",
                  maxHeight: 420, overflowY: "auto",
                }}>
                  {filtered.map((p) => {
                    const unit = resolveUnitPrice(p, clientId);
                    const hasOverride = clientId
                      && Number((p.especificaciones?.client_prices || {})[clientId] || 0) > 0;
                    return (
                      <button
                        key={p.id || p.sku} type="button"
                        onClick={() => pick(p)}
                        style={{
                          width: "100%", textAlign: "left",
                          padding: "10px 14px", border: 0,
                          background: "white", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 12,
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(48,131,254,0.05)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                      >
                        <IconPackage size={16} style={{ color: BLUE, flexShrink: 0 }}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="mono-sm" style={{
                            fontWeight: 700, color: NAVY, fontSize: 13,
                          }}>
                            {p.sku}
                          </div>
                          <div style={{
                            fontSize: 13, color: NAVY, fontWeight: 500,
                          }}>{p.nombre || "—"}</div>
                          <div className="caption" style={{
                            fontSize: 11, color: "var(--text-tertiary)",
                          }}>
                            {p.marca_nombre || "—"}{" "}
                            {p.categoria ? `· ${p.categoria}` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", marginRight: 10 }}>
                          <div className="tabular-nums" style={{
                            fontSize: 14, fontWeight: 700,
                            color: hasOverride ? MINT : NAVY,
                          }}>
                            {fmtMoney(unit)}
                          </div>
                          {hasOverride && (
                            <div className="caption" style={{
                              fontSize: 9, color: MINT, fontWeight: 700,
                              textTransform: "uppercase", letterSpacing: 0.4,
                            }}>
                              {lang === "es" ? "PRECIO CLIENTE" : "CLIENT PRICE"}
                            </div>
                          )}
                        </div>
                        <IconPlus size={14} style={{ color: MINT }}/>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Step 2: matriz tallas */}
          {picked && (
            <>
              <div style={{
                padding: "10px 14px", borderRadius: 10,
                background: "rgba(48,131,254,0.06)",
                border: "1px solid rgba(48,131,254,0.20)",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12, alignItems: "center", marginBottom: 14,
              }}>
                <div>
                  <div className="mono-sm" style={{
                    fontWeight: 700, color: NAVY, fontSize: 13,
                  }}>{picked.p.sku}</div>
                  <div className="caption" style={{
                    fontSize: 11, color: "var(--text-tertiary)",
                  }}>
                    {picked.p.marca_nombre || "—"} · {picked.p.categoria || "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="micro" style={{ color: "var(--text-tertiary)", fontSize: 10 }}>
                    {lang === "es" ? "PRECIO UNITARIO" : "UNIT PRICE"}
                  </div>
                  <div className="tabular-nums" style={{
                    fontSize: 16, fontWeight: 800, color: MINT,
                  }}>
                    {fmtMoney(picked.unit_price)}
                  </div>
                </div>
              </div>

              {picked.loading_sizes ? (
                <div className="caption" style={{
                  textAlign: "center", padding: 20,
                  color: "var(--text-tertiary)",
                }}>
                  {lang === "es" ? "Cargando tallas…" : "Loading sizes…"}
                </div>
              ) : (
                <>
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 10,
                    marginBottom: 8, flexWrap: "wrap",
                  }}>
                    <div className="micro" style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      color: "var(--text-tertiary)", textTransform: "uppercase",
                    }}>
                      {lang === "es"
                        ? `Tallas disponibles (${picked.tallas.length})`
                        : `Available sizes (${picked.tallas.length})`}
                    </div>
                    {(() => {
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
                                color: displaySystem === s ? NAVY : "var(--text-tertiary)",
                                fontSize: 11, fontWeight: 700,
                                boxShadow: displaySystem === s
                                  ? "0 1px 2px rgba(11,30,58,0.10)" : "none",
                                transition: "all 0.12s",
                              }}
                            >{labels[s]}</button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10, overflow: "hidden",
                  }}>
                    {picked.tallas.map((t, i) => {
                      const showLabel = (t.equiv && t.equiv[displaySystem]) || t.base || "—";
                      const isFallback = displaySystem !== "BASE"
                        && (!t.equiv || !t.equiv[displaySystem])
                        && !!t.base;
                      const secondary = t.equiv
                        ? Object.entries(t.equiv)
                            .filter(([k, v]) => v && k !== displaySystem && k !== "BASE")
                            .slice(0, 4)
                        : [];
                      return (
                        <div key={i} style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 100px",
                          gap: 12, alignItems: "center",
                          padding: "10px 14px",
                          borderBottom: i === picked.tallas.length - 1
                            ? "none"
                            : "1px solid var(--border-subtle)",
                          background: i % 2 === 0 ? "transparent" : "rgba(11,30,58,0.02)",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <span style={{
                              padding: "3px 10px", borderRadius: 6,
                              background: isFallback
                                ? "rgba(180,83,9,0.10)"
                                : "rgba(11,30,58,0.06)",
                              fontSize: 12, fontWeight: 700,
                              color: isFallback ? "#92400E" : NAVY,
                              minWidth: 50, textAlign: "center",
                              fontFamily: "var(--font-mono)",
                            }}
                            title={isFallback
                              ? (lang === "es"
                                  ? `${displaySystem} no definido para esta talla — mostrando base`
                                  : `${displaySystem} not set — showing base`)
                              : undefined}
                            >{showLabel}</span>
                            {secondary.length > 0 && (
                              <span className="caption" style={{
                                fontSize: 10, color: "var(--text-tertiary)",
                                fontFamily: "var(--font-mono)",
                                whiteSpace: "nowrap", overflow: "hidden",
                                textOverflow: "ellipsis", minWidth: 0,
                              }}>
                                {secondary.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                              </span>
                            )}
                            {Number(t.qty || 0) > 0 && (
                              <span className="caption tabular-nums" style={{
                                fontSize: 11, color: MINT, fontWeight: 600,
                                marginLeft: "auto",
                              }}>
                                = {fmtMoney(Number(t.qty) * Number(picked.unit_price))}
                              </span>
                            )}
                          </div>
                          <input
                            type="number" min={0}
                            className="input tabular-nums"
                            value={t.qty}
                            onChange={(e) => updateTallaQty(i, Math.max(0, Number(e.target.value || 0)))}
                            style={{
                              fontSize: 14, padding: "6px 10px",
                              border: t.qty > 0
                                ? "1.5px solid #00B286"
                                : "1px solid var(--border)",
                              borderRadius: 6, textAlign: "right",
                              fontFamily: "var(--font-mono)",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Resumen */}
                  <div style={{
                    marginTop: 14, padding: "10px 14px",
                    borderRadius: 10,
                    background: totalQty > 0
                      ? "rgba(0,178,134,0.06)"
                      : "rgba(11,30,58,0.03)",
                    border: totalQty > 0
                      ? "1px solid rgba(0,178,134,0.30)"
                      : "1px solid var(--border-subtle)",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10,
                  }}>
                    <div>
                      <div className="micro" style={{ fontSize: 10 }}>
                        {lang === "es" ? "UNIDADES" : "UNITS"}
                      </div>
                      <div className="tabular-nums" style={{
                        fontSize: 16, fontWeight: 800, color: NAVY,
                      }}>{totalQty}</div>
                    </div>
                    <div>
                      <div className="micro" style={{ fontSize: 10 }}>
                        {lang === "es" ? "TALLAS" : "SIZES"}
                      </div>
                      <div className="tabular-nums" style={{
                        fontSize: 16, fontWeight: 800, color: NAVY,
                      }}>
                        {picked.tallas.filter((t) => Number(t.qty || 0) > 0).length}
                      </div>
                    </div>
                    <div>
                      <div className="micro" style={{ fontSize: 10 }}>
                        {lang === "es" ? "VALOR TOTAL" : "TOTAL VALUE"}
                      </div>
                      <div className="tabular-nums" style={{
                        fontSize: 16, fontWeight: 800, color: MINT,
                      }}>{fmtMoney(totalValue)}</div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          background: "rgba(11,30,58,0.02)",
          display: "flex", justifyContent: "space-between", gap: 8,
        }}>
          {picked ? (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => setPicked(null)}
            >
              ← {lang === "es" ? "Volver al catálogo" : "Back to catalog"}
            </button>
          ) : <span/>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost" onClick={onClose}
            >
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
            {picked && (
              <button
                type="button"
                disabled={totalQty === 0 || picked.loading_sizes}
                onClick={submit}
                className="btn btn-accent"
                style={{
                  fontWeight: 700, minWidth: 180,
                  background: MINT, borderColor: MINT,
                }}
              >
                <IconCheck size={12}/>
                {lang === "es"
                  ? `Agregar ${totalQty} u`
                  : `Add ${totalQty} u`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
