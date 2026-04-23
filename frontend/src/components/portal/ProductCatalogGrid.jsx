// =====================================================================
// MWT.ONE · components/portal/ProductCatalogGrid.jsx
// Agente responsable: [AG-FRONTEND]
//
// Grid de cards del catálogo B2B del Portal del Cliente.
// Consume GET /api/portal/products/?limit=…&offset=…
//
// Design tokens (var(--navy) / var(--mint) / font-family 'tabular-nums'):
//   - Card: bordes sutiles + hover lift con framer-motion
//   - SKU: font-family monospace
//   - Marca: badge compacto
//   - Botón "Comprar": .btn .btn-primary (usa --btn-primary del tokens.css)
//
// Reglas (POL_VISIBILIDAD · defensa en profundidad):
//   El backend YA strip-down los campos CEO-ONLY. Acá sólo consumimos
//   los campos whitelist del ProductPortalListSerializer. Si el payload
//   trajera por error un campo sensible (costo_estandar, precio_mwt),
//   no lo renderizaríamos porque los selectores están hard-coded a los
//   nombres seguros — pero igualmente el backend es la autoridad.
// =====================================================================
import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { apiFetch, getToken } from "../../lib/api.js";
import { fmtMoney } from "../../lib/i18n.js";


export default function ProductCatalogGrid({ lang = "es", onBuy }) {
  const [items,   setItems]   = useState([]);
  const [count,   setCount]   = useState(0);
  const [offset,  setOffset]  = useState(0);
  const [limit]   = useState(24);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [q,       setQ]       = useState("");

  // Fetch paginado
  const fetchPage = useCallback(async (nextOffset, qOverride) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit",  String(limit));
      params.set("offset", String(nextOffset));
      const qValue = qOverride !== undefined ? qOverride : q;
      if (qValue) params.set("q", qValue);
      const token = getToken();
      const data = await apiFetch(`/portal/products/?${params.toString()}`, { token });
      setItems(data?.results || []);
      setCount(data?.count || 0);
      setOffset(nextOffset);
    } catch (e) {
      setError(e?.message || "No se pudo cargar el catálogo.");
    } finally {
      setLoading(false);
    }
  }, [limit, q]);

  // Primer carga
  useEffect(() => { fetchPage(0, ""); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const hasPrev = offset > 0;
  const hasNext = offset + limit < count;

  const navigate = useNavigate();
  const handleOpenDetail = useCallback((productId) => {
    // Navega al ProductFormView en modo lectura (isClient → TABS filtradas)
    navigate(`/portal/productos/${productId}`);
  }, [navigate]);

  const handleBuy = useCallback((p) => {
    if (onBuy) { onBuy(p); return; }
    // Fallback: redirige al wizard de nueva OC con el SKU pre-seleccionado
    navigate(`/portal/nueva-oc?sku=${encodeURIComponent(p.sku)}`);
  }, [onBuy, navigate]);

  return (
    <div className="portal-catalog">
      {/* ── Header + buscador ── */}
      <div className="catalog-head">
        <div className="catalog-title">
          {lang === "es" ? "Catálogo de Productos" : "Product Catalog"}
          <span className="catalog-count">{count} {lang==="es"?"productos":"products"}</span>
        </div>
        <input
          type="text"
          className="input catalog-search"
          placeholder={lang === "es" ? "Buscar por nombre o SKU…" : "Search by name or SKU…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") fetchPage(0); }}
        />
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="catalog-error">
          <span role="img" aria-label="warn">⚠️</span> {error}
        </div>
      )}

      {/* ── Grid ── */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={`grid-${offset}-${q}`}
          className="catalog-grid"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{    opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {loading && items.length === 0 && (
            <SkeletonCards n={8} />
          )}
          {!loading && items.length === 0 && !error && (
            <div className="catalog-empty">
              {lang === "es"
                ? "No hay productos en tu catálogo todavía."
                : "No products in your catalog yet."}
            </div>
          )}
          {items.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              lang={lang}
              onOpenDetail={() => handleOpenDetail(p.id)}
              onBuy={() => handleBuy(p)}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* ── Paginación ── */}
      {(hasPrev || hasNext) && (
        <div className="catalog-pager">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!hasPrev || loading}
            onClick={() => fetchPage(Math.max(offset - limit, 0))}
          >
            ← {lang === "es" ? "Anterior" : "Previous"}
          </button>
          <span className="caption tabular-nums">
            {offset + 1}–{Math.min(offset + items.length, count)} / {count}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!hasNext || loading}
            onClick={() => fetchPage(offset + limit)}
          >
            {lang === "es" ? "Siguiente" : "Next"} →
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// ProductCard · una tarjeta del grid
// ---------------------------------------------------------------------
function ProductCard({ product, lang, onOpenDetail, onBuy }) {
  const {
    sku, nombre, descripcion,
    marca_label, imagen_url,
    moneda = "USD",
    precio_venta, categoria, estado,
  } = product || {};

  return (
    <motion.article
      whileHover={{ y: -4, boxShadow: "0 6px 18px rgba(11,30,58,0.10)" }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="catalog-card"
      onClick={onOpenDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenDetail(); }}
    >
      {/* Thumbnail */}
      <div className="catalog-card-thumb" aria-hidden="true">
        {imagen_url ? (
          <img src={imagen_url} alt={nombre || sku} loading="lazy" />
        ) : (
          <div className="catalog-card-thumb-placeholder">
            <span style={{ fontSize: 32, opacity: 0.4 }}>📦</span>
          </div>
        )}
        {estado && estado !== "ACTIVO" && (
          <span className="catalog-card-badge-muted">
            {estado}
          </span>
        )}
      </div>

      {/* Cuerpo */}
      <div className="catalog-card-body">
        {marca_label && (
          <span className="catalog-card-brand-badge">{marca_label}</span>
        )}
        <h3 className="catalog-card-name">{nombre || "(Sin nombre)"}</h3>
        <div className="catalog-card-sku" style={{ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)" }}>
          SKU: <code>{sku}</code>
        </div>
        {descripcion && (
          <p className="catalog-card-desc">{descripcion}</p>
        )}
        {categoria && (
          <span className="catalog-card-cat">{categoria}</span>
        )}
      </div>

      {/* Footer con precio + CTA */}
      <footer className="catalog-card-foot">
        <div className="catalog-card-price tabular-nums">
          {precio_venta != null && precio_venta > 0
            ? fmtMoney(precio_venta, moneda)
            : (lang === "es" ? "Consultar precio" : "Quote on request")}
        </div>
        <button
          type="button"
          className="btn btn-primary catalog-card-cta"
          onClick={(e) => { e.stopPropagation(); onBuy(); }}
        >
          {lang === "es" ? "Comprar" : "Buy"}
        </button>
      </footer>
    </motion.article>
  );
}


// ---------------------------------------------------------------------
// Skeleton loader (mientras llega la 1ra page)
// ---------------------------------------------------------------------
function SkeletonCards({ n = 8 }) {
  return Array.from({ length: n }).map((_, i) => (
    <div
      key={`skel-${i}`}
      className="catalog-card catalog-card-skeleton"
      aria-hidden="true"
    >
      <div className="catalog-card-thumb catalog-card-thumb-placeholder" />
      <div className="catalog-card-body">
        <div className="skel-line skel-line-60" />
        <div className="skel-line skel-line-90" />
        <div className="skel-line skel-line-40" />
      </div>
      <div className="catalog-card-foot">
        <div className="skel-line skel-line-40" />
        <div className="skel-pill" />
      </div>
    </div>
  ));
}
