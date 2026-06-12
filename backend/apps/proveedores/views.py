import uuid
import logging
from django.db import connection, transaction, IntegrityError, DataError
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

log = logging.getLogger(__name__)

from .models import (
    Proveedor, TipoCat, EstadoCat, IncotermCat, ClaseCat, ScoreIsoCat,
    SupplierPromoCode, SupplierAuditEvent,
    SupplierImportLog, SupplierCertificacion,
    SupplierProductAssignment,
    SupplierIsoEvaluation,
)
from .serializers import (
    ProveedorSerializer, ProveedorListSerializer,
    SupplierPromoCodeSerializer, SupplierAuditEventSerializer,
    SupplierImportLogSerializer, SupplierCertificacionSerializer,
    SupplierProductAssignmentSerializer,
    SupplierIsoEvaluationSerializer,
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

        # ── Score ISO real desde la última auditoría (PLB_SUPPLIER_EVAL).
        # Una sola query con DISTINCT ON, no N+1. Pasamos el dict por
        # context al list serializer, que expone iso_score_real.
        last_eval_by_supplier = {}
        with connection.cursor() as c:
            c.execute("""
                SELECT DISTINCT ON (supplier_id)
                       supplier_id, score_total, decision, periodo, created_at
                FROM proveedores.suppliers_iso_evaluations
                WHERE is_active = TRUE
                ORDER BY supplier_id, created_at DESC
            """)
            for sup_id, score, decision, periodo, created_at in c.fetchall():
                last_eval_by_supplier[str(sup_id)] = {
                    "score":   float(score) if score is not None else None,
                    "decision": decision or "",
                    "periodo":  periodo or "",
                    "fecha":    created_at.date().isoformat() if created_at else "",
                }

        return Response(ProveedorListSerializer(
            qs, many=True,
            context={"last_eval_by_supplier": last_eval_by_supplier},
        ).data)

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
            response = Response([{"codigo": r[0], "label": r[1]} for r in c.fetchall()])
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            return response

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
            try:
                qs = list(SupplierPromoCode.objects
                          .filter(proveedor_id=pk, is_active=True)
                          .order_by("-created_at"))
                return Response(SupplierPromoCodeSerializer(qs, many=True).data)
            except Exception as e:
                # Mismatch DB-modelo, etc. — devolvemos un payload vacío
                # con detail diagnóstico en vez de 500 mudo.
                log.warning("promo_codes GET error proveedor=%s : %s", pk, e)
                return Response(
                    {"detail": "promo_codes no disponible: " + str(e)},
                    status=400,
                )

        data = {**request.data, "proveedor_id": pk}
        s = SupplierPromoCodeSerializer(data=data)
        s.is_valid(raise_exception=True)
        try:
            s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        except (IntegrityError, DataError) as e:
            log.warning("promo_codes POST DB error proveedor=%s payload=%s : %s",
                        pk, dict(request.data), e)
            return Response({"detail": str(e)}, status=400)
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

    # ── Catálogo de abastecimiento (productos asignados) ──
    # Endpoint nested: /api/proveedores/{id}/products/
    @action(detail=True, methods=["get", "post"], url_path="products")
    def products(self, request, pk=None):
        if request.method == "GET":
            try:
                qs = list(SupplierProductAssignment.objects
                          .filter(supplier_id=pk, is_active=True)
                          .order_by("product_sku"))

                # ── Anotaciones dinámicas (cantidad_12m + ultima_po + nombre + id) ──
                skus = [a.product_sku for a in qs]
                qty_12m      = {}
                ultima_po    = {}
                nombres      = {}
                producto_ids = {}

                if skus:
                    with connection.cursor() as c:
                        # Cantidades compradas en los últimos 365 días a este
                        # proveedor, agrupadas por SKU.
                        c.execute("""
                            SELECT l.sku, COALESCE(SUM(l.qty), 0) AS qty
                            FROM expedientes.linea l
                            JOIN expedientes.oc o ON o.id = l.oc_id
                            WHERE l.is_active = TRUE
                              AND o.is_active = TRUE
                              AND o.proveedor_id = %s
                              AND l.sku = ANY(%s)
                              AND COALESCE(o.issued_at, o.created_at::date)
                                  >= (NOW() - INTERVAL '365 days')::date
                            GROUP BY l.sku
                        """, [pk, skus])
                        for sku, qty in c.fetchall():
                            qty_12m[sku] = float(qty or 0)

                        # Fecha de la última PO por SKU
                        c.execute("""
                            SELECT l.sku, MAX(COALESCE(o.issued_at, o.created_at::date))
                            FROM expedientes.linea l
                            JOIN expedientes.oc o ON o.id = l.oc_id
                            WHERE l.is_active = TRUE
                              AND o.is_active = TRUE
                              AND o.proveedor_id = %s
                              AND l.sku = ANY(%s)
                            GROUP BY l.sku
                        """, [pk, skus])
                        for sku, fecha in c.fetchall():
                            ultima_po[sku] = fecha

                        # Nombres reales + UUID del producto (lookup por sku)
                        c.execute("""
                            SELECT sku, id, COALESCE(nombre, '') FROM productos.producto
                            WHERE sku = ANY(%s) AND is_active = TRUE
                        """, [skus])
                        for sku, prod_id, nombre in c.fetchall():
                            nombres[sku]      = nombre
                            producto_ids[sku] = prod_id

                ctx = {
                    "request":      request,
                    "qty_12m":      qty_12m,
                    "ultima_po":    ultima_po,
                    "nombres":      nombres,
                    "producto_ids": producto_ids,
                }
                return Response(
                    SupplierProductAssignmentSerializer(qs, many=True, context=ctx).data
                )
            except Exception as e:
                log.warning("products GET error proveedor=%s : %s", pk, e)
                return Response({"detail": "products no disponible: " + str(e)},
                                status=400)

        # POST — crear asignación nueva
        data = {**request.data, "supplier_id": pk}
        s = SupplierProductAssignmentSerializer(data=data, context={"request": request})
        s.is_valid(raise_exception=True)
        try:
            s.save(id=uuid.uuid4(),
                   created_by=getattr(request.user, "id", None))
        except (IntegrityError, DataError) as e:
            log.warning("products POST DB error proveedor=%s payload=%s : %s",
                        pk, dict(request.data), e)
            return Response({"detail": str(e)}, status=400)
        return Response(s.data, status=201)

    @action(detail=True, methods=["patch", "delete"],
            url_path=r"products/(?P<assignment_id>[^/.]+)")
    def product_detail(self, request, pk=None, assignment_id=None):
        try:
            row = SupplierProductAssignment.objects.get(
                pk=assignment_id, supplier_id=pk
            )
        except SupplierProductAssignment.DoesNotExist:
            return Response({"detail": "Asignación no existe"}, status=404)

        if request.method == "DELETE":
            row.is_active = False
            row.save()
            return Response(status=204)

        s = SupplierProductAssignmentSerializer(
            row, data=request.data, partial=True, context={"request": request}
        )
        s.is_valid(raise_exception=True)
        try:
            s.save()
        except (IntegrityError, DataError) as e:
            return Response({"detail": str(e)}, status=400)
        return Response(s.data)

    # ── Auditoría ISO (PLB_SUPPLIER_EVAL) ─────────────
    # Endpoint: /api/proveedores/{id}/evaluations/
    @action(detail=True, methods=["get", "post"], url_path="evaluations")
    def evaluations(self, request, pk=None):
        if request.method == "GET":
            try:
                qs = list(SupplierIsoEvaluation.objects
                          .filter(supplier_id=pk, is_active=True)
                          .order_by("-created_at"))

                # Enriquecimiento: mapear evaluator_id → email para mostrar
                # quién hizo la auditoría sin un join (CERO FK).
                evaluator_emails = {}
                ids = [str(e.evaluator_id) for e in qs if e.evaluator_id]
                if ids:
                    with connection.cursor() as c:
                        c.execute("""
                            SELECT id, COALESCE(email, full_name, '')
                            FROM core.users
                            WHERE id::text = ANY(%s)
                        """, [ids])
                        for uid, email in c.fetchall():
                            evaluator_emails[str(uid)] = email

                ctx = {"request": request, "evaluator_emails": evaluator_emails}
                return Response(
                    SupplierIsoEvaluationSerializer(qs, many=True, context=ctx).data
                )
            except Exception as e:
                log.warning("evaluations GET error proveedor=%s : %s", pk, e)
                return Response({"detail": "evaluations no disponible: " + str(e)},
                                status=400)

        # POST — registrar nueva auditoría
        # Forzamos supplier_id desde la URL y evaluator_id desde el JWT.
        # Eso evita que un cliente cambie la auditoría de proveedor o
        # se autoinscriba como evaluador de otro.
        data = {
            **request.data,
            "supplier_id":  pk,
            "evaluator_id": getattr(request.user, "id", None),
        }
        # Removemos cualquier intento del FE de inyectar score_total/decision.
        data.pop("score_total", None)
        data.pop("decision", None)

        s = SupplierIsoEvaluationSerializer(data=data, context={"request": request})
        s.is_valid(raise_exception=True)
        try:
            s.save(id=uuid.uuid4())
        except (IntegrityError, DataError) as e:
            log.warning("evaluations POST DB error proveedor=%s payload=%s : %s",
                        pk, dict(request.data), e)
            return Response({"detail": str(e)}, status=400)
        return Response(s.data, status=201)

    @action(detail=True, methods=["delete"],
            url_path=r"evaluations/(?P<eval_id>[^/.]+)")
    def evaluation_detail(self, request, pk=None, eval_id=None):
        try:
            row = SupplierIsoEvaluation.objects.get(pk=eval_id, supplier_id=pk)
        except SupplierIsoEvaluation.DoesNotExist:
            return Response({"detail": "Auditoría no existe"}, status=404)
        row.is_active = False
        row.save()
        return Response(status=204)

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
            rows_total     = len(rows),
            rows_valid     = len(valid_rows),
            rows_invalid   = len(rows) - len(valid_rows),
            mapping_json   = mapping,
            preview_json   = valid_rows[:50],
            errors_json    = errors[:200],
            status         = "VALID" if not errors else ("PARTIAL" if valid_rows else "REJECTED"),
            user_id        = getattr(request.user, "id", None),
        )
        return Response({
            "import_id": str(log.id),
            "total":     log.rows_total,
            "valid":     log.rows_valid,
            "invalid":   log.rows_invalid,
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

        if (log.status == "COMMITTED"
                and (log.summary_json or {}).get("idempotence_token") == idem_token):
            return Response({
                "import_id":      str(log.id),
                "status":         log.status,
                "committed_rows": log.rows_inserted,
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
            log.rows_inserted = inserted
            log.status        = "COMMITTED"
            # idempotence_token no existe como columna — vive en summary_json (jsonb)
            log.summary_json  = {**(log.summary_json or {}), "idempotence_token": idem_token}
            log.committed_at  = timezone.now()
            log.committed_by  = getattr(request.user, "id", None)
            log.save(update_fields=["rows_inserted", "status", "summary_json",
                                    "committed_at", "committed_by", "updated_at"])

        return Response({
            "import_id":      str(log.id),
            "status":         log.status,
            "committed_rows": inserted,
            "idempotent":     False,
        })
