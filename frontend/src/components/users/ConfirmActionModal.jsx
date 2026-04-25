// =====================================================================
// MWT.ONE · components/users/ConfirmActionModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal compartido entre Users.jsx y UserFormView.jsx para reemplazar
// los `window.confirm` nativos. Soporta 4 acciones: reset password /
// activar / inactivar / eliminar. El color del CTA y el copy se
// configuran por `kind` desde ACTION_META — fuente única.
//
// Uso:
//   const [pending, setPending] = useState(null); // {kind, user}
//   ...
//   {pending && createPortal(
//     <ConfirmActionModal
//        meta={ACTION_META[pending.kind]}
//        user={pending.user}
//        busy={...}
//        error={...}
//        lang={lang}
//        onCancel={...} onConfirm={...}
//     />,
//     document.body
//   )}
// =====================================================================
import React from "react";
import { motion } from "framer-motion";

export const ACTION_META = {
  reset: {
    eyebrow:    'EMAIL DE RESETEO',
    title:      '¿Enviar email de reseteo de contraseña?',
    bodyEs:     u => <>Le llegará un correo a <strong>{u.contact_email || u.email_plain}</strong> con un enlace válido por 24 horas para definir una nueva contraseña.</>,
    actionLabelEs: 'Enviar email',
    actionColor:'#3083FE',
  },
  toggleOff: {
    eyebrow:    'CAMBIO DE ESTADO',
    title:      '¿Inactivar este usuario?',
    bodyEs:     u => <>El usuario <strong>{u.full_name || u.email_plain}</strong> dejará de poder iniciar sesión inmediatamente. Su sesión activa será cerrada en el próximo request. Es reversible.</>,
    actionLabelEs: 'Sí, inactivar',
    actionColor:'#F59E0B',
  },
  toggleOn: {
    eyebrow:    'CAMBIO DE ESTADO',
    title:      '¿Reactivar este usuario?',
    bodyEs:     u => <>El usuario <strong>{u.full_name || u.email_plain}</strong> podrá volver a iniciar sesión inmediatamente con sus credenciales actuales.</>,
    actionLabelEs: 'Sí, reactivar',
    actionColor:'#10B981',
  },
  delete: {
    eyebrow:    'ACCIÓN DESTRUCTIVA',
    title:      '¿Eliminar este usuario?',
    bodyEs:     u => <>Vas a eliminar <strong>{u.full_name || u.email_plain}</strong>. Es soft-delete: el usuario queda marcado como eliminado en BD, no podrá hacer login y desaparece de los listados activos. El historial se conserva.</>,
    actionLabelEs: 'Sí, eliminar',
    actionColor:'#DC2626',
  },
};

export default function ConfirmActionModal({ meta, user, busy, error, lang, onCancel, onConfirm }) {
  if (!meta || !user) return null;
  const body = meta.bodyEs(user);
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(15,27,61,0.45)", backdropFilter: "blur(2px)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "12vh", left: "50%",
          width: "min(440px, 92vw)", zIndex: 9001,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          fontFamily: "inherit",
        }}
      >
        <div style={{ padding: "22px 22px 12px" }}>
          <div style={{
            font: "600 11px/1 inherit", color: meta.actionColor,
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
          }}>
            {meta.eyebrow}
          </div>
          <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 8 }}>
            {meta.title}
          </div>
          <div style={{ font: "500 13.5px/1.5 inherit", color: "#3D4A6B" }}>
            {body}
          </div>
          {error && (
            <div style={{
              marginTop: 14, padding: "10px 12px", borderRadius: 8,
              background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
              font: "500 12.5px/1.4 inherit",
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={{
          padding: "14px 22px 18px",
          display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
                  style={{
                    padding: "10px 16px", borderRadius: 9,
                    background: busy ? `${meta.actionColor}88` : meta.actionColor,
                    color: "#FFFFFF", border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    font: "700 13.5px/1 inherit",
                    boxShadow: busy ? "none" : `0 4px 10px ${meta.actionColor}40`,
                  }}>
            {busy
              ? (lang === "es" ? "Procesando…" : "Processing…")
              : meta.actionLabelEs}
          </button>
        </div>
      </motion.div>
    </>
  );
}
