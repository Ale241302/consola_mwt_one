#!/usr/bin/env python3
"""MWT Ola 5 · generaliza v8/v9/v10 para múltiples servers virtuales por cliente.

ContextForge sirve varios servers virtuales MWT (uno por cliente) sobre la
MISMA gateway direct_proxy. Los patches v8/v9/v10 hardcodean el server_id
único de la app MWT global ("1290625df81d4121a18a66bb164f87f1"), así que un
vsid nuevo por cliente NO heredaría direct_proxy (tools/list cacheada y
tools/call sin identidad).

Este patch:
  1. Define `_MWT_SERVER_IDS_V11` con los vsid que deben ir SIEMPRE en
     direct_proxy. Se genera desde la env `MWT_SERVER_IDS` (coma-separada) o,
     si no está, desde `_DEFAULT_IDS`.
  2. Reemplaza los literales de v8/v9/v10 por `server_id in _MWT_SERVER_IDS_V11`.

Bug corregido (2026-11-03): la primera versión emitía
`_MWT_SERVER_IDS_V11 = ['id1,id2,...,idN']` (UN solo string con comas dentro)
porque `_DEFAULT_IDS` era un str por concatenación implícita de literales. Con
eso `server_id in _MWT_SERVER_IDS_V11` nunca daba True: el gateway seguía
sirviendo tools/list desde la cache SQLite (99 tools congeladas) en lugar de
proxear en vivo al server MCP (175 tools filtradas por rol). Este patch ahora:
  · arma la lista con ids separados de verdad (lista de str, un id por elemento),
  · valida el formato de cada id y descarta basura,
  · REPARA una definición ya existente en el archivo (antes salía con
    "already applied" y no arreglaba nada),
  · valida con `ast.parse` antes de escribir.

El header `X-MWT-Client-ID` / `X-MWT-Gateway-Key` NO se inyecta aquí: se
inyecta en nginx por ruta del vsid y ContextForge lo reenvía al upstream vía
`passthrough_headers` del gateway (config en DB). El MCP server (Ola 2) lo
valida antes de honrar la identidad.
"""

import ast
import os
import re

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

# vsid de la app MWT global (admin) + vsid de todos los clientes activos.
# El vsid de cada cliente nuevo se añade aquí al registrar su server virtual.
_DEFAULT_IDS = [
    "1290625df81d4121a18a66bb164f87f1",  # app MWT global (admin)
    "c090bf4d-af94-4aff-b682-8e9d1ebdcd6d",  # Sondel
    "299b060e-d78f-4608-9314-f0f5bf2f12c2",  # Comtek
    "c062e0bc-2d2b-4018-ad47-7ed364c5c9db",  # Importaciones y Compras
    "d8853fca-cfe6-4fc5-adce-1e0183124c6f",  # Procostumer
    "1078a317-f34e-428a-8170-050f65bc7154",  # Sonepar
    "e658aae0-247d-4bf7-a22f-49b9577b733a",  # Imporcomp
    "6e62ee55-876c-4570-b707-58eebcdc0e65",  # Muito Work Limitada
    "ab007e48-766e-476b-a9f4-d563a21d845f",  # prueba
    "2575d681-1384-4fc3-929a-f5e2a953c189",  # Test RBAC Bloqueo2
]

_ID_RE = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", re.I)
_DEF_RE = re.compile(r"^_MWT_SERVER_IDS_V11\s*=.*$", re.M)


def _server_ids() -> list:
    """Lista de vsid MWT (env `MWT_SERVER_IDS` o el set por defecto)."""
    raw = os.environ.get("MWT_SERVER_IDS", "").strip()
    source = [x for x in raw.split(",")] if raw else list(_DEFAULT_IDS)

    ids = []
    for token in source:
        token = str(token).strip()
        if not token:
            continue
        if not _ID_RE.match(token):
            print(f"[v11] WARN: id con formato inválido descartado: {token!r}")
            continue
        ids.append(token.lower())
    return sorted(set(ids))


def _assign_line() -> str:
    ids = _server_ids()
    if not ids:
        raise SystemExit("[v11] ERROR: no hay server ids válidos; no se parchea.")
    return f"_MWT_SERVER_IDS_V11 = {ids!r}"


def _define_block() -> str:
    return (
        "\n"
        "# ── MWT Ola 5 · servers MWT en direct_proxy (v11) ──────────────────\n"
        f"{_assign_line()}\n"
    )


def _generalize_literals(content: str) -> int:
    """Reemplaza los literales de v8/v9/v10 por el check contra la lista."""
    applied = 0
    for old, new in (
        (
            'if server_id == "1290625df81d4121a18a66bb164f87f1":',
            "if server_id in _MWT_SERVER_IDS_V11:",
        ),
        (
            'if not gateway_id_from_header and server_id == "1290625df81d4121a18a66bb164f87f1":',
            "if not gateway_id_from_header and server_id in _MWT_SERVER_IDS_V11:",
        ),
        (
            'server_id == "1290625df81d4121a18a66bb164f87f1"',
            "server_id in _MWT_SERVER_IDS_V11",
        ),
    ):
        if old in content:
            content = content.replace(old, new)
            applied += 1
    return applied


def _install_definition(content: str) -> str:
    """Inserta —o REPARA— la definición de `_MWT_SERVER_IDS_V11`."""
    if _DEF_RE.search(content):
        # Repara una definición previa (aunque esté mal formada) sin tocar el resto.
        return _DEF_RE.sub(_assign_line(), content, count=1)

    block = _define_block()
    lines = content.split("\n")
    anchor = None
    for i, ln in enumerate(lines):
        if ln.startswith(("async def ", "def ", "class ")):
            anchor = i
            break
    if anchor is None:
        anchor = len(lines)
    lines.insert(anchor, block)
    return "\n".join(lines)


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    original = content
    literal_hits = _generalize_literals(content)
    content = _install_definition(content)

    if content == original:
        print("ContextForge MWT multi-server direct_proxy patch v11: sin cambios.")
        return

    try:
        ast.parse(content)
    except SyntaxError as exc:
        print(f"[v11] ERROR: el archivo parcheado no compila ({exc}); no se escribe.")
        raise SystemExit(1)

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print(
        "ContextForge MWT multi-server patch v11 applied "
        f"({literal_hits} literal(es) generalizado(s), {len(_server_ids())} vsid)."
    )


if __name__ == "__main__":
    main()
