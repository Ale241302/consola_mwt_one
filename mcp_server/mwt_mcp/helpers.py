"""Ola 2 · 2.14 — Maquinaria compartida de los servidores MCP de MWT.ONE.

Contiene el andamiaje común que usan los tres servidores de dominio
(mwt-comercial, mwt-logistica, mwt-finanzas) y el monolito `server.py`:

  - `_safe()`            : frontera que nunca deja escapar una excepción cruda.
  - `@write_tool`        : Ola 2 · 2.21, guard estructural de escritura.
  - `_paging()` / `_project()` : Ola 2 · 2.17, paginación y proyección de campos.
  - `_params()` / `_norm_num()` / `_as_rows()` : pequeños utilitarios.
  - `_log_mcp_audit()`   : Ola 2 · 2.20, auditoría JSON por tool-call.

Idealmente este módulo NO importa nada pesado; comparte `client`, `config`,
`schemas` e `identity` con los módulos de dominio.
"""
from __future__ import annotations

import re
from typing import Any

from . import client as api
from .client import MwtApiError
from .config import settings


# --------------------------------------------------------------------------- #
# Frontera de errores (nunca propagar crudo al agente)
# --------------------------------------------------------------------------- #
def _safe(call):
    try:
        return call()
    except MwtApiError as e:
        return {"error": True, "status": e.status, "detail": e.payload, "url": e.url}
    except Exception as e:  # noqa: BLE001 - frontera del MCP: nunca propagar crudo
        return {"error": True, "detail": str(e)}


def _wguard():
    """Guard de escritura manual (legacy). Las tools nuevas usan @write_tool."""
    if settings.readonly:
        return {
            "error": True,
            "detail": "MCP en modo solo-lectura (MWT_MCP_READONLY=1); operación de escritura bloqueada.",
        }
    return None


# --------------------------------------------------------------------------- #
# Ola 2 · 2.21 — decorador estructural de escritura
# --------------------------------------------------------------------------- #
from functools import wraps as _wraps

# Ola 2 · 2.20 — auditoría JSON por escritura (observabilidad + trazabilidad).
# Campos sensibles que NUNCA se vuelcan a los logs (se marcan como "<redactado>").
_AUDIT_REDACT = {
    "file_path", "filename", "key", "storage_url", "signed_url", "url",
    "evidencia", "documento_sap", "idempotence_token", "idempotency_key",
    "token", "password", "secret", "tax_id", "contact_email", "phone",
    "cedula",
}


