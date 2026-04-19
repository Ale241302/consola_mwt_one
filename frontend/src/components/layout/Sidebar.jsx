// App shell — sidebar
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { tr } from "../../lib/i18n.js";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  IconHome, IconFolder, IconKanban, IconBuilding, IconDollar, IconSwap,
  IconNetwork, IconUsers, IconTag, IconBoxes, IconTruck, IconWarehouse,
  IconMail, IconHistory, IconCreditCard, IconChevLeft, IconChevRight,
} from "../../lib/icons.jsx";

// key -> route path mapping. Keys mirror the original screen identifiers so that
// the sidebar items and CommandPalette navigate() calls stay in sync.
const KEY_TO_PATH = {
  dashboard:   '/dashboard',
  expedientes: '/expedientes',
  pipeline:    '/pipeline',
  portal:      '/portal',
  pagos:       '/financiero',
  transfers:   '/transferencias',
  nodos:       '/nodos',
  clientes:    '/clientes',
  brands:      '/marcas',
  productos:   '/productos',
  suppliers:   '/proveedores',
  inventario:  '/inventario',
  templates:   '/templates',
  history:     '/notificaciones',
  collections: '/cobros',
  wizard:      '/wizard',
  'oc-detail': '/expedientes',
  'expediente-detail': '/expedientes',
};

// derive currentScreen key from the URL pathname
function screenFromPath(pathname) {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/expedientes/') && pathname.match(/\/expedientes\/[^/]+\/exp\//)) return 'expediente-detail';
  if (pathname.startsWith('/expedientes/')) return 'oc-detail';
  if (pathname === '/expedientes') return 'expedientes';
  if (pathname.startsWith('/pipeline')) return 'pipeline';
  if (pathname.startsWith('/portal')) return 'portal';
  if (pathname.startsWith('/financiero')) return 'pagos';
  if (pathname.startsWith('/transferencias')) return 'transfers';
  if (pathname.startsWith('/nodos')) return 'nodos';
  if (pathname.startsWith('/clientes')) return 'clientes';
  if (pathname.startsWith('/marcas')) return 'brands';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/proveedores')) return 'suppliers';
  if (pathname.startsWith('/inventario')) return 'inventario';
  if (pathname.startsWith('/templates')) return 'templates';
  if (pathname.startsWith('/notificaciones')) return 'history';
  if (pathname.startsWith('/cobros')) return 'collections';
  if (pathname.startsWith('/wizard')) return 'wizard';
  return 'dashboard';
}

export { KEY_TO_PATH, screenFromPath };

export function Sidebar({ collapsed, onToggleCollapse, lang }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roleName, role } = useAuth();
  const currentScreen = screenFromPath(location.pathname);
  const onNavigate = (key) => {
    const path = KEY_TO_PATH[key];
    if (path) navigate(path);
  };

  // Iniciales del usuario para el avatar
  const initials = (user?.full_name || user?.email || "?")
    .split(/[\s.@]/).filter(Boolean).slice(0, 2)
    .map(s => s[0]?.toUpperCase()).join("") || "?";
  const displayName = user?.full_name || user?.email || "—";
  const displayRole = roleName || role || "—";

  const items = [
    { key: 'dashboard',      icon: <IconHome/>,       label: tr(lang,'dashboard'),     group: 'core' },
    { key: 'expedientes',    icon: <IconFolder/>,     label: tr(lang,'expedientes'),   group: 'core', counter: 32 },
    { key: 'pipeline',       icon: <IconKanban/>,     label: tr(lang,'pipeline'),      group: 'core' },
    { key: 'portal',         icon: <IconBuilding/>,   label: tr(lang,'portal'),        group: 'core' },
    { key: 'pagos',          icon: <IconDollar/>,     label: tr(lang,'financiero'),    group: 'financiero' },
    { key: 'transfers',      icon: <IconSwap/>,       label: tr(lang,'transfers'),     group: 'financiero' },
    { key: 'nodos',          icon: <IconNetwork/>,    label: tr(lang,'nodos'),         group: 'structure' },
    { key: 'clientes',       icon: <IconUsers/>,      label: tr(lang,'clientes'),      group: 'structure' },
    { key: 'brands',         icon: <IconTag/>,        label: tr(lang,'brands'),        group: 'structure' },
    { key: 'productos',      icon: <IconBoxes/>,      label: tr(lang,'productos'),     group: 'structure' },
    { key: 'suppliers',      icon: <IconTruck/>,      label: tr(lang,'suppliers'),     group: 'structure' },
    { key: 'inventario',     icon: <IconWarehouse/>,  label: tr(lang,'inventario'),    group: 'structure' },
    { key: 'templates',      icon: <IconMail/>,       label: tr(lang,'templates'),     group: 'notifications' },
    { key: 'history',        icon: <IconHistory/>,    label: tr(lang,'history'),       group: 'notifications' },
    { key: 'collections',    icon: <IconCreditCard/>, label: tr(lang,'collections'),   group: 'notifications' },
  ];
  const groups = [
    { key: 'core',          label: '' },
    { key: 'financiero',    label: tr(lang,'financiero') },
    { key: 'structure',     label: tr(lang,'structure') },
    { key: 'notifications', label: tr(lang,'notifications') },
  ];
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-head">
        <div className="sidebar-logo">
          <img
            src="https://mwt.one/images/2024/12/04/recurso-1logo_foot.png"
            alt="MWT ONE"
            className="sidebar-logo-img"
            onError={(e) => {
              // Fallback a marca "M" si el CDN no responde
              const parent = e.currentTarget.parentElement;
              if (parent) {
                e.currentTarget.remove();
                const mark = document.createElement('div');
                mark.className = 'sidebar-logo-mark';
                mark.textContent = 'M';
                parent.prepend(mark);
              }
            }}
          />
        </div>
        <button className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label="Toggle sidebar">
          {collapsed ? <IconChevRight size={16}/> : <IconChevLeft size={16}/>}
        </button>
      </div>

      <nav className="sidebar-nav">
        {groups.map(g => {
          const gItems = items.filter(i => i.group === g.key);
          return (
            <div key={g.key}>
              {g.label && <div className="sidebar-group-label">{g.label}</div>}
              {gItems.map(it => (
                <button
                  key={it.key}
                  className="sidebar-item"
                  data-active={currentScreen === it.key || (it.key==='expedientes' && currentScreen==='expediente-detail') || (it.key==='pagos' && currentScreen==='pagos')}
                  onClick={() => onNavigate(it.key)}
                  title={collapsed ? it.label : undefined}
                >
                  <span className="sidebar-item-icon">{React.cloneElement(it.icon,{size:18})}</span>
                  <span className="sidebar-item-label">{it.label}</span>
                  {it.counter != null && <span className="sidebar-counter">{it.counter}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user" title={displayName}>
          <div className="avatar">{initials}</div>
          <div className="sidebar-user-meta">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-role">{displayRole}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
