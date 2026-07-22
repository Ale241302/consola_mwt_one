"""
=====================================================================
MWT.ONE · tests/test_sizing_dinamico.py
Agente responsable: [AG-06-QA]   (Motor de Tallas · G19)

COBERTURA
=========
Sprint 2026-07-22 · G19 — la Matriz de Equivalencias deja de ser 16
columnas fijas y pasa a ser dinámica por tipo de producto:

  · Talla.equivalencias (JSONB) = fuente de verdad {unidad: valor};
    las 16 columnas char quedan como ESPEJO legacy sincronizado:
      - POST con equivalencias → claves conocidas espejadas en columna,
        desconocidas (pecho_cm…) sólo en el JSONB.
      - PATCH equivalencias {} → columnas espejo a None.
      - POST/PATCH legacy con columnas sueltas (eu=…) → merge dentro
        del equivalencias existente; columnas quedan como vinieron.
      - clone copia equivalencias.
  · /api/sizing/tipos-producto/  → CRUD (auto-slug de codigo, duplicado
    400, PATCH parcial, codigo inmutable, DELETE soft + ?hard=1).
  · /api/sizing/sistemas-medida/ → CRUD (mismo patrón).
  · /api/sizing/options/ → tipos_producto incluye sistemas +
    talla_base_label; sistemas_medida refleja el catálogo vivo.

LIMPIEZA
========
Rollback transaccional automático (conftest.py) — la DB queda intacta.

REQUISITO DE ENTORNO
====================
La DB debe tener aplicado backend/sql/G19_matriz_dinamica_equivalencias.sql
(columna ops.tallas.equivalencias + tipo_producto_cat.sistemas /
talla_base_label + seed de unidades nuevas).
=====================================================================
"""
from __future__ import annotations

import uuid

from apps.sizing.models import Talla

from tests._common import extract_results


URL_TALLAS   = "/api/sizing/tallas/"
URL_TALLA    = "/api/sizing/tallas/{pk}/"
URL_CLONE    = "/api/sizing/tallas/{pk}/clone/"
URL_TIPOS    = "/api/sizing/tipos-producto/"
URL_TIPO     = "/api/sizing/tipos-producto/{codigo}/"
URL_SISTEMAS = "/api/sizing/sistemas-medida/"
URL_SISTEMA  = "/api/sizing/sistemas-medida/{codigo}/"
URL_OPTIONS  = "/api/sizing/options/"


def _hex() -> str:
    return uuid.uuid4().hex[:8]


