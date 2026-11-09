"""Contratos del harness — A2 y C1 (`01_AJUSTES_MWT_ONE_Y_MCP.md`).

A2 · un rol de cliente nunca recibe las tools de fases/backfill.
C1 · `validate_cambios` acepta `allow_empty`, así `expediente_edit_full_patch`
     deja de fallar con `TypeError`.

Tests puros: no hablan con el backend ni con la base.
"""
from __future__ import annotations

import pytest

from mwt_mcp.schemas import validate_cambios
from mwt_mcp.tool_rbac import (
    _CLIENT_FORBIDDEN_TOOLS,
    allowed_tool_names,
    is_tool_denied,
)


def _user(role: str, modules: list[str], actions: list[str]) -> dict:
    return {"role": role, "permissions": {"modules": modules, "actions": actions}}


# ─────────────────────────────────────────────────────────────────────
# C1 · firma de validate_cambios
# ─────────────────────────────────────────────────────────────────────
class TestC1ValidateCambios:
    def test_acepta_allow_empty_como_lo_llama_el_servidor(self):
        """server.py llama validate_cambios(cambios, label=..., allow_empty=False)."""
        assert validate_cambios({"operating_company_id": "x"}, label="cambios de edit-full", allow_empty=False) is None

    def test_allow_empty_true_permite_dict_vacio(self):
        assert validate_cambios({}, allow_empty=True) is None

    def test_dict_vacio_sigue_rechazado_por_defecto(self):
        error = validate_cambios({})
        assert isinstance(error, str) and "vacío" in error

    def test_allow_empty_false_rechaza_vacio(self):
        error = validate_cambios({}, label="cambios de edit-full", allow_empty=False)
        assert isinstance(error, str) and "edit-full" in error

    def test_allowed_keys_sigue_funcionando(self):
        error = validate_cambios({"campo_raro": 1}, label="cambios", allowed_keys={"forma_pago"})
        assert isinstance(error, str) and "campo_raro" in error


# ─────────────────────────────────────────────────────────────────────
# A2 · fases/backfill fuera del alcance del cliente
# ─────────────────────────────────────────────────────────────────────
class TestA2RbacCliente:
    def _cliente_expedientes_view(self) -> dict:
        return _user("client_b2b", ["expedientes"], ["expedientes.view"])

    def test_cliente_no_ve_phase_durations_get(self):
        permitidas = allowed_tool_names(self._cliente_expedientes_view())
        assert permitidas is not None
        assert "expediente_phase_durations_get" not in permitidas

    def test_cliente_no_ve_ninguna_tool_prohibida(self):
        permitidas = allowed_tool_names(self._cliente_expedientes_view()) or set()
        assert permitidas.isdisjoint(_CLIENT_FORBIDDEN_TOOLS)

    def test_cliente_conserva_la_lectura_legitima(self):
        permitidas = allowed_tool_names(self._cliente_expedientes_view()) or set()
        assert "expediente_tiempos" in permitidas
        assert "expediente_obtener" in permitidas

    def test_operador_interno_si_la_conserva(self):
        permitidas = allowed_tool_names(_user("operador", ["expedientes"], ["expedientes.view"]))
        assert permitidas is not None
        assert "expediente_phase_durations_get" in permitidas

    def test_admin_sin_restriccion(self):
        assert allowed_tool_names(_user("admin", ["*"], ["*"])) is None

    def test_sin_identidad_sin_restriccion(self):
        assert allowed_tool_names(None) is None

    def test_cliente_con_wildcard_tampoco_las_recibe(self):
        """Bypass cerrado: modules=['*'] en un rol cliente no devuelve None."""
        permitidas = allowed_tool_names(_user("client_b2b", ["*"], ["*"]))
        assert permitidas is not None
        assert permitidas.isdisjoint(_CLIENT_FORBIDDEN_TOOLS)

    def test_call_tool_deniega_la_lectura_prohibida(self):
        """El rechazo real vive en call_tool, no solo en el listado."""
        assert is_tool_denied("expediente_phase_durations_get", set()) is True
        assert is_tool_denied("expediente_phase_durations_set", set()) is True

    def test_call_tool_deja_pasar_la_lectura_legitima(self):
        assert is_tool_denied("expediente_tiempos", set()) is False

    def test_call_tool_deniega_escritura_fuera_del_set(self):
        assert is_tool_denied("expediente_crear", set()) is True

    def test_sin_restriccion_no_deniega(self):
        assert is_tool_denied("expediente_phase_durations_get", None) is False
