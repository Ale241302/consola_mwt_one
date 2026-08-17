"""Contexto de identidad propagada por el gateway MCP (ContextForge).

Cuando el MCP server corre en modo streamable-http, un middleware ASGI lee
los headers X-Forwarded-User-* de cada request y los guarda en esta
contextvar. Las herramientas y el cliente HTTP pueden leerlos para reenviar
la identidad real al backend de MWT.ONE.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any

# Headers que nos interesan. ContextForge/Claude enviarán algunos de estos.
_IDENTITY_HEADERS = (
    "x-forwarded-user-email",
    "x-forwarded-user-id",
    "x-forwarded-user-name",
    "x-forwarded-user-roles",
    "x-forwarded-user-sub",
)

# ── Ola 2 · MCP por cliente (contenedor compartido) ────────────────
# Headers que el gateway (ContextForge / nginx) inyecta según el virtual
# server de la app de cada cliente.
_TENANT_HEADER = "x-mwt-client-id"
_GATEWAY_KEY_HEADER = "x-mwt-gateway-key"


class Tenant:
    """Cliente activo de la request MCP actual (Ola 2).

    El "cliente quemado" se resuelve por request, en orden de precedencia:
      1. Header `X-MWT-Client-ID` (inyectado por ContextForge según el vsid).
      2. Env `MWT_MCP_CLIENT_ID` (despliegue dedicado / stdio / testing).
      3. Ninguno → modo global/admin (`client_id=None`).

    `gateway_ok` indica si la request pasó la validación del `X-MWT-Gateway-Key`
    (cierra P0-2): si el MCP tiene `MWT_MCP_GATEWAY_KEY` definido y el header no
    coincide, la identidad X-Forwarded-User-* NO se honra.
    """

    def __init__(
        self,
        client_id: str | None = None,
        client_name: str | None = None,
        gateway_ok: bool = True,
        require_client_header: bool = False,
    ) -> None:
        self.client_id = (client_id or "").strip().lower() or None
        self.client_name = client_name or ""
        self.gateway_ok = bool(gateway_ok)
        self.require_client_header = bool(require_client_header)

    @property
    def is_scoped(self) -> bool:
        """True si esta request tiene un cliente resuelto (modo por cliente)."""
        return bool(self.client_id)

    @property
    def is_global(self) -> bool:
        return not self.is_scoped

    @property
    def label(self) -> str:
        return self.client_name or self.client_id or "(global)"

    def __repr__(self) -> str:
        return (
            f"Tenant(client_id={self.client_id!r}, name={self.client_name!r}, "
            f"gateway_ok={self.gateway_ok})"
        )


_tenant_ctx: ContextVar[Tenant] = ContextVar("mcp_tenant", default=Tenant())


def set_tenant(tenant: Tenant) -> None:
    """Establece el cliente activo de la request (llamado por el middleware)."""
    _tenant_ctx.set(tenant)


def current_tenant() -> Tenant:
    """Devuelve el cliente activo de la request MCP en curso."""
    return _tenant_ctx.get()


class Identity:
    """Snapshot de la identidad propagada para la request MCP actual."""

    def __init__(self, headers: dict[str, str] | None = None) -> None:
        h = {k.lower(): v for k, v in (headers or {}).items()}
        self.email: str | None = (h.get("x-forwarded-user-email") or "").strip() or None
        self.user_id: str | None = (h.get("x-forwarded-user-id") or "").strip() or None
        self.name: str | None = (h.get("x-forwarded-user-name") or "").strip() or None
        self.roles: str | None = (h.get("x-forwarded-user-roles") or "").strip() or None
        self.sub: str | None = (h.get("x-forwarded-user-sub") or "").strip() or None

    @property
    def is_present(self) -> bool:
        return bool(self.email or self.user_id or self.sub)

    def to_backend_headers(self) -> dict[str, str]:
        """Devuelve los headers para reenviar al backend cuando minteamos."""
        out: dict[str, str] = {}
        if self.email:
            out["X-Forwarded-User-Email"] = self.email
        if self.user_id:
            out["X-Forwarded-User-Id"] = self.user_id
        if self.name:
            out["X-Forwarded-User-Name"] = self.name
        if self.roles:
            out["X-Forwarded-User-Roles"] = self.roles
        if self.sub:
            out["X-Forwarded-User-Sub"] = self.sub
        return out

    def __repr__(self) -> str:
        return (
            f"Identity(email={self.email!r}, user_id={self.user_id!r}, "
            f"name={self.name!r})"
        )


_identity_ctx: ContextVar[Identity] = ContextVar("mcp_identity", default=Identity())


def set_identity(headers: dict[str, str] | None) -> None:
    """Establece la identidad actual (llamado por el middleware ASGI)."""
    _identity_ctx.set(Identity(headers))


def current_identity() -> Identity:
    """Devuelve la identidad de la request MCP en curso."""
    return _identity_ctx.get()


def identity_headers() -> dict[str, str]:
    """Alias: headers para reenviar al backend."""
    return current_identity().to_backend_headers()
