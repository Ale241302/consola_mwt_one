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
        # Ola 2 · filtrado de tools por rol del usuario conectado (Rol basado).
        # Default ON. Con MWT_MCP_RBAC=0 el list_tools devuelve todas las tools
        # (comportamiento anterior, solo ServiceToken). El enforcement real de
        # permisos siempre vive en el backend; esto reduce lo que ve el agente.
        self.rbac_filter: bool = _truthy(os.environ.get("MWT_MCP_RBAC", "1"))

        # ── Ola 2 · Modo cliente quemado (MCP por cliente, contenedor compartido) ──
        # El cliente activo de cada request se resuelve así, en orden:
        #   1. Header `X-MWT-Client-ID` (inyectado por ContextForge según el
        #      virtual server) — producción multi-cliente.
        #   2. Env `MWT_MCP_CLIENT_ID` (UUID quemado por despliegue dedicado /
        #      stdio / testing).
        #   3. Ninguno → modo global/admin (ServiceToken, app mcp-admin).
        self.client_id: str = (os.environ.get("MWT_MCP_CLIENT_ID") or "").strip().lower()
        # Nombre legible del cliente (para errores TENANT_MISMATCH accionables).
        self.client_name: str = os.environ.get("MWT_MCP_CLIENT_NAME", "").strip()
        # Secreto compartido gateway→MCP: si se define, el middleware ASGI exige
        # que `X-MWT-Gateway-Key` coincida ANTES de honrar X-Forwarded-User-*.
        self.gateway_key: str = os.environ.get("MWT_MCP_GATEWAY_KEY", "").strip()
        # Fail-closed multi-tenant: si está activo, TODO request con identidad
        # debe traer `X-MWT-Client-ID`; sin él → 401 (un contenedor compartido
        # sin cliente no debe operar multi-tenant).
        self.require_client_header: bool = _truthy(
            os.environ.get("MWT_MCP_REQUIRE_CLIENT_HEADER")
        )

    def require_token(self) -> str:
        if not self.token:
            raise RuntimeError(
                "Falta MWT_MCP_TOKEN. Genéralo con `manage.py mint_mcp_token` y "
                "expórtalo en el entorno o en el .env del MCP."
            )
        return self.token


settings = Settings()

