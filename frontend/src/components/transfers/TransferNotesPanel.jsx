// =====================================================================
// MWT.ONE · components/transfers/TransferNotesPanel.jsx
// Agente responsable: [AG-FRONTEND]
//
// Panel de notas operativas en /transferencias/{id} (sprint 2026-04-30).
//
// Reemplaza el card "NOTAS" read-only (un solo string) por un ledger:
//   · Lista cada nota con timestamp, autor y trash icon para eliminar.
//   · Textarea + botón "+ Agregar nota" para crear nuevas.
//   · Persiste en transfers.transferencia.notes_log (JSONB array,
//     migración 91l_transfers_notes_log.sql).
// =====================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconTrash, IconFileText, IconPlus } from "../../lib/icons.jsx";
import { transferDetailApi } from "../../lib/api.js";

const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const GREY  = "#6B7280";
const RED   = "#DC2626";
const VIOLET = "#481EE3";

function fmtDateTime(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(s).slice(0, 16); }
}

export default function TransferNotesPanel({
  lang = "es",
  transferId,
  initialNotes = [],   // [{id, text, created_at, created_by_name}] o legacy "string"
  legacyNote = "",     // por si la transferencia aún tiene el campo plano
  readOnly = false,
}) {
  // Aceptamos tanto array (notes_log) como string legacy (notes).
  const initial = Array.isArray(initialNotes) ? initialNotes
                : (legacyNote
                    ? [{ id: "legacy", text: legacyNote, created_at: null, created_by_name: "" }]
                    : []);
  const [notes, setNotes] = useState(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Si el padre vuelve a montar con notes nuevas (después de un reload),
  // sincronizamos.
  useEffect(() => {
    if (Array.isArray(initialNotes)) setNotes(initialNotes);
  }, [initialNotes]);

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setSaving(true);
    try {
      const res = await transferDetailApi.addNote(transferId, text);
      setNotes(res?.notes_log || []);
      setDraft("");
    } catch (e) {
      setError(lang === "es" ? "No se pudo agregar la nota." : "Could not add note.");
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (noteId) => {
    if (!noteId || noteId === "legacy") {
      // Soporte para borrar la nota legacy (plana). Solo la quitamos del UI;
      // el backend la sigue manteniendo en `notes` hasta que el CEO decida
      // limpiar manualmente (la migración 91l ya hace backfill).
      setNotes((arr) => arr.filter((n) => n.id !== "legacy"));
      return;
    }
    if (!window.confirm(lang === "es" ? "¿Eliminar esta nota?" : "Delete this note?")) return;
    try {
      const res = await transferDetailApi.removeNote(transferId, noteId);
      setNotes(res?.notes_log || []);
    } catch {
      setError(lang === "es" ? "No se pudo eliminar." : "Could not delete.");
    }
  };

  return (
    <div className="card card-pad-md" style={{ marginTop: 16 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 12, marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconFileText size={14} style={{ color: NAVY }}/>
          <div>
            <div className="micro" style={{ color: NAVY, letterSpacing: 1 }}>
              {lang === "es" ? "NOTAS" : "NOTES"}
              <span style={{ marginLeft: 8, color: GREY }}>· {notes.length}</span>
            </div>
            <div className="caption" style={{ color: GREY, marginTop: 2 }}>
              {lang === "es"
                ? "Ledger de comentarios. Cada nota queda con timestamp y autor."
                : "Comment ledger. Each note is timestamped with author."}
            </div>
          </div>
        </div>
      </div>

      {/* Error inline */}
      {error && (
        <div style={{
          background: "rgba(220,38,38,0.06)", color: RED,
          padding: "8px 12px", borderRadius: 6, fontSize: 12.5, marginBottom: 12,
        }}>{error}</div>
      )}

      {/* Form de nueva nota */}
      {!readOnly && (
        <div style={{
          display: "flex", gap: 8, marginBottom: 12,
          alignItems: "flex-start",
        }}>
          <textarea
            className="input"
            rows={2}
            placeholder={lang === "es"
              ? "Escribe una nota sobre esta transferencia…"
              : "Write a note about this transfer…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                addNote();
              }
            }}
            style={{
              flex: 1, fontSize: 13, padding: "8px 10px",
              fontFamily: "inherit", resize: "vertical",
            }}
          />
          <button
            type="button"
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="btn"
            style={{
              background: draft.trim() ? MINT : "#F3F5F8",
              color: draft.trim() ? "#fff" : GREY,
              padding: "8px 14px", fontSize: 12, fontWeight: 600,
              borderRadius: 8, alignSelf: "stretch",
              cursor: draft.trim() ? "pointer" : "not-allowed",
            }}
          >
            {saving
              ? "…"
              : (<><IconPlus size={11} style={{ verticalAlign: "-1px" }}/>{" "}
                   {lang === "es" ? "Agregar" : "Add"}</>)}
          </button>
        </div>
      )}

      {/* Lista de notas */}
      {notes.length === 0 ? (
        <div style={{
          padding: 16, textAlign: "center", color: GREY, fontSize: 13,
          background: "#FAFBFC", borderRadius: 8,
        }}>
          {lang === "es" ? "Sin notas todavía." : "No notes yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AnimatePresence>
            {notes.map((n) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: -8 }}
                style={{
                  background: "#fff",
                  border: "1px solid rgba(11,30,58,0.08)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10, alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{
                    fontSize: 13, color: NAVY, lineHeight: 1.5,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {n.text}
                  </div>
                  <div style={{
                    marginTop: 6, fontSize: 10.5, color: GREY,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      padding: "1px 6px", borderRadius: 4,
                      background: "rgba(11,30,58,0.04)",
                    }}>
                      {fmtDateTime(n.created_at)}
                    </span>
                    {n.created_by_name && (
                      <span style={{ fontWeight: 600, color: VIOLET }}>
                        · {n.created_by_name}
                      </span>
                    )}
                    {n.id === "legacy" && (
                      <span style={{
                        marginLeft: "auto", padding: "1px 8px", borderRadius: 999,
                        background: "rgba(180,83,9,0.10)", color: "#B45309",
                        fontSize: 10, fontWeight: 700,
                      }}>
                        LEGACY
                      </span>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    title={lang === "es" ? "Eliminar nota" : "Remove note"}
                    className="btn btn-ghost btn-sm"
                    style={{
                      color: RED, padding: "4px 6px",
                      alignSelf: "center",
                    }}
                  >
                    <IconTrash size={13}/>
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
