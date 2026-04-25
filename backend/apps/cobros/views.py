"""
=====================================================================
MWT.ONE · apps.cobros.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/cobros/               (CobroViewSet)
  /api/pagos/                (PagoViewSet)
  /api/conciliaciones/       (ConciliacionViewSet)
  /api/vencimientos/         (VencimientoViewSet)
  /api/withholding-log/      (WithholdingLogViewSet)
  /api/fx-rate-history/      (FxRateHistoryViewSet)
  /api/collection-events/    (CollectionEventViewSet)

Reglas:
  - Al crear Pago con estado VERIFICADO se actualiza
    cobro.monto_pagado (+= pago.monto) de forma transaccional.
  - Idempotencia por external_id (Pago) y idempotence_token (Conciliacion).
  - Mora: calculada a partir de fecha_vencimiento vs. CURRENT_DATE.
  - collection_stage se actualiza en base a dias_mora (REMINDER / DUNNING /
    ESCALATED / LEGAL) al llamar refresh_mora.
  - Soft-delete: is_active = FALSE.
=====================================================================
"""
import uuid
from decimal import Decimal
from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.storage.services import delete_object as _storage_delete

from .models import (
    Cobro, Pago, Conciliacion,
    Vencimiento, WithholdingLog, FxRateHistory, CollectionEvent,
    MetodoCat, EstadoPagoCat, DireccionCat,
    BucketMoraCat, CollectionStageCat,
)
from .serializers import (
    CobroSerializer, CobroListSerializer,
    PagoSerializer, PagoListSerializer,
    ConciliacionSerializer,
    VencimientoSerializer, WithholdingLogSerializer,
    FxRateHistorySerializer, CollectionEventSerializer,
)


# ════════════════════════════════════════════════════════════
# Helpers — mora + stage
# ════════════════════════════════════════════════════════════
def _bucket_for_days(dias):
    """Retorna el código del bucket según días de mora (canónico BLOQUE 3)."""
    if dias is None or dias <= 0:
        return "T0"
    if dias <= 30:
        return "T1"
    if dias <= 60:
        return "T2"
    if dias <= 90:
        return "T3"
    return "T4"


def _stage_for_days(dias):
    """NONE / REMINDER / DUNNING / ESCALATED / LEGAL."""
    if dias is None or dias < -3:
        return "NONE"
    if dias < 1:
        return "REMINDER"
    if dias <= 60:
        return "DUNNING"
    if dias <= 90:
        return "ESCALATED"
    return "LEGAL"


