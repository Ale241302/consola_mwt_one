"""
apps.correo · views (Etapa 3)
Bandeja (mensajes + adjuntos), contactos, grupos, estilo y envíos.

RBAC: required_module="correo".
"""
from __future__ import annotations

import hashlib
import uuid

from django.db import connection
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.permissions import user_is_ceo_or_admin

from . import services
from .models import Adjunto, Contacto, Envio, Estilo, Grupo, Mensaje, MensajeExpediente
from .serializers import (AdjuntoSerializer, ContactoSerializer, EnvioSerializer,
                          EstiloSerializer, GrupoSerializer, MensajeSerializer)


def _paging(request):
    try:
        limit = int(request.query_params.get("limit")) if request.query_params.get("limit") else None
        if limit is not None and limit <= 0:
            limit = None
    except (TypeError, ValueError):
        limit = None
    try:
        offset = max(0, int(request.query_params.get("offset"))) if request.query_params.get("offset") else 0
    except (TypeError, ValueError):
        offset = 0
    return limit, offset


class MensajeViewSet(viewsets.ViewSet):
    required_module = "correo"
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def list(self, request):
        qs = Mensaje.objects.filter(is_active=True)
        qp = request.query_params
        for param, field in (("direction", "direction"), ("expediente", "expediente_id"),
                             ("match_status", "match_status"), ("proforma", "proforma"),
                             ("sap", "sap")):
            v = qp.get(param)
            if v:
                qs = qs.filter(**{field: v.upper() if field == "direction" else v})
        if qp.get("no_leidos") in ("1", "true", "True"):
            qs = qs.filter(is_read=False)
        if qp.get("por_vincular") in ("1", "true", "True"):
            qs = qs.filter(match_status="POR_VINCULAR")
        v = qp.get("q")
        if v:
            qs = qs.filter(Q(subject__icontains=v) | Q(body_text__icontains=v) |
                           Q(from_email__icontains=v) | Q(proforma__icontains=v) | Q(sap__icontains=v))
        v = qp.get("desde")
        if v:
            qs = qs.filter(sent_at__date__gte=v)
        v = qp.get("hasta")
        if v:
            qs = qs.filter(sent_at__date__lte=v)
        qs = qs.order_by("-sent_at", "-created_at")
        limit, offset = _paging(request)
        if limit is not None:
            return Response({"count": qs.count(), "limit": limit, "offset": offset,
                             "results": MensajeSerializer(list(qs[offset:offset + limit]), many=True).data})
        return Response(MensajeSerializer(list(qs), many=True).data)

    def retrieve(self, request, pk=None):
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        data = MensajeSerializer(m).data
        data["adjuntos"] = AdjuntoSerializer(
            Adjunto.objects.filter(mensaje_id=m.id), many=True).data
        data["expedientes"] = services.expedientes_de(m.id)
        return Response(data)

    @action(detail=True, methods=["post"])
    def vincular(self, request, pk=None):
        """Vincula el mensaje a uno o varios expedientes."""
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        ids = request.data.get("expediente_ids")
        if not ids:
            single = request.data.get("expediente_id")
            ids = [single] if single else []
        if not ids:
            return Response({"detail": "expediente_id(s) requerido(s)"}, status=400)
        services.vincular_expedientes(m.id, ids)
        m.expediente_id = ids[0]
        m.match_status = "VINCULADO"
        m.match_reason = "manual"
        m.save(update_fields=["expediente_id", "match_status", "match_reason", "updated_at"])
        data = MensajeSerializer(m).data
        data["expedientes"] = services.expedientes_de(m.id)
        return Response(data)

    @action(detail=True, methods=["post"])
    def desvincular(self, request, pk=None):
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        eid = request.data.get("expediente_id")
        if eid:
            services.desvincular_expediente(m.id, eid)
        return Response({"expedientes": services.expedientes_de(m.id)})

    @action(detail=True, methods=["post"])
    def ignorar(self, request, pk=None):
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        m.match_status = "IGNORADO"
        m.save(update_fields=["match_status", "updated_at"])
        return Response(MensajeSerializer(m).data)

    @action(detail=True, methods=["post"], url_path="marcar-leido")
    def marcar_leido(self, request, pk=None):
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        m.is_read = True
        m.save(update_fields=["is_read", "updated_at"])
        return Response(MensajeSerializer(m).data)

    @action(detail=False, methods=["get"], url_path="por-expediente")
    def por_expediente(self, request):
        exp = request.query_params.get("expediente")
        if not exp:
            return Response({"detail": "expediente requerido"}, status=400)
        ids = set(MensajeExpediente.objects.filter(
            expediente_id=exp).values_list("mensaje_id", flat=True))
        qs = (Mensaje.objects.filter(is_active=True)
              .filter(Q(expediente_id=exp) | Q(id__in=ids))
              .order_by("-sent_at", "-created_at"))
        return Response(MensajeSerializer(list(qs), many=True).data)

    @action(detail=False, methods=["get"], url_path="por-vincular")
    def por_vincular(self, request):
        """Cola dedicada: mensajes que no se pudieron correlacionar."""
        qs = (Mensaje.objects.filter(is_active=True, match_status="POR_VINCULAR")
              .order_by("-sent_at", "-created_at"))
        return Response({"count": qs.count(),
                         "results": MensajeSerializer(list(qs), many=True).data})

    @action(detail=False, methods=["post"])
    def importar(self, request):
        """Importa un mensaje ya parseado (MCP Hostinger / otra fuente)."""
        return Response(services.importar_mensaje(dict(request.data or {}),
                                                  getattr(request.user, "id", None)))

    @action(detail=False, methods=["post"])
    def sync(self, request):
        direction = request.data.get("direction")
        limit = int(request.data.get("limit") or 25)
        return Response(services.sync_mailbox(direction=direction, limit=limit))

    @action(detail=False, methods=["get"], url_path="buscar")
    def buscar(self, request):
        """Alias de búsqueda sobre la bandeja."""
        return self.list(request)

    @action(detail=True, methods=["get", "post"], url_path="adjuntos")
    def adjuntos(self, request, pk=None):
        m = Mensaje.objects.filter(pk=pk, is_active=True).first()
        if not m:
            return Response({"detail": "Mensaje no existe"}, status=404)
        if request.method == "GET":
            qs = Adjunto.objects.filter(mensaje_id=m.id)
            return Response(AdjuntoSerializer(qs, many=True).data)
        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "file requerido"}, status=400)
        data = f.read()
        services._subir_adjunto(m.id, {
            "filename": f.name,
            "mimetype": f.content_type or "application/octet-stream",
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "data": data,
        })
        m.has_attachments = True
        m.save(update_fields=["has_attachments", "updated_at"])
        return Response(AdjuntoSerializer(Adjunto.objects.filter(mensaje_id=m.id), many=True).data,
                        status=201)

    @action(detail=True, methods=["get"], url_path=r"adjuntos/(?P<aid>[^/.]+)/url")
    def adjunto_url(self, request, pk=None, aid=None):
        info = services.adjunto_signed_url(aid)
        if not info:
            return Response({"detail": "Adjunto sin archivo almacenado"}, status=404)
        return Response(info)

    @action(detail=False, methods=["get"])
    def diagnostico(self, request):
        """B1/B2 · prueba claves LLM y conexión IMAP (admin/CEO)."""
        if not user_is_ceo_or_admin(request.user):
            return Response({"detail": "Solo admin/CEO"}, status=403)
        return Response({"llm": services.diagnostico_llm(),
                         "imap": services.diagnostico_imap(),
                         "hostinger_mail": services.diagnostico_hostinger()})


