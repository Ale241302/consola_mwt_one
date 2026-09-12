// frontend/src/components/ui/TablePagination.jsx
// Sprint 2026-09-12 · Paginación reutilizable para tablas densas.
// - Hook usePagination: corta la lista y expone estado de página.
// - Componente TablePagination: selector de tamaño (5/10/20/50/100) +
//   navegación prev/next + rango visible.
import React, { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

export function usePagination(items, { defaultPerPage = 20 } = {}) {
  const list = Array.isArray(items) ? items : [];
  const [perPage, setPerPage] = useState(defaultPerPage);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const safePage = Math.min(page, totalPages);

  // Al cambiar el tamaño de página (o el dataset) se vuelve a la página 1.
  useEffect(() => { setPage(1); }, [perPage, list.length]);

  const pageItems = useMemo(
    () => list.slice((safePage - 1) * perPage, safePage * perPage),
    [list, safePage, perPage],
  );

  return {
    pageItems,
    page: safePage,
    setPage,
    perPage,
    setPerPage,
    totalPages,
    total: list.length,
  };
}

export function TablePagination({
  page, totalPages, perPage, setPerPage, setPage, total, lang = "es",
}) {
  const es = lang !== "en";
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "flex-end",
      flexWrap: "wrap", gap: 10, marginTop: 12,
    }}>
      <span style={{ fontSize: 12, color: "var(--text-tertiary, #94A3B8)" }}>
        {es ? `${from}–${to} de ${total}` : `${from}–${to} of ${total}`}
      </span>
      <label style={{
        fontSize: 12, color: "var(--text-tertiary, #94A3B8)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {es ? "Por página:" : "Per page:"}
        <select
          value={perPage}
          onChange={(e) => setPerPage(Number(e.target.value))}
          style={{
            padding: "4px 8px", border: "1px solid var(--border, #CBD5E1)",
            borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: "var(--surface, #fff)", cursor: "pointer",
          }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={btnStyle(page <= 1)}>‹</button>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary, #475569)" }}>
        {page} / {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={btnStyle(page >= totalPages)}>›</button>
    </div>
  );
}

function btnStyle(disabled) {
  return {
    padding: "4px 12px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
    fontSize: 14, fontWeight: 700, background: "var(--surface, #fff)",
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "var(--text-tertiary, #94A3B8)" : "var(--text-primary, #0F172A)",
  };
}

export default TablePagination;
