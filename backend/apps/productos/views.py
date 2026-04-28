import csv
import io
import json
import logging
import uuid
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from apps.storage.services import delete_object as _storage_delete

from .models import Producto, CategoriaCat, SubcategoriaCat, UnidadCat, EstadoCat
from .serializers import ProductoSerializer, ProductoListSerializer

log = logging.getLogger(__name__)


class ProductoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Producto.objects.filter(is_active=True).order_by("nombre")
        mapping = {
            "marca":        "marca_id",
            "categoria":    "categoria",
            "subcategoria": "subcategoria",
            "estado":       "estado",
            "proveedor":    "proveedor_principal_id",
            "pais":         "pais_origen_iso2",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(nombre__icontains=q)
        return Response(ProductoListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            p = Producto.objects.get(pk=pk, is_active=True)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)
        return Response(ProductoSerializer(p).data)

    def create(self, request):
        s = ProductoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            p = Producto.objects.get(pk=pk)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)
        s = ProductoSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        try:
            instance = Producto.objects.get(pk=pk)
        except Producto.DoesNotExist:
            return Response(status=204)
        # Capturar TODAS las keys ANTES del save/delete
        keys = [
            instance.imagen_url,
            instance.ficha_url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            Producto.objects.filter(pk=pk).update(is_active=False)
            # ON COMMIT: solo si la transacción de BD se confirma, borramos
            # el objeto del bucket. Evita huérfanos en caso de rollback.
            for k in keys:
                transaction.on_commit(lambda key=k: _storage_delete(key))

        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_categorias(self, request):
        return Response([{"codigo": c.codigo, "label": c.label, "color": c.color}
                         for c in CategoriaCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_subcategorias(self, request):
        cat = request.query_params.get("categoria")
        qs = SubcategoriaCat.objects.all()
        if cat:
            qs = qs.filter(categoria_code=cat)
        return Response([{"codigo": s.codigo, "label": s.label, "categoria_code": s.categoria_code}
                         for s in qs])

    @action(detail=False, methods=["get"])
    def select_unidades(self, request):
        return Response([{"codigo": u.codigo, "label": u.label, "factor": str(u.factor)}
                         for u in UnidadCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_marcas(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT id, nombre FROM brands.marca
                WHERE is_active = TRUE ORDER BY nombre
            """)
            return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])

    @action(detail=False, methods=["get"])
    def select_proveedores(self, request):
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT id, COALESCE(nombre_comercial, razon_social)
                    FROM proveedores.proveedor
                    WHERE is_active = TRUE ORDER BY razon_social
                """)
                return Response([{"codigo": str(r[0]), "label": r[1]} for r in c.fetchall()])
            except Exception:
                return Response([])

    @action(detail=False, methods=["get"])
    def select_paises(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT iso2, label FROM core.pais_cat
                WHERE is_active = TRUE ORDER BY orden, label
            """)
            return Response([{"codigo": r[0], "label": r[1]} for r in c.fetchall()])

    # ── KPIs por SKU ──────────────────────────────────
    @action(detail=True, methods=["get"])
    def kpis(self, request, pk=None):
        stock_total = stock_disp = stock_resv = 0.0
        nodos_con_stock = 0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COALESCE(SUM(cantidad_disponible),0),
                           COALESCE(SUM(cantidad_reservada),0),
                           COALESCE(SUM(cantidad_disponible+cantidad_reservada+cantidad_en_transito),0),
                           COUNT(DISTINCT nodo_id)
                    FROM inventario.stock
                    WHERE producto_id = %s AND is_active = TRUE
                """, [pk])
                row = c.fetchone()
                stock_disp, stock_resv, stock_total, nodos_con_stock = (
                    float(row[0]), float(row[1]), float(row[2]), int(row[3])
                )
            except Exception:
                pass
        return Response({
            "stock_total":       stock_total,
            "stock_disponible":  stock_disp,
            "stock_reservado":   stock_resv,
            "nodos_con_stock":   nodos_con_stock,
        })

    # ── Duplicar producto ──────────────────────────────
    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, pk=None):
        """
        Duplica un producto existente generando un SKU derivado libre.
        POST /api/productos/<id>/duplicate/

        Estrategia de SKU:
          1. base_sku = original.sku or 'PRODUCTO'
          2. Probar f"{base_sku}-COPY", luego "-COPY-2" .. "-COPY-99".
          3. Si todas están tomadas → 409.

        El duplicado siempre nace is_active=True / estado='ACTIVO'.
        """
        try:
            src = Producto.objects.get(pk=pk, is_active=True)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)

        try:
            base_sku = src.sku or "PRODUCTO"
            candidate = None
            # Primer intento: -COPY ; luego -COPY-2 .. -COPY-99
            for i in range(1, 100):
                attempt = f"{base_sku}-COPY" if i == 1 else f"{base_sku}-COPY-{i}"
                if not Producto.objects.filter(sku=attempt).exists():
                    candidate = attempt
                    break
            if candidate is None:
                return Response(
                    {"detail": "No hay SKU libre para duplicar (agotadas variantes -COPY..-COPY-99)"},
                    status=409,
                )

            fields = {
                f.name: getattr(src, f.name)
                for f in Producto._meta.fields
                if f.name not in ("id", "sku", "created_at", "updated_at")
            }
            fields["sku"] = candidate
            fields["is_active"] = True
            fields["estado"] = "ACTIVO"
            new = Producto.objects.create(id=uuid.uuid4(), **fields)
            return Response(ProductoSerializer(new).data, status=201)
        except Exception:
            log.exception("duplicate: fallo inesperado duplicando producto %s", pk)
            return Response({"detail": "Error duplicando producto"}, status=500)

    # ── Carga masiva CSV (Hikashop export) ───────────────
    @action(
        detail=False,
        methods=["post"],
        url_path="bulk-upload-csv",
        parser_classes=[MultiPartParser, FormParser],
    )
    def bulk_upload_csv(self, request):
        """
        Carga masiva de productos vía CSV (export Hikashop).
        POST /api/productos/bulk-upload-csv/?brand_id=<uuid>
        multipart/form-data con campo 'file' (CSV utf-8-sig, delimitador ';').

        Solo importa productos padre (product_type='main'). Productos no
        publicados (product_published='0') se importan como estado='INACTIVO'.
        Política idempotente: si el SKU ya existe en la BD se OMITE
        (no se actualiza ni se duplica) — ON CONFLICT (sku) DO NOTHING.
        Respuesta: {created, updated=0, skipped, errors[]}.
        """
        # ── 1) Validar brand_id ──────────────────────────
        brand_id_raw = request.query_params.get("brand_id")
        if not brand_id_raw:
            return Response({"detail": "brand_id requerido"}, status=400)
        try:
            brand_uuid = uuid.UUID(str(brand_id_raw))
        except (ValueError, TypeError):
            return Response({"detail": "brand_id inválido o marca no existe"}, status=400)

        with connection.cursor() as c:
            c.execute(
                "SELECT 1 FROM brands.marca WHERE id=%s AND is_active=TRUE",
                [str(brand_uuid)],
            )
            if not c.fetchone():
                return Response({"detail": "brand_id inválido o marca no existe"}, status=400)

        # ── 2) Validar archivo ───────────────────────────
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "file requerido"}, status=400)

        filename = getattr(upload, "name", "upload.csv")

        # ── 3) Decodificar utf-8-sig (maneja BOM) y parsear ─────
        try:
            raw = upload.read()
            text = raw.decode("utf-8-sig")
            stream = io.StringIO(text)
            reader = csv.DictReader(stream, delimiter=";")
        except Exception:
            log.exception("bulk_upload_csv: fallo decodificación CSV")
            return Response({"detail": "CSV ilegible o codificación inválida"}, status=400)

        created = 0
        updated = 0
        skipped = 0
        errors = []
        rows_total = 0

        # ── 4) Procesar filas ────────────────────────────
        try:
            with transaction.atomic():
                for idx, row in enumerate(reader, start=1):
                    rows_total += 1
                    sku = ""
                    try:
                        product_code = (row.get("product_code") or "").strip()
                        if not product_code:
                            skipped += 1
                            continue

                        # Solo productos padre, no variantes (skip categorías y variantes de talla)
                        if (row.get("product_type") or "").strip() != "main":
                            skipped += 1
                            continue

                        # NOTA Hikashop: en el export real, `parent_category` solo está
                        # poblado en filas de tipo categoría (no en main products); todas
                        # las filas main tienen parent_category=''. Por eso NO filtramos
                        # por parent_category — confiamos en product_type='main'.

                        # Productos no publicados (product_published='0') se importan como
                        # INACTIVO/is_active=FALSE para preservar el dato pero no listarlos
                        # en el catálogo activo. La spec original pedía skip, pero ~90% de
                        # los products del CSV están unpublished — perdíamos casi todo.
                        is_published = (row.get("product_published") or "").strip() != "0"
                        estado_val = "ACTIVO" if is_published else "INACTIVO"
                        is_active_val = is_published

                        sku = product_code
                        nombre = (row.get("product_name") or "").strip() or product_code
                        descripcion = (row.get("product_description") or "").strip() or None

                        # Precio: Decimal, "" → 0
                        precio_raw = (row.get("price_value") or "").strip()
                        try:
                            precio = Decimal(precio_raw) if precio_raw else Decimal("0")
                        except (InvalidOperation, ValueError):
                            precio = Decimal("0")

                        # Imagen / ficha: primer item de la galería
                        images_raw = row.get("images") or ""
                        files_raw = row.get("files") or ""
                        images_list = [u.strip() for u in images_raw.split(";") if u.strip()]
                        files_list = [u.strip() for u in files_raw.split(";") if u.strip()]
                        imagen_url = images_list[0] if images_list else None
                        ficha_url = files_list[0] if files_list else None

                        # Capellada: preferir product_capellada; fallback a product_capellado (typo Hikashop)
                        capellada_val = (row.get("product_capellada") or "").strip()
                        if not capellada_val:
                            capellada_val = (row.get("product_capellado") or "").strip()

                        # Multi-valor (segmento / riesgo: typo intencional 'producrt_riesgo')
                        segmentos = [
                            s.strip()
                            for s in (row.get("product_segmento") or "").split(",")
                            if s.strip()
                        ]
                        riesgos = [
                            s.strip()
                            for s in (row.get("producrt_riesgo") or "").split(",")
                            if s.strip()
                        ]

                        especificaciones = {
                            "puntera":                 (row.get("product_puntera") or "").strip() or None,
                            "suela":                   (row.get("product_suela") or "").strip() or None,
                            "capellada":               capellada_val or None,
                            "cierre":                  (row.get("product_cierre") or "").strip() or None,
                            "normativa":               (row.get("product_normativa") or "").strip() or None,
                            "tipo_calzado":            (row.get("product_calzado") or "").strip() or None,
                            "color":                   (row.get("product_color") or "").strip() or None,
                            "ncm":                     (row.get("product_ncm") or "").strip() or None,
                            "disipativo":              (row.get("product_disipativo") or "").strip() or None,
                            "antiperforante":          (row.get("product_antiperforante") or "").strip() or None,
                            "metatarsal":              (row.get("product_metatarsal") or "").strip() or None,
                            "cubrepuntera":            (row.get("product_cubrepuntera") or "").strip() or None,
                            "plantilla":               (row.get("product_plantilla") or "").strip() or None,
                            "componentes_reciclados":  (row.get("product_componentes_reciclados") or "").strip() or None,
                            "segmentos":               segmentos,
                            "riesgos":                 riesgos,
                            "images_gallery":          images_list,
                            "files_gallery":           files_list,
                        }

                        # ID nuevo inyectado desde la view (patrón del proyecto: sin FKs ORM, raw SQL)
                        new_id = str(uuid.uuid4())

                        # Política: si el SKU ya existe en la BD → SKIP (no actualizar,
                        # no crear). El constraint UNIQUE(sku) es GLOBAL; usamos
                        # ON CONFLICT (sku) DO NOTHING para preservar el dato existente.
                        # RETURNING id solo devuelve fila cuando el INSERT efectivamente
                        # insertó: ausencia de fila ⇒ conflicto ⇒ skip.
                        with connection.cursor() as c:
                            c.execute(
                                """
                                INSERT INTO productos.producto
                                  (id, sku, nombre, descripcion, marca_id, categoria, subcategoria, unidad,
                                   moneda, precio_lista, imagen_url, ficha_url, especificaciones,
                                   estado, visibility_tier, is_active, created_at, updated_at)
                                VALUES (%s, %s, %s, %s, %s, 'CALZADO', NULL, 'PAR',
                                        'USD', %s, %s, %s, %s::jsonb,
                                        %s, 'INTERNAL', %s, NOW(), NOW())
                                ON CONFLICT (sku) DO NOTHING
                                RETURNING id;
                                """,
                                [
                                    new_id,
                                    sku,
                                    nombre,
                                    descripcion,
                                    str(brand_uuid),
                                    precio,
                                    imagen_url,
                                    ficha_url,
                                    json.dumps(especificaciones, ensure_ascii=False),
                                    estado_val,
                                    is_active_val,
                                ],
                            )
                            result = c.fetchone()
                            if result:
                                created += 1
                            else:
                                # SKU ya existe en la BD → omitir
                                skipped += 1

                    except Exception as e:
                        # No abortar todo el batch; registrar error de fila
                        errors.append({
                            "row": idx,
                            "sku": sku,
                            "error": str(e),
                        })

                # ── 5) Bonus: registrar en productos.imports_log ──
                # Si la tabla no existe, no abortar el batch.
                try:
                    with connection.cursor() as c:
                        rows_valid = created + updated
                        status_log = "OK" if not errors else ("PARTIAL" if rows_valid else "FAIL")
                        c.execute(
                            """
                            INSERT INTO productos.imports_log
                              (id, filename, rows_total, rows_valid, rows_inserted,
                               rows_updated, status, errors_json, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                            """,
                            [
                                str(uuid.uuid4()),
                                filename,
                                rows_total,
                                rows_valid,
                                created,
                                updated,
                                status_log,
                                json.dumps(errors, ensure_ascii=False),
                            ],
                        )
                except Exception:
                    # Tabla puede no existir en este entorno; no abortar.
                    log.warning("bulk_upload_csv: imports_log no disponible", exc_info=True)

        except Exception:
            log.exception("bulk_upload_csv: fallo global del batch")
            return Response(
                {"detail": "Error procesando carga masiva"},
                status=500,
            )

        return Response({
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "errors":  errors,
        })
