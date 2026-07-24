"""
Generador de PDF de ficha técnica de producto con WeasyPrint.
"""
import base64
import io
import logging
from typing import Any, Dict, List, Optional

from django.http import HttpResponse
from django.utils import timezone

from apps.storage.services import get_object_stream
from .models import Producto
from .serializers import ProductoSerializer

log = logging.getLogger(__name__)


def _minio_bytes(key: Optional[str]) -> Optional[bytes]:
    """Descarga los bytes de una key MinIO. Devuelve None si falla."""
    if not key or not isinstance(key, str):
        return None
    try:
        resp = get_object_stream(key)
        if resp is None:
            return None
        data = resp.read()
        resp.close()
        return data
    except Exception as e:
        log.warning("_minio_bytes(%s) falló: %s", key, e)
        return None


def _b64_img(key: Optional[str], max_w: int = 900, max_h: int = 700) -> Optional[str]:
    """Convierte una imagen MinIO a data URI base64. None si falla."""
    data = _minio_bytes(key)
    if not data:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        img.thumbnail((max_w, max_h))
        buf = io.BytesIO()
        fmt = img.format or "PNG"
        if fmt.upper() in ("JPEG", "JPG"):
            fmt = "JPEG"
        elif fmt.upper() == "WEBP":
            fmt = "WEBP"
        else:
            fmt = "PNG"
        img.save(buf, format=fmt)
        mime = f"image/{fmt.lower()}"
        return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"
    except Exception as e:
        log.warning("_b64_img(%s) falló: %s", key, e)
        return None


def _fetch_tallas(ids: List[str]) -> List[Dict[str, Any]]:
    """Consulta las tallas vinculadas al producto para la tabla de equivalencias."""
    if not ids:
        return []
    try:
        from apps.sizing.models import Talla
        qs = Talla.objects.filter(id__in=ids, is_active=True)
        return [
            {
                "id": str(t.id),
                "talla_base": t.talla_base,
                "nombre": t.nombre,
                "eu": t.eu,
                "us_men": t.us_men,
                "us_women": t.us_women,
                "uk_men": t.uk_men,
                "uk_women": t.uk_women,
                "mx": t.mx,
                "ar": t.ar,
                "jp": t.jp,
                "cn": t.cn,
                "kr": t.kr,
                "cm": t.cm,
                "inch": t.inch,
                "ancho_mm": t.ancho_mm,
                "comprimento_mm": t.comprimento_mm,
            }
            for t in qs
        ]
    except Exception as e:
        log.warning("_fetch_tallas(%s) falló: %s", ids, e)
        return []


def _safe(value: Any, default: str = "—") -> str:
    """Formatea un valor escapando HTML y usando default si es vacío."""
    if value is None or value == "":
        return default
    from django.utils.html import escape
    return escape(str(value))


def _safe_list(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if x is not None and str(x).strip()]


def _chips_html(items: List[str], css_class: str = "chip") -> str:
    if not items:
        return '<span class="muted">—</span>'
    return "".join(f'<span class="{css_class}">{_safe(x)}</span>' for x in items)


def _kv_html(rows: List[tuple]) -> str:
    """Renderiza una fila de clave-valor tipo diccionario visual."""
    if not rows:
        return '<div class="kv-empty">Sin datos</div>'
    out = []
    for k, v in rows:
        if v is None or v == "":
            continue
        out.append(f'<div class="kv-row"><span class="kv-key">{_safe(k)}</span><span class="kv-val">{_safe(v)}</span></div>')
    return "".join(out) if out else '<div class="kv-empty">Sin datos</div>'


