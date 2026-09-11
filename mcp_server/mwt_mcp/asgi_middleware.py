"""Middleware ASGI que captura la identidad propagada por el gateway MCP.

ContextForge/Cloudflare (u otro proxy OAuth) inyecta headers
X-Forwarded-User-* en cada request HTTP al MCP server. Este middleware
lee esos headers y los guarda en un contextvar para que las herramientas
puedan emitir tokens de usuario correctos hacia el backend MWT.ONE.

Ola 2 · MCP por cliente (contenedor compartido):
  · Lee `X-MWT-Client-ID` (cliente de la app según el virtual server) y
    `X-MWT-Gateway-Key` (secreto compartido gateway→MCP).
  · Valida el Gateway Key ANTES de honrar X-Forwarded-User-* (cierra P0-2):
    si `MWT_MCP_GATEWAY_KEY` está definido y el header no coincide, la
    identidad propagada NO se confía (cae a modo ServiceToken / anónimo).
  · Si `MWT_MCP_REQUIRE_CLIENT_HEADER=1` y no viene `X-MWT-Client-ID`,
    la request se rechaza con 401 (un contenedor compartido sin cliente no
    debe operar multi-tenant).
"""
from __future__ import annotations

import base64
import json
from typing import Any, Awaitable, Callable

from .config import settings
from .identity import (
    current_identity,
    current_tenant,
    set_identity,
    set_tenant,
    Tenant,
)


