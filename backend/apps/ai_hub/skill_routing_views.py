"""
=====================================================================
MWT.ONE · apps.ai_hub.skill_routing_views
Agente responsable: [AG-BACKEND]

Sprint Transfer Engine v3.5 · 2026-04-30.

Endpoint para gobernanza de skills de IA por slug:
  · GET   /api/ai/skills/<skill_key>/   → cualquier autenticado (read).
  · PATCH /api/ai/skills/<skill_key>/   → CEO/admin only (mutación crítica).

POL_VISIBILIDAD: el system_prompt y el model_id del skill IMPACTAN el
cálculo de costos de TODA la compañía (es la lógica del OCR de DUAs y
facturas para liquidación de landed cost). Por eso PATCH es estrictamente
CEO_OR_ADMIN. Defensa de segunda línea complementa al guard del frontend.
=====================================================================
"""
from __future__ import annotations

import logging
import uuid

from rest_framework import status
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AiSkill

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Permission: IsCEOOrAdmin
# ─────────────────────────────────────────────────────────────────────
CEO_ROLES = {"admin", "superadmin", "ceo"}


class IsCEOOrAdmin(BasePermission):
    """Mutación CEO_ONLY para endpoints de gobernanza de IA.

    Lee el rol desde:
      1. request.auth['role']  (custom JWT claim — patrón MWT)
      2. request.user.role     (atributo del modelo User)

    Si ninguno matchea CEO_ROLES, devuelve False → DRF responde 403.
    """
    message = (
        "Solo CEO/admin puede modificar skills de IA. "
        "El system_prompt y el modelo activo impactan el cálculo de "
        "costos de toda la compañía."
    )

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = None
        # 1) JWT claim
        if getattr(request, "auth", None):
            try:
                role = (request.auth.get("role") or "").lower()
            except Exception:
                role = None
        # 2) User.role
        if not role:
            role = (getattr(request.user, "role", "") or "").lower()
        if role in CEO_ROLES:
            return True
        # Soporte adicional: superuser/staff de Django siempre permitido
        if getattr(request.user, "is_superuser", False):
            return True
        return False


# ─────────────────────────────────────────────────────────────────────
# Helper: serializar skill al shape que espera el FE
# ─────────────────────────────────────────────────────────────────────
def _serialize_skill(s: AiSkill) -> dict:
    return {
        "id":                str(s.id),
        "skill_key":         s.skill_key or (s.codigo or "").lower().replace("_", "-"),
        "codigo":            s.codigo,
        "display_name":      s.display_name or s.nombre,
        "nombre":            s.nombre,
        "descripcion":       s.descripcion or "",
        "system_prompt":     s.system_prompt or "",
        "model_id":          s.model_id or "",
        "model_provider_id": s.model_provider_id or "",
        "category":          s.category or "",
        "icon":              s.icon or "sparkles",
        "accent_color":      s.accent_color or "#1DE394",
        "tags":              s.tags or [],
        "metadata":          s.metadata or {},
        "is_active":         bool(s.is_active),
        "updated_at":        s.updated_at.isoformat() if s.updated_at else None,
    }


# Catálogo de modelos LLM disponibles para el dropdown del FE.
# (Estable: si añadimos un modelo nuevo, se documenta aquí.)
LLM_MODELS_CATALOG = [
    {"id": "gpt-5-nano",          "label": "GPT-5 nano",          "provider": "openai",
     "speed": "fast",   "cost": "low",    "vision": True},
    {"id": "gpt-5-mini",          "label": "GPT-5 mini",          "provider": "openai",
     "speed": "medium", "cost": "medium", "vision": True},
    {"id": "gpt-5",               "label": "GPT-5",               "provider": "openai",
     "speed": "slow",   "cost": "high",   "vision": True},
    {"id": "claude-sonnet-4-6",   "label": "Claude Sonnet 4.6",   "provider": "anthropic",
     "speed": "medium", "cost": "medium", "vision": True},
    {"id": "claude-haiku-4-5-20251001",
                                  "label": "Claude Haiku 4.5",    "provider": "anthropic",
     "speed": "fast",   "cost": "low",    "vision": True},
    {"id": "claude-opus-4-6",     "label": "Claude Opus 4.6",     "provider": "anthropic",
     "speed": "slow",   "cost": "high",   "vision": True},
    {"id": "gemini-2-5-pro",      "label": "Gemini 2.5 Pro",      "provider": "google",
     "speed": "medium", "cost": "medium", "vision": True},
]


