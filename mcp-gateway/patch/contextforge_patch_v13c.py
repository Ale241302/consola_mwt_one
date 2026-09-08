"""
MWT.ONE · contextforge_patch_v13c.py (Ola 7 · Fase 3 onboarding MCP)

Cierra el enrutado del DeviceToken dentro de ContextForge:

1) utils/gateway_access.py
   - ContextVar `_mwt_device_token_var` + `set_device_token()` para que una
     request autenticada por DeviceToken propague su secret al upstream.
   - `check_gateway_access()` permite la request device (la pertenencia/scope
     real la valida el backend MWT.ONE en mcp-token, no la visibilidad del
     gateway).
   - `build_gateway_auth_headers()` inyecta
     `Authorization: DeviceToken <secret>` hacia el MCP upstream.

2) transports/streamablehttp_transport.py
   - `authenticate()` acepta el esquema DeviceToken: marca el contexto como
     autenticado (is_authenticated=True, auth_method="devicetoken") para saltar
     el OAuth per-server y deja pasar la request al handler MCP.
"""
import os

GA = "/app/mcpgateway/utils/gateway_access.py"
TX = "/app/mcpgateway/transports/streamablehttp_transport.py"
MARKER_GA = "MWT Ola 7 · DeviceToken gateway_access"
MARKER_TX = "MWT Ola 7 · DeviceToken transport"


# ── 1) gateway_access.py ───────────────────────────────────────────────

GA_IMPORT_OLD = "from mcpgateway.db import Gateway as DbGateway"
GA_IMPORT_NEW = (
    GA_IMPORT_OLD + "\n"
    "from contextvars import ContextVar\n"
    "\n"
    "# MWT Ola 7 · secret del DeviceToken activo en esta request (onboarding MCP).\n"
    "_mwt_device_token_var: ContextVar = ContextVar(\"mwt_device_token\", default=None)\n"
    "\n"
    "\n"
    "def set_device_token(token: str | None) -> None:\n"
    "    \"\"\"Registra el DeviceToken de la request actual para propagarlo al upstream.\"\"\"\n"
    "    _mwt_device_token_var.set(token)\n"
)

GA_ACCESS_OLD = (
    "    visibility = gateway.visibility if hasattr(gateway, \"visibility\") else \"public\"\n"
)
GA_ACCESS_NEW = (
    "    if _mwt_device_token_var.get(None):\n"
    "        # MWT Ola 7 · acceso por DeviceToken: la pertenencia y el scope los\n"
    "        # valida el backend MWT.ONE (POST /api/auth/mcp-token/), no la\n"
    "        # visibilidad del gateway.\n"
    "        return True\n"
    "\n"
    + GA_ACCESS_OLD
)

GA_BUILD_OLD = (
    "            auth_header = decoded.get(\"Authorization\", \"\")\n"
    "            if auth_header:  # Add header if not empty\n"
    "                headers[\"Authorization\"] = auth_header\n"
    "\n"
    "    return headers\n"
)
GA_BUILD_NEW = (
    "            auth_header = decoded.get(\"Authorization\", \"\")\n"
    "            if auth_header:  # Add header if not empty\n"
    "                headers[\"Authorization\"] = auth_header\n"
    "\n"
    "    # MWT Ola 7 · propaga el DeviceToken del cliente hacia el MCP upstream.\n"
    "    _dev = _mwt_device_token_var.get(None)\n"
    "    if _dev and not headers.get(\"Authorization\"):\n"
    "        headers[\"Authorization\"] = f\"DeviceToken {_dev}\"\n"
    "\n"
    "    return headers\n"
)

# ── 2) streamablehttp_transport.py ─────────────────────────────────────

TX_AUTH_OLD = (
    "        authorization = get_auth_header_value(headers)\n"
    "        proxy_trusted = is_proxy_auth_trust_active(settings)\n"
)
TX_AUTH_NEW = (
    "        authorization = get_auth_header_value(headers)\n"
    "        # ===== MWT Ola 7 · DeviceToken (onboarding MCP por correo) =====\n"
    "        # Credencial directa: se marca el contexto como autenticado para\n"
    "        # saltar el OAuth per-server; el header se propaga al upstream en\n"
    "        # build_gateway_auth_headers y la validación real (IP + revocación)\n"
    "        # la hace el backend MWT.ONE.\n"
    "        if (authorization or \"\").lower().startswith(\"devicetoken \"):\n"
    "            _dev_secret = authorization.split(None, 1)[1].strip()\n"
    "            from mcpgateway.utils.gateway_access import set_device_token  # noqa: PLC0415\n"
    "            set_device_token(_dev_secret)\n"
    "            user_context_var.set({\n"
    "                \"email\": None,\n"
    "                \"teams\": [],\n"
    "                \"is_authenticated\": True,\n"
    "                \"is_admin\": False,\n"
    "                \"permission_is_admin\": False,\n"
    "                \"auth_method\": \"devicetoken\",\n"
    "                \"device_token\": _dev_secret,\n"
    "            })\n"
    "            try:\n"
    "                set_trace_context_from_teams([], auth_method=\"devicetoken\")\n"
    "            except Exception:\n"
    "                pass\n"
    "            return True\n"
    "        # ===== /MWT Ola 7 DeviceToken =====\n"
    "        proxy_trusted = is_proxy_auth_trust_active(settings)\n"
)


def _patch(path: str, old: str, new: str, marker: str, label: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if marker in content:
        print(f"[v13c] {label}: ya aplicado — skip")
        return
    if old not in content:
        print(f"[v13c] {label}: ANCLA NO ENCONTRADA — revisar versión de ContextForge")
        return
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[v13c] {label}: OK")


def main() -> None:
    _patch(GA, GA_IMPORT_OLD, GA_IMPORT_NEW, MARKER_GA, "gateway_access imports")
    _patch(GA, GA_ACCESS_OLD, GA_ACCESS_NEW, "MWT Ola 7 · acceso por DeviceToken",
           "check_gateway_access")
    _patch(GA, GA_BUILD_OLD, GA_BUILD_NEW, "propaga el DeviceToken del cliente",
           "build_gateway_auth_headers")
    _patch(TX, TX_AUTH_OLD, TX_AUTH_NEW, MARKER_TX, "transport authenticate")


if __name__ == "__main__":
    main()
