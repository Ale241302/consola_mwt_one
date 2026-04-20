// ─────────────────────────────────────────────────────────────
// ProductMassiveUpload — Dropzone Excel para catálogo masivo
// Agente responsable: [AG-FRONTEND]
//
// Flujo:
//   1. Usuario arrastra .xlsx / .csv (animación de glow)
//   2. Se parsea el header (primera fila) — acá lo simulamos
//   3. Se muestra preview de MAPEO columnas Excel ↔ atributos canónicos
//      de calzado de seguridad (BRAND_ATTRIBUTES)
//   4. Cada fila puede: confirmar match, elegir target, ignorar
//   5. Submit → onParsed({ rows, mapping })
// ─────────────────────────────────────────────────────────────
import React, { useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconUpload, IconFileText, IconX, IconCheck, IconAlert, IconRefresh, IconDownload,
} from "../../lib/icons.jsx";
import { BRAND_ATTRIBUTES } from "../../data/mockData.js";

/* Campos canónicos target (fila orden de detección) */
const CANONICAL_FIELDS = [
  { k:'sku',                   l:'SKU',                   required:true  },
  { k:'nombre',                l:'Nombre del producto',   required:true  },
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
  // match exacto primero, luego contains
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

/* Simulación: cuando el usuario suelta un archivo construimos un header + rows fake  */
const MOCK_HEADER = [
  'SKU', 'Nombre producto', 'tipo_calzado', 'Cubrepuntera', 'Tipo_puntera',
  'Antiperforante', 'Protector metatarsal', 'Capellada', 'Disipativo de Energia',
  'Suela', 'Normativa', 'Cierre', 'color', 'Segmento',
  'Materiales circulares', 'Plantilla interna', 'NCM', 'riesgos',
  'observaciones', // columna extra sin match → debe quedar "ignore"
];
const MOCK_ROWS = [
  ['MLV-50S29-BLK-42','Bota 50S29 Plena Flor Negra','Bota al Tobillo','Sí','Composite 200J','Textil 1100 N','No','Cuero Plena Flor HIDRO','ABNT NBR 16603-2017 500V','Bidensidad PU','ABNT NBR 16.603:2017 500V - SECO','Con Cordones','Negro','Construcción','Suela','Etilvinilacetato ANT','6403.40.00','Caída Objetos','—'],
  ['MLV-40S18-BRN-41','Bota Alta 40S18 Hidro Marrón','Bota Alta','Sí','Acero 200J','Acero 1100 N','Externo','Cuero Vaqueta HIDRO','ISO 20345 14.000V','Caucho','ISO 20345','Con Cordones','Marron','Petroquimicos','No','Poliuretano','6403.40.00','Químicos','Pedido Petro-01'],
  ['MLV-EVA-AST-BLK-40','Zapato Antiestático Astillero','Zapato','Sí','Composite 200J','No','No','Microfibra','ISO 20345 14.000V ANT','Bidensidad PU','ISO 20345','Sin Cordones','Negro','Astillero','Sí','Etilvinilacetato','6402.99.00','Estática','—'],
  ['MLV-FUEGO-BRN-43','Bota Anti-llamas Siderúrgica','Bota Alta','Sí','Acero 200J','Acero 1100 N','Externo','Anti-llamas','Conductivo','Caucho','ISO 20345','Con Cordones','Castor','Siderurgia','No','Etilvinilacetato ANT','6403.40.00','Alta Temperatura','—'],
];

export default function ProductMassiveUpload({ lang='es', onParsed, onClose }) {
  const fileRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState('idle'); // idle | parsing | mapping | done
  const [fileName, setFileName] = useState(null);
  const [header, setHeader] = useState([]);
  const [rows,   setRows]   = useState([]);
  const [mapping, setMapping] = useState({});  // { excelColIdx: canonicalKey | 'ignore' }

  /* Fake parse — en producción: SheetJS `XLSX.read(file)` */
  const parseFile = (file) => {
    setFileName(file?.name || 'catalogo.xlsx');
    setStage('parsing');
    setTimeout(() => {
      setHeader(MOCK_HEADER);
      setRows(MOCK_ROWS);
      // Auto-mapping
      const m = {};
      MOCK_HEADER.forEach((col, i) => {
        m[i] = autoMatch(col) || 'ignore';
      });
      setMapping(m);
      setStage('mapping');
    }, 650);
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

  const confirm = () => {
    setStage('done');
    const structuredRows = rows.map(r => {
      const obj = {};
      header.forEach((col, i) => {
        const target = mapping[i];
        if (target && target !== 'ignore') obj[target] = r[i];
      });
      return obj;
    });
    onParsed && onParsed({ rows: structuredRows, mapping, fileName });
  };

  const reset = () => {
    setStage('idle'); setFileName(null);
    setHeader([]); setRows([]); setMapping({});
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
                      ? 'Faltan mapear campos requeridos: SKU y Nombre.'
                      : 'Required fields missing: SKU and Name.'}
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
                    const sampleRaw = rows[0]?.[i] || '—';
                    const optsList  = canonical?.opts ? BRAND_ATTRIBUTES[canonical.opts] : null;
                    const sampleValid = optsList ? optsList.includes(sampleRaw) : true;

                    return (
                      <tr key={i} data-ignored={isIgnore}>
                        <td className="mono-sm" style={{color:'var(--text-tertiary)'}}>{i+1}</td>
                        <td className="mono-sm">{col}</td>
                        <td>
                          <span className="mono-sm" style={{color: sampleValid ? 'var(--text-primary)' : 'var(--critical)'}}>
                            {sampleRaw}
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
            {rows.length} {lang==='es'?'productos listos para crear':'products ready to create'}
          </div>
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
