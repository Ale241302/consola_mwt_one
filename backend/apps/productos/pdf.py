"""
Generador de PDF de ficha técnica de producto con ReportLab.
Diseño 1:1 estilo ficha técnica comercial oficial Marluvas (New Prime / Composite).
Garantiza 1 sola página A4, imágenes en alta resolución con fondo transparente
compositado a blanco sin bordes dentados ni pixelación.
"""
import io
import logging
from typing import Any, Dict, List, Optional

from django.http import HttpResponse
from django.utils import timezone

from apps.storage.services import get_object_stream
from .models import Producto
from .serializers import ProductoSerializer

log = logging.getLogger(__name__)

# ── Paleta Marluvas / MWT ───────────────────────────────────────────
COLOR_NAVY = "#013A57"         # Azul marino principal Marluvas
COLOR_NAVY_DARK = "#0B1E3A"    # Azul marino oscuro para textos principales
COLOR_NAVY_LIGHT = "#0A4D6E"
COLOR_CYAN = "#00A3E0"         # Cyan para "Línea New Prime / Composite"
COLOR_TEAL = "#00B286"
COLOR_ORANGE = "#E85D04"       # Naranja Marluvas (SKU y banners)
COLOR_ORANGE_LIGHT = "#FFF7ED" # Fondo suave de avisos
COLOR_TEXT = "#1E293B"
COLOR_TEXT_SECONDARY = "#475569"
COLOR_TEXT_MUTED = "#64748B"
COLOR_BORDER = "#CBD5E1"
COLOR_BG_CARD = "#F8FAFC"
COLOR_WHITE = "#FFFFFF"


def _minio_bytes(key: Optional[str]) -> Optional[bytes]:
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


def _minio_image(key: Optional[str], max_w: int = 2400, max_h: int = 2400) -> Optional[Any]:
    """
    Descarga imagen de MinIO en alta resolución.
    Si la imagen es RGBA (PNG/WebP transparente), la composita limpiamente
    sobre un fondo blanco puro (#FFFFFF) usando la máscara alpha. Esto elimina
    recortes dentados, fondos negros y arte de pixelación al convertir a PDF.
    """
    data = _minio_bytes(key)
    if not data:
        return None
    try:
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(data))

        # Manejo de transparencia alpha (PNG / WebP)
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
            bg = PILImage.new("RGBA", img.size, (255, 255, 255, 255))
            bg.paste(img, (0, 0), img)
            img = bg.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Redimensionado de alta calidad mantenido en alta resolución
        img.thumbnail((max_w, max_h), PILImage.Resampling.LANCZOS)
        return img
    except Exception as e:
        log.warning("_minio_image(%s) falló: %s", key, e)
        return None


def _fetch_tallas(ids: List[str]) -> List[Dict[str, Any]]:
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
            }
            for t in qs
        ]
    except Exception as e:
        log.warning("_fetch_tallas(%s) falló: %s", ids, e)
        return []


def _safe(value: Any, default: str = "—") -> str:
    if value is None or value == "":
        return default
    return str(value)


def _safe_list(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if x is not None and str(x).strip()]


def _rl_image(img: Any, max_w: float, max_h: float) -> Optional[Any]:
    """Devuelve un RLImage listo para insertar, con dimensiones escaladas manteniendo aspecto."""
    if img is None:
        return None
    try:
        from reportlab.platypus import Image as RLImage
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        img_w, img_h = img.size
        scale = min(max_w / img_w, max_h / img_h, 1.0)
        return RLImage(buf, width=img_w * scale, height=img_h * scale)
    except Exception as e:
        log.warning("_rl_image falló: %s", e)
        return None


def _section_banner(text: str, styles: Dict[str, Any], bg_color: str = COLOR_ORANGE) -> Any:
    from reportlab.platypus import Paragraph, Table, TableStyle
    from reportlab.lib import colors

    style = styles["section_banner"]
    title = Paragraph(text, style)
    tbl = Table(
        [[title]],
        colWidths=[192 * 2.835],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_color)),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]),
    )
    return tbl


