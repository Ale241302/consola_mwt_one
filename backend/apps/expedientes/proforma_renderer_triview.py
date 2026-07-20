"""
=====================================================================
MWT.ONE · apps.expedientes.proforma_renderer_triview
Agente responsable: [AG-BACKEND]

Sprint 2026-07-19 · Proforma TRI-VISTA (CEO · Marluvas · Cliente) para
audiencias internas (MWT_INTERNAL / ADMIN_ONLY).

Un solo HTML con 3 tabs:
  1. CEO — modelo triangular (MWT compra a proveedor al precio UF y
     revende al cliente al precio de la OC): líneas UF vs venta con
     delta por par, arbitraje (sobreprecio fábrica, diferencial fiscal
     15%, capital, ciclo de caja) y margen bruto total.
  2. MARLUVAS — vista proveedor (compra MWT al precio unit_price_mwt).
  3. CLIENTE — vista cliente final (venta al precio unit_price_client).

Todo se calcula de datos reales (expedientes.linea con precios duales
congelados, clientes.cliente, productos.producto, brands.marca).
=====================================================================
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db import connection
from django.utils import timezone

from apps.core.constants import MWT_OPERATING_CLIENT_ID
from .models import Expediente, Linea, Oc
from .proforma_renderer import (
    _esc,
    _fmt_date_es,
    _fmt_int,
    _fmt_money,
    _next_proforma_codigo,
)
from .proforma_renderer_marluvas import (
    _fetch_mwt_company_data,
    _fetch_brand_name,
    _resolve_unit_price_mwt,
    _forma_pago_label,
)

log = logging.getLogger(__name__)

D15 = Decimal("0.15")  # diferencial fiscal interno (DAI+Ley6946)


def _q2(d) -> Decimal:
    """Sprint 2026-07-19 · redondeo a centavos HALF-UP — el mismo que usa
    SQL round() en la OC, para que la proforma coincida al centavo con el
    total de la orden (Python Decimal usa half-even por default)."""
    return Decimal(d or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ─────────────────────────────────────────────────────────────────────
# Fetch de datos
# ─────────────────────────────────────────────────────────────────────
def _fetch_cliente_full(client_id):
    """razon_social, cedula (tax_id), contacto, país, medio_pago, codigo_marluvas."""
    if not client_id:
        return None
    with connection.cursor() as c:
        c.execute("""
            SELECT razon_social, COALESCE(NULLIF(cedula_juridica,''), tax_id),
                   contacto_nombre, contacto_email, pais_iso2, ciudad,
                   medio_pago, codigo_marluvas
              FROM clientes.cliente
             WHERE id = %s AND is_active = TRUE
        """, [str(client_id)])
        row = c.fetchone()
    if not row:
        return None
    return {
        "razon_social":    row[0] or "",
        "cedula":          row[1] or "",
        "contacto_nombre": row[2] or "",
        "contacto_email":  row[3] or "",
        "pais":            row[4] or "",
        "ciudad":          row[5] or "",
        "medio_pago":      row[6] or "",
        "codigo_marluvas": row[7] or "",
    }


def _fetch_producto_map(producto_ids):
    """{producto_id: {'nombre', 'color', 'ncm'}} — ncm desde especificaciones."""
    if not producto_ids:
        return {}
    placeholders = ",".join(["%s"] * len(producto_ids))
    with connection.cursor() as c:
        c.execute(f"""
            SELECT id, nombre,
                   especificaciones ->> 'color' AS color,
                   especificaciones ->> 'ncm'   AS ncm
              FROM productos.producto
             WHERE id IN ({placeholders})
        """, [str(pid) for pid in producto_ids])
        rows = c.fetchall()
    return {
        str(pid): {"nombre": nombre or "", "color": color or "", "ncm": ncm or ""}
        for pid, nombre, color, ncm in rows
    }


def _resolve_unit_price_client(linea) -> Decimal:
    upc = Decimal(linea.unit_price_client or 0)
    if upc > 0:
        return upc
    return Decimal(linea.unit_price or 0)


# ─────────────────────────────────────────────────────────────────────
# Números a letras (ES) — para "Valor Neto"
# ─────────────────────────────────────────────────────────────────────
_UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete",
             "ocho", "nueve", "diez", "once", "doce", "trece", "catorce",
             "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte"]
_DECENAS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta",
            7: "setenta", 8: "ochenta", 9: "noventa"}
_CENTENAS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos",
             5: "quinientos", 6: "seiscientos", 7: "setecientos",
             8: "ochocientos", 9: "novecientos"}


def _w99(n: int) -> str:
    if n <= 20:
        return _UNIDADES[n]
    if n < 30:
        return "veinti" + _UNIDADES[n - 20]
    d, u = divmod(n, 10)
    return _DECENAS[d] + (f" y {_UNIDADES[u]}" if u else "")


def _w999(n: int) -> str:
    if n == 0:
        return ""
    if n == 100:
        return "cien"
    c, r = divmod(n, 100)
    parts = []
    if c:
        parts.append(_CENTENAS[c] if c > 1 or r else "cien")
    if r:
        parts.append(_w99(r))
    return " ".join(parts)


def _num_words_es(n: int) -> str:
    if n == 0:
        return "cero"
    parts = []
    millones, resto = divmod(n, 1_000_000)
    miles, unidades = divmod(resto, 1000)
    if millones:
        parts.append("un millón" if millones == 1 else f"{_num_words_es(millones)} millones")
    if miles:
        parts.append("mil" if miles == 1 else f"{_w999(miles)} mil")
    if unidades:
        parts.append(_w999(unidades))
    return " ".join(parts)


def _money_words_es(value: Decimal) -> str:
    v = Decimal(value or 0).quantize(Decimal("0.01"))
    entero = int(v)
    cents = int((v - entero) * 100)
    return f"{_num_words_es(entero)} con {cents:02d}/100"


# ─────────────────────────────────────────────────────────────────────
# Agregación por SKU
# ─────────────────────────────────────────────────────────────────────
def _group_lines(lineas, prod_map):
    """Agrupa por SKU preservando orden alfabético. Cada grupo:
    {sku, label, ncm, color, upm, upc, qty, sub_mwt, sub_cli, sizes[]}."""
    groups = {}
    for l in lineas:
        sku = (l.sku or "").strip().upper()
        if not sku:
            continue
        g = groups.setdefault(sku, {
            "sku": sku,
            "label": (prod_map.get(str(l.producto_id) or "", {}).get("nombre")
                      or l.product_label or ""),
            "ncm": prod_map.get(str(l.producto_id) or "", {}).get("ncm") or "",
            "color": prod_map.get(str(l.producto_id) or "", {}).get("color") or "",
            "upm": _resolve_unit_price_mwt(l),
            "upc": _resolve_unit_price_client(l),
            "qty": Decimal("0"),
            "sizes": [],
        })
        qty = Decimal(l.qty or 0)
        g["qty"] += qty
        # tallas ordenadas numéricamente cuando sea posible
        size = (l.size or "").strip()
        g["sizes"].append((size, qty))
    out = sorted(groups.values(), key=lambda g: g["sku"])
    for g in out:
        g["sub_mwt"] = _q2(g["qty"] * g["upm"])
        g["sub_cli"] = _q2(g["qty"] * g["upc"])
        def _key(t):
            try:
                return (0, float(t[0]))
            except (TypeError, ValueError):
                return (1, t[0])
        g["sizes"].sort(key=_key)
    return out


def _pills_html(sizes):
    return "".join(
        f'<div class="pill"><span class="s">{_esc(s or "—")}</span>'
        f'<span class="q">{_fmt_int(q)}</span></div>'
        for s, q in sizes
    )


def _talla_sections(groups, titulo):
    parts = []
    for g in groups:
        parts.append(
            f'<div class="pill-group"><div class="pl">{_esc(g["sku"])} · '
            f'{_esc(g["label"])} · {_fmt_int(g["qty"])} pares</div>'
            f'<div class="pills">{_pills_html(g["sizes"])}</div></div>'
        )
    return (
        '<div class="sect"><div class="sect-h"><h3>' + titulo + "</h3></div>"
        '<div style="padding:16px 18px;">' + "".join(parts) + "</div></div>"
    )


# ─────────────────────────────────────────────────────────────────────
# Render principal
# ─────────────────────────────────────────────────────────────────────
def render_proforma_html_triview(expediente_id, request_user=None,
                                 codigo_override=None,
                                 payment_days_override=None):
    """HTML tri-vista (CEO · Marluvas · Cliente) de la proforma.

    Returns: (html_string, metadata_dict)
    """
    expediente = Expediente.objects.get(id=expediente_id, is_active=True)
    if not expediente.client_id:
        raise ValueError("expediente_sin_cliente")

    cliente = _fetch_cliente_full(expediente.client_id)
    oc = None
    if expediente.oc_id:
        oc = Oc.objects.filter(id=expediente.oc_id, is_active=True).first()

    lineas = list(
        Linea.objects
        .filter(expediente_id=expediente.id, is_active=True)
        .order_by("sku", "size", "created_at")
    )
    if not lineas:
        raise ValueError("expediente_sin_lineas_activas")

    producto_ids = list({l.producto_id for l in lineas if l.producto_id})
    prod_map = _fetch_producto_map(producto_ids)
    groups = _group_lines(lineas, prod_map)

    today = timezone.now().date()
    if codigo_override and str(codigo_override).strip():
        codigo = str(codigo_override).strip()
    else:
        codigo = _next_proforma_codigo(today.year)

    mwt = _fetch_mwt_company_data()
    brand_name = _fetch_brand_name(getattr(expediente, "brand_id", None)) or "MARCA"

    # Plazos: cliente = override > credit_days_cliente > credit_days > 90.
    # MWT = credit_days_mwt > 15 (el wizard congela unit_price_mwt al plazo
    # elegido; default del modelo = 15d).
    def _int_pos(v):
        try:
            n = int(v)
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None
    cli_days = (_int_pos(payment_days_override)
                or _int_pos(getattr(expediente, "credit_days_cliente", None))
                or _int_pos(expediente.credit_days) or 90)
    mwt_days = (_int_pos(getattr(expediente, "credit_days_mwt", None)) or 15)

    # PO del cliente
    po_codigo = (oc.codigo if oc and oc.codigo else (expediente.codigo or ""))
    po_fecha = _fmt_date_es(oc.issued_at) if oc and oc.issued_at else "—"

    # Totales (redondeo HALF-UP como SQL round() — ver _q2)
    total_pares = sum(g["qty"] for g in groups)
    total_mwt = _q2(sum(g["sub_mwt"] for g in groups))
    total_cli = _q2(sum(g["sub_cli"] for g in groups))
    sobreprecio = _q2(total_cli - total_mwt)
    diferencial = _q2(sobreprecio * D15)
    margen = _q2(sobreprecio + diferencial)
    roi = (margen / total_mwt * 100).quantize(Decimal("0.1")) if total_mwt > 0 else Decimal("0")
    pct_venta = (margen / total_cli * 100).quantize(Decimal("0.1")) if total_cli > 0 else Decimal("0")
    ciclo = cli_days - mwt_days

    is_mwt_op = (
        str(getattr(expediente, "operating_company_id", "") or "").lower()
        == str(MWT_OPERATING_CLIENT_ID).lower()
    )
    modelo_lbl = "B (Triangular — MWT compra/revende)" if is_mwt_op else "A (Directo)"

    # Filename amigable (mismo patrón que las otras vistas)
    cli_slug = (cliente.get("razon_social") if cliente else "mwt") or "mwt"
    cli_slug = "".join(ch if ch.isalnum() else "-" for ch in cli_slug).strip("-").lower() or "mwt"
    filename = f"{codigo}_MWT_{cli_slug}_{today.isoformat()}.html"

    metadata = {
        "filename": filename,
        "codigo": codigo,
        "total_pares": int(total_pares),
        "total_value_usd": str(_q2(total_mwt)),
        # Sprint 2026-07-19 · sin esto el Documento quedaba con oc_id NULL
        # y no aparecía en "Documentos comerciales" (la lista filtra ?oc=).
        "oc_id": str(expediente.oc_id) if expediente.oc_id else None,
    }

    # ── VISTA 1 · CEO — modelo triangular ────────────────────────────
    line_rows = []
    for i, g in enumerate(groups, 1):
        delta = g["upc"] - g["upm"]
        line_rows.append(
            f'<tr><td>{i}</td><td class="m">{_esc(g["sku"])}</td>'
            f'<td>{_esc(g["label"])}</td>'
            f'<td class="m" style="font-size:10px;">{_esc(g["ncm"] or "—")}</td>'
            f'<td>{_esc(g["color"] or "—")}</td>'
            f'<td class="r">{_fmt_int(g["qty"])}</td>'
            f'<td class="r cb">{_fmt_money(g["upm"])}</td>'
            f'<td class="r cb">{_fmt_money(g["sub_mwt"])}</td>'
            f'<td class="r rb">{_fmt_money(g["upc"])}</td>'
            f'<td class="r rb">{_fmt_money(g["sub_cli"])}</td>'
            f'<td class="r" style="color:var(--ok);font-weight:700;">+{_fmt_money(delta)}</td></tr>'
        )
    lines_ceo = "".join(line_rows)

    view_ceo = f"""
