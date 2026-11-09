#!/usr/bin/env python3
"""Sella las fuentes y las salidas del dashboard (foto fija con fecha y hash).

El dashboard interno se regenera a mano y vive como "foto fija". Si alguien
mira un número viejo, el dashboard miente sin avisar. Este script deja un
`SELLO_FUENTES.json` con la fecha y el sha256 de cada fuente y de cada dataset,
para que `verificar.py` pueda decir si lo que se ve es lo que dicen los datos.

Uso:
    python scripts/dashboard/sellar.py \
        --datos  <carpeta de salidas ds_*.csv/json> \
        --fuentes <carpeta de entradas> \
        --artifact <datasets.json del artifact> \
        --salida  <carpeta>/SELLO_FUENTES.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def sha256(ruta: Path) -> str:
    digest = hashlib.sha256()
    with ruta.open("rb") as fh:
        for bloque in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(bloque)
    return digest.hexdigest()


def sello_archivo(ruta: Path) -> dict[str, Any]:
    stat = ruta.stat()
    return {
        "archivo": ruta.name,
        "bytes": stat.st_size,
        "sha256": sha256(ruta),
        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
    }


def sellar_carpeta(rutas: Iterable[Path]) -> list[dict[str, Any]]:
    """Sello de cada archivo, ordenado por nombre (ignora carpetas y ocultos)."""
    sellos = []
    for ruta in sorted(Path(p) for p in rutas):
        if ruta.is_file() and not ruta.name.startswith("."):
            sellos.append(sello_archivo(ruta))
    return sellos


def archivos_datos(datos_dir: Path) -> list[Path]:
    return [
        p for p in Path(datos_dir).iterdir()
        if p.is_file() and not p.name.startswith(".") and p.name != "SELLO_FUENTES.json"
    ]


def archivos_fuentes(fuentes_dir: Path) -> list[Path]:
    """Incluye subcarpetas (raw/): el build lee de ahí también."""
    base = Path(fuentes_dir)
    if not base.exists():
        return []
    return [p for p in base.rglob("*") if p.is_file() and not p.name.startswith(".")]


def construir_sello(
    *,
    datos_dir: Path,
    fuentes_dir: Path,
    artifact_dir: Path | None = None,
) -> dict[str, Any]:
    corte = None
    datasets = []
    if artifact_dir:
        ruta_datasets = Path(artifact_dir) / "datasets.json"
        if ruta_datasets.exists():
            meta = json.loads(ruta_datasets.read_text(encoding="utf-8"))
            corte = meta.get("corte")
            datasets = [d.get("archivo") for d in (meta.get("datasets") or []) if d.get("archivo")]

    sello_datos = sellar_carpeta(archivos_datos(datos_dir))
    presentes = {s["archivo"] for s in sello_datos}

    return {
        "generado_en": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "corte_declarado": corte,
        "datos": sello_datos,
        "fuentes": sellar_carpeta(archivos_fuentes(fuentes_dir)),
        "datasets_del_artifact": datasets,
        "datasets_faltantes": [d for d in datasets if d not in presentes],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sella fuentes y salidas del dashboard")
    parser.add_argument("--datos", required=True, help="carpeta con ds_*.csv / ds_*.json")
    parser.add_argument("--fuentes", required=True, help="carpeta de entradas del build")
    parser.add_argument("--artifact", default=None, help="carpeta del artifact con datasets.json")
    parser.add_argument("--salida", required=True, help="ruta del SELLO_FUENTES.json")
    args = parser.parse_args(argv)

    sello = construir_sello(
        datos_dir=Path(args.datos),
        fuentes_dir=Path(args.fuentes),
        artifact_dir=Path(args.artifact) if args.artifact else None,
    )
    destino = Path(args.salida)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(sello, ensure_ascii=False, indent=1), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "salida": str(destino),
        "datos": len(sello["datos"]),
        "fuentes": len(sello["fuentes"]),
        "datasets_faltantes": sello["datasets_faltantes"],
    }, ensure_ascii=False, indent=2))
    return 0 if not sello["datasets_faltantes"] else 1


if __name__ == "__main__":
    sys.exit(main())
