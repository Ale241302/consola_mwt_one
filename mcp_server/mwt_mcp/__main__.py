"""Punto de entrada del servidor MCP MWT.ONE.

Uso:
    python -m mwt_mcp            # transporte stdio (default)
    MWT_MCP_TRANSPORT=http python -m mwt_mcp   # streamable-http
"""
from __future__ import annotations

import sys

from .config import settings
from .server import mcp


def main() -> None:
    transport = settings.transport
    if transport in ("http", "streamable-http", "streamable_http"):
        # FastMCP toma host/port de sus settings; los reflejamos desde el entorno.
        mcp.settings.host = settings.host
        mcp.settings.port = settings.port
        print(
            f"[mwt-mcp] streamable-http en {settings.host}:{settings.port} "
            f"-> {settings.api_base}",
            file=sys.stderr,
        )
        mcp.run(transport="streamable-http")
    else:
        print(f"[mwt-mcp] stdio -> {settings.api_base}", file=sys.stderr)
        mcp.run()


if __name__ == "__main__":
    main()
