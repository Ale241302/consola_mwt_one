"""
=====================================================================
MWT.ONE · apps.expedientes.views_proforma
Agente responsable: [AG-FULLSTACK]

Endpoint: POST /api/expedientes/{expediente_id}/generate-proforma/

Genera la proforma "vista cliente" (tab SONDEL del template MWT) en
HTML y la persiste en MinIO + expedientes.documento con
kind='PROFORMA', audience='CLIENT'.

Reglas:
  · Solo Admin/CEO. CLIENT_* recibe 403.
  · audience='CLIENT' → visible al cliente final + MWT.
  · Numero de proforma secuencial PF-{YYYY}-{NNNN} dentro del año.
  · Devuelve documento_id, codigo y signed_url (best-effort, TTL 15min).
=====================================================================
"""
from __future__ import annotations

import json
import logging
import uuid

from django.db import connection, transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Documento, Expediente
from .proforma_renderer import render_proforma_html
from .proforma_renderer_marluvas import render_proforma_html_marluvas
from .serializers import DocumentoSerializer
from .views import _deny_client_mutation

log = logging.getLogger(__name__)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def generate_proforma(request, expediente_id):
    """POST /api/expedientes/{id}/generate-proforma/

    Renderea HTML del tab SONDEL, lo sube a MinIO, persiste en
    expedientes.documento (kind='PROFORMA', audience='CLIENT') y
    devuelve el documento + URL firmada.
    """
    denied = _deny_client_mutation(request, action_label="proforma.generate")
    if denied is not None:
        return denied

    # Validar UUID del expediente
    try:
        uuid.UUID(str(expediente_id))
    except (TypeError, ValueError):
        return Response({"detail": "expediente_id inválido"}, status=400)

    # Sprint 2026-05-24 · parametros del body (audience + codigo + payment_days).
    body = request.data if isinstance(request.data, dict) else {}
    raw_audience = str(body.get("audience") or "CLIENT").upper().strip()
    if raw_audience not in ("CLIENT", "MWT_INTERNAL", "ADMIN_ONLY"):
        raw_audience = "CLIENT"
    codigo_override = (body.get("codigo") or body.get("numero") or "").strip() or None
    payment_days_override = body.get("payment_days")

    # 1) Render -- ruteo segun audience
    try:
        if raw_audience in ("MWT_INTERNAL", "ADMIN_ONLY"):
            # Sprint 2026-05-24 · ADMIN_ONLY tambien usa vista MARLUVAS
            # (perspectiva MWT-compra, credit_days_mwt). Se diferencia de
            # MWT_INTERNAL solo en la columna `audience` del Documento
            # (ADMIN_ONLY = CEO/superuser only · MWT_INTERNAL = staff MWT).
            html_str, metadata = render_proforma_html_marluvas(
                expediente_id,
                request_user=request.user,
                codigo_override=codigo_override,
                payment_days_override=payment_days_override,
            )
        else:
            # CLIENT usa la vista cliente (SONDEL) con credit_days_cliente.
            html_str, metadata = render_proforma_html(
                expediente_id,
                request_user=request.user,
                codigo_override=codigo_override,
            )
    except Expediente.DoesNotExist:
        return Response({"detail": "Expediente no encontrado"}, status=404)
    except ValueError as ve:
        msg = str(ve)
        return Response(
            {"detail": "no se puede generar la proforma", "error": msg},
            status=422,
        )

    html_bytes = html_str.encode("utf-8")
    file_size = len(html_bytes)

    # 2) Upload a MinIO
    doc_uuid = uuid.uuid4()
    safe_name = metadata["filename"].replace("/", "_").replace("\\", "_")
    key = f"documento/{doc_uuid}/{safe_name}"

    try:
        from apps.storage.services import (
            put_object_stream,
            generate_signed_url,
        )
    except ImportError as ie:
        log.error("storage.services import failed: %s", ie)
        return Response(
            {"detail": "storage_unavailable", "error": str(ie)},
            status=502,
        )

    import io as _io
    up = put_object_stream(
        key=key,
        file_stream=_io.BytesIO(html_bytes),
        content_type="text/html; charset=utf-8",
        length=file_size,
    )
    if not up.get("ok"):
        log.error(
            "proforma.generate put_object_stream failed: %s",
            up.get("error"),
        )
        return Response(
            {"detail": "minio_upload_failed", "error": up.get("error") or "unknown"},
            status=502,
        )

    # 3) Persistir documento en BD
    author = (
        getattr(request.user, "email", None)
        or getattr(request.user, "username", None)
        or "system"
    )
    codigo = metadata["codigo"]
    oc_id = metadata.get("oc_id")

    try:
        with transaction.atomic():
            with connection.cursor() as c:
                c.execute(
                    """
                    INSERT INTO expedientes.documento (
                        id, oc_id, expediente_id,
                        kind, audience, codigo,
                        file_ext, file_size_bytes, storage_url,
                        author, fecha,
                        is_active, created_at, updated_at
                    ) VALUES (
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, CURRENT_DATE,
                        TRUE, now(), now()
                    )
                    """,
                    [
                        str(doc_uuid),
                        oc_id if oc_id else None,
                        str(expediente_id),
                        "PROFORMA", raw_audience, codigo,
                        "html", file_size, key,
                        author,
                    ],
                )
        d = Documento.objects.get(pk=doc_uuid)
    except Exception as exc:
        log.exception("proforma.generate insert failed: %s", exc)
        return Response(
            {"detail": "documento_insert_failed", "error": str(exc)[:200]},
            status=500,
        )

    # 4) Signed URL best-effort
    signed = None
    try:
        signed = generate_signed_url(key=key, kind="get", ttl=900)
    except Exception as exc:
        log.warning("generate_signed_url best-effort failed: %s", exc)
        signed = {"url": None, "available": False, "error": str(exc)}

    payload = {
        "documento":       DocumentoSerializer(d).data,
        "codigo":          codigo,
        "documento_id":    str(d.id),
        "expediente_id":   str(expediente_id),
        "filename":        metadata["filename"],
        "total_pares":     metadata["total_pares"],
        "total_value_usd": str(metadata["total_value_usd"]),
        "signed_url":      signed,
    }
    return Response(payload, status=201)


