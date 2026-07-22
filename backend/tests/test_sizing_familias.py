"""
=====================================================================
MWT.ONE · tests/test_sizing_familias.py
Agente responsable: [AG-06-QA]   (Motor de Tallas · G18)

COBERTURA
=========
Sprint 2026-07-22 · G18 — la familia de línea pasa de string libre
(metadata.familia + lista hardcodeada) a ENTIDAD por marca:

  · GET/POST/PATCH/DELETE /api/sizing/familias/  (FamiliaViewSet)
      - create 201 + shape del item (incluye marca_nombre read-only)
      - list con filtro ?marca_id y default sólo activas
      - duplicado (marca_id, nombre case-insensitive) entre activas → 400
      - mismo nombre en OTRA marca → 201
      - PATCH nombre (duplicado excluye self)
      - DELETE soft (?hard=1 → hard real, patrón TallaViewSet.destroy)
  · /api/sizing/tallas/ — nuevos campos marca_id / familia_id /
    familia_nombre y sincronización legacy:
      - POST marca_ids con 2 elementos → 400 ("una sola marca")
      - POST con marca_id → marca_ids queda [marca_id]
      - PATCH familia_id → metadata.familia = nombre + familia_nombre
      - PATCH familia_id inexistente → 400
  · GET /api/sizing/options/ — familias_linea ya NO es hardcodeado:
    sale del catálogo brands.marca_familia (activas, sorted distinct).

LIMPIEZA
========
Cada test corre dentro de una transacción con ROLLBACK automático
(conftest.py → django_db en todos los tests de tests/). La DB queda
exactamente como estaba; no hace falta teardown manual.

REQUISITO DE ENTORNO
====================
La DB contra la que corre la suite debe tener aplicado
backend/sql/G18_familias_entidad_por_marca.sql (tabla
brands.marca_familia + columnas ops.tallas.marca_id/familia_id).
=====================================================================
"""
from __future__ import annotations

import uuid

from tests._common import assert_uuid_string, extract_results
from tests.factories import MarcaModelFactory


URL_FAMILIAS = "/api/sizing/familias/"
URL_FAMILIA  = "/api/sizing/familias/{pk}/"
URL_TALLAS   = "/api/sizing/tallas/"
URL_TALLA    = "/api/sizing/tallas/{pk}/"
URL_OPTIONS  = "/api/sizing/options/"


def _nombre(prefix: str = "FamTest") -> str:
    """Nombre único por corrida — evita colisiones con data seedeada."""
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _crear_familia(client, marca_id, nombre=None, **extra):
    payload = {"marca_id": str(marca_id), "nombre": nombre or _nombre()}
    payload.update(extra)
    r = client.post(URL_FAMILIAS, payload)
    assert r.status_code == 201, r.content
    return r.json()


