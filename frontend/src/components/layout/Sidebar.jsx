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
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { tr } from "../../lib/i18n.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useRole } from "../../context/RoleContext.jsx";
import { expedientesApi } from "../../lib/api.js";
import {
  IconHome, IconFolder, IconKanban, IconBuilding, IconDollar, IconSwap,
  IconNetwork, IconUsers, IconTag, IconBoxes, IconTruck, IconWarehouse,
  IconMail, IconHistory, IconCreditCard, IconChevLeft, IconChevRight,
  IconBot, IconLock, IconClipboard,
} from "../../lib/icons.jsx";

// key -> route path mapping. Keys mirror the original screen identifiers so that
// the sidebar items and CommandPalette navigate() calls stay in sync.
const KEY_TO_PATH = {
  tickets:     '/tickets',
  dashboard:   '/dashboard',
  expedientes: '/expedientes',
  cronograma:  '/cronograma',  // Sprint 2026-06-10 · Cronograma interactivo
  pipeline:    '/pipeline',
  portal:      '/portal',
  pagos:       '/financiero',
  finanzas:    '/finanzas',  // Sprint 2026-05-24 · Modulo Finanzas CEO-ONLY
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
  // M3 CORE — usuarios y permisos (admin-only)
  usuarios:    '/usuarios',
  roles:       '/roles',
  // F6 · Bitácora histórica
  'price-history': '/historial-precios',
};

