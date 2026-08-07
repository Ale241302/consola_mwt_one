"""Punto de entrada del servidor MCP MWT.ONE.

Uso:
    python -m mwt_mcp            # transporte stdio (default)
    MWT_MCP_TRANSPORT=http python -m mwt_mcp   # streamable-http
"""
from __future__ import annotations

import sys

import uvicorn

from .asgi_middleware import IdentityPropagationMiddleware
from .config import settings
from .server import mcp


def main() -> None:
    transport = settings.transport
    if transport in ("http", "streamable-http", "streamable_http"):
        mcp.settings.host = settings.host
        mcp.settings.port = settings.port
        app = mcp.streamable_http_app()
        wrapped = IdentityPropagationMiddleware(app)
        print(
            f"[mwt-mcp] streamable-http en {settings.host}:{settings.port} "
            f"-> {settings.api_base}",
            file=sys.stderr,
        )
        uvicorn.run(
            wrapped,
            host=settings.host,
            port=settings.port,
            log_level="info",
        )
    else:
        print(f"[mwt-mcp] stdio -> {settings.api_base}", file=sys.stderr)
        mcp.run()


if __name__ == "__main__":
    main()
