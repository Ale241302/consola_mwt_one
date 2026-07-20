"""
=====================================================================
MWT.ONE · apps.expedientes.proforma_renderer
Agente responsable: [AG-FULLSTACK]

Renderiza el HTML "vista cliente" (tab SONDEL del template de
referencia) de una proforma a partir de un expediente.

Reglas de negocio (Sprint 2026-05-07):
  · Solo se incluye el contenido del tab SONDEL — sin tabs CEO,
    Marluvas, DDP. Sin packing list (defer).
  · Operador: si expediente.operating_company_id == MWT_OPERATING_CLIENT_ID
    -> "Muito Work Limitada"; si no, razón social del cliente.
  · Forma de pago: 'CREDITO' -> "Crédito", 'CONTADO' -> "Contado".
  · Moneda: siempre "Dólares estadounidenses (USD)".
  · Pronto pago tiers hardcoded: 8d=-2.75%, 30d=-1.75%, 60d=-1.00%,
    90d=base, 120d=+1.00%. El plazo "actual" se calcula contra
    expediente.credit_days.
  · Líneas: solo activas. Precio crítico: unit_price_client (snapshot
    CLIENT) — si 0/None, fallback a unit_price.
  · Total pares: SUM(qty) sobre líneas activas.
  · Total proforma: SUM(qty * unit_price_client_resuelto).
  · Número de proforma: secuencial PF-{YYYY}-{NNNN} (consulta
    expedientes.documento WHERE kind='PROFORMA' AND codigo LIKE
    'PF-{año}-%').
=====================================================================
"""
from __future__ import annotations

import html as _html
import logging
from decimal import Decimal
from typing import Optional

from django.db import connection
from django.utils import timezone

from apps.core.constants import MWT_OPERATING_CLIENT_ID

from .models import Expediente, Linea, Oc

log = logging.getLogger(__name__)


# ── Pronto pago tiers (estandar wizard) ─────────────────────
# (días, delta_pct, label_corto). delta_pct positivo = recargo,
# negativo = descuento. 90d = base (delta 0).
PRONTO_PAGO_TIERS = (
    (8,   Decimal("-0.0275"), "−2.75%"),
    (30,  Decimal("-0.0175"), "−1.75%"),
    (60,  Decimal("-0.0100"), "−1.00%"),
    (90,  Decimal("0.0000"),  "base"),
    (120, Decimal("0.0100"),  "+1.00%"),
)

MONTHS_ES = ("ene", "feb", "mar", "abr", "may", "jun",
             "jul", "ago", "sep", "oct", "nov", "dic")


def _fmt_money(value) -> str:
    try:
        v = Decimal(value or 0)
    except (ValueError, ArithmeticError):
        v = Decimal(0)
    sign = "-" if v < 0 else ""
    v = abs(v)
    quantized = v.quantize(Decimal("0.01"))
    int_part, _, dec_part = f"{quantized:.2f}".partition(".")
    # Insertar separadores de miles
    rev = int_part[::-1]
    chunks = [rev[i:i + 3] for i in range(0, len(rev), 3)]
    int_grouped = ",".join(chunks)[::-1]
    return f"{sign}${int_grouped}.{dec_part}"


def _fmt_date_es(d) -> str:
    if not d:
        return "—"
    try:
        return f"{d.day:02d}/{MONTHS_ES[d.month - 1]}/{d.year}"
    except (AttributeError, IndexError, TypeError):
        return "—"


def _fmt_int(n) -> str:
    try:
        v = int(Decimal(n or 0))
    except (ValueError, ArithmeticError):
        v = 0
    return f"{v:,}".replace(",", ",")


def _esc(s) -> str:
    if s is None:
        return ""
    return _html.escape(str(s))


def _esc_email(s) -> str:
    """Escapa un email evitando que Cloudflare lo detecte y reemplace
    con su email-obfuscation script ([email protected]).

    Reemplaza '@' por &#64; y '.' por &#46; — el browser los renderiza
    como caracteres normales pero el regex de Cloudflare no los matchea.
    """
    if s is None:
        return ""
    safe = _html.escape(str(s))
    return safe.replace("@", "&#64;").replace(".", "&#46;")


def _fetch_cliente(client_id):
    """Lee razon_social, cedula_juridica, contacto_*, pais, ciudad."""
    if not client_id:
        return None
    with connection.cursor() as c:
        c.execute("""
            SELECT id, razon_social, cedula_juridica, contacto_nombre,
                   contacto_email, contacto_tel, pais_iso2, ciudad
            FROM clientes.cliente
            WHERE id = %s AND is_active = TRUE
        """, [str(client_id)])
        row = c.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "razon_social": row[1] or "",
        "cedula_juridica": row[2] or "",
        "contacto_nombre": row[3] or "",
        "contacto_email": row[4] or "",
        "contacto_tel": row[5] or "",
        "pais": row[6] or "",
        "ciudad": row[7] or "",
    }


