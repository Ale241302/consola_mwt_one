// =====================================================================
// MWT.ONE · pages/PriceHistory.jsx
// Agente responsable: [AG-FRONTEND]
//
// F6 · Sprint 2026-05-20 · Bitácora histórica de cambios de precios.
// CEO-ONLY: lista todos los eventos de "Guardar" del motor de precios
// Marluvas (vista cliente-marca). Click en una fila → drawer read-only
// con el snapshot completo (ancla + matriz por SKU + tallas).
//
// Re-diseño 2026-05-20 (post-F6.1):
//   El render del SKU dentro del drawer ahora replica visualmente el motor:
//     · Header del SKU con BRL, COM%, badge de ancla (con tipo
//       TECHO/VIGENTE/PISO y rango de FX), Base USD, Ajuste $,
//       Sobreprecio %, Lista USD.
//     · Matriz "USD por par" con bandas como columnas (colores por tipo),
//       plazos como sub-columnas con su sub-label (base, +1%, -1%, etc.).
//     · Toggle "Esenciales | Todas las bandas".
//     · Si el SKU tiene overrides por talla (sizes_pricing), aparece un
//       toggle "+ tallas con override (N)" que expande cards por talla
//       con su propia matriz (mismo formato que el motor).
//
// Endpoints:
//   GET /commercial/marluvas/price-history/?brand_id=&cliente_id=&sku=&since=&limit=
//   GET /commercial/marluvas/price-history/<event_id>/
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch, marcasApi, clientesApi } from "../lib/api.js";
import {
  IconHistory, IconRefresh, IconX, IconChevDown, IconChevRight,
} from "../lib/icons.jsx";
import {
  BANDAS_MARLUVAS, fmtUSD, fmtPct,
} from "../constants/marluvas.js";
import { getBandPlazos, anchorPrice } from "../lib/marluvasPricing.js";
import { useSkuTallas } from "../hooks/useSkuTallas.js";

// ───────────────────── Tokens visuales ─────────────────────
// Coherentes con BrandClientPricingForm (motor de precios). Mantenerlos
// alineados con esa fuente para que el snapshot se vea idéntico.
const TECHO_BG       = "#FCE4D6";
const TECHO_STRONG   = "#F5B895";
const TECHO_TEXT     = "#92400E";
const VIGENTE_BG     = "#FEF3C7";
const VIGENTE_STRONG = "#FCD34D";
const VIGENTE_TEXT   = "#92400E";
const PISO_BG        = "#D1FAE5";
const PISO_STRONG    = "#86EFAC";
const PISO_TEXT      = "#065F46";

const FLAG = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};

// ───────────────────── Helpers ─────────────────────
// F6.1 · 2026-05-21 — bandKind ahora distingue NEUTRAL.
// Antes: cualquier banda no-techo/no-piso caía a "VIGENTE" → en la vista
// "Todas las bandas" el sistema pintaba 10 bandas amarillas (todas
// menos #1 y #12), lo cual es semánticamente incorrecto. Solo UNA banda
// es VIGENTE en cada momento: la que estaba activa según el TC al
// momento del save (event.banda_vigente_id).
function bandKind(banda, vigenteId) {
  if (banda?.techo) return "TECHO";
  if (banda?.piso)  return "PISO";
  if (Number.isFinite(Number(vigenteId)) && Number(banda?.id) === Number(vigenteId)) {
    return "VIGENTE";
  }
  return "NEUTRAL";
}

