import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Producto, CategoriaCat, SubcategoriaCat, UnidadCat, EstadoCat
from .serializers import ProductoSerializer, ProductoListSerializer


class ProductoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Producto.objects.filter(is_active=True).order_by("nombre")
        mapping = {
            "marca":        "marca_id",
            "categoria":    "categoria",
            "subcategoria": "subcategoria",
            "estado":       "estado",
            "proveedor":    "proveedor_principal_id",
            "pais":         "pais_origen_iso2",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(nombre__icontains=q)
        return Response(ProductoListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            p = Producto.objects.get(pk=pk, is_active=True)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)
        return Response(ProductoSerializer(p).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ProductoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            p = Producto.objects.get(pk=pk)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)
        s = ProductoSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Producto.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_categorias(self, request):
        return Response([{"codigo": c.codigo, "label": c.label, "color": c.color}
                         for c in CategoriaCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_subcategorias(self, request):
        cat = request.query_params.get("categoria")
        qs = SubcategoriaCat.objects.all()
        if cat:
            qs = qs.filter(categoria_code=cat)
        return Response([{"codigo": s.codigo, "label": s.label, "categoria_code": s.categoria_code}
                         for s in qs])

    @action(detail=False, methods=["get"])
    def select_unidades(self, request):
        return Response([{"codigo": u.codigo, "label": u.label, "factor": str(u.factor)}
                         for u in UnidadCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_marcas(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, nombre FROM brands.marca
                WHERE is_active = TRUE ORDER BY nombre
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    @action(detail=False, methods=["get"])
    def select_proveedores(self, request):
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT id, COALESCE(nombre_comercial, razon_social)
                    FROM proveedores.proveedor
                    WHERE is_active = TRUE ORDER BY razon_social
                """)
                return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])
            except Exception:
                return Response([])

    @action(detail=False, methods=["get"])
    def select_paises(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT iso2, label FROM core.pais_cat
                WHERE is_active = TRUE ORDER BY orden, label
            """)
            return Response([{"codigo": r[0], "label": r[1]} for r in c.fetchall()])

    # ── KPIs por SKU ──────────────────────────────────
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        stock_total = stock_disp = stock_resv = 0.0
        nodos_con_stock = 0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COALESCE(SUM(cantidad_disponible),0),
                           COALESCE(SUM(cantidad_reservada),0),
                           COALESCE(SUM(cantidad_disponible+cantidad_reservada+cantidad_en_transito),0),
                           COUNT(DISTINCT nodo_id)
                    FROM inventario.stock
                    WHERE producto_id = %s AND is_active = TRUE
                """, [pk])
                row = c.fetchone()
                stock_disp, stock_resv, stock_total, nodos_con_stock = (
                    float(row[0]), float(row[1]), float(row[2]), int(row[3])
                )
            except Exception:
                pass
        return Response({
            "stock_total":       stock_total,
            "stock_disponible":  stock_disp,
            "stock_reservado":   stock_resv,
            "nodos_con_stock":   nodos_con_stock,
        })
