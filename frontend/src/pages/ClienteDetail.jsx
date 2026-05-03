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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconMapPin, IconUser, IconMail, IconCreditCard,
  IconClock, IconAlert, IconCheck, IconX, IconShield, IconDollar,
  IconTrend, IconBoxes, IconFolder, IconHistory, IconGlobe, IconLock,
  IconRefresh, IconUsers,
} from "../lib/icons.jsx";
import { fmtMoney, fmtShortDate } from "../lib/i18n.js";
import { clientesApi, apiFetch, getToken } from "../lib/api.js";
import {
  CLIENTS, EXPEDIENTES, CLIENT_PAYMENTS, CLIENT_PRODUCTS_BOUGHT, OCS,
} from "../data/mockData.js";
// Parent-Child (sprint 2026-04-29) — tab Subsidiarias y toggle de consolidación
import SubsidiariasTab from "../components/clientes/SubsidiariasTab.jsx";
import ConsolidateToggle from "../components/clientes/ConsolidateToggle.jsx";

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
    // ── Parent-Child (sprint 2026-04-29) ──
    parent_id:         raw.parent_id || null,
    parent:            raw.parent || null,                  // {id, razon_social}
    is_parent:         raw.is_parent ?? !raw.parent_id,
    is_subsidiary:     raw.is_subsidiary ?? !!raw.parent_id,
    subsidiarias_count: Number(raw.subsidiarias_count ?? 0),
    kpis_pool:         raw.kpis_pool || null,
    // crudo por si tabs futuros lo quieren
    _raw: raw,
  };
}
// NOTA 2026-04 · ClientFormDrawer DEPRECATED — reemplazado por la página
// full-page pages/ClienteFormView.jsx. El botón "Editar" de aquí navega
// ahora a /clientes/:id/editar.
// import ClientFormDrawer from "../components/clientes/ClientFormDrawer.jsx";

// ─── Adapters API → shape histórico (sprint 2026-05-03) ───────────────
// El endpoint /clientes/{id}/expedientes/ entrega: id, codigo, estado,
// total_invoiced, total_paid, balance, credit_days, last_event_at,
// order_value, lines_count, lines_with_sap. Mapeamos al shape que ya
// esperan ExpedientesTab/KPIs y dejamos `total_invoiced` con fallback al
// order_value (suma de líneas resueltas con catálogo) para que la
// columna "Facturado" no quede en $0 cuando todavía no hay facturación.
function adaptExpedienteFromApi(r) {
  if (!r || !r.id) return null;
  const inv  = Number(r.total_invoiced || 0);
  const ov   = Number(r.order_value || 0);
  const paid = Number(r.total_paid || 0);
  const facturado = inv > 0 ? inv : ov;
  const balance   = Number(r.balance || 0) > 0
    ? Number(r.balance)
    : Math.max(0, facturado - paid);
  return {
    id:             r.id,
    ref:            r.codigo || r.id,
    oc_client:      r.codigo || '—',
    client_id:      r.client_id || null,
    status:         r.estado || 'REGISTRO',
    brand:          r.brand || '—',
    total_invoiced: facturado,
    total_paid:     paid,
    balance,
    credit_days:    Number(r.credit_days || 0),
    last_event_at:  r.last_event_at || r.created_at || null,
    lines_count:    Number(r.lines_count || 0),
    lines_with_sap: Number(r.lines_with_sap || 0),
    order_value:    ov,
  };
}

