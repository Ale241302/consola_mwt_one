// Shared UI primitives
import React from "react";
import { tr, fmtMoney, fmtShortDate } from "../../lib/i18n.js";
import { IconCheck } from "../../lib/icons.jsx";
import { DISPLAY_STAGES, displayStage } from "../../lib/phaseDisplay.js";

export function Badge({ kind='neutral', children, dot=false, style }) {
  return <span className={`badge badge-${kind}`} style={style}>{dot && <span className="dot" />}{children}</span>;
}

export function StatusBadge({ status, lang='es' }) {
  const map = {
    REGISTRO:    'info',
    PRODUCCION:  'warning',
    PREPARACION: 'warning',
    DESPACHO:    'mint',
    TRANSITO:    'info',
    EN_DESTINO:  'success',
    CERRADO:     'success',
    CANCELADO:   'critical',
  };
  return <Badge kind={map[status] || 'neutral'} dot>{tr(lang, displayStage(status))}</Badge>;
}

export function CreditDot({ band }) {
  const cls = band === 'GREEN' ? 'dot-green' : band === 'AMBER' ? 'dot-amber' : 'dot-red';
  return <span className={`dot-credit ${cls}`} />;
}

export function Progress({ value, max=100, variant='default' }) {
  const pct = Math.max(0, Math.min(100, (value/max)*100));
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={`fill ${variant}`} style={{ width: pct + '%' }} />
    </div>
  );
}

// Inline sparkline SVG
export function Sparkline({ values, color='var(--brand-accent)', height=28, width=120, fill=true }) {
  if (!values?.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1 || 1);
  const points = values.map((v, i) => `${(i*step).toFixed(1)},${(height - ((v-min)/range)*height).toFixed(1)}`).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill && <polygon points={area} fill={color} fillOpacity="0.12" />}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Bar chart (simple)
export function BarChart({ data, accessor='count', labels='status', height=180, color='var(--brand-primary)', secondaryColor='var(--brand-accent)' }) {
  const max = Math.max(...data.map(d => d[accessor])) || 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 10, height, alignItems: 'end' }}>
      {data.map((d, i) => {
        const h = (d[accessor] / max) * (height - 40);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div className="tabular" style={{ font: '700 12px/1 var(--font-mono)', color: 'var(--text-primary)' }}>{d[accessor]}</div>
            <div style={{ width: '70%', height: Math.max(6, h), background: color, borderRadius: '6px 6px 2px 2px', transition: 'height 300ms ease' }} />
            <div style={{ font: '600 10.5px/1 var(--font-body)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>{d[labels]?.toString().slice(0,10)}</div>
          </div>
        );
      })}
    </div>
  );
}

// Dual bar for cash flow
export function DualBar({ data, accessorA, accessorB, labelAccessor, labelA, labelB, height=180, colorA='var(--brand-primary)', colorB='var(--brand-accent)' }) {
  const max = Math.max(...data.flatMap(d => [d[accessorA], d[accessorB]])) || 1;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 14, height, alignItems: 'end' }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'end', justifyContent: 'center', gap: 6, height: '100%' }}>
            <div style={{ width: '30%', height: `${(d[accessorA]/max)*100}%`, background: colorA, borderRadius: '4px 4px 0 0', minHeight: 4 }} title={fmtMoney(d[accessorA])} />
            <div style={{ width: '30%', height: `${(d[accessorB]/max)*100}%`, background: colorB, borderRadius: '4px 4px 0 0', minHeight: 4 }} title={fmtMoney(d[accessorB])} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 14, marginTop: 6 }}>
        {data.map((d,i) => (
          <div key={i} style={{ textAlign: 'center', font: '600 11px/1 var(--font-body)', color: 'var(--text-tertiary)' }}>{d[labelAccessor]}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, font: '500 11px/1 var(--font-body)', color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: colorA, borderRadius: 2 }} />{labelA}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: colorB, borderRadius: 2 }} />{labelB}</span>
      </div>
    </div>
  );
}