<div id="v-ceo" class="view active">
<div class="dash">
  <div class="head">
    <div>
      <h2>{_esc(codigo)} — Triangular: MWT compra a {_esc(brand_name)} y revende a {_esc(cliente["razon_social"] if cliente else "cliente")}</h2>
      <div class="meta">
        <strong>Expediente:</strong> {_esc(expediente.codigo or "—")} · <strong>PO Cliente:</strong> {_esc(po_codigo)} · <strong>Modelo:</strong> {_esc(modelo_lbl)}<br>
        <strong>Cliente final:</strong> {_esc(cliente["razon_social"] if cliente else "—")}{(", " + _esc(cliente["ciudad"]) + ", " + _esc(cliente["pais"])) if cliente and (cliente["ciudad"] or cliente["pais"]) else ""} · <strong>Contacto:</strong> {_esc(cliente["contacto_nombre"] if cliente else "—")} · <strong>Creada:</strong> {_fmt_date_es(today)}<br>
        {f'<strong>Cód. SAP cliente:</strong> {_esc(cliente["codigo_marluvas"])}<br>' if cliente and cliente.get("codigo_marluvas") else ""}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
      <span class="badge bg-tri">TRIANGULAR MWT</span>
      <span class="badge bg-ceo">CEO-ONLY · INTERNAL</span>
    </div>
  </div>

  <div class="dual">
    <div class="card">
      <div class="card-h cost"><h3>Compra MWT &larr; {_esc(brand_name)} (UF · {mwt_days}d)</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Comisión MWT</span><span class="v">0% (compra/reventa)</span></div>
        <div class="sr"><span class="k">Condición pago</span><span class="v" style="font-size:11px;">{mwt_days}d desde aviso embarque</span></div>
        <div class="sr"><span class="k">Medio de pago</span><span class="v" style="font-size:11px;">Transferencia bancaria</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total compra MWT</span><span class="v" style="color:var(--navy);">{_fmt_money(total_mwt)}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h rev"><h3>Venta MWT &rarr; {_esc(cliente["razon_social"] if cliente else "Cliente")} (orden · {cli_days}d)</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">PO Cliente</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(po_codigo)}</span></div>
        <div class="sr"><span class="k">Fecha PO</span><span class="v" style="font-size:11px;">{po_fecha}</span></div>
        <div class="sr"><span class="k">Crédito</span><span class="v" style="font-size:11px;">{cli_days} días</span></div>
        <div class="sr"><span class="k">Precio</span><span class="v" style="font-size:11px;">Precio de la orden (OC {_esc(po_codigo)})</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total venta cliente</span><span class="v" style="color:var(--ok);">{_fmt_money(total_cli)}</span></div>
        <div class="sr"><span class="k" style="font-weight:600;">Delta (margen bruto)</span><span class="v" style="color:var(--ok);font-size:15px;">+{_fmt_money(margen)}</span></div>
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Líneas — Compra UF vs Venta</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Producto</th><th>NCM</th><th>Color</th><th class="r">Qty</th><th class="r cb">UF {mwt_days}d</th><th class="r cb">Subt. MWT</th><th class="r rb">Venta OC</th><th class="r rb">Subt. Cliente</th><th class="r">Δ fábrica/par</th></tr></thead>
      <tbody>
        {lines_ceo}
        <tr class="trow"><td colspan="5">TOTAL</td><td class="r">{_fmt_int(total_pares)}</td><td class="r cb"></td><td class="r cb">{_fmt_money(total_mwt)}</td><td class="r rb"></td><td class="r rb">{_fmt_money(total_cli)}</td><td class="r" style="color:var(--ok);">+{_fmt_money(sobreprecio)}</td></tr>
      </tbody>
    </table>
    <div style="padding:8px 12px;font-size:10px;color:var(--t3);">UF = compra MWT (unit_price_mwt congelado, pago {mwt_days}d). Venta OC = unit_price_client congelado de cada línea. El diferencial fiscal (15% DAI+Ley6946) NO se suma al precio del cliente: es ganancia interna de MWT que se captura en aduana declarando el valor UF. Ver arbitraje.</div>
  </div>

  <div class="arb">
    <h3>Arbitraje CEO-ONLY — Modelo B Triangular</h3>
    <div class="arb-grid">
      <div class="arb-card"><div class="p">Sobreprecio de fábrica</div><div class="f">Venta − UF · {_fmt_int(total_pares)} prs</div><div class="r pos">+{_fmt_money(sobreprecio)}</div></div>
      <div class="arb-card"><div class="p">Diferencial de impuestos (interno)</div><div class="f">15% s/ sobreprecio · arbitraje aduanero</div><div class="r pos">+{_fmt_money(diferencial)}</div></div>
      <div class="arb-card"><div class="p">Capital requerido</div><div class="f">UF {mwt_days}d</div><div class="r neu">{_fmt_money(total_mwt)}</div></div>
      <div class="arb-card"><div class="p">Ciclo de caja</div><div class="f">pago {mwt_days}d / cobro {cli_days}d</div><div class="r neu">−{ciclo} días</div></div>
    </div>
    <div class="arb-tot"><span class="tl">Margen bruto MWT (ROI {roi}% · {pct_venta}% s/venta)</span><span class="tv">+{_fmt_money(margen)}</span></div>
  </div>

  <div class="pend-card">
    <strong>⏳ Nacionalización DDP — pendiente flete real.</strong> Este documento fija el margen comercial (sobreprecio de fábrica + diferencial fiscal), que <strong>no depende del flete</strong>. La liquidación aduanera completa al centavo (Valor de Aduana = FOB + flete + seguro; DAI 14%, Ley 6946 1%, IVA 13% acreditable, timbres) se agrega cuando se tenga el <strong>flete exacto, seguro, TC ₡/USD y peso/cajas</strong> del envío. El diferencial fiscal ya trasladado (15% del sobreprecio) es independiente del flete porque el flete es idéntico en ambas declaraciones y se cancela.
  </div>

  <div class="balance-card">
    <strong>Lógica del negocio:</strong> MWT compra a {_esc(brand_name)} al precio UF (bajo, {mwt_days}d), nacionaliza declarando ese valor, y entrega DDP a {_esc(cliente["razon_social"] if cliente else "el cliente")} a {cli_days}d cobrando el precio de la orden (OC {_esc(po_codigo)}). El diferencial de impuestos lo captura internamente en aduana al declarar el valor UF, no lo suma al precio del cliente. Gana el spread de fábrica (+{_fmt_money(sobreprecio)}) + el spread fiscal (+{_fmt_money(diferencial)}) = <strong>{_fmt_money(margen)}</strong>. Contrapartida: MWT financia el ciclo (paga a {mwt_days}d, cobra a {cli_days}d → {ciclo} días de descalce, {_fmt_money(total_mwt)} inmovilizados). <strong>Riesgo:</strong> declarar el precio intercompañía UF y no el de reventa es subvaluación aduanera observable — palanca y riesgo del modelo.
  </div>
