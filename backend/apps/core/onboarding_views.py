"""
=====================================================================
MWT.ONE · apps.core.onboarding_views
Endpoints HTTP del onboarding MCP (Fase 2).

Públicos (formulario /registro-mcp):
  GET  /api/onboarding/clientes?q=      → clientes MCP-provisioned + sub.
  POST /api/onboarding/registro          → crea solicitud PENDIENTE.

Admin (role admin/ceo/superadmin):
  GET  /api/onboarding/solicitudes?estado=PENDIENTE
  POST /api/onboarding/solicitudes/<id>/aprobar
  POST /api/onboarding/solicitudes/<id>/rechazar   {motivo}
=====================================================================
"""
from __future__ import annotations

import uuid as _uuid

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.permissions import IsCeoOrAdmin

from . import mcp_onboarding_reg as reg


def _client_ip(request) -> str | None:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR") or ""
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


class RegistrableClientsView(APIView):
    """Autocomplete público: empresas con acceso MCP + subsidiarias."""
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_registro_q"

    def get(self, request):
        q = request.query_params.get("q", "").strip()
        results = reg.search_registrable_clients(q=q, limit=20)
        return Response({"results": results})


class RegistroMCPView(APIView):
    """Registro público → solicitud PENDIENTE (no habilita login)."""
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_registro"

    def post(self, request):
        payload = request.data or {}
        result = reg.create_registration(
            payload,
            ip=_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT"),
        )
        if not result.get("ok"):
            code = result.get("code")
            st = 409 if code in ("EMAIL_EXISTE", "PENDIENTE_EXISTE") else status.HTTP_400_BAD_REQUEST
            return Response({"detail": result.get("detail"), "code": code},
                            status=st)
        return Response({"ok": True, "id": result["id"],
                         "detail": result.get("detail")},
                        status=status.HTTP_201_CREATED)


class SolicitudesView(APIView):
    permission_classes = [IsAuthenticated, IsCeoOrAdmin]

    def get(self, request):
        estado = (request.query_params.get("estado") or "PENDIENTE").upper()
        rows = reg.listar_solicitudes(estado=estado, limit=100)
        return Response({"estado": estado, "results": rows})


class SolicitudResolverView(APIView):
    """POST /api/onboarding/solicitudes/<id>/aprobar|rechazar"""

    permission_classes = [IsAuthenticated, IsCeoOrAdmin]

    def _admin_id(self, request) -> str | None:
        uid = getattr(request.user, "user_id", None) or getattr(request.user, "id", None)
        return str(uid) if uid else None

    def post(self, request, pk=None, action="aprobar"):
        try:
            req_id = str(_uuid.UUID(str(pk)))
        except Exception:  # noqa: BLE001
            return Response({"detail": "id inválido"}, status=400)
        if action == "aprobar":
            result = reg.aprobar_solicitud(req_id, admin_user_id=self._admin_id(request))
        else:
            motivo = (request.data or {}).get("motivo") or ""
            result = reg.rechazar_solicitud(req_id, motivo=motivo)
        if not result.get("ok"):
            code = result.get("code", "ERROR")
            st = 404 if code in ("NOT_FOUND", "ESTADO") else 400
            return Response({"detail": result.get("detail"), "code": code}, status=st)
        return Response(result)
