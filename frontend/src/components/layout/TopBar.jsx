// App shell — topbar
import React from "react";
import { useNavigate } from "react-router-dom";
import { tr } from "../../lib/i18n.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { IconChevRight, IconSearch, IconSliders, IconBell, IconSettings } from "../../lib/icons.jsx";

// Icono de logout (puerta + flecha) — coherente con el set lucide del proyecto
const IconLogOut = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <path d="M16 17l5-5-5-5"/>
    <path d="M21 12H9"/>
  </svg>
);

export function TopBar({ breadcrumbs, onOpenSearch, lang, onToggleLang, onToggleTweaks }) {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

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
        <button className="icon-btn" title={user ? `${lang==='es'?'Cerrar sesión':'Sign out'} (${user.email||user.full_name})` : 'Logout'} onClick={onLogout}>
          <IconLogOut size={17}/>
        </button>
      </div>
    </div>
  );
}