// derive currentScreen key from the URL pathname
function screenFromPath(pathname) {
  if (pathname.startsWith('/tickets')) return 'tickets';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  // Fable5-QA 2026-06-11: /cronograma caia al fallback 'dashboard' y la
  // sidebar marcaba Dashboard como activo (mismo bug en /usuarios y /roles).
  if (pathname.startsWith('/cronograma')) return 'cronograma';
  if (pathname.startsWith('/expedientes/') && pathname.match(/\/expedientes\/[^/]+\/exp\//)) return 'expediente-detail';
  if (pathname.startsWith('/expedientes/')) return 'oc-detail';
  if (pathname === '/expedientes') return 'expedientes';
  if (pathname.startsWith('/pipeline')) return 'pipeline';
  if (pathname.startsWith('/portal')) return 'portal';
  if (pathname.startsWith('/financiero')) return 'pagos';
  if (pathname.startsWith('/finanzas')) return 'finanzas';  // Sprint 2026-05-24
  if (pathname.startsWith('/transferencias')) return 'transfers';
  if (pathname.startsWith('/nodos')) return 'nodos';
  if (pathname.startsWith('/clientes')) return 'clientes';
  if (pathname.startsWith('/marcas')) return 'brands';
  // Sub-motores del catálogo de Productos: mantienen 'Productos' activo
  // en la sidebar (antes caían al fallback 'dashboard').
  if (pathname.startsWith('/tallas')) return 'productos';
  if (pathname.startsWith('/ncm')) return 'productos';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/proveedores')) return 'suppliers';
  if (pathname.startsWith('/inventario')) return 'inventario';
  if (pathname.startsWith('/templates')) return 'templates';
  if (pathname.startsWith('/notificaciones')) return 'history';
  if (pathname.startsWith('/cobros')) return 'collections';
  if (pathname.startsWith('/historial-precios')) return 'price-history';
  if (pathname.startsWith('/wizard')) return 'wizard';
  if (pathname.startsWith('/ai/governance')) return 'ai-governance';
  if (pathname.startsWith('/ai')) return 'ai-hub';
  if (pathname.startsWith('/usuarios')) return 'usuarios';
  if (pathname.startsWith('/roles')) return 'roles';
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

  // Sprint 2026-05-01: contador real de expedientes (antes era 32 hardcoded).
  // Se refresca cuando cambia la ruta para reflejar altas/bajas. Para CLIENT
  // el backend ya filtra por ClientScopedManager; para ADMIN devuelve todos.
  const [expedientesCount, setExpedientesCount] = useState(null);
  useEffect(() => {
    let cancel = false;
    expedientesApi.list()
      .then((d) => {
        if (cancel) return;
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setExpedientesCount(arr.length);
      })
      .catch(() => { if (!cancel) setExpedientesCount(null); });
    return () => { cancel = true; };
    // location.pathname como dependencia: al volver al listado tras crear/
    // borrar, el contador se actualiza solo. Sin esto quedaba estancado.
  }, [location.pathname]);

  // Sprint 2026-05-20 · Reorg sidebar.
  //   · Ocultos: pagos (Financiero), suppliers (Proveedores),
  //     templates (Plantillas), pipeline → quedan fuera del nav.
  //   · Renombrados de grupo:
  //       structure     → commercial  (Comercial)
  //       financiero    → warehouse   (Almacén & Logística)
  //       notifications → communications (Comunicaciones)
  //   · Renombrados de item:
  //       history      → "Notificaciones" / "Notifications"
  //       collections  → "Cartera"        / "Portfolio"
  //   · Movidos: nodos + inventario al grupo warehouse.
  const allItems = [
    { key: 'dashboard',      icon: <IconHome/>,       label: tr(lang,'dashboard'),     group: 'core' },
    { key: 'expedientes',    icon: <IconFolder/>,     label: expedientesLabel,         group: 'core', counter: expedientesCount },
    { key: 'cronograma',     icon: <IconHistory/>,    label: lang === 'en' ? 'Timeline' : 'Cronograma', group: 'core' },
    { key: 'portal',         icon: <IconBuilding/>,   label: tr(lang,'portal'),        group: 'core' },
    // Almacén & Logística
    { key: 'transfers',      icon: <IconSwap/>,       label: tr(lang,'transfers'),     group: 'warehouse' },
    { key: 'nodos',          icon: <IconNetwork/>,    label: tr(lang,'nodos'),         group: 'warehouse' },
    { key: 'inventario',     icon: <IconWarehouse/>,  label: tr(lang,'inventario'),    group: 'warehouse' },
    // Comercial
    { key: 'clientes',       icon: <IconUsers/>,      label: tr(lang,'clientes'),      group: 'commercial' },
    { key: 'brands',         icon: <IconTag/>,        label: tr(lang,'brands'),        group: 'commercial' },
    { key: 'productos',      icon: <IconBoxes/>,      label: tr(lang,'productos'),     group: 'commercial' },
    // F6 · 2026-05-20 · Bitácora histórica de cambios de precios (CEO-ONLY).
    { key: 'price-history',  icon: <IconHistory/>,    label: lang === 'en' ? 'Price history' : 'Historial de precios', group: 'commercial' },
    // Sprint 2026-05-24 · Modulo Finanzas CEO-ONLY (comisiones, margen, devengo).
    // CLIENT_* no lo ve porque 'finanzas' NO esta en CLIENT_ALLOWED_MODULES.
    { key: 'finanzas',       icon: <IconDollar/>,     label: lang === 'en' ? 'Finance' : 'Finanzas',                  group: 'commercial' },
    // Comunicaciones
    { key: 'history',        icon: <IconHistory/>,    label: lang === 'en' ? 'Notifications' : 'Notificaciones', group: 'communications' },
    { key: 'collections',    icon: <IconCreditCard/>, label: lang === 'en' ? 'Portfolio'     : 'Cartera',        group: 'communications' },
    // Soporte
    { key: 'tickets',        icon: <IconClipboard/>,  label: tr(lang,'tickets')  || 'Gestor de Tickets', group: 'support' },
    // M3 CORE — gestión de acceso del ERP. Sólo visibles para admin
    // (el whitelist de CLIENT_ALLOWED_MODULES NO los incluye).
    { key: 'usuarios',       icon: <IconUsers/>,      label: tr(lang,'users')    || 'Usuarios',         group: 'core_admin' },
    { key: 'roles',          icon: <IconLock/>,       label: tr(lang,'roles')    || 'Roles y Permisos', group: 'core_admin' },
  ];

  // ───────────────────────────────── FILTRO POR ROL ────────────────────
  // Fuente de verdad: CLIENT_ALLOWED_MODULES (RoleContext).
  // ADMIN → todo; CLIENT → solo los keys whitelisteados.
  const items = allItems.filter(it => canSeeModule(it.key));

  // Helper de etiqueta: tr() devuelve la clave literal si no existe traducción,
  // lo que hace inútil el `|| fallback`. Usamos un fallback explícito.
  const labelOr = (key, fallback) => {
    const v = tr(lang, key);
    return (!v || v === key) ? fallback : v;
  };
  const groups = [
    { key: 'core',           label: '',                                                                   defaultOpen: true  },
    { key: 'commercial',     label: lang === 'en' ? 'Commercial'           : 'Comercial',                 defaultOpen: false },
    { key: 'warehouse',      label: lang === 'en' ? 'Warehouse & Logistics': 'Almacén & Logística',       defaultOpen: false },
    { key: 'communications', label: lang === 'en' ? 'Communications'       : 'Comunicaciones',            defaultOpen: false },
    { key: 'support',        label: lang === 'en' ? 'Support'              : 'Soporte',                   defaultOpen: false },
    { key: 'core_admin',     label: lang === 'en' ? 'Administration'       : 'Administración',            defaultOpen: false },
  ];

  // ── Secciones colapsables · persistencia en localStorage ────────
  // Cada grupo con label es un toggle. "core" (sin label) siempre visible.
  // Default: todos colapsados excepto core → evita scroll interno en
  // sidebars con muchos items (especialmente en laptops 13").
  const GROUP_STATE_KEY = 'mwt-sidebar-groups-expanded';
  const [expandedGroups, setExpandedGroups] = React.useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GROUP_STATE_KEY) : null;
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    // Default: abrimos solo los que tengan `defaultOpen=true`.
    return new Set(groups.filter(g => g.defaultOpen).map(g => g.key));
  });

  const toggleGroup = React.useCallback((key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  return (
    <aside className="sidebar" data-viewport={viewportRole} aria-label="Main navigation">
      <div className="sidebar-head">
        <div className="sidebar-logo">
          <img
            // Colapsado → logo compacto (icono cuadrado). Expandido → logo largo.
            // El recorte por CSS del logo ancho mostraba "MWT ON" cortado; el
            // logo de login es el ícono correcto para el estado colapsado.
            src={collapsed
              ? "/img/Recurso%203logo_login.png"
              : "https://mwt.one/images/2024/12/04/recurso-1logo_foot.png"}
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
          if (gItems.length === 0) return null;

          const hasLabel   = Boolean(g.label);
          const isExpanded = !hasLabel || expandedGroups.has(g.key);
          // Si hay un item activo dentro de un grupo colapsado, lo abrimos
          // automáticamente para que el usuario vea dónde está.
          const hasActiveChild = gItems.some(it =>
            currentScreen === it.key
            || (it.key === 'expedientes' && (currentScreen === 'expediente-detail' || currentScreen === 'oc-detail')));
          const effectivelyOpen = isExpanded || hasActiveChild;

          return (
            <div key={g.key} className="sidebar-group" data-collapsible={hasLabel ? 'true' : 'false'}>
              {hasLabel && (
                <button
                  type="button"
                  className="sidebar-group-label sidebar-group-toggle"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={effectivelyOpen}
                  title={effectivelyOpen ? `Colapsar ${g.label}` : `Expandir ${g.label}`}
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "space-between",
                    width:          "100%",
                    padding:        collapsed ? 0 : "8px 14px 4px",
                    margin:         0,
                    border:         "none",
                    background:     "transparent",
                    color:          "inherit",
                    cursor:         "pointer",
                    textAlign:      "left",
                    font:           "inherit",
                    textTransform:  "uppercase",
                    letterSpacing:  "0.08em",
                    fontSize:       10,
                    fontWeight:     700,
                    opacity:        collapsed ? 0 : 0.55,
                    pointerEvents:  collapsed ? "none" : "auto",
                    userSelect:     "none",
                  }}
                >
                  <span>{g.label}</span>
                  <motion.span
                    animate={{ rotate: effectivelyOpen ? 90 : 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center", justifyContent: "center",
                      width: 14, height: 14,
                    }}
                  >
                    <IconChevRight size={12}/>
                  </motion.span>
                </button>
              )}
              <AnimatePresence initial={false}>
                {effectivelyOpen && (
                  <motion.div
                    key="group-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{    height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    {gItems.map(it => (
                      <button
                        key={it.key}
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
                      </button>
                    ))}
                  </motion.div>
                )}
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
