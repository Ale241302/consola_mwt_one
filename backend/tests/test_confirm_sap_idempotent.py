"""
=====================================================================
MWT.ONE · tests/test_confirm_sap_idempotent.py
Regresión · POST /api/expedientes/{id}/confirm-sap/ (Comando C5)

BUG 2026-10-26 (producción, EXP-505433)
---------------------------------------
El endpoint hacía un INSERT ciego del ART-04. Cuando ya existía un
ART-04 activo para el expediente —creado por `upsert-sap` (MCP
`sap_upsert`), que NO transiciona el estado— el drawer "Agregar SAP"
enviaba `confirm-sap` con el expediente todavía en REGISTRO y el
INSERT reventaba contra:

    ai_unique_active_artifact
    UNIQUE (expediente_id, artifact_code) WHERE is_active
      AND artifact_code IN ('ART-02','ART-03','ART-04','ART-10','ART-11')

    → 500 «duplicate key value violates unique constraint»

Contrato que estos tests blindan:
  · confirm-sap es idempotente respecto a `ai_unique_active_artifact`.
  · Nunca devuelve 500 por un ART-04 preexistente.
  · Queda exactamente UN ART-04 activo, con el sap_id recién confirmado.
=====================================================================
"""
from __future__ import annotations

import uuid

import pytest
from django.db import connection

from apps.expedientes.models import Expediente
from tests.factories import ExpedienteModelFactory

pytestmark = [pytest.mark.expedientes, pytest.mark.integration]


# ═════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════
def _seed_linea(expediente: Expediente, *, sku: str, size: str,
                qty: float, unit_price: float) -> str:
    """Inserta una línea cruda (sin factory) y devuelve su id."""
    linea_id = str(uuid.uuid4())
    with connection.cursor() as c:
        c.execute(
            """
            INSERT INTO expedientes.linea (
                id, oc_id, expediente_id, sku, size, qty,
                unit_price, total_price, estado, is_active
            ) VALUES (
                %s::uuid, %s::uuid, %s::uuid, %s, %s, %s,
                %s, %s, 'PENDIENTE_SAP', TRUE
            )
            """,
            [linea_id, str(expediente.oc_id), str(expediente.id),
             sku, size, qty, unit_price, qty * unit_price],
        )
    return linea_id


def _seed_art04(expediente: Expediente, *, sap_id: str) -> str:
    """Simula el ART-04 que deja `upsert-sap` (MCP) sin transicionar."""
    artifact_id = str(uuid.uuid4())
    with connection.cursor() as c:
        c.execute(
            """
            INSERT INTO expedientes.artifact_instances (
                id, expediente_id, oc_id, artifact_code, kind, codigo,
                ocr_status, ocr_engine, ocr_confidence, ocr_payload,
                action_source, correlation_id, author, fecha,
                visibility_tier, audience, is_active
            ) VALUES (
                %s::uuid, %s::uuid, %s::uuid, 'ART-04', 'Confirmación SAP', %s,
                'DONE', 'manual-upload', 1.0, '{}'::jsonb,
                'C5', %s::uuid, 'qa@mwt.test', CURRENT_DATE,
                'INTERNAL', 'ADMIN_ONLY', TRUE
            )
            """,
            [artifact_id, str(expediente.id),
             str(expediente.oc_id) if expediente.oc_id else None,
             sap_id, str(uuid.uuid4())],
        )
    return artifact_id


def _active_art04(expediente: Expediente) -> list[tuple]:
    with connection.cursor() as c:
        c.execute(
            """
            SELECT id::text, codigo
              FROM expedientes.artifact_instances
             WHERE expediente_id = %s::uuid
               AND artifact_code = 'ART-04'
               AND is_active = TRUE
            """,
            [str(expediente.id)],
        )
        return c.fetchall()


# ═════════════════════════════════════════════════════════════════════
# Tests
# ═════════════════════════════════════════════════════════════════════
class TestConfirmSapIdempotent:
    """C5 debe tolerar un ART-04 preexistente (no duplicar, no 500)."""

    def test_confirm_sap_crea_art04_cuando_no_existe(self, authenticated_client):
        """
        GIVEN: expediente en REGISTRO sin ART-04.
        WHEN:  POST confirm-sap.
        THEN:  200 + exactamente un ART-04 activo con el sap_id.
        """
        exp = ExpedienteModelFactory(estado="REGISTRO")
        linea_id = _seed_linea(exp, sku="700653", size="37", qty=5,
                               unit_price=19.02)

        resp = authenticated_client.post(
            f"/api/expedientes/{exp.id}/confirm-sap/",
            {
                "sap_id": "297350",
                "fecha_fabricacion": "2026-10-26",
                "lineas_confirmadas": [
                    {"linea_id": linea_id, "qty_confirmada": 5,
                     "unit_price": 19.02},
                ],
            },
            format="json",
        )
        assert resp.status_code == 200, resp.content

        rows = _active_art04(exp)
        assert len(rows) == 1, rows
        assert rows[0][1] == "297350"

    def test_confirm_sap_actualiza_art04_preexistente(self, authenticated_client):
        """
        GIVEN: expediente en REGISTRO con un ART-04 activo creado antes
               por `upsert-sap` (caso real EXP-505433).
        WHEN:  POST confirm-sap con el mismo SAP.
        THEN:  200 (antes: 500 «duplicate key value»), un solo ART-04
               activo, y el artefacto reutilizado es el que ya existía.
        """
        exp = ExpedienteModelFactory(estado="REGISTRO")
        artifact_id = _seed_art04(exp, sap_id="297350")
        linea_id = _seed_linea(exp, sku="700653", size="38", qty=5,
                               unit_price=19.02)

        resp = authenticated_client.post(
            f"/api/expedientes/{exp.id}/confirm-sap/",
            {
                "sap_id": "297350",
                "fecha_fabricacion": "2026-10-26",
                "lineas_confirmadas": [
                    {"linea_id": linea_id, "qty_confirmada": 5,
                     "unit_price": 19.02},
                ],
            },
            format="json",
        )
        assert resp.status_code == 200, resp.content
        assert resp.json()["artifact_id"] == artifact_id

        rows = _active_art04(exp)
        assert len(rows) == 1, rows
        assert rows[0][1] == "297350"

        exp.refresh_from_db()
        assert exp.estado == "PRODUCCION"
        assert exp.sap == "297350"

        # `numero_sap` no está mapeado en el modelo: se lee por SQL.
        with connection.cursor() as c:
            c.execute(
                "SELECT numero_sap FROM expedientes.expediente WHERE id = %s::uuid",
                [str(exp.id)],
            )
            assert c.fetchone()[0] == "297350"
