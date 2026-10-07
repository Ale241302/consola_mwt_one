"""Tests de /api/harness/contents/ — contenido compartido de un Space.

La vista se auto-scopea al usuario: el autor no ve sus propias filas en
`incoming`, cada miembro ve las del resto de invitados del Space (grant activo)
y nunca las de un Space ajeno. El POST reemplaza por completo el conjunto del
autor para ese Space. El test aplica el DDL una vez (fixture de módulo) para no
depender de que el entrypoint ya haya corrido.
"""
import uuid
from pathlib import Path

import pytest
from django.db import connection

from apps.core.jwt_auth import MwtUser

SQL_FILES = [
    Path(__file__).resolve().parents[1] / "sql" / "M0_harness_share.sql",
    Path(__file__).resolve().parents[1] / "sql" / "M1_harness_share_scope.sql",
    Path(__file__).resolve().parents[1] / "sql" / "M3_harness_shared_content.sql",
]

ANA = "ana@sondelsa.com"
BEA = "bea@sondelsa.com"
OTRO = "otro@sonepar.com"
SPACE_ID = "7777666a-27d1-42ba-ab4b-25c47d862e8e"
OTRO_SPACE = "1111222b-27d1-42ba-ab4b-25c47d862e8e"

ROW_FIELDS = {
    "id", "space_id", "kind", "item_key", "author_email",
    "company_id", "payload", "created_at", "updated_at",
}


@pytest.fixture(scope="module", autouse=True)
def _ensure_table(django_db_blocker):
    """Aplica el DDL del contenido compartido una vez para el módulo."""
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


def _grant_space(api_client, owner_email, grantee_email, space_id, status="active"):
    """Publica un grant de Space a nombre del dueño."""
    _as(api_client, owner_email, ["co-sondel"])
    response = api_client.post(
        "/api/harness/shares/",
        {
            "kind": "space",
            "name": "SICOP",
            "resource_id": space_id,
            "payload": {},
            "shared_emails": [grantee_email],
            "permissions": ["view", "run"],
            "status": status,
        },
        format="json",
    )
    assert response.status_code == 201
    return response.json()


def _publish(api_client, space_id, items):
    return api_client.post(
        "/api/harness/contents/", {"space_id": space_id, "items": items}, format="json",
    )


def _item(kind="memory", item_key="nota-1", payload=None):
    return {"kind": kind, "item_key": item_key, "payload": payload or {"title": "Nota", "body": "Hola"}}


def test_publica_un_lote_y_lo_ve_el_invitado_con_grant_activo(api_client):
    _grant_space(api_client, ANA, BEA, SPACE_ID)

    # El autor publica dos ítems de distinto tipo.
    _as(api_client, ANA, ["co-sondel"])
    created = _publish(api_client, SPACE_ID, [_item(), _item(kind="routine", item_key="rutina-1")])
    assert created.status_code == 201
    rows = created.json()["rows"]
    assert len(rows) == 2
    # Campos snake_case exactos y payload como objeto, no como string jsonb.
    assert set(rows[0].keys()) == ROW_FIELDS
    assert rows[0]["author_email"] == ANA
    assert rows[0]["space_id"] == SPACE_ID
    assert rows[0]["payload"] == {"title": "Nota", "body": "Hola"}

    # El propio autor no ve sus filas como entrantes.
    _as(api_client, ANA, ["co-sondel"])
    assert api_client.get("/api/harness/contents/").json()["incoming"] == []

    # El invitado con grant activo sí las importa.
    _as(api_client, BEA, ["co-sondel"])
    incoming = api_client.get("/api/harness/contents/").json()["incoming"]
    assert sorted(item["item_key"] for item in incoming) == ["nota-1", "rutina-1"]
    assert all(item["payload"].__class__ is dict for item in incoming)


def test_un_grant_pendiente_o_de_otro_space_no_filtra(api_client):
    # Un Space ajeno y un grant pendiente: nada es visible.
    _grant_space(api_client, ANA, BEA, OTRO_SPACE, status="pending")

    _as(api_client, ANA, ["co-sondel"])
    assert _publish(api_client, OTRO_SPACE, [_item()]).status_code == 201

    _as(api_client, BEA, ["co-sondel"])
    assert api_client.get("/api/harness/contents/").json()["incoming"] == []

    _as(api_client, OTRO, ["co-sonepar"])
    assert api_client.get("/api/harness/contents/").json()["incoming"] == []


def test_el_post_reemplaza_el_conjunto_y_poda_las_filas_viejas(api_client):
    _grant_space(api_client, ANA, BEA, SPACE_ID)

    _as(api_client, ANA, ["co-sondel"])
    first = _publish(api_client, SPACE_ID, [_item(item_key="a"), _item(item_key="b")])
    assert first.status_code == 201

    # Republicar sólo con "a" poda "b" del autor para ese Space.
    second = _publish(api_client, SPACE_ID, [_item(item_key="a", payload={"v": 2})])
    assert second.status_code == 201
    assert [row["item_key"] for row in second.json()["rows"]] == ["a"]
    assert second.json()["rows"][0]["payload"] == {"v": 2}

    _as(api_client, BEA, ["co-sondel"])
    incoming = api_client.get("/api/harness/contents/").json()["incoming"]
    assert [item["item_key"] for item in incoming] == ["a"]


def test_borrado_autorizado_al_autor_o_al_dueno_del_space(api_client):
    _grant_space(api_client, ANA, BEA, SPACE_ID)

    # La autora (Ana) publica una fila.
    _as(api_client, ANA, ["co-sondel"])
    ana_row = _publish(api_client, SPACE_ID, [_item(item_key="de-ana")]).json()["rows"][0]

    # Una tercera usuaria sin ser autora ni dueña no puede borrarla.
    _as(api_client, BEA, ["co-sondel"])
    assert api_client.delete(f"/api/harness/contents/{ana_row['id']}/").status_code == 404

    # El dueño del Space (Ana) borra la fila de otra miembro (Bea).
    _as(api_client, BEA, ["co-sondel"])
    bea_row = _publish(api_client, SPACE_ID, [_item(item_key="de-bea")]).json()["rows"][0]
    _as(api_client, ANA, ["co-sondel"])
    assert api_client.delete(f"/api/harness/contents/{bea_row['id']}/").status_code == 204

    # La autora borra la propia y una fila inexistente da 404.
    assert api_client.delete(f"/api/harness/contents/{ana_row['id']}/").status_code == 204
    assert api_client.delete(f"/api/harness/contents/{uuid.uuid4()}/").status_code == 404


def test_valida_space_e_items(api_client):
    _as(api_client, ANA, ["co-sondel"])
    assert _publish(api_client, "", [_item()]).status_code == 400
    assert api_client.post(
        "/api/harness/contents/", {"space_id": SPACE_ID, "items": "no-lista"}, format="json",
    ).status_code == 400
    assert _publish(api_client, SPACE_ID, [_item(kind="agent")]).status_code == 400
    assert _publish(api_client, SPACE_ID, [_item(item_key="")]).status_code == 400
    assert _publish(api_client, SPACE_ID, [_item(payload="no-objeto")]).status_code == 400
