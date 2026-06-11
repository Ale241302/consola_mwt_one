# Sprint 08 · Brands — Marcas, Productos, Proveedores y Precios

## 1. Propósito
Catálogos maestros: marcas (feature flags), productos (tallas, especificaciones JSONB, visibilidad por cliente, client_prices), proveedores (ISO evaluations, asignaciones) y la matriz de precios por cliente (Marluvas: bandas, plazos, historial).

## 2. Mapeo Tecnológico
*   **Base de datos**: schemas `brands` (`20/21*`), `productos` (`40/41*`, `B3_product_client_alias.sql`), `proveedores` (`50-54`), pricing por cliente (`A2c-A2h marluvas*`, `D4_banda_vigente`).
*   **Backend**: apps `brands`, `productos` (aliases CEO-only), `proveedores`.
*   **Frontend**: `Brands.jsx`, `BrandDetail.jsx`, `Productos.jsx`, `ProductFormView.jsx`, `Proveedores.jsx`, `SupplierDetail/FormView.jsx`, `PriceHistory.jsx`, `BrandClientPricingForm.jsx`, `AddOCProductModal` (catálogo con precios por cliente).

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `productos.producto.especificaciones` (JSONB con sizes/client_prices/visibility): los lookups por cliente lo deserializan completo — evaluar índice GIN o columnas extraídas para los hot paths.
- [ ] **Cascada de `productosApi.get(pid)`**: OCDetail/FusionDetail hacen un GET por producto único para nombres/precios — proponer endpoint batch `?ids=` o que `lineas` traiga `product_label` resuelto.
- [ ] Listado de productos sin paginación (catálogo completo en `AddOCProductModal` con `?q=`) — confirmar límite + índice trigram en `sku`/`nombre`.
- [ ] Historial de precios (D4/A2h): consultas por banda vigente con índice por (cliente, producto, vigencia).

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `ProductFormView`: especificaciones anidadas opcionales (`spec?.client_prices?.[id]`) sin crash.
- [ ] `AddOCProductModal`: búsqueda con debounce; respuestas fuera de orden descartadas.
- [ ] `PriceHistory`: rangos grandes renderizados con paginación/virtualización si crece.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** reporta cuántos `productos/{id}` se disparan al abrir un OCDetail típico.
2. **Backend** decide batch endpoint vs enriquecer `lineas`; **SQL** valida el costo del JSONB.
3. Cierre: OCDetail de 20 líneas debe resolver nombres/precios en ≤2 requests.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (índices)** — `E5`: `linea(producto_id)` acelera los cruces producto↔líneas.
- 🔴 **PENDIENTE (paginación)** — `productos/views.py` listado `.all()` sin límite (escala mal con 10k+ SKUs); el modal Agregar Producto ya filtra con `?q=` pero el catálogo completo sigue expuesto.
- 🟡 **PENDIENTE (frontend)** — `Brands.jsx:43-45,102-103` mapper accede `r.slug`/`r.nombre` sin `?.` y `.map()` sin guard de array.
- ⏳ **PENDIENTE** — Cascada `productosApi.get(pid)` por producto único en OCDetail/FusionDetail → endpoint batch `?ids=` (objetivo: detalle de 20 líneas en ≤2 requests).
