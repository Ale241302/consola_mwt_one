"""
=====================================================================
MWT.ONE · tests/test_sizing_options.py
Agente responsable: [AG-06-QA]   (Motor de Tallas · /api/sizing/options/)

COBERTURA
=========
GET /api/sizing/options/ — payload compuesto que alimenta los selects
del FE (cero datos hardcoded).

Sprint 2026-07-21 · nuevos clasificadores del Motor de Tallas:
  · "capellada"    ← productos.attr_opcion (key='capellada')
  · "tipo_puntera" ← productos.attr_opcion (key='tipo_puntera')
Ambas deben viajar como listas de strings y NUNCA incluir valores que
matcheen /dalupo/i (marca interna, no ofrecible en el FE).

NOTA: la vista degrada a lista vacía si la tabla no existe o la query
falla → el test afirma el CONTRATO (clave presente + tipo lista), no
un contenido mínimo.
=====================================================================
"""
from __future__ import annotations


class TestSizingOptionsClasificadores:
    URL = "/api/sizing/options/"

    def test_options_incluye_capellada_y_tipo_puntera_como_listas(
        self, authenticated_client,
    ):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content

        data = r.json()
        assert isinstance(data.get("capellada"), list)
        assert isinstance(data.get("tipo_puntera"), list)
        for item in data["capellada"]:
            assert isinstance(item, str)
        for item in data["tipo_puntera"]:
            assert isinstance(item, str)

    def test_options_excluye_valores_dalupo(self, authenticated_client):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content

        data = r.json()
        for clave in ("capellada", "tipo_puntera"):
            assert all("dalupo" not in v.lower() for v in data[clave]), (
                f"'{clave}' contiene un valor DALUPO: {data[clave]}"
            )
