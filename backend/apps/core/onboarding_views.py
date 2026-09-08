"""
=====================================================================
MWT.ONE · apps.core.onboarding_views
Endpoints HTTP del onboarding MCP (Fase 2).

Públicos (formulario /registro-mcp):
  GET  /api/onboarding/clientes?q=      → clientes MCP-provisioned + sub.
  POST /api/onboarding/registro          → crea solicitud PENDIENTE.

Servicio (ServiceToken con scope mcp:token_exchange) — para integración
externa (el pipeline de correo interno los usa como funciones directas):
  POST /api/onboarding/validate          → clasifica email: existe/activo/cliente.
  POST /api/onboarding/emit-grant        → emite credencial device-bound + paquete.

Admin (role admin/ceo/superadmin):
  GET  /api/onboarding/solicitudes?estado=PENDIENTE
  POST /api/onboarding/solicitudes/<id>/aprobar
  POST /api/onboarding/solicitudes/<id>/rechazar   {motivo}
=====================================================================
"""
from __future__ import annotations

import os
import uuid as _uuid

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.authentication import MwtServiceTokenAuthentication, ServiceTokenUser
from apps.core.permissions import IsCeoOrAdmin

from . import mcp_onboarding as ob
from . import mcp_onboarding_reg as reg


def _client_ip(request) -> str | None:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR") or ""
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _device_base() -> str:
    return (os.environ.get("MWT_MCP_DEVICE_URL") or "").strip() or "https://mcp.mwt.one/device"


def _serialize_client(c: dict) -> dict:
    """Cliente MCP con URLs de conexión (oauth del core.mcp_app + device)."""
    return {
        "cliente_id": c.get("cliente_id"),
        "razon_social": c.get("razon_social") or c.get("nombre"),
        "slug": c.get("slug"),
        "mcp_url": c.get("mcp_url"),          # URL ContextForge/OAuth almacenada
        "mcp_url_device": _device_base(),     # URL directa del DeviceToken
    }


