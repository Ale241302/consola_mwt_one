// ─────────────────────────────────────────────────────────────
// TemplateEditorDrawer — Crear / editar plantilla de email
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral con 7 campos del modelo EmailTemplate:
//   name · template_key · language · brand · subject_template · body_template · is_active
// Incluye preview Jinja2 con tokens resaltados y validación básica
// de balance de llaves {{ }} y {% %}.
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconCheck, IconAlert, IconFileText, IconSparkle, IconEye,
} from "../../lib/icons.jsx";
import { EMAIL_BRANDS, EMAIL_LANGUAGES } from "../../data/mockData.js";

// ── Render de tokens Jinja para preview ─────
// Devuelve un array de fragmentos mezclando texto plano y <span class="jinja-token">
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

// Balance rápido de delimitadores Jinja — para alerta temprana
function jinjaHealth(str) {
  if (!str) return { ok:true, problems:[] };
  const problems = [];
  const openA = (str.match(/\{\{/g) || []).length;
  const closeA = (str.match(/\}\}/g) || []).length;
  if (openA !== closeA) problems.push(`{{ y }} desbalanceados (${openA}/${closeA})`);
  const openB = (str.match(/\{%/g) || []).length;
  const closeB = (str.match(/%\}/g) || []).length;
  if (openB !== closeB) problems.push(`{% y %} desbalanceados (${openB}/${closeB})`);
  return { ok: problems.length === 0, problems };
}

// Extrae variables únicas usadas en el cuerpo (para checklist en preview)
function extractVars(subject, body) {
  const set = new Set();
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)/g;
  let m;
  while ((m = re.exec(subject || ''))) set.add(m[1]);
  while ((m = re.exec(body    || ''))) set.add(m[1]);
  return Array.from(set);
}

const EMPTY = {
  name:'',
  template_key:'',
  language:'ES',
  brand:'GLOBAL',
  subject_template:'',
  body_template:'',
  is_active:true,
};

