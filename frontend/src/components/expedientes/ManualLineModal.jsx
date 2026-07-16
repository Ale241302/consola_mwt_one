// ─────────────────────────────────────────────────────────────
// ManualLineModal — buscador SKU + matriz tallas + asignación
// Sprint 2026-05-06 · extracted from CreateExpedienteWizardLite.jsx
//
// Reusable en:
//   · /portal/nueva-oc (CreateExpedienteWizardLite Step 2)
//   · /expedientes/<oc>/exp/<id> (ExpedienteDetail · LinesTab)
//
// Comportamiento idéntico al original:
//   1. Buscar producto por SKU/nombre (≥2 chars).
//   2. Badge ASIGNADO/NO ASIGNADO según especificaciones.visibility.
//      - ASIGNADO → click abre matriz de tallas.
//      - NO ASIGNADO → botón "Solicitar Asignación" (POST email).
//   3. Cargar tallas del producto desde el Motor de Tallas
//      con todas las equivalencias (BASE/EU/US_M/UK/BR/CM/ALFA).
//   4. Toggle de sistema de medida si hay >1 con datos.
//   5. "Añadir al pedido" → callback `onAdd(rows)` con shape:
//        { sku, talla, cantidad, producto_id, product_label, is_assigned }
//
// Props:
//   · lang        — "es" | "en"
//   · clientId    — UUID del cliente (para visibility checks + asignación)
//   · clientLabel — opcional · nombre legible para el dialog
//   · onClose     — callback al cerrar
//   · onAdd(rows) — callback con array de líneas a agregar al pedido
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { IconSearch, IconPackage } from "../../lib/icons.jsx";
import {
  productosApi, tallasApi, apiFetch, getToken,
} from "../../lib/api.js";


