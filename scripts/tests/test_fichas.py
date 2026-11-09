"""Contratos de ds_fichas.json (ficha y respaldo por pedido).

Cubre lo que el dataset promete: OC y SAP, carpeta, filas del LOG, últimas
anotaciones con fuente y cobro con su evidencia.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dashboard.legacy import fichas  # noqa: E402

COLUMNAS_LOG = [
    "id_observacion", "proforma", "fecha", "tipo_registro", "quien", "que_paso",
    "por_que", "resultado", "pendiente", "fuente", "carpeta", "uid",
    "messageId", "destinatarios", "asunto", "adjuntos", "confianza", "atencion",
]


def _fixture(base: Path):
    entradas = base / "entradas"
    salidas = base / "salidas"
    raiz = base / "carpetas"
    for d in (entradas, salidas, raiz):
        d.mkdir(parents=True)

    carpeta = raiz / "GT" / "Cliente" / "2026" / "1234-2026 PO 555 SAP 777"
    carpeta.mkdir(parents=True)
    with (carpeta / "LOG_EXPEDIENTE_1234-2026.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNAS_LOG)
        writer.writeheader()
        for i in range(4):
            writer.writerow({
                "id_observacion": f"OBS-{i}", "proforma": "1234-2026",
                "fecha": f"2026-0{i+1}-01", "tipo_registro": "accion",
                "quien": "Claude", "que_paso": f"paso {i}", "por_que": "",
                "resultado": "ok", "pendiente": "", "fuente": "disco",
                "carpeta": "", "uid": "", "messageId": "", "destinatarios": "",
                "asunto": "", "adjuntos": "", "confianza": "A", "atencion": "relevante",
            })
    (carpeta / "RESUMEN_1234-2026.md").write_text(
        "---\nproforma: 1234-2026\nsap: 999\n---\n", encoding="utf-8")

    (salidas / "ped.json").write_text(json.dumps({
        "1234-2026": {
            "proforma": "1234-2026", "anio": 2026, "negocio": "reventa",
            "cliente": "Cliente", "pais": "Guatemala", "usd": 1200.5,
            "usd_fuente": "mwt.one (líneas)", "en_mwt": "sí", "estado": "en destino",
            "modo": "aéreo", "pares": None, "registro": "2026-01-02",
            "salida": "2026-01-10", "llegada": "2026-01-20", "cierre": "",
        },
    }), encoding="utf-8")
    (salidas / "ds_por_cobrar.csv").write_text(
        "proforma,negocio,cliente,situacion,monto,base,dias,evidencia,accion\n"
        "1234-2026,reventa,Cliente,Esperando pago del cliente,1200.5,FE,30,FE vence 20/02,\n",
        encoding="utf-8")
    (salidas / "ds_flujo.csv").write_text(
        "proforma,cliente,concepto,fecha,mes,usd,base,supuesto,certeza\n"
        "9999-2026,Cliente,Reventa,2026-03-01,2026-03,100,,\n",
        encoding="utf-8")
    (entradas / "base_mwt.json").write_text(json.dumps({
        "expedientes": [{
            "proforma_codigo": "1234-2026", "oc_codigos": ["PO 555"],
            "lineas": [{"sku": "A", "cantidad": 10}, {"sku": "801048", "cantidad": 99}],
        }],
    }), encoding="utf-8")
    return entradas, salidas, raiz


class TestFicha:
    def test_arma_todo_desde_carpeta_y_salidas(self, tmp_path):
        entradas, salidas, raiz = _fixture(tmp_path)
        resultado = fichas.construir(entradas=entradas, salidas=salidas, raiz_carpetas=raiz)

        assert len(resultado) == 1
        ficha = resultado[0]
        assert ficha["proforma"] == "1234-2026"
        assert ficha["oc"] == "555"
        assert ficha["sap"] == "777"          # el nombre manda sobre el RESUMEN
        assert ficha["pares"] == "10"          # excluye el SKU 801048
        assert ficha["filas_log"] == 4
        assert ficha["carpeta"].endswith("1234-2026 PO 555 SAP 777")
        assert ficha["cobro"] == "Esperando pago del cliente"
        assert ficha["cobro_evidencia"] == "FE vence 20/02"
        assert ficha["estado"] == "en destino"
        assert ficha["usd"] == "1200.5"

    def test_ultimas_tres_en_orden_inverso(self, tmp_path):
        entradas, salidas, raiz = _fixture(tmp_path)
        ficha = fichas.construir(entradas=entradas, salidas=salidas, raiz_carpetas=raiz)[0]

        assert [u["que"] for u in ficha["ultimas"]] == ["paso 3", "paso 2", "paso 1"]
        assert ficha["ultimas"][0]["fuente"] == "disco"
        assert ficha["ultimas"][0]["tipo"] == "accion"

    def test_sin_carpeta_ni_log(self, tmp_path):
        entradas, salidas, raiz = _fixture(tmp_path)
        import shutil
        shutil.rmtree(raiz / "GT")

        ficha = fichas.construir(entradas=entradas, salidas=salidas, raiz_carpetas=raiz)[0]

        assert ficha["carpeta"] == ""
        assert ficha["filas_log"] == 0
        assert ficha["ultimas"] == []
        assert ficha["oc"] == "555"           # cae al oc_codigos de mwt.one

    def test_sap_desde_el_resumen_si_no_esta_en_el_nombre(self, tmp_path):
        entradas, salidas, raiz = _fixture(tmp_path)
        vieja = raiz / "GT" / "Cliente" / "2026" / "1234-2026 PO 555 SAP 777"
        nueva = raiz / "GT" / "Cliente" / "2026" / "1234-2026 PO 555"
        vieja.rename(nueva)

        ficha = fichas.construir(entradas=entradas, salidas=salidas, raiz_carpetas=raiz)[0]

        assert ficha["sap"] == "999"

    def test_cobro_desde_flujo_cuando_no_hay_por_cobrar(self, tmp_path):
        entradas, salidas, raiz = _fixture(tmp_path)
        (salidas / "ds_por_cobrar.csv").write_text(
            "proforma,negocio,cliente,situacion,monto,base,dias,evidencia,accion\n",
            encoding="utf-8")
        (salidas / "ds_flujo.csv").write_text(
            "proforma,cliente,concepto,fecha,mes,usd,base,supuesto,certeza\n"
            "1234-2026,Cliente,Reventa,2026-03-01,2026-03,100,Banco,supuesto X,media\n",
            encoding="utf-8")

        ficha = fichas.construir(entradas=entradas, salidas=salidas, raiz_carpetas=raiz)[0]

        assert ficha["cobro"] == "Reventa previsto 2026-03-01"
        assert ficha["cobro_evidencia"] == "supuesto X"