def _fetch_producto_map(producto_ids):
    """Devuelve {producto_id: {'nombre':…, 'color':…}} sin recursión."""
    if not producto_ids:
        return {}
    placeholders = ",".join(["%s"] * len(producto_ids))
    with connection.cursor() as c:
        c.execute(f"""
            SELECT id, nombre, especificaciones
            FROM productos.producto
            WHERE id IN ({placeholders})
        """, [str(pid) for pid in producto_ids])
        rows = c.fetchall()
    result = {}
    for pid, nombre, especs in rows:
        color = ""
        if isinstance(especs, dict):
            color = especs.get("color") or ""
        result[str(pid)] = {
            "nombre": nombre or "",
            "color":  color or "",
        }
    return result


def _next_proforma_codigo(year: int) -> str:
    """Genera el siguiente PF-{año}-{NNNN} consultando documentos PROFORMA."""
    prefix = f"PF-{year}-"
    with connection.cursor() as c:
        c.execute("""
            SELECT COUNT(*) FROM expedientes.documento
            WHERE kind = 'PROFORMA' AND codigo LIKE %s
        """, [f"{prefix}%"])
        (cnt,) = c.fetchone()
    return f"{prefix}{(int(cnt or 0) + 1):04d}"


def _resolve_unit_price(linea) -> Decimal:
    """unit_price_client si > 0, sino fallback a unit_price."""
    upc = Decimal(linea.unit_price_client or 0)
    if upc > 0:
        return upc
    return Decimal(linea.unit_price or 0)


def _operator_name(expediente: Expediente, cliente: Optional[dict]) -> str:
    op_id = str(expediente.operating_company_id or "").lower()
    if op_id == str(MWT_OPERATING_CLIENT_ID).lower():
        return "Muito Work Limitada"
    if cliente:
        return cliente["razon_social"] or "—"
    return "—"


def _forma_pago_label(forma_pago) -> str:
    fp = (forma_pago or "").strip().upper()
    if fp == "CREDITO":
        return "Crédito"
    if fp == "CONTADO":
        return "Contado"
    return "—"


def _plazo_label(forma_pago, credit_days) -> str:
    """Plazo de pago = días de crédito del cliente.
    Sprint 2026-05-08: independiente de forma_pago. Aunque la operación
    sea Contado, el plazo de crédito asignado al cliente sigue mostrándose
    (es metadata del cliente, no del flujo de pago de este expediente).
    """
    days = int(credit_days or 0)
    if days <= 0:
        return "—"
    return f"{days} días"


def _build_pronto_pago_html(price_base: Decimal, total_pares: int,
                             credit_days: int) -> str:
    """Construye los 5 cards de pronto pago marcando el activo según
    credit_days del expediente.

    Sprint 2026-05-24 · BUG FIX:
      `price_base` recibido viene calculado a partir de `unit_price_client`
      de las lineas, que YA tiene el descuento del plazo activo aplicado
      (por el wizard Paso 3 / pricing matrix). Por lo tanto NO es la base
      real de 90 dias — es el precio AL PLAZO ACTUAL.

      Antes (bug): aplicar PRONTO_PAGO_TIERS sobre ese precio mostraba al
      tier de 90d como "base" con valor del precio actual (ej. 8d=$46.43
      y 90d=$46.43, ambos iguales) y los ahorros mal calculados.

      Fix: normalizar dividiendo por (1 + delta_del_plazo_actual) para
      recuperar la base 90d real, luego aplicar los tiers desde ahi.
    """
    # Detectar delta del plazo actual del expediente
    current_delta = Decimal("0")
    for days, delta_pct, _label in PRONTO_PAGO_TIERS:
        if days == int(credit_days or 0):
            current_delta = delta_pct
            break

    # Normalizar a base 90d (denominador != 0 siempre que delta != -1)
    denom = Decimal("1") + current_delta
    if current_delta != Decimal("0") and denom != Decimal("0"):
        price_base = (price_base / denom).quantize(Decimal("0.0001"))

    cards = []
    base_total = price_base * Decimal(total_pares or 0)
    for days, delta_pct, label in PRONTO_PAGO_TIERS:
        price_tier = (price_base * (Decimal("1") + delta_pct)).quantize(Decimal("0.01"))
        total_tier = (price_tier * Decimal(total_pares or 0)).quantize(Decimal("0.01"))
        is_active = (int(credit_days or 0) == days)
        diff = (total_tier - base_total).quantize(Decimal("0.01"))
        if days == 90:
            sub_label = "Plazo base referencia" if not is_active else "Plazo actual PO"
            sub_color = "var(--t3)"
        elif diff < 0:
            sub_label = f"Ahorro {_fmt_money(abs(diff))}"
            sub_color = "var(--ok)"
        elif diff > 0:
            sub_label = f"Recargo {_fmt_money(diff)}"
            sub_color = "var(--warn)"
        else:
            sub_label = "Sin diferencia"
            sub_color = "var(--t2)"
        if is_active and days != 90:
            sub_label += " · Plazo actual"
        # Estilo del card: el activo lleva borde acentuado
        if is_active:
            card_style = "padding:14px;border:2px solid var(--ok);border-radius:10px;background:var(--ok-bg);text-align:center;"
            label_color = "var(--ok)"
            big_color = "var(--ok)"
        elif days == 90:
            card_style = "padding:14px;border:1px solid var(--brd2);border-radius:10px;background:var(--raised);text-align:center;"
            label_color = "var(--t2)"
            big_color = "var(--t3)"
        else:
            card_style = "padding:14px;border:1px solid var(--brd);border-radius:10px;background:var(--srf);text-align:center;"
            label_color = "var(--t2)"
            big_color = "var(--t2)"
        cards.append(f"""
        <div style="{card_style}">
          <div style="font-size:11px;color:{label_color};font-weight:700;text-transform:uppercase;letter-spacing:.5px;">{days} días</div>
          <div style="font-size:22px;font-weight:800;color:{big_color};margin-top:4px;">{_esc(label)}</div>
          <div style="font-size:18px;font-weight:700;color:var(--t1);margin-top:8px;font-variant-numeric:tabular-nums;">{_fmt_money(price_tier)}</div>
          <div style="font-size:10px;color:var(--t2);">por par</div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--raised);">
            <div style="font-size:13px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;">{_fmt_money(total_tier)}</div>
            <div style="font-size:9.5px;color:{sub_color};font-weight:600;margin-top:2px;">{_esc(sub_label)}</div>
          </div>
        </div>""")
    return "".join(cards)