// Plazos efectivos para una banda dada — tolerante a snapshots viejos.
//   1) Si hay customPlazos[banda] válido → usa esos (mismo shape que el motor).
//   2) Si NO hay customPlazos pero la matriz tiene claves de plazo,
//      DERIVA los plazos desde las claves reales calculando el factor
//      relativo al plazo "base" (el de 90d si existe, sino el mayor).
//   3) Fallback: defaults del motor [90, 60, 30, 8].
function effectivePlazos(bandaId, customPlazos, matrixRow) {
  const cp = customPlazos && customPlazos[String(bandaId)];
  if (Array.isArray(cp) && cp.length > 0) {
    return getBandPlazos(bandaId, customPlazos);
  }
  const row = matrixRow || {};
  const keys = Object.keys(row)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (keys.length > 0) {
    keys.sort((a, b) => b - a);
    const baseDay  = keys.includes(90) ? 90 : keys[0];
    const baseVal  = Number(row[String(baseDay)] ?? row[baseDay]);
    if (Number.isFinite(baseVal) && baseVal > 0) {
      return keys.map((d) => {
        const v = Number(row[String(d)] ?? row[d]);
        const factor = Number.isFinite(v) ? v / baseVal : 1;
        const pct    = (factor - 1) * 100;
        let sub;
        if (d === baseDay)               sub = "base";
        else if (Math.abs(pct) < 0.005)  sub = "base";
        else                              sub = (pct > 0 ? "+" : "−") + Math.abs(pct).toFixed(2) + "%";
        return { dias: d, factor, sub };
      });
    }
    // No podemos derivar factor (precios inválidos) — listar plazos sin sub.
    return keys.map((d) => ({ dias: d, factor: 1, sub: "" }));
  }
  return getBandPlazos(bandaId, null);
}
function bandColors(kind) {
  if (kind === "TECHO")   return { bg: TECHO_BG,   strong: TECHO_STRONG,   text: TECHO_TEXT };
  if (kind === "PISO")    return { bg: PISO_BG,    strong: PISO_STRONG,    text: PISO_TEXT };
  if (kind === "VIGENTE") return { bg: VIGENTE_BG, strong: VIGENTE_STRONG, text: VIGENTE_TEXT };
  // NEUTRAL — bandas del medio que no estaban vigentes al momento del save.
  // Look subdued: fondo de superficie, borde sutil, texto secundario.
  return {
    bg:     'var(--surface, #FFFFFF)',
    strong: 'var(--border-subtle, #E5E7EB)',
    text:   'var(--text-secondary, #64748B)',
  };
}

// Reconstruye el "input" del SKU a partir del snapshot guardado.
// Útil para llamar anchorPrice() y derivar base/ajuste/sobreprecio en el header.
function snapshotToInput(sku) {
  return {
    brl:         Number(sku.brl_override ?? 0),
    com:         Number(sku.com_pct ?? 0),
    ajuste:      Number(sku.ajuste_usd ?? 0),
    sobreprecio: Number(sku.sobreprecio_pct ?? 0),
  };
}