# ─────────────────────────────────────────────────────────────────────
# View
# ─────────────────────────────────────────────────────────────────────
class SkillByKeyView(APIView):
    """GET / PATCH /api/ai/skills/<skill_key>/

    El skill se busca primero por `skill_key` (slug), luego por `codigo`
    como fallback. Si no existe, 404.
    """

    def get_permissions(self):
        # GET → cualquier autenticado puede leer (incluyendo CLIENT B2B,
        #       que solo verá nombre del skill y modelo, no muta).
        # PATCH/PUT → CEO/admin only (HTTP 403 a otros).
        if self.request.method in ("PATCH", "PUT"):
            return [IsAuthenticated(), IsCEOOrAdmin()]
        return [IsAuthenticated()]

    # ── Lookup ────────────────────────────────────────────────────
    def _find(self, skill_key: str):
        s = AiSkill.objects.filter(skill_key=skill_key, is_active=True).first()
        if s is None:
            # Fallback: por codigo (mayúsculas) — soporta tanto "ocr-transfers"
            # como "OCR_TRANSFERS" / "SKILL_OCR_TRANSFERS".
            cod = skill_key.upper().replace("-", "_")
            s = AiSkill.objects.filter(codigo=cod, is_active=True).first()
            if s is None:
                s = AiSkill.objects.filter(
                    codigo=f"SKILL_{cod}", is_active=True
                ).first()
        return s

    # ── GET ───────────────────────────────────────────────────────
    def get(self, request, skill_key=None):
        skill = self._find(skill_key)
        if skill is None:
            return Response(
                {"detail": f"Skill '{skill_key}' no existe."},
                status=status.HTTP_404_NOT_FOUND,
            )
        out = _serialize_skill(skill)
        # Adjuntamos el catálogo de modelos disponibles para que el FE
        # pueda poblar el dropdown sin un round-trip extra.
        out["available_models"] = LLM_MODELS_CATALOG
        return Response(out)

    # ── PATCH ─────────────────────────────────────────────────────
    def patch(self, request, skill_key=None):
        skill = self._find(skill_key)
        if skill is None:
            return Response(
                {"detail": f"Skill '{skill_key}' no existe."},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data or {}
        editable = {
            "display_name":     "display_name",
            "name":             "display_name",         # alias
            "nombre":           "nombre",
            "descripcion":      "descripcion",
            "description":      "descripcion",          # alias
            "system_prompt":    "system_prompt",
            "model_id":         "model_id",
            "model_provider_id":"model_provider_id",
            "model_provider":   "model_provider_id",    # alias
            "icon":             "icon",
            "accent_color":     "accent_color",
        }
        changed = []
        for src, dst in editable.items():
            if src in data:
                v = data.get(src)
                # Validación suave de longitud por columna
                if dst in ("display_name", "nombre"):     v = (v or "")[:160]
                if dst == "model_id":                      v = (v or "")[:64]
                if dst == "model_provider_id":             v = (v or "")[:32]
                if dst == "icon":                          v = (v or "")[:48]
                if dst == "accent_color":                  v = (v or "")[:16]
                setattr(skill, dst, v)
                changed.append(dst)

        # Si se cambia el model_id pero no se manda provider → autodetectar
        # desde el catálogo (mantiene consistencia model_id ↔ provider_id).
        if "model_id" in changed and "model_provider_id" not in changed:
            for m in LLM_MODELS_CATALOG:
                if m["id"] == skill.model_id:
                    skill.model_provider_id = m["provider"]
                    changed.append("model_provider_id")
                    break

        if not changed:
            return Response(
                {"detail": "No se recibieron campos editables."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            skill.save(update_fields=changed + ["updated_at"])
        except Exception as e:
            # `managed=False` + columnas nuevas que no existan en DB →
            # Postgres lanza un error claro. Lo devolvemos como 500 JSON.
            log.exception("[ai.skill.patch] save failed: %s", e)
            return Response(
                {"detail": f"save_failed: {type(e).__name__}", "error": str(e)[:500]},
                status=500,
            )

        log.info(
            "[ai.skill.patch] user=%s skill=%s changed=%s",
            getattr(request.user, "email", "?"),
            skill.skill_key, changed,
        )
        out = _serialize_skill(skill)
        out["available_models"] = LLM_MODELS_CATALOG
        out["changed_fields"]   = changed
        return Response(out)
