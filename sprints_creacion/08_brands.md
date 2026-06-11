# Creación 08 · Brands — Marcas, Productos, Proveedores y Precios

## Objetivo
Catálogos maestros del negocio: marcas con feature flags, productos de calzado (tallas, especificaciones técnicas, visibilidad y precio por cliente), proveedores con evaluaciones ISO, y la matriz/historial de precios por cliente.

## Base de datos (schemas `brands`, `productos`, `proveedores`, `pricing`)
*   `brands.marca`: id, nombre, slug, color, feature_flags jsonb, is_active.
*   `productos.producto`: id, sku (unique, trigram idx), nombre (trigram idx), marca_id (idx), categoria, precio_lista, especificaciones jsonb (sizes[], client_prices{client_id→precio}, visibility{visible_to_all, client_overrides}, ncm, ficha técnica…), imagen_url, hs_code, estado, is_active. Catálogo de tallas (`sizing`): equivalencias EU/US/UK/BR/CM.
*   `proveedores.proveedor`: id, nombre, pais, contacto, is_active + `suppliers_product_assignments` (proveedor↔producto) + `suppliers_iso_evaluations`.
*   Pricing por cliente: bandas/plazos/historial (`A2c-A2h`, `D4_banda_vigente`).
*   SQL: `20/21*`, `40/41*`, `50-54`, `B3_product_client_alias.sql`, `B2_seed_tallas_calzado.sql`.

## Backend (apps `brands`, `productos`, `proveedores`)
*   CRUD completo de los tres catálogos (soft-delete). Productos: list con `?q=` (trigram), paginado, y endpoint batch `?ids=` para hidratar nombres/precios en lote; `aliases/` por cliente (CEO-only).
*   Resolución de precio: client_prices[client_id] → precio_lista (waterfall documentado).

## Frontend
*   **Ver registros**: `/marcas` (cards), `/productos` (tabla con imagen, SKU, marca, precio, estado, búsqueda), `/proveedores` (tabla).
*   **Ver detalle**: `/marcas/:brandId` (productos de la marca + precios por cliente), `/proveedores/:supplierId` (evaluaciones ISO, productos asignados).
*   **Crear**: `/productos/nuevo` (`ProductFormView`: SKU, nombre, marca, tallas multiselect, especificaciones, imagen, precios por cliente, visibilidad), `/proveedores/nuevo`, “+ Nueva marca”.
*   **Editar**: `/productos/:productId`, `/proveedores/:supplierId/editar`, `/marcas/:brandId/clientes/:clienteId/precios` (matriz drag&drop de precios).
*   **Eliminar**: modal en cada listado (producto advierte si tiene líneas activas) → soft-delete.
*   `/historial-precios` (CEO-only) y `/tallas` (SizingEngine: CRUD de equivalencias).

## Criterios de aceptación
- [ ] CRUD de los 3 catálogos completo; SKU único validado server-side.
- [ ] CLIENT solo ve productos visibles para él y SU precio (R3).
- [ ] Cambio de precio por cliente queda en el historial con banda y vigencia.
