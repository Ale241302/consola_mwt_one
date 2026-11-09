"""Contratos del validador de carpeta y del espejo carpeta↔mwt.one.

Fixtures sintéticas: el traspaso real es confidencial y no se versiona. Donde
existe en disco, se prueba además contra el árbol real de 2452-2026.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness_ops import espejo, validar_carpeta as vc  # noqa: E402

PF = "2452-2026"
NOMBRE = "2452-2026 PO 504978 BL SSZ1803428"


def _faltantes(hallazgos):
    return [h for h in hallazgos if h["tipo"] == "faltante"]


def _crear_carpeta(base: Path, **overrides) -> Path:
    """Carpeta completa y correcta; cada test rompe una cosa."""
    ruta = base / NOMBRE
    ruta.mkdir(parents=True)
    (ruta / f"LOG_EXPEDIENTE_{PF}.csv").write_text(
        ",".join(vc.LOG_COLUMNAS) + "\n", encoding="utf-8"
    )
    (ruta / f"RESUMEN_{PF}.md").write_text(
        "---\nproforma: 2452-2026\noc: 504978\nsap: 269433\nmodalidad: reventa_full\n---\n\n# Expediente\n",
        encoding="utf-8",
    )
    subcarpetas = {
        "Proforma": ["PF 2452-2026.pdf"],
        "OC del Cliente": ["PO 504978.pdf"],
        "SAP": ["269433.xlsx"],
        "Factura": ["Factura TRE26-0470.pdf"],
        "Packing List Detallado": ["Packing.pdf"],
        "Guia": ["MBL SSZ1803428.pdf"],
        "Certificado de Origen": ["certificado.pdf"],
        "DUA": ["DUE.pdf"],
        "Pago de Impuestos": ["comprobante.pdf"],
    }
    subcarpetas.update(overrides)
    for nombre, archivos in subcarpetas.items():
        destino = ruta / nombre
        destino.mkdir()
        if archivos:
            (destino / archivos[0]).write_bytes(b"%PDF-1.4")
    return ruta


def _hechos(ruta: Path) -> dict:
    hechos = vc.leer_carpeta(ruta)
    log = next((a for a in hechos["raiz_archivos"] if a.startswith("LOG_EXPEDIENTE_")), None)
    if log:
        hechos["log_columnas"] = vc.leer_columnas_log(ruta / log)
    return hechos


class TestCarpetaCorrecta:
    def test_carpeta_completa_no_tiene_hallazgos(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF, "modalidad": "reventa_full"})
        assert hallazgos == []


class TestFaltantes:
    def test_sin_log_ni_resumen(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / f"LOG_EXPEDIENTE_{PF}.csv").unlink()
        (ruta / f"RESUMEN_{PF}.md").unlink()
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        detalle = " ".join(h["detalle"] for h in _faltantes(hallazgos))
        assert "LOG_EXPEDIENTE" in detalle
        assert "RESUMEN" in detalle

    def test_falta_guia(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        import shutil
        shutil.rmtree(ruta / "Guia")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("Guia" in h["detalle"] for h in _faltantes(hallazgos))

    def test_reventa_exige_dua(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        import shutil
        shutil.rmtree(ruta / "DUA")
        con_modalidad = vc.validar(_hechos(ruta), {"proforma": PF, "modalidad": "reventa_full"})
        sin_modalidad = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("DUA" in h["detalle"] for h in _faltantes(con_modalidad))
        assert not any("DUA" in h["detalle"] for h in _faltantes(sin_modalidad))

    def test_cliente_sin_oc_no_la_exige(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        import shutil
        shutil.rmtree(ruta / "OC del Cliente")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF, "cliente": "UMMIE"})
        assert not any("OC del Cliente" in h["detalle"] for h in _faltantes(hallazgos))


class TestEstructura:
    def test_subcarpeta_no_estandar_sugiere_renombre(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / "Packing List").mkdir()
        (ruta / "Packing List" / "x.pdf").write_bytes(b"x")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        sugerencias = " ".join(h["sugerencia"] for h in hallazgos)
        assert "Packing List Detallado" in sugerencias

    def test_anidacion_no_permitida(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / "Guia" / "Fotos").mkdir()
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("Anidación no permitida" in h["detalle"] for h in hallazgos)

    def test_archivo_suelto_en_la_raiz(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / "nota.txt").write_text("x", encoding="utf-8")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("Archivo suelto" in h["detalle"] for h in hallazgos)

    def test_nombre_sin_patron(self, tmp_path):
        ruta = tmp_path / "SONDEL 2452"
        ruta.mkdir()
        (ruta / f"LOG_EXPEDIENTE_{PF}.csv").write_text(
            ",".join(vc.LOG_COLUMNAS) + "\n", encoding="utf-8")
        (ruta / f"RESUMEN_{PF}.md").write_text("---\n---\n", encoding="utf-8")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("nombre no sigue" in h["detalle"] for h in hallazgos)

    def test_nombre_sin_oc_avisa(self, tmp_path):
        ruta = tmp_path / "2452-2026"
        ruta.mkdir()
        (ruta / f"LOG_EXPEDIENTE_{PF}.csv").write_text(
            ",".join(vc.LOG_COLUMNAS) + "\n", encoding="utf-8")
        (ruta / f"RESUMEN_{PF}.md").write_text("---\n---\n", encoding="utf-8")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("no incluye la OC" in h["detalle"] for h in hallazgos)


class TestLog:
    def test_columnas_incorrectas(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / f"LOG_EXPEDIENTE_{PF}.csv").write_text("a,b,c\n", encoding="utf-8")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any("18 columnas" in h["detalle"] for h in hallazgos)


class TestVersiones:
    def test_hash_en_la_vigente(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / "Guia" / "DRAFT BL (03011e90).PDF").write_bytes(b"x")
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        assert any(h["tipo"] == "version_vigente" for h in hallazgos)


class TestCola:
    def test_filas_con_el_esquema_real(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        (ruta / f"LOG_EXPEDIENTE_{PF}.csv").unlink()
        hallazgos = vc.validar(_hechos(ruta), {"proforma": PF})
        filas = vc.a_cola(hallazgos, proforma=PF, carpeta=NOMBRE, fecha="2026-11-09")
        assert filas
        assert set(filas[0]) == set(vc.COLA_COLUMNAS)
        assert filas[0]["id"] == f"INC-{PF}-2026-11-09-01"
        assert filas[0]["estado"] == "abierto"
        assert filas[0]["origen"] == "validar_carpeta"


class TestParserArbol:
    def test_reconstruye_desde_el_listado(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        lineas = ["Carpeta: OneDrive\\x\\" + NOMBRE]
        for archivo in sorted(p.name for p in ruta.iterdir() if p.is_file()):
            lineas.append(f"\\{archivo}  (10 bytes)")
        for directorio in sorted(p for p in ruta.iterdir() if p.is_dir()):
            lineas.append(f"[dir] \\{directorio.name}")
            for archivo in sorted(p.name for p in directorio.iterdir()):
                lineas.append(f"\\{directorio.name}\\{archivo}  (10 bytes)")

        hechos = vc.parsear_arbol("\n".join(lineas))
        assert hechos["nombre"] == NOMBRE
        assert f"LOG_EXPEDIENTE_{PF}.csv" in hechos["raiz_archivos"]
        assert "Proforma" in hechos["subcarpetas"]
        hallazgos = vc.validar(hechos, {"proforma": PF})
        assert [h for h in hallazgos if h["tipo"] == "faltante"] == []


class TestEspejo:
    def test_iguales_no_dan_diferencias(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        carpeta = espejo.datos_carpeta(ruta, PF)
        mwt = {"proforma": "2452-2026", "oc": "504978", "sap": "269433",
               "documentos": ["PROFORMA", "FACTURA", "GUIA", "PACKING"]}
        diferencias = espejo.comparar(carpeta, mwt)
        # la carpeta tiene más documentos que mwt: eso sí es una diferencia
        assert all(d["campo"] == "documentos" for d in diferencias)

    def test_detecta_oc_distinta(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        carpeta = espejo.datos_carpeta(ruta, PF)
        diferencias = espejo.comparar(carpeta, {"proforma": "2452-2026", "oc": "999999"})
        assert any(d["campo"] == "oc" for d in diferencias)

    def test_detecta_sap_solo_en_mwt(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        carpeta = espejo.datos_carpeta(ruta, PF)
        diferencia = [d for d in espejo.comparar(carpeta, {"sap": "275155"}) if d["campo"] == "sap"]
        assert diferencia and "mwt.one" in diferencia[0]["detalle"]

    def test_documento_solo_en_carpeta(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        carpeta = espejo.datos_carpeta(ruta, PF)
        diferencias = espejo.comparar(carpeta, {"documentos": []})
        assert any("carpeta y no figura" in d["detalle"] for d in diferencias)

    def test_lee_el_resumen_para_sap(self, tmp_path):
        ruta = _crear_carpeta(tmp_path)
        datos = espejo.datos_carpeta(ruta, PF)
        assert datos["sap"] == "269433"
        assert datos["oc"] == "504978"


# ─────────────────────────────────────────────────────────────────────
# Contra el árbol real del traspaso (solo si está en disco)
# ─────────────────────────────────────────────────────────────────────
RUTA_ARBOL = (
    Path(__file__).resolve().parents[2]
    / "traspaso_harness_2026-11-09"
    / "05_muestras"
    / "arbol_2452-2026.txt"
)


@pytest.mark.skipif(not RUTA_ARBOL.exists(), reason="traspaso no presente")
class TestArbolReal:
    def test_2452_no_tiene_faltantes_y_si_un_hash_en_la_vigente(self):
        hechos = vc.parsear_arbol(RUTA_ARBOL.read_text(encoding="utf-8"))
        hallazgos = vc.validar(hechos, {"proforma": "2452-2026", "modalidad": "reventa_full"})
        assert [h for h in hallazgos if h["tipo"] == "faltante"] == []
        assert any(h["tipo"] == "version_vigente" for h in hallazgos)
