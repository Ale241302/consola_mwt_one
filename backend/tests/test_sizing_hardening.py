"""
=====================================================================
MWT.ONE · tests/test_sizing_hardening.py
Agente responsable: [AG-06-QA]   (Motor de Tallas · G20)

COBERTURA
=========
Sprint 2026-07-22 · G20 — portal B2B + hardening de catálogos sizing:

  · ?ids=<uuid,uuid,…> en /api/sizing/tallas/ — batch fetch defensivo
    para el portal (hasta 500; inválidos ignorados silenciosamente).
  · Escritura STAFF-ONLY en los catálogos sizing
    (TipoProductoCatViewSet / MedidaSistemaCatViewSet / FamiliaViewSet):
    create/update/partial_update/destroy → 403 para rol cliente,
    201/200 para staff. Lectura (list/retrieve) sigue abierta a
    cualquier autenticado (el portal B2B lee con JWT de cliente).
    TallaViewSet NO se toca (sigue IsAuthenticated en escritura).
  · Portal B2B: GET /api/portal/products/<id>/ expone
    especificaciones.tipo_producto / familia / familia_id (passthrough
    del dict — el toggle dinámico de sistemas de talla del portal se
    alimenta de ahí).

LIMPIEZA
========
Rollback transaccional automático (conftest.py) — la DB queda intacta.

REQUISITO DE ENTORNO
====================
La DB debe tener aplicados G18/G19/G20 (G20 sólo backfill de
productos.producto.especificaciones.tipo_producto).
=====================================================================
"""
from __future__ import annotations

import uuid

from tests._common import extract_results
from tests.factories import MarcaModelFactory, ProductoModelFactory


URL_TALLAS   = "/api/sizing/tallas/"
URL_TIPOS    = "/api/sizing/tipos-producto/"
URL_TIPO     = "/api/sizing/tipos-producto/{codigo}/"
URL_SISTEMAS = "/api/sizing/sistemas-medida/"
URL_SISTEMA  = "/api/sizing/sistemas-medida/{codigo}/"
URL_FAMILIAS = "/api/sizing/familias/"
URL_FAMILIA  = "/api/sizing/familias/{pk}/"
URL_PORTAL_PRODUCTO = "/api/portal/products/{pk}/"


def _hex() -> str:
    return uuid.uuid4().hex[:8]


# ═════════════════════════════════════════════════════════════════════
# 1) ?ids= · batch fetch defensivo de tallas (portal B2B)
# ═════════════════════════════════════════════════════════════════════
class TestTallasFiltroIds:

    def _mk(self, client, talla_base):
        r = client.post(URL_TALLAS, {"talla_base": talla_base})
        assert r.status_code == 201, r.content
        return r.json()["id"]

    def test_ids_devuelve_solo_los_pedidos(self, authenticated_client):
        t1 = self._mk(authenticated_client, f"91-{_hex()}")
        t2 = self._mk(authenticated_client, f"92-{_hex()}")
        t3 = self._mk(authenticated_client, f"93-{_hex()}")

        r = authenticated_client.get(f"{URL_TALLAS}?ids={t1},{t2}")
        assert r.status_code == 200, r.content

        ids = {i["id"] for i in extract_results(r.json())}
        assert ids == {t1, t2}
        assert t3 not in ids

    def test_ids_invalidos_se_ignoran_silenciosamente(self, authenticated_client):
        t1 = self._mk(authenticated_client, f"94-{_hex()}")

        # Mezcla de válido + basura: la basura se ignora, NO hay 400/500
        r = authenticated_client.get(
            f"{URL_TALLAS}?ids=basura,{t1},no-es-uuid,,")
        assert r.status_code == 200, r.content
        ids = {i["id"] for i in extract_results(r.json())}
        assert ids == {t1}

        # Todo inválido → filtro vacío (lista vacía, no error)
        r2 = authenticated_client.get(f"{URL_TALLAS}?ids=foo,bar")
        assert r2.status_code == 200, r2.content
        assert extract_results(r2.json()) == []


