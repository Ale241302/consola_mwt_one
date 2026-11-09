#!/usr/bin/env python3
"""Valida la carpeta de un expediente y emite filas para COLA_HARNESS.csv.

Reemplaza la lectura manual del agente por un contrato reproducible. Las reglas
salen de las skills `ordenar-expediente`, `expediente-carpeta` y
`expediente-reglas` (v2.3), no de criterio propio:

  · En la raíz solo `LOG_EXPEDIENTE_<proforma>.csv` y `RESUMEN_<proforma>.md`.
  · 14 subcarpetas con nombre exacto; `Anteriores\\` es la única anidación.
  · La carpeta se llama `<proforma> PO <OC> <BL o AWB>`.
  · El LOG tiene 18 columnas fijas.
  · Documentos exigidos: registro (proforma, OC, SAP) y tránsito (factura,
    packing, guía, certificado); además, por modalidad.

Uso:
    python scripts/harness_ops/validar_carpeta.py "C:\\...\\2452-2026 PO 504978 BL SSZ1803428" \
        --proforma 2452-2026 --modalidad reventa_full
    python scripts/harness_ops/validar_carpeta.py <carpeta> --proforma 2452-2026 --cola

No modifica archivos: solo lee y reporta.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

SUBCARPETAS = [
    "Proforma",
    "OC del Cliente",
    "SAP",
    "Factura",
    "Packing List Detallado",
    "Guia",
    "DUA",
    "Pago de Impuestos",
    "Certificado de Origen",
    "Seguro",
    "Liquidacion",
    "Cotizaciones",
    "Correos",
    "Otros",
]

# Nombres que se ven en carpetas viejas y deben renombrarse al estándar.
ALIAS_SUBCARPETA = {
    "packing list": "Packing List Detallado",
    "packing": "Packing List Detallado",
    "certificados": "Certificado de Origen",
    "navio": "Guia",
    "guía": "Guia",
    "facturas": "Factura",
    "proformas": "Proforma",
    "otros documentos": "Otros",
}

LOG_COLUMNAS = [
    "id_observacion", "proforma", "fecha", "tipo_registro", "quien", "que_paso",
    "por_que", "resultado", "pendiente", "fuente", "carpeta", "uid",
    "messageId", "destinatarios", "asunto", "adjuntos", "confianza", "atencion",
]

# Documentos por etapa/modalidad. Cada entrada es una subcarpeta que debe tener
# al menos un archivo.
EXIGIDOS = {
    "registro": ["Proforma"],
    "transito": ["Factura", "Packing List Detallado", "Guia", "Certificado de Origen"],
    "comision": [],
    "reventa_full": ["DUA", "Pago de Impuestos"],
    "inventario": ["Factura", "Guia"],
}

# Clientes que no emiten OC con número: no se exige la subcarpeta OC.
CLIENTES_SIN_OC = {"UMMIE", "COMTEK", "IMPORTACIONES", "IMPORTACIONES Y COMPRAS"}

PATRON_NOMBRE = re.compile(r"^(?P<proforma>\d{4}-\d{4})(?:\s|$)")
PATRON_OC = re.compile(r"\bPO\s+(?P<oc>[A-Za-z0-9_-]+)")

COLA_COLUMNAS = [
    "id", "fecha", "proforma", "carpeta", "archivo", "tipo", "detalle",
    "origen", "estado", "resuelto_el", "resolucion",
]


def parsear_arbol(texto: str) -> dict[str, Any]:
    """Reconstruye `hechos` desde una salida tipo `tree` (la de 05_muestras).

    Permite validar una carpeta sin tenerla montada: alcanza con el listado.
    """
    raiz_archivos: list[str] = []
    raiz_dirs: list[str] = []
    subcarpetas: dict[str, dict[str, Any]] = {}
    nombre = ""

    for linea in texto.splitlines():
        limpia = linea.rstrip()
        if limpia.lower().startswith("carpeta:"):
            ruta = limpia.split(":", 1)[1].strip()
            nombre = ruta.replace("/", "\\").split("\\")[-1].strip()
            continue
        if limpia.startswith("[dir] "):
            directorio = limpia[6:].strip().strip("\\")
            partes = [p for p in directorio.split("\\") if p]
            if not partes:
                continue
            if len(partes) == 1:
                raiz_dirs.append(partes[0])
                subcarpetas.setdefault(partes[0], {"files": [], "dirs": []})
            else:
                subcarpetas.setdefault(partes[0], {"files": [], "dirs": []})
                if partes[1] not in subcarpetas[partes[0]]["dirs"]:
                    subcarpetas[partes[0]]["dirs"].append(partes[1])
            continue
        if not limpia.startswith("\\"):
            continue
        sin_peso = re.sub(r"\s+\(\d+ bytes\)\s*$", "", limpia.strip())
        partes = [p for p in sin_peso.strip("\\").split("\\") if p]
        if len(partes) == 1:
            raiz_archivos.append(partes[0])
        elif len(partes) >= 2:
            subcarpetas.setdefault(partes[0], {"files": [], "dirs": []})
            if len(partes) == 2:
                subcarpetas[partes[0]]["files"].append(partes[1])
            else:
                if partes[1] not in subcarpetas[partes[0]]["dirs"]:
                    subcarpetas[partes[0]]["dirs"].append(partes[1])

    return {
        "ruta": nombre,
        "nombre": nombre,
        "raiz_archivos": raiz_archivos,
        "raiz_dirs": raiz_dirs,
        "subcarpetas": subcarpetas,
    }


def leer_carpeta(ruta: Path) -> dict[str, Any]:
    """Foto de la carpeta: raíz y un nivel de subcarpetas con sus archivos."""
    ruta = Path(ruta)
    raiz_archivos: list[str] = []
    raiz_dirs: list[str] = []
    subcarpetas: dict[str, dict[str, Any]] = {}

    for hijo in sorted(ruta.iterdir()):
        if hijo.is_dir():
            raiz_dirs.append(hijo.name)
            archivos = []
            subdirs = []
            for nieto in sorted(hijo.iterdir()):
                if nieto.is_dir():
                    subdirs.append(nieto.name)
                else:
                    archivos.append(nieto.name)
            subcarpetas[hijo.name] = {"files": archivos, "dirs": subdirs}
        else:
            raiz_archivos.append(hijo.name)

    return {
        "ruta": str(ruta),
        "nombre": ruta.name,
        "raiz_archivos": raiz_archivos,
        "raiz_dirs": raiz_dirs,
        "subcarpetas": subcarpetas,
    }


def extraer_oc(nombre: str) -> Optional[str]:
    """OC del nombre de la carpeta (`PO <oc>`), o None."""
    match = PATRON_OC.search(nombre or "")
    return match.group("oc") if match else None


def _hallazgo(tipo: str, detalle: str, *, archivo: str = "", sugerencia: str = "",
              severidad: str = "media") -> dict[str, Any]:
    return {
        "tipo": tipo,
        "detalle": detalle,
        "archivo": archivo,
        "sugerencia": sugerencia,
        "severidad": severidad,
    }


def validar(hechos: dict[str, Any], meta: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Aplica el contrato de carpeta. `meta`: proforma, modalidad, cliente."""
    meta = meta or {}
    proforma = str(meta.get("proforma") or "").strip()
    modalidad = (meta.get("modalidad") or "").strip().lower()
    cliente = (meta.get("cliente") or "").upper()
    hallazgos: list[dict[str, Any]] = []

    # 1 · archivos de control en la raíz
    if proforma:
        log_ok = f"LOG_EXPEDIENTE_{proforma}.csv" in hechos["raiz_archivos"]
        resumen_ok = f"RESUMEN_{proforma}.md" in hechos["raiz_archivos"]
        if not log_ok:
            hallazgos.append(_hallazgo(
                "faltante", f"Falta LOG_EXPEDIENTE_{proforma}.csv en la raíz",
                sugerencia="Crear el registro del expediente", severidad="alta"))
        if not resumen_ok:
            hallazgos.append(_hallazgo(
                "faltante", f"Falta RESUMEN_{proforma}.md en la raíz",
                sugerencia="Crear el resumen legible del expediente", severidad="alta"))

        for archivo in hechos["raiz_archivos"]:
            if archivo.lower().endswith((".csv", ".md")) and (
                archivo.startswith("LOG_") or archivo.startswith("RESUMEN_")
            ):
                continue
            hallazgos.append(_hallazgo(
                "carpeta", f"Archivo suelto en la raíz: {archivo}",
                archivo=archivo,
                sugerencia="Moverlo a su subcarpeta; la raíz solo lleva LOG y RESUMEN",
                severidad="baja"))

    # 2 · nombre de la carpeta
    partes = PATRON_NOMBRE.match(hechos["nombre"].strip())
    if not partes:
        hallazgos.append(_hallazgo(
            "carpeta", f"El nombre no sigue '<proforma> PO <OC> <BL o AWB>': {hechos['nombre']}",
            sugerencia="Renombrar con el patrón del documento", severidad="media"))
    elif proforma and partes.group("proforma") != proforma:
        hallazgos.append(_hallazgo(
            "carpeta", f"El nombre empieza con {partes.group('proforma')} y se validó {proforma}",
            sugerencia="Revisar de qué expediente es la carpeta", severidad="alta"))
    elif not extraer_oc(hechos["nombre"]):
        hallazgos.append(_hallazgo(
            "carpeta", "El nombre no incluye la OC (token 'PO')",
            sugerencia="Agregar 'PO <oc>' cuando aparezca la orden", severidad="baja"))

    # 3 · subcarpetas
    for nombre in hechos["raiz_dirs"]:
        if nombre not in SUBCARPETAS:
            destino = ALIAS_SUBCARPETA.get(nombre.strip().lower())
            hallazgos.append(_hallazgo(
                "carpeta",
                f"Subcarpeta no estándar: {nombre}" + (f" → {destino}" if destino else ""),
                archivo=nombre,
                sugerencia=f"Renombrar a {destino}" if destino else "Unificar con la lista estándar",
                severidad="media"))
        for sub in hechos["subcarpetas"].get(nombre, {}).get("dirs", []):
            if sub != "Anteriores":
                hallazgos.append(_hallazgo(
                    "carpeta", f"Anidación no permitida: {nombre}\\{sub}",
                    archivo=f"{nombre}\\{sub}",
                    sugerencia="Solo se permite 'Anteriores\\' dentro de una subcarpeta",
                    severidad="media"))
        if nombre == "Otros":
            continue

    # 4 · documentos exigidos
    exigidos = list(EXIGIDOS.get("registro", [])) + list(EXIGIDOS.get("transito", []))
    if modalidad:
        exigidos += EXIGIDOS.get(modalidad, [])
    if cliente in CLIENTES_SIN_OC:
        exigidos = [c for c in exigidos if c != "OC del Cliente"]
    else:
        exigidos.append("OC del Cliente")

    for requerida in dict.fromkeys(exigidos):
        contenido = hechos["subcarpetas"].get(requerida, {}).get("files", [])
        if not contenido:
            hallazgos.append(_hallazgo(
                "faltante", f"No hay documentos en '{requerida}'",
                archivo=requerida,
                sugerencia="Buscar en Correos o en la carpeta del padre si es conjunto",
                severidad="alta" if requerida in ("Proforma", "Factura", "Guia") else "media"))

    # 5 · versiones
    for nombre, contenido in hechos["subcarpetas"].items():
        if nombre == "Otros":
            continue
        for archivo in contenido.get("files", []):
            if re.search(r"\([0-9a-f]{8}\)", archivo, re.IGNORECASE):
                hallazgos.append(_hallazgo(
                    "version_vigente",
                    f"La versión vigente conserva el sufijo de hash: {nombre}\\{archivo}",
                    archivo=f"{nombre}\\{archivo}",
                    sugerencia="Dejar el nombre limpio en la subcarpeta; la anterior va a 'Anteriores' con su fecha",
                    severidad="baja"))

    # 6 · LOG con encabezado correcto
    log = next((a for a in hechos["raiz_archivos"] if a.startswith("LOG_EXPEDIENTE_")), None)
    if log and hechos.get("log_columnas") is not None:
        columnas = list(hechos["log_columnas"])
        if columnas != LOG_COLUMNAS:
            faltan = [c for c in LOG_COLUMNAS if c not in columnas]
            sobran = [c for c in columnas if c not in LOG_COLUMNAS]
            hallazgos.append(_hallazgo(
                "carpeta", f"El LOG no tiene las 18 columnas del contrato"
                           f"{f'; faltan {faltan}' if faltan else ''}"
                           f"{f'; sobran {sobran}' if sobran else ''}",
                archivo=log,
                sugerencia="Usar el encabezado canónico del LOG",
                severidad="alta"))

    return hallazgos


