// App shell — sidebar + topbar
function Sidebar({ currentScreen, onNavigate, collapsed, onToggleCollapse, lang }) {
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
          <div className="sidebar-logo-mark">M</div>
          <span>MWT · <small style={{ opacity: 0.7, fontWeight: 600 }}>ONE</small></span>
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
        <div className="sidebar-user">
          <div className="avatar">AM</div>
          <div className="sidebar-user-meta">
            <div className="sidebar-user-name">A. Mendoza</div>
            <div className="sidebar-user-role">{lang==='es' ? 'CEO · MWT PE' : 'CEO · MWT PE'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ breadcrumbs, onOpenSearch, lang, onToggleLang, onToggleTweaks }) {
  return (
    <div className="topbar">
      <div className="topbar-breadcrumbs">
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <IconChevRight size={14} />}
            {i === breadcrumbs.length - 1 ? <b>{b}</b> : <span>{b}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-search" onClick={onOpenSearch}>
        <IconSearch size={14}/>
        <span>{tr(lang,'search_ph')}</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="topbar-actions">
        <div className="lang-toggle" title={lang==='es' ? 'Idioma' : 'Language'}>
          <button data-active={lang==='es'} onClick={() => onToggleLang('es')}>ES</button>
          <button data-active={lang==='en'} onClick={() => onToggleLang('en')}>EN</button>
        </div>
        <button className="icon-btn" title="Tweaks" onClick={onToggleTweaks}><IconSliders size={17}/></button>
        <button className="icon-btn" title="Notifications"><IconBell size={17}/><span className="dot"/></button>
        <button className="icon-btn" title="Settings"><IconSettings size={17}/></button>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar });
