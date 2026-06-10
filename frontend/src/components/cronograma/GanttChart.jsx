// ─────────────────────────────────────────────────────────────
// GanttChart — Gantt interactivo del Cronograma (React)
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
//   · Zoom: botones − / + y slider (px por día 4–64).
//   · Pan: scroll horizontal nativo + arrastre con el mouse (grab).
//   · Filas recursivas: { key, label, sub, bars[], children[], summary,
//     onLabelClick } — flecha para desglosar; label sticky a la izquierda.
//   · Barras: sólidas = real; rayadas = estimado; hito circular si ~0d;
//     barra resumen (summary) delgada. Línea HOY. Tooltips nativos.
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useRef, useState, useCallback } from "react";
import {
  STAGE_COLORS, addDays, today, fmtShort,
} from "../../lib/cronogramaData.js";

const DAY = 86400000;
const LABEL_W = 280;

function barStyle(b, h) {
  const color = STAGE_COLORS[b.s] || "var(--brand-primary, #0B1E3A)";
  const base = {
    position: "absolute", top: "50%", transform: "translateY(-50%)",
    height: h, borderRadius: h / 2, background: color,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)",
    transition: "filter .15s ease, transform .15s ease",
  };
  if (b.est) {
    base.opacity = 0.55;
    base.backgroundImage =
      "repeating-linear-gradient(45deg, rgba(255,255,255,0.7) 0 4px, transparent 4px 9px)";
    base.outline = "1.5px dashed rgba(1,58,87,0.35)";
    base.outlineOffset = 1;
    base.boxShadow = "none";
  }
  return base;
}

