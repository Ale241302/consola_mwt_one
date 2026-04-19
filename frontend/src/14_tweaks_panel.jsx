// Tweaks panel (host-integrated)
function TweaksPanel({ values, onChange, onClose }) {
  return (
    <div className="tweaks-panel">
      <div className="tweaks-head">
        <span>Tweaks <small>· MWT ONE</small></span>
        <button className="icon-btn" style={{color:'#fff', width:26, height:26}} onClick={onClose}><IconX size={14}/></button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <label>Tema</label>
          <Seg options={[{value:'light',label:'Claro'},{value:'dark',label:'Oscuro'}]}
               value={values.theme} onChange={v=>onChange({theme:v})}/>
        </div>
        <div className="tweak-row">
          <label>Sidebar</label>
          <Seg options={[{value:'navy',label:'Navy'},{value:'light',label:'Claro'},{value:'sand',label:'Arena'}]}
               value={values.sidebar_variant} onChange={v=>onChange({sidebar_variant:v})}/>
        </div>
        <div className="tweak-row">
          <label>Acento</label>
          <Seg options={[{value:'mint',label:'Menta'},{value:'ice',label:'Hielo'},{value:'coral',label:'Coral'}]}
               value={values.accent} onChange={v=>onChange({accent:v})}/>
        </div>
        <div className="tweak-row">
          <label>Densidad</label>
          <Seg options={[{value:'compact',label:'Compacta'},{value:'comfortable',label:'Cómoda'},{value:'cozy',label:'Amplia'}]}
               value={values.density} onChange={v=>onChange({density:v})}/>
        </div>
        <div className="tweak-row">
          <label>Idioma</label>
          <Seg options={[{value:'es',label:'ES'},{value:'en',label:'EN'}]}
               value={values.language} onChange={v=>onChange({language:v})}/>
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { TweaksPanel });
