// =====================================================================
// MWT.ONE · TweaksPanel.jsx
// Panel flotante de ajustes de UI. Sección superior nueva: "Viewport /
// Rol" — permite al staff interno (admin/superadmin/manager/etc) cambiar
// entre Modo ADMIN y Modo CLIENTE para QA del Portal B2B.
//
// Reglas:
//   - La sección de Rol SOLO se muestra si `canTweak` (staff interno).
//     Un usuario real CLIENT_B2B nunca ve esta sección.
//   - Cambiar el toggle dispara re-render instantáneo de Sidebar, vistas
//     y permisos (via RoleContext).
//   - El override es por-pestaña (sessionStorage) — al cerrar se limpia.
// =====================================================================
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Seg } from "./ui/primitives.jsx";
import { IconX } from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";

export function TweaksPanel({ values, onChange, onClose }) {
  const { role, isAdmin, isClient, canTweak, baseViewport, override, setOverride } = useRole();

  const roleOptions = [
    { value: "ADMIN",  label: "Admin (CEO)" },
    { value: "CLIENT", label: "Cliente (B2B)" },
  ];

  return (
    <motion.div
      className="tweaks-panel"
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="tweaks-head">
        <span>Tweaks <small>· MWT ONE</small></span>
        <button className="icon-btn" style={{color:'#fff', width:26, height:26}} onClick={onClose}>
          <IconX size={14}/>
        </button>
      </div>

      <div className="tweaks-body">

        {/* ───────────────────────────── Sección ROL / VIEWPORT ─── */}
        {canTweak && (
          <div className="tweak-section">
            <div className="tweak-section-head">
              <span className="tweak-section-title">Viewport</span>
              <RoleBadge role={role} />
            </div>

            <div className="tweak-row">
              <label>Modo</label>
              <Seg
                options={roleOptions}
                value={role}
                onChange={(v) => setOverride(v === baseViewport ? null : v)}
              />
            </div>

            <AnimatePresence>
              {isClient && (
                <motion.div
                  key="client-warn"
                  className="tweak-role-note"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  <strong>Previsualizando como Cliente B2B.</strong> Solo ves
                  Dashboard y Mis Pedidos. Acciones CEO-only (precio diferido,
                  agregar SAP, subir documentos, editar líneas) están ocultas.
                </motion.div>
              )}
            </AnimatePresence>

            {override && (
              <button
                className="tweak-role-reset"
                onClick={() => setOverride(null)}
                type="button"
              >
                Volver a mi rol real ({baseViewport})
              </button>
            )}
          </div>
        )}

        {/* ───────────────────────────── Sección UI ─── */}
        <div className="tweak-section">
          <div className="tweak-section-head">
            <span className="tweak-section-title">Apariencia</span>
          </div>

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
    </motion.div>
  );
}

function RoleBadge({ role }) {
  const isAdmin = role === "ADMIN";
  return (
    <span
      className="role-badge"
      data-role={role}
      title={isAdmin ? "Viendo como Admin / CEO" : "Viendo como Cliente B2B"}
    >
      <span className="role-dot" />
      {isAdmin ? "ADMIN" : "CLIENT"}
    </span>
  );
}
