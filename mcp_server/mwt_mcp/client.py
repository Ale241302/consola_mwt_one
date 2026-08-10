"""Cliente HTTP hacia la API REST de la Consola MWT.ONE.

Envuelve httpx, inyecta el Bearer token de servicio, normaliza errores y
devuelve siempre estructuras Python (dict/list) o un dict de error claro,
de modo que las herramientas MCP nunca lancen excepciones crudas al agente.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from .config import settings
from .jwt_minter import IdentityMintingError, get_identity_token


class MwtApiError(Exception):
    """Error de negocio/HTTP de la API, ya formateado para el agente."""

    def __init__(self, status: int, payload: Any, url: str) -> None:
        self.status = status
        self.payload = payload
        self.url = url
        super().__init__(f"HTTP {status} en {url}: {payload}")


def _auth_headers() -> dict[str, str]:
    try:
        token = get_identity_token()
    except IdentityMintingError as e:
        # Fail-closed: hay identidad propagada (usuario OAuth) pero el backend
        # no emite JWT (inactivo/borrado). El tool debe fallar con 401 claro,
        # NUNCA ejecutar con el token de servicio admin.
        raise MwtApiError(
            401,
            {"detail": f"Autenticación denegada: {e}"},
            settings.api_base,
        )
    # Sprint 2026-08-07 · Ola 1 F3: Bearer para JWT legacy, ServiceToken para
    # tokens de servicio opacos emitidos por manage.py mint_mcp_token.
    if token.startswith("eyJ"):
        return {"Authorization": f"Bearer {token}"}
    return {"Authorization": f"ServiceToken {token}"}


def _parse(resp: httpx.Response) -> Any:
    ctype = resp.headers.get("content-type", "")
    if "application/json" in ctype:
        try:
            return resp.json()
        except Exception:
            return resp.text
    return resp.text


def _handle(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        raise MwtApiError(resp.status_code, _parse(resp), str(resp.request.url))
    if resp.status_code == 204:
        return {"ok": True, "status": 204}
    return _parse(resp)


def _url(path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{settings.api_base}/{path.lstrip('/')}"


def get(path: str, params: dict | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.get(_url(path), params=_clean(params), headers=_auth_headers())
        return _handle(r)


def post(path: str, body: dict | list | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.post(_url(path), json=_clean(body), headers=_auth_headers())
        return _handle(r)


def post_service(path: str, body: dict | list | None = None) -> Any:
    """POST firmado con el ServiceToken estático (NO el JWT de usuario).

    Para endpoints de metadatos/diagnóstico del propio MCP (auth/mcp-token,
    auth/mcp-diag, auth/mcp-audit) que exigen el token de servicio, no la
    identidad del usuario conectado."""
    from .jwt_minter import _service_auth_header

    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.post(_url(path), json=_clean(body), headers=_service_auth_header())
        return _handle(r)


def patch(path: str, body: dict | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.patch(_url(path), json=_clean(body), headers=_auth_headers())
        return _handle(r)


def put(path: str, body: dict | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.put(_url(path), json=_clean(body), headers=_auth_headers())
        return _handle(r)


def delete(path: str, body: dict | None = None) -> Any:
    with httpx.Client(timeout=settings.http_timeout) as c:
        r = c.request(
            "DELETE", _url(path), json=_clean(body), headers=_auth_headers()
        )
        return _handle(r)


def post_multipart(
    path: str,
    data: dict | None = None,
    file_path: str | None = None,
    file_field: str = "file",
) -> Any:
    """POST multipart/form-data. `data` son campos de formulario (los valores
    dict/list se serializan a JSON string). Si `file_path` viene, se adjunta el
    archivo en el campo `file_field`."""
    form = _form_fields(data)
    files = None
    opened = None
    try:
        if file_path:
            if not os.path.isfile(file_path):
                return {"error": f"Archivo no encontrado: {file_path}"}
            opened = open(file_path, "rb")
            files = {file_field: (os.path.basename(file_path), opened)}
        with httpx.Client(timeout=settings.http_timeout) as c:
            r = c.post(_url(path), data=form, files=files, headers=_auth_headers())
            return _handle(r)
    finally:
        if opened:
            opened.close()


def _form_fields(data: dict | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (data or {}).items():
        if v is None:
            continue
        if isinstance(v, (dict, list)):
            out[k] = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, bool):
            out[k] = "true" if v else "false"
        else:
            out[k] = str(v)
    return out


def _clean(obj: Any) -> Any:
    """Quita claves con valor None de dicts (la API trata ausente != null)."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj
