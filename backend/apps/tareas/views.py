"""
apps.tareas · views (Etapa 2)
Catálogo de tareas, agenda por expediente y mesa de trabajo.

RBAC: required_module="tareas" (el permiso global RoleBasedPermission mapea
método→acción: GET=view, POST=create, PATCH/PUT=update, DELETE=delete).
"""
from __future__ import annotations

import uuid
from datetime import date

from django.db import connection
from django.db.models import F, Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import user_is_ceo_or_admin

from . import services
from .models import Tarea, TareaCatalogo, TareaEvento
from .serializers import TareaCatalogoSerializer, TareaEventoSerializer, TareaSerializer

_ABIERTAS = ["RESUELTA", "CANCELADA"]


def _paging(request):
    raw_limit  = request.query_params.get("limit")
    raw_offset = request.query_params.get("offset")
    try:
        limit = int(raw_limit) if raw_limit not in (None, "") else None
        if limit is not None and limit <= 0:
            limit = None
    except (TypeError, ValueError):
        limit = None
    try:
        offset = max(0, int(raw_offset)) if raw_offset not in (None, "") else 0
    except (TypeError, ValueError):
        offset = 0
    return limit, offset


def _exp_context(request) -> tuple:
    """Devuelve (expediente, oc_id, client_id) informados en el request."""
    exp = request.data.get("expediente_id")
    oc  = request.data.get("oc_id")
    cli = request.data.get("client_id")
    if exp and not (oc and cli):
        with connection.cursor() as c:
            c.execute(
                "SELECT oc_id::text, client_id::text FROM expedientes.expediente "
                "WHERE id = %s::uuid", [str(exp)])
            row = c.fetchone()
            if row:
                oc  = oc  or row[0]
                cli = cli or row[1]
    return exp, oc, cli


