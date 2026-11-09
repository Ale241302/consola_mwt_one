#!/usr/bin/env python3
"""Genera `ds_fichas.json`: la ficha y el respaldo de cada pedido.

Es el dataset que faltaba: el artifact lo declara y el build no lo producía
(el traspaso lo advirtió: "no se guardó, se armó con scripts sueltos").

Por cada pedido arma:
  · datos del pedido (ped.json): proforma, cliente, país, negocio, estado, monto
  · OC y SAP desde el nombre de la carpeta o el RESUMEN
  · carpeta (ruta relativa al árbol de ventas) y filas del LOG
  · últimas 3 anotaciones del registro con su fuente
  · cobro y evidencia desde ds_por_cobrar.csv / ds_flujo.csv

Corre con `cwd` en `data/dashboard/salidas`. Entradas por defecto:
  DASH_ENTRADAS, DASH_SALIDAS, DASH_CARPETAS_RAIZ (default `<repo>/01 Marluvas`)
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import ENTRADAS, REPO, SALIDAS  # noqa: E402

QUE_MAX = 260
ULTIMAS_N = 3


def _json(ruta, defecto):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return defecto


def _csv(ruta) -> list[dict]:
    try:
        with Path(ruta).open(encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))
    except Exception:  # noqa: BLE001
        return []


def indexar_carpetas(raiz: Path) -> dict[str, dict]:
    """proforma → {carpeta relativa, ruta del LOG} recorriendo el árbol de ventas."""
    indice: dict[str, dict] = {}
    raiz = Path(raiz)
    if not raiz.exists():
        return indice
    for log in raiz.rglob("LOG_EXPEDIENTE_*.csv"):
        proforma = log.stem.replace("LOG_EXPEDIENTE_", "", 1)
        try:
            relativa = str(log.parent.relative_to(raiz))
        except ValueError:
            relativa = log.parent.name
        indice.setdefault(proforma, {"carpeta": relativa, "log": str(log)})
    return indice


def leer_log(ruta: str | Path) -> tuple[int, list[dict]]:
    """(cantidad de filas, últimas N anotaciones) de un LOG_EXPEDIENTE."""
    filas = _csv(ruta)
    ultimas = []
    for fila in reversed(filas[-ULTIMAS_N:]):
        ultimas.append({
            "fecha": (fila.get("fecha") or "").strip(),
            "tipo": (fila.get("tipo_registro") or "").strip(),
            "que": (fila.get("que_paso") or "").strip()[:QUE_MAX],
            "resultado": (fila.get("resultado") or "").strip(),
            "fuente": (fila.get("fuente") or "").strip(),
        })
    return len(filas), ultimas


def _oc_del_nombre(nombre: str) -> str:
    m = re.search(r"\bPO\s+([A-Za-z0-9_-]+)", nombre or "")
    return m.group(1) if m else ""


def _sap_del_nombre(nombre: str) -> str:
    m = re.search(r"\bSAP\s+(\d+)", nombre or "", re.IGNORECASE)
    return m.group(1) if m else ""


def _sap_del_resumen(ruta_carpeta: Path) -> str:
    for resumen in Path(ruta_carpeta).glob("RESUMEN_*.md"):
        try:
            texto = resumen.read_text(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        m = re.search(r"^sap:\s*\"?([^\"\n]+)\"?", texto, re.MULTILINE)
        if m:
            return m.group(1).strip()
    return ""


def derivar_cobro(proforma: str, por_cobrar: list[dict], flujo: list[dict]) -> tuple[str, str]:
    """Cobro y su evidencia a partir de las salidas ya curadas."""
    for fila in por_cobrar:
        if (fila.get("proforma") or "").strip() == proforma:
            return (fila.get("situacion") or "").strip(), (fila.get("evidencia") or "").strip()
    for fila in flujo:
        if (fila.get("proforma") or "").strip() == proforma:
            fecha = (fila.get("fecha") or "").strip()
            concepto = (fila.get("concepto") or "").strip()
            return (
                f"{concepto} previsto {fecha}".strip(),
                (fila.get("supuesto") or "").strip(),
            )
    return "", ""


def construir(
    *,
    entradas: Path = ENTRADAS,
    salidas: Path = SALIDAS,
    raiz_carpetas: Path | None = None,
) -> list[dict]:
    """Arma la lista de fichas. No escribe: devuelve el dataset."""
    raiz = Path(raiz_carpetas or os.environ.get("DASH_CARPETAS_RAIZ") or REPO / "01 Marluvas")
    ped = _json(Path(salidas) / "ped.json", {})
    base = _json(Path(entradas) / "base_mwt.json", {})
    por_cobrar = _csv(Path(salidas) / "ds_por_cobrar.csv")
    flujo = _csv(Path(salidas) / "ds_flujo.csv")
    indice = indexar_carpetas(raiz)

    # Expedientes por código canónico (sin prefijo PF).
    expedientes = {}
    for exp in base.get("expedientes") or []:
        codigo = re.sub(r"^PF[ -]?", "", str(exp.get("proforma_codigo") or "").strip())
        expedientes[codigo] = exp

    fichas = []
    for proforma in sorted(ped):
        p = ped[proforma]
        carpeta_info = indice.get(proforma) or {}
        carpeta = carpeta_info.get("carpeta", "")
        nombre_carpeta = Path(carpeta).name if carpeta else ""
        exp = expedientes.get(proforma) or {}

        oc = _oc_del_nombre(nombre_carpeta)
        if not oc and exp.get("oc_codigos"):
            oc = re.sub(r"^PO\s+", "", str(exp["oc_codigos"][0]).strip())
        sap = _sap_del_nombre(nombre_carpeta)
        if not sap and carpeta_info.get("log"):
            sap = _sap_del_resumen(Path(carpeta_info["log"]).parent)

        filas_log, ultimas = (0, [])
        if carpeta_info.get("log"):
            filas_log, ultimas = leer_log(carpeta_info["log"])

        cobro, evidencia = derivar_cobro(proforma, por_cobrar, flujo)

        pares = p.get("pares")
        if pares in (None, "") and exp.get("lineas"):
            pares = sum(
                l.get("cantidad") or 0
                for l in exp["lineas"]
                if l.get("sku") != "801048"
            )

        fichas.append({
            "proforma": proforma,
            "cliente": p.get("cliente") or "",
            "pais": p.get("pais") or "",
            "negocio": p.get("negocio") or "",
            "estado": p.get("estado") or "",
            "en_mwt": p.get("en_mwt") or "no",
            "oc": oc,
            "sap": sap,
            "usd": "" if p.get("usd") in (None, "") else str(p.get("usd")),
            "usd_fuente": p.get("usd_fuente") or "sin monto",
            "pares": "" if pares in (None, "") else str(pares),
            "registro": p.get("registro") or "",
            "salida": p.get("salida") or "",
            "llegada": p.get("llegada") or "",
            "cierre": p.get("cierre") or "",
            "cobro": cobro,
            "cobro_evidencia": evidencia,
            "carpeta": carpeta,
            "filas_log": filas_log,
            "ultimas": ultimas,
        })
    return fichas


def main() -> int:
    fichas = construir()
    destino = Path(SALIDAS) / "ds_fichas.json"
    destino.write_text(json.dumps(fichas, ensure_ascii=False), encoding="utf-8")
    con_log = sum(1 for f in fichas if f["filas_log"])
    con_cobro = sum(1 for f in fichas if f["cobro"])
    print(f"fichas {len(fichas)} · con LOG {con_log} · con cobro {con_cobro}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
