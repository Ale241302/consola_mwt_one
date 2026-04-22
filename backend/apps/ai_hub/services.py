"""
=====================================================================
MWT.ONE · apps.ai_hub.services
Agente responsable: [AG-BACKEND-LLM]

Capa de orquestación LLM del AI Hub.

ContextBuilder
    Ensambla el `system_prompt` combinando Agentes + Skills + Instrucciones
    anclados a un hilo, respetando prioridades (instrucciones primero, luego
    agentes, luego skills). Se respeta el scope de cada instrucción y se
    dedupe por (codigo, nombre).

FileProcessor
    Extracción de texto para PDFs (pypdf) y TXT; imágenes se preparan como
    bloques `image` base64 multimodal. Todo persistido en `ai.attachment`
    con `processing_status` = {pending, processing, ready, failed}.

ChatService
    Llamada a Anthropic con backoff exponencial (MAX_RETRIES, base, cap,
    jitter). HTTP 400/403 = no retry. HTTP 429/5xx = retry. Telemetría
    siempre append-only a `ai.usage_log`, incluso en errores.

Todas las funciones son defensivas — si Anthropic SDK / pypdf no están
disponibles, el sistema degrada a respuestas canned y extracción vacía,
en vez de romper la request.
=====================================================================
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import (
    AiAgent, AiSkill, AiInstruction,
    AiThread, AiThreadContext, AiMessage,
    AiAttachment, AiUsageLog,
)

log = logging.getLogger(__name__)


# =====================================================================
# Config helper — lee settings.AI_HUB con defaults seguros.
# =====================================================================
def _cfg(key: str, default=None):
    return (getattr(settings, "AI_HUB", {}) or {}).get(key, default)


# =====================================================================
# ContextBuilder — arma system_prompt + context_snapshot por turno.
# =====================================================================
@dataclass
class BuiltContext:
    system_prompt:     str
    context_snapshot:  dict = field(default_factory=dict)
    agents:            list[AiAgent] = field(default_factory=list)
    skills:            list[AiSkill] = field(default_factory=list)
    instructions:      list[AiInstruction] = field(default_factory=list)
    preferred_model:   str = ""
    preferred_temperature: float | None = None


class ContextBuilder:
    """Ensambla el system_prompt final a partir del estado de un hilo."""

    SEP = "\n\n───\n\n"

    @classmethod
    def build(cls, thread: AiThread, extra_agent_ids: list[str] | None = None,
              extra_skill_ids: list[str] | None = None) -> BuiltContext:
        """Construye el contexto del hilo + overrides puntuales del mensaje.

        `extra_agent_ids` / `extra_skill_ids` → mentions ad-hoc (@/ en el
        mensaje actual) que se suman al anclaje persistente del hilo.
        """
        # 1) instrucciones globales auto_inject (siempre, todas las threads)
        globals_qs = AiInstruction.objects.filter(
            is_active=True, auto_inject=True, scope="global",
        ).order_by("prioridad", "codigo")

        # 2) anclajes persistentes del hilo
        anchors = AiThreadContext.objects.filter(
            thread_id=thread.id, is_active=True,
        ).order_by("position", "created_at")

        anchored_agent_ids        = [str(a.ref_id) for a in anchors if a.ref_type == "agent"]
        anchored_skill_ids        = [str(a.ref_id) for a in anchors if a.ref_type == "skill"]
        anchored_instruction_ids  = [str(a.ref_id) for a in anchors if a.ref_type == "instruction"]

        # 3) overrides ad-hoc (@/ del mensaje actual)
        ad_hoc_agent_ids  = [str(x) for x in (extra_agent_ids or [])]
        ad_hoc_skill_ids  = [str(x) for x in (extra_skill_ids or [])]

        all_agent_ids = list(dict.fromkeys(anchored_agent_ids + ad_hoc_agent_ids))
        all_skill_ids = list(dict.fromkeys(anchored_skill_ids + ad_hoc_skill_ids))

        agents = list(AiAgent.objects.filter(
            id__in=all_agent_ids, is_active=True)) if all_agent_ids else []
        skills = list(AiSkill.objects.filter(
            id__in=all_skill_ids, is_active=True)) if all_skill_ids else []
        per_thread_instr = list(AiInstruction.objects.filter(
            id__in=anchored_instruction_ids, is_active=True,
        )) if anchored_instruction_ids else []

        # 4) mantén orden estable por anclaje
        agents_by_id = {str(a.id): a for a in agents}
        skills_by_id = {str(s.id): s for s in skills}
        agents_ordered = [agents_by_id[i] for i in all_agent_ids if i in agents_by_id]
        skills_ordered = [skills_by_id[i] for i in all_skill_ids if i in skills_by_id]

        # 5) arma el system_prompt
        parts: list[str] = []
        # 5.a Instrucciones globales auto_inject (orden por prioridad).
        for ins in globals_qs:
            parts.append(f"### {ins.titulo}\n{ins.contenido}")
        # 5.b Instrucciones ancladas del hilo (respeta prioridad).
        for ins in sorted(per_thread_instr, key=lambda x: (x.prioridad, x.codigo)):
            parts.append(f"### {ins.titulo}\n{ins.contenido}")
        # 5.c Agentes activos (cada uno con su prompt_base).
        for ag in agents_ordered:
            header = f"### Agente: {ag.nombre} ({ag.rol})"
            parts.append(f"{header}\n{ag.prompt_base}")
        # 5.d Skills activas (cada una con su system_prompt).
        for sk in skills_ordered:
            header = f"### Skill: {sk.nombre}"
            parts.append(f"{header}\n{sk.system_prompt}")

        system_prompt = cls.SEP.join(parts).strip() or (
            "Eres un asistente de MWT.ONE. Responde en español, sé conciso "
            "y no inventes datos."
        )

        # 6) snapshot — se persiste en ai.message.context_snapshot
        context_snapshot = {
            "instructions": [
                {"id": str(i.id), "codigo": i.codigo, "titulo": i.titulo,
                 "scope": i.scope, "prioridad": i.prioridad}
                for i in list(globals_qs) + per_thread_instr
            ],
            "agents": [
                {"id": str(a.id), "codigo": a.codigo, "nombre": a.nombre, "rol": a.rol}
                for a in agents_ordered
            ],
            "skills": [
                {"id": str(s.id), "codigo": s.codigo, "nombre": s.nombre,
                 "category": s.category}
                for s in skills_ordered
            ],
        }

        # 7) modelo/temperature preferidos: el primer agente manda.
        preferred_model = (
            agents_ordered[0].model_default if agents_ordered else _cfg(
                "DEFAULT_MODEL", "claude-sonnet-4-6")
        )
        preferred_temperature = (
            float(agents_ordered[0].temperature_default)
            if agents_ordered else _cfg("TEMPERATURE", 0.30)
        )

        return BuiltContext(
            system_prompt         = system_prompt,
            context_snapshot      = context_snapshot,
            agents                = agents_ordered,
            skills                = skills_ordered,
            instructions          = list(globals_qs) + per_thread_instr,
            preferred_model       = preferred_model,
            preferred_temperature = preferred_temperature,
        )


# =====================================================================
# FileProcessor — extrae texto/bytes de adjuntos persistentes.
# =====================================================================
class FileProcessor:
    """Extrae texto de PDFs/TXT y prepara imágenes para multimodal."""

    TEXT_MIMES = (
        "text/plain", "text/markdown", "text/csv",
        "application/json", "text/html", "text/xml",
    )
    PDF_MIMES = ("application/pdf",)
    IMAGE_MIMES = (
        "image/jpeg", "image/jpg", "image/png",
        "image/webp", "image/gif",
    )

    @classmethod
    def is_image(cls, mime: str) -> bool:
        return (mime or "").lower() in cls.IMAGE_MIMES

    @classmethod
    def extract_pdf_text(cls, data: bytes) -> tuple[str, int]:
        """Devuelve (texto, pages). Si pypdf no está disponible, ('', 0)."""
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception as e:
            log.warning("pypdf no disponible: %s", e)
            return "", 0
        try:
            reader = PdfReader(io.BytesIO(data))
            out = []
            for page in reader.pages:
                try:
                    out.append(page.extract_text() or "")
                except Exception:
                    out.append("")
            text = "\n\n".join(out).strip()
            return text, len(reader.pages)
        except Exception as e:
            log.warning("extract_pdf_text falló: %s", e)
            return "", 0

    @classmethod
    def extract_text(cls, filename: str, mime: str, data: bytes) -> tuple[str, int]:
        """Devuelve (texto, pages).  Pages=0 para no-PDF."""
        mime_l = (mime or "").lower()
        if mime_l in cls.TEXT_MIMES:
            try:
                return data.decode("utf-8", errors="replace"), 0
            except Exception:
                return "", 0
        if mime_l in cls.PDF_MIMES:
            return cls.extract_pdf_text(data)
        return "", 0

    @classmethod
    def image_dimensions(cls, data: bytes) -> tuple[int | None, int | None]:
        try:
            from PIL import Image  # type: ignore
            img = Image.open(io.BytesIO(data))
            return img.width, img.height
        except Exception as e:
            log.debug("image_dimensions falló: %s", e)
            return None, None

    @classmethod
    def persist_upload(cls, *, user_id: str, thread_id: str | None,
                       filename: str, mime: str, data: bytes,
                       storage_url: str, storage_backend: str = "local",
                       storage_bucket: str | None = None,
                       storage_key: str | None = None) -> AiAttachment:
        """Crea ai.attachment con extracted_text / sha256 / dims si aplica."""
        sha256 = hashlib.sha256(data).hexdigest()
        is_image = cls.is_image(mime)
        text, pages = ("", 0) if is_image else cls.extract_text(filename, mime, data)
        w, h = cls.image_dimensions(data) if is_image else (None, None)

        att = AiAttachment.objects.create(
            id               = uuid.uuid4(),
            thread_id        = thread_id,
            message_id       = None,
            user_id          = user_id,
            filename         = filename,
            mime_type        = mime,
            size_bytes       = len(data),
            storage_backend  = storage_backend,
            storage_url      = storage_url,
            storage_bucket   = storage_bucket,
            storage_key      = storage_key,
            sha256           = sha256,
            extracted_text   = text or None,
            extracted_chars  = len(text) if text else None,
            extracted_pages  = pages or None,
            is_image         = is_image,
            image_width      = w,
            image_height     = h,
            processing_status= "ready",
            metadata         = {},
            is_active        = True,
        )
        return att

    @classmethod
    def to_anthropic_block(cls, att: AiAttachment, data: bytes | None = None) -> dict | None:
        """Convierte un adjunto en un `content block` apto para Anthropic.

        Imágenes → {type:"image", source:{type:"base64", media_type, data}}.
        Textuales → se devuelve None (los anexamos como texto extra en el user message).
        """
        if att.is_image:
            if data is None:
                return None  # sin bytes en memoria, skip
            b64 = base64.standard_b64encode(data).decode("ascii")
            return {
                "type":   "image",
                "source": {
                    "type":       "base64",
                    "media_type": att.mime_type or "image/png",
                    "data":       b64,
                },
            }
        return None


# =====================================================================
# Retry helpers
# =====================================================================
class _NonRetryable(Exception):
    """HTTP 400/403 o error de cliente que NO debe reintentarse."""


class _Retryable(Exception):
    """HTTP 429/5xx u otros fallos transitorios."""


def _classify_anthropic_error(exc: Exception) -> Exception:
    """Decide si un error del SDK Anthropic es Retryable o NonRetryable."""
    status_code = getattr(exc, "status_code", None)
    if status_code in (400, 401, 403, 404, 422):
        return _NonRetryable(str(exc))
    if status_code in (408, 409, 425, 429) or (status_code and status_code >= 500):
        return _Retryable(str(exc))
    # errores sin status_code (red/timeout) → reintentar
    cls = exc.__class__.__name__.lower()
    if "timeout" in cls or "connection" in cls or "apierror" in cls:
        return _Retryable(str(exc))
    # por defecto no reintentar — evita loops infinitos en bugs de código.
    return _NonRetryable(str(exc))


# =====================================================================
# ChatService — orquesta la llamada a Anthropic.
# =====================================================================
@dataclass
class ChatResult:
    assistant_message: AiMessage
    success:           bool
    error_code:        str | None = None
    error_message:     str | None = None


class ChatService:
    """Capa principal de envío de mensaje al LLM."""

    # Pricing por millón de tokens (best-effort, sólo para reporte).
    PRICE_TABLE = {
        "claude-opus-4-6":            (15.0, 75.0),
        "claude-sonnet-4-6":          (3.0,  15.0),
        "claude-haiku-4-5-20251001":  (1.0,   5.0),
    }

    # --------- API principal ------------------------------------------
    @classmethod
    def send(cls, *,
             thread: AiThread,
             user_id: str,
             user_text: str,
             extra_agent_ids: list[str] | None = None,
             extra_skill_ids: list[str] | None = None,
             attachment_ids:  list[str] | None = None,
             idempotence_token: str | None = None,
             model_override: str | None = None,
             max_tokens_override: int | None = None,
             temperature_override: float | None = None) -> ChatResult:
        """Punto de entrada único.  Persiste user msg → llama LLM →
        persiste assistant msg + usage_log + actualiza thread totals.
        """
        # 1) idempotencia: si ya hubo un user-message con este token → early return
        if idempotence_token:
            existing = AiMessage.objects.filter(
                thread_id=thread.id, sender="user",
                idempotence_token=idempotence_token, is_active=True,
            ).first()
            if existing:
                # devuelve la respuesta assistant asociada (child con parent_message_id)
                child = AiMessage.objects.filter(
                    thread_id=thread.id, sender="assistant",
                    parent_message_id=existing.id, is_active=True,
                ).order_by("-created_at").first()
                if child:
                    return ChatResult(assistant_message=child, success=True)

        # 2) carga adjuntos (si hay) — snapshot ligero para la user-message
        attachments = []
        attachments_blob = []
        if attachment_ids:
            attachments = list(AiAttachment.objects.filter(
                id__in=attachment_ids, is_active=True, user_id=user_id))
            for a in attachments:
                attachments_blob.append({
                    "id":        str(a.id),
                    "filename":  a.filename,
                    "mime":      a.mime_type,
                    "size_kb":   round((a.size_bytes or 0) / 1024, 1),
                    "is_image":  a.is_image,
                    "pages":     a.extracted_pages,
                })

        # 3) construye contexto
        ctx = ContextBuilder.build(
            thread, extra_agent_ids=extra_agent_ids, extra_skill_ids=extra_skill_ids,
        )

        model       = model_override or ctx.preferred_model or _cfg("DEFAULT_MODEL", "claude-sonnet-4-6")
        max_tokens  = int(max_tokens_override or _cfg("MAX_TOKENS", 4096))
        temperature = (
            float(temperature_override)
            if temperature_override is not None
            else float(ctx.preferred_temperature or _cfg("TEMPERATURE", 0.30))
        )

        # 4) persiste USER message
        user_msg = AiMessage.objects.create(
            id                = uuid.uuid4(),
            thread_id         = thread.id,
            sender            = "user",
            user_id           = user_id,
            role_label        = "Usuario",
            content           = user_text or "",
            content_format    = "text",
            attachments       = attachments_blob,
            context_snapshot  = ctx.context_snapshot,
            model             = model,
            idempotence_token = idempotence_token,
            is_active         = True,
        )
        # vincula cada adjunto al message (si no lo estaba ya)
        for a in attachments:
            if not a.message_id:
                a.message_id = user_msg.id
                if not a.thread_id:
                    a.thread_id = thread.id
                a.save(update_fields=["message_id", "thread_id", "updated_at"])

        # 5) construye historial + multimodal blocks
        history = cls._build_history(thread, user_msg, user_text, attachments)

        # 6) llama al LLM con retries
        started = time.monotonic()
        resp_text, tokens_in, tokens_out, finish_reason, err_code, err_msg = \
            cls._call_with_retry(
                system=ctx.system_prompt,
                messages=history,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
            )
        latency_ms = int((time.monotonic() - started) * 1000)
        success    = err_code is None

        # 7) persiste ASSISTANT message
        assistant_role_label = (
            f"Agente: {ctx.agents[0].nombre}" if ctx.agents else "Asistente"
        )
        assistant_msg = AiMessage.objects.create(
            id                = uuid.uuid4(),
            thread_id         = thread.id,
            sender            = "assistant",
            user_id           = None,
            role_label        = assistant_role_label,
            content           = resp_text or "",
            content_format    = "markdown",
            attachments       = [],
            context_snapshot  = ctx.context_snapshot,
            model             = model,
            tokens_in         = tokens_in,
            tokens_out        = tokens_out,
            latency_ms        = latency_ms,
            finish_reason     = finish_reason,
            error_code        = err_code,
            error_message     = err_msg,
            parent_message_id = user_msg.id,
            is_active         = True,
        )

        # 8) telemetría append-only
        cls._log_usage(
            thread_id   = thread.id,
            message_id  = assistant_msg.id,
            user_id     = user_id,
            model       = model,
            tokens_in   = tokens_in or 0,
            tokens_out  = tokens_out or 0,
            latency_ms  = latency_ms,
            success     = success,
            error_code  = err_code,
            error_message = err_msg,
        )

        # 9) actualiza contadores del thread
        with transaction.atomic():
            t = AiThread.objects.select_for_update().get(pk=thread.id)
            t.last_message_at  = timezone.now()
            t.message_count    = (t.message_count or 0) + 2
            t.total_tokens_in  = (t.total_tokens_in or 0) + (tokens_in or 0)
            t.total_tokens_out = (t.total_tokens_out or 0) + (tokens_out or 0)
            if t.titulo == "Nuevo chat" and user_text:
                t.titulo = user_text.strip().splitlines()[0][:200]
            t.save(update_fields=[
                "last_message_at", "message_count", "total_tokens_in",
                "total_tokens_out", "titulo", "updated_at",
            ])

        return ChatResult(
            assistant_message=assistant_msg,
            success=success,
            error_code=err_code,
            error_message=err_msg,
        )

    # --------- historial ---------------------------------------------
    @classmethod
    def _build_history(cls, thread: AiThread, user_msg: AiMessage,
                       user_text: str, attachments: list[AiAttachment]) -> list[dict]:
        """Arma la lista `messages` para Anthropic.

        Historial de turno:
            · Todos los mensajes activos del hilo, en orden cronológico,
              omitiendo errores / system / tool.
            · El user-message actual se añade al final con los adjuntos
              como bloques multimodal (imágenes) + texto extraído anexo.
        """
        prior = list(AiMessage.objects.filter(
            thread_id=thread.id, is_active=True,
            sender__in=("user", "assistant"),
        ).exclude(id=user_msg.id).order_by("created_at"))

        history: list[dict] = []
        for m in prior:
            if m.sender == "user":
                history.append({"role": "user", "content": m.content or ""})
            else:
                if m.error_code or not m.content:
                    continue
                history.append({"role": "assistant", "content": m.content or ""})

        # turno actual (user) — multi-bloque si hay imágenes, sino texto plano
        current_blocks: list[dict] = []
        text_parts = [user_text or ""]

        for att in attachments:
            if att.is_image:
                # Volvemos a leer los bytes del storage local para enviar.
                try:
                    img_bytes = cls._read_local(att.storage_url)
                    block = FileProcessor.to_anthropic_block(att, img_bytes)
                    if block:
                        current_blocks.append(block)
                except Exception as e:
                    log.warning("No se pudo leer imagen %s: %s", att.filename, e)
            elif att.extracted_text:
                snippet = att.extracted_text
                # Capamos a ~32k chars por adjunto para no explotar el prompt.
                if len(snippet) > 32000:
                    snippet = snippet[:32000] + "\n…[truncado]"
                text_parts.append(
                    f"\n\n--- Archivo adjunto: {att.filename} ---\n{snippet}\n--- fin {att.filename} ---"
                )

        text_joined = "\n".join([p for p in text_parts if p]).strip()
        if current_blocks:
            current_blocks.append({"type": "text", "text": text_joined or "Analiza los adjuntos."})
            history.append({"role": "user", "content": current_blocks})
        else:
            history.append({"role": "user", "content": text_joined or ""})

        return history

    @staticmethod
    def _read_local(url: str) -> bytes:
        """Lee bytes desde filesystem local (storage_backend='local')."""
        if url.startswith("file://"):
            url = url[len("file://"):]
        with open(url, "rb") as f:
            return f.read()

    # --------- llamada Anthropic con backoff -------------------------
    @classmethod
    def _call_with_retry(cls, *, system: str, messages: list[dict],
                         model: str, max_tokens: int, temperature: float):
        """Devuelve (text, tokens_in, tokens_out, finish_reason, err_code, err_msg)."""
        # Dry-run: devolvemos respuesta canned.
        if _cfg("DRY_RUN", False) or not _cfg("ANTHROPIC_API_KEY"):
            return cls._dry_run_response(messages, model)

        try:
            import anthropic  # type: ignore
        except Exception as e:
            log.warning("anthropic SDK no disponible: %s", e)
            return cls._dry_run_response(messages, model)

        client = anthropic.Anthropic(api_key=_cfg("ANTHROPIC_API_KEY"))
        max_retries = int(_cfg("MAX_RETRIES", 5))
        base = float(_cfg("RETRY_BASE_SECONDS", 1.0))
        cap  = float(_cfg("RETRY_CAP_SECONDS", 60.0))

        last_err_code = None
        last_err_msg  = None
        for attempt in range(max_retries + 1):
            try:
                resp = client.messages.create(
                    model       = model,
                    max_tokens  = max_tokens,
                    temperature = temperature,
                    system      = system,
                    messages    = messages,
                )
                # extrae texto del primer bloque text
                text = ""
                try:
                    for block in resp.content or []:
                        if getattr(block, "type", None) == "text":
                            text += getattr(block, "text", "") or ""
                except Exception:
                    text = str(resp)

                usage = getattr(resp, "usage", None)
                tokens_in  = getattr(usage, "input_tokens",  None) if usage else None
                tokens_out = getattr(usage, "output_tokens", None) if usage else None
                finish_reason = getattr(resp, "stop_reason", None) or "end_turn"
                return text, tokens_in, tokens_out, finish_reason, None, None
            except Exception as e:
                classified = _classify_anthropic_error(e)
                last_err_code = e.__class__.__name__
                last_err_msg  = str(e)
                if isinstance(classified, _NonRetryable) or attempt >= max_retries:
                    return "", None, None, "error", last_err_code, last_err_msg
                # backoff con jitter
                delay = min(cap, base * (2 ** attempt))
                delay += random.uniform(0, delay * 0.25)
                log.warning("Anthropic retry %d/%d in %.2fs — %s",
                            attempt + 1, max_retries, delay, last_err_msg)
                time.sleep(delay)

        return "", None, None, "error", last_err_code, last_err_msg

    # --------- fallback dry-run --------------------------------------
    @staticmethod
    def _dry_run_response(messages: list[dict], model: str):
        last = messages[-1] if messages else {"content": ""}
        content = last.get("content")
        if isinstance(content, list):
            text_parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            user_text = " ".join(text_parts).strip()
        else:
            user_text = (content or "").strip()
        canned = (
            "**[Modo DRY-RUN]** La API key de Anthropic no está configurada — "
            "respondo con stub local.\n\n"
            f"Tu mensaje (eco): _{user_text[:300]}_\n\n"
            "Para activar respuestas reales: define `ANTHROPIC_API_KEY` en el "
            "environment del backend y reinicia el contenedor django."
        )
        # tokens estimados ~= chars / 4
        t_in  = max(1, len(user_text) // 4)
        t_out = max(1, len(canned) // 4)
        return canned, t_in, t_out, "end_turn", None, None

    # --------- telemetría --------------------------------------------
    @classmethod
    def _log_usage(cls, *, thread_id, message_id, user_id, model,
                   tokens_in, tokens_out, latency_ms, success,
                   error_code, error_message):
        try:
            price_in, price_out = cls.PRICE_TABLE.get(model, (0.0, 0.0))
            cost_usd = Decimal(
                f"{(tokens_in/1_000_000)*price_in + (tokens_out/1_000_000)*price_out:.6f}"
            )
            AiUsageLog.objects.create(
                id            = uuid.uuid4(),
                thread_id     = thread_id,
                message_id    = message_id,
                user_id       = user_id,
                provider      = "anthropic",
                model         = model,
                operation     = "chat",
                tokens_in     = tokens_in or 0,
                tokens_out    = tokens_out or 0,
                latency_ms    = latency_ms,
                cost_usd      = cost_usd,
                success       = success,
                error_code    = error_code,
                error_message = error_message,
                metadata      = {},
            )
        except Exception as e:
            log.warning("No se pudo registrar usage_log: %s", e)
