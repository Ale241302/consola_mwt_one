"""
MWT.ONE · apps.analytics.chart_svg — renderizador de charts server-side (Ola 3.10).

Genera SVG (string) a partir de `{tipo, data, opciones}` sin librerías pesadas.
Cubre los 4 tipos más usados: `line`, `area`, `bar`, `pie` (más `column` como
alias vertical de bar).

Contrato de entrada (validado por el endpoint `/api/analytics/chart-render/`):
    {
      "tipo": "line"|"area"|"bar"|"column"|"pie",
      "data": [ {x, y} | {category, value} ... ]  → máx 5000 filas,
      "opciones": { x, y, category, value, titulo, width, height, palette }
    }

Reglas de seguridad (sin SSRF): este módulo recibe SOLO datos puros (números y
labels); NUNCA URLs ni HTML. Todos los textos se escapan para evitar inyección
XML en el SVG resultante.
"""
from __future__ import annotations

import html
import math
from typing import Any

# Paleta MWT (brand + escala). Fuente: tokens del frontend (--brand-primary etc).
_PALETTES = {
    "mwt": ["#013A57", "#0B7285", "#2F9E44", "#F08C00", "#E8590C",
            "#7048E8", "#C2255C", "#5C940D", "#1971C2", "#862E9C"],
    "categorical": ["#013A57", "#4C6EF5", "#40C057", "#FAB005", "#FA5252",
                    "#7950F2", "#12B886", "#F06595", "#3BC9DB", "#E8590C"],
}
_WIDTH = 720
_HEIGHT = 360
_PAD = {"l": 56, "r": 16, "t": 28, "b": 40}
_MAX_ROWS = 5000


def _esc(v: Any) -> str:
    """Escapa un valor para insertarlo en XML/SVG (previene inyección)."""
    return html.escape(str(v if v is not None else ""), quote=True)


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _rows(data: Any) -> list[dict]:
    if not isinstance(data, list):
        return []
    out = []
    for r in data:
        if isinstance(r, dict):
            out.append(r)
        elif isinstance(r, (list, tuple)) and len(r) >= 2:
            out.append({"x": r[0], "y": r[1]})
        if len(out) >= _MAX_ROWS:
            break
    return out


def _palette(opciones: dict) -> list[str]:
    name = str(opciones.get("palette") or "mwt").lower()
    return _PALETTES.get(name, _PALETTES["mwt"])


def _svg_wrap(inner: str, width: int, height: int, titulo: str) -> str:
    t = _esc(titulo) if titulo else ""
    title_el = f'<text x="{width/2}" y="18" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="600" fill="#013A57">{t}</text>' if t else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{t}">'
        f'<rect width="100%" height="100%" fill="#ffffff"/>'
        f'{title_el}'
        f'{inner}'
        f'</svg>'
    )


def _axes_lines(w: int, h: int, n_yticks: int, ymax: float, ymin: float) -> str:
    """Ejes + grid horizontal + ticks de Y. Devuelve el SVG de esos elementos."""
    l, r, t, b = _PAD["l"], _PAD["r"], _PAD["t"], _PAD["b"]
    plot_w, plot_h = w - l - r, h - t - b
    parts = []
    # grid horizontal + labels de Y
    for i in range(n_yticks + 1):
        frac = i / n_yticks
        y = t + plot_h * (1 - frac)
        val = ymin + (ymax - ymin) * frac
        parts.append(
            f'<line x1="{l}" y1="{y:.1f}" x2="{w - r}" y2="{y:.1f}" '
            f'stroke="#E9ECEF" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{l - 8}" y="{y + 4:.1f}" text-anchor="end" font-family="sans-serif" '
            f'font-size="11" fill="#868E96">{_fmt_num(val)}</text>'
        )
    # frame
    parts.append(
        f'<rect x="{l}" y="{t}" width="{plot_w}" height="{plot_h}" '
        f'fill="none" stroke="#DEE2E6" stroke-width="1"/>'
    )
    return "".join(parts)


def _fmt_num(v: float) -> str:
    av = abs(v)
    if av >= 1_000_000:
        return f"{v/1_000_000:.1f}M"
    if av >= 1_000:
        return f"{v/1_000:.0f}K"
    if av == int(av):
        return f"{int(av)}"
    return f"{v:.2f}"


