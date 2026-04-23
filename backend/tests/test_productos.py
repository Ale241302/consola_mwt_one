"""
=====================================================================
MWT.ONE · tests/test_productos.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 10 · Productos
Endpoint:  /api/productos/  (ProductoViewSet)

CICLO DE PRUEBAS (5 fases):
  · LISTAR   — GET /api/productos/
  · DETALLE  — GET /api/productos/<uuid>/
  · CREAR    — POST con marca_id + proveedor_principal_id como UUIDs
               cruzados (sin filas correspondientes en brands /
               proveedores).
  · EDITAR   — PATCH y verificación de updated_at.
  · ELIMINAR — DELETE → 204 + is_active=False.

REGLA DE ORO MWT
================
Producto.marca_id y Producto.proveedor_principal_id son `UUIDField`
sin FK física. Los tests generan UUIDs al vuelo y los mandan al POST.
Si esto rompe, alguien agregó un FK físico — revisar el SQL del módulo.

NOTAS DE FORMATO
================
ProductoSerializer recibe los campos numéricos como Decimal o str
(DRF acepta ambos). Las factories los emiten como str para que el
JSON viaje sin sorpresas de serialización.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.productos.models import Producto

from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    ProductoModelFactory,
    ProductoPayloadFactory,
    fake_marca_id,
    fake_proveedor_id,
)

pytestmark = [pytest.mark.productos, pytest.mark.crud]


URL_LIST   = "/api/productos/"
URL_DETAIL = "/api/productos/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
def test_list_productos_returns_seeded_rows(authenticated_client):
    """
    GIVEN: 3 productos precargados vía ORM.
    WHEN:  GET /api/productos/
    THEN:  HTTP 200 + los 3 productos aparecen + cada id es UUID-string.
    """
    seeded = [ProductoModelFactory() for _ in range(3)]
    seeded_ids = {str(p.id) for p in seeded}

    response = authenticated_client.get(URL_LIST)
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert seeded_ids.issubset(returned_ids), (
        f"Productos seedeados no aparecen.\n"
        f"  esperados: {seeded_ids}\n"
        f"  recibidos: {returned_ids}"
    )

    for item in results:
        assert_uuid_string(item["id"], field_name="producto.id")


def test_list_productos_filtra_por_marca(authenticated_client):
    """
    GIVEN: 2 productos con marca A y 1 con marca B.
    WHEN:  GET /api/productos/?marca=<marca_A_id>
    THEN:  HTTP 200 + solo aparecen los 2 productos de marca A.
    """
    marca_a = fake_marca_id()
    marca_b = fake_marca_id()

    p1 = ProductoModelFactory(marca_id=marca_a)
    p2 = ProductoModelFactory(marca_id=marca_a)
    p3 = ProductoModelFactory(marca_id=marca_b)

    response = authenticated_client.get(f"{URL_LIST}?marca={marca_a}")
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert str(p1.id) in returned_ids
    assert str(p2.id) in returned_ids
    assert str(p3.id) not in returned_ids, (
        "El filtro ?marca=... no funcionó: producto de otra marca apareció"
    )


# ═════════════════════════════════════════════════════════════════════
# 2) DETALLE
# ═════════════════════════════════════════════════════════════════════
def test_retrieve_producto_returns_full_payload(authenticated_client):
    """
    GIVEN: 1 producto en DB.
    WHEN:  GET /api/productos/<id>/
    THEN:  HTTP 200 + payload con sku, nombre, marca_id, proveedor_principal_id.
    """
    p = ProductoModelFactory()
    url = URL_DETAIL.format(pk=p.id)

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    assert str(body["id"]) == str(p.id)
    assert body["sku"]    == p.sku
    assert body["nombre"] == p.nombre

    # IDs cruzados — UUID-strings, sin FK física
    assert_uuid_string(body["marca_id"], field_name="producto.marca_id")
    assert_uuid_string(
        body["proveedor_principal_id"],
        field_name="producto.proveedor_principal_id",
    )


def test_retrieve_producto_404_when_not_found(authenticated_client):
    """Producto inexistente → 404."""
    response = authenticated_client.get(URL_DETAIL.format(pk=new_uuid()))
    assert response.status_code == 404, response.content


# ═════════════════════════════════════════════════════════════════════
# 3) CREAR · UUIDs cruzados sin FK física
# ═════════════════════════════════════════════════════════════════════
def test_create_producto_with_marca_proveedor_uuids(authenticated_client):
    """
    GIVEN: payload con marca_id + proveedor_principal_id generados
           al vuelo (sin filas correspondientes en brands.marca ni
           proveedores.proveedor).
    WHEN:  POST /api/productos/
    THEN:  HTTP 201 + id devuelto es UUID-string + producto persistido.

    SI ESTO ROMPE: revisar la migración SQL del módulo productos —
    es probable que alguien haya agregado FOREIGN KEY a marca_id /
    proveedor_principal_id, lo cual viola la REGLA DE ORO MWT.
    """
    payload = ProductoPayloadFactory()

    # Sanidad antes de mandar — los IDs cruzados deben ser UUIDs string
    assert_uuid_string(payload["marca_id"], field_name="payload.marca_id")
    assert_uuid_string(
        payload["proveedor_principal_id"],
        field_name="payload.proveedor_principal_id",
    )
    assert "id" not in payload, "El cliente NUNCA manda id — el server lo genera"

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    new_id = body["id"]
    assert_uuid_string(new_id, field_name="producto.id")

    assert body["sku"]    == payload["sku"]
    assert body["nombre"] == payload["nombre"]
    assert str(body["marca_id"]) == str(payload["marca_id"])
    assert str(body["proveedor_principal_id"]) == str(
        payload["proveedor_principal_id"]
    )

    # Verificación a nivel DB — la fila existe y está activa
    assert Producto.objects.filter(pk=new_id, is_active=True).exists(), (
        f"Producto {new_id} no quedó persistido en DB"
    )


def test_create_producto_acepta_marca_id_inexistente(authenticated_client):
    """
    Validación EXPLÍCITA de la REGLA DE ORO sobre marca_id:
      · marca_id puede ser un UUID que no existe en brands.marca
      · La API debe aceptarlo (no hay FK física)

    Si este test rompe, alguien agregó FOREIGN KEY a productos.marca_id.
    """
    payload = ProductoPayloadFactory()
    payload["marca_id"] = new_uuid()  # UUID huérfano

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, (
        "POST con marca_id huérfano falló. ¿Apareció FK física?\n"
        f"  status: {response.status_code}\n"
        f"  body:   {response.content[:500]!r}"
    )


# ═════════════════════════════════════════════════════════════════════
# 4) EDITAR · updated_at avanza
# ═════════════════════════════════════════════════════════════════════
def test_update_producto_changes_updated_at(authenticated_client):
    """
    GIVEN: producto con updated_at = T0.
    WHEN:  PATCH cambiando `nombre`.
    THEN:  · HTTP 200
           · response.nombre == nuevo valor
           · DB.updated_at > T0 (auto_now actualiza en pre_save).
    """
    p = ProductoModelFactory(nombre="Nombre original")
    original_updated_at = p.updated_at

    # Delta temporal mínimo para que el timestamp sea distinto
    time.sleep(0.05)

    url = URL_DETAIL.format(pk=p.id)
    new_nombre = f"Editado por QA · {new_uuid()[:8]}"
    response = authenticated_client.patch(url, {"nombre": new_nombre})
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["nombre"] == new_nombre

    p.refresh_from_db()
    assert p.nombre == new_nombre
    assert p.updated_at > original_updated_at, (
        f"updated_at no avanzó tras el PATCH.\n"
        f"  original: {original_updated_at!r}\n"
        f"  actual:   {p.updated_at!r}"
    )


def test_update_producto_partial_no_pisa_otros_campos(authenticated_client):
    """
    PATCH parcial: cambiar solo `precio_lista` no debe alterar `sku`,
    `marca_id`, etc. (Regression test: garantizar que `partial=True`
    en el serializer no pisa con valores default).
    """
    p = ProductoModelFactory(
        sku="SKU-INTACTO-001",
        precio_lista="100.00",
    )
    original_marca_id = str(p.marca_id)
    original_sku      = p.sku

    url = URL_DETAIL.format(pk=p.id)
    response = authenticated_client.patch(url, {"precio_lista": "150.50"})
    assert response.status_code == 200, response.content

    p.refresh_from_db()
    assert str(p.precio_lista) == "150.50"
    assert p.sku == original_sku, "PATCH parcial pisó el sku"
    assert str(p.marca_id) == original_marca_id, "PATCH parcial pisó el marca_id"


# ═════════════════════════════════════════════════════════════════════
# 5) ELIMINAR · soft delete (204 + is_active=False)
# ═════════════════════════════════════════════════════════════════════
def test_soft_delete_producto_returns_204(authenticated_client):
    """
    GIVEN: producto activo.
    WHEN:  DELETE /api/productos/<id>/
    THEN:  · HTTP 204 (sin body)
           · La fila SIGUE existiendo (no es hard delete)
           · is_active = False
           · Subsiguiente GET devuelve 404 (filtro is_active=True)
    """
    p = ProductoModelFactory()
    url = URL_DETAIL.format(pk=p.id)

    response = authenticated_client.delete(url)
    assert response.status_code == 204, response.content
    assert not response.content, (
        f"DELETE devolvió body inesperado: {response.content!r}"
    )

    # La fila persiste (soft delete)
    assert Producto.objects.filter(pk=p.id).exists(), (
        "Producto HARD-DELETED — debería ser soft delete (is_active=False)"
    )

    p.refresh_from_db()
    assert p.is_active is False, (
        f"Soft delete no cambió is_active a False (actual: {p.is_active})"
    )

    # Y ya no aparece en retrieve
    followup = authenticated_client.get(url)
    assert followup.status_code == 404, (
        f"Producto soft-deleted sigue accesible vía retrieve "
        f"(status={followup.status_code})"
    )


def test_soft_deleted_producto_no_aparece_en_listado(authenticated_client):
    """
    Después de soft-delete, el producto NO debe aparecer en GET /api/productos/.
    (El listado filtra is_active=True.)
    """
    p = ProductoModelFactory()
    target_id = str(p.id)

    # Soft delete
    del_resp = authenticated_client.delete(URL_DETAIL.format(pk=target_id))
    assert del_resp.status_code == 204

    # Listar: no debe estar
    list_resp = authenticated_client.get(URL_LIST)
    assert list_resp.status_code == 200
    results = extract_results(list_resp.json())
    returned_ids = {str(item["id"]) for item in results}

    assert target_id not in returned_ids, (
        f"Producto {target_id} sigue apareciendo en listado tras soft delete.\n"
        f"  Probable causa: list() no filtra is_active=True."
    )
