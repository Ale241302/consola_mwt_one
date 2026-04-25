import uuid
from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.storage.services import delete_object as _storage_delete

from .models import (
    Marca, CategoriaCat, EstadoCat, TipoMarcaCat,
    BrandDiscountCode, BrandImportLog,
)
from .serializers import (
    MarcaSerializer, MarcaListSerializer,
    BrandDiscountCodeSerializer, BrandImportLogSerializer,
)


class MarcaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Marca.objects.filter(is_active=True).order_by("nombre")
        mapping = {
            "estado":    "estado_comercial",
            "categoria": "categoria_principal",
            "pais":      "pais_origen_iso2",
            "tipo":      "tipo",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(nombre__icontains=q)
        return Response(MarcaListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            m = Marca.objects.get(pk=pk, is_active=True)
        except Marca.DoesNotExist:
            return Response({"detail": "Marca no existe"}, status=404)
        return Response(MarcaSerializer(m).data)

    def create(self, request):
        s = MarcaSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        # `id` está en read_only_fields → DRF lo descarta del validated_data.
        # Inyectarlo vía save(**kwargs) bypasea el read_only y evita el
        # IntegrityError por PK NULL. (Mismo patrón aplicado en nodos/clientes.)
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            m = Marca.objects.get(pk=pk)
        except Marca.DoesNotExist:
            return Response({"detail": "Marca no existe"}, status=404)
        s = MarcaSerializer(m, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        try:
            instance = Marca.objects.get(pk=pk)
        except Marca.DoesNotExist:
            return Response(status=204)
        # Capturar TODAS las keys ANTES del save/delete
        keys = [
            instance.logo_url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            Marca.objects.filter(pk=pk).update(is_active=False)
            # ON COMMIT: solo si la transacción de BD se confirma, borramos
            # el objeto del bucket. Evita huérfanos en caso de rollback.
            for k in keys:
                transaction.on_commit(lambda key=k: _storage_delete(key))

        return Response(status=204)

    # ── Selects (cero hardcode FE) ────────────────────────
    @action(detail=False, methods=["get"])
    def select_categorias(self, request):
        return Response(
            [{"codigo": c.codigo, "label": c.label} for c in CategoriaCat.objects.all()]
        )

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response(
            [{"codigo": e.codigo, "label": e.label, "color": e.color}
             for e in EstadoCat.objects.all()]
        )

    @action(detail=False, methods=["get"])
    def select_tipo_marca(self, request):
        return Response(
            [{"codigo": t.codigo, "label": t.label}
             for t in TipoMarcaCat.objects.filter(is_active=True).order_by("orden")]
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

    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        """
        KPIs comerciales de la marca. Consulta productos/expedientes por UUID
        (sin FK) — si alguna tabla aún no existe, devolvemos 0 sin romper.
        """
        productos = expedientes = 0
        ventas_ytd = 0.0
        with connection.cursor() as c:
            try:
                c.execute(
                    "SELECT COUNT(*) FROM productos.producto "
                    "WHERE marca_id = %s AND is_active = TRUE", [pk]
                )
                productos = c.fetchone()[0]
            except Exception: pass
            try:
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente "
                    "WHERE marca_id = %s AND estado NOT IN ('CERRADO','CANCELADO')", [pk]
                )
                expedientes = c.fetchone()[0]
                c.execute(
                    "SELECT COALESCE(SUM(subtotal_usd),0) FROM expedientes.expediente "
                    "WHERE marca_id = %s "
                    "AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())", [pk]
                )
                ventas_ytd = float(c.fetchone()[0])
            except Exception: pass
        return Response({
            "productos_activos":    productos,
            "expedientes_abiertos": expedientes,
            "ventas_ytd_usd":       ventas_ytd,
        })

    # ── Discount codes (CRUD anidado a marca) ─────────────
    @action(detail=True, methods=["get", "post"], url_path="discount_codes")
    def discount_codes(self, request, pk=None):
        if request.method == "GET":
            qs = (BrandDiscountCode.objects
                  .filter(marca_id=pk, is_active=True)
                  .order_by("-created_at"))
            return Response(BrandDiscountCodeSerializer(qs, many=True).data)

        # POST
        data = {**request.data, "marca_id": pk}
        s = BrandDiscountCodeSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    @action(detail=True, methods=["patch", "delete"],
            url_path=r"discount_codes/(?P<code_id>[^/.]+)")
    def discount_code_detail(self, request, pk=None, code_id=None):
        try:
            dc = BrandDiscountCode.objects.get(pk=code_id, marca_id=pk)
        except BrandDiscountCode.DoesNotExist:
            return Response({"detail": "Código no existe"}, status=404)
        if request.method == "DELETE":
            dc.is_active = False
            dc.save()
            return Response(status=204)
        s = BrandDiscountCodeSerializer(dc, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    # ── Mass upload productos (2-step preview + commit) ───
    @action(detail=True, methods=["post"], url_path="upload_productos_preview")
    def upload_productos_preview(self, request, pk=None):
        """
        Body: { filename, mapping, rows: [ {...}, ... ] }
        Devuelve: { import_id, total, valid, invalid, errors, preview }
        El FE parsea el Excel con SheetJS y envía rows ya como JSON.
        """
        body     = request.data or {}
        rows     = body.get("rows") or []
        mapping  = body.get("mapping") or {}
        filename = body.get("filename") or ""

        # Validación canónica por fila (espejo de CANONICAL_FIELDS del FE).
        required = ("sku", "nombre", "precio_usd")
        errors, valid_rows = [], []
        for idx, r in enumerate(rows):
            missing = [f for f in required if not str(r.get(f, "")).strip()]
            if missing:
                errors.append({"row": idx + 1, "missing": missing})
            else:
                valid_rows.append(r)

        log = BrandImportLog.objects.create(
            id             = uuid.uuid4(),
            marca_id       = pk,
            filename       = filename[:255],
            total_rows     = len(rows),
            valid_rows     = len(valid_rows),
            invalid_rows   = len(rows) - len(valid_rows),
            mapping_json   = mapping,
            preview_json   = valid_rows[:50],   # muestra primeros 50
            errors_json    = errors[:200],      # tope defensivo
            status         = "VALID" if not errors else ("PARTIAL" if valid_rows else "REJECTED"),
            started_by     = getattr(request.user, "id", None),
        )
        return Response({
            "import_id":    str(log.id),
            "total":        log.total_rows,
            "valid":        log.valid_rows,
            "invalid":      log.invalid_rows,
            "status":       log.status,
            "errors":       errors[:200],
            "preview":      valid_rows[:50],
        })

    @action(detail=True, methods=["post"], url_path="upload_productos_commit")
    def upload_productos_commit(self, request, pk=None):
        """
        Body: { import_id, idempotence_token }
        Inserta en productos.producto las filas válidas (si la tabla existe).
        """
        import_id  = (request.data or {}).get("import_id")
        idem_token = (request.data or {}).get("idempotence_token") or str(uuid.uuid4())
        if not import_id:
            return Response({"detail": "import_id requerido"}, status=400)

        try:
            log = BrandImportLog.objects.get(pk=import_id, marca_id=pk)
        except BrandImportLog.DoesNotExist:
            return Response({"detail": "Import no existe"}, status=404)

        # Idempotencia: si ya fue committed con mismo token, devolvemos estado.
        if log.status == "COMMITTED" and log.idempotence_token == idem_token:
            return Response({
                "import_id":      str(log.id),
                "status":         log.status,
                "committed_rows": log.committed_rows,
                "idempotent":     True,
            })

        rows = log.preview_json or []
        inserted = 0
        with transaction.atomic():
            with connection.cursor() as c:
                for r in rows:
                    try:
                        c.execute("""
                            INSERT INTO productos.producto
                              (id, marca_id, sku, nombre, precio_usd,
                               is_active, created_at, updated_at)
                            VALUES (%s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                            ON CONFLICT (sku) WHERE is_active = TRUE DO NOTHING
                        """, [
                            str(uuid.uuid4()), pk,
                            r.get("sku"), r.get("nombre"),
                            r.get("precio_usd") or 0,
                        ])
                        inserted += c.rowcount
                    except Exception:
                        # No abortamos todo el lote — registramos a nivel de status.
                        continue

            log.committed_rows    = inserted
            log.status            = "COMMITTED"
            log.idempotence_token = idem_token
            log.save(update_fields=["committed_rows", "status", "idempotence_token", "updated_at"])

        return Response({
            "import_id":      str(log.id),
            "status":         log.status,
            "committed_rows": inserted,
            "idempotent":     False,
        })