def _line_chart(rows, opciones, width, height) -> str:
    x_key = opciones.get("x") or "x"
    y_keys = opciones.get("y") or "y"
    if isinstance(y_keys, str):
        y_keys = [y_keys]
    if not y_keys:
        y_keys = ["y"]
    palette = _palette(opciones)
    l, r, t, b = _PAD["l"], _PAD["r"], _PAD["t"], _PAD["b"]
    plot_w, plot_h = width - l - r, height - t - b

    xs = [_num(row.get(x_key)) for row in rows]
    series = [[_num(row.get(k)) for row in rows] for k in y_keys]
    all_vals = [v for s in series for v in s]
    ymin = min(all_vals or [0])
    ymax = max(all_vals or [1])
    if ymax == ymin:
        ymax = ymin + 1
    if ymin > 0:
        ymin = 0.0

    def sx(i):
        if len(rows) <= 1:
            return l + plot_w / 2
        return l + plot_w * (i / (len(rows) - 1))

    def sy(v):
        return t + plot_h * (1 - (v - ymin) / (ymax - ymin))

    parts = [_axes_lines(width, height, 4, ymax, ymin)]
    # area fill (solo para tipo area)
    if opciones.get("_tipo") == "area":
        for si, s in enumerate(series):
            pts = " ".join(f"{sx(i):.1f},{sy(v):.1f}" for i, v in enumerate(s))
            close = f"{sx(len(s)-1):.1f},{t+plot_h:.1f} {sx(0):.1f},{t+plot_h:.1f}"
            parts.append(
                f'<polygon points="{pts} {close}" fill="{palette[si % len(palette)]}" '
                f'fill-opacity="0.18"/>'
            )
    # líneas de las series
    for si, s in enumerate(series):
        color = palette[si % len(palette)]
        pts = " ".join(f"{sx(i):.1f},{sy(v):.1f}" for i, v in enumerate(s))
        parts.append(
            f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.5" '
            f'stroke-linejoin="round" stroke-linecap="round"/>'
        )
        # puntos
        for i, v in enumerate(s):
            parts.append(
                f'<circle cx="{sx(i):.1f}" cy="{sy(v):.1f}" r="3" fill="{color}"/>'
            )
    # labels de X (primeros/últimos + cada ~5)
    step = max(1, len(rows) // 8)
    for i in range(0, len(rows), step):
        lbl = _esc(rows[i].get(x_key))
        parts.append(
            f'<text x="{sx(i):.1f}" y="{t + plot_h + 20}" text-anchor="middle" '
            f'font-family="sans-serif" font-size="11" fill="#868E96">{lbl}</text>'
        )
    # leyenda
    if len(y_keys) > 1:
        lx = l
        for si, k in enumerate(y_keys):
            color = palette[si % len(palette)]
            parts.append(f'<rect x="{lx}" y="{t - 14}" width="10" height="10" fill="{color}"/>')
            parts.append(
                f'<text x="{lx + 14}" y="{t - 5}" font-family="sans-serif" font-size="11" '
                f'fill="#495057">{_esc(k)}</text>'
            )
            lx += 14 + len(str(k)) * 7 + 18
    return _svg_wrap("".join(parts), width, height, opciones.get("titulo"))


def _bar_chart(rows, opciones, width, height) -> str:
    cat_key = opciones.get("category") or opciones.get("x") or "category"
    val_key = opciones.get("value") or opciones.get("y") or "value"
    palette = _palette(opciones)
    l, r, t, b = _PAD["l"], _PAD["r"], _PAD["t"], _PAD["b"]
    plot_w, plot_h = width - l - r, height - t - b

    vals = [_num(row.get(val_key)) for row in rows]
    ymax = max(vals or [1])
    if ymax <= 0:
        ymax = 1.0
    n = len(rows)
    slot = plot_w / max(n, 1)
    bar_w = max(6.0, slot * 0.6)

    parts = [_axes_lines(width, height, 4, ymax, 0)]
    for i, row in enumerate(rows):
        v = _num(row.get(val_key))
        hh = plot_h * (v / ymax)
        x = l + slot * i + (slot - bar_w) / 2
        y = t + plot_h - hh
        color = palette[i % len(palette)]
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{hh:.1f}" fill="{color}" rx="2"/>')
        if hh > 20:
            parts.append(
                f'<text x="{x + bar_w/2:.1f}" y="{y - 6:.1f}" text-anchor="middle" '
                f'font-family="sans-serif" font-size="11" fill="#495057">{_fmt_num(v)}</text>'
            )
        lbl = _esc(row.get(cat_key))
        parts.append(
            f'<text x="{x + bar_w/2:.1f}" y="{t + plot_h + 20}" text-anchor="middle" '
            f'font-family="sans-serif" font-size="11" fill="#868E96">{lbl}</text>'
        )
    return _svg_wrap("".join(parts), width, height, opciones.get("titulo"))


def _pie_chart(rows, opciones, width, height) -> str:
    cat_key = opciones.get("category") or opciones.get("x") or "category"
    val_key = opciones.get("value") or opciones.get("y") or "value"
    palette = _palette(opciones)
    vals = [_num(row.get(val_key)) for row in rows]
    total = sum(vals)
    if total <= 0:
        return _svg_wrap(
            f'<text x="{width/2}" y="{height/2}" text-anchor="middle" font-family="sans-serif" '
            f'font-size="13" fill="#868E96">Sin datos</text>',
            width, height, opciones.get("titulo"),
        )
    cx, cy, rad = width * 0.36, height * 0.52, min(width, height) * 0.32
    parts = []
    ang = -90.0
    for i, row in enumerate(rows):
        frac = _num(row.get(val_key)) / total
        sweep = frac * 360.0
        a0, a1 = ang, ang + sweep
        x0, y0 = cx + rad * math.cos(math.radians(a0)), cy + rad * math.sin(math.radians(a0))
        x1, y1 = cx + rad * math.cos(math.radians(a1)), cy + rad * math.sin(math.radians(a1))
        large = 1 if sweep > 180 else 0
        color = palette[i % len(palette)]
        parts.append(
            f'<path d="M {cx:.1f} {cy:.1f} L {x0:.1f} {y0:.1f} A {rad:.1f} {rad:.1f} 0 {large} 1 {x1:.1f} {y1:.1f} Z" '
            f'fill="{color}" stroke="#ffffff" stroke-width="1.5"/>'
        )
        ang = a1
    # leyenda a la derecha
    lx, ly = width * 0.66, height * 0.18
    for i, row in enumerate(rows):
        color = palette[i % len(palette)]
        lbl = _esc(row.get(cat_key))
        v = _num(row.get(val_key))
        parts.append(f'<rect x="{lx}" y="{ly}" width="12" height="12" fill="{color}"/>')
        parts.append(
            f'<text x="{lx + 16}" y="{ly + 10}" font-family="sans-serif" font-size="12" '
            f'fill="#495057">{lbl}</text>'
        )
        parts.append(
            f'<text x="{lx + 16}" y="{ly + 24}" font-family="sans-serif" font-size="11" '
            f'fill="#868E96">{_fmt_num(v)} ({v/total*100:.1f}%)</text>'
        )
        ly += 34
    return _svg_wrap("".join(parts), width, height, opciones.get("titulo"))


def render_chart(tipo: str, data: Any, opciones: dict | None = None) -> str:
    """Genera el SVG para el chart pedido. Lanza ValueError si el tipo es inválido."""
    opciones = dict(opciones or {})
    width = int(opciones.get("width") or _WIDTH)
    height = int(opciones.get("height") or _HEIGHT)
    rows = _rows(data)
    t = (tipo or "").strip().lower()
    if t == "column":
        t = "bar"
    if t == "line":
        return _line_chart(rows, opciones, width, height)
    if t == "area":
        opciones["_tipo"] = "area"
        return _line_chart(rows, opciones, width, height)
    if t == "bar":
        return _bar_chart(rows, opciones, width, height)
    if t == "pie":
        return _pie_chart(rows, opciones, width, height)
    raise ValueError(f"tipo de chart no soportado: {tipo!r}. Válidos: line, area, bar, column, pie.")


CHART_TYPES = ("line", "area", "bar", "column", "pie")
