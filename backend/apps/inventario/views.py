import uuid
import logging
from decimal import Decimal, InvalidOperation
from django.db import connection, transaction, IntegrityError, DataError
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

log = logging.getLogger(__name__)

from .models import (
    Stock, Movimiento, TipoMovimientoCat, MotivoCat,
    ContextoMovimientoCat,
    StockSnapshot, StockUbicacion, InventoryImportLog,
    ExpedienteNodoAssignment, RecepcionCosto,
)
from .serializers import (
    StockSerializer, StockListSerializer, MovimientoSerializer,
    StockSnapshotSerializer, StockUbicacionSerializer, InventoryImportLogSerializer,
    ExpedienteNodoAssignmentSerializer,
)
from .cost_proration import operative_per_unit_map


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

    # ── Recibir lote (alta/incremento de stock) ─────────────
    # POST /api/stock/receive_batch/
    # body: { nodo_id, producto_id, lote?, cantidad,
    #         costo_unitario_usd?, fecha_vencimiento?, notas? }
    #
    # Si ya existe Stock con (nodo_id, producto_id, lote) suma la
    # cantidad al disponible. Si no, lo crea. Registra Movimiento
    # tipo='RECEPCION' en la misma transacción.
    @action(detail=False, methods=["post"], url_path="receive_batch")
    def receive_batch(self, request):
        body = request.data or {}
        nodo_id     = body.get("nodo_id")
        producto_id = body.get("producto_id")
        lote        = (body.get("lote") or "").strip()
        notas       = body.get("notas") or ""
        fecha_venc  = body.get("fecha_vencimiento") or None

        # Parseo numérico seguro
        try:
            cantidad = Decimal(str(body.get("cantidad", 0)))
        except (InvalidOperation, TypeError):
            return Response({"detail": "cantidad inválida"}, status=400)
        try:
            costo = Decimal(str(body.get("costo_unitario_usd", 0)))
        except (InvalidOperation, TypeError):
            costo = Decimal("0")

        if not nodo_id or not producto_id:
            return Response(
                {"detail": "nodo_id y producto_id son obligatorios"}, status=400
            )
        if cantidad <= 0:
            return Response({"detail": "cantidad debe ser > 0"}, status=400)

        try:
            with transaction.atomic():
                # Buscar Stock existente — el unique (nodo, producto, lote)
                # garantiza 0 o 1 fila.
                qs = Stock.objects.filter(
                    nodo_id=nodo_id, producto_id=producto_id, lote=lote
                )
                stock = qs.first()
                created_new = stock is None

                if created_new:
                    stock = Stock.objects.create(
                        id=uuid.uuid4(),
                        nodo_id=nodo_id,
                        producto_id=producto_id,
                        lote=lote,
                        cantidad_disponible=cantidad,
                        cantidad_reservada=0,
                        cantidad_en_transito=0,
                        costo_unitario_usd=costo,
                        costo_actual_usd=costo,
                        fecha_vencimiento=fecha_venc,
                        is_active=True,
                    )
                else:
                    stock.cantidad_disponible = (stock.cantidad_disponible or 0) + cantidad
                    if costo and costo > 0:
                        stock.costo_actual_usd = costo
                    if fecha_venc:
                        stock.fecha_vencimiento = fecha_venc
                    stock.last_movement_at = timezone.now()
                    stock.save()

                # Registrar Movimiento
                Movimiento.objects.create(
                    id=uuid.uuid4(),
                    tipo="RECEPCION",
                    motivo="RECIBIR_LOTE",
                    producto_id=producto_id,
                    nodo_destino_id=nodo_id,
                    lote=lote,
                    cantidad=cantidad,
                    costo_unitario_usd=costo,
                    notas=notas,
                    user_id=getattr(request.user, "id", None),
                    is_active=True,
                )
        except (IntegrityError, DataError) as e:
            log.warning("receive_batch DB error nodo=%s producto=%s lote=%s : %s",
                        nodo_id, producto_id, lote, e)
            return Response({"detail": str(e)}, status=400)

        return Response({
            "detail":   "OK",
            "stock_id": str(stock.id),
            "created":  created_new,
            "cantidad_disponible": float(stock.cantidad_disponible or 0),
        }, status=201)


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
            # Sprint 2026-04-30 — filtro por lote para drawer detalle de lote
            # en /inventario (StockMovementsDrawer.jsx).
            "lote":            "lote",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        # Filtro especial: nodo (cualquiera origen O destino). Útil
        # cuando queremos todos los movimientos que tocaron un nodo.
        nodo = request.query_params.get("nodo")
        if nodo:
            from django.db.models import Q
            qs = qs.filter(Q(nodo_origen_id=nodo) | Q(nodo_destino_id=nodo))
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
        """UPSERT en inventario.stock por (nodo, producto, lote, size-coalesced).

        Fable5-QA 2026-06-11: el unique index vigente es
        uq_stock_nodo_producto_lote_size (nodo_id, producto_id, lote,
        COALESCE(size, '')). El conflict target debe espejar EXACTAMENTE esa
        expresion; con solo (nodo_id, producto_id, lote) Postgres no infiere
        el indice y todo movimiento devolvia 400 "no unique or exclusion
        constraint matching the ON CONFLICT specification". Este INSERT no
        envia size (queda NULL), asi que el delta de un movimiento sin size
        acumula sobre la fila cuyo COALESCE(size,'') = '' (NULL o '').
        """
        with connection.cursor() as c:
            c.execute("""
                INSERT INTO inventario.stock
                    (id, nodo_id, producto_id, lote,
                     cantidad_disponible, last_movement_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, NOW())
                ON CONFLICT (nodo_id, producto_id, lote, COALESCE(size, ''))
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


# =====================================================================
# Sprint 2026-05-11 · Fase 3 — Asignaciones expediente → nodo.
#
# Endpoints (montados por inventario/urls.py):
#
#   GET /api/inventario/saldos-por-expediente/?expediente_ids=A,B,C&nodo_id=X
#       Devuelve, para cada (expediente, producto, talla), el saldo
#       pendiente de asignar (qty_total - SUM(asignaciones_activas)) y
#       cuánto ya hay asignado a este nodo. El FE filtra del lado del
#       wizard las filas con `qty_pendiente == 0`.
#       Estructura de respuesta:
#         [{
#           expediente_id, expediente_codigo,
#           producto_id, sku, nombre,
#           talla, qty_total,
#           qty_asignada_total, qty_asignada_a_este_nodo,
#           qty_pendiente
#         }, ...]
#
#   POST /api/inventario/nodo-assignments/bulk/
#       Body: { recepcion_id?, items: [
#         { expediente_id, producto_id, talla, nodo_id, qty_asignada },
#       ] }
#       Crea N filas append-only en `inventario.expediente_nodo_assignment`.
#       Antes de insertar, valida que cada (expediente, producto, talla)
#       tenga qty_pendiente >= qty_asignada (no permitir over-assign).
#
#   GET /api/nodos/{nodo_id}/inventory-allocated/
#       Inventario "asignado" del nodo, agregado por (producto, talla,
#       expediente). Devuelve sku, nombre y código del expediente para que
#       la tab Inventario del nodo muestre la columna Expediente.
# =====================================================================
class NodoAssignmentViewSet(viewsets.ViewSet):
    """Endpoints custom para asignación expediente→nodo. NO usa router CRUD."""

    # ── 1) Saldos pendientes por (expediente, producto, talla) ──
    @action(detail=False, methods=["get"], url_path="saldos-por-expediente")
    def saldos(self, request):
        raw_ids = (request.query_params.get("expediente_ids") or "").strip()
        if not raw_ids:
            return Response(
                {"detail": "expediente_ids es requerido (csv de UUIDs)"},
                status=400,
            )
        exp_ids = [s.strip() for s in raw_ids.split(",") if s.strip()]
        nodo_id = request.query_params.get("nodo_id")  # opcional

        # Una sola query SQL — más performante que armar joins ORM con FKs
        # lógicos. Hacemos LEFT JOIN para que productos sin nombre no
        # rompan el listado.
        with connection.cursor() as c:
            c.execute(
                """
                WITH lineas AS (
                    SELECT
                        l.expediente_id,
                        e.codigo                                       AS expediente_codigo,
                        l.producto_id,
                        l.sku,
                        COALESCE(p.nombre, p.descripcion, l.sku, '—')  AS nombre,
                        l.size                                         AS talla,
                        SUM(l.qty)::int                                AS qty_total
                    FROM expedientes.linea l
                    LEFT JOIN expedientes.expediente e ON e.id = l.expediente_id
                    LEFT JOIN productos.producto     p ON p.id = l.producto_id
                    WHERE l.expediente_id = ANY(%(exp_ids)s::uuid[])
                      AND l.is_active = TRUE
                      AND l.qty > 0
                    GROUP BY l.expediente_id, e.codigo, l.producto_id, l.sku,
                             p.nombre, p.descripcion, l.size
                ),
                asignado AS (
                    SELECT
                        expediente_id, producto_id, talla,
                        SUM(qty_asignada)::int                         AS qty_asignada_total,
                        SUM(qty_asignada) FILTER (WHERE nodo_id = %(nodo_id)s::uuid)::int
                                                                       AS qty_asignada_a_este_nodo
                    FROM inventario.expediente_nodo_assignment
                    WHERE expediente_id = ANY(%(exp_ids)s::uuid[])
                      AND is_active = TRUE
                    GROUP BY expediente_id, producto_id, talla
                )
                SELECT
                    l.expediente_id, l.expediente_codigo,
                    l.producto_id, l.sku, l.nombre, l.talla,
                    l.qty_total,
                    COALESCE(a.qty_asignada_total, 0)        AS qty_asignada_total,
                    COALESCE(a.qty_asignada_a_este_nodo, 0)  AS qty_asignada_a_este_nodo,
                    (l.qty_total - COALESCE(a.qty_asignada_total, 0))::int
                                                             AS qty_pendiente
                FROM lineas l
                LEFT JOIN asignado a
                  ON a.expediente_id = l.expediente_id
                 AND a.producto_id   = l.producto_id
                 AND COALESCE(a.talla,'') = COALESCE(l.talla,'')
                ORDER BY l.expediente_codigo, l.sku, l.talla
                """,
                {"exp_ids": exp_ids, "nodo_id": nodo_id},
            )
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
        return Response(rows)

    # ── 2) Bulk insert de asignaciones ──
    @action(detail=False, methods=["post"], url_path="nodo-assignments/bulk")
    def bulk_create(self, request):
        items = request.data.get("items") or []
        recepcion_id = request.data.get("recepcion_id")
        if not isinstance(items, list) or len(items) == 0:
            return Response({"detail": "items debe ser una lista no vacía"}, status=400)

        # Validar over-assign antes de insertar. Agrupamos por (exp, prod,
        # talla) para sumar las cantidades pedidas en este batch y
        # compararlas contra el pendiente actual.
        from collections import defaultdict
        pedidos = defaultdict(int)
        for it in items:
            try:
                key = (str(it["expediente_id"]), str(it["producto_id"]),
                       (it.get("talla") or ""))
                pedidos[key] += int(it["qty_asignada"])
            except (KeyError, ValueError, TypeError) as e:
                return Response(
                    {"detail": f"Item inválido: {e}"}, status=400,
                )

        # Calcular pendientes actuales con la misma query del endpoint de
        # saldos (sin filtro por nodo).
        exp_ids = list({k[0] for k in pedidos.keys()})
        with connection.cursor() as c:
            c.execute(
                """
                SELECT l.expediente_id, l.producto_id, COALESCE(l.size,'') AS talla,
                       SUM(l.qty)::int AS qty_total,
                       COALESCE(SUM(a.qty_asignada)::int, 0) AS qty_asignada_total
                FROM expedientes.linea l
                LEFT JOIN inventario.expediente_nodo_assignment a
                  ON a.expediente_id = l.expediente_id
                 AND a.producto_id   = l.producto_id
                 AND COALESCE(a.talla,'') = COALESCE(l.size,'')
                 AND a.is_active = TRUE
                WHERE l.expediente_id = ANY(%(exp_ids)s::uuid[])
                  AND l.is_active = TRUE
                GROUP BY l.expediente_id, l.producto_id, l.size
                """,
                {"exp_ids": exp_ids},
            )
            pendientes = {
                (str(r[0]), str(r[1]), r[2]): (r[3] or 0) - (r[4] or 0)
                for r in c.fetchall()
            }

        # Validar
        for key, qty_pedida in pedidos.items():
            disp = pendientes.get(key, 0)
            if qty_pedida > disp:
                return Response({
                    "detail": "Over-assignment detectado",
                    "expediente_id": key[0], "producto_id": key[1],
                    "talla": key[2], "qty_pedida": qty_pedida,
                    "qty_disponible": disp,
                }, status=400)

        uploader = getattr(request.user, "id", None) if request.user else None
        if not isinstance(uploader, uuid.UUID):
            uploader = None

        # ── Sprint 2026-06-02 · Costos operativos del paso 3 ──
        # cost_lines: [{kind, label, amount, currency, fx_to_usd, source}]
        # Se prorratean por unidad sobre TODO el batch y el costo por
        # unidad se estampa en cada asignación (costo_operativo_unitario_usd),
        # de modo que viaje con la asignación cuando se transfiera.
        cost_lines = request.data.get("cost_lines") or []
        # Prorrateo honrando el `scope` de cada costo (todo · expedientes ·
        # líneas). Cada item recibe su propio costo operativo por unidad.
        units = [{
            "idx":           i,
            "qty":           int(it["qty_asignada"]),
            "expediente_id": it.get("expediente_id"),
            "producto_id":   it.get("producto_id"),
            "talla":         it.get("talla") or "",
        } for i, it in enumerate(items)]
        per_unit_by_idx = operative_per_unit_map(cost_lines, units)
        batch_id = uuid.uuid4() if cost_lines else None
        nodo_destino = items[0].get("nodo_id") if items else None

        created = []
        with transaction.atomic():
            for i, it in enumerate(items):
                row = ExpedienteNodoAssignment.objects.create(
                    id=uuid.uuid4(),
                    expediente_id=it["expediente_id"],
                    producto_id=it["producto_id"],
                    talla=(it.get("talla") or None),
                    nodo_id=it["nodo_id"],
                    qty_asignada=int(it["qty_asignada"]),
                    recepcion_id=recepcion_id or None,
                    costo_operativo_unitario_usd=per_unit_by_idx.get(i, 0),
                    costo_batch_id=batch_id,
                    notas=it.get("notas") or None,
                    created_by_id=uploader,
                    is_active=True,
                )
                created.append(row)

            # Audit de las líneas de costo (no bloquea la asignación).
            for cl in cost_lines:
                RecepcionCosto.objects.create(
                    id=uuid.uuid4(),
                    recepcion_id=recepcion_id or None,
                    batch_id=batch_id,
                    nodo_id=nodo_destino,
                    kind=(cl.get("kind") or "OTRO")[:32],
                    label=(cl.get("label") or None),
                    amount=float(cl.get("amount") or 0),
                    currency=(cl.get("currency") or "USD")[:3],
                    fx_to_usd=float(cl.get("fx_to_usd") or 1),
                    source=(cl.get("source") or "MANUAL")[:16],
                    scope_json=cl.get("scope") or cl.get("scope_json") or None,
                    created_by_id=uploader,
                    is_active=True,
                )

        return Response(
            ExpedienteNodoAssignmentSerializer(created, many=True).data,
            status=201,
        )

    # ── 8) Nodos donde está asignado cada (producto, talla) del expediente ──
    # Sprint 2026-05-11 fase 6 · OCDetail y ExpedienteDetail necesitan
    # mostrar una columna "Nodo" en la tabla de productos. Este endpoint
    # devuelve, para cada (producto_id, talla) del expediente, la lista
    # de nodos donde se asignaron unidades (con qty agregada).
    @action(detail=False, methods=["get"],
            url_path=r"expedientes/(?P<exp_id>[^/.]+)/nodos-por-linea")
    def nodos_por_linea_expediente(self, request, exp_id=None):
        try:
            uuid.UUID(str(exp_id))
        except (TypeError, ValueError):
            return Response({"detail": "exp_id inválido"}, status=400)

        sql = """
            SELECT
                a.producto_id::text                          AS producto_id,
                COALESCE(a.talla, '')                        AS talla,
                a.nodo_id::text                              AS nodo_id,
                n.codigo                                     AS nodo_codigo,
                n.nombre                                     AS nodo_nombre,
                SUM(a.qty_asignada)::int                     AS qty
            FROM inventario.expediente_nodo_assignment a
            LEFT JOIN nodos.nodo n ON n.id = a.nodo_id
            WHERE a.expediente_id = %(exp_id)s::uuid
              AND a.is_active = TRUE
            GROUP BY a.producto_id, a.talla, a.nodo_id, n.codigo, n.nombre
            HAVING SUM(a.qty_asignada) > 0
            ORDER BY a.producto_id, a.talla, n.codigo
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"exp_id": exp_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("nodos_por_linea_expediente SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)

    # ── 9bis) Shipping summary consolidado por expediente ──
    # Sprint 2026-05-26 (CEO) · Un solo endpoint que devuelve toda la
    # info de envio necesaria para el header del expediente y la lista
    # de OC: modo de transporte (aereo/maritimo) + ETA + tracking.
    # Fuentes:
    #   · ART-05 (template_id=9) del Builder       -> transport_mode,
    #     carrier, tracking, doc_type, freight_mode, dispatch_mode, etc.
    #   · transfers.transferencia mas reciente     -> eta,
    #     dispatched_at, received_at, estado.
    # Si no existen, los campos vienen null y el frontend cae al
    # estado "Sin ART-05" / "ETA pendiente".
    @action(detail=False, methods=["get"],
            url_path=r"expedientes/(?P<exp_id>[^/.]+)/shipping-summary")
    def shipping_summary(self, request, exp_id=None):
        try:
            uuid.UUID(str(exp_id))
        except (TypeError, ValueError):
            return Response({"detail": "exp_id invalido"}, status=400)

        out = {
            "expediente_id":  str(exp_id),
            "transport_mode": None,
            "carrier":        None,
            "tracking":       None,
            "doc_type":       None,
            "freight_mode":   None,
            "dispatch_mode":  None,
            "consolidation":  None,
            "transferencia":  None,
        }

        try:
            with connection.cursor() as c:
                # 1) ART-05 mas reciente con linea apuntando a este expediente.
                c.execute("""
                    SELECT bai.data->>'field-0052' AS doc_type,
                           bai.data->>'field-0055' AS transport_mode,
                           bai.data->>'field-0061' AS freight_mode,
                           bai.data->>'field-0064' AS dispatch_mode,
                           bai.data->>'field-0072' AS tracking,
                           bai.data->>'field-0081' AS consolidation,
                           bai.data->>'field-1778635869890' AS carrier
                    FROM nodos.builder_artifact_instance bai
                    JOIN nodos.builder_artifact_line bal
                      ON bal.builder_artifact_instance_id = bai.id
                     AND bal.is_active = TRUE
                    WHERE bai.template_id = 9
                      AND bai.is_active   = TRUE
                      AND bal.expediente_id = %(exp_id)s::uuid
                    ORDER BY bai.created_at DESC
                    LIMIT 1
                """, {"exp_id": exp_id})
                row = c.fetchone()
                if row:
                    out["doc_type"]       = row[0]
                    out["transport_mode"] = row[1]
                    out["freight_mode"]   = row[2]
                    out["dispatch_mode"]  = row[3]
                    out["tracking"]       = row[4]
                    out["consolidation"]  = row[5]
                    out["carrier"]        = row[6]

                # 2) Transferencia mas reciente asociada al expediente
                #    via expediente_nodo_assignment.transferencia_id.
                c.execute("""
                    SELECT DISTINCT ON (t.id)
                           t.id::text   AS id,
                           t.codigo     AS codigo,
                           t.estado     AS estado,
                           t.eta        AS eta,
                           t.dispatched_at AS dispatched_at,
                           t.received_at   AS received_at,
                           t.ref_tracking  AS ref_tracking
                    FROM transfers.transferencia t
                    JOIN inventario.expediente_nodo_assignment a
                      ON a.transferencia_id = t.id
                    WHERE a.expediente_id = %(exp_id)s::uuid
                      AND a.is_active     = TRUE
                      AND t.is_active     = TRUE
                    ORDER BY t.id, t.created_at DESC
                """, {"exp_id": exp_id})
                rows = c.fetchall()
                if rows:
                    r = rows[0]
                    out["transferencia"] = {
                        "id":            r[0],
                        "codigo":        r[1],
                        "estado":        r[2],
                        "eta":           r[3].isoformat() if r[3] else None,
                        "dispatched_at": r[4].isoformat() if r[4] else None,
                        "received_at":   r[5].isoformat() if r[5] else None,
                        "ref_tracking":  r[6],
                    }
                    if not out["tracking"] and r[6]:
                        out["tracking"] = r[6]
        except Exception as exc:
            log.exception("shipping_summary fallo para %s", exp_id)
            return Response({"detail": f"SQL error: {exc}"}, status=500)

        resp = Response(out)
        resp["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp["Pragma"]        = "no-cache"
        return resp

    # ── 9) Artefactos del Builder relacionados a un expediente ──
    # Sprint 2026-05-11 fase 6 · La tab "Artefactos" del detalle de
    # expediente lista todas las instancias de Builder (de cualquier
    # nodo) que tienen al menos una línea apuntando a este expediente.
    @action(detail=False, methods=["get"],
            url_path=r"expedientes/(?P<exp_id>[^/.]+)/artifacts")
    def artifacts_por_expediente(self, request, exp_id=None):
        try:
            uuid.UUID(str(exp_id))
        except (TypeError, ValueError):
            return Response({"detail": "exp_id inválido"}, status=400)

        # Sprint 2026-05-26 (CEO) - enriquecer la respuesta con shipping
        # summary cuando el artefacto es ART-05 AWB/BL (template_id=9).
        # Los campos del JSONB `data` son:
        #   field-0052  -> doc_type        (awb | bl)
        #   field-0055  -> transport_mode  (aereo | maritimo)
        #   field-0061  -> freight_mode    (prepaid | postpaid)
        #   field-0064  -> dispatch_mode   (mwt | client)
        #   field-0072  -> tracking        (string)
        #   field-0081  -> consolidation   (si | no)
        #   field-1778635869890 -> carrier (string libre)
        # Para otros template_id estos campos vienen como NULL.
        sql = """
            WITH lines_agg AS (
                SELECT
                    bal.builder_artifact_instance_id                       AS iid,
                    -- Sprint 2026-07-30 (CEO) - SKUs distintos, no filas:
                    -- varias tallas del mismo SKU cuentan 1 línea.
                    COUNT(DISTINCT bal.producto_id)::int                   AS lines_count,
                    COALESCE(SUM(bal.qty)::int, 0)                         AS total_qty
                FROM nodos.builder_artifact_line bal
                WHERE bal.expediente_id = %(exp_id)s::uuid
                  AND bal.is_active = TRUE
                GROUP BY bal.builder_artifact_instance_id
            )
            SELECT
                bai.id::text                                AS id,
                bai.template_id,
                bai.template_title,
                bai.created_at,
                bai.updated_at,
                bai.created_by_name,
                bai.nodo_id::text                           AS nodo_id,
                n.codigo                                    AS nodo_codigo,
                n.nombre                                    AS nodo_nombre,
                la.lines_count,
                la.total_qty,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0052' END       AS doc_type,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0055' END       AS transport_mode,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0061' END       AS freight_mode,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0064' END       AS dispatch_mode,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0072' END       AS tracking,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-0081' END       AS consolidation,
                CASE WHEN bai.template_id = 9
                     THEN bai.data->>'field-1778635869890' END AS carrier
            FROM lines_agg la
            JOIN nodos.builder_artifact_instance bai
              ON bai.id = la.iid
             AND bai.is_active = TRUE
            LEFT JOIN nodos.nodo n ON n.id = bai.nodo_id
            ORDER BY bai.created_at DESC
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"exp_id": exp_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("artifacts_por_expediente SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)

        # Sprint 2026-05-26 (CEO) - filtrar artefactos Factura Comercial
        # (template_id=13) cuando el viewer no esta autorizado para el
        # operating_company del expediente. Mismo principio de
        # visibility POL_R3 que aplicamos en otros campos de factura.
        try:
            from apps.core.scoped_querysets import _is_bypass as _isb, _scope_ids as _sids
            user = request.user
            if not _isb(user):
                allowed_factura = False
                from apps.expedientes.models import Expediente
                try:
                    op_id = (Expediente.objects
                             .filter(id=exp_id)
                             .values_list("operating_company_id", flat=True).first())
                except Exception:
                    op_id = None
                if op_id:
                    scope = [str(s) for s in (_sids(user) or [])]
                    if str(op_id) in scope:
                        allowed_factura = True
                if not allowed_factura:
                    rows = [r for r in rows if int(r.get("template_id") or 0) != 13]
        except Exception as _vis_exc:  # noqa: BLE001
            log.warning("artifacts_por_expediente visibility filter failed: %s",
                        _vis_exc)
        return Response(rows)

    # ── 7) Set de expedientes con al menos una línea pendiente ──
    # Sprint 2026-05-11 fix · El paso 2 del wizard ofrecía expedientes ya
    # 100% asignados, generando picks vacíos. Este endpoint devuelve el
    # conjunto de IDs que SÍ tienen al menos una (producto, talla) con
    # qty_pendiente > 0 — el frontend filtra los chips usando esa lista.
    @action(detail=False, methods=["get"], url_path="expedientes-with-pending")
    def expedientes_with_pending(self, request):
        sql = """
            WITH per_line AS (
                SELECT
                    l.expediente_id,
                    l.producto_id,
                    COALESCE(l.size, '')       AS talla,
                    SUM(l.qty)::int            AS qty_total,
                    COALESCE(SUM(a.qty_asignada)::int, 0)
                                               AS qty_asignada_total
                FROM expedientes.linea l
                LEFT JOIN inventario.expediente_nodo_assignment a
                  ON a.expediente_id = l.expediente_id
                 AND a.producto_id   = l.producto_id
                 AND COALESCE(a.talla, '') = COALESCE(l.size, '')
                 AND a.is_active = TRUE
                WHERE l.is_active = TRUE
                  AND l.qty > 0
                  AND l.expediente_id IS NOT NULL
                GROUP BY l.expediente_id, l.producto_id, l.size
            )
            SELECT DISTINCT expediente_id::text
            FROM per_line
            WHERE qty_total - qty_asignada_total > 0
        """
        try:
            with connection.cursor() as c:
                c.execute(sql)
                rows = [r[0] for r in c.fetchall()]
        except Exception as exc:
            log.exception("expedientes_with_pending SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response({"expediente_ids": rows})

    # ── 4) Overview global: TODAS las asignaciones en la red ──
    # Sprint 2026-05-11 fix · Esta vista alimenta /inventario (la pantalla
    # global). Devuelve una fila por (nodo, producto, talla, expediente)
    # con SUM(qty_asignada). Soporta filtros opcionales por nodo_id,
    # expediente_id o búsqueda textual.
    @action(detail=False, methods=["get"], url_path="allocations-overview")
    def allocations_overview(self, request):
        nodo_id       = request.query_params.get("nodo_id")
        expediente_id = request.query_params.get("expediente_id")
        q             = (request.query_params.get("q") or "").strip()

        sql = """
            SELECT
                a.nodo_id,
                n.codigo                                       AS nodo_codigo,
                n.nombre                                       AS nodo_nombre,
                a.producto_id,
                l.sku,
                COALESCE(p.nombre, p.descripcion, l.sku, '—')  AS nombre,
                a.talla,
                a.expediente_id,
                e.codigo                                       AS expediente_codigo,
                SUM(a.qty_asignada)::int                       AS qty
            FROM inventario.expediente_nodo_assignment a
            JOIN expedientes.linea l
              ON l.expediente_id = a.expediente_id
             AND l.producto_id   = a.producto_id
             AND COALESCE(l.size,'') = COALESCE(a.talla,'')
            LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
            LEFT JOIN nodos.nodo            n ON n.id = a.nodo_id
            LEFT JOIN productos.producto    p ON p.id = a.producto_id
            WHERE a.is_active = TRUE
              AND (%(nodo_id)s::uuid IS NULL OR a.nodo_id       = %(nodo_id)s::uuid)
              AND (%(exp_id)s::uuid  IS NULL OR a.expediente_id = %(exp_id)s::uuid)
              AND (
                   %(q)s = ''
                OR l.sku            ILIKE '%%' || %(q)s || '%%'
                OR COALESCE(p.nombre, p.descripcion, '') ILIKE '%%' || %(q)s || '%%'
                OR e.codigo         ILIKE '%%' || %(q)s || '%%'
                OR n.codigo         ILIKE '%%' || %(q)s || '%%'
                OR n.nombre         ILIKE '%%' || %(q)s || '%%'
              )
            GROUP BY a.nodo_id, n.codigo, n.nombre,
                     a.producto_id, l.sku, p.nombre, p.descripcion,
                     a.talla, a.expediente_id, e.codigo
            HAVING SUM(a.qty_asignada) > 0
            ORDER BY n.codigo, e.codigo, l.sku, a.talla
        """
        with connection.cursor() as c:
            c.execute(sql, {
                "nodo_id": nodo_id or None,
                "exp_id":  expediente_id or None,
                "q":       q,
            })
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
        return Response(rows)

    # ── 5) Ajuste de cantidad asignada (editar/eliminar in-line) ──
    # Sprint 2026-05-11 fix · El usuario abre la tab Inventario del nodo
    # (que muestra el resultado AGREGADO por (producto, talla, expediente))
    # y quiere poder cambiar la cantidad o eliminar la línea sin entrar al
    # wizard. Como la tabla `expediente_nodo_assignment` es append-only,
    # implementamos "ajuste" así:
    #   1. Soft-deletea (is_active=FALSE) todas las rows activas que
    #      matchean (nodo_id, expediente_id, producto_id, talla).
    #   2. Si new_qty > 0: inserta una sola fila nueva con esa cantidad.
    #   3. Atómico (transaction.atomic) — si algo falla, revierte todo.
    # Esto preserva auditoría (las rows viejas con is_active=FALSE quedan)
    # y deja la suma agregada en el valor deseado.
    @action(detail=False, methods=["post"], url_path="nodo-assignments/adjust")
    def adjust(self, request):
        try:
            expediente_id = request.data["expediente_id"]
            producto_id   = request.data["producto_id"]
            nodo_id       = request.data["nodo_id"]
            new_qty       = int(request.data["new_qty"])
        except (KeyError, ValueError, TypeError) as e:
            return Response({"detail": f"Payload inválido: {e}"}, status=400)
        talla = request.data.get("talla") or ""
        if new_qty < 0:
            return Response({"detail": "new_qty no puede ser negativo"}, status=400)

        # Si la nueva cantidad es > 0, validar over-assign contra el saldo
        # del expediente excluyendo lo que ya tiene ESTE nodo (que vamos a
        # reemplazar). qty_pendiente_efectiva = qty_total
        #   - (qty_asignada_total - qty_asignada_a_este_nodo)
        if new_qty > 0:
            with connection.cursor() as c:
                c.execute(
                    """
                    SELECT
                        SUM(l.qty)::int                              AS qty_total,
                        COALESCE(SUM(a.qty_asignada)::int, 0)        AS qty_total_asig,
                        COALESCE(SUM(a.qty_asignada)
                                 FILTER (WHERE a.nodo_id = %(nodo_id)s::uuid)::int, 0)
                                                                     AS qty_este_nodo
                    FROM expedientes.linea l
                    LEFT JOIN inventario.expediente_nodo_assignment a
                      ON a.expediente_id = l.expediente_id
                     AND a.producto_id   = l.producto_id
                     AND COALESCE(a.talla,'') = COALESCE(l.size,'')
                     AND a.is_active = TRUE
                    WHERE l.expediente_id = %(exp_id)s::uuid
                      AND l.producto_id   = %(prod_id)s::uuid
                      AND COALESCE(l.size,'') = %(talla)s
                      AND l.is_active = TRUE
                    """,
                    {
                        "exp_id": expediente_id, "prod_id": producto_id,
                        "talla": talla, "nodo_id": nodo_id,
                    },
                )
                row = c.fetchone() or (0, 0, 0)
                qty_total = row[0] or 0
                qty_total_asig = row[1] or 0
                qty_este_nodo = row[2] or 0
                disponible = qty_total - (qty_total_asig - qty_este_nodo)
                if new_qty > disponible:
                    return Response({
                        "detail": "Over-assignment al ajustar",
                        "new_qty": new_qty, "qty_disponible": disponible,
                    }, status=400)

        # Aplicar el cambio en una transacción
        uploader = getattr(request.user, "id", None) if request.user else None
        if not isinstance(uploader, uuid.UUID):
            uploader = None

        with transaction.atomic():
            # 1) soft-delete de las rows activas que matchean
            qs = ExpedienteNodoAssignment.objects.filter(
                is_active=True,
                nodo_id=nodo_id,
                expediente_id=expediente_id,
                producto_id=producto_id,
            )
            # talla puede ser NULL — usamos OR para matchear ambas formas
            if talla in ("", None):
                qs = qs.filter(talla__isnull=True) | qs.filter(talla="")
            else:
                qs = qs.filter(talla=talla)
            qs.update(is_active=False)

            # 2) Insertar nueva si new_qty > 0
            new_row = None
            if new_qty > 0:
                new_row = ExpedienteNodoAssignment.objects.create(
                    id=uuid.uuid4(),
                    expediente_id=expediente_id,
                    producto_id=producto_id,
                    talla=(talla or None),
                    nodo_id=nodo_id,
                    qty_asignada=new_qty,
                    recepcion_id=None,
                    notas="adjust",
                    created_by_id=uploader,
                    is_active=True,
                )

        return Response({
            "ok": True,
            "new_qty": new_qty,
            "row_id": str(new_row.id) if new_row else None,
        })

    # ── 6) Expedientes asignados a un nodo (vista enriquecida) ──
    # Sprint 2026-05-11 fix · Para la tab "Expedientes" del detalle de
    # nodo: una fila por expediente con cliente, operador (operating_
    # company), SAP, proforma, código de OC, fecha de registro, y total
    # de unidades asignadas al nodo desde ese expediente.
    #
    # Robustez (fix 2026-05-11 v2):
    #   - clientes.cliente usa razon_social/nombre_comercial/tax_id
    #     (NO `nombre`, NO `codigo`, NO `rut`). La versión previa rompía
    #     con 500 al referenciar columnas inexistentes.
    #   - Hacemos el JOIN a expedientes.oc opcional usando WITH (CTE)
    #     para no perder filas si la OC fue borrada.
    #   - El conteo de líneas se hace por separado para mantener el
    #     SELECT principal sin GROUP BY pesado.
    @action(detail=False, methods=["get"],
            url_path=r"nodos/(?P<nodo_id>[^/.]+)/expedientes-asignados")
    def expedientes_asignados(self, request, nodo_id=None):
        sql = """
            WITH agg AS (
                SELECT
                    a.expediente_id,
                    SUM(a.qty_asignada)::int AS qty_total_asignada,
                    -- Sprint 2026-07-30 (CEO) - SKUs distintos, no
                    -- producto+talla: varias tallas del mismo SKU = 1.
                    COUNT(DISTINCT a.producto_id)::int AS lines_count
                FROM inventario.expediente_nodo_assignment a
                WHERE a.nodo_id = %(nodo_id)s::uuid
                  AND a.is_active = TRUE
                GROUP BY a.expediente_id
                HAVING SUM(a.qty_asignada) > 0
            )
            SELECT
                e.id                                          AS expediente_id,
                e.codigo                                      AS expediente_codigo,
                e.sap                                         AS expediente_sap,
                -- expedientes.expediente NO tiene columna proforma.
                -- La proforma vive en expedientes.documento (kind='PROFORMA').
                -- Tomamos el código del documento más reciente con código no
                -- vacío. LATERAL es seguro: si no hay matches, devuelve NULL.
                pf.codigo                                     AS proforma_codigo,
                e.estado                                      AS expediente_estado,
                e.created_at                                  AS fecha_registro,
                e.oc_id                                       AS oc_id,
                oc.codigo                                     AS oc_codigo,
                oc.sap                                        AS oc_sap,
                oc.proforma                                   AS oc_proforma,
                e.client_id                                   AS client_id,
                COALESCE(cl.razon_social, cl.nombre_comercial,
                         cl.tax_id, '—')                      AS client_nombre,
                e.operating_company_id                        AS operating_company_id,
                COALESCE(op.razon_social, op.nombre_comercial,
                         op.tax_id, '—')                      AS operating_company_nombre,
                agg.qty_total_asignada,
                agg.lines_count
            FROM agg
            LEFT JOIN expedientes.expediente e  ON e.id  = agg.expediente_id
            LEFT JOIN expedientes.oc         oc ON oc.id = e.oc_id
            LEFT JOIN clientes.cliente       cl ON cl.id = e.client_id
            LEFT JOIN clientes.cliente       op ON op.id = e.operating_company_id
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind = 'PROFORMA'
                  AND d.is_active = TRUE
                  AND d.codigo IS NOT NULL
                  AND d.codigo <> ''
                ORDER BY d.created_at DESC
                LIMIT 1
            ) pf ON TRUE
            ORDER BY e.codigo NULLS LAST
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"nodo_id": nodo_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("expedientes_asignados SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)

    # ── 9) Sprint 2026-05-13 · Fase 10 · costos de transferencias que ──
    #         tocan un expediente. Para la nueva tab "Costos" del OCDetail.
    #
    # Fuente de verdad:
    #   1. Encontrar transferencias que tocaron al expediente: mirar
    #      assignment rows con transferencia_id NOT NULL (creadas por
    #      el endpoint /transfer/) que tengan ese expediente_id.
    #   2. De esas transferencias, listar cost_line activas filtradas
    #      por scope_json:
    #        · scope_json IS NULL                      → aplica
    #        · scope_json.applies_to_all = TRUE        → aplica
    #        · scope_json.expediente_ids contiene exp  → aplica
    #
    # El payload incluye transferencia_id y transferencia_codigo para
    # que el frontend pueda navegar al detalle al hacer click.
    @action(detail=False, methods=["get"],
            url_path=r"expedientes/(?P<exp_id>[^/.]+)/transferencia-costos")
    def transferencia_costos_por_expediente(self, request, exp_id=None):
        sql = """
            WITH transferencias_del_exp AS (
                SELECT DISTINCT transferencia_id
                FROM inventario.expediente_nodo_assignment
                WHERE expediente_id = %(exp_id)s::uuid
                  AND transferencia_id IS NOT NULL
                  AND is_active = TRUE
            )
            SELECT
                cl.id                                              AS cost_line_id,
                cl.transferencia_id,
                t.codigo                                           AS transferencia_codigo,
                t.legal_context,
                t.created_at                                       AS transferencia_fecha,
                cl.kind,
                ck.label                                           AS kind_label,
                cl.label,
                cl.amount,
                cl.currency,
                cl.fx_to_usd,
                cl.amount_usd,
                cl.source,
                cl.scope_json,
                cl.created_at                                      AS cost_created_at
            FROM transfers.cost_line cl
            JOIN transfers.transferencia t ON t.id = cl.transferencia_id
            LEFT JOIN transfers.cost_kind_cat ck ON ck.codigo = cl.kind
            WHERE cl.transferencia_id IN (SELECT transferencia_id FROM transferencias_del_exp)
              AND cl.is_active = TRUE
              AND (
                cl.scope_json IS NULL
                OR (cl.scope_json->>'applies_to_all')::bool = TRUE
                OR cl.scope_json->'expediente_ids' ? %(exp_id_text)s
              )
            ORDER BY cl.created_at DESC
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"exp_id": exp_id, "exp_id_text": str(exp_id)})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("transferencia_costos_por_expediente SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        rows = self._recalculate_fx_on_cost_rows(rows)
        return Response(rows)

    # ── Helper compartido: recalcular FX en costos de transferencia ──
    # Sprint 2026-05-26 (CEO) · Los cost_line en transfers.cost_line
    # guardan fx_to_usd=1.0 y amount_usd=amount al crearse (la app no
    # hace conversion en POST). Eso es OK para almacenar el monto en su
    # moneda nativa, pero la UI necesita el equivalente en USD.
    # Este helper itera las filas y, cuando currency!=USD y fx_to_usd
    # es 1.0 (default no convertido), recalcula con apps.core.fx_service
    # (Frankfurter con cache + fallback hardcoded por currency).
    @staticmethod
    def _recalculate_fx_on_cost_rows(rows):
        try:
            from decimal import Decimal
            from apps.core.fx_service import get_fx_to_usd
        except ImportError:
            return rows
        cache = {}
        def _fx_for(ccy):
            if ccy in cache:
                return cache[ccy]
            try:
                v = get_fx_to_usd(ccy)
            except Exception:
                v = None
            cache[ccy] = v
            return v
        for r in rows:
            try:
                ccy = (r.get("currency") or "USD").upper()
                stored_fx = r.get("fx_to_usd")
                stored_fx_f = float(stored_fx) if stored_fx is not None else 1.0
                amount = r.get("amount")
                amount_f = float(amount) if amount is not None else 0.0
                # Trigger: moneda != USD y el fx parece default (1.0).
                if ccy != "USD" and abs(stored_fx_f - 1.0) < 1e-9 and amount_f > 0:
                    fx_real = _fx_for(ccy)
                    if fx_real and float(fx_real) > 0 and float(fx_real) != 1.0:
                        new_usd = round(amount_f * float(fx_real), 2)
                        r["fx_to_usd"]      = float(fx_real)
                        r["amount_usd"]     = new_usd
                        r["fx_recalculated"] = True
                        r["fx_source"]       = "fx_service"
            except (ValueError, TypeError):
                pass
        return rows

    # ── 10) Sprint 2026-05-13 · Fase 10 · costos de transferencias ──
    #          agregados a nivel OC. La OC tiene N expedientes; cada
    #          expediente puede haber participado en M transferencias;
    #          cada transferencia tiene K cost_line. Esta vista agrega
    #          todo para alimentar la card "Costos de transferencias"
    #          de OCDetail (página /expedientes/:ocId).
    #
    # Devuelve filas con expediente_codigo asociado (cuál de las
    # expedientes de la OC tocó esa transferencia) para que el FE
    # pueda mostrar el contexto.
    @action(detail=False, methods=["get"],
            url_path=r"ocs/(?P<oc_id>[^/.]+)/transferencia-costos")
    def transferencia_costos_por_oc(self, request, oc_id=None):
        sql = """
            WITH exp_de_oc AS (
                SELECT id AS expediente_id, codigo AS expediente_codigo
                FROM expedientes.expediente
                WHERE oc_id = %(oc_id)s::uuid
                  AND is_active = TRUE
            ),
            transferencias_de_oc AS (
                SELECT DISTINCT a.transferencia_id, a.expediente_id
                FROM inventario.expediente_nodo_assignment a
                WHERE a.expediente_id IN (SELECT expediente_id FROM exp_de_oc)
                  AND a.transferencia_id IS NOT NULL
                  AND a.is_active = TRUE
            )
            SELECT
                cl.id                                              AS cost_line_id,
                cl.transferencia_id,
                t.codigo                                           AS transferencia_codigo,
                t.legal_context,
                t.created_at                                       AS transferencia_fecha,
                td.expediente_id,
                eoc.expediente_codigo,
                cl.kind,
                ck.label                                           AS kind_label,
                cl.label,
                cl.amount,
                cl.currency,
                cl.fx_to_usd,
                cl.amount_usd,
                cl.source,
                cl.scope_json,
                cl.created_at                                      AS cost_created_at
            FROM transfers.cost_line cl
            JOIN transfers.transferencia t ON t.id = cl.transferencia_id
            JOIN transferencias_de_oc td   ON td.transferencia_id = cl.transferencia_id
            JOIN exp_de_oc eoc             ON eoc.expediente_id = td.expediente_id
            LEFT JOIN transfers.cost_kind_cat ck ON ck.codigo = cl.kind
            WHERE cl.is_active = TRUE
              AND (
                cl.scope_json IS NULL
                OR (cl.scope_json->>'applies_to_all')::bool = TRUE
                OR cl.scope_json->'expediente_ids' ? td.expediente_id::text
              )
            ORDER BY cl.created_at DESC, eoc.expediente_codigo
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"oc_id": oc_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("transferencia_costos_por_oc SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        rows = self._recalculate_fx_on_cost_rows(rows)
        return Response(rows)

    # ── 11) Sprint 2026-05-14 · Fase 13 · costos de transferencias que ──
    #         llegaron a un nodo (como destino). Para la tab "Costos"
    #         del detalle del nodo. Devuelve UNA fila por
    #         (cost_line × expediente × producto × talla) — el UI
    #         puede agrupar como prefiera. La qty es la cantidad
    #         efectivamente asignada al nodo desde ese expediente,
    #         filtrada por el `scope_json` de la cost_line.
    @action(detail=False, methods=["get"],
            url_path=r"nodos/(?P<nodo_id>[^/.]+)/transferencia-costos")
    def transferencia_costos_por_nodo(self, request, nodo_id=None):
        # Sprint 2026-06-02 · El tab Costos del nodo ahora UNE:
        #   (1) costos de transferencias (transfers.cost_line) — via assignments
        #       con transferencia_id, y
        #   (2) costos de RECEPCIÓN (inventario.recepcion_costo) — via assignments
        #       con costo_batch_id. El costo de recepción viaja con la asignación,
        #       así que aparece en el nodo donde esté actualmente.
        sql = """
            WITH asignaciones_del_nodo AS (
                SELECT
                    a.transferencia_id,
                    a.expediente_id,
                    a.producto_id,
                    COALESCE(a.talla, '')         AS talla_norm,
                    a.talla,
                    SUM(a.qty_asignada)::int      AS qty_asignada
                FROM inventario.expediente_nodo_assignment a
                WHERE a.nodo_id = %(nodo_id)s::uuid
                  AND a.transferencia_id IS NOT NULL
                  AND a.is_active = TRUE
                GROUP BY a.transferencia_id, a.expediente_id, a.producto_id, a.talla
                HAVING SUM(a.qty_asignada) > 0
            ),
            recepcion_asignaciones_del_nodo AS (
                SELECT
                    a.costo_batch_id,
                    a.expediente_id,
                    a.producto_id,
                    COALESCE(a.talla, '')         AS talla_norm,
                    a.talla,
                    SUM(a.qty_asignada)::int      AS qty_asignada
                FROM inventario.expediente_nodo_assignment a
                WHERE a.nodo_id = %(nodo_id)s::uuid
                  AND a.costo_batch_id IS NOT NULL
                  AND a.is_active = TRUE
                GROUP BY a.costo_batch_id, a.expediente_id, a.producto_id, a.talla
                HAVING SUM(a.qty_asignada) > 0
            )
            SELECT
                cl.id                                              AS cost_line_id,
                cl.transferencia_id,
                t.codigo                                           AS transferencia_codigo,
                t.legal_context,
                t.created_at                                       AS transferencia_fecha,
                a.expediente_id,
                e.codigo                                           AS expediente_codigo,
                pf.codigo                                          AS proforma_codigo,
                a.producto_id,
                l.sku,
                COALESCE(p.nombre, p.descripcion, l.sku, '—')      AS nombre,
                a.talla,
                a.qty_asignada                                     AS qty,
                cl.kind,
                ck.label                                           AS kind_label,
                cl.label,
                cl.amount,
                cl.currency,
                cl.fx_to_usd,
                cl.amount_usd,
                cl.source,
                cl.scope_json,
                cl.created_at                                      AS cost_created_at,
                FALSE                                              AS is_reception
            FROM asignaciones_del_nodo a
            JOIN transfers.cost_line cl
              ON cl.transferencia_id = a.transferencia_id
             AND cl.is_active = TRUE
            JOIN transfers.transferencia t        ON t.id = cl.transferencia_id
            LEFT JOIN expedientes.linea l
              ON l.expediente_id = a.expediente_id
             AND l.producto_id   = a.producto_id
             AND COALESCE(l.size,'') = a.talla_norm
            LEFT JOIN expedientes.expediente e    ON e.id = a.expediente_id
            LEFT JOIN productos.producto p        ON p.id = a.producto_id
            LEFT JOIN transfers.cost_kind_cat ck  ON ck.codigo = cl.kind
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind          = 'PROFORMA'
                  AND d.is_active     = TRUE
                  AND d.codigo IS NOT NULL
                  AND d.codigo <> ''
                ORDER BY d.created_at DESC
                LIMIT 1
            ) pf ON TRUE
            WHERE (
                cl.scope_json IS NULL
                OR (cl.scope_json->>'applies_to_all')::bool = TRUE
                OR (
                    cl.scope_json->'expediente_ids' ? a.expediente_id::text
                    AND (
                        cl.scope_json->'lines' IS NULL
                        OR jsonb_typeof(cl.scope_json->'lines') <> 'array'
                        OR jsonb_array_length(cl.scope_json->'lines') = 0
                        OR EXISTS (
                            SELECT 1 FROM jsonb_array_elements(cl.scope_json->'lines') AS ln
                            WHERE ln->>'expediente_id' = a.expediente_id::text
                              AND ln->>'producto_id'   = a.producto_id::text
                              AND COALESCE(ln->>'talla','') = a.talla_norm
                        )
                    )
                )
            )

            UNION ALL

            SELECT
                rc.id                                              AS cost_line_id,
                ra.costo_batch_id                                  AS transferencia_id,
                'Recepción'                                        AS transferencia_codigo,
                NULL                                               AS legal_context,
                rc.created_at                                      AS transferencia_fecha,
                ra.expediente_id,
                e.codigo                                           AS expediente_codigo,
                pf.codigo                                          AS proforma_codigo,
                ra.producto_id,
                l.sku,
                COALESCE(p.nombre, p.descripcion, l.sku, '—')      AS nombre,
                ra.talla,
                ra.qty_asignada                                    AS qty,
                rc.kind,
                COALESCE(ck.label, rc.kind)                        AS kind_label,
                rc.label,
                rc.amount,
                rc.currency,
                rc.fx_to_usd,
                rc.amount_usd,
                rc.source,
                rc.scope_json,
                rc.created_at                                      AS cost_created_at,
                TRUE                                               AS is_reception
            FROM recepcion_asignaciones_del_nodo ra
            JOIN inventario.recepcion_costo rc
              ON rc.batch_id = ra.costo_batch_id
             AND rc.is_active = TRUE
            LEFT JOIN expedientes.linea l
              ON l.expediente_id = ra.expediente_id
             AND l.producto_id   = ra.producto_id
             AND COALESCE(l.size,'') = ra.talla_norm
            LEFT JOIN expedientes.expediente e    ON e.id = ra.expediente_id
            LEFT JOIN productos.producto p        ON p.id = ra.producto_id
            LEFT JOIN transfers.cost_kind_cat ck  ON ck.codigo = rc.kind
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind          = 'PROFORMA'
                  AND d.is_active     = TRUE
                  AND d.codigo IS NOT NULL
                  AND d.codigo <> ''
                ORDER BY d.created_at DESC
                LIMIT 1
            ) pf ON TRUE
            WHERE (
                rc.scope_json IS NULL
                OR (rc.scope_json->>'applies_to_all')::bool = TRUE
                OR (
                    rc.scope_json->'expediente_ids' ? ra.expediente_id::text
                    AND (
                        rc.scope_json->'lines' IS NULL
                        OR jsonb_typeof(rc.scope_json->'lines') <> 'array'
                        OR jsonb_array_length(rc.scope_json->'lines') = 0
                        OR EXISTS (
                            SELECT 1 FROM jsonb_array_elements(rc.scope_json->'lines') AS ln
                            WHERE ln->>'expediente_id' = ra.expediente_id::text
                              AND ln->>'producto_id'   = ra.producto_id::text
                              AND COALESCE(ln->>'talla','') = ra.talla_norm
                        )
                    )
                )
            )
            ORDER BY transferencia_fecha DESC, expediente_codigo, sku, talla
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"nodo_id": nodo_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("transferencia_costos_por_nodo SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        rows = self._recalculate_fx_on_cost_rows(rows)
        return Response(rows)

    # ── 7) Sprint 2026-05-13 · Fase 8 · líneas con stock en un nodo ──
    # Para el wizard de transferencias paso 3: devuelve por cada
    # (expediente, producto, talla) la qty actualmente asignada al nodo.
    # Filtro opcional `expediente_ids` (CSV) para limitar la búsqueda a
    # los expedientes que el operador ya seleccionó en el chip-picker.
    #
    # El frontend usa esto en dos momentos:
    #   1. Sin `expediente_ids` → para construir la lista de expedientes
    #      con stock en el nodo origen (agrupando por expediente).
    #   2. Con `expediente_ids` → para listar las líneas concretas
    #      (sku, nombre, talla, qty_disponible) de los expedientes
    #      seleccionados.
    @action(detail=False, methods=["get"],
            url_path=r"nodos/(?P<nodo_id>[^/.]+)/lineas-en-nodo")
    def lineas_en_nodo(self, request, nodo_id=None):
        exp_ids_raw = (request.query_params.get("expediente_ids") or "").strip()
        exp_ids = [s.strip() for s in exp_ids_raw.split(",") if s.strip()]
        extra = ""
        params = {"nodo_id": nodo_id}
        if exp_ids:
            extra = " AND a.expediente_id = ANY(%(exp_ids)s::uuid[]) "
            params["exp_ids"] = exp_ids
        # Sprint 2026-05-17 · Exponemos linea_id_expediente,
        # unit_price_mwt/client y operating_company_id para que
        # CostScopeModal pueda mostrar columnas "Precio MWT" / "Precio
        # Cliente" editables y replicar via lineasApi.bulkUpdatePrices().
        # NOTE: el JOIN a expedientes.linea ya existia (para sacar sku) —
        # solo agregamos l.id, l.unit_price_mwt, l.unit_price_client al
        # SELECT/GROUP BY y e.operating_company_id desde expediente.
        sql = f"""
            SELECT
                a.expediente_id,
                e.codigo                                       AS expediente_codigo,
                pf.codigo                                      AS proforma_codigo,
                e.operating_company_id                         AS operating_company_id,
                a.producto_id,
                l.id                                           AS linea_id_expediente,
                l.sku,
                COALESCE(p.nombre, p.descripcion, l.sku, '—')  AS nombre,
                a.talla,
                l.unit_price_mwt                               AS unit_price_mwt,
                l.unit_price_client                            AS unit_price_client,
                SUM(a.qty_asignada)::int                       AS qty_disponible
            FROM inventario.expediente_nodo_assignment a
            JOIN expedientes.linea l
              ON l.expediente_id = a.expediente_id
             AND l.producto_id   = a.producto_id
             AND COALESCE(l.size,'') = COALESCE(a.talla,'')
            LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
            LEFT JOIN productos.producto     p ON p.id = a.producto_id
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind = 'PROFORMA'
                  AND d.is_active = TRUE
                  AND d.codigo IS NOT NULL AND d.codigo <> ''
                ORDER BY d.created_at DESC LIMIT 1
            ) pf ON TRUE
            WHERE a.nodo_id = %(nodo_id)s::uuid
              AND a.is_active = TRUE
              {extra}
            GROUP BY a.expediente_id, e.codigo, pf.codigo,
                     e.operating_company_id,
                     a.producto_id, l.id, l.sku, p.nombre, p.descripcion,
                     a.talla, l.unit_price_mwt, l.unit_price_client
            HAVING SUM(a.qty_asignada) > 0
            ORDER BY e.codigo, l.sku, a.talla
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, params)
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("lineas_en_nodo SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)

    # ── 8) Sprint 2026-05-13 · Fase 8 · Transfer atómico de asignaciones ──
    # Mueve qty de (exp, prod, talla) desde nodo_origen → nodo_destino.
    # Modelo append-only: soft-delete las rows activas del origen, crea
    # una row en destino con qty solicitada, y si quedaba residual en
    # origen, crea row residual en origen. Todo en una sola transacción.
    #
    # Si TODO el qty de un (exp, prod, talla) se mueve al destino, el
    # expediente automáticamente "desaparece" del origen (porque no
    # quedan rows activas con ese exp_id en ese nodo). La tab Inventario
    # de origen ya no lo verá. Si fue parcial, queda residual en origen.
    #
    # Payload:
    #   { origin_nodo_id, destination_nodo_id, transferencia_id?,
    #     items: [{expediente_id, producto_id, talla, qty}] }
    @action(detail=False, methods=["post"],
            url_path="nodo-assignments/transfer")
    def transfer(self, request):
        from django.db.models import Q, Sum, F
        try:
            origin_id = request.data["origin_nodo_id"]
            dest_id   = request.data["destination_nodo_id"]
            items     = request.data.get("items") or []
        except (KeyError, TypeError) as e:
            return Response({"detail": f"Payload inválido: {e}"}, status=400)
        if not isinstance(items, list) or not items:
            return Response({"detail": "items debe ser lista no vacía"}, status=400)
        if str(origin_id) == str(dest_id):
            return Response(
                {"detail": "origen y destino deben ser distintos"}, status=400,
            )
        transferencia_id = request.data.get("transferencia_id") or None

        uploader = getattr(request.user, "id", None) if request.user else None
        if not isinstance(uploader, uuid.UUID):
            uploader = None

        created_dest = []
        residuals    = []
        try:
            with transaction.atomic():
                for it in items:
                    try:
                        exp_id  = it["expediente_id"]
                        prod_id = it["producto_id"]
                        qty     = int(it["qty"])
                    except (KeyError, ValueError, TypeError) as e:
                        return Response(
                            {"detail": f"item inválido: {e}"}, status=400,
                        )
                    if qty <= 0:
                        continue
                    talla = it.get("talla") or ""

                    qs_origin = ExpedienteNodoAssignment.objects.filter(
                        is_active=True, nodo_id=origin_id,
                        expediente_id=exp_id, producto_id=prod_id,
                    )
                    if talla in ("", None):
                        qs_origin = qs_origin.filter(
                            Q(talla__isnull=True) | Q(talla=""),
                        )
                    else:
                        qs_origin = qs_origin.filter(talla=talla)
                    # Sprint 2026-06-02 · Costo operativo: lo leemos del
                    # origen ANTES del soft-delete. Promedio ponderado por
                    # qty (por si hay varios batches en origen). El costo
                    # por-unidad es invariante al split → se copia a destino
                    # y residual, y así viaja con la asignación.
                    agg = qs_origin.aggregate(
                        s=Sum("qty_asignada"),
                        c=Sum(F("qty_asignada") * F("costo_operativo_unitario_usd")),
                    )
                    qty_origin = int(agg["s"] or 0)
                    total_cost_origin = float(agg["c"] or 0)
                    per_unit_cost = round(total_cost_origin / qty_origin, 4) if qty_origin else 0
                    origin_batch_id = qs_origin.values_list("costo_batch_id", flat=True).first()
                    if qty > qty_origin:
                        return Response({
                            "detail": "Over-transfer: qty > disponible en origen",
                            "expediente_id": str(exp_id),
                            "producto_id":   str(prod_id),
                            "talla":         talla,
                            "qty_solicitada":         qty,
                            "qty_disponible_origen":  qty_origin,
                        }, status=400)
                    # 1) soft-delete origen.
                    qs_origin.update(is_active=False)
                    # 2) insertar fila en destino.
                    new_row = ExpedienteNodoAssignment.objects.create(
                        id=uuid.uuid4(),
                        expediente_id=exp_id, producto_id=prod_id,
                        talla=(talla or None),
                        nodo_id=dest_id, qty_asignada=qty,
                        recepcion_id=None,
                        # Sprint 2026-05-13 · Fase 10 — trazabilidad.
                        transferencia_id=transferencia_id or None,
                        # Sprint 2026-06-02 · el costo viaja con la asignación.
                        costo_operativo_unitario_usd=per_unit_cost,
                        costo_batch_id=origin_batch_id,
                        notas=(
                            f"transfer from {transferencia_id}"
                            if transferencia_id else "transfer"
                        ),
                        created_by_id=uploader, is_active=True,
                    )
                    created_dest.append(str(new_row.id))
                    # 3) si quedaba residual en origen, re-insertar.
                    residual = qty_origin - qty
                    if residual > 0:
                        res_row = ExpedienteNodoAssignment.objects.create(
                            id=uuid.uuid4(),
                            expediente_id=exp_id, producto_id=prod_id,
                            talla=(talla or None),
                            nodo_id=origin_id, qty_asignada=residual,
                            recepcion_id=None,
                            # Sprint 2026-05-13 · Fase 10 — trazabilidad.
                            transferencia_id=transferencia_id or None,
                            # Sprint 2026-06-02 · residual conserva su costo.
                            costo_operativo_unitario_usd=per_unit_cost,
                            costo_batch_id=origin_batch_id,
                            notas="transfer-residual",
                            created_by_id=uploader, is_active=True,
                        )
                        residuals.append(str(res_row.id))
        except Exception as exc:
            log.exception("transfer assignment failed")
            return Response({"detail": f"Error en transferencia: {exc}"}, status=500)
        return Response({
            "ok": True,
            "moved_items":          len(created_dest),
            "destination_row_ids":  created_dest,
            "residual_row_ids":     residuals,
        })

    # ── 3) Inventario asignado de un nodo (con expediente_codigo + proforma_codigo) ──
    @action(detail=False, methods=["get"], url_path=r"nodos/(?P<nodo_id>[^/.]+)/inventory-allocated")
    def inventory_allocated(self, request, nodo_id=None):
        # Sprint 2026-05-17 · agrega `proforma_codigo` (PROFORMA mas reciente del
        # expediente) para que el FE pueda mostrar el numero de proforma en la
        # tabla "Inventario asignado por expediente" del detalle de nodo.
        # El FE usa: proforma_codigo OR expediente_codigo OR '—'.
        with connection.cursor() as c:
            c.execute(
                """
                SELECT
                    l.producto_id,
                    l.sku,
                    COALESCE(p.nombre, p.descripcion, l.sku, '—')  AS nombre,
                    a.talla,
                    a.expediente_id,
                    e.codigo                                       AS expediente_codigo,
                    pf.codigo                                      AS proforma_codigo,
                    SUM(a.qty_asignada)::int                       AS qty
                FROM inventario.expediente_nodo_assignment a
                JOIN expedientes.linea l
                  ON l.expediente_id = a.expediente_id
                 AND l.producto_id   = a.producto_id
                 AND COALESCE(l.size,'') = COALESCE(a.talla,'')
                LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                LEFT JOIN productos.producto     p ON p.id = a.producto_id
                LEFT JOIN LATERAL (
                    SELECT d.codigo
                    FROM expedientes.documento d
                    WHERE d.expediente_id = e.id
                      AND d.kind          = 'PROFORMA'
                      AND d.is_active     = TRUE
                      AND d.codigo IS NOT NULL
                      AND d.codigo <> ''
                    ORDER BY d.created_at DESC
                    LIMIT 1
                ) pf ON TRUE
                WHERE a.nodo_id = %(nodo_id)s::uuid
                  AND a.is_active = TRUE
                GROUP BY l.producto_id, l.sku, p.nombre, p.descripcion,
                         a.talla, a.expediente_id, e.codigo, pf.codigo
                HAVING SUM(a.qty_asignada) > 0
                ORDER BY e.codigo, l.sku, a.talla
                """,
                {"nodo_id": nodo_id},
            )
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
        return Response(rows)
