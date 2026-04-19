// Stub — Marcas
import React from "react";
import { useOutletContext } from "react-router-dom";
import { IconSparkle } from "../lib/icons.jsx";

export default function ScreenBrands() {
  const { lang } = useOutletContext();
  const title = lang === 'es' ? 'Marcas' : 'Brands';
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es'?'MÓDULO':'MODULE'}</div>
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{lang==='es'?'Módulo disponible en siguiente iteración':'Module available in next iteration'}</div>
        </div>
      </div>
      <div className="card card-pad-lg empty">
        <IconSparkle size={24} style={{ color:'var(--brand-accent)'}}/>
        <div className="heading-md">{lang==='es'?'Próximamente':'Coming soon'}</div>
        <div className="body-sm text-sec" style={{maxWidth:420}}>
          {lang==='es'
            ? `Este módulo (${title}) está en el roadmap. Por ahora enfócate en Expedientes, Pipeline, Financiero, Inventario y Dashboard — ya son navegables.`
            : `This module (${title}) is on the roadmap. For now focus on Files, Pipeline, Financial, Inventory and Dashboard — all navigable.`}
        </div>
      </div>
    </div>
  );
}