# ═════════════════════════════════════════════════════════════════════
# 1) CRUD · tipos de producto
# ═════════════════════════════════════════════════════════════════════
class TestTiposProductoCRUD:

    def test_create_sin_codigo_genera_slug(self, authenticated_client):
        label = f"Camisetas QA {_hex()}"
        r = authenticated_client.post(
            URL_TIPOS, {"label": label,
                        "sistemas": ["pecho_cm", "cintura_cm"],
                        "talla_base_label": "Talla (T)"})
        assert r.status_code == 201, r.content

        body = r.json()
        esperado = label.lower().replace(" ", "_")
        assert body["codigo"] == esperado
        assert body["label"] == label
        assert body["sistemas"] == ["pecho_cm", "cintura_cm"]
        assert body["talla_base_label"] == "Talla (T)"
        assert body["is_active"] is True
        assert "created_at" in body and "updated_at" in body

    def test_create_codigo_duplicado_400(self, authenticated_client):
        label = f"Pantalones QA {_hex()}"
        r1 = authenticated_client.post(URL_TIPOS, {"label": label})
        assert r1.status_code == 201, r1.content

        # Mismo label → mismo slug → duplicado
        r2 = authenticated_client.post(URL_TIPOS, {"label": label})
        assert r2.status_code == 400, r2.content
        assert "codigo" in r2.json()

        # Código explícito duplicado también → 400
        r3 = authenticated_client.post(
            URL_TIPOS, {"label": "Otro label", "codigo": r1.json()["codigo"]})
        assert r3.status_code == 400, r3.content

    def test_sistemas_debe_ser_lista_de_strings(self, authenticated_client):
        r = authenticated_client.post(
            URL_TIPOS, {"label": f"Tipo QA {_hex()}", "sistemas": "eu,br"})
        assert r.status_code == 400, r.content

    def test_patch_sistemas_y_talla_base_label(self, authenticated_client):
        r = authenticated_client.post(
            URL_TIPOS, {"label": f"Tipo QA {_hex()}"})
        codigo = r.json()["codigo"]

        r = authenticated_client.patch(
            URL_TIPO.format(codigo=codigo),
            {"sistemas": ["pecho_cm"], "talla_base_label": "Talla base (T)"})
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["sistemas"] == ["pecho_cm"]
        assert body["talla_base_label"] == "Talla base (T)"

    def test_codigo_inmutable_en_update(self, authenticated_client):
        r = authenticated_client.post(
            URL_TIPOS, {"label": f"Tipo QA {_hex()}"})
        codigo = r.json()["codigo"]

        r = authenticated_client.patch(
            URL_TIPO.format(codigo=codigo), {"codigo": "hackeado"})
        assert r.status_code == 200, r.content
        assert r.json()["codigo"] == codigo

    def test_delete_soft_desaparece_del_list(self, authenticated_client):
        r = authenticated_client.post(
            URL_TIPOS, {"label": f"Tipo QA {_hex()}"})
        codigo = r.json()["codigo"]

        r = authenticated_client.delete(URL_TIPO.format(codigo=codigo))
        assert r.status_code == 204, r.content

        ids = {i["codigo"] for i in extract_results(
            authenticated_client.get(URL_TIPOS).json())}
        assert codigo not in ids

        # Con ?is_active=false sigue existiendo (soft, no hard)
        ids_inact = {i["codigo"] for i in extract_results(
            authenticated_client.get(f"{URL_TIPOS}?is_active=false").json())}
        assert codigo in ids_inact


# ═════════════════════════════════════════════════════════════════════
# 2) CRUD · unidades de medida
# ═════════════════════════════════════════════════════════════════════
class TestSistemasMedidaCRUD:

    def test_create_unidad_y_aparece_en_options(self, authenticated_client):
        label = f"Pecho QA {_hex()}"
        r = authenticated_client.post(
            URL_SISTEMAS, {"label": label, "region": "CORPORAL",
                           "grupo": "CORPORAL"})
        assert r.status_code == 201, r.content

        body = r.json()
        assert body["codigo"] == label.lower().replace(" ", "_")
        assert body["label"] == label
        # Shape existente del serializer (ni más ni menos)
        assert set(body.keys()) == {
            "codigo", "label", "region", "descripcion",
            "grupo", "orden", "is_active"}

        r_opt = authenticated_client.get(URL_OPTIONS)
        assert r_opt.status_code == 200, r_opt.content
        codigos = {s["codigo"] for s in r_opt.json()["sistemas_medida"]}
        assert body["codigo"] in codigos

    def test_create_duplicado_400(self, authenticated_client):
        label = f"Unidad QA {_hex()}"
        r1 = authenticated_client.post(URL_SISTEMAS, {"label": label})
        assert r1.status_code == 201, r1.content

        r2 = authenticated_client.post(URL_SISTEMAS, {"label": label})
        assert r2.status_code == 400, r2.content

    def test_delete_soft_desaparece_de_options(self, authenticated_client):
        r = authenticated_client.post(
            URL_SISTEMAS, {"label": f"Unidad QA {_hex()}"})
        codigo = r.json()["codigo"]

        r = authenticated_client.delete(URL_SISTEMA.format(codigo=codigo))
        assert r.status_code == 204, r.content

        codigos = {s["codigo"] for s in
                   authenticated_client.get(URL_OPTIONS).json()["sistemas_medida"]}
        assert codigo not in codigos


