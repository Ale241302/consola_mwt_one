"""Cliente HTTP hacia el MWT Builder (builder.muito.work).

El Builder es un backend Django independiente (proyecto `mwt_builder`) con su
propia API REST:
  - POST /api/login/           → JWT (access/refresh) con usuario+password.
  - GET  /api/artefactos/      → lista artefactos (plantillas Builder).
  - POST /api/artefactos/      → crea artefacto {title, structure_json, status}.
  - GET/PUT/DELETE /api/artefactos/{id}/.

Los artefactos son plantillas de formularios cuyo `structure_json` tiene forma:
  {"sections": [{"id", "columns": [{"id", "fields": [{"id", "type", "label",
    "options", "permissions"}]}], "permissions"}]}
con tipos de campo: text, number, textarea, date, checkbox, file, select,
radio, code (select/radio usan `options=[{id, label, permissions}]`).

Este módulo NO reutiliza `client.py` (que apunta a consola.mwt.one); habla
directamente con el builder y mantiene el token JWT en memoria con cache.
Nunca propaga excepciones crudas: devuelve dicts de error claros.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import httpx

from .config import settings


class BuilderApiError(Exception):
    """Error HTTP/negocio del Builder, ya formateado para el agente."""

    def __init__(self, status: int, payload: Any, url: str) -> None:
        self.status = status
        self.payload = payload
        self.url = url
        super().__init__(f"HTTP {status} en {url}: {payload}")


# ── Cache del token JWT (thread-safe) ──────────────────────────────────── #
_TokenLock = threading.Lock()
_cache: dict[str, Any] = {"access": None, "expires_at": 0.0}


def _login() -> str:
    """Hace POST /api/login/ y cachea el access token (con margen de expiración).

    Fallo si faltan credenciales o el builder no responde/login 401. Devuelve
    el access token en texto plano o lanza BuilderApiError."""
    if not settings.builder_username or not settings.builder_password:
        raise BuilderApiError(
            401,
            {"detail": "Faltan MWT_BUILDER_USERNAME / MWT_BUILDER_PASSWORD en el entorno del MCP."},
            f"{settings.builder_base}/api/login/",
        )
    url = f"{settings.builder_base}/api/login/"
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.post(
            url,
            json={
                "username": settings.builder_username,
                "password": settings.builder_password,
            },
        )
    if r.status_code != 200:
        raise BuilderApiError(
            r.status_code, _parse(r), url,
        )
    data = _parse(r)
    access = (data or {}).get("access")
    if not access:
        raise BuilderApiError(
            502, {"detail": f"Login del Builder no devolvió access token: {data}"}, url,
        )
    # Expiración aproximada: SimpleJWT default = 5 min. Cacheamos ~4 min.
    with _TokenLock:
        _cache["access"] = access
        _cache["expires_at"] = time.time() + 240
    return access


def _access_token() -> str:
    """Devuelve el token vigente; re-login si expiró o no existe."""
    with _TokenLock:
        if _cache["access"] and time.time() < _cache["expires_at"]:
            return _cache["access"]
    return _login()


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_access_token()}"}


def _url(path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{settings.builder_base}/api/{path.lstrip('/')}"


def _parse(resp: httpx.Response) -> Any:
    ctype = resp.headers.get("content-type", "")
    if "application/json" in ctype:
        try:
            return resp.json()
        except Exception:  # noqa: BLE001
            return resp.text
    return resp.text


def _clean(obj: Any) -> Any:
    """Quita claves con valor None (la API trata ausente != null)."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _handle(resp: httpx.Response, retry_after_reconnect: bool = True) -> Any:
    if resp.status_code < 400:
        if resp.status_code == 204:
            return {"ok": True, "status": 204}
        return _parse(resp)
    # 401 => token caducado/inválido: un único re-login y reintento.
    if resp.status_code == 401 and retry_after_reconnect:
        with _TokenLock:
            _cache["access"] = None
            _cache["expires_at"] = 0.0
        url = str(resp.request.url)
        method = resp.request.method
        body = getattr(resp.request, "content", b"")
        import json as _json

        payload = None
        try:
            payload = _json.loads(body) if body else None
        except Exception:  # noqa: BLE001
            payload = None
        params = dict(resp.request.url.params)
        with httpx.Client(timeout=settings.http_timeout) as c:
            r = c.request(method, url, json=payload, params=params, headers=_auth_headers())
        return _handle(r, retry_after_reconnect=False)
    raise BuilderApiError(resp.status_code, _parse(resp), str(resp.request.url))


def _request(method: str, path: str, body: dict | None = None, params: dict | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.request(method, _url(path), json=_clean(body), params=params, headers=_auth_headers())
        return _handle(r)


def listar_artefactos(limit: int | None = None, offset: int | None = None) -> Any:
    params = {}
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    return _request("GET", "artefactos/", params=params)


def obtener_artefacto(artefacto_id: int) -> Any:
    return _request("GET", f"artefactos/{artefacto_id}/")


def crear_artefacto(title: str, structure_json: dict, status: str = "Published") -> Any:
    return _request("POST", "artefactos/", {"title": title, "structure_json": structure_json, "status": status})


def editar_artefacto(artefacto_id: int, title: str, structure_json: dict, status: str | None = None) -> Any:
    body: dict[str, Any] = {"title": title, "structure_json": structure_json}
    if status:
        body["status"] = status
    return _request("PUT", f"artefactos/{artefacto_id}/", body)


def eliminar_artefacto(artefacto_id: int) -> Any:
    return _request("DELETE", f"artefactos/{artefacto_id}/")


def _safe(call):
    """Frontera de errores: nunca propaga crudo al agente."""
    try:
        return call()
    except BuilderApiError as e:
        return {"error": True, "status": e.status, "detail": e.payload, "url": e.url}
    except Exception as e:  # noqa: BLE001
        return {"error": True, "detail": str(e)}
