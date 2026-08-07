// ─────────────────────────────────────────────────────────────
// PortalProductDetail — Ficha técnica comercial de producto (B2B)
//
// Ruta /portal/productos/:productId
// Reemplaza ProductFormView para clientes B2B con un layout tipo landing
// basado en detalleproducto/Propuesta Botas Composite.dc.html, pero sin
// el header de descargar / imprimir y sin secciones genéricas.
//
// Consume GET /api/productos/:productId/ (mismo endpoint interno).
// Todos los datos visibles vienen del producto; secciones sin datos se ocultan.
//
// Exporta también <PortalProductDetailView> para reutilizar la ficha
// dentro de modales (ej. modal "Ver especificaciones" del wizard).
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { productosApi, getToken, storageUrl } from "../lib/api.js";
import { fmtMoney } from "../lib/i18n.js";
import {
  IconChevLeft, IconDownload, IconImage, IconShield,
  IconArrow, IconFileText, IconGlobe, IconAlert,
} from "../lib/icons.jsx";

const ICON_BASE = "/Iconos/";
const ICON_CACHE_BUST = "v=2";

function normalize(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Mapa de valores del producto → ruta relativa de icono en frontend/public/Iconos
const ICONS = {
  riesgo: {
    "alta temperatura": "Riesgos/Riesgos-_Alta Temperatura.png",
    "ambiente frio": "Riesgos/Riesgos-_Ambiente Frio.png",
    "caida objetos": "Riesgos/Riesgos-_Caida Objetos.png",
    "esguince": "Riesgos/Riesgos-_Esguince.png",
    "estatica": "Riesgos/Riesgos-_Estatica.png",
    "humedad": "Riesgos/Riesgos-_Humedad.png",
    "ocupacional": "Riesgos/Riesgos-_Ocupacional.png",
    "piso resbaladizo": "Riesgos/Riesgos-_Piso Resbaladizo.png",
    "polimerico": "Riesgos/Riesgos-_Polimerico.png",
    "puncion plantar": "Riesgos/Riesgos-_Puncion Plantar.png",
    "quimicos": "Riesgos/Riesgos-_Quimicos.png",
    "seguridad": "Riesgos/Riesgos-_Seguridad.png",
    "shock": "Riesgos/Riesgos-_Shock.png",
  },
  segmento: {
    "administrativo": "Segmentos/ES/Segmentos-_Administracion.png",
    "agricola": "Segmentos/ES/Segmentos-_Agricultura.png",
    "agroindustria": "Segmentos/ES/Segmentos-_Agroindustria.png",
    "alimentaria": "Segmentos/ES/Segmentos-_Alimentacion.png",
    "alimentacion": "Segmentos/ES/Segmentos-_Alimentacion.png",
    "astillero": "Segmentos/ES/Segmentos-_Astillero.png",
    "construccion": "Segmentos/ES/Segmentos-_Construccion.png",
    "electricista": "Segmentos/ES/Segmentos-_Electricidad.png",
    "ensambladora": "Segmentos/ES/Segmentos-_Ensambladora.png",
    "fabricacion": "Segmentos/ES/Segmentos-_Fabricacion.png",
    "produccion": "Segmentos/ES/Segmentos-_Fabricacion.png",
    "limpieza": "Segmentos/ES/Segmentos-_Limpieza.png",
    "maderas": "Segmentos/ES/Segmentos-_Madera.png",
    "mensajeria": "Segmentos/ES/Segmentos-_Mensajeria.png",
    "metalurgia": "Segmentos/ES/Segmentos-_Metalurgia.png",
    "militares": "Segmentos/ES/Segmentos-_Militar.png",
    "mineria": "Segmentos/ES/Segmentos-_Mineria.png",
    "montadoras": "Segmentos/ES/Segmentos-_Ensambladora.png",
    "multiservicios": "Segmentos/ES/Segmentos-_Servicios.png",
    "petroquimicos": "Segmentos/ES/Segmentos-_Petroquimica.png",
    "rescate": "Segmentos/ES/Segmentos-_Rescate.png",
    "salud": "Segmentos/ES/Segmentos-_Salud.png",
    "senderismo": "Segmentos/ES/Segmentos-_Senderismo.png",
    "servicios": "Segmentos/ES/Segmentos-_Servicios.png",
    "siderurgia": "Segmentos/ES/Segmentos-_Siderurgia.png",
    "trekking": "Segmentos/ES/Segmentos-_Senderismo.png",
  },
  normativa: {
    "iso 20345": "Normativa/Normativa-_ISO 20345.png",
    "iso 20347": "Normativa/Normativa-_ISO 20347.png",
    "astm f2413": "Normativa/Normativa-_ASTM F2413.png",
    "abnt nbr 16.603:2017 500v - seco": "Normativa/Normativa-_ABNT NBR 16.603-2017 500V - SECO.png",
    "abnt nbr 16603-2017 500v": "Normativa/Normativa-_ABNT NBR 16.603-2017 500V - SECO.png",
  },
  tipo_puntera: {
    "composite 200j": "Tipo Puntera/Tipo puntera-_Composite 200J.png",
    "acero 200j": "Tipo Puntera/Tipo puntera-_Acero 200J.png",
    "no tiene": "Tipo Puntera/Tipo puntera-_No tiene.png",
    "no": "Tipo Puntera/Tipo puntera-_No tiene.png",
  },
  antiperforante: {
    "textil 1100 n": "Anti perforante/Anti perforante-_Textil 1100 N.png",
    "acero 1100 n": "Anti perforante/Anti perforante-_Acero 1100 N.png",
    "no": "Anti perforante/Anti perforante-_NO.png",
  },
  suela: {
    "bidensidad pu": "Suela/suela-_Bidensidad PU.png",
    "monodensidad caucho": "Suela/suela-_Monodensidad Caucho.png",
  },
  cierre: {
    "con cordones": "Cierre/Cierre-_Con Cordones.png",
    "sin cordones": "Cierre/Cierre-_Sin Cordones.png",
    "de meter": "Cierre/Cierre-_De meter.png",
    "cierre velcro": "Cierre/Cierre-_Cierre Velcro.png",
    "zipper": "Cierre/Cierre-_Zipper.png",
  },
  capellada: {
    "cuero plena flor": "Capellada/Capellada-_Plena Flor.png",
    "plena flor": "Capellada/Capellada-_Plena Flor.png",
    "microfibra": "Capellada/Capellada-_Microfibra.png",
    "nobuck": "Capellada/Capellada-_Nobuck.png",
    "nobuck hidro": "Capellada/Capellada-_Nobuck_Hidro.png",
    "flor hidro": "Capellada/Capellada-_Flor HIDRO.png",
    "carnaza": "Capellada/Capellada-_Carnaza.png",
    "eva": "Capellada/Capellada-_EVA.png",
    "rodock": "Capellada/Capellada-_Rodock.png",
    "vaqueta lisa": "Capellada/Capellada-_Vaqueta Lisa.png",
    "vaqueta lisa agua": "Capellada/Capellada-_Vaqueta Lisa agua.png",
    "vaqueta lisa fuego": "Capellada/Capellada-_Vaqueta Lisa fuego.png",
    "pvc": "Capellada/Capellada-_pvc.png",
  },
  plantilla_interna: {
    "poliuretano": "Plantilla Interna/Plantilla Interna-_pu.png",
    "pu": "Plantilla Interna/Plantilla Interna-_pu.png",
    "pu sofbed": "Plantilla Interna/Plantilla Interna-_PU Sofbed.png",
    "sofbed": "Plantilla Interna/Plantilla Interna-_PU Sofbed.png",
    "eva": "Plantilla Interna/Plantilla Interna-_EVA-171.png",
    "no": "Plantilla Interna/Plantilla Interna-_NO-173.png",
  },
  protector_metatarsal: {
    "externo": "Protector Meta tarsal/Protector Meta tarsal-_Externo.png",
    "interno": "Protector Meta tarsal/Protector Meta tarsal-_Interno.png",
    "no": "Protector Meta tarsal/Protector Meta tarsal-_NO-141.png",
  },
  cubrepuntera: {
    "no": "Cubrepuntera/Cubrepuntera-_Cubrepuntera no.png",
    "si": "Cubrepuntera/Cubrepuntera-_Cubrepuntera si.png",
  },
  materiales_circulares: {
    "no": "Economia Circular/Materiales Economias Circulares-_Materiales Economias Circulares no.png",
    "si": "Economia Circular/Materiales Economias Circulares-_Materiales Economias Circulares si.png",
  },
  disipativo_energia: {
    "antiestatico": "Manejo de Energia/Manejo de Energia-_Antiestatico.png",
    "conductivo": "Manejo de Energia/Manejo de Energia-_Conductivo.png",
    "dielectrico 14.000v": "Manejo de Energia/Manejo de Energia-_Dielectrico 14.000V.png",
    "dielectrico 18.000v": "Manejo de Energia/Manejo de Energia-_Dielectrico 18.000V.png",
    "no conductivo": "Manejo de Energia/Manejo de Energia-_No Conductivo.png",
    "abnt nbr 16603-2017 500v": "Manejo de Energia/Manejo de Energia-_Norma Electricista 16603.png",
  },
  tipo_calzado: {
    "bota alta": "Tipo de Calzado/Tipo de calzado-_Bota Alta.png",
    "bota al tobillo": "Tipo de Calzado/Tipo de calzado-_Bota al Tobillo.png",
    "zapato o tenis": "Tipo de Calzado/Tipo de calzado-_Zapato o Tenis.png",
  },
};

function iconFor(category, value) {
  const key = normalize(value);
  const rel = ICONS[category]?.[key];
  return rel ? `${ICON_BASE}${rel}?${ICON_CACHE_BUST}` : null;
}


// ═════════════════════════════════════════════════════════════
// PortalProductDetailView — contenido reusable de la ficha
// ═════════════════════════════════════════════════════════════
export function PortalProductDetailView({ product, lang = "es" }) {
  const [sizeMatrix, setSizeMatrix] = useState(null);

  useEffect(() => {
    if (!product?.id) return undefined;
    let cancelled = false;
    fetchSizeMatrix(product.id)
      .then((m) => {
        if (!cancelled) setSizeMatrix(m);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[portal-product-detail-view] size matrix failed:", err);
        setSizeMatrix({ rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [product?.id]);

  const specs = useMemo(() => product?.especificaciones || {}, [product]);

  const {
    sku, nombre, descripcion, categoria, subcategoria, marca_nombre, marca_label,
    moneda, precio_venta, estado, imagen_url, ficha_url, pais_origen_iso2,
  } = product || {};

  const familia = specs.familia || categoria || "";
  const normativaArr = Array.isArray(specs.normativa) ? specs.normativa : (specs.normativa ? [specs.normativa] : []);
  const riesgos = Array.isArray(specs.riesgo) ? specs.riesgo : [];
  const segmentos = Array.isArray(specs.segmento) ? specs.segmento : [];
  const gallery = Array.isArray(specs.gallery) ? specs.gallery : [];
  const fichas = Array.isArray(specs.fichas) ? specs.fichas : (ficha_url ? [ficha_url] : []);

  const heroChips = useMemo(() => {
    const chips = [];
    if (specs.tipo_puntera) chips.push({ label: "PUNTERA", value: specs.tipo_puntera, icon: iconFor("tipo_puntera", specs.tipo_puntera) });
    if (specs.suela) chips.push({ label: "SUELA", value: specs.suela, icon: iconFor("suela", specs.suela) });
    if (specs.cierre) chips.push({ label: "CIERRE", value: specs.cierre, icon: iconFor("cierre", specs.cierre) });
    if (specs.color) chips.push({ label: "COLOR", value: specs.color });
    if (specs.tipo_calzado) chips.push({ label: "TIPO", value: specs.tipo_calzado, icon: iconFor("tipo_calzado", specs.tipo_calzado) });
    return chips.slice(0, 4);
  }, [specs]);

  const featureCards = useMemo(() => {
    const list = [];
    const add = (icon, title, value, subtitle) => list.push({ icon, title, value, subtitle });
    if (specs.tipo_puntera) add(iconFor("tipo_puntera", specs.tipo_puntera), "Puntera", specs.tipo_puntera);
    if (specs.antiperforante) add(iconFor("antiperforante", specs.antiperforante), "Antiperforante", specs.antiperforante);
    if (specs.suela) add(iconFor("suela", specs.suela), "Suela", specs.suela);
    if (specs.cierre) add(iconFor("cierre", specs.cierre), "Cierre", specs.cierre);
    if (specs.plantilla_interna) add(iconFor("plantilla_interna", specs.plantilla_interna), "Plantilla interna", specs.plantilla_interna);
    if (specs.capellada) add(iconFor("capellada", specs.capellada), "Capellada", specs.capellada);
    if (specs.protector_metatarsal && specs.protector_metatarsal !== "No") add(iconFor("protector_metatarsal", specs.protector_metatarsal), "Protector metatarsal", specs.protector_metatarsal);
    if (specs.cubrepuntera && specs.cubrepuntera !== "No") add(iconFor("cubrepuntera", specs.cubrepuntera), "Cubrepuntera", specs.cubrepuntera);
    if (specs.materiales_circulares && specs.materiales_circulares !== "No") add(iconFor("materiales_circulares", specs.materiales_circulares), "Materiales circulares", specs.materiales_circulares);
    if (specs.disipativo_energia?.length) {
      specs.disipativo_energia.forEach((d) => add(iconFor("disipativo_energia", d), "Manejo de energía", d));
    }
    return list;
  }, [specs]);

  const riskCards = useMemo(() => {
    return riesgos.map((r) => ({ name: r, icon: iconFor("riesgo", r) }));
  }, [riesgos]);

  const segmentCards = useMemo(() => {
    return segmentos.map((s) => ({ name: s, icon: iconFor("segmento", s) }));
  }, [segmentos]);

  const normBadges = useMemo(() => {
    return normativaArr.map((n) => ({ name: n, icon: iconFor("normativa", n) }));
  }, [normativaArr]);

  const specGroups = useMemo(() => {
    const build = [];
    const tech = [];
    if (specs.capellada) tech.push({ label: "Capellada", value: specs.capellada });
    if (specs.cierre) tech.push({ label: "Cierre", value: specs.cierre });
    if (specs.tipo_puntera) tech.push({ label: "Puntera", value: specs.tipo_puntera });
    if (specs.plantilla_interna) tech.push({ label: "Plantilla interna", value: specs.plantilla_interna });
    if (specs.antiperforante) tech.push({ label: "Antiperforante", value: specs.antiperforante });
    if (specs.suela) tech.push({ label: "Suela", value: specs.suela });
    if (specs.protector_metatarsal) tech.push({ label: "Protector metatarsal", value: specs.protector_metatarsal });
    if (specs.cubrepuntera) tech.push({ label: "Cubrepuntera", value: specs.cubrepuntera });
    if (specs.disipativo_energia?.length) tech.push({ label: "Disipativo de energía", value: specs.disipativo_energia.join(", ") });
    if (tech.length) build.push({ title: "CONSTRUCCIÓN DEL CALZADO", items: tech });

    const data = [];
    if (specs.color) data.push({ label: "Color", value: specs.color });
    if (specs.ncm || product?.hs_code) data.push({ label: "NCM / HS", value: specs.ncm || product?.hs_code });
    if (specs.tipo_calzado) data.push({ label: "Tipo de calzado", value: specs.tipo_calzado });
    if (product?.peso_kg) data.push({ label: "Peso por pie", value: `${product.peso_kg} kg` });
    if (product?.volumen_m3) data.push({ label: "Volumen", value: `${product.volumen_m3} m³` });
    if (pais_origen_iso2) data.push({ label: "País de origen", value: pais_origen_iso2 });
    if (normativaArr.length) data.push({ label: "Norma", value: normativaArr.join(" · ") });
    if (data.length) build.push({ title: "DATOS TÉCNICOS", items: data });
    return build;
  }, [specs, product, pais_origen_iso2, normativaArr]);

  return (
    <>
      {/* Hero */}
      <section className="ppd-hero">
        <div className="ppd-hero-inner">
          <div className="ppd-hero-info">
            <div className="ppd-eyebrow">
              <span>LÍNEA {familia.toUpperCase()}</span>
              {normativaArr.length > 0 && (
                <>
                  <span className="ppd-eyebrow-line" />
                  <span>{normativaArr.join(" · ")}</span>
                </>
              )}
            </div>
            <h1 className="ppd-title">{nombre}</h1>
            <div className="ppd-subtitle">SKU: {sku} · {categoria}{subcategoria ? ` / ${subcategoria}` : ""}</div>
            <p className="ppd-desc">{descripcion || defaultDescription(nombre, familia, lang)}</p>

            <div className="ppd-hero-chips">
              {heroChips.map((chip) => (
                <div key={chip.label} className="ppd-hero-chip">
                  {chip.icon && <img src={chip.icon} alt={chip.label} className="ppd-hero-chip-icon" />}
                  <div>
                    <span className="ppd-chip-label">{chip.label}</span>
                    <span className="ppd-chip-value">{chip.value}</span>
                  </div>
                </div>
              ))}
            </div>

            {Number(precio_venta) > 0 && (
              <div className="ppd-hero-price">
                <span className="ppd-price">{fmtMoney(precio_venta, moneda || "USD")}</span>
                <span className="ppd-price-note">{lang === "es" ? "precio base por par" : "base price per pair"}</span>
              </div>
            )}
          </div>

          <div className="ppd-hero-image">
            {imagen_url ? (
              <img src={storageUrl(imagen_url)} alt={nombre} loading="eager" />
            ) : (
              <div className="ppd-hero-image-placeholder">
                <IconImage size={48} />
                <span>{lang === "es" ? "Imagen del producto" : "Product image"}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Protección contra riesgos */}
      {riskCards.length > 0 && (
        <section className="ppd-section ppd-risks">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Protección contra riesgos" : "Risk protection"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "RIESGOS PROTEGIDOS" : "PROTECTED RISKS"}</span>
          </div>
          <div className="ppd-icons-grid">
            {riskCards.map((r) => (
              <div key={r.name} className="ppd-icon-card">
                {r.icon ? <img src={r.icon} alt={r.name} /> : <IconShield size={28} />}
                <span>{r.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Materiales y tecnologías */}
      {featureCards.length > 0 && (
        <section className="ppd-section ppd-features">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Materiales y tecnologías" : "Materials & technologies"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "INGENIERÍA DEL CALZADO" : "SHOE ENGINEERING"}</span>
          </div>
          <div className="ppd-icons-grid ppd-features-grid">
            {featureCards.map((f) => (
              <div key={`${f.title}-${f.value}`} className="ppd-icon-card">
                {f.icon ? <img src={f.icon} alt={f.title} /> : <IconImage size={28} />}
                <div className="ppd-icon-card-text">
                  <span className="ppd-icon-card-label">{f.title}</span>
                  <span className="ppd-icon-card-value">{f.value}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cumplimiento de normas */}
      {normBadges.length > 0 && (
        <section className="ppd-section ppd-norms">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Cumplimiento de normas" : "Standards compliance"}</h2>
            <span className="ppd-section-kicker">{normativaArr.join(" · ")}</span>
          </div>
          <div className="ppd-norms-badges">
            {normBadges.map((n) => (
              <div key={n.name} className="ppd-norm-badge">
                {n.icon && <img src={n.icon} alt={n.name} />}
                <span>{n.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Especificaciones técnicas */}
      {specGroups.length > 0 && (
        <section className="ppd-section ppd-specs">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Especificaciones técnicas" : "Technical specifications"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "FICHA DETALLADA" : "DETAILED SHEET"}</span>
          </div>
          <div className="ppd-specs-grid">
            {specGroups.map((g) => (
              <div key={g.title} className="ppd-spec-card">
                <div className="ppd-spec-title">{g.title}</div>
                <div className="ppd-spec-rows">
                  {g.items.map((row) => (
                    <div key={row.label} className="ppd-spec-row">
                      <span className="ppd-spec-label">{row.label}</span>
                      <span className="ppd-spec-value">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tallas / equivalencias */}
      {sizeMatrix?.rows?.length > 0 && (
        <section className="ppd-section ppd-sizes">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Tallas" : "Sizes"}</h2>
            <span className="ppd-section-kicker">{sizeMatrix.base_label}</span>
          </div>
          <div className="ppd-size-table-wrap">
            <table className="ppd-size-table ppd-size-table-inverted">
              <thead>
                <tr>
                  <th className="ppd-size-base-header">{sizeMatrix.base_label}</th>
                  {sizeMatrix.rows.map((row, idx) => (
                    <th key={idx}>{row.base}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sizeMatrix.headers.slice(1).map((h, i) => (
                  <tr key={h.code}>
                    <td className="ppd-size-row-label">{h.label}</td>
                    {sizeMatrix.rows.map((row, idx) => (
                      <td key={idx}>{row.values[i] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Aplicaciones y sectores */}
      {segmentCards.length > 0 && (
        <section className="ppd-section ppd-segments">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Aplicaciones y sectores" : "Applications & sectors"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "DÓNDE SE USA" : "WHERE IT IS USED"}</span>
          </div>
          <div className="ppd-icons-grid">
            {segmentCards.map((s) => (
              <div key={s.name} className="ppd-icon-card">
                {s.icon ? <img src={s.icon} alt={s.name} /> : <IconGlobe size={28} />}
                <span>{s.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Galería */}
      {(gallery.length > 0 || imagen_url) && (
        <section className="ppd-section ppd-gallery">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Galería" : "Gallery"}</h2>
          </div>
          <div className="ppd-gallery-grid">
            {(gallery.length ? gallery : [imagen_url]).filter(Boolean).map((src, i) => (
              <div key={i} className="ppd-gallery-item">
                <img src={storageUrl(src)} alt={`${nombre} ${i + 1}`} loading="lazy" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ficha técnica generada */}
      {product?.id && (
        <section className="ppd-section ppd-docs">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Ficha técnica" : "Technical datasheet"}</h2>
          </div>
          <div className="ppd-docs-list">
            <div className="ppd-doc-actions">
              <button
                type="button"
                className="ppd-doc-btn ppd-doc-btn-primary"
                onClick={() => downloadGeneratedPdf(product.id, `ficha-tecnica-${sku || product.id}.pdf`)}
              >
                <IconDownload size={18} />
                {lang === "es" ? "Descargar ficha técnica" : "Download datasheet"}
              </button>
              <button
                type="button"
                className="ppd-doc-btn ppd-doc-btn-secondary"
                onClick={() => printGeneratedPdf(product.id)}
              >
                {lang === "es" ? "Imprimir" : "Print"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Fichas técnicas adjuntas (originales) */}
      {fichas.length > 0 && (
        <section className="ppd-section ppd-docs">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Documentos adjuntos" : "Attached documents"}</h2>
          </div>
          <div className="ppd-docs-list">
            {fichas.map((f, i) => {
              const url = storageUrl(f);
              const filename = String(f).split("/").pop();
              return (
                <div key={i} className="ppd-doc-actions">
                  <a
                    href={url}
                    download={filename}
                    className="ppd-doc-btn ppd-doc-btn-secondary"
                  >
                    <IconFileText size={18} />
                    {filename}
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer className="ppd-footer">
        {marca_nombre || marca_label || "MWT"} · {lang === "es" ? "FICHA TÉCNICA" : "TECHNICAL SHEET"} {sku} · {normativaArr.join(" · ")}
      </footer>
    </>
  );
}


// ═════════════════════════════════════════════════════════════
// PortalProductDetail — página completa (header + ficha)
// ═════════════════════════════════════════════════════════════
export default function PortalProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    productosApi
      .get(productId)
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[portal-product-detail] fetch failed:", err);
        setError(lang === "es" ? "No se pudo cargar la ficha del producto." : "Could not load product sheet.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, lang]);

  if (loading) {
    return <PortalProductDetailSkeleton lang={lang} />;
  }

  if (error || !product) {
    return (
      <div className="ppd-root">
        <div className="ppd-error">
          <IconAlert size={40} />
          <h2>{error || (lang === "es" ? "Producto no encontrado" : "Product not found")}</h2>
          <button className="btn btn-primary" onClick={() => navigate("/portal")}>
            <IconChevLeft size={16} /> {lang === "es" ? "Volver al catálogo" : "Back to catalog"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ppd-root">
      {/* Header */}
      <header className="ppd-header">
        <button type="button" className="ppd-back" onClick={() => navigate("/portal")}>
          <IconChevLeft size={18} /> {lang === "es" ? "Volver al catálogo" : "Back to catalog"}
        </button>
        <span className="ppd-header-brand">MWT · PORTAL</span>
      </header>

      <PortalProductDetailView product={product} lang={lang} />
    </div>
  );
}


// Skeleton mientras carga
function PortalProductDetailSkeleton({ lang }) {
  return (
    <div className="ppd-root">
      <header className="ppd-header">
        <div className="ppd-skel-line" style={{ width: 160, height: 18 }} />
      </header>
      <section className="ppd-hero">
        <div className="ppd-hero-inner">
          <div className="ppd-hero-info">
            <div className="ppd-skel-line" style={{ width: 220, height: 14, marginBottom: 20 }} />
            <div className="ppd-skel-line" style={{ width: "80%", height: 42, marginBottom: 12 }} />
            <div className="ppd-skel-line" style={{ width: 160, height: 14, marginBottom: 24 }} />
            <div className="ppd-skel-line" style={{ width: "100%", height: 80 }} />
          </div>
          <div className="ppd-hero-image">
            <div className="ppd-skel-block" />
          </div>
        </div>
      </section>
    </div>
  );
}

function defaultDescription(nombre, familia, lang) {
  return lang === "es"
    ? `Calzado de seguridad ${familia ? `de línea ${familia}` : ""} diseñado para entornos industriales exigentes. Modelo ${nombre || ""}.`
    : `Safety footwear ${familia ? `from the ${familia} line` : ""} designed for demanding industrial environments. Model ${nombre || ""}.`;
}

// (storageUrl se importa desde ../lib/api.js)

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function fetchSizeMatrix(productId) {
  const token = getToken();
  const resp = await fetch(
    `${window.location.origin}${API_BASE}/productos/${encodeURIComponent(productId)}/talla-matrix/`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`No se pudo cargar la matriz de tallas (${resp.status}) ${text}`);
  }
  return await resp.json();
}

async function fetchGeneratedPdfBlobUrl(productId) {
  const token = getToken();
  const resp = await fetch(`${window.location.origin}${API_BASE}/productos/${encodeURIComponent(productId)}/ficha-tecnica/pdf/`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`No se pudo generar la ficha técnica (${resp.status})`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

async function downloadGeneratedPdf(productId, filename) {
  const url = await fetchGeneratedPdfBlobUrl(productId);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function printGeneratedPdf(productId) {
  const url = await fetchGeneratedPdfBlobUrl(productId);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.focus();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