</div>
</div>
"""

    # ── VISTA 2 · MARLUVAS (compra MWT) ──────────────────────────────
    rows_mlv = []
    for i, g in enumerate(groups, 1):
        rows_mlv.append(
            f'<tr><td>{i}</td><td class="m">{_esc(g["sku"])}</td>'
            f'<td>{_esc(g["label"])}</td>'
            f'<td class="m" style="font-size:10px;">{_esc(g["ncm"] or "—")}</td>'
            f'<td>{_esc((g["color"] or "—").upper())}</td>'
            f'<td class="r">{_fmt_int(g["qty"])}</td>'
            f'<td class="r">{_fmt_money(g["upm"])}</td>'
            f'<td class="r">{_fmt_money(g["sub_mwt"])}</td></tr>'
        )
    rows_mlv = "".join(rows_mlv)

    view_marluvas = f"""
<div id="v-marluvas" class="view">
<div class="dash">
  <div class="head">
    <div>
      <h2>{_esc(brand_name.upper())} · {_esc(codigo)}</h2>
      <div class="meta"><strong>Emisor:</strong> {_esc(mwt["razon_social"])} {("· " + _esc(mwt["tax_id"])) if mwt.get("tax_id") else ""}<br>
        <strong>Comprador:</strong> {_esc(mwt["razon_social"]).upper()}</div>
    </div>
    <span class="badge bg-mlv">VISTA MARLUVAS</span>
  </div>
  <div class="tri">
    <div class="card">
      <div class="card-h info"><h3>Comprador</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Empresa</span><span class="v">{_esc(mwt["razon_social"]).upper()}</span></div>
        <div class="sr"><span class="k">Cédula Jurídica</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(mwt["tax_id"] or "—")}</span></div>
        <div class="sr"><span class="k">Contacto</span><span class="v">{_esc(mwt["contacto_nombre"] or "—")}</span></div>
        <div class="sr"><span class="k">País</span><span class="v">{_esc(mwt["pais"] or "Costa Rica")}</span></div>
        <div class="sr"><span class="k">Email</span><span class="v" style="font-size:10px;">{_esc(mwt["contacto_email"] or "—")}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h info"><h3>Condiciones</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Forma de Pago</span><span class="v">{_esc(_forma_pago_label(expediente.forma_pago))}</span></div>
        <div class="sr"><span class="k">Plazo de pago</span><span class="v">{mwt_days} días</span></div>
        <div class="sr"><span class="k">Moneda</span><span class="v" style="font-size:11px;">Dólares (USD)</span></div>
        <div class="sr"><span class="k">Valor Neto</span><span class="v" style="font-size:9.5px;font-style:italic;">{_esc(_money_words_es(total_mwt))}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h mlv"><h3>Datos proforma</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Proforma</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(codigo)}</span></div>
        <div class="sr"><span class="k">Fecha</span><span class="v" style="font-size:11px;">{_fmt_date_es(today)}</span></div>
        <div class="sr"><span class="k">Precios</span><span class="v">FOB</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total</span><span class="v" style="color:var(--navy);">{_fmt_money(total_mwt)}</span></div>
      </div>
    </div>
  </div>
  <div class="sect">
    <div class="sect-h"><h3>Líneas de producto (compra MWT)</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Referencia</th><th>NCM</th><th>Color</th><th class="r">Cantidad</th><th class="r">Precio $</th><th class="r">Total</th></tr></thead>
      <tbody>
        {rows_mlv}
        <tr class="trow"><td colspan="5"><strong>TOTAL</strong></td><td class="r"><strong>{_fmt_int(total_pares)}</strong></td><td></td><td class="r"><strong>{_fmt_money(total_mwt)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes-card"><strong>Observações:</strong> Compra de {_esc(mwt["razon_social"]).upper()} a {_esc(brand_name)}. Preços FOB en USD. Pago a {mwt_days} días desde aviso de embarque.</div>
  {_talla_sections(groups, "Tallas BRA")}
</div>
</div>
"""

    # ── VISTA 3 · CLIENTE ────────────────────────────────────────────
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
    )

    html_str = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proforma MWT — {_esc(codigo)} · PO {_esc(po_codigo)} · Triangular</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{_TRIVIEW_CSS}</style>
</head>
<body>

<div class="top">
  <div><h1>ART-02 Proforma <span>· {_esc(codigo)} · PO {_esc(po_codigo)} · Modelo {_esc(modelo_lbl)}</span></h1></div>
  <div class="tabs">
    <button class="tab active" onclick="sw('ceo',this)">CEO</button>
    <button class="tab" onclick="sw('marluvas',this)">Marluvas</button>
    <button class="tab" onclick="sw('cliente',this)">Cliente</button>
  </div>
</div>

{view_ceo}
{view_marluvas}
{view_cliente}

<style id="print-orientation"></style>
<script>
function sw(v, btn){{
  document.querySelectorAll('.view').forEach(function(el){{el.classList.remove('active');}});
  document.querySelectorAll('.tab').forEach(function(t){{t.classList.remove('active');}});
  document.getElementById('v-'+v).classList.add('active');
  btn.classList.add('active');
}}
function printV(view,orientation){{
  var origTitle=document.title; document.title=' ';
  document.querySelectorAll('.view').forEach(function(el){{el.classList.remove('active');}});
  document.getElementById('v-'+view).classList.add('active');
  var style=document.getElementById('print-orientation');
  var css='@media print {{ @page {{ size: letter '+orientation+'; margin: 6mm 8mm; }}';
  if(orientation==='landscape'){{css+=' table.ct{{font-size:11px;}} table.ct thead th{{font-size:9px;padding:8px 10px;}} table.ct tbody td{{padding:7px 10px;}}';}}
  css+='}}';
  style.textContent=css;
  setTimeout(function(){{window.print();setTimeout(function(){{document.title=origTitle;style.textContent='';}},500);}},100);
}}
</script>
</body>
</html>
"""
    return html_str, metadata


# ─────────────────────────────────────────────────────────────────────
# CSS del template tri-vista (base: proforma V2 aprobada 2026-07-19)
# ─────────────────────────────────────────────────────────────────────
_TRIVIEW_CSS = r"""
:root{
  --navy:#013A57;--mint:#75CBB3;--mint-s:#E8F5F0;--ice:#A8D8EA;--ice-s:#EDF6FB;
  --bg:#F8FAFB;--srf:#FFFFFF;--raised:#F1F5F9;--brd:#E2E8F0;--brd2:#CBD5E1;
  --t1:#0F172A;--t2:#475569;--t3:#94A3B8;--ok:#0E8A6D;--warn:#B45309;--warn-bg:#FFF7ED;
  --crit:#DC2626;--crit-bg:#FEF2F2;--info:#0369A1;--purple:#7C3AED;--purple-bg:#F5F3FF;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--t1);line-height:1.5;-webkit-font-smoothing:antialiased;}
.top{position:fixed;top:0;left:0;right:0;z-index:100;background:var(--navy);height:52px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;}
.top h1{color:white;font-size:13px;font-weight:700;letter-spacing:-.3px;}
.top h1 span{opacity:.45;font-weight:400;}
.tabs{display:flex;gap:2px;background:rgba(255,255,255,.08);padding:3px;border-radius:8px;}
.tab{padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;color:rgba(255,255,255,.45);cursor:pointer;border:none;background:none;transition:all .15s;white-space:nowrap;}
.tab.active{background:white;color:var(--navy);}
.tab:hover:not(.active){color:white;}
.view{display:none;padding-top:52px;}
.view.active{display:block;}
.dash{max-width:1200px;margin:0 auto;padding:24px;}
.head{background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:20px 24px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:start;}
.head h2{font-size:18px;font-weight:800;color:var(--navy);letter-spacing:-.4px;}
.head .meta{font-size:12px;color:var(--t2);margin-top:4px;line-height:1.8;}
.badge{display:inline-flex;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700;}
.bg-draft{background:var(--warn-bg);color:var(--warn);}
.bg-ceo{background:var(--crit-bg);color:var(--crit);}
.bg-mlv{background:rgba(1,58,87,.08);color:var(--navy);}
.bg-tri{background:var(--purple-bg);color:var(--purple);}
.dual{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
.tri{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;}
.card{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;}
.card-h{padding:12px 18px;border-bottom:1px solid var(--brd);}
.card-h h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.card-h.cost h3{color:var(--navy);}
.card-h.rev h3{color:var(--ok);}
.card-h.info h3{color:var(--info);}
.card-h.mlv h3{color:var(--navy);}
.card-h.cli h3{color:var(--purple);}
.card-b{padding:16px 18px;}
.sr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--raised);font-size:12px;}
.sr:last-child{border-bottom:none;}
.sr .k{color:var(--t2);}
.sr .v{font-weight:700;font-variant-numeric:tabular-nums;}
.sr.big{border-top:2px solid var(--navy);margin-top:6px;padding-top:10px;}
.sr.big .v{font-size:18px;}
.sect{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;margin-bottom:16px;}
.sect-h{padding:12px 18px;border-bottom:1px solid var(--brd);}
.sect-h h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);}
table.ct{width:100%;border-collapse:collapse;font-size:12px;}
table.ct thead th{padding:8px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);background:var(--raised);border-bottom:2px solid var(--brd);}
table.ct thead th.r{text-align:right;}
table.ct tbody td{padding:8px 12px;border-bottom:1px solid #f1f5f9;}
table.ct tbody td.r{text-align:right;font-variant-numeric:tabular-nums;}
table.ct tbody td.m{font-family:'JetBrains Mono',monospace;font-size:11px;}
table.ct .cb{background:rgba(1,58,87,.02);}
table.ct .rb{background:rgba(14,138,109,.03);}
table.ct .trow{background:var(--raised);font-weight:700;}
table.ct .trow td{border-top:2px solid var(--navy);}
.pill-group{margin-bottom:14px;}
.pill-group .pl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:6px;}
.pills{display:flex;flex-wrap:wrap;gap:5px;}
.pill{display:inline-flex;flex-direction:column;align-items:center;padding:5px 9px;border:1px solid var(--brd);border-radius:6px;min-width:50px;background:var(--srf);}
.pill .s{font-size:9px;color:var(--t3);font-weight:600;}
.pill .q{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--navy);}
.arb{background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:18px;margin-bottom:16px;}
.arb h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);margin-bottom:12px;}
.arb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px;}
.arb-card{padding:10px;background:var(--raised);border-radius:8px;}
.arb-card .p{font-size:10px;color:var(--t3);font-weight:600;}
.arb-card .f{font-size:11px;color:var(--t2);}
.arb-card .r{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;}
.arb-card .r.pos{color:var(--ok);}
.arb-card .r.neu{color:var(--t3);}
.arb-tot{padding:12px 14px;background:var(--navy);border-radius:8px;display:flex;justify-content:space-between;align-items:center;}
.arb-tot .tl{font-size:11px;color:var(--ice);font-weight:600;text-transform:uppercase;letter-spacing:.5px;}
.arb-tot .tv{font-size:20px;font-weight:800;color:white;}
.notes-card{background:var(--raised);border:1px solid var(--brd);border-radius:8px;padding:14px 18px;font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:16px;}
.notes-card strong{color:var(--t1);}
.pend-card{background:var(--warn-bg);border:1px solid #f5c98a;border-radius:8px;padding:14px 18px;font-size:11px;color:#7a4a10;line-height:1.7;margin-bottom:16px;}
.pend-card strong{color:#5c3708;}
.balance-card{background:var(--ice-s);border:1px solid var(--ice);border-radius:8px;padding:14px 18px;font-size:11px;color:var(--navy);line-height:1.7;margin-bottom:16px;}
.balance-card strong{color:var(--navy);}
.actions{display:flex;gap:8px;padding:16px 0;justify-content:center;}
.btn{padding:9px 18px;border-radius:7px;font-size:12px;font-weight:600;border:none;cursor:pointer;font-family:inherit;}
.btn-p{background:var(--navy);color:#fff;}
.btn-p:hover{background:#0a4d6e;}
.btn-o{background:none;border:1.5px solid var(--brd2);color:var(--t1);}
.btn-o:hover{border-color:var(--navy);color:var(--navy);}
@media(max-width:900px){.dual,.tri{grid-template-columns:1fr;}}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}
  .top,.actions,.print-actions{display:none!important;}
  .bg-mlv,.bg-draft,.bg-ceo,.bg-tri{display:none!important;}
  .arb,.balance-card,.pend-card{display:none!important;}
  .view{display:none!important;}
  .view.active{display:block!important;padding-top:0!important;}
  @page{margin:6mm 8mm;size:letter;}
  body{background:white!important;font-size:11px;}
  .dash{max-width:100%;padding:0;}
  table.ct{font-size:10px;}
  table.ct thead th{font-size:8.5px;padding:6px 8px;background:#f1f5f9!important;border-bottom:2px solid #999!important;}
  table.ct tbody td{padding:6px 8px;}
  table.ct .trow{background:#f1f5f9!important;}
  table.ct .trow td{border-top:2px solid #333!important;}
  .card,.sect,.head,.notes-card{border:1px solid #ccc!important;}
  .card-h{border-bottom:1px solid #ccc!important;}
  .sect,.card{margin-bottom:10px;}
  .head{margin-bottom:12px;}
  .tri{grid-template-columns:1fr 1fr 1fr;gap:10px;}
  .dual{grid-template-columns:1fr 1fr;gap:10px;}
  .card,.sect,.head,.notes-card{break-inside:avoid;page-break-inside:avoid;}
  table.ct,table.ct tr,.pill-group{break-inside:avoid;page-break-inside:avoid;}
  .pill{padding:3px 7px;min-width:40px;}
  .pill .s{font-size:8px;}.pill .q{font-size:11px;}
  a{text-decoration:none;color:inherit;}
  .badge{border:1px solid currentColor;}
}
"""


# ─────────────────────────────────────────────────────────────────────
# Vista CLIENTE reutilizable (Sprint 2026-07-19)
# La usa la tri-vista (tab) y el renderer standalone de audiencia CLIENT.
# ─────────────────────────────────────────────────────────────────────
def _build_view_cliente(*, expediente, cliente, groups, mwt, brand_name,
                        codigo, cli_days, po_codigo, total_pares, total_cli,
                        today, active=False, with_print_buttons=True):
    """HTML de la vista CLIENTE (V2): card cliente, condiciones (valor
    neto en letras), datos proforma, líneas con precio unit_price_client,
    observaciones DDP y desglose por talla en pills."""
    rows_cli = []
    for i, g in enumerate(groups, 1):
        rows_cli.append(
            f'<tr><td>{i}</td><td class="m">{_esc(g["sku"])}</td>'
            f'<td>{_esc(g["label"])} — Marca {_esc(brand_name)}</td>'
            f'<td>{_esc(g["color"] or "—")}</td>'
            f'<td class="r">{_fmt_int(g["qty"])}</td>'
            f'<td class="r">{_fmt_money(g["upc"])}</td>'
            f'<td class="r">{_fmt_money(g["sub_cli"])}</td></tr>'
        )
    rows_cli = "".join(rows_cli)

    buttons = ""
    if with_print_buttons:
        buttons = """
  <div class="actions print-actions">
    <button class="btn btn-p" onclick="printV('cliente','portrait')">🖨 Imprimir Carta Vertical</button>
    <button class="btn btn-o" onclick="printV('cliente','landscape')">🖨 Imprimir Carta Horizontal</button>
  </div>"""

    return f"""
<div id="v-cliente" class="view{' active' if active else ''}">
<div class="dash">
  <div class="head">
    <div>
      <h2>{_esc(mwt["razon_social"]).upper()} · {_esc(codigo)}</h2>
      <div class="meta"><strong>Proveedor:</strong> {_esc(mwt["razon_social"])} {("· " + _esc(mwt["tax_id"])) if mwt.get("tax_id") else ""}<br>
        <strong>Cliente:</strong> {_esc(cliente["razon_social"] if cliente else "—")} {("· " + _esc(cliente["cedula"])) if cliente and cliente.get("cedula") else ""} · <strong>Contacto:</strong> {_esc(cliente["contacto_nombre"] if cliente else "—")} · <strong>Ref. PO:</strong> {_esc(po_codigo)}</div>
    </div>
    <span class="badge bg-tri">VISTA CLIENTE</span>
  </div>
  <div class="tri">
    <div class="card">
      <div class="card-h cli"><h3>Cliente</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Empresa</span><span class="v">{_esc(cliente["razon_social"] if cliente else "—")}</span></div>
        <div class="sr"><span class="k">Cédula Jurídica</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(cliente["cedula"] if cliente else "—")}</span></div>
        <div class="sr"><span class="k">Contacto</span><span class="v">{_esc(cliente["contacto_nombre"] if cliente else "—")}</span></div>
        <div class="sr"><span class="k">País</span><span class="v">{_esc(cliente["pais"] if cliente and cliente["pais"] else "Costa Rica")}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h info"><h3>Condiciones</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Forma de Pago</span><span class="v">{_esc(_forma_pago_label(expediente.forma_pago))}</span></div>
        <div class="sr"><span class="k">Plazo de pago</span><span class="v">{cli_days} días</span></div>
        <div class="sr"><span class="k">Entrega</span><span class="v" style="font-size:11px;">DDP bodega (nacionalizado)</span></div>
        <div class="sr"><span class="k">Moneda</span><span class="v" style="font-size:11px;">Dólares (USD)</span></div>
        <div class="sr"><span class="k">Valor Neto</span><span class="v" style="font-size:9.5px;font-style:italic;">{_esc(_money_words_es(total_cli))}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h mlv"><h3>Datos proforma</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Proforma</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(codigo)}</span></div>
        <div class="sr"><span class="k">Ref. PO</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(po_codigo)}</span></div>
        <div class="sr"><span class="k">Fecha</span><span class="v" style="font-size:11px;">{_fmt_date_es(today)}</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total</span><span class="v" style="color:var(--navy);">{_fmt_money(total_cli)}</span></div>
      </div>
    </div>
  </div>
  <div class="sect">
    <div class="sect-h"><h3>Líneas de producto — Marca {_esc(brand_name)}</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Descripción</th><th>Color</th><th class="r">Cantidad</th><th class="r">Precio USD</th><th class="r">Total USD</th></tr></thead>
      <tbody>
        {rows_cli}
        <tr class="trow"><td colspan="4"><strong>TOTAL</strong></td><td class="r"><strong>{_fmt_int(total_pares)}</strong></td><td></td><td class="r"><strong>{_fmt_money(total_cli)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes-card"><strong>Observaciones:</strong> Entrega <strong>DDP</strong> (Delivered Duty Paid) en bodega del cliente, mercancía nacionalizada por {_esc(mwt["razon_social"])} — el cliente no gestiona importación ni aduana. Ref. PO {_esc(po_codigo)}. Operado por {_esc(mwt["razon_social"])}. Precios sujetos a ajuste por flete definitivo.</div>
  {_talla_sections(groups, "Desglose por talla")}
  {buttons}
</div>
</div>
"""


# JS compartido: tabs + impresión por vista (Carta vertical/horizontal).
_PRINT_SCRIPT = """
function sw(v, btn){
  document.querySelectorAll('.view').forEach(function(el){el.classList.remove('active');});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('v-'+v).classList.add('active');
  if (btn) btn.classList.add('active');
}
function printV(view,orientation){
  var origTitle=document.title; document.title=' ';
  document.querySelectorAll('.view').forEach(function(el){el.classList.remove('active');});
  document.getElementById('v-'+view).classList.add('active');
  var style=document.getElementById('print-orientation');
  var css='@media print { @page { size: letter '+orientation+'; margin: 6mm 8mm; }';
  if(orientation==='landscape'){css+=' table.ct{font-size:11px;} table.ct thead th{font-size:9px;padding:8px 10px;} table.ct tbody td{padding:7px 10px;}';}
  css+='}';
  style.textContent=css;
  setTimeout(function(){window.print();setTimeout(function(){document.title=origTitle;style.textContent='';},500);},100);
}
"""


# ─────────────────────────────────────────────────────────────────────
# Sprint 2026-07-20 · Renders STANDALONE CEO y FÁBRICA (Marluvas)
#
# Cuando el expediente es operado por Muito Work Limitada,
# generate-proforma crea TRES documentos en una llamada:
#   · CLIENT       → render_proforma_html (vista cliente, proforma_renderer)
#   · MWT_INTERNAL → render_proforma_html_ceo (triangular compra/reventa)
#   · FABRICA      → render_proforma_html_fabrica (compra MWT al proveedor)
#
# Estos builders reutilizan el markup de las vistas CEO/Marluvas de la
# tri-vista, pero en HTML standalone (sin barra de tabs) y con los
# botones de impresión Carta Vertical/Horizontal de la vista cliente.
# La tri-vista (render_proforma_html_triview) NO cambia.
# ─────────────────────────────────────────────────────────────────────

def _proforma_context(expediente_id, codigo_override=None):
    """Datos compartidos de la proforma — el mismo criterio de fetch,
    plazos y totales (HALF-UP) que render_proforma_html_triview."""
    expediente = Expediente.objects.get(id=expediente_id, is_active=True)
    if not expediente.client_id:
        raise ValueError("expediente_sin_cliente")

    cliente = _fetch_cliente_full(expediente.client_id)
    oc = None
    if expediente.oc_id:
        oc = Oc.objects.filter(id=expediente.oc_id, is_active=True).first()

    lineas = list(
        Linea.objects
        .filter(expediente_id=expediente.id, is_active=True)
        .order_by("sku", "size", "created_at")
    )
    if not lineas:
        raise ValueError("expediente_sin_lineas_activas")

    producto_ids = list({l.producto_id for l in lineas if l.producto_id})
    prod_map = _fetch_producto_map(producto_ids)
    groups = _group_lines(lineas, prod_map)

    today = timezone.now().date()
    if codigo_override and str(codigo_override).strip():
        codigo = str(codigo_override).strip()
    else:
        codigo = _next_proforma_codigo(today.year)

    mwt = _fetch_mwt_company_data()
    brand_name = _fetch_brand_name(getattr(expediente, "brand_id", None)) or "MARCA"

    def _int_pos(v):
        try:
            n = int(v)
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None

    cli_days = (_int_pos(getattr(expediente, "credit_days_cliente", None))
                or _int_pos(expediente.credit_days) or 90)
    mwt_days = (_int_pos(getattr(expediente, "credit_days_mwt", None)) or 15)

    po_codigo = (oc.codigo if oc and oc.codigo else (expediente.codigo or ""))
    po_fecha = _fmt_date_es(oc.issued_at) if oc and oc.issued_at else "—"

    total_pares = sum(g["qty"] for g in groups)
    total_mwt = _q2(sum(g["sub_mwt"] for g in groups))
    total_cli = _q2(sum(g["sub_cli"] for g in groups))
    sobreprecio = _q2(total_cli - total_mwt)
    diferencial = _q2(sobreprecio * D15)
    margen = _q2(sobreprecio + diferencial)
    roi = (margen / total_mwt * 100).quantize(Decimal("0.1")) if total_mwt > 0 else Decimal("0")
    pct_venta = (margen / total_cli * 100).quantize(Decimal("0.1")) if total_cli > 0 else Decimal("0")
    ciclo = cli_days - mwt_days

    is_mwt_op = (
        str(getattr(expediente, "operating_company_id", "") or "").lower()
        == str(MWT_OPERATING_CLIENT_ID).lower()
    )
    modelo_lbl = "B (Triangular — MWT compra/revende)" if is_mwt_op else "A (Directo)"

    cli_slug = (cliente.get("razon_social") if cliente else "mwt") or "mwt"
    cli_slug = "".join(ch if ch.isalnum() else "-" for ch in cli_slug).strip("-").lower() or "mwt"

    return {
        "expediente": expediente, "cliente": cliente, "oc": oc,
        "groups": groups, "today": today, "codigo": codigo,
        "mwt": mwt, "brand_name": brand_name,
        "cli_days": cli_days, "mwt_days": mwt_days,
        "po_codigo": po_codigo, "po_fecha": po_fecha,
        "total_pares": total_pares, "total_mwt": total_mwt, "total_cli": total_cli,
        "sobreprecio": sobreprecio, "diferencial": diferencial, "margen": margen,
        "roi": roi, "pct_venta": pct_venta, "ciclo": ciclo,
        "modelo_lbl": modelo_lbl, "cli_slug": cli_slug,
    }


def _print_buttons(view_id):
    """Botones de impresión Carta V/H — mismos que la vista cliente."""
    return f"""
  <div class="actions print-actions">
    <button class="btn btn-p" onclick="printV('{view_id}','portrait')">🖨 Imprimir Carta Vertical</button>
    <button class="btn btn-o" onclick="printV('{view_id}','landscape')">🖨 Imprimir Carta Horizontal</button>
  </div>"""


def _standalone_shell(title, view_html):
    """Shell HTML standalone: CSS tri-vista + sin padding-top (no hay
    barra de tabs fija) + printV para los botones de impresión."""
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{_TRIVIEW_CSS}
/* Sin barra de tabs fija en la vista standalone — recuperar los 52px */
.view{{padding-top:0;}}</style>
</head>
<body>

{view_html}

<style id="print-orientation"></style>
<script>{_PRINT_SCRIPT}</script>
</body>
</html>
"""


def _build_view_ceo(ctx, *, active=True, with_print_buttons=True):
    """HTML de la vista CEO (triangular MWT) — mismo markup que la tab
    CEO de la tri-vista, con botones de impresión opcionales."""
    expediente  = ctx["expediente"]
    cliente     = ctx["cliente"]
    groups      = ctx["groups"]
    brand_name  = ctx["brand_name"]
    codigo      = ctx["codigo"]
    cli_days    = ctx["cli_days"]
    mwt_days    = ctx["mwt_days"]
    po_codigo   = ctx["po_codigo"]
    po_fecha    = ctx["po_fecha"]
    total_pares = ctx["total_pares"]
    total_mwt   = ctx["total_mwt"]
    total_cli   = ctx["total_cli"]
    sobreprecio = ctx["sobreprecio"]
    diferencial = ctx["diferencial"]
    margen      = ctx["margen"]
    roi         = ctx["roi"]
    pct_venta   = ctx["pct_venta"]
    ciclo       = ctx["ciclo"]
    modelo_lbl  = ctx["modelo_lbl"]
    today       = ctx["today"]

    line_rows = []
    for i, g in enumerate(groups, 1):
        delta = g["upc"] - g["upm"]
        line_rows.append(
            f'<tr><td>{i}</td><td class="m">{_esc(g["sku"])}</td>'
            f'<td>{_esc(g["label"])}</td>'
            f'<td class="m" style="font-size:10px;">{_esc(g["ncm"] or "—")}</td>'
            f'<td>{_esc(g["color"] or "—")}</td>'
            f'<td class="r">{_fmt_int(g["qty"])}</td>'
            f'<td class="r cb">{_fmt_money(g["upm"])}</td>'
            f'<td class="r cb">{_fmt_money(g["sub_mwt"])}</td>'
            f'<td class="r rb">{_fmt_money(g["upc"])}</td>'
            f'<td class="r rb">{_fmt_money(g["sub_cli"])}</td>'
            f'<td class="r" style="color:var(--ok);font-weight:700;">+{_fmt_money(delta)}</td></tr>'
        )
    lines_ceo = "".join(line_rows)
    buttons = _print_buttons("ceo") if with_print_buttons else ""

    return f"""
<div id="v-ceo" class="view{' active' if active else ''}">
<div class="dash">
  <div class="head">
    <div>
      <h2>{_esc(codigo)} — Triangular: MWT compra a {_esc(brand_name)} y revende a {_esc(cliente["razon_social"] if cliente else "cliente")}</h2>
      <div class="meta">
        <strong>Expediente:</strong> {_esc(expediente.codigo or "—")} · <strong>PO Cliente:</strong> {_esc(po_codigo)} · <strong>Modelo:</strong> {_esc(modelo_lbl)}<br>
        <strong>Cliente final:</strong> {_esc(cliente["razon_social"] if cliente else "—")}{(", " + _esc(cliente["ciudad"]) + ", " + _esc(cliente["pais"])) if cliente and (cliente["ciudad"] or cliente["pais"]) else ""} · <strong>Contacto:</strong> {_esc(cliente["contacto_nombre"] if cliente else "—")} · <strong>Creada:</strong> {_fmt_date_es(today)}<br>
        {f'<strong>Cód. SAP cliente:</strong> {_esc(cliente["codigo_marluvas"])}<br>' if cliente and cliente.get("codigo_marluvas") else ""}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
      <span class="badge bg-tri">TRIANGULAR MWT</span>
      <span class="badge bg-ceo">CEO-ONLY · INTERNAL</span>
    </div>
  </div>

  <div class="dual">
    <div class="card">
      <div class="card-h cost"><h3>Compra MWT &larr; {_esc(brand_name)} (UF · {mwt_days}d)</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Comisión MWT</span><span class="v">0% (compra/reventa)</span></div>
        <div class="sr"><span class="k">Condición pago</span><span class="v" style="font-size:11px;">{mwt_days}d desde aviso embarque</span></div>
        <div class="sr"><span class="k">Medio de pago</span><span class="v" style="font-size:11px;">Transferencia bancaria</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total compra MWT</span><span class="v" style="color:var(--navy);">{_fmt_money(total_mwt)}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h rev"><h3>Venta MWT &rarr; {_esc(cliente["razon_social"] if cliente else "Cliente")} (orden · {cli_days}d)</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">PO Cliente</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(po_codigo)}</span></div>
        <div class="sr"><span class="k">Fecha PO</span><span class="v" style="font-size:11px;">{po_fecha}</span></div>
        <div class="sr"><span class="k">Crédito</span><span class="v" style="font-size:11px;">{cli_days} días</span></div>
        <div class="sr"><span class="k">Precio</span><span class="v" style="font-size:11px;">Precio de la orden (OC {_esc(po_codigo)})</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total venta cliente</span><span class="v" style="color:var(--ok);">{_fmt_money(total_cli)}</span></div>
        <div class="sr"><span class="k" style="font-weight:600;">Delta (margen bruto)</span><span class="v" style="color:var(--ok);font-size:15px;">+{_fmt_money(margen)}</span></div>
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Líneas — Compra UF vs Venta</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Producto</th><th>NCM</th><th>Color</th><th class="r">Qty</th><th class="r cb">UF {mwt_days}d</th><th class="r cb">Subt. MWT</th><th class="r rb">Venta OC</th><th class="r rb">Subt. Cliente</th><th class="r">Δ fábrica/par</th></tr></thead>
      <tbody>
        {lines_ceo}
        <tr class="trow"><td colspan="5">TOTAL</td><td class="r">{_fmt_int(total_pares)}</td><td class="r cb"></td><td class="r cb">{_fmt_money(total_mwt)}</td><td class="r rb"></td><td class="r rb">{_fmt_money(total_cli)}</td><td class="r" style="color:var(--ok);">+{_fmt_money(sobreprecio)}</td></tr>
      </tbody>
    </table>
    <div style="padding:8px 12px;font-size:10px;color:var(--t3);">UF = compra MWT (unit_price_mwt congelado, pago {mwt_days}d). Venta OC = unit_price_client congelado de cada línea. El diferencial fiscal (15% DAI+Ley6946) NO se suma al precio del cliente: es ganancia interna de MWT que se captura en aduana declarando el valor UF. Ver arbitraje.</div>
  </div>

  <div class="arb">
    <h3>Arbitraje CEO-ONLY — Modelo B Triangular</h3>
    <div class="arb-grid">
      <div class="arb-card"><div class="p">Sobreprecio de fábrica</div><div class="f">Venta − UF · {_fmt_int(total_pares)} prs</div><div class="r pos">+{_fmt_money(sobreprecio)}</div></div>
      <div class="arb-card"><div class="p">Diferencial de impuestos (interno)</div><div class="f">15% s/ sobreprecio · arbitraje aduanero</div><div class="r pos">+{_fmt_money(diferencial)}</div></div>
      <div class="arb-card"><div class="p">Capital requerido</div><div class="f">UF {mwt_days}d</div><div class="r neu">{_fmt_money(total_mwt)}</div></div>
      <div class="arb-card"><div class="p">Ciclo de caja</div><div class="f">pago {mwt_days}d / cobro {cli_days}d</div><div class="r neu">−{ciclo} días</div></div>
    </div>
    <div class="arb-tot"><span class="tl">Margen bruto MWT (ROI {roi}% · {pct_venta}% s/venta)</span><span class="tv">+{_fmt_money(margen)}</span></div>
  </div>

  <div class="pend-card">
    <strong>⏳ Nacionalización DDP — pendiente flete real.</strong> Este documento fija el margen comercial (sobreprecio de fábrica + diferencial fiscal), que <strong>no depende del flete</strong>. La liquidación aduanera completa al centavo (Valor de Aduana = FOB + flete + seguro; DAI 14%, Ley 6946 1%, IVA 13% acreditable, timbres) se agrega cuando se tenga el <strong>flete exacto, seguro, TC ₡/USD y peso/cajas</strong> del envío. El diferencial fiscal ya trasladado (15% del sobreprecio) es independiente del flete porque el flete es idéntico en ambas declaraciones y se cancela.
  </div>

  <div class="balance-card">
    <strong>Lógica del negocio:</strong> MWT compra a {_esc(brand_name)} al precio UF (bajo, {mwt_days}d), nacionaliza declarando ese valor, y entrega DDP a {_esc(cliente["razon_social"] if cliente else "el cliente")} a {cli_days}d cobrando el precio de la orden (OC {_esc(po_codigo)}). El diferencial de impuestos lo captura internamente en aduana al declarar el valor UF, no lo suma al precio del cliente. Gana el spread de fábrica (+{_fmt_money(sobreprecio)}) + el spread fiscal (+{_fmt_money(diferencial)}) = <strong>{_fmt_money(margen)}</strong>. Contrapartida: MWT financia el ciclo (paga a {mwt_days}d, cobra a {cli_days}d → {ciclo} días de descalce, {_fmt_money(total_mwt)} inmovilizados). <strong>Riesgo:</strong> declarar el precio intercompañía UF y no el de reventa es subvaluación aduanera observable — palanca y riesgo del modelo.
  </div>
  {buttons}