# ═════════════════════════════════════════════════════════════════════
# 3) TALLA · equivalencias dinámicas (G19)
# ═════════════════════════════════════════════════════════════════════
class TestTallaEquivalencias:

    def test_post_equivalencias_espeja_columnas_conocidas(self, authenticated_client):
        r = authenticated_client.post(
            URL_TALLAS,
            {"tipo_producto": "camisa",
             "equivalencias": {"eu": "40", "pecho_cm": "96"}})
        assert r.status_code == 201, r.content

        body = r.json()
        # Clave conocida → espejo en su columna char
        assert body["eu"] == "40"
        # Clave desconocida → vive sólo en el JSONB
        assert body["equivalencias"] == {"eu": "40", "pecho_cm": "96"}
        assert "pecho_cm" not in body  # nunca se inventan columnas

        # Espejo persistido en la columna real
        t = Talla.objects.get(pk=body["id"])
        assert t.eu == "40"
        assert t.equivalencias["pecho_cm"] == "96"

    def test_patch_equivalencias_vacio_limpia_columnas(self, authenticated_client):
        talla = authenticated_client.post(
            URL_TALLAS,
            {"equivalencias": {"eu": "40", "br": "38"}}).json()
        assert talla["eu"] == "40" and talla["br"] == "38"

        r = authenticated_client.patch(
            URL_TALLA.format(pk=talla["id"]), {"equivalencias": {}})
        assert r.status_code == 200, r.content

        body = r.json()
        assert body["equivalencias"] == {}
        assert body["eu"] is None and body["br"] is None

    def test_post_legacy_columnas_sueltas_hace_merge(self, authenticated_client):
        r = authenticated_client.post(URL_TALLAS, {"eu": "41"})
        assert r.status_code == 201, r.content

        body = r.json()
        assert body["eu"] == "41"
        assert body["equivalencias"] == {"eu": "41"}

    def test_patch_legacy_merge_sobre_equivalencias_existente(
            self, authenticated_client):
        talla = authenticated_client.post(
            URL_TALLAS,
            {"equivalencias": {"br": "38", "pecho_cm": "96"}}).json()

        # PATCH legacy: sólo columna suelta → merge, no reemplazo
        r = authenticated_client.patch(
            URL_TALLA.format(pk=talla["id"]), {"eu": "42"})
        assert r.status_code == 200, r.content

        body = r.json()
        assert body["eu"] == "42"
        assert body["equivalencias"] == {
            "br": "38", "pecho_cm": "96", "eu": "42"}

    def test_clone_copia_equivalencias(self, authenticated_client):
        talla = authenticated_client.post(
            URL_TALLAS,
            {"talla_base": "M",
             "equivalencias": {"eu": "40", "pecho_cm": "96"}}).json()

        r = authenticated_client.post(URL_CLONE.format(pk=talla["id"]))
        assert r.status_code == 201, r.content

        copia = r.json()
        assert copia["equivalencias"] == {"eu": "40", "pecho_cm": "96"}
        assert copia["eu"] == "40"

    def test_list_expone_equivalencias(self, authenticated_client):
        talla = authenticated_client.post(
            URL_TALLAS,
            {"equivalencias": {"eu": "40", "pecho_cm": "96"}}).json()

        r = authenticated_client.get(URL_TALLAS)
        assert r.status_code == 200, r.content
        item = next(i for i in extract_results(r.json())
                    if i["id"] == talla["id"])
        assert item["equivalencias"] == {"eu": "40", "pecho_cm": "96"}


# ═════════════════════════════════════════════════════════════════════
# 4) OPTIONS · tipos_producto con sistemas + talla_base_label (G19)
# ═════════════════════════════════════════════════════════════════════
class TestOptionsMatrizDinamica:

    def test_tipos_producto_trae_sistemas_y_talla_base_label(
            self, authenticated_client):
        r = authenticated_client.get(URL_OPTIONS)
        assert r.status_code == 200, r.content

        tipos = r.json()["tipos_producto"]
        assert isinstance(tipos, list) and tipos, "tipos_producto vacío"
        for t in tipos:
            assert "sistemas" in t, f"tipo sin 'sistemas': {t}"
            assert "talla_base_label" in t, f"tipo sin 'talla_base_label': {t}"
            assert isinstance(t["sistemas"], list)

        # Config seed G19: calzado con sus unidades y label BRA
        calzado = next((t for t in tipos if t["codigo"] == "calzado"), None)
        assert calzado is not None
        assert calzado["talla_base_label"] == "Talla base (BRA)"
        assert "eu" in calzado["sistemas"] and "cm" in calzado["sistemas"]
