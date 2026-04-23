"""
=====================================================================
MWT.ONE · tests/test_clientes.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 8 · Clientes
Endpoint:  /api/clientes/  (ClienteViewSet)

CICLO DE PRUEBAS (5 fases + casos error + integración):
  · LISTAR   — GET /api/clientes/  (incluye filtros ?tipo, ?segmento, ?nodo)
  · DETALLE  — GET /api/clientes/<uuid>/
  · CREAR    — POST con nodo_asignado_id + responsable_id como UUIDs
               cruzados (sin filas correspondientes en nodos / core.users).
  · EDITAR   — PATCH y verificación de updated_at (timestamp avanza).
  · ELIMINAR — DELETE → 204 + is_active=False + 404 en retrieve posterior.
  · ERRORES  — payload sin campos obligatorios → 400.
  · INTEGRACIÓN — credit_history (GET) lista vacía sin snapshots.

REGLA DE ORO MWT
================
nodo_asignado_id, responsable_id, ext.issuing_entity_id son UUIDField
sin FK física. Un cliente NUNCA depende de filas reales en otras
tablas para existir.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.clientes.models import Cliente

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    ClienteModelFactory,
    ClientePayloadFactory,
    fake_nodo_id,
    fake_responsable_id,
)

pytestmark = [pytest.mark.clientes, pytest.mark.crud]


URL_LIST   = "/api/clientes/"
URL_DETAIL = "/api/clientes/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
def test_list_clientes_returns_seeded_rows(authenticated_client):
    """3 clientes precargados deben aparecer y cada id debe ser UUID-string."""
    seeded = [ClienteModelFactory() for _ in range(3)]
    seeded_ids = {str(c.id) for c in seeded}

    response = authenticated_client.get(URL_LIST)
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert seeded_ids.issubset(returned_ids), (
        f"Clientes seedeados no aparecen.\n"
        f"  esperados: {seeded_ids}\n"
        f"  recibidos: {returned_ids}"
    )
    for item in results:
        assert_uuid_string(item["id"], field_name="cliente.id")


def test_list_clientes_filtra_por_segmento(authenticated_client):
    """Filtro ?segmento=A devuelve solo los clientes con segmento=A."""
    a1 = ClienteModelFactory(segmento="A")
    a2 = ClienteModelFactory(segmento="A")
    b1 = ClienteModelFactory(segmento="B")

    response = authenticated_client.get(f"{URL_LIST}?segmento=A")
    assert response.status_code == 200, response.content

    returned_ids = {str(i["id"]) for i in extract_results(response.json())}
    assert str(a1.id) in returned_ids
    assert str(a2.id) in returned_ids
    assert str(b1.id) not in returned_ids, (
        "Filtro ?segmento=A retornó un cliente segmento B"
    )


# ═════════════════════════════════════════════════════════════════════
# 2) DETALLE
# ═════════════════════════════════════════════════════════════════════
def test_retrieve_cliente_returns_full_payload(authenticated_client):
    c = ClienteModelFactory()
    url = URL_DETAIL.format(pk=c.id)

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    assert str(body["id"])     == str(c.id)
    assert body["razon_social"] == c.razon_social
    assert body["tax_id"]       == c.tax_id

    # Campos cruzados — UUID-string sin FK
    assert_uuid_string(body["nodo_asignado_id"], field_name="cliente.nodo_asignado_id")
    assert_uuid_string(body["responsable_id"],   field_name="cliente.responsable_id")

    # Campos calculados por el serializer
    assert "credito_disponible" in body
    assert "tasa_utilizacion"   in body


def test_retrieve_cliente_404_when_not_found(authenticated_client):
    response = authenticated_client.get(URL_DETAIL.format(pk=new_uuid()))
    assert response.status_code == 404, response.content


# ═════════════════════════════════════════════════════════════════════
# 3) CREAR · UUIDs cruzados sin FK física
# ═════════════════════════════════════════════════════════════════════
def test_create_cliente_with_cross_uuids(authenticated_client):
    """
    POST con nodo_asignado_id y responsable_id que NO existen en otras
    tablas. Debe responder 201 (no hay FK física).
    """
    payload = ClientePayloadFactory()

    assert_uuid_string(payload["nodo_asignado_id"], field_name="payload.nodo_asignado_id")
    assert_uuid_string(payload["responsable_id"],   field_name="payload.responsable_id")
    assert "id" not in payload, "El cliente NUNCA manda id — el server lo genera"

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    new_id = body["id"]
    assert_uuid_string(new_id, field_name="cliente.id")
    assert body["razon_social"] == payload["razon_social"]
    assert str(body["nodo_asignado_id"]) == str(payload["nodo_asignado_id"])
    assert str(body["responsable_id"])   == str(payload["responsable_id"])

    # DB-level
    assert Cliente.objects.filter(pk=new_id, is_active=True).exists()


def test_create_cliente_acepta_nodo_id_inexistente(authenticated_client):
    """
    Validación EXPLÍCITA de la REGLA DE ORO:
      nodo_asignado_id puede ser un UUID huérfano (no existe en nodos.nodo).
    """
    payload = ClientePayloadFactory()
    payload["nodo_asignado_id"] = new_uuid()  # UUID huérfano

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, (
        "POST con nodo_asignado_id huérfano falló. ¿Apareció FK física?\n"
        f"  status: {response.status_code}\n"
        f"  body:   {response.content[:500]!r}"
    )


# ═════════════════════════════════════════════════════════════════════
# 3b) ERRORES · payload incompleto → 400
# ═════════════════════════════════════════════════════════════════════
def test_create_cliente_sin_razon_social_devuelve_400(authenticated_client):
    """razon_social es obligatorio (max_length=200, no null) → 400."""
    payload = ClientePayloadFactory()
    payload.pop("razon_social", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, (
        f"Esperado 400 por falta de razon_social, recibido {response.status_code}.\n"
        f"  body: {response.content[:300]!r}"
    )
    body = response.json()
    assert "razon_social" in body, f"El error debe nombrar razon_social. body={body}"


def test_create_cliente_sin_tax_id_devuelve_400(authenticated_client):
    """tax_id es obligatorio → 400."""
    payload = ClientePayloadFactory()
    payload.pop("tax_id", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, (
        f"Esperado 400 por falta de tax_id, recibido {response.status_code}"
    )


# ═════════════════════════════════════════════════════════════════════
# 4) EDITAR · updated_at avanza
# ═════════════════════════════════════════════════════════════════════
def test_update_cliente_changes_updated_at(authenticated_client):
    c = ClienteModelFactory(razon_social="Razon original SA")
    original_updated_at = c.updated_at

    time.sleep(0.05)

    url = URL_DETAIL.format(pk=c.id)
    new_razon = f"Editada por QA · {new_uuid()[:8]}"
    response = authenticated_client.patch(url, {"razon_social": new_razon})
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["razon_social"] == new_razon

    c.refresh_from_db()
    assert c.razon_social == new_razon
    assert c.updated_at > original_updated_at, (
        f"updated_at no avanzó.\n"
        f"  original: {original_updated_at!r}\n"
        f"  actual:   {c.updated_at!r}"
    )


def test_update_cliente_partial_no_pisa_otros_campos(authenticated_client):
    """PATCH parcial cambiando solo `dias_credito` no toca razon_social ni tax_id."""
    c = ClienteModelFactory(
        razon_social="Cliente Inmutable SRL",
        tax_id="20-99999999-1",
        dias_credito=30,
    )
    original_razon  = c.razon_social
    original_tax_id = c.tax_id

    url = URL_DETAIL.format(pk=c.id)
    response = authenticated_client.patch(url, {"dias_credito": 60})
    assert response.status_code == 200, response.content

    c.refresh_from_db()
    assert c.dias_credito  == 60
    assert c.razon_social  == original_razon,  "PATCH parcial pisó razon_social"
    assert c.tax_id        == original_tax_id, "PATCH parcial pisó tax_id"


# ═════════════════════════════════════════════════════════════════════
# 5) ELIMINAR · soft delete (204 + is_active=False)
# ═════════════════════════════════════════════════════════════════════
def test_soft_delete_cliente_returns_204_and_inactive(authenticated_client):
    c = ClienteModelFactory()
    url = URL_DETAIL.format(pk=c.id)

    response = authenticated_client.delete(url)
    assert response.status_code == 204, response.content
    assert not response.content, (
        f"DELETE devolvió body inesperado: {response.content!r}"
    )

    # La fila persiste — es soft delete, no hard delete
    assert Cliente.objects.filter(pk=c.id).exists(), (
        "Cliente HARD-DELETED — debería ser soft delete (is_active=False)"
    )

    c.refresh_from_db()
    assert c.is_active is False, (
        f"Soft delete no cambió is_active a False (actual: {c.is_active})"
    )

    # Y ya no aparece en retrieve (filtra is_active=True)
    followup = authenticated_client.get(url)
    assert followup.status_code == 404


def test_soft_deleted_cliente_no_aparece_en_listado(authenticated_client):
    c = ClienteModelFactory()
    target_id = str(c.id)

    del_resp = authenticated_client.delete(URL_DETAIL.format(pk=target_id))
    assert del_resp.status_code == 204

    list_resp = authenticated_client.get(URL_LIST)
    assert list_resp.status_code == 200
    returned_ids = {str(i["id"]) for i in extract_results(list_resp.json())}
    assert target_id not in returned_ids, (
        f"Cliente {target_id} sigue apareciendo en listado tras soft delete"
    )


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · credit_history endpoint
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
def test_credit_history_sin_snapshots_devuelve_lista_vacia(authenticated_client):
    """
    GET /api/clientes/<id>/credit_history/ sobre cliente recién creado
    sin snapshots → lista vacía (no debería romper).
    """
    c = ClienteModelFactory()
    url = f"/api/clientes/{c.id}/credit_history/"

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    # Acepta lista cruda o paginado vacío
    if isinstance(body, dict):
        assert body.get("results", []) == []
    else:
        assert body == []
