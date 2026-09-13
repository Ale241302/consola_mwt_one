"""
Etapa 4 · Sondeo real de AnyDoc (firecrawl-anydoc) sobre documentos de 01 Marluvas.

Corre con un venv que tenga `firecrawl-anydoc` (no requiere Django):

    <anydoc_venv>\\Scripts\\python.exe backend\\scripts\\probe_anydoc.py \
        --root "01 Marluvas" --out "<tmp>/anydoc_probe.json" --md-dir "<tmp>/anydoc_md"

Guarda el Markdown de cada documento convertido para luego compararlo con el
extractor MWT (ver compare_anydoc_extract.py).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import time
from pathlib import Path

import anydoc

QUOTA = {".pdf": 15, ".xlsx": 10, ".xls": 8, ".docx": 5, ".doc": 5}
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
    out = {}
    for ext, q in QUOTA.items():
        files = sorted(by_ext[ext])
        rnd.shuffle(files)
        out[ext] = files[:q]
    return out


def _err_name(exc: Exception) -> str:
    for attr in ("code", "variant"):
        v = getattr(exc, attr, None)
        if v:
            return str(v)
    return type(exc).__name__


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="01 Marluvas")
    ap.add_argument("--out", required=True)
    ap.add_argument("--md-dir", required=True)
    args = ap.parse_args()

    root = Path(args.root)
    md_dir = Path(args.md_dir)
    md_dir.mkdir(parents=True, exist_ok=True)

    sel = recoger(root)
    stats = {"root": str(root), "seleccion": {e: len(v) for e, v in sel.items()},
             "por_ext": {}, "total": {"docs": 0, "ok": 0, "needs_ocr": 0, "error": 0,
                                       "ms": 0.0, "chars": 0}, "items": []}

    for ext, files in sel.items():
        agg = {"docs": 0, "ok": 0, "needs_ocr": 0, "error": 0, "ms": 0.0, "chars": 0}
        for i, fp in enumerate(files):
            agg["docs"] += 1
            stats["total"]["docs"] += 1
            rec = {"file": fp.name, "ext": ext, "size": fp.stat().st_size,
                   "path": str(fp)}
            t0 = time.time()
            try:
                md = anydoc.to_markdown(str(fp))
                dt = (time.time() - t0) * 1000
                agg["ok"] += 1; stats["total"]["ok"] += 1
                agg["ms"] += dt; stats["total"]["ms"] += dt
                agg["chars"] += len(md or ""); stats["total"]["chars"] += len(md or "")
                mdp = md_dir / f"{ext.strip('.')}_{i:02d}_{fp.stem[:40]}.md"
                mdp.write_text(md or "", encoding="utf-8")
                rec.update({"ok": True, "ms": round(dt, 1), "chars": len(md or ""),
                            "md": str(mdp), "preview": (md or "")[:400]})
            except Exception as exc:  # noqa: BLE001
                dt = (time.time() - t0) * 1000
                name = _err_name(exc)
                if name.lower().startswith("needsocr"):
                    agg["needs_ocr"] += 1; stats["total"]["needs_ocr"] += 1
                else:
                    agg["error"] += 1; stats["total"]["error"] += 1
                rec.update({"ok": False, "ms": round(dt, 1), "error": name,
                            "msg": str(exc)[:120]})
            stats["items"].append(rec)
        stats["por_ext"][ext] = agg

    Path(args.out).write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in stats.items() if k != "items"},
                     ensure_ascii=False, indent=2))
    print(f"[probe] escrito {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