# ═════════════════════════════════════════════════════════════════════
# GET /api/expedientes/{expediente_id}/proforma-html/
# Sprint 2026-05-08 · Render dinámico de Proforma.
#
# A diferencia de generate-proforma (que sube archivo a MinIO), este
# endpoint renderiza el HTML AL VUELO con la data actual del expediente
# en cada request. Esto permite que el documento "PROFORMA HTML" sea
# siempre fresh — refleja cambios en líneas, precios, forma_pago,
# pronto_pago, cliente, etc., sin necesidad de regenerar archivos.
#
# Query params:
#   ?codigo=PF-2417-2026 (opcional · override del código mostrado)
# ═════════════════════════════════════════════════════════════════════
from django.http import HttpResponse  # noqa: E402


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def proforma_html_dynamic(request, expediente_id):
    """GET /api/expedientes/{id}/proforma-html/ — render dinámico.

    Devuelve text/html con la proforma actualizada en cada request.
    Visible para Admin, MWT staff y CLIENT_* (audience=CLIENT) si el
    documento marker existe y le corresponde.
    """
    try:
        uuid.UUID(str(expediente_id))
    except (TypeError, ValueError):
        return Response({"detail": "expediente_id inválido"}, status=400)

    codigo_override = request.query_params.get("codigo") or None

    try:
        html_str, _meta = render_proforma_html(
            expediente_id,
            request_user=request.user,
            codigo_override=codigo_override,
        )
    except Expediente.DoesNotExist:
        return Response({"detail": "Expediente no encontrado"}, status=404)
    except ValueError as ve:
        return Response(
            {"detail": "no se puede renderizar la proforma", "error": str(ve)},
            status=422,
        )
    except Exception as exc:
        log.exception("proforma_html_dynamic render failed: %s", exc)
        return Response(
            {"detail": "render_failed", "error": str(exc)[:200]},
            status=500,
        )

    return HttpResponse(html_str, content_type="text/html; charset=utf-8")


