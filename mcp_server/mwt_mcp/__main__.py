"""Punto de entrada del servidor MCP MWT.ONE.

Uso:
    python -m mwt_mcp                        # monolito completo, stdio (default)
    python -m mwt_mcp --domain comercial     # solo dominio comercial, stdio
    MWT_MCP_DOMAIN=finanzas python -m mwt_mcp            # dominio por env, stdio
    MWT_MCP_TRANSPORT=http python -m mwt_mcp --domain logistica   # streamable-http

Ola 2 · 2.14 — split por dominio: `--domain` / `MWT_MCP_DOMAIN` levanta SOLO las
tools de ese dominio (comercial | logistica | finanzas) más las compartidas,
para reducir el costo fijo de contexto por conversación. Sin indicar dominio se
arranca el monolito `mwt-one` (comportamiento anterior, 105 tools).
"""
from __future__ import annotations

import argparse
import sys

import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from .asgi_middleware import IdentityPropagationMiddleware
from .config import settings
from .server import mcp


def _resolve_domain(argv: list[str] | None) -> str | None:
    """Devuelve el dominio pedido por --domain o MWT_MCP_DOMAIN, o None."""
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--domain", default=None)
    ns, _ = p.parse_known_args(argv)
    return (ns.domain or settings.env_domain or "").strip().lower() or None


def _server_for_domain() -> FastMCP:
    """Construye el servidor de dominio correspondiente (o el monolito)."""
    from . import domains
    domain = _resolve_domain(sys.argv[1:])
    if not domain:
        return mcp
    # valida que el dominio sea conocido; build lanza ValueError si no.
    return domains.build(domain)


def _run(server: FastMCP) -> None:
    """Levanta el servidor (http o stdio)."""
    transport = settings.transport
    if transport in ("http", "streamable-http", "streamable_http"):
        server.settings.host = settings.host
        server.settings.port = settings.port
        server.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        )
        app = server.streamable_http_app()
        wrapped = IdentityPropagationMiddleware(app)
        print(
            f"[mwt-mcp] {server.name} streamable-http en "
            f"{settings.host}:{settings.port} -> {settings.api_base}",
            file=sys.stderr,
        )
        uvicorn.run(
            wrapped,
            host=settings.host,
            port=settings.port,
            log_level="info",
        )
    else:
        print(
            f"[mwt-mcp] {server.name} stdio -> {settings.api_base}",
            file=sys.stderr,
        )
        server.run()


def run_domain(domain: str) -> None:
    """Arranca un servidor MCP de dominio específico (usado por domains_cli)."""
    from . import domains
    _run(domains.build(domain))


def main() -> None:
    _run(_server_for_domain())


if __name__ == "__main__":
    main()

