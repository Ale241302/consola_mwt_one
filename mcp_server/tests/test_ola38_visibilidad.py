"""Tests Ola 3.8 · visibilidad de documentos y artefactos para client_b2b."""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp.redact import (
    filter_artefactos_for_role,
    filter_documentos_for_role,
)


# ─────────────────────────────────────────────────────────────────────── #
# Documentos: client_b2b solo ve audience=CLIENT y kind OC/PROFORMA
# ─────────────────────────────────────────────────────────────────────── #
DOCS = [
    {"id": "d1", "kind": "PROFORMA", "audience": "FABRICA", "codigo": "PF 2480-2026"},
    {"id": "d2", "kind": "PROFORMA", "audience": "MWT_INTERNAL", "codigo": "PF 2480-2026"},
    {"id": "d3", "kind": "PROFORMA", "audience": "CLIENT", "codigo": "PF 2480-2026"},
    {"id": "d4", "kind": "OC", "audience": "CLIENT", "codigo": "PO 505201"},
    {"id": "d5", "kind": "OC", "audience": "CLIENT", "codigo": "505200"},
    {"id": "d6", "kind": "ART-04", "audience": "ADMIN_ONLY", "codigo": "280007"},  # SAP
]


def test_filter_documentos_client_oculta_internos():
    out = filter_documentos_for_role(DOCS, "client_b2b")
    ids = [d["id"] for d in out]
    assert ids == ["d3", "d4", "d5"]  # solo OC del cliente + Proforma Cliente
    assert "d1" not in ids  # Proforma Fábrica
    assert "d2" not in ids  # Proforma MWT
    assert "d6" not in ids  # Confirmación SAP (ART-04)


def test_filter_documentos_admin_ve_todo():
    out = filter_documentos_for_role(DOCS, "admin")
    assert len(out) == 6
    out2 = filter_documentos_for_role(DOCS, "ceo")
    assert len(out2) == 6


def test_filter_documentos_paginated():
    payload = {"count": 6, "results": DOCS}
    out = filter_documentos_for_role(payload, "client_b2b")
    assert len(out["results"]) == 3
    assert out["count"] == 6  # meta intacta


# ─────────────────────────────────────────────────────────────────────── #
# Artefactos: client_b2b solo ve publicado=True
# ─────────────────────────────────────────────────────────────────────── #
ARTS = [
    {"id": "a1", "template_title": "Factura Comercial", "publicado": False},
    {"id": "a2", "template_title": "AWB/BL (Documento de Envío)", "publicado": True},
    {"id": "a3", "template_title": "Packing List Detallado", "publicado": True},
    {"id": "a4", "template_title": "Certificado de Origen", "publicado": True},
]


def test_filter_artefactos_client_solo_publicados():
    out = filter_artefactos_for_role(ARTS, "client_b2b")
    ids = [a["id"] for a in out]
    assert ids == ["a2", "a3", "a4"]
    assert "a1" not in ids  # no publicado


def test_filter_artefactos_admin_ve_todo():
    out = filter_artefactos_for_role(ARTS, "admin")
    assert len(out) == 4


# ─────────────────────────────────────────────────────────────────────── #
# Integración: documento_listar e inventario_artefactos_expediente
# ─────────────────────────────────────────────────────────────────────── #
def test_documento_listar_client_filtra(monkeypatch):
    monkeypatch.setattr(
        server.api, "get",
        lambda path, *a, **k: DOCS if path == "documentos/" else {},
    )
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.documento_listar(oc="oc-1")
    ids = [d["id"] for d in out]
    assert ids == ["d3", "d4", "d5"]


def test_documento_listar_admin_no_filtra(monkeypatch):
    monkeypatch.setattr(
        server.api, "get",
        lambda path, *a, **k: DOCS if path == "documentos/" else {},
    )
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.documento_listar(oc="oc-1")
    assert len(out) == 6


def test_inventario_artefactos_expediente_client_filtra(monkeypatch):
    monkeypatch.setattr(
        server.api, "get",
        lambda path, *a, **k: ARTS if "artifacts" in path else {},
    )
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.inventario_artefactos_expediente("exp-1")
    assert [a["id"] for a in out] == ["a2", "a3", "a4"]


def test_inventario_artefactos_expediente_admin_ve_todo(monkeypatch):
    monkeypatch.setattr(
        server.api, "get",
        lambda path, *a, **k: ARTS if "artifacts" in path else {},
    )
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.inventario_artefactos_expediente("exp-1")
    assert len(out) == 4


# ─────────────────────────────────────────────────────────────────────── #
# Tool unificada: expediente_documentos_completos (documentos + artefactos)
# ─────────────────────────────────────────────────────────────────────── #
def _combined_fake_get(path, *a, **k):
    if path == "documentos/":
        return DOCS
    if "artifacts" in path:
        return ARTS
    return {}


def test_documentos_completos_client_une_ambas_capas(monkeypatch):
    """client_b2b obtiene documentos visibles + artefactos publicados en UNA
    llamada: así encuentra el BL aunque esté en la capa de artefactos."""
    monkeypatch.setattr(server.api, "get", _combined_fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.expediente_documentos_completos("exp-1")
    assert [d["id"] for d in out["documentos"]] == ["d3", "d4", "d5"]
    assert [a["id"] for a in out["artefactos"]] == ["a2", "a3", "a4"]
    assert out["total_documentos"] == 3
    assert out["total_artefactos"] == 3


def test_documentos_completos_admin_ve_todo(monkeypatch):
    monkeypatch.setattr(server.api, "get", _combined_fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_documentos_completos("exp-1")
    assert len(out["documentos"]) == 6
    assert len(out["artefactos"]) == 4


def test_documentos_completos_filtra_q(monkeypatch):
    """q="bl" filtra a la capa que lo contenga (artefactos doc_type=bl o título)."""
    monkeypatch.setattr(server.api, "get", _combined_fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_documentos_completos("exp-1", q="BL")
    assert out["total_artefactos"] >= 1
    assert any("BL" in (a.get("template_title") or "") for a in out["artefactos"])
