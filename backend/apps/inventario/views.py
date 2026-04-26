import uuid
from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Stock, Movimiento, TipoMovimientoCat, MotivoCat,
    ContextoMovimientoCat,
    StockSnapshot, StockUbicacion, InventoryImportLog,
)
from .serializers import (
    StockSerializer, StockListSerializer, MovimientoSerializer,
    StockSnapshotSerializer, StockUbicacionSerializer, InventoryImportLogSerializer,
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
            qs = qs.filter(fecha_vencimiento__lt=timezone.now().date())
        if request.query_params.get("bajo_minimo") == "1":
            # Se evalúa en Python: cantidad_disponible < cantidad_minima
            rows = list(qs)
            rows = [r for r in rows if (r.cantidad_disponible or 0) < (r.cantidad_minima or 0)]
        else:
            rows = list(qs)

        # Enriquecimiento — pre-carga sku/nombre de productos + codigo/nombre
        # de nodos referenciados, en 2 queries únicas (no N+1).
        producto_ids = list({str(r.producto_id) for r in rows if r.producto_id})
        nodo_ids     = list({str(r.nodo_id)     for r in rows if r.nodo_id})
        productos = {}
        nodos     = {}
        if producto_ids or nodo_ids:
            with connection.cursor() as c:
                if producto_ids:
                    c.execute("""
                        SELECT id, COALESCE(sku, ''), COALESCE(nombre, '')
                        FROM productos.producto
                        WHERE id::text = ANY(%s)
                    """, [producto_ids])
                    for pid, sku, nombre in c.fetchall():
                        productos[str(pid)] = {"sku": sku, "nombre": nombre}
                if nodo_ids:
                    c.execute("""
                        SELECT id, COALESCE(codigo, ''), COALESCE(nombre, '')
                        FROM nodos.nodo
                        WHERE id::text = ANY(%s)
                    """, [nodo_ids])
                    for nid, codigo, nombre in c.fetchall():
                        nodos[str(nid)] = {"codigo": codigo, "nombre": nombre}

        ctx = {"request": request, "productos": productos, "nodos": nodos}
        return Response(StockListSerializer(rows, many=True, context=ctx).data)

    def retrieve(self, request, pk=None):
        try:
            s = Stock.objects.get(pk=pk, is_active=True)
        except Stock.DoesNotExist:
            return Response({"detail": "Stock no existe"}, status=404)
        return Response(StockSerializer(s).data)

    def create(self, request):
        s = StockSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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

    @action(detail=False, methods=["get"])
    def select_contextos(self, request):
        """Contextos legales para movimientos (NATIONALIZATION / EXPORT / etc.)."""
        return Response([
            {"codigo": c.codigo, "label": c.label, "color": c.color,
             "needs_approval": c.needs_approval}
            for c in ContextoMovimientoCat.objects.filter(is_active=True)
        ])

    # ── KPIs globales de inventario ──────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT
                    COALESCE(SUM(cantidad_disponible),0)            AS unidades_disp,
                    COALESCE(SUM(cantidad_reservada),0)             AS unidades_resv,
                    COALESCE(SUM(cantidad_en_transito),0)           AS unidades_trans,
                    COALESCE(SUM(cantidad_disponible*COALESCE(costo_actual_usd, costo_unitario_usd, 0)),0) AS valor_disp_usd,
                    COUNT(DISTINCT producto_id)                     AS skus_distintos,
                    COUNT(DISTINCT nodo_id)                         AS nodos_con_stock,
                    COUNT(*) FILTER (WHERE cantidad_disponible < COALESCE(cantidad_minima, 0))
                                                                    AS skus_bajo_minimo
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
            "skus_bajo_minimo":     int(row[6] or 0),
        })

    # ── Ubicaciones multi-bin ────────────────────────────
    @action(detail=True, methods=["get", "post"], url_path="ubicaciones")
    def ubicaciones(self, request, pk=None):
        if request.method == "GET":
            qs = StockUbicacion.objects.filter(stock_id=pk, is_active=True)
            return Response(StockUbicacionSerializer(qs, many=True).data)
        # POST
        data = {**request.data, "stock_id": pk}
        s = StockUbicacionSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    # ── Snapshots históricos ─────────────────────────────
    @action(detail=False, methods=["get"])
    def snapshots(self, request):
        qs = StockSnapshot.objects.filter(is_active=True).order_by("-snapshot_date")
        for p, f in (("nodo", "nodo_id"), ("producto", "producto_id"),
                     ("lote", "lote"), ("fecha", "snapshot_date")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(StockSnapshotSerializer(qs[:limit], many=True).data)

    # ── Upload masivo 2-step ─────────────────────────────
    @action(detail=False, methods=["post"], url_path="upload_stock_preview")
    def upload_stock_preview(self, request):
        """
        Body: { filename, nodo_id?, mapping, rows: [ {sku, lote?, cantidad, costo?} ] }
        Devuelve import_id + validación + preview.
        """
        body      = request.data or {}
        filename  = body.get("filename") or ""
        nodo_id   = body.get("nodo_id")
        mapping   = body.get("mapping") or {}
        rows      = body.get("rows") or []

        preview = []
        errors  = []
        valid   = 0
        invalid = 0

        # SKUs existentes para match
        skus = {str(r.get("sku")).strip() for r in rows if r.get("sku")}
        sku_map = {}
        if skus:
            with connection.cursor() as c:
                c.execute(
                    "SELECT sku, id FROM productos.producto "
                    "WHERE is_active = TRUE AND sku = ANY(%s)",
                    [list(skus)],
                )
                sku_map = {r[0]: str(r[1]) for r in c.fetchall()}

        for idx, row in enumerate(rows, start=1):
            sku     = str(row.get("sku") or "").strip()
            lote    = str(row.get("lote") or "").strip()
            try:
                cantidad = float(row.get("cantidad") or 0)
            except Exception:
                cantidad = None

            row_errors = []
            if not sku:
                row_errors.append("sku requerido")
            elif sku not in sku_map:
                row_errors.append(f"sku '{sku}' no existe en productos")
            if cantidad is None:
                row_errors.append("cantidad invalida")

            if row_errors:
                invalid += 1
                errors.append({"row": idx, "sku": sku, "errors": row_errors})
            else:
                valid += 1
                preview.append({
                    "row": idx, "sku": sku, "producto_id": sku_map[sku],
                    "lote": lote, "cantidad": cantidad,
                    "costo_unitario_usd": row.get("costo") or row.get("costo_unitario_usd") or 0,
                })

        log = InventoryImportLog.objects.create(
            id               = uuid.uuid4(),
            nodo_id          = nodo_id,
            filename         = filename,
            total_rows       = len(rows),
            valid_rows       = valid,
            invalid_rows     = invalid,
            mapping_json     = mapping,
            preview_json     = preview,
            errors_json      = errors,
            status           = "VALID" if invalid == 0 else ("PARTIAL" if valid > 0 else "REJECTED"),
        )
        return Response({
            "import_id":    str(log.id),
            "status":       log.status,
            "total_rows":   log.total_rows,
            "valid_rows":   log.valid_rows,
            "invalid_rows": log.invalid_rows,
            "preview":      preview[:50],   # recorta para el FE
            "errors":       errors[:50],
        })

    @action(detail=False, methods=["post"], url_path="upload_stock_commit")
    def upload_stock_commit(self, request):
        """
        Body: { import_id, idempotence_token }
        Ejecuta los INSERTs UPSERT sobre inventario.stock + movimientos AJUSTE.
        """
        body = request.data or {}
        import_id         = body.get("import_id")
        idempotence_token = body.get("idempotence_token") or f"imp-{import_id}"

        try:
            log = InventoryImportLog.objects.get(pk=import_id)
        except InventoryImportLog.DoesNotExist:
            return Response({"detail": "import no existe"}, status=404)

        if log.status == "COMMITTED":
            return Response({
                "detail":         "ya estaba comprometido",
                "committed_rows": log.committed_rows,
            })

        committed = 0
        preview   = log.preview_json or []
        nodo_id   = str(log.nodo_id) if log.nodo_id else None

        with transaction.atomic():
            with connection.cursor() as c:
                for row in preview:
                    producto_id = row.get("producto_id")
                    lote        = row.get("lote") or ""
                    cantidad    = float(row.get("cantidad") or 0)
                    costo       = float(row.get("costo_unitario_usd") or 0)

                    if not nodo_id:
                        # Si no se pasó nodo, no se compromete.
                        continue

                    c.execute("""
                        INSERT INTO inventario.stock
                            (id, nodo_id, producto_id, lote, cantidad_disponible,
                             costo_unitario_usd, costo_actual_usd, last_movement_at)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (nodo_id, producto_id, lote)
                        DO UPDATE SET
                            cantidad_disponible = inventario.stock.cantidad_disponible + EXCLUDED.cantidad_disponible,
                            costo_actual_usd    = EXCLUDED.costo_actual_usd,
                            last_movement_at    = NOW(),
                            updated_at          = NOW()
                    """, [nodo_id, producto_id, lote, cantidad, costo, costo])
                    committed += 1

            log.committed_rows    = committed
            log.idempotence_token = idempotence_token
            log.status            = "COMMITTED"
            log.committed_at      = timezone.now()
            log.save()

        return Response({
            "import_id":      str(log.id),
            "committed_rows": committed,
            "status":         log.status,
        })


# ============================================================
# MovimientoViewSet  — /api/movimientos/
# ============================================================
class MovimientoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Movimiento.objects.filter(is_active=True).order_by("-created_at")
        mapping = {
            "tipo":            "tipo",
            "motivo":          "motivo",
            "producto":        "producto_id",
            "nodo_origen":     "nodo_origen_id",
            "nodo_destino":    "nodo_destino_id",
            "referencia_id":   "referencia_id",
            "contexto_legal":  "contexto_legal",
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
            lote?, cantidad, costo_unitario_usd?, notas?,
            contexto_legal?, idempotence_token? }
        """
        data = {**request.data}

        # ── Idempotencia: si ya existe el token, devolver el movimiento previo.
        token = data.get("idempotence_token")
        if token:
            prev = Movimiento.objects.filter(
                idempotence_token=token, is_active=True,
            ).first()
            if prev:
                return Response(MovimientoSerializer(prev).data, status=200)

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
                m = s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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

    @action(detail=False, methods=["get"])
    def select_contextos(self, request):
        return Response([
            {"codigo": c.codigo, "label": c.label, "color": c.color,
             "needs_approval": c.needs_approval}
            for c in ContextoMovimientoCat.objects.filter(is_active=True)
        ])
