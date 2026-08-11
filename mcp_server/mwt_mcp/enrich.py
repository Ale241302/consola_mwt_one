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
    """Carga el mapa id -> nombre_comercial de las empresas del usuario.

    Usa `portal/me/` como fuente PRIMARIA porque es accesible para TODOS los
    roles (incluido client_b2b, que recibe 403 en `/clientes/`). El `me`
    devuelve `empresas: [{id, nombre, razon_social}]`. Para staff, se añade un
    fallback a `clientes/` (más completo). Fail-safe: ante error, cachea
    vacío para no repetir la llamada por cada tool.
    """
    global _client_cache, _client_cache_exp
    try:
        names: dict[str, str] = {}
        try:
            data = api.get("portal/me/")
            empresas = (data or {}).get("empresas") or []
            for e in empresas:
                if e.get("id"):
                    names[str(e["id"])] = e.get("nombre") or e.get("razon_social") or ""
        except Exception:  # noqa: BLE001 - fallback a clientes/
            pass
        if not names:
            data = api.get("clientes/", {"limit": 500})
            rows = data if isinstance(data, list) else (data or {}).get("results") or []
            for r in rows:
                if r.get("id"):
                    names[str(r["id"])] = (r.get("nombre_comercial") or r.get("razon_social") or "")
        _client_cache = names
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


# --------------------------------------------------------------------------- #
# Enriquecimiento de PRODUCTOS (Ola 3.7 · Calidad)
# --------------------------------------------------------------------------- #
_talla_cache: dict[str, dict] = {}
_talla_cache_exp: float = 0.0


def _ensure_tallas_loaded() -> None:
    global _talla_cache, _talla_cache_exp
    if time.time() < _talla_cache_exp:
        return
    try:
        data = api.get("sizing/tallas/", {"limit": 500})
        rows = data if isinstance(data, list) else (data or {}).get("results") or []
        _talla_cache = {str(r.get("id")): r for r in rows if r.get("id")}
        _talla_cache_exp = time.time() + _CACHE_TTL
    except Exception:  # noqa: BLE001
        _talla_cache_exp = time.time() + 60


def resolve_tallas(sizes: list | None) -> list[dict]:
    """Resuelve una lista de UUIDs de talla a su nombre + equivalencias.

    Ej. `["71e3feb6-..."]` -> `[{"id": "...", "nombre": "33", "eu": "35",
    "us_men": "3-3.5", "cm": "22.34"}]`. Fail-safe: deja el UUID si no resuelve.
    """
    if not sizes:
        return []
    _ensure_tallas_loaded()
    out = []
    for s in sizes:
        sid = str(s)
        t = _talla_cache.get(sid)
        if not t:
            out.append({"id": sid, "nombre": sid})
            continue
        out.append({
            "id": sid,
            "nombre": t.get("nombre") or t.get("talla_base") or sid,
            "talla_base": t.get("talla_base"),
            "eu": t.get("eu"),
            "us_men": t.get("us_men"),
            "us_women": t.get("us_women"),
            "uk_men": t.get("uk_men"),
            "cm": t.get("cm"),
            "br": t.get("br"),
        })
    return out


def _client_ids_for_user(user: dict | None) -> set[str]:
    """Legal entity ids del usuario conectado (para filtrar client_prices)."""
    if not user:
        return set()
    ids = user.get("legal_entity_ids") or []
    return {str(x) for x in ids}


def enrich_producto(payload: Any, user: dict | None = None) -> Any:
    """Enriquece un producto (o lista):
      · `tallas`/`especificaciones.sizes` -> array con nombre + equivalencias.
      · `especificaciones.client_prices` -> filtrado por rol:
        CEO/Admin: todos; client_b2b: solo sus legal_entity_ids.
      · `ficha_pdf` se deja como referencia (el MCP la descarga en demanda).
    """
    from .redact import is_ceo_or_admin, is_client

    role = (user or {}).get("role") or (user or {}).get("role_slug") or ""

    def _one(row: dict) -> dict:
        if not isinstance(row, dict):
            return row
        out = dict(row)
        spec = out.get("especificaciones")
        if isinstance(spec, dict):
            spec = dict(spec)
            sizes = spec.get("sizes") or []
            if sizes:
                spec["sizes"] = resolve_tallas(sizes)
            cp = spec.get("client_prices") or {}
            if isinstance(cp, dict) and cp:
                if is_ceo_or_admin(role):
                    pass  # CEO/Admin: todos los precios
                elif is_client(role):
                    allowed = _client_ids_for_user(user)
                    spec["client_prices"] = {
                        k: v for k, v in cp.items()
                        if k in allowed or _is_uuid_in(user, k)
                    }
                else:
                    # staff no-CEO: sin precios por cliente (evita fuga)
                    spec["client_prices"] = {}
            out["especificaciones"] = spec
        tallas = out.get("tallas") or []
        if tallas:
            out["tallas"] = resolve_tallas(tallas)
        return out

    def _is_uuid_in(user, cid):
        # comparación tolerante: algunos client_prices usan el id de legal_entity
        le = user.get("legal_entity_ids") or []
        return str(cid) in {str(x) for x in le}

    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        payload = dict(payload)
        payload["results"] = [_one(r) for r in payload["results"]]
        return payload
    if isinstance(payload, list):
        return [_one(r) for r in payload]
    if isinstance(payload, dict):
        return _one(payload)
    return payload
