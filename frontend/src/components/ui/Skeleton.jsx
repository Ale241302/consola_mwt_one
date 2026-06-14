// =====================================================================
// MWT.ONE · Skeleton — placeholders de carga reutilizables
// Agente responsable: [AG-FRONTEND]
//
// Problema (Auditoría de carga · 2026-06-14): las vistas de listado
// renderizaban la tabla VACÍA mientras cargaban (la bandera `loading`
// existía pero no se consumía) → el usuario veía pantalla en blanco /
// "Sin resultados" durante 1-2 s y creía que el sitio estaba roto.
//
// Reutiliza la animación `skelShimmer` ya definida en styles/app.css.
// Sin hex hardcodeados (R1): los colores salen de tokens CSS / .mwt-skel.
// =====================================================================
import React from "react";

/**
 * Bloque rectangular con shimmer.
 * @param {object} props
 * @param {number|string} [props.height=16]
 * @param {number|string} [props.width="100%"]
 * @param {number} [props.radius=6]
 * @param {object} [props.style]
 */
export function Skeleton({ height = 16, width = "100%", radius = 6, style }) {
  return (
    <span
      className="mwt-skel"
      aria-hidden="true"
      style={{
        display: "block",
        height: typeof height === "number" ? `${height}px` : height,
        width: typeof width === "number" ? `${width}px` : width,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

/**
 * Varias líneas de texto fantasma.
 * @param {object} props
 * @param {number} [props.lines=3]
 */
export function SkeletonText({ lines = 3, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={10} width={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

/**
 * Filas fantasma para un <tbody>. Devuelve <tr> con una sola celda que
 * ocupa todo el ancho (colSpan grande, seguro ante columnas dinámicas).
 * @param {object} props
 * @param {number} [props.rows=8]
 * @param {number} [props.colSpan=99]
 */
export function TableSkeletonRows({ rows = 8, colSpan = 99 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="mwt-skel-row" aria-hidden="true">
          <td colSpan={colSpan} style={{ padding: "10px 12px" }}>
            <Skeleton height={14} width={`${65 + ((i * 7) % 30)}%`} />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Grilla de tarjetas fantasma (KPIs, listados tipo card).
 * @param {object} props
 * @param {number} [props.count=4]
 * @param {number} [props.height=96]
 */
export function SkeletonCards({ count = 4, height = 96, style }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(180px, 1fr))`,
        gap: 12,
        ...style,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} radius={12} />
      ))}
    </div>
  );
}

export default Skeleton;