// ─────────────────────────────────────────────────────────────
// Field helper — duplicado del wizard para no acoplar imports
// ─────────────────────────────────────────────────────────────
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
// MANUAL LINE PANEL — buscar SKU + matriz tallas
// ═════════════════════════════════════════════════════════════
export function ManualLinePanel({ lang, clientId, clientLabel, onClose, onAdd }) {
  const [search, setSearch]     = useState("");
  const [results, setResults]   = useState([]);
  const [picked, setPicked]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [cpaSet, setCpaSet]     = useState(new Set());
  const [requestPending, setRequestPending] = useState(new Set());
  const [requestSent,    setRequestSent]    = useState(new Set());
  const [requestErr,     setRequestErr]     = useState({});
  const [sizingMap, setSizingMap] = useState({});
  const [displaySystem, setDisplaySystem] = useState("BR");

  // Cargar CPA del cliente (legacy /commercial/client-assignments).
  // Sprint 2026-05-03 v3: opcional. Fuente principal de "asignado" es
  // especificaciones.visibility del producto.
  useEffect(() => {
    if (!clientId) return;
    apiFetch(`/commercial/client-assignments/?client=${clientId}`, { token: getToken() })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setCpaSet(new Set(arr.map((a) => (a.brand_sku || "").toUpperCase()).filter(Boolean)));
      })
      .catch(() => {});
  }, [clientId]);

  // Helper canónico de visibilidad.
  const isProductAssigned = useCallback((p) => {
    if (!p) return false;
    const sku = (p.sku || "").toUpperCase();
    const vis = p?.especificaciones?.visibility || {};
    if (vis.visible_to_all === true) return true;
    const ov = vis.client_overrides || {};
    if (clientId && ov[clientId] === true) return true;
    if (cpaSet.size > 0 && cpaSet.has(sku)) return true;
    return false;
  }, [clientId, cpaSet]);

  // Solicitud de asignación (one-click).
  const requestAssignment = useCallback(async (p) => {
    const sku = (p.sku || "").toUpperCase();
    if (!sku || !clientId) return;
    if (requestPending.has(sku) || requestSent.has(sku)) return;
    setRequestPending(prev => new Set(prev).add(sku));
    setRequestErr(prev => { const n = { ...prev }; delete n[sku]; return n; });
    try {
      const res = await fetch("/api/catalog/request-assignment/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ client_id: clientId, sku }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setRequestSent(prev => new Set(prev).add(sku));
    } catch (e) {
      setRequestErr(prev => ({ ...prev, [sku]: e?.message || "fallo" }));
    } finally {
      setRequestPending(prev => {
        const n = new Set(prev); n.delete(sku); return n;
      });
    }
  }, [clientId, requestPending, requestSent]);

  // Catálogo de tallas (Motor de Tallas) con equivalencias.
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

  // Buscar productos.
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
    const isAssigned = isProductAssigned(p);

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
                  const isAssigned = isProductAssigned(p);
                  const pending = requestPending.has(sku);
                  const sent    = requestSent.has(sku);
                  const err     = requestErr[sku];
                  return (
                    <div key={p.id || sku}
                         style={{
                           width: "100%",
                           padding: "10px 14px",
                           border: "1px solid var(--border)",
                           borderRadius: 8, marginBottom: 6,
                           background: "#fff",
                           display: "flex", alignItems: "center", gap: 12,
                         }}>
                      <IconPackage size={14} style={{ color: "#3083FE", flexShrink: 0 }}/>
                      <button type="button"
                              onClick={() => isAssigned ? pick(p) : null}
                              disabled={!isAssigned}
                              style={{
                                flex: 1, minWidth: 0, textAlign: "left",
                                background: "transparent", border: 0,
                                padding: 0, cursor: isAssigned ? "pointer" : "default",
                                opacity: isAssigned ? 1 : 0.78,
                              }}
                              title={isAssigned
                                ? ""
                                : (lang === "es"
                                    ? "Producto no asignado al cliente. Solicitá la asignación al equipo MWT."
                                    : "Product not assigned. Request assignment to the MWT team.")}>
                        <div style={{ fontWeight: 600, color: "#0B1E3A" }}>
                          <span className="mono-sm">{sku}</span>
                          {isAssigned ? (
                            <span style={{
                              marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                              background: "rgba(0,178,134,0.12)", color: "#00875A",
                              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                            }}>
                              ✓ {lang === "es" ? "ASIGNADO" : "ASSIGNED"}
                            </span>
                          ) : (
                            <span style={{
                              marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                              background: "rgba(180,83,9,0.10)", color: "#B45309",
                              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                            }}>
                              ⚠ {lang === "es" ? "NO ASIGNADO" : "NOT ASSIGNED"}
                            </span>
                          )}
                        </div>
                        <div className="caption tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {p.nombre || p.product_label || ""}
                        </div>
                      </button>
                      {!isAssigned && (
                        <button type="button"
                                onClick={(e) => { e.stopPropagation(); requestAssignment(p); }}
                                disabled={pending || sent}
                                style={{
                                  flexShrink: 0,
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid " + (sent ? "rgba(0,135,90,0.25)" : "rgba(0,178,134,0.35)"),
                                  background: sent ? "rgba(0,135,90,0.10)" : "#fff",
                                  color: sent ? "#00875A" : "#00B286",
                                  fontWeight: 700, fontSize: 12,
                                  cursor: (pending || sent) ? "default" : "pointer",
                                  whiteSpace: "nowrap",
                                }}
                                title={err || ""}>
                          {pending
                            ? (lang === "es" ? "Enviando…" : "Sending…")
                            : sent
                              ? (lang === "es" ? "✓ Solicitado" : "✓ Requested")
                              : (lang === "es" ? "Solicitar Asignación" : "Request Assignment")}
                        </button>
                      )}
                    </div>
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

              {!picked.loading_sizes && picked.tallas.length >= 1 && (() => {
                const allSystems = ["EU","US_M","US_W","UK_M","BR","CM","ALFA"];
                const systemsWithData = allSystems.filter((s) =>
                  picked.tallas.some((t) => !!(t.equiv && t.equiv[s]))
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
export function RequestAssignmentDialog({ lang, sku, clientId, clientEmail, onClose, onSent, onError }) {
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
