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

        # ── REGLA Parent-Child (sprint 2026-04-29) ──
        # El dashboard top-level NO muestra subsidiarias por defecto, para
        # que la jerarquía sea legible. Override:
        #   ?is_parent=true   (default) → solo top-level (parent_id IS NULL)
        #   ?is_parent=false           → solo subsidiarias
        #   ?is_parent=all              → todos sin filtro (legacy)
        is_parent_q = (request.query_params.get("is_parent") or "true").lower()
        if is_parent_q == "true":
            qs = qs.filter(parent_id__isnull=True)
        elif is_parent_q == "false":
            qs = qs.filter(parent_id__isnull=False)
        # 'all' o cualquier otro valor → no filtra

        mapping = {
            "tipo":     "tipo",
            "estado":   "estado",
            "segmento": "segmento",
            "pais":     "pais_iso2",
            "nodo":     "nodo_asignado_id",
            "canal":    "canal",
            "incoterm": "incoterm",
            "parent":   "parent_id",  # filtrar subsidiarias de un padre específico
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
        s = ClienteSerializer(data=request.data, context=self._ctx(request))
        s.is_valid(raise_exception=True)
        # ── id explícito vía save(**kwargs) ──
        # `id` está en read_only_fields del serializer → DRF lo descarta
        # del validated_data. Si dejamos que `save()` siga sin él, Django
        # manda INSERT id=NULL y revienta la PK NOT NULL. La forma canónica
        # es inyectarlo como kwarg de save(): se mergea a validated_data
        # antes de llamar a create(). Mismo patrón aplicado en nodos.
        s.save(id=uuid.uuid4())
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
        # Soft delete + cascada lógica a subsidiarias activas (Parent-Child).
        # Si el padre se desactiva, sus subsidiarias también — mantienen el
        # historial pero salen del dashboard. Reversible vía PATCH is_active.
        Cliente.objects.filter(pk=pk).update(is_active=False)
        Cliente.objects.filter(parent_id=str(pk), is_active=True).update(is_active=False)
        return Response(status=204)

    # ═══════════════════════════════════════════════════════════════
    # Parent-Child actions (sprint 2026-04-29)
    # ═══════════════════════════════════════════════════════════════
    @action(detail=True, methods=["get", "post"], url_path="subsidiarias")
    def subsidiarias(self, request, pk=None):
        """GET → lista subsidiarias activas del cliente padre.
        POST → crea una nueva subsidiaria con parent_id=pk.

        Validación: el cliente {pk} NO puede ser ya una subsidiaria
        (regla 2 niveles).
        """
        try:
            parent = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente padre no existe."}, status=404)

        if parent.is_subsidiary:
            return Response(
                {"detail": "Una subsidiaria no puede tener subsidiarias "
                           "(anidación máxima: 2 niveles)."},
                status=400,
            )

        if request.method.upper() == "GET":
            subs = (Cliente.objects
                    .filter(parent_id=str(pk), is_active=True)
                    .order_by("razon_social"))
            return Response(
                ClienteListSerializer(subs, many=True, context=self._ctx(request)).data
            )

        # POST → crear subsidiaria
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        data["parent_id"] = str(parent.id)
        # Heredar campos sensatos del padre si no vienen en el payload.
        data.setdefault("pais_iso2",       parent.pais_iso2)
        data.setdefault("moneda",          parent.moneda)
        data.setdefault("dias_credito",    parent.dias_credito)
        data.setdefault("incoterm",        parent.incoterm)
        data.setdefault("medio_pago",      parent.medio_pago)
        data.setdefault("canal",           parent.canal)
        data.setdefault("tipo",            parent.tipo)
        data.setdefault("segmento",        parent.segmento)
        data.setdefault("visibility_tier", parent.visibility_tier)

        s = ClienteSerializer(data=data, context=self._ctx(request))
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    @action(detail=True, methods=["get"], url_path="kpis_pool")
    def kpis_pool(self, request, pk=None):
        """KPIs financieros consolidados del pool padre + subsidiarias.

        El FE usa este endpoint como single-source para los tiles del
        header (Crédito, Total facturado, DSO, Expedientes activos).
        """
        try:
            cli = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)
        return Response(cli.calcular_kpis_consolidados())

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
        """KPIs operativos (expedientes + ventas YTD).

        Soporta consolidación Parent-Child:
          ?consolidate=true  → padre incluye subsidiarias (default si is_parent)
          ?consolidate=false → solo el cliente {pk}
        """
        # Resolver el cliente para decidir el alcance del pool
        try:
            cli = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        # Default: padre consolida; subsidiaria no.
        consolidate_q = (request.query_params.get("consolidate") or "").lower()
        if consolidate_q == "true":
            consolidate = True
        elif consolidate_q == "false":
            consolidate = False
        else:
            consolidate = cli.is_parent

        if consolidate and cli.is_parent:
            client_ids = cli.pool_ids()
        else:
            client_ids = [str(pk)]

        total_exp = exp_abiertos = exp_mora = 0
        ventas_ytd = 0.0
        with connection.cursor() as c:
            try:
                placeholders = ",".join(["%s"] * len(client_ids))
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE cliente_id::text IN ({placeholders})",
                    client_ids,
                )
                total_exp = c.fetchone()[0]
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE cliente_id::text IN ({placeholders}) "
                    f"AND estado NOT IN ('CERRADO','CANCELADO')",
                    client_ids,
                )
                exp_abiertos = c.fetchone()[0]
                c.execute(
                    f"SELECT COALESCE(SUM(subtotal_usd),0) FROM expedientes.expediente "
                    f"WHERE cliente_id::text IN ({placeholders}) "
                    f"AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())",
                    client_ids,
                )
                ventas_ytd = float(c.fetchone()[0])
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE cliente_id::text IN ({placeholders}) AND estado = 'MORA'",
                    client_ids,
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
            # Metadata Parent-Child
            "consolidated":         consolidate and cli.is_parent,
            "pool_size":            len(client_ids),
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
