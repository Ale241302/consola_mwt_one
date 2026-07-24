"""
Generador de PDF de ficha técnica de producto con ReportLab.
Diseño profesional estilo ficha técnica comercial (referencia Marluvas New Prime).
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

# ── Paleta corporativa MWT ───────────────────────────────────────────
NAVY = "#013A57"
NAVY_DARK = "#0B1E3A"
NAVY_LIGHT = "#0a4d6e"
TEAL = "#00B286"
TEAL_LIGHT = "#75CBB3"
ORANGE = "#E85D04"
ORANGE_LIGHT = "#F4A261"
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


def _minio_image(key: Optional[str], max_w: int = 2000, max_h: int = 1600) -> Optional[Any]:
    """Descarga imagen de MinIO en alta resolución."""
    data = _minio_bytes(key)
    if not data:
        return None
    try:
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(data))
        # No comprimir demasiado — mantener calidad para PDF
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


def _kv(label: str, value: Any, styles: Dict[str, Any]) -> Any:
    from reportlab.platypus import Paragraph
    if value is None or value == "":
        value = "—"
    return [
        Paragraph(label, styles["kv_label"]),
        Paragraph(_safe(value), styles["kv_value"]),
    ]


def _section_header(text: str, styles: Dict[str, Any], bg_color=ORANGE) -> Any:
    from reportlab.platypus import Paragraph
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors

    style = styles["section_header"]
    title = Paragraph(text, style)
    tbl = Table(
        [[title]],
        colWidths=[180 * 2.835],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_color)),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
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
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(NAVY)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor(TEXT)),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor(BORDER)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
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
            PageBreak, Image as RLImage,
        )

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            rightMargin=12 * mm, leftMargin=12 * mm,
            topMargin=12 * mm, bottomMargin=14 * mm,
            title=f"Ficha técnica · {data.get('sku') or producto_id}",
        )

        # ── Estilos ───────────────────────────────────────────────────
        styles = {
            "brand": ParagraphStyle(
                "brand", fontName="Helvetica-Bold", fontSize=26,
                textColor=colors.HexColor(NAVY), leading=30,
                spaceAfter=0,
            ),
            "linea": ParagraphStyle(
                "linea", fontName="Helvetica-Bold", fontSize=16,
                textColor=colors.HexColor(NAVY_LIGHT), leading=20,
                spaceAfter=0,
            ),
            "sku": ParagraphStyle(
                "sku", fontName="Helvetica-Bold", fontSize=20,
                textColor=colors.HexColor(ORANGE), leading=24,
                spaceAfter=0,
            ),
            "subtitle": ParagraphStyle(
                "subtitle", fontName="Helvetica", fontSize=10,
                textColor=colors.HexColor(TEXT_SECONDARY), leading=13,
            ),
            "section_header": ParagraphStyle(
                "section_header", fontName="Helvetica-Bold", fontSize=13,
                textColor=colors.white, leading=16,
            ),
            "body": ParagraphStyle(
                "body", fontName="Helvetica", fontSize=10,
                textColor=colors.HexColor(TEXT), leading=14,
            ),
            "body_bold": ParagraphStyle(
                "body_bold", fontName="Helvetica-Bold", fontSize=10,
                textColor=colors.HexColor(TEXT), leading=14,
            ),
            "kv_label": ParagraphStyle(
                "kv_label", fontName="Helvetica-Bold", fontSize=10,
                textColor=colors.HexColor(TEXT), leading=13,
            ),
            "kv_value": ParagraphStyle(
                "kv_value", fontName="Helvetica", fontSize=10,
                textColor=colors.HexColor(TEXT), leading=13,
            ),
            "footer": ParagraphStyle(
                "footer", fontName="Helvetica", fontSize=8,
                textColor=colors.HexColor(TEXT_MUTED), alignment=1,
            ),
        }

        story = []

        # ══════════════════════════════════════════════════════════════
        # PORTADA — Header + Hero
        # ══════════════════════════════════════════════════════════════

        marca = data.get("marca_nombre") or "Marca"
        sku = data.get("sku") or "—"
        nombre = data.get("nombre") or "Producto"
        descripcion = data.get("descripcion") or ""

        # Header con marca, línea y SKU
        header_cells = [
            Paragraph(marca, styles["brand"]),
            Paragraph(_safe(esp.get("familia") or esp.get("linea") or ""), styles["linea"]),
            Paragraph(sku, styles["sku"]),
        ]
        header_tbl = Table(
            [[header_cells]],
            colWidths=[180 * mm],
            style=TableStyle([
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]),
        )
        story.append(header_tbl)
        story.append(Spacer(1, 8))

        # Subtítulo descriptivo
        subtitle_parts = []
        if data.get("categoria"):
            subtitle_parts.append(data["categoria"])
        if esp.get("tipo_puntera"):
            subtitle_parts.append(f"con puntera de {esp['tipo_puntera'].lower()}")
        if esp.get("capellada"):
            subtitle_parts.append(f"capellada {esp['capellada'].lower()}")
        if esp.get("cierre"):
            subtitle_parts.append(f"cierre {esp['cierre'].lower()}")
        if subtitle_parts:
            story.append(Paragraph(
                ", ".join(subtitle_parts) + ".",
                styles["subtitle"],
            ))
        story.append(Spacer(1, 12))

        # Hero: imagen principal grande + imágenes secundarias
        hero_key = data.get("imagen_url") or (
            esp.get("gallery") and esp.get("gallery")[0] or None
        )
        hero_img = _minio_image(hero_key, max_w=2400, max_h=1800) if hero_key else None
        hero_rl = _rl_image(hero_img, max_w=120 * mm, max_h=90 * mm) if hero_img else None

        # Imágenes secundarias (vistas alternativas)
        gallery_keys = _safe_list(esp.get("gallery"))
        secondary_imgs = []
        for k in gallery_keys[1:4]:
            img = _minio_image(k, max_w=1200, max_h=900)
            rl = _rl_image(img, max_w=55 * mm, max_h=40 * mm) if img else None
            if rl:
                secondary_imgs.append(rl)

        if hero_rl:
            left_cell = [hero_rl]
        else:
            left_cell = [Paragraph("Sin imagen", styles["body"])]

        # Imágenes secundarias apiladas a la derecha
        right_cells = []
        if secondary_imgs:
            for img in secondary_imgs:
                right_cells.append([img])
        if not right_cells:
            right_cells = [[""]]

        hero_tbl = Table(
            [[left_cell, right_cells]],
            colWidths=[125 * mm, 60 * mm],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]),
        )
        story.append(hero_tbl)
        story.append(Spacer(1, 16))

        # ══════════════════════════════════════════════════════════════
        # ESPECIFICACIONES TÉCNICAS
        # ══════════════════════════════════════════════════════════════
        story.append(_section_header("Especificaciones Técnicas", styles))
        story.append(Spacer(1, 8))

        specs = [
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
            ("Categoría", data.get("categoria")),
            ("Color", esp.get("color")),
            ("País de origen", data.get("pais_origen_iso2")),
            ("NCM / HS Code", esp.get("ncm") or data.get("hs_code")),
            ("Unidad", data.get("unidad")),
            ("Moneda", data.get("moneda")),
        ]

        specs_data = []
        for label, value in specs:
            if value is None or value == "":
                value = "—"
            specs_data.append([
                Paragraph(label, styles["kv_label"]),
                Paragraph(_safe(value), styles["kv_value"]),
            ])

        specs_tbl = Table(specs_data, colWidths=[55 * mm, 125 * mm])
        specs_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor(BORDER)),
        ]))
        story.append(specs_tbl)
        story.append(Spacer(1, 14))

        # ══════════════════════════════════════════════════════════════
        # NORMATIVA / RIESGOS / SEGMENTOS
        # ══════════════════════════════════════════════════════════════
        normativa = _safe_list(esp.get("normativa"))
        riesgo = _safe_list(esp.get("riesgo"))
        segmento = _safe_list(esp.get("segmento"))
        disipativo = _safe_list(esp.get("disipativo_energia"))

        chips_data = []
        if normativa:
            chips_data.append([
                Paragraph("<b>Normativa</b>", styles["kv_label"]),
                Paragraph(", ".join(normativa), styles["kv_value"]),
            ])
        if disipativo:
            chips_data.append([
                Paragraph("<b>Disipativo</b>", styles["kv_label"]),
                Paragraph(", ".join(disipativo), styles["kv_value"]),
            ])
        if riesgo:
            chips_data.append([
                Paragraph("<b>Riesgo</b>", styles["kv_label"]),
                Paragraph(", ".join(riesgo), styles["kv_value"]),
            ])
        if segmento:
            chips_data.append([
                Paragraph("<b>Segmento</b>", styles["kv_label"]),
                Paragraph(", ".join(segmento), styles["kv_value"]),
            ])

        if chips_data:
            chips_tbl = Table(chips_data, colWidths=[40 * mm, 140 * mm])
            chips_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(chips_tbl)
            story.append(Spacer(1, 14))

        # ══════════════════════════════════════════════════════════════
        # DESCRIPCIÓN
        # ══════════════════════════════════════════════════════════════
        if descripcion:
            story.append(_section_header("Descripción", styles, bg_color=NAVY_LIGHT))
            story.append(Spacer(1, 8))
            story.append(Paragraph(descripcion, styles["body"]))
            story.append(Spacer(1, 14))

        # ══════════════════════════════════════════════════════════════
        # TABLA DE TALLAS
        # ══════════════════════════════════════════════════════════════
        talla_ids = _safe_list(esp.get("sizes")) or _safe_list(data.get("tallas"))
        tallas = _fetch_tallas(talla_ids)
        if tallas:
            story.append(PageBreak())
            story.append(_section_header("Tabla de tallas y equivalencias", styles, bg_color=NAVY))
            story.append(Spacer(1, 8))
            story.append(_talla_table(tallas))
            story.append(Spacer(1, 14))

        # ══════════════════════════════════════════════════════════════
        # GALERÍA (si hay más de 1 imagen)
        # ══════════════════════════════════════════════════════════════
        if len(gallery_keys) > 1 and len(secondary_imgs) < 3:
            gallery_imgs = []
            for k in gallery_keys[1:5]:
                img = _minio_image(k, max_w=1200, max_h=900)
                rl = _rl_image(img, max_w=55 * mm, max_h=55 * mm) if img else None
                if rl:
                    gallery_imgs.append(rl)
            if gallery_imgs:
                story.append(_section_header("Galería", styles, bg_color=TEAL))
                story.append(Spacer(1, 8))
                gal_tbl = Table([gallery_imgs], colWidths=[60 * mm] * len(gallery_imgs))
                gal_tbl.setStyle(TableStyle([
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]))
                story.append(gal_tbl)
                story.append(Spacer(1, 14))

        # ── Footer ────────────────────────────────────────────────────
        story.append(Spacer(1, 20))
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
