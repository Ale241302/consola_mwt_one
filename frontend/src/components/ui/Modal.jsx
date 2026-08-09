// MWT.ONE · components/ui/Modal.jsx
// Shell de modal accesible reutilizable (focus trap + Escape + restore).
// Ola 3 · 3.25 · Accesibilidad.
import React from "react";
import { useDialogA11y } from "../../lib/a11y/useDialogA11y.js";
import { useAutoId } from "../../lib/a11y/useAutoId.js";
import { IconX } from "../../lib/icons.jsx";

export default function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const titleId = useAutoId("modal-title");
  const ref = useDialogA11y({ open, onClose });
  if (!open) return null;
  return (
    <div className="mwt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`mwt-modal mwt-modal--${size}`}
        tabIndex={-1}
      >
        <div className="mwt-modal-head">
          <h2 id={titleId} className="mwt-modal-title">{title}</h2>
          <button type="button" className="mwt-modal-close" aria-label="Cerrar" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="mwt-modal-body">{children}</div>
        {footer && <div className="mwt-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
