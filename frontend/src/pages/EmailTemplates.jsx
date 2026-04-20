// ─────────────────────────────────────────────────────────────
// TemplatesManager — Plantillas de Email (Jinja2)
// Agente responsable: [AG-FRONTEND]
//
// Estructura:
//   · lado izquierdo: lista con tarjetas (activas + inactivas grayed-out)
//     con filtros por brand y idioma + botón "Nueva"
//   · lado derecho: panel detalle con preview Jinja2 resaltado,
//     estadísticas (sent_count_30d) y acciones:
//       - Enviar prueba  (siempre)
//       - Enviar proforma (solo key = proforma.sent)
//       - Editar         (drawer)
//       - Eliminar / Restaurar (soft delete · is_active=false)
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconX, IconFileText, IconEye, IconSparkle,
  IconRefresh, IconCheck, IconAlert, IconPaperclip, IconMail, IconHistory,
} from "../lib/icons.jsx";
import {
  EMAIL_TEMPLATES as MOCK_EMAIL_TEMPLATES, EMAIL_BRANDS, EMAIL_LANGUAGES,
} from "../data/mockData.js";
import TemplateEditorDrawer from "../components/notificaciones/TemplateEditorDrawer.jsx";
import TestSendModal        from "../components/notificaciones/TestSendModal.jsx";
import { useEmailTemplates } from "../hooks/useEmailTemplates.js";
import { emailTemplatesApi } from "../lib/api.js";

// Adapter: backend row → shape usado por la página
function mapApiTemplateToRow(r) {
  return {
    id:               r.id,
    name:             r.name,
    template_key:     r.template_key,
    language:         r.language || 'ES',
    brand:            r.brand || 'GLOBAL',
    brand_id:         r.brand_id || null,
    subject_template: r.subject_template || '',
    body_template:    r.body_template || '',
    variables_meta:   Array.isArray(r.variables_meta) ? r.variables_meta : [],
    sent_count_30d:   r.sent_count_30d || 0,
    is_active:        !!r.is_active,
    updated_at:       r.updated_at || null,
  };
}

function brandLabel(v) {
  const b = EMAIL_BRANDS.find(x => x.value === v);
  return b ? b.label : v;
}
function langLabel(v) {
  const l = EMAIL_LANGUAGES.find(x => x.value === v);
  return l ? l.label : v;
}

// ── Render Jinja2 preview (misma función que drawer, inline) ─────
function renderJinja(str) {
  if (!str) return [];
  const out = [];
  const re = /(\{\{[^}]+\}\}|\{%[^%]+%\})/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ type:'text', value: str.slice(last, m.index), k: i++ });
    out.push({ type:'tok',  value: m[0],                           k: i++ });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ type:'text', value: str.slice(last), k: i++ });
  return out;
}

