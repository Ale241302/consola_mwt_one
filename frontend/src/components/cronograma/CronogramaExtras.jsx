// ─────────────────────────────────────────────────────────────
// CronogramaExtras — KPIs, Entregas, Pipeline, Entrada de pares,
// Hoja de recepción y tabla de Expedientes (Cronograma React)
// Sprint 2026-06-10 (rev2) · Agente responsable: [AG-03 FRONTEND]
//
// Paridad con los tabs del antiguo Resumen .html, con animaciones
// framer-motion y visibilidad por rol (R3): los precios de la fila
// expandida respetan `isClient`.
// Cada componente recibe `enriched`: [{ it, segs, delivery }].
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  STAGES, STAGE_LABELS, STAGE_COLORS, fmtShort, today,
} from "../../lib/cronogramaData.js";

const fInt = (n) => Number(n || 0).toLocaleString("es-CR");
const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyOf = (l) => Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0;
const stagger = {
  hidden: { opacity: 0, y: 8 },
  show: (i) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.4), duration: 0.25 } }),
};
const selStyle = { padding: "5px 10px", fontSize: 12.5 };
const lblStyle = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase" };

function llegaCell(delivery, lang) {
  if (!delivery.date) return <span style={{ color: "var(--text-tertiary, #CBD5E1)" }}>—</span>;
  if (delivery.done) return <span style={{ color: "#13B98A", fontWeight: 700 }}>{lang === "es" ? "entregado" : "delivered"}</span>;
  return <span className="tabular-nums">{fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}</span>;
}

/* ── KPIs ──────────────────────────────────────────────────── */
export function KpiStrip({ enriched, lang = "es" }) {
  const items = enriched.map((e) => e.it);
  const delivered = items.filter((it) => it.estado === "EN_DESTINO" || it.estado === "CERRADO").length;
  const transit = items.filter((it) => it.estado === "TRANSITO").length;
  const porSalir = items.filter((it) => ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO"].includes(it.estado)).length;
  const pares = items.reduce((a, it) => a + (it.volumen || 0), 0);
  const kpis = [
    [lang === "es" ? "Expedientes" : "Files", items.length],
    [lang === "es" ? "Entregados" : "Delivered", delivered],
    [lang === "es" ? "En tránsito" : "In transit", transit],
    [lang === "es" ? "Por salir" : "To ship", porSalir],
    [lang === "es" ? "Pares totales" : "Total pairs", fInt(pares)],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      {kpis.map(([label, value], i) => (
        <motion.div key={label} custom={i} variants={stagger} initial="hidden" animate="show"
                    whileHover={{ y: -2, boxShadow: "0 8px 20px rgba(1,58,87,0.10)" }}
                    className="card" style={{ padding: "12px 16px", borderRadius: 12 }}>
          <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "#0B1E3A" }}>{value}</div>
          <div className="caption" style={{ ...lblStyle, fontSize: 10 }}>{label}</div>
        </motion.div>
      ))}
    </div>
  );
}