def leer_columnas_log(ruta_log: Path) -> Optional[list[str]]:
    """Encabezado del LOG, o None si no se puede leer."""
    try:
        with Path(ruta_log).open(encoding="utf-8-sig", newline="") as fh:
            return next(csv.reader(fh), None)
    except Exception:  # noqa: BLE001
        return None


def a_cola(
    hallazgos: Iterable[dict[str, Any]],
    *,
    proforma: str,
    carpeta: str,
    fecha: str,
) -> list[dict[str, str]]:
    """Convierte hallazgos en filas de COLA_HARNESS.csv (tipo y columnas reales)."""
    filas = []
    for numero, hallazgo in enumerate(hallazgos, start=1):
        filas.append({
            "id": f"INC-{proforma}-{fecha}-{numero:02d}",
            "fecha": fecha,
            "proforma": proforma,
            "carpeta": carpeta,
            "archivo": hallazgo.get("archivo", ""),
            "tipo": hallazgo.get("tipo", "carpeta"),
            "detalle": hallazgo.get("detalle", ""),
            "origen": "validar_carpeta",
            "estado": "abierto",
            "resuelto_el": "",
            "resolucion": "",
        })
    return filas


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Valida la carpeta de un expediente")
    parser.add_argument("carpeta")
    parser.add_argument("--proforma", required=True)
    parser.add_argument("--modalidad", choices=sorted(EXIGIDOS), default=None)
    parser.add_argument("--cliente", default="")
    parser.add_argument("--fecha", default="", help="fecha para el id de la cola (YYYY-MM-DD)")
    parser.add_argument("--cola", action="store_true", help="emitir filas de COLA_HARNESS.csv")
    args = parser.parse_args(argv)

    ruta = Path(args.carpeta)
    if not ruta.is_dir():
        print(json.dumps({"ok": False, "error": f"No existe la carpeta {ruta}"}, ensure_ascii=False))
        return 2

    hechos = leer_carpeta(ruta)
    log = next((a for a in hechos["raiz_archivos"] if a.startswith("LOG_EXPEDIENTE_")), None)
    if log:
        hechos["log_columnas"] = leer_columnas_log(ruta / log)

    hallazgos = validar(hechos, {
        "proforma": args.proforma,
        "modalidad": args.modalidad,
        "cliente": args.cliente,
    })

    if args.cola:
        filas = a_cola(hallazgos, proforma=args.proforma, carpeta=ruta.name,
                       fecha=args.fecha)
        salida = sys.stdout
        writer = csv.DictWriter(salida, fieldnames=COLA_COLUMNAS)
        writer.writeheader()
        writer.writerows(filas)
        return 0

    print(json.dumps({
        "ok": not hallazgos,
        "carpeta": str(ruta),
        "proforma": args.proforma,
        "hallazgos": hallazgos,
        "total": len(hallazgos),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