export default function ScreenEmailTemplates() {
  const { lang } = useOutletContext();

  // ── Backend data ── se hidrata una vez; luego se trabaja sobre `list` local
  const { templates: apiTemplates, loading: loadingTpl, reload: reloadTpl } = useEmailTemplates();

  // Copia en estado local — soporta soft-delete y edición en sesión
  const [list, setList]         = useState(() => [...MOCK_EMAIL_TEMPLATES]);
  const [q, setQ]               = useState('');
  const [brandF, setBrandF]     = useState('ALL');
  const [langF, setLangF]       = useState('ALL');
  const [showInactive, setSI]   = useState(false);
  const [selId, setSelId]       = useState(MOCK_EMAIL_TEMPLATES[0]?.id || null);

  // Cuando llega data del backend, reemplaza la lista mock. Si está vacío, se queda con mock.
  useEffect(() => {
    if (!loadingTpl && Array.isArray(apiTemplates) && apiTemplates.length > 0) {
      const mapped = apiTemplates.map(mapApiTemplateToRow);
      setList(mapped);
      setSelId((prev) => prev || mapped[0]?.id || null);
    }
  }, [apiTemplates, loadingTpl]);
  const [editTpl, setEditTpl]   = useState(null);   // null = closed, {} = new, {...} = edit
  const [testTpl, setTestTpl]   = useState(null);   // { tpl, mode }

  // ── Rows filtradas ──────────────────
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter(t => {
        if (!showInactive && !t.is_active) return false;
        if (brandF !== 'ALL' && t.brand !== brandF) return false;
        if (langF  !== 'ALL' && t.language !== langF) return false;
        if (!needle) return true;
        return [t.name, t.template_key, t.subject_template].join(' ').toLowerCase().includes(needle);
      })
      .sort((a,b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [list, q, brandF, langF, showInactive]);

  const selected = useMemo(
    () => list.find(t => t.id === selId) || filtered[0] || null,
    [list, selId, filtered]
  );

  // ── Actions ──────────────────
  function openNew() {
    setEditTpl({});
  }
  function openEdit(t) {
    setEditTpl(t);
  }
  // Normaliza el payload para el backend (quita campos internos del mock)
  function toApiBody(t) {
    return {
      name:             t.name,
      template_key:     t.template_key,
      language:         t.language,
      brand:            t.brand,
      brand_id:         t.brand_id || null,
      subject_template: t.subject_template,
      body_template:    t.body_template,
      variables_meta:   Array.isArray(t.variables_meta) ? t.variables_meta : [],
      is_active:        !!t.is_active,
    };
  }

  async function saveTemplate(t) {
    // Update optimista local antes del roundtrip
    setList(prev => {
      const idx = prev.findIndex(x => x.id === t.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...t };
        return next;
      }
      return [...prev, t];
    });
    setSelId(t.id);

    // Persist: PATCH si existe en backend (UUID real), POST si es nuevo
    const body = toApiBody(t);
    const looksLikeUuid = typeof t.id === "string" && /^[0-9a-f]{8}-/.test(t.id);
    try {
      if (looksLikeUuid) {
        await emailTemplatesApi.update(t.id, body);
      } else {
        await emailTemplatesApi.create(body);
      }
      await reloadTpl?.();
    } catch (e) {
      console.error("saveTemplate falló:", e);
      alert(`${lang==='es'?'Error al guardar la plantilla':'Template save error'}: ${e?.message || e}`);
    }
  }

  async function softDelete(t) {
    setList(prev => prev.map(x => x.id === t.id ? { ...x, is_active:false } : x));
    try {
      if (typeof t.id === "string" && /^[0-9a-f]{8}-/.test(t.id)) {
        await emailTemplatesApi.update(t.id, { is_active: false });
        await reloadTpl?.();
      }
    } catch (e) {
      console.error("softDelete falló:", e);
    }
  }

  async function restore(t) {
    setList(prev => prev.map(x => x.id === t.id ? { ...x, is_active:true } : x));
    try {
      if (typeof t.id === "string" && /^[0-9a-f]{8}-/.test(t.id)) {
        await emailTemplatesApi.update(t.id, { is_active: true });
        await reloadTpl?.();
      }
    } catch (e) {
      console.error("restore falló:", e);
    }
  }

  // Contadores por brand
  const brandCounts = useMemo(() => {
    const c = { ALL: list.length };
    for (const b of EMAIL_BRANDS) c[b.value] = list.filter(t => t.brand === b.value).length;
    return c;
  }, [list]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'COMUNICACIONES · PLANTILLAS':'COMMS · TEMPLATES'}
          </div>
          <h1 className="page-title">
            {lang==='es'?'Plantillas de email':'Email templates'}
          </h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Administra los cuerpos de correo del sistema con sintaxis Jinja2 por marca e idioma. Los borrados son lógicos (soft delete).'
              : 'Manage the system email bodies with Jinja2 syntax per brand and language. Deletions are soft.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent" onClick={openNew}>
            <IconPlus size={14}/> {lang==='es'?'Nueva plantilla':'New template'}
          </button>
        </div>
      </div>

      {/* ── Layout 2 columnas ── */}
      <div className="tpl-layout" style={{ marginTop:16 }}>
        {/* ── Columna izquierda — lista ── */}
        <aside className="tpl-list">
          <div className="tpl-list-head">
            <div className="search-wrap">
              <IconSearch size={13} className="search-icon"/>
              <input
                className="input input-sm"
                placeholder={lang==='es'?'Buscar nombre, key o asunto…':'Search name, key or subject…'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && <button className="search-clear" onClick={() => setQ('')}><IconX size={11}/></button>}
            </div>

            <div className="tpl-list-filters">
              <select
                className="input input-sm"
                value={brandF}
                onChange={(e) => setBrandF(e.target.value)}
                style={{ flex:1 }}
              >
                <option value="ALL">
                  {lang==='es'?'Todas las marcas':'All brands'} ({brandCounts.ALL})
                </option>
                {EMAIL_BRANDS.map(b => (
                  <option key={b.value} value={b.value}>
                    {b.label} ({brandCounts[b.value] || 0})
                  </option>
                ))}
              </select>
              <select
                className="input input-sm"
                value={langF}
                onChange={(e) => setLangF(e.target.value)}
                style={{ width:110 }}
              >
                <option value="ALL">{lang==='es'?'Todos':'All'}</option>
                {EMAIL_LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.value}</option>
                ))}
              </select>
            </div>

            <label className="tpl-show-inactive">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setSI(e.target.checked)}
              />
              <span>
                {lang==='es'?'Mostrar inactivas':'Show inactive'}
              </span>
            </label>
          </div>

          <div className="tpl-list-body">
            <AnimatePresence mode="popLayout">
              {filtered.map((t, idx) => (
                <motion.button
                  key={t.id}
                  type="button"
                  layout
                  initial={{ opacity:0, y:4 }}
                  animate={{ opacity:1, y:0 }}
                  exit={{ opacity:0 }}
                  transition={{ duration:0.18, delay: Math.min(idx*0.02, 0.12) }}
                  className={`tpl-card ${selected?.id === t.id ? 'is-sel' : ''} ${t.is_active ? '' : 'is-inactive'}`}
                  onClick={() => setSelId(t.id)}
                >
                  <div className="tpl-card-name-row">
                    <div className="tpl-card-name">{t.name}</div>
                    {t.is_active
                      ? <span className="tpl-state-dot is-ok"/>
                      : <span className="tpl-state-dot is-off"/>}
                  </div>
                  <div className="tpl-card-key mono">{t.template_key}</div>
                  <div className="tpl-card-meta">
                    <span className="tpl-meta-pill">{langLabel(t.language)}</span>
                    <span className="tpl-meta-pill tpl-meta-brand">{brandLabel(t.brand)}</span>
                    {t.sent_count_30d > 0 && (
                      <span className="tpl-meta-stat micro">
                        <IconMail size={10}/> {t.sent_count_30d} / 30d
                      </span>
                    )}
                    {!t.is_active && (
                      <span className="tpl-meta-pill is-inactive-pill">
                        {lang==='es'?'Inactiva':'Inactive'}
                      </span>
                    )}
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>

            {filtered.length === 0 && (
              <div className="tpl-list-empty text-sec body-sm">
                <IconSparkle size={18} style={{ opacity:0.4 }}/>
                {lang==='es'?'Sin plantillas que coincidan':'No templates match'}
              </div>
            )}
          </div>
        </aside>

        {/* ── Columna derecha — detalle ── */}
        <section className="tpl-detail">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity:0, y:8 }}
                animate={{ opacity:1, y:0 }}
                exit={{ opacity:0, y:-6 }}
                transition={{ duration:0.22 }}
                className="tpl-detail-inner"
              >
                {/* Header */}
                <div className="tpl-detail-head">
                  <div style={{ minWidth:0 }}>
                    <div className="flex ai-center gap-2" style={{ flexWrap:'wrap' }}>
                      <h2 className="heading-lg" style={{ margin:0 }}>{selected.name}</h2>
                      <span
                        className="trf-badge"
                        style={{
                          color: selected.is_active ? '#0E8A6D' : '#6B7280',
                          background: selected.is_active ? 'rgba(14,138,109,0.14)' : 'rgba(107,114,128,0.12)',
                          borderColor: selected.is_active ? 'rgba(14,138,109,0.35)' : 'rgba(107,114,128,0.3)',
                        }}
                      >
                        <span
                          className="trf-badge-dot"
                          style={{ background: selected.is_active ? '#0E8A6D' : '#6B7280' }}
                        />
                        {selected.is_active
                          ? (lang==='es'?'ACTIVA':'ACTIVE')
                          : (lang==='es'?'INACTIVA':'INACTIVE')}
                      </span>
                    </div>
                    <div className="tpl-detail-sub mono">{selected.template_key}</div>
                    <div className="tpl-detail-meta micro">
                      {langLabel(selected.language)} · {brandLabel(selected.brand)}
                      {selected.updated_at && (
                        <> · {lang==='es'?'act.':'upd.'} {selected.updated_at}</>
                      )}
                    </div>
                  </div>
                  <div className="flex ai-center gap-2" style={{ flexWrap:'wrap', justifyContent:'flex-end' }}>
                    <button
                      className="btn btn-accent btn-sm"
                      disabled={!selected.is_active}
                      onClick={() => setTestTpl({ tpl: selected, mode:'test' })}
                    >
                      <IconSparkle size={12}/> {lang==='es'?'Enviar prueba':'Test send'}
                    </button>
                    {selected.template_key === 'proforma.sent' && (
                      <button
                        className="btn btn-brand btn-sm"
                        disabled={!selected.is_active}
                        onClick={() => setTestTpl({ tpl: selected, mode:'proforma' })}
                      >
                        <IconPaperclip size={12}/> {lang==='es'?'Enviar proforma':'Send proforma'}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(selected)}>
                      <IconFileText size={12}/> {lang==='es'?'Editar':'Edit'}
                    </button>
                    {selected.is_active ? (
                      <button
                        className="btn btn-warn btn-sm"
                        onClick={() => {
                          if (window.confirm(
                            lang==='es'
                              ? '¿Marcar esta plantilla como inactiva? Se puede restaurar después.'
                              : 'Mark this template as inactive? You can restore it later.'
                          )) softDelete(selected);
                        }}
                      >
                        <IconX size={12}/> {lang==='es'?'Eliminar':'Delete'}
                      </button>
                    ) : (
                      <button className="btn btn-accent btn-sm" onClick={() => restore(selected)}>
                        <IconRefresh size={12}/> {lang==='es'?'Restaurar':'Restore'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="tpl-stats-row">
                  <div className="tpl-stat-card">
                    <div className="micro">{lang==='es'?'ENVÍOS 30 DÍAS':'SENDS LAST 30 DAYS'}</div>
                    <div className="tpl-stat-value tabular-nums">
                      {(selected.sent_count_30d || 0).toLocaleString('en-US')}
                    </div>
                  </div>
                  <div className="tpl-stat-card">
                    <div className="micro">{lang==='es'?'IDIOMA':'LANGUAGE'}</div>
                    <div className="tpl-stat-value">{langLabel(selected.language)}</div>
                  </div>
                  <div className="tpl-stat-card">
                    <div className="micro">{lang==='es'?'MARCA':'BRAND'}</div>
                    <div className="tpl-stat-value">{brandLabel(selected.brand)}</div>
                  </div>
                  <div className="tpl-stat-card">
                    <div className="micro">{lang==='es'?'ÚLTIMA EDICIÓN':'LAST UPDATE'}</div>
                    <div className="tpl-stat-value">{selected.updated_at || '—'}</div>
                  </div>
                </div>

                {/* Preview */}
                <div className="tpl-preview-card" style={{ marginTop:16 }}>
                  <div className="tpl-preview-head">
                    <div className="flex ai-center gap-2">
                      <IconEye size={13} style={{ color:'var(--brand-accent, #00B286)' }}/>
                      <div className="heading-sm" style={{ margin:0 }}>
                        {lang==='es'?'Preview de la plantilla':'Template preview'}
                      </div>
                    </div>
                    <div className="micro text-sec">
                      {lang==='es'?'variables':'variables'}{' '}
                      <span className="mono">{'{{ ... }}'}</span>{' '}
                      {lang==='es'?'resaltadas':'highlighted'}
                    </div>
                  </div>
                  <div className="tpl-preview-body">
                    <div className="tpl-preview-subject">
                      <div className="micro">{lang==='es'?'ASUNTO':'SUBJECT'}</div>
                      <div className="tpl-preview-text">
                        {renderJinja(selected.subject_template).map(f =>
                          f.type === 'tok'
                            ? <span key={f.k} className="jinja-token">{f.value}</span>
                            : <span key={f.k}>{f.value}</span>
                        )}
                      </div>
                    </div>
                    <div className="tpl-preview-content">
                      <pre className="tpl-preview-pre">
                        {renderJinja(selected.body_template).map(f =>
                          f.type === 'tok'
                            ? <span key={f.k} className="jinja-token">{f.value}</span>
                            : <span key={f.k}>{f.value}</span>
                        )}
                      </pre>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity:0 }}
                animate={{ opacity:1 }}
                className="tpl-detail-empty"
              >
                <IconFileText size={22} style={{ opacity:0.35 }}/>
                <div className="heading-md">
                  {lang==='es'?'Selecciona una plantilla':'Pick a template'}
                </div>
                <div className="body-sm text-sec">
                  {lang==='es'
                    ? 'Elige una de la izquierda o crea una nueva para empezar.'
                    : 'Choose one on the left or create a new one to get started.'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Editor Drawer */}
      <AnimatePresence>
        {editTpl !== null && (
          <TemplateEditorDrawer
            lang={lang}
            template={editTpl.id ? editTpl : null}
            onClose={() => setEditTpl(null)}
            onSave={saveTemplate}
          />
        )}
      </AnimatePresence>

      {/* Test-Send Modal */}
      <AnimatePresence>
        {testTpl && (
          <TestSendModal
            lang={lang}
            template={testTpl.tpl}
            mode={testTpl.mode}
            onClose={() => setTestTpl(null)}
            onSent={() => {}}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
