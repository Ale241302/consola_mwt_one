"""
apps.finanzas Â· views (read-only API CEO-only)
Sprint 2026-05-24 Â· Decision CEO (Alejandro)
Agente responsable: [AG-BACKEND]

Endpoints:
  GET /api/finanzas/overview/                  -> KPIs hero
  GET /api/finanzas/comisiones/                -> lista de expedientes con calculo
  GET /api/finanzas/comisiones/<expediente_id>/ -> breakdown linea por linea
  GET /api/finanzas/cliente/<client_id>/       -> perfil financiero cliente

Calculo "al vuelo" (sin MV) â€” para MVP. Cuando crezca el volumen, mover a
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
    if not raw or raw == "â€”":
        return "â€”"
    if not raw.upper().startswith("PF"):
        return f"PF {raw}"
    return raw


def _resolve_devengo_estado(
    *,
    commission_rate: Decimal | None,
    shipment_date,
    eta,
    created_at_date=None,
    credit_days_cliente: int | None,
    credit_days_mwt: int | None,
    balance: Decimal,
    total_paid: Decimal,
    today: date,
) -> tuple[str, date | None]:
    """Estado de devengo segun Â§3.3 del SPEC.

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

    # JerarquÃ­a de fecha base (real > eta > estimada con dÃ­as crÃ©dito cliente)
    base = shipment_date or eta
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