</div>
</div>
"""


def _build_view_fabrica(ctx, *, active=True, with_print_buttons=True):
    """HTML de la vista FÁBRICA (compra MWT al proveedor) — mismo markup
    que la tab Marluvas de la tri-vista, con botones de impresión."""
    expediente  = ctx["expediente"]
    groups      = ctx["groups"]
    mwt         = ctx["mwt"]
    brand_name  = ctx["brand_name"]
    codigo      = ctx["codigo"]
    mwt_days    = ctx["mwt_days"]
    total_pares = ctx["total_pares"]
    total_mwt   = ctx["total_mwt"]

    rows_mlv = []
    for i, g in enumerate(groups, 1):
        rows_mlv.append(
            f'<tr><td>{i}</td><td class="m">{_esc(g["sku"])}</td>'
            f'<td>{_esc(g["label"])}</td>'
            f'<td class="m" style="font-size:10px;">{_esc(g["ncm"] or "—")}</td>'
            f'<td>{_esc((g["color"] or "—").upper())}</td>'
            f'<td class="r">{_fmt_int(g["qty"])}</td>'
            f'<td class="r">{_fmt_money(g["upm"])}</td>'
            f'<td class="r">{_fmt_money(g["sub_mwt"])}</td></tr>'
        )
    rows_mlv = "".join(rows_mlv)
    buttons = _print_buttons("fabrica") if with_print_buttons else ""

    return f"""
