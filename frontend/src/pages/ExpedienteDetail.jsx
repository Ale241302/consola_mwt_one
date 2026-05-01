// Expediente detail — the hero screen
import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { tr, fmtMoney, fmtMoneyDetail, fmtDate, relativeTime } from "../lib/i18n.js";
import { expedientesApi, clientesApi, marcasApi, lineasApi, productosApi } from "../lib/api.js";
import {
  Badge, StatusBadge, Progress, StateTimeline, CreditBar, CountryFlag,
} from "../components/ui/primitives.jsx";
import { ArtifactsBoard } from "../components/ArtifactsBoard.jsx";
import BuilderArtifactsBoard from "../components/expedientes/builderArtifacts/BuilderArtifactsBoard.jsx";
import ArtifactsSummaryCard from "../components/expedientes/builderArtifacts/ArtifactsSummaryCard.jsx";
import DocumentMatchmakerWizard from "../components/expedientes/DocumentMatchmakerWizard.jsx";
import CommercialDataHardStop from "../components/expedientes/CommercialDataHardStop.jsx";
import {
  IconChevLeft, IconMapPin, IconShip, IconPlane, IconPackage, IconClock,
  IconArrow, IconDollar, IconPlus, IconPaperclip, IconMail, IconMore,
  IconSettings, IconUpload, IconCheck, IconFileText, IconDownload,
  IconEye, IconLock, IconGlobe, IconSparkle, IconX,
} from "../lib/icons.jsx";
import {
  EXPEDIENTES, CLIENTS, BRANDS, OCS, HERO_ID, HERO_LINES, HERO_COSTS,
  HERO_PAGOS, HERO_ARTIFACTS, HERO_ACTIVITY,
} from "../data/mockData.js";
import { useRole } from "../context/RoleContext.jsx";