export default function GanttChart({ rows = [], lang = "es" }) {
  const [pxDay, setPxDay] = useState(16);
  const [expanded, setExpanded] = useState(() => new Set());
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  const { min, max } = useMemo(() => {
    let mn = today(), mx = addDays(today(), 7);
    const walk = (rs) => (rs || []).forEach((r) => {
      (r.bars || []).forEach((b) => {
        if (b.a && b.a < mn) mn = b.a;
        if (b.b && b.b > mx) mx = b.b;
      });
      if (r.children) walk(r.children);
    });
    walk(rows);
    return { min: addDays(mn, -3), max: addDays(mx, 5) };
  }, [rows]);

  const spanDays = Math.max(1, Math.round((max - min) / DAY));
  const width = spanDays * pxDay;
  const x = useCallback((d) => ((d - min) / DAY) * pxDay, [min, pxDay]);

  // Ticks adaptativos según el zoom.
  const ticks = useMemo(() => {
    const step = pxDay >= 36 ? 1 : pxDay >= 12 ? 7 : 14;
    const out = [];
    let t = new Date(min);
    if (step > 1) t.setDate(t.getDate() + ((1 - t.getDay() + 7) % 7)); // lunes
    for (; t <= max; t = addDays(t, step)) out.push(new Date(t));
    return out;
  }, [min, max, pxDay]);

  const flat = useMemo(() => {
    const out = [];
    const push = (rs, depth) => (rs || []).forEach((r) => {
      out.push({ ...r, depth });
      if (r.children && r.children.length && expanded.has(r.key)) {
        push(r.children, depth + 1);
      }
    });
    push(rows, 0);
    return out;
  }, [rows, expanded]);

  const toggle = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Pan por arrastre (mouse) sobre el área del gráfico.
  const onMouseDown = useCallback((e) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0) return;
    dragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      if (Math.abs(dx) > 3) d.moved = true;
      el.scrollLeft = d.scrollLeft - dx;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const zoom = (delta) => setPxDay((p) => Math.max(4, Math.min(64, p + delta)));

  if (!rows.length) {
    return (
      <div className="caption" style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)" }}>
        {lang === "es" ? "Sin expedientes para graficar." : "Nothing to chart."}
      </div>
    );
  }

  const todayX = x(today());

  return (
    <div>
      {/* Toolbar zoom */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, justifyContent: "flex-end" }}>
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Zoom" : "Zoom"}
        </span>
        <button className="btn btn-ghost btn-xs" onClick={() => zoom(-4)} style={{ padding: "2px 9px", fontWeight: 800 }}>−</button>
        <input type="range" min="4" max="64" value={pxDay}
               onChange={(e) => setPxDay(Number(e.target.value))}
               style={{ width: 120 }}/>
        <button className="btn btn-ghost btn-xs" onClick={() => zoom(4)} style={{ padding: "2px 9px", fontWeight: 800 }}>+</button>
        <span className="caption tabular-nums" style={{ color: "var(--text-tertiary)", width: 56 }}>
          {pxDay}px/{lang === "es" ? "día" : "day"}
        </span>
      </div>

      <div ref={scrollRef}
           onMouseDown={onMouseDown}
           style={{ overflowX: "auto", overflowY: "hidden", cursor: "grab", border: "1px solid var(--border-subtle, #E1E6ED)", borderRadius: 12, background: "var(--surface, #fff)", userSelect: "none" }}>
        <div style={{ position: "relative", width: LABEL_W + width + 24, minWidth: "100%" }}>
          {/* Grid + HOY (detrás de las filas, delante del fondo) */}
          <div style={{ position: "absolute", left: LABEL_W, top: 0, bottom: 26, width, pointerEvents: "none" }}>
            {ticks.map((t, i) => (
              <div key={i} style={{ position: "absolute", left: x(t), top: 0, bottom: 0, width: 1, background: "var(--border-subtle, #EDF1F5)" }}/>
            ))}
            <div style={{ position: "absolute", left: todayX, top: 0, bottom: 0, width: 2, background: "#EF4444", boxShadow: "0 0 8px rgba(239,68,68,0.35)" }}>
              <span style={{ position: "absolute", top: 2, left: 5, fontSize: 9, fontWeight: 800, color: "#EF4444", letterSpacing: 1 }}>
                {lang === "es" ? "HOY" : "TODAY"}
              </span>
            </div>
          </div>

          {/* Filas */}
          {flat.map((r) => {
            const isParent = r.depth === 0;
            const hasKids = r.children && r.children.length > 0;
            const open = expanded.has(r.key);
            const rowH = isParent ? 38 : 30;
            const barH = r.summary ? 5 : (isParent ? 12 : 11);
            return (
              <div key={r.key}
                   style={{ display: "flex", height: rowH, borderBottom: "1px dashed var(--border-subtle, #F1F5F9)", background: isParent ? "transparent" : "rgba(248,250,252,0.6)" }}>
                {/* Label sticky */}
                <div style={{
                  position: "sticky", left: 0, zIndex: 5, width: LABEL_W, flex: "none",
                  display: "flex", alignItems: "center", gap: 6,
                  padding: `0 10px 0 ${10 + r.depth * 18}px`,
                  background: "var(--surface, #fff)",
                  borderRight: "1px solid var(--border-subtle, #E1E6ED)",
                  overflow: "hidden",
                }}>
                  {hasKids ? (
                    <button onClick={(e) => { e.stopPropagation(); toggle(r.key); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{
                              border: "1px solid var(--border-subtle, #E1E6ED)", background: "#fff",
                              color: "#013A57", borderRadius: "50%", width: 20, height: 20,
                              fontSize: 9, cursor: "pointer", flex: "none",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              transform: open ? "rotate(90deg)" : "none", transition: "transform .2s ease",
                            }}>▸</button>
                  ) : <span style={{ width: 20, flex: "none" }}/>}
                  <span onClick={r.onLabelClick}
                        onMouseDown={(e) => e.stopPropagation()}
                        title={r.labelTip || r.label}
                        style={{ minWidth: 0, cursor: r.onLabelClick ? "pointer" : "default" }}>
                    <span style={{ fontSize: isParent ? 12.5 : 11.5, fontWeight: isParent ? 800 : 600, color: r.onLabelClick ? "var(--brand-primary, #013A57)" : "var(--text-secondary, #36556B)", whiteSpace: "nowrap", textDecoration: r.onLabelClick ? "underline dotted" : "none", textUnderlineOffset: 3 }}>
                      {r.label}
                    </span>
                    {r.sub && (
                      <span className="caption" style={{ marginLeft: 6, fontSize: 10.5, color: "var(--text-tertiary, #94A3B8)", whiteSpace: "nowrap" }}>
                        {r.sub}
                      </span>
                    )}
                  </span>
                </div>
                {/* Track */}
                <div style={{ position: "relative", width, flex: "none" }}>
                  {(r.bars || []).map((b, i) => {
                    if (!b.a || !b.b) return null;
                    const l = x(b.a);
                    const w = Math.max(0, x(b.b) - l);
                    const tip = b.tip || "";
                    if (w < 8) {
                      return (
                        <span key={i} title={tip} style={{
                          position: "absolute", left: l, top: "50%", transform: "translate(-50%, -50%)",
                          width: 11, height: 11, borderRadius: "50%",
                          background: STAGE_COLORS[b.s] || "#0B1E3A",
                          boxShadow: "0 0 0 2.5px #fff, 0 1px 4px rgba(1,58,87,0.3)",
                          opacity: b.est ? 0.55 : 1,
                        }}/>
                      );
                    }
                    return (
                      <span key={i} title={tip}
                            style={{ ...barStyle(b, r.summary ? 5 : barH), left: l, width: w }}/>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Eje */}
          <div style={{ display: "flex", height: 26 }}>
            <div style={{ position: "sticky", left: 0, zIndex: 5, width: LABEL_W, flex: "none", background: "var(--surface, #fff)", borderRight: "1px solid var(--border-subtle, #E1E6ED)" }}/>
            <div style={{ position: "relative", width, flex: "none" }}>
              {ticks.map((t, i) => (
                <span key={i} className="tabular-nums" style={{ position: "absolute", left: x(t), top: 5, transform: "translateX(-50%)", fontSize: 10, color: "var(--text-tertiary, #94A3B8)", whiteSpace: "nowrap" }}>
                  {fmtShort(t, lang)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, alignItems: "center" }}>
        {Object.entries(STAGE_COLORS).slice(0, 6).map(([s, c]) => (
          <span key={s} className="caption" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary, #475569)" }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: c, display: "inline-block" }}/>
            {(lang === "es"
              ? { REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación", DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino" }
              : { REGISTRO: "Registry", PRODUCCION: "Production", PREPARACION: "Preparation", DESPACHO: "Dispatch", TRANSITO: "Transit", EN_DESTINO: "At destination" })[s]}
          </span>
        ))}
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Rayado = estimado · ▸ desglosa · arrastra para desplazarte" : "Striped = estimated · ▸ expand · drag to pan"}
        </span>
      </div>
    </div>
  );
}