function adaptProductoFromApi(r) {
  // Sprint 2026-05-03 v2: el backend ahora devuelve UNA FILA POR LÍNEA
  // del expediente — no agregado. Pasamos los campos al shape que la
  // ProductosTab nueva consume directamente.
  if (!r) return null;
  return {
    line_id:           r.line_id || r.id || null,
    sku:               r.sku || r.producto_id || '—',
    product:           r.nombre || r.sku || '—',
    talla:             r.talla || '—',
    qty:               Number(r.qty || 0),
    sap:               r.sap || null,
    unit_price:        Number(r.unit_price || 0),
    line_total:        Number(r.line_total || 0),
    expediente_id:     r.expediente_id || null,
    expediente_codigo: r.expediente_codigo || '—',
    expediente_estado: r.expediente_estado || null,
    last_seen_at:      r.last_seen_at || null,
  };
}

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
  // Toggle Consolidar (sprint Parent-Child) — solo visible en padre.
  // Si está ON, las tabs Expedientes / Pagos / Productos consolidan
  // padre + subsidiarias. OFF muestra solo la entidad actual.
  const [consolidate, setConsolidate] = useState(true);
  // showEdit/setShowEdit ya no se usa — la edición es una página aparte.
  // Lo mantengo declarado para no romper la función si algún effect lo refería.
  const [showEdit, setShowEdit] = useState(false);   // eslint-disable-line no-unused-vars

  // Estado para el modal de confirmación de eliminación
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteErr,     setDeleteErr]     = useState(null);

  // Cambio de estado inline (popover desde el botón "Estado")
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [savingStatus,   setSavingStatus]   = useState(false);
  const statusBtnRef = useRef(null);

  // ── Fetch real al backend (antes leía CLIENTS de mockData.js, por eso
  //    clientes creados vía API mostraban "Cliente no encontrado") ──
  const [rawClient, setRawClient] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState(null);

  // Sprint 2026-05-03 · Expedientes y productos del cliente vienen ahora
  // del backend (endpoints `/clientes/{id}/expedientes/` y
  // `/clientes/{id}/productos_comprados/`). Reemplaza el filtrado in-memory
  // contra MOCK_EXPEDIENTES y MOCK_CLIENT_PRODUCTS_BOUGHT que mostraba
  // siempre "Sin expedientes" para clientes del backend.
  const [apiExpedientes, setApiExpedientes] = useState(null);
  const [apiProductos,   setApiProductos]   = useState(null);

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

  // Refrescar expedientes + productos cuando consolidate o el id cambian.
  // Si el cliente es mock saltamos el fetch — los datos vendrán del mock.
  useEffect(() => {
    if (!clienteId || rawClient?.__isMockShape) {
      setApiExpedientes(null);
      setApiProductos(null);
      return;
    }
    let cancelled = false;
    const cQ = consolidate ? 'true' : 'false';
    const tk = getToken();
    Promise.all([
      apiFetch(`/clientes/${clienteId}/expedientes/?consolidate=${cQ}`,        { token: tk }).catch(() => []),
      apiFetch(`/clientes/${clienteId}/productos_comprados/?consolidate=${cQ}`, { token: tk }).catch(() => []),
    ]).then(([exps, prods]) => {
      if (cancelled) return;
      setApiExpedientes(Array.isArray(exps) ? exps : (exps?.results || []));
      setApiProductos(Array.isArray(prods) ? prods : (prods?.results || []));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, consolidate, rawClient?.__isMockShape]);

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

  /* ── Data slices (sprint 2026-05-03) ───────────────────────
     Si tenemos data del API la usamos; si no (cliente mock o aún
     cargando), caemos al mock data. El adapter mapea el shape del
     backend al shape histórico que esperan los <ExpedientesTab/> y
     <ProductosTab/>. */
  const expedientesCliente = useMemo(() => {
    if (Array.isArray(apiExpedientes)) {
      return apiExpedientes.map(adaptExpedienteFromApi).filter(Boolean);
    }
    return cid ? EXPEDIENTES.filter(e => e.client_id === cid) : [];
  }, [apiExpedientes, cid]);
  const expedientesActivos = useMemo(
    () => expedientesCliente.filter(
      e => e.status !== 'CERRADO' && e.status !== 'CANCELADO'
    ),
    [expedientesCliente]
  );
  // Pagos: aún no hay endpoint dedicado. Usamos mock cuando es cliente
  // mock; para clientes reales devolvemos lista vacía hasta que cobros
  // exponga /clientes/{id}/pagos/.
  const pagosCliente = useMemo(() => {
    if (rawClient?.__isMockShape && cid) {
      return CLIENT_PAYMENTS.filter(p => p.client_id === cid)
        .sort((a,b) => (a.date < b.date ? 1 : -1));
    }
    return [];
  }, [cid, rawClient?.__isMockShape]);
  const productosCliente = useMemo(() => {
    if (Array.isArray(apiProductos)) {
      return apiProductos.map(adaptProductoFromApi).filter(Boolean);
    }
    return cid
      ? CLIENT_PRODUCTS_BOUGHT.filter(p => p.client_id === cid)
          .sort((a,b) => b.revenue_12m - a.revenue_12m)
      : [];
  }, [apiProductos, cid]);

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
      <div className="flex ai-center gap-2" style={{marginBottom: 12, flexWrap:'wrap'}}>
        <button className="btn btn-ghost" onClick={()=>navigate('/clientes')}>
          <IconChevLeft size={14}/> {lang==='es'?'Clientes':'Clients'}
        </button>
        <span className="caption" style={{color:'var(--text-tertiary)'}}>/</span>
        {/* Si es subsidiaria, breadcrumb anidado: Clientes / [Padre] / [Sub] */}
        {client.is_subsidiary && client.parent && (
          <>
            <button className="btn btn-ghost"
                    style={{padding:'4px 8px'}}
                    onClick={()=>navigate(`/clientes/${client.parent.id}`)}>
              {client.parent.razon_social || client.parent.nombre_comercial}
            </button>
            <span className="caption" style={{color:'var(--text-tertiary)'}}>/</span>
          </>
        )}
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
          {/* Círculo de bandera removido — el país aparece en el row de info debajo del nombre. */}
          <div style={{flex:1, minWidth:0}}>
            {/* Chip "Cliente padre" — solo visible en subsidiarias */}
            {client.is_subsidiary && client.parent && (
              <button
                onClick={()=>navigate(`/clientes/${client.parent.id}`)}
                className="parent-chip"
                style={{
                  display:'inline-flex', alignItems:'center', gap:6,
                  padding:'4px 10px', marginBottom: 6,
                  background:'rgba(0,178,134,0.10)',
                  border:'1px solid rgba(0,178,134,0.25)',
                  borderRadius: 999,
                  font:'600 11px/1 inherit',
                  color:'#0F1B3D',
                  cursor:'pointer',
                  transition:'background 0.18s ease',
                }}
                onMouseOver={e=>e.currentTarget.style.background='rgba(0,178,134,0.18)'}
                onMouseOut ={e=>e.currentTarget.style.background='rgba(0,178,134,0.10)'}
              >
                <IconChevLeft size={11} style={{color:'#00B286'}}/>
                <span style={{
                  color:'#00B286', textTransform:'uppercase',
                  letterSpacing:'0.08em', fontSize:10,
                }}>
                  {lang==='es'?'Cliente padre:':'Parent client:'}
                </span>
                <strong style={{color:'#0F1B3D'}}>
                  {client.parent.razon_social || client.parent.nombre_comercial}
                </strong>
              </button>
            )}
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
          <div style={{display:'flex', gap:8, position:'relative'}}>
            {/* Cambiar estado inline — solo nodos del backend (los mock no
                pueden persistir cambios). Abre un popover con las 4 opciones. */}
            {client._raw && (
              <button ref={statusBtnRef}
                      className="btn btn-ghost"
                      disabled={savingStatus}
                      onClick={()=>setShowStatusMenu(s=>!s)}>
                {savingStatus
                  ? (lang==='es'?'Guardando…':'Saving…')
                  : (lang==='es'?'Estado ▾':'Status ▾')}
              </button>
            )}
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

      {/* Popover de estados — vía Portal, ancla al botón "Estado".
          Se monta fuera del hero (overflow:hidden lo cortaba). */}
      {showStatusMenu && createPortal(
        <AnimatePresence>
          <StatusPopover
            anchorRef={statusBtnRef}
            current={client.estado}
            busy={savingStatus}
            lang={lang}
            onClose={()=>setShowStatusMenu(false)}
            onPick={async (newEstado) => {
              if (newEstado === client.estado) { setShowStatusMenu(false); return; }
              setSavingStatus(true);
              try {
                await clientesApi.update(clienteId, { estado: newEstado });
                const fresh = await clientesApi.get(clienteId);
                setRawClient(fresh);
                setShowStatusMenu(false);
              } catch (e) {
                alert((lang==='es'?'Error: ':'Error: ') + (e?.message || ''));
              } finally {
                setSavingStatus(false);
              }
            }}
          />
        </AnimatePresence>,
        document.body
      )}

      {/* ── Modal confirmación de eliminación ─────────
           Renderizado vía Portal a document.body para que `position:fixed`
           sea relativo al viewport (algún ancestor con transform/perspective
           rompía el centrado en pantalla). */}
      {confirmDelete && createPortal(
        <AnimatePresence>
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
        </AnimatePresence>,
        document.body
      )}

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
      <div className="tab-bar" style={{marginTop: 20, display:'flex', alignItems:'center'}}>
        <div style={{display:'flex', flex:1, flexWrap:'wrap'}}>
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
          {/* Subsidiarias — solo PADRE puede tener subsidiarias (max 2 niveles) */}
          {client.is_parent && (
            <button className="tab-btn" data-active={tab==='subsidiarias'}
                    onClick={()=>setTab('subsidiarias')}>
              <IconUsers size={12}/> {lang==='es'?'Subsidiarias':'Subsidiaries'}
              <span className="tab-count">{client.subsidiarias_count || 0}</span>
            </button>
          )}
        </div>
        {/* Toggle Consolidar — solo padre, oculto en tab Subsidiarias / Alertas */}
        {client.is_parent && client.subsidiarias_count > 0
          && tab !== 'subsidiarias' && tab !== 'alertas' && (
          <ConsolidateToggle
            value={consolidate}
            onChange={setConsolidate}
            lang={lang}
          />
        )}
      </div>

      <div className="tab-panel">
        <AnimatePresence mode="wait">
          {tab === 'expedientes' && (
            <motion.div key="exp" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <ExpedientesTab lang={lang}
                              expedientes={expedientesActivos}
                              consolidate={consolidate}
                              isParent={client.is_parent}
                              onOpen={(exp)=>{
                // Sprint 2026-05-03: con expedientes del backend ya no
                // tenemos un mock OCS para resolver oc_id. Usamos la ruta
                // tolerante /expedientes/none/exp/<id> que ya soporta
                // ExpedienteDetail (mismo patrón que Expedientes.jsx).
                const oc = OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(exp.id));
                if (oc) {
                  navigate(`/expedientes/${oc.id}/exp/${exp.id}`);
                } else {
                  navigate(`/expedientes/none/exp/${exp.id}`);
                }
              }}/>
            </motion.div>
          )}
          {tab === 'pagos' && (
            <motion.div key="pay" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <PagosTab lang={lang} pagos={pagosCliente}
                        consolidate={consolidate} isParent={client.is_parent}/>
            </motion.div>
          )}
          {tab === 'productos' && (
            <motion.div key="prod" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <ProductosTab lang={lang} productos={productosCliente}
                            consolidate={consolidate} isParent={client.is_parent}
                            onOpenExpediente={(p) => {
                              // Sprint 2026-05-03 v2: el row click navega al
                              // detalle del expediente (mismo patrón que la
                              // tab Expedientes). Si no hay oc en mock,
                              // usamos la ruta tolerante /expedientes/none.
                              const oc = OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(p.expediente_id));
                              if (oc) {
                                navigate(`/expedientes/${oc.id}/exp/${p.expediente_id}`);
                              } else {
                                navigate(`/expedientes/none/exp/${p.expediente_id}`);
                              }
                            }}/>
            </motion.div>
          )}
          {tab === 'alertas' && (
            <motion.div key="alr" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <AlertasTab lang={lang} alertas={alertas}/>
            </motion.div>
          )}
          {tab === 'subsidiarias' && client.is_parent && (
            <motion.div key="subs" initial={{opacity:0, y:6}} animate={{opacity:1, y:0}} exit={{opacity:0}} transition={{duration:0.18}}>
              <SubsidiariasTab parent={client._raw || client} lang={lang}/>
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
function ConsolidatedBanner({ lang, isParent, consolidate }) {
  if (!isParent || !consolidate) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:6,
      padding:'8px 12px', marginBottom: 10,
      background:'rgba(0,178,134,0.06)',
      border:'1px dashed rgba(0,178,134,0.30)',
      borderRadius:8,
      font:'500 12px/1.4 inherit', color:'#0F1B3D',
    }}>
      <span style={{
        width:6, height:6, borderRadius:99, background:'#00B286', flexShrink:0,
      }}/>
      <span>
        {lang==='es'
          ? 'Vista consolidada · incluye padre + subsidiarias activas.'
          : 'Consolidated view · includes parent + active subsidiaries.'}
      </span>
    </div>
  );
}

