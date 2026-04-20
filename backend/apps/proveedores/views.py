import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Proveedor, TipoCat, EstadoCat, IncotermCat
from .serializers import ProveedorSerializer, ProveedorListSerializer


class ProveedorViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Proveedor.objects.filter(is_active=True).order_by("razon_social")
        mapping = {
            "tipo":   "tipo",
            "estado": "estado",
            "pais":   "pais_iso2",
            "incoterm": "incoterm_default",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(razon_social__icontains=q)
        return Response(ProveedorListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            p = Proveedor.objects.get(pk=pk, is_active=True)
        except Proveedor.DoesNotExist:
            return Response({"detail": "Proveedor no existe"}, status=404)
        return Response(ProveedorSerializer(p).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ProveedorSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            p = Proveedor.objects.get(pk=pk)
        except Proveedor.DoesNotExist:
            return Response({"detail": "Proveedor no existe"}, status=404)
        s = ProveedorSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Proveedor.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response([{"codigo": t.codigo, "label": t.label, "color": t.color}
                         for t in TipoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_incoterms(self, request):
        return Response([{"codigo": i.codigo, "label": i.label, "descripcion": i.descripcion}
                         for i in IncotermCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_paises(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT iso2, label FROM core.pais_cat
                WHERE is_active = TRUE ORDER BY orden, label
            """)
            return Response([{"codigo": r[0], "label": r[1]} for r in c.fetchall()])

    @action(detail=False, methods=["get"])
    def select_responsables(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, full_name FROM core.users
                WHERE is_active = TRUE AND deleted_at IS NULL
                ORDER BY full_name
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    # ── KPIs comerciales ──────────────────────────────
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        total_skus = oc_abiertas = oc_cerradas = 0
        spend_ytd = 0.0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COUNT(*) FROM productos.producto
                    WHERE proveedor_principal_id = %s AND is_active = TRUE
                """, [pk])
                total_skus = c.fetchone()[0]
            except Exception:
                pass
            try:
                c.execute("""
                    SELECT COUNT(*) FROM expedientes.oc
                    WHERE proveedor_id = %s AND estado NOT IN ('CERRADA','CANCELADA')
                """, [pk])
                oc_abiertas = c.fetchone()[0]
                c.execute("""
                    SELECT COUNT(*) FROM expedientes.oc
                    WHERE proveedor_id = %s AND estado = 'CERRADA'
                """, [pk])
                oc_cerradas = c.fetchone()[0]
                c.execute("""
                    SELECT COALESCE(SUM(total_usd),0) FROM expedientes.oc
                    WHERE proveedor_id = %s
                    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
                """, [pk])
                spend_ytd = float(c.fetchone()[0])
            except Exception:
                pass
        return Response({
            "total_skus":    total_skus,
            "oc_abiertas":   oc_abiertas,
            "oc_cerradas":   oc_cerradas,
            "spend_ytd_usd": spend_ytd,
        })
