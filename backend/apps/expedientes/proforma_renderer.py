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
    credit_days del expediente."""
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
    # / SKU / Descripción / Color / Talla / Qty / Precio / Subtotal."""
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
    """Renderea el HTML de la proforma (tab SONDEL — vista cliente).

    Args:
        expediente_id: UUID del expediente.
        request_user: opcional, usuario que dispara la generación.
        codigo_override: si viene, se usa como código de la proforma
            (ej. "PF-2417-2026" — lo que tipeó el usuario en el input
            'Numero / Codigo' al subir el PDF). Si es None o vacío,
            cae al secuencial PF-YYYY-NNNN.

    Returns:
        (html_string, metadata_dict)

    Lanza ValueError si el expediente no tiene cliente o líneas.
    """
    expediente = Expediente.objects.get(id=expediente_id, is_active=True)
    if not expediente.client_id:
        raise ValueError("expediente_sin_cliente")

    cliente = _fetch_cliente(expediente.client_id)
    if cliente is None:
        raise ValueError("cliente_no_encontrado")

    # OC asociada (puede no existir)
    oc = None
    if expediente.oc_id:
        oc = Oc.objects.filter(id=expediente.oc_id, is_active=True).first()

    # Líneas activas
    lineas = list(
        Linea.objects
        .filter(expediente_id=expediente.id, is_active=True)
        .order_by("size", "sku", "created_at")
    )
    if not lineas:
        raise ValueError("expediente_sin_lineas_activas")

    producto_ids = list({l.producto_id for l in lineas if l.producto_id})
    prod_map = _fetch_producto_map(producto_ids)

    # Numero de proforma — si el usuario tipeó algo, lo usamos.
    today = timezone.now().date()
    if codigo_override and str(codigo_override).strip():
        codigo = str(codigo_override).strip()
    else:
        codigo = _next_proforma_codigo(today.year)

    # Operador / forma de pago
    operador = _operator_name(expediente, cliente)
    forma_pago = _forma_pago_label(expediente.forma_pago)
    plazo = _plazo_label(expediente.forma_pago, expediente.credit_days)

    # PO Cliente · prioridad:
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
    po_fecha = _fmt_date_es(oc.issued_at) if oc and oc.issued_at else "—"

    # Líneas + totales
    rows_html, total_pares, total_value = _build_lineas_html(lineas, prod_map)

    # Precio "promedio" para los cards de pronto pago — usamos el
    # mayor unit_price_client visto (todas las líneas suelen tener el
    # mismo precio por par; tomamos el max por seguridad).
    if total_pares > 0:
        price_avg = (total_value / Decimal(total_pares)).quantize(Decimal("0.01"))
    else:
        price_avg = Decimal("0.00")

    pronto_pago_html = _build_pronto_pago_html(
        price_avg, total_pares, int(expediente.credit_days or 0),
    )

    # Filename amigable
    cli_slug = (cliente["razon_social"] or "cliente").strip()
    cli_slug = "".join(ch if ch.isalnum() else "-" for ch in cli_slug).strip("-").lower() or "cliente"
    filename = f"{codigo}_{cli_slug}_{today.isoformat()}.html"

    title_safe = _esc(f"Proforma {codigo}")
    cliente_pais = cliente["pais"] or "—"
    cliente_ciudad = cliente["ciudad"] or "—"
    pais_label = ", ".join([x for x in (cliente_ciudad, cliente_pais) if x and x != "—"]) or "—"

    html_str = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_safe} · {_esc(expediente.codigo or "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {{
  --navy:#013A57;--navy-h:#0a4d6e;--mint:#75CBB3;--mint-s:#E8F5F0;
  --ice:#A8D8EA;--ice-s:#EDF6FB;--bg:#F8FAFB;--srf:#FFFFFF;--raised:#F1F5F9;
  --brd:#E2E8F0;--brd2:#CBD5E1;--t1:#0F172A;--t2:#475569;--t3:#94A3B8;
  --ok:#0E8A6D;--ok-bg:#F0FAF6;--warn:#B45309;--warn-bg:#FFF7ED;
  --crit:#DC2626;--crit-bg:#FEF2F2;--info:#0369A1;
}}
*{{margin:0;padding:0;box-sizing:border-box;}}
body{{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--t1);line-height:1.5;-webkit-font-smoothing:antialiased;}}
.dash{{max-width:1200px;margin:0 auto;padding:24px;}}
.head{{background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:20px 24px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:start;}}
.head h2{{font-size:18px;font-weight:800;color:var(--navy);letter-spacing:-.4px;}}
.head .meta{{font-size:12px;color:var(--t2);margin-top:4px;line-height:1.8;}}
.badge{{display:inline-flex;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700;}}
.tri{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;}}
.card{{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;}}
.card-h{{padding:12px 18px;border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;}}
.card-h h3{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}}
.card-h.info h3{{color:var(--info);}}
.card-h.mlv h3{{color:var(--navy);}}
.card-b{{padding:16px 18px;}}
.sr{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--raised);font-size:12px;}}
.sr:last-child{{border-bottom:none;}}
.sr .k{{color:var(--t2);}}
.sr .v{{font-weight:700;font-variant-numeric:tabular-nums;}}
.sr.big{{border-top:2px solid var(--navy);margin-top:6px;padding-top:10px;}}
.sr.big .v{{font-size:18px;}}
.sect{{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;margin-bottom:16px;}}
.sect-h{{padding:12px 18px;border-bottom:1px solid var(--brd);}}
.sect-h h3{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);}}
table.ct{{width:100%;border-collapse:collapse;font-size:12px;}}
table.ct thead th{{padding:8px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);background:var(--raised);border-bottom:2px solid var(--brd);}}
table.ct thead th.r{{text-align:right;}}
table.ct tbody td{{padding:8px 12px;border-bottom:1px solid #f1f5f9;}}
table.ct tbody td.r{{text-align:right;font-variant-numeric:tabular-nums;}}
table.ct tbody td.m{{font-family:'JetBrains Mono',monospace;font-size:11px;}}
table.ct .trow{{background:var(--raised);font-weight:700;}}
table.ct .trow td{{border-top:2px solid var(--navy);}}
.notes-card{{background:var(--raised);border:1px solid var(--brd);border-radius:8px;padding:14px 18px;font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:16px;}}
.notes-card strong{{color:var(--t1);}}
.actions{{display:flex;gap:8px;padding:16px 0;}}
.btn{{padding:8px 16px;border-radius:7px;font-size:12px;font-weight:600;border:none;cursor:pointer;}}
.btn-p{{background:var(--navy);color:white;}}
.btn-o{{background:none;border:1.5px solid var(--brd2);color:var(--t1);}}
@media(max-width:900px){{.tri{{grid-template-columns:1fr;}}}}
@media print{{
  *{{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}}
  .actions,[data-no-print]{{display:none!important;}}
  body{{background:white!important;font-size:10.5px;}}
  @page{{margin:12mm;size:letter;}}
  .dash{{max-width:100%;padding:0;}}
  table.ct{{font-size:9.5px;}}
  table.ct thead th{{font-size:8px;padding:5px 6px;background:#f1f5f9!important;border-bottom:2px solid #999!important;}}
  table.ct tbody td{{padding:5px 6px;}}
  table.ct .trow{{background:#f1f5f9!important;}}
  table.ct .trow td{{border-top:2px solid #333!important;}}
  .card,.sect,.head,.notes-card{{border:1px solid #ccc!important;background:white!important;}}
  .card,.sect,.head,.notes-card{{break-inside:avoid;page-break-inside:avoid;}}
  table.ct{{break-inside:auto;page-break-inside:auto;}}
  table.ct thead{{display:table-header-group;}}
  table.ct tr{{break-inside:avoid;page-break-inside:avoid;}}
}}
</style>
</head>
<body>

<div class="view active">
<div class="dash">

  <div class="head">
    <div>
      <h2>PROFORMA {_esc(codigo)} &middot; <span style="color:var(--info);">PO {_esc(po_codigo)}</span></h2>
      <div class="meta"><strong>Emisor:</strong> {_esc(operador)} &middot; Costa Rica<br>
        <strong>Cliente:</strong> {_esc(cliente['razon_social'] or '—')} &middot; {('Cédula Jurídica ' + _esc(cliente['cedula_juridica'])) if cliente['cedula_juridica'] else ''} &middot; {_esc(pais_label)}</div>
    </div>
    <span class="badge" style="background:rgba(0,160,221,.1);color:#0077A8;">VISTA CLIENTE</span>
  </div>

  <div class="tri">
    <div class="card">
      <div class="card-h info"><h3>Cliente</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Empresa</span><span class="v">{_esc(cliente['razon_social'] or '—')}</span></div>
        <div class="sr"><span class="k">Cédula Jurídica</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(cliente['cedula_juridica'] or '—')}</span></div>
        <div class="sr"><span class="k">Contacto</span><span class="v">{_esc(cliente['contacto_nombre'] or '—')}</span></div>
        <div class="sr"><span class="k">País</span><span class="v">{_esc(cliente['pais'] or '—')}</span></div>
        <div class="sr"><span class="k">Teléfono</span><span class="v" style="font-size:11px;">{_esc(cliente['contacto_tel'] or '—')}</span></div>
        <div class="sr"><span class="k">Email</span><span class="v" style="font-size:10px;" data-cfemail="">{_esc_email(cliente['contacto_email'] or '—')}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h info"><h3>Condiciones</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Forma de Pago</span><span class="v">{_esc(forma_pago)}</span></div>
        <div class="sr"><span class="k">Plazo de pago</span><span class="v">{_esc(plazo)}</span></div>
        <div class="sr"><span class="k">Moneda</span><span class="v" style="font-size:11px;">Dólares estadounidenses (USD)</span></div>
        <div class="sr"><span class="k">Precio por par</span><span class="v">{_fmt_money(price_avg)}</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr"><span class="k">Operado por</span><span class="v" style="font-size:11px;">{_esc(operador)}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h mlv"><h3>Datos proforma</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Proforma</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(codigo)}</span></div>
        <div class="sr"><span class="k">PO Referencia</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(po_codigo)}</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total</span><span class="v" style="color:var(--navy);">{_fmt_money(total_value)}</span></div>
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Propuesta &mdash; Descuento por Pronto Pago</h3></div>
    <div style="padding:18px;">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px;">
        {pronto_pago_html}
      </div>
      <div style="padding:10px 14px;background:var(--mint-s);border:1px solid var(--mint);border-radius:8px;font-size:11px;color:var(--t1);line-height:1.6;">
        <strong style="color:var(--navy);">Pronto pago:</strong> el descuento se aplica sobre el total facturado al confirmar el plazo de pago elegido. Plazo se cuenta desde la fecha de factura en destino. Sujeto a aprobación de crédito y disponibilidad de stock.
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Líneas de producto</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Part Nº</th><th>Descripción</th><th>Color</th><th class="r">Talla</th><th class="r">Cantidad</th><th class="r">Precio $</th><th class="r">Total</th></tr></thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>

  <div class="notes-card">
    <strong>Operador:</strong> Esta orden es operada por <strong>{_esc(operador)}</strong>, quien gestiona la importación y entrega en destino.<br>
    <strong>Ref:</strong> PO {_esc(po_codigo)}. Documento generado el {_esc(_fmt_date_es(today))}.<br>
    <strong>Bill To:</strong> {_esc(cliente['razon_social'] or '—')} &middot; {_esc(pais_label)} &middot; Contact: {_esc(cliente['contacto_nombre'] or '—')}
  </div>

  <div class="actions" data-no-print>
    <button class="btn btn-p" onclick="window.print()">Imprimir</button>
    <button class="btn btn-o" onclick="window.close()">Cerrar</button>
  </div>

</div>
</div>
</body>
</html>
"""

    metadata = {
        "codigo":          codigo,
        "filename":        filename,
        "client_id":       str(expediente.client_id),
        "expediente_id":   str(expediente.id),
        "oc_id":           str(expediente.oc_id) if expediente.oc_id else None,
        "total_pares":     total_pares,
        "total_value_usd": total_value,
    }

    return html_str, metadata
