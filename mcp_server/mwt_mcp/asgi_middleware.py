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

from typing import Any, Awaitable, Callable

from .config import settings
from .identity import (
    current_identity,
    current_tenant,
    set_identity,
    set_tenant,
    Tenant,
)


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
