"""
=====================================================================
MWT.ONE · tests/test_proveedores.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 11 · Proveedores
Endpoint base:  /api/proveedores/  (ProveedorViewSet)

CICLO DE PRUEBAS (5 fases + score ISO + certificaciones + promo codes):
  · LISTAR   — GET /api/proveedores/ (filtros ?tipo, ?clase, ?pais)
  · DETALLE  — GET /api/proveedores/<uuid>/
  · CREAR    — POST con responsable_id como UUID cruzado.
  · EDITAR   — PATCH y verificación de updated_at.
               Actualizamos `score_iso` y `clase` (campos del Tab Comercial).
  · ELIMINAR — DELETE → 204 + is_active=False.
  · ERRORES  — payload sin razon_social → 400.
  · INTEGRACIÓN:
       · /promo_codes/         → crear/editar/borrar (PromoEngine)
       · /certificaciones/     → crear/listar (CRUD anidado)
       · /audit_log/           → append-only event log

REGLA DE ORO MWT
================
proveedor.responsable_id es UUIDField sin FK. Igual aplica para
satellites: supplier_promo_code.proveedor_id, supplier_certificacion.proveedor_id.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.proveedores.models import (
    Proveedor,
    SupplierAuditEvent,
    SupplierCertificacion,
    SupplierPromoCode,
)

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    ProveedorModelFactory,
    ProveedorPayloadFactory,
    SupplierCertificacionPayloadFactory,
    SupplierPromoCodePayloadFactory,
    fake_responsable_id,
)

pytestmark = [pytest.mark.proveedores, pytest.mark.crud]


URL_LIST   = "/api/proveedores/"
URL_DETAIL = "/api/proveedores/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
def test_list_proveedores_returns_seeded_rows(authenticated_client):
    seeded = [ProveedorModelFactory() for _ in range(3)]
    seeded_ids = {str(p.id) for p in seeded}

    response = authenticated_client.get(URL_LIST)
    assert response.status_code == 200, response.content

    results = extract_results(response.json())
    returned_ids = {str(item["id"]) for item in results}

    assert seeded_ids.issubset(returned_ids), (
        f"Proveedores seedeados no aparecen.\n"
        f"  esperados: {seeded_ids}\n"
        f"  recibidos: {returned_ids}"
    )
    for item in results:
        assert_uuid_string(item["id"], field_name="proveedor.id")


def test_list_proveedores_filtra_por_clase(authenticated_client):
    """?clase=CRITICO devuelve solo críticos."""
    critico   = ProveedorModelFactory(clase="CRITICO")
    normal    = ProveedorModelFactory(clase="NORMAL")
    eventual  = ProveedorModelFactory(clase="EVENTUAL")

    response = authenticated_client.get(f"{URL_LIST}?clase=CRITICO")
    assert response.status_code == 200, response.content

    returned_ids = {str(i["id"]) for i in extract_results(response.json())}
    assert str(critico.id)  in returned_ids
    assert str(normal.id)   not in returned_ids
    assert str(eventual.id) not in returned_ids


# ═════════════════════════════════════════════════════════════════════
# 2) DETALLE
# ═════════════════════════════════════════════════════════════════════
def test_retrieve_proveedor_returns_full_payload(authenticated_client):
    p = ProveedorModelFactory()
    url = URL_DETAIL.format(pk=p.id)

    response = authenticated_client.get(url)
    assert response.status_code == 200, response.content

    body = response.json()
    assert str(body["id"])    == str(p.id)
    assert body["razon_social"] == p.razon_social
    assert body["tipo"]         == p.tipo

    # Cross-UUID
    assert_uuid_string(body["responsable_id"], field_name="proveedor.responsable_id")

    # Campos del Tab Comercial (Bloque 51_proveedores_audit.sql)
    assert "clase"     in body
    assert "score_iso" in body


def test_retrieve_proveedor_404_when_not_found(authenticated_client):
    response = authenticated_client.get(URL_DETAIL.format(pk=new_uuid()))
    assert response.status_code == 404, response.content


# ═════════════════════════════════════════════════════════════════════
# 3) CREAR · UUID cruzado + score / clase
# ═════════════════════════════════════════════════════════════════════
def test_create_proveedor_with_cross_uuid_y_score(authenticated_client):
    payload = ProveedorPayloadFactory()

    assert_uuid_string(payload["responsable_id"], field_name="payload.responsable_id")
    assert "id" not in payload

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content

    body = response.json()
    new_id = body["id"]
    assert_uuid_string(new_id, field_name="proveedor.id")

    # Tab Comercial — clase + score_iso deben preservarse
    assert body["clase"]            == payload["clase"]
    assert str(body["score_iso"])   == str(payload["score_iso"])
    assert str(body["responsable_id"]) == str(payload["responsable_id"])

    # Categorías + certificaciones JSON deben mantenerse
    assert body["categorias"]      == payload["categorias"]
    assert body["certificaciones"] == payload["certificaciones"]

    assert Proveedor.objects.filter(pk=new_id, is_active=True).exists()


# ═════════════════════════════════════════════════════════════════════
# 3b) ERRORES · payload incompleto → 400
# ═════════════════════════════════════════════════════════════════════
def test_create_proveedor_sin_razon_social_devuelve_201(authenticated_client):
    """
    Contrato vigente: razon_social es OPCIONAL en el serializer de proveedores
    (filosofía MWT: el form no lo exige, la API tampoco) → 201.
    """
    payload = ProveedorPayloadFactory()
    payload.pop("razon_social", None)

    response = authenticated_client.post(URL_LIST, payload)
    assert response.status_code == 201, response.content


def test_create_proveedor_codigo_duplicado_devuelve_400(authenticated_client):
    """`codigo` es UNIQUE — segundo POST con mismo codigo debe rechazar."""
    p1 = ProveedorPayloadFactory()
    r1 = authenticated_client.post(URL_LIST, p1)
    assert r1.status_code == 201, r1.content

    p2 = ProveedorPayloadFactory()
    p2["codigo"] = p1["codigo"]  # colisión deliberada

    r2 = authenticated_client.post(URL_LIST, p2)
    assert r2.status_code == 400, (
        f"Esperado 400 por codigo duplicado, recibido {r2.status_code}"
    )


# ═════════════════════════════════════════════════════════════════════
# 4) EDITAR · updated_at + score_iso + clase
# ═════════════════════════════════════════════════════════════════════
def test_update_proveedor_changes_updated_at(authenticated_client):
    p = ProveedorModelFactory(clase="NORMAL", rating="3.50")
    original_updated_at = p.updated_at

    time.sleep(0.05)

    url = URL_DETAIL.format(pk=p.id)
    response = authenticated_client.patch(url, {
        "clase":     "CRITICO",
        "score_iso": "5.0",
        "rating":    "4.80",
    })
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["clase"]          == "CRITICO"
    assert str(body["score_iso"]) == "5.0"
    assert str(body["rating"])    == "4.80"

    p.refresh_from_db()
    assert p.clase == "CRITICO"
    assert p.updated_at > original_updated_at


def test_update_proveedor_partial_no_pisa_certificaciones(authenticated_client):
    """PATCH cambiando `nps` no debe pisar el array `certificaciones`."""
    p = ProveedorModelFactory(certificaciones=["ISO_9001", "ISO_45001"])
    original_certs = list(p.certificaciones)

    url = URL_DETAIL.format(pk=p.id)
    response = authenticated_client.patch(url, {"nps": 10})
    assert response.status_code == 200, response.content

    p.refresh_from_db()
    assert p.nps == 10
    assert p.certificaciones == original_certs, (
        "PATCH parcial sobre `nps` pisó el array `certificaciones`"
    )


# ═════════════════════════════════════════════════════════════════════
# 5) ELIMINAR · soft delete
# ═════════════════════════════════════════════════════════════════════
def test_soft_delete_proveedor_returns_204_and_inactive(authenticated_client):
    p = ProveedorModelFactory()
    url = URL_DETAIL.format(pk=p.id)

    response = authenticated_client.delete(url)
    assert response.status_code == 204, response.content
    assert not response.content

    assert Proveedor.objects.filter(pk=p.id).exists(), (
        "Proveedor HARD-DELETED — debería ser soft delete"
    )
    p.refresh_from_db()
    assert p.is_active is False

    followup = authenticated_client.get(url)
    assert followup.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · Promo Codes (PromoEngine, Tab 2 de la consola)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestProveedorPromoCodes:
    """
    /api/proveedores/<id>/promo_codes/  → GET (list) + POST (create)
    /api/proveedores/<id>/promo_codes/<code_id>/  → PATCH + DELETE (soft)
    """

    def _url_list(self, pid):
        return f"/api/proveedores/{pid}/promo_codes/"

    def _url_detail(self, pid, cid):
        return f"/api/proveedores/{pid}/promo_codes/{cid}/"

    def test_list_promo_codes_vacio_para_proveedor_nuevo(self, authenticated_client):
        p = ProveedorModelFactory()
        response = authenticated_client.get(self._url_list(p.id))
        assert response.status_code == 200, response.content
        body = response.json()
        if isinstance(body, dict):
            assert body.get("results", []) == []
        else:
            assert body == []

    def test_create_promo_code_proveedor_devuelve_201(self, authenticated_client):
        p = ProveedorModelFactory()
        payload = SupplierPromoCodePayloadFactory()

        response = authenticated_client.post(self._url_list(p.id), payload)
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"],           field_name="promo.id")
        assert_uuid_string(body["proveedor_id"], field_name="promo.proveedor_id")
        assert str(body["proveedor_id"]) == str(p.id), (
            "El viewset debe inyectar proveedor_id desde la URL"
        )

        assert SupplierPromoCode.objects.filter(
            pk=body["id"], proveedor_id=p.id, is_active=True
        ).exists()

    def test_soft_delete_promo_code_proveedor(self, authenticated_client):
        p = ProveedorModelFactory()
        create_resp = authenticated_client.post(
            self._url_list(p.id), SupplierPromoCodePayloadFactory()
        )
        assert create_resp.status_code == 201
        cid = create_resp.json()["id"]

        del_resp = authenticated_client.delete(self._url_detail(p.id, cid))
        assert del_resp.status_code == 204

        pc = SupplierPromoCode.objects.get(pk=cid)
        assert pc.is_active is False, (
            "DELETE en promo_code no es soft — perdimos auditoría"
        )


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · Certificaciones (compliance ISO)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestProveedorCertificaciones:
    """
    /api/proveedores/<id>/certificaciones/  → GET (list) + POST (create)
    """

    def _url(self, pid):
        return f"/api/proveedores/{pid}/certificaciones/"
    def test_list_certificaciones_vacio(self, authenticated_client):
        p = ProveedorModelFactory()
        response = authenticated_client.get(self._url(p.id))
        assert response.status_code == 200, response.content
        body = response.json()
        if isinstance(body, dict):
            assert body.get("results", []) == []
        else:
            assert body == []
    def test_create_certificacion_proveedor_devuelve_201(self, authenticated_client):
        p = ProveedorModelFactory()
        payload = SupplierCertificacionPayloadFactory()

        response = authenticated_client.post(self._url(p.id), payload)
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"],           field_name="cert.id")
        assert_uuid_string(body["proveedor_id"], field_name="cert.proveedor_id")
        assert str(body["proveedor_id"]) == str(p.id)
        assert body["tipo_certificacion"] == payload["tipo_certificacion"]
        assert body["numero_certificado"] == payload["numero_certificado"]

        assert SupplierCertificacion.objects.filter(
            pk=body["id"], proveedor_id=p.id, is_active=True
        ).exists()
    def test_create_multiple_certificaciones_y_listar(self, authenticated_client):
        """Un proveedor puede tener varias certs (ISO 9001, 14001, 45001)."""
        p = ProveedorModelFactory()
        for tipo in ("ISO_9001", "ISO_14001", "ISO_45001"):
            payload = SupplierCertificacionPayloadFactory(tipo_certificacion=tipo)
            r = authenticated_client.post(self._url(p.id), payload)
            assert r.status_code == 201, r.content

        list_resp = authenticated_client.get(self._url(p.id))
        assert list_resp.status_code == 200
        results = extract_results(list_resp.json())
        tipos = {item["tipo_certificacion"] for item in results}
        assert tipos == {"ISO_9001", "ISO_14001", "ISO_45001"}


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · Audit log (append-only)
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
def test_audit_log_proveedor_append_y_listar(authenticated_client):
    """
    POST /api/proveedores/<id>/audit_log/  inserta un evento.
    GET sobre el mismo URL lista los eventos en orden desc.
    """
    p = ProveedorModelFactory()
    url = f"/api/proveedores/{p.id}/audit_log/"

    payload = {
        "evento_tipo":      "PRICE_CHANGE",
        "entidad_afectada": "producto.precio_usd",
        "valor_anterior":   "29.90",
        "valor_nuevo":      "32.50",
        "delta_resumen":    "Ajuste de precio por inflación",
        "actor_type":       "USER",
    }

    create_resp = authenticated_client.post(url, payload)
    assert create_resp.status_code == 201, create_resp.content

    body = create_resp.json()
    assert_uuid_string(body["id"],           field_name="audit.id")
    assert_uuid_string(body["proveedor_id"], field_name="audit.proveedor_id")
    assert body["evento_tipo"] == "PRICE_CHANGE"

    # GET — el evento debe aparecer
    list_resp = authenticated_client.get(url)
    assert list_resp.status_code == 200
    results = extract_results(list_resp.json())
    assert any(e["id"] == body["id"] for e in results), (
        "El evento creado no aparece en GET /audit_log/"
    )
