// =====================================================================
// MWT.ONE · BuilderArtifactsBoard
// Reemplaza el board de artefactos mock-only por un sistema dinámico
// alimentado por el Builder externo + persistido en
// expedientes.builder_artifact_instance.
//
// Reglas:
//   · POL_VISIBILIDAD: CLIENT_* → readOnly=true (sin botones de mutación).
//   · STATE GATE: el botón "+ Artefacto" se deshabilita en etapas que
//     todavía no llegaron (stageIndex(target) > stageIndex(currentStage)).
//   · El backend valida lo mismo (defensa de profundidad).
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import {
  IconPlus, IconFileText, IconCheck, IconPencil, IconTrash,
} from "../../../lib/icons.jsx";
import {
  builderArtifactsApi, builderTemplatesApi,
} from "../../../lib/api.js";
import {
  STAGE_ORDER, STAGE_COLOR, stageLabel, canAddArtifactToStage,
} from "./stages.js";
import ArtifactPickerModal from "./ArtifactPickerModal.jsx";
import ArtifactFillModal from "./ArtifactFillModal.jsx";

// Re-fetch transparente con marcador local — evita prop drilling.
function useArtifactInstances(expedienteId) {
  const [instances, setInstances] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [tick,      setTick]      = useState(0);

  useEffect(() => {
    if (!expedienteId) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    builderArtifactsApi
      .list(expedienteId)
      .then((data) => {
        if (cancel) return;
        const list = Array.isArray(data) ? data : (data?.results || []);
        setInstances(list);
        setLoading(false);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || "Error");
        setLoading(false);
      });
    return () => { cancel = true; };
  }, [expedienteId, tick]);

  const refetch = () => setTick((t) => t + 1);

  // Mutaciones optimistas con rollback en caso de error.
  const create = async (payload) => {
    const created = await builderArtifactsApi.create(expedienteId, payload);
    setInstances((prev) => [...prev, created]);
    return created;
  };
  const update = async (id, payload) => {
    const updated = await builderArtifactsApi.update(expedienteId, id, payload);
    setInstances((prev) => prev.map((it) => (it.id === id ? updated : it)));
    return updated;
  };
  const remove = async (id) => {
    const snapshot = instances;
    setInstances((prev) => prev.filter((it) => it.id !== id));
    try {
      await builderArtifactsApi.remove(expedienteId, id);
    } catch (e) {
      setInstances(snapshot);
      throw e;
    }
  };

  return { instances, loading, error, refetch, create, update, remove };
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────
export default function BuilderArtifactsBoard({
  expedienteId,
  currentStage,        // estado actual del expediente (REGISTRO / PRODUCCION / ...)
  lang = "es",
  readOnly = false,    // CLIENT_* lo recibe en true
}) {
  const {
    instances, loading, error, create, update, remove,
  } = useArtifactInstances(expedienteId);

  const [pickerStage, setPickerStage] = useState(null);
  const [creating,    setCreating]    = useState(null); // {template, stage}
  const [editing,     setEditing]     = useState(null); // instance
  const [saving,      setSaving]      = useState(false);

  // Agrupar por etapa para render rápido.
  const grouped = useMemo(() => {
    const acc = STAGE_ORDER.reduce((a, s) => ({ ...a, [s]: [] }), {});
    for (const it of instances) {
      if (acc[it.stage]) acc[it.stage].push(it);
    }
    return acc;
  }, [instances]);

  // Picker → Fill: cuando el user elige plantilla, la re-cargamos
  // (template fresco) para snapshotear la versión actual.
  const handlePickTemplate = async (tpl) => {
    if (!pickerStage) return;
    let fresh = tpl;
    try {
      fresh = await builderTemplatesApi.get(tpl.id);
    } catch {
      // Si el detail falla, usamos el de la lista (best-effort).
    }
    setCreating({ template: fresh, stage: pickerStage });
    setPickerStage(null);
  };

  const handleCreateSubmit = async (data) => {
    if (!creating) return;
    setSaving(true);
    try {
      await create({
        template_id:        creating.template.id,
        template_title:     creating.template.title,
        stage:              creating.stage,
        data,
        structure_snapshot: creating.template.structure_json || { sections: [] },
      });
      setCreating(null);
    } catch (e) {
      alert((lang === "es" ? "Error al crear: " : "Create error: ") +
            (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (data) => {
    if (!editing) return;
    setSaving(true);
    try {
      await update(editing.id, { data });
      setEditing(null);
    } catch (e) {
      alert((lang === "es" ? "Error al guardar: " : "Save error: ") +
            (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (it) => {
    const ok = window.confirm(
      lang === "es"
        ? `¿Eliminar artefacto "${it.template_title}"? Esta acción no se puede deshacer.`
        : `Delete artifact "${it.template_title}"? This cannot be undone.`
    );
    if (!ok) return;
    try {
      await remove(it.id);
    } catch (e) {
      alert((lang === "es" ? "Error al eliminar: " : "Delete error: ") +
            (e?.message || ""));
    }
  };

  if (loading) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center" }}>
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando artefactos…" : "Loading artifacts…"}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="card card-pad"
        style={{
          background: "var(--critical-bg, rgba(220,38,38,0.06))",
          border: "1px solid var(--critical, #DC2626)",
          color: "var(--critical, #DC2626)",
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="artifacts-board-wrap">
      <div className="artifacts-board">
        {STAGE_ORDER.map((stage) => {
          const items = grouped[stage] || [];
          const allowed = !readOnly && canAddArtifactToStage(currentStage, stage);
          return (
            <div
              key={stage}
              className="ab-column"
              data-state={stage}
            >
              <div className="ab-col-head">
                <div className="ab-col-title">
                  <span
                    className="ab-state-dot"
                    data-state={stage}
                    style={{ background: STAGE_COLOR[stage] }}
                  />
                  <span>{stageLabel(lang, stage)}</span>
                  <span className="ab-col-count tabular">{items.length}</span>
                </div>
                {!readOnly && (
                  <button
                    className="ab-add-artifact"
                    onClick={() => setPickerStage(stage)}
                    disabled={!allowed}
                    title={
                      allowed
                        ? (lang === "es" ? "Agregar artefacto" : "Add artifact")
                        : (lang === "es"
                            ? "El expediente aún no llegó a esta etapa"
                            : "Expediente has not reached this stage yet")
                    }
                  >
                    <IconPlus size={12}/>
                    {lang === "es" ? "Artefacto" : "Artifact"}
                  </button>
                )}
              </div>
              <div className="ab-col-body">
                {items.length === 0 && (
                  <div className="ab-empty">
                    <IconFileText size={18}/>
                    <span>
                      {lang === "es" ? "Sin artefactos" : "No artifacts"}
                    </span>
                  </div>
                )}
                {items.map((it) => (
                  <ArtifactInstanceCard
                    key={it.id}
                    instance={it}
                    lang={lang}
                    readOnly={readOnly}
                    onEdit={() => setEditing(it)}
                    onDelete={() => handleDelete(it)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {pickerStage && (
        <ArtifactPickerModal
          stage={pickerStage}
          lang={lang}
          onPick={handlePickTemplate}
          onClose={() => setPickerStage(null)}
        />
      )}

      {creating && (
        <ArtifactFillModal
          mode="create"
          templateTitle={creating.template.title}
          structure={creating.template.structure_json || { sections: [] }}
          stage={creating.stage}
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setCreating(null))}
          onSubmit={handleCreateSubmit}
        />
      )}

      {editing && (
        <ArtifactFillModal
          mode="edit"
          templateTitle={editing.template_title}
          structure={editing.structure_snapshot || { sections: [] }}
          stage={editing.stage}
          initialData={editing.data || {}}
          lang={lang}
          saving={saving}
          onCancel={() => (saving ? null : setEditing(null))}
          onSubmit={handleEditSubmit}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Card de una instancia: título + resumen + acciones.
// ─────────────────────────────────────────────────────────────────────
function ArtifactInstanceCard({ instance, lang, readOnly, onEdit, onDelete }) {
  const summary = (() => {
    if (!instance.data) return "";
    for (const v of Object.values(instance.data)) {
      if (typeof v === "string" && v.trim()) return v.slice(0, 60);
      if (typeof v === "number") return String(v);
      if (v && typeof v === "object" && v.file_name) return v.file_name;
    }
    return "";
  })();

  const dt = instance.updated_at || instance.created_at;
  const dateTxt = dt
    ? new Date(dt).toLocaleDateString(lang === "es" ? "es-CO" : "en-US", {
        day: "2-digit", month: "short", year: "2-digit",
      })
    : "";

  return (
    <div className="ab-artifact">
      <div className="ab-art-head" onClick={onEdit} style={{ cursor: "pointer" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ab-art-code tabular">#{instance.template_id}</div>
          <div className="ab-art-name" title={instance.template_title}>
            {instance.template_title}
          </div>
        </div>
        <IconCheck size={14}/>
      </div>
      {summary && (
        <div className="ab-art-records">
          <div className="ab-rec-mini">
            <IconCheck size={10}/>
            <span className="ab-rec-preview">{summary}</span>
            <span className="ab-rec-date tabular">{dateTxt}</span>
          </div>
        </div>
      )}
      {!readOnly && (
        <div
          style={{
            display: "flex", gap: 6, padding: "0 8px 8px", justifyContent: "flex-end",
          }}
        >
          <button
            className="btn btn-ghost btn-sm"
            onClick={onEdit}
            style={{ fontSize: 11 }}
            type="button"
          >
            <IconPencil size={11}/>
            {lang === "es" ? "Editar" : "Edit"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            style={{ fontSize: 11, color: "var(--critical, #DC2626)" }}
            type="button"
          >
            <IconTrash size={11}/>
            {lang === "es" ? "Eliminar" : "Delete"}
          </button>
        </div>
      )}
      <div
        className="caption tabular"
        style={{
          padding: "0 12px 8px",
          color: "var(--text-tertiary)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {dateTxt} · {instance.created_by_name || "—"}
      </div>
    </div>
  );
}
