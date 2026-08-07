"""
=====================================================================
MWT.ONE · apps.storage.helpers

Utilidades puras para normalizar referencias a objetos de storage.

Problema que resuelve:
  El frontend y el MCP esperan que los campos `imagen_url`, `ficha_url`,
  `logo_url` y `storage_url` contengan la *object key* relativa al bucket
  (ej: "producto/<id>/<uuid>-filename.png"). Sin embargo, en el pasado varios
  flujos (upload-url, portal, documentos) persistieron URLs firmadas de MinIO
  completas: "https://host:9000/bucket/producto/.../file.png?X-Amz-...".

  Eso provoca ERR_SSL_PROTOCOL_ERROR / mixed-content cuando el navegador
  intenta cargar la imagen directamente, y además filtra la firma AWS.

`normalize_storage_key(value)` convierte cualquier URL de MinIO/S3 conocida
en key relativa, dejando intactas las URLs externas (CDN, placeholder,
dynamic://, etc.).
=====================================================================
"""
from __future__ import annotations

import re
import logging
from urllib.parse import urlparse, unquote
from django.conf import settings

log = logging.getLogger(__name__)


def _minio_public_hosts() -> set:
    """Devuelve los hosts que reconocemos como endpoints de MinIO."""
    hosts = set()
    for endpoint in (
        getattr(settings, "MINIO_PUBLIC_ENDPOINT", None),
        getattr(settings, "MINIO_ENDPOINT", None),
    ):
        if not endpoint:
            continue
        endpoint = str(endpoint).strip()
        if "://" not in endpoint:
            endpoint = f"http://{endpoint}"
        parsed = urlparse(endpoint)
        host = parsed.netloc or parsed.path
        if host:
            hosts.add(host.lower())
    return hosts


def normalize_storage_key(value: str | None) -> str | None:
    """Convierte una URL firmada de MinIO en object key relativa al bucket.

    Reglas:
      - None / "" / ya relativa → se devuelve limpia (sin leading slash).
      - URLs cuyo host no sea MinIO → se devuelven tal cual (CDN externo).
      - URLs de MinIO (path-style) → se extrae el path, se quita el bucket
        y el leading slash, se devuelve la key.
      - "dynamic://..." y otras pseudo-URLs → se devuelven tal cual.
      - Query params y fragmentos se descartan.

    Ejemplo:
      "https://187.77.218.102:9000/mwt-one/producto/abc/file.png?X-Amz-..."
      → "producto/abc/file.png"
    """
    if not value:
        return None

    value = str(value).strip()
    if not value:
        return None

    # Ya es key relativa (no URL).
    if not re.match(r"^https?://", value, re.IGNORECASE):
        return value.lstrip("/")

    parsed = urlparse(value)
    if not parsed.netloc:
        return value.lstrip("/")

    # Es una URL. ¿Es de nuestro MinIO?
    if parsed.netloc.lower() not in _minio_public_hosts():
        return value  # CDN externo; no tocar.

    bucket = getattr(settings, "MINIO_BUCKET", "mwt-one") or "mwt-one"
    path = unquote(parsed.path or "")

    # Path-style: /<bucket>/key  o  /key (bucket-less, legacy)
    prefix_bucket = f"/{bucket}/"
    if path.startswith(prefix_bucket):
        key = path[len(prefix_bucket):]
    elif path.startswith("/"):
        key = path[1:]
    else:
        key = path

    if not key:
        return None
    return key
