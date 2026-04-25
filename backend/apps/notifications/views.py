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
import logging
import uuid
from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    NotificationLog, EstadoEnvioCat, TriggerCat,
    GraceDaysCat, EmailQueueLog,
)
from .serializers import (
    NotificationLogSerializer, NotificationLogListSerializer,
    GraceDaysCatSerializer, EmailQueueLogSerializer,
)

log = logging.getLogger(__name__)


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
        # Idempotency by token — if already seen, return existing row.
        tok = request.data.get("idempotence_token")
        if tok:
            existing = NotificationLog.objects.filter(
                idempotence_token=tok, is_active=True,
            ).first()
            if existing:
                return Response(
                    {**NotificationLogSerializer(existing).data, "idempotent": True},
                    status=200,
                )

        data = {**request.data}
        data.setdefault("ts", timezone.now())
        s = NotificationLogSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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

    @action(detail=False, methods=["get"], url_path="select-grace-days")
    def select_grace_days(self, request):
        return Response(GraceDaysCatSerializer(
            GraceDaysCat.objects.filter(is_active=True), many=True).data)

    @action(detail=False, methods=["get"], url_path="by-recipient")
    def by_recipient(self, request):
        """Agregado por recipient_email — volumen, último envío y rate de falla."""
        email = request.query_params.get("email")
        qs = NotificationLog.objects.filter(is_active=True)
        if email:
            qs = qs.filter(recipient_email=email)
        with connection.cursor() as c:
            try:
                sql = """
                    SELECT
                      recipient_email,
                      COUNT(*)                                                   AS total,
                      MAX(ts)                                                    AS last_ts,
                      COUNT(*) FILTER (WHERE status IN ('Sent','Delivered'))     AS sent_ok,
                      COUNT(*) FILTER (WHERE status IN ('Failed','Exhausted','Bounced')) AS failed,
                      COALESCE(
                        100.0 * COUNT(*) FILTER (WHERE status IN ('Failed','Exhausted','Bounced'))
                        / NULLIF(COUNT(*), 0),
                        0
                      ) AS failure_rate
                    FROM notifications.notification_log
                    WHERE is_active = TRUE
                      AND recipient_email IS NOT NULL
                """
                params = []
                if email:
                    sql += " AND recipient_email = %s"
                    params.append(email)
                sql += " GROUP BY recipient_email ORDER BY total DESC LIMIT 200"
                c.execute(sql, params)
                rows = c.fetchall()
                return Response([
                    {
                        "recipient_email": r[0],
                        "total":           r[1],
                        "last_ts":         r[2].isoformat() if r[2] else None,
                        "sent_ok":         r[3],
                        "failed":          r[4],
                        "failure_rate":    float(r[5]),
                    }
                    for r in rows
                ])
            except Exception:
                return Response([])

    # ── Retry de un envío fallido ─────────────────────
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        """Crea un nuevo notification_log con trigger='retry' apuntando al
        original. Idempotente por retry_of_token si se envía."""
        try:
            orig = NotificationLog.objects.get(pk=pk, is_active=True)
        except NotificationLog.DoesNotExist:
            return Response({"detail": "Log original no existe"}, status=404)

        token = request.data.get("idempotence_token") or f"retry:{orig.id}:{uuid.uuid4().hex[:8]}"

        existing = NotificationLog.objects.filter(
            idempotence_token=token, is_active=True,
        ).first()
        if existing:
            return Response(
                {**NotificationLogSerializer(existing).data, "idempotent": True},
                status=200,
            )

        new = NotificationLog.objects.create(
            id                = uuid.uuid4(),
            ts                = timezone.now(),
            expediente_id     = orig.expediente_id,
            proforma_id       = orig.proforma_id,
            template_key      = orig.template_key,
            template_id       = orig.template_id,
            recipient_email   = orig.recipient_email,
            subject           = orig.subject,
            body_preview      = orig.body_preview,
            trigger           = "retry",
            status            = "Sent",
            retries           = (orig.retries or 0) + 1,
            attempt_count     = 1,
            amount_overdue    = orig.amount_overdue,
            grace_days_used   = orig.grace_days_used,
            currency          = orig.currency,
            idempotence_token = token,
            retry_of          = orig.id,
            retry_of_token    = orig.idempotence_token,
        )

        # Si hay servicio de mailing disponible, intenta reenviar
        sent_ok = False
        err = None
        try:
            from apps.storage.services import send_test_email  # type: ignore
            send_test_email(to=orig.recipient_email, subject=orig.subject or "", body=orig.body_preview or "")
            sent_ok = True
        except Exception as e:
            err = f"mailing service no disponible: {e!r}"
            new.status = "Failed"
            new.error  = err[:512]
            new.save(update_fields=["status", "error", "updated_at"])

        return Response({
            "ok":    True,
            "sent":  sent_ok,
            "error": err,
            "log":   NotificationLogSerializer(new).data,
        }, status=201)

    # ── Bulk send (best-effort, idempotencia por item) ─
    @action(detail=False, methods=["post"], url_path="bulk-send")
    def bulk_send(self, request):
        """Body: { items: [ { recipient_email, template_key, idempotence_token?, variables? }, ... ] }
        Inserta N notification_log rows en estado 'Sent' (o 'Failed' si mailing no disponible).
        """
        items = request.data.get("items") or []
        if not isinstance(items, list) or not items:
            return Response({"detail": "items debe ser una lista no vacía"}, status=400)

        created = []
        skipped = []
        failed  = []

        for item in items:
            tok = item.get("idempotence_token")
            if tok:
                existing = NotificationLog.objects.filter(
                    idempotence_token=tok, is_active=True,
                ).first()
                if existing:
                    skipped.append({"token": tok, "id": str(existing.id)})
                    continue

            try:
                row = NotificationLog.objects.create(
                    id                = uuid.uuid4(),
                    ts                = timezone.now(),
                    expediente_id     = item.get("expediente_id"),
                    proforma_id       = item.get("proforma_id"),
                    template_key      = item.get("template_key"),
                    template_id       = item.get("template_id"),
                    recipient_email   = item.get("recipient_email"),
                    subject           = item.get("subject"),
                    body_preview      = item.get("body_preview"),
                    trigger           = item.get("trigger") or "bulk_send",
                    status            = "Sent",
                    idempotence_token = tok,
                    amount_overdue    = item.get("amount_overdue"),
                    currency          = item.get("currency"),
                )
                created.append(str(row.id))
            except Exception as e:
                failed.append({"item": item, "error": str(e)})

        return Response({
            "ok":       True,
            "created":  created,
            "skipped":  skipped,
            "failed":   failed,
            "summary":  {"created": len(created), "skipped": len(skipped), "failed": len(failed)},
        }, status=201)

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


