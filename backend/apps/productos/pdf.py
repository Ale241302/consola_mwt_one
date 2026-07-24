"""
Generador de PDF de ficha técnica de producto con ReportLab.
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


def _minio_image(key: Optional[str], max_w: int = 900, max_h: int = 700) -> Optional[Any]:
    """Devuelve un objeto PIL.Image listo para insertar en ReportLab."""
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


def _kv_table(rows: List[tuple], col_widths=None) -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    data = [[k, _safe(v)] for k, v in rows if v is not None and v != ""]
    if not data:
        return Table([["Sin datos"]], style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9)]))
    tbl = Table(data, colWidths=col_widths or [120, 300])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#013A57")),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#0B1E3A")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _chips(items: List[str], color_hex="#013A57") -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    if not items:
        return Table([["—"]], style=TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#94A3B8")),
        ]))
    # Chips en una fila
    cell = ", ".join(items)
    return Table([[cell]], colWidths=[500], style=TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor(color_hex)),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("ROUNDEDCORNERS", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))


def _talla_table(tallas: List[Dict[str, Any]]) -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    if not tallas:
        return Table([["Sin tallas configuradas"]], style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9)]))

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
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#013A57")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#0B1E3A")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    # Zebra striping
    for i in range(1, len(data)):
        if i % 2 == 0:
            tbl.setStyle(TableStyle([("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8FAFB"))]))
    return tbl


def _section_title(txt: str) -> Any:
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph
    from reportlab.lib.units import mm

    style = ParagraphStyle(
        "section",
        fontName="Helvetica-Bold",
        fontSize=10,
        textColor="#013A57",
        spaceAfter=6,
        leftIndent=0,
        borderPadding=0,
        borderWidth=0,
        borderColor="#00B286",
        # Simula la barra verde izquierda con un bullet
        bulletIndent=0,
    )
    return Paragraph(f'<font color="#00B286">■</font> {txt}', style)


def _image_for_reportlab(img: Any) -> Optional[Any]:
    """Convierte PIL.Image a reportlab.lib.utils.ImageReader."""
    if img is None:
        return None
    try:
        from reportlab.lib.utils import ImageReader
        return ImageReader(img)
    except Exception as e:
        log.warning("_image_for_reportlab falló: %s", e)
        return None


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
            Image as RLImage, PageBreak,
        )

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            rightMargin=14 * mm, leftMargin=14 * mm,
            topMargin=14 * mm, bottomMargin=18 * mm,
            title=f"Ficha técnica · {data.get('sku') or producto_id}",
        )

        styles = ParagraphStyle(
            "body",
            fontName="Helvetica",
            fontSize=10,
            textColor=colors.HexColor("#0B1E3A"),
            leading=14,
        )
        styles_h1 = ParagraphStyle(
            "h1",
            fontName="Helvetica-Bold",
            fontSize=22,
            textColor=colors.white,
            leading=26,
        )
        styles_h2 = ParagraphStyle(
            "h2",
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=colors.HexColor("#75CBB3"),
            leading=14,
            spaceAfter=6,
        )
        styles_sku = ParagraphStyle(
            "sku",
            fontName="Courier",
            fontSize=11,
            textColor=colors.HexColor("#cfe3ec"),
            leading=14,
        )

        story = []

        # ── Header navy ────────────────────────────────────────────────
        header_data = [[
            Paragraph(f'<font color="#75CBB3">{_safe(data.get("marca_nombre") or "Marca")}</font>', styles_h2),
        ], [
            Paragraph(_safe(data.get("nombre") or "Producto"), styles_h1),
        ], [
            Paragraph(f"SKU: {_safe(data.get('sku') or '—')}", styles_sku),
        ]]
        header_tbl = Table(header_data, colWidths=[180 * mm])
        header_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#013A57")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#013A57")),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ("LEFTPADDING", (0, 0), (-1, -1), 16),
            ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ]))
        story.append(header_tbl)
        story.append(Spacer(1, 12))

        # ── Hero: imagen + descripción/info base ───────────────────────
        hero_key = data.get("imagen_url") or (
            esp.get("gallery") and esp.get("gallery")[0] or None
        )
        hero_img = _minio_image(hero_key, max_w=900, max_h=700) if hero_key else None
        hero_rl = _image_for_reportlab(hero_img) if hero_img else None

        info_base = [
            ("Categoría", data.get("categoria")),
            ("Subcategoría", data.get("subcategoria")),
            ("Color", esp.get("color")),
            ("País de origen", data.get("pais_origen_iso2")),
            ("NCM / HS Code", esp.get("ncm") or data.get("hs_code")),
            ("Unidad", data.get("unidad")),
            ("Moneda", data.get("moneda")),
        ]

        right_cells = []
        right_cells.append(_section_title("Descripción"))
        right_cells.append(Paragraph(_safe(data.get("descripcion") or "Sin descripción disponible."), styles))
        right_cells.append(Spacer(1, 8))
        right_cells.append(_section_title("Información base"))
        right_cells.append(_kv_table(info_base, col_widths=[80, 90]))

        left_cell = []
        if hero_rl:
            img_w, img_h = hero_rl.getSize()
            max_w = 80 * mm
            max_h = 90 * mm
            scale = min(max_w / img_w, max_h / img_h, 1.0)
            left_cell.append(RLImage(hero_rl, width=img_w * scale, height=img_h * scale))
        else:
            left_cell.append(Paragraph("Sin imagen", styles))

        hero_tbl = Table(
            [[left_cell, right_cells]],
            colWidths=[85 * mm, 95 * mm],
        )
        hero_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (0, 0), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(hero_tbl)
        story.append(Spacer(1, 12))

        # ── Atributos técnicos ─────────────────────────────────────────
        story.append(_section_title("Atributos técnicos"))
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
        story.append(_kv_table(atributos, col_widths=[80, 100]))
        story.append(Spacer(1, 12))

        # ── Normativa / Riesgos / Segmentos ────────────────────────────
        story.append(_section_title("Normativa · Riesgos · Segmentos"))
        chip_groups = [
            ("Normativa", _safe_list(esp.get("normativa"))),
            ("Disipativo de energía", _safe_list(esp.get("disipativo_energia"))),
            ("Riesgo", _safe_list(esp.get("riesgo"))),
            ("Segmento", _safe_list(esp.get("segmento"))),
        ]
        chip_rows = []
        for label, items in chip_groups:
            if items:
                chip_rows.append([
                    Paragraph(f"<b>{label}</b>", styles),
                    _chips(items),
                ])
        if chip_rows:
            chip_tbl = Table(chip_rows, colWidths=[50 * mm, 130 * mm])
            chip_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(chip_tbl)
        else:
            story.append(Paragraph("Sin datos", styles))
        story.append(Spacer(1, 12))

        # ── Tabla de tallas ────────────────────────────────────────────
        talla_ids = _safe_list(esp.get("sizes")) or _safe_list(data.get("tallas"))
        tallas = _fetch_tallas(talla_ids)
        if tallas:
            story.append(PageBreak())
            story.append(_section_title("Tabla de tallas y equivalencias"))
            story.append(_talla_table(tallas))
            story.append(Spacer(1, 12))

        # ── Galería ────────────────────────────────────────────────────
        gallery_keys = _safe_list(esp.get("gallery"))
        if len(gallery_keys) > 1:
            gallery_imgs = []
            for k in gallery_keys[1:4]:
                img = _minio_image(k, max_w=600, max_h=450)
                rl = _image_for_reportlab(img) if img else None
                if rl:
                    img_w, img_h = rl.getSize()
                    max_w = 55 * mm
                    max_h = 55 * mm
                    scale = min(max_w / img_w, max_h / img_h, 1.0)
                    gallery_imgs.append(RLImage(rl, width=img_w * scale, height=img_h * scale))
            if gallery_imgs:
                story.append(PageBreak())
                story.append(_section_title("Galería"))
                gal_tbl = Table([gallery_imgs], colWidths=[60 * mm] * len(gallery_imgs))
                gal_tbl.setStyle(TableStyle([
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]))
                story.append(gal_tbl)

        # ── Footer ─────────────────────────────────────────────────────
        story.append(Spacer(1, 20))
        footer_style = ParagraphStyle(
            "footer",
            fontName="Helvetica",
            fontSize=8,
            textColor=colors.HexColor("#94A3B8"),
            alignment=1,  # TA_CENTER
        )
        story.append(Paragraph(
            f"Ficha técnica generada por MWT.ONE · {timezone.now().strftime('%d/%m/%Y %H:%M')}",
            footer_style,
        ))

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()
    except Exception as e:
        log.error("render_ficha_tecnica_pdf(%s) ReportLab falló: %s", producto_id, e)
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
