"""
apps.finanzas · views (read-only API CEO-only)
Sprint 2026-05-24 · Decision CEO (Alejandro)
Agente responsable: [AG-BACKEND]

Endpoints:
  GET /api/finanzas/overview/                  -> KPIs hero
  GET /api/finanzas/comisiones/                -> lista de expedientes con calculo
  GET /api/finanzas/comisiones/<expediente_id>/ -> breakdown linea por linea
  GET /api/finanzas/cliente/<client_id>/       -> perfil financiero cliente

Calculo "al vuelo" (sin MV) — para MVP. Cuando crezca el volumen, mover a
mv_linea_finanzas refrescada por Celery. Deuda diferida documentada en
docs/finanzas/SPEC_FINANZAS_MODULE_v1.md.

Reglas (autoritativas):
  commission_rate  = COALESCE(expediente.commission_pct, cliente.comision_pct)
                     -- decimal 0..1 (ej 0.12 = 12%)
  delta_unit       = unit_price_client - unit_price_mwt
  delta_total      = sum(qty * delta_unit)
  commission_amount = delta_total * commission_rate  (NULL si rate NULL)
  margen_pct       = delta_unit / unit_price_client  (proteccion div/0)

Visibilidad: solo expedientes con operating_company_id = MWT_OPERATING_CLIENT_ID
entran al calculo de comisiones (otros se omiten o van a tabla "sin comision").
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.core.constants import MWT_OPERATING_CLIENT_ID

from .permissions import IsCeoOrAdmin


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _dec(v) -> Decimal:
    """Normaliza a Decimal sin lanzar (None/'' -> 0)."""
    if v is None or v == "":
        return Decimal("0")
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _resolve_display_id(codigo: str | None, proforma_codigo: str | None) -> str:
    """number_proforma > codigo. Nunca exponer UUID."""
    if proforma_codigo and str(proforma_codigo).strip():
        return str(proforma_codigo).strip()
    return str(codigo or "—")


def _resolve_devengo_estado(
    *,
    commission_rate: Decimal | None,
    shipment_date,
    eta,
    credit_days_cliente: int | None,
    credit_days_mwt: int | None,
    balance: Decimal,
    total_paid: Decimal,
    today: date,
) -> tuple[str, date | None]:
    """Estado de devengo segun §3.3 del SPEC.

    Returns:
        (estado, fecha_devengo_esperada)
    """
    if commission_rate is None:
        return ("SIN_TASA", None)

    # Si el expediente ya esta pagado completamente, asumimos DEVENGADA.
    # (Cuando exista PaymentLine.commission_settled_at, refinar.)
    if total_paid > 0 and balance == 0:
        return ("DEVENGADA", None)

    base = shipment_date or eta
    if base is None:
        return ("PROYECTADA", None)

    cd_cli = int(credit_days_cliente or 0)
    cd_mwt = int(credit_days_mwt or 0)
    BUFFER_RECONCILIACION = 10  # dias, constante (deuda diferida: hacer setting)

    fecha_pago_cliente_a_marluvas = base + timedelta(days=cd_cli)
    fecha_pago_marluvas_a_mwt = fecha_pago_cliente_a_marluvas + timedelta(days=cd_mwt)
    fecha_devengo = fecha_pago_marluvas_a_mwt + timedelta(days=BUFFER_RECONCILIACION)

    if fecha_devengo <= today:
        return ("VENCIDA", fecha_devengo)
    if fecha_pago_cliente_a_marluvas <= today:
        return ("DEVENGABLE", fecha_devengo)
    return ("PROYECTADA", fecha_devengo)


def _fetch_expedientes_mwt() -> list[dict]:
    """Lee expedientes operados por MWT con agregados de lineas.
    Una sola query JOIN — evita N+1. Solo lineas activas.
    """
    with connection.cursor() as c:
        c.execute(
            """
            SELECT
                e.id::text                                        AS expediente_id,
                e.codigo                                          AS codigo,
                e.proforma_codigo                                 AS proforma_codigo,
                e.client_id::text                                 AS client_id,
                e.operating_company_id::text                      AS operating_company_id,
                e.shipment_date                                   AS shipment_date,
                e.eta                                             AS eta,
                e.credit_days                                     AS credit_days,
                e.credit_days_mwt                                 AS credit_days_mwt,
                e.credit_days_cliente                             AS credit_days_cliente,
                e.forma_pago                                      AS forma_pago,
                COALESCE(e.balance, 0)                            AS balance,
                COALESCE(e.total_paid, 0)                         AS total_paid,
                COALESCE(e.commission_pct, cl.comision_pct)       AS commission_rate,
                CASE
                    WHEN e.commission_pct IS NOT NULL THEN 'expediente.commission_pct'
                    WHEN cl.comision_pct  IS NOT NULL THEN 'cliente.comision_pct'
                    ELSE NULL
                END                                               AS commission_rate_source,
                cl.razon_social                                   AS cliente_razon_social,
                cl.segmento                                       AS cliente_segmento,
                cl.dias_credito                                   AS cliente_dias_credito,
                COALESCE(SUM(l.qty * l.unit_price_client), 0)     AS total_client,
                COALESCE(SUM(l.qty * l.unit_price_mwt), 0)        AS total_mwt,
                COALESCE(SUM(l.qty * (l.unit_price_client - l.unit_price_mwt)), 0) AS delta_total,
                COALESCE(SUM(l.qty), 0)                           AS total_qty,
                COUNT(l.id)                                       AS lines_count
            FROM expedientes.expediente e
            LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
            LEFT JOIN expedientes.linea l ON l.expediente_id = e.id AND l.is_active = TRUE
            WHERE e.is_active = TRUE
              AND e.operating_company_id = %s
            GROUP BY e.id, cl.id, cl.razon_social, cl.segmento, cl.dias_credito, cl.comision_pct
            ORDER BY e.created_at DESC
            """,
            [str(MWT_OPERATING_CLIENT_ID)],
        )
        cols = [c0[0] for c0 in c.description]
        return [dict(zip(cols, row)) for row in c.fetchall()]


def _build_item(row: dict, today: date) -> dict:
    """Transforma una fila del cursor en el item de la API."""
    commission_rate = row["commission_rate"]
    delta_total = _dec(row["delta_total"])
    total_client = _dec(row["total_client"])
    total_mwt = _dec(row["total_mwt"])

    if commission_rate is not None:
        commission_amount = (delta_total * _dec(commission_rate)).quantize(Decimal("0.01"))
    else:
        commission_amount = None

    margen_pct = None
    if total_client > 0:
        # Margen ponderado del expediente (delta / total_client).
        margen_pct = (delta_total / total_client).quantize(Decimal("0.0001"))

    estado, fecha_devengo = _resolve_devengo_estado(
        commission_rate=_dec(commission_rate) if commission_rate is not None else None,
        shipment_date=row["shipment_date"],
        eta=row["eta"],
        credit_days_cliente=row["credit_days_cliente"],
        credit_days_mwt=row["credit_days_mwt"],
        balance=_dec(row["balance"]),
        total_paid=_dec(row["total_paid"]),
        today=today,
    )

    return {
        "expediente_id":         row["expediente_id"],
        "display_id":            _resolve_display_id(row["codigo"], row["proforma_codigo"]),
        "codigo":                row["codigo"],
        "proforma_codigo":       row["proforma_codigo"],
        "client_id":             row["client_id"],
        "cliente_razon_social":  row["cliente_razon_social"] or "—",
        "cliente_segmento":      row["cliente_segmento"] or None,
        "dias_credito_cliente":  row["cliente_dias_credito"],
        "commission_rate":       (str(commission_rate) if commission_rate is not None else None),
        "commission_rate_source": row["commission_rate_source"],
        "total_client":          str(total_client.quantize(Decimal("0.01"))),
        "total_mwt":             str(total_mwt.quantize(Decimal("0.01"))),
        "delta_total":           str(delta_total.quantize(Decimal("0.01"))),
        "commission_amount":     (str(commission_amount) if commission_amount is not None else None),
        "margen_pct":            (str(margen_pct) if margen_pct is not None else None),
        "forma_pago":            row["forma_pago"],
        "credit_days_mwt":       row["credit_days_mwt"],
        "credit_days_cliente":   row["credit_days_cliente"],
        "shipment_date":         row["shipment_date"].isoformat() if row["shipment_date"] else None,
        "eta":                   row["eta"].isoformat() if row["eta"] else None,
        "fecha_devengo_esperada": fecha_devengo.isoformat() if fecha_devengo else None,
        "devengo_estado":        estado,
        "lines_count":           row["lines_count"],
        "total_qty":             str(_dec(row["total_qty"])),
    }


# ---------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def overview(request):
    """KPIs hero + lista resumida.

    Response:
      {
        "kpis": {
          "comision_total_devengable": "1234.56",
          "comision_devengada": "123.45",
          "comision_pendiente": "1111.11",
          "comision_proyectada": "...",
          "margen_total_usd": "...",
          "margen_pct_ponderado": "0.1234",
          "expedientes_count": 17,
          "expedientes_sin_tasa_count": 2
        },
        "items": [<top-20 items>]
      }
    """
    today = date.today()
    rows = _fetch_expedientes_mwt()
    items = [_build_item(r, today) for r in rows]

    tot_devengable = Decimal("0")
    tot_devengada = Decimal("0")
    tot_pendiente = Decimal("0")
    tot_proyectada = Decimal("0")
    tot_margen = Decimal("0")
    sum_client_for_pct = Decimal("0")
    sum_delta_for_pct = Decimal("0")
    sin_tasa = 0

    for it in items:
        amt_str = it["commission_amount"]
        if amt_str is None:
            sin_tasa += 1
            continue
        amt = _dec(amt_str)
        estado = it["devengo_estado"]
        tot_devengable += amt
        if estado == "DEVENGADA":
            tot_devengada += amt
        elif estado in ("DEVENGABLE", "VENCIDA"):
            tot_pendiente += amt
        elif estado == "PROYECTADA":
            tot_proyectada += amt

        tot_margen += _dec(it["delta_total"])
        sum_client_for_pct += _dec(it["total_client"])
        sum_delta_for_pct += _dec(it["delta_total"])

    margen_pct_pond = None
    if sum_client_for_pct > 0:
        margen_pct_pond = (sum_delta_for_pct / sum_client_for_pct).quantize(Decimal("0.0001"))

    return Response({
        "kpis": {
            "comision_total_devengable": str(tot_devengable.quantize(Decimal("0.01"))),
            "comision_devengada":        str(tot_devengada.quantize(Decimal("0.01"))),
            "comision_pendiente":        str(tot_pendiente.quantize(Decimal("0.01"))),
            "comision_proyectada":       str(tot_proyectada.quantize(Decimal("0.01"))),
            "margen_total_usd":          str(tot_margen.quantize(Decimal("0.01"))),
            "margen_pct_ponderado":      (str(margen_pct_pond) if margen_pct_pond is not None else None),
            "expedientes_count":         len(items),
            "expedientes_sin_tasa_count": sin_tasa,
        },
        "items": items[:20],
        "today": today.isoformat(),
    })


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def comisiones_list(request):
    """Lista paginada simple de expedientes MWT con calculos.

    Query params soportados: ?client_id=...&estado_devengo=...
    """
    today = date.today()
    rows = _fetch_expedientes_mwt()
    items = [_build_item(r, today) for r in rows]

    # Filtros simples
    client_id = (request.query_params.get("client_id") or "").strip()
    estado = (request.query_params.get("estado_devengo") or "").strip().upper()
    if client_id:
        items = [it for it in items if it["client_id"] == client_id]
    if estado:
        items = [it for it in items if it["devengo_estado"] == estado]

    return Response({
        "count": len(items),
        "results": items,
    })


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def cliente_profile(request, client_id):
    """Perfil financiero de un cliente — comision agregada + sus expedientes."""
    today = date.today()
    rows = _fetch_expedientes_mwt()
    mine = [r for r in rows if str(r["client_id"]) == str(client_id)]
    items = [_build_item(r, today) for r in mine]

    tot_comision = Decimal("0")
    tot_delta = Decimal("0")
    tot_client = Decimal("0")
    tot_mwt = Decimal("0")
    for it in items:
        if it["commission_amount"] is not None:
            tot_comision += _dec(it["commission_amount"])
        tot_delta += _dec(it["delta_total"])
        tot_client += _dec(it["total_client"])
        tot_mwt += _dec(it["total_mwt"])

    # Datos basicos del cliente (separately — perfil no duplica /api/clientes/)
    cliente_summary = None
    if items:
        cliente_summary = {
            "id": items[0]["client_id"],
            "razon_social": items[0]["cliente_razon_social"],
            "segmento": items[0]["cliente_segmento"],
            "dias_credito": items[0]["dias_credito_cliente"],
        }

    return Response({
        "client_id": str(client_id),
        "cliente_summary": cliente_summary,
        "agregados": {
            "comision_acumulada":     str(tot_comision.quantize(Decimal("0.01"))),
            "delta_total":            str(tot_delta.quantize(Decimal("0.01"))),
            "total_client":           str(tot_client.quantize(Decimal("0.01"))),
            "total_mwt":              str(tot_mwt.quantize(Decimal("0.01"))),
            "expedientes_count":      len(items),
        },
        "expedientes": items,
        "today": today.isoformat(),
    })