# ════════════════════════════════════════════════════════════
# Cobro
# ════════════════════════════════════════════════════════════
class CobroViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Cobro.objects.filter(is_active=True).order_by("-fecha_vencimiento", "-created_at")
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"),
                     ("client", "client_id"), ("estado", "estado"), ("moneda", "moneda"),
                     ("bucket_mora", "bucket_mora"), ("collection_stage", "collection_stage")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        if request.query_params.get("en_mora") == "1":
            qs = qs.filter(dias_mora__gt=0)
        return Response(CobroListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            c = Cobro.objects.get(pk=pk, is_active=True)
        except Cobro.DoesNotExist:
            return Response({"detail": "Cobro no existe"}, status=404)
        data = CobroSerializer(c).data
        data["vencimientos"] = VencimientoSerializer(
            Vencimiento.objects.filter(cobro_id=c.id, is_active=True), many=True,
        ).data
        return Response(data)

    def create(self, request):
        s = CobroSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoPagoCat.objects.filter(is_active=True)])

    @action(detail=False, methods=["get"])
    def select_buckets(self, request):
        return Response([
            {"codigo": b.codigo, "label": b.label, "color": b.color,
             "dias_min": b.dias_min, "dias_max": b.dias_max}
            for b in BucketMoraCat.objects.filter(is_active=True)
        ])

    @action(detail=False, methods=["get"])
    def select_collection_stages(self, request):
        return Response([
            {"codigo": s.codigo, "label": s.label, "color": s.color,
             "descripcion": s.descripcion, "dias_trigger": s.dias_trigger}
            for s in CollectionStageCat.objects.filter(is_active=True)
        ])

    # ── Plan de vencimientos T1/T2/T3 ──────────────────
    @action(detail=True, methods=["get", "post"], url_path="vencimientos")
    def vencimientos(self, request, pk=None):
        if request.method == "GET":
            qs = Vencimiento.objects.filter(cobro_id=pk, is_active=True)
            return Response(VencimientoSerializer(qs, many=True).data)
        # POST: crea o reemplaza el plan entero
        # Body: { plan: [{tramo, pct_monto, monto_usd, fecha_vencimiento}, ...] }
        body = request.data or {}
        plan = body.get("plan") or []
        with transaction.atomic():
            Vencimiento.objects.filter(cobro_id=pk, is_active=True).update(is_active=False)
            out = []
            for v in plan:
                payload = {**v, "cobro_id": pk}
                s = VencimientoSerializer(data=payload)
                s.is_valid(raise_exception=True)
                s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
                out.append(s.data)
        return Response({"count": len(out), "plan": out}, status=201)

    # ── Refresh mora (todos / por id) ─────────────────
    @action(detail=False, methods=["post"], url_path="refresh_mora")
    def refresh_mora(self, request):
        """
        Recalcula dias_mora / bucket_mora / collection_stage.
        Body opcional: { cobro_id? } para limitar a uno.
        """
        cobro_id = (request.data or {}).get("cobro_id")
        qs = Cobro.objects.filter(is_active=True)
        if cobro_id:
            qs = qs.filter(pk=cobro_id)

        today     = timezone.now().date()
        updated   = 0
        for c in qs:
            if not c.fecha_vencimiento or (c.monto_pendiente or 0) <= 0:
                dias = 0
            else:
                dias = (today - c.fecha_vencimiento).days
            bucket = _bucket_for_days(dias)
            stage  = _stage_for_days(dias)
            Cobro.objects.filter(pk=c.id).update(
                dias_mora        = max(0, dias),
                bucket_mora      = bucket,
                collection_stage = stage,
            )
            updated += 1
        return Response({"updated": updated})

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "pendientes": 0, "parciales": 0, "pagados": 0,
            "monto_total": 0.0, "monto_pagado": 0.0, "monto_pendiente": 0.0,
            "t1": 0, "t2": 0, "t3": 0, "t4": 0,
            "monto_t1_usd": 0.0, "monto_t2_usd": 0.0,
            "monto_t3_usd": 0.0, "monto_t4_usd": 0.0,
            "en_legal": 0,
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
                      COUNT(*) FILTER (WHERE bucket_mora = 'T1' AND monto_pendiente > 0),
                      COUNT(*) FILTER (WHERE bucket_mora = 'T2' AND monto_pendiente > 0),
                      COUNT(*) FILTER (WHERE bucket_mora = 'T3' AND monto_pendiente > 0),
                      COUNT(*) FILTER (WHERE bucket_mora = 'T4' AND monto_pendiente > 0),
                      COALESCE(SUM(monto_pendiente) FILTER (WHERE bucket_mora = 'T1'), 0),
                      COALESCE(SUM(monto_pendiente) FILTER (WHERE bucket_mora = 'T2'), 0),
                      COALESCE(SUM(monto_pendiente) FILTER (WHERE bucket_mora = 'T3'), 0),
                      COALESCE(SUM(monto_pendiente) FILTER (WHERE bucket_mora = 'T4'), 0),
                      COUNT(*) FILTER (WHERE collection_stage = 'LEGAL')
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
                    "t1": r[7], "t2": r[8], "t3": r[9], "t4": r[10],
                    "monto_t1_usd": float(r[11]),
                    "monto_t2_usd": float(r[12]),
                    "monto_t3_usd": float(r[13]),
                    "monto_t4_usd": float(r[14]),
                    "en_legal":     r[15],
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
                     ("estado", "estado"), ("metodo", "metodo"), ("moneda", "moneda"),
                     ("external_id", "external_id"), ("bank_statement_id", "bank_statement_id")):
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
        data = PagoSerializer(p).data
        data["retenciones"] = WithholdingLogSerializer(
            WithholdingLog.objects.filter(pago_id=p.id, is_active=True), many=True,
        ).data
        return Response(data)

    def create(self, request):
        """Crea un pago; si está VERIFICADO actualiza cobro.monto_pagado.
        Idempotente por external_id (si viene)."""
        data = {**request.data}

        # ── Idempotencia por external_id ───────────────
        external_id = data.get("external_id")
        if external_id:
            prev = Pago.objects.filter(external_id=external_id, is_active=True).first()
            if prev:
                return Response(PagoSerializer(prev).data, status=200)

        # Asegurar monto_usd si no viene
        if not data.get("monto_usd"):
            monto   = Decimal(str(data.get("monto", 0)))
            fx_rate = Decimal(str(data.get("fx_rate", 1)))
            data["monto_usd"] = str(monto * fx_rate)

        s = PagoSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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
        # Capturar TODAS las keys ANTES del save/delete
        keys = [
            p.comprobante_url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            Pago.objects.filter(pk=pk).update(is_active=False)
            if p.estado == "VERIFICADO":
                self._aplicar_delta_cobro(p.cobro_id, -p.monto, "REVERSO")
            # ON COMMIT: solo si la transacción de BD se confirma, borramos
            # el objeto del bucket. Evita huérfanos en caso de rollback.
            for k in keys:
                transaction.on_commit(lambda key=k: _storage_delete(key))
        return Response(status=204)

    # ── Retenciones (append-only log por pago) ────────
    @action(detail=True, methods=["get", "post"], url_path="retenciones")
    def retenciones(self, request, pk=None):
        if request.method == "GET":
            qs = WithholdingLog.objects.filter(pago_id=pk, is_active=True)
            return Response(WithholdingLogSerializer(qs, many=True).data)
        # POST
        data = {**request.data, "pago_id": pk}
        s = WithholdingLogSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_metodos(self, request):
        return Response([{"codigo": m.codigo, "label": m.label, "direccion": m.direccion}
                         for m in MetodoCat.objects.filter(is_active=True)])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoPagoCat.objects.filter(is_active=True)])

    @action(detail=False, methods=["get"])
    def select_direcciones(self, request):
        return Response([{"codigo": d.codigo, "label": d.label}
                         for d in DireccionCat.objects.filter(is_active=True)])

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
                     ("cobro", "cobro_id"), ("external_ref", "external_ref")):
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
        data = {**request.data}
        # ── Idempotencia por idempotence_token ─────────
        token = data.get("idempotence_token")
        if token:
            prev = Conciliacion.objects.filter(idempotence_token=token, is_active=True).first()
            if prev:
                return Response(ConciliacionSerializer(prev).data, status=200)
        s = ConciliacionSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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


