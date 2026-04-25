// ─────────────────────────────────────────────────────────────
// ClienteDetail — Vista completa de un cliente B2B [CEO-ONLY]
// Agente responsable: [AG-FRONTEND]
//
// Hero + KPIs crediticios + 4 tabs:
//   1. Expedientes Activos    — reloj de crédito (semáforo <60/60-74/≥75)
//   2. Pagos                  — Payment Status Machine
//                               (pending · verified · credit_released · rejected)
//   3. Productos comprados    — Inteligencia de surtido (12m)
//   4. Alertas                — señales cruzadas de riesgo y oportunidad
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconMapPin, IconUser, IconMail, IconCreditCard,
  IconClock, IconAlert, IconCheck, IconX, IconShield, IconDollar,
  IconTrend, IconBoxes, IconFolder, IconHistory, IconGlobe, IconLock,
  IconRefresh,
} from "../lib/icons.jsx";
import { fmtMoney, fmtShortDate } from "../lib/i18n.js";
import { clientesApi } from "../lib/api.js";
import {
  CLIENTS, EXPEDIENTES, CLIENT_PAYMENTS, CLIENT_PRODUCTS_BOUGHT, OCS,
} from "../data/mockData.js";

// ── Banderitas por país (mismo subset que NodoDetail) ──
const FLAG_BY_ISO2 = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', CN:'🇨🇳', MX:'🇲🇽',
  AR:'🇦🇷', CL:'🇨🇱', ES:'🇪🇸', BR:'🇧🇷', UY:'🇺🇾',
  EC:'🇪🇨', CR:'🇨🇷', PA:'🇵🇦',
};

// ── Adapter backend → forma esperada por la vista (heredada del mock).
// El backend usa nombres canónicos (razon_social, credito_aprobado, dias_credito,
// pais_iso2, contacto_email…); el render legado lee `name`, `credito_limit`,
// `credito_dias`, `country`, `email`. Mapeamos en un solo lugar.
function adaptBackendClient(raw) {
  if (!raw || !raw.id) return null;
  return {
    id:                raw.id,
    name:              raw.razon_social || raw.nombre_comercial || raw.tax_id || '—',
    flag:              FLAG_BY_ISO2[raw.pais_iso2] || '🌐',
    country:           raw.pais_iso2 || '—',
    canal:             (raw.canal || 'directo').toLowerCase(),
    estado:            raw.estado || 'ACTIVO',
    codigo_marluvas:   raw.codigo_marluvas || '—',
    cedula_juridica:   raw.cedula_juridica || '',
    direccion_entrega: raw.direccion_entrega || raw.direccion || '',
    contacto_nombre:   raw.contacto_nombre || '—',
    email:             raw.contacto_email || '',
    incoterm:          raw.incoterm || '—',
    // Crédito · soporta ambos nombres (alias backend / canon Excel COMEX)
    credito_limit:     Number(raw.credito_limit_usd ?? raw.credito_aprobado ?? 0),
    credito_used:      Number(raw.credito_usado ?? 0),
    credito_dias:      Number(raw.dias_credito ?? 0),
    // crudo por si tabs futuros lo quieren
    _raw: raw,
  };
}
// NOTA 2026-04 · ClientFormDrawer DEPRECATED — reemplazado por la página
// full-page pages/ClienteFormView.jsx. El botón "Editar" de aquí navega
// ahora a /clientes/:id/editar.
// import ClientFormDrawer from "../components/clientes/ClientFormDrawer.jsx";

/* ── Payment Status Machine ──────────────────────────── */
const PAYMENT_STATUS = {
  pending:          { label: 'Pendiente',          className: 'ps-pending',  icon: IconClock },
  verified:         { label: 'Verificado',         className: 'ps-verified', icon: IconCheck },
  credit_released:  { label: 'Crédito liberado',   className: 'ps-released', icon: IconShield },
  rejected:         { label: 'Rechazado',          className: 'ps-rejected', icon: IconX },
};

/* ── Channel meta (reuso del dashboard) ──────────────── */
const CHANNEL_META = {
  directo:      { label: 'Directo',      color: '#3083FE' },
  distribuidor: { label: 'Distribuidor', color: '#481EE3' },
};

