"""
=====================================================================
MWT.ONE · tests/test_wizard_client_po.py
Agente responsable: [AG-06-QA] + [AG-BACKEND]

Wizard "Subir Orden de Compra" del cliente B2B
(POST /api/expedientes/create-from-oc/) · Sprint 2026-06-12.

COBERTURA
=========
1. UNIT (funciones puras de apps.expedientes.po_alias_matcher):
   · normalize_code / extract_size (talla = último grupo numérico)
   · match_part_number — alias más LARGO gana; no-match → None
   · pick_band — bordes de banda (piso inclusivo / techo exclusivo)
   · pick_plazo_price — plazo 90d exacto
   · format_po_codigo — "PO 504983"

2. ENDPOINT (con `ocr_payload` JSON precomputado — SIN archivo y SIN
   llamadas externas; FX monkeypatcheado a 5.1604 → banda 6):
   · CLIENT B2B: client_id FORZADO del JWT (legal_entity_ids)
   · R1: líneas matcheadas por alias del cliente
         (productos.product_client_alias)
   · R2: UNA fila en expedientes.linea POR TALLA, qty correcta
   · R3: unit_price_client = precio 90d de la banda 6 de la matriz
         congelada (pricing.marluvas_client_sku_pricing.prices_matrix)
   · R4: expedientes.documento kind='OC', codigo='PO 504983',
         audience='CLIENT', ligado al expediente
   · Línea sin match → producto_id NULL + needs_review=True
   · ADMIN no-regresión: payload completo respetado

Sin llamadas a LLM ni red — el `ocr_payload` precomputado es el camino
alterno documentado del endpoint. Rollback automático vía conftest.
=====================================================================
"""
from __future__ import annotations

import json
import uuid
from decimal import Decimal

import pytest
from django.db import connection

from apps.core.jwt_auth import MwtUser
from apps.expedientes import views_wizard
from apps.expedientes.po_alias_matcher import (
    build_alias_index,
    extract_size,
    format_po_codigo,
    match_part_number,
    normalize_code,
    pick_band,
    pick_plazo_price,
)
from tests._factories_v2 import insert_row, new_id
from tests.factories import ClienteModelFactory, ProductoModelFactory

pytestmark = [pytest.mark.expedientes]

URL = "/api/expedientes/create-from-oc/"
FX_RATE = 5.1604          # USD/BRL del CEO → banda 6 ("5,00 – 5,20")


# ═════════════════════════════════════════════════════════════════════
# 1) UNIT · normalización + talla
# ═════════════════════════════════════════════════════════════════════
class TestNormalizeAndSize:

    def test_normalize_quita_separadores_y_uppercasea(self):
        assert normalize_code("50B22-CPAP") == "50B22CPAP"
        assert normalize_code(" 70b22_cpap.pad/ ") == "70B22CPAPPAD"
        assert normalize_code("50B22CPAP") == "50B22CPAP"

    def test_normalize_vacio_y_none(self):
        assert normalize_code(None) == ""
        assert normalize_code("  ") == ""

    @pytest.mark.parametrize("part,base,size", [
        ("50B22CPAP-37",         "50B22CPAP",       "37"),
        ("70B22-CPAP-35",        "70B22CPAP",       "35"),
        ("75BPR29-MSMC-CPAP-38", "75BPR29MSMCCPAP", "38"),
        ("70C32-PET-CPAP-PAD-40","70C32PETCPAPPAD", "40"),
        ("70B22-CPAP-JA-36",     "70B22CPAPJA",     "36"),   # token JA-36
        ("70B22-CPAP-WH-46",     "70B22CPAPWH",     "46"),   # token WH-46
    ])
    def test_extract_size_talla_es_ultimo_grupo_numerico(self, part, base, size):
        assert extract_size(part) == (base, size)

    @pytest.mark.parametrize("part", [
        "50B22CPAP",     # termina en letra — sin talla
        "700211",        # SKU numérico largo — no se parte
        "70B22",         # trailing '22' fuera de rango de talla
    ])
    def test_extract_size_sin_talla_plausible(self, part):
        base, size = extract_size(part)
        assert size is None
        assert base == normalize_code(part)


