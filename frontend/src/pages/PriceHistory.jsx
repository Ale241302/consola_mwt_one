// =====================================================================
// MWT.ONE · pages/PriceHistory.jsx
// Agente responsable: [AG-FRONTEND]
//
// F6 · Sprint 2026-05-20 · Bitácora histórica de cambios de precios.
// CEO-ONLY: lista todos los eventos de "Guardar" del motor de precios
// Marluvas (vista cliente-marca). Click en una fila → drawer read-only
// con el snapshot completo (ancla + matriz por SKU).
//
// Endpoints:
//   GET /commercial/marluvas/price-history/?brand_id=&cliente_id=&sku=&since=&limit=
//   GET /commercial/marluvas/price-history/<event_id>/
//
// Filtros UI:
//   · Marca (dropdown)
//   · Cliente (dropdown)
//   · SKU (input texto)
//   · Desde fecha (date input)
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch, marcasApi, clientesApi } from "../lib/api.js";
import {
  IconFolder, IconHistory, IconRefresh, IconX, IconChevDown,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";

const FLAG = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};

export default function ScreenPriceHistory() {
  const { accessToken } = useAuth() || {};

  // ── Filtros ──
  const [brandId,   setBrandId]   = useState("");
  const [clienteId, setClienteId] = useState("");
  const [sku,       setSku]       = useState("");
  const [since,     setSince]     = useState("");

  // ── Catálogos dropdowns ──
  const [brands,   setBrands]   = useState([]);
  const [clients,  setClients]  = useState([]);
  useEffect(() => {
    marcasApi.list().then(d => setBrands(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setBrands([]));
    clientesApi.list().then(d => setClients(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setClients([]));
  }, []);

  // ── Data ──
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const reload = () => {
    let cancel = false;
    setLoading(true); setError(null);
    const qs = new URLSearchParams();
    if (brandId)   qs.set("brand_id",   brandId);
    if (clienteId) qs.set("cliente_id", clienteId);
    if (sku)       qs.set("sku",        sku);
    if (since)     qs.set("since",      since);
    qs.set("limit", "100");
    apiFetch(`/commercial/marluvas/price-history/?${qs.toString()}`, { token: accessToken })
      .then(res => { if (!cancel) setEvents(res?.events || []); })
      .catch(err => { if (!cancel) setError(String(err?.body?.detail || err?.message || err)); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [brandId, clienteId, sku, since, accessToken]);

  // ── Drawer detalle ──
  const [detailId,     setDetailId]     = useState(null);
  const [detail,       setDetail]       = useState(null);
  const [detailLoading,setDetailLoading]= useState(false);
  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    let cancel = false;
    setDetailLoading(true);
    apiFetch(`/commercial/marluvas/price-history/${detailId}/`, { token: accessToken })
      .then(res => { if (!cancel) setDetail(res); })
      .catch(()  => { if (!cancel) setDetail(null); })
      .finally(()=> { if (!cancel) setDetailLoading(false); });
    return () => { cancel = true; };
  }, [detailId, accessToken]);

  // ── Helpers ──
  const brandsById  = useMemo(() => {
    const m = {}; for (const b of brands) m[b.id] = b.nombre || b.name || b.label || '—'; return m;
  }, [brands]);
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CR', { hour12:false }); }
    catch { return iso; }
  };

  const totals = useMemo(() => {
    let skus = 0, cells = 0;
    for (const e of events) { skus += e.sku_count || 0; cells += e.cells_count || 0; }
    return { events: events.length, skus, cells };
  }, [events]);

  // ── Render ──
  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">ADMIN · CEO</div>
          <h1 className="page-title">Historial de precios</h1>
          <p className="page-subtitle">
            Bitácora completa de cambios del motor de precios Marluvas — auditable y read-only.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={reload} disabled={loading}>
          <IconRefresh size={14}/> Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="kpi-row" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:14 }}>
        <KpiCard label="Eventos" value={totals.events}/>
        <KpiCard label="SKUs guardados" value={totals.skus}/>
        <KpiCard label="Celdas congeladas" value={totals.cells}/>
      </div>

      {/* Filtros */}
      <div className="card card-pad-md" style={{ marginBottom:14 }}>
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10,
        }}>
          <Field label="Marca">
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-base">
              <option value="">Todas</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.nombre || b.name || '—'}</option>)}
            </select>
          </Field>
          <Field label="Cliente">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="input-base">
              <option value="">Todos</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.razon_social || c.nombre_comercial || '—'}</option>
              ))}
            </select>
          </Field>
          <Field label="SKU">
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ej: 700728"
                   className="input-base" />
          </Field>
          <Field label="Desde">
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
                   className="input-base"/>
          </Field>
        </div>
      </div>

      {/* Tabla eventos */}
      {error && (
        <div style={{
          padding:'12px 14px', marginBottom:12,
          background:'rgba(220,38,38,0.08)', color:'#991B1B',
          border:'1px solid rgba(220,38,38,0.35)', borderRadius:8,
          font:'500 12px/1.4 var(--font-body)',
        }}>Error: {error}</div>
      )}

      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Marca</th>
              <th>Cliente</th>
              <th className="ta-right">SKUs</th>
              <th className="ta-right">Celdas</th>
              <th className="ta-right">Bandas custom</th>
              <th>Vigencia</th>
              <th style={{ width:30 }}/>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:'var(--text-tertiary)' }}>
                Cargando…
              </td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={8} style={{ padding:40, textAlign:'center', color:'var(--text-tertiary)' }}>
                <IconHistory size={22} style={{ color:'var(--text-tertiary)', marginBottom:6 }}/>
                <div className="heading-md">Sin historial</div>
                <div className="caption">Ajusta los filtros o esperá a que el motor de precios guarde una simulación.</div>
              </td></tr>
            ) : events.map((e) => {
              const flag = FLAG[(e.cliente?.pais_iso2 || '').toUpperCase()] || '🌐';
              const vigencia = e.fecha_inicio || e.fecha_fin
                ? `${e.fecha_inicio || '—'} → ${e.fecha_fin || 'indef.'}`
                : '—';
              return (
                <tr key={e.id} className="row-clickable" onClick={() => setDetailId(e.id)}
                    style={{ cursor:'pointer' }}>
                  <td className="tabular-nums">{fmtDate(e.snapshot_at)}</td>
                  <td>{brandsById[e.brand_id] || '—'}</td>
                  <td>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <span>{flag}</span>
                      <span style={{ fontWeight:600 }}>
                        {e.cliente?.razon_social || e.cliente?.nombre_comercial || '—'}
                      </span>
                    </span>
                  </td>
                  <td className="ta-right tabular-nums">{e.sku_count}</td>
                  <td className="ta-right tabular-nums">{e.cells_count}</td>
                  <td className="ta-right tabular-nums">
                    {e.custom_plazos_bands > 0
                      ? <span style={{
                          padding:'2px 7px', borderRadius:10,
                          background:'rgba(245,158,11,0.15)', color:'#92400E',
                          font:'700 10px/1 var(--font-body)',
                        }}>{e.custom_plazos_bands}</span>
                      : <span style={{ color:'var(--text-tertiary)' }}>0</span>}
                  </td>
                  <td className="caption">{vigencia}</td>
                  <td style={{ textAlign:'center' }}>›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drawer detalle */}
      {detailId && (
        <DetailDrawer
          loading={detailLoading}
          data={detail}
          brandName={detail?.event?.brand_id ? brandsById[detail.event.brand_id] : null}
          onClose={() => { setDetailId(null); setDetail(null); }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Drawer read-only con cabecera + lista de SKUs
// =====================================================================
function DetailDrawer({ data, loading, brandName, onClose }) {
  const fmtDateTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CR', { hour12:false }); }
    catch { return iso; }
  };
  const flag = FLAG[(data?.event?.cliente?.pais_iso2 || '').toUpperCase()] || '🌐';

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(11,30,58,0.45)',
      display:'flex', justifyContent:'flex-end',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width:'min(960px, 100vw)', height:'100vh',
        background:'var(--surface, #FFFFFF)',
        overflowY:'auto', boxShadow:'-12px 0 32px rgba(11,30,58,0.18)',
      }}>
        <div style={{
          padding:'18px 22px', borderBottom:'1px solid var(--border-subtle, #E5E7EB)',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12,
        }}>
          <div>
            <div style={{ font:'700 9.5px/1 var(--font-body)', color:'var(--text-tertiary)',
              textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>
              Snapshot · Historial de precios
            </div>
            <div style={{ font:'700 18px/1.2 var(--font-display)', color:'var(--text-primary)' }}>
              {loading ? 'Cargando…' : (
                data?.event ? (
                  <>
                    {brandName || '—'} <span style={{ color:'var(--text-tertiary)', fontWeight:500 }}>·</span>{' '}
                    {flag} {data.event.cliente?.razon_social || '—'}
                  </>
                ) : 'Sin datos'
              )}
            </div>
            {data?.event && (
              <div style={{ font:'500 11.5px/1.4 var(--font-body)', color:'var(--text-secondary)', marginTop:4 }}>
                Guardado el {fmtDateTime(data.event.snapshot_at)}
                {data.event.fecha_inicio && (
                  <> · Vigencia: {data.event.fecha_inicio} → {data.event.fecha_fin || 'indef.'}</>
                )}
                {' · '}<strong>{data.event.sku_count}</strong> SKUs ·{' '}
                <strong>{data.event.cells_count}</strong> celdas
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background:'transparent', border:'1px solid var(--border-subtle, #E5E7EB)',
            borderRadius:6, padding:'6px 8px', cursor:'pointer',
          }} title="Cerrar"><IconX size={14}/></button>
        </div>

        <div style={{ padding:'18px 22px' }}>
          {loading ? (
            <div style={{ color:'var(--text-tertiary)', padding:20 }}>Cargando snapshot…</div>
          ) : !data?.skus?.length ? (
            <div style={{ padding:20, color:'var(--text-tertiary)' }}>
              Este evento no tiene SKUs persistidos.
            </div>
          ) : (
            <>
              {data.event?.custom_plazos && Object.keys(data.event.custom_plazos).length > 0 && (
                <div style={{
                  marginBottom:14, padding:'10px 12px',
                  background:'rgba(245,158,11,0.08)',
                  border:'1px solid rgba(245,158,11,0.35)', borderRadius:8,
                  font:'500 11.5px/1.4 var(--font-body)', color:'#92400E',
                }}>
                  Plazos custom: {Object.keys(data.event.custom_plazos).length} banda(s) con plazos
                  personalizados. Las columnas de la matriz reflejan ese estado al momento del guardado.
                </div>
              )}
              {data.skus.map((s) => (
                <SkuSnapshotCard key={s.id} sku={s} customPlazos={data.event?.custom_plazos || {}}/>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Card por SKU dentro del drawer: ancla + matriz simplificada
// =====================================================================
function SkuSnapshotCard({ sku, customPlazos }) {
  const matrix = sku.prices_matrix || {};
  const bandaIds = Object.keys(matrix).sort((a,b) => Number(a) - Number(b));
  return (
    <div style={{
      marginBottom:12, padding:'12px 14px',
      background:'var(--surface, #FFFFFF)',
      border:'1px solid var(--border-subtle, #E5E7EB)',
      borderRadius:8,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, marginBottom:8 }}>
        <div style={{ font:'700 13.5px/1.2 var(--font-display)', color:'var(--text-primary)' }}>
          SKU {sku.sku}
          {!sku.activo && <span style={{
            marginLeft:8, padding:'2px 7px', borderRadius:10,
            background:'rgba(100,116,139,0.15)', color:'var(--text-tertiary)',
            font:'700 9px/1 var(--font-body)', textTransform:'uppercase',
          }}>Inactivo</span>}
        </div>
        <div style={{ display:'flex', gap:14, font:'500 10.5px/1.4 var(--font-body)',
          color:'var(--text-secondary)', fontVariantNumeric:'tabular-nums', flexWrap:'wrap' }}>
          {sku.brl_override != null && <span>BRL: <strong>{Number(sku.brl_override).toFixed(2)}</strong></span>}
          <span>Com: <strong>{Number(sku.com_pct).toFixed(2)}%</strong></span>
          <span>Ajuste: <strong>${Number(sku.ajuste_usd).toFixed(2)}</strong></span>
          <span>Sobreprecio: <strong>{(Number(sku.sobreprecio_pct) * 100).toFixed(2)}%</strong></span>
          {sku.anchor && (
            <span style={{
              padding:'2px 7px', borderRadius:10,
              background:'rgba(0,178,134,0.12)', color:'#065F46',
              font:'700 9.5px/1 var(--font-body)',
            }}>
              Ancla: #{sku.anchor.bandaId} · {sku.anchor.plazoDias}d
            </span>
          )}
        </div>
      </div>

      <div style={{ overflowX:'auto', border:'1px solid var(--border-subtle, #E5E7EB)', borderRadius:6 }}>
        <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:0,
                        fontVariantNumeric:'tabular-nums' }}>
          <thead>
            <tr>
              <th style={smTh}>Banda</th>
              <th style={smTh}>Plazos</th>
            </tr>
          </thead>
          <tbody>
            {bandaIds.length === 0 ? (
              <tr><td colSpan={2} style={{ ...smTd, color:'var(--text-tertiary)', fontStyle:'italic' }}>
                Sin matriz persistida
              </td></tr>
            ) : bandaIds.map((bid) => {
              const row = matrix[bid] || {};
              const plazos = Object.keys(row).sort((a,b) => Number(b) - Number(a));
              return (
                <tr key={bid}>
                  <td style={{ ...smTd, fontWeight:700, color:'var(--text-primary)' }}>#{bid}</td>
                  <td style={smTd}>
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                      {plazos.map(d => (
                        <span key={d} style={{
                          padding:'2px 8px', borderRadius:6,
                          background:'var(--surface-alt, #F8FAFC)',
                          border:'1px solid var(--border-subtle, #E5E7EB)',
                          font:'600 10.5px/1.3 var(--font-mono, ui-monospace)',
                        }}>
                          {d}d: <strong>{Number(row[d]).toFixed(2)}</strong>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sku.sizes_pricing && Object.keys(sku.sizes_pricing).length > 0 && (
        <div style={{ marginTop:8, font:'500 10.5px/1.3 var(--font-body)', color:'var(--text-secondary)' }}>
          + {Object.keys(sku.sizes_pricing).length} override(s) por talla en este snapshot.
        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────
function KpiCard({ label, value }) {
  return (
    <div className="card card-pad-md">
      <div style={{ font:'600 9.5px/1 var(--font-body)', color:'var(--text-tertiary)',
        textTransform:'uppercase', letterSpacing:0.5, marginBottom:5 }}>{label}</div>
      <div style={{ font:'700 22px/1 var(--font-display)', color:'var(--text-primary)',
        fontVariantNumeric:'tabular-nums' }}>{(value || 0).toLocaleString()}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display:'block' }}>
      <div style={{ font:'700 9.5px/1 var(--font-body)', color:'var(--text-tertiary)',
        textTransform:'uppercase', letterSpacing:0.5, marginBottom:5 }}>{label}</div>
      {children}
    </label>
  );
}

// ── Tabla compacta del drawer ──
const smTh = {
  padding:'8px 10px', font:'700 9.5px/1 var(--font-body)',
  color:'var(--text-secondary)', textAlign:'left',
  textTransform:'uppercase', letterSpacing:0.5,
  borderBottom:'1px solid var(--border-subtle, #E5E7EB)',
  background:'var(--surface-alt, #F8FAFC)',
};
const smTd = {
  padding:'8px 10px', fontSize:11.5,
  borderBottom:'1px solid var(--border-subtle, #F1F5F9)',
  verticalAlign:'middle',
};
