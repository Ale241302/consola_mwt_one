// =====================================================================
// MWT.ONE · lib/portalProductsMock.js
// Agente responsable: [AG-FRONTEND]
//
// Fixtures demo del catálogo B2B para modo VITE_USE_MOCKS=1.
// El shape IMITA exactamente el del backend (ProductPortalListSerializer
// y ProductPortalDetailSerializer) — así los mismos componentes de vista
// renderizan igual con mock o con backend real, sin branch-and-render.
//
// Reglas:
//   · CERO datos sensibles — solo campos del whitelist strip-down:
//     id, sku, nombre, descripcion, marca_id, marca_label, categoria,
//     subcategoria, unidad, moneda, imagen_url, estado, precio_venta
//     (+ especificaciones, tallas, colores, peso_kg, volumen_m3,
//        pais_origen_iso2, ficha_url, created_at, updated_at en detalle).
//   · NUNCA costo_estandar, precio_mwt, precio_lista, proveedor_principal_id,
//     stock_*, visibility_tier, hs_code.
//
// Para agregar productos, basta con empujar objetos al array PRODUCTS.
// =====================================================================

const BRAND_RANA_WALK_ID = "brand-ranawalk-demo";
const BRAND_RANA_PRO_ID  = "brand-ranapro-demo";

// Fotos libres para demo (Unsplash). Si el entorno del portal bloquea
// dominios externos, cambiar a imagen_url=null y el placeholder del grid
// renderiza un 📦.
const IMG_BOOT_STEEL   = "https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600&q=75";
const IMG_BOOT_LEATHER = "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=75";
const IMG_SNEAKER_SAFETY = "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=600&q=75";
const IMG_SHOE_OFFICE  = "https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?w=600&q=75";
const IMG_BOOT_DIELECT = "https://images.unsplash.com/photo-1605348532760-6753d2c43329?w=600&q=75";
const IMG_SHOE_SPORT   = "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&q=75";

