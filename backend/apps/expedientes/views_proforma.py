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
