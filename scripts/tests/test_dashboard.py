"""Contratos del dashboard versionado: sello de fuentes y verificaciones.

El objetivo es que un dashboard viejo o descuadrado se detecte solo, en vez de
depender de que alguien mire tres números a ojo (doc 04).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard import sellar, verificar  # noqa: E402

CSV = "cliente,pais,negocio,anio,pedidos,usd_confirmado\nAcme,GT,comision,2026,2,100\nBeta,CR,reventa,2026,1,50\n"


def _fixture(base: Path):
    datos = base / "datos"
    fuentes = base / "fuentes"
    artifact = base / "artifact"
    for d in (datos, fuentes, artifact):
        d.mkdir(parents=True)

    (datos / "ds_clientes_anio.csv").write_text(CSV, encoding="utf-8")
    (datos / "ds_clientes_ficha.json").write_text(json.dumps([
        {"cliente": "Acme", "pedidos": [{"pf": "1-2026"}, {"pf": "2-2026"}]},
        {"cliente": "Beta", "pedidos": [{"pf": "3-2026"}]},
    ]), encoding="utf-8")
    (datos / "ds_flujo.csv").write_text("mes,monto\n2026-01,10\n", encoding="utf-8")

    (fuentes / "base_mwt.json").write_text("{}", encoding="utf-8")
    (fuentes / "raw").mkdir()
    (fuentes / "raw" / "comisiones.json").write_text("[]", encoding="utf-8")

    (artifact / "datasets.json").write_text(json.dumps({
        "corte": "2026-11-08",
        "datasets": [
            {"id": "clientes_anio", "archivo": "ds_clientes_anio.csv"},
            {"id": "clientes_ficha", "archivo": "ds_clientes_ficha.json"},
            {"id": "flujo", "archivo": "ds_flujo.csv"},
        ],
    }), encoding="utf-8")
    return datos, fuentes, artifact


def _sello(datos, fuentes, artifact) -> dict:
    sello = sellar.construir_sello(datos_dir=datos, fuentes_dir=fuentes, artifact_dir=artifact)
    (datos / "SELLO_FUENTES.json").write_text(json.dumps(sello), encoding="utf-8")
    return sello


class TestSello:
    def test_sella_datos_fuentes_y_subcarpetas(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)

        assert {s["archivo"] for s in sello["datos"]} == {
            "ds_clientes_anio.csv", "ds_clientes_ficha.json", "ds_flujo.csv",
        }
        assert {s["archivo"] for s in sello["fuentes"]} == {"base_mwt.json", "comisiones.json"}
        assert all(len(s["sha256"]) == 64 for s in sello["datos"])
        assert sello["corte_declarado"] == "2026-11-08"
        assert sello["datasets_faltantes"] == []

    def test_detecta_dataset_declarado_y_ausente(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        (artifact / "datasets.json").write_text(json.dumps({
            "datasets": [{"id": "x", "archivo": "ds_no_existe.csv"}],
        }), encoding="utf-8")
        sello = sellar.construir_sello(datos_dir=datos, fuentes_dir=fuentes, artifact_dir=artifact)
        assert sello["datasets_faltantes"] == ["ds_no_existe.csv"]


class TestVerificacion:
    def test_todo_cuadrado_pasa(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        resultado = verificar.verificar(datos, artifact, sello)
        assert resultado["ok"] is True, resultado["chequeos"]

    def test_archivo_modificado_despues_del_sello(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        (datos / "ds_flujo.csv").write_text("mes,monto\n2026-02,20\n", encoding="utf-8")

        resultado = verificar.verificar(datos, artifact, sello)
        assert resultado["ok"] is False
        assert "sellos" in resultado["fallidos"]

    def test_cliente_con_pedidos_y_sin_ficha(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        (datos / "ds_clientes_ficha.json").write_text(json.dumps([
            {"cliente": "Acme", "pedidos": [{"pf": "1-2026"}, {"pf": "2-2026"}]},
        ]), encoding="utf-8")

        resultado = verificar.verificar(datos, artifact, sello)
        chequeo = next(c for c in resultado["chequeos"] if c["id"] == "clientes")
        assert chequeo["ok"] is False
        assert any("no tiene ficha" in h["detalle"] for h in chequeo["hallazgos"])

    def test_pedidos_que_no_cuadran(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        (datos / "ds_clientes_ficha.json").write_text(json.dumps([
            {"cliente": "Acme", "pedidos": [{"pf": "1-2026"}]},
            {"cliente": "Beta", "pedidos": [{"pf": "3-2026"}]},
        ]), encoding="utf-8")

        resultado = verificar.verificar(datos, artifact, sello)
        chequeo = next(c for c in resultado["chequeos"] if c["id"] == "clientes")
        assert any("pedidos: tabla=2 ficha=1" in h["detalle"] for h in chequeo["hallazgos"])

    def test_fuente_mas_nueva_que_las_salidas(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        futuro = time.time() + 3600
        os.utime(fuentes / "base_mwt.json", (futuro, futuro))
        sello = sellar.construir_sello(datos_dir=datos, fuentes_dir=fuentes, artifact_dir=artifact)

        resultado = verificar.verificar(datos, artifact, sello)
        assert "frescura" in resultado["fallidos"]

    def test_artifact_declara_dataset_ausente(self, tmp_path):
        datos, fuentes, artifact = _fixture(tmp_path)
        sello = _sello(datos, fuentes, artifact)
        (artifact / "datasets.json").write_text(json.dumps({
            "datasets": [{"id": "x", "archivo": "ds_que_no_existe.csv"}],
        }), encoding="utf-8")

        resultado = verificar.verificar(datos, artifact, sello)
        chequeo = next(c for c in resultado["chequeos"] if c["id"] == "artifact")
        assert chequeo["ok"] is False
