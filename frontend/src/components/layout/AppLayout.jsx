// App layout — sidebar + topbar + routed outlet
import React, { useState, useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate, useParams, matchPath } from "react-router-dom";
import { Sidebar, screenFromPath } from "./Sidebar.jsx";
import { TopBar } from "./TopBar.jsx";
import { CommandPalette } from "../CommandPalette.jsx";
import { TweaksPanel } from "../TweaksPanel.jsx";
import TicketWidget from "../tickets/TicketWidget.jsx";
import { tr } from "../../lib/i18n.js";
import { OCS, EXPEDIENTES } from "../../data/mockData.js";

const DEFAULT_TWEAKS = {
  theme: 'light',
  accent: 'mint',
  density: 'compact',
  sidebar_variant: 'navy',
  language: 'es',
};

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [tweaks, setTweaks] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mwt-tweaks'));
      return { ...DEFAULT_TWEAKS, ...(stored || {}) };
    } catch {
      return DEFAULT_TWEAKS;
    }
  });
  const [lang, setLang] = useState(tweaks.language || 'es');
  const [collapsed, setCollapsed] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);

  // Persist tweaks
  useEffect(() => { localStorage.setItem('mwt-tweaks', JSON.stringify(tweaks)); }, [tweaks]);

  // Apply theme/accent/density attrs to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme',    tweaks.theme || 'light');
    root.setAttribute('data-accent',   tweaks.accent || 'mint');
    root.setAttribute('data-density',  tweaks.density || 'comfortable');
    root.setAttribute('data-sidebar',  tweaks.sidebar_variant || 'navy');
  }, [tweaks]);

  // Keep lang in sync with tweaks.language
  useEffect(() => { setLang(tweaks.language || 'es'); }, [tweaks.language]);

  // Cmd+K
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowCmd(s=>!s); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Tweaks host protocol
  useEffect(() => {
    const handler = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode')   setShowTweaks(true);
      if (d.type === '__deactivate_edit_mode') setShowTweaks(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const updateTweaks = (patch) => {
    setTweaks(t => {
      const next = {...t, ...patch};
      window.parent.postMessage({type:'__edit_mode_set_keys', edits: patch}, '*');
      return next;
    });
  };
  const onToggleLang = (next) => updateTweaks({ language: next });

  // Breadcrumbs derived from URL
  const breadcrumbs = useMemo(() => {
    const path = location.pathname;
    const screen = screenFromPath(path);

    // /expedientes/:ocId
    const ocMatch = matchPath('/expedientes/:ocId', path);
    const expMatch = matchPath('/expedientes/:ocId/exp/:expedienteId', path);
    if (expMatch) {
      const ocId = expMatch.params.ocId;
      const expedienteId = expMatch.params.expedienteId;
      return [
        tr(lang,'expedientes'),
        OCS.find(o=>o.id===ocId)?.code || '',
        EXPEDIENTES.find(e=>e.id===expedienteId)?.ref || '',
      ];
    }
    if (ocMatch) {
      const ocId = ocMatch.params.ocId;
      return [tr(lang,'expedientes'), OCS.find(o=>o.id===ocId)?.code || ''];
    }

    const map = {
      'dashboard':   [tr(lang,'dashboard')],
      'expedientes': [tr(lang,'expedientes')],
      'pipeline':    [tr(lang,'pipeline')],
      'pagos':       [tr(lang,'financiero')],
      'inventario':  [tr(lang,'inventario')],
      'portal':      [tr(lang,'portal')],
      'wizard':      [tr(lang,'expedientes'), tr(lang,'new_expediente')],
      'transfers':   [tr(lang,'transfers')],
      'nodos':       [tr(lang,'nodos')],
      'clientes':    [tr(lang,'clientes')],
      'brands':      [tr(lang,'brands')],
      'productos':   [tr(lang,'productos')],
      'suppliers':   [tr(lang,'suppliers')],
      'templates':   [tr(lang,'templates')],
      'history':     [tr(lang,'history')],
      'collections': [tr(lang,'collections')],
    };
    return map[screen] || [tr(lang,'dashboard')];
  }, [location.pathname, lang]);

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={()=>setCollapsed(!collapsed)}
        lang={lang}
      />
      <div className="main">
        <TopBar
          breadcrumbs={breadcrumbs}
          lang={lang}
          onOpenSearch={()=>setShowCmd(true)}
          onToggleLang={onToggleLang}
          onToggleTweaks={()=>setShowTweaks(s=>!s)}
        />
        <Outlet context={{ lang }} />
      </div>
      {showCmd && <CommandPalette lang={lang} onClose={()=>setShowCmd(false)} />}
      {showTweaks && <TweaksPanel values={tweaks} onChange={updateTweaks} onClose={()=>setShowTweaks(false)} />}
      <TicketWidget lang={lang} />
    </div>
  );
}
