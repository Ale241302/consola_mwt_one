"""
=====================================================================
MWT.ONE · tests/test_fusion.py
Agente responsable: [AG-QA-BACKEND-2]

Módulo 19 — Fusión visual de expedientes (Sprint 2026-06-11 · E3).

Endpoints (apps/expedientes/views.py · ExpedienteViewSet actions):
  · POST /api/expedientes/fusionar/     {"expediente_ids": [...], "label"?}
  · POST /api/expedientes/fusion-label/ {"fusion_id", "label"}
  · POST /api/expedientes/desfusionar/  {"fusion_id"} | {"expediente_ids"}

Reglas del contrato:
  · ≥ 2 expediente_ids para fusionar; el server genera fusion_id nuevo.
  · Re-fusionar una selección sobrescribe la fusión anterior del miembro.
  · fusion-label renombra TODO el grupo (404 si no existe).
  · desfusionar limpia fusion_id + fusion_label.
  · Mutaciones denegadas a roles CLIENT_* (403, _deny_client_mutation).
  · fusion_id / fusion_label viajan en el listado (no son dato sensible).
=====================================================================
"""
from __future__ import annotations

import pytest

from apps.expedientes.models import Expediente
from tests._common import extract_results, find_by_id, new_uuid
from tests.factories import ExpedientePayloadFactory

pytestmark = [pytest.mark.fusion, pytest.mark.expedientes]

URL_FUSIONAR    = "/api/expedientes/fusionar/"
URL_LABEL       = "/api/expedientes/fusion-label/"
URL_DESFUSIONAR = "/api/expedientes/desfusionar/"


def _crear_expediente(client, **extra):
    payload = ExpedientePayloadFactory(**extra)
    r = client.post("/api/expedientes/", payload, format="json")
    assert r.status_code == 201, r.content
    return r.json()["id"]


