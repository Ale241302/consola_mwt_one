"""Preflight de creación de expediente — contrato del harness.

Impide los dos errores caros de la carga histórica antes de tocar mwt.one:

  · **A4 / C7** — crear con precios que no cuadran con la proforma (el 2304
    quedó con 24.860 contra 14.044,80) o dejar una OC suelta cuando la
    creación falla después (504069).
  · **C6** — `po_number` de más de 28 caracteres útiles: mwt.one arma el
    código como `EXP-<po_number>` sobre una columna de 32, y con 29 revienta
    con HTTP 500; el reintento con el mismo token devuelve CRASHED.

Todo este módulo es **puro**: no llama a la API ni a la base. La tool que lo
usa es `expediente_preflight_creacion` en `server.py`.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

PO_MAX = 28          # "EXP-" (4) + po_number en varchar(32) = 28 útiles
TOLERANCIA = "0.01"  # centavos


def _dec(valor: Any) -> Optional[Decimal]:
    if valor in (None, ""):
        return None
    try:
        return Decimal(str(valor))
    except (InvalidOperation, ValueError, TypeError):
        return None


def validar_po_number(po_number: Optional[str]) -> list[dict]:
    """Bloqueos por longitud del código interno (C6). Vacío = se puede crear."""
    if not po_number:
        return []
    po = str(po_number).strip()
    if len(po) <= PO_MAX:
        return []
    return [{
        "codigo": "C6",
        "campo": "po_number",
        "detalle": (
            f"'{po}' tiene {len(po)} caracteres y el máximo útil es {PO_MAX}: "
            "mwt.one arma el código interno como 'EXP-' + po_number en una "
            "columna de 32. Con más, la creación devuelve HTTP 500 y el "
            "reintento con el mismo token queda CRASHED."
        ),
        "accion": (
            "Creá con po_number = la proforma (ej. 2501-2026) y anotá que el "
            "código interno queda pendiente del ajuste C6, o acortá el nombre."
        ),
    }]


def comparar_total(
    declarado: Any,
    resuelto: Any,
    tolerancia: str | Decimal = TOLERANCIA,
) -> dict:
    """Compara el total de la proforma contra el que resuelve el motor.

    `cuadra=None` cuando alguno de los dos no es comparable (falta el dato).
    """
    d, r = _dec(declarado), _dec(resuelto)
    if d is None or r is None:
        return {
            "comparable": False,
            "cuadra": None,
            "declarado": None if d is None else str(d),
            "resuelto": None if r is None else str(r),
            "diferencia": None,
        }
    diferencia = (r - d).quantize(Decimal("0.01"))
    return {
        "comparable": True,
        "cuadra": diferencia.copy_abs() <= Decimal(str(tolerancia)),
        "declarado": str(d),
        "resuelto": str(r),
        "diferencia": str(diferencia),
    }


def auditar_lineas(lineas: Iterable[dict]) -> dict:
    """Cuenta líneas resueltas, sin match y sin precio a partir del preview."""
    resueltas = 0
    sin_match = 0
    sin_precio = 0
    for linea in lineas or []:
        resueltas += 1
        if not linea.get("producto_id") or not linea.get("assigned", True):
            sin_match += 1
        precio = _dec(linea.get("unit_price"))
        if precio is None or precio <= 0:
            sin_precio += 1
    return {
        "total": resueltas,
        "sin_match": sin_match,
        "sin_precio": sin_precio,
    }


def total_de_lineas(lineas: Iterable[dict]) -> str:
    """Suma qty × unit_price de las líneas resueltas, en string decimal."""
    total = Decimal("0")
    for linea in lineas or []:
        qty = _dec(linea.get("qty"))
        precio = _dec(linea.get("unit_price"))
        if qty is None or precio is None:
            continue
        total += qty * precio
    return str(total.quantize(Decimal("0.01")))


def construir_resultado(
    *,
    bloqueos: Optional[list[dict]] = None,
    avisos: Optional[list[dict]] = None,
    totales: Optional[dict] = None,
    lineas: Optional[dict] = None,
    referencias: Optional[dict] = None,
) -> dict:
    """Respuesta única del preflight: `ok` significa 'se puede crear'."""
    bloqueos = bloqueos or []
    return {
        "ok": not bloqueos,
        "puede_crear": not bloqueos,
        "bloqueos": bloqueos,
        "avisos": avisos or [],
        "totales": totales or {},
        "lineas": lineas or {},
        "referencias": referencias or {},
        "siguiente": (
            "Crear con expediente_crear(...) usando los mismos datos del preflight."
            if not bloqueos else
            "Corregí los bloqueos y volvé a correr el preflight antes de crear."
        ),
    }
