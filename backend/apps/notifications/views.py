"""
=====================================================================
MWT.ONE · apps.notifications.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/notification-logs/         (NotificationLogViewSet)
  /api/collection-logs/           (CollectionLogViewSet — filtered view of
                                   notification_log con trigger C1/C2/C3)

Reglas:
  - Soft-delete: is_active = FALSE.
  - Los logs son creados principalmente por Celery; el endpoint acepta
    POST para permitir registro desde workflows manuales.
=====================================================================
"""
import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import NotificationLog, EstadoEnvioCat, TriggerCat
from .serializers import (
    NotificationLogSerializer, NotificationLogListSerializer,
)


# ════════════════════════════════════════════════════════════
# NotificationLog (general)
# ════════════════════════════════════════════════════════════
class NotificationLogViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = NotificationLog.objects.filter(is_active=True).order_by("-ts")
        for p, f in (("expediente", "expediente_id"), ("proforma", "proforma_id"),
                     ("template_key", "template_key"), ("trigger", "trigger"),
                     ("status", "status"), ("recipient", "recipient_email")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(subject__icontains=q)
        limit = request.query_params.get("limit")
        if limit:
            try:
                qs = qs[: int(limit)]
            except (TypeError, ValueError):
                pass
        return Response(NotificationLogListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            n = NotificationLog.objects.get(pk=pk, is_active=True)
        except NotificationLog.DoesNotExist:
            return Response({"detail": "Log no existe"}, status=404)
        return Response(NotificationLogSerializer(n).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = NotificationLogSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            n = NotificationLog.objects.get(pk=pk)
        except NotificationLog.DoesNotExist:
            return Response({"detail": "Log no existe"}, status=404)
        s = NotificationLogSerializer(n, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        NotificationLog.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoEnvioCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_triggers(self, request):
        return Response([{"codigo": t.codigo, "label": t.label}
                         for t in TriggerCat.objects.all()])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "sent": 0, "delivered": 0, "skipped": 0,
            "failed": 0, "exhausted": 0, "bounced": 0,
            "last_24h": 0, "last_7d": 0,
            "failure_rate_7d": 0.0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE status = 'Sent'),
                      COUNT(*) FILTER (WHERE status = 'Delivered'),
                      COUNT(*) FILTER (WHERE status = 'Skipped'),
                      COUNT(*) FILTER (WHERE status = 'Failed'),
                      COUNT(*) FILTER (WHERE status = 'Exhausted'),
                      COUNT(*) FILTER (WHERE status = 'Bounced'),
                      COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '24 hours'),
                      COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '7 days'),
                      COALESCE(
                        100.0 * COUNT(*) FILTER (WHERE status IN ('Failed','Exhausted','Bounced') AND ts >= NOW() - INTERVAL '7 days')
                        / NULLIF(COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '7 days'), 0),
                        0
                      )
                    FROM notifications.notification_log
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":           r[0],
                    "sent":            r[1],
                    "delivered":       r[2],
                    "skipped":         r[3],
                    "failed":          r[4],
                    "exhausted":       r[5],
                    "bounced":         r[6],
                    "last_24h":        r[7],
                    "last_7d":         r[8],
                    "failure_rate_7d": float(r[9]),
                }
            except Exception:
                pass
        return Response(out)


# ════════════════════════════════════════════════════════════
# CollectionLog — view filtrada (trigger C1/C2/C3)
# ════════════════════════════════════════════════════════════
class CollectionLogViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = NotificationLog.objects.filter(
            is_active=True,
            trigger__in=["C1", "C2", "C3"],
        ).order_by("-ts")
        for p, f in (("expediente", "expediente_id"), ("proforma", "proforma_id"),
                     ("trigger", "trigger"), ("status", "status")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(NotificationLogListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            n = NotificationLog.objects.get(pk=pk, is_active=True)
        except NotificationLog.DoesNotExist:
            return Response({"detail": "Log no existe"}, status=404)
        return Response(NotificationLogSerializer(n).data)

    # ── KPIs de cobranza ──────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "c1": 0, "c2": 0, "c3": 0,
            "sent": 0, "failed": 0,
            "amount_overdue_total": 0.0,
            "proformas_pinged": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE trigger = 'C1'),
                      COUNT(*) FILTER (WHERE trigger = 'C2'),
                      COUNT(*) FILTER (WHERE trigger = 'C3'),
                      COUNT(*) FILTER (WHERE status IN ('Sent','Delivered')),
                      COUNT(*) FILTER (WHERE status IN ('Failed','Exhausted','Bounced')),
                      COALESCE(SUM(amount_overdue), 0),
                      COUNT(DISTINCT proforma_id) FILTER (WHERE proforma_id IS NOT NULL)
                    FROM notifications.notification_log
                    WHERE is_active = TRUE
                      AND trigger IN ('C1','C2','C3')
                """)
                r = c.fetchone()
                out = {
                    "total":                 r[0],
                    "c1":                    r[1],
                    "c2":                    r[2],
                    "c3":                    r[3],
                    "sent":                  r[4],
                    "failed":                r[5],
                    "amount_overdue_total":  float(r[6]),
                    "proformas_pinged":      r[7],
                }
            except Exception:
                pass
        return Response(out)