def _compact_talla_table(tallas: List[Dict[str, Any]]) -> Any:
    """Renders a compact 1-line or 2-line sizing matrix to fit cleanly on page 1."""
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    if not tallas:
        return None

    def sort_key(t):
        try:
            return float(t.get("talla_base") or 9999)
        except (TypeError, ValueError):
            return 9999

    tallas = sorted(tallas, key=sort_key)
    systems = [
        ("BRA", "talla_base"), ("EU", "eu"), ("US M", "us_men"),
        ("US W", "us_women"), ("UK M", "uk_men"),
        ("MX", "mx"), ("AR", "ar"), ("CM", "cm"),
    ]
    visible = [(label, key) for label, key in systems if any(t.get(key) for t in tallas)]
    if not visible:
        visible = [("BRA", "talla_base")]

    tallas_shown = tallas[:15]

    header = ["SISTEMA"] + [_safe(t.get("talla_base")) for t in tallas_shown]
    rows = []
    for label, key in visible:
        if key == "talla_base":
            continue
        row = [label] + [_safe(t.get(key) or "—") for t in tallas_shown]
        rows.append(row)

    data = [header] + rows
    col_w = [14 * 2.835] + [((192 - 14) / max(len(tallas_shown), 1)) * 2.835] * len(tallas_shown)

    tbl = Table(data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 6.5),
        ("LEADING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(COLOR_NAVY)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor(COLOR_TEXT)),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor(COLOR_BORDER)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
    ]))
    for i in range(1, len(data)):
        if i % 2 == 0:
            tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (-1, i), colors.HexColor(COLOR_BG_CARD))]))
    return tbl


def draw_first_page_background(canvas, doc):
    """Dibuja el footer institucional Marluvas / MWT.ONE al pie de la única página."""
    from reportlab.lib import colors

    canvas.saveState()
    # 1. Nota de validez (Banner Naranja)
    canvas.setFillColor(colors.HexColor(COLOR_ORANGE))
    canvas.rect(0, 18, 595.27, 16, stroke=0, fill=1)

    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(colors.white)
    canvas.drawCentredString(595.27 / 2, 22, "Nota: La validez del producto empieza por la fecha de fabricación")

    # 2. Barra de contacto inferior (Azul Marino Oscuro)
    canvas.setFillColor(colors.HexColor(COLOR_NAVY_DARK))
    canvas.rect(0, 0, 595.27, 18, stroke=0, fill=1)

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#E2E8F0"))
    canvas.drawCentredString(
        595.27 / 2, 5,
        "marluvas.com.br/es   |   consola.mwt.one   |   +55 0300 788 3323"
    )
    canvas.restoreState()