export const PORTAL_PRODUCTS_DEMO = [
  {
    id:           "prod-rw-001",
    sku:          "RW-IND-STL-42",
    nombre:       "Bota industrial con puntera de acero",
    descripcion:  "Bota de seguridad cat. S3 · cuero flor · suela PU bidensidad · ideal para obra civil y metalmecánica.",
    marca_id:     BRAND_RANA_WALK_ID,
    marca_label:  "Rana Walk",
    categoria:    "CALZADO_INDUSTRIAL",
    subcategoria: "BOTAS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_BOOT_STEEL,
    estado:       "ACTIVO",
    precio_venta: 89.50,
    // Detalle
    especificaciones: {
      tipo_calzado:   "Bota",
      cubrepuntera:   "Acero",
      antiperforante: "Kevlar",
      capellada:      "Cuero flor bovino",
      suela:          "PU bidensidad",
      normativa:      "ISO 20345 · S3 SRC",
      cierre:         "Cordón",
      color:          "Negro",
      segmento:       "Industrial",
      materiales_circulares: "No",
      plantilla_interna: "EVA + malla antibacterial",
    },
    tallas:  ["38","39","40","41","42","43","44","45"],
    colores: ["Negro"],
    peso_kg:    1.85,
    volumen_m3: 0.012,
    pais_origen_iso2: "BR",
    ficha_url:  null,
    created_at: "2026-02-14T10:22:00Z",
    updated_at: "2026-04-10T15:08:00Z",
  },
  {
    id:           "prod-rw-002",
    sku:          "RW-IND-COMP-41",
    nombre:       "Zapato de seguridad puntera compuesta",
    descripcion:  "Ligero, 25% más liviano que el acero. Ideal para logística y almacenes refrigerados.",
    marca_id:     BRAND_RANA_WALK_ID,
    marca_label:  "Rana Walk",
    categoria:    "CALZADO_INDUSTRIAL",
    subcategoria: "ZAPATOS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_SNEAKER_SAFETY,
    estado:       "ACTIVO",
    precio_venta: 72.00,
    especificaciones: {
      tipo_calzado:   "Zapato",
      cubrepuntera:   "Composite",
      antiperforante: "Textil no-metálico",
      capellada:      "Microfibra + malla 3D",
      suela:          "PU bidensidad antideslizante",
      normativa:      "ISO 20345 · S1P SRC",
      cierre:         "Cordón",
      color:          "Gris/Negro",
      segmento:       "Logística",
    },
    tallas:  ["38","39","40","41","42","43","44"],
    colores: ["Gris"],
    peso_kg:    0.95,
    volumen_m3: 0.010,
    pais_origen_iso2: "VN",
    ficha_url:  null,
    created_at: "2026-01-18T09:00:00Z",
    updated_at: "2026-04-05T11:30:00Z",
  },
  {
    id:           "prod-rp-003",
    sku:          "RP-DIEL-43",
    nombre:       "Bota dieléctrica 18 kV",
    descripcion:  "Calzado aislante para trabajos eléctricos. Sin componentes metálicos. Homologada 18 kV.",
    marca_id:     BRAND_RANA_PRO_ID,
    marca_label:  "Rana Pro",
    categoria:    "CALZADO_INDUSTRIAL",
    subcategoria: "BOTAS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_BOOT_DIELECT,
    estado:       "ACTIVO",
    precio_venta: 118.90,
    especificaciones: {
      tipo_calzado:   "Bota",
      cubrepuntera:   "Composite",
      antiperforante: "Textil",
      capellada:      "Cuero engrasado hidrofugado",
      suela:          "Caucho dieléctrico",
      normativa:      "EN 50321 · clase 0 · 18 kV",
      cierre:         "Cordón + cremallera lateral",
      color:          "Marrón",
      segmento:       "Eléctrico",
      disipativo_energia: "Sí",
    },
    tallas:  ["39","40","41","42","43","44","45","46"],
    colores: ["Marrón"],
    peso_kg:    2.10,
    volumen_m3: 0.014,
    pais_origen_iso2: "BR",
    ficha_url:  null,
    created_at: "2025-11-02T14:00:00Z",
    updated_at: "2026-03-28T10:12:00Z",
  },
  {
    id:           "prod-rw-004",
    sku:          "RW-CAS-40",
    nombre:       "Zapato casual oficina",
    descripcion:  "Estilo ejecutivo con confort deportivo. Plantilla anatómica. Para personal administrativo.",
    marca_id:     BRAND_RANA_WALK_ID,
    marca_label:  "Rana Walk",
    categoria:    "CALZADO_CASUAL",
    subcategoria: "ZAPATOS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_SHOE_OFFICE,
    estado:       "ACTIVO",
    precio_venta: 64.00,
    especificaciones: {
      tipo_calzado:   "Zapato",
      cubrepuntera:   "No",
      capellada:      "Cuero suave",
      suela:          "TPU flexible",
      cierre:         "Cordón",
      color:          "Negro",
      segmento:       "Oficina",
    },
    tallas:  ["38","39","40","41","42","43","44"],
    colores: ["Negro","Café"],
    peso_kg:    0.70,
    volumen_m3: 0.009,
    pais_origen_iso2: "VN",
    ficha_url:  null,
    created_at: "2026-02-01T09:00:00Z",
    updated_at: "2026-04-12T08:44:00Z",
  },
  {
    id:           "prod-rw-005",
    sku:          "RW-FIELD-44",
    nombre:       "Bota de trabajo cuero engrasado",
    descripcion:  "Para trabajo en campo, forestal y agrícola. Impermeable. Suela lug alta tracción.",
    marca_id:     BRAND_RANA_WALK_ID,
    marca_label:  "Rana Walk",
    categoria:    "CALZADO_INDUSTRIAL",
    subcategoria: "BOTAS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_BOOT_LEATHER,
    estado:       "ACTIVO",
    precio_venta: 98.75,
    especificaciones: {
      tipo_calzado:   "Bota",
      cubrepuntera:   "Acero",
      capellada:      "Cuero engrasado 2.2 mm",
      suela:          "Caucho nitrilo lug",
      normativa:      "ISO 20345 · S3 HRO",
      cierre:         "Cordón + empeine acolchado",
      color:          "Café",
      segmento:       "Campo / forestal",
    },
    tallas:  ["39","40","41","42","43","44","45"],
    colores: ["Café"],
    peso_kg:    2.00,
    volumen_m3: 0.013,
    pais_origen_iso2: "BR",
    ficha_url:  null,
    created_at: "2025-10-20T13:15:00Z",
    updated_at: "2026-04-02T18:40:00Z",
  },
  {
    id:           "prod-rp-006",
    sku:          "RP-SPORT-39",
    nombre:       "Zapatilla deportiva antideslizante",
    descripcion:  "Calzado deportivo con suela antideslizante grado HORECA. Perfecta para restaurantes y cocinas.",
    marca_id:     BRAND_RANA_PRO_ID,
    marca_label:  "Rana Pro",
    categoria:    "CALZADO_INDUSTRIAL",
    subcategoria: "ZAPATILLAS",
    unidad:       "PAR",
    moneda:       "USD",
    imagen_url:   IMG_SHOE_SPORT,
    estado:       "ACTIVO",
    precio_venta: 58.50,
    especificaciones: {
      tipo_calzado:   "Zapatilla",
      cubrepuntera:   "No",
      capellada:      "Malla técnica + microfibra",
      suela:          "Caucho HORECA SRC",
      normativa:      "ISO 20347 · OB SRC",
      cierre:         "Cordón",
      color:          "Blanco",
      segmento:       "HORECA",
    },
    tallas:  ["36","37","38","39","40","41","42"],
    colores: ["Blanco","Negro"],
    peso_kg:    0.55,
    volumen_m3: 0.008,
    pais_origen_iso2: "VN",
    ficha_url:  null,
    created_at: "2026-03-05T11:11:00Z",
    updated_at: "2026-04-18T09:22:00Z",
  },
];

// ---------------------------------------------------------------------
// Helpers para el interceptor (shape del backend para list + retrieve)
// ---------------------------------------------------------------------
export function portalProductsListMock({ limit = 60, offset = 0, q = "" } = {}) {
  const needle = (q || "").trim().toLowerCase();
  const filtered = needle
    ? PORTAL_PRODUCTS_DEMO.filter((p) =>
        (p.nombre || "").toLowerCase().includes(needle) ||
        (p.sku    || "").toLowerCase().includes(needle),
      )
    : PORTAL_PRODUCTS_DEMO;
  const page = filtered.slice(offset, offset + limit);
  return {
    count:   filtered.length,
    limit,
    offset,
    results: page,
  };
}

export function portalProductsDetailMock(productId) {
  const p = PORTAL_PRODUCTS_DEMO.find((x) => x.id === productId);
  return p || null;
}
