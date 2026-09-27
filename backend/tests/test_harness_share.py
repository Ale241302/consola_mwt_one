"""Tests de /api/harness/shares/ — compartición de agentes/skills del harness.

La vista se auto-scopea al usuario: sólo ve lo suyo y lo que le compartieron por
correo o con toda su empresa. El test aplica el DDL una vez (fixture de módulo)
para no depender de que el entrypoint ya haya corrido.
"""
import uuid
from pathlib import Path

import pytest
from django.db import connection

from apps.core.jwt_auth import MwtUser

SQL_FILE = Path(__file__).resolve().parents[1] / "sql" / "M0_harness_share.sql"

ANA = "ana@sondelsa.com"
BEA = "bea@sondelsa.com"
OTRO = "otro@sonepar.com"


@pytest.fixture(scope="module", autouse=True)
def _ensure_table():
    """Aplica el DDL del compartir una vez para el módulo."""
    sql = SQL_FILE.read_text(encoding="utf-8")
    with connection.cursor() as cursor:
        cursor.execute(sql)
    yield


def _as(api_client, email, companies):
    user = MwtUser(
        user_id=str(uuid.uuid4()),
        email=email,
        role="client_b2b",
        permissions={"modules": []},
        is_active=True,
        legal_entity_ids=companies,
    )
    api_client.force_authenticate(user=user, token={"role": "client_b2b"})
    return api_client


def _publish(api_client, **overrides):
    body = {
        "kind": "agent",
        "name": "Analista de compras",
        "payload": {"responsibility": "Analiza compras", "skills": ["mwt-compras-clientes-leer"]},
        "shared_emails": [],
        "share_all": False,
    }
    body.update(overrides)
    return api_client.post("/api/harness/shares/", body, format="json")


def test_publica_por_correo_y_lo_ve_el_destinatario(api_client):
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(api_client, shared_emails=[BEA])
    assert created.status_code == 201
    share_id = created.json()["id"]

    # El dueño la ve como saliente; el destinatario, como entrante.
    _as(api_client, ANA, ["co-sondel"])
    owner = api_client.get("/api/harness/shares/").json()
    assert [s["id"] for s in owner["outgoing"]] == [share_id]
    assert owner["incoming"] == []

    _as(api_client, BEA, ["co-sondel"])
    bea = api_client.get("/api/harness/shares/").json()
    assert [s["id"] for s in bea["incoming"]] == [share_id]
    assert bea["outgoing"] == []


def test_compartir_con_toda_la_empresa_no_alcanza_a_otra(api_client):
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(api_client, name="Con toda la empresa", share_all=True, shared_emails=[])
    assert created.status_code == 201
    share_id = created.json()["id"]

    # Un compañero de empresa la recibe; un usuario de otra empresa no.
    _as(api_client, "logistica@sondelsa.com", ["co-sondel"])
    colleague = api_client.get("/api/harness/shares/").json()
    assert share_id in [s["id"] for s in colleague["incoming"]]

    _as(api_client, OTRO, ["co-sonepar"])
    stranger = api_client.get("/api/harness/shares/").json()
    assert stranger["incoming"] == []


def test_solo_el_dueno_borra_y_republicar_actualiza(api_client):
    _as(api_client, ANA, ["co-sondel"])
    share_id = _publish(api_client, name="Reutilizable", shared_emails=[BEA]).json()["id"]

    # Republicar con el mismo nombre actualiza (mismo id), no duplica.
    again = _publish(api_client, name="Reutilizable", shared_emails=[BEA, "carla@sondelsa.com"])
    assert again.status_code == 201
    assert again.json()["id"] == share_id

    # Otro usuario no puede borrarla.
    _as(api_client, BEA, ["co-sondel"])
    assert api_client.delete(f"/api/harness/shares/{share_id}/").status_code == 404

    # El dueño sí.
    _as(api_client, ANA, ["co-sondel"])
    assert api_client.delete(f"/api/harness/shares/{share_id}/").status_code == 204


def test_rechaza_sin_destino_y_payload_no_objeto(api_client):
    _as(api_client, ANA, ["co-sondel"])
    assert _publish(api_client, shared_emails=[], share_all=False).status_code == 400
    assert _publish(api_client, payload="no-es-objeto").status_code == 400
