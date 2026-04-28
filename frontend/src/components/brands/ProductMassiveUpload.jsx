// ─────────────────────────────────────────────────────────────
// ProductMassiveUpload — Dropzone Excel/CSV para catálogo masivo
// Agente responsable: [AG-FRONTEND]
//
// Flujo Excel (2-step, .xlsx / .xls):
//   1. Usuario suelta .xlsx → parsea con SheetJS en cliente
//   2. Auto-mapping columnas Excel ↔ atributos canónicos
//   3. Confirm import → POST /api/marcas/{marcaId}/upload_productos_preview/
//   4. Si preview OK → POST /api/marcas/{marcaId}/upload_productos_commit/
//      con idempotence_token para que reintentos sean seguros.
//
// Flujo CSV directo (Hikashop, .csv):
//   1. Usuario suelta .csv → NO se parsea en cliente.
//   2. POST multipart /api/productos/bulk-upload-csv/?brand_id={marcaId}
//      con el archivo crudo en `file`. El backend devuelve
//      {created, updated, skipped, errors[]}.
//
// Nota: `marcaId` es obligatorio para que el upload sea real; si no viene,
// el componente sigue funcionando en modo "solo-cliente" y emite onParsed
// con las filas parseadas (útil para testing del parser Excel).
// ─────────────────────────────────────────────────────────────
import React, { useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  IconUpload, IconFileText, IconX, IconCheck, IconAlert, IconRefresh, IconDownload,
} from "../../lib/icons.jsx";
import { BRAND_ATTRIBUTES } from "../../data/mockData.js";
import { marcasApi, getToken } from "../../lib/api.js";

/* Campos canónicos target (fila orden de detección) */
const CANONICAL_FIELDS = [
  { k:'sku',                   l:'SKU',                   required:true  },
  { k:'nombre',                l:'Nombre del producto',   required:true  },
  { k:'precio_usd',            l:'Precio USD',            required:true  },
  { k:'tipo_calzado',          l:'Tipo Calzado',          opts:'tipo_calzado' },
  { k:'cubrepuntera',          l:'Cubrepuntera',          opts:'cubrepuntera' },
  { k:'tipo_puntera',          l:'Tipo Puntera',          opts:'tipo_puntera' },
  { k:'antiperforante',        l:'Antiperforante',        opts:'antiperforante' },
  { k:'protector_metatarsal',  l:'Protector Metatarsal',  opts:'protector_metatarsal' },
  { k:'capellada',             l:'Capellada',             opts:'capellada' },
  { k:'disipativo_energia',    l:'Disipativo de Energía', opts:'disipativo_energia' },
  { k:'suela',                 l:'Suela',                 opts:'suela' },
  { k:'normativa',             l:'Normativa',             opts:'normativa' },
  { k:'cierre',                l:'Cierre',                opts:'cierre' },
  { k:'color',                 l:'Color',                 opts:'color' },
  { k:'segmento',              l:'Segmento',              opts:'segmento' },
  { k:'materiales_circulares', l:'Materiales Econ. Circulares', opts:'materiales_circulares' },
  { k:'plantilla_interna',     l:'Plantilla Interna',     opts:'plantilla_interna' },
  { k:'ncm',                   l:'NCM' },
  { k:'riesgo',                l:'Riesgo',                opts:'riesgo' },
];