export default function ScreenExpedienteDetail() {
  const navigate = useNavigate();
  const { expedienteId: paramExpId } = useParams();
  const { lang } = useOutletContext();
  const expedienteId = paramExpId || HERO_ID;
  const onBack = () => navigate(-1);
  const onNavigate = (key) => {
    const map = {
      dashboard: '/dashboard', expedientes: '/expedientes', pipeline: '/pipeline',
      portal: '/portal', pagos: '/financiero', inventario: '/inventario',
    };
    if (map[key]) navigate(map[key]);
  };

  // ── Datos: mocks (HERO) o fetch real desde API ─────────────────
  // El expediente recién creado por el wizard simplificado vive en BD,
  // no en EXPEDIENTES (mock). Hacemos fetch al API; mientras carga,
  // usamos el mock fallback solo si el id coincide con HERO_ID.
  const isHeroOrMock = EXPEDIENTES.some(e => e.id === expedienteId);
  const [apiExp,    setApiExp]    = useState(null);
  const [apiClient, setApiClient] = useState(null);
  const [apiBrand,  setApiBrand]  = useState(null);
  const [apiLines,  setApiLines]  = useState([]);
  // Sprint 2026-05-01: mapa { producto_id -> precio } para fallback de
  // unit_price cuando la linea del expediente tiene precio 0. La fuente
  // es el catalogo de productos (especificaciones.client_prices[client]
  // || precio_lista). Mismo enfoque que OCDetail.jsx.
  const [cpaPriceMap, setCpaPriceMap] = useState({});
  const [loading,   setLoading]   = useState(!isHeroOrMock);
  const [notFound,  setNotFound]  = useState(false);

  useEffect(() => {
    if (isHeroOrMock || expedienteId === HERO_ID) return;
    let cancel = false;
    setLoading(true); setNotFound(false);
    expedientesApi.get(expedienteId)
      .then(async (e) => {
        if (cancel) return;
        setApiExp(e);
        // Hidratar cliente y marca en paralelo (best-effort).
        // OJO: para listar las líneas usamos `e.id` (UUID canónico), no el
        // `expedienteId` del URL — éste puede ser el codigo legible
        // (EXP-2026-0001) y el filtro del backend espera UUID.
        const [cli, br, ln] = await Promise.all([
          e.client_id ? clientesApi.get(e.client_id).catch(() => null) : Promise.resolve(null),
          e.brand_id  ? marcasApi.get(e.brand_id).catch(() => null)    : Promise.resolve(null),
          lineasApi.list({ expediente: e.id }).catch(() => ({ results: [] })),
        ]);
        if (cancel) return;
        setApiClient(cli);
        setApiBrand(br);
        const lineasArr = Array.isArray(ln) ? ln : (ln?.results || []);
        setApiLines(lineasArr);

        // Sprint 2026-05-01: cuando la linea trae unit_price=0 (caso
        // comun en wizard simplificado), fetcheamos los productos para
        // leer el precio del catalogo. Mismo enfoque que OCDetail.jsx.
        if (e.client_id && lineasArr.length > 0) {
          const uniquePidIds = Array.from(new Set(
            lineasArr.map(l => l.producto_id).filter(Boolean)
          ));
          if (uniquePidIds.length > 0) {
            try {
              const prods = await Promise.all(
                uniquePidIds.map(pid => productosApi.get(pid).catch(() => null))
              );
              if (cancel) return;
              const map = {};
              for (const p of prods) {
                if (!p?.id) continue;
                const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
                const override = Number(cliMap[e.client_id] || 0);
                const lista    = Number(p.precio_lista || 0);
                map[p.id] = override > 0 ? override : lista;
              }
              setCpaPriceMap(map);
            } catch { /* swallow */ }
          }
        }
      })
      .catch(() => { if (!cancel) setNotFound(true); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [expedienteId, isHeroOrMock]);

  // Mapper: API → shape esperado por el UI viejo (mock-shape).
  // ⚠ NO hacemos spread de mockExp — eso filtraba defaults seed (CIF/SEA/
  // FCL, "Lote invierno 2026...", fechas falsas, etc.). Construimos el
  // objeto con defaults vacíos explícitos. DetailRow se encarga de
  // mostrar "—" cuando llegan vacíos.
  const mockExp = EXPEDIENTES.find(e => e.id === expedienteId) || EXPEDIENTES[2];
  const exp = apiExp ? {
    id:               apiExp.id,
    ref:              apiExp.codigo,
    codigo:           apiExp.codigo,
    estado:           apiExp.estado,
    status:           (apiExp.estado || "").toLowerCase() || "registro",
    client_id:        apiExp.client_id,
    brand_id:         apiExp.brand_id,
    oc_id:            apiExp.oc_id,
    oc_client:        apiExp.oc_id || "",
    proforma:         apiExp.proforma || "",
    sap:              apiExp.sap || "",
    modo_operacion:   apiExp.modo_operacion || "",
    // Aliases para compat con el UI mock (lee `exp.mode` / `exp.currency`)
    mode:             apiExp.modo_operacion || "",
    currency:         apiExp.moneda || "",
    moneda:           apiExp.moneda || "",
    origin:           apiExp.origin || "",
    destination:      apiExp.destination || "",
    origin_country:   apiExp.origin_country || "",
    destination_country: apiExp.destination_country || "",
    freight_mode:     apiExp.freight_mode || "",
    dispatch_mode:    apiExp.dispatch_mode || "",
    incoterm:         apiExp.incoterm || "",
    eta:              apiExp.eta || null,
    shipment_date:    apiExp.shipment_date || null,
    total_cost:       Number(apiExp.total_cost || 0),
    total_invoiced:   Number(apiExp.total_invoiced || 0),
    total_paid:       Number(apiExp.total_paid || 0),
    balance:          Number(apiExp.balance || 0),
    container_count:  apiExp.container_count || 0,
    product_count:    apiLines.length || 0,
    is_blocked:       !!apiExp.is_blocked,
    block_reason:     apiExp.block_reason || "",
    phase_signal:     apiExp.phase_signal || "green",
    is_active:        apiExp.is_active !== false,
    // Notas: el modelo guarda `notas` (string), el UI lee `exp.notes`.
    notas:            apiExp.notas || "",
    notes:            apiExp.notas || "",
    created_at:       apiExp.created_at || null,
    updated_at:       apiExp.updated_at || null,
    last_event_at:    apiExp.last_event_at || apiExp.updated_at || null,
    // Campos descriptivos hidratados de cliente/marca:
    client:           apiClient?.razon_social || apiClient?.nombre || apiClient?.codigo || "",
    client_country:   apiClient?.pais_iso2 || "",
    brand:            apiBrand?.nombre || apiBrand?.brand_code || "",
  } : mockExp;

  // Mapear cliente API → shape esperado por el UI mock-based.
  // El UI legacy lee `client.name`, `client.code`, `client.country`, etc.
  // El API devuelve `razon_social`, `codigo`, `pais_iso2`. Si no hay
  // apiClient (ruta hero o no resolvió), caemos al mock.
  const mockClientFallback = CLIENTS.find(c => c.id === exp.client_id) || CLIENTS[0];
  const client = apiClient ? {
    ...mockClientFallback,
    id:        apiClient.id,
    name:      apiClient.razon_social || apiClient.nombre || apiClient.codigo || "—",
    code:      apiClient.codigo || apiClient.rut || apiClient.id || "",
    country:   apiClient.pais_iso2 || mockClientFallback.country || "",
    rfc:       apiClient.rfc || apiClient.rut || "",
    city:      apiClient.ciudad || mockClientFallback.city || "",
    contact:   apiClient.contacto_nombre || apiClient.contacto_email || mockClientFallback.contact || "",
    email:     apiClient.contacto_email || mockClientFallback.email || "",
  } : mockClientFallback;

  const brand  = apiBrand
              ? { ...BRANDS[0], id: apiBrand.id,
                  name: apiBrand.nombre || apiBrand.brand_code || "—",
                  nombre: apiBrand.nombre,
                  brand_code: apiBrand.brand_code,
                  color: apiBrand.color || BRANDS[0].color }
              : (BRANDS.find(b => b.id === exp.brand_id) || BRANDS[0]);

  // ── Role-aware strip-down ─────────────────────────────────────
  // Si isClient → ocultamos tabs "Costos" y "Actividad" (esta última
  // expone logs internos de state machine), el action bar completo
  // (Avanzar estado, Registrar pago, Registrar costo, Agregar docu,
  // Enviar portal) y el NextActionCard del rail derecho.
  const { isClient } = useRole();
  const [tab, setTab] = useState('overview');
  // Si el rol cambia en caliente y el tab activo ya no es visible al
  // cliente, lo re-anclamos a 'overview' en el próximo render.
  if (isClient && (tab === 'costs' || tab === 'activity')) {
    Promise.resolve().then(() => setTab('overview'));
  }
  const [showAdvance, setShowAdvance] = useState(false);
  const [showCostDrawer, setShowCostDrawer] = useState(false);
  const [showPaymentDrawer, setShowPaymentDrawer] = useState(false);
  // Sprint Document Matchmaker (2026-04-29) — wizard de auditoría IA.
  // Solo CEO/admin puede cruzar documentos contra la BD; el cliente B2B
  // solo visualiza los artefactos publicados.
  const [showMatchmaker, setShowMatchmaker] = useState(false);

  // Only use rich HERO data if this is the hero expediente
  const isHero = exp.id === HERO_ID;
  // Líneas reales desde API si existe el expediente en BD; HERO_LINES
  // solo cuando es el hero mock.
  const lines = isHero ? HERO_LINES : (apiLines.length ? apiLines : []);
  const costs = isHero ? HERO_COSTS : [];
  const pagos = isHero ? HERO_PAGOS : [];
  const artifacts = isHero ? HERO_ARTIFACTS : [];
  const activity = isHero ? HERO_ACTIVITY : [];

  // Loading / not-found para expedientes reales que aún no llegan del API
  // Sprint 2026-05-01: cpaPriceMap ya esta indexado por producto_id en el
  // useEffect arriba. Aqui exponemos un helper que las tablas del expediente
  // usan para heredar precio cuando la linea trae unit_price=0.

  if (loading) {
    return (
      <div className="page" style={{ maxWidth: 1500, padding: 32 }}>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando expediente…" : "Loading file…"}
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="page" style={{ maxWidth: 1500, padding: 32 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}
                style={{ marginBottom: 14 }}>
          <IconChevLeft size={14}/> {lang === "es" ? "Volver" : "Back"}
        </button>
        <div className="card card-pad-lg" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#0B1E3A" }}>
            {lang === "es" ? "Expediente no encontrado" : "File not found"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 6 }}>
            {lang === "es"
              ? `No existe un expediente con id ${expedienteId}.`
              : `No file with id ${expedienteId}.`}
          </div>
        </div>
      </div>
    );
  }

  const dates = isHero ? {
    REGISTRO: '2026-01-14', PRODUCCION: '2026-02-08',
    PREPARACION: '2026-03-01', DESPACHO: '2026-03-18',
    TRANSITO: '2026-03-28',
  } : {};

  return (
    <div className="page" style={{ maxWidth: 1500 }} data-screen-label={`Expediente · ${exp.ref}`}>
      {/* Back + breadcrumb */}
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14, padding: '0 8px 0 4px' }}>
        <IconChevLeft size={14}/> {tr(lang,'back_to_oc')}
      </button>

      {/* Hero header */}
      <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          padding: '22px 28px 24px',
          background: `linear-gradient(180deg, var(--brand-primary) 0%, var(--brand-primary-dark) 100%)`,
          color: '#fff',
        }}>
          <div className="flex ai-center gap-3" style={{ marginBottom: 10 }}>
            <span className="mono" style={{ color: 'var(--brand-accent)', fontWeight: 700, fontSize: 13 }}>{exp.ref}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ opacity: 0.75, fontSize: 13 }}>{exp.oc_client}</span>
            {exp.sap && <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span style={{ opacity: 0.75, fontSize: 13 }}>{exp.sap}</span>
            </>}
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ opacity: 0.75, fontSize: 13 }}>{exp.proforma}</span>
            {exp.is_blocked && (
              <span style={{ marginLeft: 'auto' }}>
                <Badge kind="critical" dot>{lang==='es' ? 'BLOQUEADO · Crédito' : 'BLOCKED · Credit'}</Badge>
              </span>
            )}
          </div>
          <div className="flex ai-center gap-3" style={{ flexWrap: 'wrap' }}>
            <h1 style={{ font: '800 26px/1.15 var(--font-display)', letterSpacing: '-0.02em' }}>
              {exp.client}
            </h1>
            <CountryFlag country={exp.client_country}/>
            <span style={{ opacity:0.85 }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: 0.92 }}>
              <span style={{ width:8, height:8, background: brand.color, borderRadius: 2 }}/>
              {exp.brand}
            </span>
          </div>
          <div className="flex ai-center gap-4" style={{ marginTop: 14, flexWrap: 'wrap', fontSize: 13, opacity: 0.86 }}>
            <span className="flex ai-center gap-2"><IconMapPin size={13}/>{exp.origin} → {exp.destination}</span>
            <span className="flex ai-center gap-2">{exp.freight_mode === 'SEA' ? <IconShip size={13}/> : <IconPlane size={13}/>}{exp.mode} · {exp.freight_mode} · {exp.dispatch_mode}</span>
            <span className="flex ai-center gap-2"><IconPackage size={13}/>{exp.container_count} {lang==='es' ? 'contenedores' : 'containers'} · {exp.product_count} {lang==='es' ? 'SKUs' : 'SKUs'}</span>
            <span className="flex ai-center gap-2"><IconClock size={13}/>ETA {fmtDate(exp.eta, lang)}</span>
          </div>
        </div>

        {/* State timeline strip */}
        <div style={{ padding: '8px 24px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}>
          <StateTimeline currentStatus={exp.status} lang={lang} dates={dates}/>
        </div>

        {/* Action bar — SOLO ADMIN. CLIENT B2B es read-only:
            sin Avanzar estado, sin Registrar pago/costo, sin Agregar
            documento ni Enviar al portal. En su lugar mostramos una
            píldora "Vista de solo lectura" para que el cliente entienda
            que está viendo un tracking public de su orden. */}
        {!isClient && (
          <div className="flex ai-center jc-between" style={{ padding: '12px 24px', background: 'var(--bg-alt)' }}>
            <div className="flex gap-2">
              <button className="btn btn-accent" onClick={() => setShowAdvance(true)}>
                <IconArrow size={14}/> {tr(lang,'advance_state')}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowPaymentDrawer(true)}>
                <IconDollar size={14}/> {tr(lang,'register_payment')}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowCostDrawer(true)}>
                <IconPlus size={14}/> {tr(lang,'add_cost')}
              </button>
              <button className="btn btn-ghost"><IconPaperclip size={14}/>{tr(lang,'add_document')}</button>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm"><IconMail size={13}/>{lang==='es' ? 'Enviar portal' : 'Send portal'}</button>
              <button className="icon-btn" style={{ width: 32, height: 32 }}><IconMore size={15}/></button>
            </div>
          </div>
        )}
        {isClient && (
          <div
            className="flex ai-center"
            style={{ padding: '10px 24px', background: 'var(--bg-alt)', gap: 10 }}
          >
            <span
              style={{
                display:'inline-flex', alignItems:'center', gap:6,
                fontSize:12, fontWeight:500,
                color:'var(--text-tertiary, #64748B)',
                padding:'5px 12px', borderRadius:6,
                background:'rgba(0,0,0,0.04)',
              }}
            >
              <IconLock size={12}/>
              {lang==='es'
                ? 'Seguimiento de orden — vista de solo lectura'
                : 'Order tracking — read-only view'}
            </span>
          </div>
        )}
      </div>

      {/* Body: main col + right rail */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div>
          {/* Tabs. Para CLIENT B2B escondemos:
                · 'costs'     → composición interna de costos (CEO-ONLY)
                · 'activity'  → logs de state machine (INTERNAL)
              El cliente sólo ve: resumen, productos, documentos, pagos. */}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {[
              ['overview', tr(lang,'tab_overview'), null,                true],
              ['lines',    tr(lang,'tab_lines'),    lines.length,        true],
              ['artifacts',tr(lang,'tab_artifacts'),artifacts.length,    true],
              ['costs',    tr(lang,'tab_costs'),    costs.length,        !isClient],
              ['payments', tr(lang,'tab_payments'), pagos.length,        true],
              ['activity', tr(lang,'tab_activity'), activity.length,     !isClient],
            ].filter(([,,,visible]) => visible).map(([k,l,c]) => (
              <button key={k} className="tab" data-active={tab===k} onClick={() => setTab(k)}>
                {l}{c != null && <span className="count">{c}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview'  && (
            <>
              {/* Hard stop de datos comerciales — bloquea T2 si faltan
                  modo_operacion/brand_id/moneda. Auto-oculta si todo OK. */}
              {!isClient && <CommercialDataHardStop expediente={exp} lang={lang}
                                                    onSaved={() => navigate(0)}/>}
              <OverviewTab exp={exp} lang={lang} lines={lines}
                           activity={activity} isClient={isClient}
                           isHeroOrMock={isHeroOrMock}
                           cpaPriceMap={cpaPriceMap}
                           onOpenArtifactsTab={() => setTab('artifacts')}/>
            </>
          )}
          {tab === 'lines'     && <LinesTab lines={lines} lang={lang} cpaPriceMap={cpaPriceMap}/>}
          {tab === 'artifacts' && (
            <div>
              {/* Toolbar de artifacts: solo visible para CEO/admin.
                  El botón "Auditar documento con IA" abre el wizard
                  Document Matchmaker (cruce IA gpt-5-nano vs BD). */}
              {!isClient && (
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: 14, padding: "10px 14px", borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(72,30,227,0.05), rgba(0,178,134,0.04))",
                  border: "1px solid rgba(72,30,227,0.18)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <IconSparkle size={14} style={{ color: "#481EE3" }}/>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#0B1E3A" }}>
                        {lang === "es"
                          ? "Auditoría documental con IA"
                          : "AI Document Audit"}
                      </div>
                      <div className="caption" style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                        {lang === "es"
                          ? "Sube OC / Proforma / Confirmación SAP y cruza contra la BD con gpt-5-nano."
                          : "Upload PO / Proforma / SAP confirmation and cross-check the DB with gpt-5-nano."}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMatchmaker(true)}
                    className="btn btn-accent"
                    style={{
                      fontWeight: 700, background: "#481EE3", borderColor: "#481EE3",
                      letterSpacing: 0.3,
                    }}>
                    <IconUpload size={12}/>{" "}
                    {lang === "es" ? "Auditar documento" : "Audit document"}
                  </button>
                </div>
              )}
              {/* Sprint 2026-05-01: el board legacy mock-only se reemplaza
                  por el nuevo board dinámico que consume:
                    · Builder externo (templates) vía /api/builder/templates/
                    · Backend Consola (instancias) vía
                      /api/expedientes/{id}/artifacts/
                  Se mantiene el legacy <ArtifactsBoard> SÓLO para el HERO
                  demo (mock data) mientras VITE_USE_MOCKS=1. */}
              {isHeroOrMock ? (
                <ArtifactsBoard expedienteId={exp.id} lang={lang} readOnly={isClient}/>
              ) : (
                <BuilderArtifactsBoard
                  expedienteId={exp.id}
                  currentStage={(exp.estado || "REGISTRO").toUpperCase()}
                  lang={lang}
                  readOnly={isClient}
                />
              )}
            </div>
          )}
          {tab === 'costs'     && !isClient && <CostsTab costs={costs} lang={lang} onAdd={() => setShowCostDrawer(true)}/>}
          {tab === 'payments'  && <PaymentsTab pagos={pagos} lang={lang} exp={exp}
                                               onAdd={isClient ? null : () => setShowPaymentDrawer(true)}
                                               readOnly={isClient}/>}
          {tab === 'activity'  && !isClient && <ActivityTab activity={activity} lang={lang}/>}
        </div>

        {/* Right rail.
            NextActionCard es CEO-ONLY — expone "próximas acciones del
            pipeline" (available_transitions) que es info operativa interna.
            Para CLIENT lo reemplazamos por un tracking summary público. */}
        <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>
          <ClientCard client={client} exp={exp} lang={lang}/>
          {!isClient && <FinancialCard exp={exp} lang={lang}/>}
          {!isClient && <NextActionCard exp={exp} lang={lang} onAdvance={() => setShowAdvance(true)}/>}
          {isClient && <TrackingSummaryCard exp={exp} lang={lang}/>}
        </div>
      </div>

      {showAdvance     && <AdvanceStateModal exp={exp} lang={lang} onClose={() => setShowAdvance(false)}/>}
      {showCostDrawer  && <CostDrawer lang={lang} exp={exp} onClose={() => setShowCostDrawer(false)}/>}
      {showPaymentDrawer && <PaymentDrawer lang={lang} exp={exp} onClose={() => setShowPaymentDrawer(false)}/>}
      {showMatchmaker && (
        <DocumentMatchmakerWizard
          expedienteId={exp.id}
          lang={lang}
          onClose={() => setShowMatchmaker(false)}
          onApplied={() => {
            // Después de aplicar resoluciones, refrescar la página para
            // que las líneas del expediente reflejen los cambios.
            // navigate(0) hace un soft-reload manteniendo el JWT.
            setTimeout(() => navigate(0), 800);
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({ exp, lang, lines, activity, isHeroOrMock, onOpenArtifactsTab, cpaPriceMap }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>
      {/* Sprint 2026-05-01: el card "Detalles" mostraba modo/flete/ETA/
          contenedores/origen/destino que viven en los artefactos del
          expediente. Lo reemplazamos por un resumen real del board de
          artefactos. Mantenemos el legacy SOLO para HERO mock. */}
      {isHeroOrMock ? (
        <div className="card">
          <div className="card-head">
            <div className="card-title">{tr(lang,'details')}</div>
            <button className="btn btn-ghost btn-sm"><IconSettings size={13}/>{tr(lang,'edit')}</button>
          </div>
          <div className="card-pad-lg grid col-3 gap-6">
            <DetailRow label={tr(lang,'mode')} value={exp.mode}/>
            <DetailRow label={tr(lang,'freight')} value={exp.freight_mode}/>
            <DetailRow label={tr(lang,'dispatch')} value={exp.dispatch_mode}/>
            <DetailRow label={tr(lang,'shipment_date')} value={fmtDate(exp.shipment_date, lang)}/>
            <DetailRow label={tr(lang,'eta')} value={fmtDate(exp.eta, lang)}/>
            <DetailRow label={tr(lang,'containers')} value={`${exp.container_count}`}/>
            <DetailRow label={tr(lang,'origin')} value={exp.origin}/>
            <DetailRow label={tr(lang,'destination')} value={exp.destination}/>
            <DetailRow label={tr(lang,'products')} value={`${exp.product_count} SKUs`}/>
            <DetailRow label={tr(lang,'created')} value={fmtDate(exp.created_at, lang)}/>
            <DetailRow label={tr(lang,'updated')} value={relativeTime(exp.last_event_at, lang)}/>
            <DetailRow label={lang==='es'?'Moneda':'Currency'} value={exp.currency}/>
          </div>
        </div>
      ) : (
        <ArtifactsSummaryCard
          expedienteId={exp.id}
          currentStage={(exp.estado || "REGISTRO").toUpperCase()}
          lang={lang}
          onOpenTab={onOpenArtifactsTab}
        />
      )}

      {exp.notes && (
        <div className="card card-pad-lg">
          <div className="micro" style={{ marginBottom: 6 }}>{lang==='es' ? 'NOTAS INTERNAS' : 'INTERNAL NOTES'}</div>
          <div className="body-md text-sec">{exp.notes}</div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title">{lang==='es' ? 'Productos' : 'Products'}</div>
          <span className="caption">{lines.length} {lang==='es' ? 'líneas' : 'lines'}</span>
        </div>
        <table className="table">
          <thead><tr>
            <th>SKU</th>
            <th>{lang==='es' ? 'Descripción' : 'Description'}</th>
            <th style={{textAlign:'right'}}>{lang==='es' ? 'Cant.' : 'Qty'}</th>
            <th style={{textAlign:'right'}}>{lang==='es' ? 'P. unitario' : 'Unit price'}</th>
            <th style={{textAlign:'right'}}>{lang==='es' ? 'Subtotal' : 'Subtotal'}</th>
            <th style={{textAlign:'right'}}>{lang==='es' ? 'Margen' : 'Margin'}</th>
          </tr></thead>
          <tbody>
            {lines.map(l => {
              // Coerción defensiva: los campos del API llegan como strings
              // (Decimal serializado). Sin Number(), `qty * unit_price` hace
              // string concat y `(margin*100)` es NaN%.
              const qty   = Number(l.qty || 0);
              let unit    = Number(l.unit_price || 0);
              // Fallback: cuando la linea trae unit_price=0 leemos el
              // precio del catalogo de productos (cpaPriceMap),
              // indexado por producto_id. Mismo enfoque que OCDetail.
              if (unit === 0 && cpaPriceMap && l.producto_id) {
                const fb = Number(cpaPriceMap[l.producto_id] || 0);
                if (fb > 0) unit = fb;
              }
              const sub   = Number(l.total_price && Number(l.total_price) > 0
                                    ? l.total_price
                                    : qty * unit);
              const margin = Number(l.margin ?? 0);
              return (
                <tr key={l.id}>
                  <td><span className="mono-sm" style={{fontWeight:600, color:'var(--interactive)'}}>{l.sku}</span></td>
                  <td>{l.name || l.product_label || l.descripcion || ''}</td>
                  <td className="td-num tabular">{qty}</td>
                  <td className="td-money">{fmtMoneyDetail(unit)}</td>
                  <td className="td-money">{fmtMoney(sub)}</td>
                  <td className="td-num">
                    {margin > 0
                      ? <Badge kind="mint">{(margin*100).toFixed(1)}%</Badge>
                      : <span className="caption" style={{color:'var(--text-tertiary)'}}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">{tr(lang,'recent_activity')}</div>
          <button className="btn btn-ghost btn-sm">{tr(lang,'view_all')}</button>
        </div>
        <div style={{ padding: 16 }}>
          <ActivityList items={activity.slice(0,4)} lang={lang}/>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  // Tratar como vacío: null, undefined, "", "—" → mostrar guion gris
  // para que la UI no quede con "undefined" o textos falsos.
  const isEmpty = value == null || value === "" || value === "—";
  return (
    <div>
      <div className="micro" style={{ marginBottom: 4 }}>{label}</div>
      <div className="body-md text-prim" style={{ fontWeight: 500 }}>
        {isEmpty
          ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
          : value}
      </div>
    </div>
  );
}

function LinesTab({ lines, lang, cpaPriceMap }) {
  // Sprint 2026-05-01: total con fallback al catalogo de productos
  const total = lines.reduce((a, l) => {
    let unit = Number(l.unit_price || 0);
    if (unit === 0 && cpaPriceMap && l.producto_id) {
      const fb = Number(cpaPriceMap[l.producto_id] || 0);
      if (fb > 0) unit = fb;
    }
    return a + Number(l.qty || 0) * unit;
  }, 0);
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Productos del expediente' : 'File products'}</div>
        <button className="btn btn-ghost btn-sm"><IconPlus size={13}/>{lang==='es' ? 'Agregar línea' : 'Add line'}</button>
      </div>
      <table className="table">
        <thead><tr>
          <th>SKU</th>
          <th>{lang==='es' ? 'Descripción' : 'Description'}</th>
          <th>{lang==='es' ? 'Contenedor' : 'Container'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Cant.' : 'Qty'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Costo unit.' : 'Unit cost'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Precio unit.' : 'Unit price'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Subtotal' : 'Subtotal'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Margen' : 'Margin'}</th>
        </tr></thead>
        <tbody>
          {lines.map(l => {
            // Fallback al catalogo de productos si la linea trae 0
            let _unit = Number(l.unit_price || 0);
            let _total = Number(l.total_price || 0);
            if (_unit === 0 && cpaPriceMap && l.producto_id) {
              const fb = Number(cpaPriceMap[l.producto_id] || 0);
              if (fb > 0) _unit = fb;
            }
            const _qty = Number(l.qty || 0);
            if (_total === 0) _total = _qty * _unit;
            return (
            <tr key={l.id}>
              <td><span className="mono-sm" style={{ fontWeight: 600, color:'var(--interactive)' }}>{l.sku}</span></td>
              <td>{l.name}</td>
              <td className="mono-sm text-sec">{l.container}</td>
              <td className="td-num tabular">{l.qty}</td>
              <td className="td-money text-sec">{fmtMoneyDetail(Number(l.unit_cost || 0))}</td>
              <td className="td-money">{fmtMoneyDetail(_unit)}</td>
              <td className="td-money">{fmtMoney(_total)}</td>
              <td className="td-num">{Number(l.margin || 0) > 0
                ? <Badge kind="mint">{(Number(l.margin)*100).toFixed(1)}%</Badge>
                : <span className="caption" style={{color:'var(--text-tertiary)'}}>—</span>}</td>
            </tr>
          );})}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} style={{ padding: 14, textAlign:'right', fontWeight: 600, color:'var(--text-tertiary)', textTransform:'uppercase', fontSize: 11, letterSpacing: '0.08em' }}>
              {lang==='es' ? 'Total' : 'Total'}
            </td>
            <td className="td-money" style={{ padding: 14, fontSize: 15, fontFamily: 'var(--font-mono)' }}>{fmtMoney(total)}</td>
            <td/>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ArtifactsTab({ artifacts, lang }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Documentos del expediente' : 'File documents'}</div>
        <button className="btn btn-primary btn-sm"><IconUpload size={13}/>{tr(lang,'upload')}</button>
      </div>
      <div style={{ padding: 12 }}>
        {artifacts.map(a => {
          const icon = { issued:<IconCheck size={14}/>, pending:<IconClock size={14}/>, future:<IconFileText size={14}/> }[a.status];
          const color = { issued:'var(--success)', pending:'var(--warning)', future:'var(--text-tertiary)' }[a.status];
          const bg = { issued:'var(--success-bg)', pending:'var(--warning-bg)', future:'var(--bg-alt)' }[a.status];
          return (
            <div key={a.id} style={{ display:'flex', gap:12, alignItems:'center', padding:'12px 12px', borderBottom:'1px solid var(--divider)' }}>
              <div style={{ width:36, height:36, background: bg, color, borderRadius: 8, display:'grid', placeItems:'center', flexShrink:0 }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex ai-center gap-2">
                  <span className="heading-sm" style={{ color:'var(--text-primary)' }}>{a.kind}</span>
                  {a.code && <span className="mono-sm text-ter">· {a.code}</span>}
                </div>
                <div className="caption" style={{ marginTop: 2 }}>
                  {a.status === 'issued' && `${tr(lang,'doc_status_issued')} · ${fmtDate(a.date, lang)} · ${a.author}`}
                  {a.status === 'pending' && (lang==='es' ? 'Esperando emisión del proveedor' : 'Awaiting supplier issuance')}
                  {a.status === 'future' && (lang==='es' ? 'Se emitirá al arribar a destino' : 'Will be issued on arrival')}
                </div>
              </div>
              <Badge kind={a.status==='issued'?'success':a.status==='pending'?'warning':'neutral'}>{tr(lang,'doc_status_'+a.status)}</Badge>
              {a.status === 'issued' ? (
                <button className="btn btn-ghost btn-sm"><IconDownload size={13}/>PDF</button>
              ) : a.status === 'pending' ? (
                <button className="btn btn-secondary btn-sm"><IconUpload size={13}/>{tr(lang,'upload')}</button>
              ) : <button className="btn btn-ghost btn-sm" disabled>—</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostsTab({ costs, lang, onAdd }) {
  const total = costs.reduce((a,c) => a+c.amount, 0);
  const clientVisible = costs.filter(c=>c.visibility==='CLIENT').reduce((a,c)=>a+c.amount,0);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{lang==='es' ? 'Costos del expediente' : 'File costs'}</div>
          <div className="card-subtitle">{fmtMoney(total)} {lang==='es' ? 'total' : 'total'} · {fmtMoney(clientVisible)} {lang==='es' ? 'visibles al cliente' : 'client visible'}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}><IconPlus size={13}/>{tr(lang,'add_cost')}</button>
      </div>
      <table className="table">
        <thead><tr>
          <th>{lang==='es' ? 'Fecha' : 'Date'}</th>
          <th>{tr(lang,'cost_type')}</th>
          <th>{tr(lang,'supplier')}</th>
          <th>{lang==='es' ? 'Doc.' : 'Doc.'}</th>
          <th>{tr(lang,'visibility')}</th>
          <th style={{textAlign:'right'}}>{tr(lang,'amount')}</th>
        </tr></thead>
        <tbody>
          {costs.map(c => (
            <tr key={c.id}>
              <td className="text-sec">{fmtDate(c.date, lang)}</td>
              <td style={{fontWeight:500}}>{c.type}</td>
              <td>{c.supplier}</td>
              <td><span className="mono-sm text-ter">{c.doc}</span></td>
              <td>
                {c.visibility === 'CLIENT'
                  ? <Badge kind="mint"><IconEye size={10}/> {tr(lang,'client_visible')}</Badge>
                  : <Badge kind="outline"><IconLock size={10}/> {tr(lang,'internal_only')}</Badge>}
              </td>
              <td className="td-money">{fmtMoney(c.amount, c.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTab({ pagos, lang, exp, onAdd, readOnly = false }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>
      <div className="card card-pad-lg">
        <div className="flex ai-center jc-between mb-3">
          <div className="heading-md">{tr(lang,'payment_progress')}</div>
          <span className="mono tabular" style={{fontSize:13}}>{fmtMoney(exp.total_paid)} / {fmtMoney(exp.total_invoiced)}</span>
        </div>
        <Progress value={exp.total_paid/exp.total_invoiced*100} variant="success"/>
        <div className="grid col-3 gap-4 mt-6">
          <KV label={tr(lang,'total_invoiced_lbl')} value={fmtMoney(exp.total_invoiced)}/>
          <KV label={tr(lang,'paid_lbl')} value={fmtMoney(exp.total_paid)} good/>
          <KV label={tr(lang,'balance')} value={fmtMoney(exp.balance)} warning/>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div className="card-title">{lang==='es' ? 'Pagos registrados' : 'Registered payments'}</div>
          {!readOnly && onAdd && (
            <button className="btn btn-primary btn-sm" onClick={onAdd}><IconPlus size={13}/>{tr(lang,'register_payment')}</button>
          )}
        </div>
        <table className="table">
          <thead><tr>
            <th>{lang==='es' ? 'Fecha' : 'Date'}</th>
            <th>{tr(lang,'payment_method')}</th>
            <th>{tr(lang,'reference')}</th>
            <th>{tr(lang,'apply_to')}</th>
            <th style={{textAlign:'right'}}>{tr(lang,'amount')}</th>
            <th>{tr(lang,'status')}</th>
          </tr></thead>
          <tbody>
            {pagos.map(p => (
              <tr key={p.id}>
                <td className="text-sec">{fmtDate(p.date, lang)}</td>
                <td>{p.method}</td>
                <td><span className="mono-sm" style={{fontWeight:600}}>{p.ref}</span></td>
                <td className="text-sec">{p.applied_to}</td>
                <td className="td-money">{fmtMoney(p.amount)}</td>
                <td><Badge kind="success" dot>{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityTab({ activity, lang }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{tr(lang,'tab_activity')}</div>
      </div>
      <div style={{ padding: 18 }}>
        <ActivityList items={activity} lang={lang}/>
      </div>
    </div>
  );
}

function ActivityList({ items, lang }) {
  return (
    <div style={{ position:'relative' }}>
      <div style={{ position:'absolute', left: 13, top: 10, bottom: 10, width: 2, background: 'var(--divider)' }}/>
      {items.map((ev, i) => (
        <div key={ev.id} style={{ display:'flex', gap: 14, paddingBottom: 14, position:'relative' }}>
          <div style={{
            width: 28, height: 28, borderRadius:'50%',
            background: 'var(--surface)', border: '2px solid var(--brand-accent)',
            display:'grid', placeItems:'center', flexShrink:0, zIndex:1,
            color:'var(--brand-accent-dark,#0E8A6D)',
          }}>
            <IconSparkle size={12}/>
          </div>
          <div style={{ flex:1 }}>
            <div className="flex ai-center gap-2">
              <span className="heading-sm" style={{ color:'var(--text-primary)' }}>{ev.what}</span>
              <span className="caption">· {ev.who}</span>
              <span className="caption" style={{ marginLeft:'auto' }}>{relativeTime(ev.t, lang)}</span>
            </div>
            <div className="body-sm text-sec" style={{ marginTop:3 }}>{ev.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function KV({ label, value, good, warning }) {
  return (
    <div>
      <div className="micro" style={{ marginBottom: 4 }}>{label}</div>
      <div className="tabular" style={{
        font: '700 18px/1.1 var(--font-mono)',
        color: good ? 'var(--success)' : warning ? 'var(--warning)' : 'var(--text-primary)',
      }}>{value}</div>
    </div>
  );
}

// Right rail cards
function ClientCard({ client, exp, lang }) {
  return (
    <div className="card card-pad-lg">
      <div className="flex ai-center gap-3 mb-4">
        <div className="avatar" style={{ width: 40, height: 40, fontSize: 14, background:'var(--brand-primary)', color:'#fff' }}>
          {(client?.name || "?").split(' ').map(s=>s[0]).slice(0,2).join('')}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div className="heading-md truncate">{client.name}</div>
          <div className="caption flex ai-center gap-2"><CountryFlag country={client.country}/>{client.country} · {client.contact}</div>
        </div>
        <button className="icon-btn" style={{ width:30, height:30 }}><IconMore size={14}/></button>
      </div>
      <div style={{ display:'grid', gap: 8, fontSize: 13 }}>
        <div className="flex ai-center gap-2 text-sec"><IconMail size={13}/>{client.email}</div>
        <div className="flex ai-center gap-2 text-sec"><IconGlobe size={13}/>{client.phone}</div>
      </div>
      <div style={{ borderTop: '1px solid var(--divider)', marginTop: 14, paddingTop: 14 }}>
        <div className="flex ai-center jc-between mb-2">
          <div className="micro">{lang==='es' ? 'LÍMITE DE CRÉDITO' : 'CREDIT LIMIT'}</div>
          <Badge kind={client.band==='GREEN'?'success':client.band==='AMBER'?'warning':'critical'} dot>{client.band}</Badge>
        </div>
        <CreditBar limit={client.credit_limit} used={client.credit_used}/>
      </div>
    </div>
  );
}

function FinancialCard({ exp, lang }) {
  const paidPct = exp.total_invoiced > 0 ? (exp.total_paid / exp.total_invoiced * 100) : 0;
  // Guard NaN: si total_invoiced es 0 (expediente recién creado), margin
  // queda como (negativo/0) = -Infinity o NaN, y .toFixed() devuelve
  // "NaN" que se ve feo. En ese caso forzamos 0%.
  const margin = exp.total_invoiced > 0
    ? ((exp.total_invoiced - exp.total_cost) / exp.total_invoiced * 100)
    : 0;
  return (
    <div className="card card-pad-lg">
      <div className="heading-md mb-4">{tr(lang,'cost_summary')}</div>
      <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>
        <MiniMetric label={tr(lang,'total_cost')}      value={fmtMoney(exp.total_cost)}      sub={lang==='es'?'suma de costos':'sum of costs'}/>
        <MiniMetric label={tr(lang,'total_invoiced_lbl')} value={fmtMoney(exp.total_invoiced)} sub={lang==='es'?'a cliente':'to client'}/>
        <div>
          <div className="flex ai-center jc-between mb-2">
            <span className="micro">{tr(lang,'paid_lbl')}</span>
            <span className="tabular" style={{ font:'600 12px/1 var(--font-mono)'}}>{paidPct.toFixed(0)}%</span>
          </div>
          <Progress value={paidPct} variant="success"/>
          <div className="flex ai-center jc-between mt-2">
            <span className="caption">{fmtMoney(exp.total_paid)}</span>
            <span className="caption">{fmtMoney(exp.balance)} {lang==='es'?'pendiente':'balance'}</span>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
          <div className="flex ai-center jc-between">
            <span className="micro">{tr(lang,'margin')}</span>
            <span className="tabular" style={{
              font:'700 17px/1 var(--font-mono)',
              color: margin>15 ? 'var(--success)' : margin>8 ? 'var(--warning)' : 'var(--critical)'
            }}>{margin.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, sub }) {
  return (
    <div>
      <div className="micro" style={{ marginBottom: 3 }}>{label}</div>
      <div className="tabular" style={{ font:'700 17px/1.1 var(--font-mono)' }}>{value}</div>
      {sub && <div className="caption" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function NextActionCard({ exp, lang, onAdvance }) {
  const next = {
    REGISTRO: 'PRODUCCION', PRODUCCION: 'PREPARACION', PREPARACION: 'DESPACHO',
    DESPACHO: 'TRANSITO', TRANSITO: 'EN_DESTINO', EN_DESTINO: 'CERRADO',
  }[exp.status];
  return (
    <div className="card card-pad-lg" style={{ background: 'linear-gradient(135deg, var(--brand-accent-soft), var(--brand-ice-soft))', border: '1px solid color-mix(in oklab, var(--brand-accent), transparent 70%)' }}>
      <div className="flex ai-center gap-2 mb-3">
        <IconArrow size={15} style={{color:'var(--brand-primary)'}}/>
        <span className="micro" style={{ color:'var(--brand-primary)'}}>{lang==='es' ? 'PRÓXIMA ACCIÓN' : 'NEXT ACTION'}</span>
      </div>
      <div className="heading-md mb-2">
        {lang==='es' ? 'Confirmar arribo y liberación aduanera' : 'Confirm arrival and customs release'}
      </div>
      <div className="body-sm text-sec mb-4">
        {lang==='es'
          ? `Cuando la nave arribe a ${exp.destination}, actualiza el expediente a "${tr(lang,next||'CERRADO')}" para iniciar la secuencia de facturación final.`
          : `When the vessel arrives at ${exp.destination}, advance to "${tr(lang,next||'CERRADO')}" to trigger final invoicing.`}
      </div>
      {next && (
        <button className="btn btn-accent w-full" onClick={onAdvance}>
          <IconArrow size={14}/> {tr(lang,'advance_to')} {tr(lang,next)}
        </button>
      )}
    </div>
  );
}

// Modals / Drawers
function AdvanceStateModal({ exp, lang, onClose }) {
  const order = ['REGISTRO','PRODUCCION','PREPARACION','DESPACHO','TRANSITO','EN_DESTINO','CERRADO'];
  const idx = order.indexOf(exp.status);
  const next = order[idx+1];
  return (
    <>
      <div className="overlay" onClick={onClose}/>
      <div className="modal modal-md" role="dialog" aria-modal="true">
        <div className="flex ai-center jc-between" style={{ padding: '18px 22px', borderBottom: '1px solid var(--divider)'}}>
          <div>
            <div className="heading-md">{tr(lang,'advance_state')}</div>
            <div className="caption">{exp.ref} · {exp.client}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={16}/></button>
        </div>
        <div style={{ padding: 22 }}>
          <div className="flex ai-center gap-3 mb-4">
            <StatusBadge status={exp.status} lang={lang}/>
            <IconArrow size={16} style={{color:'var(--text-tertiary)'}}/>
            <StatusBadge status={next} lang={lang}/>
          </div>
          <div className="body-md text-sec mb-4">
            {lang==='es'
              ? 'Confirma que el expediente cumple los requisitos del siguiente estado. Esto notificará al cliente si las notificaciones están activas.'
              : 'Confirm the file meets the next state\'s requirements. This will notify the client if notifications are active.'}
          </div>
          <div className="card card-pad" style={{background: 'var(--bg-alt)'}}>
            <div className="micro mb-2">{lang==='es' ? 'CHECKLIST PARA ' : 'CHECKLIST FOR '}{tr(lang,next)}</div>
            <div style={{display:'flex', flexDirection:'column', gap: 6}}>
              <div className="flex ai-center gap-2" style={{fontSize:13}}><IconCheck size={14} style={{color:'var(--success)'}}/>{lang==='es'?'Bill of Lading preliminar cargado':'Preliminary BL uploaded'}</div>
              <div className="flex ai-center gap-2" style={{fontSize:13}}><IconCheck size={14} style={{color:'var(--success)'}}/>{lang==='es'?'50% de cobro aplicado':'50% payment applied'}</div>
              <div className="flex ai-center gap-2" style={{fontSize:13}}><IconClock size={14} style={{color:'var(--warning)'}}/>{lang==='es'?'Falta confirmación de zarpe':'Missing departure confirmation'}</div>
            </div>
          </div>
          <div className="mt-4">
            <label className="field-label">{lang==='es' ? 'Notas (opcional)' : 'Notes (optional)'}</label>
            <textarea className="textarea" placeholder={lang==='es' ? 'Ej: Nave MSC Leone, contenedores MSCU-7821094, MSCU-4398721...' : 'E.g. MSC Leone vessel, containers MSCU-7821094, MSCU-4398721...'}/>
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--divider)', display:'flex', justifyContent:'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>{tr(lang,'cancel')}</button>
          <button className="btn btn-primary" onClick={onClose}><IconCheck size={14}/>{lang==='es' ? `Avanzar a ${tr(lang,next)}` : `Advance to ${tr(lang,next)}`}</button>
        </div>
      </div>
    </>
  );
}

function CostDrawer({ lang, exp, onClose }) {
  return (
    <>
      <div className="overlay" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="heading-md">{tr(lang,'add_cost')}</div>
            <div className="caption">{exp.ref} · {exp.client}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={16}/></button>
        </div>
        <div className="drawer-body" style={{display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <label className="field-label">{tr(lang,'cost_type')}</label>
            <select className="select">
              <option>Mercadería</option><option>Flete marítimo</option><option>Flete aéreo</option>
              <option>Seguro</option><option>Aduana origen</option><option>Aduana destino</option>
              <option>Transporte interno</option><option>Almacenaje</option><option>Gastos bancarios</option>
            </select>
          </div>
          <div className="grid col-2 gap-4">
            <div>
              <label className="field-label">{tr(lang,'amount')}</label>
              <input className="input" placeholder="0.00" defaultValue="1840.00"/>
            </div>
            <div>
              <label className="field-label">{lang==='es' ? 'Moneda' : 'Currency'}</label>
              <select className="select"><option>USD</option><option>EUR</option><option>CNY</option><option>PEN</option></select>
            </div>
          </div>
          <div className="grid col-2 gap-4">
            <div>
              <label className="field-label">{lang==='es' ? 'Fecha' : 'Date'}</label>
              <input className="input" type="date" defaultValue="2026-03-28"/>
            </div>
            <div>
              <label className="field-label">{lang==='es' ? 'Número de doc.' : 'Doc. number'}</label>
              <input className="input" placeholder="INV-…"/>
            </div>
          </div>
          <div>
            <label className="field-label">{tr(lang,'supplier')}</label>
            <input className="input" placeholder={lang==='es' ? 'Buscar proveedor…' : 'Search supplier…'}/>
          </div>
          <div>
            <label className="field-label">{tr(lang,'visibility')}</label>
            <div className="seg" style={{height:40}}>
              <button data-active="true">{tr(lang,'client_visible')}</button>
              <button>{tr(lang,'internal_only')}</button>
            </div>
            <div className="field-hint">{lang==='es' ? 'Los costos visibles aparecerán en el Portal del cliente.' : 'Visible costs will appear in the client Portal.'}</div>
          </div>
          <div>
            <label className="field-label">{lang==='es' ? 'Adjuntar documento' : 'Attach document'}</label>
            <div className="card card-pad" style={{borderStyle:'dashed', textAlign:'center', color:'var(--text-tertiary)'}}>
              <IconUpload size={20} style={{opacity:0.5}}/>
              <div className="caption" style={{marginTop:6}}>{lang==='es' ? 'Arrastra o haz clic para subir PDF, imagen, XML' : 'Drag or click to upload PDF, image, XML'}</div>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>{tr(lang,'cancel')}</button>
          <button className="btn btn-primary" onClick={onClose}><IconCheck size={14}/>{tr(lang,'save')}</button>
        </div>
      </div>
    </>
  );
}

function PaymentDrawer({ lang, exp, onClose }) {
  return (
    <>
      <div className="overlay" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="heading-md">{tr(lang,'register_payment')}</div>
            <div className="caption">{exp.ref} · {exp.client}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={16}/></button>
        </div>
        <div className="drawer-body" style={{display:'flex',flexDirection:'column',gap:16}}>
          <div className="card card-pad" style={{background:'var(--brand-accent-soft)'}}>
            <div className="flex ai-center jc-between">
              <div>
                <div className="micro">{tr(lang,'balance')}</div>
                <div className="tabular" style={{ font:'700 20px/1 var(--font-mono)', color:'var(--brand-primary)'}}>{fmtMoney(exp.balance)}</div>
              </div>
              <div>
                <div className="micro">{tr(lang,'total_invoiced_lbl')}</div>
                <div className="tabular" style={{ font:'600 14px/1 var(--font-mono)'}}>{fmtMoney(exp.total_invoiced)}</div>
              </div>
            </div>
          </div>
          <div className="grid col-2 gap-4">
            <div>
              <label className="field-label">{tr(lang,'amount')}</label>
              <input className="input" placeholder="0.00" defaultValue={Number(exp.balance || 0).toFixed(2)}/>
            </div>
            <div>
              <label className="field-label">{lang==='es' ? 'Moneda' : 'Currency'}</label>
              <select className="select"><option>USD</option><option>PEN</option></select>
            </div>
          </div>
          <div className="grid col-2 gap-4">
            <div>
              <label className="field-label">{lang==='es' ? 'Fecha' : 'Date'}</label>
              <input className="input" type="date" defaultValue="2026-04-20"/>
            </div>
            <div>
              <label className="field-label">{tr(lang,'payment_method')}</label>
              <select className="select">
                <option>{lang==='es'?'Transferencia':'Wire transfer'}</option>
                <option>{lang==='es'?'Carta de crédito':'Letter of credit'}</option>
                <option>{lang==='es'?'Cobranza documentaria':'Documentary collection'}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">{tr(lang,'reference')}</label>
            <input className="input" placeholder="TRX-…"/>
          </div>
          <div>
            <label className="field-label">{tr(lang,'apply_to')}</label>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {['Proforma PF-0942 · saldo 50%', 'Factura FAC-2026-01842 · 100%'].map((x,i) => (
                <label key={i} className="card card-pad" style={{display:'flex',alignItems:'center',gap:10, cursor:'pointer'}}>
                  <input type="radio" name="apply" defaultChecked={i===0}/>
                  <span className="body-sm">{x}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>{tr(lang,'cancel')}</button>
          <button className="btn btn-primary" onClick={onClose}><IconCheck size={14}/>{tr(lang,'save')}</button>
        </div>
      </div>
    </>
  );
}


// ════════════════════════════════════════════════════════════════════
// TrackingSummaryCard · CLIENT-ONLY (reemplaza NextActionCard)
//
// Muestra al cliente un resumen limpio de tracking: estado público,
// ETA, cobertura de pagos. SIN available_transitions, SIN próximas
// acciones internas, SIN botón "Avanzar".
// ════════════════════════════════════════════════════════════════════
function TrackingSummaryCard({ exp, lang }) {
  // Mapa técnico → público (duplicado mínimo, coherente con backend)
  const STATE_PUBLIC = {
    REGISTRO:    { es: 'Confirmado',     en: 'Confirmed',      step: 0 },
    PRODUCCION:  { es: 'En fabricación', en: 'Manufacturing',  step: 1 },
    PREPARACION: { es: 'Preparación',    en: 'Preparing',      step: 2 },
    DESPACHO:    { es: 'Despachado',     en: 'Dispatched',     step: 3 },
    TRANSITO:    { es: 'En tránsito',    en: 'In transit',     step: 3 },
    EN_DESTINO:  { es: 'En aduana',      en: 'In customs',     step: 4 },
    CERRADO:     { es: 'Listo',          en: 'Ready',          step: 5 },
  };
  const tech = (exp?.status || exp?.estado || '').toUpperCase();
  const map  = STATE_PUBLIC[tech] || { es: tech || '—', en: tech || '—', step: 0 };
  const coverage = (exp?.total_invoiced && exp.total_invoiced > 0)
    ? Math.round((exp.total_paid / exp.total_invoiced) * 100)
    : 0;

  return (
    <div className="card card-pad">
      <div className="heading-md" style={{ marginBottom: 10 }}>
        {lang === 'es' ? 'Seguimiento de orden' : 'Order tracking'}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-tertiary, #64748B)',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
      }}>
        {lang === 'es' ? 'Estado actual' : 'Current status'}
      </div>
      <div style={{
        fontSize: 16, fontWeight: 600,
        color: 'var(--brand-primary, #0B1E3A)',
        marginBottom: 14,
      }}>
        {lang === 'es' ? map.es : map.en}
      </div>

      {/* Paso del pipeline (0..5) como progress bar simple */}
      <div style={{
        height: 8, background: 'var(--surface-soft, #F3F5F8)',
        borderRadius: 999, overflow: 'hidden', marginBottom: 14,
      }}>
        <div style={{
          height: '100%',
          width: `${(map.step / 5) * 100}%`,
          background: 'var(--brand-accent, #00B286)',
          transition: 'width 400ms ease',
        }}/>
      </div>

      {/* ETA + cobertura */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
        <div>
          <div className="micro">ETA</div>
          <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {exp?.eta ? fmtDate(exp.eta, lang) : '—'}
          </div>
        </div>
        <div>
          <div className="micro">{lang === 'es' ? 'Cobertura' : 'Coverage'}</div>
          <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {coverage}%
          </div>
        </div>
      </div>

      <p style={{
        marginTop: 14, fontSize: 11,
        color: 'var(--text-tertiary, #64748B)',
        lineHeight: 1.5,
      }}>
        <IconLock size={11} style={{ verticalAlign: '-2px', marginRight: 4 }}/>
        {lang === 'es'
          ? 'Los documentos oficiales de tu orden aparecen en la pestaña "Documentos". Las cuentas financieras internas y el detalle operativo de costos son confidenciales.'
          : 'Official documents appear in the "Documents" tab. Internal financial accounts and cost details are confidential.'}
      </p>
    </div>
  );
}
