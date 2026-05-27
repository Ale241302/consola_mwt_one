// ─────────────────────────────────────────────────────────────
// TransferBuilderArtifactsBlock — Artefactos del Builder ligados
// a una transferencia. Sprint 2026-05-14 · Fase 16.
//
// CEO: "Debe haber un botón 'Agregar artefacto' en el detalle de la
// transferencia, con scope picker idéntico al paso 3 del wizard de
// recepción, pero con los expedientes y productos que están en ESTA
// transferencia (con la talla y cantidad que se guardaron al crearla)."
//
// Flow:
//   1. Click "+ Agregar artefacto" → ArtifactScopeModal con
//      inMemoryExpedientes + inMemoryLines derivados de transfer.lineas.
//   2. Usuario elige expedientes + líneas (con descuento por uso previo
//      del mismo template, vía el endpoint available-lines del backend).
//   3. ArtifactPickerModal → elige template del Builder externo.
//   4. ArtifactFillModal → llena los campos del template.
//   5. POST a /api/transferencias/{trf_id}/builder-artifacts/.
//
// Persiste en la tabla nodos.builder_artifact_instance ampliada con
// transferencia_id (SQL B3). Reutiliza ArtifactScopeModal, Picker, Fill
// (mismos componentes del módulo nodos).
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  IconPlus, IconFileText, IconPencil, IconTrash,
} from "../../lib/icons.jsx";
import {
  transferBuilderArtifactsApi, builderTemplatesApi,
} from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";

// Reusamos los modales del módulo nodos.
import ArtifactScopeModal  from "../nodos/ArtifactScopeModal.jsx";
import ArtifactPickerModal from "../expedientes/builderArtifacts/ArtifactPickerModal.jsx";
import ArtifactFillModal   from "../expedientes/builderArtifacts/ArtifactFillModal.jsx";
import ConfirmModal        from "../common/ConfirmModal.jsx";

