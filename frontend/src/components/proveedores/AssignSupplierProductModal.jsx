// =====================================================================
// MWT.ONE · components/proveedores/AssignSupplierProductModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal de "Asignar SKU al proveedor" (catálogo de abastecimiento).
// Pide: SKU MWT (con autocomplete sobre el catálogo real de productos),
// código que la fábrica usa, MOQ, costo FOB, lead time. Al confirmar
// hace POST /api/proveedores/{id}/products/.
//
// Solo el rol admin puede ver / editar el costo (defensa visual; el
// backend también filtra el campo en GET vía POL_VISIBILIDAD).
// =====================================================================
import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { productosApi } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";

export default function AssignSupplierProductModal({
  supplierName = "",
  excludeSkus  = [],          // ya asignados, se filtran del autocomplete
  lang         = "es",
  onClose,
  onAssign,                   // async (body) => res
}) {
  const { isAdmin } = useRole();

  const [allProducts, setAllProducts] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [needle, setNeedle]           = useState("");
  const [selectedSku, setSelectedSku] = useState("");
  const [selectedName, setSelectedName] = useState("");

  const [form, setForm] = useState({
    supplier_sku_code: "",
    moq:               0,
    base_cost_usd:     "",
    production_lead_time_days: 0,
    notas: "",
  });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  // Cargar catálogo de productos para el autocomplete
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await productosApi.list();
        if (alive) setAllProducts(Array.isArray(list) ? list : []);
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Productos filtrables (no asignados aún + match con búsqueda)
  const excluded = useMemo(() => new Set(excludeSkus), [excludeSkus]);
  const filtered = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return allProducts
      .filter(p => p.sku && !excluded.has(p.sku))
      .filter(p => {
        if (!n) return true;
        const hay = `${p.sku} ${p.nombre || ""}`.toLowerCase();
        return hay.includes(n);
      })
      .slice(0, 50); // tope para no inundar la lista
  }, [allProducts, excluded, needle]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickSku = (p) => {
    setSelectedSku(p.sku);
    setSelectedName(p.nombre || "");
    setNeedle(`${p.sku} · ${p.nombre || ""}`);
  };

  const canSave = !!selectedSku && !busy;

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        product_sku:       selectedSku,
        supplier_sku_code: form.supplier_sku_code || null,
        moq:               Number(form.moq) || 0,
        production_lead_time_days: Number(form.production_lead_time_days) || 0,
        notas:             form.notas || null,
      };
      if (isAdmin && form.base_cost_usd !== "") {
        body.base_cost_usd = Number(form.base_cost_usd);
      }
      await onAssign(body);
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
      {/* Tarjeta */}
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "8vh", left: "50%",
          width: "min(640px, 94vw)",
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
            {lang === "es" ? "ASIGNAR SKU AL PROVEEDOR" : "ASSIGN SKU TO SUPPLIER"}
          </div>
          <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 4 }}>
            {lang === "es" ? "Catálogo de abastecimiento" : "Supply catalog"}
          </div>
          <div style={{ font: "500 12.5px/1.4 inherit", color: "#64748B" }}>
            {(lang === "es" ? "Definí los términos comerciales que esta fábrica usa para el SKU. " : "Define the commercial terms this factory uses for the SKU. ")}
            {supplierName && <strong style={{ color: "#0F1B3D" }}>{supplierName}</strong>}
          </div>
        </div>

        {/* Body scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 12px" }}>
          {/* SKU autocomplete */}
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B",
              marginBottom: 6, letterSpacing: "0.04em",
            }}>
              {lang === "es" ? "SKU MWT" : "MWT SKU"} *
            </label>
            <input
              className="input"
              type="text"
              placeholder={lang === "es" ? "Buscar SKU o nombre…" : "Search SKU or name…"}
              value={needle}
              onChange={(e) => { setNeedle(e.target.value); setSelectedSku(""); setSelectedName(""); }}
              disabled={busy}
              style={{ width: "100%" }}
            />
            {!selectedSku && needle.trim().length > 0 && (
              <div style={{
                marginTop: 6, maxHeight: 180, overflowY: "auto",
                border: "1px solid #E5E7EB", borderRadius: 8,
                background: "#FFFFFF",
              }}>
                {loadingList ? (
                  <div style={{ padding: 14, color: "#64748B", font: "500 12.5px inherit" }}>
                    {lang === "es" ? "Cargando catálogo…" : "Loading catalog…"}
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 14, color: "#64748B", font: "500 12.5px inherit" }}>
                    {lang === "es" ? "Sin resultados." : "No matches."}
                  </div>
                ) : filtered.map(p => (
                  <button
                    key={p.id || p.sku}
                    type="button"
                    onClick={() => pickSku(p)}
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
                      {p.sku}
                    </span>
                    <span style={{ marginLeft: 8, color: "#64748B" }}>
                      {p.nombre || "—"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedSku && (
              <div style={{
                marginTop: 6, padding: "8px 12px",
                background: "#ECFDF5", border: "1px solid #A7F3D0",
                borderRadius: 8, font: "500 12.5px inherit", color: "#065F46",
              }}>
                ✓ {selectedSku}{selectedName ? ` · ${selectedName}` : ""}
              </div>
            )}
          </div>

          {/* Grid 2 columnas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Código de fábrica" : "Factory code"}
              </label>
              <input
                className="input mono-sm" type="text"
                placeholder="MARLU-A102"
                value={form.supplier_sku_code}
                onChange={(e) => set("supplier_sku_code", e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "MOQ (pedido mínimo)" : "MOQ (minimum order)"}
              </label>
              <input
                className="input tabular-nums" type="number" min="0"
                value={form.moq}
                onChange={(e) => set("moq", e.target.value)}
                disabled={busy}
              />
            </div>

            {isAdmin && (
              <div>
                <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#B45309", marginBottom: 6 }}>
                  {lang === "es" ? "🔒 Costo FOB USD (CEO-only)" : "🔒 Base cost USD (CEO-only)"}
                </label>
                <input
                  className="input tabular-nums" type="number" min="0" step="0.0001"
                  placeholder="0.0000"
                  value={form.base_cost_usd}
                  onChange={(e) => set("base_cost_usd", e.target.value)}
                  disabled={busy}
                  style={{ borderColor: "#FCD34D" }}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
                {lang === "es" ? "Lead time (días)" : "Lead time (days)"}
              </label>
              <input
                className="input tabular-nums" type="number" min="0" max="365"
                value={form.production_lead_time_days}
                onChange={(e) => set("production_lead_time_days", e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Notas internas (opcional)" : "Internal notes (optional)"}
            </label>
            <textarea
              className="input" rows={2}
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
              padding: "10px 16px", borderRadius: 9,
              background: canSave ? "#3083FE" : "#3083FE88",
              color: "#FFFFFF", border: "none",
              cursor: canSave ? "pointer" : "not-allowed",
              font: "700 13.5px/1 inherit",
              boxShadow: canSave ? "0 4px 10px rgba(48,131,254,0.4)" : "none",
            }}
          >
            {busy
              ? (lang === "es" ? "Asignando…" : "Assigning…")
              : (lang === "es" ? "Asignar SKU"  : "Assign SKU")}
          </button>
        </div>
      </motion.div>
    </>
  );
}