def _audit_sanitize(value, key: str = ""):
    """Sanea un valor antes de loguearlo: trunca strings largos y redacta todo
    lo que contenga una clave de la lista _AUDIT_REDACT."""
    if isinstance(value, dict):
        return {k: _audit_sanitize(v, _audit_key(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_audit_sanitize(v, key) for v in value]
    if isinstance(value, str):
        if any(red in key.lower() for red in _AUDIT_REDACT):
            return "<redactado>"
        return value if len(value) <= 200 else value[:200] + "…<truncado>"
    return value


def _audit_key(k: str) -> str:
    return (k or "").lower()


def _log_mcp_audit(tool: str, args, result, duration_ms: float, identity: dict | None = None, event: str = "write"):
    """Emite un log JSON estructurado por tool-call de escritura a stderr.

    El proceso MCP escribe una sola línea por invocación. Un observador
    (gateway o agente) puede agregar estos logs; el almacenamiento durable se
    centraliza en la tabla `core.mcp_audit` (DDL versionado:
    database/sql/98b_mcp_audit_and_idempotency.sql).
    """
    import json as _json
    import time as _time

    if isinstance(result, dict):
        ok = not bool(result.get("error"))
        status = result.get("status")
    else:
        ok = True
        status = None
    ident = identity or {}
    rec = {
        "event": event,
        "at": _time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tool": tool,
        "identity": {"sub": ident.get("sub"), "roles": ident.get("roles")},
        "args_sanitized": _audit_sanitize(args),
        "ok": ok,
        "http_status": status,
        "duration_ms": duration_ms,
    }
    try:
        import sys as _sys
        print(_json.dumps(rec, ensure_ascii=False), file=_sys.stderr, flush=True)
    except Exception:  # noqa: BLE001 - nunca romper la tool por un log fallido
        pass


def write_tool(func):
    """Marca y blinda una tool de escritura del MCP.

    Aplica _wguard() de forma estructural ANTES de ejecutar el cuerpo y marca la
    función con `._mwt_write = True` para auditoría/detección. Emite un log JSON
    por llamada (Ola 2 · 2.20) con args saneados."""
    import time as _time

    @_wraps(func)
    def wrapper(*args, **kwargs):
        g = _wguard()
        if g:
            return g
        t0 = _time.monotonic()
        try:
            result = func(*args, **kwargs)
            _log_mcp_audit(func.__name__, kwargs, result,
                           int((_time.monotonic() - t0) * 1000))
            return result
        except Exception as e:  # noqa: BLE001
            _log_mcp_audit(func.__name__, kwargs,
                           {"error": True, "detail": str(e), "status": 500},
                           int((_time.monotonic() - t0) * 1000))
            raise

    wrapper._mwt_write = True
    return wrapper


def _is_write_tool(func) -> bool:
    """Devuelve True si la tool está marcada como de escritura."""
    return bool(getattr(func, "_mwt_write", False))


# Listado nominal de tools que, aunque siguen siendo "preview"/"dry-run",
# ejecutan POST en el backend. El decorador @write_tool las blinda en readonly.
WRITE_TOOLS_WITH_POST = {
    "expediente_resolve_oc_preview": "POST /expedientes/resolve-oc-preview/",
    "pago_dry_run": "POST /finance/payments/dry-run/",
}


# --------------------------------------------------------------------------- #
# Ola 2 · 2.17 — paginación y proyección
# --------------------------------------------------------------------------- #
def _paging(limit, offset, default: int = 50, max_limit: int = 200):
    """Coerce de paginación para las tools de listado.

    Devuelve (limit_coerced, offset_coerced). Valores seguros:
      - limit: 1..max_limit (default limit=default). Si el caller pasa 0 o
        negativo, se usa el default.
      - offset: >= 0 (default 0)."""
    try:
        lim = int(limit) if limit is not None else default
    except (TypeError, ValueError):
        lim = default
    if lim < 1:
        lim = default
    if lim > max_limit:
        lim = max_limit
    try:
        off = int(offset) if offset is not None else 0
    except (TypeError, ValueError):
        off = 0
    if off < 0:
        off = 0
    return lim, off


def _project(campos: str | None, data: Any) -> Any:
    """Proyección cliente-lado (`campos`): recorta la respuesta a solo los campos
    pedidos para ahorrar contexto del agente. Si `campos` es None/vacío devuelve
    `data` sin cambios (compatibilidad total)."""
    if not campos:
        return data
    keep = [c.strip() for c in str(campos).split(",") if c.strip()]
    if not keep:
        return data

    def _pick(row):
        if isinstance(row, dict):
            return {k: row[k] for k in keep if k in row}
        return row

    # Wrapper paginado DRF: {results:[...], count, next, previous}
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        out = dict(data)
        out["results"] = [_pick(r) for r in out["results"]]
        return out
    if isinstance(data, list):
        return [_pick(r) for r in data]
    return _pick(data)


# --------------------------------------------------------------------------- #
# Pequeños utilitarios
# --------------------------------------------------------------------------- #
def _params(**kwargs) -> dict:
    return {k: v for k, v in kwargs.items() if v is not None}


def _norm_num(s: str | None) -> str:
    """Normaliza un número de OC/proforma/SAP para comparar: minúsculas, quita
    prefijos 'po'/'oc' y todo lo no alfanumérico. '504960' == 'PO 504960' == 'PO-504960'."""
    s = re.sub(r"[^0-9a-z]", "", (s or "").strip().lower())
    return re.sub(r"^(po|oc)(?=\d)", "", s)


def _as_rows(data: Any) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("results") or []
    return []