def _ventana_10_20(base: date | None) -> tuple[date | None, date | None, str | None]:
    """Etapa 5 · ventana de pago de comisión: días 10–20 del mes SIGUIENTE
    al pago del cliente (ej. pago 1-sep → comisión 10–20 oct)."""
    if base is None:
        return (None, None, None)
    if base.month == 12:
        inicio = date(base.year + 1, 1, 10)
    else:
        inicio = date(base.year, base.month + 1, 10)
    fin = inicio.replace(day=20)
    return (inicio, fin, inicio.strftime("%Y-%m"))


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
                a05.shipment_date_artifact                        AS shipment_date_artifact,
                a05.eta_artifact                                  AS eta_artifact,
                e.credit_days_mwt                                 AS credit_days_mwt,
                COALESCE(e.credit_days_cliente, e.credit_days, cl.dias_credito, 90) AS credit_days_cliente,
                NULLIF(e.phase_durations_json -> 'PREPARACION' ->> 'end', '')::date          AS prep_end,
                NULLIF(e.phase_durations_json -> 'PREPARACION_DESPACHO' ->> 'end', '')::date AS prepdesp_end,
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
                oc.razon_social                                   AS operador_razon_social,
                e.brand_id::text                                  AS brand_id,
                bm.nombre                                         AS brand_name,
                COALESCE(cl.dias_credito, 90)                     AS cliente_dias_credito,
                COALESCE(SUM(l.qty * l.unit_price_client), 0)     AS total_client,
                COALESCE(SUM(l.qty * l.unit_price_mwt), 0)        AS total_mwt,
                COALESCE(SUM(l.qty * (l.unit_price_client - l.unit_price_mwt)), 0) AS delta_total,
                COALESCE(SUM(l.qty * l.unit_price_client *
                    COALESCE(l.commission_pct,
                             clientes.comision_pct_for(e.client_id, p.marca_id, COALESCE(p.nombre, l.sku)),
                             e.commission_pct, cl.comision_pct, 0)), 0) AS commission_client,
                COALESCE(SUM(l.qty * (l.unit_price_client - l.unit_price_mwt) *
                    COALESCE(l.commission_pct,
                             clientes.comision_pct_for(e.client_id, p.marca_id, COALESCE(p.nombre, l.sku)),
                             e.commission_pct, cl.comision_pct, 0)), 0) AS commission_delta,
                COALESCE(SUM(l.qty), 0)                           AS total_qty,
                COUNT(l.id)                                       AS lines_count
            FROM expedientes.expediente e
            LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
            LEFT JOIN clientes.cliente oc ON oc.id = e.operating_company_id
            LEFT JOIN brands.marca bm ON bm.id = e.brand_id
            LEFT JOIN expedientes.linea l ON l.expediente_id = e.id AND l.is_active = TRUE
            LEFT JOIN productos.producto p ON p.id = l.producto_id
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
                     oc.id, oc.razon_social,
                     e.brand_id, bm.nombre,
                     a05.shipment_date_artifact, a05.eta_artifact
            ORDER BY proforma_codigo ASC NULLS LAST, e.codigo ASC
            """
        )
        cols = [c0[0] for c0 in c.description]
        return [dict(zip(cols, row)) for row in c.fetchall()]


def _build_item(row: dict, today: date) -> dict:
    """Transforma una fila del cursor en el item de la API."""
    commission_rate = row["commission_rate"]
    total_client = _dec(row["total_client"])

    # Regla de Operador (Sprint 2026-08-03 CEO Directive):
    # El expediente lo opera Muito Work Limitada si su operating_company_id es
    # MWT (constante MWT_OPERATING_CLIENT_ID); si no, lo opera el propio cliente.
    is_mwt_operated = (str(row["operating_company_id"]) == MWT_OPERATING_CLIENT_ID)

    if is_mwt_operated:
        total_mwt = _dec(row["total_mwt"])
        delta_total = _dec(row["delta_total"])
    else:
        total_mwt = Decimal("0.00")
        delta_total = total_client

    # K2 · prorrateo por línea (familias): si hay % por línea
    # (expedientes.linea.commission_pct o reglas por marca/familia), se usa esa suma.
    comm_client = _dec(row.get("commission_client") or 0)

    # Regla CEO: la comisión MWT se calcula SIEMPRE sobre el Total Cliente.
    # Si el expediente lo opera Muito Work Limitada, la comisión se muestra en 0:
    # en ese caso el beneficio de MWT es el arbitraje (Δ), no una comisión.
    if is_mwt_operated:
        commission_amount = Decimal("0.00")
    elif comm_client and comm_client != 0:
        commission_amount = comm_client.quantize(Decimal("0.01"))
    elif commission_rate is not None:
        commission_amount = (total_client * _dec(commission_rate)).quantize(Decimal("0.01"))
    else:
        commission_amount = None

    margen_pct = None
    if total_client > 0:
        margen_pct = (delta_total / total_client).quantize(Decimal("0.0001"))

    cd_cli = int(row["credit_days_cliente"] or row.get("cliente_dias_credito") or 90)
    cd_mwt = int(row["credit_days_mwt"]) if row.get("credit_days_mwt") is not None else None

    estado, _fecha_devengo_credito = _resolve_devengo_estado(
        commission_rate=_dec(commission_rate) if commission_rate is not None else None,
        shipment_date=(row.get("shipment_date_artifact") or row["shipment_date"]),
        eta=(row.get("eta_artifact") or row["eta"]),
        created_at_date=row.get("created_at_date"),
        credit_days_cliente=cd_cli,
        credit_days_mwt=cd_mwt,
        balance=_dec(row["balance"]),
        total_paid=_dec(row["total_paid"]),
        today=today,
    )

    # Fecha de devengo = fecha en que finalizó la fase de PREPARACION
    # (PREPARACION_DESPACHO si la fase visual fusionada reemplazó a PREPARACION).
    # Si la fase aún no cerró, no hay devengo todavía.
    fecha_devengo = row.get("prep_end") or row.get("prepdesp_end")

    # Fecha de pago aproximada = devengo + plazo del CLIENTE (no el de MWT).
    fecha_pago_aprox = (
        fecha_devengo + timedelta(days=cd_cli) if fecha_devengo else None
    )

    base = (row.get("shipment_date_artifact")
            or row["shipment_date"]
            or row.get("eta_artifact")
            or row["eta"])
    if base is None and row.get("created_at_date"):
        base = row["created_at_date"] + timedelta(days=cd_cli)

    fecha_facturada = None
    if base is not None:
        fecha_facturada = base + timedelta(days=cd_cli)
    fpa_inicio, fpa_fin, mes_pago_label = _next_month_business_window(
        fecha_facturada, n_days=10
    )
    vc_ini, vc_fin, vc_mes = _ventana_10_20(fecha_pago_aprox or fecha_facturada)

    return {
        "expediente_id":         row["expediente_id"],
        "display_id":            _resolve_display_id(row["codigo"], row["proforma_codigo"]),
        "codigo":                row["codigo"],
        "proforma_codigo":       row["proforma_codigo"],
        "client_id":             row["client_id"],
        "cliente_razon_social":  row["cliente_razon_social"] or "â€”",
        "cliente_segmento":      row["cliente_segmento"] or None,
        "operador_razon_social": row.get("operador_razon_social") or None,
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
        "fecha_pago_aprox":       fecha_pago_aprox.isoformat() if fecha_pago_aprox else None,
        "devengo_estado":        estado,
        "lines_count":           row["lines_count"],
        "total_qty":             str(_dec(row["total_qty"])),
        "fecha_facturada":           fecha_facturada.isoformat() if fecha_facturada else None,
        "mes_pago_aproximado":       mes_pago_label,
        "fecha_pago_aprox_inicio":   fpa_inicio.isoformat() if fpa_inicio else None,
        "fecha_pago_aprox_fin":      fpa_fin.isoformat() if fpa_fin else None,
        "brand_id":                  row.get("brand_id"),
        "brand_name":                row.get("brand_name"),
        "ventana_comision_inicio":   vc_ini.isoformat() if vc_ini else None,
        "ventana_comision_fin":      vc_fin.isoformat() if vc_fin else None,
        "mes_comision":              vc_mes,
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
            {"id": "<expediente_id>", "label": "EXP-2026-0001 Â· Sondel",
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
        cliente = it.get("cliente_razon_social") or "â€”"
        display = it.get("display_id") or it.get("codigo") or "â€”"
        points.append({
            "id":        it["expediente_id"],
            "label":     f"{display} Â· {cliente}",
            "projected": m,
            "real":      m,
            "value":     delta,
        })
    return Response({"points": points, "today": today.isoformat()})


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def cliente_profile(request, client_id):
    """Perfil financiero de un cliente â€” comision agregada + sus expedientes."""
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

    # Datos basicos del cliente (separately â€” perfil no duplica /api/clientes/)
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


# ---------------------------------------------------------------------
# Etapa 5 · PORTADA CEO — respuestas pendientes + proximas salidas
# ---------------------------------------------------------------------
def _query(sql: str, params=None) -> list[dict]:
    with connection.cursor() as c:
        c.execute(sql, params)
        cols = [c0[0] for c0 in c.description]
        return [dict(zip(cols, row)) for row in c.fetchall()]


# Sub-select reutilizable: codigo de la proforma vigente del expediente.
_PROFORMA_SUBSELECT = """
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
    )
