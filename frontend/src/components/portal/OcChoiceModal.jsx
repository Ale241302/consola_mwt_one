// =====================================================================
// MWT.ONE · components/portal/OcChoiceModal.jsx
// Sprint 2026-07-16
//
// Modal que pregunta al cliente B2B si cuenta con la Orden de Compra antes
// de entrar al wizard de /portal/nueva-oc:
//   · "Sí, subir mi OC"    → Paso 1 (subir archivo).
//   · "No, agregar a mano" → Paso 2 (armar el pedido manualmente).
//
// Colores del sitio (Mint MWT / Navy) + hovers explícitos en ambos botones.
// =====================================================================
import React from "react";

const MINT      = "#00B286";
const MINT_DARK = "#008B69";
const NAVY      = "#0B1E3A";

export default function OcChoiceModal({ open, lang = "es", onYes, onNo, onClose }) {
  if (!open) return null;
  const t = (es, en) => (lang === "es" ? es : en);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(11,30,58,0.55)", backdropFilter: "blur(3px)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#FFFFFF", borderRadius: 16, padding: 28,
          width: "100%", maxWidth: 460, position: "relative",
          boxShadow: "0 24px 60px -12px rgba(11,30,58,0.45)",
        }}
      >
        <button
          type="button" onClick={onClose} aria-label={t("Cerrar", "Close")}
          style={{
            position: "absolute", top: 14, right: 14, width: 30, height: 30,
            border: "none", background: "transparent", borderRadius: 8,
            color: "#64748B", fontSize: 18, lineHeight: 1, cursor: "pointer",
            transition: "background 140ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#F1F5F9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >×</button>

        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
          textTransform: "uppercase", color: MINT,
        }}>
          {t("Nueva orden de compra", "New purchase order")}
        </div>
        <h2 style={{ margin: "8px 0 6px", fontSize: 20, fontWeight: 800, color: NAVY }}>
          {t("¿Cuentas con la orden de compra?", "Do you have the purchase order?")}
        </h2>
        <p style={{ margin: "0 0 22px", fontSize: 13.5, lineHeight: 1.5, color: "#64748B" }}>
          {t(
            "Si tenés el archivo de tu OC, subilo y lo leemos por vos. Si no, armá tu pedido agregando los productos a mano.",
            "If you have your PO file, upload it and we'll read it for you. If not, build your order by adding the products manually.",
          )}
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button" onClick={onYes}
            style={{
              flex: 1, minWidth: 150, padding: "12px 18px", borderRadius: 11,
              border: "none", background: MINT, color: "#FFFFFF",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,178,134,0.30)",
              transition: "background 140ms ease, transform 140ms ease, box-shadow 140ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = MINT_DARK;
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,178,134,0.40)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = MINT;
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,178,134,0.30)";
            }}
          >
            {t("Sí, subir mi OC", "Yes, upload my PO")}
          </button>

          <button
            type="button" onClick={onNo}
            style={{
              flex: 1, minWidth: 150, padding: "12px 18px", borderRadius: 11,
              border: `1.5px solid ${NAVY}`, background: "#FFFFFF", color: NAVY,
              fontSize: 14, fontWeight: 700, cursor: "pointer",
              transition: "background 140ms ease, color 140ms ease, transform 140ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NAVY;
              e.currentTarget.style.color = "#FFFFFF";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#FFFFFF";
              e.currentTarget.style.color = NAVY;
              e.currentTarget.style.transform = "none";
            }}
          >
            {t("No, agregar a mano", "No, add manually")}
          </button>
        </div>
      </div>
    </div>
  );
}
