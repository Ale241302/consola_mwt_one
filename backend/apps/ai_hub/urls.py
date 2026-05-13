"""
=====================================================================
MWT.ONE · apps.ai_hub.urls
Agente responsable: [AG-BACKEND-API]

Monta todos los recursos del AI Hub bajo /api/ai/.

Recursos REST (DefaultRouter):
  · agents          → /api/ai/agents/         + /api/ai/agents/select/
  · skills          → /api/ai/skills/         + /api/ai/skills/select/
  · instructions    → /api/ai/instructions/   + /api/ai/instructions/select/
  · threads         → /api/ai/threads/        + actions: pin/unpin/archive/
                          unarchive/messages/context/anchor/unanchor
  · thread-contexts → /api/ai/thread-contexts/  (CRUD bajo nivel)
  · messages        → /api/ai/messages/         (CRUD soft, idempotente)
  · attachments     → /api/ai/attachments/      (CRUD soft)
  · usage-logs      → /api/ai/usage-logs/       (read-only + summary)

Endpoints LLM (POST /api/ai/chat/send/, /api/ai/chat/upload/) los
aporta [AG-BACKEND-LLM] en `chat_views.py` y se agregan aquí mismo.
=====================================================================
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AiAgentViewSet, AiSkillViewSet, AiInstructionViewSet,
    AiThreadViewSet, AiThreadContextViewSet,
    AiMessageViewSet, AiAttachmentViewSet, AiUsageLogViewSet,
)

router = DefaultRouter()
router.register(r"ai/agents",          AiAgentViewSet,         basename="ai-agents")
router.register(r"ai/skills",          AiSkillViewSet,         basename="ai-skills")
router.register(r"ai/instructions",    AiInstructionViewSet,   basename="ai-instructions")
router.register(r"ai/threads",         AiThreadViewSet,        basename="ai-threads")
router.register(r"ai/thread-contexts", AiThreadContextViewSet, basename="ai-thread-contexts")
router.register(r"ai/messages",        AiMessageViewSet,       basename="ai-messages")
router.register(r"ai/attachments",     AiAttachmentViewSet,    basename="ai-attachments")
router.register(r"ai/usage-logs",      AiUsageLogViewSet,      basename="ai-usage-logs")

# Endpoints LLM (chat completion + file upload) — aportados por [AG-BACKEND-LLM]
# Se importan aquí para que vivan bajo /api/ai/chat/.
try:
    from .chat_views import ChatSendView, ChatUploadView  # noqa: WPS433
    chat_urlpatterns = [
        path("ai/chat/send/",   ChatSendView.as_view(),   name="ai-chat-send"),
        path("ai/chat/upload/", ChatUploadView.as_view(), name="ai-chat-upload"),
    ]
except Exception:  # pragma: no cover — chat_views todavía no está pegado
    chat_urlpatterns = []

# Endpoint de gobernanza por slug — Sprint Transfer Engine v3.5
# (skill_routing_views.py). GET es read para todo autenticado; PATCH
# está bloqueado a CEO/admin (HTTP 403 a otros).
from .skill_routing_views import SkillByKeyView   # noqa: E402

skill_routing_urlpatterns = [
    path("ai/skills/<slug:skill_key>/",
         SkillByKeyView.as_view(),
         name="ai-skill-by-key"),
]

# Sprint 2026-05-11 · Fase 7 · extractor genérico de documentos.
# Lo aporta `document_extract_views.py` — recibe archivo + structure_json
# del Builder y devuelve los campos autocompletados por IA.
try:
    from .document_extract_views import DocumentExtractView  # noqa: E402, WPS433
    document_extract_urlpatterns = [
        path("ai/document/extract/",
             DocumentExtractView.as_view(),
             name="ai-document-extract"),
    ]
except Exception:  # pragma: no cover — defensa por si SDK no está
    document_extract_urlpatterns = []

urlpatterns = [
    # ⚠ skill_routing_urlpatterns DEBE ir antes que el router
    # porque /api/ai/skills/<slug>/ colisionaría con el detail del
    # AiSkillViewSet (que matchea cualquier string como pk UUID).
    *skill_routing_urlpatterns,
    *chat_urlpatterns,
    *document_extract_urlpatterns,
    path("", include(router.urls)),
]
