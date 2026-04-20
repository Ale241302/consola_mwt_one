"""
=====================================================================
MWT.ONE · apps.storage.services
Agente responsable: [AG-BACKEND]

Helpers puros (sin dependencia del request) para:
  - Generar URLs firmadas contra MinIO/S3.
  - Ingerir documentos en Paperless-ngx para OCR / clasificación.

Reglas:
  - Nunca URLs permanentes: por defecto TTL = 15 minutos.
  - Si MinIO no está disponible (dev sin docker), devolvemos una
    pseudo-URL "minio://bucket/key" que el frontend sabe ignorar.
  - Paperless: POST multipart a /api/documents/post_document/ con el
    Token del settings.PAPERLESS_TOKEN; el task_id devuelto se guarda
    en expedientes.documento.paperless_task_id para auditar el OCR.
=====================================================================
"""
from __future__ import annotations

import datetime as _dt
import io
import logging
import os
from typing import Optional
from urllib.parse import urlparse

from django.conf import settings

log = logging.getLogger(__name__)


# --------------------------------------------------------------------
# MinIO client (lazy) — se cachea la instancia entre llamadas
# --------------------------------------------------------------------
_minio_client = None


def _get_minio_client():
    """Instancia perezosa del cliente MinIO. None si la lib no está
    disponible o los credenciales no están configurados."""
    global _minio_client
    if _minio_client is not None:
        return _minio_client
    try:
        from minio import Minio  # noqa: PLC0415
    except Exception as e:
        log.warning("minio lib no disponible: %s", e)
        return None

    endpoint = getattr(settings, "MINIO_ENDPOINT", "") or ""
    access   = getattr(settings, "MINIO_ACCESS_KEY", "") or ""
    secret   = getattr(settings, "MINIO_SECRET_KEY", "") or ""
    if not endpoint or not access or not secret:
        log.info("MinIO no configurado (endpoint/access/secret vacíos)")
        return None

    parsed = urlparse(endpoint if "://" in endpoint else f"http://{endpoint}")
    host   = parsed.netloc or parsed.path
    secure = (parsed.scheme == "https") or bool(getattr(settings, "MINIO_SECURE", False))

    try:
        _minio_client = Minio(host, access_key=access, secret_key=secret, secure=secure)
        return _minio_client
    except Exception as e:
        log.error("Fallo al construir cliente MinIO: %s", e)
        return None


def ensure_bucket(bucket: Optional[str] = None) -> bool:
    """Crea el bucket si no existe. Idempotente. Devuelve True si el
    bucket quedó disponible tras la llamada."""
    client = _get_minio_client()
    if client is None:
        return False
    bucket = bucket or getattr(settings, "MINIO_BUCKET", "mwt-one")
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
        return True
    except Exception as e:
        log.error("ensure_bucket(%s) falló: %s", bucket, e)
        return False


# --------------------------------------------------------------------
# Signed URLs (presigned GET / PUT)
# --------------------------------------------------------------------
def generate_signed_url(
    key: str,
    *,
    kind: str = "get",
    ttl: int = 900,
    bucket: Optional[str] = None,
) -> dict:
    """
    Devuelve una URL firmada para acceder a un objeto en MinIO.

    Parámetros:
        key    → ruta interna al objeto (sin bucket). Ej: "expedientes/EXP-001/bl.pdf"
        kind   → "get" (descarga) | "put" (upload).
        ttl    → segundos de validez. Máx 7d por restricción de S3.
        bucket → sobrescribe settings.MINIO_BUCKET si se proporciona.

    Devuelve:
        {
          "url":        str,          # URL firmada (o pseudo-URL si no hay MinIO)
          "method":     "GET"|"PUT",
          "expires_at": ISO-8601 UTC,
          "bucket":     str,
          "key":        str,
          "available":  bool,         # False = storage no disponible
        }
    """
    bucket = bucket or getattr(settings, "MINIO_BUCKET", "mwt-one")
    method = "PUT" if kind.lower() == "put" else "GET"
    ttl    = max(60, min(int(ttl or 900), 7 * 24 * 3600))

    expires_at = (_dt.datetime.utcnow() + _dt.timedelta(seconds=ttl)).isoformat() + "Z"

    client = _get_minio_client()
    if client is None:
        return {
            "url":        f"minio://{bucket}/{key}",
            "method":     method,
            "expires_at": expires_at,
            "bucket":     bucket,
            "key":        key,
            "available":  False,
        }

    # Asegurar bucket sólo en modo upload (PUT) — getters no deben crearlo
    if method == "PUT":
        ensure_bucket(bucket)

    try:
        if method == "PUT":
            url = client.presigned_put_object(bucket, key, expires=_dt.timedelta(seconds=ttl))
        else:
            url = client.presigned_get_object(bucket, key, expires=_dt.timedelta(seconds=ttl))
    except Exception as e:
        log.error("presigned_%s_object(%s/%s) falló: %s", method.lower(), bucket, key, e)
        return {
            "url":        f"minio://{bucket}/{key}",
            "method":     method,
            "expires_at": expires_at,
            "bucket":     bucket,
            "key":        key,
            "available":  False,
        }

    return {
        "url":        url,
        "method":     method,
        "expires_at": expires_at,
        "bucket":     bucket,
        "key":        key,
        "available":  True,
    }


# --------------------------------------------------------------------
# Paperless-ngx ingest
# --------------------------------------------------------------------
def paperless_ingest(
    *,
    file_bytes: bytes,
    filename: str,
    title: Optional[str] = None,
    correspondent: Optional[str] = None,
    document_type: Optional[str] = None,
    tags: Optional[list] = None,
) -> dict:
    """
    Envía un documento a Paperless-ngx para OCR + clasificación.

    Devuelve:
        { "ok": bool, "task_id": str|None, "status": int, "error": str|None }

    El `task_id` devuelto por Paperless (UUID) debe persistirse en
    expedientes.documento.paperless_task_id para auditar y, más tarde,
    correlacionar el PDF OCRizado que Paperless genera.
    """
    url   = getattr(settings, "PAPERLESS_URL", "") or ""
    token = getattr(settings, "PAPERLESS_TOKEN", "") or ""
    if not url or not token:
        return {"ok": False, "task_id": None, "status": 0, "error": "paperless_not_configured"}

    try:
        import requests  # noqa: PLC0415
    except Exception:
        return {"ok": False, "task_id": None, "status": 0, "error": "requests_missing"}

    endpoint = url.rstrip("/") + "/api/documents/post_document/"
    headers  = {"Authorization": f"Token {token}"}
    files    = {"document": (filename, io.BytesIO(file_bytes))}
    data     = {}
    if title:         data["title"]         = title
    if correspondent: data["correspondent"] = correspondent
    if document_type: data["document_type"] = document_type
    if tags:
        # Paperless acepta múltiples "tags"; la lib requests soporta listas.
        data["tags"] = tags

    try:
        resp = requests.post(endpoint, headers=headers, files=files, data=data, timeout=30)
    except Exception as e:
        return {"ok": False, "task_id": None, "status": 0, "error": f"request_failed: {e}"}

    if resp.status_code >= 400:
        return {"ok": False, "task_id": None, "status": resp.status_code, "error": resp.text[:500]}

    # Paperless devuelve el UUID del task como string plano
    task_id = resp.text.strip().strip('"')
    return {"ok": True, "task_id": task_id or None, "status": resp.status_code, "error": None}