/* ── Próximas entregas ─────────────────────────────────────── */
export function UpcomingDeliveries({ enriched, lang = "es", labelOf, onOpen }) {
  const rows = enriched
    .filter((e) => e.delivery.date)
    .sort((a, b) => {
      if (a.delivery.done !== b.delivery.done) return a.delivery.done ? 1 : -1;
      return a.delivery.done ? b.delivery.date - a.delivery.date : a.delivery.date - b.delivery.date;
    });
  if (!rows.length) {
    return <div className="caption" style={{ padding: 18, textAlign: "center", color: "var(--text-tertiary)" }}>
      {lang === "es" ? "Sin fechas de entrega." : "No delivery dates."}
    </div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
      {rows.map(({ it, delivery }, i) => {
        const dias = Math.round((delivery.date - today()) / 86400000);
        return (
          <motion.div key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                      whileHover={{ y: -3, boxShadow: "0 10px 24px rgba(1,58,87,0.12)" }}
                      onClick={() => onOpen && onOpen(it)}
                      className="card"
                      style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", borderTop: `3px solid ${delivery.done ? "#13B98A" : "#013A57"}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0B1E3A" }}>
              {labelOf(it)}
              <span className="tabular-nums" style={{ fontWeight: 700, color: "var(--text-secondary, #475569)" }}>
                {" · "}{fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}
              </span>
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 3 }}>
              {fInt(it.volumen)} prs · {it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)")} · {it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client")}
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: delivery.done ? "#13B98A" : (dias <= 7 ? "#F59E0B" : "#0FA3A0") }}/>
              {delivery.done
                ? (lang === "es" ? "Entregado" : "Delivered")
                : (dias <= 0
                    ? (lang === "es" ? "entrega hoy/vencida" : "due today/overdue")
                    : (lang === "es" ? `en ${dias} días` : `in ${dias} days`))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── Pipeline por estado (kanban) ──────────────────────────── */
export function PipelineBoard({ enriched, lang = "es", labelOf, onOpen }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  const by = {};
  STAGES.forEach((s) => { by[s] = []; });
  enriched.forEach((e) => { (by[e.it.estado] || (by[e.it.estado] = [])).push(e); });
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(130px, 1fr))`, gap: 8, overflowX: "auto" }}>
      {STAGES.map((s) => (
        <div key={s} style={{ background: "var(--surface-alt, #F6F8FB)", borderRadius: 12, padding: 8, minHeight: 120 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "2px 4px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: STAGE_COLORS[s] }}/>
            <span style={{ ...lblStyle, color: "var(--text-secondary, #475569)" }}>{L[s]}</span>
            <span className="tabular-nums" style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, background: "#fff", borderRadius: 99, padding: "1px 7px", color: "var(--text-tertiary)" }}>
              {(by[s] || []).length}
            </span>
          </div>
          {(by[s] || []).map(({ it, delivery }, i) => (
            <motion.div key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                        whileHover={{ y: -2, boxShadow: "0 8px 18px rgba(1,58,87,0.12)" }}
                        onClick={() => onOpen && onOpen(it)}
                        style={{ background: "#fff", borderRadius: 10, padding: "9px 10px", marginBottom: 7, cursor: "pointer", border: "1px solid var(--border-subtle, #E1E6ED)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0B1E3A" }}>{labelOf(it)}</div>
              <div className="caption tabular-nums" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                {fInt(it.volumen)} prs · {it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air")}
              </div>
              {delivery.date && (
                <div className="caption tabular-nums" style={{ marginTop: 4, color: delivery.done ? "#13B98A" : "var(--text-secondary, #475569)", fontWeight: 700 }}>
                  {delivery.done ? (lang === "es" ? "Entregado " : "Delivered ") : (lang === "es" ? "Llega " : "ETA ")}
                  {fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Entrada de pares (tabla plana modelo × talla) ─────────── */
export function PairsTable({ enriched, lang = "es", labelOf }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  const [modelo, setModelo] = useState("ALL");
  const [orden, setOrden] = useState("modelo");

  const rows = useMemo(() => {
    const out = [];
    enriched.forEach(({ it, delivery }) => {
      (it.lineas || []).forEach((l) => {
        out.push({
          modelo: l.product_label || l.sku || "—",
          talla: l.size || "—",
          qty: qtyOf(l),
          delivery,
          estado: L[it.estado] || it.estado,
          ref: `${labelOf(it)}${it.ocCodigo && labelOf(it).indexOf(it.ocCodigo) < 0 ? " / PO " + it.ocCodigo : ""}`,
        });
      });
    });
    return out;
  }, [enriched, labelOf, L]);

  const modelos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.modelo))).sort(),
    [rows]
  );

  const visibles = useMemo(() => {
    const f = modelo === "ALL" ? rows : rows.filter((r) => r.modelo === modelo);
    return [...f].sort((a, b) => orden === "fecha"
      ? ((a.delivery.date ? a.delivery.date.getTime() : Infinity) - (b.delivery.date ? b.delivery.date.getTime() : Infinity))
        || a.modelo.localeCompare(b.modelo) || (Number(a.talla) - Number(b.talla))
      : a.modelo.localeCompare(b.modelo) || (Number(a.talla) - Number(b.talla)));
  }, [rows, modelo, orden]);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={lblStyle}>{lang === "es" ? "Modelo" : "Model"}</span>
        <select className="input" value={modelo} onChange={(e) => setModelo(e.target.value)} style={selStyle}>
          <option value="ALL">{lang === "es" ? "Todos" : "All"}</option>
          {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={lblStyle}>{lang === "es" ? "Ordenar" : "Sort"}</span>
        <select className="input" value={orden} onChange={(e) => setOrden(e.target.value)} style={selStyle}>
          <option value="modelo">{lang === "es" ? "Modelo / talla" : "Model / size"}</option>
          <option value="fecha">{lang === "es" ? "Fecha de llegada" : "Arrival date"}</option>
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{lang === "es" ? "Modelo" : "Model"}</th>
              <th style={{ textAlign: "right" }}>{lang === "es" ? "Talla" : "Size"}</th>
              <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
              <th>{lang === "es" ? "Llega" : "Arrives"}</th>
              <th>{lang === "es" ? "Estado" : "State"}</th>
              <th>{lang === "es" ? "Exped (OC)" : "File (PO)"}</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={6} className="caption" style={{ textAlign: "center", padding: 16, color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Sin datos." : "No data."}
              </td></tr>
            )}
            {visibles.map((r, i) => (
              <motion.tr key={i} custom={Math.min(i, 12)} variants={stagger} initial="hidden" animate="show">
                <td>{r.modelo}</td>
                <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{r.talla}</td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>{fInt(r.qty)}</td>
                <td>{llegaCell(r.delivery, lang)}</td>
                <td>{r.estado}</td>
                <td className="mono-sm">{r.ref}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Hoja de recepción (matriz de tallas por expediente) ───── */
function SizeMatrix({ lineas, lang }) {
  const sizes = Array.from(new Set(lineas.map((l) => l.size).filter(Boolean)))
    .sort((a, b) => Number(a) - Number(b));
  const byModelo = new Map();
  lineas.forEach((l) => {
    const k = l.product_label || l.sku || "—";
    const g = byModelo.get(k) || {};
    g[l.size] = (g[l.size] || 0) + qtyOf(l);
    byModelo.set(k, g);
  });
  const colTot = {};
  let grand = 0;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>{lang === "es" ? "Modelo" : "Model"}</th>
            {sizes.map((s) => <th key={s} className="tabular-nums" style={{ textAlign: "right" }}>{s}</th>)}
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byModelo.entries()).map(([m, g]) => {
            let rt = 0;
            const cells = sizes.map((s) => {
              const q = g[s] || 0;
              if (q) { colTot[s] = (colTot[s] || 0) + q; rt += q; }
              return <td key={s} className="tabular-nums" style={{ textAlign: "right", color: q ? undefined : "var(--text-tertiary, #E2E8F0)" }}>{q || "·"}</td>;
            });
            grand += rt;
            return (
              <tr key={m}>
                <td style={{ fontWeight: 700 }}>{m}</td>
                {cells}
                <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 800 }}>{fInt(rt)}</td>
              </tr>
            );
          })}
          <tr style={{ background: "rgba(1,58,87,0.05)", fontWeight: 700 }}>
            <td>Total</td>
            {sizes.map((s) => <td key={s} className="tabular-nums" style={{ textAlign: "right" }}>{colTot[s] || ""}</td>)}
            <td className="tabular-nums" style={{ textAlign: "right" }}>{fInt(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ReceptionSheet({ enriched, lang = "es", labelOf, onOpen }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  const [show, setShow] = useState("all");
  const [modelo, setModelo] = useState("ALL");
  const modelos = useMemo(() => Array.from(new Set(
    enriched.flatMap(({ it }) => (it.lineas || []).map((l) => l.product_label || l.sku))
  )).filter(Boolean).sort(), [enriched]);

  const cards = useMemo(() => {
    let list = [...enriched];
    if (show === "pend") list = list.filter((e) => !e.delivery.done);
    if (show === "done") list = list.filter((e) => e.delivery.done);
    return list.sort((a, b) =>
      (a.delivery.date ? a.delivery.date.getTime() : Infinity)
      - (b.delivery.date ? b.delivery.date.getTime() : Infinity));
  }, [enriched, show]);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={lblStyle}>{lang === "es" ? "Mostrar" : "Show"}</span>
        <select className="input" value={show} onChange={(e) => setShow(e.target.value)} style={selStyle}>
          <option value="all">{lang === "es" ? "Todos" : "All"}</option>
          <option value="pend">{lang === "es" ? "Por llegar" : "Incoming"}</option>
          <option value="done">{lang === "es" ? "Entregados" : "Delivered"}</option>
        </select>
        <span style={lblStyle}>{lang === "es" ? "Modelo" : "Model"}</span>
        <select className="input" value={modelo} onChange={(e) => setModelo(e.target.value)} style={selStyle}>
          <option value="ALL">{lang === "es" ? "Todos" : "All"}</option>
          {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {cards.length === 0 && (
        <div className="caption" style={{ padding: 18, textAlign: "center", color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Sin llegadas con este filtro." : "No arrivals with this filter."}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map(({ it, delivery }, i) => {
          const lineas = modelo === "ALL"
            ? (it.lineas || [])
            : (it.lineas || []).filter((l) => (l.product_label || l.sku) === modelo);
          if (modelo !== "ALL" && !lineas.length) return null;
          return (
            <motion.div key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                        className="card" style={{ padding: "14px 16px", borderRadius: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <span onClick={() => onOpen && onOpen(it)}
                      style={{ fontSize: 14, fontWeight: 800, color: "#013A57", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                  {labelOf(it)}
                </span>
                {it.ocCodigo && labelOf(it).indexOf(it.ocCodigo) < 0 && (
                  <span className="caption" style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>OC PO {it.ocCodigo}</span>
                )}
                <b className="tabular-nums" style={{ color: "#0B1E3A" }}>{fInt(it.volumen)} prs</b>
                <span style={{
                  marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                  background: delivery.done ? "rgba(19,185,138,0.12)" : "rgba(1,58,87,0.08)",
                  color: delivery.done ? "#0B7A5C" : "#013A57",
                }}>
                  {delivery.done
                    ? (lang === "es" ? "Entregado" : "Delivered")
                    : (delivery.date
                        ? `${lang === "es" ? "Llega" : "ETA"} ${fmtShort(delivery.date, lang)}${delivery.est ? " (est.)" : ""}`
                        : (lang === "es" ? "Sin fecha" : "No date"))}
                </span>
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 10 }}>
                {[it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client"),
                  it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)"),
                  L[it.estado] || it.estado,
                  it.embarque ? `${lang === "es" ? "sale" : "ships"} ${it.embarque}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {lineas.length
                ? <SizeMatrix lineas={lineas} lang={lang}/>
                : <div className="caption" style={{ color: "var(--text-tertiary)" }}>{lang === "es" ? "Sin desglose." : "No breakdown."}</div>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tabla de expedientes (agrupable + fila expandible) ────── */
function LineasDetail({ it, isClient, lang }) {
  // Agrupa líneas por SKU → tallas chips. Precios por rol (R3).
  const bySku = new Map();
  (it.lineas || []).forEach((l) => {
    const g = bySku.get(l.sku) || { sku: l.sku || "—", modelo: l.product_label || "—", qty: 0, amountCli: 0, amountMwt: 0, unitCli: Number(l.unit_price_client) || 0, unitMwt: Number(l.unit_price_mwt) || 0, sizes: [] };
    const q = qtyOf(l);
    g.qty += q;
    g.amountCli += q * (Number(l.unit_price_client) || 0);
    g.amountMwt += q * (Number(l.unit_price_mwt) || 0);
    if (l.size) g.sizes.push([l.size, q]);
    bySku.set(l.sku, g);
  });
  const rows = Array.from(bySku.values());
  const totQty = rows.reduce((a, r) => a + r.qty, 0);
  const totCli = rows.reduce((a, r) => a + r.amountCli, 0);
  const totMwt = rows.reduce((a, r) => a + r.amountMwt, 0);
  return (
    <table className="table" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>{lang === "es" ? "Código" : "Code"}</th>
          <th>{lang === "es" ? "Modelo" : "Model"}</th>
          <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
          {!isClient && <th style={{ textAlign: "right" }}>{lang === "es" ? "P. MWT" : "MWT price"}</th>}
          <th style={{ textAlign: "right" }}>{lang === "es" ? "P. Cliente" : "Client price"}</th>
          <th style={{ textAlign: "right" }}>Total</th>
          <th>{lang === "es" ? "Tallas" : "Sizes"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.sku}>
            <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>{r.sku}</td>
            <td>{r.modelo}</td>
            <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{fInt(r.qty)}</td>
            {!isClient && <td className="tabular-nums" style={{ textAlign: "right" }}>{usd(r.unitMwt)}</td>}
            <td className="tabular-nums" style={{ textAlign: "right" }}>{usd(r.unitCli)}</td>
            <td className="tabular-nums" style={{ textAlign: "right" }}>{usd(isClient ? r.amountCli : (it.operadoPorMwt ? r.amountMwt : r.amountCli))}</td>
            <td>
              {r.sizes.sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, q]) => (
                <span key={s} className="tabular-nums" style={{ display: "inline-block", fontSize: 10.5, padding: "1px 7px", borderRadius: 999, background: "rgba(1,58,87,0.06)", marginRight: 4, marginBottom: 2 }}>
                  <b>{s}</b> {q}
                </span>
              ))}
            </td>
          </tr>
        ))}
        <tr style={{ background: "rgba(1,58,87,0.05)", fontWeight: 700 }}>
          <td colSpan={2}>Total</td>
          <td className="tabular-nums" style={{ textAlign: "right" }}>{fInt(totQty)}</td>
          {!isClient && <td className="tabular-nums" style={{ textAlign: "right" }}>{usd(totMwt)}</td>}
          <td></td>
          <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286" }}>{usd(isClient ? totCli : (it.operadoPorMwt ? totMwt : totCli))}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );
}