"""


@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def radiografia_ceo(request):
    """Etapa 5 · Portada CEO.

    Devuelve, anclado a datos reales (nada inventado):
      · respuestas_pendientes: correos IN cuyo ultimo mensaje del hilo no fue
        respondido (sin OUT posterior) y no estan ignorados.
      · borradores_por_revisar: Envios en estado BORRADOR.
      · proximas_salidas: fechas PRODUCCION/ETD publicadas dentro de la ventana
        (default 21 dias, configurable con ?window_days=). Clasifica la certeza:
        RECONFIRMADA (exacta), POR_RECONFIRMAR (mes/rango), CAMBIO (conflicto).
      · sin_fecha: expedientes en REGISTRO/PRODUCCION sin fecha publicada.
      · bloqueos: cambios de fecha pendientes de revisar + tareas REQUIERE_REVISION.

    NO expone saldo disponible: el plan deja abierta la fuente del saldo inicial.
    """
    try:
        window_days = int(request.query_params.get("window_days") or 21)
    except (TypeError, ValueError):
        window_days = 21
    window_days = max(1, min(window_days, 180))
    today = date.today()

    # ── Respuestas pendientes ─────────────────────────────────────────
    respuestas = _query(f"""
        WITH ranked AS (
            SELECT m.id::text AS mensaje_id, m.thread_key, m.message_id, m.subject,
                   m.from_email, m.from_name, m.sent_at, m.received_at, m.created_at,
                   m.expediente_id::text AS expediente_id, m.match_status, m.folder,
                   ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(m.thread_key, m.message_id, m.id::text)
                       ORDER BY COALESCE(m.sent_at, m.received_at, m.created_at) DESC
                   ) AS rn
              FROM correo.mensaje m
             WHERE m.is_active = TRUE AND m.direction = 'IN'
        )
        SELECT r.mensaje_id, r.subject, r.from_email, r.from_name, r.match_status, r.folder,
               COALESCE(r.sent_at, r.received_at, r.created_at) AS fecha,
               r.expediente_id, e.codigo AS exp_codigo, e.estado AS exp_estado,
               cl.razon_social AS cliente,
               {_PROFORMA_SUBSELECT} AS proforma_codigo
          FROM ranked r
          LEFT JOIN expedientes.expediente e ON e.id::text = r.expediente_id
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE r.rn = 1
           AND r.match_status <> 'IGNORADO'
           AND NOT EXISTS (
                 SELECT 1 FROM correo.mensaje o
                  WHERE o.is_active = TRUE AND o.direction = 'OUT'
                    AND COALESCE(o.thread_key, o.message_id, o.id::text)
                        = COALESCE(r.thread_key, r.message_id, r.mensaje_id)
                    AND COALESCE(o.sent_at, o.received_at, o.created_at)
                        > COALESCE(r.sent_at, r.received_at, r.created_at)
               )
         ORDER BY fecha ASC
         LIMIT 50
    """)
    for r in respuestas:
        r["display_id"] = _resolve_display_id(r.get("exp_codigo"), r.get("proforma_codigo"))
        r["fecha"] = r["fecha"].isoformat() if r.get("fecha") else None

    # ── Borradores por revisar ────────────────────────────────────────
    borradores = _query(f"""
        SELECT v.id::text AS envio_id, v.expediente_id::text AS expediente_id,
               v.subject, v.destinatarios, v.estado, v.updated_at,
               e.codigo AS exp_codigo, cl.razon_social AS cliente,
               {_PROFORMA_SUBSELECT} AS proforma_codigo
          FROM correo.envio v
          LEFT JOIN expedientes.expediente e ON e.id = v.expediente_id
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE v.estado = 'BORRADOR'
         ORDER BY v.updated_at DESC
         LIMIT 50
    """)
    for b in borradores:
        b["display_id"] = _resolve_display_id(b.get("exp_codigo"), b.get("proforma_codigo"))
        b["updated_at"] = b["updated_at"].isoformat() if b.get("updated_at") else None

    # ── Proximas salidas de produccion ────────────────────────────────
    salidas = _query(f"""
        SELECT ef.expediente_id::text AS expediente_id, ef.campo, ef.valor_raw,
               ef.valor_fecha, ef.precision, ef.updated_at,
               e.codigo AS exp_codigo, e.estado AS exp_estado,
               cl.razon_social AS cliente,
               {_PROFORMA_SUBSELECT} AS proforma_codigo,
               EXISTS (
                   SELECT 1 FROM correo.extraccion x
                    WHERE x.expediente_id = ef.expediente_id
                      AND x.campo = ef.campo
                      AND x.conflicto = TRUE
                      AND x.estado = 'PROPUESTO'
               ) AS conflicto
          FROM correo.expediente_fecha ef
          JOIN expedientes.expediente e ON e.id = ef.expediente_id AND e.is_active = TRUE
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE ef.publicado = TRUE
           AND ef.campo IN ('PRODUCCION', 'ETD')
           AND ef.valor_fecha IS NOT NULL
           AND ef.valor_fecha BETWEEN CURRENT_DATE AND (CURRENT_DATE + %s::int)
         ORDER BY ef.valor_fecha ASC
         LIMIT 100
    """, [window_days])
    for s in salidas:
        s["display_id"] = _resolve_display_id(s.get("exp_codigo"), s.get("proforma_codigo"))
        s["valor_fecha"] = s["valor_fecha"].isoformat() if s.get("valor_fecha") else None
        s["ultima_actualizacion"] = s["updated_at"].isoformat() if s.get("updated_at") else None
        s.pop("updated_at", None)
        if s.get("conflicto"):
            s["estado_fecha"] = "CAMBIO"
        elif (s.get("precision") or "EXACTA") != "EXACTA":
            s["estado_fecha"] = "POR_RECONFIRMAR"
        else:
            s["estado_fecha"] = "RECONFIRMADA"

    # ── Sin fecha concreta (en registro/produccion sin fecha publicada) ─
    sin_fecha = _query(f"""
        SELECT e.id::text AS expediente_id, e.codigo AS exp_codigo, e.estado AS exp_estado,
               e.shipment_date, e.eta, cl.razon_social AS cliente,
               {_PROFORMA_SUBSELECT} AS proforma_codigo
          FROM expedientes.expediente e
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE e.is_active = TRUE
           AND e.estado IN ('REGISTRO', 'PRODUCCION')
           AND NOT EXISTS (
                 SELECT 1 FROM correo.expediente_fecha ef
                  WHERE ef.expediente_id = e.id
                    AND ef.publicado = TRUE
                    AND ef.campo IN ('PRODUCCION', 'ETD')
                    AND ef.valor_fecha IS NOT NULL
               )
         ORDER BY e.codigo ASC
         LIMIT 100
    """)
    for s in sin_fecha:
        s["display_id"] = _resolve_display_id(s.get("exp_codigo"), s.get("proforma_codigo"))

    # ── Bloqueos (cambios de fecha + tareas de revision) ──────────────
    cambios = _query(f"""
        SELECT x.id::text AS extraccion_id, x.campo, x.valor_fecha, x.conflicto,
               x.created_at, x.expediente_id::text AS expediente_id,
               e.codigo AS exp_codigo, cl.razon_social AS cliente,
               {_PROFORMA_SUBSELECT} AS proforma_codigo
          FROM correo.extraccion x
          LEFT JOIN expedientes.expediente e ON e.id = x.expediente_id
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE x.estado = 'PROPUESTO' AND x.conflicto = TRUE
         ORDER BY x.created_at DESC
         LIMIT 50
    """)
    for x in cambios:
        x["display_id"] = _resolve_display_id(x.get("exp_codigo"), x.get("proforma_codigo"))
        x["valor_fecha"] = x["valor_fecha"].isoformat() if x.get("valor_fecha") else None
        x["created_at"] = x["created_at"].isoformat() if x.get("created_at") else None

    tareas_rev = _query("""
        SELECT t.id::text AS tarea_id, t.titulo, t.estado, t.due_date,
               t.expediente_id::text AS expediente_id, e.codigo AS exp_codigo,
               cl.razon_social AS cliente
          FROM tareas.tarea t
          LEFT JOIN expedientes.expediente e ON e.id = t.expediente_id
          LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
         WHERE t.is_active = TRUE AND t.estado = 'REQUIERE_REVISION'
         ORDER BY t.due_date ASC NULLS LAST
         LIMIT 50
    """)
    for t in tareas_rev:
        t["due_date"] = t["due_date"].isoformat() if t.get("due_date") else None

    return Response({
        "today": today.isoformat(),
        "window_days": window_days,
        "respuestas_pendientes": respuestas,
        "borradores_por_revisar": borradores,
        "proximas_salidas": salidas,
        "sin_fecha": sin_fecha,
        "bloqueos": {
            "cambios_fecha": cambios,
            "tareas_revision": tareas_rev,
        },
    })


# ---------------------------------------------------------------------
# Etapa 5 · COMISIONES POR MARCA (ventana 10–20 del mes siguiente al pago)
# ---------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def comisiones_por_marca(request):
    """Comisión por marca, separada en proyectada / pendiente / devengada,
    con la ventana de pago 10–20 del mes siguiente al pago del cliente."""
    today = date.today()
    items = [_build_item(r, today) for r in _fetch_expedientes()]
    marcas: dict[str, dict] = {}
    for it in items:
        key = it.get("brand_name") or "(sin marca)"
        m = marcas.setdefault(key, {
            "brand_id": it.get("brand_id"), "brand_name": key,
            "comision_total": Decimal("0"), "comision_devengada": Decimal("0"),
            "comision_pendiente": Decimal("0"), "comision_proyectada": Decimal("0"),
            "delta_total": Decimal("0"), "expedientes": 0, "sin_tasa": 0,
            "ventanas": {},
        })
        m["expedientes"] += 1
        m["delta_total"] += _dec(it.get("delta_total"))
        amt = it.get("commission_amount")
        if amt is None:
            m["sin_tasa"] += 1
            continue
        a = _dec(amt)
        m["comision_total"] += a
        est = it["devengo_estado"]
        if est == "DEVENGADA":
            m["comision_devengada"] += a
        elif est in ("DEVENGABLE", "VENCIDA"):
            m["comision_pendiente"] += a
        elif est == "PROYECTADA":
            m["comision_proyectada"] += a
        mes = it.get("mes_comision")
        if mes:
            v = m["ventanas"].setdefault(mes, {
                "mes": mes, "inicio": it.get("ventana_comision_inicio"),
                "fin": it.get("ventana_comision_fin"), "monto": Decimal("0"),
            })
            v["monto"] += a
    results = []
    for m in marcas.values():
        for v in m["ventanas"].values():
            v["monto"] = str(v["monto"].quantize(Decimal("0.01")))
        m["ventanas"] = sorted(m["ventanas"].values(), key=lambda x: x["mes"])
        for k in ("comision_total", "comision_devengada", "comision_pendiente",
                  "comision_proyectada", "delta_total"):
            m[k] = str(m[k].quantize(Decimal("0.01")))
        results.append(m)
    results.sort(key=lambda x: _dec(x["comision_total"]), reverse=True)
    return Response({
        "results": results,
        "today": today.isoformat(),
        "ventana_comision": "días 10–20 del mes siguiente al pago del cliente",
    })


# ---------------------------------------------------------------------
# Etapa 5 · FLUJO DE DINERO (90 días, USD + CRC) + saldo inicial
# ---------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def flujo(request):
    """Flujo NETO proyectado (entradas − salidas) a N días (default 90),
    agrupado por semana, en USD y CRC, más el saldo inicial configurado.

    No es 'saldo disponible bancario': es flujo + saldo inicial declarado.
    """
    try:
        dias = int(request.query_params.get("dias") or 90)
    except (TypeError, ValueError):
        dias = 90
    dias = max(7, min(dias, 365))
    today = date.today()

    with connection.cursor() as c:
        c.execute("SELECT moneda, monto FROM finanzas.saldo_inicial")
        saldo = {r[0]: _dec(r[1]) for r in c.fetchall()}

    with connection.cursor() as c:
        c.execute("""
            SELECT direction, moneda, fecha,
                   COALESCE(monto_usd, 0) AS monto_usd,
                   COALESCE(monto, 0)     AS monto
              FROM finance.payment
             WHERE is_active = TRUE AND fecha IS NOT NULL
               AND fecha BETWEEN %s AND %s
        """, [today, today + timedelta(days=dias)])
        pagos = c.fetchall()

    def _wk(d):
        return d - timedelta(days=d.weekday())

    weeks: dict = {}
    for direction, moneda, fecha, monto_usd, monto in pagos:
        ws = _wk(fecha)
        b = weeks.setdefault(ws, {
            "semana": ws.isoformat(), "fin": (ws + timedelta(days=6)).isoformat(),
            "entradas_usd": Decimal("0"), "salidas_usd": Decimal("0"),
            "entradas_crc": Decimal("0"), "salidas_crc": Decimal("0"),
        })
        if direction == "IN":
            b["entradas_usd"] += _dec(monto_usd)
            if (moneda or "").upper() == "CRC":
                b["entradas_crc"] += _dec(monto)
        elif direction == "OUT":
            b["salidas_usd"] += _dec(monto_usd)
            if (moneda or "").upper() == "CRC":
                b["salidas_crc"] += _dec(monto)

    series = []
    tot = {"entradas_usd": Decimal("0"), "salidas_usd": Decimal("0"),
           "entradas_crc": Decimal("0"), "salidas_crc": Decimal("0")}
    for ws in sorted(weeks):
        b = weeks[ws]
        for k in ("entradas_usd", "salidas_usd", "entradas_crc", "salidas_crc"):
            tot[k] += b[k]
        b["neto_usd"] = str((b["entradas_usd"] - b["salidas_usd"]).quantize(Decimal("0.01")))
        b["neto_crc"] = str((b["entradas_crc"] - b["salidas_crc"]).quantize(Decimal("0.01")))
        for k in ("entradas_usd", "salidas_usd", "entradas_crc", "salidas_crc"):
            b[k] = str(b[k].quantize(Decimal("0.01")))
        series.append(b)

    neto_usd = tot["entradas_usd"] - tot["salidas_usd"]
    neto_crc = tot["entradas_crc"] - tot["salidas_crc"]
    saldo_usd = saldo.get("USD", Decimal("0"))
    saldo_crc = saldo.get("CRC", Decimal("0"))
    return Response({
        "today": today.isoformat(),
        "dias": dias,
        "monedas": ["USD", "CRC"],
        "saldo_inicial": {"USD": str(saldo_usd), "CRC": str(saldo_crc)},
        "semanas": series,
        "totales": {
            "entradas_usd": str(tot["entradas_usd"].quantize(Decimal("0.01"))),
            "salidas_usd": str(tot["salidas_usd"].quantize(Decimal("0.01"))),
            "neto_usd": str(neto_usd.quantize(Decimal("0.01"))),
            "entradas_crc": str(tot["entradas_crc"].quantize(Decimal("0.01"))),
            "salidas_crc": str(tot["salidas_crc"].quantize(Decimal("0.01"))),
            "neto_crc": str(neto_crc.quantize(Decimal("0.01"))),
        },
        "saldo_final_proyectado": {
            "USD": str((saldo_usd + neto_usd).quantize(Decimal("0.01"))),
            "CRC": str((saldo_crc + neto_crc).quantize(Decimal("0.01"))),
        },
        "nota": ("Flujo proyectado (entradas − salidas) + saldo inicial declarado. "
                 "No es saldo bancario disponible."),
    })


@api_view(["GET", "POST"])
@permission_classes([IsCeoOrAdmin])
def saldo_inicial(request):
    """GET/POST del saldo inicial por moneda (USD, CRC)."""
    if request.method == "POST":
        with connection.cursor() as c:
            for mon in ("USD", "CRC"):
                if mon in (request.data or {}):
                    c.execute("""
                        INSERT INTO finanzas.saldo_inicial (moneda, monto, notas, updated_at)
                        VALUES (%s, %s, %s, NOW())
                        ON CONFLICT (moneda) DO UPDATE
                          SET monto = EXCLUDED.monto,
                              notas = EXCLUDED.notas,
                              updated_at = NOW()
                    """, [mon, _dec(request.data.get(mon)), request.data.get("notas")])
    with connection.cursor() as c:
        c.execute("SELECT moneda, monto, notas, updated_at FROM finanzas.saldo_inicial")
        cols = [x[0] for x in c.description]
        rows = [dict(zip(cols, r)) for r in c.fetchall()]
    for r in rows:
        r["monto"] = str(r["monto"])
        r["updated_at"] = r["updated_at"].isoformat() if r.get("updated_at") else None
    return Response({"results": rows})


# ---------------------------------------------------------------------
# Etapa 5 · ARBITRAJE por fechas de factura (modelo C · MWT opera)
#   Arbitraje bruto = precio cliente − precio MWT (Δ).
#   Vencimiento compra = fecha factura compra + plazo MWT.
#   Vencimiento venta  = fecha factura venta  + plazo cliente.
#   Desfase > 0 → MWT paga antes de cobrar (financiación temporal).
# ---------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsCeoOrAdmin])
def arbitraje(request):
    from collections import defaultdict

    today = date.today()
    items = [_build_item(r, today) for r in _fetch_expedientes()]
    if not items:
        return Response({"results": [], "today": today.isoformat(),
                         "resumen": {"expedientes": 0, "arbitraje_bruto_total": "0.00",
                                     "monto_requiere_financiacion": "0.00"}})

    ids = [it["expediente_id"] for it in items]
    with connection.cursor() as c:
        c.execute("""
            SELECT expediente_id::text, COALESCE(audience, ''), MIN(fecha)
              FROM expedientes.documento
             WHERE is_active = TRUE AND kind = 'FACTURA'
               AND expediente_id IS NOT NULL AND fecha IS NOT NULL
               AND expediente_id::text = ANY(%s::text[])
             GROUP BY 1, 2
        """, [ids])
        fac = c.fetchall()
    inv: dict = defaultdict(dict)
    for eid, aud, f in fac:
        inv[eid][aud or ""] = f

    results = []
    for it in items:
        # El arbitraje es el beneficio de MWT solo cuando MWT opera el expediente.
        if str(it.get("operating_company_id") or "") != MWT_OPERATING_CLIENT_ID:
            continue
        eid = it["expediente_id"]
        d = inv.get(eid, {})
        venta_fecha = d.get("CLIENT")
        compra_fecha = d.get("ADMIN_ONLY") or d.get("MWT_INTERNAL")
        cd_cli = int(it.get("credit_days_cliente") or 90)
        cd_mwt = it.get("credit_days_mwt")
        cd_mwt = int(cd_mwt) if cd_mwt is not None else None
        try:
            salida = date.fromisoformat(it["shipment_date"]) if it.get("shipment_date") else None
        except (TypeError, ValueError):
            salida = None
        venta_base = venta_fecha or salida
        compra_base = compra_fecha or salida
        venta_vence = (venta_base + timedelta(days=cd_cli)) if venta_base else None
        compra_vence = (compra_base + timedelta(days=cd_mwt)) if (compra_base and cd_mwt is not None) else None
        desfase = (venta_vence - compra_vence).days if (venta_vence and compra_vence) else None
        results.append({
            "expediente_id": eid,
            "display_id": it["display_id"],
            "cliente": it.get("cliente_razon_social"),
            "brand_name": it.get("brand_name"),
            "total_client": it["total_client"],
            "total_mwt": it["total_mwt"],
            "arbitraje_bruto": it["delta_total"],
            "compra_fecha": compra_fecha.isoformat() if compra_fecha else (salida.isoformat() if salida else None),
            "venta_fecha":  venta_fecha.isoformat() if venta_fecha else (salida.isoformat() if salida else None),
            "credit_days_mwt": cd_mwt,
            "credit_days_cliente": cd_cli,
            "compra_vence": compra_vence.isoformat() if compra_vence else None,
            "venta_vence":  venta_vence.isoformat() if venta_vence else None,
            "desfase_dias": desfase,
            "requiere_financiacion": bool(desfase and desfase > 0),
        })

    results.sort(key=lambda x: (x["desfase_dias"] is None, -(x["desfase_dias"] or 0)))
    tot_arb = sum(_dec(x["arbitraje_bruto"]) for x in results)
    en_riesgo = sum(_dec(x["total_mwt"]) for x in results if x["requiere_financiacion"])
    return Response({
        "results": results,
        "today": today.isoformat(),
        "resumen": {
            "expedientes": len(results),
            "arbitraje_bruto_total": str(tot_arb.quantize(Decimal("0.01"))),
            "monto_requiere_financiacion": str(en_riesgo.quantize(Decimal("0.01"))),
        },
        "nota": ("Arbitraje bruto = precio cliente − precio MWT (Δ). Vencimientos = fecha de la "
                 "factura (o la salida, si falta) + plazo compra (MWT) / venta (cliente). "
                 "Desfase > 0 = MWT paga antes de cobrar (financiación temporal)."),
    })



