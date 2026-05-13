"""
apps.ai_hub.document_extract_views
==================================

Sprint 2026-05-11 · Fase 7 — Endpoint genérico `POST /api/ai/document/extract/`
que recibe un archivo y la estructura de un template del Builder y
devuelve los campos autocompletados con IA.

Diseño: ver `document_extractor.py`. Esta view sólo orquesta:
  · valida payload (file + structure)
  · llama a `extract_fields_from_document()`
  · devuelve JSON al cliente

CEO use case: en `ArtifactFillModal` el operador arrastra un PDF/Excel/
Word/txt antes de la Sección 1; al detectar el archivo, el frontend
manda este endpoint y pre-rellena los campos del template.
"""
from __future__ import annotations

import json
import logging

from rest_framework.parsers import MultiPartParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .document_extractor import extract_fields_from_document


log = logging.getLogger(__name__)

# Límite duro del tamaño aceptado por el endpoint (defensa adicional al
# que ya impone Django/nginx). 25 MB cubre 99% de los PDFs comerciales.
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024


class DocumentExtractView(APIView):
    """POST /api/ai/document/extract/  (multipart/form-data)

    Form fields:
      - file: el documento (PDF/Excel/Word/txt/imagen).
      - structure: JSON string con el structure_json del template del
        Builder. Forma esperada:
          { "sections": [
              { "id": "...", "title": "...",
                "columns": [
                  { "id": "...",
                    "fields": [ { "id": "...", "type": "text|select|radio|...",
                                  "label": "...", "options": [...], ... } ]
                  }, ... ]
              }, ... ]
          }
      - model: opcional, override del modelo Anthropic.

    Respuesta (200):
      {
        "extracted":  { field_id: value, ... },
        "confidence": { field_id: 0-100, ... },
        "notes":      str,
        "_meta": { model, kind, fields_in_schema, fields_extracted, ... }
      }

    Errores:
      400 — missing file / structure inválida / archivo demasiado grande.
      Sigue siendo 200 si la IA falla — el body trae `_meta.error` y el
      FE muestra un toast pero no rompe el modal.
    """
    permission_classes = [IsAuthenticated]
    parser_classes     = [MultiPartParser, JSONParser]

    def post(self, request):
        f = request.FILES.get("file")
        if f is None:
            return Response({"detail": "file es requerido"}, status=400)

        if f.size and f.size > MAX_FILE_SIZE_BYTES:
            mb = round(f.size / (1024 * 1024), 1)
            return Response({
                "detail": (
                    f"Archivo demasiado grande ({mb} MB). "
                    f"Límite: {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."
                ),
            }, status=400)

        # structure puede venir como string JSON (form-data) o como dict
        # cuando el cliente manda multipart/related; soportamos ambas.
        raw_struct = request.data.get("structure")
        if raw_struct is None:
            return Response({"detail": "structure es requerido"}, status=400)
        if isinstance(raw_struct, str):
            try:
                structure_json = json.loads(raw_struct)
            except Exception as exc:
                return Response({
                    "detail": f"structure no es JSON válido: {exc}",
                }, status=400)
        elif isinstance(raw_struct, dict):
            structure_json = raw_struct
        else:
            return Response({
                "detail": "structure debe ser JSON object o string JSON",
            }, status=400)

        if not isinstance(structure_json, dict):
            return Response({"detail": "structure debe ser un objeto"},
                            status=400)

        # Modelo override (opcional)
        model = (request.data.get("model") or "").strip() or None

        file_bytes = f.read()
        try:
            result = extract_fields_from_document(
                file_bytes     = file_bytes,
                mime_type      = f.content_type or "",
                filename       = f.name or "",
                structure_json = structure_json,
                model          = model,
            )
        except Exception as exc:
            log.exception("DocumentExtractView · extract failed")
            return Response({
                "extracted":  {},
                "confidence": {},
                "notes":      "",
                "_meta": {"error": f"extract error: {exc}"},
            }, status=200)

        return Response(result, status=200)