export default function TransferBuilderArtifactsBlock({
  /** transfer { _backend_id, lines | lineas (enriquecidas con expediente_codigo) } */
  transfer,
  lang = "es",
}) {
  const { isClient } = useRole();
  const readOnly = isClient;
  const trfId = transfer?._backend_id || transfer?.id;

  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Flow modal · scope → picker → fill
  const [scopeMode,        setScopeMode]        = useState(null);
  const [scopePayload,     setScopePayload]     = useState(null);
  const [editingInstance,  setEditingInstance]  = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [creating,   setCreating]   = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy,    setDeleteBusy]    = useState(false);
  const [deleteError,   setDeleteError]   = useState(null);

  // ── Derivar datos en memoria desde transfer.lineas ──────────
  // El ArtifactScopeModal sabe trabajar con `inMemoryExpedientes` +
  // `inMemoryLines` (pattern del wizard de recepción paso 3). El
  // backend retrieve() ya enriquece cada linea con expediente_codigo
  // y expediente_id (Fase 11.2), así que esto es trivial.
  const inMemoryExpedientes = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];
    const map = new Map();
    for (const l of lineas) {
      const expId = l.expediente_id;
      if (!expId) continue;
      if (!map.has(expId)) {
        map.set(expId, {
          expediente_id:    expId,
          expediente_codigo: l.expediente_codigo || "",
          proforma_codigo:   l.proforma_codigo  || "",
        });
      }
    }
    return Array.from(map.values());
  }, [transfer]);

  const inMemoryLines = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];
    return lineas
      .filter((l) => l.expediente_id)
      .map((l) => ({
        expediente_id:    l.expediente_id,
        expediente_codigo: l.expediente_codigo || "",
        producto_id:      l._raw?.producto_id || l.producto_id || "",
        sku:              l.sku || "",
        nombre:           l.product_label || l.product || l.sku || "",
        talla:            l.size || "",
        qty_disponible:   Number(l.qty_transfer || 0),
      }));
  }, [transfer]);

  // ── Cargar instancias ──────────────────────────────────────
  const reload = useCallback(() => {
    if (!trfId) return;
    setLoading(true); setError(null);
    transferBuilderArtifactsApi.list(trfId)
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setItems(arr);
      })
      .catch((e) => setError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error cargando artefactos" : "Error loading artifacts")))
      .finally(() => setLoading(false));
  }, [trfId, lang]);

  useEffect(() => { reload(); }, [reload]);

  // ── Flow create: scope → picker → fill ─────────────────────
  const handleScopeCreateSubmit = (payload) => {
    setScopePayload(payload);
    setScopeMode(null);
    setShowPicker(true);
  };

  const handlePickTemplate = async (tpl) => {
    let fresh = tpl;
    try { fresh = await builderTemplatesApi.get(tpl.id); } catch {}
    setCreating({ template: fresh });
    setShowPicker(false);
  };

  const handleCreateSubmit = async (data) => {
    if (!creating) return;
    setSaving(true);
    try {
      await transferBuilderArtifactsApi.create(trfId, {
        template_id:        creating.template.id,
        template_title:     creating.template.title,
        data,
        structure_snapshot: creating.template.structure_json || { sections: [] },
        lines:              scopePayload?.lines || [],
      });
      setCreating(null);
      setScopePayload(null);
      reload();
    } catch (e) {
      alert((lang === "es" ? "Error al crear: " : "Create error: ") +
            (e?.body?.detail || e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit (campos) ─────────────────────────────────────────
  const handleEditSubmit = async (data) => {
    if (!editing) return;
    setSaving(true);
    try {
      await transferBuilderArtifactsApi.update(trfId, editing.id, { data });
      setEditing(null);
      reload();
    } catch (e) {
      alert((lang === "es" ? "Error al guardar: " : "Save error: ") +
            (e?.body?.detail || e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit scope ────────────────────────────────────────────
  const handleEditScopeSubmit = async (payload) => {
    if (!editingInstance) return;
    setSaving(true);
    try {
      await transferBuilderArtifactsApi.update(trfId, editingInstance.id, {
        lines: payload.lines,
      });
      setScopeMode(null);
      setEditingInstance(null);
      reload();
    } catch (e) {
      alert((lang === "es" ? "Error al guardar alcance: " : "Scope save error: ") +
            (e?.body?.detail || e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = async (it) => {
    try {
      const full = await transferBuilderArtifactsApi.get(trfId, it.id);
      setEditing(full);
    } catch {
      setEditing(it);
    }
  };

  // ── Delete con ConfirmModal ────────────────────────────────
  const requestDelete = (it) => { setDeleteError(null); setPendingDelete(it); };
  const cancelDelete  = () => { if (deleteBusy) return; setPendingDelete(null); setDeleteError(null); };
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      await transferBuilderArtifactsApi.remove(trfId, pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setDeleteError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error al eliminar" : "Delete error"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const noLines = inMemoryExpedientes.length === 0;

  return (
    <div className="card card-pad-md" style={{ marginBottom: 14 }}>
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 12 }}>
        {lang === "es" ? "ARTEFACTOS" : "ARTIFACTS"}
      </div>

      <div style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginBottom: 10 }}>
        <div className="caption" style={{ color: "var(--text-secondary)" }}>
          {items.length}{" "}
          {lang === "es" ? "artefacto(s) vinculados a este movimiento" : "artifact(s) linked to this transfer"}
        </div>
        {!readOnly && (
          <button type="button" className="btn btn-primary btn-sm"
                  disabled={!trfId || noLines}
                  title={noLines
                    ? (lang === "es" ? "El movimiento no tiene líneas con expediente" : "Transfer has no lines with expediente")
                    : ""}
                  onClick={() => { setScopePayload(null); setScopeMode("create"); }}>
            <IconPlus size={13}/>
            {lang === "es" ? "Agregar artefacto" : "Add artifact"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="caption" style={{ color: "var(--text-tertiary)", padding: "10px 0" }}>
          {lang === "es" ? "Cargando…" : "Loading…"}
        </div>
      ) : error ? (
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{
          padding: "20px 18px", textAlign: "center",
          border: "1px dashed var(--border-subtle)", borderRadius: 10,
          color: "var(--text-tertiary)", fontSize: 13,
        }}>
          {lang === "es"
            ? "Sin artefactos. Agrega proformas, BL/AWB, facturas u otros documentos del Builder."
            : "No artifacts. Add proformas, BL/AWB, invoices or other Builder documents."}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}>
          {items.map((it) => (
            <ArtifactCard
              key={it.id}
              instance={it}
              readOnly={readOnly}
              lang={lang}
              onEdit={() => openEdit(it)}
              onEditScope={async () => {
                try {
                  const full = await transferBuilderArtifactsApi.get(trfId, it.id);
                  setEditingInstance(full);
                  setScopeMode("edit-scope-only");
                } catch (e) {
                  alert((lang === "es" ? "Error: " : "Error: ") +
                        (e?.body?.detail || e?.message || ""));
                }
              }}
              onDelete={() => requestDelete(it)}
            />
          ))}
        </div>
      )}

      {/* ── Modal 0 · Scope (create) ─────────────────────────── */}
      {scopeMode === "create" && (
        <ArtifactScopeModal
          /* nodeId requerido por la firma, pero al pasar inMemory* el
             modal no llama a la API; lo dejamos como string vacío. */
          nodeId={transfer?._raw?.destino_id || ""}
          lang={lang}
          inMemoryExpedientes={inMemoryExpedientes}
          inMemoryLines={inMemoryLines}
          onCancel={() => setScopeMode(null)}
          onSubmit={handleScopeCreateSubmit}
          submitLabel={lang === "es"
            ? "Siguiente — elegir plantilla"
            : "Next — pick template"}
        />
      )}
      {scopeMode === "edit-scope-only" && editingInstance && (
        <ArtifactScopeModal
          nodeId={transfer?._raw?.destino_id || ""}
          templateId={editingInstance.template_id}
          templateTitle={editingInstance.template_title}
          excludeInstanceId={editingInstance.id}
          initialLines={editingInstance.lines || []}
          initialExpedienteIds={
            Array.from(new Set((editingInstance.lines || [])
              .map((l) => l.expediente_id)))
          }
          inMemoryExpedientes={inMemoryExpedientes}
          inMemoryLines={inMemoryLines}
          lang={lang}
          onCancel={() => { setScopeMode(null); setEditingInstance(null); }}
          onSubmit={handleEditScopeSubmit}
          submitLabel={lang === "es" ? "Guardar alcance" : "Save scope"}
        />
      )}

      {/* ── Modal 1 · Picker de templates ─────────────────────── */}
      {showPicker && (
        <ArtifactPickerModal
          lang={lang}
          onPick={handlePickTemplate}
          onClose={() => { setShowPicker(false); setScopePayload(null); }}
        />
      )}

      {/* ── Modal 2a · Fill (create) ──────────────────────────── */}
      {creating && (
        <ArtifactFillModal
          mode="create"
          templateTitle={creating.template.title}
          structure={creating.template.structure_json || { sections: [] }}
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setCreating(null))}
          onSubmit={handleCreateSubmit}
        />
      )}

      {/* ── Modal 2b · Fill (edit) ────────────────────────────── */}
      {editing && (
        <ArtifactFillModal
          mode="edit"
          templateTitle={editing.template_title}
          structure={editing.structure_snapshot || { sections: [] }}
          initialData={editing.data || {}}
          linesScope={editing.lines || []}
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setEditing(null))}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* ── ConfirmModal de delete ────────────────────────────── */}
      {pendingDelete && createPortal(
        <ConfirmModal
          eyebrow={lang === "es" ? "ACCIÓN DESTRUCTIVA" : "DESTRUCTIVE ACTION"}
          title={lang === "es"
            ? `¿Eliminar artefacto "${pendingDelete.template_title}"?`
            : `Delete artifact "${pendingDelete.template_title}"?`}
          body={lang === "es"
            ? 'Se archiva con is_active=FALSE — el historial se preserva.'
            : 'Marked is_active=FALSE — history preserved.'}
          actionLabel={lang === "es" ? "Sí, eliminar" : "Yes, delete"}
          actionColor="#DC2626"
          cancelLabel={lang === "es" ? "Cancelar" : "Cancel"}
          busy={deleteBusy}
          error={deleteError}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />,
        document.body,
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Card individual (mismo patrón que NodoArtifactsTab)
// ─────────────────────────────────────────────────────────────
function ArtifactCard({ instance, readOnly, lang, onEdit, onEditScope, onDelete }) {
  const linesCount = Number(instance.lines_count || 0);
  const totalQty   = Number(instance.total_qty   || 0);
  return (
    <div style={{
      border: "1px solid var(--border-subtle)",
      borderRadius: 12, padding: 14,
      background: "var(--surface, white)",
      display: "flex", flexDirection: "column", gap: 8,
      cursor: readOnly ? "default" : "pointer",
      transition: "all 0.15s",
    }}
    onClick={readOnly ? undefined : onEdit}
    onMouseEnter={(e) => {
      if (readOnly) return;
      e.currentTarget.style.borderColor = "var(--brand-primary)";
      e.currentTarget.style.boxShadow   = "0 4px 12px -4px rgba(72,30,227,0.15)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = "var(--border-subtle)";
      e.currentTarget.style.boxShadow   = "none";
    }}>
      <div style={{ display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="heading-sm" style={{
            color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {instance.template_title}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
            #{instance.template_id}
          </div>
          {linesCount > 0 && (
            <div className="caption tabular-nums" style={{
              color: "var(--brand-accent, #0E8A6D)",
              fontWeight: 600, marginTop: 4, fontSize: 11,
            }}>
              {linesCount} {lang === "es" ? "línea(s) · " : "line(s) · "}
              {totalQty.toLocaleString()} u
            </div>
          )}
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); onEditScope(); }}
                    title={lang === "es" ? "Editar alcance" : "Edit scope"}
                    style={{ width: 26, height: 26 }}>
              <IconFileText size={11}/>
            </button>
            <button type="button" className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    title={lang === "es" ? "Editar campos" : "Edit fields"}
                    style={{ width: 26, height: 26 }}>
              <IconPencil size={11}/>
            </button>
            <button type="button" className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    title={lang === "es" ? "Eliminar" : "Delete"}
                    style={{ width: 26, height: 26, color: "var(--critical)" }}>
              <IconTrash size={11}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
