"""
=====================================================================
MWT.ONE · apps.expedientes.views_builder_artifacts
Agente responsable: [AG-BACKEND]

Endpoints para instancias de artefactos del Builder externo
(https://builder.muito.work).

Rutas (registradas en apps/expedientes/urls.py):
  GET    /api/expedientes/{id}/artifacts/
  POST   /api/expedientes/{id}/artifacts/
  PATCH  /api/expedientes/{id}/artifacts/{artifact_id}/
  DELETE /api/expedientes/{id}/artifacts/{artifact_id}/

  GET    /api/builder/templates/        (proxy con cache de token JWT)
  GET    /api/builder/templates/{id}/   (proxy)

Reglas:
  · CLIENT_* NO puede mutar (mismo guard que el resto de expedientes).
  · stage_index(stage) <= stage_index(expediente.estado) en backend.
  · CHECK constraint a nivel SQL ya valida los valores permitidos.
=====================================================================
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Optional

import requests
from django.http import JsonResponse
from rest_framework import status as drf_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import BuilderArtifactInstance, Expediente
from .serializers import (
    BuilderArtifactInstanceSerializer,
    BuilderArtifactInstanceUpdateSerializer,
)
from .views import _deny_client_mutation

log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────
# Orden canónico de etapas (debe coincidir con el frontend).
# ────────────────────────────────────────────────────────────
STAGE_ORDER = (
    "REGISTRO",
    "PRODUCCION",
    "PREPARACION",
    "DESPACHO",
    "TRANSITO",
    "EN_DESTINO",
    "CERRADO",
)


def _stage_index(stage: Optional[str]) -> int:
    """Devuelve el índice de la etapa en el orden canónico, -1 si desconocido."""
    if not stage:
        return -1
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


def _can_attach_to_stage(expediente_stage: str, target_stage: str) -> bool:
    """Regla: sólo se puede crear artefactos en etapas <= estado actual.

    Si el expediente está en PRODUCCION, se permite REGISTRO y PRODUCCION,
    pero NO PREPARACION/DESPACHO/etc. (todavía no llegó).
    """
    a = _stage_index(expediente_stage)
    b = _stage_index(target_stage)
    if a < 0 or b < 0:
        return False
    return b <= a


# ════════════════════════════════════════════════════════════
# CRUD: /api/expedientes/{id}/artifacts/  + .../{artifact_id}/
# ════════════════════════════════════════════════════════════
class BuilderArtifactsListCreateView(APIView):
    """GET / POST sobre artefactos de un expediente."""

    permission_classes = [IsAuthenticated]

    def get(self, request, expediente_id: str):
        # Validar que el expediente exista (defensa de profundidad).
        try:
            uuid.UUID(str(expediente_id))
        except (TypeError, ValueError):
            return Response({"detail": "expediente_id inválido"}, status=400)

        qs = BuilderArtifactInstance.objects.filter(
            expediente_id=expediente_id, is_active=True,
        ).order_by("stage", "created_at")

        # Filtros opcionales
        stage = request.query_params.get("stage")
        if stage:
            qs = qs.filter(stage=stage)
        template_id = request.query_params.get("template_id")
        if template_id:
            try:
                qs = qs.filter(template_id=int(template_id))
            except (TypeError, ValueError):
                pass

        return Response(BuilderArtifactInstanceSerializer(qs, many=True).data)

    def post(self, request, expediente_id: str):
        denied = _deny_client_mutation(request, action_label="builder_artifact.create")
        if denied is not None:
            return denied

        try:
            uuid.UUID(str(expediente_id))
        except (TypeError, ValueError):
            return Response({"detail": "expediente_id inválido"}, status=400)

        # Cargar expediente para validar etapa.
        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        s = BuilderArtifactInstanceSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        target_stage = s.validated_data.get("stage")
        if not _can_attach_to_stage(exp.estado, target_stage):
            return Response({
                "detail": (
                    f"No se puede agregar artefacto a la etapa {target_stage}: "
                    f"el expediente está en {exp.estado}."
                ),
                "expediente_stage": exp.estado,
                "target_stage":     target_stage,
                "rule": "stage_index(target) <= stage_index(expediente)",
            }, status=409)

        # Capturar autor (best-effort).
        user = request.user
        created_by_id   = str(getattr(user, "id", "") or "") or None
        created_by_name = (
            getattr(user, "nombre", None)
            or getattr(user, "username", None)
            or getattr(user, "email", None)
            or "system"
        )

        instance = s.save(
            id=uuid.uuid4(),
            expediente_id=uuid.UUID(str(expediente_id)),
            created_by_id=created_by_id,
            created_by_name=created_by_name,
            updated_by_id=created_by_id,
            updated_by_name=created_by_name,
        )
        return Response(
            BuilderArtifactInstanceSerializer(instance).data,
            status=drf_status.HTTP_201_CREATED,
        )


class BuilderArtifactDetailView(APIView):
    """PATCH / DELETE sobre un artefacto específico."""

    permission_classes = [IsAuthenticated]

    def _get_or_404(self, expediente_id: str, artifact_id: str):
        try:
            return BuilderArtifactInstance.objects.get(
                pk=artifact_id, expediente_id=expediente_id, is_active=True,
            )
        except BuilderArtifactInstance.DoesNotExist:
            return None

    def patch(self, request, expediente_id: str, artifact_id: str):
        denied = _deny_client_mutation(request, action_label="builder_artifact.update")
        if denied is not None:
            return denied

        obj = self._get_or_404(expediente_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)

        # Si están moviendo a otra etapa, re-validar la regla.
        new_stage = (request.data or {}).get("stage")
        if new_stage and new_stage != obj.stage:
            try:
                exp = Expediente.objects.get(pk=expediente_id, is_active=True)
            except Expediente.DoesNotExist:
                return Response({"detail": "Expediente no existe"}, status=404)
            if not _can_attach_to_stage(exp.estado, new_stage):
                return Response({
                    "detail": (
                        f"No se puede mover el artefacto a {new_stage}: "
                        f"el expediente está en {exp.estado}."
                    ),
                }, status=409)

        s = BuilderArtifactInstanceUpdateSerializer(
            obj, data=request.data, partial=True,
        )
        s.is_valid(raise_exception=True)

        user = request.user
        s.save(
            updated_by_id=str(getattr(user, "id", "") or "") or None,
            updated_by_name=(
                getattr(user, "nombre", None)
                or getattr(user, "username", None)
                or getattr(user, "email", None)
                or "system"
            ),
        )
        obj.refresh_from_db()
        return Response(BuilderArtifactInstanceSerializer(obj).data)

    def delete(self, request, expediente_id: str, artifact_id: str):
        denied = _deny_client_mutation(request, action_label="builder_artifact.delete")
        if denied is not None:
            return denied

        # Soft-delete.
        n = BuilderArtifactInstance.objects.filter(
            pk=artifact_id, expediente_id=expediente_id,
        ).update(is_active=False)
        if n == 0:
            return Response({"detail": "Artefacto no existe"}, status=404)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Builder API proxy
#   Login server-side y cache del access token en memoria.
# ════════════════════════════════════════════════════════════
_BUILDER_BASE = os.environ.get(
    "BUILDER_API_BASE", "https://builder.muito.work/api",
).rstrip("/")
_BUILDER_USERNAME = os.environ.get("BUILDER_USERNAME", "Admin")
_BUILDER_PASSWORD = os.environ.get("BUILDER_PASSWORD", "")
_BUILDER_TOKEN_TTL_S = int(os.environ.get("BUILDER_TOKEN_TTL_S", "240"))  # 4 min

# Cache muy simple en proceso. En multi-worker (gunicorn) cada worker
# tendrá su propio cache; cuando expira (cada 4 min) se hace re-login.
_token_cache = {"access": None, "expires_at": 0.0}


def _builder_token() -> str:
    now = time.time()
    if _token_cache["access"] and _token_cache["expires_at"] > now + 30:
        return _token_cache["access"]

    if not _BUILDER_PASSWORD:
        raise RuntimeError("BUILDER_PASSWORD no está configurado en el entorno")

    resp = requests.post(
        f"{_BUILDER_BASE}/login/",
        json={"username": _BUILDER_USERNAME, "password": _BUILDER_PASSWORD},
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    access = body.get("access")
    if not access:
        raise RuntimeError("Builder login no devolvió access token")

    _token_cache["access"]     = access
    _token_cache["expires_at"] = now + _BUILDER_TOKEN_TTL_S
    return access


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def builder_templates_list(request):
    """Proxy a GET https://builder.muito.work/api/artefactos/.

    Filtramos para devolver sólo los Published — el resto no debería
    ofrecerse a usuarios finales.
    """
    try:
        token = _builder_token()
    except Exception as e:
        log.exception("[builder_templates_list] no pude obtener token")
        return Response(
            {"detail": "builder_unavailable", "error": str(e)[:200]},
            status=502,
        )
    try:
        r = requests.get(
            f"{_BUILDER_BASE}/artefactos/",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        log.warning("[builder_templates_list] fallo proxy: %s", e)
        return Response({"detail": "builder_proxy_error", "error": str(e)[:200]},
                        status=502)

    data = r.json() if r.text else []
    # Si llega como dict paginado de DRF, normalizamos.
    if isinstance(data, dict) and "results" in data:
        data = data["results"]

    only_published = (request.query_params.get("only_published") or "1") == "1"
    if only_published and isinstance(data, list):
        data = [t for t in data if (t or {}).get("status") == "Published"]
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def builder_template_detail(request, template_id: int):
    """Proxy a GET https://builder.muito.work/api/artefactos/{id}/."""
    try:
        token = _builder_token()
    except Exception as e:
        log.exception("[builder_template_detail] no pude obtener token")
        return Response({"detail": "builder_unavailable", "error": str(e)[:200]},
                        status=502)
    try:
        r = requests.get(
            f"{_BUILDER_BASE}/artefactos/{template_id}/",
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
    except requests.RequestException as e:
        log.warning("[builder_template_detail] fallo proxy: %s", e)
        return Response({"detail": "builder_proxy_error", "error": str(e)[:200]},
                        status=502)
    if r.status_code == 404:
        return Response({"detail": "template_not_found"}, status=404)
    if not r.ok:
        return Response({"detail": "builder_proxy_error",
                         "status": r.status_code}, status=502)
    return Response(r.json())
