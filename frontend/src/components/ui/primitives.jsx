// Shared UI primitives
import React from "react";
import { tr, fmtMoney, fmtShortDate } from "../../lib/i18n.js";
import { IconCheck } from "../../lib/icons.jsx";

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
  return <Badge kind={map[status] || 'neutral'} dot>{tr(lang, status)}</Badge>;
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
export function StateTimeline({ currentStatus, lang='es', dates={} }) {
  const order = ['REGISTRO','PRODUCCION','PREPARACION','DESPACHO','TRANSITO','EN_DESTINO','CERRADO'];
  const currentIdx = order.indexOf(currentStatus);
  const progressPct = currentIdx >= 0 ? (currentIdx / (order.length - 1)) * 100 : 0;
  return (
    <div className="state-timeline">
      <div className="state-line"><div className="fill" style={{ width: progressPct + '%' }} /></div>
      {order.map((s, i) => {
        const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'future';
        return (
          <div key={s} className="state-step" data-status={status}>
            <div className="state-dot">{status === 'done' && <IconCheck size={10} />}</div>
            <div className="state-label">{tr(lang, s)}</div>
            <div className="state-sub">{dates[s] ? fmtShortDate(dates[s], lang) : ''}</div>
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
