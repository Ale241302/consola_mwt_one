"""
Etapa 4 · Arnés de evaluación del extractor de fechas sobre documentos reales.

Corre localmente con el venv del backend:

    backend\\.venv\\Scripts\\python.exe backend\\scripts\\eval_anydoc_extraction.py \
        --root "01 Marluvas" --out "docs/planes/2026-09-11-consola-ceo-cliente/etapa4-anydoc-muestra.json"

Mide, sobre una muestra real y autorizada (carpeta 01 Marluvas):
  · cobertura de texto por tipo de archivo (¿se puede leer el binario?),
  · fechas detectadas (campo / precisión / tipo de mención),
  · tiempo por documento.

No inventa: si un adjunto no tiene texto (PDF escaneado, .xls/.doc legacy) no
emite fechas y se reporta como 'sin_texto'.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from apps.ai_hub.document_extractor import _to_text_payload  # noqa: E402
from apps.correo.extraccion import extraer_de_texto  # noqa: E402

# Cuota de muestra por extensión (determinista).
QUOTA = {".pdf": 30, ".xlsx": 20, ".xls": 10, ".docx": 8}
MAX_BYTES = 20 * 1024 * 1024
SKIP_DIRS = {"_tmp_stage", ".git", "node_modules", "__pycache__"}


def recoger(root: Path) -> dict[str, list[Path]]:
    by_ext: dict[str, list[Path]] = {e: [] for e in QUOTA}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            ext = Path(fn).suffix.lower()
            if ext in by_ext:
                by_ext[ext].append(Path(dirpath) / fn)
    rnd = random.Random(42)
    sel = {}
    for ext, quota in QUOTA.items():
        files = sorted(by_ext[ext])
        rnd.shuffle(files)
        sel[ext] = files[:quota]
    return sel


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="01 Marluvas")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        print(f"[eval] raíz no existe: {root}")
        return 2

    sel = recoger(root)
    stats = {
        "root": str(root),
        "seleccion": {e: len(v) for e, v in sel.items()},
        "por_ext": {},
        "total": {"docs": 0, "con_texto": 0, "sin_texto": 0, "errores": 0,
                   "fechas": 0, "segundos": 0.0},
        "campos": {}, "precision": {}, "tipo_mencion": {},
        "muestras": [],
    }

    for ext, files in sel.items():
        agg = {"docs": 0, "con_texto": 0, "sin_texto": 0, "errores": 0,
               "fechas": 0, "chars": 0, "segundos": 0.0}
        for fp in files:
            agg["docs"] += 1
            stats["total"]["docs"] += 1
            t0 = time.time()
            try:
                size = fp.stat().st_size
                if size > MAX_BYTES:
                    agg["errores"] += 1
                    stats["total"]["errores"] += 1
                    continue
                data = fp.read_bytes()
                text, kind, is_image = _to_text_payload(data, "", fp.name)
            except Exception as exc:  # noqa: BLE001
                agg["errores"] += 1
                stats["total"]["errores"] += 1
                stats["muestras"].append({"file": fp.name, "ext": ext, "error": str(exc)[:120]})
                continue

            dt = time.time() - t0
            agg["segundos"] += dt
            stats["total"]["segundos"] += dt
            nchars = len((text or "").strip())
            agg["chars"] += nchars
            if nchars >= 10:
                agg["con_texto"] += 1
                stats["total"]["con_texto"] += 1
            else:
                agg["sin_texto"] += 1
                stats["total"]["sin_texto"] += 1
                continue

            items = extraer_de_texto(text)
            agg["fechas"] += len(items)
            stats["total"]["fechas"] += len(items)
            for it in items:
                stats["campos"][it["campo"]] = stats["campos"].get(it["campo"], 0) + 1
                stats["precision"][it["precision"]] = stats["precision"].get(it["precision"], 0) + 1
                tm = it.get("tipo_mencion", "CONFIRMACION")
                stats["tipo_mencion"][tm] = stats["tipo_mencion"].get(tm, 0) + 1
            if items and len(stats["muestras"]) < 60:
                stats["muestras"].append({
                    "file": fp.name, "ext": ext, "kind": kind, "chars": nchars,
                    "fechas": [{"campo": i["campo"], "valor_fecha": i["valor_fecha"],
                                "precision": i["precision"], "tipo": i.get("tipo_mencion")}
                               for i in items[:8]],
                    "raw": (it.get("valor_raw") or "")[:160] if items else "",
                })
        stats["por_ext"][ext] = agg

    print(json.dumps({k: v for k, v in stats.items() if k != "muestras"},
                     ensure_ascii=False, indent=2))
    if args.out:
        outp = Path(args.out)
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[eval] escrito {outp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
