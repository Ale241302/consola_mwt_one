"""
=====================================================================
MWT.ONE · apps.email_templates.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/email-templates/            (TemplateViewSet)
  /api/email-template-versions/    (VersionViewSet — audit append-only)

Reglas:
  - Soft-delete: is_active = FALSE (kill switch).
  - En cada update se snapshot-ea la versión previa en email_templates.version.
=====================================================================
"""
import uuid
from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Template, Version, LanguageCat
from .serializers import (
    TemplateSerializer, TemplateListSerializer,
    VersionSerializer,
)


# ════════════════════════════════════════════════════════════
# Template
# ════════════════════════════════════════════════════════════
class TemplateViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Template.objects.all().order_by("template_key", "language", "brand")
        active = request.query_params.get("is_active")
        if active in ("1", "true", "True"):
            qs = qs.filter(is_active=True)
        elif active in ("0", "false", "False"):
            qs = qs.filter(is_active=False)
        for p, f in (("key", "template_key"), ("language", "language"),
                     ("brand", "brand"), ("brand_id", "brand_id")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(name__icontains=q)
        return Response(TemplateListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)
        data = TemplateSerializer(t).data
        data["versions"] = VersionSerializer(
            Version.objects.filter(template_id=t.id).order_by("-created_at"), many=True
        ).data
        return Response(data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = TemplateSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            Version.objects.create(
                id               = uuid.uuid4(),
                template_id      = s.data["id"],
                subject_template = s.data.get("subject_template"),
                body_template    = s.data.get("body_template"),
                changed_by_id    = data.get("changed_by_id"),
                changed_by_name  = data.get("changed_by_name"),
                change_note      = data.get("change_note") or "Creación",
            )
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)
        prev_subject = t.subject_template
        prev_body    = t.body_template
        s = TemplateSerializer(t, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            t.refresh_from_db()
            # Snapshot sólo si cambió subject o body
            if t.subject_template != prev_subject or t.body_template != prev_body:
                Version.objects.create(
                    id               = uuid.uuid4(),
                    template_id      = t.id,
                    subject_template = t.subject_template,
                    body_template    = t.body_template,
                    changed_by_id    = request.data.get("changed_by_id"),
                    changed_by_name  = request.data.get("changed_by_name"),
                    change_note      = request.data.get("change_note") or "Edición",
                )
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Template.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_languages(self, request):
        return Response([{"codigo": l.codigo, "label": l.label}
                         for l in LanguageCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_keys(self, request):
        """Devuelve keys únicas agrupadas por template_key."""
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT template_key, COUNT(*) AS variantes
                    FROM email_templates.template
                    GROUP BY template_key
                    ORDER BY template_key
                """)
                rows = c.fetchall()
                return Response([{"codigo": r[0], "variantes": r[1]} for r in rows])
            except Exception:
                return Response([])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "active": 0, "disabled": 0,
            "languages": 0, "brands": 0,
            "sent_30d": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE is_active = TRUE),
                      COUNT(*) FILTER (WHERE is_active = FALSE),
                      COUNT(DISTINCT language),
                      COUNT(DISTINCT brand),
                      COALESCE(SUM(sent_count_30d), 0)
                    FROM email_templates.template
                """)
                r = c.fetchone()
                out = {
                    "total":     r[0],
                    "active":    r[1],
                    "disabled":  r[2],
                    "languages": r[3],
                    "brands":    r[4],
                    "sent_30d":  r[5],
                }
            except Exception:
                pass
        return Response(out)

    # ── Test render (Jinja2 safe-ish preview) ─────────
    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """Preview del subject+body con variables enviadas por el usuario.
        Usa Jinja2 si está disponible; si no, fallback a str.format_map."""
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)
        ctx = request.data.get("variables") or {}
        subject = t.subject_template
        body    = t.body_template
        try:
            from jinja2 import Environment
            env = Environment(autoescape=False)
            subject = env.from_string(subject).render(**ctx)
            body    = env.from_string(body).render(**ctx)
        except Exception:
            try:
                subject = subject.format_map(ctx)
                body    = body.format_map(ctx)
            except Exception:
                pass
        return Response({"subject": subject, "body": body})


# ════════════════════════════════════════════════════════════
# Version (audit — read-only + create)
# ════════════════════════════════════════════════════════════
class VersionViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Version.objects.all().order_by("-created_at")
        tid = request.query_params.get("template")
        if tid:
            qs = qs.filter(template_id=tid)
        return Response(VersionSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            v = Version.objects.get(pk=pk)
        except Version.DoesNotExist:
            return Response({"detail": "Versión no existe"}, status=404)
        return Response(VersionSerializer(v).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = VersionSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)
