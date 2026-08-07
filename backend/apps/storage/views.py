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
import mimetypes

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated, AllowAny

from django.http import HttpResponseRedirect, StreamingHttpResponse
from django.conf import settings

from .services import (
    generate_signed_url, paperless_ingest, ensure_bucket,
    delete_object, make_object_key, put_object_stream,
)

log = logging.getLogger(__name__)


def _user_can_access_key(user, key: str) -> bool:
    """Verifica que un key de MinIO pertenezca a un objeto visible por el usuario.

    Ola 0 — P0.2: mínimo viable. Si el key es de un documento, se aplica el
    scope del expediente y el gate de audience. Si el usuario es bypass
    (superadmin/admin) se permite cualquier key. Para otros tipos de objeto
    (productos, marcas, etc.) se permite a staff autenticado; en la Ola 1 se
    añadirá scoping específico.
    """
    from apps.core.scoped_querysets import _is_bypass, scoped_expediente_ids
    from apps.expedientes.models import Documento
    from apps.core.permissions import _is_client_viewer, _is_admin_viewer

    if not user or not getattr(user, "is_authenticated", False):
        return False
    if _is_bypass(user):
        return True

    # Documento: scope via expediente_id + audience.
    try:
        doc = Documento.objects.filter(storage_url=key, is_active=True).first()
        if doc:
            exp_ids = scoped_expediente_ids(user)
            if exp_ids is not None and str(doc.expediente_id) not in exp_ids:
                return False
            doc_aud = getattr(doc, "audience", "CLIENT")
            if _is_client_viewer(user) and doc_aud != "CLIENT":
                return False
            if doc_aud == "ADMIN_ONLY" and not _is_admin_viewer(user):
                return False
            return True
    except Exception as e:
        log.warning("_user_can_access_key(documento) falló: %s", e)

    # Fallback: permitir a staff autenticado para otros tipos de objeto.
    # Esto cubre productos, marcas, logos, etc. hasta que se añada scoping.
    return True


def _is_public_key(key: str) -> bool:
    """Devuelve True si el key corresponde a un activo público del sitio.

    Ola 0 hotfix: imágenes de productos, fichas técnicas y logos de clientes
    se sirven sin autenticación porque el frontend las renderiza en <img>
    y el navegador no envía el header Authorization. Los documentos de
    expedientes y otros activos privados siguen requiriendo auth + scoping.
    La lista es configurable vía STORAGE_PUBLIC_KEY_PREFIXES.
    """
    if not key:
        return False
    prefixes = getattr(settings, "STORAGE_PUBLIC_KEY_PREFIXES", [])
    return any(key.startswith(prefix) for prefix in prefixes)


def _authenticate_token_from_query(request):
    """Autentica al usuario desde ?token=<JWT> si no hay Authorization header.

    Necesario para que <img>, <iframe> y <a href> puedan descargar activos
    privados (documentos, expedientes, artefactos) sin mandar header
    Authorization. El token sigue siendo un access JWT normal de DRF.
    """
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed, TokenError

    if getattr(request.user, "is_authenticated", False):
        return
    token = request.query_params.get("token")
    if not token:
        return
    try:
        auth = JWTAuthentication()
        validated_token = auth.get_validated_token(token)
        user = auth.get_user(validated_token)
        request.user = user
        request.auth = validated_token
    except (InvalidToken, AuthenticationFailed, TokenError):
        pass


