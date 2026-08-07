"""Middleware ASGI que captura la identidad propagada por el gateway MCP.

ContextForge/Cloudflare (u otro proxy OAuth) inyecta headers
X-Forwarded-User-* en cada request HTTP al MCP server. Este middleware
lee esos headers y los guarda en un contextvar para que las herramientas
puedan emitir tokens de usuario correctos hacia el backend MWT.ONE.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from .identity import set_identity


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
            set_identity(headers)
            import sys
            identity = current_identity()
            print(
                f"[mwt-mcp] IdentityPropagationMiddleware: email={identity.email!r} "
                f"user_id={identity.user_id!r} name={identity.name!r} "
                f"roles={identity.roles!r} sub={identity.sub!r}",
                file=sys.stderr,
            )
            forwarded = {k: v for k, v in headers.items() if k.startswith("x-forwarded")}
            if forwarded:
                print(f"[mwt-mcp] forwarded headers: {forwarded!r}", file=sys.stderr)
        return await self.app(scope, receive, send)
