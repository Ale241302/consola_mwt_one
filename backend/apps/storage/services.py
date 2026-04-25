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
# Object lifecycle: delete + key generation
# --------------------------------------------------------------------
def delete_object(key: str, *, bucket: Optional[str] = None) -> dict:
    """
    Elimina un objeto del bucket. Idempotente — si no existe devuelve
    `available=True, deleted=False` sin error.

    Devuelve:
        { "ok": bool, "deleted": bool, "available": bool, "error": str|None }
    """
    bucket = bucket or getattr(settings, "MINIO_BUCKET", "mwt-one")
    client = _get_minio_client()
    if client is None:
        return {"ok": False, "deleted": False, "available": False,
                "error": "minio_unavailable"}
    try:
        client.remove_object(bucket, key)
        return {"ok": True, "deleted": True, "available": True, "error": None}
    except Exception as e:
        # MinIO `NoSuchKey` se considera idempotente (no error real)
        cls = type(e).__name__
        if "NoSuchKey" in cls or "S3Error" in cls and "does not exist" in str(e).lower():
            return {"ok": True, "deleted": False, "available": True, "error": None}
        log.error("delete_object(%s/%s) falló: %s", bucket, key, e)
        return {"ok": False, "deleted": False, "available": True,
                "error": f"{cls}: {e}"}


def put_object_stream(key: str, file_stream, content_type: str = "application/octet-stream",
                      length: int = -1, *, bucket: Optional[str] = None) -> dict:
    """
    Sube un objeto a MinIO directamente desde un stream (sin signed URL).
    Útil cuando el browser no puede alcanzar MinIO (mixed-content / firewall) —
    el FE manda el binario a Django (HTTPS) y Django lo proxea internamente.

    Args:
        key          → ruta destino en el bucket (usar make_object_key)
        file_stream  → file-like object (request.FILES[name] funciona)
        content_type → MIME del archivo
        length       → tamaño en bytes (-1 = lectura total/streaming)
        bucket       → override de settings.MINIO_BUCKET

    Returns:
        { ok, key, bucket, etag, error }
    """
    bucket = bucket or getattr(settings, "MINIO_BUCKET", "mwt-one")
    client = _get_minio_client()
    if client is None:
        return {"ok": False, "key": key, "bucket": bucket, "etag": None,
                "error": "minio_unavailable"}
    ensure_bucket(bucket)
    try:
        # MinIO requiere el length exacto si <= 5MB; para más usa multipart.
        # Si length=-1 (desconocido), pasamos part_size=10MB para multipart auto.
        if length and length > 0:
            result = client.put_object(bucket, key, file_stream, length,
                                       content_type=content_type)
        else:
            result = client.put_object(bucket, key, file_stream, length=-1,
                                       part_size=10 * 1024 * 1024,
                                       content_type=content_type)
        return {"ok": True, "key": key, "bucket": bucket,
                "etag": getattr(result, "etag", None), "error": None}
    except Exception as e:
        log.error("put_object_stream(%s/%s) falló: %s", bucket, key, e)
        return {"ok": False, "key": key, "bucket": bucket, "etag": None,
                "error": f"{type(e).__name__}: {e}"}


def get_object_stream(key: str, *, bucket: Optional[str] = None):
    """
    Devuelve un urllib3 HTTPResponse-like para el objeto pedido. El caller
    debe llamar `.close()` cuando termine. Devuelve None si MinIO no está
    disponible. Lanza excepción si el objeto no existe.

    Útil para hacer streaming proxy desde Django:
        resp = get_object_stream(key)
        return StreamingHttpResponse(resp.stream(), content_type=...)
    """
    bucket = bucket or getattr(settings, "MINIO_BUCKET", "mwt-one")
    client = _get_minio_client()
    if client is None:
        return None
    return client.get_object(bucket, key)


def make_object_key(scope: str, filename: str) -> str:
    """
    Genera una key única dentro del bucket: <scope>/<uuid>-<filename-saneado>.
    Ej: make_object_key("producto/abc-123", "Ficha técnica.pdf")
        → "producto/abc-123/9f2c1a-ficha-tecnica.pdf"

    El scope sirve como "carpeta lógica" para agrupar/limpiar objetos
    relacionados a un mismo registro. Saneamos filename para evitar
    paths traversal y caracteres problemáticos.
    """
    import uuid as _uuid
    import re
    safe_scope = re.sub(r"[^a-zA-Z0-9/_-]+", "-", (scope or "misc")).strip("/-") or "misc"
    safe_name  = re.sub(r"[^a-zA-Z0-9._-]+", "-",
                        (filename or "archivo").lower()).strip("-") or "archivo"
    short_uuid = _uuid.uuid4().hex[:8]
    return f"{safe_scope}/{short_uuid}-{safe_name}"


# --------------------------------------------------------------------
# Email · helper unificado para envío SMTP
# --------------------------------------------------------------------
def send_test_email(*, to: str, subject: str, body: str,
                    html_body: str = None,
                    reply_to: str = None,
                    from_email: str = None) -> dict:
    """
    Envía un email vía el backend configurado en settings.EMAIL_BACKEND.

    Lee credenciales de:
      EMAIL_HOST · EMAIL_PORT · EMAIL_HOST_USER · EMAIL_HOST_PASSWORD
      EMAIL_USE_SSL · EMAIL_USE_TLS · DEFAULT_FROM_EMAIL · DEFAULT_REPLY_TO

    Si EMAIL_HOST_PASSWORD está vacío, settings cae al backend `console`
    y el mensaje se imprime en stdout (no falla, útil para dev).

    Devuelve dict:
      { "ok": bool, "backend": str, "to": str, "subject": str,
        "from": str, "error": str|None }

    Nunca lanza excepción — atrapa todo internamente.
    """
    from django.conf import settings as _s
    from django.core.mail import EmailMultiAlternatives

    fmail   = from_email or getattr(_s, "DEFAULT_FROM_EMAIL", None)
    rto     = reply_to   or getattr(_s, "DEFAULT_REPLY_TO",   None)
    backend = getattr(_s, "EMAIL_BACKEND", "?")

    if not to:
        return {"ok": False, "backend": backend, "to": None,
                "subject": subject, "from": fmail,
                "error": "to_required"}

    try:
        msg = EmailMultiAlternatives(
            subject  = subject or "(sin asunto)",
            body     = body or "",
            from_email = fmail,
            to       = [to] if isinstance(to, str) else list(to),
            reply_to = [rto] if rto else None,
        )
        if html_body:
            msg.attach_alternative(html_body, "text/html")
        n = msg.send(fail_silently=False)
        return {
            "ok":      bool(n),
            "backend": backend,
            "to":      to,
            "subject": subject,
            "from":    fmail,
            "error":   None if n else "send_returned_zero",
        }
    except Exception as e:
        log.exception("send_test_email failed: %s", e)
        return {
            "ok":      False,
            "backend": backend,
            "to":      to,
            "subject": subject,
            "from":    fmail,
            "error":   f"{type(e).__name__}: {e}",
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
