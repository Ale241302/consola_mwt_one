"""
Generador de ficha técnica PDF (A4) alineado al diseño de detalleproducto.

Diseño: hoja A4 de 210 mm × 297 mm con estilo institucional EPP SEGURA:
  • Header con marca, línea, código y CA.
  • Hero: imagen del producto + título + descripción + chips técnicos.
  • Dos tablas: CONSTRUCCIÓN DEL CALZADO y DATOS TÉCNICOS.
  • Strip de normas: 200J / 1500N / 1100N / SRC.
  • Segmentos/aplicaciones + embalaje.
  • Footer institucional.

Toma los datos reales del producto (especificaciones JSON, imagen desde MinIO)
y rellena con valores por defecto cuando algún campo no está disponible.
"""
import io
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from django.http import HttpResponse

from apps.storage.services import get_object_stream
from .models import Producto
from .serializers import ProductoSerializer

log = logging.getLogger(__name__)

# ── Paleta exacta del diseño detalleproducto ─────────────────────────
COLOR_NAVY_DARK = "#0B1E3A"      # Azul marino oscuro (textos principales)
COLOR_ACCENT = "#1DE394"        # Verde accent
COLOR_ACCENT_INK = "#06251B"    # Color oscuro sobre accent
COLOR_WHITE = "#FFFFFF"
COLOR_BG = "#F3F6FB"            # Fondo general
COLOR_PLACEHOLDER_BG = "#EAF0F8"
COLOR_PLACEHOLDER_BORDER = "#AEBBD0"
COLOR_PLACEHOLDER_TEXT = "#8595AC"
COLOR_DESC = "#334155"
COLOR_LABEL = "#64748B"
COLOR_CHIP_BORDER = "#DDD8CE"
COLOR_TABLE_BORDER = "#E7EDF6"
COLOR_TABLE_HEADER_BG = "#0B1E3A"
COLOR_TABLE_HEADER_TEXT = "#1DE394"
COLOR_LIGHT_BG = "#F8FAFC"


# ── Helpers de datos ─────────────────────────────────────────────────

def _safe(value: Any, default: str = "—") -> str:
    if value is None or value == "":
        return default
    return str(value)


def _safe_list(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if x is not None and str(x).strip()]


def _join(items: Any, sep: str = ", ") -> str:
    return sep.join(_safe_list(items)) or "—"


def _num(value: Any, decimals: int = 3) -> str:
    """Formatea número decimal con coma como separador decimal (sin separador de miles)."""
    if value is None or value == "":
        return "—"
    try:
        d = Decimal(str(value))
        if d == d.to_integral_value():
            return str(int(d))
        s = f"{float(d):.{decimals}f}"
        if "." in s:
            s = s.replace(".", ",")
        return s
    except Exception:
        return str(value)


# ── Helpers de imagen ────────────────────────────────────────────────

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


def _minio_image(key: Optional[str], max_w: int = 1400, max_h: int = 1400) -> Optional[Any]:
    """Descarga imagen de MinIO, compone transparencia sobre blanco y redimensiona."""
    data = _minio_bytes(key)
    if not data:
        return None
    try:
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(data))
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
            bg = PILImage.new("RGBA", img.size, (255, 255, 255, 255))
            bg.paste(img, (0, 0), img)
            img = bg.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((max_w, max_h), PILImage.Resampling.LANCZOS)
        return img
    except Exception as e:
        log.warning("_minio_image(%s) falló: %s", key, e)
        return None


def _rl_image(img: Any, max_w: float, max_h: float) -> Optional[Any]:
    """Convierte imagen PIL a ReportLab Image escalada."""
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


# ── Helpers de layout ───────────────────────────────────────────────

def _hex(c: str) -> Any:
    from reportlab.lib import colors
    return colors.HexColor(c)


def _style(name: str, **overrides) -> Any:
    from reportlab.lib.styles import ParagraphStyle
    base = {
        "fontName": "Helvetica",
        "fontSize": 9,
        "leading": 11,
        "textColor": _hex(COLOR_NAVY_DARK),
    }
    base.update(overrides)
    return ParagraphStyle(name, **base)


