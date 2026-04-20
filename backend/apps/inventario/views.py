import uuid
from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Stock, Movimiento, TipoMovimientoCat, MotivoCat
from .serializers import (
    StockSerializer, StockListSerializer, MovimientoSerializer,
)


# ============================================================
# StockViewSet  — /api/stock/
# ============================================================
class StockViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Stock.objects.filter(is_active=True).order_by("-updated_at")
        mapping = {
            "nodo":      "nodo_id",
            "producto":  "producto_id",
            "lote":      "lote",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        # Filtros derivados
        if request.query_params.get("solo_disponible") == "1":
            qs = qs.filter(cantidad_disponible__gt=0)
        if request.query_params.get("vencidos") == "1":
            from django.utils import timezone
            qs = qs.filter(fecha_vencimiento__lt=timezone.now().date())
        return Response(StockListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            s = Stock.objects.get(pk=pk, is_active=True)
        except Stock.DoesNotExist:
            return Response({"detail": "Stock no existe"}, status=404)
        return Response(StockSerializer(s).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = StockSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            obj = Stock.objects.get(pk=pk)
        except Stock.DoesNotExist:
            return Response({"detail": "Stock no existe"}, status=404)
        s = StockSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Stock.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_nodos(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, codigo || ' · ' || nombre FROM nodos.nodo
                WHERE is_active = TRUE ORDER BY codigo
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    @action(detail=False, methods=["get"])
    def select_productos(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, sku || ' · ' || nombre FROM productos.producto
                WHERE is_active = TRUE ORDER BY sku
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    # ── KPIs globales de inventario ──────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT
                    COALESCE(SUM(cantidad_disponible),0)            AS unidades_disp,
                    COALESCE(SUM(cantidad_reservada),0)             AS unidades_resv,
                    COALESCE(SUM(cantidad_en_transito),0)           AS unidades_trans,
                    COALESCE(SUM(cantidad_disponible*costo_unitario_usd),0) AS valor_disp_usd,
                    COUNT(DISTINCT producto_id)                     AS skus_distintos,
                    COUNT(DISTINCT nodo_id)                         AS nodos_con_stock
                FROM inventario.stock WHERE is_active = TRUE
            """)
            row = c.fetchone()
        return Response({
            "unidades_disponibles": float(row[0] or 0),
            "unidades_reservadas":  float(row[1] or 0),
            "unidades_en_transito": float(row[2] or 0),
            "valor_disponible_usd": float(row[3] or 0),
            "skus_distintos":       int(row[4] or 0),
            "nodos_con_stock":      int(row[5] or 0),
        })


# ============================================================
# MovimientoViewSet  — /api/movimientos/
# ============================================================
class MovimientoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Movimiento.objects.filter(is_active=True).order_by("-created_at")
        mapping = {
            "tipo":          "tipo",
            "motivo":        "motivo",
            "producto":      "producto_id",
            "nodo_origen":   "nodo_origen_id",
            "nodo_destino":  "nodo_destino_id",
            "referencia_id": "referencia_id",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(MovimientoSerializer(qs[:limit], many=True).data)

    def retrieve(self, request, pk=None):
        try:
            m = Movimiento.objects.get(pk=pk)
        except Movimiento.DoesNotExist:
            return Response({"detail": "Movimiento no existe"}, status=404)
        return Response(MovimientoSerializer(m).data)

    def create(self, request):
        """
        Crea movimiento Y aplica el delta al stock atómicamente.
        Body mínimo:
          { tipo, motivo?, producto_id, nodo_origen_id?, nodo_destino_id?,
            lote?, cantidad, costo_unitario_usd?, notas? }
        """
        data = {**request.data, "id": str(uuid.uuid4())}
        s = MovimientoSerializer(data=data)
        s.is_valid(raise_exception=True)

        tipo            = s.validated_data["tipo"]
        producto_id     = s.validated_data["producto_id"]
        nodo_origen_id  = s.validated_data.get("nodo_origen_id")
        nodo_destino_id = s.validated_data.get("nodo_destino_id")
        cantidad        = float(s.validated_data["cantidad"])
        lote            = s.validated_data.get("lote") or ""

        try:
            with transaction.atomic():
                m = s.save()
                # Aplicar delta al stock según tipo
                if tipo == "ENTRADA" and nodo_destino_id:
                    self._aplicar_delta(nodo_destino_id, producto_id, lote, +cantidad)
                elif tipo == "SALIDA" and nodo_origen_id:
                    self._aplicar_delta(nodo_origen_id, producto_id, lote, -cantidad)
                elif tipo == "TRANSFER" and nodo_origen_id and nodo_destino_id:
                    self._aplicar_delta(nodo_origen_id,  producto_id, lote, -cantidad)
                    self._aplicar_delta(nodo_destino_id, producto_id, lote, +cantidad)
                elif tipo == "AJUSTE" and (nodo_destino_id or nodo_origen_id):
                    self._aplicar_delta(nodo_destino_id or nodo_origen_id,
                                        producto_id, lote, cantidad)
                # MERMA / RETORNO / RESERVA / LIBERA: el FE ya las modela explícitas
        except Exception as e:
            return Response({"detail": f"Error aplicando movimiento: {e}"}, status=400)

        return Response(MovimientoSerializer(m).data, status=201)

    @staticmethod
    def _aplicar_delta(nodo_id, producto_id, lote, delta):
        """UPSERT en inventario.stock por (nodo, producto, lote)."""
        with connection.cursor() as c:
            c.execute("""
                INSERT INTO inventario.stock
                    (id, nodo_id, producto_id, lote,
                     cantidad_disponible, last_movement_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, NOW())
                ON CONFLICT (nodo_id, producto_id, lote)
                DO UPDATE SET
                    cantidad_disponible = inventario.stock.cantidad_disponible + EXCLUDED.cantidad_disponible,
                    last_movement_at    = NOW(),
                    updated_at          = NOW()
            """, [str(nodo_id), str(producto_id), lote, delta])

    # ── Selects ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response([{"codigo": t.codigo, "label": t.label,
                          "direccion": t.direccion, "color": t.color}
                         for t in TipoMovimientoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_motivos(self, request):
        tipo_mov = request.query_params.get("tipo_mov")
        qs = MotivoCat.objects.all()
        if tipo_mov:
            qs = qs.filter(tipo_mov=tipo_mov)
        return Response([{"codigo": m.codigo, "label": m.label, "tipo_mov": m.tipo_mov}
                         for m in qs])