# ═════════════════════════════════════════════════════════════════════
# 2) UNIT · match por alias (más largo gana / no-match)
# ═════════════════════════════════════════════════════════════════════
class TestAliasMatch:

    def _index(self):
        return build_alias_index([
            {"alias": "50B22",      "producto_id": "P-CORTO", "sku": "500100"},
            {"alias": "50B22-CPAP", "producto_id": "P-LARGO", "sku": "500211"},
            {"alias": "75BPR29-MSMC", "producto_id": "P-MSMC", "sku": "750300"},
        ])

    def test_alias_mas_largo_gana(self):
        m = match_part_number("50B22CPAP-37", self._index())
        assert m is not None
        assert m["producto_id"] == "P-LARGO"
        assert m["sku"] == "500211"
        assert m["size"] == "37"
        assert m["matched_via"] == "client_alias"

    def test_alias_corto_cuando_no_aplica_el_largo(self):
        m = match_part_number("50B22-37", self._index())
        assert m is not None
        assert m["producto_id"] == "P-CORTO"
        assert m["size"] == "37"

    def test_alias_prefijo_no_exacto(self):
        # El alias es prefijo del part sin talla (sufijos extra del cliente)
        m = match_part_number("75BPR29-MSMC-CPAP-38", self._index())
        assert m is not None
        assert m["producto_id"] == "P-MSMC"
        assert m["size"] == "38"

    def test_separadores_indiferentes(self):
        # PO trae `50B22CPAP`, alias en DB `50B22-CPAP`
        m = match_part_number("50B22CPAP35", self._index())
        assert m is not None and m["producto_id"] == "P-LARGO"

    def test_explicit_size_se_respeta(self):
        m = match_part_number("50B22-CPAP-38", self._index(), explicit_size="39")
        assert m is not None
        assert m["size"] == "39"

    def test_no_match_devuelve_none(self):
        assert match_part_number("ZZZ-NADA-40", self._index()) is None
        assert match_part_number("", self._index()) is None
        assert match_part_number("50B22CPAP-37", []) is None


# ═════════════════════════════════════════════════════════════════════
# 3) UNIT · pick_band (bordes) + pick_plazo_price + format_po_codigo
# ═════════════════════════════════════════════════════════════════════
class TestBandsAndPlazos:

    @pytest.mark.parametrize("rate,banda", [
        (4.00,   1),      # piso global inclusivo
        (4.19,   1),
        (4.9999, 5),      # justo bajo el techo de la 5
        (5.00,   6),      # techo exclusivo → sube a la 6
        (5.1604, 6),      # rate del CEO → banda "5,00 – 5,20"
        (5.20,   7),
        (6.39,  12),
        (6.40,  None),    # fuera de rango por arriba
        (3.99,  None),    # fuera de rango por abajo
        (None,  None),
        ("5,1604", 6),    # string con coma BR
        ("abc", None),
    ])
    def test_pick_band_bordes(self, rate, banda):
        assert pick_band(rate) == banda

    def test_pick_band_bandas_custom(self):
        bands = [(1, 1.0, 2.0), (2, 2.0, 3.0)]
        assert pick_band(2.5, bands) == 2
        assert pick_band(3.0, bands) is None

    def test_pick_plazo_90(self):
        matrix = {"ok": True, "plazos": [
            {"dias": 8,  "price": Decimal("21.00")},
            {"dias": 30, "price": Decimal("21.50")},
            {"dias": 60, "price": Decimal("22.00")},
            {"dias": 90, "price": Decimal("22.50")},
        ]}
        assert pick_plazo_price(matrix, 90) == Decimal("22.50")
        assert pick_plazo_price(matrix, "90") == Decimal("22.50")
        assert pick_plazo_price(matrix, 45) is None

    def test_pick_plazo_matrix_invalida(self):
        assert pick_plazo_price(None, 90) is None
        assert pick_plazo_price({"ok": False}, 90) is None
        assert pick_plazo_price({"ok": True, "plazos": [{"dias": 90, "price": 0}]}, 90) is None

    @pytest.mark.parametrize("raw,expected", [
        ("504983",            "PO 504983"),
        ("PO-504983",         "PO 504983"),
        ("PO 504983",         "PO 504983"),
        ("po:504983",         "PO 504983"),
        ("Purchase Order 504983", "PO 504983"),
        (504983,              "PO 504983"),
        ("",                  None),
        (None,                None),
    ])
    def test_format_po_codigo(self, raw, expected):
        assert format_po_codigo(raw) == expected