def _talla_table_html(tallas: List[Dict[str, Any]]) -> str:
    if not tallas:
        return '<div class="muted">Sin tallas configuradas</div>'

    def sort_key(t):
        try:
            return float(t.get("talla_base") or 9999)
        except (TypeError, ValueError):
            return 9999

    tallas = sorted(tallas, key=sort_key)
    systems = [
        ("BRA", "talla_base"), ("EU", "eu"), ("US Men", "us_men"),
        ("US Women", "us_women"), ("UK Men", "uk_men"), ("UK Women", "uk_women"),
        ("MX", "mx"), ("AR", "ar"), ("JP", "jp"), ("CN", "cn"),
        ("KR", "kr"), ("CM", "cm"), ("IN", "inch"),
    ]
    visible = [(label, key) for label, key in systems if any(t.get(key) for t in tallas)]
    if not visible:
        visible = [("BRA", "talla_base")]

    head = "".join(f"<th>{_safe(label)}</th>" for label, _ in visible)
    rows = []
    for t in tallas:
        cells = "".join(f"<td>{_safe(t.get(key) or '—')}</td>" for _, key in visible)
        rows.append(f"<tr>{cells}</tr>")

    return f"""
    <table class="talla-table">
      <thead><tr>{head}</tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    """


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Ficha técnica · {sku}</title>
<style>
  @page {{
    size: A4;
    margin: 14mm 14mm 18mm 14mm;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: 'DejaVu Sans', 'Segoe UI', Arial, sans-serif;
    color: #0B1E3A;
    margin: 0;
    padding: 0;
    font-size: 11px;
    line-height: 1.45;
  }}
  .header {{
    background: linear-gradient(120deg, #013A57 0%, #0a4d6e 100%);
    color: #fff;
    padding: 22px 24px;
    border-radius: 10px;
    margin-bottom: 18px;
  }}
  .header .brand {{
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #75CBB3;
    margin-bottom: 6px;
  }}
  .header .title {{
    font-size: 24px;
    font-weight: 800;
    line-height: 1.2;
    margin: 0;
  }}
  .header .sku {{
    font-family: 'DejaVu Sans Mono', monospace;
    font-size: 13px;
    color: #cfe3ec;
    margin-top: 4px;
  }}
  .quick-facts {{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
  }}
  .fact {{
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.18);
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 10px;
    color: #fff;
  }}
  .hero {{
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 20px;
    margin-bottom: 18px;
    page-break-inside: avoid;
  }}
  .hero-img {{
    border: 1px solid #E5E7EB;
    border-radius: 10px;
    background: #fff;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 260px;
  }}
  .hero-img img {{
    max-width: 100%;
    max-height: 260px;
    object-fit: contain;
  }}
  .hero-desc {{
    display: flex;
    flex-direction: column;
    justify-content: center;
  }}
  .section {{
    margin-bottom: 16px;
    page-break-inside: avoid;
  }}
  .section-title {{
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.9px;
    text-transform: uppercase;
    color: #013A57;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }}
  .section-title::before {{
    content: '';
    width: 4px;
    height: 14px;
    border-radius: 2px;
    background: #00B286;
    display: inline-block;
  }}
  .card {{
    border: 1px solid #E5E7EB;
    border-radius: 10px;
    background: #fff;
    padding: 12px;
  }}
  .kv-grid {{
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0 18px;
  }}
  .kv-row {{
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px solid #F1F5F9;
    font-size: 10.5px;
  }}
  .kv-key {{
    color: #64748B;
    font-weight: 600;
  }}
  .kv-val {{
    color: #0B1E3A;
    font-weight: 700;
    text-align: right;
  }}
  .chip-group {{
    margin-bottom: 10px;
  }}
  .chip-label {{
    font-size: 10px;
    font-weight: 700;
    color: #013A57;
    margin-bottom: 4px;
  }}
  .chip {{
    display: inline-block;
    padding: 4px 9px;
    border-radius: 999px;
    font-size: 9.5px;
    border: 1px solid rgba(1,58,87,0.18);
    background: rgba(1,58,87,0.05);
    color: #013A57;
    font-weight: 600;
    margin-right: 5px;
    margin-bottom: 4px;
  }}
  .muted {{
    color: #94A3B8;
    font-size: 10px;
  }}
  .talla-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }}
  .talla-table th {{
    background: #013A57;
    color: #fff;
    padding: 6px 5px;
    text-align: center;
    font-weight: 700;
    white-space: nowrap;
  }}
  .talla-table td {{
    padding: 5px 5px;
    text-align: center;
    border-bottom: 1px solid #E5E7EB;
    color: #0B1E3A;
    font-weight: 600;
  }}
  .talla-table tbody tr:nth-child(even) {{
    background: #F8FAFB;
  }}
  .gallery {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }}
  .gallery-img {{
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    background: #fff;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
  }}
  .gallery-img img {{
    max-width: 100%;
    max-height: 140px;
    object-fit: contain;
  }}
  .footer {{
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #E5E7EB;
    text-align: center;
    color: #94A3B8;
    font-size: 9px;
  }}
  .page-break {{
    page-break-before: always;
  }}
  @media print {{
    .page-break {{ page-break-before: always; }}
  }}
</style>
</head>
<body>

<div class="header">
  <div class="brand">{marca}</div>
  <h1 class="title">{nombre}</h1>
  <div class="sku">SKU: {sku}</div>
  <div class="quick-facts">{facts_html}</div>
</div>

<div class="hero">
  <div class="hero-img">{hero_img_html}</div>
  <div class="hero-desc">
    <div class="section">
      <div class="section-title">Descripción</div>
      <p style="margin:0;font-size:11px;color:#334155;">{descripcion}</p>
    </div>
    <div class="section">
      <div class="section-title">Información base</div>
      <div class="card">
        <div class="kv-grid">{info_base_html}</div>
      </div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Atributos técnicos</div>
  <div class="card">
    <div class="kv-grid">{atributos_html}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Normativa · Riesgos · Segmentos</div>
  <div class="card">{chips_html}</div>
</div>

<div class="page-break"></div>

<div class="section">
  <div class="section-title">Tabla de tallas y equivalencias</div>
  <div class="card">{talla_table_html}</div>
</div>

{gallery_html}

<div class="footer">
  Ficha técnica generada por MWT.ONE · {fecha}
</div>