def _build_lineas_html(lineas, prod_map):
    """Genera <tr> de la tabla de líneas. Cada línea muestra:
    # / SKU / Descripción / Color / Talla / Qty / Precio / Subtotal.

    Sprint 2026-05-10 v2: el descuento por pronto pago (credit_days) NO
    se aplica aquí — el total del pedido se queda en base. El selector
    de plazo en el modal solo persiste credit_days en el expediente y
    el bloque de tier comparison abajo del HTML refleja la card activa.
    """
    rows = []
    total_qty = Decimal(0)
    total_value = Decimal(0)
    for idx, l in enumerate(lineas, start=1):
        prod = prod_map.get(str(l.producto_id or ""), {})
        nombre = prod.get("nombre") or l.sku or "—"
        color = prod.get("color") or "—"
        qty = Decimal(l.qty or 0)
        unit = _resolve_unit_price(l)
        sub = (unit * qty).quantize(Decimal("0.01"))
        total_qty += qty
        total_value += sub
        rows.append(f"""
        <tr>
          <td>{idx}</td>
          <td class="m">{_esc(l.sku or "—")}</td>
          <td>{_esc(nombre)}</td>
          <td>{_esc(color)}</td>
          <td class="r">{_esc(l.size or "—")}</td>
          <td class="r">{_fmt_int(qty)}</td>
          <td class="r">{_fmt_money(unit)}</td>
          <td class="r">{_fmt_money(sub)}</td>
        </tr>""")
    rows_html = "".join(rows)
    total_qty_int = int(total_qty)
    total_value_q = total_value.quantize(Decimal("0.01"))
    rows_html += f"""
        <tr class="trow"><td colspan="5"><strong>TOTAL</strong></td><td class="r"><strong>{_fmt_int(total_qty_int)}</strong></td><td></td><td class="r"><strong>{_fmt_money(total_value_q)}</strong></td></tr>"""
    return rows_html, total_qty_int, total_value_q


