"""
=====================================================================
MWT.ONE · apps.ai_hub.chat_views
Agente responsable: [AG-BACKEND-LLM]

Endpoints conversacionales del AI Hub (NO catálogos).

  · POST /api/ai/chat/send/    — envía un mensaje al LLM y devuelve la
                                 respuesta del asistente + metadatos.
  · POST /api/ai/chat/upload/  — sube un archivo (multipart/form-data)
                                 y crea ai.attachment con texto extraído.

Reglas MWT respetadas:
  · Idempotencia por idempotence_token (early-return en send).
  · Storage local por defecto en /var/lib/mwt-one/ai-uploads/<user>/<uuid>-<filename>
    (configurable vía AI_HUB.UPLOAD_BUCKET; en producción debe migrarse
    al backend storage real — MinIO/S3).
  · Validación de tamaño (settings.AI_HUB.MAX_UPLOAD_MB).
  · No FK; UUIDs lógicos en thread_id / user_id.
=====================================================================
"""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

from django.conf import settings
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AiThread, AiMessage, AiAttachment
from .serializers import (
    AiMessageSerializer, AiAttachmentSerializer,
)
from .services import ChatService, FileProcessor

log = logging.getLogger(__name__)


# =====================================================================
# Helpers
# =====================================================================
def _cfg(key: str, default=None):
    return (getattr(settings, "AI_HUB", {}) or {}).get(key, default)


def _resolve_user_id(request, fallback: str | None = None) -> str | None:
    """Devuelve el UUID del usuario.  Prioridad:
        1. payload `user_id`        (el frontend lo manda explícitamente)
        2. JWT claim `user_uuid`    (SIMPLE_JWT.USER_ID_CLAIM)
        3. `fallback` recibido por el caller.
    """
    if fallback:
        return fallback
    # 2: JWT
    auth = getattr(request, "user", None)
    user_uuid = getattr(auth, "user_uuid", None) or getattr(auth, "id", None)
    if user_uuid:
        return str(user_uuid)
    # nada
    return None


def _upload_root() -> Path:
    """Ubicación del bucket local de uploads (mkdir -p si falta)."""
    root = Path(os.environ.get("AI_HUB_UPLOAD_DIR", "/var/lib/mwt-one/ai-uploads"))
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log.warning("No se pudo crear %s, fallback a /tmp: %s", root, e)
        root = Path("/tmp/mwt-one-ai-uploads")
        root.mkdir(parents=True, exist_ok=True)
    return root