</body>
</html>
"""


def render_ficha_tecnica_pdf(producto_id: str) -> Optional[bytes]:
    """
    Genera el PDF de la ficha técnica. Devuelve bytes o None si falla.
    """
    try:
        producto = Producto.objects.get(pk=producto_id, is_active=True)
    except Producto.DoesNotExist:
        return None

    data = ProductoSerializer(producto).data
    esp = data.get("especificaciones") or {}

    # ── Imagen principal y galería ─────────────────────────────────────
    hero_key = data.get("imagen_url") or (
        esp.get("gallery") and esp.get("gallery")[0] or None
    )
    hero_b64 = _b64_img(hero_key, max_w=900, max_h=700) if hero_key else None
    hero_img_html = (
        f'<img src="{hero_b64}" alt="producto"/>' if hero_b64
        else '<div class="muted">Sin imagen</div>'
    )

    gallery_keys = _safe_list(esp.get("gallery"))
    gallery_items = []
    for k in gallery_keys[1:4]:  # máximo 3 imágenes adicionales
        b64 = _b64_img(k, max_w=600, max_h=450)
        if b64:
            gallery_items.append(f'<div class="gallery-img"><img src="{b64}" alt="galería"/></div>')
    gallery_html = ""
    if gallery_items:
        gallery_html = f"""
        <div class="section page-break">
          <div class="section-title">Galería</div>
          <div class="gallery">{''.join(gallery_items)}</div>
        </div>
        """

    # ── Datos de la ficha ─────────────────────────────────────────────
    marca = data.get("marca_nombre") or "Marca"
    sku = data.get("sku") or "—"
    nombre = data.get("nombre") or "Producto"
    descripcion = data.get("descripcion") or esp.get("descripcion") or "Sin descripción disponible."

    facts = [
        ("Categoría", data.get("categoria")),
        ("Color", esp.get("color")),
        ("País", data.get("pais_origen_iso2")),
        ("NCM", esp.get("ncm") or data.get("hs_code")),
    ]
    facts_html = "".join(
        f'<span class="fact">{_safe(k)}: {_safe(v)}</span>'
        for k, v in facts if v
    )

    info_base = [
        ("Categoría", data.get("categoria")),
        ("Subcategoría", data.get("subcategoria")),
        ("Color", esp.get("color")),
        ("País de origen", data.get("pais_origen_iso2")),
        ("NCM / HS Code", esp.get("ncm") or data.get("hs_code")),
        ("Unidad", data.get("unidad")),
        ("Moneda", data.get("moneda")),
    ]
    info_base_html = _kv_html(info_base)

    atributos = [
        ("Tipo de calzado", esp.get("tipo_calzado")),
        ("Tipo de puntera", esp.get("tipo_puntera")),
        ("Cubre puntera", esp.get("cubrepuntera")),
        ("Antiperforante", esp.get("antiperforante")),
        ("Protector metatarsal", esp.get("protector_metatarsal")),
        ("Capellada", esp.get("capellada")),
        ("Suela", esp.get("suela")),
        ("Cierre", esp.get("cierre")),
        ("Plantilla interna", esp.get("plantilla_interna")),
        ("Materiales circulares", esp.get("materiales_circulares")),
    ]
    atributos_html = _kv_html(atributos)

    chip_groups = [
        ("Normativa", _safe_list(esp.get("normativa"))),
        ("Disipativo de energía", _safe_list(esp.get("disipativo_energia"))),
        ("Riesgo", _safe_list(esp.get("riesgo"))),
        ("Segmento", _safe_list(esp.get("segmento"))),
    ]
    chips_html = ""
    for label, items in chip_groups:
        if items:
            chips_html += f"""
            <div class="chip-group">
              <div class="chip-label">{_safe(label)}</div>
              <div>{_chips_html(items)}</div>
            </div>
            """
    if not chips_html:
        chips_html = '<span class="muted">Sin datos</span>'

    # ── Tallas ────────────────────────────────────────────────────────
    talla_ids = _safe_list(esp.get("sizes")) or _safe_list(data.get("tallas"))
    tallas = _fetch_tallas(talla_ids)
    talla_table_html = _talla_table_html(tallas)

    html = HTML_TEMPLATE.format(
        marca=_safe(marca),
        nombre=_safe(nombre),
        sku=_safe(sku),
        facts_html=facts_html,
        hero_img_html=hero_img_html,
        descripcion=_safe(descripcion),
        info_base_html=info_base_html,
        atributos_html=atributos_html,
        chips_html=chips_html,
        talla_table_html=talla_table_html,
        gallery_html=gallery_html,
        fecha=timezone.now().strftime("%d/%m/%Y %H:%M"),
    )

    try:
        from weasyprint import HTML
        pdf = HTML(string=html).write_pdf()
        return pdf
    except Exception as e:
        log.error("render_ficha_tecnica_pdf(%s) WeasyPrint falló: %s", producto_id, e)
        return None


def pdf_response(producto_id: str, filename: Optional[str] = None) -> HttpResponse:
    """
    Devuelve un HttpResponse con el PDF. Si falla, devuelve 404.
    """
    pdf_bytes = render_ficha_tecnica_pdf(producto_id)
    if not pdf_bytes:
        return HttpResponse(status=404)
    if not filename:
        filename = f"ficha-tecnica-{producto_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
