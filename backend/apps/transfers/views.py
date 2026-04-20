"""
=====================================================================
MWT.ONE · apps.transfers.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/transferencias/          (TransferenciaViewSet)
  /api/transfer-lineas/         (LineaViewSet)
  /api/transfer-eventos/        (EventoViewSet)

Reglas:
  - Soft-delete: is_active = FALSE.
  - Al cambiar de estado, insert en transfers.evento con estado_prev → estado_nuevo.
=====================================================================
"""
import uuid
from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Transferencia, Linea, Evento,
    EstadoTransferCat, LegalContextCat,
)
from .serializers import (
    TransferenciaSerializer, TransferenciaListSerializer,
    LineaSerializer, EventoSerializer,
)


# ════════════════════════════════════════════════════════════
# Transferencia
# ════════════════════════════════════════════════════════════
class TransferenciaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Transferencia.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("origen", "origen_id"), ("destino", "destino_id"),
                     ("estado", "estado"), ("legal_context", "legal_context")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        needs = request.query_params.get("needs_approval")
        if needs in ("1", "true", "True"):
            qs = qs.filter(needs_approval=True)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(TransferenciaListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            t = Transferencia.objects.get(pk=pk, is_active=True)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        data = TransferenciaSerializer(t).data
        data["lineas"] = LineaSerializer(
            Linea.objects.filter(transferencia_id=t.id, is_active=True), many=True
        ).data
        data["eventos"] = EventoSerializer(
            Evento.objects.filter(transferencia_id=t.id).order_by("-created_at"), many=True
        ).data
        return Response(data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = TransferenciaSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            # primer evento (creación)
            Evento.objects.create(
                id               = uuid.uuid4(),
                transferencia_id = s.data["id"],
                estado_prev      = None,
                estado_nuevo     = s.data.get("estado", "PLANNED"),
                actor_id         = data.get("created_by_id"),
                actor_name       = data.get("created_by_name"),
                notes            = "Creación",
            )
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            t = Transferencia.objects.get(pk=pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        prev_estado = t.estado
        s = TransferenciaSerializer(t, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            t.refresh_from_db()
            if t.estado != prev_estado:
                Evento.objects.create(
                    id               = uuid.uuid4(),
                    transferencia_id = t.id,
                    estado_prev      = prev_estado,
                    estado_nuevo     = t.estado,
                    actor_id         = request.data.get("actor_id"),
                    actor_name       = request.data.get("actor_name"),
                    notes            = request.data.get("notes") or f"{prev_estado} → {t.estado}",
                )
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Transferencia.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoTransferCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_legal_contexts(self, request):
        return Response([{"codigo": c.codigo, "label": c.label, "descripcion": c.descripcion}
                         for c in LegalContextCat.objects.all()])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "planned": 0, "approved": 0,
            "in_transit": 0, "received": 0, "reconciled": 0,
            "cancelled": 0, "needs_approval": 0,
            "value_usd_active": 0.0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado = 'PLANNED'),
                      COUNT(*) FILTER (WHERE estado = 'APPROVED'),
                      COUNT(*) FILTER (WHERE estado = 'IN_TRANSIT'),
                      COUNT(*) FILTER (WHERE estado = 'RECEIVED'),
                      COUNT(*) FILTER (WHERE estado = 'RECONCILED'),
                      COUNT(*) FILTER (WHERE estado = 'CANCELLED'),
                      COUNT(*) FILTER (WHERE needs_approval = TRUE AND estado = 'PLANNED'),
                      COALESCE(SUM(value_usd) FILTER (WHERE estado NOT IN ('CANCELLED','RECONCILED')), 0)
                    FROM transfers.transferencia
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":             r[0],
                    "planned":           r[1],
                    "approved":          r[2],
                    "in_transit":        r[3],
                    "received":          r[4],
                    "reconciled":        r[5],
                    "cancelled":         r[6],
                    "needs_approval":    r[7],
                    "value_usd_active":  float(r[8]),
                }
            except Exception:
                pass
        return Response(out)

    # ── Approve / Dispatch / Receive shortcuts ────────
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._transition(request, pk, "APPROVED", "Aprobada")

    @action(detail=True, methods=["post"])
    def dispatch(self, request, pk=None):
        return self._transition(request, pk, "IN_TRANSIT", "Despachada")

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        return self._transition(request, pk, "RECEIVED", "Recibida")

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        return self._transition(request, pk, "RECONCILED", "Conciliada")

    def _transition(self, request, pk, nuevo_estado, note):
        try:
            t = Transferencia.objects.get(pk=pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        prev = t.estado
        with transaction.atomic():
            Transferencia.objects.filter(pk=pk).update(estado=nuevo_estado)
            Evento.objects.create(
                id               = uuid.uuid4(),
                transferencia_id = t.id,
                estado_prev      = prev,
                estado_nuevo     = nuevo_estado,
                actor_id         = request.data.get("actor_id"),
                actor_name       = request.data.get("actor_name"),
                notes            = request.data.get("notes") or note,
            )
        t.refresh_from_db()
        return Response(TransferenciaSerializer(t).data)


# ════════════════════════════════════════════════════════════
# Línea
# ════════════════════════════════════════════════════════════
class LineaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Linea.objects.filter(is_active=True).order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        sku = request.query_params.get("sku")
        if sku:
            qs = qs.filter(sku__icontains=sku)
        return Response(LineaSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            l = Linea.objects.get(pk=pk, is_active=True)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        return Response(LineaSerializer(l).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = LineaSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            l = Linea.objects.get(pk=pk)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        s = LineaSerializer(l, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Linea.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Evento (audit trail — read-only + create)
# ════════════════════════════════════════════════════════════
class EventoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Evento.objects.all().order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        return Response(EventoSerializer(qs, many=True).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = EventoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)
