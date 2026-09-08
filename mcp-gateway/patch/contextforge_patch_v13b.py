"""
MWT.ONE · contextforge_patch_v13b.py (Ola 7 · Fase 3 onboarding MCP)

Complemento de v13: el middleware CSRF de ContextForge rechazaba las
requests con `Authorization: DeviceToken <secret>` (solo exime esquema
Bearer). Este patch exime también el esquema DeviceToken en
`middleware/csrf_middleware.py`, igual que ya se hace con Bearer (no hay
cookie ambiental que proteger; la credencial es un header portador).
"""
FILE = "/app/mcpgateway/middleware/csrf_middleware.py"
MARKER = "MWT Ola 7 · DeviceToken CSRF"

OLD = (
    '        # 4. Skip Bearer token requests (not vulnerable to CSRF)\n'
    '        auth_header = get_auth_header_value(request.headers) or ""\n'
    '        if _extract_bearer_token(auth_header):\n'
    '            return await call_next(request)\n'
)

NEW = OLD + (
    '\n'
    '        # 4a. Skip DeviceToken requests (MWT Ola 7 · onboarding MCP por correo):\n'
    '        # credencial directa portadora, sin cookies -> no aplica CSRF.\n'
    '        if (auth_header or "").lower().startswith("devicetoken "):\n'
    '            return await call_next(request)\n'
)


def main() -> None:
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()
    if MARKER in content:
        print("[v13b] ya aplicado — skip")
        return
    if OLD not in content:
        print("[v13b] ANCLA NO ENCONTRADA — no se aplicó")
        return
    content = content.replace(OLD, NEW, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("[v13b] CSRF exime DeviceToken")


if __name__ == "__main__":
    main()
