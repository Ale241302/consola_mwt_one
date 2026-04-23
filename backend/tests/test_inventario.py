"""
=====================================================================
MWT.ONE · tests/test_inventario.py
Agente responsable: [AG-06-QA]
Cobertura: Módulo 12 · Inventario
Endpoints:
  · /api/stock/         (StockViewSet)
  · /api/movimientos/   (MovimientoViewSet)

CICLO DE PRUEBAS:
  · LISTAR   — GET /api/stock/  (incluye filtros ?nodo, ?producto, ?solo_disponible=1)
  · DETALLE  — GET /api/stock/<uuid>/
  · CREAR    — POST con nodo_id + producto_id como UUIDs cruzados huérfanos.
  · EDITAR   — PATCH y verificación de updated_at (timestamp avanza).
  · ELIMINAR — DELETE → 204 + is_active=False + 404 en retrieve posterior.
  · ERRORES  — payload sin campos obligatorios → 400.
  · INTEGRACIÓN — movimiento ENTRADA aplica delta a stock; idempotence_token
                  evita doble alta; KPIs y selects responden 200.

REGLA DE ORO MWT
================
nodo_id, producto_id, referencia_id, user_id son UUIDField sin FK.
Stock NUNCA depende de filas reales en otras tablas para existir.
=====================================================================
"""
from __future__ import annotations

import time

import pytest

from apps.inventario.models import Movimiento, Stock

from tests._common import (
    assert_uuid_string,
    extract_results,
    new_uuid,
)
from tests.factories import (
    MovimientoModelFactory,
    MovimientoPayloadFactory,
    StockModelFactory,
    StockPayloadFactory,
    fake_nodo_id,
    fake_producto_id,
)

pytestmark = [pytest.mark.inventario, pytest.mark.crud]


URL_STOCK_LIST   = "/api/stock/"
URL_STOCK_DETAIL = "/api/stock/{pk}/"
URL_MOV_LIST     = "/api/movimientos/"
URL_MOV_DETAIL   = "/api/movimientos/{pk}/"