# ════════════════════════════════════════════════════════════
# GraceDaysCatViewSet — CRUD del catálogo (finance puede editar)
# ════════════════════════════════════════════════════════════
class GraceDaysCatViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = GraceDaysCat.objects.filter(is_active=True)
        return Response(GraceDaysCatSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            g = GraceDaysCat.objects.get(pk=pk, is_active=True)
        except GraceDaysCat.DoesNotExist:
            return Response({"detail": "GraceDays no existe"}, status=404)
        return Response(GraceDaysCatSerializer(g).data)

    def update(self, request, pk=None):
        try:
            g = GraceDaysCat.objects.get(pk=pk)
        except GraceDaysCat.DoesNotExist:
            return Response({"detail": "GraceDays no existe"}, status=404)
        s = GraceDaysCatSerializer(g, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update


# ════════════════════════════════════════════════════════════
# EmailQueueLog (tracking de la cola Celery)
# ════════════════════════════════════════════════════════════
class EmailQueueLogViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = EmailQueueLog.objects.filter(is_active=True).order_by("-enqueued_at")
        for p, f in (("status",           "status"),
                     ("notification",     "notification_id"),
                     ("template_key",     "template_key"),
                     ("recipient_email",  "recipient_email"),
                     ("celery_task_id",   "celery_task_id")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(EmailQueueLogSerializer(qs[:limit], many=True).data)

    def retrieve(self, request, pk=None):
        try:
            q = EmailQueueLog.objects.get(pk=pk, is_active=True)
        except EmailQueueLog.DoesNotExist:
            return Response({"detail": "Queue log no existe"}, status=404)
        return Response(EmailQueueLogSerializer(q).data)

    def create(self, request):
        # Idempotency by celery_task_id
        ctid = request.data.get("celery_task_id")
        if ctid:
            existing = EmailQueueLog.objects.filter(
                celery_task_id=ctid, is_active=True,
            ).first()
            if existing:
                return Response(
                    {**EmailQueueLogSerializer(existing).data, "idempotent": True},
                    status=200,
                )
        s = EmailQueueLogSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            q = EmailQueueLog.objects.get(pk=pk)
        except EmailQueueLog.DoesNotExist:
            return Response({"detail": "Queue log no existe"}, status=404)
        s = EmailQueueLogSerializer(q, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "queued": 0, "sending": 0, "sent": 0, "failed": 0,
            "retry": 0, "last_24h": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE status = 'QUEUED'),
                      COUNT(*) FILTER (WHERE status = 'SENDING'),
                      COUNT(*) FILTER (WHERE status = 'SENT'),
                      COUNT(*) FILTER (WHERE status = 'FAILED'),
                      COUNT(*) FILTER (WHERE status = 'RETRY'),
                      COUNT(*) FILTER (WHERE enqueued_at >= NOW() - INTERVAL '24 hours')
                    FROM notifications.email_queue_log
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":    r[0],
                    "queued":   r[1],
                    "sending":  r[2],
                    "sent":     r[3],
                    "failed":   r[4],
                    "retry":    r[5],
                    "last_24h": r[6],
                }
            except Exception:
                pass
        return Response(out)
