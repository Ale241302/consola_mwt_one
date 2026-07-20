"""
=====================================================================
MWT.ONE · apps.expedientes.proforma_renderer_marluvas
Sprint: 2026-05-24 · Decision CEO (Alejandro)
Agente responsable: [AG-BACKEND]

Renderea el HTML de la proforma "vista interna MWT" (tab MARLUVAS del
template del CEO). Esta vista NO se le muestra al cliente final — es
la perspectiva de Muito Work Limitada COMO COMPRADOR (lo que MWT le
paga al proveedor: precio unit_price_mwt, plazo MWT, etc.).

Audience: MWT_INTERNAL (no visible a CLIENT_*).

A diferencia de render_proforma_html (vista SONDEL / cliente final):
  · Usa unit_price_mwt en lugar de unit_price_client (precios mas bajos)
  · Header: emisor + comprador = Muito Work Limitada
  · Badge "VISTA MARLUVAS" (interna)
  · Sin bloque de pronto-pago (no aplica desde la perspectiva compra)
  · Notas: "Proforma interna · cuenta a MWT"

Reutiliza estilos / helpers del proforma_renderer.py original para
mantener un look-and-feel consistente.

POL_VISIBILIDAD (R3): este archivo NUNCA debe ser servido a roles
CLIENT_*. La filtracion vive en views_proforma.py al persistir el
Documento con audience='MWT_INTERNAL'.
=====================================================================
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from django.db import connection
from django.utils import timezone

from .models import Expediente, Linea, Oc
from .proforma_renderer import (
    MWT_OPERATING_CLIENT_ID,
    PRONTO_PAGO_TIERS,
    _build_pronto_pago_html,
    _esc,
    _esc_email,
    _fmt_date_es,
    _fmt_int,
    _fmt_money,
    _fetch_cliente,
    _fetch_producto_map,
    _forma_pago_label,
    _next_proforma_codigo,
    _plazo_label,
)


# ---------------------------------------------------------------------
# Helpers especificos Marluvas
# ---------------------------------------------------------------------
def _fetch_mwt_company_data() -> dict:
    """Lee los datos comerciales de Muito Work Limitada desde
    clientes.cliente (ID conocido = MWT_OPERATING_CLIENT_ID).

    Si por alguna razon el registro no existe, devuelve un dict con
    valores hardcoded coherentes con la realidad operativa de MWT.
    """
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT razon_social, tax_id, contacto_nombre,
                       contacto_email, contacto_tel, pais_iso2, ciudad
                  FROM clientes.cliente
                 WHERE id = %s
                """,
                [str(MWT_OPERATING_CLIENT_ID)],
            )
            row = c.fetchone()
    except Exception:
        row = None

    if not row:
        # Hardcoded fallback (mismos datos del template del CEO).
        return {
            "razon_social":    "Muito Work Limitada",
            "tax_id":          "3-102-751710",
            "contacto_nombre": "Alvaro Alfaro M.",
            "contacto_email":  "alvaro@muitowork.com",
            "contacto_tel":    "+506 6043-1300",
            "pais":            "Costa Rica",
            "ciudad":          "San Jose",
        }

    razon, tax_id, ctc_n, ctc_e, ctc_t, pais_iso, ciudad = row
    return {
        "razon_social":    razon or "Muito Work Limitada",
        "tax_id":          tax_id or "3-102-751710",
        "contacto_nombre": ctc_n or "Alvaro Alfaro M.",
        "contacto_email":  ctc_e or "alvaro@muitowork.com",
        "contacto_tel":    ctc_t or "+506 6043-1300",
        "pais":            pais_iso or "CR",
        "ciudad":          ciudad or "San Jose",
    }


def _resolve_unit_price_mwt(linea) -> Decimal:
    """unit_price_mwt si > 0, sino fallback al unit_price legacy."""
    upm = Decimal(linea.unit_price_mwt or 0)
    if upm > 0:
        return upm
    return Decimal(linea.unit_price or 0)


def _fetch_brand_name(brand_id) -> str:
    """Devuelve el nombre de la marca del expediente (para el header).
    Si no hay brand_id o no se encuentra, devuelve cadena vacia.
    """
    if not brand_id:
        return ""
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT nombre FROM brands.marca WHERE id = %s",
                [str(brand_id)],
            )
            row = c.fetchone()
        return (row[0] if row else "") or ""
    except Exception:
        return ""


def _build_lineas_html_mwt(lineas, prod_map):
    """Tabla de lineas con precios MWT (unit_price_mwt).
    Estructura identica a _build_lineas_html del renderer original,
    pero usa _resolve_unit_price_mwt.
    """
    rows = []
    total_qty = Decimal(0)
    total_value = Decimal(0)
    for idx, l in enumerate(lineas, start=1):
        prod = prod_map.get(str(l.producto_id or ""), {})
        nombre = prod.get("nombre") or l.sku or "—"
        color = prod.get("color") or "—"
        qty = Decimal(l.qty or 0)
        unit = _resolve_unit_price_mwt(l)
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