class TestFusionar:
    def test_fusionar_dos_expedientes_comparte_fusion_id(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        r = authenticated_client.post(URL_FUSIONAR, {
            "expediente_ids": [e1, e2],
            "label": "PO-CLIENTE-110022",
        }, format="json")
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["members"] == 2
        assert body["fusion_label"] == "PO-CLIENTE-110022"
        fid = body["fusion_id"]
        # Ambos miembros comparten el fusion_id en DB
        a, b = Expediente.objects.get(pk=e1), Expediente.objects.get(pk=e2)
        assert str(a.fusion_id) == fid and str(b.fusion_id) == fid
        assert a.fusion_label == "PO-CLIENTE-110022"

    def test_fusion_id_viaja_en_el_listado(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        fid = authenticated_client.post(
            URL_FUSIONAR, {"expediente_ids": [e1, e2]}, format="json"
        ).json()["fusion_id"]
        r = authenticated_client.get("/api/expedientes/")
        assert r.status_code == 200
        items = extract_results(r.json())
        for eid in (e1, e2):
            row = find_by_id(items, eid)
            assert row is not None
            assert str(row["fusion_id"]) == fid

    def test_menos_de_dos_ids_400(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        r = authenticated_client.post(URL_FUSIONAR,
                                      {"expediente_ids": [e1]}, format="json")
        assert r.status_code == 400

    def test_ids_invalidos_400(self, authenticated_client):
        r = authenticated_client.post(URL_FUSIONAR,
                                      {"expediente_ids": ["no-uuid", "x"]},
                                      format="json")
        assert r.status_code == 400

    def test_expedientes_inexistentes_404(self, authenticated_client):
        r = authenticated_client.post(URL_FUSIONAR,
                                      {"expediente_ids": [new_uuid(), new_uuid()]},
                                      format="json")
        assert r.status_code == 404

    def test_refusionar_migra_a_la_nueva_fusion(self, authenticated_client):
        """Re-fusionar selección = sobrescribir la fusión anterior."""
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        e3 = _crear_expediente(authenticated_client)
        fid1 = authenticated_client.post(
            URL_FUSIONAR, {"expediente_ids": [e1, e2]}, format="json"
        ).json()["fusion_id"]
        fid2 = authenticated_client.post(
            URL_FUSIONAR, {"expediente_ids": [e2, e3]}, format="json"
        ).json()["fusion_id"]
        assert fid1 != fid2
        assert str(Expediente.objects.get(pk=e2).fusion_id) == fid2, "e2 migró"
        assert str(Expediente.objects.get(pk=e1).fusion_id) == fid1, "e1 conserva"


class TestFusionLabel:
    def test_renombra_todo_el_grupo(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        fid = authenticated_client.post(
            URL_FUSIONAR,
            {"expediente_ids": [e1, e2], "label": "Original"}, format="json",
        ).json()["fusion_id"]
        r = authenticated_client.post(URL_LABEL,
                                      {"fusion_id": fid, "label": "Renombrada QA"},
                                      format="json")
        assert r.status_code == 200, r.content
        assert r.json() == {"fusion_id": fid, "fusion_label": "Renombrada QA",
                            "members": 2}
        for eid in (e1, e2):
            assert Expediente.objects.get(pk=eid).fusion_label == "Renombrada QA"

    def test_fusion_id_invalido_400(self, authenticated_client):
        r = authenticated_client.post(URL_LABEL,
                                      {"fusion_id": "nope", "label": "X"},
                                      format="json")
        assert r.status_code == 400

    def test_fusion_inexistente_404(self, authenticated_client):
        r = authenticated_client.post(URL_LABEL,
                                      {"fusion_id": new_uuid(), "label": "X"},
                                      format="json")
        assert r.status_code == 404


class TestDesfusionar:
    def test_desfusionar_por_fusion_id(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        fid = authenticated_client.post(
            URL_FUSIONAR, {"expediente_ids": [e1, e2], "label": "L"},
            format="json",
        ).json()["fusion_id"]
        r = authenticated_client.post(URL_DESFUSIONAR, {"fusion_id": fid},
                                      format="json")
        assert r.status_code == 200, r.content
        assert r.json() == {"unfused": 2}
        for eid in (e1, e2):
            e = Expediente.objects.get(pk=eid)
            assert e.fusion_id is None
            assert e.fusion_label is None

    def test_desfusionar_por_expediente_ids_parcial(self, authenticated_client):
        e1 = _crear_expediente(authenticated_client)
        e2 = _crear_expediente(authenticated_client)
        fid = authenticated_client.post(
            URL_FUSIONAR, {"expediente_ids": [e1, e2]}, format="json",
        ).json()["fusion_id"]
        # Solo e1 sale del grupo
        r = authenticated_client.post(URL_DESFUSIONAR,
                                      {"expediente_ids": [e1]}, format="json")
        assert r.status_code == 200
        assert r.json() == {"unfused": 1}
        assert Expediente.objects.get(pk=e1).fusion_id is None
        assert str(Expediente.objects.get(pk=e2).fusion_id) == fid

    def test_sin_parametros_400(self, authenticated_client):
        r = authenticated_client.post(URL_DESFUSIONAR, {}, format="json")
        assert r.status_code == 400


class TestFusionVisibilidadCliente:
    """R3-adjacente: las mutaciones de fusión están vetadas a CLIENT_*."""

    @pytest.mark.r3
    @pytest.mark.parametrize("url,payload", [
        (URL_FUSIONAR,    {"expediente_ids": [new_uuid(), new_uuid()]}),
        (URL_LABEL,       {"fusion_id": new_uuid(), "label": "X"}),
        (URL_DESFUSIONAR, {"fusion_id": new_uuid()}),
    ])
    def test_rol_cliente_403(self, client_authenticated, url, payload):
        r = client_authenticated.post(url, payload, format="json")
        assert r.status_code == 403, (
            f"{url} debe denegar mutación a rol cliente, recibido {r.status_code}"
        )
