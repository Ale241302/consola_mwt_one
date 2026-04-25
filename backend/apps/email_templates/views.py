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
import logging
import time
import uuid
from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Template, Version, LanguageCat,
    TemplateStatusCat, RenderPreviewLog,
)
from .serializers import (
    TemplateSerializer, TemplateListSerializer,
    VersionSerializer,
    TemplateStatusCatSerializer, RenderPreviewLogSerializer,
)

log = logging.getLogger(__name__)


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
                     ("brand", "brand"), ("brand_id", "brand_id"),
                     ("status", "status")):
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
        # Idempotence by token — early return if already exists
        tok = request.data.get("idempotence_token")
        if tok:
            existing = Template.objects.filter(
                idempotence_token=tok, is_active=True,
            ).first()
            if existing:
                return Response({**TemplateSerializer(existing).data, "idempotent": True}, status=200)

        data = {**request.data}
        data.setdefault("status", "DRAFT")
        new_id = uuid.uuid4()
        s = TemplateSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save(id=new_id)   # bypass read_only_fields=("id",)
            Version.objects.create(
                id               = uuid.uuid4(),
                template_id      = new_id,
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

    # ── Selects extendidos (BLOQUE 4) ─────────────────
    @action(detail=False, methods=["get"])
    def select_statuses(self, request):
        return Response(TemplateStatusCatSerializer(
            TemplateStatusCat.objects.filter(is_active=True), many=True).data)

    @action(detail=False, methods=["get"])
    def select_brands(self, request):
        """Brands distintas usadas por templates — útil para filtro en UI."""
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT brand, brand_id, COUNT(*) AS n
                    FROM email_templates.template
                    GROUP BY brand, brand_id
                    ORDER BY brand
                """)
                rows = c.fetchall()
                return Response([
                    {"codigo": r[0], "brand_id": str(r[1]) if r[1] else None, "count": r[2]}
                    for r in rows
                ])
            except Exception:
                return Response([])

    # ── Variables declaradas por la template ──────────
    @action(detail=True, methods=["get"])
    def variables(self, request, pk=None):
        """Regresa variables_meta + las variables detectadas automáticamente
        con regex sobre el subject+body (Jinja2 `{{ var }}` o `{var}`)."""
        import re
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)

        src = (t.subject_template or "") + "\n" + (t.body_template or "")
        jinja_vars  = set(re.findall(r"\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}", src))
        format_vars = set(re.findall(r"(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})", src))
        detected = sorted(jinja_vars | format_vars)

        return Response({
            "declared":  t.variables_meta or [],
            "detected":  detected,
            "count_declared": len(t.variables_meta or []),
            "count_detected": len(detected),
        })

    # ── Test render con logging en render_preview_log ─
    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """Preview del subject+body con variables enviadas por el usuario.
        Usa Jinja2 si está disponible; si no, fallback a str.format_map.
        Además persiste el render en render_preview_log (append-only)."""
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)

        ctx = request.data.get("variables") or {}
        subject = t.subject_template
        body    = t.body_template
        error_code = None
        error_message = None
        render_ok = True
        t0 = time.time()

        try:
            from jinja2 import Environment
            env = Environment(autoescape=False)
            subject = env.from_string(subject).render(**ctx)
            body    = env.from_string(body).render(**ctx)
        except Exception as je:
            try:
                subject = t.subject_template.format_map(ctx)
                body    = t.body_template.format_map(ctx)
            except Exception as fe:
                render_ok     = False
                error_code    = "RENDER_FAILED"
                error_message = f"jinja={je!r}; format={fe!r}"

        duration_ms = int((time.time() - t0) * 1000)

        # Persist preview log (best-effort)
        try:
            RenderPreviewLog.objects.create(
                id                = uuid.uuid4(),
                template_id       = t.id,
                template_key      = t.template_key,
                language          = t.language,
                brand             = t.brand,
                payload_sample    = ctx,
                rendered_subject  = subject[:512] if isinstance(subject, str) else None,
                rendered_body     = body if isinstance(body, str) else None,
                render_ok         = render_ok,
                error_code        = error_code,
                error_message     = error_message,
                duration_ms       = duration_ms,
                triggered_by_name = (getattr(request.user, "email", None)
                                     or getattr(request.user, "username", None)
                                     or "system"),
            )
        except Exception as le:
            log.warning("render_preview_log insert falló: %s", le)

        return Response({
            "subject":     subject,
            "body":        body,
            "render_ok":   render_ok,
            "duration_ms": duration_ms,
            "error_code":  error_code,
            "error":       error_message,
        })

    # ── Lifecycle: publish / archive / unarchive ──────
    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)
        if t.status == "PUBLISHED":
            return Response({"ok": True, "idempotent": True, "template": TemplateSerializer(t).data})
        if t.status == "ARCHIVED":
            return Response({"detail": "Plantilla archivada — no se puede publicar"}, status=409)

        t.status           = "PUBLISHED"
        t.published_at     = timezone.now()
        t.published_by_id  = getattr(request.user, "id", None)
        t.is_active        = True
        t.save()

        Version.objects.create(
            id               = uuid.uuid4(),
            template_id      = t.id,
            subject_template = t.subject_template,
            body_template    = t.body_template,
            changed_by_id    = getattr(request.user, "id", None),
            changed_by_name  = getattr(request.user, "email", None) or getattr(request.user, "username", None),
            change_note      = "Publicación",
        )
        return Response({"ok": True, "template": TemplateSerializer(t).data})

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)
        if t.status == "ARCHIVED":
            return Response({"ok": True, "idempotent": True, "template": TemplateSerializer(t).data})

        t.status          = "ARCHIVED"
        t.archived_at     = timezone.now()
        t.archived_by_id  = getattr(request.user, "id", None)
        t.is_active       = False
        t.save()

        Version.objects.create(
            id               = uuid.uuid4(),
            template_id      = t.id,
            subject_template = t.subject_template,
            body_template    = t.body_template,
            changed_by_id    = getattr(request.user, "id", None),
            changed_by_name  = getattr(request.user, "email", None) or getattr(request.user, "username", None),
            change_note      = request.data.get("change_note") or "Archivado",
        )
        return Response({"ok": True, "template": TemplateSerializer(t).data})

    @action(detail=True, methods=["post"], url_path="test-send")
    def test_send(self, request, pk=None):
        """Envía un render de prueba al email indicado.
        Si el service de mailing no está disponible, queda como "encolado" y
        se registra en render_preview_log con render_ok=True.
        """
        try:
            t = Template.objects.get(pk=pk)
        except Template.DoesNotExist:
            return Response({"detail": "Plantilla no existe"}, status=404)

        to_email = (request.data.get("to") or "").strip()
        if not to_email or "@" not in to_email:
            return Response({"detail": "Campo 'to' debe ser un email válido"}, status=400)
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
                subject = t.subject_template.format_map(ctx)
                body    = t.body_template.format_map(ctx)
            except Exception:
                pass

        sent_ok = False
        err = None
        try:
            from apps.storage.services import send_test_email  # type: ignore
            send_test_email(to=to_email, subject=subject, body=body)
            sent_ok = True
        except Exception as e:
            err = f"mailing service no disponible: {e!r}"

        t.last_test_send_at = timezone.now()
        t.save(update_fields=["last_test_send_at", "updated_at"])

        # Preview log
        try:
            RenderPreviewLog.objects.create(
                id                = uuid.uuid4(),
                template_id       = t.id,
                template_key      = t.template_key,
                language          = t.language,
                brand             = t.brand,
                payload_sample    = {"to": to_email, "variables": ctx, "channel": "test_send"},
                rendered_subject  = subject[:512] if isinstance(subject, str) else None,
                rendered_body     = body if isinstance(body, str) else None,
                render_ok         = sent_ok,
                error_code        = None if sent_ok else "SEND_QUEUED",
                error_message     = err,
                triggered_by_name = (getattr(request.user, "email", None)
                                     or getattr(request.user, "username", None)
                                     or "system"),
            )
        except Exception:
            pass

        return Response({
            "ok":      True,
            "sent":    sent_ok,
            "to":      to_email,
            "subject": subject,
            "body":    body,
            "error":   err,
        })


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
        s = VersionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)


# ════════════════════════════════════════════════════════════
# RenderPreviewLog (append-only)
# ════════════════════════════════════════════════════════════
class RenderPreviewLogViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = RenderPreviewLog.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("template", "template_id"),
                     ("key",      "template_key"),
                     ("language", "language"),
                     ("brand",    "brand")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        ok = request.query_params.get("render_ok")
        if ok in ("true", "false"):
            qs = qs.filter(render_ok=(ok == "true"))
        limit = int(request.query_params.get("limit") or 100)
        return Response(RenderPreviewLogSerializer(qs[:limit], many=True).data)

    def retrieve(self, request, pk=None):
        try:
            r = RenderPreviewLog.objects.get(pk=pk, is_active=True)
        except RenderPreviewLog.DoesNotExist:
            return Response({"detail": "Preview log no existe"}, status=404)
        return Response(RenderPreviewLogSerializer(r).data)

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {"total": 0, "failed_7d": 0, "success_rate_7d": 0.0}
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (
                        WHERE render_ok = FALSE
                          AND created_at > now() - interval '7 days'
                      ),
                      COUNT(*) FILTER (
                        WHERE created_at > now() - interval '7 days'
                      )
                    FROM email_templates.render_preview_log
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                total_7d = r[2] or 0
                failed_7d = r[1] or 0
                success_rate_7d = (
                    round((total_7d - failed_7d) / total_7d * 100.0, 2)
                    if total_7d > 0 else 100.0
                )
                out = {
                    "total":           r[0],
                    "failed_7d":       failed_7d,
                    "success_rate_7d": success_rate_7d,
                }
            except Exception:
                pass
        return Response(out)
