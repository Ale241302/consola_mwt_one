"""Tests unitarios de la redacción por rol del MCP (Ola 3.5 · Eje B).

Corren SIN dependencias de red ni del paquete `mcp`: `redact.py` solo
importa `copy`. Verifican el contrato de la frontera:
  - CEO/Admin/ceo  -> acceso total (el MISMO objeto, sin copia).
  - client_b2b     -> oscurece costos, márgenes, comisiones, crédito, precio
                      MWT, proveedores y PII (catálogo B2B_FORBIDDEN).
  - staff (manager/operator/finance/viewer/desconocido) -> oscurece CEO_ONLY.
  - Sin identidad (user=None) -> sin redacción (ServiceToken puro).
  - Recursivo: dicts y listas anidadas (líneas de expediente, cost_breakdown).
  - Shape preservado: la clave se oscurece con "***", NO se elimina.
"""
from __future__ import annotations

import copy

import pytest

from mwt_mcp.redact import (
    B2B_FORBIDDEN_KEYS,
    CEO_ONLY_KEYS,
    forbidden_keys_for_role,
    is_client,
    is_ceo_or_admin,
    redact_for_role,
    redact_for_user,
)


def _expediente_payload() -> dict:
    """Shape realista de `expediente_obtener` / línea de expediente con
    campos CEO_ONLY que el backend devuelve a cualquier rol con la tool."""
    return {
        "id": "exp-1",
        "codigo": "EXP-1027",
        "estado": "PRODUCCION",
        "client_id": "cli-1",
        "moneda": "USD",
        "total_cost": 1234.50,               # CEO_ONLY
        "projected_margin": 0.18,            # CEO_ONLY
        "real_margin": None,                 # CEO_ONLY
        "credit_band": "GREEN",              # CEO_ONLY
        "lines": [
            {
                "id": "l-1",
                "sku": "70B22-CPAP",
                "size": "39",
                "qty": 12,
                "unit_price_mwt": 36.46,     # CEO_ONLY
                "unit_price_client": 48.74,  # visible
                "unit_cost": 25.10,          # CEO_ONLY
            },
        ],
        "proveedor": {
            "supplier_id": "sup-9",          # B2B-only
            "supplier_name": "Fabrica X",    # B2B-only
        },
        "contact_email": "cliente@mwt.example",  # B2B-only (PII)
        "notes": "todo bien",
    }


def test_ceo_ve_todo_mismo_objeto():
    """superadmin/admin/ceo reciben el payload SIN copiar (cero costo)."""
    payload = _expediente_payload()
    for role in ("superadmin", "admin", "ceo", "CEO", " Admin "):
        result = redact_for_role(payload, role)
        assert result is payload, f"rol {role!r} debe devolver el MISMO objeto"
    assert "unit_cost" in payload["lines"][0]
    assert "projected_margin" in payload


def test_is_ceo_or_admin():
    assert is_ceo_or_admin("superadmin")
    assert is_ceo_or_admin("admin")
    assert is_ceo_or_admin("ceo")
    assert not is_ceo_or_admin("manager")
    assert not is_ceo_or_admin("client_b2b")
    assert not is_ceo_or_admin(None)


def test_is_client():
    assert is_client("client_b2b")
    assert is_client("client")
    assert is_client("cliente")
    assert not is_client("manager")
    assert not is_client("admin")
    assert not is_client(None)


def test_client_b2b_no_ve_costos_margen_comisiones_proveedores_pii():
    payload = redact_for_role(_expediente_payload(), "client_b2b")
    assert payload["total_cost"] == "***"
    assert payload["projected_margin"] == "***"
    assert payload["lines"][0]["unit_cost"] == "***"
    assert payload["lines"][0]["unit_price_mwt"] == "***"
    # El dict completo de proveedor se oscurece (clave B2B_FORBIDDEN).
    assert payload["proveedor"] == "***"
    assert payload["contact_email"] == "***"
    # El precio del cliente y datos no sensibles quedan intactos.
    assert payload["lines"][0]["unit_price_client"] == 48.74
    assert payload["lines"][0]["sku"] == "70B22-CPAP"
    assert payload["notes"] == "todo bien"


