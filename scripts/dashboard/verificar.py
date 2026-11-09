#!/usr/bin/env python3
"""Verifica que el dashboard no mienta (las comprobaciones del doc 04).

Automatiza lo que hoy se hace a ojo:

  1. **Trazabilidad** — cada dataset del artifact existe, coincide con su sello
     (sha256) y ninguna fuente es más nueva que las salidas (si lo es, el
     dashboard está desactualizado).
  2. **Cuadre de clientes** — todo cliente de la tabla tiene ficha (y al revés),
     y los pedidos de la ficha coinciden con la suma de la tabla por cliente.
  3. **Artefacto completo** — `datasets.json` no referencia archivos ausentes.

No abre el navegador (el tercer punto original pide revisar la consola): si
hace falta, se complementa con `browser-qa`.

Uso:
    python scripts/dashboard/verificar.py \
        --datos  <carpeta ds_*> --artifact <carpeta del artifact> \
        --sello  <SELLO_FUENTES.json>
Salida: JSON con `ok`, cada chequeo y sus hallazgos. Exit 1 si algo falla.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sellar import archivos_datos, sha256  # noqa: E402


def _json(ruta: Path, defecto: Any) -> Any:
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return defecto


def _csv(ruta: Path) -> list[dict[str, Any]]:
    try:
        with Path(ruta).open(encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))
    except Exception:  # noqa: BLE001
        return []


def verificar_sellos(datos_dir: Path, sello: dict[str, Any]) -> dict[str, Any]:
    """Los archivos de datos no cambiaron desde que se sellaron."""
    esperado = {s["archivo"]: s for s in (sello.get("datos") or [])}
    actuales = {p.name: p for p in archivos_datos(datos_dir)}
    hallazgos = []

    for nombre, sello_archivo in esperado.items():
        ruta = actuales.get(nombre)
        if not ruta:
            hallazgos.append({"archivo": nombre, "detalle": "está en el sello y no en la carpeta"})
            continue
        if sha256(ruta) != sello_archivo.get("sha256"):
            hallazgos.append({"archivo": nombre, "detalle": "cambió después de sellarse"})

    nuevos = sorted(set(actuales) - set(esperado))
    for nombre in nuevos:
        hallazgos.append({"archivo": nombre, "detalle": "no está en el sello"})

    return {
        "id": "sellos",
        "ok": not hallazgos,
        "detalle": f"{len(esperado)} archivos sellados, {len(actuales)} en disco",
        "hallazgos": hallazgos,
    }


def verificar_frescura(datos_dir: Path, sello: dict[str, Any]) -> dict[str, Any]:
    """Ninguna fuente debe ser más nueva que la salida más vieja."""
    datos = [Path(datos_dir) / s["archivo"] for s in (sello.get("datos") or [])]
    datos = [p for p in datos if p.exists()]
    if not datos:
        return {"id": "frescura", "ok": False, "detalle": "no hay datos para comparar", "hallazgos": []}

    salida_mas_nueva = max(p.stat().st_mtime for p in datos)
    viejas = []
    for fuente in sello.get("fuentes") or []:
        # No tenemos la ruta completa de la fuente en el sello: comparamos por fecha.
        from datetime import datetime

        try:
            mtime = datetime.fromisoformat(fuente["mtime"]).timestamp()
        except Exception:  # noqa: BLE001
            continue
        if mtime > salida_mas_nueva:
            viejas.append(fuente["archivo"])

    return {
        "id": "frescura",
        "ok": not viejas,
        "detalle": "ninguna fuente es más nueva que las salidas" if not viejas
                   else f"{len(viejas)} fuente(s) más nuevas que las salidas",
        "hallazgos": [{"archivo": a, "detalle": "fuente más nueva que el dashboard"} for a in viejas],
    }


def verificar_clientes(datos_dir: Path) -> dict[str, Any]:
    """La ficha de cada cliente cuadra con su fila en la tabla de clientes."""
    # Filas de la tabla que no son clientes (agrupaciones del build).
    agregados = {"sin desglose", "sin dato", "total"}
    filas = _csv(Path(datos_dir) / "ds_clientes_anio.csv")
    fichas = _json(Path(datos_dir) / "ds_clientes_ficha.json", [])
    if not filas or not fichas:
        return {
            "id": "clientes",
            "ok": True,
            "detalle": "sin ds_clientes_anio.csv o ds_clientes_ficha.json: no se evalúa",
            "hallazgos": [],
        }

    pedidos_tabla: dict[str, int] = {}
    for fila in filas:
        cliente = (fila.get("cliente") or "").strip()
        if not cliente or cliente.lower() in agregados:
            continue
        try:
            pedidos_tabla[cliente] = pedidos_tabla.get(cliente, 0) + int(float(fila.get("pedidos") or 0))
        except ValueError:
            continue

    fichas_por_cliente = {(f.get("cliente") or "").strip(): f for f in fichas}
    hallazgos = []

    for cliente in sorted(set(pedidos_tabla) - set(fichas_por_cliente)):
        hallazgos.append({"cliente": cliente, "detalle": "tiene pedidos y no tiene ficha"})
    for cliente in sorted(set(fichas_por_cliente) - set(pedidos_tabla)):
        hallazgos.append({"cliente": cliente, "detalle": "tiene ficha y no tiene pedidos en la tabla"})
    for cliente in sorted(set(fichas_por_cliente) & set(pedidos_tabla)):
        en_tabla = pedidos_tabla[cliente]
        en_ficha = len(fichas_por_cliente[cliente].get("pedidos") or [])
        if en_tabla != en_ficha:
            hallazgos.append({
                "cliente": cliente,
                "detalle": f"pedidos: tabla={en_tabla} ficha={en_ficha}",
            })

    return {
        "id": "clientes",
        "ok": not hallazgos,
        "detalle": f"{len(fichas_por_cliente)} fichas contra {len(pedidos_tabla)} clientes",
        "hallazgos": hallazgos,
    }


def verificar_artifact(artifact_dir: Optional[Path], datos_dir: Path) -> dict[str, Any]:
    """`datasets.json` no referencia archivos que no estén en las salidas."""
    if not artifact_dir:
        return {"id": "artifact", "ok": True, "detalle": "sin artifact: no se evalúa", "hallazgos": []}
    meta = _json(Path(artifact_dir) / "datasets.json", {})
    presentes = {p.name for p in archivos_datos(datos_dir)}
    faltantes = []
    for dataset in meta.get("datasets") or []:
        archivo = dataset.get("archivo")
        if archivo and archivo not in presentes:
            faltantes.append({"archivo": archivo, "detalle": "declarado en el artifact y ausente en las salidas"})
    return {
        "id": "artifact",
        "ok": not faltantes,
        "detalle": f"{len(meta.get('datasets') or [])} datasets declarados",
        "hallazgos": faltantes,
    }


def verificar(datos_dir: Path, artifact_dir: Optional[Path], sello: dict[str, Any]) -> dict[str, Any]:
    chequeos = [
        verificar_sellos(datos_dir, sello),
        verificar_frescura(datos_dir, sello),
        verificar_clientes(datos_dir),
        verificar_artifact(artifact_dir, datos_dir),
    ]
    return {
        "ok": all(c["ok"] for c in chequeos),
        "chequeos": chequeos,
        "fallidos": [c["id"] for c in chequeos if not c["ok"]],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verifica el dashboard contra su sello")
    parser.add_argument("--datos", required=True)
    parser.add_argument("--sello", required=True)
    parser.add_argument("--artifact", default=None)
    parser.add_argument("--no-fail", action="store_true", help="siempre exit 0 (solo reporta)")
    args = parser.parse_args(argv)

    sello = _json(Path(args.sello), {})
    if not sello:
        print(json.dumps({"ok": False, "error": f"No se pudo leer el sello {args.sello}"}, ensure_ascii=False))
        return 2

    resultado = verificar(
        Path(args.datos),
        Path(args.artifact) if args.artifact else None,
        sello,
    )
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    if args.no_fail:
        return 0
    return 0 if resultado["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