def render_proforma_html(expediente_id, request_user=None,
                         codigo_override=None):
    """Renderea el HTML de la proforma CLIENTE con el layout V2 — el
    mismo de la tab "Cliente" de la tri-vista (Sprint 2026-07-20):
    cards Cliente / Condiciones (valor neto en letras) / Datos proforma,
    líneas con precio unit_price_client, observaciones DDP y desglose
    por talla en pills. Una sola vista, sin tabs.

    Args:
        expediente_id: UUID del expediente.
        request_user: opcional, usuario que dispara la generación.
        codigo_override: si viene, se usa como código de la proforma
            (ej. "PF-2417-2026" — lo que tipeó el usuario en el input
            'Numero / Codigo'). Si es None o vacío, cae al secuencial
            PF-YYYY-NNNN.

    Returns:
        (html_string, metadata_dict)

    Lanza ValueError si el expediente no tiene cliente o líneas.
    """
    # Imports locales: proforma_renderer_triview importa helpers de ESTE
    # módulo a nivel módulo — importarlo arriba sería circular.
    from .proforma_renderer_triview import (
        _PRINT_SCRIPT,
        _TRIVIEW_CSS,
        _build_view_cliente,
        _fetch_cliente_full,
        _fetch_producto_map as _fetch_producto_map_v2,
        _group_lines,
        _q2,
    )
    from .proforma_renderer_marluvas import (
        _fetch_brand_name,
        _fetch_mwt_company_data,
    )

    expediente = Expediente.objects.get(id=expediente_id, is_active=True)
    if not expediente.client_id:
        raise ValueError("expediente_sin_cliente")

    cliente = _fetch_cliente_full(expediente.client_id)
    if cliente is None:
        raise ValueError("cliente_no_encontrado")

    # OC asociada (puede no existir)
    oc = None
    if expediente.oc_id:
        oc = Oc.objects.filter(id=expediente.oc_id, is_active=True).first()

    # Líneas activas (mismo orden que la tri-vista)
    lineas = list(
        Linea.objects
        .filter(expediente_id=expediente.id, is_active=True)
        .order_by("sku", "size", "created_at")
    )
    if not lineas:
        raise ValueError("expediente_sin_lineas_activas")

    producto_ids = list({l.producto_id for l in lineas if l.producto_id})
    prod_map = _fetch_producto_map_v2(producto_ids)
    groups = _group_lines(lineas, prod_map)

    # Número de proforma — si el usuario tipeó algo, lo usamos.
    today = timezone.now().date()
    if codigo_override and str(codigo_override).strip():
        codigo = str(codigo_override).strip()
    else:
        codigo = _next_proforma_codigo(today.year)

    mwt = _fetch_mwt_company_data()
    brand_name = (_fetch_brand_name(getattr(expediente, "brand_id", None))
                  or "MARCA")

    # Plazo cliente: credit_days_cliente > credit_days > 90 — el mismo
    # criterio que la tri-vista.
    def _int_pos(v):
        try:
            n = int(v)
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None

    cli_days = (_int_pos(getattr(expediente, "credit_days_cliente", None))
                or _int_pos(expediente.credit_days) or 90)

    # PO Cliente · prioridad (sin cambios):
    #   1) Documento kind='OC' más reciente del expediente — el codigo
    #      lo tipea el usuario al subir la OC ("Numero/Codigo" del modal).
    #   2) oc.codigo (entidad OC del expediente).
    #   3) expediente.codigo como último fallback.
    po_codigo = None
    try:
        from .models import Documento
        latest_oc_doc = (
            Documento.objects
            .filter(expediente_id=expediente.id, kind='OC', is_active=True)
            .exclude(codigo__isnull=True)
            .exclude(codigo__exact='')
            .order_by('-created_at')
            .first()
        )
        if latest_oc_doc and latest_oc_doc.codigo:
            po_codigo = latest_oc_doc.codigo.strip()
    except Exception:
        po_codigo = None
    if not po_codigo:
        po_codigo = (oc.codigo if oc else (expediente.codigo or ""))

    # Totales — precio CLIENTE (unit_price_client congelado), redondeo
    # HALF-UP como SQL round() (ver _q2 en proforma_renderer_triview).
    total_pares = int(sum(g["qty"] for g in groups))
    total_cli = _q2(sum(g["sub_cli"] for g in groups))

    view_cliente = _build_view_cliente(
        expediente=expediente,
        cliente=cliente,
        groups=groups,
        mwt=mwt,
        brand_name=brand_name,
        codigo=codigo,
        cli_days=cli_days,
        po_codigo=po_codigo,
        total_pares=total_pares,
        total_cli=total_cli,
        today=today,
        active=True,
    )

    html_str = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proforma {_esc(codigo)} · PO {_esc(po_codigo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{_TRIVIEW_CSS}</style>
</head>
<body>

{view_cliente}

<style id="print-orientation"></style>
<script>{_PRINT_SCRIPT}</script>
</body>
</html>
"""

    # Filename amigable (mismo patrón de siempre para la vista cliente)
    cli_slug = (cliente["razon_social"] or "cliente").strip()
    cli_slug = "".join(ch if ch.isalnum() else "-" for ch in cli_slug).strip("-").lower() or "cliente"
    filename = f"{codigo}_{cli_slug}_{today.isoformat()}.html"

    metadata = {
        "codigo":          codigo,
        "filename":        filename,
        "client_id":       str(expediente.client_id),
        "expediente_id":   str(expediente.id),
        "oc_id":           str(expediente.oc_id) if expediente.oc_id else None,
        "total_pares":     total_pares,
        "total_value_usd": total_cli,
    }

    return html_str, metadata