def test_staff_no_ve_ceo_only_pero_si_ve_campos_operativos():
    for role in ("manager", "operator", "finance", "compras", "viewer", "otro"):
        payload = redact_for_role(_expediente_payload(), role)
        assert payload["total_cost"] == "***", role
        assert payload["projected_margin"] == "***", role
        assert payload["lines"][0]["unit_cost"] == "***", role
        assert payload["lines"][0]["unit_price_mwt"] == "***", role
        # Staff interno SÍ ve proveedor y PII (no es B2B).
        assert payload["proveedor"]["supplier_id"] == "sup-9", role
        assert payload["contact_email"] == "cliente@mwt.example", role


def test_recursivo_en_listas_de_dicts():
    data = {
        "ok": True,
        "results": [
            {"codigo": "A", "unit_cost": 10.0, "margen": 0.1},
            {"codigo": "B", "landed_cost_usd": 99.0, "comision_pct": 0.08},
        ],
    }
    out = redact_for_role(data, "manager")
    assert out["results"][0]["unit_cost"] == "***"
    assert out["results"][0]["margen"] == "***"
    assert out["results"][1]["landed_cost_usd"] == "***"
    assert out["results"][1]["comision_pct"] == "***"
    assert out["results"][0]["codigo"] == "A"


def test_shape_preservado():
    """El shape se conserva: la clave existe pero con '***'."""
    data = {"a": {"unit_cost": 5.0}}
    out = redact_for_role(data, "manager")
    assert "unit_cost" in out["a"]
    assert out["a"]["unit_cost"] == "***"


def test_no_identity_no_redact():
    """Sin identidad propagada (ServiceToken puro / stdio) -> sin cambios."""
    payload = _expediente_payload()
    assert redact_for_user(payload, None) is payload
    assert redact_for_user(payload, {}) is payload


def test_redact_for_user_usa_role_del_perfil():
    payload = _expediente_payload()
    out = redact_for_user(payload, {"role": "client_b2b"})
    assert out["total_cost"] == "***"
    out2 = redact_for_user(payload, {"role": "ceo", "role_slug": "ceo"})
    assert out2 is payload
    # Si solo está role_slug, se respeta igual.
    out3 = redact_for_user(payload, {"role_slug": "manager"})
    assert out3["projected_margin"] == "***"


def test_valores_anidados_no_dict_ni_lista_intactos():
    data = {"k": "string", "n": 5, "f": 3.14, "b": True, "nada": None}
    out = redact_for_role(data, "client_b2b")
    assert out == data


def test_forbidden_keys_for_role():
    assert forbidden_keys_for_role("admin") is None
    assert forbidden_keys_for_role("ceo") is None
    assert forbidden_keys_for_role("client_b2b") == B2B_FORBIDDEN_KEYS
    assert forbidden_keys_for_role("manager") == CEO_ONLY_KEYS
    assert forbidden_keys_for_role("") == CEO_ONLY_KEYS
    assert forbidden_keys_for_role(None) == CEO_ONLY_KEYS


def test_b2b_forbidden_supera_ceo_only():
    """El catálogo B2B es un superconjunto estricto del CEO_ONLY."""
    assert B2B_FORBIDDEN_KEYS.issuperset(CEO_ONLY_KEYS)
    assert len(B2B_FORBIDDEN_KEYS) > len(CEO_ONLY_KEYS)


def test_no_muta_el_original():
    """La redacción trabaja sobre una copia: el payload original no cambia."""
    payload = _expediente_payload()
    snapshot = copy.deepcopy(payload)
    redact_for_role(payload, "manager")
    assert payload == snapshot
