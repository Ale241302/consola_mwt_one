// =====================================================================
// MWT.ONE · OCDetail.jsx
//
// Vista de detalle de una Orden de Compra, con dos experiencias:
//
//   ADMIN (staff MWT)  → CRUD completo:
//       · Editar cantidades y precios de línea
//       · Agregar / eliminar productos
//       · "+ Agregar SAP" (ART-04 RegisterSAPConfirmation, C5)
//       · "+ Agregar Documento"
//       · Inputs deferred_qty + deferred_unit_price + toggle visibility
//       · Totales con "diferido" visible
//
//   CLIENT (Portal B2B) → Lectura + descarga:
//       · qty/precio visibles pero NO editables
//       · Sin "+ Agregar SAP" (ART-04 es estrictamente MWT-Factory)
//       · Sin "+ Agregar Documento" (cliente solo descarga via signed URL)
//       · Sin "+ Agregar producto", sin eliminar líneas
//       · Columnas deferred_qty/deferred_unit_price OCULTAS — nunca editar
//       · Si show_deferred_to_client=true en una línea → mostrar
//         "Precio acordado: $X" como lectura, NUNCA llamarlo "deferred"
//       · Credit clock KPI oculto (es interno)
//
// Fuente de autoridad: RoleContext (can, isAdmin, isClient). La protección
// real vive en el backend (apps.portal.ClientScopedManager + POL_VISIBILIDAD).
// =====================================================================
import React, { useState, useMemo } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import { StatusBadge, CreditDot, CountryFlag } from "../components/ui/primitives.jsx";
import {
  IconChevLeft, IconChevDown, IconChevRight, IconDownload, IconPlus,
  IconFolder, IconPlane, IconShip, IconAlert, IconX, IconSearch, IconPackage,
} from "../lib/icons.jsx";
import {
  OCS, CLIENTS, BRANDS, EXPEDIENTES, PRODUCTS, HERO_OC_ID,
} from "../data/mockData.js";
import AddSAPConfirmationDrawer from "../components/expedientes/AddSAPConfirmationDrawer.jsx";
import { useRole } from "../context/RoleContext.jsx";