class _ServiceScopedView(APIView):
    """Base para endpoints de servicio del onboarding.

    Exige ServiceToken con scope `mcp:token_exchange` (igual que
    POST /api/auth/mcp-token/).
    """
    authentication_classes = [MwtServiceTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_onboarding"

    def _service_ok(self, request):
        user = request.user
        if isinstance(user, ServiceTokenUser) and user.has_scope("mcp:token_exchange"):
            return user
        return None


class OnboardingValidateView(_ServiceScopedView):
    """POST /api/onboarding/validate — clasifica un email solicitante.

    Body: {email, remitente_ip?} → {existe, activo, scenario,
    cliente_mcp?, ambiguo?, clientes:[...]}.
    """

    def post(self, request):
        if not self._service_ok(request):
            return Response(
                {"detail": "Se requiere ServiceToken con scope mcp:token_exchange"},
                status=status.HTTP_403_FORBIDDEN)
        email = str((request.data or {}).get("email") or "").strip().lower()
        if not email or "@" not in email:
            return Response({"detail": "email inválido"}, status=400)

        decision = ob.decide_scenario(email)
        target = decision.get("target")
        clients = decision.get("clients") or []
        scenario = decision.get("scenario", "no_registrado")

        out = {
            "email": email,
            "scenario": scenario,
            "existe": bool(target),
            "activo": bool(target and target.get("is_active")),
            "ambiguo": scenario == "elegir_empresa",
            "clientes": [_serialize_client(c) for c in clients],
        }
        if decision.get("client"):
            out["cliente_mcp"] = _serialize_client(decision["client"])
        return Response(out)


class OnboardingEmitGrantView(_ServiceScopedView):
    """POST /api/onboarding/emit-grant — emite la credencial device-bound.

    Body: {email, cliente_id?, creado_via?} →
    {ok, secret (única vez), grant, cliente, paquete{json, md}}.
    Emitir uno nuevo revoca el grant previo del par (single-active, D3).
    """

    def post(self, request):
        if not self._service_ok(request):
            return Response(
                {"detail": "Se requiere ServiceToken con scope mcp:token_exchange"},
                status=status.HTTP_403_FORBIDDEN)
        payload = request.data or {}
        email = str(payload.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return Response({"detail": "email inválido"}, status=400)

        decision = ob.decide_scenario(email)
        target = decision.get("target")
        if not target:
            return Response({"detail": "Usuario no registrado", "code": "EMAIL_NOT_FOUND"},
                            status=404)
        if not target.get("is_active"):
            return Response({"detail": "Usuario inactivo", "code": "USER_INACTIVO"},
                            status=403)

        clients = decision.get("clients") or []
        if not clients:
            return Response(
                {"detail": "El usuario no tiene empresa con MCP provisionado.",
                 "code": "SIN_MCP"}, status=400)

        wanted = str(payload.get("cliente_id") or "").strip().lower()
        client = None
        if wanted:
            client = next((c for c in clients
                           if str(c.get("cliente_id")).lower() == wanted), None)
            if not client:
                return Response(
                    {"detail": "cliente_id no está entre las empresas MCP del usuario.",
                     "code": "CLIENTE_INVALIDO",
                     "clientes": [_serialize_client(c) for c in clients]},
                    status=400)
        elif len(clients) == 1:
            client = clients[0]
        else:
            return Response(
                {"detail": "El usuario tiene varias empresas MCP: indica cliente_id.",
                 "code": "REQUIERE_CLIENTE_ID",
                 "clientes": [_serialize_client(c) for c in clients]},
                status=400)

        creado_via = str(payload.get("creado_via") or "email").strip().lower()
        if creado_via not in ("email", "registro", "external"):
            creado_via = "external"

        grant = ob.emit_grant(
            target, client["cliente_id"],
            creado_via=creado_via,
            ip=str(payload.get("ip") or "") or _client_ip(request),
            mac=str(payload.get("mac") or "") or None,
            user_agent=request.META.get("HTTP_USER_AGENT"),
        )
        package = ob.build_package(client, target, grant)
        return Response({
            "ok": True,
            "secret": grant["secret"],            # única vez — no se re-emite
            "grant": {
                "id": grant["grant_id"],
                "estado": grant["estado"],
                "expira_iso": grant["expira_iso"],
                "secret_prefix": grant["secret_prefix"],
            },
            "cliente": _serialize_client(client),
            "paquete": {
                "fname_json": package["fname_json"],
                "json": package["json_text"],
                "mime_json": package["mime_json"],
                "fname_md": package["fname_md"],
                "md": package["md_text"],
                "mime_md": package["mime_md"],
            },
        })


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
            st = 409 if code in ("EMAIL_EXISTE", "PENDIENTE_EXISTE", "CUENTA_ACTIVA") else status.HTTP_400_BAD_REQUEST
            return Response({"detail": result.get("detail"), "code": code},
                            status=st)
        return Response({"ok": True, "id": result["id"],
                         "detail": result.get("detail")},
                        status=status.HTTP_201_CREATED)


class ReactivacionMCPView(APIView):
    """POST /api/onboarding/reactivacion — usuario inactivo pide re-activarse."""
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_registro"

    def post(self, request):
        payload = request.data or {}
        result = reg.create_registration(
            payload,
            ip=_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT"),
            tipo="reactivacion",
        )
        if not result.get("ok"):
            code = result.get("code")
            st = 409 if code in ("EMAIL_EXISTE", "PENDIENTE_EXISTE", "CUENTA_ACTIVA") else status.HTTP_400_BAD_REQUEST
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
    action = "aprobar"  # sobreescrito por as_view(action=...)

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


class UsuarioEmpresasMCPView(APIView):
    """GET /api/onboarding/usuarios/<uuid>/empresas — empresas del usuario
    para el modal de envío de credenciales (admin)."""
    permission_classes = [IsAuthenticated, IsCeoOrAdmin]

    def get(self, request, user_id=None):
        try:
            uid = str(_uuid.UUID(str(user_id)))
        except Exception:  # noqa: BLE001
            return Response({"detail": "id inválido"}, status=400)
        rows = reg.listar_empresas_mcp(uid)
        return Response({"results": rows})


class EnviarCredencialesMCPView(APIView):
    """POST /api/onboarding/usuarios/<uuid>/enviar-credenciales  {cliente_id}
    → emite el grant de esa empresa y envía el correo con .json/.md (admin)."""
    permission_classes = [IsAuthenticated, IsCeoOrAdmin]

    def post(self, request, user_id=None):
        try:
            uid = str(_uuid.UUID(str(user_id)))
        except Exception:  # noqa: BLE001
            return Response({"detail": "id inválido"}, status=400)
        cliente_id = str((request.data or {}).get("cliente_id") or "").strip()
        if not cliente_id:
            return Response({"detail": "Falta cliente_id."}, status=400)
        result = reg.emitir_y_enviar_credenciales(uid, cliente_id)
        if not result.get("ok"):
            code = result.get("code", "ERROR")
            return Response({"detail": result.get("detail"), "code": code},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(result)