# ═════════════════════════════════════════════════════════════════════
# 1) CRUD · familias
# ═════════════════════════════════════════════════════════════════════
class TestFamiliasCRUD:

    def test_create_familia_201_y_shape(self, authenticated_client):
        m = MarcaModelFactory()
        nombre = _nombre()

        r = authenticated_client.post(
            URL_FAMILIAS,
            {"marca_id": str(m.id), "nombre": nombre,
             "descripcion": "línea de prueba"})
        assert r.status_code == 201, r.content

        body = r.json()
        assert_uuid_string(body["id"], field_name="familia.id")
        assert body["marca_id"]    == str(m.id)
        assert body["nombre"]      == nombre
        assert body["descripcion"] == "línea de prueba"
        assert body["is_active"]   is True
        assert body["marca_nombre"] == m.nombre   # read-only derivado
        assert "created_at" in body and "updated_at" in body

    def test_create_aparece_en_list_y_filtro_marca_id(self, authenticated_client):
        m1 = MarcaModelFactory()
        m2 = MarcaModelFactory()
        fam = _crear_familia(authenticated_client, m1.id)

        # List default (sólo activas) la contiene
        r = authenticated_client.get(URL_FAMILIAS)
        assert r.status_code == 200, r.content
        ids = {str(i["id"]) for i in extract_results(r.json())}
        assert fam["id"] in ids

        # ?marca_id la incluye para su marca y la excluye para otra
        r_m1 = authenticated_client.get(f"{URL_FAMILIAS}?marca_id={m1.id}")
        assert fam["id"] in {str(i["id"]) for i in extract_results(r_m1.json())}

        r_m2 = authenticated_client.get(f"{URL_FAMILIAS}?marca_id={m2.id}")
        assert fam["id"] not in {str(i["id"]) for i in extract_results(r_m2.json())}

    def test_duplicado_case_insensitive_misma_marca_400(self, authenticated_client):
        m = MarcaModelFactory()
        nombre = _nombre()
        _crear_familia(authenticated_client, m.id, nombre=nombre)

        # Mismo nombre, distinto caso, MISMA marca → 400
        r = authenticated_client.post(
            URL_FAMILIAS,
            {"marca_id": str(m.id), "nombre": nombre.swapcase()})
        assert r.status_code == 400, r.content

    def test_mismo_nombre_en_otra_marca_201(self, authenticated_client):
        m1 = MarcaModelFactory()
        m2 = MarcaModelFactory()
        nombre = _nombre()
        _crear_familia(authenticated_client, m1.id, nombre=nombre)

        r = authenticated_client.post(
            URL_FAMILIAS, {"marca_id": str(m2.id), "nombre": nombre})
        assert r.status_code == 201, r.content

    def test_patch_nombre_y_duplicado_excluye_self(self, authenticated_client):
        m = MarcaModelFactory()
        fam_a = _crear_familia(authenticated_client, m.id)
        fam_b = _crear_familia(authenticated_client, m.id)

        # Renombrar B con un nombre libre → 200
        nuevo = _nombre("FamRenombrada")
        r = authenticated_client.patch(
            URL_FAMILIA.format(pk=fam_b["id"]), {"nombre": nuevo})
        assert r.status_code == 200, r.content
        assert r.json()["nombre"] == nuevo

        # PATCH con su PROPIO nombre (otro caso) no es duplicado
        r_self = authenticated_client.patch(
            URL_FAMILIA.format(pk=fam_b["id"]), {"nombre": nuevo.swapcase()})
        assert r_self.status_code == 200, r_self.content

        # Renombrar B al nombre de A (case-insensitive) → 400
        r_dup = authenticated_client.patch(
            URL_FAMILIA.format(pk=fam_b["id"]),
            {"nombre": fam_a["nombre"].swapcase()})
        assert r_dup.status_code == 400, r_dup.content

    def test_delete_soft_oculta_del_list_default(self, authenticated_client):
        m = MarcaModelFactory()
        fam = _crear_familia(authenticated_client, m.id)

        r = authenticated_client.delete(URL_FAMILIA.format(pk=fam["id"]))
        assert r.status_code == 204, r.content

        # Default (sólo activas): ya no aparece
        ids_default = {str(i["id"]) for i in extract_results(
            authenticated_client.get(URL_FAMILIAS).json())}
        assert fam["id"] not in ids_default

        # ?is_active=false: visible de nuevo
        r_inact = authenticated_client.get(f"{URL_FAMILIAS}?is_active=false")
        assert r_inact.status_code == 200, r_inact.content
        ids_inact = {str(i["id"]) for i in extract_results(r_inact.json())}
        assert fam["id"] in ids_inact

        # Tras el soft delete el nombre queda LIBRE (índice sólo activas)
        r_re = authenticated_client.post(
            URL_FAMILIAS, {"marca_id": str(m.id), "nombre": fam["nombre"]})
        assert r_re.status_code == 201, r_re.content


