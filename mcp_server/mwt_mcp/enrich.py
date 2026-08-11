"""Enriquecimiento de respuestas del MCP con nombres legibles (Ola 3.7 · Calidad).

Resuelve los UUIDs que el backend devuelve en campos como `client_id`,
`legal_entity_ids`, `operating_company_id`, `brand_id` a su nombre legible
(`nombre_comercial` / `razon_social` / `nombre`), para que el agente no le
muestre al CEO/Admin un UUID sino "Sondel S.A.".

También normaliza la presentación de los códigos de un expediente según el rol:
  · CEO/Admin  -> `proforma_codigos` + `oc_codigos` + `sap_codigos` (los presentes)
  · client_b2b -> `oc_codigos` + `sap_codigos` (sin proforma interna)

Diseño:
  · Resolución por BATCH con caché en memoria (TTL 30 min): se piden UNA vez los
    clientes del scope y se mapea id -> nombre_comercial. Evita N+1 por fila.
  · `enrich_ids(data)` recorre el payload y sustituye los campos *_id por un
    campo adjunto `*_nombre` cuando el ID está en el mapa (no muta el ID).
  · Fail-safe: si no se puede resolver (red, permiso), deja el UUID tal cual.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from . import client as api

# Caché simple de id -> nombre_comercial (TTL 30 min).
_CACHE_TTL = 30 * 60
_client_cache: dict[str, str] = {}
_client_cache_exp: float = 0.0
_cache_lock = threading.Lock()


def _resolver(identity_email: str | None = None) -> None:
    """Carga el mapa id -> nombre_comercial de TODOS los clientes visibles.

    Usa el mismo `api.get("clientes/")` que las tools; el resultado trae
    `id` + `nombre_comercial`/`razon_social`. Fail-safe: ante error, cachea
    vacío para no repetir la llamada por cada tool.
    """
    global _client_cache, _client_cache_exp
    try:
        data = api.get("clientes/", {"limit": 500})
        rows = data if isinstance(data, list) else (data or {}).get("results") or []
        _client_cache = {
            str(r.get("id")): (r.get("nombre_comercial") or r.get("razon_social") or "")
            for r in rows
            if r.get("id")
        }
        _client_cache_exp = time.time() + _CACHE_TTL
    except Exception:  # noqa: BLE001 - fail-safe
        _client_cache_exp = time.time() + 60  # reintenta pronto


def _ensure_loaded() -> None:
    with _cache_lock:
        if time.time() >= _client_cache_exp:
            _resolver()


def client_name(client_id: str | None) -> str | None:
    """Nombre legible de un client_id (nombre_comercial o razon_social)."""
    if not client_id:
        return None
    _ensure_loaded()
    name = _client_cache.get(str(client_id))
    return name or None


# Campos *_id que queremos enriquecer con un *_nombre adjunto.
_ID_FIELDS = (
    "client_id", "legal_entity_id", "operating_company_id",
    "nodo_asignado_id", "responsable_id", "parent_id",
)


def _enrich_dict(obj: dict) -> dict:
    out = dict(obj)
    for field in _ID_FIELDS:
        cid = out.get(field)
        if cid:
            name = client_name(cid)
            if name:
                # Adjunta el nombre sin pisar el id: ej. client_id + client_name
                out.setdefault(field.replace("_id", "_name"), name)
    return out


def _walk(value: Any) -> Any:
    if isinstance(value, dict):
        return _enrich_dict({k: _walk(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_walk(v) for v in value]
    return value


def enrich_ids(payload: Any) -> Any:
    """Recorre el payload y adjunta `*_name` para los campos *_id resueltos.

    NO muta el id original; solo añade el nombre cuando se pudo resolver.
    Fail-safe: ante cualquier error devuelve el payload intacto.
    """
    try:
        return _walk(payload)
    except Exception:  # noqa: BLE001
        return payload


# --------------------------------------------------------------------------- #
# Presentación de códigos de expediente según rol (Ola 3.7 · Calidad)
# --------------------------------------------------------------------------- #
def present_expediente_codigos(row: dict, role: str) -> dict:
    """Normaliza los códigos de un expediente según el rol.

    Añade un campo `codigos_presentacion` con el formato legible:
      CEO/Admin  -> "PF 2393-2025 · PO 504302 · 257021"   (proforma + oc + sap)
      client_b2b -> "PO 504302 · 257021"                   (oc + sap)

    Si el backend ya trae `proforma_codigos`/`oc_codigos`/`sap_codigos`
    (listas), se usan esas; si no, se deriva del `codigo` interno.
    """
    from .redact import is_ceo_or_admin, is_client

    role = (role or "").strip().lower()
    proformas = row.get("proforma_codigos") or (
        [row["proforma_codigo"]] if row.get("proforma_codigo") else []
    )
    ocs = row.get("oc_codigos") or []
    saps = row.get("sap_codigos") or []

    partes: list[str] = []
    if is_ceo_or_admin(role):
        partes.extend(proformas)  # proforma interna solo para CEO/Admin
    partes.extend(ocs)
    partes.extend(saps)

    out = dict(row)
    if partes:
        out["codigos_presentacion"] = " · ".join(partes)
    return out