def render_ficha_tecnica_pdf(producto_id: str) -> Optional[bytes]:
    try:
        producto = Producto.objects.get(pk=producto_id, is_active=True)
    except Producto.DoesNotExist:
        return None

    data = ProductoSerializer(producto).data
    esp = data.get("especificaciones") or {}

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        )

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            rightMargin=9 * mm, leftMargin=9 * mm,
            topMargin=8 * mm, bottomMargin=16 * mm,
            title=f"Ficha Técnica · {data.get('sku') or producto_id}",
        )

        # ── Estilos ───────────────────────────────────────────────────
        styles = {
            "brand_title": ParagraphStyle(
                "brand_title", fontName="Helvetica-Bold", fontSize=22,
                textColor=colors.HexColor(COLOR_NAVY), leading=24, spaceAfter=2,
            ),
            "brand_sub": ParagraphStyle(
                "brand_sub", fontName="Helvetica-Bold", fontSize=8,
                textColor=colors.HexColor(COLOR_TEXT_MUTED), leading=10, spaceAfter=6,
            ),
            "linea": ParagraphStyle(
                "linea", fontName="Helvetica-Bold", fontSize=13,
                textColor=colors.HexColor(COLOR_CYAN), leading=15, spaceAfter=2,
            ),
            "sku": ParagraphStyle(
                "sku", fontName="Helvetica-Bold", fontSize=18,
                textColor=colors.HexColor(COLOR_ORANGE), leading=20, spaceAfter=4,
            ),
            "summary_desc": ParagraphStyle(
                "summary_desc", fontName="Helvetica", fontSize=8.5,
                textColor=colors.HexColor(COLOR_TEXT), leading=11.5,
            ),
            "section_banner": ParagraphStyle(
                "section_banner", fontName="Helvetica-Bold", fontSize=10,
                textColor=colors.white, leading=12,
            ),
            "body": ParagraphStyle(
                "body", fontName="Helvetica", fontSize=8,
                textColor=colors.HexColor(COLOR_TEXT), leading=11,
            ),
            "kv_label": ParagraphStyle(
                "kv_label", fontName="Helvetica-Bold", fontSize=8,
                textColor=colors.HexColor(COLOR_NAVY), leading=10,
            ),
            "kv_val": ParagraphStyle(
                "kv_val", fontName="Helvetica", fontSize=8,
                textColor=colors.HexColor(COLOR_TEXT), leading=10,
            ),
            "bullet_item": ParagraphStyle(
                "bullet_item", fontName="Helvetica", fontSize=7.5,
                textColor=colors.HexColor(COLOR_TEXT), leading=9.5,
            ),
            "attr_header": ParagraphStyle(
                "attr_header", fontName="Helvetica-Bold", fontSize=8,
                textColor=colors.HexColor(COLOR_ORANGE), leading=10,
            ),
            "attr_body": ParagraphStyle(
                "attr_body", fontName="Helvetica", fontSize=7.5,
                textColor=colors.HexColor(COLOR_TEXT), leading=9.5,
            ),
        }

        story = []

        # ══════════════════════════════════════════════════════════════
        # HEADER — Marca + SKU + Descripción (Izq) | Hero + Gallery (Der)
        # ══════════════════════════════════════════════════════════════
        marca = data.get("marca_nombre") or "MARLUVAS"
        sku = data.get("sku") or "—"
        familia = _safe(esp.get("familia") or esp.get("linea") or "Composite")

        desc_parts = []
        if data.get("categoria"):
            desc_parts.append(f"{data['categoria']}s")
        if esp.get("tipo_puntera"):
            desc_parts.append(f"con puntera de {esp['tipo_puntera'].lower()}")
        if esp.get("capellada"):
            desc_parts.append(f"confeccionados de {esp['capellada'].lower()}")
        if esp.get("cierre"):
            desc_parts.append(f"cierre {esp['cierre'].lower()}")
        if esp.get("suela"):
            desc_parts.append(f"y suela {esp['suela'].lower()}")

        summary_text = (
            ", ".join(desc_parts) + "."
            if desc_parts
            else _safe(data.get("descripcion") or "Calzado ocupacional de alta calidad y protección.")
        )

        left_header_elements = [
            Paragraph(marca.upper(), styles["brand_title"]),
            Paragraph("EQUIPOS PROFESIONALES", styles["brand_sub"]),
            Paragraph(f"Línea {familia}", styles["linea"]),
            Paragraph(sku, styles["sku"]),
            Paragraph(summary_text, styles["summary_desc"]),
        ]

        # Imágenes (Hero principal + Galería secundaria)
        hero_key = data.get("imagen_url") or (
            esp.get("gallery") and esp.get("gallery")[0] or None
        )
        hero_img = _minio_image(hero_key, max_w=1800, max_h=1400) if hero_key else None
        hero_rl = _rl_image(hero_img, max_w=80 * mm, max_h=52 * mm) if hero_img else None

        gallery_keys = _safe_list(esp.get("gallery"))
        secondary_rls = []
        for k in gallery_keys[1:4]:
            sec_img = _minio_image(k, max_w=800, max_h=600)
            sec_rl = _rl_image(sec_img, max_w=26 * mm, max_h=22 * mm) if sec_img else None
            if sec_rl:
                secondary_rls.append(sec_rl)

        right_header_cells = []
        if hero_rl:
            right_header_cells.append([hero_rl])
        if secondary_rls:
            sec_tbl = Table([secondary_rls], colWidths=[27 * mm] * len(secondary_rls))
            sec_tbl.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]))
            right_header_cells.append([sec_tbl])

        right_header_tbl = Table(
            right_header_cells if right_header_cells else [[Paragraph("Sin imagen", styles["body"])]],
            colWidths=[84 * mm],
        )
        right_header_tbl.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))

        header_table = Table(
            [[left_header_elements, right_header_tbl]],
            colWidths=[108 * mm, 84 * mm],
        )
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(header_table)
        story.append(Spacer(1, 4))

        # ══════════════════════════════════════════════════════════════
        # BANNER DE ESPECIFICACIONES TÉCNICAS
        # ══════════════════════════════════════════════════════════════
        story.append(_section_banner("Especificaciones Técnicas", styles))
        story.append(Spacer(1, 4))

        # ══════════════════════════════════════════════════════════════
        # BLOQUE PRINCIPAL: COLUMNA IZQUIERDA (Destacados) | DERECHA (Detalles)
        # ══════════════════════════════════════════════════════════════
        bullets = [
            f"Puntera: {_safe(esp.get('tipo_puntera'))}",
            f"Capellada: {_safe(esp.get('capellada'))}",
            "Collarín acolchado",
            f"Cierre: {_safe(esp.get('cierre'))}",
            f"Forro interno: {_safe(esp.get('plantilla_interna') or 'Tejido no tejido')}",
            "Libre de componentes metálicos",
            "Plantilla antibacteriana",
            f"Suela: {_safe(esp.get('suela'))}",
        ]
        bullet_pars = [Paragraph(f"• {b}", styles["bullet_item"]) for b in bullets]

        quick_card_tbl = Table([[bullet_pars]], colWidths=[64 * mm])
        quick_card_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(COLOR_BG_CARD)),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(COLOR_BORDER)),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))

        left_side_content = [
            quick_card_tbl,
            Spacer(1, 4),
            Table([
                [Paragraph("<b>Color:</b>", styles["kv_label"]), Paragraph(_safe(esp.get("color")), styles["kv_val"])],
                [Paragraph("<b>País:</b>", styles["kv_label"]), Paragraph(_safe(data.get("pais_origen_iso2")), styles["kv_val"])],
                [Paragraph("<b>NCM:</b>", styles["kv_label"]), Paragraph(_safe(esp.get("ncm") or data.get("hs_code")), styles["kv_val"])],
                [Paragraph("<b>Normativa:</b>", styles["kv_label"]), Paragraph(_safe(", ".join(_safe_list(esp.get("normativa")))), styles["kv_val"])],
            ], colWidths=[18 * mm, 46 * mm], style=TableStyle([
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]))
        ]

        attr_rows = []

        suela_val = _safe(esp.get("suela"))
        suela_desc = (
            "Constituida por dos capas de poliuretano (PU), inyectada directamente a la capellada, "
            "siendo la 1ª capa (entresuela) más blanda y liviana proporcionando mayor comodidad; "
            "y la 2ª capa (suela) más compacta, resistente a objetos cortantes, perforantes y abrasión "
            "con sistema antideslizante (Categoría SRC)."
            if "PU" in suela_val.upper() or "BIDENSIDAD" in suela_val.upper()
            else f"Suela de alta resistencia confeccionada en {suela_val} con diseño ergonómico."
        )
        attr_rows.append([
            Paragraph("Suela", styles["attr_header"]),
            Paragraph(suela_desc, styles["attr_body"])
        ])

        if esp.get("capellada"):
            attr_rows.append([
                Paragraph("Capellada", styles["attr_header"]),
                Paragraph(f"Confeccionada de {_safe(esp.get('capellada'))} con alta resistencia al rasgado y flexión.", styles["attr_body"])
            ])

        if esp.get("antiperforante"):
            attr_rows.append([
                Paragraph("Antiperforante", styles["attr_header"]),
                Paragraph(f"Plantilla flexible {_safe(esp.get('antiperforante'))} con protección integral de la planta del pie.", styles["attr_body"])
            ])

        if esp.get("tipo_puntera"):
            attr_rows.append([
                Paragraph("Puntera", styles["attr_header"]),
                Paragraph(f"Puntera de {_safe(esp.get('tipo_puntera'))} resistente al impacto de 200J y compresión.", styles["attr_body"])
            ])

        segmentos = _safe_list(esp.get("segmento"))
        riesgos = _safe_list(esp.get("riesgo"))
        if segmentos or riesgos:
            tags = ", ".join(segmentos + riesgos)
            attr_rows.append([
                Paragraph("Segmentos", styles["attr_header"]),
                Paragraph(f"Ideal para uso en: <b>{tags}</b>.", styles["attr_body"])
            ])

        right_attr_tbl = Table(attr_rows, colWidths=[30 * mm, 94 * mm], style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor(COLOR_BORDER)),
        ]))

        body_grid = Table([[left_side_content, right_attr_tbl]], colWidths=[66 * mm, 126 * mm])
        body_grid.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(body_grid)
        story.append(Spacer(1, 4))

        # ══════════════════════════════════════════════════════════════
        # MATRIZ DE TALLAS COMPACTA (Pie de página 1)
        # ══════════════════════════════════════════════════════════════
        talla_ids = _safe_list(esp.get("sizes")) or _safe_list(data.get("tallas"))
        tallas = _fetch_tallas(talla_ids)
        talla_tbl = _compact_talla_table(tallas)
        if talla_tbl:
            story.append(_section_banner("Tabla de Tallas y Equivalencias", styles, bg_color=COLOR_NAVY))
            story.append(Spacer(1, 2))
            story.append(talla_tbl)

        doc.build(story, onFirstPage=draw_first_page_background)
        buffer.seek(0)
        return buffer.getvalue()
    except Exception as e:
        log.error("render_ficha_tecnica_pdf(%s) falló: %s", producto_id, e)
        return None


def pdf_response(producto_id: str, filename: Optional[str] = None) -> HttpResponse:
    pdf_bytes = render_ficha_tecnica_pdf(producto_id)
    if not pdf_bytes:
        return HttpResponse(status=404)
    if not filename:
        filename = f"ficha-tecnica-{producto_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
