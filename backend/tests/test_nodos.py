"""
=====================================================================
MWT.ONE · tests/test_nodos.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 7 · Nodos
Endpoint base:  /api/nodos/  (NodoViewSet)

CICLO DE PRUEBAS (5 fases + capabilities + jerarquía):
  · LISTAR   — GET /api/nodos/ (filtros ?tipo, ?pais, ?status)
  · DETALLE  — GET /api/nodos/<uuid>/
  · CREAR    — POST con responsable_id + legal_entity_owner_id +
               operator_id como UUIDs cruzados, capabilities[], zona_horaria.
  · EDITAR   — PATCH cambiando status + capabilities (verificar updated_at).
  · ELIMINAR — DELETE → 204 + is_active=False.
  · ERRORES  — payload sin codigo / nombre → 400.
               codigo duplicado (UNIQUE) → 400.
  · INTEGRACIÓN:
       · /select_capabilities/  → fuente única de capacidades canónicas.
       · /jerarquia/            → árbol vacío sobre DB limpia.
       · /<id>/descendientes/   → vacío sin relaciones.

REGLA DE ORO MWT
================
responsable_id, legal_entity_owner_id, operator_id son UUIDField sin FK.
Un nodo NO requiere que existan filas en core.users / legal_entities /
operadores para crearse.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.nodos.models import Nodo

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    NodoModelFactory,
    NodoPayloadFactory,
    fake_legal_entity_id,
    fake_operator_id,
    fake_responsable_id,
)

pytestmark = [pytest.mark.nodos, pytest.mark.crud]


URL_LIST   = "/api/nodos/"
URL_DETAIL = "/api/nodos/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
def test_list_nodos_returns_seeded_rows(authenticated_client):
    seeded = [NodoModelFactory() for _ in range(3)]
    seeded_ids = {str(n.id) for n in seeded}

    response = authenticated_client.get(URL_LIST)
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert seeded_ids.issubset(returned_ids), (
        f"Nodos seedeados no aparecen.\n"
        f"  esperados: {seeded_ids}\n"
        f"  recibidos: {returned_ids}"
    )
    for item in results:
        assert_uuid_string(item["id"], field_name="nodo.id")


def test_list_nodos_filtra_por_status(authenticated_client):
    """?status=ACTIVE devuelve solo nodos activos (no SETUP, no RETIRED)."""
    activo  = NodoModelFactory(status="ACTIVE")
    setup   = NodoModelFactory(status="SETUP")
    retired = NodoModelFactory(status="RETIRED")

    response = authenticated_client.get(f"{URL_LIST}?status=ACTIVE")
    assert response.status_code == 200, response.content

    returned_ids = {str(i["id"]) for i in extract_results(response.json())}
    assert str(activo.id)  in returned_ids
    assert str(setup.id)   not in returned_ids
    assert str(retired.id) not in returned_ids


def test_list_nodos_filtra_por_pais(authenticated_client):
    """?pais=BR (case-insensitive en el viewset → .upper())."""
    arg = NodoModelFactory(pais_iso2="AR")
    bra = NodoModelFactory(pais_iso2="BR")

    response = authenticated_client.get(f"{URL_LIST}?pais=br")
    assert response.status_code == 200, response.content

    returned_ids = {str(i["id"]) for i in extract_results(response.json())}
    assert str(bra.id) in returned_ids
    assert str(arg.id) not in returned_ids


# ═════════════════════════════════════════════════════════════════════
# 2) DETALLE
# ═════════════════════════════════════════════════════════════════════
def test_retrieve_nodo_returns_full_payload(authenticated_client):
    n = NodoModelFactory()
    url = URL_DETAIL.format(pk=n.id)

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    assert str(body["id"]) == str(n.id)
    assert body["codigo"]   == n.codigo
    assert body["nombre"]   == n.nombre

    # Cross-UUIDs
    assert_uuid_string(body["responsable_id"],       field_name="nodo.responsable_id")
    assert_uuid_string(body["legal_entity_owner_id"], field_name="nodo.legal_entity_owner_id")
    assert_uuid_string(body["operator_id"],          field_name="nodo.operator_id")

    # Capabilities + zona horaria + status (extensiones)
    assert isinstance(body["capabilities"], list)
    assert body["zona_horaria"] is not None
    assert body["status"] in ("ACTIVE", "INACTIVE", "SETUP", "RETIRED")


def test_retrieve_nodo_404_when_not_found(authenticated_client):
    response = authenticated_client.get(URL_DETAIL.format(pk=new_uuid()))
    assert response.status_code == 404, response.content


# ═════════════════════════════════════════════════════════════════════
# 3) CREAR · UUIDs cruzados + capabilities + zona_horaria
# ═════════════════════════════════════════════════════════════════════
def test_create_nodo_with_capabilities_y_zona_horaria(authenticated_client):
    """
    POST /api/nodos/ con:
      · responsable_id, legal_entity_owner_id, operator_id como UUIDs cruzados
      · capabilities=[receive, store, dispatch]
      · zona_horaria='America/Argentina/Buenos_Aires'
    """
    payload = NodoPayloadFactory()

    for fld in ("responsable_id", "legal_entity_owner_id", "operator_id"):
        assert_uuid_string(payload[fld], field_name=f"payload.{fld}")
    assert "id" not in payload

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    new_id = body["id"]
    assert_uuid_string(new_id, field_name="nodo.id")
    assert body["codigo"]       == payload["codigo"]
    assert body["nombre"]       == payload["nombre"]
    assert body["zona_horaria"] == payload["zona_horaria"]
    assert body["capabilities"] == payload["capabilities"]
    assert body["status"]       == payload["status"]

    # Cross-UUIDs preservados
    assert str(body["responsable_id"])        == str(payload["responsable_id"])
    assert str(body["legal_entity_owner_id"]) == str(payload["legal_entity_owner_id"])
    assert str(body["operator_id"])           == str(payload["operator_id"])

    # DB-level
    assert Nodo.objects.filter(pk=new_id, is_active=True).exists()


def test_create_nodo_aplica_defaults_para_capabilities_y_status(authenticated_client):
    """
    Si el cliente NO manda capabilities ni status, la view aplica defaults:
      · capabilities = []
      · status       = "ACTIVE"
    (ver NodoViewSet.create — setdefault).
    """
    payload = NodoPayloadFactory()
    payload.pop("capabilities", None)
    payload.pop("status", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    assert body["capabilities"] == [], (
        f"Default de capabilities debe ser []. Recibido: {body['capabilities']!r}"
    )
    assert body["status"] == "ACTIVE", (
        f"Default de status debe ser ACTIVE. Recibido: {body['status']!r}"
    )


def test_create_nodo_acepta_legal_entity_id_inexistente(authenticated_client):
    """REGLA DE ORO: legal_entity_owner_id huérfano → 201."""
    payload = NodoPayloadFactory()
    payload["legal_entity_owner_id"] = new_uuid()

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, (
        "POST con legal_entity_owner_id huérfano falló. ¿Apareció FK física?"
    )


# ═════════════════════════════════════════════════════════════════════
# 3b) ERRORES · payload incompleto → 400
# ═════════════════════════════════════════════════════════════════════
def test_create_nodo_sin_codigo_devuelve_400(authenticated_client):
    payload = NodoPayloadFactory()
    payload.pop("codigo", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, response.content
    assert "codigo" in response.json()


def test_create_nodo_sin_nombre_devuelve_400(authenticated_client):
    payload = NodoPayloadFactory()
    payload.pop("nombre", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, response.content
    assert "nombre" in response.json()


def test_create_nodo_codigo_duplicado_devuelve_400(authenticated_client):
    """codigo es UNIQUE (max_length=16). Duplicado → 400."""
    p1 = NodoPayloadFactory()
    r1 = authenticated_client.post(URL_LIST, p1)
    assert r1.status_code == 201, r1.content

    p2 = NodoPayloadFactory()
    p2["codigo"] = p1["codigo"]  # colisión

    r2 = authenticated_client.post(URL_LIST, p2)
    assert r2.status_code == 400, (
        f"Esperado 400 por codigo duplicado, recibido {r2.status_code}"
    )


# ═════════════════════════════════════════════════════════════════════
# 4) EDITAR · updated_at + capabilities + status
# ═════════════════════════════════════════════════════════════════════
def test_update_nodo_changes_updated_at(authenticated_client):
    n = NodoModelFactory(status="SETUP", capabilities=["receive"])
    original_updated_at = n.updated_at

    time.sleep(0.05)

    url = URL_DETAIL.format(pk=n.id)
    response = authenticated_client.patch(url, {
        "status":       "ACTIVE",
        "capabilities": ["receive", "store", "dispatch", "report_inventory"],
    })
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["status"]       == "ACTIVE"
    assert body["capabilities"] == ["receive", "store", "dispatch", "report_inventory"]

    n.refresh_from_db()
    assert n.status == "ACTIVE"
    assert n.updated_at > original_updated_at


def test_update_nodo_partial_no_pisa_zona_horaria(authenticated_client):
    """PATCH sobre `nombre` no debe pisar zona_horaria, capabilities, ni codigo."""
    n = NodoModelFactory(
        zona_horaria="America/Lima",
        capabilities=["receive", "store"],
        codigo="NODO-INTACTO",
    )
    original_zona  = n.zona_horaria
    original_caps  = list(n.capabilities)
    original_code  = n.codigo

    url = URL_DETAIL.format(pk=n.id)
    response = authenticated_client.patch(url, {"nombre": "Renombrado por QA"})
    assert response.status_code == 200, response.content

    n.refresh_from_db()
    assert n.nombre        == "Renombrado por QA"
    assert n.zona_horaria  == original_zona, "PATCH parcial pisó zona_horaria"
    assert n.capabilities  == original_caps, "PATCH parcial pisó capabilities"
    assert n.codigo        == original_code, "PATCH parcial pisó codigo"


# ═════════════════════════════════════════════════════════════════════
# 5) ELIMINAR · soft delete
# ═════════════════════════════════════════════════════════════════════
def test_soft_delete_nodo_returns_204_and_inactive(authenticated_client):
    n = NodoModelFactory()
    url = URL_DETAIL.format(pk=n.id)

    response = authenticated_client.delete(url)
    assert response.status_code == 204, response.content
    assert not response.content

    assert Nodo.objects.filter(pk=n.id).exists(), (
        "Nodo HARD-DELETED — debería ser soft delete"
    )
    n.refresh_from_db()
    assert n.is_active is False

    followup = authenticated_client.get(url)
    assert followup.status_code == 404


def test_soft_deleted_nodo_no_aparece_en_listado(authenticated_client):
    n = NodoModelFactory()
    target_id = str(n.id)

    del_resp = authenticated_client.delete(URL_DETAIL.format(pk=target_id))
    assert del_resp.status_code == 204

    list_resp = authenticated_client.get(URL_LIST)
    returned_ids = {str(i["id"]) for i in extract_results(list_resp.json())}
    assert target_id not in returned_ids, (
        f"Nodo {target_id} sigue apareciendo en listado tras soft delete"
    )


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · selects + jerarquía
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
def test_select_capabilities_devuelve_canon(authenticated_client):
    """
    GET /api/nodos/select_capabilities/  → fuente única de capacidades.
    Debe contener al menos receive/store/dispatch (CAPABILITIES_CANON).
    """
    response = authenticated_client.get("/api/nodos/select_capabilities/")
    assert response.status_code == 200, response.content

    body = response.json()
    assert isinstance(body, list)
    codigos = {item["codigo"] for item in body}
    for esperado in ("receive", "store", "dispatch"):
        assert esperado in codigos, (
            f"capability '{esperado}' falta en CAPABILITIES_CANON. "
            f"Recibidos: {sorted(codigos)}"
        )


@pytest.mark.integration
def test_jerarquia_endpoint_devuelve_lista(authenticated_client):
    """
    GET /api/nodos/jerarquia/ devuelve la lista de aristas activas.
    Sobre DB limpia (sin relaciones), la lista es vacía pero el endpoint
    no debe romper.
    """
    response = authenticated_client.get("/api/nodos/jerarquia/")
    assert response.status_code == 200, response.content

    body = response.json()
    if isinstance(body, dict):
        assert "results" in body or "data" in body or body == {}
    else:
        assert isinstance(body, list)


@pytest.mark.integration
def test_descendientes_de_nodo_huerfano_devuelve_vacio(authenticated_client):
    """
    GET /api/nodos/<id>/descendientes/ sobre nodo recién creado sin
    relaciones jerárquicas debe devolver lista vacía (no 404).
    """
    n = NodoModelFactory()
    url = f"/api/nodos/{n.id}/descendientes/"

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    if isinstance(body, dict):
        assert body.get("results", []) == [] or body == {}
    else:
        assert body == []