<div id="v-fabrica" class="view{' active' if active else ''}">
<div class="dash">
  <div class="head">
    <div>
      <h2>{_esc(brand_name.upper())} · {_esc(codigo)}</h2>
      <div class="meta"><strong>Emisor:</strong> {_esc(mwt["razon_social"])} {("· " + _esc(mwt["tax_id"])) if mwt.get("tax_id") else ""}<br>
        <strong>Comprador:</strong> {_esc(mwt["razon_social"]).upper()}</div>
    </div>
    <span class="badge bg-mlv">VISTA FÁBRICA</span>
  </div>
  <div class="tri">
    <div class="card">
      <div class="card-h info"><h3>Comprador</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Empresa</span><span class="v">{_esc(mwt["razon_social"]).upper()}</span></div>
        <div class="sr"><span class="k">Cédula Jurídica</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(mwt["tax_id"] or "—")}</span></div>
        <div class="sr"><span class="k">Contacto</span><span class="v">{_esc(mwt["contacto_nombre"] or "—")}</span></div>
        <div class="sr"><span class="k">País</span><span class="v">{_esc(mwt["pais"] or "Costa Rica")}</span></div>
        <div class="sr"><span class="k">Email</span><span class="v" style="font-size:10px;">{_esc(mwt["contacto_email"] or "—")}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h info"><h3>Condiciones</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Forma de Pago</span><span class="v">{_esc(_forma_pago_label(expediente.forma_pago))}</span></div>
        <div class="sr"><span class="k">Plazo de pago</span><span class="v">{mwt_days} días</span></div>
        <div class="sr"><span class="k">Moneda</span><span class="v" style="font-size:11px;">Dólares (USD)</span></div>
        <div class="sr"><span class="k">Valor Neto</span><span class="v" style="font-size:9.5px;font-style:italic;">{_esc(_money_words_es(total_mwt))}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h mlv"><h3>Datos proforma</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Proforma</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(codigo)}</span></div>
        <div class="sr"><span class="k">Fecha</span><span class="v" style="font-size:11px;">{_fmt_date_es(ctx["today"])}</span></div>
        <div class="sr"><span class="k">Precios</span><span class="v">FOB</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total</span><span class="v" style="color:var(--navy);">{_fmt_money(total_mwt)}</span></div>
      </div>
    </div>
  </div>
  <div class="sect">
    <div class="sect-h"><h3>Líneas de producto (compra MWT)</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Referencia</th><th>NCM</th><th>Color</th><th class="r">Cantidad</th><th class="r">Precio $</th><th class="r">Total</th></tr></thead>
      <tbody>
        {rows_mlv}
        <tr class="trow"><td colspan="5"><strong>TOTAL</strong></td><td class="r"><strong>{_fmt_int(total_pares)}</strong></td><td></td><td class="r"><strong>{_fmt_money(total_mwt)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes-card"><strong>Observações:</strong> Compra de {_esc(mwt["razon_social"]).upper()} a {_esc(brand_name)}. Preços FOB en USD. Pago a {mwt_days} días desde aviso de embarque.</div>
  {_talla_sections(groups, "Tallas BRA")}
  {buttons}
</div>
</div>
"""


def render_proforma_html_ceo(expediente_id, request_user=None,
                             codigo_override=None):
    """HTML standalone de la vista CEO (triangular MWT). Devuelve
    (html_string, metadata_dict) — mismo contrato que render_proforma_html."""
    ctx = _proforma_context(expediente_id, codigo_override)
    view = _build_view_ceo(ctx, active=True, with_print_buttons=True)
    html_str = _standalone_shell(
        f"Proforma {_esc(ctx['codigo'])} · PO {_esc(ctx['po_codigo'])} · Triangular MWT",
        view,
    )
    metadata = {
        "filename": f"{ctx['codigo']}_MWT_{ctx['cli_slug']}_{ctx['today'].isoformat()}.html",
        "codigo": ctx["codigo"],
        "total_pares": int(ctx["total_pares"]),
        "total_value_usd": str(_q2(ctx["total_mwt"])),
        "oc_id": str(ctx["expediente"].oc_id) if ctx["expediente"].oc_id else None,
    }
    return html_str, metadata


def render_proforma_html_fabrica(expediente_id, request_user=None,
                                 codigo_override=None):
    """HTML standalone de la vista FÁBRICA (compra MWT al proveedor).
    Devuelve (html_string, metadata_dict)."""
    ctx = _proforma_context(expediente_id, codigo_override)
    view = _build_view_fabrica(ctx, active=True, with_print_buttons=True)
    html_str = _standalone_shell(
        f"Proforma Fábrica {_esc(ctx['codigo'])} · {_esc(ctx['brand_name'])}",
        view,
    )
    metadata = {
        "filename": f"{ctx['codigo']}_FABRICA_{ctx['cli_slug']}_{ctx['today'].isoformat()}.html",
        "codigo": ctx["codigo"],
        "total_pares": int(ctx["total_pares"]),
        "total_value_usd": str(_q2(ctx["total_mwt"])),
        "oc_id": str(ctx["expediente"].oc_id) if ctx["expediente"].oc_id else None,
    }
    return html_str, metadata