// Canonical-state timeline
// Sprint 2026-07-30 · Si se pasa phaseInfo, renderiza los días debajo del
// label de cada fase, alineados con el estado. El click abre el editor de
// fechas cuando canEdit es true o hay datos para ver.
export function StateTimeline({ currentStatus, lang='es', dates={},
                                phaseInfo, canEdit=false, onOpenPhase,
                                transitProgress=null, freightMode=null }) {
  const order = DISPLAY_STAGES;
  const currentDisplay = displayStage(currentStatus);
  const currentIdx = order.indexOf(currentDisplay);
  const progressPct = currentIdx >= 0 ? (currentIdx / (order.length - 1)) * 100 : 0;
  // Fechas de fases técnicas fusionadas: mostrar la entrada a la primera
  // fase técnica del grupo (PREPARACION) como fecha de la fase visual.
  const displayDates = {};
  order.forEach((ds) => {
    if (ds === 'PREPARACION_DESPACHO') {
      displayDates[ds] = dates.PREPARACION || dates.DESPACHO || '';
    } else {
      displayDates[ds] = dates[ds] || '';
    }
  });

  // Barra de progreso temporal de Tránsito (entre Preparación de despacho
  // y Tránsito). Solo visible cuando el estado actual es TRANSITO.
  const transitIdx = order.indexOf('TRANSITO');
  const showTransitProgress = currentStatus === 'TRANSITO' && transitProgress != null && transitIdx >= 0;
  const transitIcon = freightMode === 'SEA' ? '🚢' : freightMode === 'AIR' ? '✈️' : '📦';

  return (
    <div className="state-timeline">
      <div className="state-line"><div className="fill" style={{ width: progressPct + '%' }} /></div>

      {/* Progreso intra-fase de Tránsito */}
      {showTransitProgress && (
        <div style={{
          position: 'absolute',
          top: 25,
          left: `${((transitIdx - 0.5) / order.length) * 100}%`,
          width: `${(1 / order.length) * 100}%`,
          height: 2,
          zIndex: 1,
          pointerEvents: 'none',
        }}>
          {/* Fondo gris del segmento */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'var(--border)',
            borderRadius: 1,
          }} />
          {/* Fill verde proporcional al tiempo transcurrido */}
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${transitProgress}%`,
            background: 'var(--brand-accent)',
            borderRadius: 1,
            transition: 'width 300ms ease',
          }} />
          {/* Ícono de transporte en la posición actual */}
          <div style={{
            position: 'absolute',
            left: `${transitProgress}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 16,
            background: 'var(--surface)',
            borderRadius: '50%',
            padding: '0 3px',
            lineHeight: 1,
          }}>
            {transitIcon}
          </div>
        </div>
      )}

      {order.map((s, i) => {
        const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'future';
        const info = phaseInfo ? (phaseInfo[s] || {}) : {};
        const ov = info.override;
        const has = info.real != null || (ov && ov.days != null);
        const shown = ov && ov.days != null ? ov.days : info.real;
        const clickable = onOpenPhase && (has || info.entry || canEdit);
        return (
          <div key={s} className="state-step" data-status={status}>
            <div className="state-dot">{status === 'done' && <IconCheck size={10} />}</div>
            <div className="state-label">{tr(lang, s)}</div>
            <div className="state-sub">{displayDates[s] ? fmtShortDate(displayDates[s], lang) : ''}</div>
            {phaseInfo && (
              <button
                type="button"
                className={[
                  'state-days', 'tabular-nums',
                  ov ? 'state-days--manual' : '',
                  info.open ? 'state-days--open' : '',
                ].filter(Boolean).join(' ')}
                disabled={!clickable}
                onClick={() => clickable && onOpenPhase(s)}
                title={clickable
                  ? (lang === 'es' ? 'Click para fijar fechas' : 'Click to set dates')
                  : undefined}
              >
                {has ? `${shown}d` : '—'}
                {info.open && <span className="state-days-open">{lang === 'es' ? ' · en curso' : ' · ongoing'}</span>}
                {canEdit && ov && <span className="state-days-edit"> ✎</span>}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Credit bar
export function CreditBar({ limit, used }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const variant = pct > 85 ? 'critical' : pct > 70 ? 'warning' : 'success';
  return (
    <div>
      <Progress value={pct} variant={variant} />
      <div className="flex ai-center jc-between mt-2" style={{ font: 'var(--caption)', color: 'var(--text-tertiary)' }}>
        <span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtMoney(used)}</span> / {fmtMoney(limit)}</span>
        <span className="tabular">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// Segmented control
export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.value} data-active={value===o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CountryFlag({ country }) {
  const map = {
    'Perú':'🇵🇪','Chile':'🇨🇱','Argentina':'🇦🇷','Colombia':'🇨🇴','México':'🇲🇽','Ecuador':'🇪🇨','R. Dominicana':'🇩🇴','Brasil':'🇧🇷',
  };
  return <span style={{ fontSize: 13 }}>{map[country] || '🌎'}</span>;
}
