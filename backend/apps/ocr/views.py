"""
=====================================================================
MWT.ONE · apps.ocr.views
Agente responsable: [AG-BACKEND]

Endpoints del wizard OCR:

  POST /api/ocr/parse-oc/
        multipart/form-data · field "file" (PDF de OC)
        → 200 { ok, payload:{client, brand, po, lines, …} }
        → 400 si el archivo no es PDF o está vacío
        → 422 si el OCR no extrajo nada útil (confidence = 0)

  POST /api/ocr/resolve-line/
        body: {client_id, sku, qty, unit_price}
        → devuelve el veredicto price_verdict + MOQ para UNA línea
          (útil cuando el usuario edita una fila en el Step 3 del
           wizard y queremos re-validar sin re-subir el PDF).

Seguridad:
  - IsAuthenticated (sesión o token DRF).
  - Límite hard-coded 10 MB por PDF.
  - El endpoint NO persiste nada en la DB — sólo parsea y devuelve.
    La persistencia la hace /api/expedientes/create-from-oc/
    (orchestrator) dentro de un transaction.atomic().
=====================================================================
"""
from __future__ import annotations

import logging

from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .services import parse_oc_auto, resolve_client_price

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB — aplica tanto a PDF como a XLSX
_SUPPORTED_EXTS = (".pdf", ".xlsx", ".xlsm")


# --------------------------------------------------------------------
# POST /api/ocr/parse-oc/
# --------------------------------------------------------------------
@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([IsAuthenticated])
def parse_oc(request):
    """Step 1 del wizard: recibe el PDF de la OC del cliente y
    devuelve el payload estructurado."""
    f = request.FILES.get("file")
    if not f:
        return Response({"ok": False, "error": "file_missing"}, status=400)

    # Validación tipo + tamaño — soportamos .pdf y .xlsx
    name = (f.name or "").lower()
    if not any(name.endswith(ext) for ext in _SUPPORTED_EXTS):
        return Response({
            "ok":    False,
            "error": "unsupported_format",
            "hint":  "Formatos soportados: .pdf, .xlsx",
        }, status=400)

    if f.size > MAX_FILE_BYTES:
        return Response({
            "ok":    False,
            "error": "file_too_large",
            "max_mb": MAX_FILE_BYTES / (1024 * 1024),
        }, status=400)

    file_bytes = b"".join(chunk for chunk in f.chunks())

    try:
        # parse_oc_auto rutea internamente a parse_oc_pdf (Paperless+pdfminer)
        # o parse_oc_xlsx (pandas) según la extensión/magic bytes del archivo.
        result = parse_oc_auto(file_bytes, f.name)
    except Exception as e:
        log.exception("parse_oc_auto crashed: %s", e)
        return Response({"ok": False, "error": f"ocr_crashed: {e}"}, status=500)

    if not result.get("ok"):
        return Response(result, status=422)

    payload = result["payload"]

    # Enriquecer cada línea con el veredicto price + MOQ
    client_candidates = (payload.get("client") or {}).get("_candidates") or []
    client_id = client_candidates[0]["id"] if client_candidates else None

    for line in payload.get("lines") or []:
        verdict = resolve_client_price(
            client_id=client_id,
            sku=line.get("sku"),
            qty=line.get("qty") or 0,
            unit_price=line.get("unit_price") or 0,
        )
        line.update({
            "system_unit_price": verdict["system_unit_price"],
            "price_delta_pct":   verdict["price_delta_pct"],
            "price_verdict":     verdict["price_verdict"],
            "moq_client":        verdict["moq_client"],
            "moq_violated":      verdict["moq_violated"],
            "validation_notes":  verdict["notes"],
            "producto_id":       verdict.get("producto_id"),
        })

    if payload.get("confidence", 0) < 0.05 and not payload.get("lines"):
        return Response({
            "ok":      False,
            "error":   "ocr_empty",
            "payload": payload,
            "hint":    "El PDF no contiene texto seleccionable. Escanee con OCR más nítido o introduzca datos manualmente.",
        }, status=422)

    return Response({"ok": True, "payload": payload})


# --------------------------------------------------------------------
# POST /api/ocr/resolve-line/
# --------------------------------------------------------------------
@api_view(["POST"])
@parser_classes([JSONParser])
@permission_classes([IsAuthenticated])
def resolve_line(request):
    """Step 3 del wizard: revalida UNA línea (cuando el CEO edita
    qty/unit_price a mano)."""
    body = request.data or {}
    verdict = resolve_client_price(
        client_id=body.get("client_id"),
        sku=body.get("sku"),
        qty=float(body.get("qty") or 0),
        unit_price=float(body.get("unit_price") or 0),
    )
    return Response({"ok": True, "verdict": verdict})
