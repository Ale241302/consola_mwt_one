"""
=====================================================================
MWT.ONE · apps.expedientes.views_sap_analyze
Agente responsable: [AG-BACKEND]

Sprint 2026-05-04 · endpoint dedicado al ANÁLISIS PREVIO de
Confirmación SAP — se invoca ANTES del confirm-sap/upsert-sap, desde
el drawer "Agregar SAP" del frontend, para pre-poblar y validar los
datos del documento contra las líneas reales del expediente.

  POST /api/expedientes/{id}/analyze-sap-confirmation/
       Body multipart:
         · file: xlsx | xls | csv | pdf  (≤ 25 MB)
       Response:
         {
           ok, kind, filename, sap_id, sap_count, all_saps,
           lineas:        [{ sap_doc, sku, talla, qty, descripcion,
                            raw_material, match: { matched, line_id,
                            qty_exp, qty_diff, name_match, ... } }],
           discrepancies: [{ kind, severity, sku, talla, qty_doc,
                            qty_exp, descripcion, ... }],
           summary:       { lines_in_doc, lines_matched,
                            lines_unmatched, discrepancies_count,
                            perfect_match }
         }

Visibilidad: CEO/ADMIN-only (CLIENT_* → 403).

NO persiste nada — es un análisis stateless. El usuario decide en
el drawer qué líneas agregar al SAP, y luego el confirm-sap /
upsert-sap final hace la persistencia.
=====================================================================
"""
from __future__ import annotations

import logging

from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Expediente
from .sap_extractor import analyze_sap_document
from .views import _deny_client_mutation

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
ALLOWED_EXT = (".xlsx", ".xlsm", ".xls", ".pdf", ".csv")


class AnalyzeSapConfirmationView(APIView):
    """Analiza un documento de Confirmación SAP (xlsx / pdf / csv) y
    devuelve el cruce contra expedientes.linea sin persistir."""

    permission_classes = [IsAuthenticated]
    parser_classes     = [MultiPartParser, FormParser]

    def post(self, request, expediente_id=None):
        denied = _deny_client_mutation(
            request, action_label="expediente.analyze_sap_confirmation",
        )
        if denied is not None:
            return denied

        f = request.FILES.get("file") or request.FILES.get("documento_sap")
        if not f:
            return Response(
                {"detail": "Falta el archivo. Esperado bajo el campo 'file'."},
                status=400,
            )

        filename     = f.name or "documento"
        content_type = (getattr(f, "content_type", None) or
                        "application/octet-stream")

        fname_lower = filename.lower()
        if not any(fname_lower.endswith(ext) for ext in ALLOWED_EXT):
            return Response(
                {"detail": f"Extensión no soportada. Permitidas: {ALLOWED_EXT}"},
                status=400,
            )

        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        file_bytes = b"".join(chunk for chunk in f.chunks())
        if len(file_bytes) > MAX_FILE_BYTES:
            return Response(
                {"detail": f"Archivo > {MAX_FILE_BYTES // (1024 * 1024)} MB."},
                status=413,
            )

        try:
            result = analyze_sap_document(
                file_bytes=file_bytes,
                filename=filename,
                content_type=content_type,
                expediente_id=str(exp.id),
            )
        except Exception as e:
            log.exception("[analyze-sap] extractor falló")
            return Response(
                {"detail": "extractor_failed", "error": str(e)},
                status=500,
            )

        # Auditable: log breve. NO persistimos en BD — esta vista es
        # stateless por diseño (el confirm-sap/upsert-sap es quien
        # persiste con el ART-04 final).
        log.info(
            "[analyze-sap] expediente=%s filename=%s kind=%s sap_id=%s "
            "lines=%d matched=%d disc=%d",
            exp.id, filename, result.get("kind"), result.get("sap_id"),
            (result.get("summary") or {}).get("lines_in_doc", 0),
            (result.get("summary") or {}).get("lines_matched", 0),
            (result.get("summary") or {}).get("discrepancies_count", 0),
        )

        return Response({
            "ok":             bool(result.get("ok")),
            "expediente_id":  str(exp.id),
            "filename":       result.get("filename") or filename,
            "kind":           result.get("kind"),
            "sap_id":         result.get("sap_id"),
            "sap_count":      result.get("sap_count") or 0,
            "all_saps":       result.get("all_saps") or [],
            "lineas":         result.get("lineas") or [],
            "discrepancies":  result.get("discrepancies") or [],
            "summary":        result.get("summary") or {},
            "error":          result.get("error"),
        }, status=200)
