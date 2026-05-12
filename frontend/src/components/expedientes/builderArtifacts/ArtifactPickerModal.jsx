// =====================================================================
// MWT.ONE · ArtifactPickerModal
// Modal para escoger una plantilla del Builder. Llama al proxy
// /api/builder/templates/ y filtra Published.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { IconPlus, IconSearch, IconFileText, IconX } from "../../../lib/icons.jsx";
import { builderTemplatesApi } from "../../../lib/api.js";
import { stageLabel } from "./stages.js";

export default function ArtifactPickerModal({ stage, lang = "es", onPick, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [q,         setQ]         = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    builderTemplatesApi
      .list()
      .then((data) => {
        if (cancel) return;
        const list = Array.isArray(data) ? data : (data?.results || []);
        setTemplates(list);
        setLoading(false);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || (lang === "es" ? "Error" : "Error"));
        setLoading(false);
      });
    return () => { cancel = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!q.trim()) return templates;
    const k = q.toLowerCase();
    return templates.filter((t) =>
      (t.title || "").toLowerCase().includes(k) ||
      String(t.id || "").includes(k)
    );
  }, [templates, q]);

  // Sprint 2026-05-11 fase 4 · `stage` es opcional. En nodos no aplica:
  // el picker se usa para escoger una plantilla sin contexto de etapa.
  // Si `stage` viene, mostramos su label; si no, mostramos un texto
  // genérico ("Selecciona") para evitar que stageLabel rompa con null.
  const stageTxt = stage
    ? stageLabel(lang, stage)
    : (lang === "es" ? "Selecciona" : "Select");

  return (
    <div className="mdl-backdrop" onClick={(e) => {
      if (e.target.classList.contains("mdl-backdrop")) onClose?.();
    }}>
      <div className="mdl-panel" data-wide>
        <div className="mdl-head">
          <div>
            <div className="mdl-title">
              {lang === "es" ? "Buscar plantilla de artefacto" : "Find artifact template"}
            </div>
            <div className="mdl-subtitle">
              {lang === "es" ? "Etapa" : "Stage"}: {stageTxt}{" "}
              · {templates.length}{" "}
              {lang === "es" ? "publicadas" : "published"}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={14}/>
          </button>
        </div>
        <div className="mdl-body">
          <div className="mdl-search">
            <IconSearch size={13}/>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                lang === "es"
                  ? "Escribe título o ID…"
                  : "Type title or ID…"
              }
            />
          </div>

          {loading && (
            <div className="mdl-empty" style={{ padding: 32 }}>
              <span>{lang === "es" ? "Cargando plantillas…" : "Loading…"}</span>
            </div>
          )}

          {error && !loading && (
            <div
              className="mdl-empty"
              style={{
                padding: 16,
                color: "var(--critical, #DC2626)",
                background: "var(--critical-bg, rgba(220,38,38,0.08))",
                borderRadius: 8,
              }}
            >
              <span>
                {lang === "es" ? "Error al cargar Builder: " : "Builder error: "}{error}
              </span>
            </div>
          )}

          {!loading && !error && (
            <div className="mdl-list">
              {filtered.length === 0 && (
                <div className="mdl-empty">
                  <IconFileText size={16}/>
                  <span>
                    {lang === "es"
                      ? "Ninguna plantilla coincide con la búsqueda."
                      : "No template matches the search."}
                  </span>
                </div>
              )}
              {filtered.map((t) => {
                const sections = (t.structure_json?.sections || []);
                const fieldsCount = sections.reduce(
                  (acc, s) => acc + (s.columns || []).reduce(
                    (a, c) => a + (c.fields || []).length, 0
                  ), 0
                );
                return (
                  <div
                    key={t.id}
                    className="mdl-row"
                    onClick={() => onPick?.(t)}
                  >
                    <div className="mdl-row-icon"><IconFileText size={14}/></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mdl-row-name">
                        <span className="mdl-row-code tabular">#{t.id}</span>
                        <span>{t.title}</span>
                      </div>
                      <div className="caption tabular">
                        {sections.length}{" "}
                        {lang === "es" ? "secciones · " : "sections · "}
                        {fieldsCount}{" "}
                        {lang === "es" ? "campos" : "fields"}
                      </div>
                    </div>
                    <button className="btn btn-primary btn-sm">
                      <IconPlus size={11}/>
                      {lang === "es" ? "Elegir" : "Pick"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
