// ─────────────────────────────────────────────────────────────
// NodoArtifactsTab — tab "Artefactos" del detalle de un nodo
// Sprint 2026-05-11 · Fase 4 — integración Builder externo.
// Agente responsable: [AG-FRONTEND]
//
// Reemplaza la versión legacy (Fase 2) que solo guardaba metadata + URL
// libre. Ahora usa el mismo Builder (https://builder.muito.work) que ya
// teníamos en expedientes:
//
//   1. Click "+ Agregar artefacto" → ArtifactPickerModal lista templates.
//   2. Usuario elige uno → cierra picker, abre ArtifactFillModal con la
//      estructura del template (secciones, labels, tipos de campo,
//      opciones de select, drag-drop de archivos).
//   3. Guardar → POST /api/nodos/{id}/builder-artifacts/. Los datos
//      persisten en nodos.builder_artifact_instance (JSONB).
//   4. Click en una card → re-abre el ArtifactFillModal en modo `edit`
//      con la data ya cargada.
//   5. Eliminar → soft-delete con ConfirmModal MWT.
//
// La subida real de archivos la maneja DynamicField (componente reusado
// del lado expediente), que sube al storage (MinIO via storage-proxy) y
// guarda la URL en el JSONB del data.
//
// Reglas:
//   R1 · sin hex hardcodeados (vars CSS MWT).
//   R3 · CLIENT_* no ve botones de mutación (readOnly=true).
//   R5 · tabular-nums donde aplica.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  IconPlus, IconFileText, IconPencil, IconTrash,
} from "../../lib/icons.jsx";
import {
  nodoBuilderArtifactsApi, builderTemplatesApi,
} from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";

// Reusamos los modales del módulo expediente — funcionan idénticos.
// ArtifactPickerModal y ArtifactFillModal ya soportan `stage` opcional
// (sprint 2026-05-11 fase 4 — ambos verifican null).
import ArtifactPickerModal from "../expedientes/builderArtifacts/ArtifactPickerModal.jsx";
import ArtifactFillModal   from "../expedientes/builderArtifacts/ArtifactFillModal.jsx";
import ConfirmModal        from "../common/ConfirmModal.jsx";
// Sprint 2026-05-11 · Fase 5 · captura del alcance ANTES del template.
import ArtifactScopeModal  from "./ArtifactScopeModal.jsx";

