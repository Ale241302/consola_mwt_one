#!/usr/bin/env python3
"""Corre el build completo del dashboard interno (paso 1 + paso 2).

Los generadores legacy escriben con la codificación del sistema; en Windows eso
rompía los CSV (`UnicodeDecodeError` al leerlos). Acá se invocan con `-X utf8`
para que la salida sea UTF-8 en cualquier máquina.

Uso:
    python scripts/dashboard/build.py

Entradas/salidas (por defecto, y configurables por entorno):
    data/dashboard/entradas   ← base_mwt, carpetas, cobro_cruce, raw/
    data/dashboard/salidas    → ds_*.csv, ds_*.json, ped.json
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

LEGACY = Path(__file__).resolve().parent / "legacy"
PASOS = ["build.py", "build2.py"]


def main() -> int:
    for paso in PASOS:
        ruta = LEGACY / paso
        print(f"==> {paso}")
        resultado = subprocess.run(
            [sys.executable, "-X", "utf8", str(ruta)],
            cwd=str(LEGACY),
        )
        if resultado.returncode != 0:
            print(f"[ERROR] {paso} terminó con {resultado.returncode}")
            return resultado.returncode
    print("==> build completo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
