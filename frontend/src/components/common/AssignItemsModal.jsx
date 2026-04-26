// =====================================================================
// MWT.ONE · components/common/AssignItemsModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal genérico de asignación múltiple. Lista los items disponibles
// (con buscador), permite seleccionar varios con checkbox, y dispara
// onAssign(selectedIds[]) al confirmar.
//
// El llamador es responsable de:
//   · cargar la lista `items` (cada item DEBE tener id, title, subtitle?, meta?)
//   · ejecutar el batch de updates en `onAssign`
//   · cerrar el modal con `onClose`
//
// Uso:
//   {open && createPortal(
//     <AssignItemsModal
//        title="Asignar productos a Jinjiang CN"
//        eyebrow="ASIGNAR SKUs"
//        items={availableProducts}        // [{id, title, subtitle, meta}]
//        loading={loadingAvail}
//        actionLabel="Asignar"
//        onClose={()=>setOpen(false)}
//        onAssign={async (ids) => { ... await Promise.all(...); }}
//     />, document.body)}
// =====================================================================
import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";

export default function AssignItemsModal({
  eyebrow,
  title,
  items = [],
  loading = false,
  actionLabel = "Asignar",
  cancelLabel = "Cancelar",
  emptyHint = "No hay items disponibles para asignar.",
  searchPlaceholder = "Buscar…",
  onClose,
  onAssign,
}) {
  const [selected, setSelected] = useState(new Set());
  const [needle, setNeedle]     = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const filtered = useMemo(() => {
    const n = needle.trim().toLowerCase();
    if (!n) return items;
    return items.filter(it => {
      const hay = [it.title, it.subtitle, it.meta].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(n);
    });
  }, [items, needle]);

  const allFilteredSelected = filtered.length > 0
    && filtered.every(it => selected.has(it.id));

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach(it => next.delete(it.id));
      } else {
        filtered.forEach(it => next.add(it.id));
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await onAssign(Array.from(selected));
      onClose?.();
    } catch (e) {
      setError(String(e?.message || e));
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
      {/* Tarjeta — más ancha que ConfirmModal porque hay tabla */}
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "10vh", left: "50%",
          width: "min(680px, 94vw)",
          maxHeight: "80vh",
          zIndex: 9001,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          fontFamily: "inherit",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "22px 22px 12px" }}>
          {eyebrow && (
            <div style={{
              font: "600 11px/1 inherit", color: "#3083FE",
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
            }}>
              {eyebrow}
            </div>
          )}
          {title && (
            <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 12 }}>
              {title}
            </div>
          )}
          <input
            type="text"
            className="input"
            placeholder={searchPlaceholder}
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            disabled={busy}
            style={{ width: "100%" }}
          />
        </div>

        {/* Tabla scrollable */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "0 22px",
          minHeight: 100,
        }}>
          {loading ? (
            <div style={{
              padding: 32, textAlign: "center",
              font: "500 13px/1.4 inherit", color: "#64748B",
            }}>
              Cargando…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{
              padding: 32, textAlign: "center",
              font: "500 13px/1.4 inherit", color: "#64748B",
            }}>
              {needle ? "Sin resultados para tu búsqueda." : emptyHint}
            </div>
          ) : (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 0", borderBottom: "1px solid #E5E7EB",
                font: "600 11px/1 inherit", color: "#64748B",
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  disabled={busy}
                />
                <span>Seleccionar todo ({filtered.length})</span>
              </div>
              {filtered.map(it => {
                const on = selected.has(it.id);
                return (
                  <label
                    key={it.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 0", borderBottom: "1px solid #F1F5F9",
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => !busy && toggle(it.id)}
                      disabled={busy}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: "600 13.5px/1.3 inherit", color: "#0F1B3D" }}>
                        {it.title}
                      </div>
                      {it.subtitle && (
                        <div style={{ font: "500 12px/1.3 inherit", color: "#64748B", marginTop: 2 }}>
                          {it.subtitle}
                        </div>
                      )}
                    </div>
                    {it.meta && (
                      <div style={{
                        font: "600 12px/1.3 inherit", color: "#3D4A6B",
                        whiteSpace: "nowrap",
                      }}>
                        {it.meta}
                      </div>
                    )}
                  </label>
                );
              })}
            </>
          )}
        </div>

        {error && (
          <div style={{
            margin: "12px 22px 0", padding: "10px 12px", borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
            font: "500 12.5px/1.4 inherit",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "14px 22px 18px",
          display: "flex", gap: 10, justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #F1F5F9", marginTop: 8,
        }}>
          <div style={{ font: "500 12.5px/1.3 inherit", color: "#64748B" }}>
            {selected.size > 0 ? `${selected.size} seleccionado${selected.size!==1?"s":""}` : ""}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || selected.size === 0}
              style={{
                padding: "10px 16px", borderRadius: 9,
                background: (busy || selected.size === 0) ? "#3083FE88" : "#3083FE",
                color: "#FFFFFF", border: "none",
                cursor: (busy || selected.size === 0) ? "not-allowed" : "pointer",
                font: "700 13.5px/1 inherit",
                boxShadow: (busy || selected.size === 0)
                  ? "none"
                  : "0 4px 10px rgba(48,131,254,0.4)",
              }}
            >
              {busy ? "Asignando…" : `${actionLabel}${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
