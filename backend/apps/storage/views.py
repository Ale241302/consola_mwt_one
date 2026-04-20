"""
=====================================================================
MWT.ONE · apps.storage.views
Agente responsable: [AG-BACKEND]

Expone:
  POST /api/storage/signed_url/        → firma GET o PUT para MinIO.
  POST /api/storage/paperless_ingest/  → sube a Paperless-ngx y devuelve task_id.
  GET  /api/storage/healthz/           → estado de los gateways.

Reglas:
  - NO confundir con /api/documentos/ (ese es el índice de dominio). Aquí
    sólo se firma / se ingesta.
  - TTL por defecto 15 min (máx 7d).
=====================================================================
"""
import base64
import logging

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from .services import generate_signed_url, paperless_ingest, ensure_bucket

log = logging.getLogger(__name__)


class StorageViewSet(viewsets.ViewSet):
    """ViewSet liviano, sin `basename`, expuesto vía DefaultRouter en urls.py."""
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @action(detail=False, methods=["get", "post"])
    def signed_url(self, request):
        """
        Body (JSON) o query params:
            { key: str, kind: "get"|"put", ttl: int, bucket?: str }

        Respuesta:
            { url, method, expires_at, bucket, key, available }
        """
        src  = request.data if request.method == "POST" else request.query_params
        key  = src.get("key")
        kind = (src.get("kind") or "get").lower()
        ttl  = int(src.get("ttl") or 900)
        bkt  = src.get("bucket") or None

        if not key:
            return Response({"detail": "Falta 'key'"}, status=400)

        data = generate_signed_url(key=key, kind=kind, ttl=ttl, bucket=bkt)
        return Response(data)

    @action(detail=False, methods=["post"])
    def paperless_ingest(self, request):
        """
        Dos modos de entrada:
            A) multipart/form-data: file=<binario>, filename, title, correspondent, ...
            B) JSON: { filename, title, body_b64 }

        Respuesta:
            { ok, task_id, status, error, expediente_id?, documento_id? }
        """
        title         = request.data.get("title") or None
        filename      = request.data.get("filename") or "documento.pdf"
        correspondent = request.data.get("correspondent") or None
        document_type = request.data.get("document_type") or None
        tags          = request.data.get("tags") or None

        # Relación con expediente/documento para auditar el OCR (opcional)
        expediente_id = request.data.get("expediente_id") or None
        documento_id  = request.data.get("documento_id")  or None

        # ── Leer bytes del archivo ─────
        file_bytes: bytes
        f = request.FILES.get("file")
        if f is not None:
            file_bytes = f.read()
            filename   = filename or f.name
        else:
            b64 = request.data.get("body_b64") or request.data.get("body") or ""
            if not b64:
                return Response({"detail": "Falta 'file' (multipart) o 'body_b64' (JSON)."}, status=400)
            try:
                file_bytes = base64.b64decode(b64)
            except Exception:
                return Response({"detail": "body_b64 no es base64 válido."}, status=400)

        result = paperless_ingest(
            file_bytes    = file_bytes,
            filename      = filename,
            title         = title,
            correspondent = correspondent,
            document_type = document_type,
            tags          = tags,
        )
        result["expediente_id"] = expediente_id
        result["documento_id"]  = documento_id
        return Response(result)

    @action(detail=False, methods=["get"])
    def healthz(self, request):
        """Diagnóstico rápido de los gateways de storage."""
        from django.conf import settings
        minio_ok = ensure_bucket()
        paperless_configured = bool(
            getattr(settings, "PAPERLESS_URL", "") and
            getattr(settings, "PAPERLESS_TOKEN", "")
        )
        return Response({
            "minio_available":        minio_ok,
            "minio_bucket":           getattr(settings, "MINIO_BUCKET", ""),
            "paperless_configured":   paperless_configured,
        })
