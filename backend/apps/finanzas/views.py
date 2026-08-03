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
  commission_amount = base * commission_rate  (NULL si rate NULL)
                     -- decision CEO 2026-07-29: regla DUAL segun operador.
                     --   operado por MWT     -> base = delta_total (reventa)
                     --   operado por cliente -> base = total_client (operacion)
  margen_pct       = delta_unit / unit_price_client  (proteccion div/0)

Visibilidad: TODOS los expedientes activos entran al calculo, sin importar
el operating_company_id (decision CEO 2026-07-29: la consola es de MWT y
debe ver el negocio completo, no solo lo operado directamente por MWT).
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
    """number_proforma > codigo. Estandariza prefijo PF en todos los identificadores."""
    raw = (proforma_codigo or codigo or "").strip()
    if not raw or raw == "—":
        return "—"
    if not raw.upper().startswith("PF"):
        return f"PF {raw}"
    return raw


def _resolve_devengo_estado(
    *,
    commission_rate: Decimal | None,
    shipment_date,
    eta,
    oc_delivery_date=None,
    created_at_date=None,
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
    if total_paid > 0 and balance == 0:
        return ("DEVENGADA", None)

    cd_cli = int(credit_days_cliente or 90)
    cd_mwt = int(credit_days_mwt or 90)

    # Jerarquía de fecha base (real > eta > prometida OC > estimada con días crédito cliente)
    base = shipment_date or eta or oc_delivery_date
    if base is None and created_at_date is not None:
        base = created_at_date + timedelta(days=cd_cli)
    if base is None:
        return ("PROYECTADA", None)

    BUFFER_RECONCILIACION = 10  # dias

    fecha_pago_cliente_a_marluvas = base + timedelta(days=cd_cli)
    fecha_pago_marluvas_a_mwt = fecha_pago_cliente_a_marluvas + timedelta(days=cd_mwt)
    fecha_devengo = fecha_pago_marluvas_a_mwt + timedelta(days=BUFFER_RECONCILIACION)

    if fecha_devengo <= today:
        return ("VENCIDA", fecha_devengo)
    if fecha_pago_cliente_a_marluvas <= today:
        return ("DEVENGABLE", fecha_devengo)
    return ("PROYECTADA", fecha_devengo)


def _next_month_business_window(d: date | None, n_days: int = 10) -> tuple[date | None, date | None, str | None]:
    """Sprint 2026-05-30 (CEO) - dada una fecha base (fecha_facturada),
    calcula el rango de los primeros N dias habiles del mes SIGUIENTE.

    Args:
        d:       fecha base (fecha_facturada = shipment_date + credit_days_cli).
        n_days:  cuantos dias habiles (default 10).

    Returns:
        (inicio, fin, label_mes):
          inicio   -> primer dia del mes siguiente (date)
          fin      -> n-esimo dia habil del mes siguiente (date)
          label    -> "2026-06" (YYYY-MM del mes siguiente)
        Si d es None devuelve (None, None, None).
    """
    if d is None:
        return (None, None, None)
    # Primer dia del mes siguiente
    if d.month == 12:
        inicio = date(d.year + 1, 1, 1)
    else:
        inicio = date(d.year, d.month + 1, 1)
    label = inicio.strftime("%Y-%m")
    # Avanzar n dias habiles (lun=0..vie=4)
    cur = inicio
    habiles = 0
    while habiles < n_days:
        if cur.weekday() < 5:  # lun-vie
            habiles += 1
            if habiles == n_days:
                break
        cur = cur + timedelta(days=1)
    return (inicio, cur, label)


def _fetch_expedientes() -> list[dict]:
    """Lee TODOS los expedientes activos con agregados de lineas.
    Una sola query JOIN — evita N+1. Solo lineas activas.
    Sin filtro por operating_company_id (decision CEO 2026-07-29).
    """
    with connection.cursor() as c:
        c.execute(
            """
            SELECT
                e.id::text                                        AS expediente_id,
                e.codigo                                          AS codigo,
                (
                    SELECT d.codigo
                      FROM expedientes.documento d
                     WHERE d.expediente_id = e.id
                       AND d.kind = 'PROFORMA'
                       AND d.is_active = TRUE
                       AND d.codigo IS NOT NULL
                       AND d.codigo <> ''
                     ORDER BY d.created_at DESC
                     LIMIT 1
                )                                                 AS proforma_codigo,
                e.client_id::text                                 AS client_id,
                e.operating_company_id::text                      AS operating_company_id,
                e.shipment_date                                   AS shipment_date,
                e.eta                                             AS eta,
                MAX(e.created_at)::date                           AS created_at_date,
                MAX(oc.delivery_date)                             AS oc_delivery_date,
                a05.shipment_date_artifact                        AS shipment_date_artifact,
                a05.eta_artifact                                  AS eta_artifact,
                COALESCE(e.credit_days_mwt, e.credit_days, 90)   AS credit_days_mwt,
                COALESCE(e.credit_days_cliente, e.credit_days, cl.dias_credito, 90) AS credit_days_cliente,
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
                COALESCE(cl.dias_credito, 90)                     AS cliente_dias_credito,
                COALESCE(SUM(l.qty * l.unit_price_client), 0)     AS total_client,
                COALESCE(SUM(l.qty * l.unit_price_mwt), 0)        AS total_mwt,
                COALESCE(SUM(l.qty * (l.unit_price_client - l.unit_price_mwt)), 0) AS delta_total,
                COALESCE(SUM(l.qty), 0)                           AS total_qty,
                COUNT(l.id)                                       AS lines_count
            FROM expedientes.expediente e
            LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
            LEFT JOIN expedientes.oc oc ON oc.id = e.oc_id
            LEFT JOIN expedientes.linea l ON l.expediente_id = e.id AND l.is_active = TRUE
            LEFT JOIN LATERAL (
                SELECT
                    NULLIF(bai.data->>'field-1780150662711', '')::date AS shipment_date_artifact,
                    NULLIF(bai.data->>'field-1780150673285', '')::date AS eta_artifact
                FROM nodos.builder_artifact_instance bai
                JOIN nodos.builder_artifact_line bal
                  ON bal.builder_artifact_instance_id = bai.id
                 AND bal.is_active = TRUE
                WHERE bai.template_id = 9
                  AND bai.is_active   = TRUE
                  AND bal.expediente_id = e.id
                ORDER BY bai.updated_at DESC NULLS LAST, bai.created_at DESC
                LIMIT 1
            ) a05 ON TRUE
            WHERE e.is_active = TRUE
            GROUP BY e.id, cl.id, cl.razon_social, cl.segmento, cl.dias_credito, cl.comision_pct,
                     a05.shipment_date_artifact, a05.eta_artifact
            ORDER BY e.created_at DESC
            """
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
        base = (delta_total
                if row["operating_company_id"] == MWT_OPERATING_CLIENT_ID
                else total_client)
        commission_amount = (base * _dec(commission_rate)).quantize(Decimal("0.01"))
    else:
        commission_amount = None

    margen_pct = None
    if total_client > 0:
        margen_pct = (delta_total / total_client).quantize(Decimal("0.0001"))

    cd_cli = int(row["credit_days_cliente"] or row.get("cliente_dias_credito") or 90)
    cd_mwt = int(row["credit_days_mwt"] or 90)

    estado, fecha_devengo = _resolve_devengo_estado(
        commission_rate=_dec(commission_rate) if commission_rate is not None else None,
        shipment_date=(row.get("shipment_date_artifact") or row["shipment_date"]),
        eta=(row.get("eta_artifact") or row["eta"]),
        oc_delivery_date=row.get("oc_delivery_date"),
        created_at_date=row.get("created_at_date"),
        credit_days_cliente=cd_cli,
        credit_days_mwt=cd_mwt,
        balance=_dec(row["balance"]),
        total_paid=_dec(row["total_paid"]),
        today=today,
    )

    base = (row.get("shipment_date_artifact")
            or row["shipment_date"]
            or row.get("eta_artifact")
            or row["eta"]
            or row.get("oc_delivery_date"))
    if base is None and row.get("created_at_date"):
        base = row["created_at_date"] + timedelta(days=cd_cli)

    fecha_facturada = None
    if base is not None:
        fecha_facturada = base + timedelta(days=cd_cli)
    fpa_inicio, fpa_fin, mes_pago_label = _next_month_business_window(
        fecha_facturada, n_days=10
    )

    return {
        "expediente_id":         row["expediente_id"],
        "display_id":            _resolve_display_id(row["codigo"], row["proforma_codigo"]),
        "codigo":                row["codigo"],
        "proforma_codigo":       row["proforma_codigo"],
        "client_id":             row["client_id"],
        "cliente_razon_social":  row["cliente_razon_social"] or "—",
        "cliente_segmento":      row["cliente_segmento"] or None,
        "dias_credito_cliente":  cd_cli,
        "commission_rate":       (str(commission_rate) if commission_rate is not None else None),
        "commission_rate_source": row["commission_rate_source"],
        "total_client":          str(total_client.quantize(Decimal("0.01"))),
        "total_mwt":             str(total_mwt.quantize(Decimal("0.01"))),
        "delta_total":           str(delta_total.quantize(Decimal("0.01"))),
        "commission_amount":     (str(commission_amount) if commission_amount is not None else None),
        "margen_pct":            (str(margen_pct) if margen_pct is not None else None),
        "forma_pago":            row["forma_pago"],
        "credit_days_mwt":       cd_mwt,
        "credit_days_cliente":   cd_cli,
        "shipment_date":         (row.get("shipment_date_artifact") or row["shipment_date"]).isoformat()
                                  if (row.get("shipment_date_artifact") or row["shipment_date"]) else None,
        "eta":                   (row.get("eta_artifact") or row["eta"]).isoformat()
                                  if (row.get("eta_artifact") or row["eta"]) else None,
        "shipment_date_source":  ("artifact_ART05" if row.get("shipment_date_artifact")
                                  else ("expediente" if row["shipment_date"] else None)),
        "fecha_devengo_esperada": fecha_devengo.isoformat() if fecha_devengo else None,
        "devengo_estado":        estado,
        "lines_count":           row["lines_count"],
        "total_qty":             str(_dec(row["total_qty"])),
        "fecha_facturada":           fecha_facturada.isoformat() if fecha_facturada else None,
        "mes_pago_aproximado":       mes_pago_label,
        "fecha_pago_aprox_inicio":   fpa_inicio.isoformat() if fpa_inicio else None,
        "fecha_pago_aprox_fin":      fpa_fin.isoformat() if fpa_fin else None,
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
    rows = _fetch_expedientes()
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
    """Lista paginada simple de expedientes con calculos.

    Query params soportados: ?client_id=...&estado_devengo=...
    """
    today = date.today()
    rows = _fetch_expedientes()
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
def commission_by_month(request):
    """Sprint 2026-05-30 (CEO) - Agrupa comision_amount por
    mes_pago_aproximado (primer dia mes siguiente a fecha_facturada).

    Response: {
        "results": [
            {"month": "2026-06", "month_label": "Jun 2026",
             "commission_usd": "1234.56", "expedientes_count": 3,
             "delta_total_usd": "10234.50"},
            ...
        ],
        "today": "2026-05-30"
    }

    Util para BarChart "Comision esperada por mes" en /finanzas.
    """
    today = date.today()
    rows = _fetch_expedientes()
    items = [_build_item(r, today) for r in rows]
    agg: dict[str, dict] = {}
    for it in items:
        m = it.get("mes_pago_aproximado")
        if not m:
            continue
        amt = it.get("commission_amount")
        if amt is None:
            continue
        bucket = agg.setdefault(m, {
            "month": m,
            "commission_usd": Decimal("0"),
            "delta_total_usd": Decimal("0"),
            "expedientes_count": 0,
        })
        bucket["commission_usd"] += _dec(amt)
        bucket["delta_total_usd"] += _dec(it.get("delta_total"))
        bucket["expedientes_count"] += 1
    # Ordenar cronologicamente
    sorted_months = sorted(agg.keys())
    # Label legible (Jun 2026)
    MESES_ES = ["", "Ene","Feb","Mar","Abr","May","Jun",
                "Jul","Ago","Sep","Oct","Nov","Dic"]
    results = []
    for m in sorted_months:
        bucket = agg[m]
        try:
            y, mo = m.split("-")
            label = f"{MESES_ES[int(mo)]} {y}"
        except (ValueError, IndexError):
            label = m
        results.append({
            "month":             m,
            "month_label":       label,
            "commission_usd":    str(bucket["commission_usd"].quantize(Decimal("0.01"))),
            "delta_total_usd":   str(bucket["delta_total_usd"].quantize(Decimal("0.01"))),
            "expedientes_count": bucket["expedientes_count"],
        })
    return Response({"results": results, "today": today.isoformat()})


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def margin_scatter(request):
    """Sprint 2026-05-30 (CEO) - datos para scatter Margen proyectado vs real.

    Response: {
        "points": [
            {"id": "<expediente_id>", "label": "EXP-2026-0001 · Sondel",
             "projected": 0.21, "real": 0.21, "value": 2591.45},
            ...
        ],
        "today": "2026-05-30"
    }

    En MVP, margen proyectado = margen real = margen_pct del expediente
    (las lineas no tienen drift aun). Cuando exista mv_linea_finanzas
    con costo real vs proyectado por linea, este endpoint se enrique
    con la diferencia projected vs real.
    """
    today = date.today()
    rows = _fetch_expedientes()
    items = [_build_item(r, today) for r in rows]
    points = []
    for it in items:
        mp = it.get("margen_pct")
        if mp is None:
            continue
        m = float(mp)
        # MVP: projected == real. Cuando haya drift de margen, separar.
        delta = float(_dec(it.get("delta_total")))
        cliente = it.get("cliente_razon_social") or "—"
        display = it.get("display_id") or it.get("codigo") or "—"
        points.append({
            "id":        it["expediente_id"],
            "label":     f"{display} · {cliente}",
            "projected": m,
            "real":      m,
            "value":     delta,
        })
    return Response({"points": points, "today": today.isoformat()})


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def cliente_profile(request, client_id):
    """Perfil financiero de un cliente — comision agregada + sus expedientes."""
    today = date.today()
    rows = _fetch_expedientes()
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