# ═════════════════════════════════════════════════════════════════════
# 2) HARDENING · escritura staff-only en catálogos sizing
#    (cliente B2B → 403 · staff → 201/200 · lectura abierta)
# ═════════════════════════════════════════════════════════════════════
class TestStaffOnlyWrites:

    # ── tipos de producto ────────────────────────────────────────
    def test_tipos_cliente_no_puede_escribir(self, client_authenticated):
        label = f"Tipo QA {_hex()}"
        assert client_authenticated.post(
            URL_TIPOS, {"label": label}).status_code == 403
        assert client_authenticated.patch(
            URL_TIPO.format(codigo="calzado"),
            {"label": label}).status_code == 403
        assert client_authenticated.delete(
            URL_TIPO.format(codigo="calzado")).status_code == 403

    def test_tipos_staff_si_puede_escribir(self, authenticated_client):
        r = authenticated_client.post(URL_TIPOS, {"label": f"Tipo QA {_hex()}"})
        assert r.status_code == 201, r.content
        codigo = r.json()["codigo"]
        assert authenticated_client.patch(
            URL_TIPO.format(codigo=codigo),
            {"talla_base_label": "T"}).status_code == 200
        assert authenticated_client.delete(
            URL_TIPO.format(codigo=codigo)).status_code == 204

    # ── unidades de medida ───────────────────────────────────────
    def test_unidades_cliente_no_puede_escribir(self, client_authenticated):
        label = f"Unidad QA {_hex()}"
        assert client_authenticated.post(
            URL_SISTEMAS, {"label": label}).status_code == 403
        assert client_authenticated.patch(
            URL_SISTEMA.format(codigo="eu"),
            {"label": label}).status_code == 403
        assert client_authenticated.delete(
            URL_SISTEMA.format(codigo="eu")).status_code == 403

    def test_unidades_staff_si_puede_escribir(self, authenticated_client):
        r = authenticated_client.post(
            URL_SISTEMAS, {"label": f"Unidad QA {_hex()}"})
        assert r.status_code == 201, r.content
        codigo = r.json()["codigo"]
        assert authenticated_client.delete(
            URL_SISTEMA.format(codigo=codigo)).status_code == 204

    # ── familias por marca ───────────────────────────────────────
    def test_familias_cliente_no_puede_escribir(self, client_authenticated):
        m = MarcaModelFactory()
        assert client_authenticated.post(
            URL_FAMILIAS,
            {"marca_id": str(m.id), "nombre": f"Fam QA {_hex()}"}
        ).status_code == 403

    def test_familias_staff_si_puede_escribir(self, authenticated_client):
        m = MarcaModelFactory()
        r = authenticated_client.post(
            URL_FAMILIAS,
            {"marca_id": str(m.id), "nombre": f"Fam QA {_hex()}"})
        assert r.status_code == 201, r.content
        fid = r.json()["id"]
        assert authenticated_client.patch(
            URL_FAMILIA.format(pk=fid),
            {"descripcion": "d"}).status_code == 200
        assert authenticated_client.delete(
            URL_FAMILIA.format(pk=fid)).status_code == 204

    # ── lectura sigue abierta a cualquier autenticado ────────────
    def test_cliente_puede_leer_los_catalogos(self, client_authenticated):
        for url in (URL_TIPOS, URL_SISTEMAS, URL_FAMILIAS, URL_TALLAS):
            r = client_authenticated.get(url)
            assert r.status_code == 200, (
                f"GET {url} con JWT de cliente debe seguir abierto "
                f"(el portal B2B lo lee): recibido {r.status_code}"
            )


# ═════════════════════════════════════════════════════════════════════
# 3) PORTAL B2B · especificaciones passthrough (toggle dinámico)
# ═════════════════════════════════════════════════════════════════════
class TestPortalEspecificacionesPassthrough:

    def test_detalle_producto_expone_tipo_producto_familia(
            self, authenticated_client):
        fam_id = str(uuid.uuid4())
        p = ProductoModelFactory(especificaciones={
            "tipo_producto": "calzado",
            "familia": "Composite",
            "familia_id": fam_id,
        })

        r = authenticated_client.get(URL_PORTAL_PRODUCTO.format(pk=p.id))
        assert r.status_code == 200, r.content

        body = r.json()
        especs = body.get("especificaciones") or {}
        assert especs.get("tipo_producto") == "calzado"
        assert especs.get("familia") == "Composite"
        assert especs.get("familia_id") == fam_id
        # tallas (ids) viajan en el detalle para el batch ?ids=
        assert "tallas" in body
