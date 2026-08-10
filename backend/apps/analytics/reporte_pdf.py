"""MWT.ONE · apps.analytics.reporte_pdf — PDF de reportes (Ola 3.10 ampliada).

Usa ReportLab (ya en requirements) para generar un PDF simple con branding
MWT a partir de las mismas secciones del reporte Markdown:
  `secciones`: [{titulo, tipo: "texto"|"tabla", data?}]

Seguridad: todo texto pasa por ReportLab (escapado automático); no se
interpola HTML ni URLs.
"""
from __future__ import annotations

import io
from typing import Any

_MWT_BRAND = "#013A57"
_MWT_ACCENT = "#0B7285"


def _fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:,.2f}" if v != int(v) else f"{int(v):,}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def reporte_pdf_bytes(titulo: str, secciones: list) -> bytes:
    """Genera un PDF en memoria a partir de secciones. Devuelve bytes."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "MWTTitle", parent=styles["Title"], textColor=colors.HexColor(_MWT_BRAND),
        fontSize=18, spaceAfter=10)
    h2_style = ParagraphStyle(
        "MWTH2", parent=styles["Heading2"], textColor=colors.HexColor(_MWT_ACCENT),
        fontSize=13, spaceBefore=10, spaceAfter=4)
    body_style = ParagraphStyle(
        "MWTBody", parent=styles["BodyText"], fontSize=10, leading=14)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter,
                            leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.75 * inch, bottomMargin=0.75 * inch,
                            title=titulo)
    story = [Paragraph(titulo, title_style), Spacer(1, 6)]

    for sec in secciones or []:
        st = (sec.get("tipo") or "texto").lower()
        story.append(Paragraph(str(sec.get("titulo") or ""), h2_style))
        if st == "tabla":
            d = sec.get("data") or {}
            columnas = d.get("columnas") or []
            filas = d.get("filas") or []
            keys = [c.get("key") for c in columnas]
            headers = [str(c.get("label") or c.get("key") or "") for c in columnas]
            table_data = [headers]
            for row in filas[:200]:
                table_data.append([_fmt(row.get(k)) for k in keys])
            if len(table_data) > 1:
                tbl = Table(table_data, repeatRows=1)
                tbl.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(_MWT_BRAND)),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DEE2E6")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                     [colors.white, colors.HexColor("#F1F3F5")]),
                ]))
                story.append(tbl)
        else:
            story.append(Paragraph(str(sec.get("data") or ""), body_style))
        story.append(Spacer(1, 8))

    doc.build(story)
    return buf.getvalue()
