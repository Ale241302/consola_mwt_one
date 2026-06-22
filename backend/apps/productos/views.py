import csv
import io
import json
import logging
import uuid
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from apps.storage.services import delete_object as _storage_delete

from .models import (
    Producto, CategoriaCat, SubcategoriaCat, UnidadCat, EstadoCat,
    ProductClientAlias, NcmCode,
)
from .serializers import (
    ProductoSerializer, ProductoListSerializer, ProductClientAliasSerializer,
    NcmCodeSerializer,
)

log = logging.getLogger(__name__)


# Roles que pueden leer/escribir aliases comerciales por cliente.
# Los CLIENT_* (rol "cliente") jamas tocan este endpoint - el portal B2B
# sirve sus propias vistas de producto sin alias gestionables (R3).
_CEO_LIKE_ROLES = {"admin", "superadmin", "ceo", "manager"}


def _is_staff_role(request) -> bool:
    """True si el JWT trae un role staff/CEO-like (no cliente)."""
    role = ""
    if getattr(request, "auth", None):
        role = (request.auth.get("role") or "").lower()
    if not role and getattr(request, "user", None):
        role = (getattr(request.user, "role", "") or "").lower()
    return role in _CEO_LIKE_ROLES


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
        # Fable5 · batch por ids — hidratación de nombres/precios en UN
        # request desde OCDetail/FusionDetail (antes: un GET por producto).
        ids = request.query_params.get("ids")
        if ids:
            id_list = [s for s in (x.strip() for x in str(ids).split(",")) if s][:500]
            if id_list:
                qs = qs.filter(id__in=id_list)
        # Búsqueda libre — busca en NOMBRE, SKU y descripción.
        # Bug previo: sólo buscaba en `nombre`, así que si el usuario tipeaba
        # el SKU (ej. "701805") y el nombre era "50B21-A-GR-DRB", no aparecía.
        q = request.query_params.get("q")
        if q:
            from django.db.models import Q
            qq = q.strip()
            qs = qs.filter(
                Q(nombre__icontains=qq) |
                Q(sku__icontains=qq) |
                Q(descripcion__icontains=qq)
            )
        # Fable5 · paginación defensiva: limit/offset opcionales con cap
        # duro de 2000 filas (un catálogo gigante no debe tumbar el list).
        qp = request.query_params
        try:
            limit  = min(int(qp.get("limit", 2000) or 2000), 2000)
            offset = max(int(qp.get("offset", 0) or 0), 0)
        except (TypeError, ValueError):
            return Response(
                {"detail": "limit/offset inválidos: deben ser enteros."},
                status=400,
            )
        if limit < 0:
            return Response(
                {"detail": "limit inválido: debe ser >= 0."},
                status=400,
            )
        qs = qs[offset:offset + limit]
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
        """
        HARD DELETE: borra la fila de productos.producto definitivamente.
        Decisión de producto (no soft delete): permite reusar el SKU sin
        chocar con UNIQUE(sku), y libera el catálogo de fantasmas.

        Nota arquitectura: el patrón MWT es "sin FK gestionadas por Postgres";
        las referencias huérfanas en inventario.stock / productos.talla_matriz /
        productos.variante / productos.precio_history NO se cascadean
        automáticamente. La app es responsable de filtrarlas (todas
        chequean producto_id contra productos.producto en sus queries).
        """
        try:
            instance = Producto.objects.get(pk=pk)
        except Producto.DoesNotExist:
            return Response(status=204)
        # Capturar TODAS las keys ANTES del delete
        keys = [
            instance.imagen_url,
            instance.ficha_url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            Producto.objects.filter(pk=pk).delete()
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
            response = Response([{"codigo": r[0], "label": r[1]} for r in c.fetchall()])
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            return response

    # -- Aliases comerciales por cliente -----------------
    # Tabla productos.product_client_alias (sql/B3_*).
    # Permite al CEO fijar un "nombre que usa el cliente" para este SKU,
    # util en proformas, OCs y catalogos B2B. CEO/ADMIN-only - los
    # CLIENT_* nunca alcanzan este endpoint (R3 - POL_VISIBILIDAD).
    #
    # GET    /api/productos/<id>/aliases/                -> listar activos
    # POST   /api/productos/<id>/aliases/                -> upsert (body:
    #         {cliente_id, alias, cliente_sku?, notas?})
    # DELETE /api/productos/<id>/aliases/?cliente_id=... -> soft-delete
    @action(detail=True, methods=["get", "post", "delete"], url_path="aliases")
    def aliases(self, request, pk=None):
        # Validar producto existente (evita huerfanos)
        try:
            producto = Producto.objects.get(pk=pk)
        except Producto.DoesNotExist:
            return Response({"detail": "Producto no existe"}, status=404)

        # Bloqueo CEO-ONLY (R3): rol "cliente" no puede leer ni escribir.
        if not _is_staff_role(request):
            return Response({"detail": "Solo staff/CEO puede gestionar aliases."},
                            status=403)

        if request.method == "GET":
            qs = ProductClientAlias.objects.filter(
                producto_id=producto.id,
                is_active=True,
            ).order_by("alias")
            return Response(ProductClientAliasSerializer(qs, many=True).data)

        if request.method == "POST":
            data = request.data or {}
            cliente_id = data.get("cliente_id")
            if not cliente_id:
                return Response({"detail": "cliente_id requerido"}, status=400)
            try:
                cliente_uuid = uuid.UUID(str(cliente_id))
            except (ValueError, TypeError):
                return Response({"detail": "cliente_id invalido (UUID)"}, status=400)

            ser = ProductClientAliasSerializer(data=data)
            ser.is_valid(raise_exception=True)
            payload = ser.validated_data

            user_id = getattr(getattr(request, "user", None), "id", None)
            with transaction.atomic():
                # Politica upsert: la fila activa por (producto, cliente)
                # se actualiza in-place. Si no existe, se crea con id nuevo.
                # El unique parcial de la BD garantiza que NUNCA hay 2
                # filas activas para el mismo par.
                existing = (
                    ProductClientAlias.objects
                    .filter(
                        producto_id=producto.id,
                        cliente_id=str(cliente_uuid),
                        is_active=True,
                    )
                    .first()
                )
                if existing:
                    existing.alias       = payload["alias"]
                    existing.cliente_sku = payload.get("cliente_sku")
                    existing.notas       = payload.get("notas")
                    existing.updated_by_id = user_id
                    existing.save(update_fields=[
                        "alias", "cliente_sku", "notas",
                        "updated_by_id", "updated_at",
                    ])
                    return Response(
                        ProductClientAliasSerializer(existing).data,
                        status=200,
                    )

                # Insert nuevo — en savepoint propio para tolerar la carrera
                # contra el unique parcial activo `pca_one_active_per_pair`.
                # FIX 2026-06-22: antes un IntegrityError (POST concurrente del
                # mismo par, o reintento) escapaba sin captura -> HTTP 500.
                try:
                    with transaction.atomic():
                        row = ProductClientAlias.objects.create(
                            id            = uuid.uuid4(),
                            producto_id   = producto.id,
                            cliente_id    = str(cliente_uuid),
                            alias         = payload["alias"],
                            cliente_sku   = payload.get("cliente_sku"),
                            notas         = payload.get("notas"),
                            is_active     = True,
                            created_by_id = user_id,
                            updated_by_id = user_id,
                        )
                    return Response(
                        ProductClientAliasSerializer(row).data,
                        status=201,
                    )
                except IntegrityError:
                    # Otra request creó la fila activa entre el SELECT y el INSERT
                    # (o colisión del unique parcial). Caer a UPDATE idempotente.
                    existing = (
                        ProductClientAlias.objects
                        .filter(
                            producto_id=producto.id,
                            cliente_id=str(cliente_uuid),
                            is_active=True,
                        )
                        .first()
                    )
                    if existing is None:
                        return Response(
                            {"detail": "Conflicto de alias, reintenta."},
                            status=409,
                        )
                    existing.alias       = payload["alias"]
                    existing.cliente_sku = payload.get("cliente_sku")
                    existing.notas       = payload.get("notas")
                    existing.updated_by_id = user_id
                    existing.save(update_fields=[
                        "alias", "cliente_sku", "notas",
                        "updated_by_id", "updated_at",
                    ])
                    return Response(
                        ProductClientAliasSerializer(existing).data,
                        status=200,
                    )

        # DELETE: soft-delete por cliente_id (idempotente).
        cliente_id = (
            request.query_params.get("cliente_id")
            or (request.data or {}).get("cliente_id")
        )
        if not cliente_id:
            return Response({"detail": "cliente_id requerido"}, status=400)
        try:
            cliente_uuid = uuid.UUID(str(cliente_id))
        except (ValueError, TypeError):
            return Response({"detail": "cliente_id invalido (UUID)"}, status=400)

        ProductClientAlias.objects.filter(
            producto_id=producto.id,
            cliente_id=str(cliente_uuid),
            is_active=True,
        ).update(is_active=False)
        return Response(status=204)

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
            # Primer intento: -COPY ; luego -COPY-2 .. -COPY-99.
            # La unicidad ahora es por marca: chequeamos en la MISMA marca del
            # original y solo entre filas activas (los soft-deleted no bloquean).
            for i in range(1, 100):
                attempt = f"{base_sku}-COPY" if i == 1 else f"{base_sku}-COPY-{i}"
                exists_qs = Producto.objects.filter(
                    sku=attempt,
                    marca_id=src.marca_id,
                    is_active=True,
                )
                if not exists_qs.exists():
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

    # ── Eliminación masiva (hard delete) ──────────────────
    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        """
        Elimina múltiples productos en una sola transacción (HARD DELETE).
        POST /api/productos/bulk-delete/
        Body: { "ids": ["<uuid>", "<uuid>", ...] }

        Misma política que destroy(): borra fila + cleanup de assets MinIO
        vía transaction.on_commit. Las referencias huérfanas en otras
        tablas (inventario, talla_matriz, variante) NO se cascadean
        (patrón MWT sin FKs gestionadas por Postgres).

        Respuesta:
          { "deleted": <int>, "not_found": <int> }
        """
        ids_raw = (request.data or {}).get("ids")
        if not isinstance(ids_raw, list) or not ids_raw:
            return Response({"detail": "ids requerido (lista no vacía)"}, status=400)

        # Validar UUIDs (filtra inválidos sin abortar)
        valid_ids = []
        for v in ids_raw:
            try:
                valid_ids.append(str(uuid.UUID(str(v))))
            except (ValueError, TypeError):
                continue

        if not valid_ids:
            return Response({"detail": "ningún id válido en la lista"}, status=400)

        # Capturar TODAS las keys de assets ANTES del delete
        instances = list(Producto.objects.filter(pk__in=valid_ids))
        keys = []
        for inst in instances:
            if inst.imagen_url: keys.append(inst.imagen_url)
            if inst.ficha_url:  keys.append(inst.ficha_url)

        with transaction.atomic():
            deleted_count, _ = Producto.objects.filter(pk__in=valid_ids).delete()
            for k in keys:
                transaction.on_commit(lambda key=k: _storage_delete(key))

        return Response({
            "deleted":   deleted_count,
            "not_found": len(valid_ids) - deleted_count,
        })

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

                        # Productos no publicados (product_published='0') se importan con
                        # estado='INACTIVO' (no aparecen "en venta") pero is_active=TRUE
                        # (sí están en el catálogo / pueden listarse / contar como SKU
                        # registrado). Esto separa dos conceptos:
                        #   · is_active = "está en el catálogo" (toggle de la UI)
                        #   · estado   = ACTIVO/INACTIVO/DESCONTINUADO/PROXIMAMENTE
                        # Importante para idempotencia: el pre-check de unicidad usa
                        # is_active=TRUE, así que TODOS los importados (publicados o no)
                        # bloquean re-creaciones del mismo SKU en la misma marca.
                        is_published = (row.get("product_published") or "").strip() != "0"
                        estado_val = "ACTIVO" if is_published else "INACTIVO"
                        is_active_val = True

                        sku = product_code
                        nombre = (row.get("product_name") or "").strip() or product_code
                        descripcion = (row.get("product_description") or "").strip() or None

                        # Precio de lista: política del catálogo MWT — en carga masiva
                        # SIEMPRE entra en 0. Los precios se definen después en el
                        # Motor de Precios (PricingManagerTable) por mercado y cliente.
                        # Las columnas `price_value` / `product_price_real_muitowork`
                        # del CSV de Hikashop se ignoran a propósito.
                        precio = Decimal("0")

                        # ⚠️ Galería e imagen principal / ficha técnica: NO se importan
                        # en carga masiva. Política del catálogo: las imágenes y PDFs se
                        # adjuntan después por el operador desde el form de producto, para
                        # garantizar control de calidad sobre los assets del CDN/MinIO.
                        # Las columnas `images` y `files` del CSV de Hikashop se ignoran.
                        imagen_url = None
                        ficha_url = None

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

                        # Claves canónicas alineadas con el frontend (ProductFormView /
                        # BrandDetail adapter). Nombres específicos:
                        #   · `tipo_puntera`  ← NO `puntera` (el adapter lee tipo_puntera)
                        #   · `segmento`      ← string CSV-joined (el adapter lee string,
                        #                       no el array). `segmentos` se mantiene como
                        #                       array auxiliar para queries futuros.
                        especificaciones = {
                            "tipo_puntera":            (row.get("product_puntera") or "").strip() or None,
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
                            # `segmento` (string canónico que renderiza el card) +
                            # `segmentos` (array para filtros/queries multi-valor).
                            "segmento":                ", ".join(segmentos) if segmentos else None,
                            "segmentos":               segmentos,
                            "riesgos":                 riesgos,
                            # `images_gallery` y `files_gallery` quedan fuera del payload
                            # a propósito: la galería y la ficha PDF NO se importan en
                            # bulk. El operador las sube manualmente desde el form.
                        }

                        # ID nuevo inyectado desde la view (patrón del proyecto: sin FKs ORM, raw SQL)
                        new_id = str(uuid.uuid4())

                        # Política de unicidad por marca:
                        #   · Si el (sku, marca_id) YA existe ACTIVO en la BD → SKIP.
                        #   · Si existe sólo soft-deleted (is_active=FALSE) → CREAR (legacy).
                        #   · Si existe en OTRA marca → CREAR (mismo SKU, distinta marca = OK).
                        #
                        # El constraint a nivel BD es ahora UNIQUE(sku, marca_id) parcial
                        # WHERE is_active=TRUE (ver 41c_productos_sku_marca_active.sql),
                        # pero hacemos pre-check explícito para poder contar skipped vs
                        # created correctamente (ON CONFLICT no distingue cuando el INSERT
                        # mismo viene con is_active=FALSE, donde la unicidad parcial no
                        # se dispara).
                        with connection.cursor() as c:
                            c.execute(
                                """
                                SELECT 1 FROM productos.producto
                                WHERE sku = %s
                                  AND marca_id = %s
                                  AND is_active = TRUE
                                LIMIT 1
                                """,
                                [sku, str(brand_uuid)],
                            )
                            if c.fetchone():
                                # Ya existe activo en esta marca → omitir
                                skipped += 1
                                continue

                            c.execute(
                                """
                                INSERT INTO productos.producto
                                  (id, sku, nombre, descripcion, marca_id, categoria, subcategoria, unidad,
                                   moneda, precio_lista, imagen_url, ficha_url, especificaciones,
                                   estado, visibility_tier, is_active, created_at, updated_at)
                                VALUES (%s, %s, %s, %s, %s, 'CALZADO', NULL, 'PAR',
                                        'USD', %s, %s, %s, %s::jsonb,
                                        %s, 'INTERNAL', %s, NOW(), NOW())
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
                            if c.fetchone():
                                created += 1
                            else:
                                # No debería ocurrir (sin ON CONFLICT), pero por defensa
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


class NcmCodeViewSet(viewsets.ModelViewSet):
    queryset = NcmCode.objects.filter(is_active=True).order_by("code")
    serializer_class = NcmCodeSerializer

    def perform_create(self, serializer):
        serializer.save(id=uuid.uuid4())

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.save()
        return Response(status=204)

