import uuid
from datetime import date
from decimal import Decimal

from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Cliente, TipoCat, EstadoCat, SegmentoCat,
    CanalCat, MedioPagoCat, IncotermCat,
    ClienteCreditSnapshot,
)
from .serializers import (
    ClienteSerializer, ClienteListSerializer,
    ClienteCreditSnapshotSerializer,
)


def _calc_semaforo(tasa_util: float, dias_mora: int) -> str:
    """Regla canónica del semáforo — fuente única (BE)."""
    if dias_mora >= 60 or tasa_util >= 100:
        return "BLOQUEADO"
    if dias_mora >= 30 or tasa_util >= 85:
        return "ROJO"
    if dias_mora >= 15 or tasa_util >= 70:
        return "AMBAR"
    return "VERDE"


class ClienteViewSet(viewsets.ViewSet):
    """
    CRUD de clientes B2B · sprint Cliente M3b.

    IMPORTANTE — POL_VISIBILIDAD:
      Los serializers aplican gate CEO-ONLY sobre los campos
      credito_limit_usd / credito_aprobado / comision_pct. Para que la
      política se active, el contexto debe incluir ``request`` (lo que
      hacemos en `_ctx()` y pasamos a cada Serializer).
    """

    def _ctx(self, request):
        """Context estándar DRF — requerido para POL_VISIBILIDAD."""
        return {"request": request, "view": self}

    def list(self, request):
        qs = Cliente.objects.filter(is_active=True).order_by("razon_social")
        mapping = {
            "tipo":     "tipo",
            "estado":   "estado",
            "segmento": "segmento",
            "pais":     "pais_iso2",
            "nodo":     "nodo_asignado_id",
            "canal":    "canal",
            "incoterm": "incoterm",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(razon_social__icontains=q)
        return Response(ClienteListSerializer(qs, many=True, context=self._ctx(request)).data)

    def retrieve(self, request, pk=None):
        try:
            c = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)
        return Response(ClienteSerializer(c, context=self._ctx(request)).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ClienteSerializer(data=data, context=self._ctx(request))
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            c = Cliente.objects.get(pk=pk)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)
        s = ClienteSerializer(c, data=request.data, partial=True,
                              context=self._ctx(request))
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
    def select_canales(self, request):
        return Response(
            [{"codigo": c.codigo, "label": c.label}
             for c in CanalCat.objects.filter(is_active=True).order_by("orden")]
        )

    @action(detail=False, methods=["get"])
    def select_medios_pago(self, request):
        return Response(
            [{"codigo": m.codigo, "label": m.label}
             for m in MedioPagoCat.objects.filter(is_active=True).order_by("orden")]
        )

    @action(detail=False, methods=["get"])
    def select_incoterms(self, request):
        return Response(
            [{"codigo": i.codigo, "label": i.label, "descripcion": i.descripcion}
             for i in IncotermCat.objects.filter(is_active=True).order_by("orden")]
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

    # ── Semáforo de crédito (BE = fuente única) ───────
    @action(detail=True, methods=["get"])
    def credit_history(self, request, pk=None):
        """Últimos N snapshots (default 30) ordenados desc."""
        limit = int(request.query_params.get("limit", 30))
        qs = (ClienteCreditSnapshot.objects
              .filter(cliente_id=pk, is_active=True)
              .order_by("-snapshot_date", "-created_at")[:limit])
        return Response(ClienteCreditSnapshotSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"])
    def refresh_credit(self, request, pk=None):
        """
        Recalcula el semáforo de crédito y upserta un snapshot para HOY.
        Regla: se guarda un único snapshot por cliente/día (idempotente).
        """
        try:
            cli = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        # Datos auxiliares del ERP (si la tabla existe).
        dias_mora_max     = 0
        facturas_vencidas = 0
        monto_vencido     = Decimal("0.00")
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COALESCE(MAX(dias_mora), 0),
                           COUNT(*) FILTER (WHERE dias_mora > 0),
                           COALESCE(SUM(monto_usd) FILTER (WHERE dias_mora > 0), 0)
                    FROM finanzas.factura_vencimiento
                    WHERE cliente_id = %s AND pagada = FALSE
                """, [pk])
                r = c.fetchone()
                dias_mora_max     = int(r[0] or 0)
                facturas_vencidas = int(r[1] or 0)
                monto_vencido     = Decimal(r[2] or 0)
            except Exception:
                # Tabla aún no existe — se usan ceros.
                connection.rollback() if hasattr(connection, "rollback") else None

        aprobado = Decimal(cli.credito_aprobado or 0)
        usado    = Decimal(cli.credito_usado    or 0)
        disponible = aprobado - usado
        tasa = float((usado / aprobado) * 100) if aprobado > 0 else 0.0
        tasa = round(tasa, 2)
        estado = _calc_semaforo(tasa, dias_mora_max)

        today = date.today()
        # UPSERT manual vía SQL (no tenemos FKs pero sí el unique parcial).
        with connection.cursor() as c:
            c.execute("""
                INSERT INTO clientes.cliente_credit_snapshot
                  (id, cliente_id, snapshot_date,
                   credito_aprobado, credito_usado, credito_disponible,
                   tasa_utilizacion, dias_mora_max, facturas_vencidas, monto_vencido_usd,
                   estado_semaforo, calculo_json, source, triggered_by,
                   is_active, created_at, updated_at)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
                   %s, %s, TRUE, NOW(), NOW())
                ON CONFLICT (cliente_id, snapshot_date)
                  WHERE is_active = TRUE
                DO UPDATE SET
                  credito_aprobado   = EXCLUDED.credito_aprobado,
                  credito_usado      = EXCLUDED.credito_usado,
                  credito_disponible = EXCLUDED.credito_disponible,
                  tasa_utilizacion   = EXCLUDED.tasa_utilizacion,
                  dias_mora_max      = EXCLUDED.dias_mora_max,
                  facturas_vencidas  = EXCLUDED.facturas_vencidas,
                  monto_vencido_usd  = EXCLUDED.monto_vencido_usd,
                  estado_semaforo    = EXCLUDED.estado_semaforo,
                  calculo_json       = EXCLUDED.calculo_json,
                  source             = EXCLUDED.source,
                  triggered_by       = EXCLUDED.triggered_by,
                  updated_at         = NOW()
            """, [
                str(uuid.uuid4()), pk, today,
                aprobado, usado, disponible,
                tasa, dias_mora_max, facturas_vencidas, monto_vencido,
                estado,
                '{"version":"1.0","fuente":"refresh_credit"}',
                request.data.get("source", "MANUAL"),
                str(request.user.id) if getattr(request.user, "id", None) else None,
            ])

        return Response({
            "cliente_id":         pk,
            "snapshot_date":      today.isoformat(),
            "credito_aprobado":   float(aprobado),
            "credito_usado":      float(usado),
            "credito_disponible": float(disponible),
            "tasa_utilizacion":   tasa,
            "dias_mora_max":      dias_mora_max,
            "facturas_vencidas":  facturas_vencidas,
            "monto_vencido_usd":  float(monto_vencido),
            "estado_semaforo":    estado,
        })
