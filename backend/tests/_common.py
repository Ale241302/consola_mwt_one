"""
=====================================================================
MWT.ONE · tests/_common.py
Agente responsable: [AG-06-QA]

Helpers transversales reutilizados por TODOS los archivos test_*.py.
Centralizar acá evita duplicar lógica frágil:
  · extract_results():   tolera respuestas paginadas DRF y listas crudas
  · assert_uuid_string(): valida la "Regla de Oro" de UUIDs como str
  · pretty_payload():    serialización legible para los reportes de error
=====================================================================
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Iterable


# ─────────────────────────────────────────────────────────────────────
# DRF · normalizar respuesta de listado
# ─────────────────────────────────────────────────────────────────────
def extract_results(payload: Any) -> list:
    """
    Devuelve la lista de items de una respuesta DRF, sin importar si
    está paginada (LimitOffsetPagination → {count, next, previous, results})
    o si es una lista cruda (caso de los `viewsets.ViewSet` que MWT usa
    sin paginator). Cualquier otro shape lanza AssertionError con detalle.
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if "results" in payload and isinstance(payload["results"], list):
            return payload["results"]
        # Algunos endpoints empaquetan como {data: [...]}
        if "data" in payload and isinstance(payload["data"], list):
            return payload["data"]
    raise AssertionError(
        "La respuesta no es una lista ni un payload paginado DRF. "
        f"Tipo recibido: {type(payload).__name__}, payload: {pretty_payload(payload)[:300]}"
    )


# ─────────────────────────────────────────────────────────────────────
# Regla de Oro MWT · UUIDs como cadenas, no FK físicas
# ─────────────────────────────────────────────────────────────────────
def assert_uuid_string(value: Any, field_name: str = "id") -> None:
    """Valida que `value` sea un UUID v4 representado como str."""
    assert isinstance(value, str), (
        f"[REGLA DE ORO MWT] {field_name} debe ser str (no FK), "
        f"se recibió {type(value).__name__}: {value!r}"
    )
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError) as e:
        raise AssertionError(
            f"[REGLA DE ORO MWT] {field_name}={value!r} no es un UUID válido: {e}"
        )


def new_uuid() -> str:
    """Genera un UUID v4 como str (la única forma permitida en MWT)."""
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────────────
# Reporte de errores · serialización segura
# ─────────────────────────────────────────────────────────────────────
def pretty_payload(payload: Any) -> str:
    """JSON serializable o repr — usado por el runner para el log de fallas."""
    try:
        return json.dumps(payload, indent=2, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return repr(payload)


def find_by_id(items: Iterable[dict], target_id: str, key: str = "id") -> dict | None:
    """Busca un item por id en una lista de dicts. None si no existe."""
    for it in items:
        if str(it.get(key, "")) == str(target_id):
            return it
    return None
