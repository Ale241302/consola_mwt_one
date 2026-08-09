// MWT.ONE · components/ui/VirtualTable.jsx
// Tabla con virtualización opcional: bajo umbral o imprimiendo renderiza
// una <table> normal; con muchas filas virtualiza el cuerpo.
//
// DOS modos:
//   · Modo columnas (simple): pasa `columns` + `rows`; el componente
//     arma thead y render de celdas por columna.
//   · Modo render propio (complejo): pasa `thead` (nodo JSX) y/o
//     `renderRow(row)` para tablas con filas especiales (fusión,
//     skeleton, columnas por rol). El componente sigue manejando la
//     virtualización, el fallback de umbral y la desactivación en print.
//
// Ola 3 · 3.27 · Virtualización.
import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useIsPrinting } from "../../lib/useIsPrinting.js";
import { shouldVirtualize } from "../../lib/virtualTableLogic.js";

/**
 * @typedef {object} Column
 * @property {string} key
 * @property {string} header
 * @property {string} [className]
 * @property {"left"|"right"|"center"} [align]
 * @property {(row:any)=>any} [render]
 */

/**
 * @param {object} props
 * @param {Column[]} [props.columns]
 * @param {React.ReactNode} [props.thead] nodo <thead> custom (modo complejo)
 * @param {any[]} props.rows
 * @param {(row:any)=>string|number} props.rowKey
 * @param {(row:any)=>React.ReactNode} [props.renderRow] render de fila custom
 * @param {React.ReactNode} [props.loadingSkeleton] nodo skeleton cuando rows vacías
 * @param {number} [props.threshold] filas mínimas para virtualizar (default 60)
 * @param {number} [props.estimateRowHeight] px estimados por fila (default 44)
 * @param {number} [props.maxHeight] alto del viewport virtual (default 640)
 * @param {string} [props.className]
 * @param {string} [props.emptyLabel]
 */
export default function VirtualTable({
  columns = [],
  thead,
  rows = [],
  rowKey,
  renderRow,
  loadingSkeleton,
  threshold,
  estimateRowHeight = 44,
  maxHeight = 640,
  className = "",
  emptyLabel = "Sin datos",
}) {
  const printing = useIsPrinting();
  const virtualize = shouldVirtualize(rows.length, threshold, printing);
  const scrollRef = useRef(null);

  // thead custom (modo complejo) o auto-armado desde columns.
  const Head = thead || (
    <thead>
      <tr>
        {columns.map((c) => (
          <th
            key={c.key}
            className={[c.className, c.align === "right" || c.align === "center" ? c.align : ""].filter(Boolean).join(" ") || undefined}
            style={c.align ? { textAlign: c.align } : undefined}
          >
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderRowDefault = (row) => (
    <tr key={rowKey(row)}>
      {columns.map((c) => (
        <td
          key={c.key}
          className={[c.className, c.align === "right" || c.align === "center" ? c.align : ""].filter(Boolean).join(" ") || undefined}
          style={c.align ? { textAlign: c.align } : undefined}
        >
          {c.render ? c.render(row) : row[c.key]}
        </td>
      ))}
    </tr>
  );
  const renderRowFinal = renderRow || renderRowDefault;
  const colSpan = columns.length || 99;

  if (!virtualize) {
    return (
      <table className={`mwt-table ${className}`}>
        {Head}
        <tbody>
          {rows.length === 0 && loadingSkeleton}
          {rows.length === 0 && !loadingSkeleton && emptyLabel != null
            ? <tr><td colSpan={colSpan} className="mwt-table-empty">{emptyLabel}</td></tr>
            : rows.map((r) => {
                const el = renderRowFinal(r);
                return React.isValidElement(el)
                  ? React.cloneElement(el, { key: rowKey(r) })
                  : <tr key={rowKey(r)}>{el}</tr>;
              })}
        </tbody>
      </table>
    );
  }

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
  });
  const items = virt.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div ref={scrollRef} className="mwt-vtable-scroll" style={{ maxHeight, overflow: "auto" }}>
      <table className={`mwt-table ${className}`}>
        {Head}
        <tbody>
          {rows.length === 0 && loadingSkeleton}
          {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={colSpan} /></tr>}
          {items.map((vi) => {
            const row = rows[vi.index];
            const tr = renderRowFinal(row);
            return tr && React.isValidElement(tr)
              ? React.cloneElement(tr, {
                  key: rowKey(row),
                  "data-index": vi.index,
                  ref: virt.measureElement,
                })
              : <tr key={rowKey(row)} data-index={vi.index} ref={virt.measureElement}>{tr}</tr>;
          })}
          {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={colSpan} /></tr>}
        </tbody>
      </table>
    </div>
  );
}
