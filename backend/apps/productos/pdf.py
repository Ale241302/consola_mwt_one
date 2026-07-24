"""
Generador de PDF de ficha técnica de producto con ReportLab.
Diseño profesional estilo ficha técnica comercial.
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

# ── Colores MWT ──────────────────────────────────────────────────────
NAVY = "#013A57"
NAVY_LIGHT = "#0a4d6e"
TEAL = "#00B286"
TEAL_LIGHT = "#75CBB3"
TEXT = "#0B1E3A"
TEXT_SECONDARY = "#64748B"
TEXT_MUTED = "#94A3B8"
BORDER = "#E5E7EB"
BG_LIGHT = "#F8FAFB"
BG_SOFT = "#F1F5F9"
WHITE = "#FFFFFF"


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


def _minio_image(key: Optional[str], max_w: int = 1200, max_h: int = 900) -> Optional[Any]:
    data = _minio_bytes(key)
    if not data:
        return None
    try:
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(data))
        img.thumbnail((max_w, max_h))
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
                "ancho_mm": t.ancho_mm,
                "comprimento_mm": t.comprimento_mm,
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
    """Devuelve un RLImage listo para insertar, con dimensiones escaladas."""
    if img is None:
        return None
    try:
        from reportlab.platypus import Image as RLImage
        buf = io.BytesIO()
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(buf, format="PNG")
        buf.seek(0)
        img_w, img_h = img.size
        scale = min(max_w / img_w, max_h / img_h, 1.0)
        return RLImage(buf, width=img_w * scale, height=img_h * scale)
    except Exception as e:
        log.warning("_rl_image falló: %s", e)
        return None


def _kv_row(label: str, value: Any, label_style, value_style) -> Any:
    from reportlab.platypus import Paragraph
    from reportlab.platypus import Table, TableStyle
    if value is None or value == "":
        value = "—"
    return [
        Paragraph(label, label_style),
        Paragraph(_safe(value), value_style),
    ]


def _section_header(text: str, styles: Dict[str, Any]) -> Any:
    from reportlab.platypus import Paragraph
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    style = styles["section_header"]
    bar = Table(
        [[""]],
        colWidths=[4],
        rowHeights=[16],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(TEAL)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]),
    )
    title = Paragraph(text, style)
    tbl = Table(
        [[bar, title]],
        colWidths=[8, 170],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]),
    )
    return tbl


def _chip_row(label: str, items: List[str], styles: Dict[str, Any]) -> Any:
    from reportlab.platypus import Paragraph
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    if not items:
        return None

    label_p = Paragraph(f"<b>{label}</b>", styles["chip_label"])
    chips_text = "  •  ".join(items)
    chips_p = Paragraph(chips_text, styles["chip_text"])

    tbl = Table(
        [[label_p, chips_p]],
        colWidths=[50 * 2.835, 130 * 2.835],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]),
    )
    return tbl


def _talla_table(tallas: List[Dict[str, Any]]) -> Any:
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    if not tallas:
        return Table([["Sin tallas configuradas"]], style=TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor(TEXT_MUTED)),
        ]))

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

    header = [label for label, _ in visible]
    rows = [[_safe(t.get(key) or "—") for _, key in visible] for t in tallas]
    data = [header] + rows

    tbl = Table(data, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(NAVY)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor(TEXT)),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor(BORDER)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    for i in range(1, len(data)):
        if i % 2 == 0:
            tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (-1, i), colors.HexColor(BG_LIGHT))]))
    return tbl


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
            PageBreak, KeepTogether,
        )

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            rightMargin=14 * mm, leftMargin=14 * mm,
            topMargin=14 * mm, bottomMargin=16 * mm,
            title=f"Ficha técnica · {data.get('sku') or producto_id}",
        )

        # ── Estilos ───────────────────────────────────────────────────
        styles = {
            "body": ParagraphStyle(
                "body", fontName="Helvetica", fontSize=10,
                textColor=colors.HexColor(TEXT), leading=14,
            ),
            "body_small": ParagraphStyle(
                "body_small", fontName="Helvetica", fontSize=9,
                textColor=colors.HexColor(TEXT_SECONDARY), leading=12,
            ),
            "h1": ParagraphStyle(
                "h1", fontName="Helvetica-Bold", fontSize=24,
                textColor=colors.white, leading=28,
            ),
            "h2": ParagraphStyle(
                "h2", fontName="Helvetica-Bold", fontSize=11,
                textColor=colors.HexColor(TEAL_LIGHT), leading=14,
                spaceAfter=4,
            ),
            "sku": ParagraphStyle(
                "sku", fontName="Courier", fontSize=12,
                textColor=colors.HexColor("#cfe3ec"), leading=14,
            ),
            "section_header": ParagraphStyle(
                "section_header", fontName="Helvetica-Bold", fontSize=11,
                textColor=colors.HexColor(NAVY), leading=14,
                spaceAfter=6,
            ),
            "kv_label": ParagraphStyle(
                "kv_label", fontName="Helvetica-Bold", fontSize=9,
                textColor=colors.HexColor(TEXT_SECONDARY), leading=12,
            ),
            "kv_value": ParagraphStyle(
                "kv_value", fontName="Helvetica-Bold", fontSize=9,
                textColor=colors.HexColor(TEXT), leading=12,
            ),
            "chip_label": ParagraphStyle(
                "chip_label", fontName="Helvetica-Bold", fontSize=9,
                textColor=colors.HexColor(NAVY), leading=12,
            ),
            "chip_text": ParagraphStyle(
                "chip_text", fontName="Helvetica", fontSize=9,
                textColor=colors.HexColor(TEXT), leading=12,
            ),
            "footer": ParagraphStyle(
                "footer", fontName="Helvetica", fontSize=8,
                textColor=colors.HexColor(TEXT_MUTED), alignment=1,
            ),
        }

        story = []

        # ══════════════════════════════════════════════════════════════
        # PORTADA
        # ══════════════════════════════════════════════════════════════

        # ── Header navy ───────────────────────────────────────────────
        header_cells = []
        header_cells.append(Paragraph(
            f'<font color="{TEAL_LIGHT}">{_safe(data.get("marca_nombre") or "Marca")}</font>',
            styles["h2"],
        ))
        header_cells.append(Spacer(1, 4))
        header_cells.append(Paragraph(
            _safe(data.get("nombre") or "Producto"), styles["h1"],
        ))
        header_cells.append(Spacer(1, 4))
        header_cells.append(Paragraph(
            f"SKU: {_safe(data.get('sku') or '—')}", styles["sku"],
        ))

        header_tbl = Table(
            [[header_cells]],
            colWidths=[180 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(NAVY)),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor(NAVY)),
                ("TOPPADDING", (0, 0), (-1, -1), 18),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
                ("LEFTPADDING", (0, 0), (-1, -1), 20),
                ("RIGHTPADDING", (0, 0), (-1, -1), 20),
            ]),
        )
        story.append(header_tbl)
        story.append(Spacer(1, 16))

        # ── Hero: imagen + info base ──────────────────────────────────
        hero_key = data.get("imagen_url") or (
            esp.get("gallery") and esp.get("gallery")[0] or None
        )
        hero_img = _minio_image(hero_key, max_w=1200, max_h=900) if hero_key else None
        hero_rl = _rl_image(hero_img, max_w=85 * mm, max_h=95 * mm) if hero_img else None

        info_base = [
            ("Categoría", data.get("categoria")),
            ("Subcategoría", data.get("subcategoria")),
            ("Color", esp.get("color")),
            ("País de origen", data.get("pais_origen_iso2")),
            ("NCM / HS Code", esp.get("ncm") or data.get("hs_code")),
            ("Unidad", data.get("unidad")),
            ("Moneda", data.get("moneda")),
        ]

        # Tabla de info base con estilo
        info_data = []
        for label, value in info_base:
            if value is None or value == "":
                value = "—"
            info_data.append([
                Paragraph(label, styles["kv_label"]),
                Paragraph(_safe(value), styles["kv_value"]),
            ])

        info_tbl = Table(info_data, colWidths=[45 * mm, 55 * mm])
        info_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor(BORDER)),
        ]))

        left_cell = []
        if hero_rl:
            left_cell.append(hero_rl)
        else:
            left_cell.append(Paragraph("Sin imagen", styles["body_small"]))

        right_cell = []
        right_cell.append(_section_header("Información base", styles))
        right_cell.append(info_tbl)

        hero_tbl = Table(
            [[left_cell, right_cell]],
            colWidths=[90 * mm, 100 * mm],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]),
        )
        story.append(hero_tbl)
        story.append(Spacer(1, 18))

        # ── Descripción ───────────────────────────────────────────────
        descripcion = data.get("descripcion") or "Sin descripción disponible."
        story.append(_section_header("Descripción", styles))
        story.append(Paragraph(descripcion, styles["body"]))
        story.append(Spacer(1, 18))

        # ── Atributos técnicos ────────────────────────────────────────
        story.append(_section_header("Atributos técnicos", styles))
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

        attr_data = []
        for label, value in atributos:
            if value is None or value == "":
                value = "—"
            attr_data.append([
                Paragraph(label, styles["kv_label"]),
                Paragraph(_safe(value), styles["kv_value"]),
            ])

        attr_tbl = Table(attr_data, colWidths=[55 * mm, 125 * mm])
        attr_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor(BORDER)),
        ]))
        story.append(attr_tbl)
        story.append(Spacer(1, 18))

        # ── Normativa / Riesgos / Segmentos ───────────────────────────
        chip_groups = [
            ("Normativa", _safe_list(esp.get("normativa"))),
            ("Disipativo de energía", _safe_list(esp.get("disipativo_energia"))),
            ("Riesgo", _safe_list(esp.get("riesgo"))),
            ("Segmento", _safe_list(esp.get("segmento"))),
        ]

        chips_story = []
        for label, items in chip_groups:
            if items:
                chips_story.append(_chip_row(label, items, styles))
        if chips_story:
            story.append(_section_header("Normativa · Riesgos · Segmentos", styles))
            for row in chips_story:
                story.append(row)
            story.append(Spacer(1, 12))

        # ══════════════════════════════════════════════════════════════
        # TABLA DE TALLAS
        # ══════════════════════════════════════════════════════════════
        talla_ids = _safe_list(esp.get("sizes")) or _safe_list(data.get("tallas"))
        tallas = _fetch_tallas(talla_ids)
        if tallas:
            story.append(PageBreak())
            story.append(_section_header("Tabla de tallas y equivalencias", styles))
            story.append(_talla_table(tallas))
            story.append(Spacer(1, 12))

        # ══════════════════════════════════════════════════════════════
        # GALERÍA
        # ══════════════════════════════════════════════════════════════
        gallery_keys = _safe_list(esp.get("gallery"))
        if len(gallery_keys) > 1:
            gallery_imgs = []
            for k in gallery_keys[1:4]:
                img = _minio_image(k, max_w=900, max_h=700)
                rl = _rl_image(img, max_w=55 * mm, max_h=55 * mm) if img else None
                if rl:
                    gallery_imgs.append(rl)
            if gallery_imgs:
                story.append(PageBreak())
                story.append(_section_header("Galería", styles))
                gal_tbl = Table([gallery_imgs], colWidths=[60 * mm] * len(gallery_imgs))
                gal_tbl.setStyle(TableStyle([
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]))
                story.append(gal_tbl)
                story.append(Spacer(1, 12))

        # ── Footer ────────────────────────────────────────────────────
        story.append(Spacer(1, 24))
        story.append(Paragraph(
            f"Ficha técnica generada por MWT.ONE · {timezone.now().strftime('%d/%m/%Y %H:%M')}",
            styles["footer"],
        ))

        doc.build(story)
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
