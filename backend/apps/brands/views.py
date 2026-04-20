import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Marca, CategoriaCat, EstadoCat
from .serializers import MarcaSerializer, MarcaListSerializer


class MarcaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Marca.objects.filter(is_active=True).order_by("nombre")
        mapping = {
            "estado":    "estado_comercial",
            "categoria": "categoria_principal",
            "pais":      "pais_origen_iso2",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(nombre__icontains=q)
        return Response(MarcaListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            m = Marca.objects.get(pk=pk, is_active=True)
        except Marca.DoesNotExist:
            return Response({"detail": "Marca no existe"}, status=404)
        return Response(MarcaSerializer(m).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = MarcaSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            m = Marca.objects.get(pk=pk)
        except Marca.DoesNotExist:
            return Response({"detail": "Marca no existe"}, status=404)
        s = MarcaSerializer(m, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Marca.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects (cero hardcode FE) ────────────────────────
    @action(detail=False, methods=["get"])
    def select_categorias(self, request):
        return Response(
            [{"codigo": c.codigo, "label": c.label} for c in CategoriaCat.objects.all()]
        )

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response(
            [{"codigo": e.codigo, "label": e.label, "color": e.color}
             for e in EstadoCat.objects.all()]
        )

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
            return Response([
                {"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()
            ])

    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        """
        KPIs comerciales de la marca. Consulta productos/expedientes por UUID
        (sin FK) — si alguna tabla aún no existe, devolvemos 0 sin romper.
        """
        productos = expedientes = 0
        ventas_ytd = 0.0
        with connection.cursor() as c:
            try:
                c.execute(
                    "SELECT COUNT(*) FROM productos.producto "
                    "WHERE marca_id = %s AND is_active = TRUE", [pk]
                )
                productos = c.fetchone()[0]
            except Exception: pass
            try:
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente "
                    "WHERE marca_id = %s AND estado NOT IN ('CERRADO','CANCELADO')", [pk]
                )
                expedientes = c.fetchone()[0]
                c.execute(
                    "SELECT COALESCE(SUM(subtotal_usd),0) FROM expedientes.expediente "
                    "WHERE marca_id = %s "
                    "AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())", [pk]
                )
                ventas_ytd = float(c.fetchone()[0])
            except Exception: pass
        return Response({
            "productos_activos":    productos,
            "expedientes_abiertos": expedientes,
            "ventas_ytd_usd":       ventas_ytd,
        })