# ═════════════════════════════════════════════════════════════════════
# 4) ENDPOINT · seed helpers
# ═════════════════════════════════════════════════════════════════════
def _seed_client_world():
    """Cliente + producto + alias + matriz de precios congelada.
    Devuelve dict con todos los ids."""
    brand_id = new_id()
    cliente = ClienteModelFactory(razon_social="SonDel S.A.")
    cliente_id = str(cliente.id)

    producto = ProductoModelFactory(
        sku="700211",
        nombre="70B22-E-C-PAD",
        marca_id=uuid.UUID(brand_id),
    )
    producto_id = str(producto.id)

    insert_row(
        "productos.product_client_alias",
        id=new_id(),
        producto_id=producto_id,
        cliente_id=cliente_id,
        alias="70B22-CPAP",
        cliente_sku=None,
        is_active=True,
    )

    # Matriz congelada por contrato: banda 6 (5,00–5,20) ≠ banda 5 para
    # poder asertar que la banda elegida fue la correcta.
    insert_row(
        "pricing.marluvas_client_sku_pricing",
        id=new_id(),
        brand_id=brand_id,
        cliente_id=cliente_id,
        sku="700211",
        prices_matrix={
            "5": {"8": 28.00, "30": 28.80, "60": 29.40, "90": 30.00},
            "6": {"8": 21.00, "30": 21.50, "60": 22.00, "90": 22.50},
        },
        is_active=True,
    )
    return {"brand_id": brand_id, "cliente_id": cliente_id,
            "producto_id": producto_id}


def _po_payload():
    """PO estilo SonDel: una fila POR TALLA, Part Nº = alias + talla."""
    return {
        "po": {"number": "504983", "currency": "USD", "date": None},
        "confidence": 0.98,
        "ocr_engine": "test-fixture",
        "lines": [
            # sin separador y sin columna size → talla del sufijo
            {"sku": "70B22CPAP-37", "qty": 24, "unit_price": 23.10},
            # con separador y size explícito
            {"sku": "70B22-CPAP-38", "qty": 12, "unit_price": 23.10, "size": "38"},
            # sin match en catálogo → revisión
            {"sku": "ZZZ-UNKNOWN-40", "qty": 5, "unit_price": 9.99},
        ],
    }


@pytest.fixture
def client_b2b(api_client):
    """APIClient autenticado como usuario B2B 'cliente' con scope de
    empresa (legal_entity_ids) — patrón token={'role': 'cliente'}."""
    def _make(cliente_id: str):
        user = MwtUser(
            user_id=str(uuid.uuid4()),
            email="po-client@sondel.test",
            full_name="SonDel Compras",
            role="cliente",
            permissions={"modules": ["expedientes", "ocs"]},
            legal_entity_ids=[cliente_id],
        )
        api_client.force_authenticate(user=user, token={"role": "cliente"})
        return api_client
    return _make


@pytest.fixture
def fx_5_1604(monkeypatch):
    """FX USD/BRL determinístico — sin red. 5.1604 → banda 6."""
    monkeypatch.setattr(views_wizard, "_resolve_tc_usd_brl", lambda: FX_RATE)


def _fetch_lineas(expediente_id: str):
    with connection.cursor() as c:
        c.execute("""
            SELECT producto_id::text, sku, size, qty, unit_price_client,
                   unit_price_mwt, notas
              FROM expedientes.linea
             WHERE expediente_id = %s::uuid AND is_active = TRUE
             ORDER BY size NULLS LAST
        """, [expediente_id])
        return c.fetchall()