def _paragraph(text: str, style: Any) -> Any:
    from reportlab.platypus import Paragraph
    return Paragraph(str(text), style)


def _make_table(data, col_widths, style_commands, **kwargs) -> Any:
    from reportlab.platypus import Table, TableStyle
    t = Table(data, colWidths=col_widths, **kwargs)
    t.setStyle(TableStyle(style_commands))
    return t


# ── Extracción de datos del producto ─────────────────────────────────

def _extract_specs(data: Dict[str, Any]) -> Dict[str, Any]:
    """Mapea especificaciones JSON a los campos del PDF."""
    esp = data.get("especificaciones") or {}
    out = {}

    # Identidad
    out["brand"] = _safe(data.get("marca_nombre") or "EPP SEGURA")
    out["linea"] = _safe(esp.get("familia") or "COMPOSITE")
    out["code"] = _safe(data.get("sku") or data.get("nombre"))
    out["name"] = _safe(data.get("nombre") or data.get("sku"))
    out["ca"] = _safe(esp.get("ca") or "—")
    out["description"] = _safe(data.get("descripcion") or esp.get("descripcion_tecnica") or _build_default_description(data, esp))

    # Chips técnicos hero
    chips = []
    chips.append(("CA", out["ca"]))
    peso = data.get("peso_kg")
    if peso:
        chips.append(("PESO / PIE", f"{_num(peso, 3)} kg"))
    else:
        chips.append(("PESO / PIE", _safe(esp.get("peso_pie"))))
    chips.append(("ALTURA CAÑA", _safe(esp.get("altura_cania") or "—")))
    chips.append(("VALIDEZ", _safe(esp.get("validez") or "36 meses")))
    out["chips"] = chips

    # Construcción del calzado
    construction_items = []
    if esp.get("capellada"):
        construction_items.append(("Capellada", _safe(esp.get("capellada"))))
    if esp.get("forro"):
        construction_items.append(("Forro / sudador", _safe(esp.get("forro"))))
    elif esp.get("plantilla_interna"):
        construction_items.append(("Forro / sudador", _safe(esp.get("plantilla_interna"))))
    if esp.get("tipo_puntera"):
        construction_items.append(("Puntera", _safe(esp.get("tipo_puntera"))))
    if esp.get("antiperforante"):
        construction_items.append(("Plantilla montaje", _safe(esp.get("antiperforante"))))
    if esp.get("plantilla_higienica"):
        construction_items.append(("Plantilla higiénica", _safe(esp.get("plantilla_higienica"))))
    elif esp.get("plantilla_interna"):
        construction_items.append(("Plantilla higiénica", _safe(esp.get("plantilla_interna"))))
    if esp.get("suela"):
        construction_items.append(("Suela", _safe(esp.get("suela"))))
    if esp.get("cierre"):
        construction_items.append(("Cierre", _safe(esp.get("cierre"))))
    if not construction_items:
        construction_items.append(("Capellada", "—"))
    out["construction_items"] = construction_items

    # Datos técnicos
    technical_items = []
    sizes = _safe_list(esp.get("sizes"))
    if sizes:
        technical_items.append(("Numeración", f"{len(sizes)} tallas disponibles"))
    if esp.get("color"):
        technical_items.append(("Color", _safe(esp.get("color"))))
    if peso:
        technical_items.append(("Peso por pie", f"{_num(peso, 3)} kg"))
    elif esp.get("peso_pie"):
        technical_items.append(("Peso por pie", _safe(esp.get("peso_pie"))))
    if esp.get("altura_cania"):
        technical_items.append(("Altura de caña", _safe(esp.get("altura_cania"))))
    technical_items.append(("Validez", _safe(esp.get("validez") or "36 meses desde fabricación")))
    norms = _safe_list(esp.get("normativa"))
    technical_items.append(("Norma", _join(norms)))
    if not technical_items:
        technical_items.append(("Norma", "—"))
    out["technical_items"] = technical_items

    # Norma stats strip
    tipo_puntera = _safe(esp.get("tipo_puntera"), "").lower()
    suela = _safe(esp.get("suela"), "").lower()
    antiperforante = _safe(esp.get("antiperforante"), "").lower()
    stats = [
        ("200J", "Impacto", "Resistencia de puntera"),
        ("1500N", "Compresión", "Carga máxima de puntera"),
    ]
    if antiperforante:
        stats.append(("1100N", "Antiperforación", "Plantilla no metálica"))
    else:
        stats.append(("1100N", "Antiperforación", "—"))
    if "src" in suela or "bidensidad" in suela:
        stats.append(("SRC", "Antideslizante", "Cerámica + acero"))
    else:
        stats.append(("SRC", "Antideslizante", "—"))
    out["norma_stats"] = stats

    # Segmentos
    out["segments"] = _safe_list(esp.get("segmento")) or _safe_list(esp.get("segmentos")) or []

    # Embalaje
    out["packaging"] = _safe(
        esp.get("embalaje")
        or "Bolsa plástica individual en caja colectiva. Consulte disponibilidad de empaque para volúmenes."
    )

    return out


