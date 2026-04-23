"""
=====================================================================
MWT.ONE · apps.ai_hub.views
Agente responsable: [AG-BACKEND-API]

ViewSets DRF del AI Hub.

CRUD catálogos (gobernanza):
  · /api/ai/agents/         (CRUD)
  · /api/ai/skills/         (CRUD)
  · /api/ai/instructions/   (CRUD)

Endpoints lightweight para autocomplete del MentionPopover:
  · GET /api/ai/agents-select/?q=...
  · GET /api/ai/skills-select/?q=...
  · GET /api/ai/instructions-select/?q=...

Conversación:
  · /api/ai/threads/                          (CRUD + actions)
       · POST /api/ai/threads/<id>/anchor/     → anclar contexto
       · POST /api/ai/threads/<id>/unanchor/   → desanclar contexto
       · POST /api/ai/threads/<id>/pin/
       · POST /api/ai/threads/<id>/unpin/
       · POST /api/ai/threads/<id>/archive/
       · POST /api/ai/threads/<id>/unarchive/
       · GET  /api/ai/threads/<id>/messages/   → mensajes paginados
       · GET  /api/ai/threads/<id>/context/    → snapshot de anclaje

  · /api/ai/messages/             (read + delete soft)
  · /api/ai/attachments/          (read + create + delete soft)
  · /api/ai/usage-logs/           (read-only, audit)

NOTA: el endpoint REAL de envío de mensaje al LLM lo expone
[AG-BACKEND-LLM] en `apps.ai_hub.chat_views.ChatView`
(POST /api/ai/chat/send/), no aquí.

Reglas MWT respetadas:
  · idempotence_token early-return en mensajes.
  · Filtros por user_id (scoping suave).
  · No se reciben campos calculados desde cliente.
=====================================================================
"""
import uuid
import logging

from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    AiAgent, AiSkill, AiInstruction,
    AiThread, AiThreadContext, AiMessage,
    AiAttachment, AiUsageLog,
)
from .serializers import (
    AiAgentSerializer, AiAgentListSerializer, AiAgentSelectSerializer,
    AiSkillSerializer, AiSkillListSerializer, AiSkillSelectSerializer,
    AiInstructionSerializer, AiInstructionListSerializer, AiInstructionSelectSerializer,
    AiThreadSerializer, AiThreadListSerializer,
    AiThreadContextSerializer,
    AiMessageSerializer, AiMessageListSerializer,
    AiAttachmentSerializer, AiAttachmentListSerializer,
    AiUsageLogSerializer,
)

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Guards anti-CLIENT · Defensa en profundidad del AI Hub
#
# El AI Hub expone 3 superficies:
#   1. Gobernanza (AiAgent / AiSkill / AiInstruction) — CEO-ONLY
#   2. Hilos (AiThread) — scoped: el CLIENT sólo ve sus propios hilos
#   3. Chat (ChatSendView) — CLIENT no puede mencionar agentes/skills
#                             → el backend fuerza el asistente SVC-01
# ══════════════════════════════════════════════════════════════════════
_CLIENT_ROLES = {"client_b2b", "cliente", "client"}


def _is_client_role(role) -> bool:
    return (role or "").lower() in _CLIENT_ROLES