export default function ScreenOCDetail() {
  const navigate = useNavigate();
  const { ocId: paramOcId } = useParams();
  const { lang } = useOutletContext();
  // Viewport efectivo + capability gates (ver POL_VISIBILIDAD).
  const { isAdmin, isClient, can } = useRole();
  const ocId = paramOcId || HERO_OC_ID;
  const onBack = () => navigate('/expedientes');
  const onOpenExpediente = (id) => {
    const oc = OCS.find(o => o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate('/expedientes');
  };

  // Si el ocId no matchea ningún mock, NO cayemos a OCS[0] (eso pintaba
  // datos quemados de Andes Retail Co. cuando el usuario aterrizaba con
  // un codigo real como EXP-2026-0001). En su lugar redirigimos al
  // listado para que el usuario reintente desde ahí. Una alternativa
  // sería fetch al API de OCs, pero por ahora el listado es suficiente.
  const ocFromMock = OCS.find(o => o.id === ocId);
  if (!ocFromMock) {
    // Soft-redirect dentro de un useEffect-like effect: hacemos navigate
    // y devolvemos null para no renderizar el detalle con datos basura.
    if (typeof window !== "undefined") {
      Promise.resolve().then(() => navigate('/expedientes', { replace: true }));
    }
    return null;
  }
  const oc = ocFromMock;
  const client = CLIENTS.find(c => c.id === oc.client_id);
  const brand  = BRANDS.find(b => b.id === oc.brand_id);

  // Local mutable line state (for deferred qty/price + visibility toggle)
  const [lineEdits, setLineEdits] = useState({});
  // Added / removed lines (on top of baseline oc.lines)
  const [extraLines, setExtraLines] = useState([]);
  const [removedLineIds, setRemovedLineIds] = useState(new Set());
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const [openSap, setOpenSap] = useState(null); // expand/collapse SAP group
  const [showAddProduct, setShowAddProduct] = useState(false);

  // ── Drawer "+ Agregar SAP" (Comando C5 RegisterSAPConfirmation) ──
  const [sapDrawerOpen, setSapDrawerOpen] = useState(false);
  const [sapDrawerExp, setSapDrawerExp]   = useState(null);

  // Detecta el primer expediente en estado REGISTRO ligado a esta OC.
  // Si no encontramos uno con estado explícito, fallback al primer
  // expediente listado (mock data no siempre trae estado).
  const sapEligibleExp = useMemo(() => {
    const expIds = oc.expedientes || [];
    const expObjs = expIds
      .map(eid => EXPEDIENTES.find(e => e.id === eid))
      .filter(Boolean);
    const inRegistro = expObjs.find(e =>
      (e.estado || e.status || "REGISTRO").toUpperCase() === "REGISTRO"
    );
    return inRegistro || expObjs[0] || null;
  }, [oc]);

  const openSapDrawer = () => {
    setSapDrawerExp(sapEligibleExp);
    setSapDrawerOpen(true);
  };

  // Líneas que pertenecen al expediente del drawer (para conciliación)
  const sapDrawerLines = useMemo(() => {
    if (!sapDrawerExp) return [];
    const expId = sapDrawerExp.id;
    return (oc.lines || [])
      .filter(l => l.exp_id === expId || l.expediente_id === expId || !l.exp_id)
      .map(l => ({
        id:           l.id,
        sku:          l.sku,
        size:         l.size,
        qty:          Number(l.qty || 0),
        unit_price:   Number(l.unit_price || 0),
        descripcion:  l.product || l.descripcion || "",
      }));
  }, [oc, sapDrawerExp]);

  const updateLine = (lineId, patch) => {
    setLineEdits(prev => ({ ...prev, [lineId]: { ...(prev[lineId]||{}), ...patch } }));
  };
  const readLine = (line) => {
    const edits = lineEdits[line.id] || {};
    const merged = { ...line, ...edits };
    // Recompute total_price when qty or unit_price was edited
    if ('qty' in edits || 'unit_price' in edits) {
      merged.total_price = merged.qty * merged.unit_price;
    }
    return merged;
  };

  // Effective line list = baseline (minus removed) + extras, all with edits applied
  const allLines = useMemo(() => {
    const base = oc.lines.filter(l => !removedLineIds.has(l.id));
    return [...base, ...extraLines].map(readLine);
  }, [oc.lines, extraLines, removedLineIds, lineEdits]);

  const addProduct = (product) => {
    const newLine = {
      id: 'L-NEW-' + Math.random().toString(36).slice(2,7),
      sku: product.sku,
      product: product.name,
      size: '—',
      qty: 1,
      unit_price: 0,
      total_price: 0,
      sap: null,
      exp_id: null,
      transport_mode: null,
      production_date: null,
      status: 'PENDIENTE_SAP',
      deferred_qty: 0,
      deferred_unit_price: 0,
      show_deferred_to_client: false,
    };
    setExtraLines(prev => [...prev, newLine]);
    setShowAddProduct(false);
  };

  const removeLine = (lineId) => {
    if (extraLines.some(l => l.id === lineId)) {
      setExtraLines(prev => prev.filter(l => l.id !== lineId));
    } else {
      setRemovedLineIds(prev => { const n = new Set(prev); n.add(lineId); return n; });
    }
  };

  // Totals computed from edited lines
  const computedTotal = allLines.reduce((a, l) => a + (l.qty * l.unit_price), 0);
  const computedDeferred = allLines.reduce((a, l) => a + ((l.deferred_qty||0) * (l.deferred_unit_price||0)), 0);

  // Group edited lines by SAP (null → orphan bucket)
  const sapGroups = useMemo(() => {
    const map = new Map();
    for (const l of allLines) {
      const key = l.sap || '__ORPHAN__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return Array.from(map.entries()).map(([sap, lines]) => ({
      sap: sap === '__ORPHAN__' ? null : sap,
      lines,
      exp_id: lines[0].exp_id,
      transport_mode: lines[0].transport_mode,
      production_date: lines[0].production_date,
      status: lines[0].status,
      total_value: lines.reduce((a,l)=>a+(l.qty*l.unit_price), 0),
      total_qty:   lines.reduce((a,l)=>a+l.qty, 0),
    }));
  }, [allLines]);

  const filteredGroups = showOrphansOnly ? sapGroups.filter(g => !g.sap) : sapGroups;

  const statusLabel = oc.status === 'CERRADO' ? tr(lang,'oc_state_closed')
                    : oc.status === 'EN_EJECUCION' ? tr(lang,'oc_state_active')
                    : tr(lang,'oc_state_partial');
  const statusColor = oc.status === 'CERRADO' ? 'var(--text-tertiary)'
                    : oc.status === 'EN_EJECUCION' ? 'var(--success)'
                    : 'var(--warning)';

  return (
    <div className="page" data-screen-label="OC Detail">
      {/* ── Header ───── */}
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <div className="flex ai-center gap-3" style={{marginBottom: 10}}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>
              <IconChevLeft size={14}/> {tr(lang,'back_to_list')}
            </button>
            <span className="caption" style={{color:'var(--text-tertiary)'}}>•</span>
            <span className="micro">{tr(lang,'po_number')}</span>
          </div>

          <div className="flex ai-center gap-3" style={{marginBottom: 6}}>
            <h1 className="page-title" style={{margin: 0}}>{oc.code}</h1>
            <span className="oc-status-chip" style={{
              color: statusColor, background: 'color-mix(in oklab,' + statusColor + ' 14%, transparent)',
              border: '1px solid color-mix(in oklab,' + statusColor + ' 36%, transparent)',
            }}>● {statusLabel}</span>
          </div>

          <div className="flex ai-center gap-3 page-subtitle" style={{flexWrap:'wrap'}}>
            <div className="flex ai-center gap-2">
              <CountryFlag country={oc.client_country}/>
              <span style={{fontWeight: 500, color:'var(--text-primary)'}}>{oc.client}</span>
            </div>
            <span>·</span>
            <div className="flex ai-center gap-2">
              <span style={{ width:8, height:8, background: brand?.color, borderRadius: 2, display:'inline-block' }}/>
              <span>{oc.brand}</span>
            </div>
            <span>·</span>
            <span>{tr(lang,'issued_date')} {oc.issued}</span>
            <span>·</span>
            <span>{oc.lines_count} {tr(lang,'lines_count').toLowerCase()} · {oc.expedientes.length} {tr(lang,'expedientes').toLowerCase()}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          {/* "+ Agregar SAP" → register_sap (CEO-ONLY).
              ART-04 SAPConfirmation se registra SIEMPRE desde MWT-Factory. */}
          {can('register_sap') && (
            <button
              className="btn btn-primary"
              onClick={openSapDrawer}
              disabled={!sapEligibleExp}
              title={!sapEligibleExp
                ? (lang === 'es' ? 'No hay expediente en REGISTRO para confirmar' : 'No expediente in REGISTRO to confirm')
                : ''}
              style={{ background: '#0B1E3A' }}
            >
              <IconPlus size={14}/>{lang === 'es' ? 'Agregar SAP' : 'Add SAP'}
            </button>
          )}
          {/* "+ Agregar Documento" → upload_document (CEO-ONLY).
              El cliente solo descarga documentos publicados via signed URL. */}
          {can('upload_document') && (
            <button className="btn btn-ghost"><IconPlus size={14}/>{tr(lang,'add_document')}</button>
          )}
        </div>
      </div>

      {/* Drawer · Comando C5 RegisterSAPConfirmation — SOLO si el usuario
          puede registrar SAP (CEO-ONLY). Para CLIENT ni se monta. */}
      {can('register_sap') && (
        <AddSAPConfirmationDrawer
          open={sapDrawerOpen}
          onClose={() => setSapDrawerOpen(false)}
          lang={lang}
          oc={{ id: oc.id, codigo: oc.code || oc.codigo }}
          expediente={sapDrawerExp && {
            id:     sapDrawerExp.id,
            codigo: sapDrawerExp.codigo || sapDrawerExp.code || sapDrawerExp.id,
            estado: (sapDrawerExp.estado || sapDrawerExp.status || 'REGISTRO').toUpperCase(),
          }}
          lines={sapDrawerLines}
          onSuccess={() => {
            // Optimistic refresh: el backend devolvió el expediente con
            // estado=PRODUCCION. En la versión con backend real, acá
            // invalidamos el fetch del OC. Para mock, solo cerramos.
            setSapDrawerOpen(false);
          }}
        />
      )}

      {/* ── KPI row ─────
          Para CLIENT ocultamos el "Credit clock" (días de crédito gastados)
          porque es métrica interna de cobranza. Dejamos coverage, logistics
          split y financial status — el cliente sí ve su propia factura. */}
      <div className={`grid gap-3 mb-4 ${isClient ? 'col-3' : 'col-4'}`}>
        {/* Coverage */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'oc_coverage')}</div>
          <div className="k-value" style={{
            color: oc.coverage_pct === 1 ? 'var(--success)' : oc.coverage_pct >= 0.75 ? 'var(--warning)' : 'var(--critical)'
          }}>
            {Math.round(oc.coverage_pct * 100)}%
          </div>
          <div className="k-sub">
            <span style={{color:'var(--text-secondary)'}}>{oc.lines_with_sap}/{oc.lines_count}</span>
            <span>{tr(lang,'coverage_sub')}</span>
          </div>
          <div style={{height: 3, background:'var(--border)', borderRadius: 2, marginTop: 10, overflow:'hidden'}}>
            <div style={{height:'100%', width: (oc.coverage_pct*100)+'%',
              background: oc.coverage_pct === 1 ? 'var(--success)' : oc.coverage_pct >= 0.75 ? 'var(--warning)' : 'var(--critical)'
            }}/>
          </div>
        </div>

        {/* Logistics split */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'logistics_split')}</div>
          <div className="k-value" style={{display:'flex', alignItems:'baseline', gap:6, fontSize: 28}}>
            <span style={{color:'var(--brand-accent)'}}>{Math.round(oc.sea_pct*100)}%</span>
            <span className="caption" style={{fontSize:11}}>{tr(lang,'transport_sea')}</span>
            <span className="caption" style={{color:'var(--text-tertiary)', margin:'0 4px'}}>/</span>
            <span style={{color:'var(--brand-primary)'}}>{Math.round(oc.air_pct*100)}%</span>
            <span className="caption" style={{fontSize:11}}>{tr(lang,'transport_air')}</span>
          </div>
          <div className="split-bar" style={{marginTop:12}}>
            <div className="seg sea" style={{width: (oc.sea_pct*100)+'%'}}/>
            <div className="seg air" style={{width: (oc.air_pct*100)+'%'}}/>
          </div>
        </div>

        {/* Financial */}
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'financial_status')}</div>
          <div className="k-value" style={{fontSize: 24, whiteSpace:'nowrap'}}>
            {fmtMoney(oc.total_invoiced)}
          </div>
          <div className="k-sub" style={{display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2}}>
            <span><span style={{color:'var(--success)'}}>{fmtMoney(oc.total_paid)}</span> {tr(lang,'paid_lbl').toLowerCase()}</span>
            <span><span style={{color:'var(--brand-primary)'}}>{fmtMoney(oc.balance)}</span> {tr(lang,'pending').toLowerCase()}</span>
          </div>
        </div>

        {/* Credit clock — métrica interna de cobranza: CEO-ONLY. */}
        {isAdmin && (
          <div className="kpi-tile">
            <div className="k-label">{tr(lang,'credit_clock')}</div>
            <div className="k-value" style={{display:'flex', alignItems:'baseline', gap:6}}>
              <CreditDot band={oc.credit_band}/>
              <span style={{
                color: oc.credit_band === 'RED' ? 'var(--critical)' : oc.credit_band === 'AMBER' ? 'var(--warning)' : 'var(--success)'
              }}>{oc.max_credit_days}d</span>
            </div>
            <div className="k-sub">
              {oc.max_credit_days > 0
                ? <span>{tr(lang,'credit_triggered')} · {tr(lang,'vs_historical')} 45d</span>
                : <span>{tr(lang,'credit_idle')}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Main content: Lines table + Docs sidebar ───── */}
      <div className="grid gap-3" style={{gridTemplateColumns: '1fr 340px', alignItems:'start'}}>
        {/* Lines grouped by SAP */}
        <div className="card">
          <div className="card-head" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
            <div>
              <div className="card-title">{tr(lang,'oc_lines')}</div>
              <div className="card-subtitle">{tr(lang,'grouped_by_sap')} · {oc.lines_count} {tr(lang,'lines_count').toLowerCase()}</div>
            </div>
            <div className="ceo-chip-group" style={{marginLeft:'auto'}}>
              <button data-active={!showOrphansOnly} onClick={()=>setShowOrphansOnly(false)}>
                {lang==='es'?'Todas':'All'}
              </button>
              <button data-active={showOrphansOnly} onClick={()=>setShowOrphansOnly(true)}>
                {tr(lang,'line_status_orphan')}
              </button>
            </div>
          </div>

          <div>
            {filteredGroups.map((g, gi) => {
              const exp = g.exp_id ? EXPEDIENTES.find(e => e.id === g.exp_id) : null;
              const isOpen = openSap === (g.sap || '__orphan_'+gi);
              const key = g.sap || '__orphan_'+gi;
              return (
                <div key={key} className="sap-group" data-orphan={!g.sap}>
                  {/* Group header = SAP chip */}
                  <div className="sap-group-head" onClick={() => setOpenSap(isOpen ? null : key)}>
                    <div className="flex ai-center gap-3" style={{flex: 1, minWidth: 0}}>
                      <IconChevDown size={14} style={{
                        color:'var(--text-tertiary)',
                        transform: isOpen ? 'none' : 'rotate(-90deg)',
                        transition: 'transform 160ms'
                      }}/>
                      {g.sap ? (
                        <>
                          <a
                            className="sap-link"
                            onClick={(e)=>{ e.stopPropagation(); onOpenExpediente(g.exp_id); }}
                            title={tr(lang,'open_expediente')}
                          >
                            <IconFolder size={12}/> {g.sap}
                          </a>
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>→</span>
                          <span className="caption">{exp?.ref}</span>
                          <span className={'transport-chip ' + (g.transport_mode === 'AEREO' ? 'air' : 'sea')}>
                            {g.transport_mode === 'AEREO' ? <IconPlane size={11}/> : <IconShip size={11}/>}
                            {g.transport_mode === 'AEREO' ? tr(lang,'transport_air') : tr(lang,'transport_sea')}
                          </span>
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>
                            {tr(lang,'prod_date')}: <span className="tabular">{g.production_date}</span>
                          </span>
                          {exp && <StatusBadge status={exp.status} lang={lang}/>}
                        </>
                      ) : (
                        <>
                          <span className="sap-link orphan">
                            <IconAlert size={12}/> {tr(lang,'line_status_orphan')}
                          </span>
                          <span className="caption" style={{color:'var(--warning)'}}>
                            {tr(lang,'pending_sap')}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex ai-center gap-3" style={{marginLeft:'auto'}}>
                      <span className="caption" style={{color:'var(--text-tertiary)'}}>
                        {g.lines.length} {tr(lang,'lines_count').toLowerCase()} · {g.total_qty.toLocaleString()} u
                      </span>
                      <span className="td-money" style={{minWidth:110, textAlign:'right'}}>{fmtMoney(g.total_value)}</span>
                    </div>
                  </div>

                  {/* Lines */}
                  {isOpen && (
                    <div className="sap-lines">
                      <div className="sap-lines-head">
                        <div style={{flex: '1 1 auto', minWidth: 200}}>{tr(lang,'product_line')}</div>
                        <div style={{width: 60, textAlign:'center'}}>{lang==='es'?'Talla':'Size'}</div>
                        <div style={{width: 80, textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</div>
                        <div style={{width: 100, textAlign:'right'}}>{tr(lang,'unit_price_lbl')}</div>
                        <div style={{width: 110, textAlign:'right'}}>{tr(lang,'total_price_lbl')}</div>
                        {/* Columnas "diferido" (qty + precio) + toggle de visibilidad:
                            CEO-ONLY. CLIENT nunca las ve — nunca debe enterarse que
                            existe un concepto "deferred" interno. */}
                        {isAdmin && (
                          <div style={{width: 190, textAlign:'center', borderLeft:'1px dashed var(--divider)', paddingLeft: 12, color:'var(--brand-accent-dark,#0E8A6D)'}}>
                            🔒 {tr(lang,'deferred_price_col')}
                          </div>
                        )}
                        {isAdmin && (
                          <div style={{width: 90, textAlign:'center'}}>{tr(lang,'visible_to_client_short')}</div>
                        )}
                        {/* Para CLIENT, si el CEO publicó un "precio acordado" en alguna
                            línea del grupo, lo mostramos agregado al final (read-only). */}
                        {isClient && g.lines.some(l => l.show_deferred_to_client) && (
                          <div style={{width: 170, textAlign:'right', borderLeft:'1px dashed var(--divider)', paddingLeft: 12}}>
                            {tr(lang, 'agreed_price') || (lang==='es' ? 'Precio acordado' : 'Agreed price')}
                          </div>
                        )}
                      </div>
                      {g.lines.map(l => (
                        <div key={l.id} className="sap-line">
                          <div style={{flex: '1 1 auto', minWidth: 200}}>
                            <div className="body-sm" style={{fontWeight: 500}}>{l.product}</div>
                            <div className="caption" style={{fontFamily:'var(--font-mono)', marginTop: 2}}>{l.sku}</div>
                          </div>
                          <div style={{width: 60, textAlign:'center'}}>
                            <span className="size-chip">{l.size}</span>
                          </div>
                          <div style={{width: 80, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{l.qty.toLocaleString()}</div>
                          <div style={{width: 100, textAlign:'right', fontVariantNumeric:'tabular-nums', color:'var(--text-secondary)'}}>
                            ${l.unit_price.toFixed(2)}
                          </div>
                          <div style={{width: 110, textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight: 600}}>
                            {fmtMoney(l.total_price)}
                          </div>
                          {/* ADMIN: inputs editables de deferred_qty / deferred_unit_price. */}
                          {isAdmin && (
                            <div style={{width: 190, borderLeft:'1px dashed var(--divider)', paddingLeft: 12, display:'flex', gap: 6, alignItems:'center', justifyContent:'center'}}>
                              <div className="deferred-input">
                                <span>qty</span>
                                <input type="number" value={l.deferred_qty || 0} min={0} max={l.qty}
                                  onChange={(e)=>updateLine(l.id, { deferred_qty: +e.target.value })}/>
                              </div>
                              <div className="deferred-input">
                                <span>$</span>
                                <input type="number" value={l.deferred_unit_price || 0} min={0} step="0.01"
                                  onChange={(e)=>updateLine(l.id, { deferred_unit_price: +e.target.value })}/>
                              </div>
                            </div>
                          )}
                          {/* ADMIN: switch de visibilidad para publicar el precio al cliente. */}
                          {isAdmin && (
                            <div style={{width: 90, textAlign:'center'}}>
                              <div className="switch sm" data-on={l.show_deferred_to_client}
                                   onClick={()=>updateLine(l.id, { show_deferred_to_client: !l.show_deferred_to_client })}/>
                            </div>
                          )}
                          {/* CLIENT: "Precio acordado" como lectura. Nunca "deferred". */}
                          {isClient && g.lines.some(ll => ll.show_deferred_to_client) && (
                            <div style={{width: 170, textAlign:'right', borderLeft:'1px dashed var(--divider)', paddingLeft: 12, fontVariantNumeric:'tabular-nums', fontWeight: 600}}>
                              {l.show_deferred_to_client && l.deferred_qty > 0 && l.deferred_unit_price > 0
                                ? fmtMoney(l.deferred_qty * l.deferred_unit_price)
                                : <span className="caption" style={{color:'var(--text-tertiary)'}}>—</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Totals row */}
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'14px 22px', borderTop:'1px solid var(--divider)',
            background:'var(--bg-alt)',
          }}>
            <span className="micro">{lang==='es'?'Valor total de la Orden':'Total order value'}</span>
            <span style={{font:'800 18px/1 var(--font-display)', fontVariantNumeric:'tabular-nums'}}>{fmtMoney(computedTotal)}</span>
          </div>
        </div>

        {/* Documents hub */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'documents_hub')}</div>
              <div className="card-subtitle">{oc.docs.length} {lang==='es'?'archivos':'files'}</div>
            </div>
          </div>
          <div style={{padding:'8px 0'}}>
            {oc.docs.map(d => (
              <div key={d.id} className="doc-item">
                <div className={'doc-icon ext-' + d.ext}>
                  {d.ext.toUpperCase()}
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="body-sm" style={{fontWeight: 500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.kind}</div>
                  <div className="caption" style={{marginTop: 2, fontFamily:'var(--font-mono)'}}>{d.code}</div>
                  <div className="caption" style={{color:'var(--text-tertiary)', marginTop: 3}}>
                    {d.date} · {d.size} · {d.author}
                  </div>
                </div>
                <button className="icon-btn" title={tr(lang,'download')}>
                  <IconDownload size={13}/>
                </button>
              </div>
            ))}
          </div>

          {/* Expedientes pill list */}
          <div style={{borderTop:'1px solid var(--divider)', padding: '16px 22px'}}>
            <div className="micro" style={{marginBottom: 10}}>{tr(lang,'expedientes_in_oc')}</div>
            {oc.expedientes.map(eid => {
              const e = EXPEDIENTES.find(x => x.id === eid);
              if (!e) return null;
              return (
                <div key={eid} className="exp-link-row" onClick={()=>onOpenExpediente(eid)}>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="flex ai-center gap-2">
                      <IconFolder size={12} style={{color:'var(--text-tertiary)'}}/>
                      <span className="body-sm" style={{fontWeight: 600}}>{e.ref}</span>
                      {e.sap && <span className="caption" style={{fontFamily:'var(--font-mono)'}}>{e.sap}</span>}
                    </div>
                    <div className="caption" style={{marginTop: 2}}>
                      {e.origin} → {e.destination}
                    </div>
                  </div>
                  <StatusBadge status={e.status} lang={lang}/>
                  <IconChevRight size={13} style={{color:'var(--text-tertiary)'}}/>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          Tabla plana "Productos OC":
            · ADMIN → tabla completa editable con columnas diferido + eliminar
            · CLIENT → tabla de solo-lectura, sin diferido, sin eliminar
          ══════════════════════════════════════════════════════════════════ */}
      <div className="card" style={{marginTop: 14}}>
        <div className="card-head" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div className="card-title">{lang==='es'?'Productos OC':'PO Products'}</div>
            <div className="card-subtitle">
              {allLines.length} {lang==='es'?'líneas':'lines'}
              {isAdmin && <> · {lang==='es'?'editable':'editable'}</>}
              {' '}· {fmtMoney(computedTotal)} {lang==='es'?'total':'total'}
              {/* El "diferido" es concepto interno — nunca se muestra a CLIENT. */}
              {isAdmin && computedDeferred > 0 && <> · <span style={{color:'var(--brand-accent-dark,#0E8A6D)'}}>🔒 {fmtMoney(computedDeferred)} {lang==='es'?'diferido':'deferred'}</span></>}
            </div>
          </div>
          {/* "+ Agregar producto" → add_oc_line (CEO-ONLY). */}
          {can('add_oc_line') && (
            <button className="btn btn-primary" onClick={()=>setShowAddProduct(true)}>
              <IconPlus size={14}/> {lang==='es'?'Agregar producto':'Add product'}
            </button>
          )}
        </div>
        <div style={{overflowX:'auto'}}>
          <table className="oc-products-table" data-viewport={isClient ? 'CLIENT' : 'ADMIN'}>
            <thead>
              <tr>
                <th style={{width:140}}>SKU</th>
                <th>{lang==='es'?'Nombre':'Name'}</th>
                <th style={{width:70, textAlign:'center'}}>{lang==='es'?'Talla':'Size'}</th>
                <th style={{width:90, textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
                <th style={{width:100, textAlign:'right'}}>{lang==='es'?'Precio':'Price'}</th>
                <th style={{width:110, textAlign:'right'}}>{lang==='es'?'Total':'Total'}</th>
                <th style={{width:130}}>SAP</th>
                {/* Columnas deferred qty/price: CEO-ONLY. */}
                {isAdmin && (
                  <th style={{width:100, textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Cant. dif.':'Def. qty'}
                  </th>
                )}
                {isAdmin && (
                  <th style={{width:110, textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Precio dif.':'Def. price'}
                  </th>
                )}
                {/* Columna acciones (botón eliminar): requiere delete_oc_line. */}
                {can('delete_oc_line') && <th style={{width:44}}></th>}
              </tr>
            </thead>
            <tbody>
              {allLines.map(l => (
                <tr key={l.id} data-orphan={!l.sap}>
                  <td className="mono" style={{fontSize:11.5}}>{l.sku}</td>
                  <td>{l.product}</td>
                  <td style={{textAlign:'center'}}>
                    <span className="size-chip">{l.size}</span>
                  </td>
                  {/* Qty editable → capability edit_oc_line_qty. */}
                  {can('edit_oc_line_qty') ? (
                    <td className="td-edit" style={{textAlign:'right'}}>
                      <input className="edit-input tabular" type="number" min={0}
                        value={l.qty}
                        onChange={e=>updateLine(l.id, { qty: +e.target.value })}/>
                    </td>
                  ) : (
                    <td className="td-num" style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                      {l.qty.toLocaleString()}
                    </td>
                  )}
                  {/* Precio unitario editable → capability edit_oc_line_unit_price. */}
                  {can('edit_oc_line_unit_price') ? (
                    <td className="td-edit" style={{textAlign:'right'}}>
                      <div className="edit-input-money">
                        <span>$</span>
                        <input className="edit-input tabular" type="number" min={0} step="0.01"
                          value={l.unit_price}
                          onChange={e=>updateLine(l.id, { unit_price: +e.target.value })}/>
                      </div>
                    </td>
                  ) : (
                    <td className="td-num" style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color:'var(--text-secondary)'}}>
                      ${l.unit_price.toFixed(2)}
                    </td>
                  )}
                  <td className="td-money">{fmtMoney(l.qty * l.unit_price)}</td>
                  <td>
                    {l.sap ? (
                      <a className="sap-link sap-link-inline" onClick={()=>l.exp_id && onOpenExpediente(l.exp_id)} title={tr(lang,'open_expediente')}>
                        <IconFolder size={11}/> {l.sap}
                      </a>
                    ) : (
                      <span className="caption" style={{color:'var(--warning)', display:'inline-flex', alignItems:'center', gap:4}}>
                        <IconAlert size={11}/> {tr(lang,'line_status_orphan')}
                      </span>
                    )}
                  </td>
                  {/* Inputs deferred qty / deferred price: CEO-ONLY. */}
                  {isAdmin && (
                    <td className="td-edit" style={{textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 4%, transparent)'}}>
                      <input className="edit-input tabular" type="number" min={0} max={l.qty}
                        value={l.deferred_qty || 0}
                        onChange={e=>updateLine(l.id, { deferred_qty: +e.target.value })}/>
                    </td>
                  )}
                  {isAdmin && (
                    <td className="td-edit" style={{textAlign:'right', background:'color-mix(in oklab, var(--brand-accent) 4%, transparent)'}}>
                      <div className="edit-input-money">
                        <span>$</span>
                        <input className="edit-input tabular" type="number" min={0} step="0.01"
                          value={l.deferred_unit_price || 0}
                          onChange={e=>updateLine(l.id, { deferred_unit_price: +e.target.value })}/>
                      </div>
                    </td>
                  )}
                  {/* Botón eliminar → delete_oc_line (CEO-ONLY). */}
                  {can('delete_oc_line') && (
                    <td style={{textAlign:'center'}}>
                      <button className="icon-btn" title={lang==='es'?'Eliminar':'Remove'}
                        onClick={()=>removeLine(l.id)}
                        style={{width:26, height:26, color:'var(--text-tertiary)'}}>
                        <IconX size={12}/>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {allLines.length === 0 && (
                <tr><td colSpan={isAdmin ? 10 : 7} style={{textAlign:'center', padding:'32px', color:'var(--text-tertiary)'}}>
                  {lang==='es'
                    ? (isClient ? 'Sin productos en esta orden.' : 'Sin productos. Agrega el primero.')
                    : (isClient ? 'No products in this order.' : 'No products yet. Add your first.')}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{textAlign:'right', fontWeight:600, padding:'14px 12px'}}>
                  {lang==='es'?'Total orden':'Order total'}
                </td>
                <td className="td-money" style={{fontSize:15, fontWeight:700}}>{fmtMoney(computedTotal)}</td>
                {/* Totales de "diferido" en el tfoot: CEO-ONLY. */}
                {isAdmin && (
                  <td colSpan={2} style={{textAlign:'right', fontWeight:600, color:'var(--brand-accent-dark,#0E8A6D)', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    🔒 {lang==='es'?'Total diferido':'Deferred total'}
                  </td>
                )}
                {isAdmin && (
                  <td className="td-money" style={{fontWeight:700, color:'var(--brand-accent-dark,#0E8A6D)', background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}>
                    {fmtMoney(computedDeferred)}
                  </td>
                )}
                {/* Celda vacía para alinear con la columna de acciones (solo ADMIN). */}
                {can('delete_oc_line') && (
                  <td style={{background:'color-mix(in oklab, var(--brand-accent) 8%, transparent)'}}/>
                )}
                {/* CLIENT: no tiene columnas deferred ni acciones → el colspan ya cuadra. */}
                {isClient && <td/>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modal "Agregar producto" solo se monta si ADMIN puede agregar línea. */}
      {can('add_oc_line') && showAddProduct && (
        <AddProductModal lang={lang} onPick={addProduct} onClose={()=>setShowAddProduct(false)}/>
      )}
    </div>
  );
}

// ── Add product modal: pick from catalog ─────
function AddProductModal({ lang, onPick, onClose }) {
  const [q, setQ] = useState('');
  const filtered = PRODUCTS.filter(p =>
    !q || (p.sku+' '+p.name+' '+p.brand).toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="mdl-backdrop" onClick={(e)=>{ if (e.target.classList.contains('mdl-backdrop')) onClose(); }}>
      <div className="mdl-panel">
        <div className="mdl-head">
          <div>
            <div className="mdl-title">{lang==='es'?'Agregar producto a la OC':'Add product to PO'}</div>
            <div className="mdl-subtitle">{PRODUCTS.length} {lang==='es'?'productos en catálogo':'products in catalog'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
        </div>
        <div className="mdl-body">
          <div className="mdl-search">
            <IconSearch size={13}/>
            <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
              placeholder={lang==='es'?'Buscar por SKU, nombre o marca…':'Search by SKU, name or brand…'}/>
          </div>
          <div className="mdl-list">
            {filtered.map(p => (
              <div key={p.id} className="mdl-row" onClick={()=>onPick(p)}>
                <div className="mdl-row-icon"><IconPackage size={14}/></div>
                <div style={{flex:1, minWidth:0}}>
                  <div className="mdl-row-name">
                    <span className="mdl-row-code">{p.sku}</span>
                    <span>{p.name}</span>
                  </div>
                  <div className="caption">{p.brand} · {p.category}</div>
                </div>
                <button className="btn btn-primary btn-sm"><IconPlus size={11}/>{lang==='es'?'Agregar':'Add'}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