def _jwt_alg(token: str) -> str | None:
    """Devuelve el `alg` del header de un JWT (sin verificar firma)."""
    try:
        header_b64 = token.split(".")[0]
        pad = "=" * (-len(header_b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(header_b64 + pad))
        return data.get("alg")
    except Exception:  # noqa: BLE001
        return None



class IdentityPropagationMiddleware:
    """Envuelve la app MCP y extrae identidad del scope ASGI."""

    def __init__(self, app: Callable[..., Awaitable[Any]]) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> Any:
        if scope.get("type") == "http":
            headers = {}
            for raw_name, raw_value in scope.get("headers", []):
                name = raw_name.decode("latin-1").lower()
                value = raw_value.decode("latin-1")
                headers[name] = value

            # ── Ola 2 · cliente activo (X-MWT-Client-ID) ──────────────
            hdr_client = (headers.get("x-mwt-client-id") or "").strip().lower()
            resolved_client = hdr_client or settings.client_id

            # ── Ola 2 · validación del Gateway Key (P0-2) ─────────────
            gateway_ok = True
            if settings.gateway_key:
                provided = (headers.get("x-mwt-gateway-key") or "").strip()
                gateway_ok = provided and provided == settings.gateway_key

            # ── Ola 2 · fail-closed: cliente requerido por header ─────
            if (
                settings.require_client_header
                and not hdr_client
            ):
                return await self._reject_http(
                    send,
                    status=401,
                    detail=(
                        "CLIENT_HEADER_REQUIRED: este servidor MCP opera "
                        "multi-cliente y requiere el header X-MWT-Client-ID."
                    ),
                )

            # Solo se confía la identidad propagada si el gateway key pasó.
            effective_headers = dict(headers)
            if settings.gateway_key and not gateway_ok:
                for k in list(effective_headers.keys()):
                    if k.startswith("x-forwarded-user"):
                        del effective_headers[k]

            # ── Fase 3 · DeviceToken (Authorization: DeviceToken <secret>) ──
            # Credencial directa del onboarding por correo: el MCP la resuelve
            # contra el backend (POST /api/auth/mcp-token/ con grant_secret+ip)
            # que vincula el equipo (IP) al primer uso. El acceso público al
            # contenedor es SOLO vía nginx (location /device/) que reenvía la IP
            # real (CF-Connecting-IP); el backend valida secret+IP fail-closed.
            #
            # M365 Copilot MCP · Microsoft Entra ID: Authorization: Bearer <entra>.
            # El token Entra (multi-inquilino) viaja como x-mwt-entra-token y el
            # mint lo manda al backend (POST /api/auth/mcp-token/ con entra_token),
            # que valida JWKS + mapea por email a la consola MWT.
            device_secret = None
            entra_token = None
            authz = (headers.get("authorization") or "").strip()
            if authz.lower().startswith("devicetoken "):
                device_secret = authz.split(None, 1)[1].strip() or None
            elif authz.lower().startswith("bearer "):
                candidate = authz.split(None, 1)[1].strip() or None
                # Solo reenviamos al backend tokens OIDC asimétricos (RS256):
                # son los únicos validables (Authentik / Entra). El gateway
                # (ContextForge) también reenvía su propio token de sesión
                # HS256 (sin iss/aud), que NO es validable → en ese caso nos
                # quedamos con la identidad propagada X-Forwarded-User-*.
                if candidate and _jwt_alg(candidate) == "RS256":
                    entra_token = candidate
            # ── OAuth opt-in (MWT_MCP_OAUTH=1) ─────────────────────────────
            # Una request MCP SIN Authorization (ni DeviceToken ni Bearer)
            # dispara el challenge OAuth para que el cliente (Claude Desktop
            # conector / M365 Copilot) sepa a qué authorization server ir.
            # Solo aplica cuando está activo; no toca el flujo DeviceToken.
            if (settings.mcp_oauth and not device_secret and not entra_token
                    and not authz.lower().startswith(("devicetoken ", "bearer "))):
                metadata = f"{settings.oauth_base}/.well-known/oauth-authorization-server"
                body = (
                    '{"error": true, "code": "OAUTH_REQUIRED", '
                    f'"resource": "{settings.oauth_base}", '
                    f'"metadata": "{metadata}"}}'
                ).encode("utf-8")
                await send({
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"www-authenticate",
                         f'Bearer resource_metadata="{metadata}"'.encode("ascii")),
                        (b"content-length", str(len(body)).encode("ascii")),
                    ],
                })
                await send({"type": "http.response.body", "body": body})
                return
            if device_secret:
                effective_headers["x-mwt-device-secret"] = device_secret
                client_ip = (
                    (headers.get("x-forwarded-for") or "").split(",")[0].strip()
                    or (headers.get("x-real-ip") or "").strip()
                    or None
                )
                if not client_ip and scope.get("client"):
                    try:
                        client_ip = str(scope["client"][0])
                    except Exception:  # noqa: BLE001
                        client_ip = None
                if client_ip:
                    effective_headers["x-mwt-client-ip"] = client_ip
            if entra_token:
                effective_headers["x-mwt-entra-token"] = entra_token

            set_identity(effective_headers)
            set_tenant(Tenant(
                client_id=resolved_client,
                client_name=settings.client_name or None,
                gateway_ok=gateway_ok,
                require_client_header=settings.require_client_header,
            ))

            import sys
            identity = current_identity()
            tenant = current_tenant()
            print(
                f"[mwt-mcp] IdentityPropagationMiddleware: email={identity.email!r} "
                f"user_id={identity.user_id!r} name={identity.name!r} "
                f"roles={identity.roles!r} sub={identity.sub!r} "
                f"tenant={tenant.client_id!r} gateway_ok={tenant.gateway_ok}",
                file=sys.stderr,
            )
            forwarded = {k: v for k, v in headers.items() if k.startswith("x-forwarded")}
            if forwarded:
                print(f"[mwt-mcp] forwarded headers: {forwarded!r}", file=sys.stderr)
        return await self.app(scope, receive, send)

    async def _reject_http(
        self,
        send: Callable,
        status: int,
        detail: str,
    ) -> None:
        """Envía una respuesta HTTP de error sin invocar la app MCP."""
        body = (
            f'{{"error": true, "code": "CLIENT_HEADER_REQUIRED", '
            f'"detail": "{detail}"}}'
        ).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