def _build_default_description(data: Dict[str, Any], esp: Dict[str, Any]) -> str:
    """Construye una descripción técnica corta a partir de los datos disponibles."""
    parts = []
    if data.get("categoria"):
        parts.append(f"{data['categoria']}")
    if esp.get("tipo_puntera"):
        parts.append(f"con puntera de {esp['tipo_puntera']}")
    if esp.get("capellada"):
        parts.append(f"confeccionada en {esp['capellada'].lower()}")
    if esp.get("cierre"):
        parts.append(f"cierre {esp['cierre'].lower()}")
    if esp.get("suela"):
        parts.append(f"y suela {esp['suela'].lower()}")
    if parts:
        return ", ".join(parts) + "."
    return "Calzado de seguridad ocupacional de alto desempeño."


# ── Renderizado del PDF ──────────────────────────────────────────────

def _build_placeholder_image() -> Any:
    """Placeholder cuando no hay imagen: cuadro gris con icono y texto."""
    from reportlab.platypus import Paragraph, Table, TableStyle, Spacer
    from reportlab.lib.units import mm

    icon_style = _style("placeholder_icon", fontSize=14, leading=16, textColor=_hex(COLOR_PLACEHOLDER_TEXT), alignment=1)
    text_style = _style("placeholder_text", fontName="Helvetica", fontSize=6, leading=7, textColor=_hex(COLOR_PLACEHOLDER_TEXT), alignment=1)
    data = [
        [Spacer(1, 8 * mm)],
        [Paragraph("◈", icon_style)],
        [Paragraph("IMAGEN PRODUCTO<br/>1400 × 1400 px", text_style)],
    ]
    t = Table(data, colWidths=[50 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _hex(COLOR_PLACEHOLDER_BG)),
        ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_PLACEHOLDER_BORDER)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    return t


def _build_image_cell(image_key: Optional[str]) -> Any:
    from reportlab.lib.units import mm
    img = _minio_image(image_key, max_w=1400, max_h=1400)
    rl = _rl_image(img, max_w=50 * mm, max_h=50 * mm)
    if rl:
        from reportlab.platypus import Table, TableStyle
        t = Table([[rl]], colWidths=[50 * mm], rowHeights=[50 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), _hex(COLOR_WHITE)),
            ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_PLACEHOLDER_BORDER)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        return t
    return _build_placeholder_image()