# ═════════════════════════════════════════════════════════════════════
# GET /api/expedientes/{expediente_id}/factura-payload/
# Sprint 2026-06-01 · Factura comercial del expediente.
#
# Devuelve un payload con la MISMA forma que invoice_payload (transfers)
# para que el frontend genere la "Factura comercial" con el mismo generador
# que la factura de transferencia (buildTransferInvoiceHtml). Incluye
# precios MWT/cliente, NCM por línea (productos.especificaciones->>'ncm') y
# el flag operated_by_mwt. El expediente no tiene flete/seguro, así que
# CIF = mercadería (extra=0) en la sección de nacionalización.
# ═════════════════════════════════════════════════════════════════════
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def factura_payload(request, expediente_id):
    """GET /api/expedientes/{id}/factura-payload/ — datos para la factura.

    El `id` puede ser un expediente_id O un oc_id (la página de detalle del
    expediente es OC-céntrica). Resuelve líneas por cualquiera de los dos e
    incluye los costos de transferencia (FLETE/SEGURO/…) asociados a esos
    expedientes para que el CIF de la factura los sume.
    """
    try:
        uuid.UUID(str(expediente_id))
    except (TypeError, ValueError):
        return Response({"detail": "expediente_id inválido"}, status=400)

    import datetime as _dt
    from apps.core.constants import MWT_OPERATING_CLIENT_ID
    pid = str(expediente_id)

    # 1) Líneas por expediente_id O por oc_id.
    with connection.cursor() as c:
        c.execute(
            """
            SELECT l.id, l.sku, COALESCE(l.size, ''), l.qty,
                   l.unit_price_mwt, l.unit_price_client, l.producto_id,
                   COALESCE(p.nombre, ''), p.especificaciones->>'ncm',
                   l.expediente_id,
                   COALESCE(l.sap, ''),
                   COALESCE(na.nodo_label, '')
            FROM expedientes.linea l
            LEFT JOIN productos.producto p ON p.id = l.producto_id
            -- Sprint 2026-06-10 · nodo asignado por línea (mayor qty) para
            -- el modal de SKUs del Cronograma.
            LEFT JOIN LATERAL (
                SELECT n.codigo AS nodo_label
                FROM inventario.expediente_nodo_assignment a
                JOIN nodos.nodo n ON n.id = a.nodo_id
                WHERE a.expediente_id = l.expediente_id
                  AND a.producto_id = l.producto_id
                  AND COALESCE(a.talla, '') = COALESCE(l.size, '')
                  AND a.is_active = TRUE
                ORDER BY a.qty_asignada DESC
                LIMIT 1
            ) na ON TRUE
            WHERE (l.expediente_id = %(id)s::uuid OR l.oc_id = %(id)s::uuid)
              AND l.is_active = TRUE
            ORDER BY l.sku, l.size
            """,
            {"id": pid},
        )
        rows = c.fetchall()

    exp_ids = sorted({str(r[9]) for r in rows if r[9]})

    # 2) Meta del expediente (codigo, operating_company, cliente).
    with connection.cursor() as c:
        c.execute(
            """
            SELECT e.codigo, e.operating_company_id, e.estado,
                   COALESCE(cl.razon_social, '') AS cliente
            FROM expedientes.expediente e
            LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
            WHERE e.id = ANY(%(ids)s::uuid[]) OR e.id = %(id)s::uuid OR e.oc_id = %(id)s::uuid
            ORDER BY e.created_at
            LIMIT 1
            """,
            {"ids": exp_ids or [pid], "id": pid},
        )
        meta = c.fetchone()
    if not meta:
        return Response({"detail": "Expediente no encontrado"}, status=404)
    codigo, op_id, estado, cliente = meta
    op_id = str(op_id) if op_id else None
    operated_by_mwt = bool(op_id) and op_id.lower() == str(MWT_OPERATING_CLIENT_ID).lower()

    # 2b) Número de proforma (MWT) y número de OC (cliente) para el nombre
    #     del archivo y el encabezado.
    proforma_codigo = None
    oc_codigo = None
    ids_for_ref = exp_ids or [pid]
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT codigo FROM expedientes.documento
                WHERE expediente_id = ANY(%(ids)s::uuid[]) AND kind = 'PROFORMA'
                  AND is_active = TRUE AND codigo IS NOT NULL AND codigo <> ''
                ORDER BY created_at DESC LIMIT 1
                """,
                {"ids": ids_for_ref},
            )
            r = c.fetchone()
            if r:
                proforma_codigo = r[0]
            c.execute(
                r"""
                SELECT codigo FROM expedientes.documento
                WHERE expediente_id = ANY(%(ids)s::uuid[])
                  AND kind ~* '^OC(\s|_|$)'
                  AND is_active = TRUE AND codigo IS NOT NULL AND codigo <> ''
                ORDER BY (audience = 'CLIENT') DESC, created_at DESC LIMIT 1
                """,
                {"ids": ids_for_ref},
            )
            r = c.fetchone()
            if r:
                oc_codigo = r[0]
            if not oc_codigo:
                c.execute(
                    """
                    SELECT o.codigo
                    FROM expedientes.oc o
                    JOIN expedientes.expediente e ON e.oc_id = o.id
                    WHERE e.id = ANY(%(ids)s::uuid[]) AND o.is_active = TRUE
                      AND o.codigo IS NOT NULL AND o.codigo <> ''
                    LIMIT 1
                    """,
                    {"ids": ids_for_ref},
                )
                r = c.fetchone()
                if r:
                    oc_codigo = r[0]
    except Exception:
        log.exception("[factura_payload] ref codes lookup failed id=%s", pid)

    # 2c) Metadata de envío (AWB/BL) y empaque (Packing) desde builder-artifacts.
    try:
        from .shipping_meta import resolve_shipping_packing
        _sp = resolve_shipping_packing(ids_for_ref)
    except Exception:
        log.exception("[factura_payload] shipping/packing resolve failed id=%s", pid)
        _sp = {"shipping": {}, "packing": {}}

    # 3) Costos de transferencia asociados (FLETE/SEGURO/…). Dedup por
    #    cost_line: seleccionamos directo de transfers.cost_line para los
    #    transferencia_id ligados a estos expedientes vía assignment.
    cost_breakdown = []
    extra = 0.0
    ids_for_costs = exp_ids or [pid]
    try:
        with connection.cursor() as c:
            c.execute(
                """
                WITH trf AS (
                    SELECT DISTINCT transferencia_id
                    FROM inventario.expediente_nodo_assignment
                    WHERE expediente_id = ANY(%(ids)s::uuid[])
                      AND transferencia_id IS NOT NULL
                      AND is_active = TRUE
                )
                SELECT cl.kind, COALESCE(ck.label, cl.kind), cl.label,
                       cl.amount, cl.currency, cl.fx_to_usd, cl.amount_usd, cl.source
                FROM transfers.cost_line cl
                LEFT JOIN transfers.cost_kind_cat ck ON ck.codigo = cl.kind
                WHERE cl.transferencia_id IN (SELECT transferencia_id FROM trf)
                  AND cl.is_active = TRUE
                ORDER BY cl.kind, cl.created_at
                """,
                {"ids": ids_for_costs},
            )
            for cr in c.fetchall():
                amt_usd = float(cr[6]) if cr[6] is not None else 0.0
                extra += amt_usd
                cost_breakdown.append({
                    "kind":       cr[0],
                    "label":      cr[2] or cr[1] or cr[0],
                    "amount":     float(cr[3]) if cr[3] is not None else 0.0,
                    "currency":   cr[4] or "USD",
                    "fx_to_usd":  float(cr[5]) if cr[5] is not None else 1.0,
                    "amount_usd": amt_usd,
                    "source":     cr[7] or "MANUAL",
                })
    except Exception:
        log.exception("[factura_payload] transfer costs lookup failed id=%s", pid)

    # 3b) context_data de la transferencia ligada (vista dual MWT/Cliente).
    #     buildTransferInvoiceHtml lee context_data.views[audience] para
    #     aplicar tasas (DAI/Ley/IVA), overrides de línea e impuestos custom
    #     guardados por vista. Sin esto la factura del expediente ignoraría
    #     las modificaciones hechas en el detalle de la transferencia.
    trf_id = None
    trf_codigo = None
    trf_legal = None
    trf_tracking = ""
    trf_context_data = {}
    trf_origen_id = None
    trf_destino_id = None
    trf_origen_label = None
    trf_destino_label = None
    trf_dispatched_at = None
    trf_received_at = None
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT t.id, t.codigo, t.legal_context,
                       COALESCE(t.ref_tracking, ''), t.context_data,
                       t.origen_id, t.destino_id,
                       t.origen_label, t.destino_label,
                       t.dispatched_at, t.received_at
                FROM transfers.transferencia t
                WHERE t.id IN (
                    SELECT DISTINCT transferencia_id
                    FROM inventario.expediente_nodo_assignment
                    WHERE expediente_id = ANY(%(ids)s::uuid[])
                      AND transferencia_id IS NOT NULL
                      AND is_active = TRUE
                )
                ORDER BY t.created_at DESC
                LIMIT 1
                """,
                {"ids": ids_for_costs},
            )
            tr = c.fetchone()
        if tr:
            trf_id = str(tr[0]) if tr[0] else None
            trf_codigo = tr[1]
            trf_legal = tr[2]
            trf_tracking = tr[3] or ""
            cd = tr[4]
            if isinstance(cd, str):
                try:
                    cd = json.loads(cd)
                except (ValueError, TypeError):
                    cd = {}
            trf_context_data = cd if isinstance(cd, dict) else {}
            trf_origen_id = str(tr[5]) if tr[5] else None
            trf_destino_id = str(tr[6]) if tr[6] else None
            trf_origen_label = tr[7] or None
            trf_destino_label = tr[8] or None
            trf_dispatched_at = tr[9]
            trf_received_at = tr[10]
    except Exception:
        log.exception("[factura_payload] transfer context_data lookup failed id=%s", pid)

    # 3c) DAI vivo por NCM (productos.ncm_code.tarifas) según origen→destino de
    #     la transferencia ligada. Igual que invoice_payload (transfers): la
    #     factura del expediente debe traer el arancel real, no un hardcode 0.14.
    ncm_dai_map = {}
    try:
        origen_iso = ""
        destino_iso = ""
        _node_ids = [x for x in (trf_origen_id, trf_destino_id) if x]
        if _node_ids:
            with connection.cursor() as c:
                c.execute(
                    "SELECT id, UPPER(COALESCE(pais_iso2, '')) "
                    "FROM nodos.nodo WHERE id = ANY(%(ids)s::uuid[])",
                    {"ids": _node_ids},
                )
                _paises = {str(rr[0]): rr[1] for rr in c.fetchall()}
            origen_iso = _paises.get(trf_origen_id or "", "")
            destino_iso = _paises.get(trf_destino_id or "", "")
        _codes = sorted({r[8] for r in rows if r[8]})
        if _codes and destino_iso:
            with connection.cursor() as c:
                c.execute(
                    "SELECT code, tarifas FROM productos.ncm_code "
                    "WHERE code = ANY(%(codes)s) AND is_active = TRUE",
                    {"codes": _codes},
                )
                for code, tarifas in c.fetchall():
                    if isinstance(tarifas, str):
                        try:
                            tarifas = json.loads(tarifas)
                        except (ValueError, TypeError):
                            tarifas = []
                    rate = None
                    for tf in (tarifas or []):
                        if (str(tf.get("origin_iso2", "")).upper() == origen_iso
                                and str(tf.get("destination_iso2", "")).upper() == destino_iso):
                            rate = tf.get("rate_pct")
                            break
                    if rate is not None:
                        ncm_dai_map[code] = float(rate) / 100.0
    except Exception:
        log.exception("[factura_payload] ncm dai rate lookup failed id=%s", pid)

    # 4) Construir líneas + totales.
    lineas = []
    units = 0
    fob = 0.0
    for r in rows:
        try:
            qty = int(float(r[3] or 0))
        except (TypeError, ValueError):
            qty = 0
        mwt = float(r[4]) if r[4] is not None else 0.0
        client = float(r[5]) if r[5] is not None else 0.0
        units += qty
        fob += qty * mwt
        lineas.append({
            "sku":               r[1] or "",
            "product_label":     r[7] or "",
            "size":              r[2] or "",
            "producto_id":       str(r[6]) if r[6] else None,
            "qty_planned":       qty,
            "qty_dispatched":    None,
            "qty_received":      None,
            "unit_value_usd":    mwt,
            "unit_cost_usd":     mwt,
            "cost_share_usd":    0.0,
            "landed_cost_usd":   None,
            "estado_discrepancia": None,
            "unit_price_mwt":    mwt,
            "unit_price_client": client,
            "operating_company_id": op_id,
            "expediente_codigo": codigo,
            "proforma_codigo":   codigo,
            "ncm":               r[8],
            "dai_rate":          ncm_dai_map.get(r[8]),
            # Sprint 2026-06-10 · SAP y nodo por línea (modal del Cronograma).
            "sap":               r[10] or "",
            "nodo":              r[11] or "",
        })

    landed = fob + extra

    # Sprint 2026-06-10 (rev) · overrides manuales de días por fase.
    # `pid` puede ser expediente_id u oc_id (página OC-céntrica). Además
    # matcheamos por los expedientes REALES de las líneas resueltas
    # (l.expediente_id) — cubre el caso en que el id del export no coincide
    # 1:1 con expedientes.expediente.id/oc_id. Se prefiere el override
    # NO-vacío más recientemente actualizado.
    phase_durations = {}
    _line_exp_ids = sorted({str(r[9]) for r in rows if r[9]})
    with connection.cursor() as c:
        c.execute(
            """
            SELECT e.phase_durations_json
            FROM expedientes.expediente e
            WHERE (e.id = %(id)s::uuid
                   OR e.oc_id = %(id)s::uuid
                   OR e.id = ANY(%(line_ids)s::uuid[]))
              AND e.is_active = TRUE
            ORDER BY (e.phase_durations_json IS NOT NULL
                      AND e.phase_durations_json <> '{}'::jsonb) DESC,
                     e.updated_at DESC
            LIMIT 1
            """,
            {"id": pid, "line_ids": _line_exp_ids},
        )
        _pd_row = c.fetchone()
        _pd_val = _pd_row[0] if _pd_row else None
        # jsonb puede llegar como STRING en cursor crudo según el driver.
        if isinstance(_pd_val, str):
            try:
                _pd_val = json.loads(_pd_val)
            except (ValueError, TypeError):
                _pd_val = None
        if isinstance(_pd_val, dict):
            phase_durations = _pd_val

    return Response({
        "kind": "FACTURA_COMERCIAL",
        "doc_kind_label": "FACTURA COMERCIAL",
        "proforma_codigo": proforma_codigo or codigo,
        "oc_codigo": oc_codigo or proforma_codigo or codigo,
        "phase_durations": phase_durations,
        "shipping": _sp.get("shipping") or {},
        "packing": _sp.get("packing") or {},
        "transferencia": {
            "id":             trf_id or pid,
            "codigo":         trf_codigo or codigo,
            "legal_context":  trf_legal or "NATIONALIZATION",
            "estado":         estado,
            "ref_tracking":   trf_tracking,
            "value_usd":      fob,
            "total_cost_usd": extra,
            # context_data real de la transferencia → vista dual MWT/Cliente.
            "context_data":   trf_context_data,
        },
        "operating_company": {
            "operated_by_mwt":         operated_by_mwt,
            "operating_company_id":    op_id,
            "operating_company_label": "Muito Work Limitada" if operated_by_mwt else (cliente or "Cliente final"),
            "client_name":             cliente,
            "mwt_operating_client_id": str(MWT_OPERATING_CLIENT_ID),
            "mwt_operator_name":       "Muito Work Limitada",
        },
        "origen":  {"label": trf_origen_label or "Muito Work Limitada"},
        "destino": {"label": trf_destino_label or (cliente or "Cliente")},
        "fechas":  {
            "created_at":    _dt.date.today().isoformat(),
            "dispatched_at": trf_dispatched_at.isoformat() if trf_dispatched_at else None,
            "received_at":   trf_received_at.isoformat() if trf_received_at else None,
        },
        "personas": {},
        "lineas": lineas,
        "cost_breakdown": cost_breakdown,
        "totales": {
            "fob_total_usd":           fob,
            "extra_costs_total_usd":   extra,
            "landed_total_usd":        landed,
            "avg_landed_per_unit_usd": (landed / units) if units else 0.0,
            "units_total":             units,
            "lines_count":             len(lineas),
        },
    })
