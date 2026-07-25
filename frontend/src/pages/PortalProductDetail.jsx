// ─────────────────────────────────────────────────────────────
// PortalProductDetail — Ficha técnica comercial de producto (B2B)
//
// Ruta /portal/productos/:productId
// Reemplaza ProductFormView para clientes B2B con un layout tipo landing
// basado en detalleproducto/Propuesta Botas Composite.dc.html, pero sin
// el header de descargar / imprimir.
//
// Consume GET /api/productos/:productId/ (mismo endpoint interno).
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { productosApi } from "../lib/api.js";
import { fmtMoney } from "../lib/i18n.js";
import {
  IconChevLeft, IconDownload, IconImage, IconShield,
  IconCheck, IconArrow, IconFileText, IconGlobe,
} from "../lib/icons.jsx";

const COLORS = {
  navy: "#0B1E3A",
  mint: "#00B286",
  lightGreen: "#1DE394",
  purple: "#481EE3",
  blue: "#3083FE",
  cyan: "#1EE3D7",
};

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

  const imageUrl = useCallback((key) => {
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key;
    return `${window.location.origin}/api/storage/download/?key=${encodeURIComponent(key)}`;
  }, []);

  const specs = useMemo(() => product?.especificaciones || {}, [product]);

  const {
    sku, nombre, descripcion, categoria, subcategoria, marca_nombre, marca_label,
    moneda, precio_venta, precio_mwt, estado, imagen_url, ficha_url, pais_origen_iso2,
  } = product || {};

  const familia = specs.familia || categoria || "";
  const normativa = Array.isArray(specs.normativa) ? specs.normativa.join(", ") : (specs.normativa || "NBR ISO 20345:2015");
  const riesgos = Array.isArray(specs.riesgo) ? specs.riesgo : [];
  const segmentos = Array.isArray(specs.segmento) ? specs.segmento : [];
  const gallery = Array.isArray(specs.gallery) ? specs.gallery : [];
  const fichas = Array.isArray(specs.fichas) ? specs.fichas : (ficha_url ? [ficha_url] : []);

  const heroChips = useMemo(() => {
    const chips = [];
    if (specs.tipo_puntera && specs.tipo_puntera !== "No") chips.push({ label: "PUNTERA", value: specs.tipo_puntera });
    if (specs.suela) chips.push({ label: "SUELA", value: specs.suela });
    if (specs.cierre) chips.push({ label: "CIERRE", value: specs.cierre });
    if (specs.color) chips.push({ label: "COLOR", value: specs.color });
    if (specs.tipo_calzado) chips.push({ label: "TIPO", value: specs.tipo_calzado });
    if (pais_origen_iso2) chips.push({ label: "ORIGEN", value: pais_origen_iso2 });
    return chips.slice(0, 4);
  }, [specs, pais_origen_iso2]);

  const benefits = useMemo(() => {
    const list = [];
    const add = (tag, title, text, color) => list.push({ tag, title, text, color });
    const puntera = String(specs.tipo_puntera || "").toLowerCase();
    if (puntera.includes("composite") || puntera.includes("acero") || puntera.includes("metal")) {
      add("PUN", "Puntera más ligera", "Puntera de composite o metal que protege contra impactos y compresión, más ligera que el acero tradicional.", COLORS.mint);
    }
    if (String(specs.antiperforante || "").toLowerCase() !== "no" && specs.antiperforante) {
      add("ANT", "Antiperforación total", "Plantilla no metálica que protege la planta del pie contra objetos punzantes.", COLORS.blue);
    }
    const suela = String(specs.suela || "").toLowerCase();
    if (suela.includes("antideslizante") || suela.includes("src") || suela.includes("bidensidad")) {
      add("SRC", "Suela antideslizante", "Suela bidensidad con diseño que mejora la adherencia en superficies resbaladizas.", COLORS.purple);
    }
    if (riesgos.some((r) => String(r).toLowerCase().includes("shock")) || specs.disipativo_energia?.length) {
      add("DIÉ", "Disipación de energía", "Diseño que ayuda a disipar cargas electrostáticas y reduce el impacto en la marcha.", COLORS.cyan);
    }
    if (String(specs.protector_metatarsal || "").toLowerCase() !== "no" && specs.protector_metatarsal) {
      add("MET", "Protector metatarsal", "Protección adicional para la zona del empeine contra impactos.", COLORS.mint);
    }
    if (String(specs.materiales_circulares || "").toLowerCase() === "sí") {
      add("SUS", "Materiales circulares", "Construcción con materiales seleccionados pensando en sostenibilidad.", COLORS.lightGreen);
    }
    // Fallbacks si quedan muy pocos
    if (list.length < 3) {
      add("COM", "Confort de jornada", "Diseño ergonómico para uso prolongado durante la jornada laboral.", COLORS.blue);
    }
    if (list.length < 3) {
      add("NOR", "Normativa certificada", `Certificado conforme a ${normativa}.`, COLORS.mint);
    }
    return list.slice(0, 6);
  }, [specs, riesgos, normativa]);

  const technologies = useMemo(() => {
    const list = [];
    if (specs.tipo_puntera) {
      list.push({
        index: "T1",
        title: `Puntera ${specs.tipo_puntera}`,
        text: punteraText(specs.tipo_puntera),
        color: COLORS.mint,
      });
    }
    if (specs.plantilla_interna) {
      list.push({
        index: "T2",
        title: `Plantilla ${specs.plantilla_interna}`,
        text: plantillaText(specs.plantilla_interna, specs.antiperforante),
        color: COLORS.blue,
      });
    }
    if (specs.suela) {
      list.push({
        index: "T3",
        title: `Suela ${specs.suela}`,
        text: suelaText(specs.suela),
        color: COLORS.purple,
      });
    }
    return list;
  }, [specs]);

  const normaStats = useMemo(() => {
    const norma = String(normativa).toLowerCase();
    if (norma.includes("20345") || norma.includes("iso")) {
      return [
        { value: "200J", label: "Impacto", note: "Resistencia de puntera" },
        { value: "1500N", label: "Compresión", note: "Carga máxima de puntera" },
        { value: "1100N", label: "Antiperforación", note: "Plantilla no metálica" },
        { value: "SRC", label: "Antideslizante", note: "Cerámica + acero" },
      ];
    }
    return [];
  }, [normativa]);

  const specGroups = useMemo(() => {
    const build = [];
    const tech = [];
    if (specs.capellada) tech.push({ label: "Capellada", value: specs.capellada });
    if (specs.cierre) tech.push({ label: "Cierre", value: specs.cierre });
    if (specs.tipo_puntera) tech.push({ label: "Puntera", value: specs.tipo_puntera });
    if (specs.plantilla_interna) tech.push({ label: "Plantilla interna", value: specs.plantilla_interna });
    if (specs.antiperforante && specs.antiperforante !== "No") tech.push({ label: "Antiperforante", value: specs.antiperforante });
    if (specs.suela) tech.push({ label: "Suela", value: specs.suela });
    if (specs.protector_metatarsal && specs.protector_metatarsal !== "No") tech.push({ label: "Protector metatarsal", value: specs.protector_metatarsal });
    if (specs.disipativo_energia?.length) tech.push({ label: "Disipativo de energía", value: specs.disipativo_energia.join(", ") });
    if (tech.length) build.push({ title: "CONSTRUCCIÓN DEL CALZADO", items: tech });

    const data = [];
    if (specs.color) data.push({ label: "Color", value: specs.color });
    if (specs.ncm || product?.hs_code) data.push({ label: "NCM / HS", value: specs.ncm || product?.hs_code });
    if (specs.tipo_calzado) data.push({ label: "Tipo de calzado", value: specs.tipo_calzado });
    if (product?.peso_kg) data.push({ label: "Peso por pie", value: `${product.peso_kg} kg` });
    if (product?.volumen_m3) data.push({ label: "Volumen", value: `${product.volumen_m3} m³` });
    if (pais_origen_iso2) data.push({ label: "País de origen", value: pais_origen_iso2 });
    if (normativa) data.push({ label: "Norma", value: normativa });
    if (data.length) build.push({ title: "DATOS TÉCNICOS", items: data });
    return build;
  }, [specs, product, pais_origen_iso2, normativa]);

  const segmentCards = useMemo(() => {
    const all = segmentos.length ? segmentos : ["Industrial"];
    const palette = [COLORS.mint, COLORS.blue, COLORS.purple, COLORS.cyan];
    return all.slice(0, 4).map((name, i) => ({
      name,
      note: sectorNote(name),
      color: palette[i % palette.length],
    }));
  }, [segmentos]);

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

      {/* Hero */}
      <section className="ppd-hero">
        <div className="ppd-hero-inner">
          <div className="ppd-hero-info">
            <div className="ppd-eyebrow">
              <span>LÍNEA {familia.toUpperCase()}</span>
              <span className="ppd-eyebrow-line" />
              <span>{normativa}</span>
            </div>
            <h1 className="ppd-title">{nombre}</h1>
            <div className="ppd-subtitle">SKU: {sku} · {categoria}{subcategoria ? ` / ${subcategoria}` : ""}</div>
            <p className="ppd-desc">{descripcion || defaultDescription(nombre, familia, lang)}</p>

            <div className="ppd-hero-chips">
              {heroChips.map((chip) => (
                <div key={chip.label} className="ppd-hero-chip">
                  <span className="ppd-chip-label">{chip.label}</span>
                  <span className="ppd-chip-value">{chip.value}</span>
                </div>
              ))}
            </div>

            <div className="ppd-hero-price">
              {Number(precio_venta) > 0 ? (
                <>
                  <span className="ppd-price">{fmtMoney(precio_venta, moneda || "USD")}</span>
                  <span className="ppd-price-note">{lang === "es" ? "precio base por par" : "base price per pair"}</span>
                </>
              ) : (
                <span className="ppd-price-na">{lang === "es" ? "Consultar precio" : "Quote on request"}</span>
              )}
            </div>
          </div>

          <div className="ppd-hero-image">
            {imagen_url ? (
              <img src={imageUrl(imagen_url)} alt={nombre} loading="eager" />
            ) : (
              <div className="ppd-hero-image-placeholder">
                <IconImage size={48} />
                <span>{lang === "es" ? "Imagen del producto" : "Product image"}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="ppd-section ppd-benefits">
        <div className="ppd-section-head">
          <h2>{lang === "es" ? "Beneficios y diferenciales" : "Benefits & differentiators"}</h2>
          <span className="ppd-section-kicker">{lang === "es" ? "POR QUÉ ELEGIRLA" : "WHY CHOOSE IT"}</span>
        </div>
        <div className="ppd-benefits-grid">
          {benefits.map((b) => (
            <div key={b.title} className="ppd-benefit-card">
              <div className="ppd-benefit-tag" style={{ background: b.color }}>{b.tag}</div>
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Technologies */}
      {technologies.length > 0 && (
        <section className="ppd-section ppd-tech">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Tecnologías" : "Technologies"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "INGENIERÍA DEL CALZADO" : "SHOE ENGINEERING"}</span>
          </div>
          <div className="ppd-tech-list">
            {technologies.map((t) => (
              <div key={t.title} className="ppd-tech-card">
                <div className="ppd-tech-media">
                  <IconImage size={32} />
                  <span>DETALLE · 900 × 675 px</span>
                </div>
                <div className="ppd-tech-body">
                  <div className="ppd-tech-index" style={{ color: "#fff", background: t.color }}>{t.index}</div>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Norms */}
      {normaStats.length > 0 && (
        <section className="ppd-section ppd-norms">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Cumplimiento de normas" : "Standards compliance"}</h2>
            <span className="ppd-section-kicker">{normativa}</span>
          </div>
          <p className="ppd-norms-intro">
            {lang === "es"
              ? "Desempeño certificado conforme a la norma brasileña NBR ISO, referencia internacional en calzado de seguridad ocupacional."
              : "Certified performance according to the Brazilian NBR ISO standard, an international reference in occupational safety footwear."}
          </p>
          <div className="ppd-norms-grid">
            {normaStats.map((s) => (
              <div key={s.label} className="ppd-norm-card">
                <span className="ppd-norm-value">{s.value}</span>
                <span className="ppd-norm-label">{s.label}</span>
                <span className="ppd-norm-note">{s.note}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Specifications */}
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

      {/* Segments */}
      {segmentCards.length > 0 && (
        <section className="ppd-section ppd-segments">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Aplicaciones y sectores" : "Applications & sectors"}</h2>
            <span className="ppd-section-kicker">{lang === "es" ? "DÓNDE SE USA" : "WHERE IT IS USED"}</span>
          </div>
          <div className="ppd-segments-grid">
            {segmentCards.map((seg) => (
              <div key={seg.name} className="ppd-segment-card">
                <div className="ppd-segment-icon" style={{ background: seg.color }}>
                  <IconGlobe size={22} />
                </div>
                <div>
                  <h3>{seg.name}</h3>
                  <p>{seg.note}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Gallery */}
      {(gallery.length > 0 || imagen_url) && (
        <section className="ppd-section ppd-gallery">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Galería" : "Gallery"}</h2>
          </div>
          <div className="ppd-gallery-grid">
            {(gallery.length ? gallery : [imagen_url]).filter(Boolean).map((src, i) => (
              <div key={i} className="ppd-gallery-item">
                <img src={imageUrl(src)} alt={`${nombre} ${i + 1}`} loading="lazy" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Technical docs */}
      {fichas.length > 0 && (
        <section className="ppd-section ppd-docs">
          <div className="ppd-section-head">
            <h2>{lang === "es" ? "Fichas técnicas" : "Technical datasheets"}</h2>
          </div>
          <div className="ppd-docs-list">
            {fichas.map((f, i) => {
              const filename = String(f).split("/").pop();
              return (
                <a
                  key={i}
                  href={imageUrl(f)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ppd-doc-link"
                >
                  <IconFileText size={20} />
                  <span className="ppd-doc-name">{filename}</span>
                  <IconDownload size={18} />
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="ppd-cta">
        <div className="ppd-cta-inner">
          <div>
            <h2>{lang === "es" ? "¿Necesita esta línea para su equipo?" : "Need this line for your team?"}</h2>
            <p>
              {lang === "es"
                ? "Solicite cotización, disponibilidad de tallas y volúmenes. Asesoría técnica en selección de EPP para su operación."
                : "Request a quote, size availability and volumes. Technical advice on PPE selection for your operation."}
            </p>
          </div>
          <button
            type="button"
            className="ppd-cta-btn"
            onClick={() => navigate("/portal/nueva-oc", { state: { entrySource: "portal_product_detail", jumpToStep: "products" } })}
          >
            {lang === "es" ? "Solicitar cotización" : "Request quote"} <IconArrow size={16} />
          </button>
        </div>
      </section>

      <footer className="ppd-footer">
        {marca_nombre || marca_label || "MWT"} · {lang === "es" ? "FICHA TÉCNICA" : "TECHNICAL SHEET"} {sku} · {normativa}
      </footer>
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

function IconAlert({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3 1 21h22L12 3z" />
      <path d="M12 10v4M12 17v.5" />
    </svg>
  );
}

function defaultDescription(nombre, familia, lang) {
  return lang === "es"
    ? `Calzado de seguridad ${familia ? `de línea ${familia}` : ""} diseñado para entornos industriales exigentes. Modelo ${nombre || ""}.`
    : `Safety footwear ${familia ? `from the ${familia} line` : ""} designed for demanding industrial environments. Model ${nombre || ""}.`;
}

function punteraText(tipo) {
  const t = String(tipo).toLowerCase();
  if (t.includes("composite")) return "Puntera de composite que protege contra impactos de 200 J y compresión de 1500 N. Más ligera que el acero, no conduce calor/frío y no dispara detectores de metal.";
  if (t.includes("acero") || t.includes("metal")) return "Puntera de acero que resiste impactos de 200 J y compresión de 1500 N para máxima protección en entornos pesados.";
  return `Puntera ${tipo} para protección contra impactos y compresión.`;
}

function plantillaText(plantilla, antiperforante) {
  if (String(antiperforante || "").toLowerCase() !== "no" && antiperforante) {
    return `Plantilla ${plantilla} con resistencia antiperforante para proteger la planta del pie de objetos punzantes.`;
  }
  return `Plantilla ${plantilla} diseñada para confort durante la jornada y absorción de impactos.`;
}

function suelaText(suela) {
  return `Suela ${suela} con diseño antideslizante y bidensidad que combina confort y resistencia a la abrasión.`;
}

function sectorNote(name) {
  const map = {
    "Construcción Civil": "Obra, terreno y estructura",
    "Servicios Generales": "Mantenimiento y logística",
    "Eléctrica": "Instalaciones y redes",
    "Mecánica": "Talleres e industria",
    "Alimentaria": "Procesamiento de alimentos",
    "Salud": "Hospitales y clínicas",
    "Industrial": "Entornos industriales",
  };
  return map[name] || "Entornos industriales";
}
