"""
=====================================================================
MWT.ONE · apps.tickets.views
Agente responsable: [AG-02 · AG-BACKEND]

Endpoints:
  GET    /api/tickets/                  -> listado (filtrado por rol)
  POST   /api/tickets/                  -> crea ticket + dispara emails
  GET    /api/tickets/<id>/             -> detalle + hilo + adjuntos
  PATCH  /api/tickets/<id>/             -> editar (solo si NO finalizado)
  DELETE /api/tickets/<id>/             -> soft-delete (solo si NO finalizado)
  POST   /api/tickets/<id>/messages/    -> agrega mensaje (chat)
  POST   /api/tickets/<id>/attachments/ -> sube adjunto (MinIO)
  POST   /api/tickets/<id>/transition/  -> cambia status (admin para los terminales)
  GET    /api/tickets/<id>/attachments/<att_id>/download/ -> signed URL
  GET    /api/tickets/dashboard/        -> KPIs (admin only)
  GET    /api/tickets/reasons/          -> catalogo motivos
  GET    /api/tickets/statuses/         -> catalogo estados

Reglas:
  - Usuario estandar (rol distinto a CEO/admin/manager) solo ve sus
    propios tickets.
  - Solo admin puede pasar a EN_REVISION/RESUELTO/FINALIZADO.
  - Cuando status='FINALIZADO' el ticket es INMUTABLE: rechazamos
    PATCH/DELETE/messages/attachments/transition con 409.
=====================================================================
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import timedelta
from typing import Optional

from django.db import connection, transaction
from django.db.models import Avg, Count
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response

from apps.storage.services import (
    make_object_key, put_object_stream, generate_signed_url, delete_object,
)

from .models import (
    Ticket, TicketMessage, TicketAttachment,
    ReasonCat, StatusCat,
)
from .serializers import (
    TicketSerializer, TicketListSerializer,
    TicketMessageSerializer, TicketAttachmentSerializer,
    ReasonCatSerializer, StatusCatSerializer,
)
from .tasks import (
    enqueue_new_ticket_emails,
    enqueue_message_email,
    enqueue_status_change_email,
)

log = logging.getLogger(__name__)


# Roles considerados staff (pueden ver todos los tickets, transicionar
# estados restringidos y ver el dashboard). Mismo set que el resto del
# proyecto (R3 · POL_VISIBILIDAD).
# Sprint 2026-05-22 · spec del CEO: SOLO superadmin/admin bypassean scope.
# `ceo`/`manager` pasan a ser users con scope normal (ven solo sus tickets,
# no la lista global). Alineado con apps.core.scoped_querysets.BYPASS_ROLES.
_ADMIN_ROLES = {"admin", "superadmin"}

# Mapa MIME → file_kind (whitelist explicita: PDF, DOCX, JPG, PNG)
_ALLOWED_MIME = {
    "application/pdf":                                                 "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/msword":                                              "DOCX",
    "image/jpeg":                                                      "JPG",
    "image/jpg":                                                       "JPG",
    "image/png":                                                       "PNG",
}
_ALLOWED_EXT = {
    "pdf":  "PDF",
    "docx": "DOCX",
    "doc":  "DOCX",
    "jpg":  "JPG",
    "jpeg": "JPG",
    "png":  "PNG",
}
_MAX_BYTES = 25 * 1024 * 1024   # 25 MB por adjunto


def _role(request) -> str:
    if getattr(request, "auth", None):
        return (request.auth.get("role") or "").lower()
    if getattr(request, "user", None):
        return (getattr(request.user, "role", "") or "").lower()
    return ""


def _is_admin(request) -> bool:
    return _role(request) in _ADMIN_ROLES


def _user_id(request) -> Optional[str]:
    u = getattr(request, "user", None)
    return getattr(u, "id", None) if u else None


def _detect_kind(file) -> str:
    mime = (getattr(file, "content_type", "") or "").lower()
    if mime in _ALLOWED_MIME:
        return _ALLOWED_MIME[mime]
    name = (getattr(file, "name", "") or "").lower()
    m = re.search(r"\.([a-z0-9]+)$", name)
    if m and m.group(1) in _ALLOWED_EXT:
        return _ALLOWED_EXT[m.group(1)]
    return "OTHER"


def _can_write(ticket: Ticket, request) -> Optional[Response]:
    """Devuelve un Response de error si el ticket no puede mutarse, o
    None si el caller puede continuar."""
    if not ticket.is_active:
        return Response({"detail": "Ticket eliminado."}, status=410)
    if ticket.status == "FINALIZADO":
        return Response(
            {"detail": "Ticket finalizado: ya no acepta cambios."},
            status=409,
        )
    if not _is_admin(request):
        # Usuario estandar solo puede tocar lo suyo.
        if str(ticket.user_id) != str(_user_id(request) or ""):
            return Response({"detail": "No autorizado."}, status=403)
    return None


# =====================================================================
# ViewSet principal
# =====================================================================
class TicketViewSet(viewsets.ViewSet):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    # ── List / Retrieve ─────────────────────────────────────
    def list(self, request):
        qs = Ticket.objects.filter(is_active=True)
        if not _is_admin(request):
            qs = qs.filter(user_id=str(_user_id(request) or ""))
        # Filtros opcionales
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        reason = request.query_params.get("reason")
        if reason:
            qs = qs.filter(reason=reason)
        q = (request.query_params.get("q") or "").strip()
        if q:
            from django.db.models import Q
            qs = qs.filter(
                Q(description__icontains=q) |
                Q(user_email__icontains=q) |
                Q(user_full_name__icontains=q)
            )
        qs = qs.order_by("-created_at")
        return Response(TicketListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk, is_active=True)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)
        if not _is_admin(request) and str(t.user_id) != str(_user_id(request) or ""):
            return Response({"detail": "No autorizado."}, status=403)
        return Response(TicketSerializer(t).data)

    # ── Create ──────────────────────────────────────────────
    def create(self, request):
        u = getattr(request, "user", None)
        if not getattr(u, "id", None):
            return Response({"detail": "Sesion requerida."}, status=401)

        data = request.data or {}
        ser = TicketSerializer(data=data)
        ser.is_valid(raise_exception=True)
        payload = ser.validated_data

        new_id = uuid.uuid4()
        with transaction.atomic():
            t = Ticket.objects.create(
                id              = new_id,
                user_id         = str(u.id),
                user_email      = getattr(u, "email", "") or "",
                user_full_name  = getattr(u, "full_name", "") or "",
                context_url     = (data.get("context_url") or "")[:512],
                reason          = payload.get("reason") or "OTRO",
                description     = payload["description"],
                status          = "ABIERTO",
                is_active       = True,
            )

        # Side-effect: emails (encola en Celery o sincrono fallback)
        try:
            enqueue_new_ticket_emails(str(t.id))
        except Exception as e:
            log.warning("enqueue_new_ticket_emails fallo: %s", e)

        return Response(TicketSerializer(t).data, status=201)

    # ── Update (parcial) ────────────────────────────────────
    def update(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)
        guard = _can_write(t, request)
        if guard is not None:
            return guard

        data = request.data or {}
        # Solo description y reason son editables. status va por /transition/.
        editable = {}
        if "description" in data:
            v = (data.get("description") or "").strip()
            if v:
                editable["description"] = v
        if "reason" in data and data["reason"]:
            editable["reason"] = data["reason"]
        for k, v in editable.items():
            setattr(t, k, v)
        t.save(update_fields=list(editable.keys()) + ["updated_at"]
               if editable else None)
        return Response(TicketSerializer(t).data)
    partial_update = update

    # ── Destroy (soft-delete) ───────────────────────────────
    def destroy(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk)
        except Ticket.DoesNotExist:
            return Response(status=204)
        guard = _can_write(t, request)
        if guard is not None:
            return guard
        t.is_active = False
        t.save(update_fields=["is_active", "updated_at"])
        return Response(status=204)

    # ── Catalogos ──────────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="reasons")
    def reasons(self, request):
        qs = ReasonCat.objects.filter(is_active=True).order_by("orden", "codigo")
        return Response(ReasonCatSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"], url_path="statuses")
    def statuses(self, request):
        qs = StatusCat.objects.filter(is_active=True).order_by("orden", "codigo")
        return Response(StatusCatSerializer(qs, many=True).data)

    # ── Mensajes (chat) ────────────────────────────────────
    @action(detail=True, methods=["get", "post"], url_path="messages")
    def messages(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk, is_active=True)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)

        if not _is_admin(request) and str(t.user_id) != str(_user_id(request) or ""):
            return Response({"detail": "No autorizado."}, status=403)

        if request.method == "GET":
            qs = TicketMessage.objects.filter(ticket_id=t.id, is_active=True).order_by("created_at")
            return Response(TicketMessageSerializer(qs, many=True).data)

        # POST: crea mensaje (rechazado si finalizado)
        guard = _can_write(t, request)
        if guard is not None:
            return guard

        u = getattr(request, "user", None)
        ser = TicketMessageSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        content = ser.validated_data["content"]

        admin_now = _is_admin(request)
        now = timezone.now()

        with transaction.atomic():
            m = TicketMessage.objects.create(
                id           = uuid.uuid4(),
                ticket_id    = t.id,
                sender_id    = str(getattr(u, "id", "") or ""),
                sender_email = getattr(u, "email", "") or "",
                sender_role  = _role(request),
                content      = content,
            )
            # Auto-transicion: si admin responde por primera vez y el
            # ticket esta ABIERTO -> EN_REVISION + first_response_at.
            updates = []
            if admin_now and t.status == "ABIERTO":
                t.status = "EN_REVISION"
                updates.append("status")
            if admin_now and not t.first_response_at:
                t.first_response_at = now
                updates.append("first_response_at")
            if updates:
                t.save(update_fields=updates + ["updated_at"])

        # Side-effect: notificar al admin Y al usuario que hay un mensaje
        # nuevo en el hilo. Si el rol cambio a EN_REVISION en este request,
        # tambien dispara el correo de cambio de estado (transparente).
        try:
            enqueue_message_email(str(t.id), str(m.id))
        except Exception as e:
            log.warning("enqueue_message_email fallo: %s", e)
        if "status" in updates:
            try:
                enqueue_status_change_email(str(t.id), "ABIERTO", t.status)
            except Exception as e:
                log.warning("enqueue_status_change_email (auto) fallo: %s", e)

        return Response(TicketMessageSerializer(m).data, status=201)

    # ── Adjuntos: subida directa a MinIO ───────────────────
    @action(
        detail=True,
        methods=["post"],
        url_path="attachments",
        parser_classes=[MultiPartParser, FormParser],
    )
    def attachments(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk, is_active=True)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)
        guard = _can_write(t, request)
        if guard is not None:
            return guard

        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "Falta archivo (campo 'file')."}, status=400)

        if f.size and f.size > _MAX_BYTES:
            return Response(
                {"detail": f"Archivo excede el limite de {_MAX_BYTES // (1024*1024)} MB."},
                status=413,
            )

        kind = _detect_kind(f)
        if kind == "OTHER":
            return Response(
                {"detail": "Tipo no permitido. Solo PDF, DOCX, JPG, PNG."},
                status=415,
            )

        # message_id opcional: si viene, el adjunto pertenece a ese mensaje.
        message_id_raw = (request.data.get("message_id") or "").strip()
        message_uuid: Optional[uuid.UUID] = None
        if message_id_raw:
            try:
                message_uuid = uuid.UUID(message_id_raw)
            except (ValueError, TypeError):
                return Response({"detail": "message_id invalido."}, status=400)
            if not TicketMessage.objects.filter(
                pk=str(message_uuid), ticket_id=t.id, is_active=True,
            ).exists():
                return Response({"detail": "message_id no pertenece al ticket."},
                                status=400)

        # Subida a MinIO
        scope = f"tickets/{t.id}"
        key   = make_object_key(scope, getattr(f, "name", "archivo"))
        try:
            up = put_object_stream(
                key=key,
                file_stream=f,
                content_type=getattr(f, "content_type", "application/octet-stream"),
                length=getattr(f, "size", -1) or -1,
            )
        except Exception as e:
            log.exception("ticket attachment: put_object_stream fallo: %s", e)
            return Response({"detail": "Fallo al subir archivo."}, status=502)
        if not up.get("ok"):
            return Response({"detail": f"MinIO: {up.get('error')}"}, status=502)

        att = TicketAttachment.objects.create(
            id              = uuid.uuid4(),
            ticket_id       = t.id if not message_uuid else None,
            message_id      = str(message_uuid) if message_uuid else None,
            file_object_key = key,
            file_name       = getattr(f, "name", "archivo")[:255],
            file_size_bytes = getattr(f, "size", None) or None,
            file_mime       = (getattr(f, "content_type", "") or "")[:96] or None,
            file_kind       = kind,
            uploaded_by_id  = _user_id(request),
        )
        return Response(TicketAttachmentSerializer(att).data, status=201)

    # ── Adjunto: signed URL para descarga ──────────────────
    @action(
        detail=True,
        methods=["get"],
        url_path=r"attachments/(?P<att_id>[0-9a-f-]{36})/download",
    )
    def attachment_download(self, request, pk=None, att_id=None):
        try:
            t = Ticket.objects.get(pk=pk, is_active=True)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)
        if not _is_admin(request) and str(t.user_id) != str(_user_id(request) or ""):
            return Response({"detail": "No autorizado."}, status=403)
        try:
            att = TicketAttachment.objects.get(pk=att_id, is_active=True)
        except TicketAttachment.DoesNotExist:
            return Response({"detail": "Adjunto no existe."}, status=404)
        if att.ticket_id and str(att.ticket_id) != str(t.id):
            return Response({"detail": "Adjunto no pertenece al ticket."}, status=400)
        if att.message_id and not TicketMessage.objects.filter(
            pk=str(att.message_id), ticket_id=t.id, is_active=True,
        ).exists():
            return Response({"detail": "Adjunto no pertenece al ticket."}, status=400)

        signed = generate_signed_url(key=att.file_object_key, kind="get", ttl=900)
        return Response({
            "url":       signed.get("url"),
            "expires_at":signed.get("expires_at"),
            "file_name": att.file_name,
            "file_mime": att.file_mime,
        })

    # ── Transiciones de estado ─────────────────────────────
    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, pk=None):
        try:
            t = Ticket.objects.get(pk=pk, is_active=True)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket no existe."}, status=404)
        if t.status == "FINALIZADO":
            return Response(
                {"detail": "Ticket finalizado: no admite mas transiciones."},
                status=409,
            )
        target = (request.data.get("status") or "").upper()
        if target not in dict(Ticket.STATUS_CHOICES):
            return Response({"detail": "Estado destino invalido."}, status=400)

        # Reglas de transicion segun rol
        admin_now = _is_admin(request)
        if not admin_now:
            return Response(
                {"detail": "Solo admin puede cambiar el estado."},
                status=403,
            )

        previous_status = t.status

        updates = {"status": target}
        if target == "FINALIZADO":
            updates["finalized_at"]    = timezone.now()
            updates["finalized_by_id"] = _user_id(request)

        for k, v in updates.items():
            setattr(t, k, v)
        t.save(update_fields=list(updates.keys()) + ["updated_at"])

        # Notificar a admin + usuario del cambio de estado.
        if previous_status != target:
            try:
                enqueue_status_change_email(str(t.id), previous_status, target)
            except Exception as e:
                log.warning("enqueue_status_change_email fallo: %s", e)

        return Response(TicketSerializer(t).data)

    # ── Dashboard admin ────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="dashboard")
    def dashboard(self, request):
        if not _is_admin(request):
            return Response({"detail": "Solo admin."}, status=403)

        # Counts por estado
        rows = (
            Ticket.objects
            .filter(is_active=True)
            .values("status")
            .annotate(c=Count("id"))
        )
        by_status = {r["status"]: r["c"] for r in rows}
        abiertos    = by_status.get("ABIERTO", 0)
        en_revision = by_status.get("EN_REVISION", 0)
        resueltos   = by_status.get("RESUELTO", 0)
        cerrados    = by_status.get("FINALIZADO", 0)

        # Tiempo promedio de respuesta:
        #   first_response_at - created_at sobre tickets que tienen ambos.
        avg_seconds = None
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)))
                    FROM tickets.ticket
                    WHERE is_active = TRUE
                      AND first_response_at IS NOT NULL
                      AND created_at IS NOT NULL
                """)
                row = c.fetchone()
                if row and row[0] is not None:
                    avg_seconds = float(row[0])
        except Exception as e:
            log.warning("dashboard avg_seconds fallo: %s", e)

        avg_human = None
        if avg_seconds is not None:
            td = timedelta(seconds=int(avg_seconds))
            total_min = int(td.total_seconds() // 60)
            h, m = divmod(total_min, 60)
            avg_human = f"{h}h {m}m" if h else f"{m}m"

        return Response({
            "abiertos":    abiertos,
            "en_revision": en_revision,
            "resueltos":   resueltos,
            "cerrados":    cerrados,
            "total":       abiertos + en_revision + resueltos + cerrados,
            "avg_response_seconds": avg_seconds,
            "avg_response_human":   avg_human,
        })
