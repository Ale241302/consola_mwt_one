// App shell — topbar con popovers de campana + tuerca
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tr } from "../../lib/i18n.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { apiFetch, getToken } from "../../lib/api.js";
import { IconChevRight, IconSearch, IconSliders, IconBell, IconSettings } from "../../lib/icons.jsx";
import ActivityPanel from "./ActivityPanel.jsx";
import SettingsMenu from "./SettingsMenu.jsx";

// Icono de logout
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

  // ── Popovers ─────────────────────────────────────────────
  const [bellOpen, setBellOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollTimer = useRef(null);

  // Polling ligero del unread-count cada 60s (+ inmediatamente al montar)
  useEffect(() => {
    let alive = true;
    const fetchCount = async () => {
      try {
        const d = await apiFetch("/activity-feed/unread-count/", { token: getToken() });
        if (alive) setUnreadCount(Number(d?.count) || 0);
      } catch {
        if (alive) setUnreadCount(0);
      }
    };
    fetchCount();
    pollTimer.current = setInterval(fetchCount, 60_000);
    return () => { alive = false; if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  // Re-fetch count cuando se cierra el panel (puede haber leídas)
  useEffect(() => {
    if (!bellOpen) {
      apiFetch("/activity-feed/unread-count/", { token: getToken() })
        .then((d) => setUnreadCount(Number(d?.count) || 0))
        .catch(() => {});
    }
  }, [bellOpen]);

  return (
    <div className="topbar" style={{ position: "relative" }}>
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

        {/* Campana + badge de unread */}
        <button
          className="icon-btn"
          title={lang==='es' ? 'Notificaciones' : 'Notifications'}
          onClick={() => { setSettingsOpen(false); setBellOpen((v) => !v); }}
          style={{ position: "relative" }}
        >
          <IconBell size={17}/>
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} notificaciones sin leer`}
              style={{
                position: "absolute",
                top: 4, right: 4,
                minWidth: 14, height: 14,
                padding: "0 4px",
                borderRadius: 7,
                background: "#D64545",
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 0 2px #fff",
                lineHeight: 1,
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* Tuerca */}
        <button
          className="icon-btn"
          title={lang==='es' ? 'Configuración' : 'Settings'}
          onClick={() => { setBellOpen(false); setSettingsOpen((v) => !v); }}
        >
          <IconSettings size={17}/>
        </button>

        <button
          className="icon-btn"
          title={user ? `${lang==='es'?'Cerrar sesión':'Sign out'} (${user.email||user.full_name})` : 'Logout'}
          onClick={onLogout}
        >
          <IconLogOut size={17}/>
        </button>
      </div>

      {/* Popovers (absolutos sobre el topbar) */}
      <ActivityPanel open={bellOpen}     onClose={() => setBellOpen(false)}     lang={lang}/>
      <SettingsMenu  open={settingsOpen} onClose={() => setSettingsOpen(false)} lang={lang}/>
    </div>
  );
}