function ExpedientesTab({ lang, expedientes, onOpen, consolidate, isParent }) {
  if (!expedientes.length) {
    return (
      <>
        <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
        <div className="card card-pad-lg empty">
          <IconFolder size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">{lang==='es'?'Sin expedientes activos':'No active files'}</div>
        </div>
      </>
    );
  }
  return (
    <>
      <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
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
    </>
  );
}

/* ────────────────────────────────────────────────────
   TAB · Pagos — Payment Status Machine
   ──────────────────────────────────────────────────── */
function PagosTab({ lang, pagos, consolidate, isParent }) {
  if (!pagos.length) {
    return (
      <>
        <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
        <div className="card card-pad-lg empty">
          <IconDollar size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">{lang==='es'?'Sin pagos registrados':'No payments recorded'}</div>
        </div>
      </>
    );
  }

  const agg = pagos.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    acc.total = (acc.total || 0) + p.amount;
    return acc;
  }, {});

  return (
    <>
      <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
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
   TAB · Productos comprados — una fila por línea de expediente
   Sprint 2026-05-03 v2: muestra talla, cantidad y expediente
   clickeable. El total al pie suma todas las líneas.
   ──────────────────────────────────────────────────── */
function ProductosTab({ lang, productos, consolidate, isParent, onOpenExpediente }) {
  if (!productos.length) {
    return (
      <>
        <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
        <div className="card card-pad-lg empty">
          <IconBoxes size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">{lang==='es'?'Sin productos comprados':'No products purchased'}</div>
          <div className="caption" style={{color:'var(--text-tertiary)'}}>
            {lang==='es'
              ? 'Cuando este cliente tenga expedientes con líneas activas, aparecerán aquí agrupados por expediente.'
              : 'Lines from active files for this client will appear grouped by file.'}
          </div>
        </div>
      </>
    );
  }
  // KPIs de pie de tabla
  const totalQty   = productos.reduce((a, p) => a + Number(p.qty || 0), 0);
  const totalValor = productos.reduce((a, p) => a + Number(p.line_total || 0), 0);
  const expedientesUnicos = new Set(productos.map(p => p.expediente_id).filter(Boolean)).size;
  return (
    <>
      <ConsolidatedBanner lang={lang} isParent={isParent} consolidate={consolidate}/>
      {/* Mini-summary */}
      <div className="status-machine-strip" style={{marginBottom: 10}}>
        <div className="sm-box">
          <div className="sm-label">{lang==='es'?'Líneas':'Lines'}</div>
          <div className="sm-val tabular-nums">{productos.length}</div>
        </div>
        <div className="sm-box">
          <div className="sm-label">{lang==='es'?'Expedientes':'Files'}</div>
          <div className="sm-val tabular-nums">{expedientesUnicos}</div>
        </div>
        <div className="sm-box">
          <div className="sm-label">{lang==='es'?'Unidades':'Units'}</div>
          <div className="sm-val tabular-nums">{totalQty.toLocaleString()}</div>
        </div>
        <div className="sm-box sm-total">
          <div className="sm-label">{lang==='es'?'Total':'Total'}</div>
          <div className="sm-val tabular-nums">{fmtMoney(totalValor)}</div>
        </div>
      </div>

      <div className="card card-pad-0">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>{lang==='es'?'Producto':'Product'}</th>
              <th style={{textAlign:'center'}}>{lang==='es'?'Talla':'Size'}</th>
              <th style={{textAlign:'right'}}>{lang==='es'?'Cantidad':'Qty'}</th>
              <th style={{textAlign:'right'}}>{lang==='es'?'Precio':'Price'}</th>
              <th style={{textAlign:'right'}}>{lang==='es'?'Total':'Total'}</th>
              <th>{lang==='es'?'Expediente':'File'}</th>
            </tr>
          </thead>
          <tbody>
            {productos.map(p => (
              <tr key={p.line_id || `${p.expediente_id}-${p.sku}-${p.talla}`}
                  onClick={() => p.expediente_id && onOpenExpediente && onOpenExpediente(p)}
                  style={{ cursor: p.expediente_id ? 'pointer' : 'default' }}
                  title={lang==='es' ? 'Abrir expediente' : 'Open file'}>
                <td className="mono-sm">{p.sku}</td>
                <td>{p.product}</td>
                <td style={{textAlign:'center'}} className="tabular-nums">{p.talla || '—'}</td>
                <td style={{textAlign:'right'}} className="tabular-nums">{Number(p.qty || 0).toLocaleString()}</td>
                <td style={{textAlign:'right'}} className="tabular-nums">{fmtMoney(p.unit_price)}</td>
                <td style={{textAlign:'right'}} className="tabular-nums">{fmtMoney(p.line_total)}</td>
                <td>
                  <span className="mono-sm" style={{
                    color: 'var(--brand-accent, #00B286)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}>
                    {p.expediente_codigo || '—'}
                  </span>
                  {p.sap && (
                    <span className="caption mono-sm" style={{
                      marginLeft: 8, color: 'var(--text-tertiary)',
                    }}>
                      · SAP {p.sap}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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
   StatusPopover — cambio rápido de estado (PATCH inline)
   Estados: ACTIVO · PAUSADO · INACTIVO · BLOQUEADO
   ──────────────────────────────────────────────────── */
const STATUS_OPTIONS = [
  { k:'ACTIVO',    l:'Activo',    color:'#10B981', hint:'Operación normal.' },
  { k:'PAUSADO',   l:'Pausado',   color:'#F59E0B', hint:'Suspendido temporalmente.' },
  { k:'INACTIVO',  l:'Inactivo',  color:'#64748B', hint:'Fuera de operación.' },
  { k:'BLOQUEADO', l:'Bloqueado', color:'#DC2626', hint:'Sin nuevas OCs.' },
];

function StatusPopover({ anchorRef, current, busy, lang, onClose, onPick }) {
  const ref = useRef(null);
  // Posición fija calculada desde el ancla (botón "Estado").
  // El ancho del popover (260px) lo alineamos a la derecha del botón.
  const POP_W = 260;
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const reposition = () => {
      const a = anchorRef?.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const left = Math.max(8, r.right - POP_W); // alinea borde derecho del popover con borde derecho del botón
      const top  = r.bottom + 6;                  // 6px debajo del botón
      setPos({ top, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchorRef]);

  // Click fuera cierra (excluye al propio ancla para evitar toggle-loop)
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchorRef?.current && anchorRef.current.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose, anchorRef]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity:0, y:-4 }}
      animate={{ opacity:1, y:0, transition:{ duration:0.14 }}}
      exit   ={{ opacity:0, y:-4, transition:{ duration:0.10 }}}
      style={{
        position:'fixed', top: pos.top, left: pos.left,
        zIndex:1000, width: POP_W,
        background:'#FFFFFF', borderRadius:12,
        boxShadow:'0 18px 40px -12px rgba(15,27,61,0.28)',
        border:'1px solid #EAEEF5', overflow:'hidden',
        fontFamily:'inherit',
      }}
    >
      <div style={{
        padding:'10px 14px', borderBottom:'1px solid #F1F4F9',
        font:'600 11px/1 inherit', color:'#6B7894',
        textTransform:'uppercase', letterSpacing:'0.1em',
      }}>
        {lang==='es' ? 'Cambiar estado' : 'Change status'}
      </div>
      {STATUS_OPTIONS.map(s => {
        const isCurrent = current === s.k;
        return (
          <button key={s.k} type="button"
                  disabled={busy}
                  onClick={()=>onPick?.(s.k)}
                  style={{
                    display:'flex', alignItems:'center', gap:10,
                    width:'100%', padding:'10px 14px',
                    background: isCurrent ? '#F7F9FC' : '#FFFFFF',
                    border:'none', borderTop:'1px solid #F1F4F9',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    textAlign:'left',
                  }}
                  onMouseOver={e => !busy && !isCurrent && (e.currentTarget.style.background='#F7F9FC')}
                  onMouseOut ={e => !busy && !isCurrent && (e.currentTarget.style.background='#FFFFFF')}>
            <span style={{
              width:10, height:10, borderRadius:99, background:s.color, flexShrink:0,
              boxShadow:`0 0 0 3px ${s.color}22`,
            }}/>
            <div style={{flex:1, minWidth:0}}>
              <div style={{
                font:'600 13px/1.2 inherit',
                color: isCurrent ? '#0F1B3D' : '#3D4A6B',
              }}>
                {s.l}
              </div>
              <div style={{ font:'500 11.5px/1.3 inherit', color:'#8893AC' }}>
                {s.hint}
              </div>
            </div>
            {isCurrent && (
              <span style={{ font:'600 10.5px/1 inherit', color:s.color }}>
                {lang==='es'?'ACTUAL':'CURRENT'}
              </span>
            )}
          </button>
        );
      })}
    </motion.div>
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
        initial={{ opacity:0, y:-12, x:'-50%' }}
        animate={{ opacity:1, y:0,   x:'-50%', transition:{ duration:0.18 }}}
        exit   ={{ opacity:0, y:-12, x:'-50%', transition:{ duration:0.12 }}}
        role="dialog" aria-modal="true"
        style={{
          // Centrado horizontal, anclado a 12vh desde la parte superior
          // (el usuario lo prefiere alto, no en el centro vertical).
          position:'fixed', top:'12vh', left:'50%',
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
