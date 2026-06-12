"""
=====================================================================
MWT.ONE · tests/test_marcas.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 9 · Marcas
Endpoint base:  /api/marcas/  (MarcaViewSet)

CICLO DE PRUEBAS (5 fases + Pricing/Discount):
  · LISTAR   — GET /api/marcas/  (filtros ?estado, ?categoria, ?tipo)
  · DETALLE  — GET /api/marcas/<uuid>/
  · CREAR    — POST con responsable_id + issuing_entity_id como
               UUIDs cruzados (sin filas en core.users / legal_entities).
  · EDITAR   — PATCH y verificación de updated_at.
  · ELIMINAR — DELETE → 204 + is_active=False.
  · ERRORES  — payload sin nombre/slug/categoria → 400.

PRICING ENGINE (sub-recurso anidado a la marca)
================================================
La consola comercial de la marca incluye códigos de descuento — los
tests cubren:
  · GET    /api/marcas/<id>/discount_codes/                → listar
  · POST   /api/marcas/<id>/discount_codes/                → crear
  · PATCH  /api/marcas/<id>/discount_codes/<code_id>/      → editar
  · DELETE /api/marcas/<id>/discount_codes/<code_id>/      → soft delete
  · upload_productos_preview (smoke) — valida required fields del Excel.

REGLA DE ORO MWT
================
responsable_id, issuing_entity_id son UUIDField sin FK física.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.brands.models import BrandDiscountCode, Marca

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    BrandDiscountCodePayloadFactory,
    MarcaModelFactory,
    MarcaPayloadFactory,
    fake_legal_entity_id,
    fake_responsable_id,
)

pytestmark = [pytest.mark.marcas, pytest.mark.crud]


URL_LIST   = "/api/marcas/"
URL_DETAIL = "/api/marcas/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
def test_list_marcas_returns_seeded_rows(authenticated_client):
    seeded = [MarcaModelFactory() for _ in range(3)]
    seeded_ids = {str(m.id) for m in seeded}

    response = authenticated_client.get(URL_LIST)
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert seeded_ids.issubset(returned_ids), (
        f"Marcas seedeadas no aparecen.\n"
        f"  esperadas: {seeded_ids}\n"
        f"  recibidas: {returned_ids}"
    )
    for item in results:
        assert_uuid_string(item["id"], field_name="marca.id")


def test_list_marcas_filtra_por_tipo(authenticated_client):
    """Filtro ?tipo=PROPIA aísla solo marcas propias."""
    propia    = MarcaModelFactory(tipo="PROPIA")
    exclusiva = MarcaModelFactory(tipo="EXCLUSIVA")

    response = authenticated_client.get(f"{URL_LIST}?tipo=PROPIA")
    assert response.status_code == 200, response.content

    returned_ids = {str(i["id"]) for i in extract_results(response.json())}
    assert str(propia.id)    in returned_ids
    assert str(exclusiva.id) not in returned_ids


# ═════════════════════════════════════════════════════════════════════
# 2) DETALLE
# ═════════════════════════════════════════════════════════════════════
def test_retrieve_marca_returns_full_payload(authenticated_client):
    m = MarcaModelFactory()
    url = URL_DETAIL.format(pk=m.id)

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    assert str(body["id"]) == str(m.id)
    assert body["nombre"] == m.nombre
    assert body["slug"]   == m.slug

    # Cross-UUID — sin FK física
    assert_uuid_string(body["responsable_id"], field_name="marca.responsable_id")


def test_retrieve_marca_404_when_not_found(authenticated_client):
    response = authenticated_client.get(URL_DETAIL.format(pk=new_uuid()))
    assert response.status_code == 404, response.content


# ═════════════════════════════════════════════════════════════════════
# 3) CREAR · UUIDs cruzados sin FK
# ═════════════════════════════════════════════════════════════════════
def test_create_marca_with_cross_uuids(authenticated_client):
    payload = MarcaPayloadFactory()

    assert_uuid_string(payload["responsable_id"],    field_name="payload.responsable_id")
    assert_uuid_string(payload["issuing_entity_id"], field_name="payload.issuing_entity_id")
    assert "id" not in payload

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    new_id = body["id"]
    assert_uuid_string(new_id, field_name="marca.id")
    assert body["nombre"] == payload["nombre"]
    assert body["slug"]   == payload["slug"]
    assert str(body["responsable_id"])    == str(payload["responsable_id"])
    assert str(body["issuing_entity_id"]) == str(payload["issuing_entity_id"])

    assert Marca.objects.filter(pk=new_id, is_active=True).exists()


def test_create_marca_acepta_issuing_entity_id_inexistente(authenticated_client):
    """REGLA DE ORO: issuing_entity_id huérfano → 201 (no hay FK)."""
    payload = MarcaPayloadFactory()
    payload["issuing_entity_id"] = new_uuid()

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, (
        "POST con issuing_entity_id huérfano falló. ¿Apareció FK física?"
    )


# ═════════════════════════════════════════════════════════════════════
# 3b) ERRORES · payload incompleto → 400
# ═════════════════════════════════════════════════════════════════════
def test_create_marca_sin_nombre_devuelve_400(authenticated_client):
    payload = MarcaPayloadFactory()
    payload.pop("nombre", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, response.content
    assert "nombre" in response.json()


def test_create_marca_sin_slug_devuelve_400(authenticated_client):
    payload = MarcaPayloadFactory()
    payload.pop("slug", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 400, response.content
    assert "slug" in response.json()


def test_create_marca_slug_duplicado_devuelve_400(authenticated_client):
    """slug es UNIQUE — segundo POST con mismo slug debe rechazarse."""
    p1 = MarcaPayloadFactory()
    r1 = authenticated_client.post(URL_LIST, p1)
    assert r1.status_code == 201, r1.content

    # Segundo POST con MISMO slug
    p2 = MarcaPayloadFactory()
    p2["slug"] = p1["slug"]

    r2 = authenticated_client.post(URL_LIST, p2)
    assert r2.status_code == 400, (
        f"Esperado 400 por slug duplicado, recibido {r2.status_code}.\n"
        f"  body: {r2.content[:300]!r}"
    )


# ═════════════════════════════════════════════════════════════════════
# 4) EDITAR · updated_at avanza
# ═════════════════════════════════════════════════════════════════════
def test_update_marca_changes_updated_at(authenticated_client):
    m = MarcaModelFactory(estado_comercial="PROSPECTO")
    original_updated_at = m.updated_at

    time.sleep(0.05)

    url = URL_DETAIL.format(pk=m.id)
    response = authenticated_client.patch(url, {"estado_comercial": "ACTIVA"})
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["estado_comercial"] == "ACTIVA"

    m.refresh_from_db()
    assert m.estado_comercial == "ACTIVA"
    assert m.updated_at > original_updated_at, (
        f"updated_at no avanzó.\n  original: {original_updated_at!r}\n"
        f"  actual:   {m.updated_at!r}"
    )


# ═════════════════════════════════════════════════════════════════════
# 5) ELIMINAR · soft delete
# ═════════════════════════════════════════════════════════════════════
def test_soft_delete_marca_returns_204_and_inactive(authenticated_client):
    m = MarcaModelFactory()
    url = URL_DETAIL.format(pk=m.id)

    response = authenticated_client.delete(url)
    assert response.status_code == 204, response.content
    assert not response.content

    assert Marca.objects.filter(pk=m.id).exists(), (
        "Marca HARD-DELETED — debería ser soft delete"
    )
    m.refresh_from_db()
    assert m.is_active is False

    followup = authenticated_client.get(url)
    assert followup.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# PRICING ENGINE · Discount codes (CRUD anidado a la marca)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestMarcaPricingEngine:
    """
    El Pricing Engine es parte del dominio Marcas: cada marca tiene su
    propio set de códigos de descuento. Los endpoints anidados son:
      · GET    /api/marcas/<id>/discount_codes/
      · POST   /api/marcas/<id>/discount_codes/
      · PATCH  /api/marcas/<id>/discount_codes/<code_id>/
      · DELETE /api/marcas/<id>/discount_codes/<code_id>/  → soft
    """

    def _url_codes(self, marca_id):
        return f"/api/marcas/{marca_id}/discount_codes/"

    def _url_code_detail(self, marca_id, code_id):
        return f"/api/marcas/{marca_id}/discount_codes/{code_id}/"
    def test_list_discount_codes_vacio_para_marca_nueva(self, authenticated_client):
        m = MarcaModelFactory()
        response = authenticated_client.get(self._url_codes(m.id))
        assert response.status_code == 200, response.content
        body = response.json()
        if isinstance(body, dict):
            assert body.get("results", []) == []
        else:
            assert body == []
    def test_create_discount_code_marca_devuelve_201(self, authenticated_client):
        m = MarcaModelFactory()
        payload = BrandDiscountCodePayloadFactory()

        response = authenticated_client.post(self._url_codes(m.id), payload)
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"],       field_name="discount.id")
        assert_uuid_string(body["marca_id"], field_name="discount.marca_id")
        assert str(body["marca_id"]) == str(m.id), (
            "El viewset DEBE inyectar marca_id desde la URL, no aceptar el del body"
        )
        assert body["codigo"] == payload["codigo"]

        # DB-level
        assert BrandDiscountCode.objects.filter(
            pk=body["id"], marca_id=m.id, is_active=True
        ).exists()
    def test_update_discount_code_marca_actualiza_valor(self, authenticated_client):
        m = MarcaModelFactory()
        # Crear via API para obtener id devuelto
        create_resp = authenticated_client.post(
            self._url_codes(m.id), BrandDiscountCodePayloadFactory()
        )
        assert create_resp.status_code == 201, create_resp.content
        code_id = create_resp.json()["id"]

        # PATCH cambiando descuento_pct
        url = self._url_code_detail(m.id, code_id)
        patch_resp = authenticated_client.patch(url, {"descuento_pct": "25.50"})
        assert patch_resp.status_code == 200, patch_resp.content
        assert str(patch_resp.json()["descuento_pct"]) == "25.50"
    def test_soft_delete_discount_code_marca(self, authenticated_client):
        m = MarcaModelFactory()
        create_resp = authenticated_client.post(
            self._url_codes(m.id), BrandDiscountCodePayloadFactory()
        )
        assert create_resp.status_code == 201
        code_id = create_resp.json()["id"]

        url = self._url_code_detail(m.id, code_id)
        del_resp = authenticated_client.delete(url)
        assert del_resp.status_code == 204, del_resp.content

        # is_active = False (soft)
        dc = BrandDiscountCode.objects.get(pk=code_id)
        assert dc.is_active is False, (
            "DELETE en discount_code no es soft — perdimos auditoría"
        )

        # Ya no aparece en listado
        list_resp = authenticated_client.get(self._url_codes(m.id))
        list_ids = {str(i["id"]) for i in extract_results(list_resp.json())}
        assert code_id not in list_ids


# ═════════════════════════════════════════════════════════════════════
# UPLOAD MASIVO · preview de productos (smoke)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
def test_upload_productos_preview_marca_clasifica_filas(authenticated_client):
    """
    POST /api/marcas/<id>/upload_productos_preview/ con 3 filas:
      · 2 válidas (sku + nombre + precio_usd presentes)
      · 1 inválida (sin precio_usd)
    Espera: VALID_ROWS=2, INVALID_ROWS=1, status='PARTIAL'.
    """
    m = MarcaModelFactory()
    url = f"/api/marcas/{m.id}/upload_productos_preview/"
    body = {
        "filename": "test-catalogo.xlsx",
        "mapping":  {"sku": "SKU", "nombre": "Nombre", "precio_usd": "Precio"},
        "rows": [
            {"sku": "ABC-001", "nombre": "Producto OK 1", "precio_usd": "29.90"},
            {"sku": "ABC-002", "nombre": "Producto OK 2", "precio_usd": "45.00"},
            {"sku": "ABC-003", "nombre": "Producto sin precio"},  # falta precio_usd
        ],
    }

    response = authenticated_client.post(url, body)
    assert response.status_code == 200, response.content

    rj = response.json()
    assert rj["total"]   == 3
    assert rj["valid"]   == 2
    assert rj["invalid"] == 1
    assert rj["status"]  == "PARTIAL"
    assert_uuid_string(rj["import_id"], field_name="import_id")

    # Errores deben mencionar el field faltante
    assert any("precio_usd" in e["missing"] for e in rj["errors"]), (
        f"El reporte de errores no menciona precio_usd faltante: {rj['errors']}"
    )
