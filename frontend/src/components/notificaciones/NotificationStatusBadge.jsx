// ─────────────────────────────────────────────────────────────
// NotificationStatusBadge — Badge reutilizable de estado de envío
// Agente responsable: [AG-FRONTEND]
//
// Mapea estrictamente los 5 estados del NotificationLog a la
// paleta MWT.ONE. Aceptado en title-case (Sent / Skipped / ...)
// y lowercase (sent / skipped / ...).
//
//   Sent       → Success  #0E8A6D
//   Skipped    → Neutral  #64748B
//   Disabled   → Warning  #B45309
//   Exhausted  → Critical #DC2626
//   Failed     → Critical #DC2626
// ─────────────────────────────────────────────────────────────
import React from "react";

// Paleta estricta — no se mueve
export const NOTIFICATION_BADGE_COLORS = {
  sent:      { color:'#0E8A6D', soft:'rgba(14,138,109,0.14)',  tone:'success',  label:'Sent'      },
  skipped:   { color:'#64748B', soft:'rgba(100,116,139,0.14)', tone:'neutral',  label:'Skipped'   },
  disabled:  { color:'#B45309', soft:'rgba(180,83,9,0.14)',    tone:'warning',  label:'Disabled'  },
  exhausted: { color:'#DC2626', soft:'rgba(220,38,38,0.14)',   tone:'critical', label:'Exhausted' },
  failed:    { color:'#DC2626', soft:'rgba(220,38,38,0.14)',   tone:'critical', label:'Failed'    },
};

export default function NotificationStatusBadge({ status, size='md', showDot=true, className='' }) {
  const key = String(status || '').toLowerCase();
  const meta = NOTIFICATION_BADGE_COLORS[key] || {
    color:'#6B7280', soft:'rgba(107,114,128,0.14)', tone:'neutral', label: status || '—'
  };
  const cls = `nh-badge nh-badge-${size} ${className}`.trim();
  return (
    <span
      className={cls}
      style={{
        color: meta.color,
        background: meta.soft,
        borderColor: `${meta.color}55`,
      }}
    >
      {showDot && (
        <span className="nh-badge-dot" style={{ background: meta.color }}/>
      )}
      <span className="nh-badge-label">{meta.label.toUpperCase()}</span>
    </span>
  );
}
