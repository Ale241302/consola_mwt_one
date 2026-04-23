#!/usr/bin/env python3
"""
=====================================================================
MWT.ONE · run_mwt_tests.py — Master Test Runner
Agente responsable: [AG-06-QA]

¿QUÉ ES?
========
Wrapper sobre `pytest` que:

  1. Configura DJANGO_SETTINGS_MODULE si no está exportado.
  2. Permite filtrar por módulo con la flag `--modulo expedientes`
     (mapea a los markers definidos en pytest.ini).
  3. Permite saltar archivos pesados con `--solo-smoke`.
  4. Imprime un BANNER inicial con los módulos seleccionados, la
     versión de Python, Django y DRF detectadas, para que el log
     de CI tenga contexto auditable.
  5. Devuelve el exit-code real de pytest para que CI pueda fallar.

USO TÍPICO
==========
    # Suite completa
    python run_mwt_tests.py

    # Solo un módulo
    python run_mwt_tests.py --modulo productos
    python run_mwt_tests.py --modulo expedientes

    # Smoke tests (rápidos)
    python run_mwt_tests.py --solo-smoke

    # Pasar flags directos a pytest
    python run_mwt_tests.py --modulo productos -- -k "soft_delete" -x

NOTA
====
Este runner NO duplica lógica de pytest — solo lo invoca con la
configuración correcta. Toda la mecánica (auto django_db, captura
de fallas, fixtures) vive en `tests/conftest.py`.
=====================================================================
"""
from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent

# Marker → archivo principal (informativo, pytest discovers todo)
MODULE_MARKERS = {
    "dashboard":      "Módulo  1 · Dashboard",
    "expedientes":    "Módulo  2 · Expedientes",
    "pipeline":       "Módulo  3 · Pipeline",
    "portal":         "Módulo  4 · Portal B2B",
    "financiero":     "Módulo  5 · Financiero",
    "transferencias": "Módulo  6 · Transferencias",
    "nodos":          "Módulo  7 · Nodos",
    "clientes":       "Módulo  8 · Clientes",
    "marcas":         "Módulo  9 · Marcas",
    "productos":      "Módulo 10 · Productos",
    "proveedores":    "Módulo 11 · Proveedores",
    "inventario":     "Módulo 12 · Inventario",
    "plantillas":     "Módulo 13 · Plantillas Email",
    "notificaciones": "Módulo 14 · Notificaciones",
    "cobros":         "Módulo 15 · Cobros",
}


def _print_banner(modulos: list[str], pytest_args: list[str]) -> None:
    """Cabecera visual antes de invocar pytest."""
    sep = "═" * 70
    print(sep)
    print("║  MWT.ONE · SUITE DE PRUEBAS AUTOMATIZADAS")
    print("║  Agente:  [AG-06-QA]")
    print(f"║  Python:  {sys.version.split()[0]}")
    try:
        import django  # noqa
        print(f"║  Django:  {django.get_version()}")
    except Exception:
        print("║  Django:  (no detectado)")
    try:
        import rest_framework  # noqa
        print(f"║  DRF:     {rest_framework.VERSION}")
    except Exception:
        print("║  DRF:     (no detectado)")

    if modulos:
        print("║  Módulos seleccionados:")
        for m in modulos:
            label = MODULE_MARKERS.get(m, m)
            print(f"║     · {label}")
    else:
        print("║  Módulos: TODOS (suite completa)")

    print(f"║  Args extra → pytest: {shlex.join(pytest_args) if pytest_args else '(ninguno)'}")
    print(sep)


def _build_pytest_cmd(modulos: list[str],
                      solo_smoke: bool,
                      pytest_args: list[str]) -> list[str]:
    """Construye la línea de comandos pytest final."""
    cmd: list[str] = [sys.executable, "-m", "pytest"]

    # Markers (-m). Si hay varios módulos y/o smoke se combinan con OR.
    expr_parts: list[str] = []
    if modulos:
        expr_parts.append(" or ".join(modulos))
    if solo_smoke:
        expr_parts.append("smoke")
    if expr_parts:
        cmd += ["-m", " or ".join(expr_parts)]

    # Path explícito a tests/ — robusto aunque se invoque desde otro cwd.
    cmd.append(str(BACKEND_DIR / "tests"))

    # Flags extra del usuario (todo lo que venga después de `--`)
    cmd += pytest_args
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Master runner de la suite de pruebas MWT.ONE.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--modulo", "-m",
        action="append",
        choices=list(MODULE_MARKERS.keys()),
        help=("Filtra por módulo (puede repetirse). "
              "Ej: --modulo productos --modulo expedientes."),
    )
    parser.add_argument(
        "--solo-smoke",
        action="store_true",
        help="Ejecuta solo los smoke tests (rápidos).",
    )
    parser.add_argument(
        "pytest_args",
        nargs=argparse.REMAINDER,
        help="Flags extra pasados directo a pytest (después de `--`).",
    )
    ns = parser.parse_args()

    modulos = ns.modulo or []
    # argparse REMAINDER deja el `--` separador como primer item; lo recortamos
    pytest_args = ns.pytest_args or []
    if pytest_args and pytest_args[0] == "--":
        pytest_args = pytest_args[1:]

    # Asegura que Django pueda importar config.settings
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    # cwd = backend/ para que pytest.ini se descubra automáticamente
    os.chdir(BACKEND_DIR)

    _print_banner(modulos, pytest_args)

    cmd = _build_pytest_cmd(modulos, ns.solo_smoke, pytest_args)
    print(f"║  Ejecutando: {shlex.join(cmd)}\n")

    try:
        result = subprocess.run(cmd, check=False)
    except FileNotFoundError as e:
        print(f"❌ No se pudo lanzar pytest: {e}", file=sys.stderr)
        return 127

    sep = "═" * 70
    print(f"\n{sep}")
    if result.returncode == 0:
        print("║  ✅  SUITE COMPLETA — sin fallas")
    else:
        print(f"║  ❌  SUITE TERMINÓ CON FALLAS (exit={result.returncode})")
        print("║  Revisá el banner '❌ FALLA EN TEST' arriba: muestra")
        print("║  endpoint + payload + status + response del request fallido.")
    print(sep)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