class ContactoViewSet(viewsets.ViewSet):
    required_module = "correo"

    def list(self, request):
        qs = Contacto.objects.filter(is_active=True)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(nombre__icontains=q) | Q(email__icontains=q) |
                           Q(empresa__icontains=q) | Q(marca__icontains=q))
        return Response(ContactoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        o = Contacto.objects.filter(pk=pk, is_active=True).first()
        if not o:
            return Response({"detail": "Contacto no existe"}, status=404)
        return Response(ContactoSerializer(o).data)

    def create(self, request):
        data = dict(request.data or {})
        data["id"] = data.get("id") or str(uuid.uuid4())
        s = ContactoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=data["id"])
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        o = Contacto.objects.filter(pk=pk).first()
        if not o:
            return Response({"detail": "Contacto no existe"}, status=404)
        s = ContactoSerializer(o, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    partial_update = update

    def destroy(self, request, pk=None):
        Contacto.objects.filter(pk=pk).update(is_active=False, updated_at=timezone.now())
        return Response(status=204)


class GrupoViewSet(viewsets.ViewSet):
    required_module = "correo"

    def list(self, request):
        return Response(GrupoSerializer(Grupo.objects.filter(is_active=True), many=True).data)

    def create(self, request):
        data = dict(request.data or {})
        data["id"] = data.get("id") or str(uuid.uuid4())
        s = GrupoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=data["id"])
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        o = Grupo.objects.filter(pk=pk).first()
        if not o:
            return Response({"detail": "Grupo no existe"}, status=404)
        s = GrupoSerializer(o, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    partial_update = update

    def destroy(self, request, pk=None):
        Grupo.objects.filter(pk=pk).update(is_active=False, updated_at=timezone.now())
        return Response(status=204)


class EstiloViewSet(viewsets.ViewSet):
    required_module = "correo"

    def list(self, request):
        return Response(EstiloSerializer(Estilo.objects.order_by("-version"), many=True).data)

    def _current(self):
        return Estilo.objects.order_by("-version").first()

    @action(detail=False, methods=["get"])
    def actual(self, request):
        o = self._current()
        return Response(EstiloSerializer(o).data if o else {})

    @action(detail=False, methods=["post"])
    def publicar(self, request):
        last = self._current()
        next_v = (last.version + 1) if last else 1
        contenido = (request.data.get("contenido") or "").strip()
        if not contenido:
            return Response({"detail": "contenido requerido"}, status=400)
        e = Estilo.objects.create(
            id=uuid.uuid4(), version=next_v, contenido=contenido,
            reglas=request.data.get("reglas") or {},
            created_by_id=getattr(request.user, "id", None),
        )
        return Response(EstiloSerializer(e).data, status=201)

    @action(detail=False, methods=["post"])
    def aprender(self, request):
        """Aprende del par (borrador ↔ enviado/corregido) y acumula la preferencia."""
        texto_es = (request.data.get("texto_es") or "").strip()
        enviado = (request.data.get("texto_enviado") or "").strip()
        if not texto_es and not enviado:
            return Response({"detail": "texto requerido"}, status=400)
        learned = services.aprender_estilo(texto_es, enviado or None,
                                           getattr(request.user, "id", None))
        return Response({"ok": True, "learned": learned})


class EnvioViewSet(viewsets.ViewSet):
    required_module = "correo"

    def list(self, request):
        qs = Envio.objects.all()
        exp = request.query_params.get("expediente")
        if exp:
            qs = qs.filter(expediente_id=exp)
        est = request.query_params.get("estado")
        if est:
            qs = qs.filter(estado=est.upper())
        return Response(EnvioSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        e = Envio.objects.filter(pk=pk).first()
        if not e:
            return Response({"detail": "Envío no existe"}, status=404)
        return Response(EnvioSerializer(e).data)

    def create(self, request):
        data = dict(request.data or {})
        data["id"] = data.get("id") or str(uuid.uuid4())
        data["created_by_id"] = str(getattr(request.user, "id", "") or "") or None
        if data.get("expediente_id") and not data.get("oc_id"):
            with connection.cursor() as c:
                c.execute("SELECT oc_id::text FROM expedientes.expediente WHERE id=%s::uuid",
                          [str(data["expediente_id"])])
                row = c.fetchone()
                if row:
                    data["oc_id"] = row[0]
        s = EnvioSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=data["id"])
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        e = Envio.objects.filter(pk=pk).first()
        if not e:
            return Response({"detail": "Envío no existe"}, status=404)
        s = EnvioSerializer(e, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    partial_update = update

    @action(detail=True, methods=["post"])
    def traducir(self, request, pk=None):
        e = Envio.objects.filter(pk=pk).first()
        if not e:
            return Response({"detail": "Envío no existe"}, status=404)
        idioma = (request.data.get("idioma") or e.idioma or "").strip()
        origen = (request.data.get("idioma_origen") or "es").strip()
        if not idioma:
            return Response({"detail": "idioma requerido"}, status=400)
        texto = request.data.get("texto") or e.body_es
        trad = services.traducir(texto, idioma, origen)
        if trad is None:
            return Response({"detail": "traduccion_no_disponible (falta OPENAI_API_KEY)"}, status=503)
        e.idioma = idioma
        e.body_traducido = trad
        e.save(update_fields=["idioma", "body_traducido", "updated_at"])
        return Response(EnvioSerializer(e).data)

    @action(detail=True, methods=["post"])
    def enviar(self, request, pk=None):
        e = Envio.objects.filter(pk=pk).first()
        if not e:
            return Response({"detail": "Envío no existe"}, status=404)
        if e.estado == "ENVIADO":
            return Response({"detail": "ya_enviado"}, status=400)
        return Response(services.enviar_envio(e, getattr(request.user, "id", None)))

    @action(detail=True, methods=["post"])
    def corregir(self, request, pk=None):
        """Guarda la corrección del borrador y aprende de ella (estilo)."""
        e = Envio.objects.filter(pk=pk).first()
        if not e:
            return Response({"detail": "Envío no existe"}, status=404)
        antes = e.body_es or ""
        nuevo = request.data.get("body_es")
        if nuevo is not None:
            e.body_es = nuevo
            e.save(update_fields=["body_es", "updated_at"])
        learned = services.aprender_estilo(antes, nuevo or antes,
                                           getattr(request.user, "id", None))
        return Response({"ok": True, "envio": EnvioSerializer(e).data, "learned": learned})