# ═════════════════════════════════════════════════════════════════════
# 2) TALLAS · marca_id / familia_id (G18)
# ═════════════════════════════════════════════════════════════════════
class TestTallaClasificadoresG18:

    def test_post_marca_ids_dos_elementos_400(self, authenticated_client):
        m1 = MarcaModelFactory()
        m2 = MarcaModelFactory()

        r = authenticated_client.post(
            URL_TALLAS, {"marca_ids": [str(m1.id), str(m2.id)]})
        assert r.status_code == 400, r.content
        assert "marca_ids" in r.json()

    def test_post_con_marca_id_sincroniza_marca_ids(self, authenticated_client):
        m = MarcaModelFactory()

        r = authenticated_client.post(
            URL_TALLAS, {"marca_id": str(m.id), "talla_base": "99"})
        assert r.status_code == 201, r.content

        body = r.json()
        assert body["marca_id"]  == str(m.id)
        assert body["marca_ids"] == [str(m.id)]
        assert body["familia_id"]    is None
        assert body["familia_nombre"] is None

    def test_post_con_marca_ids_legacy_sincroniza_marca_id(self, authenticated_client):
        m = MarcaModelFactory()

        r = authenticated_client.post(
            URL_TALLAS, {"marca_ids": [str(m.id)]})
        assert r.status_code == 201, r.content

        body = r.json()
        assert body["marca_id"]  == str(m.id)
        assert body["marca_ids"] == [str(m.id)]

    def test_patch_familia_id_sincroniza_metadata_y_nombre(self, authenticated_client):
        m = MarcaModelFactory()
        fam = _crear_familia(authenticated_client, m.id)

        talla = authenticated_client.post(
            URL_TALLAS, {"marca_id": str(m.id)}).json()

        r = authenticated_client.patch(
            URL_TALLA.format(pk=talla["id"]), {"familia_id": fam["id"]})
        assert r.status_code == 200, r.content

        body = r.json()
        assert body["familia_id"]    == fam["id"]
        assert body["familia_nombre"] == fam["nombre"]
        assert body["metadata"]["familia"] == fam["nombre"]

        # familia_nombre se resuelve AUNQUE la familia se desactive
        authenticated_client.delete(URL_FAMILIA.format(pk=fam["id"]))
        r2 = authenticated_client.get(URL_TALLA.format(pk=talla["id"]))
        assert r2.status_code == 200, r2.content
        assert r2.json()["familia_nombre"] == fam["nombre"]

    def test_patch_familia_id_inexistente_400(self, authenticated_client):
        talla = authenticated_client.post(URL_TALLAS, {}).json()

        r = authenticated_client.patch(
            URL_TALLA.format(pk=talla["id"]),
            {"familia_id": str(uuid.uuid4())})
        assert r.status_code == 400, r.content
        assert "familia_id" in r.json()

    def test_filtro_tallas_por_familia_id(self, authenticated_client):
        m = MarcaModelFactory()
        fam = _crear_familia(authenticated_client, m.id)

        t1 = authenticated_client.post(
            URL_TALLAS, {"marca_id": str(m.id), "talla_base": "98"}).json()
        authenticated_client.patch(
            URL_TALLA.format(pk=t1["id"]), {"familia_id": fam["id"]})

        r = authenticated_client.get(f"{URL_TALLAS}?familia_id={fam['id']}")
        assert r.status_code == 200, r.content
        ids = {str(i["id"]) for i in extract_results(r.json())}
        assert t1["id"] in ids

    def test_filtro_tallas_por_marca_id_usa_columna(self, authenticated_client):
        m = MarcaModelFactory()
        t = authenticated_client.post(
            URL_TALLAS, {"marca_id": str(m.id), "talla_base": "97"}).json()

        r = authenticated_client.get(f"{URL_TALLAS}?marca_id={m.id}")
        assert r.status_code == 200, r.content
        ids = {str(i["id"]) for i in extract_results(r.json())}
        assert t["id"] in ids


# ═════════════════════════════════════════════════════════════════════
# 3) OPTIONS · familias_linea deja de ser hardcodeado (G18)
# ═════════════════════════════════════════════════════════════════════
class TestSizingOptionsFamiliasLinea:

    def test_familias_linea_sale_del_catalogo(self, authenticated_client):
        m = MarcaModelFactory()
        fam = _crear_familia(authenticated_client, m.id)

        r = authenticated_client.get(URL_OPTIONS)
        assert r.status_code == 200, r.content

        data = r.json()
        assert isinstance(data.get("familias_linea"), list)
        for item in data["familias_linea"]:
            assert isinstance(item, str)
        assert fam["nombre"] in data["familias_linea"], (
            "familias_linea debe salir de brands.marca_familia (activas), "
            f"no de una lista hardcodeada: {data['familias_linea']}"
        )