/* Auto-matcher fuzzy: compara header normalizado */
function normalize(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function autoMatch(header) {
  const n = normalize(header);
  const direct = CANONICAL_FIELDS.find(f => normalize(f.k) === n);
  if (direct) return direct.k;
  const byLabel = CANONICAL_FIELDS.find(f => normalize(f.l) === n);
  if (byLabel) return byLabel.k;
  const partial = CANONICAL_FIELDS.find(f =>
    n.includes(normalize(f.k)) || normalize(f.k).includes(n)
  );
  if (partial) return partial.k;
  const partialL = CANONICAL_FIELDS.find(f =>
    n.includes(normalize(f.l)) || normalize(f.l).includes(n)
  );
  return partialL?.k || null;
}

/* Genera un token de idempotencia simple (no crypto-grade — suficiente para
   prevenir dobles commits en esta sesión). */
function makeIdempToken() {
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function ProductMassiveUpload({ lang='es', marcaId, onParsed, onClose }) {
  const fileRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage]   = useState('idle');
                              // idle | parsing | mapping | uploading | done | error
  const [fileName, setFileName] = useState(null);
  const [header, setHeader] = useState([]);
  const [rows,   setRows]   = useState([]);
  const [mapping, setMapping] = useState({});  // { excelColIdx: canonicalKey | 'ignore' }
  const [serverResult, setServerResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // ─────────────────────────────────────────────────────────────
  // Flujo Hikashop / bulk-upload-csv
  // Sube el CSV crudo en multipart al endpoint nuevo. NO parseamos
  // en cliente: el backend procesa las 95 columnas Hikashop directamente.
  // ─────────────────────────────────────────────────────────────
  async function uploadCsvDirect(file) {
    setFileName(file.name);
    setStage('uploading');
    setErrorMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const url = `${import.meta.env.VITE_API_BASE || '/api'}/productos/bulk-upload-csv/?brand_id=${encodeURIComponent(marcaId)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail || `HTTP ${resp.status}`);
      setServerResult({ csvDirect: true, ...data });
      setStage('done');
      onParsed && onParsed({ csvDirect: true, ...data, fileName: file.name });
    } catch (e) {
      console.error('[ProductMassiveUpload] csv upload failed', e);
      setErrorMsg(`${lang==='es'?'Error al subir CSV: ':'CSV upload failed: '}${e.message || ''}`);
      setStage('error');
    }
  }

  /* Parse real con SheetJS — solo para .xlsx / .xls.
     Para .csv saltamos al flujo directo Hikashop. */
  const parseFile = (file) => {
    const name = file?.name || '';
    if (name.toLowerCase().endsWith('.csv')) {
      // Flujo Hikashop / bulk-upload-csv: subir crudo, sin parsear.
      uploadCsvDirect(file);
      return;
    }
    setFileName(name || 'catalogo.xlsx');
    setStage('parsing');
    setErrorMsg('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        const ws   = wb.Sheets[firstSheet];
        // header:1 → devuelve array de arrays (primera fila = cabeceras)
        const aoa  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!aoa.length) {
          setErrorMsg(lang==='es' ? 'El archivo está vacío.' : 'File is empty.');
          setStage('error');
          return;
        }
        const rawHeader = aoa[0].map((h) => (h == null ? '' : String(h)));
        const rawRows   = aoa.slice(1).filter(r => r.some(v => String(v ?? '').trim() !== ''));

        setHeader(rawHeader);
        setRows(rawRows);

        const m = {};
        rawHeader.forEach((col, i) => {
          m[i] = autoMatch(col) || 'ignore';
        });
        setMapping(m);
        setStage('mapping');
      } catch (err) {
        console.error('[ProductMassiveUpload] parse error', err);
        setErrorMsg(lang==='es'
          ? 'No se pudo leer el archivo. Verifica formato.'
          : 'Could not read the file. Check the format.');
        setStage('error');
      }
    };
    reader.onerror = () => {
      setErrorMsg(lang==='es' ? 'Error leyendo el archivo.' : 'File read error.');
      setStage('error');
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) parseFile(f);
  };
  const handlePick = (e) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const matchedCount = useMemo(
    () => Object.values(mapping).filter(v => v && v !== 'ignore').length,
    [mapping]
  );
  const requiredMatched = useMemo(() => {
    const mapped = new Set(Object.values(mapping).filter(v => v && v !== 'ignore'));
    return CANONICAL_FIELDS.filter(f => f.required).every(f => mapped.has(f.k));
  }, [mapping]);

  /* Confirm → sube preview y luego commit contra el backend. */
  const confirm = async () => {
    // Estructuramos filas { sku, nombre, precio_usd, ... } usando el mapping.
    const structuredRows = rows.map(r => {
      const obj = {};
      header.forEach((col, i) => {
        const target = mapping[i];
        if (target && target !== 'ignore') obj[target] = r[i];
      });
      return obj;
    });

    // Mapping exportable para el backend: { "SKU": "sku", ... }.
    const mappingExport = {};
    header.forEach((col, i) => {
      const target = mapping[i];
      if (target && target !== 'ignore') mappingExport[col] = target;
    });

    // Si no tenemos marcaId, fallback a solo-cliente (testing/dry-run).
    if (!marcaId) {
      setStage('done');
      onParsed && onParsed({ rows: structuredRows, mapping: mappingExport, fileName });
      return;
    }

    setStage('uploading');
    setErrorMsg('');
    try {
      const preview = await marcasApi.action('upload_productos_preview', marcaId, {
        filename: fileName,
        mapping:  mappingExport,
        rows:     structuredRows,
      });

      if (preview.status === 'REJECTED') {
        setErrorMsg(lang==='es'
          ? `Todas las filas fueron rechazadas (${preview.invalid} inválidas).`
          : `All rows rejected (${preview.invalid} invalid).`);
        setServerResult(preview);
        setStage('error');
        return;
      }

      const idemToken = makeIdempToken();
      const commit = await marcasApi.action('upload_productos_commit', marcaId, {
        import_id:         preview.import_id,
        idempotence_token: idemToken,
      });

      setServerResult({ ...preview, ...commit });
      setStage('done');
      onParsed && onParsed({
        rows:      structuredRows,
        mapping:   mappingExport,
        fileName,
        import_id: preview.import_id,
        committed: commit.committed_rows,
        status:    commit.status,
      });
    } catch (e) {
      console.error('[ProductMassiveUpload] upload failed', e);
      setErrorMsg((lang==='es' ? 'Error al subir: ' : 'Upload failed: ') + (e?.message || ''));
      setStage('error');
    }
  };

  const reset = () => {
    setStage('idle'); setFileName(null);
    setHeader([]); setRows([]); setMapping({});
    setServerResult(null); setErrorMsg('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="mass-upload">
      {/* ─── Dropzone (idle) ─── */}
      {stage === 'idle' && (
        <motion.div
          className="dropzone"
          data-dragging={isDragging}
          onDragOver={(e)=>{e.preventDefault(); setIsDragging(true);}}
          onDragLeave={()=>setIsDragging(false)}
          onDrop={handleDrop}
          onClick={()=>fileRef.current?.click()}
          initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}
          whileHover={{ y: -2 }}
        >
          <motion.div
            className="dropzone-icon"
            animate={isDragging ? { scale: 1.1, rotate: -4 } : { scale: 1, rotate: 0 }}
            transition={{ type:'spring', stiffness:260, damping:18 }}
          >
            <IconUpload size={22}/>
          </motion.div>
          <div className="heading-md">
            {lang==='es'
              ? (isDragging ? 'Suelta tu Excel aquí' : 'Arrastra tu Excel o haz click')
              : (isDragging ? 'Drop your Excel here' : 'Drag your Excel or click')}
          </div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            .xlsx · .xls · .csv — {lang==='es'?'hasta 5 MB':'up to 5 MB'}
          </div>
          <div className="mass-helpers">
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e)=>{e.stopPropagation();}}>
              <IconDownload size={12}/> {lang==='es'?'Plantilla de ejemplo':'Sample template'}
            </button>
          </div>
          <input
            ref={fileRef} type="file" style={{display:'none'}}
            accept=".xlsx,.xls,.csv"
            onChange={handlePick}
          />
        </motion.div>
      )}

      {/* ─── Parsing ─── */}
      {stage === 'parsing' && (
        <div className="dropzone dropzone-parsing">
          <motion.div className="dropzone-icon"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}>
            <IconRefresh size={20}/>
          </motion.div>
          <div className="heading-md">{lang==='es'?'Analizando archivo…':'Analyzing file…'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>{fileName}</div>
        </div>
      )}

      {/* ─── Uploading (preview + commit · o CSV directo Hikashop) ─── */}
      {stage === 'uploading' && (
        <div className="dropzone dropzone-parsing">
          <motion.div className="dropzone-icon"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}>
            <IconRefresh size={20}/>
          </motion.div>
          <div className="heading-md">
            {lang==='es'?'Subiendo al servidor…':'Uploading to server…'}
          </div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {rows.length > 0
              ? <>{rows.length} {lang==='es'?'filas':'rows'} · {fileName}</>
              : fileName}
          </div>
        </div>
      )}

      {/* ─── Error ─── */}
      {stage === 'error' && (
        <div className="dropzone dropzone-parsing" style={{borderColor:'var(--critical)'}}>
          <div className="dropzone-icon" style={{background:'var(--critical-bg,#fee)', color:'var(--critical)'}}>
            <IconAlert size={22}/>
          </div>
          <div className="heading-md">{lang==='es'?'Error en la carga':'Upload error'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {errorMsg || (lang==='es'?'Algo salió mal.':'Something went wrong.')}
          </div>
          {serverResult?.errors?.length > 0 && (
            <ul className="caption" style={{color:'var(--text-tertiary)', marginTop:8, maxHeight:120, overflow:'auto'}}>
              {serverResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {lang==='es'?'Fila':'Row'} {e.row}: {(e.missing || []).join(', ')}
                </li>
              ))}
              {serverResult.errors.length > 10 && (
                <li>+ {serverResult.errors.length - 10} {lang==='es'?'más':'more'}</li>
              )}
            </ul>
          )}
          <div className="mass-helpers">
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
              <IconRefresh size={12}/> {lang==='es'?'Intentar de nuevo':'Try again'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Mapping preview ─── */}
      {stage === 'mapping' && (
        <AnimatePresence>
          <motion.div
            initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
            transition={{duration:0.18}}
            className="mapping-wrap"
          >
            <div className="mapping-head">
              <div>
                <div className="heading-md" style={{display:'flex', alignItems:'center', gap:8}}>
                  <IconFileText size={14}/> {fileName}
                </div>
                <div className="caption" style={{color:'var(--text-tertiary)'}}>
                  {rows.length} {lang==='es'?'filas detectadas':'rows detected'} · {matchedCount}/{header.length} {lang==='es'?'columnas mapeadas':'columns mapped'}
                </div>
              </div>
              <div className="flex ai-center gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                  <IconX size={12}/> {lang==='es'?'Cambiar archivo':'Change file'}
                </button>
                <button type="button" className="btn btn-primary btn-sm"
                        disabled={!requiredMatched} onClick={confirm}>
                  <IconCheck size={12}/> {lang==='es'?'Confirmar import':'Confirm import'}
                </button>
              </div>
            </div>

            {!requiredMatched && (
              <div className="alert-row alert-warning" style={{marginBottom:10}}>
                <div className="alert-icon"><IconAlert size={14}/></div>
                <div className="alert-body">
                  <div className="alert-msg">
                    {lang==='es'
                      ? 'Faltan mapear campos requeridos: SKU, Nombre y Precio USD.'
                      : 'Required fields missing: SKU, Name and USD Price.'}
                  </div>
                </div>
              </div>
            )}

            <div className="card card-pad-0 mapping-table-wrap">
              <table className="table mapping-table">
                <thead>
                  <tr>
                    <th style={{width: 60}}>#</th>
                    <th style={{width: '26%'}}>{lang==='es'?'Columna Excel':'Excel column'}</th>
                    <th style={{width: '22%'}}>{lang==='es'?'Muestra':'Sample'}</th>
                    <th>{lang==='es'?'Campo canónico':'Canonical field'}</th>
                    <th style={{width: 60}}></th>
                  </tr>
                </thead>
                <tbody>
                  {header.map((col, i) => {
                    const target = mapping[i] || 'ignore';
                    const isIgnore = target === 'ignore';
                    const canonical = CANONICAL_FIELDS.find(f => f.k === target);
                    const sampleRaw = rows[0]?.[i] ?? '—';
                    const optsList  = canonical?.opts ? BRAND_ATTRIBUTES[canonical.opts] : null;
                    const sampleValid = optsList ? optsList.includes(sampleRaw) : true;

                    return (
                      <tr key={i} data-ignored={isIgnore}>
                        <td className="mono-sm" style={{color:'var(--text-tertiary)'}}>{i+1}</td>
                        <td className="mono-sm">{col || <em style={{color:'var(--text-tertiary)'}}>({lang==='es'?'sin título':'untitled'})</em>}</td>
                        <td>
                          <span className="mono-sm" style={{color: sampleValid ? 'var(--text-primary)' : 'var(--critical)'}}>
                            {String(sampleRaw)}
                          </span>
                          {!sampleValid && (
                            <span className="caption" style={{color:'var(--critical)', marginLeft:6}}>
                              ⚠ {lang==='es'?'fuera de enum':'not in enum'}
                            </span>
                          )}
                        </td>
                        <td>
                          <select
                            className="select select-sm"
                            value={target}
                            onChange={(e)=>setMapping(m => ({ ...m, [i]: e.target.value }))}
                            data-match={isIgnore ? 'none' : (canonical?.required ? 'required' : 'ok')}
                          >
                            <option value="ignore">— {lang==='es'?'ignorar':'ignore'} —</option>
                            {CANONICAL_FIELDS.map(f => (
                              <option key={f.k} value={f.k}>
                                {f.l}{f.required ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{textAlign:'center'}}>
                          {isIgnore
                            ? <span className="dot-mini dot-ignore" title="ignorada"/>
                            : (canonical?.required
                                ? <span className="dot-mini dot-req" title="requerido mapeado"/>
                                : <span className="dot-mini dot-ok" title="mapeado"/>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* ─── Done ─── */}
      {stage === 'done' && (
        <motion.div
          initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
          className="dropzone dropzone-done"
        >
          <div className="dropzone-icon" style={{background:'var(--success-bg)', color:'var(--success)'}}>
            <IconCheck size={22}/>
          </div>
          <div className="heading-md">
            {lang==='es'?'Import confirmado':'Import confirmed'}
          </div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {(serverResult?.csvDirect || serverResult?.created != null) ? (
              lang==='es'
                ? <>{serverResult?.created ?? 0} creados, {serverResult?.updated ?? 0} actualizados, {serverResult?.skipped ?? 0} saltados. {serverResult?.errors?.length ?? 0} errores.</>
                : <>{serverResult?.created ?? 0} created, {serverResult?.updated ?? 0} updated, {serverResult?.skipped ?? 0} skipped. {serverResult?.errors?.length ?? 0} errors.</>
            ) : (
              <>
                {serverResult?.committed_rows ?? rows.length}{' '}
                {lang==='es'?'productos creados':'products created'}
                {serverResult?.invalid > 0 && (
                  <> · {serverResult.invalid} {lang==='es'?'rechazadas':'rejected'}</>
                )}
              </>
            )}
          </div>
          {(serverResult?.csvDirect || serverResult?.created != null) && serverResult?.errors?.length > 0 && (
            <ul className="caption" style={{color:'var(--text-tertiary)', marginTop:8, maxHeight:120, overflow:'auto', textAlign:'left'}}>
              {serverResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {typeof e === 'string'
                    ? e
                    : <>{lang==='es'?'Fila':'Row'} {e.row ?? '?'}: {e.message || (e.missing || []).join(', ') || JSON.stringify(e)}</>}
                </li>
              ))}
              {serverResult.errors.length > 10 && (
                <li>+ {serverResult.errors.length - 10} {lang==='es'?'más':'more'}</li>
              )}
            </ul>
          )}
          <div className="mass-helpers">
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
              <IconRefresh size={12}/> {lang==='es'?'Otro archivo':'Another file'}
            </button>
            {onClose && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                <IconCheck size={12}/> {lang==='es'?'Cerrar':'Close'}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
