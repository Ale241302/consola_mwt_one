// MWT.ONE · features/transfers/liquidation/components/SummaryStat.jsx
// Stat del resumen de landed cost. Ola 3 · 3.28.
import React from "react";

export default function SummaryStat({ label, value, color, strong }) {
  return (
    <div>
      <div className="micro" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: 1, marginBottom: 4 }}>
        {label}
      </div>
      <div className="tabular-nums" style={{
        fontSize: strong ? 24 : 18, fontWeight: 700,
        color: color || "#fff",
      }}>
        {value}
      </div>
    </div>
  );
}