export function ExpedientesTable({ enriched, lang = "es", labelOf, onOpen, isClient = false }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  const [grp, setGrp] = useState("none");
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const groups = useMemo(() => {
    if (grp === "none") return [["", enriched]];
    const keyOf = (e) => grp === "oc" ? (e.it.ocCodigo || "(sin OC)")
      : grp === "operador" ? (e.it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client"))
      : (L[e.it.estado] || e.it.estado);
    const m = new Map();
    enriched.forEach((e) => { (m.get(keyOf(e)) || m.set(keyOf(e), []).get(keyOf(e))).push(e); });
    return Array.from(m.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [enriched, grp, lang, L]);

  const COLS = isClient ? 8 : 9;

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
        <span style={lblStyle}>{lang === "es" ? "Agrupar por" : "Group by"}</span>
        <select className="input" value={grp} onChange={(e) => setGrp(e.target.value)} style={selStyle}>
          <option value="none">{lang === "es" ? "Sin agrupar" : "No grouping"}</option>
          <option value="oc">OC</option>
          <option value="operador">{lang === "es" ? "Operador" : "Operator"}</option>
          <option value="estado">{lang === "es" ? "Estado" : "State"}</option>
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{lang === "es" ? "Exped." : "File"}</th>
              <th>OC</th>
              {!isClient && <th>{lang === "es" ? "Cliente" : "Client"}</th>}
              <th>{lang === "es" ? "Operador" : "Operator"}</th>
              <th>{lang === "es" ? "Modo" : "Mode"}</th>
              <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
              <th>{lang === "es" ? "Estado" : "State"}</th>
              <th>{lang === "es" ? "Embarque" : "Shipped"}</th>
              <th>{lang === "es" ? "Entrega / ETA" : "Delivery / ETA"}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([gkey, list]) => (
              <React.Fragment key={gkey || "_all"}>
                {gkey && (
                  <tr style={{ background: "rgba(1,58,87,0.06)" }}>
                    <td colSpan={COLS} style={{ fontWeight: 800, fontSize: 11.5, letterSpacing: 0.4 }}>
                      {gkey} · {list.length} exped. · {fInt(list.reduce((a, e) => a + e.it.volumen, 0))} {lang === "es" ? "pares" : "pairs"}
                    </td>
                  </tr>
                )}
                {list.map(({ it, delivery }) => {
                  const isOpen = open.has(it.id);
                  return (
                    <React.Fragment key={it.id}>
                      <tr onClick={() => toggle(it.id)} style={{ cursor: "pointer", background: isOpen ? "rgba(19,185,138,0.05)" : undefined }}>
                        <td style={{ fontWeight: 800, color: "var(--brand-primary, #013A57)", whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .18s ease", marginRight: 6, fontSize: 10 }}>▸</span>
                          <span onClick={(e) => { e.stopPropagation(); onOpen && onOpen(it); }}
                                title={lang === "es" ? "Ver SKUs y precios" : "View SKUs & prices"}
                                style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                            {labelOf(it)}
                          </span>
                        </td>
                        <td className="mono-sm">{it.ocCodigo ? `PO ${it.ocCodigo}` : "—"}</td>
                        {!isClient && <td style={{ maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.cliente || "—"}</td>}
                        <td>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: "rgba(1,58,87,0.08)", color: "#013A57" }}>
                            {it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client")}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: "rgba(15,163,160,0.10)", color: "#0B7E8F" }}>
                            {(it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air")).toUpperCase()}
                          </span>
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{fInt(it.volumen)}</td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: STAGE_COLORS[it.estado] || "#94A7B8" }}/>
                            {L[it.estado] || it.estado}
                          </span>
                        </td>
                        <td className="tabular-nums">{it.embarque || "—"}</td>
                        <td className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
                          {delivery.date
                            ? <>
                                {fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}
                                {delivery.done && <span style={{ color: "#13B98A", fontWeight: 800 }}> OK</span>}
                              </>
                            : "—"}
                        </td>
                      </tr>
                      <AnimatePresence>
                        {isOpen && (
                          <tr>
                            <td colSpan={COLS} style={{ padding: 0, background: "var(--surface-alt, #FBFCFE)" }}>
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                                          exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                                          style={{ overflow: "hidden", padding: "10px 14px" }}>
                                <LineasDetail it={it} isClient={isClient} lang={lang}/>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
