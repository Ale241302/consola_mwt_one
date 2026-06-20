"""CLI de sincronización: canónico → artefactos nativos por CLI.

Uso:
    python -m harness.sync --target claude
    python -m harness.sync --all
    python -m harness.sync --target claude --dry-run

Lee ``harness/harness.config.yaml``, instancia el adapter del/los target(s)
activo(s), carga ``canonical/`` y emite los artefactos nativos. Degrada con
gracia si ``canonical/agents/`` o ``canonical/skills/`` aún no existen (los crea
la Fase 1): emite lo que haya y avisa con un warning.

Resoluciones de ruta: todo es relativo a la raíz del repo (el padre de
``harness/``). ``out_dir`` de cada target en la config se resuelve contra esa raíz.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from .adapters.base import Adapter

# Raíz del repo = padre de harness/.
_HARNESS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _HARNESS_DIR.parent
_CONFIG_PATH = _HARNESS_DIR / "harness.config.yaml"


@dataclass(slots=True)
class TargetPlan:
    """Plan de sincronización resuelto para un target."""

    name: str
    adapter_ref: str       # "modulo:Clase"
    out_dir: Path
    canonical_dir: Path
    config: dict[str, object]


def _warn(msg: str) -> None:
    print(f"[harness.sync] WARNING: {msg}", file=sys.stderr)


def _info(msg: str) -> None:
    print(f"[harness.sync] {msg}")


def _load_config(path: Path = _CONFIG_PATH) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"No se encontró la config del harness: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("harness.config.yaml no es un mapeo válido.")
    return data


def _load_adapter(adapter_ref: str, config: dict[str, object]) -> Adapter:
    """Instancia un adapter desde una referencia ``"modulo:Clase"``."""
    if ":" not in adapter_ref:
        raise ValueError(f"adapter inválido (esperado 'modulo:Clase'): {adapter_ref!r}")
    mod_name, cls_name = adapter_ref.split(":", 1)
    module = importlib.import_module(mod_name)
    cls = getattr(module, cls_name)
    if not (isinstance(cls, type) and issubclass(cls, Adapter)):
        raise TypeError(f"{adapter_ref} no es una subclase de Adapter.")
    return cls(config)


def _resolve_plans(
    cfg: dict[str, object], selected: str | None, do_all: bool
) -> list[TargetPlan]:
    targets = cfg.get("targets")
    if not isinstance(targets, dict):
        raise ValueError("harness.config.yaml: falta la sección 'targets'.")

    canonical_cfg = cfg.get("canonical")
    canonical_root = "canonical/"
    if isinstance(canonical_cfg, dict) and canonical_cfg.get("root"):
        canonical_root = str(canonical_cfg["root"])
    canonical_dir = (_HARNESS_DIR / canonical_root).resolve()

    plans: list[TargetPlan] = []
    for name, tcfg in targets.items():
        if not isinstance(tcfg, dict):
            continue
        if selected and name != selected:
            continue
        if do_all and not tcfg.get("enabled", False):
            _info(f"target '{name}' deshabilitado — se omite.")
            continue
        if not selected and not do_all:
            continue
        adapter_ref = tcfg.get("adapter")
        if not adapter_ref:
            _warn(f"target '{name}' sin 'adapter' — se omite.")
            continue
        out_dir = (_REPO_ROOT / str(tcfg.get("out_dir") or f".{name}/")).resolve()
        plans.append(
            TargetPlan(
                name=name,
                adapter_ref=str(adapter_ref),
                out_dir=out_dir,
                canonical_dir=canonical_dir,
                config=tcfg,
            )
        )

    if selected and not plans:
        raise ValueError(f"target '{selected}' no existe en harness.config.yaml.")
    return plans


def _check_canonical(canonical_dir: Path) -> None:
    """Avisa (no falla) si faltan subdirectorios opcionales de la Fase 1."""
    if not canonical_dir.is_dir():
        _warn(f"no existe canonical_dir: {canonical_dir}")
        return
    if not (canonical_dir / "AGENTS.md").is_file():
        _warn("falta canonical/AGENTS.md — las instrucciones base estarán vacías.")
    if not (canonical_dir / "agents").is_dir():
        _warn("canonical/agents/ no existe aún (Fase 1) — sin subagentes.")
    if not (canonical_dir / "skills").is_dir():
        _warn("canonical/skills/ no existe aún (Fase 1) — sin skills.")


def run_plan(plan: TargetPlan, dry_run: bool) -> list[Path]:
    """Ejecuta el sync de un target. Devuelve las rutas escritas (o que se escribirían)."""
    _info(f"=== target: {plan.name} ===")
    _check_canonical(plan.canonical_dir)
    adapter = _load_adapter(plan.adapter_ref, plan.config)
    spec = adapter.load(plan.canonical_dir)
    _info(
        f"canónico cargado: {len(spec.agents)} agentes, "
        f"{len(spec.skills)} skills, {len(spec.tools)} servidores MCP."
    )
    if dry_run:
        _info(f"[dry-run] emitiría artefactos en: {plan.out_dir}")
        return []
    written = adapter.emit(spec, plan.out_dir)
    for p in written:
        try:
            shown = p.relative_to(_REPO_ROOT)
        except ValueError:
            shown = p
        _info(f"  escrito: {shown}")
    _info(f"OK — {len(written)} archivo(s) escrito(s).")
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m harness.sync",
        description="Sincroniza canonical/ hacia los artefactos nativos de cada CLI.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--target", help="nombre del target (p.ej. claude).")
    group.add_argument(
        "--all", action="store_true", help="sincroniza todos los targets habilitados."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="muestra qué se haría sin escribir archivos.",
    )
    args = parser.parse_args(argv)

    try:
        cfg = _load_config()
        plans = _resolve_plans(cfg, args.target, args.all)
    except (FileNotFoundError, ValueError, TypeError) as exc:
        _warn(str(exc))
        return 2

    if not plans:
        _warn("no hay targets que sincronizar.")
        return 0

    for plan in plans:
        run_plan(plan, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
