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
        # Sprint 2026-05-03 · BUGFIX: la columna real en expedientes.expediente
        # es `client_id` (antes filtrábamos por `cliente_id` inexistente → la
        # query rompía y caía al `except Exception` → siempre devolvía 0).
        # También ahora filtramos por is_active=TRUE y usamos total_invoiced
        # para ventas YTD (subtotal_usd no existe en el schema actual).
        with connection.cursor() as c:
            try:
                placeholders = ",".join(["%s"] * len(client_ids))
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE client_id::text IN ({placeholders}) AND is_active = TRUE",
                    client_ids,
                )
                total_exp = c.fetchone()[0]
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE client_id::text IN ({placeholders}) AND is_active = TRUE "
                    f"AND estado NOT IN ('CERRADO','CANCELADO')",
                    client_ids,
                )
                exp_abiertos = c.fetchone()[0]
                c.execute(
                    f"SELECT COALESCE(SUM(total_invoiced),0) FROM expedientes.expediente "
                    f"WHERE client_id::text IN ({placeholders}) AND is_active = TRUE "
                    f"AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())",
                    client_ids,
                )
                ventas_ytd = float(c.fetchone()[0])
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE client_id::text IN ({placeholders}) AND is_active = TRUE "
                    f"AND estado = 'MORA'",
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

    # ══════════════════════════════════════════════════════════════
    # Sprint 2026-05-03 · Hidratación de la ficha de cliente
    #   GET /api/clientes/{id}/expedientes/         → lista activos
    #   GET /api/clientes/{id}/productos_comprados/ → agregado de líneas
    # Antes ClienteDetail.jsx leía mock data para estas dos vistas.
    # ══════════════════════════════════════════════════════════════
    @action(detail=True, methods=["get"], url_path="expedientes")
    def expedientes(self, request, pk=None):
        """Expedientes activos del cliente (o pool si es padre).

        Sprint 2026-05-03 v2 · Reescrito sin subqueries correlados.
        Antes la subquery `(SELECT SUM(...) WHERE l.expediente_id = e.id)`
        a veces tronaba silenciosamente y devolvía []. Ahora separamos:
          1. Header de expedientes (un SELECT plano).
          2. Aggregate de líneas por expediente (GROUP BY).
          3. Merge en Python.
        """
        try:
            cli = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        consolidate_q = (request.query_params.get("consolidate") or "").lower()
        if consolidate_q == "true":
            consolidate = True
        elif consolidate_q == "false":
            consolidate = False
        else:
            consolidate = cli.is_parent
        include_closed = (request.query_params.get("include_closed") or "").lower() == "true"
        client_ids = cli.pool_ids() if (consolidate and cli.is_parent) else [str(pk)]

        if not client_ids:
            return Response([])

        out = []
        try:
            with connection.cursor() as c:
                placeholders = ",".join(["%s"] * len(client_ids))
                estado_filter = "" if include_closed else "AND e.estado NOT IN (\'CERRADO\',\'CANCELADO\')"

                # Sprint 2026-05-17 fix · El cliente debe ver expedientes en
                # los que aparece como cliente_final O como operating_company
                # (legal entity que opera la importacion). Antes solo se
                # filtraba por client_id, asi que Muito Work Limitada veia
                # 0 expedientes aunque operara 5 (todos con client_id=Sondel
                # pero operating_company_id=MWT).
                #
                # El WHERE OR no rompe el caso del cliente normal: si Sondel
                # consulta, sigue viendo solo sus expedientes (donde
                # client_id=Sondel). Solo cambia para legal entities que
                # tambien aparecen como operador.
                #
                # Sumamos el campo operating_company_id al SELECT por si el
                # FE quiere distinguir "soy cliente final" vs "soy operador".

                # 1. Headers de expedientes
                c.execute(
                    f"""
                    SELECT
                        e.id::text, e.codigo, e.estado, e.client_id::text,
                        COALESCE(e.total_invoiced, 0)::float,
                        COALESCE(e.total_paid,     0)::float,
                        COALESCE(e.balance,        0)::float,
                        COALESCE(e.credit_days,    0)::int,
                        e.last_event_at, e.created_at,
                        e.operating_company_id::text AS operating_company_id
                    FROM expedientes.expediente e
                    WHERE (
                        e.client_id::text            IN ({placeholders})
                        OR e.operating_company_id::text IN ({placeholders})
                    )
                      AND e.is_active = TRUE
                      {estado_filter}
                    ORDER BY e.last_event_at DESC NULLS LAST, e.created_at DESC
                    """,
                    client_ids + client_ids,
                )
                rows = c.fetchall()
                exp_ids = [r[0] for r in rows]
                if not exp_ids:
                    return Response([])

                # 2. Aggregate de líneas por expediente (qty, valor, lines, lines_with_sap)
                ph2 = ",".join(["%s"] * len(exp_ids))
                c.execute(
                    f"""
                    SELECT
                        l.expediente_id::text AS exp_id,
                        COUNT(*) FILTER (WHERE l.is_active = TRUE) AS lines_count,
                        COUNT(*) FILTER (WHERE l.is_active = TRUE
                                           AND l.sap IS NOT NULL
                                           AND l.sap <> \'\') AS lines_with_sap,
                        COALESCE(SUM(
                            CASE WHEN l.is_active = TRUE THEN
                                l.qty * COALESCE(
                                    NULLIF(l.unit_price, 0),
                                    CASE
                                        WHEN p.especificaciones IS NOT NULL
                                         AND jsonb_typeof(p.especificaciones->\'client_prices\') = \'object\'
                                         AND jsonb_typeof(p.especificaciones->\'client_prices\'->(e.client_id::text)) = \'number\'
                                        THEN (p.especificaciones->\'client_prices\'->>(e.client_id::text))::numeric
                                        ELSE NULL
                                    END,
                                    NULLIF(p.precio_lista, 0),
                                    0
                                )
                            ELSE 0 END
                        ), 0)::float AS order_value
                    FROM expedientes.linea l
                    INNER JOIN expedientes.expediente e ON e.id = l.expediente_id
                    LEFT JOIN productos.producto p ON p.id = l.producto_id
                    WHERE l.expediente_id::text IN ({ph2})
                    GROUP BY l.expediente_id
                    """,
                    exp_ids,
                )
                agg = {}
                for r in c.fetchall():
                    agg[r[0]] = {
                        "lines_count":    int(r[1] or 0),
                        "lines_with_sap": int(r[2] or 0),
                        "order_value":    float(r[3] or 0),
                    }

                for r in rows:
                    a = agg.get(r[0]) or {"lines_count": 0, "lines_with_sap": 0, "order_value": 0.0}
                    op_id = r[10] if len(r) > 10 else None
                    # Sprint 2026-05-17 · `viewer_role` permite que el FE
                    # distinga si este cliente aparece como CLIENT (cliente
                    # final del expediente) u OPERATOR (legal entity que lo
                    # opera). Solo informativo — no afecta filtros.
                    is_client_of_exp = (r[3] in client_ids)
                    is_op_of_exp     = (op_id in client_ids) if op_id else False
                    if is_client_of_exp and is_op_of_exp:
                        viewer_role = "BOTH"
                    elif is_op_of_exp:
                        viewer_role = "OPERATOR"
                    else:
                        viewer_role = "CLIENT"
                    out.append({
                        "id":             r[0],
                        "codigo":         r[1],
                        "estado":         r[2],
                        "client_id":      r[3],
                        "total_invoiced": float(r[4] or 0),
                        "total_paid":     float(r[5] or 0),
                        "balance":        float(r[6] or 0),
                        "credit_days":    int(r[7] or 0),
                        "last_event_at":  r[8].isoformat() if r[8] else None,
                        "created_at":     r[9].isoformat() if r[9] else None,
                        "order_value":    a["order_value"],
                        "lines_count":    a["lines_count"],
                        "lines_with_sap": a["lines_with_sap"],
                        # Sprint 2026-05-17 — nuevos campos para distinguir
                        # rol del cliente consultante en este expediente.
                        "operating_company_id": op_id,
                        "viewer_role":          viewer_role,
                    })
        except Exception as e:
            import logging
            logging.getLogger(__name__).exception(
                "[clientes.expedientes] query failed for pk=%s: %s", pk, e
            )
            out = []
        return Response(out)

    @action(detail=True, methods=["get"], url_path="productos_comprados")
    def productos_comprados(self, request, pk=None):
        """Productos comprados en expedientes activos del cliente.

        Sprint 2026-05-03 v2 · Devuelve UNA FILA POR LÍNEA del expediente
        (no agregado por SKU). Permite que la UI muestre la tabla
        completa con talla, cantidad, expediente clickeable, etc.
        """
        try:
            cli = Cliente.objects.get(pk=pk, is_active=True)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        consolidate_q = (request.query_params.get("consolidate") or "").lower()
        if consolidate_q == "true":
            consolidate = True
        elif consolidate_q == "false":
            consolidate = False
        else:
            consolidate = cli.is_parent
        client_ids = cli.pool_ids() if (consolidate and cli.is_parent) else [str(pk)]

        if not client_ids:
            return Response([])

        out = []
        try:
            with connection.cursor() as c:
                placeholders = ",".join(["%s"] * len(client_ids))
                c.execute(
                    f"""
                    SELECT
                        l.id::text                            AS line_id,
                        l.expediente_id::text                 AS expediente_id,
                        e.codigo                              AS expediente_codigo,
                        e.estado                              AS expediente_estado,
                        e.client_id::text                     AS client_id,
                        COALESCE(l.producto_id::text, \'\')   AS producto_id,
                        COALESCE(l.sku, p.sku, \'—\')         AS sku,
                        COALESCE(p.nombre, l.sku, \'—\')      AS nombre,
                        COALESCE(l.size, \'\')                AS talla,
                        COALESCE(l.qty, 0)::float             AS qty,
                        COALESCE(l.sap, \'\')                 AS sap,
                        COALESCE(NULLIF(l.unit_price, 0),
                                 NULLIF(p.precio_lista, 0),
                                 0)::float                    AS unit_price,
                        COALESCE(l.qty * COALESCE(
                            NULLIF(l.unit_price, 0),
                            CASE
                                WHEN p.especificaciones IS NOT NULL
                                 AND jsonb_typeof(p.especificaciones->\'client_prices\') = \'object\'
                                 AND jsonb_typeof(p.especificaciones->\'client_prices\'->(e.client_id::text)) = \'number\'
                                THEN (p.especificaciones->\'client_prices\'->>(e.client_id::text))::numeric
                                ELSE NULL
                            END,
                            NULLIF(p.precio_lista, 0),
                            0
                        ), 0)::float                          AS line_total,
                        COALESCE(e.last_event_at, e.created_at) AS last_seen_at
                    FROM expedientes.linea l
                    INNER JOIN expedientes.expediente e
                            ON e.id = l.expediente_id
                           AND e.is_active = TRUE
                           AND e.estado NOT IN (\'CERRADO\',\'CANCELADO\')
                    LEFT JOIN productos.producto p ON p.id = l.producto_id
                    WHERE l.is_active = TRUE
                      AND (
                          e.client_id::text            IN ({placeholders})
                          OR e.operating_company_id::text IN ({placeholders})
                      )
                    ORDER BY COALESCE(e.last_event_at, e.created_at) DESC,
                             l.sku, l.size
                    """,
                    client_ids + client_ids,
                )
                for r in c.fetchall():
                    out.append({
                        "line_id":           r[0],
                        "expediente_id":     r[1],
                        "expediente_codigo": r[2],
                        "expediente_estado": r[3],
                        "client_id":         r[4],
                        "producto_id":       r[5] or None,
                        "sku":               r[6],
                        "nombre":            r[7],
                        "talla":             r[8],
                        "qty":               float(r[9] or 0),
                        "sap":               r[10] or None,
                        "unit_price":        float(r[11] or 0),
                        "line_total":        float(r[12] or 0),
                        "last_seen_at":      r[13].isoformat() if r[13] else None,
                    })
        except Exception as e:
            import logging
            logging.getLogger(__name__).exception(
                "[clientes.productos_comprados] query failed for pk=%s: %s", pk, e
            )
            out = []
        return Response(out)

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

    # ════════════════════════════════════════════════════════
    # Credit Clock v2.0 — Fase 5A
    # ════════════════════════════════════════════════════════
    @action(detail=True, methods=["get", "patch"], url_path="credit_config")
    def credit_config(self, request, pk=None):
        """GET → devuelve la config; PATCH → actualiza tope/umbrales/bloqueo.

        Defaults globales 90/60/75/True. Editable solo por CEO/ADMIN
        (R3). El recompute del clock se dispara automáticamente al
        guardar, para reflejar de inmediato el cambio en el dashboard.
        """
        # Validar que el cliente existe (para 404 limpio)
        try:
            Cliente.objects.get(pk=pk)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        # GET — leer (con defaults si no hay row)
        if request.method == "GET":
            with connection.cursor() as c:
                c.execute(
                    """
                    SELECT tope_dias, umbral_amarillo_dias, umbral_rojo_dias,
                           bloqueo_automatico, notas, updated_by, updated_at
                      FROM clientes.credit_config
                     WHERE cliente_id = %s LIMIT 1
                    """,
                    [pk],
                )
                row = c.fetchone()
            if not row:
                return Response({
                    "cliente_id":           pk,
                    "tope_dias":            90,
                    "umbral_amarillo_dias": 60,
                    "umbral_rojo_dias":     75,
                    "bloqueo_automatico":   True,
                    "notas":                None,
                    "is_default":           True,
                })
            return Response({
                "cliente_id":           pk,
                "tope_dias":            row[0],
                "umbral_amarillo_dias": row[1],
                "umbral_rojo_dias":     row[2],
                "bloqueo_automatico":   bool(row[3]),
                "notas":                row[4],
                "updated_by":           str(row[5]) if row[5] else None,
                "updated_at":           row[6].isoformat() if row[6] else None,
                "is_default":           False,
            })

        # PATCH — actualizar (R3 · solo ADMIN/CEO; el endpoint global
        # tiene RoleBasedPermission por DEFAULT_PERMISSION_CLASSES, pero
        # marcamos required_module aquí por claridad)
        body = request.data or {}
        tope     = int(body.get("tope_dias", 90))
        amarillo = int(body.get("umbral_amarillo_dias", 60))
        rojo     = int(body.get("umbral_rojo_dias", 75))
        if not (0 < amarillo < rojo <= tope):
            return Response({
                "detail": ("Umbrales inválidos: se requiere "
                           "0 < umbral_amarillo_dias < umbral_rojo_dias <= tope_dias"),
            }, status=400)

        with connection.cursor() as c:
            c.execute(
                """
                INSERT INTO clientes.credit_config (
                    cliente_id, tope_dias, umbral_amarillo_dias, umbral_rojo_dias,
                    bloqueo_automatico, notas, updated_by, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (cliente_id) DO UPDATE SET
                    tope_dias            = EXCLUDED.tope_dias,
                    umbral_amarillo_dias = EXCLUDED.umbral_amarillo_dias,
                    umbral_rojo_dias     = EXCLUDED.umbral_rojo_dias,
                    bloqueo_automatico   = EXCLUDED.bloqueo_automatico,
                    notas                = EXCLUDED.notas,
                    updated_by           = EXCLUDED.updated_by,
                    updated_at           = NOW()
                """,
                [
                    pk, tope, amarillo, rojo,
                    bool(body.get("bloqueo_automatico", True)),
                    (body.get("notas") or None),
                    str(request.user.id) if getattr(request.user, "id", None) else None,
                ],
            )

        # Recompute inmediato — el dashboard refleja el cambio en <2s
        from apps.clientes.credit_clock import CreditClockProjector
        snap = CreditClockProjector.recompute(uuid.UUID(pk))
        return Response({
            "ok":         True,
            "cliente_id": pk,
            "config": {
                "tope_dias":            tope,
                "umbral_amarillo_dias": amarillo,
                "umbral_rojo_dias":     rojo,
                "bloqueo_automatico":   bool(body.get("bloqueo_automatico", True)),
            },
            "clock": snap.as_dict(),
        })

    @action(detail=True, methods=["get", "post"], url_path="credit_clock")
    def credit_clock(self, request, pk=None):
        """
        GET  → devuelve la cache derivada (días, expedientes en banda,
               monto pendiente, bloqueado).
        POST → recompute manual (reservado a CEO/ADMIN). Útil cuando
               el cron del worker no corrió o cambió un dato externo.
        """
        try:
            Cliente.objects.get(pk=pk)
        except Cliente.DoesNotExist:
            return Response({"detail": "Cliente no existe"}, status=404)

        if request.method == "POST":
            from apps.clientes.credit_clock import CreditClockProjector
            snap = CreditClockProjector.recompute(uuid.UUID(pk))
            return Response({"ok": True, "clock": snap.as_dict()})

        # GET — read cache
        with connection.cursor() as c:
            c.execute(
                """
                SELECT dias_credito_consumidos,
                       expedientes_abiertos_total,
                       expedientes_abiertos_amarillo,
                       expedientes_abiertos_rojo,
                       monto_pendiente_usd, bloqueado, bloqueo_reason,
                       last_recalc_at, last_payment_id, updated_at
                  FROM clientes.credit_clock
                 WHERE cliente_id = %s LIMIT 1
                """,
                [pk],
            )
            row = c.fetchone()
        if not row:
            return Response({
                "cliente_id":              pk,
                "dias_credito_consumidos": 0,
                "expedientes_abiertos_total":    0,
                "expedientes_abiertos_amarillo": 0,
                "expedientes_abiertos_rojo":     0,
                "monto_pendiente_usd": "0.00",
                "bloqueado":           False,
                "bloqueo_reason":      None,
                "last_recalc_at":      None,
                "is_stale":            True,
            })
        return Response({
            "cliente_id":                    pk,
            "dias_credito_consumidos":       row[0],
            "expedientes_abiertos_total":    row[1],
            "expedientes_abiertos_amarillo": row[2],
            "expedientes_abiertos_rojo":     row[3],
            "monto_pendiente_usd":           str(row[4]),
            "bloqueado":                     bool(row[5]),
            "bloqueo_reason":                row[6],
            "last_recalc_at":                row[7].isoformat() if row[7] else None,
            "last_payment_id":               str(row[8]) if row[8] else None,
            "updated_at":                    row[9].isoformat() if row[9] else None,
            "is_stale":                      False,
        })
