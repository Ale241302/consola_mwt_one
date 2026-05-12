"""
apps.nodos.views_builder_artifacts — Builder artifacts por nodo.

Sprint 2026-05-11 · Fase 4 — espejo del módulo
`apps.expedientes.views_builder_artifacts` pero parametrizado para
`nodos.builder_artifact_instance`.

Rutas (montadas por apps.nodos.urls):
  GET    /api/nodos/{nodo_id}/builder-artifacts/
  POST   /api/nodos/{nodo_id}/builder-artifacts/
  PATCH  /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/
  DELETE /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/  (soft)

El proxy real al Builder externo (`/api/builder/templates/`) ya existe
en `apps.expedientes.views_builder_artifacts` — lo seguimos usando desde
allá; este módulo solo gestiona las instancias *persistidas* en
`nodos.builder_artifact_instance`. El frontend hace ambas llamadas
secuencialmente (1: lista templates → 2: crea instancia con template_id).
"""
import uuid
import logging

from rest_framework import status as drf_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Nodo, NodoBuilderArtifactInstance
from .serializers import (
    NodoBuilderArtifactInstanceSerializer,
    NodoBuilderArtifactInstanceUpdateSerializer,
)

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# GET / POST /api/nodos/{nodo_id}/builder-artifacts/
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    # ── List ──────────────────────────────────────────
    def get(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        qs = NodoBuilderArtifactInstance.objects.filter(
            nodo_id=nodo_id, is_active=True,
        ).order_by("-created_at")

        template_id = request.query_params.get("template_id")
        if template_id:
            try:
                qs = qs.filter(template_id=int(template_id))
            except (TypeError, ValueError):
                pass

        return Response(
            NodoBuilderArtifactInstanceSerializer(qs, many=True).data
        )

    # ── Create ────────────────────────────────────────
    def post(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        # Defensa en profundidad: el nodo debe existir y estar activo.
        if not Nodo.objects.filter(pk=nodo_id, is_active=True).exists():
            return Response({"detail": "Nodo no existe"}, status=404)

        s = NodoBuilderArtifactInstanceSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Capturar autor (best-effort — el JWT siempre trae user.id si
        # el usuario está autenticado, pero algunos contextos legacy
        # pueden traer un AnonymousUser; protegemos con getattr).
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
            nodo_id=uuid.UUID(str(nodo_id)),
            created_by_id=created_by_id,
            created_by_name=created_by_name,
            updated_by_id=created_by_id,
            updated_by_name=created_by_name,
        )
        return Response(
            NodoBuilderArtifactInstanceSerializer(instance).data,
            status=drf_status.HTTP_201_CREATED,
        )


# ════════════════════════════════════════════════════════════
# PATCH / DELETE /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_or_404(self, nodo_id, artifact_id):
        try:
            return NodoBuilderArtifactInstance.objects.get(
                pk=artifact_id, nodo_id=nodo_id, is_active=True,
            )
        except NodoBuilderArtifactInstance.DoesNotExist:
            return None

    def get(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        return Response(NodoBuilderArtifactInstanceSerializer(obj).data)

    def patch(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)

        s = NodoBuilderArtifactInstanceUpdateSerializer(
            obj, data=request.data, partial=True,
        )
        s.is_valid(raise_exception=True)

        user = request.user
        updated_by_id   = str(getattr(user, "id", "") or "") or None
        updated_by_name = (
            getattr(user, "nombre", None)
            or getattr(user, "username", None)
            or getattr(user, "email", None)
            or "system"
        )
        s.save(updated_by_id=updated_by_id, updated_by_name=updated_by_name)
        # Devolvemos la entidad completa (no solo lo modificado) para que
        # el FE pueda refrescar el modal con los timestamps actualizados.
        obj.refresh_from_db()
        return Response(NodoBuilderArtifactInstanceSerializer(obj).data)

    def delete(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        # Soft-delete (convención MWT — preserva trazabilidad).
        obj.is_active = False
        obj.save(update_fields=["is_active", "updated_at"])
        return Response(status=204)
