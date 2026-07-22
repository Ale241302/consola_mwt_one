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
  productosApi, tallasApi, apiFetch, getToken, storageApi,
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
  // Sprint 2026-07-20 · sistema de talla por defecto: BRA (la base del
  // Motor de Tallas para calzado Marluvas). El toggle muestra BRA primero.
  // Sprint 2026-07-21 · US M / US W habilitados otra vez (inputs activos;
  // la cantidad siempre se registra contra la talla base BRA).
  const [displaySystem, setDisplaySystem] = useState("BR");
  // Sprint 2026-07-20 · resultados divididos: asignados visibles y, bajo
  // el chevron "Más opciones", los NO asignados que matchean la búsqueda.
  const [showMore, setShowMore] = useState(false);
  // Sprint 2026-07-20 · modal anidado "Ver especificaciones" (no cierra
  // este modal de búsqueda).
  const [specsProduct, setSpecsProduct] = useState(null);

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
            // Sprint 2026-07-21 · medidas internas (mm) del PDF Marluvas
            ancho:       sz.ancho_mm       ?? null,
            comprimento: sz.comprimento_mm ?? null,
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
              // Sprint 2026-07-22 · IN (pulgadas) en el toggle, tras CM
              INCH: sz.inch     || null,
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
            ancho:       t.ancho_mm       ?? null,
            comprimento: t.comprimento_mm ?? null,
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
              INCH: t.inch     || null,
              ALFA: t.alfa     || null,
            },
          };
        }
      } else {
        const m = sizingMap[String(t)];
        if (m?.base) entry = { base: m.base, equiv: m.equiv, ancho: m.ancho ?? null, comprimento: m.comprimento ?? null };
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
      .map((t) => {
        // Sprint 2026-07-20 · la línea siempre guarda la talla BRA (base
        // del Motor), pero si el usuario ingresó cantidades en OTRO
        // sistema (EU, CM, …) también conservamos la talla ORIGINAL que
        // vio al digitar, para mostrarla en la tabla del Paso 2.
        const shown = (t.equiv && t.equiv[displaySystem]) || t.base;
        const isBra = displaySystem === "BR" || displaySystem === "BASE"
          || shown === t.base;
        return {
          sku:           picked.sku,
          talla:         t.base === "ÚNICA" ? null : t.base,
          cantidad:      Number(t.qty),
          producto_id:   picked.producto_id,
          product_label: picked.product_label,
          is_assigned:   picked.is_assigned,
          talla_sistema: isBra ? null : displaySystem,
          talla_original: isBra ? null : shown,
        };
      });
    if (rows.length === 0) return;
    onAdd(rows);
    setPicked(null);
    setSearch("");
  };

  return (
    <>
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
                {(() => {
                  const renderProductRow = (p) => {
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
                        {/* Sprint 2026-07-20 · Ver especificaciones — abre un
                            modal anidado con la ficha del producto SIN cerrar
                            este modal de búsqueda. */}
                        <button type="button"
                                onClick={(e) => { e.stopPropagation(); setSpecsProduct(p); }}
                                style={{
                                  flexShrink: 0,
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "#fff",
                                  color: "#013A57",
                                  fontWeight: 700, fontSize: 12,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}>
                          {lang === "es" ? "Ver especificaciones" : "View specs"}
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
                  };
                  // Sprint 2026-07-20 · split: asignados visibles; los NO
                  // asignados quedan tras el chevron "Más opciones" (solo si
                  // hay alguno — si no, el chevron no se muestra).
                  const assignedRes   = results.filter((p) => isProductAssigned(p));
                  const unassignedRes = results.filter((p) => !isProductAssigned(p));
                  return (
                    <>
                      {assignedRes.map(renderProductRow)}
                      {unassignedRes.length > 0 && (
                        <button type="button"
                                onClick={() => setShowMore((v) => !v)}
                                style={{
                                  width: "100%", textAlign: "left",
                                  padding: "8px 12px", marginBottom: 6,
                                  background: "transparent", border: 0,
                                  color: "#013A57", fontWeight: 700, fontSize: 12,
                                  cursor: "pointer",
                                }}>
                          {showMore ? "▾" : "▸"}{" "}
                          {lang === "es"
                            ? `Más opciones (${unassignedRes.length})`
                            : `More options (${unassignedRes.length})`}
                        </button>
                      )}
                      {showMore && unassignedRes.map(renderProductRow)}
                    </>
                  );
                })()}
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
                // Sprint 2026-07-20 · BRA primero y por defecto (es la base
                // del Motor). Sprint 2026-07-21 · todos los sistemas con
                // datos permiten digitar cantidades (incluidos US M / US W).
                // Se quita "Letras" (ALFA): el cliente ordena en sistemas
                // numéricos; las medidas internas van bajo cada talla.
                // Sprint 2026-07-22 · se agrega IN (pulgadas) tras CM.
                const allSystems = ["BR","EU","US_M","US_W","UK_M","CM","INCH"];
                const systemsWithData = allSystems.filter((s) =>
                  picked.tallas.some((t) => !!(t.equiv && t.equiv[s]))
                );
                const labels = {
                  BASE: lang === "es" ? "Base" : "Base",
                  EU: "EU", US_M: "US M", US_W: "US W",
                  UK_M: "UK", BR: "BRA", CM: "CM", INCH: "IN",
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

              {/* Sprint 2026-07-21 · US M / US W habilitados otra vez:
                  el cliente puede digitar cantidades en cualquier sistema
                  (la talla se guarda siempre contra la base BRA). */}
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
                          fontSize: 11, textAlign: "center",
                          color: "#013A57", fontWeight: 700,
                          marginBottom: 4,
                          fontFamily: "var(--font-mono, monospace)",
                        }}>BRA {t.base}</div>
                      )}
                      <input className="input tabular-nums" type="number" min="0"
                             value={t.qty}
                             onChange={(e) => {
                               const v = Math.max(0, Number(e.target.value) || 0);
                               // Sprint 2026-07-18 · forzamos el texto del DOM al
                               // número canónico: sin esto, teclear "05" sobre un
                               // state que ya valía 5 no disparaba re-render y el
                               // input se quedaba mostrando "05".
                               e.target.value = String(v);
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
    {/* Sprint 2026-07-20 · modal anidado "Ver especificaciones" — se abre
        ENCIMA de este modal sin cerrarlo (zIndex mayor). */}
    {specsProduct && (
      <ProductSpecsModal
        lang={lang}
        product={specsProduct}
        onClose={() => setSpecsProduct(null)}
      />
    )}
    </>
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



// ═════════════════════════════════════════════════════════════
// PRODUCT SPECS MODAL — Sprint 2026-07-20 (rev2 · diseño amplio)
// Ficha read-only del producto (como /portal/productos/:id pero en
// modal): imagen grande, datos base, atributos técnicos y botón de
// DESCARGA DE FICHA TÉCNICA (PDF desde especificaciones.fichas /
// ficha_url vía /api/storage/download/). Se abre anidado desde el
// buscador de línea manual SIN cerrarlo.
// ═════════════════════════════════════════════════════════════
export function ProductSpecsModal({ lang = "es", product, onClose }) {
  const [full, setFull] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!product?.id) return undefined;
    productosApi.get(product.id)
      .then((d) => { if (alive) setFull(d); })
      .catch(() => { /* fallback: mostramos lo que ya trae la fila */ });
    return () => { alive = false; };
  }, [product?.id]);

  const p = full || product || {};
  const esp = p.especificaciones || {};
  const L = (es, en) => (lang === "es" ? es : en);
  const imgKey = p.imagen_url
    || (Array.isArray(esp.gallery) && esp.gallery.length ? esp.gallery[0] : null);

  // ── Fichas técnicas (PDF) — ficha_url + especificaciones.fichas[]
  const fichaKeys = [...new Set(
    [p.ficha_url, ...(Array.isArray(esp.fichas) ? esp.fichas : [])]
      .filter((k) => k && typeof k === "string")
  )];
  const fichaName = (key) => {
    const base = String(key).split("/").pop() || "ficha.pdf";
    // Quita el prefijo hex de 8 chars que agrega el uploader ("e70cb4df-…")
    return base.replace(/^[0-9a-f]{8}-/i, "");
  };

  const quickFacts = [
    [L("Categoría", "Category"), p.categoria],
    [L("Color", "Color"), esp.color],
    [L("País de origen", "Country of origin"), p.pais_origen_iso2],
    ["NCM", esp.ncm || p.hs_code],
  ].filter(([, v]) => v);

  const specRows = [
    [L("Tipo de calzado", "Footwear type"), esp.tipo_calzado],
    [L("Tipo de puntera", "Toe cap type"), esp.tipo_puntera],
    [L("Cubre puntera", "Toe cover"), esp.cubrepuntera],
    [L("Antiperforante", "Puncture resistant"), esp.antiperforante],
    [L("Protector metatarsal", "Metatarsal guard"), esp.protector_metatarsal],
    [L("Capellada", "Upper"), esp.capellada],
    [L("Suela", "Sole"), esp.suela],
    [L("Cierre", "Closure"), esp.cierre],
    [L("Plantilla interna", "Insole"), esp.plantilla_interna],
    [L("Materiales circulares", "Circular materials"), esp.materiales_circulares],
    [L("Unidad", "Unit"), p.unidad],
    [L("Moneda", "Currency"), p.moneda],
  ].filter(([, v]) => v);

  const chipGroups = [
    ["Normativa", esp.normativa],
    [L("Disipativo de energía", "Energy dissipative"), esp.disipativo_energia],
    [L("Riesgo", "Risk"), esp.riesgo],
    [L("Segmento", "Segment"), esp.segmento],
  ].filter(([, arr]) => Array.isArray(arr) && arr.length > 0);

  const sectionTitle = (txt) => (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
      color: "#013A57", textTransform: "uppercase",
      marginBottom: 8, marginTop: 4,
    }}>{txt}</div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 130,
      background: "rgba(11,30,58,0.58)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             background: "#fff", borderRadius: 16, width: "min(880px, 96vw)",
             height: "min(92vh, 900px)", overflow: "hidden",
             display: "flex", flexDirection: "column",
             boxShadow: "0 40px 80px -24px rgba(15,27,61,0.60)",
           }}>
        {/* ── Header navy ─────────────────────────────────── */}
        <header style={{
          padding: "18px 24px",
          background: "linear-gradient(120deg, #013A57 0%, #0a4d6e 100%)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14,
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2,
              color: "#75CBB3", textTransform: "uppercase", marginBottom: 4,
            }}>
              {L("Especificaciones del producto", "Product specs")}
            </div>
            <div style={{
              fontSize: 20, fontWeight: 800, color: "#fff", lineHeight: 1.2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {(p.sku || "").toUpperCase()}
              </span>
              <span style={{ opacity: 0.55, fontWeight: 600 }}> · </span>
              {p.nombre || p.product_label || "—"}
            </div>
            {p.marca_nombre && (
              <span style={{
                display: "inline-block", marginTop: 7, padding: "3px 10px",
                borderRadius: 999, fontSize: 11, fontWeight: 700,
                background: "rgba(255,255,255,0.14)", color: "#E8F5F0",
              }}>{p.marca_nombre}</span>
            )}
          </div>
          <button onClick={onClose}
                  style={{
                    flexShrink: 0, width: 34, height: 34, borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(255,255,255,0.10)", color: "#fff",
                    fontSize: 15, cursor: "pointer", lineHeight: 1,
                  }}>✕</button>
        </header>

        {/* ── Body ────────────────────────────────────────── */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
          {/* Hero: imagen + quick facts + ficha */}
          <div style={{ display: "flex", gap: 20, alignItems: "stretch", flexWrap: "wrap" }}>
            <div style={{
              width: 220, minHeight: 220, flexShrink: 0,
              border: "1px solid var(--border)", borderRadius: 14,
              background: "linear-gradient(180deg,#F8FAFB 0%,#EFF4F8 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {imgKey ? (
                <img
                  src={storageApi.downloadUrl(imgKey)}
                  alt={p.nombre || p.sku || "producto"}
                  style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10 }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                  {L("Sin imagen", "No image")}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                {sectionTitle(L("Información base", "Base info"))}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                }}>
                  {quickFacts.map(([k, v]) => (
                    <div key={k} style={{
                      border: "1px solid var(--border)", borderRadius: 10,
                      padding: "8px 12px", background: "#F8FAFB",
                    }}>
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0B1E3A", marginTop: 2 }}>{String(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
              {fichaKeys.length > 0 && (
                <div style={{
                  border: "1px solid rgba(1,58,87,0.18)", borderRadius: 12,
                  background: "rgba(1,58,87,0.04)", padding: "12px 14px",
                }}>
                  {sectionTitle(L("Ficha técnica (PDF)", "Datasheet (PDF)"))}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {fichaKeys.map((k) => (
                      <a key={k}
                         href={storageApi.downloadUrl(k)}
                         target="_blank" rel="noreferrer"
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 8,
                           padding: "9px 14px", borderRadius: 9,
                           background: "#013A57", color: "#fff",
                           fontSize: 12.5, fontWeight: 700, textDecoration: "none",
                         }}>
                        <span style={{ fontSize: 14 }}>⬇</span>
                        {L("Descargar ficha técnica", "Download datasheet")}
                        <span style={{
                          fontWeight: 500, fontSize: 11, opacity: 0.75,
                          overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", maxWidth: 320,
                        }}>· {fichaName(k)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Atributos */}
          <div style={{ marginTop: 20 }}>
            {sectionTitle(L("Atributos del calzado", "Footwear attributes"))}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "0 24px",
            }}>
              {specRows.map(([k, v]) => (
                <div key={k} style={{
                  display: "flex", justifyContent: "space-between", gap: 14,
                  padding: "7px 0", borderBottom: "1px solid #F1F5F9", fontSize: 12.5,
                }}>
                  <span style={{ color: "var(--text-tertiary)" }}>{k}</span>
                  <span style={{ fontWeight: 700, color: "#0B1E3A", textAlign: "right" }}>{String(v)}</span>
                </div>
              ))}
              {specRows.length === 0 && (
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {L("Cargando especificaciones…", "Loading specs…")}
                </div>
              )}
            </div>
          </div>

          {/* Chips */}
          {chipGroups.length > 0 && (
            <div style={{ marginTop: 18 }}>
              {sectionTitle(L("Normativa · Riesgos · Segmentos", "Standards · Risks · Segments"))}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14,
              }}>
                {chipGroups.map(([k, arr]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#013A57", marginBottom: 5 }}>{k}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {arr.map((x) => (
                        <span key={String(x)} style={{
                          padding: "4px 10px", borderRadius: 999, fontSize: 11,
                          border: "1px solid rgba(1,58,87,0.20)",
                          background: "rgba(1,58,87,0.05)",
                          color: "#013A57", fontWeight: 600,
                        }}>{String(x)}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <footer style={{
          padding: "12px 24px", borderTop: "1px solid #F1F4F9",
          display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0,
        }}>
          {fichaKeys.length > 0 && (
            <a href={storageApi.downloadUrl(fichaKeys[0])}
               target="_blank" rel="noreferrer"
               style={{
                 display: "inline-flex", alignItems: "center", gap: 7,
                 padding: "9px 16px", borderRadius: 9,
                 border: "1.5px solid #013A57",
                 background: "#fff", color: "#013A57",
                 fontSize: 12.5, fontWeight: 700, textDecoration: "none",
               }}>
              ⬇ {L("Descargar ficha técnica", "Download datasheet")}
            </a>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            {L("Cerrar", "Close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