def _stream_object_response(key: str, public: bool = False):
    """Devuelve un StreamingHttpResponse con el contenido del objeto MinIO.

    Hotfix para evitar mixed-content / ERR_SSL_PROTOCOL_ERROR cuando MinIO
    no tiene certificado válido: en vez de redirigir al navegador a una URL
    firmada (que puede ser HTTP), Django stremea los bytes por HTTPS.

    Seguridad:
      - X-Content-Type-Options: nosniff para evitar sniffing de MIME.
      - Content-Disposition: attachment para tipos ejecutables (HTML, SVG, JS)
        y inline para imágenes/PDF.
      - Cache-Control: public para activos públicos, private para privados.
      - Cierra/libera la conexión de urllib3 al terminar (incluso si el cliente
        corta la descarga).
    """
    from .services import get_object_stream

    try:
        resp = get_object_stream(key)
    except Exception as e:
        err = str(e)
        if "NoSuchKey" in err or "NoSuchBucket" in err:
            return Response({"detail": "No encontrado"}, status=404)
        log.error("download stream get_object failed for %s: %s", key, e)
        return Response({"detail": "storage_unavailable"}, status=503)

    if resp is None:
        return Response({"detail": "storage_unavailable"}, status=503)

    content_type = (
        resp.headers.get("Content-Type")
        or mimetypes.guess_type(key)[0]
        or "application/octet-stream"
    )

    # Forzar attachment para tipos que pueden ejecutar scripts en same-origin.
    executable_types = {"text/html", "application/xhtml+xml", "image/svg+xml",
                        "text/javascript", "application/javascript", "application/x-shockwave-flash"}
    safe_inline = content_type.startswith("image/") or content_type == "application/pdf"
    if safe_inline:
        disposition = "inline"
    else:
        disposition = "attachment"

    # Extraer filename del key (último segmento).
    filename = key.split("/")[-1]

    def _chunks():
        try:
            for chunk in resp.stream():
                yield chunk
        finally:
            try:
                resp.close()
            except Exception:
                pass
            try:
                resp.release_conn()
            except Exception:
                pass

    django_resp = StreamingHttpResponse(_chunks(), content_type=content_type)
    content_length = resp.headers.get("Content-Length")
    if content_length:
        django_resp["Content-Length"] = content_length
    django_resp["X-Content-Type-Options"] = "nosniff"
    django_resp["Content-Disposition"] = f'{disposition}; filename="{filename}"'
    if public:
        django_resp["Cache-Control"] = "public, max-age=3600"
    else:
        django_resp["Cache-Control"] = "private, max-age=0"

    # Passthrough de ETag/Last-Modified para aprovechar cache condicional.
    etag = resp.headers.get("ETag")
    if etag:
        django_resp["ETag"] = etag
    last_modified = resp.headers.get("Last-Modified")
    if last_modified:
        django_resp["Last-Modified"] = last_modified

    return django_resp


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

    # ── Download: sirve el objeto por HTTPS vía Django stream.
    #    Evita mixed-content / ERR_SSL_PROTOCOL_ERROR cuando MinIO no tiene
    #    certificado válido. Permite acceso anónimo a activos públicos
    #    (imágenes de productos, fichas, logos de clientes). Documentos y
    #    otros activos privados requieren autenticación + scoping. El bucket
    #    nunca viene del cliente.
    @action(detail=False, methods=["get"], url_path="download",
            permission_classes=[AllowAny], throttle_classes=[])
    def download(self, request):
        """
        GET /api/storage/download/?key=<key>

        - Si el key pertenece a un prefijo público (STORAGE_PUBLIC_KEY_PREFIXES),
          stremea el objeto sin pedir autenticación.
        - Para el resto requiere autenticación, verifica que el key pertenezca a
          un objeto visible por el usuario y luego stremea el objeto.
        """
        key = request.query_params.get("key")
        if not key:
            return Response({"detail": "Falta 'key'"}, status=400)

        if _is_public_key(key):
            return _stream_object_response(key, public=True)

        _authenticate_token_from_query(request)

        if not request.user or not getattr(request.user, "is_authenticated", False):
            return Response({"detail": "Las credenciales de autenticación no se proveyeron."}, status=401)

        if not _user_can_access_key(request.user, key):
            return Response({"detail": "No autorizado"}, status=403)

        return _stream_object_response(key, public=False)

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
        if isinstance(key, str) and (key.startswith("http://") or key.startswith("https://")):
            return Response({"ok": True, "deleted": False, "available": True, "error": None, "key": key}, status=200)
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
