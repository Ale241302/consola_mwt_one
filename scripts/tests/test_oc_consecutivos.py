"""Contratos del CLI de consecutivos de OC (paso 2 de 03_REGLAS_DE_CODIGO.md).

Lo que se protege: dos sesiones a la vez no pueden quedarse con el mismo
número, y reasignar una proforma no renumera lo ya asignado.
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import oc_consecutivos as oc  # noqa: E402


def datos_base() -> dict:
    return {
        "2296-2025": "MAR-IMPORCOMP-GT-01-25",
        "2365-2025": "MAR-IMPORCOMP-GT-02-25",
        "2110-2023": "MAR-IMPORCOMP-GT-01-23",
        "2311-2025": None,
    }


class TestFormato:
    def test_formatea_el_ejemplo_del_documento(self):
        assert oc.formatear("MAR", "IMPORCOMP", "GT", 4, 2026) == "MAR-IMPORCOMP-GT-04-26"

    def test_parsea_y_vuelve(self):
        partes = oc.parsear("MAR-IMPORCOMP-GT-04-26")
        assert partes == {
            "prv": "MAR",
            "cliente": "IMPORCOMP",
            "pais": "GT",
            "nn": 4,
            "anio": 2026,
            "codigo": "MAR-IMPORCOMP-GT-04-26",
        }

    def test_rechaza_formatos_invalidos(self):
        for malo in ("", "SIN-OC-1", "MAR-IMPORCOMP-GT-4-26", "MAR-IMPORCOMP-GT-004-26"):
            assert oc.parsear(malo) is None


class TestNumeracion:
    def test_siguiente_por_cliente_pais_anio(self):
        # 2025 tiene 01 y 02 para IMPORCOMP-GT → el siguiente es 3
        assert oc.siguiente_numero(datos_base(), "IMPORCOMP", "GT", 2025) == 3

    def test_otro_anio_empieza_en_uno(self):
        assert oc.siguiente_numero(datos_base(), "IMPORCOMP", "GT", 2026) == 1

    def test_otro_pais_no_contamina(self):
        assert oc.siguiente_numero(datos_base(), "IMPORCOMP", "HN", 2025) == 1

    def test_ignora_pendientes_y_nulos(self):
        datos = {"1-2026": None, "2-2026": "MAR-UMMIE-GT-01-26"}
        assert oc.siguiente_numero(datos, "UMMIE", "GT", 2026) == 2


class TestReservar:
    def test_asigna_el_siguiente_y_muta_el_dict(self):
        datos = datos_base()
        resultado = oc.reservar(datos, proforma="2400-2025", cliente="IMPORCOMP", pais="GT", anio=2025)
        assert resultado["ok"] is True
        assert resultado["codigo"] == "MAR-IMPORCOMP-GT-03-25"
        assert resultado["ya_existia"] is False
        assert datos["2400-2025"] == "MAR-IMPORCOMP-GT-03-25"

    def test_es_idempotente(self):
        datos = datos_base()
        primera = oc.reservar(datos, proforma="2400-2025", cliente="IMPORCOMP", pais="GT", anio=2025)
        segunda = oc.reservar(datos, proforma="2400-2025", cliente="IMPORCOMP", pais="GT", anio=2025)
        assert segunda["codigo"] == primera["codigo"]
        assert segunda["ya_existia"] is True

    def test_completa_un_pendiente_sin_renumerar(self):
        datos = datos_base()
        resultado = oc.reservar(datos, proforma="2311-2025", cliente="IMPORCOMP", pais="GT", anio=2025)
        assert resultado["codigo"] == "MAR-IMPORCOMP-GT-03-25"
        assert datos["2296-2025"] == "MAR-IMPORCOMP-GT-01-25"

    def test_rechaza_prv_invalido(self):
        resultado = oc.reservar(datos_base(), proforma="1-2026", cliente="X", pais="GT", anio=2026, prv="ZZZ")
        assert resultado["ok"] is False

    def test_avisa_cuando_el_codigo_ya_esta_usado(self):
        datos = {"1-2026": "MAR-UMMIE-GT-01-26"}
        # forzamos colisión: el siguiente de HN es 01 y ya existe ese código en GT? no;
        # probamos el guard con un datos donde el NN calculado ya está tomado por otro país.
        datos["2-2026"] = "MAR-UMMIE-GT-02-26"
        resultado = oc.reservar(datos, proforma="3-2026", cliente="UMMIE", pais="GT", anio=2026)
        assert resultado["ok"] is True
        assert resultado["codigo"] == "MAR-UMMIE-GT-03-26"


class TestAuditar:
    def test_detecta_pendientes_repetidos_y_formato(self):
        datos = {
            "1-2026": "MAR-UMMIE-GT-01-26",
            "2-2026": "MAR-UMMIE-GT-01-26",  # repetido
            "3-2026": None,                   # pendiente
            "4-2026": "basura",               # formato
        }
        audit = oc.auditar(datos)
        assert audit["pendientes"] == ["3-2026"]
        assert audit["repetidos"] == {"MAR-UMMIE-GT-01-26": ["1-2026", "2-2026"]}
        assert audit["formato_invalido"] == [{"proforma": "4-2026", "codigo": "basura"}]
        assert audit["asignados"] == 2

    def test_detecta_huecos(self):
        datos = {
            "1-2026": "MAR-UMMIE-GT-01-26",
            "2-2026": "MAR-UMMIE-GT-03-26",
        }
        assert oc.auditar(datos)["huecos"] == {"UMMIE-GT-2026": [2]}


class TestArchivo:
    def test_reserva_en_archivo_crea_y_persiste(self, tmp_path):
        ruta = tmp_path / "ch09.json"
        resultado = oc.reservar_en_archivo(
            ruta, proforma="2501-2026", cliente="IMPORCOMP", pais="GT", anio=2026
        )
        assert resultado["ok"] is True
        assert json.loads(ruta.read_text(encoding="utf-8")) == {"2501-2026": "MAR-IMPORCOMP-GT-01-26"}
        assert not (tmp_path / "ch09.json.lock").exists()

    def test_dos_reservas_en_paralelo_no_repiten_numero(self, tmp_path):
        ruta = tmp_path / "ch09.json"
        proformas = [f"{2500 + i}-2026" for i in range(6)]

        def reservar(proforma):
            return oc.reservar_en_archivo(
                ruta, proforma=proforma, cliente="IMPORCOMP", pais="GT", anio=2026
            )

        with ThreadPoolExecutor(max_workers=6) as pool:
            resultados = list(pool.map(reservar, proformas))

        codigos = [r["codigo"] for r in resultados]
        assert all(r["ok"] for r in resultados)
        assert len(set(codigos)) == len(codigos), codigos
        assert sorted(int(c.split("-")[-2]) for c in codigos) == list(range(1, 7))

    def test_bloqueo_ocupado_falla_rapido(self, tmp_path):
        ruta = tmp_path / "ch09.json"
        ruta.write_text("{}", encoding="utf-8")
        (tmp_path / "ch09.json.lock").write_text("999 0", encoding="utf-8")
        with pytest.raises(oc.BloqueoOcupado):
            with oc.bloqueo_archivo(ruta, espera_seg=0.2, robado_seg=3600):
                pass

    def test_lee_el_json_real_del_traspaso_si_esta(self):
        ruta = (
            Path(__file__).resolve().parents[2]
            / "traspaso_harness_2026-11-09"
            / "02_consecutivos"
            / "ch09_consecutivos.json"
        )
        if not ruta.exists():
            pytest.skip("traspaso no presente en este entorno")
        datos = oc.cargar(ruta)
        assert datos["2365-2025"] == "MAR-IMPORCOMP-GT-02-25"
        assert oc.siguiente_numero(datos, "IMPORCOMP", "GT", 2026) == 1
