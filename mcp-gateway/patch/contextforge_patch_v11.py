#!/usr/bin/env python3
"""MWT Ola 5 · generaliza v8/v9/v10 para múltiples servers virtuales por cliente.

ContextForge sirve varios servers virtuales MWT (uno por cliente) sobre la
MISMA gateway direct_proxy. Los patches v8/v9/v10 hardcodean el server_id
único de la app MWT global ("1290625df81d4121a18a66bb164f87f1"), así que un
vsid nuevo por cliente NO heredaría direct_proxy (tools/list cacheada y
tools/call sin identidad).

Este patch:
  1. Define `_MWT_SERVER_IDS_V11` con los vsid que deben ir SIEMPRE en
     direct_proxy. Se carga de la env `MWT_SERVER_IDS` (coma-separada) con
     fallback al vsid global. El vsid de cada cliente se añade al registrar
     el server (Ola 5 · registro).
  2. Reemplaza los literales de v8/v9/v10 por `server_id in _MWT_SERVER_IDS_V11`.

El header `X-MWT-Client-ID` / `X-MWT-Gateway-Key` NO se inyecta aquí: se
inyecta en nginx por ruta del vsid y ContextForge lo reenvía al upstream vía
`passthrough_headers` del gateway (config en DB). El MCP server (Ola 2) lo
valida antes de honrar la identidad.
"""

import os

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

# vsid de la app MWT global (admin) + vsid de Sondel (piloto Ola 5).
# El vsid de cada cliente nuevo se añade aquí al registrar su server virtual.
_DEFAULT_IDS = "1290625df81d4121a18a66bb164f87f1,c090bf4d-af94-4aff-b682-8e9d1ebdcd6d"


def _server_ids() -> set:
    raw = os.environ.get("MWT_SERVER_IDS", "").strip()
    ids = [x.strip() for x in raw.split(",") if x.strip()] if raw else []
    ids = ids or [x.strip() for x in _DEFAULT_IDS.split(",") if x.strip()]
    return set(ids)


def _define_block() -> str:
    ids = sorted(_server_ids())
    return (
        "\n"
        "# ── MWT Ola 5 · servers MWT en direct_proxy (v11) ──────────────────\n"
        f"_MWT_SERVER_IDS_V11 = {ids!r}\n"
    )


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "_MWT_SERVER_IDS_V11" in content:
        print("ContextForge MWT multi-server direct_proxy patch v11 already applied.")
        return

    replacements = [
        (
            'if server_id == "1290625df81d4121a18a66bb164f87f1":',
            "if server_id in _MWT_SERVER_IDS_V11:",
        ),
        (
            'if not gateway_id_from_header and server_id == "1290625df81d4121a18a66bb164f87f1":',
            "if not gateway_id_from_header and server_id in _MWT_SERVER_IDS_V11:",
        ),
    ]
    applied = 0
    for old, new in replacements:
        if old in content and new not in content:
            content = content.replace(old, new, 1)
            applied += 1
        elif old in content:
            applied += 1  # ya generalizado (forma nueva presente en otra iteración)

    # v10 puede tener el literal con indentación distinta; barrido general.
    if 'server_id == "1290625df81d4121a18a66bb164f87f1"' in content:
        content = content.replace(
            'server_id == "1290625df81d4121a18a66bb164f87f1"',
            "server_id in _MWT_SERVER_IDS_V11",
        )

    # Definir el set tras el primer bloque de imports (antes de la 1ª def/async def).
    lines = content.split("\n")
    anchor = None
    for i, ln in enumerate(lines):
        if ln.startswith(("async def ", "def ", "class ")):
            anchor = i
            break
    if anchor is None:
        anchor = len(lines)
    lines.insert(anchor, _define_block())
    content = "\n".join(lines)

    # Import os (si falta) — el define usa os.environ.
    if "import os\n" not in content and "import os " not in content:
        # insertar tras el primer import
        for i, ln in enumerate(lines):
            if ln.startswith(("import ", "from ")):
                lines.insert(i + 1, "import os")
                content = "\n".join(lines)
                break

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"ContextForge MWT multi-server patch v11 applied successfully ({applied} literal(s) generalizado(s)).")


if __name__ == "__main__":
    main()
