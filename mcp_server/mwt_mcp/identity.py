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