def _deny_ai_governance_for_client(request, resource_label: str = ""):
    """Si el caller es CLIENT B2B → Response 403. En caso contrario → None.

    Usado en AiAgentViewSet / AiSkillViewSet / AiInstructionViewSet para
    bloquear CUALQUIER método (GET, POST, PUT, PATCH, DELETE) — el
    cliente B2B no debe ni siquiera leer el catálogo de agentes/skills/
    instrucciones, porque esa info es gobernanza interna MWT.
    """
    role = (getattr(request.user, "role", "") or "").lower()
    if role in _CLIENT_ROLES:
        log.warning(
            "AI Hub governance access denied: role=%s user=%s resource=%s path=%s",
            role, getattr(request.user, "email", "?"),
            resource_label, getattr(request, "path", "?"),
        )
        return Response(
            {
                "detail":   "La gobernanza del AI Hub es CEO-ONLY. El rol CLIENT no tiene acceso.",
                "resource": resource_label,
                "role":     role,
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


# UUID canónico del Asistente MWT (SVC-01). Si no existe en la DB, el
# ChatService resuelve al agente default del schema — no rompe.
SVC_01_SLUG = "asistente-mwt"
SVC_01_CODIGO = "SVC-01"


# =====================================================================
# Helpers
# =====================================================================
def _ensure_uuid(data: dict) -> dict:
    """Asigna UUID si falta. Trabaja sobre una copia mutable del payload."""
    if not data.get("id"):
        data["id"] = str(uuid.uuid4())
    return data


def _request_data_copy(request):
    """request.data → dict mutable (resiste a QueryDict)."""
    if hasattr(request.data, "copy"):
        return request.data.copy()
    return dict(request.data)


def _label_for(ref_type: str, ref) -> str:
    """Devuelve el label snapshot para el contexto anclado."""
    if ref_type == "agent" and isinstance(ref, AiAgent):
        return f"{ref.avatar_emoji} {ref.nombre}"
    if ref_type == "skill" and isinstance(ref, AiSkill):
        return f"/{ref.codigo} — {ref.nombre}"
    if ref_type == "instruction" and isinstance(ref, AiInstruction):
        return ref.titulo
    return ""


# =====================================================================
# Catálogos: Agent / Skill / Instruction
# =====================================================================
class AiAgentViewSet(viewsets.ModelViewSet):
    """CRUD sobre `ai.agent`. Soft-delete vía is_active=False.

    SEGURIDAD: todo método (incluso GET list/retrieve) está bloqueado
    para CLIENT B2B — la gobernanza del AI Hub es CEO-ONLY.
    """
    queryset = AiAgent.objects.filter(is_active=True)
    serializer_class = AiAgentSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_ai_governance_for_client(request, resource_label="ai.agent")
        if denied is not None:
            # DRF `initial` no soporta returnar Response directo — usamos
            # una excepción PermissionDenied para que se serialize correcto.
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get_serializer_class(self):
        if self.action == "list":
            return AiAgentListSerializer
        return AiAgentSerializer

    def get_queryset(self):
        qs = AiAgent.objects.filter(is_active=True)
        rol = self.request.query_params.get("rol")
        autonomy = self.request.query_params.get("autonomy_ceiling")
        q = self.request.query_params.get("q")
        if rol:
            qs = qs.filter(rol=rol)
        if autonomy:
            qs = qs.filter(autonomy_ceiling=autonomy)
        if q:
            qs = qs.filter(nombre__icontains=q) | qs.filter(codigo__icontains=q)
        return qs.order_by("rol", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── GET /api/ai/agents-select/ (alias por router) ─────────
    @action(detail=False, methods=["get"], url_path="select")
    def select(self, request):
        """Lightweight para MentionPopover (@). Filtros: q, rol."""
        qs = AiAgent.objects.filter(is_active=True)
        q = request.query_params.get("q")
        rol = request.query_params.get("rol")
        if q:
            qs = qs.filter(nombre__icontains=q) | qs.filter(codigo__icontains=q)
        if rol:
            qs = qs.filter(rol=rol)
        qs = qs.order_by("rol", "codigo")[:50]
        return Response(AiAgentSelectSerializer(qs, many=True).data)


class AiSkillViewSet(viewsets.ModelViewSet):
    """CRUD sobre `ai.skill`. SEGURIDAD: CEO-ONLY. CLIENT B2B → 403."""
    queryset = AiSkill.objects.filter(is_active=True)
    serializer_class = AiSkillSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_ai_governance_for_client(request, resource_label="ai.skill")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get_serializer_class(self):
        if self.action == "list":
            return AiSkillListSerializer
        return AiSkillSerializer

    def get_queryset(self):
        qs = AiSkill.objects.filter(is_active=True)
        category = self.request.query_params.get("category")
        q = self.request.query_params.get("q")
        if category:
            qs = qs.filter(category=category)
        if q:
            qs = qs.filter(nombre__icontains=q) | qs.filter(codigo__icontains=q)
        return qs.order_by("category", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=False, methods=["get"], url_path="select")
    def select(self, request):
        """Lightweight para MentionPopover (/). Filtros: q, category."""
        qs = AiSkill.objects.filter(is_active=True)
        q = request.query_params.get("q")
        category = request.query_params.get("category")
        if q:
            qs = qs.filter(nombre__icontains=q) | qs.filter(codigo__icontains=q)
        if category:
            qs = qs.filter(category=category)
        qs = qs.order_by("category", "codigo")[:50]
        return Response(AiSkillSelectSerializer(qs, many=True).data)


class AiInstructionViewSet(viewsets.ModelViewSet):
    """CRUD sobre `ai.instruction`. SEGURIDAD: CEO-ONLY. CLIENT B2B → 403."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_ai_governance_for_client(request, resource_label="ai.instruction")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    queryset = AiInstruction.objects.filter(is_active=True)
    serializer_class = AiInstructionSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return AiInstructionListSerializer
        return AiInstructionSerializer

    def get_queryset(self):
        qs = AiInstruction.objects.filter(is_active=True)
        scope = self.request.query_params.get("scope")
        domain = self.request.query_params.get("domain")
        auto = self.request.query_params.get("auto_inject")
        q = self.request.query_params.get("q")
        if scope:
            qs = qs.filter(scope=scope)
        if domain:
            qs = qs.filter(domain=domain)
        if auto is not None:
            qs = qs.filter(auto_inject=(auto.lower() in ("1", "true", "yes")))
        if q:
            qs = qs.filter(titulo__icontains=q) | qs.filter(codigo__icontains=q)
        return qs.order_by("prioridad", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=False, methods=["get"], url_path="select")
    def select(self, request):
        qs = AiInstruction.objects.filter(is_active=True)
        scope = request.query_params.get("scope")
        q = request.query_params.get("q")
        if scope:
            qs = qs.filter(scope=scope)
        if q:
            qs = qs.filter(titulo__icontains=q) | qs.filter(codigo__icontains=q)
        qs = qs.order_by("prioridad", "codigo")[:50]
        return Response(AiInstructionSelectSerializer(qs, many=True).data)


# =====================================================================
# Threads
# =====================================================================
class AiThreadViewSet(viewsets.ModelViewSet):
    """CRUD sobre `ai.thread` + acciones de gestión."""
    queryset = AiThread.objects.filter(is_active=True)
    serializer_class = AiThreadSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return AiThreadListSerializer
        return AiThreadSerializer

    def get_queryset(self):
        qs = AiThread.objects.filter(is_active=True)
        user_id = self.request.query_params.get("user_id")
        archived = self.request.query_params.get("archived")
        pinned = self.request.query_params.get("pinned")
        q = self.request.query_params.get("q")

        # ── SECURITY ClientScopedManager · CLIENT B2B ────────────
        # Un cliente B2B SOLO puede ver los hilos donde él es el creador.
        # Esto ignora cualquier `user_id` que venga como query param
        # (anti-spoofing) y fuerza request.user.id. Para staff interno,
        # respetamos el filtro opcional del query param (útil para
        # impersonation desde el Tweaks panel en dev).
        if _is_client_role(getattr(self.request.user, "role", None)):
            forced_uid = (getattr(self.request.user, "id", None)
                          or getattr(self.request.user, "pk", None))
            if forced_uid:
                qs = qs.filter(user_id=str(forced_uid))
            else:
                # Sin uid del JWT → no hay scope → sin resultados.
                qs = qs.none()
        elif user_id:
            qs = qs.filter(user_id=user_id)

        if archived is not None:
            qs = qs.filter(archived=(archived.lower() in ("1", "true", "yes")))
        else:
            qs = qs.filter(archived=False)
        if pinned is not None:
            qs = qs.filter(pinned=(pinned.lower() in ("1", "true", "yes")))
        if q:
            qs = qs.filter(titulo__icontains=q)
        return qs.order_by("-pinned", "-last_message_at", "-created_at")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── POST /api/ai/threads/<id>/pin/ ────────────────────────
    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        try:
            t = AiThread.objects.get(pk=pk, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        t.pinned = True
        t.save(update_fields=["pinned", "updated_at"])
        return Response({"ok": True, "id": str(t.id), "pinned": True})

    @action(detail=True, methods=["post"])
    def unpin(self, request, pk=None):
        try:
            t = AiThread.objects.get(pk=pk, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        t.pinned = False
        t.save(update_fields=["pinned", "updated_at"])
        return Response({"ok": True, "id": str(t.id), "pinned": False})

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        try:
            t = AiThread.objects.get(pk=pk, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        t.archived = True
        t.save(update_fields=["archived", "updated_at"])
        return Response({"ok": True, "id": str(t.id), "archived": True})

    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        try:
            t = AiThread.objects.get(pk=pk, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        t.archived = False
        t.save(update_fields=["archived", "updated_at"])
        return Response({"ok": True, "id": str(t.id), "archived": False})

    # ── GET /api/ai/threads/<id>/messages/ ────────────────────
    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        """Mensajes activos del hilo, en orden cronológico."""
        qs = AiMessage.objects.filter(thread_id=pk, is_active=True).order_by("created_at")
        # paginación liviana (no usamos LimitOffset para evitar wrappers)
        try:
            limit = max(1, min(int(request.query_params.get("limit", 200)), 1000))
        except ValueError:
            limit = 200
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except ValueError:
            offset = 0
        total = qs.count()
        rows = qs[offset:offset + limit]
        return Response({
            "count":   total,
            "limit":   limit,
            "offset":  offset,
            "results": AiMessageListSerializer(rows, many=True).data,
        })

    # ── GET /api/ai/threads/<id>/context/ ─────────────────────
    @action(detail=True, methods=["get"])
    def context(self, request, pk=None):
        """Anclajes activos del hilo (agentes + skills + instrucciones)."""
        qs = AiThreadContext.objects.filter(
            thread_id=pk, is_active=True
        ).order_by("position", "created_at")
        return Response(AiThreadContextSerializer(qs, many=True).data)

    # ── POST /api/ai/threads/<id>/anchor/ ─────────────────────
    @action(detail=True, methods=["post"])
    def anchor(self, request, pk=None):
        """Ancla un Agent / Skill / Instruction al hilo.

        Payload:
            {
              "ref_type": "agent" | "skill" | "instruction",
              "ref_id":   "<uuid>",
              "position": 0,                    # opcional
              "pinned_by_id": "<uuid>"          # opcional
            }
        Idempotente: si ya existe (thread_id, ref_type, ref_id) is_active,
        retorna el existente.
        """
        try:
            thread = AiThread.objects.get(pk=pk, is_active=True)
        except AiThread.DoesNotExist:
            return Response({"detail": "Thread no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        data = _request_data_copy(request)
        ref_type = data.get("ref_type")
        ref_id   = data.get("ref_id")
        if ref_type not in ("agent", "skill", "instruction") or not ref_id:
            return Response({"detail": "ref_type/ref_id inválidos."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Resuelve label desde el catálogo
        ref_obj = None
        try:
            if ref_type == "agent":
                ref_obj = AiAgent.objects.get(pk=ref_id, is_active=True)
            elif ref_type == "skill":
                ref_obj = AiSkill.objects.get(pk=ref_id, is_active=True)
            elif ref_type == "instruction":
                ref_obj = AiInstruction.objects.get(pk=ref_id, is_active=True)
        except (AiAgent.DoesNotExist, AiSkill.DoesNotExist, AiInstruction.DoesNotExist):
            return Response({"detail": "ref_id no encontrado en catálogo."},
                            status=status.HTTP_404_NOT_FOUND)

        # Idempotencia (thread_id, ref_type, ref_id) is_active=TRUE
        existing = AiThreadContext.objects.filter(
            thread_id=thread.id, ref_type=ref_type, ref_id=ref_id, is_active=True,
        ).first()
        if existing:
            return Response(
                AiThreadContextSerializer(existing).data,
                status=status.HTTP_200_OK,
                headers={"X-Idempotent-Replay": "true"},
            )

        ctx = AiThreadContext.objects.create(
            id           = uuid.uuid4(),
            thread_id    = thread.id,
            ref_type     = ref_type,
            ref_id       = ref_id,
            ref_label    = _label_for(ref_type, ref_obj),
            position     = int(data.get("position", 0) or 0),
            pinned_by_id = data.get("pinned_by_id"),
            metadata     = data.get("metadata") or {},
            is_active    = True,
        )
        return Response(AiThreadContextSerializer(ctx).data,
                        status=status.HTTP_201_CREATED)

    # ── POST /api/ai/threads/<id>/unanchor/ ───────────────────
    @action(detail=True, methods=["post"])
    def unanchor(self, request, pk=None):
        """Desancla (soft-delete) un contexto del hilo.

        Payload (cualquiera de los dos modos):
            { "context_id": "<uuid>" }                       # por id directo
            { "ref_type": "agent", "ref_id": "<uuid>" }      # por par
        """
        data = _request_data_copy(request)
        ctx_id = data.get("context_id")
        ref_type = data.get("ref_type")
        ref_id   = data.get("ref_id")

        try:
            if ctx_id:
                ctx = AiThreadContext.objects.get(pk=ctx_id, thread_id=pk, is_active=True)
            elif ref_type and ref_id:
                ctx = AiThreadContext.objects.get(
                    thread_id=pk, ref_type=ref_type, ref_id=ref_id, is_active=True,
                )
            else:
                return Response({"detail": "Falta context_id o (ref_type, ref_id)."},
                                status=status.HTTP_400_BAD_REQUEST)
        except AiThreadContext.DoesNotExist:
            return Response({"detail": "Contexto no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        ctx.is_active = False
        ctx.save(update_fields=["is_active", "updated_at"])
        return Response({"ok": True, "id": str(ctx.id)})


# =====================================================================
# ThreadContext (CRUD bajo nivel — para gestión avanzada)
# =====================================================================
class AiThreadContextViewSet(viewsets.ModelViewSet):
    queryset = AiThreadContext.objects.filter(is_active=True)
    serializer_class = AiThreadContextSerializer

    def get_queryset(self):
        qs = AiThreadContext.objects.filter(is_active=True)
        thread_id = self.request.query_params.get("thread_id")
        ref_type = self.request.query_params.get("ref_type")
        if thread_id:
            qs = qs.filter(thread_id=thread_id)
        if ref_type:
            qs = qs.filter(ref_type=ref_type)
        return qs.order_by("position", "created_at")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# Messages — read-mostly. La creación REAL pasa por chat_views.send().
# =====================================================================
class AiMessageViewSet(viewsets.ModelViewSet):
    queryset = AiMessage.objects.filter(is_active=True)
    serializer_class = AiMessageSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return AiMessageListSerializer
        return AiMessageSerializer

    def get_queryset(self):
        qs = AiMessage.objects.filter(is_active=True)
        thread_id = self.request.query_params.get("thread_id")
        sender = self.request.query_params.get("sender")
        if thread_id:
            qs = qs.filter(thread_id=thread_id)
        if sender:
            qs = qs.filter(sender=sender)
        return qs.order_by("created_at")

    def create(self, request, *args, **kwargs):
        """Crear mensaje manual (no genera respuesta IA).

        Idempotente vía idempotence_token.
        """
        data = _ensure_uuid(_request_data_copy(request))
        token = data.get("idempotence_token")
        if token:
            existing = AiMessage.objects.filter(
                idempotence_token=token, is_active=True).first()
            if existing:
                return Response(
                    AiMessageSerializer(existing).data,
                    status=status.HTTP_200_OK,
                    headers={"X-Idempotent-Replay": "true"},
                )
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# Attachments
# =====================================================================
class AiAttachmentViewSet(viewsets.ModelViewSet):
    """CRUD de adjuntos. Upload binario real → /api/ai/chat/upload/
    (chat_views.upload). Aquí mantenemos endpoint para listar/borrar.
    """
    queryset = AiAttachment.objects.filter(is_active=True)
    serializer_class = AiAttachmentSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return AiAttachmentListSerializer
        return AiAttachmentSerializer

    def get_queryset(self):
        qs = AiAttachment.objects.filter(is_active=True)
        thread_id = self.request.query_params.get("thread_id")
        message_id = self.request.query_params.get("message_id")
        user_id = self.request.query_params.get("user_id")
        if thread_id:
            qs = qs.filter(thread_id=thread_id)
        if message_id:
            qs = qs.filter(message_id=message_id)
        if user_id:
            qs = qs.filter(user_id=user_id)
        return qs.order_by("-created_at")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# UsageLog — read-only, audit/telemetría
# =====================================================================
class AiUsageLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Append-only telemetría. Solo GET."""
    queryset = AiUsageLog.objects.all()
    serializer_class = AiUsageLogSerializer

    def get_queryset(self):
        qs = AiUsageLog.objects.all()
        thread_id = self.request.query_params.get("thread_id")
        message_id = self.request.query_params.get("message_id")
        user_id = self.request.query_params.get("user_id")
        provider = self.request.query_params.get("provider")
        success = self.request.query_params.get("success")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if thread_id:
            qs = qs.filter(thread_id=thread_id)
        if message_id:
            qs = qs.filter(message_id=message_id)
        if user_id:
            qs = qs.filter(user_id=user_id)
        if provider:
            qs = qs.filter(provider=provider)
        if success is not None:
            qs = qs.filter(success=(success.lower() in ("1", "true", "yes")))
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        return qs.order_by("-created_at")

    # ── GET /api/ai/usage-logs/summary/ ───────────────────────
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Agregado por (provider, model) en una ventana opcional."""
        sql = """
            SELECT
              provider,
              model,
              COUNT(*)                         AS calls,
              COUNT(*) FILTER (WHERE success = TRUE)  AS ok,
              COUNT(*) FILTER (WHERE success = FALSE) AS errors,
              COALESCE(SUM(tokens_in), 0)      AS tokens_in,
              COALESCE(SUM(tokens_out), 0)     AS tokens_out,
              COALESCE(SUM(cost_usd), 0)       AS cost_usd,
              ROUND(AVG(latency_ms))           AS avg_latency_ms
            FROM ai.usage_log
            WHERE 1=1
              AND (%s::timestamptz IS NULL OR created_at >= %s::timestamptz)
              AND (%s::timestamptz IS NULL OR created_at <= %s::timestamptz)
            GROUP BY provider, model
            ORDER BY calls DESC
        """
        date_from = request.query_params.get("date_from")
        date_to   = request.query_params.get("date_to")
        params = [date_from, date_from, date_to, date_to]
        rows = []
        try:
            with connection.cursor() as c:
                c.execute(sql, params)
                cols = [d[0] for d in c.description]
                for r in c.fetchall():
                    rec = dict(zip(cols, r))
                    # decimales → float para JSON
                    for k in ("cost_usd",):
                        if rec.get(k) is not None:
                            rec[k] = float(rec[k])
                    rows.append(rec)
        except Exception as e:
            log.warning("usage-logs/summary falló: %s", e)
            return Response({"detail": str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(rows)