# ---------------------------------------------------------------------
# Funcion publica
# ---------------------------------------------------------------------
def render_proforma_html_marluvas(expediente_id, request_user=None,
                                   codigo_override=None,
                                   payment_days_override=None):
    """Renderea el HTML de la proforma vista MWT-INTERNA (tab MARLUVAS).

    Args:
        expediente_id: UUID del expediente.
        request_user: opcional, quien genera.
        codigo_override: si viene, usa ese codigo en lugar del secuencial.
        payment_days_override: si viene, usa ese plazo en lugar de
            expediente.credit_days_mwt o credit_days legacy.

    Returns:
        (html_string, metadata_dict)
    """
    expediente = Expediente.objects.get(id=expediente_id, is_active=True)
    if not expediente.client_id:
        raise ValueError("expediente_sin_cliente")

    # Datos del cliente FINAL (Sondel) — los necesitamos para algunos
    # campos del header como referencia interna, pero no se exponen como
    # "cliente" en esta vista MWT.
    cliente_final = _fetch_cliente(expediente.client_id)

    # OC asociada (puede no existir)
    oc = None
    if expediente.oc_id:
        oc = Oc.objects.filter(id=expediente.oc_id, is_active=True).first()

    # Lineas activas
    lineas = list(
        Linea.objects
        .filter(expediente_id=expediente.id, is_active=True)
        .order_by("size", "sku", "created_at")
    )
    if not lineas:
        raise ValueError("expediente_sin_lineas_activas")

    producto_ids = list({l.producto_id for l in lineas if l.producto_id})
    prod_map = _fetch_producto_map(producto_ids)

    # Numero de proforma
    today = timezone.now().date()
    if codigo_override and str(codigo_override).strip():
        codigo = str(codigo_override).strip()
    else:
        codigo = _next_proforma_codigo(today.year)

    # Datos de la compania MWT (emisor + comprador desde su propia perspectiva)
    mwt = _fetch_mwt_company_data()

    # Marca (para el titulo "MARLUVAS · PF-XXXX")
    brand_name = _fetch_brand_name(getattr(expediente, "brand_id", None))
    brand_label = brand_name.upper() if brand_name else "PROFORMA INTERNA"

    # Plazo MWT: prioridad override > credit_days_mwt > credit_days legacy
    if payment_days_override is not None and str(payment_days_override).strip():
        try:
            plazo_dias = int(payment_days_override)
        except (TypeError, ValueError):
            plazo_dias = int(getattr(expediente, "credit_days_mwt", None) or
                             expediente.credit_days or 0)
    else:
        plazo_dias = int(getattr(expediente, "credit_days_mwt", None) or
                         expediente.credit_days or 0)

    # PO Cliente (para referencia)
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

    # Lineas + totales (con precios MWT)
    rows_html, total_pares, total_value = _build_lineas_html_mwt(lineas, prod_map)

    # Precio promedio MWT
    if total_pares > 0:
        price_avg = (total_value / Decimal(total_pares)).quantize(Decimal("0.01"))
    else:
        price_avg = Decimal("0.00")

    # Forma de pago: la operacion MWT compra al proveedor SUELE ser contado,
    # pero respetamos lo que diga forma_pago si esta seteado.
    forma_pago_lbl = _forma_pago_label(expediente.forma_pago) or "Contado"
    plazo_lbl = _plazo_label(expediente.forma_pago, plazo_dias) if plazo_dias > 0 else "0 días"

    # Sprint 2026-05-24 · bloque pronto-pago (reutiliza helper de SONDEL).
    # Pasa plazo_dias (credit_days_mwt) como credit_days para que el helper
    # detecte el tier activo y normalice price_avg a la base 90d antes de
    # aplicar los descuentos. Coherente con vista CLIENT.
    pronto_pago_html_mwt = _build_pronto_pago_html(
        price_avg, total_pares, int(plazo_dias or 0),
    )

    # Filename amigable
    cli_slug = (cliente_final.get("razon_social") if cliente_final else "mwt") or "mwt"
    cli_slug = "".join(ch if ch.isalnum() else "-" for ch in cli_slug).strip("-").lower() or "mwt"
    filename = f"{codigo}_MWT_{cli_slug}_{today.isoformat()}.html"

    title_safe = _esc(f"Proforma MWT-INTERNA {codigo}")
    pais_label = ", ".join([x for x in (mwt["ciudad"], mwt["pais"]) if x]) or "Costa Rica"

    html_str = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_safe}</title>
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
.bg-mlv{{background:rgba(1,58,87,.08);color:var(--navy);}}
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

