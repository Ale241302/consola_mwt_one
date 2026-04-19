// App root — router + global state
function App() {
  const [tweaks, setTweaks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mwt-tweaks')) || window.__TWEAKS__; }
    catch { return window.__TWEAKS__; }
  });
  const [lang, setLang] = useState(tweaks.language || 'es');
  const [screen, setScreen] = useState(() => localStorage.getItem('mwt-screen') || 'expedientes');
  const [expedienteId, setExpedienteId] = useState(() => localStorage.getItem('mwt-exp') || HERO_ID);
  const [ocId, setOcId] = useState(() => localStorage.getItem('mwt-oc') || HERO_OC_ID);
  const [collapsed, setCollapsed] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);

  // Persist
  useEffect(() => { localStorage.setItem('mwt-screen', screen); }, [screen]);
  useEffect(() => { localStorage.setItem('mwt-exp', expedienteId); }, [expedienteId]);
  useEffect(() => { localStorage.setItem('mwt-oc', ocId); }, [ocId]);
  useEffect(() => { localStorage.setItem('mwt-tweaks', JSON.stringify(tweaks)); }, [tweaks]);

  // Apply theme/accent/density attrs to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme',    tweaks.theme || 'light');
    root.setAttribute('data-accent',   tweaks.accent || 'mint');
    root.setAttribute('data-density',  tweaks.density || 'comfortable');
    root.setAttribute('data-sidebar',  tweaks.sidebar_variant || 'navy');
  }, [tweaks]);

  // Keep lang in sync
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

  const openExpediente = (id) => { setExpedienteId(id); setScreen('expediente-detail'); };
  const openOC = (id) => { setOcId(id); setScreen('oc-detail'); };

  const breadcrumbs = (() => {
    const map = {
      'dashboard':   [tr(lang,'dashboard')],
      'expedientes': [tr(lang,'expedientes')],
      'oc-detail':   [tr(lang,'expedientes'), OCS.find(o=>o.id===ocId)?.code || ''],
      'expediente-detail': [tr(lang,'expedientes'), OCS.find(o=>o.id===ocId)?.code || '', EXPEDIENTES.find(e=>e.id===expedienteId)?.ref || ''],
      'pipeline':    [tr(lang,'pipeline')],
      'pagos':       [tr(lang,'financiero')],
      'inventario':  [tr(lang,'inventario')],
      'portal':      [tr(lang,'portal')],
      'wizard':      [tr(lang,'expedientes'), tr(lang,'new_expediente')],
    };
    return map[screen] || [tr(lang,'dashboard')];
  })();

  // Portal gets its own chrome (no app sidebar)
  if (screen === 'portal') {
    return (
      <div className="app-shell" data-collapsed={collapsed}>
        <Sidebar currentScreen={screen} onNavigate={setScreen} collapsed={collapsed} onToggleCollapse={()=>setCollapsed(!collapsed)} lang={lang}/>
        <div className="main">
          <TopBar breadcrumbs={breadcrumbs} lang={lang} onOpenSearch={()=>setShowCmd(true)} onToggleLang={setLang} onToggleTweaks={()=>setShowTweaks(s=>!s)}/>
          <ScreenPortal lang={lang} onOpenOC={openOC}/>
        </div>
        {showCmd && <CommandPalette lang={lang} onClose={()=>setShowCmd(false)} onNavigate={setScreen} onOpenExpediente={openExpediente}/>}
        {showTweaks && <TweaksPanel values={tweaks} onChange={updateTweaks} onClose={()=>setShowTweaks(false)}/>}
      </div>
    );
  }

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <Sidebar currentScreen={screen} onNavigate={setScreen} collapsed={collapsed} onToggleCollapse={()=>setCollapsed(!collapsed)} lang={lang}/>
      <div className="main">
        <TopBar breadcrumbs={breadcrumbs} lang={lang} onOpenSearch={()=>setShowCmd(true)} onToggleLang={setLang} onToggleTweaks={()=>setShowTweaks(s=>!s)}/>
        {screen==='dashboard'          && <ScreenDashboard lang={lang} onOpenExpediente={openExpediente} onNavigate={setScreen}/>}
        {screen==='expedientes'        && <ScreenExpedientes lang={lang} onOpenOC={openOC} onOpenExpediente={openExpediente} onNavigate={setScreen}/>}
        {screen==='oc-detail'          && <ScreenOCDetail lang={lang} ocId={ocId} onBack={()=>setScreen('expedientes')} onOpenExpediente={openExpediente}/>}
        {screen==='expediente-detail'  && <ScreenExpedienteDetail lang={lang} expedienteId={expedienteId} onBack={()=>setScreen('oc-detail')} onNavigate={setScreen}/>}
        {screen==='pipeline'           && <ScreenPipeline lang={lang} onOpenExpediente={openExpediente} onNavigate={setScreen}/>}
        {screen==='pagos'              && <ScreenPagos lang={lang} onOpenExpediente={openExpediente}/>}
        {screen==='inventario'         && <ScreenInventario lang={lang}/>}
        {screen==='wizard'             && <ScreenWizard lang={lang} onCancel={()=>setScreen('expedientes')} onCreate={()=>setScreen('expediente-detail')}/>}
        {/* Stub screens */}
        {['transfers','nodos','clientes','brands','productos','suppliers','templates','history','collections'].includes(screen) && (
          <div className="page">
            <div className="page-header">
              <div>
                <div className="micro" style={{marginBottom:6}}>{lang==='es'?'MÓDULO':'MODULE'}</div>
                <h1 className="page-title">{tr(lang, screen)}</h1>
                <div className="page-subtitle">{lang==='es'?'Módulo disponible en siguiente iteración':'Module available in next iteration'}</div>
              </div>
            </div>
            <div className="card card-pad-lg empty">
              <IconSparkle size={24} style={{ color:'var(--brand-accent)'}}/>
              <div className="heading-md">{lang==='es'?'Próximamente':'Coming soon'}</div>
              <div className="body-sm text-sec" style={{maxWidth:420}}>
                {lang==='es'?`Este módulo (${tr(lang,screen)}) está en el roadmap. Por ahora enfócate en Expedientes, Pipeline, Financiero, Inventario y Dashboard — ya son navegables.`
                           :`This module (${tr(lang,screen)}) is on the roadmap. For now focus on Files, Pipeline, Financial, Inventory and Dashboard — all navigable.`}
              </div>
            </div>
          </div>
        )}
      </div>
      {showCmd && <CommandPalette lang={lang} onClose={()=>setShowCmd(false)} onNavigate={setScreen} onOpenExpediente={openExpediente}/>}
      {showTweaks && <TweaksPanel values={tweaks} onChange={updateTweaks} onClose={()=>setShowTweaks(false)}/>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
