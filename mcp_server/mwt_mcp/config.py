"""Configuración del servidor MCP MWT.ONE (leída de variables de entorno)."""
from __future__ import annotations

import os


def _truthy(val: str | None) -> bool:
    return str(val or "").strip().lower() in ("1", "true", "yes", "y", "on")


class Settings:
    def __init__(self) -> None:
        self.api_base: str = os.environ.get(
            "MWT_API_BASE", "https://consola.mwt.one/api"
        ).rstrip("/")
        self.token: str = os.environ.get("MWT_MCP_TOKEN", "").strip()
        self.transport: str = os.environ.get("MWT_MCP_TRANSPORT", "stdio").strip().lower()
        self.host: str = os.environ.get("MWT_MCP_HOST", "0.0.0.0")
        self.port: int = int(os.environ.get("MWT_MCP_PORT", "8765"))
        self.http_timeout: float = float(os.environ.get("MWT_HTTP_TIMEOUT", "60"))
        self.readonly: bool = _truthy(os.environ.get("MWT_MCP_READONLY"))
        # Ola 2 · 2.14 — dominio MCP activo (comercial | logistica | finanzas).
        # Vacío/None => monolito completo (mwt-one). Se lee por env; el CLI
        # --domain tiene PRIORIDAD sobre esta variable (ver __main__).
        self.env_domain: str = (os.environ.get("MWT_MCP_DOMAIN") or "").strip().lower()

    def require_token(self) -> str:
        if not self.token:
            raise RuntimeError(
                "Falta MWT_MCP_TOKEN. Genéralo con `manage.py mint_mcp_token` y "
                "expórtalo en el entorno o en el .env del MCP."
            )
        return self.token


settings = Settings()