# ── Catálogo ────────────────────────────────────────────────────────
class TareaCatalogoViewSet(viewsets.ViewSet):
    required_module = "tareas"

    def list(self, request):
        qs = TareaCatalogo.objects.filter(is_active=True)
        return Response(TareaCatalogoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        obj = TareaCatalogo.objects.filter(pk=pk, is_active=True).first()
        if not obj:
            return Response({"detail": "Plantilla no existe"}, status=404)
        return Response(TareaCatalogoSerializer(obj).data)

    def create(self, request):
        if not user_is_ceo_or_admin(request.user):
            return Response({"detail": "Solo admin/CEO gestiona el catálogo."}, status=403)
        s = TareaCatalogoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        if not user_is_ceo_or_admin(request.user):
            return Response({"detail": "Solo admin/CEO gestiona el catálogo."}, status=403)
        obj = TareaCatalogo.objects.filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Plantilla no existe"}, status=404)
        s = TareaCatalogoSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    partial_update = update

    def destroy(self, request, pk=None):
        if not user_is_ceo_or_admin(request.user):
            return Response({"detail": "Solo admin/CEO gestiona el catálogo."}, status=403)
        TareaCatalogo.objects.filter(pk=pk).update(is_active=False, updated_at=timezone.now())
        return Response(status=204)


# ── Tareas (agenda) ─────────────────────────────────────────────────
class TareaViewSet(viewsets.ViewSet):
    required_module = "tareas"

    # ---- helpers ---------------------------------------------------
    def _get(self, pk):
        return Tarea.objects.filter(pk=pk, is_active=True).first()

    def _filtros(self, qs, request):
        qp = request.query_params
        for param, field in (("expediente", "expediente_id"), ("oc", "oc_id"),
                             ("client", "client_id"), ("responsable", "responsable_user_id")):
            v = qp.get(param)
            if v:
                qs = qs.filter(**{field: v})
        v = qp.get("estado")
        if v:
            qs = qs.filter(estado__in=[x.strip().upper() for x in v.split(",") if x.strip()])
        v = qp.get("tipo")
        if v:
            qs = qs.filter(tipo__in=[x.strip().upper() for x in v.split(",") if x.strip()])
        v = qp.get("origen")
        if v:
            qs = qs.filter(origen=v.strip().upper())
        if qp.get("abiertas") in ("1", "true", "True"):
            qs = qs.exclude(estado__in=_ABIERTAS)
        if qp.get("vencidas") in ("1", "true", "True"):
            qs = qs.filter(due_date__lt=date.today()).exclude(estado__in=_ABIERTAS)
        v = qp.get("due_from")
        if v:
            qs = qs.filter(due_date__gte=v)
        v = qp.get("due_to")
        if v:
            qs = qs.filter(due_date__lte=v)
        v = qp.get("q")
        if v:
            qs = qs.filter(Q(titulo__icontains=v) | Q(descripcion__icontains=v) |
                           Q(external_ref__icontains=v) | Q(catalogo_codigo__icontains=v))
        return qs

    # ---- CRUD ------------------------------------------------------
    def list(self, request):
        qs = self._filtros(Tarea.objects.filter(is_active=True), request)
        qs = qs.order_by(F("due_date").asc(nulls_last=True), "created_at")
        limit, offset = _paging(request)
        if limit is not None:
            return Response({
                "count":   qs.count(),
                "limit":   limit,
                "offset":  offset,
                "results": TareaSerializer(list(qs[offset:offset + limit]), many=True).data,
            })
        return Response(TareaSerializer(list(qs), many=True).data)

    def retrieve(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        return Response(TareaSerializer(t).data)

    def create(self, request):
        data = dict(request.data or {})
        data["id"] = data.get("id") or str(uuid.uuid4())
        exp, oc, cli = _exp_context(request)
        data.setdefault("expediente_id", exp)
        data.setdefault("oc_id", oc)
        data.setdefault("client_id", cli)
        codigo = data.get("catalogo_codigo")
        if codigo and not data.get("catalogo_id"):
            cat = TareaCatalogo.objects.filter(codigo=codigo, is_active=True).first()
            if cat:
                data["catalogo_id"]      = str(cat.id)
                data.setdefault("titulo", cat.nombre)
                data.setdefault("tipo", cat.tipo)
                data.setdefault("descripcion", cat.descripcion)
                data.setdefault("depends_on_hito", cat.depends_on_hito)
        data.setdefault("origen", "MANUAL")
        data["created_by_id"] = str(getattr(request.user, "id", "") or "") or None
        s = TareaSerializer(data=data)
        s.is_valid(raise_exception=True)
        # `id` está en read_only_fields → se inyecta explícito (patrón del proyecto).
        s.save(id=data["id"])
        services.log_evento(s.instance.id, "CREADA", {"origen": s.instance.origen},
                            getattr(request.user, "id", None))
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        data = dict(request.data or {})
        if "due_date" in data and data.get("due_date") != (t.due_date.isoformat() if t.due_date else None):
            data["is_override"] = True
        s = TareaSerializer(t, data=data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        services.log_evento(t.id, "EDITADA", {"campos": list(data.keys())},
                            getattr(request.user, "id", None))
        return Response(s.data)

    partial_update = update

    def destroy(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        t.is_active = False
        t.save(update_fields=["is_active", "updated_at"])
        services.log_evento(t.id, "ELIMINADA", {}, getattr(request.user, "id", None))
        return Response(status=204)

    # ---- acciones --------------------------------------------------
    @action(detail=True, methods=["post"])
    def enviar(self, request, pk=None):
        """Marca la tarea como enviada y agenda el seguimiento a 3 días hábiles."""
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        now = timezone.now()
        t.estado = "ESPERANDO_RESPUESTA"
        t.last_sent_at = now
        t.save(update_fields=["estado", "last_sent_at", "updated_at"])
        services.log_evento(t.id, "ENVIADA", {}, getattr(request.user, "id", None))
        # Seguimiento (regla: 3 días hábiles después del envío efectivo).
        exp = {"id": t.expediente_id, "oc_id": str(t.oc_id) if t.oc_id else None,
               "client_id": str(t.client_id) if t.client_id else None}
        if t.expediente_id:
            services.ensure_auto(exp, "SEGUIMIENTO_SIN_RESPUESTA",
                                 due=services.add_business_days(now.date(), 3),
                                 user_id=getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def responder(self, request, pk=None):
        """Registra la respuesta del interlocutor; pasa a revisión del negocio."""
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        t.responded_at = timezone.now()
        t.estado = "REQUIERE_REVISION"
        t.save(update_fields=["estado", "responded_at", "updated_at"])
        services.log_evento(t.id, "RESPONDIDA", {}, getattr(request.user, "id", None))
        if t.expediente_id:
            services.cancelar_auto(t.expediente_id, "SEGUIMIENTO_SIN_RESPUESTA",
                                   "respuesta recibida", getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def completar(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        now = timezone.now()
        t.estado = "RESUELTA"
        t.completed_at = now
        t.responded_at = t.responded_at or now
        t.save(update_fields=["estado", "completed_at", "responded_at", "updated_at"])
        services.log_evento(t.id, "COMPLETADA", {}, getattr(request.user, "id", None))
        if t.expediente_id and t.catalogo_codigo:
            services.cancelar_auto(t.expediente_id, "SEGUIMIENTO_SIN_RESPUESTA",
                                   "tarea resuelta", getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        t.estado = "CANCELADA"
        t.save(update_fields=["estado", "updated_at"])
        services.log_evento(t.id, "CANCELADA",
                            {"motivo": request.data.get("motivo")},
                            getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def reactivar(self, request, pk=None):
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        t.estado = "PENDIENTE"
        t.completed_at = None
        t.save(update_fields=["estado", "completed_at", "updated_at"])
        services.log_evento(t.id, "REACTIVADA", {}, getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["post"])
    def reprogramar(self, request, pk=None):
        """Cambia la fecha de vencimiento y marca override (nunca la pisa el generador)."""
        t = self._get(pk)
        if not t:
            return Response({"detail": "Tarea no existe"}, status=404)
        due = request.data.get("due_date")
        if not due:
            return Response({"detail": "due_date requerido"}, status=400)
        t.due_date = due
        t.is_override = True
        t.save(update_fields=["due_date", "is_override", "updated_at"])
        services.log_evento(t.id, "REPROGRAMADA", {"due_date": str(due)},
                            getattr(request.user, "id", None))
        return Response(TareaSerializer(self._get(pk)).data)

    @action(detail=True, methods=["get"])
    def eventos(self, request, pk=None):
        qs = TareaEvento.objects.filter(tarea_id=pk).order_by("-created_at")[:200]
        return Response(TareaEventoSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": c, "label": c} for c in
                         ["PENDIENTE", "BORRADOR_LISTO", "ESPERANDO_RESPUESTA",
                          "REQUIERE_REVISION", "RESUELTA", "CANCELADA"]])

    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response([{"codigo": c, "label": c} for c in
                         ["PRODUCCION", "DOCUMENTO", "LOGISTICA", "SEGUIMIENTO", "OPERATIVO"]])

    @action(detail=False, methods=["get"])
    def select_responsables(self, request):
        qs = (Tarea.objects.filter(is_active=True, responsable_user_id__isnull=False)
              .values_list("responsable_user_id", flat=True).distinct())
        return Response([{"id": str(x)} for x in qs if x])

    @action(detail=False, methods=["get"])
    def select_catalogos(self, request):
        qs = TareaCatalogo.objects.filter(is_active=True)
        return Response(TareaCatalogoSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def mesa(self, request):
        """Mesa de trabajo: todas las tareas abiertas con contexto del expediente."""
        where = ["t.is_active = TRUE", "t.estado NOT IN ('RESUELTA','CANCELADA')"]
        params: list = []
        qp = request.query_params
        for param, col in (("expediente", "t.expediente_id"), ("oc", "t.oc_id"),
                           ("client", "t.client_id"), ("responsable", "t.responsable_user_id")):
            v = qp.get(param)
            if v:
                where.append(f"{col} = %s::uuid")
                params.append(v)
        v = qp.get("estado")
        if v:
            where.append("t.estado = ANY(%s)")
            params.append([x.strip().upper() for x in v.split(",") if x.strip()])
        v = qp.get("tipo")
        if v:
            where.append("t.tipo = ANY(%s)")
            params.append([x.strip().upper() for x in v.split(",") if x.strip()])
        v = qp.get("q")
        if v:
            where.append("(t.titulo ILIKE %s OR t.descripcion ILIKE %s OR t.catalogo_codigo ILIKE %s)")
            like = f"%{v}%"
            params.extend([like, like, like])

        sql = f"""
            SELECT t.id::text, t.expediente_id::text, t.oc_id::text, t.client_id::text,
                   t.catalogo_codigo, t.titulo, t.descripcion, t.tipo, t.estado,
                   t.prioridad, t.origen, t.due_date, t.last_sent_at, t.responded_at,
                   t.is_override, t.external_ref, t.responsable_user_id::text,
                   cl.razon_social AS cliente,
                   e.estado AS expediente_estado, e.codigo AS expediente_codigo,
                   (SELECT oc.codigo FROM expedientes.oc oc WHERE oc.id = t.oc_id) AS oc_codigo,
                   (SELECT d.codigo FROM expedientes.documento d
                     WHERE d.expediente_id = t.expediente_id AND d.kind = 'PROFORMA'
                       AND d.is_active = TRUE AND COALESCE(d.codigo,'') <> ''
                     ORDER BY d.created_at DESC LIMIT 1) AS proforma,
                   (SELECT STRING_AGG(DISTINCT l.sap, ', ')
                      FROM expedientes.linea l
                     WHERE l.expediente_id = t.expediente_id AND l.is_active = TRUE
                       AND COALESCE(l.sap,'') <> '') AS sap
              FROM tareas.tarea t
              LEFT JOIN clientes.cliente cl ON cl.id = t.client_id
              LEFT JOIN expedientes.expediente e ON e.id = t.expediente_id
             WHERE {' AND '.join(where)}
             ORDER BY t.due_date NULLS LAST, t.created_at
        """
        with connection.cursor() as c:
            c.execute(sql, params)
            cols = [d[0] for d in c.description]
            items = [dict(zip(cols, row)) for row in c.fetchall()]

        today = date.today()
        kpis = {
            "total":       len(items),
            "vencidas":    sum(1 for i in items if i["due_date"] and i["due_date"] < today),
            "hoy":         sum(1 for i in items if i["due_date"] == today),
            "proximas":    sum(1 for i in items if i["due_date"] and i["due_date"] > today),
            "sin_fecha":   sum(1 for i in items if not i["due_date"]),
            "esperando":   sum(1 for i in items if i["estado"] == "ESPERANDO_RESPUESTA"),
            "revision":    sum(1 for i in items if i["estado"] == "REQUIERE_REVISION"),
        }
        for i in items:
            for k in ("due_date", "last_sent_at", "responded_at"):
                if i.get(k) is not None:
                    i[k] = i[k].isoformat()
        return Response({"kpis": kpis, "items": items, "count": len(items),
                         "today": today.isoformat()})

    @action(detail=False, methods=["post"])
    def generar(self, request):
        """(Re)genera las tareas automáticas. Admin/CEO, o de un solo expediente."""
        exp = request.data.get("expediente_id")
        if exp:
            return Response(services.generar_para_expediente(
                exp, getattr(request.user, "id", None)))
        if not user_is_ceo_or_admin(request.user):
            return Response({"detail": "Solo admin/CEO ejecuta la generación global."}, status=403)
        return Response(services.generar_global(getattr(request.user, "id", None)))
