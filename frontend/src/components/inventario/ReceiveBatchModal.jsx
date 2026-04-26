// =====================================================================
// MWT.ONE · components/inventario/ReceiveBatchModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal "Recibir lote" — alta o incremento de inventario en un nodo.
// Pide nodo destino, producto (con autocomplete por SKU/nombre), lote,
// cantidad, costo unitario USD opcional, fecha de vencimiento opcional
// y notas. Al confirmar dispara POST /api/stock/receive_batch/ que crea
// o suma el Stock y registra un Movimiento tipo RECEPCION.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { nodosApi, productosApi, apiFetch, getToken } from "../../lib/api.js";

export default function ReceiveBatchModal({ lang = "es", onClose, onSaved }) {
  // ── Catálogos ─────────────────────────────────────
  const [nodes,    setNodes]    = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [n, p] = await Promise.all([
          nodosApi.list().catch(() => []),
          productosApi.list().catch(() => []),
        ]);
        if (!alive) return;
        const ns = Array.isArray(n) ? n : (n?.results || []);
        const ps = Array.isArray(p) ? p : (p?.results || []);
        setNodes(ns.filter(x => x.is_active !== false));
        setProducts(ps);
      } finally {
        if (alive) setLoadingCatalogs(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Form ─────────────────────────────────────────
  const [form, setForm] = useState({
    nodo_id:     "",
    producto_id: "",
    lote:        "",
    cantidad:    "",
    costo_unitario_usd: "",
    fecha_vencimiento:  "",
    notas:       "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Autocomplete del producto
  const [needle, setNeedle] = useState("");
  const [pickedLabel, setPickedLabel] = useState("");

  const filteredProducts = useMemo(() => {
    const n = needle.trim().toLowerCase();
    if (!n) return products.slice(0, 30);
    return products
      .filter(p => `${p.sku || ""} ${p.nombre || ""}`.toLowerCase().includes(n))
      .slice(0, 30);
  }, [products, needle]);

  const pickProduct = (p) => {
    set("producto_id", p.id);
    setPickedLabel(`${p.sku || "—"} · ${p.nombre || ""}`);
    setNeedle(`${p.sku || "—"} · ${p.nombre || ""}`);
  };

  // Sugerir lote con la fecha actual (formato L-YYYY-MM-DD-NN)
  const suggestLote = () => {
    const d = new Date();
    const ymd = d.toISOString().slice(0, 10);
    const tag = Math.random().toString(36).slice(2, 4).toUpperCase();
    set("lote", `L-${ymd}-${tag}`);
  };

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const canSave =
    !!form.nodo_id &&
    !!form.producto_id &&
    Number(form.cantidad) > 0 &&
    !busy;

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        nodo_id:     form.nodo_id,
        producto_id: form.producto_id,
        lote:        form.lote || "",
        cantidad:    Number(form.cantidad),
        notas:       form.notas || null,
      };
      if (form.costo_unitario_usd !== "") {
        body.costo_unitario_usd = Number(form.costo_unitario_usd);
      }
      if (form.fecha_vencimiento) {
        body.fecha_vencimiento = form.fecha_vencimiento;
      }
      const res = await apiFetch("/stock/receive_batch/", {
        method: "POST",
        body,
        token: getToken(),
      });
      onSaved?.(res);
      onClose?.();
    } catch (e) {
      let msg = String(e?.message || e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object") {
          msg = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("  ·  ");
        }
      } catch (_) {}
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(15,27,61,0.45)", backdropFilter: "blur(2px)",
        }}
      />
      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "8vh", left: "50%",
          width: "min(640px, 96vw)",
          maxHeight: "84vh",
          zIndex: 9001,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          fontFamily: "inherit",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "22px 22px 12px" }}>
          <div style={{
            font: "600 11px/1 inherit", color: "#3083FE",
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
          }}>
            {lang === "es" ? "RECIBIR LOTE" : "RECEIVE LOT"}
          </div>
          <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 4 }}>
            {lang === "es" ? "Alta de inventario en un nodo" : "Inventory intake at a node"}
          </div>
          <div style={{ font: "500 12.5px/1.4 inherit", color: "#64748B" }}>
            {lang === "es"
              ? "Si ya hay stock con el mismo SKU + lote, se suma. Si no, se crea. Se registra un movimiento tipo RECEPCION."
              : "If stock with same SKU + lot exists, it's added. Otherwise it's created. Records a RECEPCION movement."}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 12px" }}>
          {/* Nodo destino */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Nodo destino" : "Destination node"} *
            </label>
            <select
              className="select"
              value={form.nodo_id}
              disabled={busy || loadingCatalogs}
              onChange={(e) => set("nodo_id", e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">
                — {loadingCatalogs
                    ? (lang === "es" ? "Cargando…" : "Loading…")
                    : (lang === "es" ? "Selecciona nodo" : "Select node")} —
              </option>
              {nodes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.codigo ? `${n.codigo} · ` : ""}{n.nombre || n.id}
                  {n.pais_iso2 ? ` (${n.pais_iso2})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Producto autocomplete */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Producto (SKU)" : "Product (SKU)"} *
            </label>
            <input
              className="input"
              type="text"
              placeholder={lang === "es" ? "Buscar SKU o nombre…" : "Search SKU or name…"}
              value={needle}
              onChange={(e) => { setNeedle(e.target.value); set("producto_id", ""); setPickedLabel(""); }}
              disabled={busy || loadingCatalogs}
              style={{ width: "100%" }}
            />
            {!form.producto_id && needle.trim() && (
              <div style={{
                marginTop: 6, maxHeight: 180, overflowY: "auto",
                border: "1px solid #E5E7EB", borderRadius: 8,
              }}>
                {loadingCatalogs ? (
                  <div style={{ padding: 14, color: "#64748B", font: "500 12.5px inherit" }}>
                    {lang === "es" ? "Cargando catálogo…" : "Loading catalog…"}
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div style={{ padding: 14, color: "#64748B", font: "500 12.5px inherit" }}>
                    {lang === "es" ? "Sin resultados." : "No matches."}
                  </div>
                ) : filteredProducts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProduct(p)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 12px", border: "none", background: "transparent",
                      borderBottom: "1px solid #F1F5F9", cursor: "pointer",
                      font: "500 13px inherit",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#F8FAFC"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ font: "600 12.5px ui-monospace, monospace", color: "#0F1B3D" }}>
                      {p.sku || "—"}
                    </span>
                    <span style={{ marginLeft: 8, color: "#64748B" }}>
                      {p.nombre || ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {form.producto_id && (
              <div style={{
                marginTop: 6, padding: "6px 10px", borderRadius: 6,
                background: "#ECFDF5", border: "1px solid #A7F3D0",
                color: "#065F46", font: "500 12px inherit",
              }}>
                ✓ {pickedLabel}
              </div>
            )}
          </div>

          {/* Lote + Cantidad */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Lote (opcional)" : "Lot (optional)"}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input mono-sm"
                  type="text"
                  placeholder="L-2026-04-26-A1"
                  value={form.lote}
                  onChange={(e) => set("lote", e.target.value)}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-xs" onClick={suggestLote} disabled={busy}>
                  {lang === "es" ? "Sugerir" : "Suggest"}
                </button>
              </div>
            </div>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Cantidad" : "Quantity"} *
              </label>
              <input
                className="input tabular-nums"
                type="number" min="0" step="1"
                placeholder="0"
                value={form.cantidad}
                onChange={(e) => set("cantidad", e.target.value)}
                disabled={busy}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Costo + Vencimiento */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Costo unitario USD (opcional)" : "Unit cost USD (optional)"}
              </label>
              <input
                className="input tabular-nums"
                type="number" min="0" step="0.0001"
                placeholder="0.0000"
                value={form.costo_unitario_usd}
                onChange={(e) => set("costo_unitario_usd", e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Vencimiento (opcional)" : "Expiry (optional)"}
              </label>
              <input
                className="input mono-sm"
                type="date"
                value={form.fecha_vencimiento}
                onChange={(e) => set("fecha_vencimiento", e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {/* Notas */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Notas (opcional)" : "Notes (optional)"}
            </label>
            <textarea
              className="input"
              rows={2}
              placeholder={lang === "es"
                ? "Ej: recepción inicial · OC-2026-001 · contenedor MSCU1234567"
                : "E.g. initial intake · PO-2026-001 · container MSCU1234567"}
              value={form.notas}
              onChange={(e) => set("notas", e.target.value)}
              disabled={busy}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        </div>

        {error && (
          <div style={{
            margin: "0 22px 8px", padding: "10px 12px", borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
            font: "500 12.5px/1.4 inherit",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "14px 22px 18px",
          display: "flex", gap: 10, justifyContent: "flex-end",
          borderTop: "1px solid #F1F5F9",
        }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            style={{
              padding: "10px 18px", borderRadius: 9,
              background: canSave ? "#0E8A6D" : "#94a3b888",
              color: "#FFFFFF", border: "none",
              cursor: canSave ? "pointer" : "not-allowed",
              font: "700 13.5px/1 inherit",
              boxShadow: canSave ? "0 4px 10px rgba(14,138,109,0.4)" : "none",
            }}
          >
            {busy
              ? (lang === "es" ? "Recibiendo…" : "Receiving…")
              : (lang === "es" ? "Recibir lote" : "Receive lot")}
          </button>
        </div>
      </motion.div>
    </>
  );
}