# =====================================================================
# POST /api/ai/chat/send/
# =====================================================================
class ChatSendView(APIView):
    """Envía un mensaje al LLM y devuelve la respuesta del asistente.

    Payload JSON:
    {
      "thread_id":        "<uuid>",          # requerido
      "user_id":          "<uuid>",          # opcional si JWT lo provee
      "user_text":        "...",             # requerido (puede ser '' si solo adjuntos)
      "agent_ids":        ["<uuid>", ...],   # opcional — @-mentions ad-hoc
      "skill_ids":        ["<uuid>", ...],   # opcional — /-mentions ad-hoc
      "attachment_ids":   ["<uuid>", ...],   # opcional — adjuntos ya subidos
      "idempotence_token":"...",             # opcional
      "model":            "claude-sonnet-4-6",   # opcional (override por turno)
      "max_tokens":       4096,                  # opcional
      "temperature":      0.30                   # opcional
    }
    """
    parser_classes = (JSONParser,)

    def post(self, request):
        data = request.data or {}

        thread_id = data.get("thread_id")
        if not thread_id:
            return Response({"detail": "thread_id es requerido."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            thread = AiThread.objects.get(pk=thread_id, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        user_id = _resolve_user_id(request, data.get("user_id"))
        if not user_id:
            return Response({"detail": "user_id no resuelto (envía user_id o autentícate)."},
                            status=status.HTTP_400_BAD_REQUEST)

        user_text = (data.get("user_text") or "").strip()
        if not user_text and not (data.get("attachment_ids") or []):
            return Response({"detail": "user_text o attachment_ids requerido."},
                            status=status.HTTP_400_BAD_REQUEST)

        # ── HARD SHIELD CLIENT B2B ───────────────────────────────
        # Si el caller es CLIENT, ignoramos cualquier intento de orquestar
        # agentes/skills ad-hoc (menciones @ o /). El cliente sólo habla
        # con el Asistente MWT (SVC-01). Además, bloqueamos overrides de
        # modelo/temperatura — el cliente no puede forzar un modelo caro
        # (opus) ni subir la temperatura.
        role = (getattr(request.user, "role", "") or "").lower()
        _is_client = role in {"client_b2b", "cliente", "client"}

        if _is_client:
            extra_agent_ids = []     # ignorado (no orquesta)
            extra_skill_ids = []     # ignorado (no orquesta)
            model_override       = None
            max_tokens_override  = None
            temperature_override = None
            # Log silencioso si hubo intento de inyectar agents/skills.
            if data.get("agent_ids") or data.get("skill_ids"):
                log.warning(
                    "B2B orchestration spoof attempt: user=%s agent_ids=%s skill_ids=%s thread=%s",
                    getattr(request.user, "email", "?"),
                    data.get("agent_ids"), data.get("skill_ids"), thread_id,
                )
        else:
            extra_agent_ids = data.get("agent_ids") or []
            extra_skill_ids = data.get("skill_ids") or []
            model_override       = data.get("model")
            max_tokens_override  = data.get("max_tokens")
            temperature_override = data.get("temperature")

        try:
            result = ChatService.send(
                thread               = thread,
                user_id              = user_id,
                user_text            = user_text,
                extra_agent_ids      = extra_agent_ids,
                extra_skill_ids      = extra_skill_ids,
                attachment_ids       = data.get("attachment_ids") or [],
                idempotence_token    = data.get("idempotence_token"),
                model_override       = model_override,
                max_tokens_override  = max_tokens_override,
                temperature_override = temperature_override,
            )
        except Exception as e:
            log.exception("ChatService.send falló")
            return Response({"detail": f"Fallo interno: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        out = {
            "ok":              result.success,
            "assistant":       AiMessageSerializer(result.assistant_message).data,
            "error_code":      result.error_code,
            "error_message":   result.error_message,
        }
        # Devolvemos también el user-message recién persistido (parent).
        if result.assistant_message and result.assistant_message.parent_message_id:
            try:
                user_msg = AiMessage.objects.get(
                    pk=result.assistant_message.parent_message_id, is_active=True)
                out["user"] = AiMessageSerializer(user_msg).data
            except AiMessage.DoesNotExist:
                pass

        http_status = status.HTTP_200_OK if result.success else status.HTTP_502_BAD_GATEWAY
        return Response(out, status=http_status)


# =====================================================================
# POST /api/ai/chat/upload/
# =====================================================================
class ChatUploadView(APIView):
    """Sube un archivo y crea ai.attachment.

    multipart/form-data:
        file        — el binario
        user_id     — UUID del usuario (o vía JWT)
        thread_id   — opcional, si ya existe el hilo

    Devuelve el AiAttachment serializado con storage_url + extracted_text.
    """
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "Sube un archivo en `file`."},
                            status=status.HTTP_400_BAD_REQUEST)

        max_mb = int(_cfg("MAX_UPLOAD_MB", 25))
        if f.size > max_mb * 1024 * 1024:
            return Response(
                {"detail": f"Archivo excede {max_mb} MB."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        user_id = _resolve_user_id(request, request.data.get("user_id"))
        if not user_id:
            return Response({"detail": "user_id requerido."},
                            status=status.HTTP_400_BAD_REQUEST)

        thread_id = request.data.get("thread_id") or None
        # Validar thread si se envió
        if thread_id:
            if not AiThread.objects.filter(pk=thread_id, is_active=True).exists():
                return Response({"detail": "Thread no existe."},
                                status=status.HTTP_404_NOT_FOUND)

        # Persistencia binaria (storage local)
        root = _upload_root()
        user_dir = root / str(user_id)
        try:
            user_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning("No se pudo crear dir %s: %s", user_dir, e)
            return Response({"detail": "Storage no disponible."},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        safe_name = "".join(c for c in f.name if c.isalnum() or c in (".", "-", "_"))[:200] or "upload.bin"
        token = uuid.uuid4().hex[:12]
        target = user_dir / f"{token}-{safe_name}"

        data = b""
        try:
            with open(target, "wb") as out_f:
                for chunk in f.chunks():
                    out_f.write(chunk)
                    data += chunk
        except Exception as e:
            log.exception("Fallo al guardar upload")
            return Response({"detail": f"Fallo al persistir: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            att = FileProcessor.persist_upload(
                user_id        = user_id,
                thread_id      = thread_id,
                filename       = f.name,
                mime           = f.content_type or "application/octet-stream",
                data           = data,
                storage_url    = str(target),
                storage_backend= "local",
                storage_bucket = _cfg("UPLOAD_BUCKET"),
                storage_key    = str(target.relative_to(root)),
            )
        except Exception as e:
            log.exception("FileProcessor.persist_upload falló")
            return Response({"detail": f"Fallo al procesar: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(AiAttachmentSerializer(att).data, status=status.HTTP_201_CREATED)
