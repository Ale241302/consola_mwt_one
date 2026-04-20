import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Cliente, TipoCat, EstadoCat, SegmentoCat
from .serializers import ClienteSerializer, ClienteListSerializer


class ClienteViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Cliente.objects.filter(is_active=True).order_by("razon_social")
        mapping = {
            "tipo":     "tipo",
            "estado":   "estado",
            "segmento": "segmento",
            "pais":     "pais_iso2",
            "nodo":     "nodo_asignado_id",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(razon_social__icontains=q)
        return Response(ClienteListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            c = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)
        return Response(ClienteSerializer(c).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ClienteSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            c = Cliente.objects.get(pk=pk)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)
        s = ClienteSerializer(c, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Cliente.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response([{"codigo": t.codigo, "label": t.label} for t in TipoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response(
            [{"codigo": e.codigo, "label": e.label, "color": e.color}
             for e in EstadoCat.objects.all()]
        )

    @action(detail=False, methods=["get"])
    def select_segmentos(self, request):
        return Response(
            [{"codigo": s.codigo, "label": s.label, "color": s.color}
             for s in SegmentoCat.objects.all()]
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
    def select_nodos(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, codigo || ' · ' || nombre FROM nodos.nodo
                WHERE is_active = TRUE ORDER BY codigo
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

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

    # ── KPIs comerciales del cliente ──────────────────
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        total_exp = exp_abiertos = exp_mora = 0
        ventas_ytd = 0.0
        with connection.cursor() as c:
            try:
                c.execute("SELECT COUNT(*) FROM expedientes.expediente WHERE cliente_id = %s", [pk])
                total_exp = c.fetchone()[0]
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente "
                    "WHERE cliente_id = %s AND estado NOT IN ('CERRADO','CANCELADO')", [pk]
                )
                exp_abiertos = c.fetchone()[0]
                c.execute(
                    "SELECT COALESCE(SUM(subtotal_usd),0) FROM expedientes.expediente "
                    "WHERE cliente_id = %s "
                    "AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())", [pk]
                )
                ventas_ytd = float(c.fetchone()[0])
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente "
                    "WHERE cliente_id = %s AND estado = 'MORA'", [pk]
                )
                exp_mora = c.fetchone()[0]
            except Exception:
                # Si expedientes.expediente aún no existe, devolvemos ceros.
                pass
        return Response({
            "total_expedientes":    total_exp,
            "expedientes_abiertos": exp_abiertos,
            "ventas_ytd_usd":       ventas_ytd,
            "expedientes_mora":     exp_mora,
        })
