// Artifacts by state — board view for expediente detail
// Flow:
//  1. Each state (REGISTRO → CERRADO) is a column.
//  2. Inside each column: list of artifacts assigned to this expediente for that state.
//  3. "+ Agregar artefacto" on a column → ModalPickArtifact → pick from ARTIFACT_CATALOG.
//  4. Each artifact card shows its records + "+ Agregar registro" → ModalAddRecord.
import React, { useState } from "react";
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  IconPlus, IconFileText, IconCheck, IconSearch, IconUpload, IconX,
} from "../lib/icons.jsx";
import {
  STATES, HERO_ID, ARTIFACT_CATALOG, HERO_ARTIFACT_RECORDS,
} from "../data/mockData.js";

export function ArtifactsBoard({ expedienteId, lang }) {
  // Initialize from HERO_ARTIFACT_RECORDS if hero, else empty
  const isHero = expedienteId === HERO_ID;
  const [records, setRecords] = useState(() => isHero ? JSON.parse(JSON.stringify(HERO_ARTIFACT_RECORDS)) : {});
  const [assigned, setAssigned] = useState(() => isHero ? new Set(Object.keys(HERO_ARTIFACT_RECORDS)) : new Set());
  const [pickState, setPickState] = useState(null);          // state for which we are picking
  const [recordModal, setRecordModal] = useState(null);       // { artifact, editing? }
  const [viewArtifact, setViewArtifact] = useState(null);     // expanded records view

  const VISIBLE_STATES = STATES; // all 7

  const artifactsForState = (state) =>
    ARTIFACT_CATALOG.filter(a => a.state === state && assigned.has(a.id));

  const availableForState = (state) =>
    ARTIFACT_CATALOG.filter(a => a.state === state && !assigned.has(a.id));

  const addArtifact = (id) => {
    setAssigned(prev => { const n = new Set(prev); n.add(id); return n; });
    if (!records[id]) setRecords(prev => ({ ...prev, [id]: [] }));
    setPickState(null);
  };

  const saveRecord = (artifactId, values) => {
    const newRec = {
      id: 'R-' + Math.random().toString(36).slice(2, 8),
      created: new Date().toISOString().slice(0,10),
      author: 'A. Mendoza',
      ...values,
    };
    setRecords(prev => ({ ...prev, [artifactId]: [...(prev[artifactId]||[]), newRec] }));
    setRecordModal(null);
  };

  return (
    <div className="artifacts-board-wrap">
      <div className="artifacts-board">
        {VISIBLE_STATES.map(state => {
          const items = artifactsForState(state);
          return (
            <div key={state} className="ab-column" data-state={state}>
              <div className="ab-col-head">
                <div className="ab-col-title">
                  <span className="ab-state-dot" data-state={state}/>
                  <span>{tr(lang, state)}</span>
                  <span className="ab-col-count">{items.length}</span>
                </div>
                <button className="ab-add-artifact" onClick={()=>setPickState(state)}>
                  <IconPlus size={12}/> {lang==='es'?'Artefacto':'Artifact'}
                </button>
              </div>
              <div className="ab-col-body">
                {items.length === 0 && (
                  <div className="ab-empty">
                    <IconFileText size={18}/>
                    <span>{lang==='es'?'Sin artefactos':'No artifacts'}</span>
                  </div>
                )}
                {items.map(art => {
                  const recs = records[art.id] || [];
                  return (
                    <div key={art.id} className="ab-artifact">
                      <div className="ab-art-head" onClick={()=>setViewArtifact(art)}>
                        <div style={{flex:1, minWidth:0}}>
                          <div className="ab-art-code">{art.code}</div>
                          <div className="ab-art-name">{art.name}</div>
                        </div>
                        <div className="ab-art-count">{recs.length}</div>
                      </div>
                      <div className="ab-art-records">
                        {recs.slice(-2).map(r => (
                          <div key={r.id} className="ab-rec-mini" onClick={()=>setViewArtifact(art)}>
                            <IconCheck size={10}/>
                            <span className="ab-rec-preview">{recordSummary(art, r, lang)}</span>
                            <span className="ab-rec-date">{r.created}</span>
                          </div>
                        ))}
                        {recs.length > 2 && (
                          <div className="ab-rec-more" onClick={()=>setViewArtifact(art)}>
                            +{recs.length-2} {lang==='es'?'más':'more'}
                          </div>
                        )}
                      </div>
                      <button className="ab-add-record" onClick={()=>setRecordModal({ artifact: art })}>
                        <IconPlus size={11}/> {lang==='es'?'Agregar registro':'Add record'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {pickState && (
        <ModalPickArtifact
          state={pickState}
          lang={lang}
          available={availableForState(pickState)}
          onPick={addArtifact}
          onClose={()=>setPickState(null)}
        />
      )}

      {recordModal && (
        <ModalAddRecord
          artifact={recordModal.artifact}
          lang={lang}
          onSave={(vals)=>saveRecord(recordModal.artifact.id, vals)}
          onClose={()=>setRecordModal(null)}
        />
      )}

      {viewArtifact && (
        <ModalViewRecords
          artifact={viewArtifact}
          records={records[viewArtifact.id] || []}
          lang={lang}
          onAddRecord={()=>{ setRecordModal({ artifact: viewArtifact }); setViewArtifact(null); }}
          onClose={()=>setViewArtifact(null)}
        />
      )}
    </div>
  );
}

// ── Compact summary of a record (first meaningful field) ─────
function recordSummary(art, r, lang) {
  const prefer = ['oc_number','pf_code','sap_number','bl_code','ci_code','pl_code','dua_code','invoice_code','booking_ref','policy','dex_code','po_fab','progress_pct','qc_status','location','date','amount'];
  for (const k of prefer) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== '') {
      const f = art.fields.find(ff => ff.k === k);
      if (f?.type === 'money') return fmtMoney(r[k]);
      if (k === 'progress_pct') return r[k] + '%';
      return String(r[k]).slice(0, 26);
    }
  }
  return (lang==='es'?'Registro':'Record');
}

// ── Modal: pick artifact from catalog ─────
function ModalPickArtifact({ state, lang, available, onPick, onClose }) {
  const [q, setQ] = useState('');
  const filtered = available.filter(a =>
    !q || (a.name+' '+a.code).toLowerCase().includes(q.toLowerCase())
  );
  return (
    <ModalShell onClose={onClose} title={lang==='es'?'Buscar artefacto':'Find artifact'}
      subtitle={`${tr(lang,'state')}: ${tr(lang, state)} · ${available.length} ${lang==='es'?'disponibles':'available'}`}>
      <div className="mdl-search">
        <IconSearch size={13}/>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
          placeholder={lang==='es'?'Escribe código o nombre…':'Type code or name…'}/>
      </div>
      <div className="mdl-list">
        {filtered.length === 0 && (
          <div className="mdl-empty">
            <IconCheck size={16}/>
            <span>{lang==='es'?'Todos los artefactos de este estado ya están agregados':'All artifacts for this state are already added'}</span>
          </div>
        )}
        {filtered.map(a => (
          <div key={a.id} className="mdl-row" onClick={()=>onPick(a.id)}>
            <div className="mdl-row-icon"><IconFileText size={14}/></div>
            <div style={{flex:1, minWidth:0}}>
              <div className="mdl-row-name">
                <span className="mdl-row-code">{a.code}</span>
                <span>{a.name}</span>
              </div>
              <div className="caption">{a.fields.length} {lang==='es'?'campos · tipo':'fields · type'} {a.kind}</div>
            </div>
            <button className="btn btn-primary btn-sm"><IconPlus size={11}/>{lang==='es'?'Agregar':'Add'}</button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

// ── Modal: add/edit record (dynamic fields) ─────
function ModalAddRecord({ artifact, lang, onSave, onClose }) {
  const [vals, setVals] = useState(() => Object.fromEntries(artifact.fields.map(f => [f.k, f.type==='number' ? 0 : f.type==='money' ? 0 : ''])));
  const update = (k, v) => setVals(prev => ({ ...prev, [k]: v }));
  const canSave = artifact.fields.some(f => vals[f.k] !== '' && vals[f.k] !== 0);
  return (
    <ModalShell onClose={onClose}
      title={`${artifact.code} · ${artifact.name}`}
      subtitle={`${tr(lang,'state')}: ${tr(lang, artifact.state)} · ${lang==='es'?'Nuevo registro':'New record'}`}>
      <div className="mdl-form">
        {artifact.fields.map(f => (
          <div key={f.k} className="mdl-field">
            <label>{f.l}</label>
            {f.type === 'text' && <input className="input" value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}/>}
            {f.type === 'number' && <input className="input" type="number" value={vals[f.k]||0} onChange={e=>update(f.k, +e.target.value)}/>}
            {f.type === 'money' && (
              <div className="input" style={{display:'flex', alignItems:'center', gap:6}}>
                <span style={{color:'var(--text-tertiary)', fontWeight:500}}>USD</span>
                <input type="number" style={{border:0, background:'transparent', outline:'none', flex:1, font:'inherit'}}
                  value={vals[f.k]||0} onChange={e=>update(f.k, +e.target.value)}/>
              </div>
            )}
            {f.type === 'date' && <input className="input" type="date" value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}/>}
            {f.type === 'datetime' && <input className="input" type="datetime-local" value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}/>}
            {f.type === 'textarea' && <textarea className="input" rows={3} value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}/>}
            {f.type === 'select' && (
              <select className="select" value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}>
                <option value="">{lang==='es'?'Seleccionar…':'Select…'}</option>
                {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === 'file' && (
              <div className="mdl-file">
                <IconUpload size={12}/>
                <span>{vals[f.k] ? vals[f.k] : (lang==='es'?'Subir archivo…':'Upload file…')}</span>
                <input type="text" placeholder="nombre_archivo.pdf" value={vals[f.k]||''} onChange={e=>update(f.k, e.target.value)}/>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mdl-footer">
        <button className="btn btn-ghost" onClick={onClose}>{lang==='es'?'Cancelar':'Cancel'}</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={()=>onSave(vals)}>
          <IconCheck size={13}/> {lang==='es'?'Guardar registro':'Save record'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Modal: view all records of an artifact ─────
function ModalViewRecords({ artifact, records, lang, onAddRecord, onClose }) {
  return (
    <ModalShell onClose={onClose}
      title={`${artifact.code} · ${artifact.name}`}
      subtitle={`${records.length} ${lang==='es'?'registros':'records'} · ${tr(lang, artifact.state)}`}
      wide>
      <div className="mdl-records">
        {records.length === 0 && (
          <div className="mdl-empty">
            <IconFileText size={16}/>
            <span>{lang==='es'?'Este artefacto aún no tiene registros':'This artifact has no records yet'}</span>
          </div>
        )}
        {records.map((r, idx) => (
          <div key={r.id} className="rec-card">
            <div className="rec-card-head">
              <div className="rec-card-badge">#{idx+1}</div>
              <div style={{flex:1}}>
                <div className="rec-card-title">{recordSummary(artifact, r, lang)}</div>
                <div className="caption">{r.created} · {r.author}</div>
              </div>
            </div>
            <div className="rec-card-fields">
              {artifact.fields.map(f => {
                const v = r[f.k];
                if (v === undefined || v === null || v === '') return null;
                let display = String(v);
                if (f.type === 'money') display = fmtMoney(v);
                if (f.type === 'number' && f.k === 'progress_pct') display = v + '%';
                return (
                  <div key={f.k} className="rec-card-field">
                    <span className="rec-card-label">{f.l}</span>
                    <span className="rec-card-value" style={f.type==='file'?{color:'var(--brand-primary)', textDecoration:'underline'}:{}}>{display}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mdl-footer">
        <button className="btn btn-ghost" onClick={onClose}>{lang==='es'?'Cerrar':'Close'}</button>
        <button className="btn btn-primary" onClick={onAddRecord}>
          <IconPlus size={13}/> {lang==='es'?'Agregar registro':'Add record'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shared modal shell ─────
function ModalShell({ title, subtitle, children, onClose, wide }) {
  return (
    <div className="mdl-backdrop" onClick={(e)=>{ if (e.target.classList.contains('mdl-backdrop')) onClose(); }}>
      <div className="mdl-panel" data-wide={wide}>
        <div className="mdl-head">
          <div>
            <div className="mdl-title">{title}</div>
            <div className="mdl-subtitle">{subtitle}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
        </div>
        <div className="mdl-body">{children}</div>
      </div>
    </div>
  );
}
