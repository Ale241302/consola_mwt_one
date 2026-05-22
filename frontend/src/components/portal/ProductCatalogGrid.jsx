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
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { apiFetch, getToken } from "../../lib/api.js";
import { fmtMoney } from "../../lib/i18n.js";
import { bandaForTC } from "../../constants/marluvas.js";
import { useExchangeRateUSDBRL } from "../../hooks/useExchangeRateUSDBRL.js";


export default function ProductCatalogGrid({ lang = "es", onBuy, clientId }) {
  // ── Tasa USD/BRL en vivo + banda Marluvas activa ────────────────────
  // Sprint 2026-05-22 · El catálogo del Portal debe pintar el precio en
  // la moneda local (BRL para BR, USD canónico para los demás). Tomamos
  // la TC viva (AwesomeAPI + Frankfurter fallback) y buscamos la banda
  // Marluvas donde encaja (12 bandas de 0.20 desde 4.00). Multiplicamos
  // el `precio_venta` que el backend ya resuelve como "techo a 90d" vía
  // `resolve_client_price(client_id, brand, sku)` por `banda.div`. Si la
  // TC todavía no llegó, ProductCard pinta "Consultar precio".
  // Fix · `tcUsdBrl` y `bandaActiva` eran referenciados en línea 210-211
  // pero NUNCA se definían → ReferenceError al abrir la tab Productos.
  const { tc: tcUsdBrl } = useExchangeRateUSDBRL(getToken());
  const bandaActiva = useMemo(() => bandaForTC(tcUsdBrl), [tcUsdBrl]);
  const [items,   setItems]   = useState([]);
  const [count,   setCount]   = useState(0);
  const [offset,  setOffset]  = useState(0);
  const [limit]   = useState(24);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [q,       setQ]       = useState("");

  // ── Carrito (en memoria) ─────────────────────────────────────
  // Map<productId, {product, qty}>. Se persiste únicamente en el runtime
  // del portal — cuando el cliente pulsa "Procesar Pedido" lo mandamos
  // al CreateExpedienteWizard vía location.state (no localStorage para
  // no mezclar estado comercial entre sesiones).
  const [cart, setCart] = useState({});   // { [productId]: { product, qty } }

  const cartSummary = useMemo(() => {
    const entries = Object.values(cart);
    const units   = entries.reduce((a, it) => a + (Number(it.qty) || 0), 0);
    const subtotal = entries.reduce(
      (a, it) => a + (Number(it.qty) || 0) * (Number(it.product?.precio_venta) || 0),
      0,
    );
    const currency = entries[0]?.product?.moneda || "USD";
    return {
      count:    entries.length,
      units,
      subtotal,
      currency,
      isEmpty:  entries.length === 0,
    };
  }, [cart]);

  const setQty = useCallback((product, nextQty) => {
    const q = Math.max(0, Math.floor(Number(nextQty) || 0));
    setCart((prev) => {
      const next = { ...prev };
      if (q <= 0) {
        delete next[product.id];
      } else {
        next[product.id] = { product, qty: q };
      }
      return next;
    });
  }, []);

  const clearCart = useCallback(() => setCart({}), []);

  // Fetch paginado. El backend resuelve el scope del cliente en este orden:
  //   1. JWT claim portal_client_id  (cuando el claim esté en producción)
  //   2. Header X-Portal-Client       (dev / impersonation desde Tweaks panel)
  //   3. Query ?client_id=            (último fallback)
  // Siempre pasamos el header si el padre nos dio un clientId — esto es
  // consistente con portalApi.* en lib/api.js.
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
      const headers = clientId ? { "X-Portal-Client": clientId } : {};
      const data = await apiFetch(
        `/portal/products/?${params.toString()}`,
        { token, headers },
      );
      setItems(data?.results || []);
      setCount(data?.count || 0);
      setOffset(nextOffset);
    } catch (e) {
      setError(e?.message || "No se pudo cargar el catálogo.");
    } finally {
      setLoading(false);
    }
  }, [limit, q, clientId]);

  // Primer carga
  useEffect(() => { fetchPage(0, ""); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const hasPrev = offset > 0;
  const hasNext = offset + limit < count;

  const navigate = useNavigate();
  const handleOpenDetail = useCallback((productId) => {
    // Navega al ProductFormView en modo lectura (isClient → TABS filtradas)
    navigate(`/portal/productos/${productId}`);
  }, [navigate]);

  // Click en "Comprar" desde una card: agrega 1 unidad al carrito.
  // La navegación al wizard ocurre desde la barra flotante ("Procesar Pedido").
  const handleBuy = useCallback((p) => {
    if (onBuy) { onBuy(p); return; }
    setCart((prev) => {
      const existing = prev[p.id];
      const qty = (existing?.qty || 0) + 1;
      return { ...prev, [p.id]: { product: p, qty } };
    });
  }, [onBuy]);

  // "Procesar Pedido": salta al wizard (Paso 2 — Confirmar Productos)
  // con el carrito serializado en location.state.cartItems. Al reconstruir
  // el wizard, pre-siembra `state.lines` con estos items y setea idx=1
  // (Paso 2 en el flujo CLIENT de 3 pasos).
  const handleProcessOrder = useCallback(() => {
    const cartItems = Object.values(cart).map(({ product, qty }) => ({
      sku:          product.sku,
      descripcion:  product.nombre || product.descripcion || null,
      size:         null,
      qty:          Number(qty) || 1,
      unit_price:   Number(product.precio_venta) || 0,
      producto_id:  product.id,
      currency:     product.moneda || "USD",
    }));
    if (cartItems.length === 0) return;
    navigate("/portal/nueva-oc", {
      state: {
        cartItems,
        // Metadatos para que el wizard entre en modo "cart seed"
        entrySource: "portal_catalog_cart",
        jumpToStep:  "products",    // el wizard salta al Paso 2 si ve este flag
      },
    });
  }, [cart, navigate]);

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
              cartQty={cart[p.id]?.qty || 0}
              onChangeQty={(nq) => setQty(p, nq)}
              tcUsdBrl={tcUsdBrl}
              banda={bandaActiva}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* ── Barra flotante de carrito ── */}
      <AnimatePresence>
        {!cartSummary.isEmpty && (
          <motion.div
            key="cart-bar"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0,  opacity: 1 }}
            exit={{    y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="catalog-cart-bar"
            role="region"
            aria-label={lang === "es" ? "Carrito de pedido" : "Order cart"}
          >
            <div className="catalog-cart-summary">
              <div className="catalog-cart-summary-main">
                <span className="catalog-cart-badge">{cartSummary.count}</span>
                <div>
                  <div className="catalog-cart-summary-label">
                    {lang === "es" ? "Productos en pedido" : "Items in order"}
                  </div>
                  <div className="catalog-cart-summary-value tabular-nums">
                    {cartSummary.units} {lang === "es" ? "unidades" : "units"}
                    {" · "}
                    {fmtMoney(cartSummary.subtotal, cartSummary.currency)}
                  </div>
                </div>
              </div>
              <div className="catalog-cart-actions">
                <button
                  type="button"
                  className="btn btn-ghost catalog-cart-clear"
                  onClick={clearCart}
                >
                  {lang === "es" ? "Vaciar" : "Clear"}
                </button>
                <motion.button
                  type="button"
                  className="btn btn-primary catalog-cart-cta"
                  onClick={handleProcessOrder}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                >
                  {lang === "es" ? "Procesar Pedido" : "Process Order"} →
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
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
//
// Props de carrito:
//   cartQty      → cantidad actual de este SKU en el carrito (0 = no agregado)
//   onChangeQty  → (nextQty) => void · callback para actualizar la cantidad
// ---------------------------------------------------------------------
function ProductCard({
  product, lang, onOpenDetail, onBuy, cartQty = 0, onChangeQty,
  tcUsdBrl, banda,
}) {
  const {
    sku, nombre, descripcion,
    marca_label, imagen_url,
    moneda = "USD",
    precio_venta, categoria, estado,
  } = product || {};
  const inCart = cartQty > 0;

  // Rev 2026-05-21g · Precio del catalogo en BRL para el cliente activo.
  // Toma el precio USD de venta (que en el motor de precios Marluvas es
  // el "techo a 90d" — el plazo mas largo y de mayor valor) y lo
  // multiplica por el divisor de la banda vigente del USD/BRL del dia.
  // Si todavia no llego la TC o el SKU no tiene precio USD, dejamos el
  // texto fallback "Consultar precio" para que el cliente sepa que
  // todavia no esta disponible.
  const precioUsdBase = Number(precio_venta) || 0;
  const tieneBanda    = !!banda && !!banda.div;
  const precioBrl     = (tieneBanda && precioUsdBase > 0)
    ? precioUsdBase * Number(banda.div)
    : null;

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
          <img
            src={
              // Si imagen_url ya es URL absoluta (CDN externo), úsala
              // directo. Si es una key de MinIO (formato 'producto/.../*.png'),
              // pásala por /api/storage/download/ — mismo patrón que el
              // módulo /productos admin.
              /^https?:\/\//i.test(imagen_url)
                ? imagen_url
                : `${window.location.origin}/api/storage/download/?key=${encodeURIComponent(imagen_url)}`
            }
            alt={nombre || sku}
            loading="lazy"
            onError={(e) => {
              // Si la key es inválida (legacy), oculta y deja placeholder
              e.currentTarget.style.display = "none";
              const ph = e.currentTarget.nextElementSibling;
              if (ph && ph.classList) ph.classList.remove("hidden");
            }}
          />
        ) : null}
        {!imagen_url && (
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

      {/* Footer con precio + CTA (o stepper si está en carrito) */}
      <footer className="catalog-card-foot">
        <div className="catalog-card-price tabular-nums">
          {precioBrl != null ? (
            <>
              <span>{"R$ " + precioBrl.toLocaleString("pt-BR", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}</span>
              <span style={{
                display: "block", fontSize: 10, fontWeight: 500,
                color: "var(--text-tertiary)", marginTop: 2,
                letterSpacing: 0.3,
              }}>
                {(lang === "es" ? "Banda " : "Band ") + (banda?.rango || "") +
                  " · 90d · " + fmtMoney(precioUsdBase, "USD")}
              </span>
            </>
          ) : (lang === "es" ? "Consultar precio" : "Quote on request")}
        </div>
        {!inCart ? (
          <button
            type="button"
            className="btn btn-primary catalog-card-cta"
            onClick={(e) => { e.stopPropagation(); onBuy(); }}
          >
            {lang === "es" ? "Comprar" : "Buy"}
          </button>
        ) : (
          <div
            className="catalog-card-stepper"
            onClick={(e) => e.stopPropagation()}
            role="group"
            aria-label={lang === "es" ? "Cantidad" : "Quantity"}
          >
            <button
              type="button"
              className="catalog-stepper-btn"
              onClick={() => onChangeQty && onChangeQty(cartQty - 1)}
              aria-label={lang === "es" ? "Quitar uno" : "Remove one"}
            >
              −
            </button>
            <input
              type="number"
              min={0}
              className="catalog-stepper-input tabular-nums"
              value={cartQty}
              onChange={(e) => onChangeQty && onChangeQty(Number(e.target.value))}
            />
            <button
              type="button"
              className="catalog-stepper-btn"
              onClick={() => onChangeQty && onChangeQty(cartQty + 1)}
              aria-label={lang === "es" ? "Agregar uno" : "Add one"}
            >
              +
            </button>
          </div>
        )}
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