def _build_header(styles: Dict[str, Any], specs: Dict[str, Any]) -> Any:
    """Header institucional: marca a la izquierda, línea/código/CA a la derecha."""
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.units import mm

    left = [
        [Paragraph(f"<b>{specs['brand'].upper()}</b>", styles["brand_title"])],
        [Paragraph("EQUIPO DE PROTECCIÓN PERSONAL", styles["brand_sub"])],
    ]
    left_tbl = Table(left, colWidths=[75 * mm])
    left_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))

    ca_tbl = Table([[Paragraph(f"CA <b>{specs['ca']}</b>", styles["header_ca"])]], colWidths=[28 * mm])
    ca_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _hex(COLOR_NAVY_DARK)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 1 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
        ("LEFTPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]))

    right = [
        [Paragraph(f"FICHA TÉCNICA · LÍNEA <b>{specs['linea'].upper()}</b>", styles["header_meta"])],
        [Paragraph(f"<b>{specs['code']}</b>", styles["header_code"])],
        [ca_tbl],
    ]
    right_tbl = Table(right, colWidths=[85 * mm])
    right_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 1), (0, 1), 1 * mm),
        ("BOTTOMPADDING", (0, 2), (0, 2), 0),
    ]))

    header = Table([[left_tbl, right_tbl]], colWidths=[95 * mm, 95 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 2.5, _hex(COLOR_NAVY_DARK)),
    ]))
    return header


def _build_chips(chips: List[Tuple[str, str]], styles: Dict[str, Any]) -> Any:
    """4 chips técnicos en grid: CA, PESO/PIE, ALTURA CAÑA, VALIDEZ."""
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.units import mm

    cells = []
    for label, value in chips:
        cell = [
            Paragraph(label, styles["chip_label"]),
            Paragraph(f"<b>{value}</b>", styles["chip_value"]),
        ]
        cells.append(cell)
    # Asegurar 4 celdas, completando con vacíos si faltan
    while len(cells) < 4:
        cells.append([Paragraph("", styles["chip_label"]), Paragraph("—", styles["chip_value"])])

    row = [[c[0], c[1]] for c in cells]
    chip_tbl = Table(row, colWidths=[(38 * mm) for _ in range(4)])
    chip_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _hex(COLOR_WHITE)),
        ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_CHIP_BORDER)),
        ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return chip_tbl


def _build_specs_table(title: str, items: List[Tuple[str, str]], styles: Dict[str, Any]) -> Any:
    """Tabla de dos columnas: label | value con header oscuro."""
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.units import mm

    data = [[Paragraph(title, styles["table_header"])]]
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), _hex(COLOR_TABLE_HEADER_BG)),
        ("TEXTCOLOR", (0, 0), (-1, 0), _hex(COLOR_TABLE_HEADER_TEXT)),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("LEADING", (0, 0), (-1, 0), 9),
        ("LEFTPADDING", (0, 0), (-1, 0), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, 0), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 1.5 * mm),
    ]
    for i, (label, value) in enumerate(items, start=1):
        data.append([Paragraph(label, styles["table_label"]), Paragraph(value, styles["table_value"])])
        style_cmds.extend([
            ("LINEBELOW", (0, i), (-1, i), 0.5, _hex(COLOR_TABLE_BORDER)),
            ("LEFTPADDING", (0, i), (-1, i), 2.5 * mm),
            ("RIGHTPADDING", (0, i), (-1, i), 2.5 * mm),
            ("TOPPADDING", (0, i), (-1, i), 1.2 * mm),
            ("BOTTOMPADDING", (0, i), (-1, i), 1.2 * mm),
            ("VALIGN", (0, i), (-1, i), "TOP"),
        ])

    tbl = Table(data, colWidths=[32 * mm, 55 * mm])
    tbl.setStyle(TableStyle(style_cmds + [
        ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_CHIP_BORDER)),
        ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
    ]))
    return tbl


def _build_norma_stats(stats: List[Tuple[str, str, str]], styles: Dict[str, Any]) -> Any:
    """Strip de 4 celdas de norma en una fila: valor grande, label, note."""
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.units import mm

    # Cada celda es una mini-columna interna con 3 párrafos.
    cells = []
    for value, label, note in stats:
        inner = Table([
            [Paragraph(f"<b>{value}</b>", styles["stat_value"])],
            [Paragraph(f"<b>{label}</b>", styles["stat_label"])],
            [Paragraph(note, styles["stat_note"])],
        ], colWidths=[40 * mm])
        inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        cells.append([inner])
    while len(cells) < 4:
        cells.append([Paragraph("", styles["stat_value"])])

    tbl = Table([cells], colWidths=[(45.5 * mm) for _ in range(4)])
    tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_NAVY_DARK)),
        ("LINERIGHT", (0, 0), (-2, -1), 0.5, _hex(COLOR_CHIP_BORDER)),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return tbl


