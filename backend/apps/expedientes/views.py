"""
=====================================================================
MWT.ONE · apps.expedientes.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/ocs/           (OcViewSet)
  /api/expedientes/   (ExpedienteViewSet)
  /api/lineas/        (LineaViewSet)
  /api/documentos/    (DocumentoViewSet)

Cada ViewSet ofrece full CRUD + select_* + kpis.
=====================================================================
"""
import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Oc, Expediente, Linea, Documento,
    EstadoOcCat, EstadoExpedienteCat, ModoOperacionCat, IncotermCat,
)
from .serializers import (
    OcSerializer, OcListSerializer,
    ExpedienteSerializer, ExpedienteListSerializer,
    LineaSerializer, DocumentoSerializer,
)


# ════════════════════════════════════════════════════════════
# OC
# ════════════════════════════════════════════════════════════
class OcViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Oc.objects.filter(is_active=True).order_by("-issued_at", "-created_at")
        mapping = {
            "client":  "client_id",
            "brand":   "brand_id",
            "estado":  "estado",
            "moneda":  "moneda",
            "credit_band": "credit_band",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(OcListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            o = Oc.objects.get(pk=pk, is_active=True)
        except Oc.DoesNotExist:
            return Response({"detail": "OC no existe"}, status=404)
        return Response(OcSerializer(o).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = OcSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            o = Oc.objects.get(pk=pk)
        except Oc.DoesNotExist:
            return Response({"detail": "OC no existe"}, status=404)
        s = OcSerializer(o, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Oc.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoOcCat.objects.all()])

    # ── KPIs globales ─────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        total = abiertas = cerradas = 0
        total_value = total_paid = 0.0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COUNT(*),
                           COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
                           COUNT(*) FILTER (WHERE estado = 'CERRADO'),
                           COALESCE(SUM(total_value),0),
                           COALESCE(SUM(total_paid),0)
                    FROM expedientes.oc
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                total, abiertas, cerradas = r[0], r[1], r[2]
                total_value, total_paid = float(r[3]), float(r[4])
            except Exception:
                pass
        return Response({
            "total":         total,
            "abiertas":      abiertas,
            "cerradas":      cerradas,
            "total_value":   total_value,
            "total_paid":    total_paid,
            "balance":       total_value - total_paid,
        })


# ════════════════════════════════════════════════════════════
# Expediente
# ════════════════════════════════════════════════════════════
class ExpedienteViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Expediente.objects.filter(is_active=True).order_by("-last_event_at", "-created_at")
        mapping = {
            "oc":             "oc_id",
            "client":         "client_id",
            "brand":          "brand_id",
            "estado":         "estado",
            "modo_operacion": "modo_operacion",
            "phase_signal":   "phase_signal",
            "credit_band":    "credit_band",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        is_blocked = request.query_params.get("is_blocked")
        if is_blocked in ("true", "false"):
            qs = qs.filter(is_blocked=(is_blocked == "true"))
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(ExpedienteListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            e = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)
        return Response(ExpedienteSerializer(e).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ExpedienteSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            e = Expediente.objects.get(pk=pk)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)
        s = ExpedienteSerializer(e, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Expediente.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([
            {"codigo": e.codigo, "label": e.label, "color": e.color,
             "orden": e.orden, "baseline_dias": e.baseline_dias}
            for e in EstadoExpedienteCat.objects.all()
        ])

    @action(detail=False, methods=["get"])
    def select_modos(self, request):
        return Response([{"codigo": m.codigo, "label": m.label, "descripcion": m.descripcion}
                         for m in ModoOperacionCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_incoterms(self, request):
        return Response([{"codigo": i.codigo, "label": i.label}
                         for i in IncotermCat.objects.all()])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """KPIs globales del dashboard CEO."""
        out = {
            "total": 0, "activos": 0, "bloqueados": 0,
            "total_invoiced": 0.0, "total_paid": 0.0, "receivables": 0.0,
            "credit_60_75": 0, "credit_75_plus": 0, "factory_delayed": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO')),
                      COUNT(*) FILTER (WHERE is_blocked = TRUE),
                      COALESCE(SUM(total_invoiced),0),
                      COALESCE(SUM(total_paid),0),
                      COALESCE(SUM(balance),0),
                      COUNT(*) FILTER (WHERE credit_days > 60 AND credit_days <= 75),
                      COUNT(*) FILTER (WHERE credit_days > 75),
                      COUNT(*) FILTER (WHERE factory_delay = TRUE)
                    FROM expedientes.expediente
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":            r[0],
                    "activos":          r[1],
                    "bloqueados":       r[2],
                    "total_invoiced":   float(r[3]),
                    "total_paid":       float(r[4]),
                    "receivables":      float(r[5]),
                    "credit_60_75":     r[6],
                    "credit_75_plus":   r[7],
                    "factory_delayed":  r[8],
                }
            except Exception:
                pass
        return Response(out)

    # ── Líneas de un expediente ───────────────────────
    @action(detail=True, methods=["get"])
    def lineas(self, request, pk=None):
        qs = Linea.objects.filter(expediente_id=pk, is_active=True).order_by("sku", "size")
        return Response(LineaSerializer(qs, many=True).data)

    # ── Documentos de un expediente ───────────────────
    @action(detail=True, methods=["get"])
    def documentos(self, request, pk=None):
        qs = Documento.objects.filter(expediente_id=pk, is_active=True).order_by("-fecha", "-created_at")
        return Response(DocumentoSerializer(qs, many=True).data)


# ════════════════════════════════════════════════════════════
# Línea (se expone para edición en bloque)
# ════════════════════════════════════════════════════════════
class LineaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Linea.objects.filter(is_active=True)
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"),
                     ("producto", "producto_id"), ("sap", "sap"),
                     ("estado", "estado")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(LineaSerializer(qs.order_by("sku", "size"), many=True).data)

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
# Documento
# ════════════════════════════════════════════════════════════
class DocumentoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Documento.objects.filter(is_active=True).order_by("-fecha", "-created_at")
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"), ("kind", "kind")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(DocumentoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        return Response(DocumentoSerializer(d).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = DocumentoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            d = Documento.objects.get(pk=pk)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        s = DocumentoSerializer(d, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Documento.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Presigned URL (GET) para ver/descargar el documento ──
    @action(detail=True, methods=["get"])
    def signed_url(self, request, pk=None):
        """Devuelve una URL firmada (TTL 15min por defecto) para el objeto
        asociado al documento. Usa `bucket_key` si existe, o deriva uno
        determinista a partir de expediente_id+id si falta."""
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)

        key = getattr(d, "bucket_key", None) or f"expedientes/{d.expediente_id}/{d.id}"
        ttl = int(request.query_params.get("ttl") or 900)

        try:
            from apps.storage.services import generate_signed_url  # noqa: PLC0415
            data = generate_signed_url(key=key, kind="get", ttl=ttl)
        except Exception as e:
            data = {"url": None, "available": False, "error": str(e), "key": key}

        data["documento_id"]  = str(d.id)
        data["expediente_id"] = str(d.expediente_id) if d.expediente_id else None
        return Response(data)
