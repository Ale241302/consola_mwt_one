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
    filter_documentos_for_role,
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
        "balance": 500.00,                   # B2B-only (Ola 3.8)
        "total_invoiced": 1700.00,           # B2B-only (Ola 3.8)
        "total_paid": 1200.00,               # B2B-only (Ola 3.8)
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
    """superadmin/admin/ceo ven TODOS los datos financieros, PERO reciben copia
    filtrada sin UUIDs internos (Ola 3.8: el filtro de IDs aplica a todos los roles)."""
    payload = _expediente_payload()
    for role in ("superadmin", "admin", "ceo", "CEO", " Admin "):
        result = redact_for_role(payload, role)
        # Financiero intacto.
        assert result["total_cost"] == 1234.50, role
        assert result["projected_margin"] == 0.18, role
        assert result["lines"][0]["unit_cost"] == 25.10, role
        assert result["lines"][0]["unit_price_mwt"] == 36.46, role
        # UUID interno de proveedor oculto también para CEO/Admin.
        assert result["proveedor"]["supplier_id"] == "***", role
    # El original no se mutó.
    assert payload["proveedor"]["supplier_id"] == "sup-9"


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
        # Staff interno ve proveedor y PII (no es B2B), pero NO el UUID supplier_id.
        assert payload["proveedor"]["supplier_name"] == "Fabrica X", role
        assert payload["proveedor"]["supplier_id"] == "***", role
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
    # CEO ve financiero intacto pero sin UUIDs internos (copia filtrada).
    assert out2["total_cost"] == 1234.50
    assert out2["proveedor"]["supplier_id"] == "***"
    # Si solo está role_slug, se respeta igual.
    out3 = redact_for_user(payload, {"role_slug": "manager"})
    assert out3["projected_margin"] == "***"


def test_client_b2b_no_ve_balance_ni_totales_internos():
    """Ola 3.8 · el client_b2b NO ve balance/total_invoiced/total_paid."""
    payload = _expediente_payload()
    out = redact_for_role(payload, "client_b2b")
    assert out["balance"] == "***"
    assert out["total_invoiced"] == "***"
    assert out["total_paid"] == "***"
    assert out["projected_margin"] == "***"
    assert out["total_cost"] == "***"
    # CEO/Admin sí los ven.
    out_ceo = redact_for_role(payload, "ceo")
    assert out_ceo["balance"] == 500.00


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


def test_exp_codigo_se_elimina_para_todos_los_roles():
    """El código interno EXP- se elimina en TODOS los roles (no solo client_b2b),
    esté donde esté el campo (raíz, anidado en listas, expediente_codigo)."""
    payload = {
        "id": "exp-1",
        "codigo": "EXP-505201-2",
        "codigo_interno": "EXP-505201-2",
        "expediente_codigo": "EXP-505201-2",
        "oc_codigos": ["PO 505201"],
        "lines": [{"codigo": "EXP-505201-2", "sku": "700728"}],
    }
    for role in ("admin", "ceo", "manager", "client_b2b"):
        out = redact_for_role(payload, role)
        assert "codigo" not in out, role
        assert "codigo_interno" not in out, role
        assert "expediente_codigo" not in out, role
        assert out["lines"][0].get("codigo") is None or "codigo" not in out["lines"][0], role
        assert out["oc_codigos"] == ["PO 505201"], role
        assert out["id"] == "exp-1", role  # UUID de encadenamiento se conserva


def test_exp_codigo_no_elimina_codigo_negocio():
    """Un `codigo` que NO sea EXP- (ej. PO, SKU) se conserva."""
    payload = {"codigo": "PO 505201", "sku": "700728"}
    out = redact_for_role(payload, "admin")
    assert out["codigo"] == "PO 505201"
    assert out["sku"] == "700728"


