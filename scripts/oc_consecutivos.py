#!/usr/bin/env python3
"""Reserva consecutivos de OC sin número — `ch09_consecutivos.json` como transacción.

Hoy el archivo se edita a mano y dos sesiones pueden asignar el mismo número.
Este CLI toma un bloqueo de archivo, calcula el siguiente consecutivo del
cliente/año, lo escribe de forma atómica y devuelve el código:

    MAR-IMPORCOMP-GT-04-26

Formato (POL_CODIGO_OC v1.4, `03_REGLAS_DE_CODIGO.md`):
    {PRV}-{CLIENTE}-{PAIS}-{NN}-{AA}
    PRV     MAR | TEC | BAN
    NN      consecutivo de 2 dígitos por cliente y año, en orden de proforma,
            incluidos los cancelados; no se reutiliza
    AA      año de la proforma (2 dígitos)

Uso:
    python scripts/oc_consecutivos.py reservar --proforma 2501-2026 \
        --cliente IMPORCOMP --pais GT --anio 2026
    python scripts/oc_consecutivos.py listar --cliente IMPORCOMP --anio 2026
    python scripts/oc_consecutivos.py auditar

Ruta del JSON: `--json`, o la variable `MWT_OC_CONSECUTIVOS`, o
`~/.claude-server-commander/ch09_consecutivos.json`.

No toca mwt.one ni el correo: solo el archivo de consecutivos.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

CODIGO_RE = re.compile(
    r"^(?P<prv>[A-Z]{3})-(?P<cliente>[A-Z0-9]+)-(?P<pais>[A-Z]{2})-"
    r"(?P<nn>\d{2})-(?P<aa>\d{2})$"
)
PRV_VALIDOS = {"MAR", "TEC", "BAN"}
RUTA_POR_DEFECTO = Path.home() / ".claude-server-commander" / "ch09_consecutivos.json"


# ─────────────────────────────────────────────────────────────────────
# Núcleo puro (testeable sin disco)
# ─────────────────────────────────────────────────────────────────────
def formatear(prv: str, cliente: str, pais: str, nn: int, anio: int | str) -> str:
    """Arma el código de OC con el formato de la política."""
    prv, cliente, pais = prv.upper(), cliente.upper(), pais.upper()
    aa = str(anio)[-2:]
    return f"{prv}-{cliente}-{pais}-{int(nn):02d}-{aa}"


def parsear(codigo: str) -> Optional[dict[str, Any]]:
    """Separa un código en sus partes; None si no cumple el formato."""
    match = CODIGO_RE.match((codigo or "").strip().upper())
    if not match:
        return None
    partes = match.groupdict()
    return {
        "prv": partes["prv"],
        "cliente": partes["cliente"],
        "pais": partes["pais"],
        "nn": int(partes["nn"]),
        "anio": 2000 + int(partes["aa"]),
        "codigo": (codigo or "").strip().upper(),
    }


def siguiente_numero(datos: dict[str, Any], cliente: str, pais: str, anio: int | str) -> int:
    """NN libre: máximo ya usado para ese cliente/país/año, más uno.

    Incluye los códigos de proformas canceladas (no se reutiliza el número) y
    no depende del orden del archivo.
    """
    cliente, pais, aa = cliente.upper(), pais.upper(), str(anio)[-2:]
    maximo = 0
    for codigo in datos.values():
        if not codigo:
            continue
        partes = parsear(codigo)
        if not partes:
            continue
        if (partes["cliente"], partes["pais"], f"{partes['anio']}"[-2:]) == (cliente, pais, aa):
            maximo = max(maximo, partes["nn"])
    return maximo + 1


def reservar(
    datos: dict[str, Any],
    *,
    proforma: str,
    cliente: str,
    pais: str,
    anio: int | str,
    prv: str = "MAR",
) -> dict[str, Any]:
    """Asigna el consecutivo en el dict (no escribe en disco).

    Idempotente: si la proforma ya tiene código, lo devuelve tal cual. Si el
    código existente no cumple el formato, lo reporta como conflicto en vez de
    inventar otro.
    """
    proforma = proforma.strip()
    if prv.upper() not in PRV_VALIDOS:
        return {"ok": False, "error": f"PRV inválido: {prv}. Válidos: {sorted(PRV_VALIDOS)}"}

    if proforma in datos and datos[proforma]:
        existente = str(datos[proforma])
        return {
            "ok": True,
            "codigo": existente,
            "ya_existia": True,
            "nn": (parsear(existente) or {}).get("nn"),
        }

    nn = siguiente_numero(datos, cliente, pais, anio)
    if nn > 99:
        return {"ok": False, "error": f"Consecutivo agotado para {cliente}-{pais}-{anio} (NN>99)"}
    codigo = formatear(prv, cliente, pais, nn, anio)
    if codigo in {c for c in datos.values() if c}:
        return {"ok": False, "error": f"El código {codigo} ya está asignado a otra proforma"}
    datos[proforma] = codigo
    return {"ok": True, "codigo": codigo, "ya_existia": False, "nn": nn}


def auditar(datos: dict[str, Any]) -> dict[str, Any]:
    """Busca lo que un humano debería revisar: pendientes, repetidos, formato y huecos."""
    pendientes = sorted(p for p, c in datos.items() if not c)
    por_codigo: dict[str, list[str]] = {}
    formato_invalido = []
    for proforma, codigo in datos.items():
        if not codigo:
            continue
        partes = parsear(codigo)
        if not partes:
            formato_invalido.append({"proforma": proforma, "codigo": codigo})
            continue
        por_codigo.setdefault(partes["codigo"], []).append(proforma)

    repetidos = {codigo: ps for codigo, ps in por_codigo.items() if len(ps) > 1}

    series: dict[tuple[str, str, str], list[int]] = {}
    for codigo in por_codigo:
        partes = parsear(codigo)
        if partes:
            series.setdefault(
                (partes["cliente"], partes["pais"], str(partes["anio"])), []
            ).append(partes["nn"])

    huecos = {}
    for clave, numeros in series.items():
        esperado = set(range(1, max(numeros) + 1))
        faltan = sorted(esperado - set(numeros))
        if faltan:
            huecos["-".join(clave)] = faltan

    return {
        "total_proformas": len(datos),
        "asignados": sum(1 for c in datos.values() if c and parsear(c)),
        "pendientes": pendientes,
        "repetidos": repetidos,
        "formato_invalido": formato_invalido,
        "huecos": huecos,
    }


# ─────────────────────────────────────────────────────────────────────
# IO: bloqueo, lectura y escritura atómica
# ─────────────────────────────────────────────────────────────────────
class BloqueoOcupado(RuntimeError):
    pass


class bloqueo_archivo:
    """Bloqueo exclusivo por archivo `.lock`, portable y con robo por antigüedad.

    `O_CREAT|O_EXCL` es atómico en Windows y POSIX. Si un proceso murió sin
    liberar, el bloqueo se toma cuando supera `robado_seg` (por defecto 120 s).
    """

    def __init__(self, ruta_json: Path, espera_seg: float = 10.0, robado_seg: float = 120.0):
        self.ruta_lock = Path(str(ruta_json) + ".lock")
        self.espera_seg = espera_seg
        self.robado_seg = robado_seg
        self._fd: int | None = None

    def __enter__(self):
        limite = time.monotonic() + self.espera_seg
        while True:
            try:
                self._fd = os.open(self.ruta_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self._fd, f"{os.getpid()} {time.time():.0f}".encode())
                return self
            except FileExistsError:
                if self._robar_si_viejo():
                    continue
                if time.monotonic() >= limite:
                    raise BloqueoOcupado(
                        f"Otro proceso tiene {self.ruta_lock} desde hace más de "
                        f"{self.espera_seg:.0f}s. Esperá o borrá el .lock si quedó huérfano."
                    )
                time.sleep(0.05)

    def _robar_si_viejo(self) -> bool:
        try:
            edad = time.time() - self.ruta_lock.stat().st_mtime
            if edad > self.robado_seg:
                self.ruta_lock.unlink(missing_ok=True)
                return True
        except FileNotFoundError:
            return True
        return False

    def __exit__(self, *exc):
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        self.ruta_lock.unlink(missing_ok=True)
        return False


def cargar(ruta: Path) -> dict[str, Any]:
    if not ruta.exists():
        return {}
    with ruta.open(encoding="utf-8") as fh:
        datos = json.load(fh)
    if not isinstance(datos, dict):
        raise ValueError(f"{ruta} debe ser un objeto {{proforma: codigo}}, no {type(datos).__name__}")
    return datos


def guardar_atomico(ruta: Path, datos: dict[str, Any]) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_suffix(ruta.suffix + f".tmp{os.getpid()}")
    with temporal.open("w", encoding="utf-8") as fh:
        json.dump(datos, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(temporal, ruta)


def reservar_en_archivo(ruta: Path, **kwargs) -> dict[str, Any]:
    """Reserva con bloqueo y escritura atómica. Relee dentro del bloqueo."""
    ruta = Path(ruta)
    with bloqueo_archivo(ruta):
        datos = cargar(ruta)
        resultado = reservar(datos, **kwargs)
        if resultado.get("ok"):
            guardar_atomico(ruta, datos)
        return resultado


# ─────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────
def _ruta(args) -> Path:
    return Path(args.json or os.environ.get("MWT_OC_CONSECUTIVOS") or RUTA_POR_DEFECTO)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Consecutivos de OC sin número")
    parser.add_argument("--json", help="Ruta de ch09_consecutivos.json")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_res = sub.add_parser("reservar", help="Reserva el siguiente consecutivo")
    p_res.add_argument("--proforma", required=True, help="ej. 2501-2026")
    p_res.add_argument("--cliente", required=True, help="ej. IMPORCOMP")
    p_res.add_argument("--pais", required=True, help="ISO-2, ej. GT")
    p_res.add_argument("--anio", required=True, type=int, help="año de la proforma")
    p_res.add_argument("--prv", default="MAR", help="MAR|TEC|BAN (default MAR)")

    p_list = sub.add_parser("listar", help="Lista los códigos de un cliente")
    p_list.add_argument("--cliente")
    p_list.add_argument("--anio", type=int)

    sub.add_parser("auditar", help="Pendientes, repetidos, formato y huecos")

    args = parser.parse_args(argv)
    ruta = _ruta(args)

    if args.cmd == "reservar":
        try:
            resultado = reservar_en_archivo(
                ruta,
                proforma=args.proforma,
                cliente=args.cliente,
                pais=args.pais,
                anio=args.anio,
                prv=args.prv,
            )
        except BloqueoOcupado as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 2
        print(json.dumps({**resultado, "archivo": str(ruta)}, ensure_ascii=False, indent=2))
        return 0 if resultado.get("ok") else 1

    if args.cmd == "listar":
        datos = cargar(ruta)
        filas = []
        for proforma, codigo in datos.items():
            partes = parsear(codigo) if codigo else None
            if args.cliente and (not partes or partes["cliente"] != args.cliente.upper()):
                continue
            if args.anio and (not partes or partes["anio"] != args.anio):
                continue
            filas.append({"proforma": proforma, "codigo": codigo, "nn": (partes or {}).get("nn")})
        filas.sort(key=lambda f: (f["nn"] is None, f["nn"] or 0, f["proforma"]))
        print(json.dumps(filas, ensure_ascii=False, indent=2))
        return 0

    print(json.dumps(auditar(cargar(ruta)), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
