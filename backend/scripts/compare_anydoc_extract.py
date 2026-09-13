"""
Etapa 4 · Comparación de extracción de fechas: AnyDoc(Markdown) vs extractor MWT.

Corre con el venv del BACKEND (necesita Django + PyMuPDF):

    backend\\.venv\\Scripts\\python.exe backend\\scripts\\compare_anydoc_extract.py \
        --probe "<tmp>/anydoc_probe.json"

Para cada documento del sondeo AnyDoc compara, sobre el MISMO archivo:
  · MWT  = texto propio (_to_text_payload) -> extraer_de_texto
  · AnyDoc = Markdown de AnyDoc -> extraer_de_texto
Cuenta campos/fechas hallados por cada uno y qué aporta AnyDoc que MWT no ve.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from apps.ai_hub.document_extractor import _to_text_payload  # noqa: E402
from apps.correo.extraccion import extraer_de_texto  # noqa: E402


def _pares(items):
    return {(i["campo"], i.get("valor_fecha")) for i in items}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", required=True)
    args = ap.parse_args()

    probe = json.loads(Path(args.probe).read_text(encoding="utf-8"))
    res = {
        "docs": 0, "mwt_texto_ok": 0, "anydoc_md_ok": 0,
        "mwt_fechas": 0, "anydoc_fechas": 0,
        "solo_mwt": 0, "solo_anydoc": 0, "ambos": 0, "ninguno": 0,
        "ambos_sin_ocr": 0,
        "anydoc_recupera": [],   # docs donde AnyDoc ve fechas que MWT no
        "por_ext": {},
    }

    for it in probe["items"]:
        res["docs"] += 1
        ext = it["ext"]
        agg = res["por_ext"].setdefault(ext, {"docs": 0, "mwt": 0, "anydoc": 0,
                                              "solo_anydoc": 0, "needs_ocr": 0})
        agg["docs"] += 1

        if not it.get("ok"):
            if (it.get("error") or "").lower().startswith("needsocr"):
                agg["needs_ocr"] += 1
                res["ambos_sin_ocr"] += 1
            continue

        md = Path(it["md"]).read_text(encoding="utf-8")
        res["anydoc_md_ok"] += 1

        # MWT: texto propio
        mwt_items = []
        try:
            data = Path(it["path"]).read_bytes()
            text, kind, is_image = _to_text_payload(data, "", it["file"])
            # Evitar el falso texto de .xls/.doc legacy (binario decodificado).
            if it["ext"] not in (".xls", ".doc") and text:
                mwt_items = extraer_de_texto(text)
                if len((text or "").strip()) >= 10:
                    res["mwt_texto_ok"] += 1
        except Exception:  # noqa: BLE001
            pass

        any_items = extraer_de_texto(md)
        mwt_p, any_p = _pares(mwt_items), _pares(any_items)
        res["mwt_fechas"] += len(mwt_p)
        res["anydoc_fechas"] += len(any_p)
        agg["mwt"] += len(mwt_p)
        agg["anydoc"] += len(any_p)

        if mwt_p and any_p and mwt_p == any_p:
            res["ambos"] += 1
        elif mwt_p and not any_p:
            res["solo_mwt"] += 1
        elif any_p and not mwt_p:
            res["solo_anydoc"] += 1
            agg["solo_anydoc"] += 1
            res["anydoc_recupera"].append({
                "file": it["file"], "ext": ext,
                "fechas": [{"campo": c, "valor": v} for c, v in sorted(any_p)],
            })
        else:
            res["ninguno"] += 1

    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