export default function NodoArtifactsTab({ nodeId, lang = "es" }) {
  const { isClient } = useRole();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Estados de los modales — flow: scope → picker → fill
  // Sprint 2026-05-11 · Fase 5
  //   - scopeMode: null | 'create' | 'edit' | 'edit-scope-only'
  //   - scopePayload: { expediente_ids, lines }   (paso intermedio)
  //   - editingInstance: instancia activa cuando se edita
  const [scopeMode,      setScopeMode]      = useState(null);
  const [scopePayload,   setScopePayload]   = useState(null);
  const [editingInstance, setEditingInstance] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [creating,   setCreating]   = useState(null);  // {template}
  const [editing,    setEditing]    = useState(null);  // instance (fill modal)
  const [saving,     setSaving]     = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy,    setDeleteBusy]    = useState(false);
  const [deleteError,   setDeleteError]   = useState(null);

  const reload = useCallback(() => {
    if (!nodeId) return;
    setLoading(true); setError(null);
    nodoBuilderArtifactsApi.list(nodeId)
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setItems(arr);
      })
      .catch((e) => setError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error cargando artefactos" : "Error loading artifacts")))
      .finally(() => setLoading(false));
  }, [nodeId, lang]);

  useEffect(() => { reload(); }, [reload]);

  // ── Flow create: scope → picker → fill ─────────────────────
  // Sprint 2026-05-11 · Fase 5
  // 1) Click "+ Agregar artefacto" → abre ArtifactScopeModal.
  // 2) Usuario elige expedientes + líneas → handleScopeCreateSubmit.
  // 3) Abrimos ArtifactPickerModal con scopePayload guardado.
  // 4) Elige template → handlePickTemplate → abrimos ArtifactFillModal.
  // 5) Submit del fill → llamamos create con data + lines del scope.
  const handleScopeCreateSubmit = (payload) => {
    setScopePayload(payload);
    setScopeMode(null);
    setShowPicker(true);
  };

  const handlePickTemplate = async (tpl) => {
    // Re-fetcheamos el template completo (con structure_json) por si
    // la lista trae shape ligero.
    let fresh = tpl;
    try {
      fresh = await builderTemplatesApi.get(tpl.id);
    } catch {
      // best-effort — usamos el de la lista.
    }
    setCreating({ template: fresh });
    setShowPicker(false);
  };

  // ── Crear ──────────────────────────────────────────────────
  const handleCreateSubmit = async (data) => {
    if (!creating) return;
    setSaving(true);
    try {
      await nodoBuilderArtifactsApi.create(nodeId, {
        template_id:        creating.template.id,
        template_title:     creating.template.title,
        data,
        structure_snapshot: creating.template.structure_json || { sections: [] },
        // Sprint 2026-05-11 · Fase 5 · líneas capturadas en el scope.
        lines: scopePayload?.lines || [],
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

  // ── Editar ─────────────────────────────────────────────────
  // El flow de edit conserva sus líneas existentes a menos que el
  // usuario abra el botón "Editar alcance" (scope edit). Si solo edita
  // el form, mandamos `data` sin tocar `lines`.
  const handleEditSubmit = async (data) => {
    if (!editing) return;
    setSaving(true);
    try {
      await nodoBuilderArtifactsApi.update(nodeId, editing.id, { data });
      setEditing(null);
      reload();
    } catch (e) {
      alert((lang === "es" ? "Error al guardar: " : "Save error: ") +
            (e?.body?.detail || e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // Edit del alcance (líneas) de una instancia ya creada.
  const handleEditScopeSubmit = async (payload) => {
    if (!editingInstance) return;
    setSaving(true);
    try {
      await nodoBuilderArtifactsApi.update(nodeId, editingInstance.id, {
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

  // Abre el modal de edición de un artefacto. Fetcheamos el detail
  // para traer las `lines` actuales (el listado las trae solo en
  // resumen con lines_count/total_qty, no las líneas individuales).
  const openEdit = async (it) => {
    try {
      const full = await nodoBuilderArtifactsApi.get(nodeId, it.id);
      setEditing(full);
    } catch {
      // best-effort: si falla el get, usamos el item del listado.
      setEditing(it);
    }
  };

  // ── Eliminar (con ConfirmModal MWT) ────────────────────────
  const requestDelete = (it) => {
    setDeleteError(null);
    setPendingDelete(it);
  };
  const cancelDelete = () => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  };
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      await nodoBuilderArtifactsApi.remove(nodeId, pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setDeleteError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error al eliminar" : "Delete error"));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card card-pad-lg">
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando artefactos…" : "Loading artifacts…"}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card card-pad-lg">
        <div className="body-sm" style={{ color: "var(--critical)" }}>{error}</div>
        <button className="btn btn-secondary btn-sm" onClick={reload}
                style={{ marginTop: 10 }}>
          {lang === "es" ? "Reintentar" : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head"
           style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between" }}>
        <div>
          <div className="card-title">
            {lang === "es" ? "Artefactos del nodo" : "Node artifacts"}
          </div>
          <div className="card-subtitle">
            {items.length} {lang === "es" ? "registrados" : "registered"}
            {" · "}
            {lang === "es"
              ? "plantillas dinámicas desde el Builder externo"
              : "dynamic templates from external Builder"}
          </div>
        </div>
        {!isClient && (
          <button
            type="button"
            className="btn btn-primary"
            /* Sprint 2026-05-11 · Fase 5 — abrimos primero el modal
               de ALCANCE (expedientes + líneas), después el picker
               de template y por último el fill form. */
            onClick={() => { setScopePayload(null); setScopeMode("create"); }}
            disabled={!nodeId}
          >
            <IconPlus size={14}/>
            {lang === "es" ? "Agregar artefacto" : "Add artifact"}
          </button>
        )}
      </div>

      {/* Grid de cards de instancias */}
      {items.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <IconFileText size={28}
                        style={{ color: "var(--text-tertiary)", marginBottom: 10 }}/>
          <div className="body-sm" style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
            {lang === "es" ? "Sin artefactos" : "No artifacts yet"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es"
              ? "Agrega proformas, contratos 3PL, fotos de bodega o cualquier documento."
              : "Add proformas, 3PL contracts, warehouse photos or any document."}
          </div>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
          padding: 16,
        }}>
          {items.map((it) => (
            <ArtifactCard
              key={it.id}
              instance={it}
              readOnly={isClient}
              lang={lang}
              /* Sprint 2026-05-11 · Fase 5 — openEdit hace fetch del
                 detail para traer las `lines` antes de abrir el modal. */
              onEdit={() => openEdit(it)}
              onEditScope={async () => {
                try {
                  const full = await nodoBuilderArtifactsApi.get(nodeId, it.id);
                  setEditingInstance(full);
                  setScopeMode("edit-scope-only");
                } catch (e) {
                  alert((lang === "es" ? "Error: " : "Error: ")
                        + (e?.body?.detail || e?.message || ""));
                }
              }}
              onDelete={() => requestDelete(it)}
            />
          ))}
        </div>
      )}

      {/* ── Modal 0 · Scope (Fase 5) — expedientes + líneas ─── */}
      {scopeMode === "create" && (
        <ArtifactScopeModal
          nodeId={nodeId}
          lang={lang}
          onCancel={() => setScopeMode(null)}
          onSubmit={handleScopeCreateSubmit}
          submitLabel={lang === "es"
            ? "Siguiente — elegir plantilla"
            : "Next — pick template"}
        />
      )}
      {scopeMode === "edit-scope-only" && editingInstance && (
        <ArtifactScopeModal
          nodeId={nodeId}
          templateId={editingInstance.template_id}
          templateTitle={editingInstance.template_title}
          excludeInstanceId={editingInstance.id}
          initialLines={editingInstance.lines || []}
          initialExpedienteIds={
            // Reconstruir la lista de expedientes a partir de las líneas.
            Array.from(new Set((editingInstance.lines || [])
              .map((l) => l.expediente_id)))
          }
          lang={lang}
          onCancel={() => { setScopeMode(null); setEditingInstance(null); }}
          onSubmit={handleEditScopeSubmit}
          submitLabel={lang === "es" ? "Guardar alcance" : "Save scope"}
        />
      )}

      {/* ── Modal 1 · Picker de templates ────────────── */}
      {showPicker && (
        <ArtifactPickerModal
          /* stage queda undefined — el picker ya soporta nodos */
          lang={lang}
          onPick={handlePickTemplate}
          onClose={() => {
            setShowPicker(false);
            // Si el usuario cancela el picker después del scope,
            // descartamos el scope payload — no tiene sentido sin template.
            setScopePayload(null);
          }}
        />
      )}

      {/* ── Modal 2a · Fill (crear) ───────────────────── */}
      {creating && (
        <ArtifactFillModal
          mode="create"
          templateTitle={creating.template.title}
          structure={creating.template.structure_json || { sections: [] }}
          /* stage undefined intencionalmente */
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setCreating(null))}
          onSubmit={handleCreateSubmit}
        />
      )}

      {/* ── Modal 2b · Fill (editar) ──────────────────── */}
      {editing && (
        <ArtifactFillModal
          mode="edit"
          templateTitle={editing.template_title}
          structure={editing.structure_snapshot || { sections: [] }}
          initialData={editing.data || {}}
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setEditing(null))}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* ── ConfirmModal de delete ────────────────────── */}
      {pendingDelete && createPortal(
        <ConfirmModal
          eyebrow={lang === "es" ? "ACCIÓN DESTRUCTIVA" : "DESTRUCTIVE ACTION"}
          title={lang === "es"
            ? `¿Eliminar artefacto "${pendingDelete.template_title}"?`
            : `Delete artifact "${pendingDelete.template_title}"?`}
          body={
            <>
              {lang === "es"
                ? 'Se archiva con is_active=FALSE — preservamos historial para auditoría. Para restaurarlo necesitas tocar BD directamente.'
                : 'Marked is_active=FALSE — history preserved for audit. Restore requires direct DB action.'}
            </>
          }
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

// ────────────────────────────────────────────────────────
// Card individual
// ────────────────────────────────────────────────────────
function ArtifactCard({ instance, readOnly, lang, onEdit, onEditScope, onDelete }) {
  const dataKeys = Object.keys(instance.data || {});
  const linesCount = Number(instance.lines_count || 0);
  const totalQty   = Number(instance.total_qty   || 0);
  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(
        lang === "es" ? "es-ES" : "en-US",
        { year: "numeric", month: "short", day: "2-digit" });
    } catch { return iso; }
  };
  return (
    <div style={{
      border: "1px solid var(--border-subtle)",
      borderRadius: 12,
      padding: 14,
      background: "var(--surface, white)",
      display: "flex", flexDirection: "column", gap: 8,
      cursor: readOnly ? "default" : "pointer",
      transition: "all 0.15s",
    }}
    onClick={readOnly ? undefined : onEdit}
    onMouseEnter={(e) => {
      if (readOnly) return;
      e.currentTarget.style.borderColor = "var(--brand-primary)";
      e.currentTarget.style.boxShadow = "0 4px 12px -4px rgba(72,30,227,0.15)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = "var(--border-subtle)";
      e.currentTarget.style.boxShadow = "none";
    }}>
      <div style={{ display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="heading-sm" style={{
            color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {instance.template_title}
          </div>
          <div className="caption" style={{
            color: "var(--text-tertiary)", marginTop: 2,
          }}>
            #{instance.template_id} · {dataKeys.length} {lang === "es" ? "campos" : "fields"}
          </div>
          {/* Sprint 2026-05-11 · Fase 5 · alcance del artefacto */}
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
            {onEditScope && (
              <button
                type="button"
                className="icon-btn"
                onClick={(e) => { e.stopPropagation(); onEditScope(); }}
                title={lang === "es" ? "Editar alcance (expedientes / líneas)" : "Edit scope"}
                style={{ width: 28, height: 28 }}
              >
                <IconFileText size={12}/>
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title={lang === "es" ? "Editar campos del artefacto" : "Edit artifact fields"}
              style={{ width: 28, height: 28 }}
            >
              <IconPencil size={12}/>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title={lang === "es" ? "Eliminar" : "Delete"}
              style={{ width: 28, height: 28, color: "var(--critical)" }}
            >
              <IconTrash size={12}/>
            </button>
          </div>
        )}
      </div>
      <div className="caption tabular-nums" style={{
        color: "var(--text-tertiary)", fontSize: 11,
        borderTop: "1px solid var(--divider, var(--border-subtle))",
        paddingTop: 8, marginTop: 4,
      }}>
        {instance.created_by_name || "—"} · {fmt(instance.created_at)}
        {instance.updated_at !== instance.created_at && (
          <>
            {" · "}
            <span style={{ color: "var(--text-secondary)" }}>
              {lang === "es" ? "editado" : "edited"} {fmt(instance.updated_at)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
