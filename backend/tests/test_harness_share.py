"""Tests de /api/harness/shares/ — compartición de agentes/skills y Spaces/Work Flows.

La vista se auto-scopea al usuario: sólo ve lo suyo y lo que le compartieron por
correo o con toda su empresa. El test aplica el DDL una vez (fixture de módulo)
para no depender de que el entrypoint ya haya corrido.
"""
import uuid
from pathlib import Path

import pytest
from django.db import connection

from apps.core.jwt_auth import MwtUser

SQL_FILES = [
    Path(__file__).resolve().parents[1] / "sql" / "M0_harness_share.sql",
    Path(__file__).resolve().parents[1] / "sql" / "M1_harness_share_scope.sql",
]

ANA = "ana@sondelsa.com"
BEA = "bea@sondelsa.com"
OTRO = "otro@sonepar.com"
SPACE_ID = "8888559a-27d1-42ba-ab4b-25c47d862e8e"


@pytest.fixture(scope="module", autouse=True)
def _ensure_table(django_db_blocker):
    """Aplica el DDL del compartir una vez para el módulo."""
    with django_db_blocker.unblock():
        with connection.cursor() as cursor:
            for sql_file in SQL_FILES:
                cursor.execute(sql_file.read_text(encoding="utf-8"))
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


def test_publica_un_space_con_id_permisos_y_estado(api_client):
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(
        api_client,
        kind="space",
        name="SICOP",
        resource_id=SPACE_ID,
        payload={},
        shared_emails=[BEA],
        permissions=["view", "run", "share"],
        status="pending",
    )
    assert created.status_code == 201
    row = created.json()
    assert row["kind"] == "space"
    assert row["resource_id"] == SPACE_ID
    assert row["permissions"] == ["view", "run", "share"]
    assert row["status"] == "pending"

    # El invitado importa el grant contra el id remoto del recurso.
    _as(api_client, BEA, ["co-sondel"])
    incoming = api_client.get("/api/harness/shares/").json()["incoming"]
    assert [s["resource_id"] for s in incoming] == [SPACE_ID]
    assert incoming[0]["permissions"] == ["view", "run", "share"]


def test_el_mismo_space_con_dos_invitados_no_se_pisa(api_client):
    _as(api_client, ANA, ["co-sondel"])
    first = _publish(api_client, kind="space", name="SICOP", resource_id=SPACE_ID, shared_emails=[BEA], permissions=["view"])
    second = _publish(api_client, kind="space", name="SICOP", resource_id=SPACE_ID, shared_emails=["carla@sondelsa.com"], permissions=["run"])
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    _as(api_client, ANA, ["co-sondel"])
    outgoing = api_client.get("/api/harness/shares/").json()["outgoing"]
    assert sorted(s["resource_id"] for s in outgoing) == [SPACE_ID, SPACE_ID]


def test_un_space_exige_resource_id(api_client):
    _as(api_client, ANA, ["co-sondel"])
    assert _publish(api_client, kind="space", shared_emails=[BEA]).status_code == 400


def test_el_enlace_de_aceptar_marca_el_grant_activo(api_client):
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(
        api_client, kind="space", name="SICOP", resource_id=SPACE_ID,
        shared_emails=[BEA], permissions=["view"], status="pending",
    )
    grant_id = created.json()["id"]

    # El enlace del correo se abre sin credenciales y confirma en HTML.
    accepted = api_client.get(f"/api/harness/shares/accept/?grant={grant_id}", HTTP_ACCEPT="text/html")
    assert accepted.status_code == 200
    assert "Acceso aceptado" in accepted.content.decode("utf-8")

    _as(api_client, ANA, ["co-sondel"])
    row = next(s for s in api_client.get("/api/harness/shares/").json()["outgoing"] if s["id"] == grant_id)
    assert row["status"] == "active"


def test_el_enlace_de_aceptar_rechaza_un_id_desconocido(api_client):
    response = api_client.get(
        "/api/harness/shares/accept/?grant=00000000-0000-0000-0000-000000000000",
        HTTP_ACCEPT="text/html",
    )
    assert response.status_code == 404


def test_republish_refresca_el_payload_sin_tocar_estado(api_client):
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(
        api_client, kind="space", name="SICOP", resource_id=SPACE_ID,
        payload={"contextEntries": []}, shared_emails=[BEA], permissions=["view"], status="pending",
    )
    assert created.status_code == 201
    assert created.json()["status"] == "pending"
    grant_id = created.json()["id"]

    # El enlace de aceptación lo activa; el snapshot refrescado no lo desactiva.
    api_client.get(f"/api/harness/shares/accept/?grant={grant_id}", HTTP_ACCEPT="text/html")
    _as(api_client, ANA, ["co-sondel"])
    refreshed = api_client.post(
        "/api/harness/shares/republish/",
        {"kind": "space", "resource_id": SPACE_ID, "name": "SICOP",
         "payload": {"contextEntries": [{"title": "A", "body": "B"}]}},
        format="json",
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["updated"] >= 1
    row = next(s for s in api_client.get("/api/harness/shares/").json()["outgoing"] if s["id"] == grant_id)
    assert row["status"] == "active"
    assert row["payload"] == {"contextEntries": [{"title": "A", "body": "B"}]}

    # Un recurso inexistente no actualiza ninguna fila.
    missing = api_client.post(
        "/api/harness/shares/republish/",
        {"kind": "space", "resource_id": "00000000-0000-0000-0000-000000000000", "payload": {}},
        format="json",
    )
    assert missing.status_code == 200
    assert missing.json()["updated"] == 0

    assert api_client.delete(f"/api/harness/shares/{grant_id}/").status_code == 204