def test_client_b2b_oculta_ids_internos_puros():
    """Ola 3.8 · filtro sistémico: UUIDs de usuarios/operador/proveedor y
    claves de infraestructura se oscurecen para client_b2b."""
    payload = {
        "id": "exp-1",                     # raíz: encadenable -> se mantiene
        "expediente_id": "exp-1",          # encadenable -> se mantiene
        "client_id": "cli-1",              # encadenable -> se mantiene
        "created_by_id": "u-1",            # interno -> ***
        "approved_by_id": "u-2",           # interno -> ***
        "uploaded_by": "u-3",              # interno -> ***
        "operating_company_id": "mwt-1",   # interno -> ***
        "proveedor_id": "sup-1",           # interno -> ***
        "storage_url": "s3://bucket/key",  # infra -> ***
        "object_key": "buckets/2026/a.pdf",
        "sha256": "abc123",
        "scope_json": {"expediente_ids": ["e1"]},
        "codigo": "PO 504302",             # código de negocio visible
        "oc_codigos": ["PO 504302"],
        "estado": "EN_DESTINO",
        "lines": [
            {"id": "l1", "producto_id": "p1", "sku": "700728",
             "unit_price_client": 48.74, "created_by_id": "u-9"},
        ],
    }
    out = redact_for_role(payload, "client_b2b")
    # Encadenables se conservan.
    assert out["id"] == "exp-1"
    assert out["expediente_id"] == "exp-1"
    assert out["client_id"] == "cli-1"
    assert out["lines"][0]["id"] == "l1"
    assert out["lines"][0]["producto_id"] == "p1"
    assert out["lines"][0]["unit_price_client"] == 48.74
    # Internos se oscurecen.
    assert out["created_by_id"] == "***"
    assert out["approved_by_id"] == "***"
    assert out["uploaded_by"] == "***"
    assert out["operating_company_id"] == "***"
    assert out["proveedor_id"] == "***"
    assert out["storage_url"] == "***"
    assert out["object_key"] == "***"
    assert out["sha256"] == "***"
    assert out["scope_json"] == "***"
    assert out["lines"][0]["created_by_id"] == "***"
    # Código de negocio y estado visibles.
    assert out["codigo"] == "PO 504302"
    assert out["estado"] == "EN_DESTINO"


def test_client_b2b_oculta_cualquier_id_futuro():
    """Regla sistémica: una clave *_id desconocida se oscurece automáticamente
    para client_b2b (no requiere parche tool por tool)."""
    payload = {"id": "x", "audit_actor_id": "u1", "nuevo_recurso_id": "r1",
               "expediente_id": "e1", "notas": "ok"}
    out = redact_for_role(payload, "client_b2b")
    assert out["audit_actor_id"] == "***"
    assert out["nuevo_recurso_id"] == "***"
    assert out["expediente_id"] == "e1"   # encadenable
    assert out["id"] == "x"               # raíz
    assert out["notas"] == "ok"


def test_staff_tambien_oculta_ids_internos():
    """El filtro de IDs internos aplica a TODOS los roles (Ola 3.8): también
    el staff interno y admin/CEO dejan de recibir UUIDs de auditoría/operador."""
    payload = {"id": "exp-1", "created_by_id": "u-1", "operating_company_id": "mwt-1"}
    for role in ("manager", "operator", "admin", "ceo"):
        out = redact_for_role(payload, role)
        assert out["created_by_id"] == "***", role
        assert out["operating_company_id"] == "***", role
        assert out["id"] == "exp-1"  # raíz encadenable se conserva


def test_client_b2b_ve_proforma_oc_factura_audience_client():
    """Regla CEO 2026-08-19 · client_b2b ve SOLO documentos kind PROFORMA/OC/
    FACTURA con audience CLIENT. FABRICA/MWT_INTERNAL/ADMIN_ONLY se ocultan."""
    docs = [
        {"id": "d1", "kind": "PROFORMA", "audience": "CLIENT"},
        {"id": "d2", "kind": "PROFORMA", "audience": "FABRICA"},
        {"id": "d3", "kind": "PROFORMA", "audience": "MWT_INTERNAL"},
        {"id": "d4", "kind": "OC", "audience": "CLIENT"},
        {"id": "d5", "kind": "FACTURA", "audience": "CLIENT"},
        {"id": "d6", "kind": "ART-04", "audience": "ADMIN_ONLY"},
        {"id": "d7", "kind": "FACTURA", "audience": "CLIENTE"},
    ]
    out = filter_documentos_for_role({"results": docs}, "client_b2b")
    ids = [r["id"] for r in out["results"]]
    assert ids == ["d1", "d4", "d5", "d7"]
    # Admin/CEO no se filtran.
    out_admin = filter_documentos_for_role({"results": docs}, "admin")
    assert len(out_admin["results"]) == 7