const ESTADO_BADGE = {
  ACTIVO:    'badge-success',
  PAUSADO:   'badge-warning',
  BLOQUEADO: 'badge-danger',
};

/* ── Semáforo reloj de crédito (días) ───────────────── */
function creditClockBand(days) {
  if (days >= 75) return 'red';
  if (days >= 60) return 'amber';
  return 'green';
}

/* ── PaymentStatusBadge ─────────────────────────────── */
function PaymentStatusBadge({ status }) {
  const m = PAYMENT_STATUS[status] || PAYMENT_STATUS.pending;
  const Ico = m.icon;
  return (
    <span className={`payment-status ${m.className}`}>
      <Ico size={11}/>
      <span>{m.label}</span>
    </span>
  );
}

export default function ScreenClienteDetail() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const [tab, setTab] = useState('expedientes');
  // showEdit/setShowEdit ya no se usa — la edición es una página aparte.
  // Lo mantengo declarado para no romper la función si algún effect lo refería.
  const [showEdit, setShowEdit] = useState(false);   // eslint-disable-line no-unused-vars

  // Estado para el modal de confirmación de eliminación
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteErr,     setDeleteErr]     = useState(null);

  // ── Fetch real al backend (antes leía CLIENTS de mockData.js, por eso
  //    clientes creados vía API mostraban "Cliente no encontrado") ──
  const [rawClient, setRawClient] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    clientesApi.get(clienteId)
      .then(data => { if (!cancelled) { setRawClient(data); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        // Fallback a mock para IDs demo que solo existen en mockData.js.
        const mockMatch = CLIENTS.find(c => c.id === clienteId);
        if (mockMatch) {
          setRawClient({ __isMockShape: true, ...mockMatch });
        } else {
          setLoadErr(err?.message || 'fetch_failed');
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [clienteId]);

  const client = useMemo(() => {
    if (!rawClient) return null;
    if (rawClient.__isMockShape) return rawClient;
    return adaptBackendClient(rawClient);
  }, [rawClient]);

  // ─── TODOS los hooks DEBEN ejecutarse en cada render (regla de hooks
  //     de React). Por eso los `useMemo` van ANTES de los returns
  //     condicionales (loading / not-found), con null-safety en su body
  //     para que no fallen cuando `client` aún no resolvió. ───
  const cid = client?.id;

  /* ── Data slices ────────────────── */
  const expedientesCliente = useMemo(
    () => cid ? EXPEDIENTES.filter(e => e.client_id === cid) : [],
    [cid]
  );
  const expedientesActivos = useMemo(
    () => expedientesCliente.filter(e => e.status !== 'CERRADO'),
    [expedientesCliente]
  );
  const pagosCliente = useMemo(
    () => cid
      ? CLIENT_PAYMENTS.filter(p => p.client_id === cid)
          .sort((a,b) => (a.date < b.date ? 1 : -1))
      : [],
    [cid]
  );
  const productosCliente = useMemo(
    () => cid
      ? CLIENT_PRODUCTS_BOUGHT.filter(p => p.client_id === cid)
          .sort((a,b) => b.revenue_12m - a.revenue_12m)
      : [],
    [cid]
  );

  /* ── KPIs ───────────────────────── */
  const kpis = useMemo(() => {
    if (!client) return {
      credito_limit:0, credito_used:0, credito_avail:0, credito_pct:0,
      total_facturado:0, total_pagado:0, saldo:0,
      dso:0, expedientes_activos:0,
    };
    const credito_limit = client.credito_limit || 0;
    const credito_used  = client.credito_used  || 0;
    const credito_avail = Math.max(0, credito_limit - credito_used);
    const credito_pct   = credito_limit ? credito_used / credito_limit : 0;

    const total_facturado = expedientesCliente.reduce((a,e) => a + (e.total_invoiced || 0), 0);
    const total_pagado    = expedientesCliente.reduce((a,e) => a + (e.total_paid     || 0), 0);
    const saldo           = total_facturado - total_pagado;

    // DSO (Days Sales Outstanding) ~ weighted avg credit_days of active expedientes
    const dsoNum = expedientesActivos.reduce((a,e) => a + (e.credit_days || 0) * (e.balance || 0), 0);
    const dsoDen = expedientesActivos.reduce((a,e) => a + (e.balance || 0), 0);
    const dso = dsoDen ? Math.round(dsoNum / dsoDen) : client.credito_dias;

    return {
      credito_limit, credito_used, credito_avail, credito_pct,
      total_facturado, total_pagado, saldo,
      dso, expedientes_activos: expedientesActivos.length,
    };
  }, [client, expedientesCliente, expedientesActivos]);

  /* ── Alertas derivadas ────────── */
  const alertas = useMemo(() => {
    if (!client) return [];
    const out = [];
    if (kpis.credito_pct >= 1)   out.push({ severity:'critical', msg: `Crédito al ${(kpis.credito_pct*100).toFixed(0)}% — bloqueo automático.` });
    else if (kpis.credito_pct >= 0.85) out.push({ severity:'warning', msg: `Crédito al ${(kpis.credito_pct*100).toFixed(0)}% — revisar antes de aprobar nueva OC.` });
    expedientesActivos.forEach(e => {
      if (e.credit_days >= 75) out.push({ severity:'critical', msg: `${e.ref} · reloj de crédito ${e.credit_days}d · cliente debería estar bloqueado.` });
      else if (e.credit_days >= 60) out.push({ severity:'warning', msg: `${e.ref} · reloj ${e.credit_days}d · negociar cobro / garantía.` });
    });
    const rejected = pagosCliente.filter(p => p.status === 'rejected');
    if (rejected.length) out.push({ severity:'warning', msg: `${rejected.length} pago(s) rechazado(s) históricamente · revisar origen de fondos.` });
    const pending = pagosCliente.filter(p => p.status === 'pending');
    if (pending.length >= 2) out.push({ severity:'info', msg: `${pending.length} pagos en status pending · acelerar conciliación bancaria.` });
    if (client.estado === 'BLOQUEADO') out.push({ severity:'critical', msg: 'Cliente BLOQUEADO — no emitir nuevas proformas sin autorización CEO.' });
    if (!out.length) out.push({ severity:'ok', msg: 'Sin señales activas. Cliente saludable.' });
    return out;
  }, [kpis, expedientesActivos, pagosCliente, client]);

  // ── Returns condicionales DESPUÉS de todos los hooks ──
  if (loading) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconRefresh size={20} style={{color:'var(--brand-accent)', animation:'spin 1.2s linear infinite'}}/>
          <div className="caption">{lang==='es'?'Cargando cliente…':'Loading client…'}</div>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconAlert size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">{lang==='es'?'Cliente no encontrado':'Client not found'}</div>
          {loadErr && <div className="caption" style={{color:'var(--text-tertiary)'}}>{loadErr}</div>}
          <button className="btn btn-ghost" onClick={()=>navigate('/clientes')}>
            <IconChevLeft size={14}/> {lang==='es'?'Volver a Clientes':'Back to Clients'}
          </button>
        </div>
      </div>
    );
  }

  const channel = CHANNEL_META[client.canal] || CHANNEL_META.directo;

  return (
    <div className="page">
      {/* ── Breadcrumb ────────────── */}
      <div className="flex ai-center gap-2" style={{marginBottom: 12}}>
        <button className="btn btn-ghost" onClick={()=>navigate('/clientes')}>
          <IconChevLeft size={14}/> {lang==='es'?'Clientes':'Clients'}
        </button>
        <span className="caption" style={{color:'var(--text-tertiary)'}}>/</span>
        <span className="caption">{client.name}</span>
        <span className="badge badge-outline" style={{marginLeft: 8}}>
          <IconLock size={10}/> CEO-ONLY
        </span>
      </div>

      {/* ── Hero ────────────────────── */}
      <motion.div
        className="client-hero"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.28 } }}
        style={{ '--channel-color': channel.color }}
      >
        <div className="client-hero-accent"/>
        <div className="client-hero-body">
          <div className="client-flag hero-flag">{client.flag || '🌐'}</div>
          <div style={{flex:1, minWidth:0}}>
            <div className="micro" style={{color: channel.color}}>{channel.label.toUpperCase()}</div>
            <h1 className="page-title" style={{margin:'2px 0 2px'}}>{client.name}</h1>
            <div className="caption" style={{display:'flex', gap:14, flexWrap:'wrap'}}>
              <span style={{display:'inline-flex', alignItems:'center', gap:4}}>
                <IconMapPin size={11}/> {client.direccion_entrega || client.country}
              </span>
              <span className="mono-sm">SAP · {client.codigo_marluvas}</span>
              <span className="mono-sm">{client.cedula_juridica}</span>
            </div>
            <div style={{display:'flex', gap:8, marginTop: 10, flexWrap:'wrap'}}>
              <span className={`badge ${ESTADO_BADGE[client.estado] || 'badge-outline'}`}>
                <span className="dot"/> {client.estado}
              </span>
              <span className="pill-soft">
                <IconUser size={11}/> {client.contacto_nombre}
              </span>
              <span className="pill-soft mono-sm">
                <IconMail size={11}/> {client.email}
              </span>
              <span className="pill-soft">
                <IconCreditCard size={11}/> {client.credito_dias}d · {client.incoterm}
              </span>
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost"
                    onClick={() => navigate(`/clientes/${clienteId}/editar`)}>
              {lang==='es' ? 'Editar' : 'Edit'}
            </button>
            {/* Eliminar (soft-delete vía DELETE /api/clientes/{id}/) — solo
                si el cliente vino del backend; los mock-only no se borran. */}
            {client._raw && (
              <button className="btn btn-ghost"
                      style={{ color: '#DC2626' }}
                      onClick={() => setConfirmDelete(true)}>
                {lang==='es' ? 'Eliminar' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Modal confirmación de eliminación ───────── */}
      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDeleteModal
            clientName={client.name}
            busy={deleting}
            error={deleteErr}
            lang={lang}
            onCancel={() => { setConfirmDelete(false); setDeleteErr(null); }}
            onConfirm={async () => {
              setDeleting(true);
              setDeleteErr(null);
              try {
                await clientesApi.remove(clienteId);
                navigate('/clientes', { replace: true });
              } catch (e) {
                setDeleteErr(e?.message || (lang==='es'?'No se pudo eliminar.':'Delete failed.'));
              } finally {
                setDeleting(false);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* ── KPIs ──────────────────── */}
      <div className="nodes-kpis" style={{marginTop: 16}}>
        <div className={`kpi-tile ${kpis.credito_pct >= 1 ? 'band-critical' : kpis.credito_pct >= 0.85 ? 'band-warning' : ''}`}>
          <div className="k-label">{lang==='es'?'Crédito':'Credit'}</div>
          <div className="k-value">{(kpis.credito_pct*100).toFixed(0)}%</div>
          <div className={`credit-bar band-${kpis.credito_pct >= 1 ? 'critical' : kpis.credito_pct >= 0.85 ? 'warning' : 'ok'}`} style={{marginTop: 6}}>
            <span style={{width:`${Math.min(100, kpis.credito_pct*100)}%`}}/>
          </div>
          <div className="k-sub">{fmtMoney(kpis.credito_used)} / {fmtMoney(kpis.credito_limit)}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Total facturado (lifetime)':'Total invoiced (lifetime)'}</div>
          <div className="k-value">{fmtMoney(kpis.total_facturado)}</div>
          <div className="k-sub">
            <span style={{color:'var(--band-green, #00B286)'}}>{fmtMoney(kpis.total_pagado)}</span>
            {' · '}
            {lang==='es'?'saldo':'balance'}: {fmtMoney(kpis.saldo)}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">DSO <span style={{color:'var(--text-tertiary)'}}>({lang==='es'?'días promedio':'avg days'})</span></div>
          <div className="k-value">{kpis.dso}d</div>
          <div className="k-sub">
            {lang==='es'?'Plazo default':'Default term'}: {client.credito_dias}d
          </div>
        </div>
        <div className="kpi-tile accent">
          <div className="k-label">{lang==='es'?'Expedientes activos':'Active files'}</div>
          <div className="k-value">{kpis.expedientes_activos}</div>
          <div className="k-sub">
            {expedientesCliente.length - kpis.expedientes_activos} {lang==='es'?'cerrados':'closed'}
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────── */}
      <div className="tab-bar" style={{marginTop: 20}}>
        <button className="tab-btn" data-active={tab==='expedientes'} onClick={()=>setTab('expedientes')}>
          <IconFolder size={12}/> {lang==='es'?'Expedientes activos':'Active files'}
          <span className="tab-count">{expedientesActivos.length}</span>
        </button>
        <button className="tab-btn" data-active={tab==='pagos'} onClick={()=>setTab('pagos')}>
          <IconDollar size={12}/> {lang==='es'?'Pagos':'Payments'}
          <span className="tab-count">{pagosCliente.length}</span>
        </button>
        <button className="tab-btn" data-active={tab==='productos'} onClick={()=>setTab('productos')}>
          <IconBoxes size={12}/> {lang==='es'?'Productos comprados':'Products bought'}
          <span className="tab-count">{productosCliente.length}</span>
        </button>
        <button className="tab-btn" data-active={tab==='alertas'} onClick={()=>setTab('alertas')}>
          <IconAlert size={12}/> {lang==='es'?'Alertas':'Alerts'}
          <span className="tab-count">{alertas.filter(a => a.severity !== 'ok').length}</span>
        </button>
      </div>

      <div className="tab-panel">
        <AnimatePresence mode="wait">
          {tab === 'expedientes' && (
            <motion.div key="exp" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <ExpedientesTab lang={lang} expedientes={expedientesActivos} onOpen={(exp)=>{
                const oc = OCS.find(o => o.expedientes.includes(exp.id));
                if (oc) navigate(`/expedientes/${oc.id}/exp/${exp.id}`);
              }}/>
            </motion.div>
          )}
          {tab === 'pagos' && (
            <motion.div key="pay" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <PagosTab lang={lang} pagos={pagosCliente}/>
            </motion.div>
          )}
          {tab === 'productos' && (
            <motion.div key="prod" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <ProductosTab lang={lang} productos={productosCliente}/>
            </motion.div>
          )}
          {tab === 'alertas' && (
            <motion.div key="alr" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <AlertasTab lang={lang} alertas={alertas}/>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Edit Drawer DEPRECATED — la edición es ahora la página
          /clientes/:id/editar (ver ClienteFormView.jsx). El AnimatePresence
          queda inactivo (showEdit siempre false). */}
      <AnimatePresence>
        {false && showEdit && (
          <div
            /* keep-alive removed block */
            onClick={()=>setShowEdit(false)}
            data-deprecated="ClientFormDrawer"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   TAB · Expedientes activos — reloj de crédito semáforo
   ──────────────────────────────────────────────────── */
function ExpedientesTab({ lang, expedientes, onOpen }) {
  if (!expedientes.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconFolder size={22} style={{color:'var(--text-tertiary)'}}/>
        <div className="heading-md">{lang==='es'?'Sin expedientes activos':'No active files'}</div>
      </div>
    );
  }
  return (
    <div className="card card-pad-0">
      <table className="table">
        <thead>
          <tr>
            <th>{lang==='es'?'Expediente':'File'}</th>
            <th>OC</th>
            <th>{lang==='es'?'Estado':'Status'}</th>
            <th>{lang==='es'?'Marca':'Brand'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Facturado':'Invoiced'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Saldo':'Balance'}</th>
            <th>{lang==='es'?'Reloj crédito':'Credit clock'}</th>
          </tr>
        </thead>
        <tbody>
          {expedientes.map(e => {
            const band = creditClockBand(e.credit_days);
            return (
              <tr key={e.id} onClick={()=>onOpen(e)} style={{cursor:'pointer'}}>
                <td className="mono-sm">{e.ref}</td>
                <td className="mono-sm">{e.oc_client}</td>
                <td><span className="badge badge-outline">{e.status}</span></td>
                <td>{e.brand}</td>
                <td style={{textAlign:'right'}}>{fmtMoney(e.total_invoiced)}</td>
                <td style={{textAlign:'right'}}>{fmtMoney(e.balance)}</td>
                <td>
                  <span className={`cred-clock band-${band}`}>
                    <span className="cred-clock-dot"/>
                    {e.credit_days}d
                    {band === 'red'   && <span className="caption" style={{marginLeft:6, color:'var(--danger, #D64545)'}}>{lang==='es'?'bloqueo':'block'}</span>}
                    {band === 'amber' && <span className="caption" style={{marginLeft:6, color:'var(--warning, #E0A100)'}}>{lang==='es'?'riesgo':'risk'}</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   TAB · Pagos — Payment Status Machine
   ──────────────────────────────────────────────────── */
function PagosTab({ lang, pagos }) {
  if (!pagos.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconDollar size={22} style={{color:'var(--text-tertiary)'}}/>
        <div className="heading-md">{lang==='es'?'Sin pagos registrados':'No payments recorded'}</div>
      </div>
    );
  }

  const agg = pagos.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    acc.total = (acc.total || 0) + p.amount;
    return acc;
  }, {});

  return (
    <>
      {/* Mini-dashboard de estados */}
      <div className="status-machine-strip">
        {Object.entries(PAYMENT_STATUS).map(([k, m]) => (
          <div key={k} className={`sm-box ${m.className}`}>
            <div className="sm-label">{m.label}</div>
            <div className="sm-val">{agg[k] || 0}</div>
          </div>
        ))}
        <div className="sm-box sm-total">
          <div className="sm-label">{lang==='es'?'Total':'Total'}</div>
          <div className="sm-val">{fmtMoney(agg.total || 0)}</div>
        </div>
      </div>

      <div className="card card-pad-0" style={{marginTop: 12}}>
        <table className="table">
          <thead>
            <tr>
              <th>{lang==='es'?'ID Pago':'Payment ID'}</th>
              <th>{lang==='es'?'Fecha':'Date'}</th>
              <th>{lang==='es'?'Expediente':'File'}</th>
              <th>{lang==='es'?'Método':'Method'}</th>
              <th>{lang==='es'?'Referencia':'Ref.'}</th>
              <th style={{textAlign:'right'}}>{lang==='es'?'Monto':'Amount'}</th>
              <th>{lang==='es'?'Estado':'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {pagos.map(p => (
              <tr key={p.id}>
                <td className="mono-sm">{p.id}</td>
                <td>{fmtShortDate(p.date, lang)}</td>
                <td className="mono-sm">{p.expediente}</td>
                <td>{p.method}</td>
                <td className="mono-sm" style={{color:'var(--text-tertiary)'}}>{p.ref}</td>
                <td style={{textAlign:'right'}}>{fmtMoney(p.amount)}</td>
                <td><PaymentStatusBadge status={p.status}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────
   TAB · Productos comprados — inteligencia
   ──────────────────────────────────────────────────── */
function ProductosTab({ lang, productos }) {
  if (!productos.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconBoxes size={22} style={{color:'var(--text-tertiary)'}}/>
        <div className="heading-md">{lang==='es'?'Sin historial de compras':'No purchase history'}</div>
      </div>
    );
  }
  const totalRevenue = productos.reduce((a, p) => a + p.revenue_12m, 0);
  return (
    <div className="card card-pad-0">
      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>{lang==='es'?'Producto':'Product'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Unidades 12m':'Units 12m'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Revenue 12m':'Revenue 12m'}</th>
            <th>{lang==='es'?'Frecuencia':'Frequency'}</th>
            <th>{lang==='es'?'Último pedido':'Last order'}</th>
            <th>{lang==='es'?'Mix':'Mix'}</th>
          </tr>
        </thead>
        <tbody>
          {productos.map(p => {
            const mix = totalRevenue ? (p.revenue_12m / totalRevenue) : 0;
            return (
              <tr key={p.sku}>
                <td className="mono-sm">{p.sku}</td>
                <td>{p.product}</td>
                <td style={{textAlign:'right'}}>{p.units_12m.toLocaleString()}</td>
                <td style={{textAlign:'right'}}>{fmtMoney(p.revenue_12m)}</td>
                <td><span className="pill-soft">{p.frequency}</span></td>
                <td>{fmtShortDate(p.last_order, lang)}</td>
                <td style={{width: 160}}>
                  <div className="credit-bar band-ok" style={{background:'color-mix(in oklab, var(--text-tertiary), white 80%)'}}>
                    <span style={{width:`${(mix*100).toFixed(0)}%`, background: 'var(--channel-color, #481EE3)'}}/>
                  </div>
                  <div className="caption" style={{textAlign:'right', marginTop:2}}>{(mix*100).toFixed(0)}%</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   TAB · Alertas
   ──────────────────────────────────────────────────── */
function AlertasTab({ lang, alertas }) {
  return (
    <div className="alert-stack">
      {alertas.map((a, i) => (
        <div key={i} className={`alert-row alert-${a.severity}`}>
          <div className="alert-icon">
            {a.severity === 'ok'       && <IconCheck size={14}/>}
            {a.severity === 'info'     && <IconHistory size={14}/>}
            {a.severity === 'warning'  && <IconAlert size={14}/>}
            {a.severity === 'critical' && <IconLock size={14}/>}
          </div>
          <div className="alert-body">
            <div className="alert-msg">{a.msg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────
   ConfirmDeleteModal — confirmación de soft-delete
   ──────────────────────────────────────────────────── */
function ConfirmDeleteModal({ clientName, busy, error, lang, onCancel, onConfirm }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onCancel}
        style={{
          position:'fixed', inset:0, zIndex:90,
          background:'rgba(15,27,61,0.45)', backdropFilter:'blur(2px)',
        }}
      />
      <motion.div
        initial={{ opacity:0, scale:0.96 }}
        animate={{ opacity:1, scale:1, transition:{ duration:0.18 }}}
        exit   ={{ opacity:0, scale:0.96, transition:{ duration:0.12 }}}
        role="dialog" aria-modal="true"
        style={{
          position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          width:'min(420px, 92vw)', zIndex:91,
          background:'#FFFFFF', borderRadius:14,
          boxShadow:'0 30px 60px -20px rgba(15,27,61,0.45)',
          fontFamily:'inherit',
        }}
      >
        <div style={{ padding:'22px 22px 12px' }}>
          <div style={{
            font:'600 11px/1 inherit', color:'#DC2626',
            letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8,
          }}>
            {lang==='es' ? 'Acción destructiva' : 'Destructive action'}
          </div>
          <div style={{ font:'700 17px/1.3 inherit', color:'#0F1B3D', marginBottom:8 }}>
            {lang==='es' ? '¿Eliminar este cliente?' : 'Delete this client?'}
          </div>
          <div style={{ font:'500 13.5px/1.5 inherit', color:'#3D4A6B' }}>
            {lang==='es'
              ? <>Vas a eliminar <strong>{clientName}</strong>. Es soft-delete: el cliente queda inactivo en BD pero se conserva el historial. Cualquier expediente o pago asociado no se borra.</>
              : <>You're about to delete <strong>{clientName}</strong>. This is a soft-delete: the client becomes inactive in DB but history is preserved. Linked files/payments are not removed.</>
            }
          </div>
          {error && (
            <div style={{
              marginTop:14, padding:'10px 12px', borderRadius:8,
              background:'#FEE2E2', border:'1px solid #FCA5A5', color:'#991B1B',
              font:'500 12.5px/1.4 inherit',
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={{
          padding:'14px 22px 18px',
          display:'flex', gap:10, justifyContent:'flex-end',
        }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {lang==='es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
                  style={{
                    padding:'10px 16px', borderRadius:9,
                    background: busy ? '#FCA5A5' : '#DC2626',
                    color:'#FFFFFF', border:'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    font:'700 13.5px/1 inherit',
                    boxShadow: busy ? 'none' : '0 4px 10px rgba(220,38,38,0.25)',
                  }}>
            {busy
              ? (lang==='es' ? 'Eliminando…' : 'Deleting…')
              : (lang==='es' ? 'Sí, eliminar' : 'Yes, delete')}
          </button>
        </div>
      </motion.div>
    </>
  );
}
