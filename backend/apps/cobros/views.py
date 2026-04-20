"""
=====================================================================
MWT.ONE · apps.cobros.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/cobros/          (CobroViewSet)
  /api/pagos/           (PagoViewSet)
  /api/conciliaciones/  (ConciliacionViewSet)

Reglas:
  - Al crear Pago con estado VERIFICADO se actualiza
    cobro.monto_pagado (+= pago.monto) de forma transaccional.
  - Soft-delete: is_active = FALSE.
=====================================================================
"""
import uuid
from decimal import Decimal
from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Cobro, Pago, Conciliacion,
    MetodoCat, EstadoPagoCat, DireccionCat,
)
from .serializers import (
    CobroSerializer, CobroListSerializer,
    PagoSerializer, PagoListSerializer,
    ConciliacionSerializer,
)


# ════════════════════════════════════════════════════════════
# Cobro
# ════════════════════════════════════════════════════════════
class CobroViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Cobro.objects.filter(is_active=True).order_by("-fecha_vencimiento", "-created_at")
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"),
                     ("client", "client_id"), ("estado", "estado"), ("moneda", "moneda")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(CobroListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            c = Cobro.objects.get(pk=pk, is_active=True)
        except Cobro.DoesNotExist:
            return Response({"detail": "Cobro no existe"}, status=404)
        return Response(CobroSerializer(c).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = CobroSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            c = Cobro.objects.get(pk=pk)
        except Cobro.DoesNotExist:
            return Response({"detail": "Cobro no existe"}, status=404)
        s = CobroSerializer(c, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Cobro.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoPagoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "pendientes": 0, "parciales": 0, "pagados": 0,
            "monto_total": 0.0, "monto_pagado": 0.0, "monto_pendiente": 0.0,
            "vencidos_30": 0, "vencidos_60": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado = 'PENDIENTE'),
                      COUNT(*) FILTER (WHERE monto_pagado > 0 AND monto_pendiente > 0),
                      COUNT(*) FILTER (WHERE monto_pendiente = 0),
                      COALESCE(SUM(monto_total),0),
                      COALESCE(SUM(monto_pagado),0),
                      COALESCE(SUM(monto_pendiente),0),
                      COUNT(*) FILTER (WHERE fecha_vencimiento < CURRENT_DATE - INTERVAL '30 days' AND monto_pendiente > 0),
                      COUNT(*) FILTER (WHERE fecha_vencimiento < CURRENT_DATE - INTERVAL '60 days' AND monto_pendiente > 0)
                    FROM cobros.cobro
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":           r[0],
                    "pendientes":      r[1],
                    "parciales":       r[2],
                    "pagados":         r[3],
                    "monto_total":     float(r[4]),
                    "monto_pagado":    float(r[5]),
                    "monto_pendiente": float(r[6]),
                    "vencidos_30":     r[7],
                    "vencidos_60":     r[8],
                }
            except Exception:
                pass
        return Response(out)


# ════════════════════════════════════════════════════════════
# Pago
# ════════════════════════════════════════════════════════════
class PagoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Pago.objects.filter(is_active=True).order_by("-fecha_operacion", "-created_at")
        for p, f in (("cobro", "cobro_id"), ("oc", "oc_id"),
                     ("expediente", "expediente_id"), ("client", "client_id"),
                     ("proveedor", "proveedor_id"), ("direccion", "direccion"),
                     ("estado", "estado"), ("metodo", "metodo"), ("moneda", "moneda")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(PagoListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            p = Pago.objects.get(pk=pk, is_active=True)
        except Pago.DoesNotExist:
            return Response({"detail": "Pago no existe"}, status=404)
        return Response(PagoSerializer(p).data)

    def create(self, request):
        """Crea un pago; si está VERIFICADO actualiza cobro.monto_pagado."""
        data = {**request.data, "id": str(uuid.uuid4())}
        # asegurar monto_usd si no viene
        if not data.get("monto_usd"):
            monto   = Decimal(str(data.get("monto", 0)))
            fx_rate = Decimal(str(data.get("fx_rate", 1)))
            data["monto_usd"] = str(monto * fx_rate)

        s = PagoSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            self._aplicar_delta_cobro(data.get("cobro_id"),
                                      Decimal(str(data.get("monto", 0))),
                                      data.get("estado", "PENDIENTE"))
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            p = Pago.objects.get(pk=pk)
        except Pago.DoesNotExist:
            return Response({"detail": "Pago no existe"}, status=404)
        prev_estado = p.estado
        prev_monto  = p.monto
        prev_cobro  = p.cobro_id
        s = PagoSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            p.refresh_from_db()
            # Si pasó a VERIFICADO (no lo estaba antes): +monto
            if prev_estado != "VERIFICADO" and p.estado == "VERIFICADO":
                self._aplicar_delta_cobro(p.cobro_id, p.monto, "VERIFICADO")
            # Si estaba VERIFICADO y pasa a otro (e.g. RECHAZADO/REVERTIDO): -monto_previo
            elif prev_estado == "VERIFICADO" and p.estado != "VERIFICADO":
                self._aplicar_delta_cobro(prev_cobro, -prev_monto, "REVERSO")
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        try:
            p = Pago.objects.get(pk=pk)
        except Pago.DoesNotExist:
            return Response(status=204)
        with transaction.atomic():
            Pago.objects.filter(pk=pk).update(is_active=False)
            if p.estado == "VERIFICADO":
                self._aplicar_delta_cobro(p.cobro_id, -p.monto, "REVERSO")
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_metodos(self, request):
        return Response([{"codigo": m.codigo, "label": m.label, "direccion": m.direccion}
                         for m in MetodoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoPagoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_direcciones(self, request):
        return Response([{"codigo": d.codigo, "label": d.label}
                         for d in DireccionCat.objects.all()])

    # ── Helpers ───────────────────────────────────────
    @staticmethod
    def _aplicar_delta_cobro(cobro_id, delta_monto, estado_pago):
        """Actualiza cobro.monto_pagado sólo si el pago está VERIFICADO.
        El signo del delta ya viene ajustado por el caller."""
        if not cobro_id:
            return
        if estado_pago != "VERIFICADO" and estado_pago != "REVERSO":
            return
        with connection.cursor() as c:
            try:
                c.execute("""
                    UPDATE cobros.cobro
                    SET monto_pagado = GREATEST(monto_pagado + %s, 0),
                        estado = CASE
                                   WHEN monto_total - (monto_pagado + %s) <= 0 THEN 'CONCILIADO'
                                   WHEN monto_pagado + %s > 0 THEN 'PENDIENTE'
                                   ELSE 'PENDIENTE'
                                 END
                    WHERE id = %s
                """, [delta_monto, delta_monto, delta_monto, cobro_id])
            except Exception:
                pass


# ════════════════════════════════════════════════════════════
# Conciliación
# ════════════════════════════════════════════════════════════
class ConciliacionViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Conciliacion.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("ingreso", "pago_ingreso_id"), ("egreso", "pago_egreso_id"),
                     ("cobro", "cobro_id")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(ConciliacionSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            c = Conciliacion.objects.get(pk=pk, is_active=True)
        except Conciliacion.DoesNotExist:
            return Response({"detail": "Conciliación no existe"}, status=404)
        return Response(ConciliacionSerializer(c).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ConciliacionSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            c = Conciliacion.objects.get(pk=pk)
        except Conciliacion.DoesNotExist:
            return Response({"detail": "Conciliación no existe"}, status=404)
        s = ConciliacionSerializer(c, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Conciliacion.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)
