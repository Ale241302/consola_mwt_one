#!/usr/bin/env python3
"""Espejo carpeta ↔ mwt.one: lista solo las diferencias.

La carpeta y mwt.one deberían ser espejo (regla de oro del doc 02). En vez de
que un agente lea ambos lados y compare a ojo, este script compara los datos de
la carpeta (nombre, RESUMEN_<pf>.md y LOG) contra la respuesta de
`expediente_obtener` guardada en un JSON, y devuelve las diferencias.

Uso:
    # 1. el agente guarda la respuesta de expediente_obtener
    #    (o cualquier JSON con proforma/oc/sap/documentos)
    # 2. se compara
    python scripts/harness_ops/espejo.py "C:\\...\\2452-2026 PO 504978 BL SSZ1803428" \
        --expediente expediente.json

No llama a la API ni modifica nada. `--formato json` para uso programático.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validar_carpeta import PATRON_NOMBRE, extraer_oc, leer_carpeta  # noqa: E402

# Subcarpeta de la carpeta → tipo de documento en mwt.one.
DOC_POR_SUBCARPETA = {
    "Proforma": "PROFORMA",
    "OC del Cliente": "OC",
    "SAP": "SAP",
    "Factura": "FACTURA",
    "Packing List Detallado": "PACKING",
    "Guia": "GUIA",
    "DUA": "DUA",
    "Pago de Impuestos": "IMPUESTOS",
    "Certificado de Origen": "CERTIFICADO",
    "Seguro": "SEGURO",
    "Liquidacion": "LIQUIDACION",
    "Cotizaciones": "COTIZACION",
}


def _norm(valor: Any) -> str:
    """Normaliza referencias: mayúsculas, sin prefijos PO/OC/PF ni separadores."""
    texto = str(valor or "").strip().upper()
    texto = re.sub(r"^(PO|OC|PF)\s*", "", texto)
    return re.sub(r"[^A-Z0-9]", "", texto)


def _primero(datos: dict[str, Any], *claves: str) -> Any:
    for clave in claves:
        valor = datos.get(clave)
        if isinstance(valor, list):
            valor = valor[0] if valor else None
        if valor not in (None, ""):
            return valor
    return None


def leer_resumen(ruta: Path) -> dict[str, Any]:
    """Frontmatter del RESUMEN (`clave: valor`), sin dependencia de YAML."""
    if not ruta.exists():
        return {}
    texto = ruta.read_text(encoding="utf-8", errors="replace")
    if not texto.startswith("---"):
        return {}
    fin = texto.find("\n---", 3)
    if fin == -1:
        return {}
    datos: dict[str, Any] = {}
    for linea in texto[3:fin].splitlines():
        if ":" not in linea or linea.strip().startswith("#"):
            continue
        clave, _, valor = linea.partition(":")
        datos[clave.strip()] = valor.strip().strip('"').strip("'")
    return datos


def datos_carpeta(ruta: Path, proforma: Optional[str] = None) -> dict[str, Any]:
    """Proforma, OC, SAP y documentos que se pueden ver desde la carpeta."""
    ruta = Path(ruta)
    hechos = leer_carpeta(ruta)
    nombre = hechos["nombre"]
    partes = PATRON_NOMBRE.match(nombre.strip()) or None

    proforma = proforma or (partes.group("proforma") if partes else None)
    oc = extraer_oc(nombre)

    resumen = {}
    if proforma:
        resumen = leer_resumen(ruta / f"RESUMEN_{proforma}.md")
    if not proforma and resumen.get("proforma"):
        proforma = resumen["proforma"]
    oc = oc or resumen.get("oc")
    sap = resumen.get("sap")

    documentos = sorted(
        kind
        for subcarpeta, kind in DOC_POR_SUBCARPETA.items()
        if hechos["subcarpetas"].get(subcarpeta, {}).get("files")
    )
    return {
        "proforma": proforma,
        "oc": oc,
        "sap": sap,
        "documentos": documentos,
        "nombre": nombre,
        "modalidad": resumen.get("modalidad"),
        "embarque": resumen.get("embarque"),
    }


def datos_expediente(expediente: dict[str, Any]) -> dict[str, Any]:
    """Extrae del JSON de `expediente_obtener` lo comparable. Tolera variantes."""
    documentos = []
    for doc in expediente.get("documentos") or []:
        if isinstance(doc, dict):
            kind = doc.get("kind") or doc.get("tipo") or doc.get("tipo_documento")
            if kind:
                documentos.append(str(kind).upper())
    if not documentos:
        documentos = [str(d).upper() for d in (expediente.get("documentos_kinds") or [])]

    return {
        "proforma": _primero(expediente, "proforma", "proforma_codigos"),
        "oc": _primero(expediente, "oc", "oc_codigo", "oc_codigos"),
        "sap": _primero(expediente, "sap", "sap_codigos"),
        "documentos": sorted(set(documentos)),
        "estado": expediente.get("estado"),
    }


def comparar(carpeta: dict[str, Any], expediente: dict[str, Any]) -> list[dict[str, Any]]:
    """Diferencias entre los dos lados. Lista vacía = espejo."""
    diferencias: list[dict[str, Any]] = []

    for campo in ("proforma", "oc", "sap"):
        izq, der = _norm(carpeta.get(campo)), _norm(expediente.get(campo))
        if izq and der and izq != der:
            diferencias.append({
                "campo": campo,
                "carpeta": carpeta.get(campo),
                "mwt": expediente.get(campo),
                "detalle": f"La {campo} de la carpeta no coincide con mwt.one",
            })
        elif bool(izq) != bool(der):
            diferencias.append({
                "campo": campo,
                "carpeta": carpeta.get(campo) or "—",
                "mwt": expediente.get(campo) or "—",
                "detalle": f"La {campo} existe solo en {'la carpeta' if izq else 'mwt.one'}",
            })

    docs_carpeta = set(carpeta.get("documentos") or [])
    docs_mwt = set(expediente.get("documentos") or [])
    for kind in sorted(docs_carpeta - docs_mwt):
        diferencias.append({
            "campo": "documentos",
            "carpeta": kind,
            "mwt": "—",
            "detalle": f"{kind} está en la carpeta y no figura en mwt.one",
        })
    for kind in sorted(docs_mwt - docs_carpeta):
        diferencias.append({
            "campo": "documentos",
            "carpeta": "—",
            "mwt": kind,
            "detalle": f"{kind} figura en mwt.one y no está en la carpeta",
        })

    return diferencias


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compara carpeta vs mwt.one")
    parser.add_argument("carpeta")
    parser.add_argument("--expediente", required=True, help="JSON con la respuesta de expediente_obtener")
    parser.add_argument("--proforma", default=None)
    parser.add_argument("--formato", choices=("json", "texto"), default="json")
    args = parser.parse_args(argv)

    ruta = Path(args.carpeta)
    if not ruta.is_dir():
        print(json.dumps({"ok": False, "error": f"No existe la carpeta {ruta}"}, ensure_ascii=False))
        return 2

    with Path(args.expediente).open(encoding="utf-8") as fh:
        expediente = json.load(fh)

    carpeta = datos_carpeta(ruta, args.proforma)
    lado_mwt = datos_expediente(expediente)
    diferencias = comparar(carpeta, lado_mwt)

    if args.formato == "texto":
        if not diferencias:
            print("Espejo: no hay diferencias.")
        for diff in diferencias:
            print(f"- {diff['campo']}: carpeta={diff['carpeta']} · mwt.one={diff['mwt']} · {diff['detalle']}")
        return 0

    print(json.dumps({
        "ok": not diferencias,
        "carpeta": carpeta,
        "mwt": lado_mwt,
        "diferencias": diferencias,
        "total": len(diferencias),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
