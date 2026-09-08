"""
MWT.ONE · contextforge_patch_v13.py (Ola 7 · Fase 3 onboarding MCP)

Permite requests con `Authorization: DeviceToken <secret>` SIN pasar por el
OAuth interactivo de Authentik, para que un agente IA conecte directo al MCP
de la empresa con la credencial emitida por correo (core.mcp_device_grant).

El secret NO se valida aquí: se reenvía aguas abajo y la validación real
(vinculación por IP + revocación) ocurre en el backend de MWT.ONE en
`POST /api/auth/mcp-token/`. La capa que patcheamos es `require_auth`
(utils/verify_credentials.py), el chokepoint que hoy responde 401 antes de
llegar al upstream cuando no hay sesión OAuth.
"""
import os

FILE = "/app/mcpgateway/utils/verify_credentials.py"
MARKER = "MWT Ola 7 · DeviceToken"

OLD = (
    "    # If MCP client auth is disabled and proxy auth is trusted, use proxy headers\n"
    "    if not settings.mcp_client_auth_enabled:"
)

NEW = (
    "    # ===== MWT Ola 7 · DeviceToken (onboarding MCP por correo) =====\n"
    "    # Bypass OAuth SOLO para credenciales directas del tipo\n"
    "    # `Authorization: DeviceToken <secret>`. El secret viaja aguas abajo;\n"
    "    # la validacion real (bind por IP + revocacion) la hace el backend\n"
    "    # MWT.ONE en POST /api/auth/mcp-token/ (fail-closed).\n"
    "    _raw_auth = (request.headers.get(\"authorization\") or \"\").strip()\n"
    "    if _raw_auth.lower().startswith(\"devicetoken \"):\n"
    "        _secret = _raw_auth.split(None, 1)[1].strip()\n"
    "        request.state._jwt_verified_payload = {\n"
    "            \"sub\": \"device-token\",\n"
    "            \"source\": \"devicetoken\",\n"
    "            \"email\": None,\n"
    "            \"device_token\": _secret,\n"
    "            \"is_admin\": False,\n"
    "            \"teams\": None,\n"
    "        }\n"
    "        request.state._device_token = _secret\n"
    "        return request.state._jwt_verified_payload\n"
    "    # ===== /MWT Ola 7 DeviceToken =====\n"
    "\n"
    + OLD
)


def main() -> None:
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if MARKER in content:
        print("[v13] ya aplicado — skip")
        return
    if OLD not in content:
        print("[v13] ANCLA NO ENCONTRADA — no se aplicó (revisar versión de ContextForge)")
        return

    content = content.replace(OLD, NEW, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("[v13] DeviceToken bypass aplicado en require_auth")


if __name__ == "__main__":
    main()
