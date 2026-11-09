"""Rutas del build del dashboard (una sola fuente de verdad).

Los scripts legacy tenían rutas del entorno donde corrían
(`/home/claude/dash/raw/`, `/mnt/user-data/uploads/...`). Acá se resuelven a
carpetas del repo, configurables por entorno:

    DASH_ENTRADAS   entradas del build (default <repo>/data/dashboard/entradas)
    DASH_SALIDAS    salidas ds_*.csv/json (default <repo>/data/dashboard/salidas)
    DASH_RAW        crudos del paso 1 (default <ENTRADAS>/raw)

Los datos NO se versionan: `data/dashboard/` está en `.gitignore`.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENTRADAS = Path(os.environ.get("DASH_ENTRADAS", REPO / "data" / "dashboard" / "entradas"))
SALIDAS = Path(os.environ.get("DASH_SALIDAS", REPO / "data" / "dashboard" / "salidas"))
RAW = Path(os.environ.get("DASH_RAW", ENTRADAS / "raw"))


def preparar() -> None:
    """Crea la carpeta de salidas y trabaja desde ahí (los legacy escriben en cwd)."""
    SALIDAS.mkdir(parents=True, exist_ok=True)
    os.chdir(SALIDAS)