// Saneamiento defensivo: si un endpoint devuelve JSONB como string
// (caso raw cursor sin adapter psycopg2 JSONB), parsea a objeto.
// Si ya es objeto, lo devuelve tal cual. Vacío en errores.
function safeObj(v) {
  if (v == null) return {};
  if (typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return {};
}

// ═══════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════
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
  const brandsById = useMemo(() => {
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
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
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
              <th>SKUs</th>
              <th>Vigencia</th>
              <th style={{ width:30 }}/>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding:24, textAlign:'center', color:'var(--text-tertiary)' }}>
                Cargando…
              </td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={6} style={{ padding:40, textAlign:'center', color:'var(--text-tertiary)' }}>
                <IconHistory size={22} style={{ color:'var(--text-tertiary)', marginBottom:6 }}/>
                <div className="heading-md">Sin historial</div>
                <div className="caption">Ajusta los filtros o esperá a que el motor de precios guarde una simulación.</div>
              </td></tr>
            ) : events.map((e) => {
              const vigencia = e.fecha_inicio || e.fecha_fin
                ? `${e.fecha_inicio || '—'} → ${e.fecha_fin || 'indef.'}`
                : '—';
              // F6.1 · Lista comma-separated de SKUs (en lugar de count).
              // El backend siempre devuelve `skus: []` (puede estar vacío
              // si el snapshot no tiene hijas). Fallback a sku_count si el
              // server viejo aún no envía la lista.
              const skuList = Array.isArray(e.skus) ? e.skus : [];
              const skuLabel = skuList.length > 0
                ? skuList.join(', ')
                : (e.sku_count > 0 ? String(e.sku_count) : '—');
              return (
                <tr key={e.id} className="row-clickable" onClick={() => setDetailId(e.id)}
                    style={{ cursor:'pointer' }}>
                  <td className="tabular-nums">{fmtDate(e.snapshot_at)}</td>
                  <td>{brandsById[e.brand_id] || '—'}</td>
                  <td style={{ fontWeight:600 }}>
                    {e.cliente?.razon_social || e.cliente?.nombre_comercial || '—'}
                  </td>
                  <td className="tabular-nums" style={{
                    font:'500 12px/1.3 var(--font-mono, ui-monospace)',
                    color:'var(--text-primary)',
                    maxWidth:360, wordBreak:'break-word',
                  }}>
                    {skuLabel}
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

// ═══════════════════════════════════════════════════════════════════
// DRAWER
// ═══════════════════════════════════════════════════════════════════
function DetailDrawer({ data, loading, brandName, onClose }) {
  const fmtDateTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CR', { hour12:false }); }
    catch { return iso; }
  };
  const flag = FLAG[(data?.event?.cliente?.pais_iso2 || '').toUpperCase()] || '🌐';
  // F6.1 · 2026-05-21 — banda que estaba vigente al momento del save.
  // Si el snapshot es viejo (pre-D4) el backend devuelve null y caemos al
  // default conocido: banda 6 (5,00 – 5,20). El visor lo pinta amarillo
  // (VIGENTE); el resto de las bandas del medio quedan NEUTRAL.
  const vigenteIdRaw = data?.event?.banda_vigente_id;
  const vigenteId = Number.isFinite(Number(vigenteIdRaw)) ? Number(vigenteIdRaw) : 6;
  // Saneamos custom_plazos por si snapshots viejos tienen shape raro
  // (ej. lista plana en vez de { "<bandaId>": [...] }). Sólo aceptamos
  // claves 1..12 y arrays válidos de {dias, factor}.
  const customPlazos = useMemo(() => {
    // safeObj para tolerar JSONB-como-string del backend.
    const raw = safeObj(data?.event?.custom_plazos);
    if (!raw || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const bid = Number(k);
      if (!Number.isFinite(bid) || bid < 1 || bid > 12) continue;
      if (!Array.isArray(v)) continue;
      const clean = v
        .filter((p) => p && Number.isFinite(Number(p.dias)) && Number.isFinite(Number(p.factor)))
        .map((p) => ({ dias: Number(p.dias), factor: Number(p.factor) }));
      if (clean.length > 0) out[String(bid)] = clean;
    }
    return out;
  }, [data?.event?.custom_plazos]);

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(11,30,58,0.45)',
      display:'flex', justifyContent:'flex-end',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width:'min(1180px, 100vw)', height:'100vh',
        background:'var(--surface, #FFFFFF)',
        overflowY:'auto', boxShadow:'-12px 0 32px rgba(11,30,58,0.18)',
      }}>
        <div style={{
          padding:'18px 22px', borderBottom:'1px solid var(--border-subtle, #E5E7EB)',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12,
          position:'sticky', top:0, background:'var(--surface, #FFFFFF)', zIndex:5,
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
              {Object.keys(customPlazos).length > 0 && (
                <div style={{
                  marginBottom:14, padding:'10px 12px',
                  background:'rgba(245,158,11,0.08)',
                  border:'1px solid rgba(245,158,11,0.35)', borderRadius:8,
                  font:'500 11.5px/1.4 var(--font-body)', color:'#92400E',
                }}>
                  Plazos custom: {Object.keys(customPlazos).length} banda(s) con plazos
                  personalizados. Las columnas reflejan ese estado al momento del guardado.
                </div>
              )}
              {data.skus.map((s) => (
                <SkuSnapshotCard key={s.id} sku={s} customPlazos={customPlazos} vigenteId={vigenteId}/>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SKU card — replica visual del motor de precios
// ═══════════════════════════════════════════════════════════════════
function SkuSnapshotCard({ sku, customPlazos, vigenteId }) {
  const [bandFilter,  setBandFilter]  = useState("essentials"); // essentials | all
  const [showSizes,   setShowSizes]   = useState(false);
  // Saneamiento defensivo — los JSONB pueden llegar como strings si el
  // backend lee con raw cursor sin adapter psycopg2 registrado.
  const sizesPricing  = safeObj(sku.sizes_pricing);
  const matrix        = safeObj(sku.prices_matrix);
  const rawAnchor     = safeObj(sku.anchor);
  const sizeOverrideCount = Object.keys(sizesPricing).length;

  const input  = snapshotToInput(sku);
  // Ancla efectiva: snapshot → si no hay, fallback al techo 90d (default histórico).
  const anchor = Number.isFinite(Number(rawAnchor.bandaId))
    ? { bandaId: Number(rawAnchor.bandaId), plazoDias: Number(rawAnchor.plazoDias) }
    : { bandaId: 1, plazoDias: 90 };
  const anclaBanda  = BANDAS_MARLUVAS.find((b) => b.id === anchor.bandaId) || BANDAS_MARLUVAS[0];
  const anclaKind   = bandKind(anclaBanda, vigenteId);
  const anclaColors = bandColors(anclaKind);
  // Lista USD: leer de la matriz congelada (fuente de verdad inmutable).
  // Base USD: derivar vía anchorPrice cuando hay BRL (snapshot completo);
  // si no hay BRL_override, se deriva indirectamente de la lista quitando
  // ajuste y sobreprecio cuando es posible (no perfecto, pero útil).
  const matrixLista = Number(matrix?.[String(anchor.bandaId)]?.[String(anchor.plazoDias)]);
  const hasBrl  = Number.isFinite(input.brl) && input.brl > 0;
  const derived = hasBrl ? anchorPrice(input, anchor) : null;
  const listaUSD = Number.isFinite(matrixLista) ? matrixLista
                  : (derived ? derived.lista : NaN);
  const baseUSD  = derived ? derived.base
                  : (Number.isFinite(matrixLista)
                      ? (matrixLista - input.ajuste) / (1 + input.sobreprecio)
                      : NaN);

  // Determinar bandas a mostrar.
  // "essentials" = TECHO + VIGENTE + PISO + cualquier banda con
  //                custom_plazos + la banda anclada (si no está ya).
  const allBandIdsInMatrix = Object.keys(matrix)
    .map((k) => Number(k))
    .filter((n) => !Number.isNaN(n));
  const essentialIds = new Set();
  for (const b of BANDAS_MARLUVAS) {
    if (b.techo || b.piso) essentialIds.add(b.id);
  }
  // Banda vigente "default" = banda 6 (5,00–5,20) si está en la matriz.
  if (allBandIdsInMatrix.includes(6)) essentialIds.add(6);
  // Bandas con custom_plazos
  for (const k of Object.keys(customPlazos || {})) {
    const n = Number(k);
    if (Number.isFinite(n)) essentialIds.add(n);
  }
  essentialIds.add(anchor.bandaId);

  const visibleBandIds = bandFilter === "all"
    ? allBandIdsInMatrix.length > 0
        ? allBandIdsInMatrix.sort((a,b) => a-b)
        : BANDAS_MARLUVAS.map((b) => b.id)
    : [...essentialIds].filter((id) => allBandIdsInMatrix.length === 0 || allBandIdsInMatrix.includes(id))
        .sort((a,b) => a-b);

  return (
    <div style={{
      marginBottom:14, padding:'14px 16px',
      background:'var(--surface, #FFFFFF)',
      border:'1px solid var(--border-subtle, #E5E7EB)',
      borderRadius:10,
    }}>
      {/* Header del SKU (estilo motor) */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                    gap:14, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ font:'700 15px/1.2 var(--font-display)', color:'var(--text-primary)' }}>
            SKU {sku.sku}
          </div>
          {!sku.activo && <span style={{
            padding:'2px 7px', borderRadius:10,
            background:'rgba(100,116,139,0.15)', color:'var(--text-tertiary)',
            font:'700 9px/1 var(--font-body)', textTransform:'uppercase',
          }}>Inactivo</span>}
          {/* Ancla badge — con tipo de banda y rango */}
          <span style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'4px 9px', borderRadius:10,
            background:anclaColors.bg, color:anclaColors.text,
            border:`1px solid ${anclaColors.strong}`,
            font:'700 10px/1 var(--font-body)', textTransform:'uppercase',
            letterSpacing:0.4,
          }}>
            Ancla · #{anchor.bandaId} · {anchor.plazoDias}d · {anclaKind}
          </span>
        </div>

        {/* KPIs derivados del snapshot */}
        <div style={{ display:'flex', gap:14, flexWrap:'wrap',
                      fontVariantNumeric:'tabular-nums',
                      font:'500 11px/1.3 var(--font-body)', color:'var(--text-secondary)' }}>
          {hasBrl && <KpiInline label="BRL"               value={input.brl.toFixed(2)}/>}
          <KpiInline label="COM %"        value={`${input.com.toFixed(2)}%`}/>
          {Number.isFinite(baseUSD)  && <KpiInline label="BASE USD"  value={fmtUSD(baseUSD)}  accent={anclaColors.text}/>}
          <KpiInline label="AJUSTE $"     value={fmtUSD(input.ajuste)}/>
          <KpiInline label="SOBREPRECIO"  value={fmtPct(input.sobreprecio)}/>
          {Number.isFinite(listaUSD) && <KpiInline label="LISTA USD" value={fmtUSD(listaUSD)} accent={anclaColors.text}/>}
        </div>
      </div>

      {/* Toggle Esenciales | Todas */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                    marginBottom:8, gap:10 }}>
        <div style={{ font:'700 10.5px/1 var(--font-body)', color:'var(--text-secondary)',
                      textTransform:'uppercase', letterSpacing:0.5 }}>
          Matriz de precios · USD por par
        </div>
        <div style={{ display:'inline-flex', gap:0,
                      border:'1px solid var(--border-subtle, #E5E7EB)', borderRadius:6,
                      overflow:'hidden' }}>
          {["essentials","all"].map((mode) => (
            <button key={mode}
              onClick={() => setBandFilter(mode)}
              style={{
                padding:'5px 12px', border:'none', cursor:'pointer',
                background: bandFilter === mode ? 'var(--surface-alt, #F1F5F9)' : 'transparent',
                color:      bandFilter === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                font:       '600 10.5px/1.2 var(--font-body)',
              }}>
              {mode === "essentials" ? "Esenciales" : "Todas las bandas"}
            </button>
          ))}
        </div>
      </div>

      {/* Matriz banda × plazo */}
      <MatrixView
        matrix={matrix}
        bandIds={visibleBandIds}
        customPlazos={customPlazos}
        anchor={anchor}
        vigenteId={vigenteId}
      />

      {/* Tallas */}
      {sizeOverrideCount > 0 && (
        <div style={{ marginTop:12 }}>
          <button onClick={() => setShowSizes((v) => !v)} style={{
            display:'inline-flex', alignItems:'center', gap:6,
            background:'transparent', border:'1px solid var(--border-subtle, #E5E7EB)',
            borderRadius:6, padding:'6px 10px', cursor:'pointer',
            font:'600 11px/1.2 var(--font-body)', color:'var(--text-primary)',
          }}>
            {showSizes ? <IconChevDown size={12}/> : <IconChevRight size={12}/>}
            Tallas con override ({sizeOverrideCount})
          </button>
          {showSizes && (
            <SizesBreakdown
              sku={sku}
              sizesPricing={sizesPricing}
              customPlazos={customPlazos}
              fallbackAnchor={anchor}
              vigenteId={vigenteId}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MatrixView — renderiza una tabla agrupada por banda × plazo
// Replica el layout del motor: header de banda con rango/÷div/tipo,
// luego una fila de plazos con sub-label, luego los precios.
// ═══════════════════════════════════════════════════════════════════
function MatrixView({ matrix, bandIds, customPlazos, anchor, vigenteId }) {
  if (!bandIds || bandIds.length === 0) {
    return <div style={{
      padding:14, font:'500 11px/1.3 var(--font-body)', color:'var(--text-tertiary)',
      fontStyle:'italic', border:'1px dashed var(--border-subtle, #E5E7EB)', borderRadius:6,
    }}>Sin matriz persistida en este snapshot.</div>;
  }

  return (
    <div style={{ overflowX:'auto', border:'1px solid var(--border-subtle, #E5E7EB)',
                  borderRadius:8 }}>
      {/* Header banda */}
      <div style={{ display:'flex', alignItems:'stretch' }}>
        {bandIds.map((bid) => {
          const banda = BANDAS_MARLUVAS.find((b) => b.id === bid);
          if (!banda) return null;
          const kind = bandKind(banda, vigenteId);
          const colors = bandColors(kind);
          const row    = matrix[String(bid)] || matrix[bid] || {};
          const plazos = effectivePlazos(bid, customPlazos, row);
          return (
            <div key={`h-${bid}`} style={{
              flex:`${plazos.length} 0 ${plazos.length * 76}px`,
              padding:'8px 8px 6px',
              background: colors.bg,
              borderRight:'1px solid var(--border-subtle, #E5E7EB)',
              borderBottom:`2px solid ${colors.strong}`,
              textAlign:'center',
            }}>
              <div style={{ font:'700 11.5px/1.2 var(--font-display)',
                            color:'var(--text-primary)' }}>
                {banda.rango}
              </div>
              <div style={{ font:'500 10px/1.2 var(--font-mono, ui-monospace)',
                            color:'var(--text-secondary)' }}>
                ÷{banda.div.toFixed(2)}
              </div>
              <div style={{ font:'700 9px/1 var(--font-body)',
                            color: colors.text, letterSpacing:0.5,
                            textTransform:'uppercase', marginTop:2 }}>
                {kind}
              </div>
            </div>
          );
        })}
      </div>
      {/* Header plazos (sub) */}
      <div style={{ display:'flex', alignItems:'stretch',
                    background:'var(--surface-alt, #F8FAFC)' }}>
        {bandIds.map((bid) => {
          const row    = matrix[String(bid)] || matrix[bid] || {};
          const plazos = effectivePlazos(bid, customPlazos, row);
          return (
            <div key={`p-${bid}`} style={{
              flex:`${plazos.length} 0 ${plazos.length * 76}px`,
              display:'grid',
              gridTemplateColumns:`repeat(${plazos.length}, 1fr)`,
              borderRight:'1px solid var(--border-subtle, #E5E7EB)',
            }}>
              {plazos.map((p) => {
                const isAnchorCell = bid === anchor.bandaId && p.dias === anchor.plazoDias;
                return (
                  <div key={p.dias} style={{
                    padding:'6px 4px',
                    borderRight:'1px solid var(--border-subtle, #F1F5F9)',
                    textAlign:'center',
                    background: isAnchorCell ? 'rgba(0,178,134,0.08)' : 'transparent',
                  }}>
                    <div style={{ font:'700 10.5px/1 var(--font-body)',
                                  color:'var(--text-primary)' }}>
                      {p.dias}d
                    </div>
                    <div style={{ font:'500 9.5px/1.2 var(--font-mono, ui-monospace)',
                                  color:'var(--text-tertiary)', marginTop:2 }}>
                      {p.sub}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Fila de precios. Lookup tolerante: prueba String e int keys; si la
          celda no está, intenta derivarla desde el plazo base de la banda
          (precio_base × factor_plazo) — útil para snapshots viejos que
          guardaron grilla incompleta. */}
      <div style={{ display:'flex', alignItems:'stretch' }}>
        {bandIds.map((bid) => {
          // Lookup tolerante por bandaId (string o int).
          const row = matrix[String(bid)] || matrix[bid] || {};
          const plazos = effectivePlazos(bid, customPlazos, row);
          // Precio base de la banda — el plazo cuyo factor = 1.0 ("base").
          const basePlazo = plazos.find((pp) => Math.abs(pp.factor - 1) < 0.0001);
          const baseDays  = basePlazo ? String(basePlazo.dias) : null;
          const basePrice = baseDays != null
            ? Number(row[baseDays] ?? row[Number(baseDays)])
            : NaN;
          return (
            <div key={`v-${bid}`} style={{
              flex:`${plazos.length} 0 ${plazos.length * 76}px`,
              display:'grid',
              gridTemplateColumns:`repeat(${plazos.length}, 1fr)`,
              borderRight:'1px solid var(--border-subtle, #E5E7EB)',
            }}>
              {plazos.map((p) => {
                const dKey  = String(p.dias);
                const raw   = row[dKey] ?? row[Number(dKey)];
                let val     = Number(raw);
                let derived = false;
                if (!Number.isFinite(val) && Number.isFinite(basePrice)) {
                  // Derivar desde el base de la banda usando el factor del plazo.
                  val = basePrice * p.factor;
                  derived = true;
                }
                const ok  = Number.isFinite(val);
                const isAnchorCell = bid === anchor.bandaId && p.dias === anchor.plazoDias;
                return (
                  <div key={p.dias}
                    title={derived ? `Derivado desde base ${baseDays}d (snapshot viejo sin esta celda).` : undefined}
                    style={{
                      padding:'10px 4px',
                      borderRight:'1px solid var(--border-subtle, #F1F5F9)',
                      textAlign:'center',
                      background: isAnchorCell ? 'rgba(0,178,134,0.06)' : 'transparent',
                      fontVariantNumeric:'tabular-nums',
                      font:`${isAnchorCell ? 700 : 600} 12.5px/1.2 var(--font-mono, ui-monospace)`,
                      color: !ok ? 'var(--text-tertiary)'
                            : derived ? 'var(--text-secondary)'
                            : 'var(--text-primary)',
                      fontStyle: derived ? 'italic' : 'normal',
                    }}>
                    {ok ? val.toFixed(2) : '—'}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SizesBreakdown — cards por talla (estilo SkuSizesPanel del motor)
// ═══════════════════════════════════════════════════════════════════
function SizesBreakdown({ sku, sizesPricing, customPlazos, fallbackAnchor, vigenteId }) {
  const { tallas } = useSkuTallas(sku.sku, true);
  const tallasByUuid = useMemo(() => {
    const m = {};
    for (const t of (tallas || [])) m[String(t.uuid)] = t;
    return m;
  }, [tallas]);

  const tallaUuids = Object.keys(sizesPricing || {});

  return (
    <div style={{ marginTop:10, padding:'12px',
                  background:'var(--surface-alt, #F8FAFC)',
                  border:'1px solid var(--border-subtle, #E5E7EB)',
                  borderRadius:8 }}>
      {tallaUuids.length === 0 ? (
        <div style={{ font:'500 11px/1.3 var(--font-body)',
                      color:'var(--text-tertiary)' }}>
          Sin overrides por talla en este snapshot.
        </div>
      ) : tallaUuids.map((uuid) => {
        const data       = safeObj(sizesPricing[uuid]);
        const tallaMeta  = tallasByUuid[uuid];
        const sizeMatrix = safeObj(data.matrix);
        const sizeAnchorRaw = safeObj(data.anchor);
        const sizeAnchor = Number.isFinite(Number(sizeAnchorRaw.bandaId))
          ? { bandaId: Number(sizeAnchorRaw.bandaId), plazoDias: Number(sizeAnchorRaw.plazoDias) }
          : fallbackAnchor;

        // Filtrar bandas visibles — usar las bandas que existen en la matriz de la talla
        const idsInMatrix = Object.keys(sizeMatrix)
          .map((k) => Number(k)).filter((n) => !Number.isNaN(n));
        const visible = idsInMatrix.length > 0
          ? idsInMatrix.sort((a,b) => a-b)
          : BANDAS_MARLUVAS.filter((b) => b.techo || b.piso || b.id === 6).map((b) => b.id);

        return (
          <div key={uuid} style={{
            marginBottom:10, padding:'10px 12px',
            background:'var(--surface, #FFFFFF)',
            border:'1px solid var(--border-subtle, #E5E7EB)',
            borderRadius:6,
          }}>
            <div style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', marginBottom:8, gap:10, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ font:'700 12.5px/1.2 var(--font-display)',
                              color:'var(--text-primary)' }}>
                  Talla {tallaMeta?.label || uuid.slice(0, 6)}
                </div>
                {tallaMeta?.tipo && (
                  <span style={{
                    padding:'2px 7px', borderRadius:10,
                    background:'rgba(0,178,134,0.10)', color:'#065F46',
                    font:'700 9px/1 var(--font-body)', textTransform:'uppercase',
                  }}>{tallaMeta.tipo}</span>
                )}
              </div>
              <div style={{
                padding:'2px 8px', borderRadius:10,
                background:'rgba(245,158,11,0.12)', color:'#92400E',
                font:'700 9px/1 var(--font-body)', textTransform:'uppercase',
              }}>
                Override · Ancla #{sizeAnchor.bandaId} · {sizeAnchor.plazoDias}d
              </div>
            </div>
            <MatrixView
              matrix={sizeMatrix}
              bandIds={visible}
              customPlazos={customPlazos}
              anchor={sizeAnchor}
              vigenteId={vigenteId}
            />
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────── Sub-componentes ─────────────────────
function KpiInline({ label, value, accent }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:1, minWidth:54 }}>
      <div style={{ font:'700 8.5px/1 var(--font-body)', color:'var(--text-tertiary)',
                    textTransform:'uppercase', letterSpacing:0.5 }}>{label}</div>
      <div style={{ font:'700 12.5px/1.1 var(--font-mono, ui-monospace)',
                    color: accent || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

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
