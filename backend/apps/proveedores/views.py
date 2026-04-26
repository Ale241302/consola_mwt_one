import uuid
import logging
from django.db import connection, transaction, IntegrityError, DataError
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

log = logging.getLogger(__name__)

from .models import (
    Proveedor, TipoCat, EstadoCat, IncotermCat, ClaseCat, ScoreIsoCat,
    SupplierPromoCode, SupplierAuditEvent,
    SupplierImportLog, SupplierCertificacion,
)
from .serializers import (
    ProveedorSerializer, ProveedorListSerializer,
    SupplierPromoCodeSerializer, SupplierAuditEventSerializer,
    SupplierImportLogSerializer, SupplierCertificacionSerializer,
)


class ProveedorViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Proveedor.objects.filter(is_active=True).order_by("razon_social")
        mapping = {
            "tipo":     "tipo",
            "estado":   "estado",
            "pais":     "pais_iso2",
            "incoterm": "incoterm_default",
            "clase":    "clase",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(razon_social__icontains=q)
        return Response(ProveedorListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            p = Proveedor.objects.get(pk=pk, is_active=True)
        except Proveedor.DoesNotExist:
            return Response({"detail": "Proveedor no existe"}, status=404)
        return Response(ProveedorSerializer(p).data)

    def create(self, request):
        s = ProveedorSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        except (IntegrityError, DataError) as e:
            # Devolvemos un 400 inteligible en vez de 500 mudo —
            # esto evita que un NOT NULL/CHECK escondido tumbe la UI
            # sin dejar rastro en logs (DEBUG=0).
            log.warning("Proveedor.create DB error: %s · payload=%s",
                        e, dict(request.data))
            return Response({"detail": str(e)}, status=400)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            p = Proveedor.objects.get(pk=pk)
        except Proveedor.DoesNotExist:
            return Response({"detail": "Proveedor no existe"}, status=404)
        s = ProveedorSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Proveedor.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response([{"codigo": t.codigo, "label": t.label, "color": t.color}
                         for t in TipoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_incoterms(self, request):
        return Response([{"codigo": i.codigo, "label": i.label, "descripcion": i.descripcion}
                         for i in IncotermCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_clase(self, request):
        return Response([{"codigo": c.codigo, "label": c.label, "color": c.color}
                         for c in ClaseCat.objects.filter(is_active=True).order_by("orden")])

    @action(detail=False, methods=["get"])
    def select_score_iso(self, request):
        return Response([{"codigo": str(s.codigo), "label": s.label}
                         for s in ScoreIsoCat.objects.all().order_by("codigo")])

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
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    # ── KPIs comerciales ──────────────────────────────
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        total_skus = oc_abiertas = oc_cerradas = 0
        spend_ytd = 0.0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COUNT(*) FROM productos.producto
                    WHERE proveedor_principal_id = %s AND is_active = TRUE
                """, [pk])
                total_skus = c.fetchone()[0]
            except Exception:
                pass
            try:
                c.execute("""
                    SELECT COUNT(*) FROM expedientes.oc
                    WHERE proveedor_id = %s AND estado NOT IN ('CERRADA','CANCELADA')
                """, [pk])
                oc_abiertas = c.fetchone()[0]
                c.execute("""
                    SELECT COUNT(*) FROM expedientes.oc
                    WHERE proveedor_id = %s AND estado = 'CERRADA'
                """, [pk])
                oc_cerradas = c.fetchone()[0]
                c.execute("""
                    SELECT COALESCE(SUM(total_usd),0) FROM expedientes.oc
                    WHERE proveedor_id = %s
                    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
                """, [pk])
                spend_ytd = float(c.fetchone()[0])
            except Exception:
                pass
        return Response({
            "total_skus":    total_skus,
            "oc_abiertas":   oc_abiertas,
            "oc_cerradas":   oc_cerradas,
            "spend_ytd_usd": spend_ytd,
        })

    # ── Promo codes (CRUD anidado) ────────────────────
    @action(detail=True, methods=["get", "post"], url_path="promo_codes")
    def promo_codes(self, request, pk=None):
        if request.method == "GET":
            qs = (SupplierPromoCode.objects
                  .filter(proveedor_id=pk, is_active=True)
                  .order_by("-created_at"))
            return Response(SupplierPromoCodeSerializer(qs, many=True).data)

        data = {**request.data, "proveedor_id": pk}
        s = SupplierPromoCodeSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    @action(detail=True, methods=["patch", "delete"],
            url_path=r"promo_codes/(?P<code_id>[^/.]+)")
    def promo_code_detail(self, request, pk=None, code_id=None):
        try:
            pc = SupplierPromoCode.objects.get(pk=code_id, proveedor_id=pk)
        except SupplierPromoCode.DoesNotExist:
            return Response({"detail": "Código no existe"}, status=404)
        if request.method == "DELETE":
            pc.is_active = False
            pc.save()
            return Response(status=204)
        s = SupplierPromoCodeSerializer(pc, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    # ── Audit log (read-only + append) ────────────────
    @action(detail=True, methods=["get", "post"], url_path="audit_log")
    def audit_log(self, request, pk=None):
        if request.method == "GET":
            limit = int(request.query_params.get("limit", 100))
            qs = (SupplierAuditEvent.objects
                  .filter(proveedor_id=pk, is_active=True)
                  .order_by("-created_at")[:limit])
            return Response(SupplierAuditEventSerializer(qs, many=True).data)

        data = {**request.data, "proveedor_id": pk}
        data.setdefault("actor_id", str(getattr(request.user, "id", "")) or None)
        data.setdefault("actor_type", "USER")
        s = SupplierAuditEventSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    # ── Certificaciones ───────────────────────────────
    @action(detail=True, methods=["get", "post"], url_path="certificaciones")
    def certificaciones(self, request, pk=None):
        if request.method == "GET":
            qs = (SupplierCertificacion.objects
                  .filter(proveedor_id=pk, is_active=True)
                  .order_by("-fecha_vencimiento"))
            return Response(SupplierCertificacionSerializer(qs, many=True).data)

        data = {**request.data, "proveedor_id": pk}
        s = SupplierCertificacionSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    # ── Mass upload catálogo (2-step preview + commit) ─
    @action(detail=True, methods=["post"], url_path="upload_catalogo_preview")
    def upload_catalogo_preview(self, request, pk=None):
        body     = request.data or {}
        rows     = body.get("rows") or []
        mapping  = body.get("mapping") or {}
        filename = body.get("filename") or ""

        required = ("sku", "nombre", "precio_usd")
        errors, valid_rows = [], []
        for idx, r in enumerate(rows):
            missing = [f for f in required if not str(r.get(f, "")).strip()]
            if missing:
                errors.append({"row": idx + 1, "missing": missing})
            else:
                valid_rows.append(r)

        log = SupplierImportLog.objects.create(
            id             = uuid.uuid4(),
            proveedor_id   = pk,
            filename       = filename[:255],
            total_rows     = len(rows),
            valid_rows     = len(valid_rows),
            invalid_rows   = len(rows) - len(valid_rows),
            mapping_json   = mapping,
            preview_json   = valid_rows[:50],
            errors_json    = errors[:200],
            status         = "VALID" if not errors else ("PARTIAL" if valid_rows else "REJECTED"),
            started_by     = getattr(request.user, "id", None),
        )
        return Response({
            "import_id": str(log.id),
            "total":     log.total_rows,
            "valid":     log.valid_rows,
            "invalid":   log.invalid_rows,
            "status":    log.status,
            "errors":    errors[:200],
            "preview":   valid_rows[:50],
        })

    @action(detail=True, methods=["post"], url_path="upload_catalogo_commit")
    def upload_catalogo_commit(self, request, pk=None):
        import_id  = (request.data or {}).get("import_id")
        idem_token = (request.data or {}).get("idempotence_token") or str(uuid.uuid4())
        if not import_id:
            return Response({"detail": "import_id requerido"}, status=400)

        try:
            log = SupplierImportLog.objects.get(pk=import_id, proveedor_id=pk)
        except SupplierImportLog.DoesNotExist:
            return Response({"detail": "Import no existe"}, status=404)

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
                              (id, proveedor_principal_id, sku, nombre, precio_usd,
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