def _build_segments_packaging(segments: List[str], packaging: str, styles: Dict[str, Any]) -> Any:
    """Dos columnas: segmentos como pills + embalaje."""
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.units import mm

    seg_label = Paragraph("SEGMENTOS / APLICACIONES", styles["section_label"])
    if segments:
        # Pills como pequeñas celdas con borde redondeado (simulado con box).
        pills = []
        for s in segments[:8]:
            pill = Table([[Paragraph(s, styles["pills"])]], colWidths=[None])
            pill.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.75, _hex(COLOR_NAVY_DARK)),
                ("ROUNDEDCORNERS", (0, 0), (-1, -1), 3 * mm),
                ("LEFTPADDING", (0, 0), (-1, -1), 2 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            pills.append(pill)
        # Distribuir pills en filas de 2
        pill_rows = [pills[i : i + 2] for i in range(0, len(pills), 2)]
        pill_table = Table(pill_rows, colWidths=[42 * mm, 42 * mm])
        pill_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 1.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ]))
    else:
        pill_table = Paragraph("—", styles["pills"])

    left = [
        [seg_label],
        [pill_table],
    ]
    left_tbl = Table(left, colWidths=[90 * mm])
    left_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 2 * mm),
    ]))

    pack_label = Paragraph("EMBALAJE", styles["section_label"])
    pack_content = Paragraph(packaging, styles["packaging_text"])
    right = [[pack_label], [pack_content]]
    right_tbl = Table(right, colWidths=[90 * mm])
    right_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 2 * mm),
    ]))

    tbl = Table([[left_tbl, right_tbl]], colWidths=[95 * mm, 95 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _draw_footer(canvas, doc):
    """Dibuja el footer institucional en la primera/única página."""
    canvas.saveState()
    from reportlab.lib.units import mm
    width = 210 * mm
    y = 12 * mm
    canvas.setStrokeColor(_hex(COLOR_NAVY_DARK))
    canvas.setLineWidth(1.5)
    canvas.line(14 * mm, y, 196 * mm, y)

    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(_hex(COLOR_LABEL))
    canvas.drawString(14 * mm, y - 5 * mm, "VALIDEZ 36 MESES DESDE FECHA DE FABRICACIÓN · ALTURA DE CAÑA BASADA EN TALLA 40 (±3,33 mm/talla)")
    canvas.setFont("Helvetica-Bold", 6.5)
    canvas.setFillColor(_hex(COLOR_NAVY_DARK))
    canvas.drawRightString(196 * mm, y - 5 * mm, "EPP SEGURA")
    canvas.restoreState()


# ── Función pública ──────────────────────────────────────────────────

def render_ficha_tecnica_pdf(producto_id: str) -> Optional[bytes]:
    try:
        producto = Producto.objects.get(pk=producto_id, is_active=True)
    except Producto.DoesNotExist:
        return None

    data = ProductoSerializer(producto).data
    specs = _extract_specs(data)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        )
        from reportlab.lib.enums import TA_RIGHT, TA_CENTER

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            rightMargin=14 * mm, leftMargin=14 * mm,
            topMargin=14 * mm, bottomMargin=12 * mm,
            title=f"Ficha Técnica · {specs['code']}",
        )

        styles = {
            "brand_title": _style("brand_title", fontName="Helvetica-Bold", fontSize=12, leading=14, textColor=_hex(COLOR_NAVY_DARK)),
            "brand_sub": _style("brand_sub", fontName="Helvetica", fontSize=6.5, leading=8, textColor=_hex(COLOR_LABEL)),
            "header_meta": _style("header_meta", fontName="Helvetica", fontSize=7, leading=9, textColor=_hex(COLOR_LABEL), alignment=TA_RIGHT),
            "header_code": _style("header_code", fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=_hex(COLOR_NAVY_DARK), alignment=TA_RIGHT),
            "header_ca": _style("header_ca", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=_hex(COLOR_WHITE), backColor=_hex(COLOR_NAVY_DARK), alignment=TA_CENTER),
            "title": _style("title", fontName="Helvetica-Bold", fontSize=17, leading=19, textColor=_hex(COLOR_NAVY_DARK)),
            "description": _style("description", fontName="Helvetica", fontSize=9, leading=13, textColor=_hex(COLOR_DESC)),
            "chip_label": _style("chip_label", fontName="Helvetica", fontSize=6, leading=8, textColor=_hex(COLOR_LABEL)),
            "chip_value": _style("chip_value", fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=_hex(COLOR_NAVY_DARK)),
            "table_header": _style("table_header", fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=_hex(COLOR_TABLE_HEADER_TEXT)),
            "table_label": _style("table_label", fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=_hex(COLOR_LABEL)),
            "table_value": _style("table_value", fontName="Helvetica", fontSize=8, leading=11, textColor=_hex(COLOR_NAVY_DARK)),
            "stat_value": _style("stat_value", fontName="Helvetica-Bold", fontSize=15, leading=17, textColor=_hex(COLOR_NAVY_DARK)),
            "stat_label": _style("stat_label", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=_hex(COLOR_NAVY_DARK)),
            "stat_note": _style("stat_note", fontName="Helvetica", fontSize=6.5, leading=9, textColor=_hex(COLOR_LABEL)),
            "section_label": _style("section_label", fontName="Helvetica", fontSize=7, leading=9, textColor=_hex(COLOR_LABEL)),
            "pills": _style("pills", fontName="Helvetica-Bold", fontSize=8, leading=12, textColor=_hex(COLOR_NAVY_DARK)),
            "packaging_text": _style("packaging_text", fontName="Helvetica", fontSize=8, leading=12, textColor=_hex(COLOR_DESC)),
        }

        story = []

        # Header
        story.append(_build_header(styles, specs))
        story.append(Spacer(1, 3 * mm))

        # Hero: imagen | título + desc + chips
        image_cell = _build_image_cell(data.get("imagen_url"))
        right_hero = [
            [Paragraph(specs["name"], styles["title"])],
            [Paragraph(specs["description"], styles["description"])],
            [Spacer(1, 2 * mm)],
            [_build_chips(specs["chips"], styles)],
        ]
        right_hero_tbl = Table(right_hero, colWidths=[108 * mm])
        right_hero_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))

        hero = Table([[image_cell, right_hero_tbl]], colWidths=[52 * mm, 108 * mm])
        hero.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]))
        story.append(hero)

        # Dos tablas de especificaciones
        left_table = _build_specs_table("CONSTRUCCIÓN DEL CALZADO", specs["construction_items"], styles)
        right_table = _build_specs_table("DATOS TÉCNICOS", specs["technical_items"], styles)
        specs_row = Table([[left_table, right_table]], colWidths=[87 * mm, 87 * mm])
        specs_row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]))
        story.append(specs_row)

        # Strip de normas
        story.append(_build_norma_stats(specs["norma_stats"], styles))
        story.append(Spacer(1, 3 * mm))

        # Segmentos + embalaje
        story.append(_build_segments_packaging(specs["segments"], specs["packaging"], styles))

        doc.build(story, onFirstPage=_draw_footer)
        buffer.seek(0)
        return buffer.getvalue()
    except Exception as e:
        log.error("render_ficha_tecnica_pdf(%s) falló: %s", producto_id, e)
        return None


def pdf_response(producto_id: str, filename: Optional[str] = None, inline: bool = False) -> HttpResponse:
    pdf_bytes = render_ficha_tecnica_pdf(producto_id)
    if not pdf_bytes:
        return HttpResponse(status=404)
    if not filename:
        filename = f"ficha-tecnica-{producto_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    disp = "inline" if inline else "attachment"
    response["Content-Disposition"] = f'{disp}; filename="{filename}"'
    return response