# ═════════════════════════════════════════════════════════════════════
# STOCK · 1) LISTAR
# ═════════════════════════════════════════════════════════════════════
class TestStockCrud:
    def test_list_stock_returns_seeded_rows(self, authenticated_client):
        seeded = [StockModelFactory() for _ in range(3)]
        seeded_ids = {str(s.id) for s in seeded}

        response = authenticated_client.get(URL_STOCK_LIST)
        assert response.status_code == 200, response.content

        results = extract_results(response.json())
        returned_ids = {str(item["id"]) for item in results}
        assert seeded_ids.issubset(returned_ids), (
            f"Stocks seedeados no aparecen.\n"
            f"  esperados: {seeded_ids}\n"
            f"  recibidos: {returned_ids}"
        )
        for item in results:
            assert_uuid_string(item["id"], field_name="stock.id")

    def test_list_stock_filtra_por_nodo(self, authenticated_client):
        """Filtro ?nodo=<uuid> devuelve solo stocks de ese nodo."""
        target_nodo = new_uuid()
        s1 = StockModelFactory(nodo_id=target_nodo)
        s2 = StockModelFactory(nodo_id=target_nodo)
        s_otro = StockModelFactory()  # otro nodo

        response = authenticated_client.get(f"{URL_STOCK_LIST}?nodo={target_nodo}")
        assert response.status_code == 200, response.content

        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert str(s1.id) in ids
        assert str(s2.id) in ids
        assert str(s_otro.id) not in ids, "Filtro ?nodo devolvió stocks de otro nodo"

    def test_list_stock_solo_disponible(self, authenticated_client):
        """?solo_disponible=1 excluye stocks con cantidad_disponible=0."""
        with_stock = StockModelFactory(cantidad_disponible="50.000")
        empty      = StockModelFactory(cantidad_disponible="0.000")

        response = authenticated_client.get(f"{URL_STOCK_LIST}?solo_disponible=1")
        assert response.status_code == 200, response.content

        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert str(with_stock.id) in ids
        assert str(empty.id) not in ids, "Stock con cantidad=0 no debería aparecer"

    # ─────────────────────────────────────────────────────────────
    # 2) DETALLE
    # ─────────────────────────────────────────────────────────────
    def test_retrieve_stock_returns_full_payload(self, authenticated_client):
        s = StockModelFactory()
        url = URL_STOCK_DETAIL.format(pk=s.id)

        response = authenticated_client.get(url)
        assert response.status_code == 200, response.content

        body = response.json()
        assert str(body["id"]) == str(s.id)
        assert_uuid_string(body["nodo_id"], field_name="stock.nodo_id")
        assert_uuid_string(body["producto_id"], field_name="stock.producto_id")

    def test_retrieve_stock_404_when_not_found(self, authenticated_client):
        response = authenticated_client.get(URL_STOCK_DETAIL.format(pk=new_uuid()))
        assert response.status_code == 404, response.content

    # ─────────────────────────────────────────────────────────────
    # 3) CREAR · UUIDs cruzados sin FK
    # ─────────────────────────────────────────────────────────────
    def test_create_stock_with_cross_uuids(self, authenticated_client):
        payload = StockPayloadFactory()
        assert_uuid_string(payload["nodo_id"], field_name="payload.nodo_id")
        assert_uuid_string(payload["producto_id"], field_name="payload.producto_id")
        assert "id" not in payload, "Stock NUNCA manda id — el server lo genera"

        response = authenticated_client.post(URL_STOCK_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        new_id = body["id"]
        assert_uuid_string(new_id, field_name="stock.id")
        assert str(body["nodo_id"]) == str(payload["nodo_id"])
        assert str(body["producto_id"]) == str(payload["producto_id"])

        # DB-level
        assert Stock.objects.filter(pk=new_id, is_active=True).exists()

    def test_create_stock_acepta_nodo_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: nodo_id huérfano (no existe en nodos.nodo) debe aceptarse."""
        payload = StockPayloadFactory()
        payload["nodo_id"] = new_uuid()  # huérfano

        response = authenticated_client.post(URL_STOCK_LIST, payload)
        assert response.status_code == 201, (
            f"POST con nodo_id huérfano falló. ¿Apareció FK física?\n"
            f"  status: {response.status_code}\n"
            f"  body:   {response.content[:500]!r}"
        )

    # ─────────────────────────────────────────────────────────────
    # 3b) ERRORES · payload incompleto → 400
    # ─────────────────────────────────────────────────────────────
    def test_create_stock_sin_nodo_id_devuelve_400(self, authenticated_client):
        """nodo_id es obligatorio → 400."""
        payload = StockPayloadFactory()
        payload.pop("nodo_id", None)

        response = authenticated_client.post(URL_STOCK_LIST, payload)
        assert response.status_code == 400, (
            f"Esperado 400 por falta de nodo_id, recibido {response.status_code}.\n"
            f"  body: {response.content[:300]!r}"
        )

    def test_create_stock_sin_producto_id_devuelve_400(self, authenticated_client):
        """producto_id es obligatorio → 400."""
        payload = StockPayloadFactory()
        payload.pop("producto_id", None)

        response = authenticated_client.post(URL_STOCK_LIST, payload)
        assert response.status_code == 400, response.content

    # ─────────────────────────────────────────────────────────────
    # 4) EDITAR · updated_at avanza
    # ─────────────────────────────────────────────────────────────
    def test_update_stock_changes_updated_at(self, authenticated_client):
        s = StockModelFactory(cantidad_disponible="100.000")
        original_updated_at = s.updated_at

        time.sleep(0.05)

        url = URL_STOCK_DETAIL.format(pk=s.id)
        response = authenticated_client.patch(url, {"cantidad_disponible": "150.000"})
        assert response.status_code == 200, response.content

        s.refresh_from_db()
        assert float(s.cantidad_disponible) == 150.0
        assert s.updated_at > original_updated_at, (
            f"updated_at no avanzó.\n"
            f"  original: {original_updated_at!r}\n"
            f"  actual:   {s.updated_at!r}"
        )

    def test_update_stock_partial_no_pisa_otros_campos(self, authenticated_client):
        """PATCH parcial cambiando solo `ubicacion_fisica` no toca cantidades."""
        s = StockModelFactory(
            cantidad_disponible="80.000",
            cantidad_minima="30.000",
            ubicacion_fisica="A-01-01",
        )
        original_disp = s.cantidad_disponible
        original_min  = s.cantidad_minima

        url = URL_STOCK_DETAIL.format(pk=s.id)
        response = authenticated_client.patch(url, {"ubicacion_fisica": "B-09-22"})
        assert response.status_code == 200, response.content

        s.refresh_from_db()
        assert s.ubicacion_fisica   == "B-09-22"
        assert s.cantidad_disponible == original_disp, "PATCH parcial pisó cantidad_disponible"
        assert s.cantidad_minima     == original_min,  "PATCH parcial pisó cantidad_minima"

    # ─────────────────────────────────────────────────────────────
    # 5) ELIMINAR · soft delete
    # ─────────────────────────────────────────────────────────────
    def test_soft_delete_stock_returns_204_and_inactive(self, authenticated_client):
        s = StockModelFactory()
        url = URL_STOCK_DETAIL.format(pk=s.id)

        response = authenticated_client.delete(url)
        assert response.status_code == 204, response.content

        # La fila persiste — soft delete
        assert Stock.objects.filter(pk=s.id).exists()

        s.refresh_from_db()
        assert s.is_active is False, (
            f"Soft delete no cambió is_active a False (actual: {s.is_active})"
        )

        # Ya no aparece en retrieve (filtra is_active=True)
        followup = authenticated_client.get(url)
        assert followup.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# MOVIMIENTO · CRUD + integraciones
# ═════════════════════════════════════════════════════════════════════
class TestMovimientoCrud:
    def test_list_movimientos_returns_seeded_rows(self, authenticated_client):
        seeded = [MovimientoModelFactory() for _ in range(3)]
        seeded_ids = {str(m.id) for m in seeded}

        response = authenticated_client.get(URL_MOV_LIST)
        assert response.status_code == 200, response.content

        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert seeded_ids.issubset(ids)

    def test_list_movimientos_filtra_por_tipo(self, authenticated_client):
        """Filtro ?tipo=ENTRADA debe excluir movimientos SALIDA."""
        ent = MovimientoModelFactory(tipo="ENTRADA")
        sal = MovimientoModelFactory(
            tipo="SALIDA",
            nodo_origen_id=fake_nodo_id(),
            nodo_destino_id=None,
        )

        response = authenticated_client.get(f"{URL_MOV_LIST}?tipo=ENTRADA")
        assert response.status_code == 200, response.content

        ids = {str(i["id"]) for i in extract_results(response.json())}
        assert str(ent.id) in ids
        assert str(sal.id) not in ids, "Filtro ?tipo=ENTRADA dejó pasar un SALIDA"

    def test_retrieve_movimiento_404_when_not_found(self, authenticated_client):
        response = authenticated_client.get(URL_MOV_DETAIL.format(pk=new_uuid()))
        assert response.status_code == 404, response.content

    def test_create_movimiento_entrada_aplica_delta_stock(self, authenticated_client):
        """
        POST /api/movimientos/ tipo=ENTRADA con nodo_destino_id + producto_id +
        cantidad debe (1) crear el movimiento, (2) UPSERT en inventario.stock.
        """
        nodo_dest   = new_uuid()
        producto_id = new_uuid()
        lote        = "LOTE-INT-001"

        payload = MovimientoPayloadFactory(
            tipo="ENTRADA",
            nodo_destino_id=nodo_dest,
            producto_id=producto_id,
            lote=lote,
            cantidad="40.000",
        )
        response = authenticated_client.post(URL_MOV_LIST, payload)
        assert response.status_code == 201, response.content

        body = response.json()
        assert_uuid_string(body["id"], field_name="movimiento.id")
        assert body["tipo"] == "ENTRADA"

        # El UPSERT crea la fila de stock con la cantidad del movimiento
        stock = Stock.objects.filter(
            nodo_id=nodo_dest, producto_id=producto_id, lote=lote,
        ).first()
        assert stock is not None, (
            "No se creó el stock asociado tras el movimiento ENTRADA"
        )
        assert float(stock.cantidad_disponible) == 40.0

    def test_create_movimiento_idempotence_token(self, authenticated_client):
        """Reintento con mismo idempotence_token devuelve el movimiento previo (200)."""
        token = f"idem-{new_uuid()}"
        payload = MovimientoPayloadFactory(
            tipo="ENTRADA",
            nodo_destino_id=new_uuid(),
            producto_id=new_uuid(),
            cantidad="10.000",
            idempotence_token=token,
        )

        first = authenticated_client.post(URL_MOV_LIST, payload)
        assert first.status_code == 201, first.content
        first_id = first.json()["id"]

        # Reintento con el mismo token: NO debe crear otro
        second = authenticated_client.post(URL_MOV_LIST, payload)
        assert second.status_code == 200, (
            f"Reintento con mismo idempotence_token no devolvió 200 (idempotente).\n"
            f"  status: {second.status_code}\n"
            f"  body:   {second.content[:300]!r}"
        )
        assert second.json()["id"] == first_id

        # Solo existe UN movimiento con ese token
        count = Movimiento.objects.filter(
            idempotence_token=token, is_active=True,
        ).count()
        assert count == 1, f"Idempotence rota: {count} movimientos con el mismo token"

    def test_create_movimiento_sin_cantidad_devuelve_400(self, authenticated_client):
        payload = MovimientoPayloadFactory()
        payload.pop("cantidad", None)

        response = authenticated_client.post(URL_MOV_LIST, payload)
        assert response.status_code == 400, response.content


# ═════════════════════════════════════════════════════════════════════
# INTEGRACIÓN · KPIs + Selects + Snapshots
# ═════════════════════════════════════════════════════════════════════
@pytest.mark.integration
class TestStockIntegration:
    def test_kpis_endpoint_responde_200_y_keys(self, authenticated_client):
        """GET /api/stock/kpis/ devuelve un JSON con las claves canónicas."""
        StockModelFactory(cantidad_disponible="50.000")
        response = authenticated_client.get("/api/stock/kpis/")
        assert response.status_code == 200, response.content

        body = response.json()
        for key in (
            "unidades_disponibles", "unidades_reservadas", "unidades_en_transito",
            "valor_disponible_usd", "skus_distintos", "nodos_con_stock",
            "skus_bajo_minimo",
        ):
            assert key in body, f"KPI {key!r} ausente en {sorted(body.keys())}"

    def test_select_contextos_responde_lista(self, authenticated_client):
        response = authenticated_client.get("/api/stock/select_contextos/")
        assert response.status_code == 200, response.content
        assert isinstance(response.json(), list)

    def test_snapshots_sin_filas_devuelve_lista_vacia(self, authenticated_client):
        """Sin StockSnapshot rows, /snapshots/ devuelve lista vacía (no 500)."""
        response = authenticated_client.get("/api/stock/snapshots/")
        assert response.status_code == 200, response.content
        body = response.json()
        # Acepta lista cruda o paginado
        if isinstance(body, dict):
            assert body.get("results", []) == []
        else:
            assert body == []

    def test_upload_stock_preview_clasifica_filas_invalidas(self, authenticated_client):
        """
        /api/stock/upload_stock_preview/ con SKUs inexistentes debe
        marcarlos como invalid_rows y devolver el log con status REJECTED.
        """
        body = {
            "filename": "stock_qa.xlsx",
            "nodo_id":  new_uuid(),
            "mapping":  {"sku": "SKU", "cantidad": "Cantidad"},
            "rows": [
                {"sku": "SKU-INEXISTENTE-1", "lote": "L1", "cantidad": 10},
                {"sku": "",                   "lote": "L2", "cantidad": 5},
            ],
        }
        response = authenticated_client.post(
            "/api/stock/upload_stock_preview/", body, format="json",
        )
        assert response.status_code == 200, response.content

        out = response.json()
        assert "import_id" in out
        assert out["total_rows"]   == 2
        assert out["invalid_rows"] >= 2, (
            f"Esperaba ≥2 filas inválidas (SKU vacío + inexistente), got {out['invalid_rows']}"
        )
        assert out["status"] in ("REJECTED", "PARTIAL")
