// Command palette
function CommandPalette({ lang, onClose, onNavigate, onOpenExpediente }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const actions = useMemo(() => [
    { id:'nav-dashboard', label: tr(lang,'dashboard'), icon:<IconHome size={14}/>, kind:'nav', run: () => onNavigate('dashboard') },
    { id:'nav-exps', label: tr(lang,'expedientes'), icon:<IconFolder size={14}/>, kind:'nav', run: () => onNavigate('expedientes') },
    { id:'nav-pipe', label: tr(lang,'pipeline'), icon:<IconKanban size={14}/>, kind:'nav', run: () => onNavigate('pipeline') },
    { id:'nav-pagos', label: tr(lang,'financiero'), icon:<IconDollar size={14}/>, kind:'nav', run: () => onNavigate('pagos') },
    { id:'nav-inv', label: tr(lang,'inventario'), icon:<IconWarehouse size={14}/>, kind:'nav', run: () => onNavigate('inventario') },
    { id:'nav-portal', label: tr(lang,'portal'), icon:<IconBuilding size={14}/>, kind:'nav', run: () => onNavigate('portal') },
    { id:'act-new', label: tr(lang,'new_expediente'), icon:<IconPlus size={14}/>, kind:'action', meta:'⌘N', run: () => onNavigate('wizard') },
    ...EXPEDIENTES.slice(0,8).map(e => ({
      id: e.id, label: e.ref+' · '+e.client, icon:<IconFolder size={14}/>,
      kind:'exp', meta: tr(lang, e.status), run: () => onOpenExpediente(e.id)
    })),
  ], [lang, onNavigate, onOpenExpediente]);

  const filtered = actions.filter(a => !q || a.label.toLowerCase().includes(q.toLowerCase()));
  const grouped = {
    [lang==='es'?'Navegación':'Navigation']: filtered.filter(a=>a.kind==='nav'),
    [lang==='es'?'Acciones':'Actions']: filtered.filter(a=>a.kind==='action'),
    [lang==='es'?'Expedientes':'Files']: filtered.filter(a=>a.kind==='exp'),
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(filtered.length-1, a+1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a-1)); }
      if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [filtered, active, onClose]);

  let idx = -1;
  return (
    <>
      <div className="overlay" onClick={onClose}/>
      <div className="cmd-modal" role="dialog">
        <div className="cmd-input-wrap">
          <IconSearch size={16} style={{color:'var(--text-tertiary)'}}/>
          <input autoFocus placeholder={lang==='es'?'Escribe un comando, expediente o cliente…':'Type a command, file or client…'} value={q} onChange={e=>{setQ(e.target.value); setActive(0);}}/>
          <span className="kbd">ESC</span>
        </div>
        <div className="cmd-list">
          {Object.entries(grouped).map(([group, items]) => items.length > 0 && (
            <div key={group}>
              <div className="cmd-section-title">{group}</div>
              {items.map(it => {
                idx++;
                const myIdx = idx;
                return (
                  <div key={it.id} className="cmd-item" data-active={active===myIdx}
                       onMouseEnter={() => setActive(myIdx)}
                       onClick={() => { it.run(); onClose(); }}>
                    <span className="icon">{it.icon}</span>
                    <span>{it.label}</span>
                    {it.meta && <span className="meta">{it.meta}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty"><IconSearch size={18}/>{lang==='es'?'Sin resultados':'No results'}</div>}
        </div>
        <div className="cmd-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> {lang==='es'?'navegar':'navigate'}</span>
          <span><span className="kbd">↵</span> {lang==='es'?'abrir':'open'}</span>
          <span><span className="kbd">ESC</span> {lang==='es'?'cerrar':'close'}</span>
        </div>
      </div>
    </>
  );
}
Object.assign(window, { CommandPalette });
