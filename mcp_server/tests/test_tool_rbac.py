"""Tests de `tool_rbac.py` (Ola 3.9 · H2).

Cubre el filtrado de tools por rol:
  - Sin usuario / sin identidad -> todas (None = sin restricción).
  - modules=["*"] -> todas.
  - Rol sin matriz -> solo introspección (fail-safe).
  - Módulo sin acción -> solo las view de ese módulo + siempre-visibles.
  - Permisos en string JSON -> parseo correcto.
  - `list_tools` fail-closed: identidad inválida -> lista vacía.
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import tool_rbac
from mwt_mcp.tool_rbac import allowed_tool_names


# ─────────────────────────────────────────────────────────────────────── #
# allowed_tool_names
# ─────────────────────────────────────────────────────────────────────── #
def test_sin_usuario_devuelve_none():
    assert allowed_tool_names(None) is None
    assert allowed_tool_names({}) is None


def test_modules_wildcard_devuelve_none():
    user = {"permissions": {"modules": ["*"], "actions": []}}
    assert allowed_tool_names(user) is None


def test_rol_sin_matriz_solo_introspeccion():
    user = {"permissions": {"modules": [], "actions": []}}
    allowed = allowed_tool_names(user)
    assert allowed is not None
    assert "mwt_whoami" in allowed
    assert "mwt_health" in allowed
    # 9bf5f21: mwt_diag_scope es CEO-only (roles.view) — NO es siempre-visible.
    assert "mwt_diag_scope" not in allowed
    assert "cliente_crear" not in allowed
    assert "expediente_crear" not in allowed


def test_modulo_view_solo_tools_lectura():
    """modules=["expedientes"] con actions=['expedientes.view'] -> solo view del módulo."""
    user = {"permissions": {"modules": ["expedientes"], "actions": ["expedientes.view"]}}
    allowed = allowed_tool_names(user)
    assert "expediente_obtener" in allowed      # view
    assert "expediente_listar" in allowed       # view
    assert "expediente_crear" not in allowed    # create
    assert "expediente_eliminar" not in allowed  # delete
    assert "expediente_avanzar_estado" not in allowed  # update
    assert "mwt_whoami" in allowed              # siempre visible


def test_modulo_sin_actions_permite_todo_el_modulo():
    """Diseño del código: modules sin actions explícitas -> TODAS las tools del módulo."""
    user = {"permissions": {"modules": ["expedientes"], "actions": []}}
    allowed = allowed_tool_names(user)
    assert "expediente_obtener" in allowed
    assert "expediente_crear" in allowed
    assert "expediente_eliminar" in allowed
    assert "cliente_crear" not in allowed       # otro módulo no activo


def test_modulo_y_accion_especifica():
    user = {"permissions": {"modules": ["clientes"], "actions": ["clientes.create"]}}
    allowed = allowed_tool_names(user)
    assert "cliente_crear" in allowed
    assert "cliente_obtener" not in allowed  # sin clientes.view
    assert "cliente_editar" not in allowed


def test_actions_wildcard_permite_modulo_completo():
    user = {"permissions": {"modules": ["pagos"], "actions": ["*"]}}
    allowed = allowed_tool_names(user)
    assert "pago_listar" in allowed
    assert "pago_registrar" in allowed
    assert "pago_conciliar" in allowed


def test_permisos_en_string_json():
    import json

    perms = {"modules": ["nodos"], "actions": ["nodos.view"]}
    user = {"permissions": json.dumps(perms)}
    allowed = allowed_tool_names(user)
    assert "nodo_listar" in allowed
    assert "nodo_crear" not in allowed


def test_permisos_como_lista():
    user = {"permissions": ["expedientes", "clientes"]}
    allowed = allowed_tool_names(user)
    # "modules" derivado de la lista; sin actions -> todas las tools de esos módulos.
    assert "expediente_obtener" in allowed
    assert "expediente_crear" in allowed
    assert "cliente_obtener" in allowed
    assert "transferencia_listar" not in allowed


def test_todas_las_tools_estan_mapeadas():
    """Regresión: toda tool registrada en server.py tiene entrada en TOOL_MODULES."""
    from mwt_mcp import server

    registered = set()
    for name, fn in server.mcp._tool_manager._tools.items():
        registered.add(name)
    mapeadas = set(tool_rbac.TOOL_MODULES.keys())
    sin_mapa = registered - mapeadas
    assert not sin_mapa, f"Tools sin mapeo RBAC: {sorted(sin_mapa)}"


# ─────────────────────────────────────────────────────────────────────── #
# RbacFastMCP.list_tools — fail-closed
# ─────────────────────────────────────────────────────────────────────── #
@pytest.mark.asyncio
async def test_list_tools_fail_closed_sin_jwt():
    """Identidad propagada pero backend no emite JWT -> lista VACÍA (fail-closed)."""
    from mcp.types import Tool

    from mwt_mcp.tool_rbac import RbacFastMCP

    mcp = RbacFastMCP("test")
    # Registramos 2 tools de prueba.
    def _a() -> str:
        return "a"

    def _b() -> str:
        return "b"

    mcp.add_tool(_a, name="cliente_crear")
    mcp.add_tool(_b, name="cliente_obtener")

    from mwt_mcp.jwt_minter import IdentityMintingError

    with mock.patch("mwt_mcp.tool_rbac.get_identity_user",
                    side_effect=IdentityMintingError("no JWT")):
        tools = await mcp.list_tools()
    assert tools == []


@pytest.mark.asyncio
async def test_list_tools_error_inesperado_fail_closed():
    from mwt_mcp.tool_rbac import RbacFastMCP

    mcp = RbacFastMCP("test")
    mcp.add_tool(lambda: "x", name="cliente_crear")

    with mock.patch("mwt_mcp.tool_rbac.get_identity_user",
                    side_effect=RuntimeError("boom")):
        tools = await mcp.list_tools()
    assert tools == []


@pytest.mark.asyncio
async def test_list_tools_sin_identidad_todas():
    from mwt_mcp.tool_rbac import RbacFastMCP

    mcp = RbacFastMCP("test")
    mcp.add_tool(lambda: "a", name="cliente_crear")
    mcp.add_tool(lambda: "b", name="mwt_whoami")

    with mock.patch("mwt_mcp.tool_rbac.get_identity_user", return_value=None):
        tools = await mcp.list_tools()
    names = {t.name for t in tools}
    assert names == {"cliente_crear", "mwt_whoami"}