export default function TemplateEditorDrawer({ lang='es', template, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(template || {}) }));
  const isEdit = !!template?.id;

  // scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const health = useMemo(() => {
    const s = jinjaHealth(form.subject_template);
    const b = jinjaHealth(form.body_template);
    return {
      ok: s.ok && b.ok,
      problems: [...s.problems.map(p => 'Asunto: ' + p), ...b.problems.map(p => 'Cuerpo: ' + p)],
    };
  }, [form.subject_template, form.body_template]);

  const vars = useMemo(
    () => extractVars(form.subject_template, form.body_template),
    [form.subject_template, form.body_template]
  );

  const canSave =
    form.name.trim().length > 0 &&
    form.template_key.trim().length > 0 &&
    form.subject_template.trim().length > 0 &&
    form.body_template.trim().length > 0 &&
    health.ok;

  function update(k, v) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function save() {
    if (!canSave) return;
    onSave?.({
      ...form,
      id: template?.id || ('tpl-' + Date.now().toString(36)),
      updated_at: new Date().toISOString().slice(0,10),
      sent_count_30d: template?.sent_count_30d ?? 0,
    });
    onClose?.();
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <motion.aside
        className="tpl-drawer"
        initial={{ x:'100%' }}
        animate={{ x:0 }}
        exit={{ x:'100%' }}
        transition={{ type:'spring', stiffness:260, damping:30 }}
      >
        {/* Head */}
        <div className="tpl-drawer-head">
          <div>
            <div className="micro" style={{ marginBottom:4 }}>
              {isEdit
                ? (lang==='es'?'EDITAR PLANTILLA':'EDIT TEMPLATE')
                : (lang==='es'?'NUEVA PLANTILLA':'NEW TEMPLATE')}
            </div>
            <div className="heading-md">
              {form.name || (lang==='es'?'Sin título':'Untitled')}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <IconX size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="tpl-drawer-body">
          {/* ── Metadata row ─────────────────── */}
          <div className="tpl-field-grid">
            <div className="tpl-field">
              <label className="tpl-label">{lang==='es'?'Nombre descriptivo':'Display name'}</label>
              <input
                className="input"
                placeholder={lang==='es'?'Ej. Aviso de Despacho':'E.g. Dispatch Notice'}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>
            <div className="tpl-field">
              <label className="tpl-label">
                <span className="mono" style={{ fontSize:11 }}>template_key</span>
                <span className="tpl-hint micro">
                  {lang==='es'?'clave técnica · único por brand/idioma':'technical key · unique per brand/lang'}
                </span>
              </label>
              <input
                className="input mono"
                placeholder="expediente.dispatched"
                value={form.template_key}
                onChange={(e) => update('template_key', e.target.value)}
                disabled={isEdit}
              />
            </div>
          </div>

          <div className="tpl-field-grid">
            <div className="tpl-field">
              <label className="tpl-label">{lang==='es'?'Idioma':'Language'}</label>
              <select
                className="input"
                value={form.language}
                onChange={(e) => update('language', e.target.value)}
              >
                {EMAIL_LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="tpl-field">
              <label className="tpl-label">{lang==='es'?'Marca':'Brand'}</label>
              <select
                className="input"
                value={form.brand}
                onChange={(e) => update('brand', e.target.value)}
              >
                {EMAIL_BRANDS.map(b => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
            <div className="tpl-field">
              <label className="tpl-label">{lang==='es'?'Estado':'Status'}</label>
              <label className="tpl-toggle">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => update('is_active', e.target.checked)}
                />
                <span className="tpl-toggle-track"/>
                <span className="tpl-toggle-label">
                  {form.is_active
                    ? (lang==='es'?'Activa':'Active')
                    : (lang==='es'?'Inactiva':'Inactive')}
                </span>
              </label>
            </div>
          </div>

          {/* ── Subject ───────────────────── */}
          <div className="tpl-field">
            <label className="tpl-label">{lang==='es'?'Asunto (Jinja2)':'Subject (Jinja2)'}</label>
            <input
              className="input mono"
              placeholder="Expediente {{ expediente_code }} registrado"
              value={form.subject_template}
              onChange={(e) => update('subject_template', e.target.value)}
            />
          </div>

          {/* ── Body ───────────────────── */}
          <div className="tpl-field">
            <label className="tpl-label">
              <span>{lang==='es'?'Cuerpo (texto plano + Jinja2)':'Body (plain text + Jinja2)'}</span>
              <span className="tpl-hint micro">
                {lang==='es'?'sin HTML · usa {{ variable }} para renderizar':'no HTML · use double braces for variables'}
              </span>
            </label>
            <textarea
              className="input mono tpl-textarea"
              rows={14}
              placeholder={`Hola {{ client_name }},\n\nTu expediente {{ expediente_code }}...\n`}
              value={form.body_template}
              onChange={(e) => update('body_template', e.target.value)}
            />
          </div>

          {/* ── Validación ─────────────────── */}
          {!health.ok && (
            <div className="tpl-warn">
              <IconAlert size={14}/>
              <div>
                <div className="heading-sm" style={{ color:'var(--warning, #B45309)' }}>
                  {lang==='es'?'Sintaxis Jinja2':'Jinja2 syntax'}
                </div>
                <ul style={{ margin:0, paddingLeft:16, fontSize:12 }}>
                  {health.problems.map((p,i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* ── Preview ─────────────────── */}
          <div className="tpl-preview-card">
            <div className="tpl-preview-head">
              <div className="flex ai-center gap-2">
                <IconEye size={13} style={{ color:'var(--brand-accent, #00B286)' }}/>
                <div className="heading-sm" style={{ margin:0 }}>
                  {lang==='es'?'Preview con Jinja2 resaltado':'Preview with Jinja2 highlights'}
                </div>
              </div>
              <div className="tpl-vars-chips">
                {vars.map(v => (
                  <span key={v} className="jinja-chip mono">{v}</span>
                ))}
                {vars.length === 0 && (
                  <span className="micro text-sec">
                    {lang==='es'?'Sin variables':'No variables'}
                  </span>
                )}
              </div>
            </div>
            <div className="tpl-preview-body">
              <div className="tpl-preview-subject">
                <div className="micro">{lang==='es'?'ASUNTO':'SUBJECT'}</div>
                <div className="tpl-preview-text">
                  {renderJinja(form.subject_template).map(f =>
                    f.type === 'tok'
                      ? <span key={f.k} className="jinja-token">{f.value}</span>
                      : <span key={f.k}>{f.value}</span>
                  )}
                  {!form.subject_template && (
                    <span className="text-sec">—</span>
                  )}
                </div>
              </div>
              <div className="tpl-preview-content">
                <pre className="tpl-preview-pre">
                  {renderJinja(form.body_template).map(f =>
                    f.type === 'tok'
                      ? <span key={f.k} className="jinja-token">{f.value}</span>
                      : <span key={f.k}>{f.value}</span>
                  )}
                  {!form.body_template && (
                    <span className="text-sec">—</span>
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="tpl-drawer-foot">
          <div className="micro" style={{ color: health.ok ? 'var(--success, #0E8A6D)' : 'var(--warning, #B45309)' }}>
            {health.ok
              ? (lang==='es'?'Sintaxis OK':'Syntax OK')
              : (lang==='es'?'Sintaxis Jinja2 inválida':'Invalid Jinja2 syntax')}
          </div>
          <div className="flex ai-center gap-2">
            <button className="btn btn-ghost" onClick={onClose}>
              {lang==='es'?'Cancelar':'Cancel'}
            </button>
            <button
              className="btn btn-accent"
              onClick={save}
              disabled={!canSave}
            >
              <IconCheck size={12}/>
              {isEdit
                ? (lang==='es'?'Guardar cambios':'Save changes')
                : (lang==='es'?'Crear plantilla':'Create template')}
            </button>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
