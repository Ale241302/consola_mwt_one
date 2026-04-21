// ─────────────────────────────────────────────────────────────
// AutomaticCollectionLogTable — Tab 2 del Dashboard de Cobros
// Agente responsable: [AG-FRONTEND]
//
// Tabla read-only que audita lo que el CollectionBot envió.
// Es la fuente única de verdad sobre actividad automática.
// Internamente reusa la implementación ya estable usada en el
// Historial de Notificaciones (CollectionLogTable) para evitar
// duplicar lógica de filtros, pero la "wrapeamos" aquí para
// inyectar copy específico del módulo Cobros y un disclaimer
// de inmutabilidad ("read-only · audit trail").
// ─────────────────────────────────────────────────────────────
import React from "react";
import { IconShield, IconSparkle } from "../../lib/icons.jsx";
import CollectionLogTable from "../notificaciones/CollectionLogTable.jsx";

export default function AutomaticCollectionLogTable({ lang = "es", logs = [] }) {
  return (
    <div className="cobros-audit">
      {/* Banner inmutabilidad — refuerza que el humano NO escribe aquí */}
      <div className="cobros-audit-banner">
        <div className="cobros-audit-banner-icon">
          <IconShield size={14}/>
        </div>
        <div style={{ flex: 1 }}>
          <div className="heading-sm" style={{ marginBottom: 2 }}>
            {lang === "es"
              ? "Auditoría inmutable del CollectionBot"
              : "Immutable CollectionBot audit trail"}
          </div>
          <div className="caption">
            {lang === "es"
              ? "Cada fila representa un correo enviado por el cron de cobranza. Read-only — esta vista no permite reenviar ni editar; usá el drawer del caso para gobernanza."
              : "Each row is an email sent by the collections cron. Read-only — this view does not allow resending or editing; use the case drawer for governance."}
          </div>
        </div>
        <div className="cobros-audit-bot">
          <IconSparkle size={11}/>
          <span className="micro">{lang === "es" ? "AUTOMÁTICO" : "AUTOMATED"}</span>
        </div>
      </div>

      {/* Reuso de la tabla canonica de logs de cobranza */}
      <CollectionLogTable lang={lang} logs={logs}/>
    </div>
  );
}