# ═════════════════════════════════════════════════════════════════════
# 5) ENDPOINT · CLIENT B2B end-to-end (ocr_payload, sin archivo)
# ═════════════════════════════════════════════════════════════════════
class TestCreateFromOcClientAlias:

    def test_client_po_alias_talla_banda_90d_documento(self, client_b2b, fx_5_1604):
        ids = _seed_client_world()
        api = client_b2b(ids["cliente_id"])

        r = api.post(URL, {
            "ocr_payload": _po_payload(),
            # intento de spoofing: debe ser IGNORADO (JWT manda)
            "client_id": new_id(),
            "idempotence_token": new_id(),
        }, format="json")

        assert r.status_code == 201, r.content
        body = r.json()
        assert body["ok"] is True

        # ── Seguridad B2B: client_id forzado del JWT ──
        exp = body["expediente"]
        assert exp["client_id"] == ids["cliente_id"]
        assert exp["phase_signal"] == "PENDING_CEO_REVIEW"
        assert exp["submitted_via_portal"] is True
        assert body["requires_ceo_review"] is True

        # ── R1: match por alias del cliente ──
        am = body["alias_match"]
        assert am["matched_alias"] == 2
        assert am["unmatched"] == 1
        assert am["tc_usd_brl"] == pytest.approx(FX_RATE)
        assert am["banda_id"] == 6

        # ── R2: UNA fila por talla, qty correcta ──
        rows = _fetch_lineas(exp["id"])
        assert len(rows) == 3, "la PO trae 3 filas (2 tallas + 1 sin match)"
        by_size = {row[2]: row for row in rows}
        assert set(by_size) == {"37", "38", "40"}
        assert float(by_size["37"][3]) == 24.0
        assert float(by_size["38"][3]) == 12.0

        # Líneas matcheadas → producto MWT + SKU MWT (no el Part Nº)
        for size in ("37", "38"):
            assert by_size[size][0] == ids["producto_id"]
            assert by_size[size][1] == "700211"

        # ── R3: precio 90d de la banda 6 (5,00–5,20 ∋ 5.1604) ──
        for size in ("37", "38"):
            assert Decimal(str(by_size[size][4])) == Decimal("22.5000"), \
                "unit_price_client debe ser el 90d de la banda 6 (22.50), no la 5 (30.00)"

        # ── Línea sin match: sin producto, con flag de revisión ──
        assert by_size["40"][0] is None
        assert "revisión" in (by_size["40"][6] or "").lower() or \
               "revision" in (by_size["40"][6] or "").lower()
        resp_unmatched = [l for l in body["lines"] if l["needs_review"]]
        assert len(resp_unmatched) == 1
        assert resp_unmatched[0]["producto_id"] is None
        assert resp_unmatched[0]["client_part_number"] == "ZZZ-UNKNOWN-40"

        # ── R4: documento kind='OC' codigo='PO 504983' visible al cliente ──
        doc = body["document"]
        assert doc["kind"] == "OC"
        assert doc["codigo"] == "PO 504983"
        assert doc["audience"] == "CLIENT"
        with connection.cursor() as c:
            c.execute("""
                SELECT kind, codigo, audience, oc_id::text
                  FROM expedientes.documento
                 WHERE expediente_id = %s::uuid AND is_active = TRUE
            """, [exp["id"]])
            docs = c.fetchall()
        assert len(docs) == 1
        assert docs[0][0] == "OC"
        assert docs[0][1] == "PO 504983"
        assert docs[0][2] == "CLIENT"
        assert docs[0][3] == body["oc"]["id"]

    def test_client_sin_fx_no_revienta_y_usa_banda_default(self, client_b2b, monkeypatch):
        """Tolerancia a fallo FX: rate=None → el motor cae a su banda
        default (6) y el endpoint responde 201 igual."""
        ids = _seed_client_world()
        api = client_b2b(ids["cliente_id"])
        monkeypatch.setattr(views_wizard, "_resolve_tc_usd_brl", lambda: None)

        r = api.post(URL, {"ocr_payload": _po_payload()}, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        assert body["alias_match"]["tc_usd_brl"] is None
        assert body["alias_match"]["banda_id"] is None
        rows = _fetch_lineas(body["expediente"]["id"])
        matched = [row for row in rows if row[0] == ids["producto_id"]]
        # banda fallback central del motor = 6 → 22.50 (no el precio OCR)
        assert all(Decimal(str(row[4])) == Decimal("22.5000") for row in matched)

    def test_client_sin_scope_devuelve_403(self, api_client):
        user = MwtUser(user_id=str(uuid.uuid4()), email="lost@b2b.test",
                       role="cliente", permissions={"modules": ["expedientes"]})
        api_client.force_authenticate(user=user, token={"role": "cliente"})
        r = api_client.post(URL, {"ocr_payload": _po_payload()}, format="json")
        assert r.status_code == 403
        assert r.json()["error"] == "client_scope_missing"


# ═════════════════════════════════════════════════════════════════════
# 6) ENDPOINT · ADMIN no-regresión (payload completo respetado)
# ═════════════════════════════════════════════════════════════════════
class TestCreateFromOcAdminNoRegression:

    def test_admin_payload_respetado(self, authenticated_client, fx_5_1604):
        ids = _seed_client_world()
        r = authenticated_client.post(URL, {
            "ocr_payload": _po_payload(),
            "client_id": ids["cliente_id"],
            "brand_id": ids["brand_id"],
            "mode": "FULL",
            "freight_mode": "SEA",
            "transport_mode": "MARITIMO",
            "price_basis": "FOB",
            "credit_days": 90,
        }, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        exp = body["expediente"]
        assert exp["client_id"] == ids["cliente_id"]
        assert exp["modo_operacion"] == "FULL"
        assert exp["freight_mode"] == "SEA"
        assert exp["price_basis"] == "FOB"
        assert exp["phase_signal"] == "ON_TRACK"
        assert body["requires_ceo_review"] is False
        # contrato previo intacto
        for key in ("oc", "artifact_id", "correlation_id", "submission_id"):
            assert key in body
        # el alias-match también enriquece el flujo ADMIN (aditivo)
        assert body["alias_match"]["matched_alias"] == 2
        rows = _fetch_lineas(exp["id"])
        assert len(rows) == 3

    def test_admin_sin_lineas_400(self, authenticated_client):
        r = authenticated_client.post(URL, {
            "ocr_payload": {"po": {"number": "1"}, "lines": []},
        }, format="json")
        assert r.status_code == 400
        assert r.json()["error"] == "no_lines_in_payload"
