"""
=====================================================================
MWT.ONE · apps.storage.views
Agente responsable: [AG-BACKEND]

Expone:
  POST /api/storage/signed_url/        → firma GET o PUT para MinIO.
  POST /api/storage/paperless_ingest/  → sube a Paperless-ngx y devuelve task_id.
  GET  /api/storage/healthz/           → estado de los gateways.

Reglas:
  - NO confundir con /api/documentos/ (ese es el índice de dominio). Aquí
    sólo se firma / se ingesta.
  - TTL por defecto 15 min (máx 7d).
=====================================================================
"""
import base64
import logging

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.permissions import AllowAny

from django.http import StreamingHttpResponse, Http404

from .services import (
    generate_signed_url, paperless_ingest, ensure_bucket,
    delete_object, make_object_key, put_object_stream, get_object_stream,
)

log = logging.getLogger(__name__)


class StorageViewSet(viewsets.ViewSet):
    """ViewSet liviano, sin `basename`, expuesto vía DefaultRouter en urls.py."""
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @action(detail=False, methods=["get", "post"])
    def signed_url(self, request):
        """
        Body (JSON) o query params:
            { key: str, kind: "get"|"put", ttl: int, bucket?: str }

        Respuesta:
            { url, method, expires_at, bucket, key, available }
        """
        src  = request.data if request.method == "POST" else request.query_params
        key  = src.get("key")
        kind = (src.get("kind") or "get").lower()
        ttl  = int(src.get("ttl") or 900)
        bkt  = src.get("bucket") or None

        if not key:
            return Response({"detail": "Falta 'key'"}, status=400)

        data = generate_signed_url(key=key, kind=kind, ttl=ttl, bucket=bkt)
        return Response(data)

    # ── Upload de 2 pasos: el FE pide PUT URL + key, sube directo a MinIO,
    #    luego PATCHea su modelo con la key. ────────────────────────────
    @action(detail=False, methods=["post"], url_path="upload-url")
    def upload_url(self, request):
        """
        Body (JSON):
            { filename: str, content_type?: str, scope?: str, ttl?: int }

        Respuesta:
            { upload_url, key, method:"PUT", expires_at, bucket, available,
              content_type }

        El FE debe luego hacer:
            await fetch(upload_url, { method:"PUT", body: file,
                                      headers:{"Content-Type": content_type } });
            await api.patch(`/api/<modelo>/<id>/`, { ficha_url: key });
        """
        filename     = (request.data.get("filename") or "").strip()
        content_type = (request.data.get("content_type") or "application/octet-stream").strip()
        scope        = (request.data.get("scope") or "misc").strip()
        ttl          = int(request.data.get("ttl") or 600)

        if not filename:
            return Response({"detail": "Falta 'filename'"}, status=400)

        # Genera key única deterministicamente para evitar colisiones.
        key  = make_object_key(scope, filename)
        sign = generate_signed_url(key=key, kind="put", ttl=ttl)
        return Response({
            "upload_url":   sign["url"],
            "key":          sign["key"],
            "method":       "PUT",
            "expires_at":   sign["expires_at"],
            "bucket":       sign["bucket"],
            "available":    sign["available"],
            "content_type": content_type,
        }, status=200 if sign["available"] else 503)

    # ── Upload-proxy: el FE manda el archivo por HTTPS al backend, y
    #    Django lo sube a MinIO internamente. Evita mixed-content cuando
    #    MinIO no tiene SSL público. Cuesta 1 hop más pero funciona ya. ──
    @action(detail=False, methods=["post"], url_path="upload-proxy",
            parser_classes=[MultiPartParser, FormParser])
    def upload_proxy(self, request):
        """
        multipart/form-data:
          file:     <binario>          (requerido)
          scope:    "producto/<id>"    (opcional, default "misc")
          filename: nombre.png         (opcional, fallback al name del File)

        Respuesta:
          { ok, key, bucket, etag, content_type, size, error }
        """
        f = request.FILES.get("file")
        if f is None:
            return Response({"detail": "Falta 'file'"}, status=400)
        scope        = (request.data.get("scope") or "misc").strip()
        filename     = (request.data.get("filename") or f.name).strip()
        content_type = f.content_type or "application/octet-stream"

        key = make_object_key(scope, filename)
        result = put_object_stream(key, f, content_type=content_type, length=f.size)
        result["content_type"] = content_type
        result["size"]         = f.size
        return Response(result, status=200 if result.get("ok") else 502)

    # ── Download-proxy: stream GET vía Django (HTTPS) en vez de exponer
    #    la URL HTTP de MinIO. Permite que <img>/<iframe> en el FE
    #    pidan archivos sin mixed-content. Usa GET para que cacheen. ──
    @action(detail=False, methods=["get"], url_path="download",
            permission_classes=[AllowAny])   # la key UUID actúa como secret
    def download(self, request):
        """
        GET /api/storage/download/?key=<key>

        Streamea el objeto desde MinIO. Permite acceso sin auth porque
        las keys contienen un UUID hex de 8 chars que es difícil de
        adivinar (security through obscurity tipo signed-URL pre-S3).
        Las keys solo se conocen leyendo el modelo del usuario, que SÍ
        requiere auth. Para uso público de img/iframe en pages HTTPS.

        Devuelve 404 si no existe, 503 si MinIO está offline.
        """
        key = request.query_params.get("key")
        bkt = request.query_params.get("bucket") or None
        if not key:
            return Response({"detail": "Falta 'key'"}, status=400)
        try:
            resp = get_object_stream(key, bucket=bkt)
        except Exception as e:
            cls = type(e).__name__
            if "NoSuchKey" in cls:
                raise Http404("objeto no existe")
            log.error("download(%s) falló: %s", key, e)
            return Response({"detail": str(e)}, status=502)
        if resp is None:
            return Response({"detail": "minio_unavailable"}, status=503)

        # Adivina el content-type del header de MinIO o por extensión.
        ct = resp.headers.get("Content-Type") or "application/octet-stream"
        # Cache 5 min en el browser para previews repetidos.
        streamer = StreamingHttpResponse(
            resp.stream(64 * 1024),   # chunks de 64KB
            content_type=ct,
        )
        streamer["Cache-Control"] = "private, max-age=300"
        # Sugerencia de filename (último segmento de la key)
        fname = key.split("/")[-1]
        streamer["Content-Disposition"] = f'inline; filename="{fname}"'
        cl = resp.headers.get("Content-Length")
        if cl:
            streamer["Content-Length"] = cl
        # Cerramos el upstream cuando el response termine
        streamer._resource_closers.append(lambda: (resp.close(), resp.release_conn()))
        return streamer

    # ── DELETE genérico: borra un objeto del bucket por su key.
    #    El llamador (Producto/Expediente/etc.) es responsable de
    #    setear ficha_url=NULL en su columna en la misma transacción. ──
    @action(detail=False, methods=["delete", "post"], url_path="delete")
    def delete_obj(self, request):
        """
        DELETE /api/storage/delete/?key=<key>
          o
        POST   /api/storage/delete/  { key: <key> }

        Respuesta:
            { ok, deleted, available, error, key }
        """
        src = request.query_params if request.method == "DELETE" else request.data
        key = src.get("key")
        bkt = src.get("bucket") or None
        if not key:
            return Response({"detail": "Falta 'key'"}, status=400)
        result = delete_object(key, bucket=bkt)
        result["key"] = key
        return Response(result, status=200 if result.get("ok") else 502)

    @action(detail=False, methods=["post"])
    def paperless_ingest(self, request):
        """
        Dos modos de entrada:
            A) multipart/form-data: file=<binario>, filename, title, correspondent, ...
            B) JSON: { filename, title, body_b64 }

        Respuesta:
            { ok, task_id, status, error, expediente_id?, documento_id? }
        """
        title         = request.data.get("title") or None
        filename      = request.data.get("filename") or "documento.pdf"
        correspondent = request.data.get("correspondent") or None
        document_type = request.data.get("document_type") or None
        tags          = request.data.get("tags") or None

        # Relación con expediente/documento para auditar el OCR (opcional)
        expediente_id = request.data.get("expediente_id") or None
        documento_id  = request.data.get("documento_id")  or None

        # ── Leer bytes del archivo ─────
        file_bytes: bytes
        f = request.FILES.get("file")
        if f is not None:
            file_bytes = f.read()
            filename   = filename or f.name
        else:
            b64 = request.data.get("body_b64") or request.data.get("body") or ""
            if not b64:
                return Response({"detail": "Falta 'file' (multipart) o 'body_b64' (JSON)."}, status=400)
            try:
                file_bytes = base64.b64decode(b64)
            except Exception:
                return Response({"detail": "body_b64 no es base64 válido."}, status=400)

        result = paperless_ingest(
            file_bytes    = file_bytes,
            filename      = filename,
            title         = title,
            correspondent = correspondent,
            document_type = document_type,
            tags          = tags,
        )
        result["expediente_id"] = expediente_id
        result["documento_id"]  = documento_id
        return Response(result)

    @action(detail=False, methods=["get"])
    def healthz(self, request):
        """Diagnóstico rápido de los gateways de storage + SMTP."""
        from django.conf import settings
        minio_ok = ensure_bucket()
        paperless_configured = bool(
            getattr(settings, "PAPERLESS_URL", "") and
            getattr(settings, "PAPERLESS_TOKEN", "")
        )
        # SMTP — sin enviar, solo verificamos config.
        email_pwd_set = bool(getattr(settings, "EMAIL_HOST_PASSWORD", "") or "")
        return Response({
            "minio_available":        minio_ok,
            "minio_bucket":           getattr(settings, "MINIO_BUCKET", ""),
            "paperless_configured":   paperless_configured,
            "smtp": {
                "backend":            getattr(settings, "EMAIL_BACKEND", "?"),
                "host":               getattr(settings, "EMAIL_HOST", ""),
                "port":               getattr(settings, "EMAIL_PORT", 0),
                "use_ssl":            getattr(settings, "EMAIL_USE_SSL", False),
                "use_tls":            getattr(settings, "EMAIL_USE_TLS", False),
                "user":               getattr(settings, "EMAIL_HOST_USER", ""),
                "password_set":       email_pwd_set,
                "from":               getattr(settings, "DEFAULT_FROM_EMAIL", ""),
                "reply_to":           getattr(settings, "DEFAULT_REPLY_TO", ""),
            },
        })

    @action(detail=False, methods=["post"], url_path="test-smtp")
    def test_smtp(self, request):
        """Envía un email de prueba real al destinatario que se pase.

        POST body:
          { "to": "destinatario@ejemplo.com", "subject": "...", "body": "..." }

        Útil para validar que las credenciales de mail.mwt.one están bien
        configuradas en el .env del VPS sin pasar por el flujo de reset.
        Sólo admin/superuser.
        """
        # Permission gate
        user = request.user
        is_admin = (
            getattr(user, "is_superuser", False)
            or (getattr(user, "role", "") or "").lower() in ("superadmin", "admin")
        )
        if not is_admin:
            return Response({"detail": "Solo admin/superadmin."}, status=403)

        from .services import send_test_email
        to      = request.data.get("to")
        subject = request.data.get("subject") or "[MWT.ONE] Test SMTP"
        body    = request.data.get("body")    or "Este es un correo de prueba enviado desde /api/storage/test-smtp/."

        if not to:
            return Response({"detail": "Falta 'to' (destinatario)."}, status=400)

        result = send_test_email(to=to, subject=subject, body=body)
        return Response(result, status=200 if result.get("ok") else 502)