# ════════════════════════════════════════════════════════════
# Vencimiento (Plan de pagos T1/T2/T3)
# ════════════════════════════════════════════════════════════
class VencimientoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Vencimiento.objects.filter(is_active=True).order_by("fecha_vencimiento")
        for p, f in (("cobro", "cobro_id"), ("estado", "estado"), ("tramo", "tramo")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(VencimientoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            v = Vencimiento.objects.get(pk=pk, is_active=True)
        except Vencimiento.DoesNotExist:
            return Response({"detail": "Vencimiento no existe"}, status=404)
        return Response(VencimientoSerializer(v).data)

    def create(self, request):
        s = VencimientoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            v = Vencimiento.objects.get(pk=pk)
        except Vencimiento.DoesNotExist:
            return Response({"detail": "Vencimiento no existe"}, status=404)
        s = VencimientoSerializer(v, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Vencimiento.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Withholding log (append-only)
# ════════════════════════════════════════════════════════════
class WithholdingLogViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = WithholdingLog.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("pago", "pago_id"), ("cobro", "cobro_id"), ("tipo", "tipo")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(WithholdingLogSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            w = WithholdingLog.objects.get(pk=pk, is_active=True)
        except WithholdingLog.DoesNotExist:
            return Response({"detail": "Retención no existe"}, status=404)
        return Response(WithholdingLogSerializer(w).data)

    def create(self, request):
        s = WithholdingLogSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)


# ════════════════════════════════════════════════════════════
# FX Rate history
# ════════════════════════════════════════════════════════════
class FxRateHistoryViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = FxRateHistory.objects.filter(is_active=True).order_by("-fecha")
        for p, f in (("moneda_from", "moneda_from"), ("moneda_to", "moneda_to"),
                     ("source", "source"), ("fecha", "fecha")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(FxRateHistorySerializer(qs[:limit], many=True).data)

    def create(self, request):
        """Idempotente por (fecha, moneda_from, moneda_to, source)."""
        data = {**request.data}
        prev = FxRateHistory.objects.filter(
            fecha       = data.get("fecha"),
            moneda_from = data.get("moneda_from"),
            moneda_to   = data.get("moneda_to") or "USD",
            source      = data.get("source"),
            is_active   = True,
        ).first()
        if prev:
            return Response(FxRateHistorySerializer(prev).data, status=200)
        s = FxRateHistorySerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """
        Devuelve el TC más reciente (≤ fecha) para el par dado.
        GET /api/fx-rate-history/lookup/?moneda_from=PEN&fecha=2026-04-21
        """
        mf     = request.query_params.get("moneda_from")
        mt     = request.query_params.get("moneda_to", "USD")
        fecha  = request.query_params.get("fecha") or timezone.now().date().isoformat()
        source = request.query_params.get("source")
        qs = FxRateHistory.objects.filter(
            moneda_from=mf, moneda_to=mt, fecha__lte=fecha, is_active=True,
        ).order_by("-fecha")
        if source:
            qs = qs.filter(source=source)
        row = qs.first()
        if not row:
            return Response({"detail": "Sin TC disponible"}, status=404)
        return Response(FxRateHistorySerializer(row).data)


# ════════════════════════════════════════════════════════════
# CollectionEvent (log inmutable del CollectionBot)
# ════════════════════════════════════════════════════════════
class CollectionEventViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = CollectionEvent.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("cobro", "cobro_id"), ("client", "client_id"),
                     ("canal", "canal"), ("stage", "stage"), ("outcome", "outcome")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(CollectionEventSerializer(qs[:limit], many=True).data)

    def create(self, request):
        data = {**request.data}
        s = CollectionEventSerializer(data=data)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
            # bump last_reminder_at en el cobro
            if data.get("cobro_id"):
                Cobro.objects.filter(pk=data["cobro_id"]).update(
                    last_reminder_at=timezone.now(),
                )
        return Response(s.data, status=201)