<div class="dash">

  <div class="head">
    <div>
      <h2>{_esc(brand_label)} &middot; {_esc(codigo)}</h2>
      <div class="meta"><strong>Emisor:</strong> {_esc(mwt['razon_social'])} {_esc(mwt['tax_id'])} &middot; {_esc(pais_label)}<br>
        <strong>Comprador:</strong> {_esc(mwt['razon_social'])} &middot; <strong>Ref expediente:</strong> {_esc(expediente.codigo or '—')}</div>
    </div>
    <span class="badge bg-mlv">VISTA MARLUVAS &middot; INTERNAL</span>
  </div>

  <div class="tri">
    <div class="card">
      <div class="card-h info"><h3>Comprador</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Empresa</span><span class="v">{_esc(mwt['razon_social'])}</span></div>
        <div class="sr"><span class="k">Cédula Jurídica</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(mwt['tax_id'])}</span></div>
        <div class="sr"><span class="k">Contacto</span><span class="v">{_esc(mwt['contacto_nombre'])}</span></div>
        <div class="sr"><span class="k">País</span><span class="v">{_esc(mwt['pais'])}</span></div>
        <div class="sr"><span class="k">Teléfono</span><span class="v" style="font-size:11px;">{_esc(mwt['contacto_tel'])}</span></div>
        <div class="sr"><span class="k">Email</span><span class="v" style="font-size:10px;" data-cfemail="">{_esc_email(mwt['contacto_email'])}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h info"><h3>Condiciones</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Forma de Pago</span><span class="v">{_esc(forma_pago_lbl)}</span></div>
        <div class="sr"><span class="k">Plazo de pago</span><span class="v">{_esc(plazo_lbl)}</span></div>
        <div class="sr"><span class="k">Moneda</span><span class="v" style="font-size:11px;">Dólares estadounidenses (USD)</span></div>
        <div class="sr"><span class="k">Precios</span><span class="v">FOB</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr big"><span class="k" style="font-weight:700;">Total compra</span><span class="v" style="color:var(--navy);">{_fmt_money(total_value)}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h mlv"><h3>Datos proforma</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">Proforma</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(codigo)}</span></div>
        <div class="sr"><span class="k">PO Referencia</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">{_esc(po_codigo)}</span></div>
        <div class="sr"><span class="k">Fecha PO</span><span class="v" style="font-size:11px;">{_esc(po_fecha)}</span></div>
        <div class="sr"><span class="k">Fecha Proforma</span><span class="v" style="font-size:11px;">{_esc(_fmt_date_es(today))}</span></div>
        <div class="sr"><span class="k">Total pares</span><span class="v">{_fmt_int(total_pares)}</span></div>
        <div class="sr"><span class="k">Precio por par</span><span class="v">{_fmt_money(price_avg)}</span></div>
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Propuesta &mdash; Descuento por Pronto Pago (MWT)</h3></div>
    <div style="padding:18px;">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px;">
        {pronto_pago_html_mwt}
      </div>
      <div style="padding:10px 14px;background:var(--mint-s);border:1px solid var(--mint);border-radius:8px;font-size:11px;color:var(--t1);line-height:1.6;">
        <strong style="color:var(--navy);">Pronto pago (MWT &rarr; proveedor):</strong> el descuento se aplica sobre el costo MWT al confirmar el plazo. El plazo actual del expediente es {_esc(str(plazo_dias))} dias.
      </div>
    </div>
  </div>

  <div class="sect">
    <div class="sect-h"><h3>Líneas de producto (precios MWT)</h3></div>
    <table class="ct">
      <thead><tr><th>#</th><th>Código</th><th>Referencia</th><th>Color</th><th class="r">Talla</th><th class="r">Cantidad</th><th class="r">Precio $</th><th class="r">Total</th></tr></thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>

  <div class="notes-card">
    <strong>Observaciones (interna · MWT):</strong> Proforma interna desde la perspectiva de Muito Work Limitada como comprador. Los precios reflejan <strong>unit_price_mwt</strong> congelado de cada linea — el costo que MWT paga al proveedor (Marluvas). NO ES visible al cliente final.<br>
    <strong>Ref expediente:</strong> {_esc(expediente.codigo or '—')} &middot; <strong>PO Cliente:</strong> {_esc(po_codigo)} &middot; <strong>Generada:</strong> {_esc(_fmt_date_es(today))}<br>
    <strong>Precios:</strong> FOB &middot; <strong>Moneda:</strong> USD &middot; <strong>Partida arancelaria:</strong> 6403.99.90
  </div>

  <div class="actions" data-no-print>
    <button class="btn btn-p" onclick="window.print()">Imprimir</button>
    <button class="btn btn-o" onclick="window.close()">Cerrar</button>
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
        "audience":        "MWT_INTERNAL",
    }

    return html_str, metadata

# FIN proforma_renderer_marluvas.py
