// =====================================================================
// MWT.ONE · Sidebar.jsx
// App shell — navegación lateral.
//
// Este componente escucha el viewport efectivo (ADMIN|CLIENT) desde
// RoleContext y filtra dinámicamente los items visibles:
//
//   - ADMIN  → ve los 15 módulos (Dashboard, Expedientes, Pipeline,
//              Portal, Financiero, Transferencias, Nodos, Clientes,
//              Marcas, Productos, Proveedores, Inventario, Templates,
//              Historial de Notif., Cobros).
//
//   - CLIENT → ve SOLO los módulos en CLIENT_ALLOWED_MODULES:
//              Dashboard y Expedientes ("Mis Pedidos").
//              Todos los demás quedan ocultos.
//
// El filtrado usa `canSeeModule(key)` del RoleContext para que la
// whitelist sea una fuente única de verdad (ver POL_VISIBILIDAD).
//
// Re-render instantáneo: como RoleContext actualiza cuando cambia el
// override del Tweaks, el Sidebar re-renderiza automáticamente sin
// necesidad de refrescar la página.
// =====================================================================
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { tr } from "../../lib/i18n.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useRole } from "../../context/RoleContext.jsx";
import {
  IconHome, IconFolder, IconKanban, IconBuilding, IconDollar, IconSwap,
  IconNetwork, IconUsers, IconTag, IconBoxes, IconTruck, IconWarehouse,
  IconMail, IconHistory, IconCreditCard, IconChevLeft, IconChevRight,
  IconBot,
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
  'ai-hub':    '/ai',
  'ai-chat':   '/ai',
  'ai-governance': '/ai/governance',
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
  if (pathname.startsWith('/ai/governance')) return 'ai-governance';
  if (pathname.startsWith('/ai')) return 'ai-hub';
  return 'dashboard';
}

export { KEY_TO_PATH, screenFromPath };

export function Sidebar({ collapsed, onToggleCollapse, lang }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roleName, role: backendRoleName } = useAuth();
  const { isClient, canSeeModule, role: viewportRole } = useRole();
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
  // En modo CLIENT, el badge del footer muestra "Cliente B2B" en vez del rol real.
  // Esto refuerza al staff interno que está previsualizando (y si de verdad es
  // un cliente, es fiel a lo que ve).
  const displayRole = isClient
    ? tr(lang, 'role_client_b2b') || 'Cliente B2B'
    : (roleName || backendRoleName || "—");

  // ───────────────────────────────── CATÁLOGO COMPLETO ─────────────────
  // El título del módulo "expedientes" cambia según viewport:
  //   ADMIN  → "Expedientes"
  //   CLIENT → "Mis Pedidos"  (lenguaje de cliente, no de ops)
  const expedientesLabel = isClient
    ? (tr(lang, 'my_orders') || 'Mis Pedidos')
    : tr(lang, 'expedientes');

  const allItems = [
    { key: 'dashboard',      icon: <IconHome/>,       label: tr(lang,'dashboard'),     group: 'core' },
    { key: 'expedientes',    icon: <IconFolder/>,     label: expedientesLabel,         group: 'core', counter: isClient ? null : 32 },
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
    { key: 'ai-hub',         icon: <IconBot/>,        label: tr(lang,'ai_hub') || 'AI Hub', group: 'ai' },
  ];

  // ───────────────────────────────── FILTRO POR ROL ────────────────────
  // Fuente de verdad: CLIENT_ALLOWED_MODULES (RoleContext).
  // ADMIN → todo; CLIENT → solo los keys whitelisteados.
  const items = allItems.filter(it => canSeeModule(it.key));

  const groups = [
    { key: 'core',          label: '' },
    { key: 'financiero',    label: tr(lang,'financiero') },
    { key: 'structure',     label: tr(lang,'structure') },
    { key: 'notifications', label: tr(lang,'notifications') },
    { key: 'ai',            label: tr(lang,'ai_hub') || 'AI Hub' },
  ];

  return (
    <aside className="sidebar" data-viewport={viewportRole} aria-label="Main navigation">
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
          // Items de este grupo que pasaron el filtro de rol.
          const gItems = items.filter(i => i.group === g.key);
          // Si el grupo queda vacío (p.ej. CLIENT oculta todo "financiero"),
          // no renderizamos ni el label del grupo ni un div fantasma.
          if (gItems.length === 0) return null;
          return (
            <div key={g.key} className="sidebar-group">
              {g.label && <div className="sidebar-group-label">{g.label}</div>}
              <AnimatePresence initial={false} mode="popLayout">
                {gItems.map(it => (
                  <motion.button
                    key={it.key}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                    className="sidebar-item"
                    data-active={
                      currentScreen === it.key
                      || (it.key === 'expedientes' && (currentScreen === 'expediente-detail' || currentScreen === 'oc-detail'))
                      || (it.key === 'pagos' && currentScreen === 'pagos')
                    }
                    onClick={() => onNavigate(it.key)}
                    title={collapsed ? it.label : undefined}
                  >
                    <span className="sidebar-item-icon">{React.cloneElement(it.icon,{size:18})}</span>
                    <span className="sidebar-item-label">{it.label}</span>
                    {it.counter != null && <span className="sidebar-counter">{it.counter}</span>}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user" title={displayName}>
          <div className="avatar" data-viewport={viewportRole}>{initials}</div>
          <div className="sidebar-user-meta">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-role">{displayRole}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
