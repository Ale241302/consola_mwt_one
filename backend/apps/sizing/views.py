"""
=====================================================================
MWT.ONE · apps.sizing.views
Agente responsable: [AG-BACKEND]
Sprint: SIZING ENGINE v1

Endpoints expuestos:
  · /api/sizing/tallas/                 (CRUD Talla)
  · /api/sizing/tallas/<id>/            (retrieve/update/destroy)
  · /api/sizing/tipos-producto/         (read-only catálogo)
  · /api/sizing/sistemas-medida/        (read-only catálogo)
  · /api/sizing/options/                (single payload — alimenta FE)

Reglas MWT:
  · Cero datos hardcoded en el FE → /options/ entrega catálogos.
  · Soft-delete vía PATCH is_active=False.
=====================================================================
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.db import connection

from .models import Talla, TipoProductoCat, MedidaSistemaCat
from .serializers import (
    TallaSerializer, TallaListSerializer,
    TipoProductoCatSerializer, MedidaSistemaCatSerializer,
)


# ─────────────────────────────────────────────────────────────────────
# CRUD principal
# ─────────────────────────────────────────────────────────────────────
class TallaViewSet(viewsets.ModelViewSet):
    """
    CRUD completo del catálogo de tallas.

    Filtros simples vía querystring:
      · ?tipo_producto=calzado      → sólo calzado
      · ?tipo_producto=plantilla    → sólo plantillas
      · ?is_active=true|false       → activos / inactivos
      · ?q=42                       → coincidencia parcial en talla_base / nombre / equivalencias top
    """
    permission_classes = [IsAuthenticated]
    queryset           = Talla.objects.all()
    lookup_field       = "id"

    # ── Serializer dinámico (lista vs detalle) ─────────────────
    def get_serializer_class(self):
        if self.action == "list":
            return TallaListSerializer
        return TallaSerializer

    # ── Filtros + ordenamiento ─────────────────────────────────
    def get_queryset(self):
        qs = Talla.objects.all().order_by("tipo_producto", "talla_base", "id")
        params = self.request.query_params

        tp = params.get("tipo_producto")
        if tp:
            qs = qs.filter(tipo_producto=tp.strip().lower())

        active = params.get("is_active")
        if active is not None and active != "":
            qs = qs.filter(is_active=str(active).lower() in ("1", "true", "yes"))

        # ── Sprint 2026-07-16 · filtros por clasificadores multi-valor ──
        # JSONB containment: la lista debe contener el valor pedido.
        marca = (params.get("marca_id") or "").strip()
        if marca:
            qs = qs.filter(marca_ids__contains=[marca])

        familia = (params.get("familia") or "").strip().upper()
        if familia:
            qs = qs.filter(familias__contains=[familia])

        tipo = (params.get("tipo") or "").strip()
        if tipo:
            qs = qs.filter(tipos__contains=[tipo])

        q = (params.get("q") or "").strip()
        if q:
            from django.db.models import Q
            ql = q.lower()
            qs = qs.filter(
                Q(talla_base__icontains=q) |
                Q(nombre__icontains=q) |
                Q(eu__iexact=ql)        |
                Q(us_men__iexact=ql)    |
                Q(us_women__iexact=ql)  |
                Q(uk_men__iexact=ql)    |
                Q(br__iexact=ql)        |
                Q(cm__iexact=ql)
            )
        return qs

    # ── Delete: por defecto SOFT (is_active=False).
    #    Si el caller pasa ?hard=1 en query params, hacemos HARD delete
    #    real (DELETE FROM ops.tallas WHERE id=...). Esto le permite al
    #    FE distinguir "Desactivar" vs "Eliminar permanente". ──────────
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        hard = str(request.query_params.get("hard", "")).lower() in ("1", "true", "yes")
        if hard:
            instance.delete()  # HARD — fila eliminada de la tabla
            return Response(status=status.HTTP_204_NO_CONTENT)
        # SOFT (default)
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Acción de utilidad: clonar una talla existente ─────────
    @action(detail=True, methods=["post"], url_path="clone")
    def clone(self, request, id=None):
        """Crea una copia inactiva (borrador) de la talla actual."""
        original = self.get_object()
        copia = Talla.objects.create(
            is_active=False,
            tipo_producto=original.tipo_producto,
            talla_base=(original.talla_base or "") + "-COPY",
            nombre=original.nombre,
            descripcion=original.descripcion,
            marca_ids=list(original.marca_ids or []),
            tipos=list(original.tipos or []),
            familias=list(original.familias or []),
            **{f: getattr(original, f) for f in Talla.EQUIVALENCE_FIELDS},
            **{f: getattr(original, f) for f in Talla.DIMENSION_FIELDS},
            metadata=dict(original.metadata or {}),
        )
        return Response(TallaSerializer(copia).data, status=status.HTTP_201_CREATED)

    # ── Sprint 2026-07-16 · duplicar la corrida de una familia a otra ──
    # POST /api/sizing/tallas/clone-familia/
    #   body: { familia_origen, familia_destino, marca_ids?, tipos? }
    # Crea una COPIA de cada talla activa de la familia origen, asignada a
    # la familia destino (con las marcas/tipos indicadas o heredadas).
    # Evita re-digitar 15 equivalencias por talla al abrir una línea nueva.
    @action(detail=False, methods=["post"], url_path="clone-familia")
    def clone_familia(self, request):
        data = request.data or {}
        origen  = str(data.get("familia_origen") or "").strip().upper()
        destino = str(data.get("familia_destino") or "").strip().upper()
        if not origen or not destino:
            return Response(
                {"detail": "familia_origen y familia_destino son obligatorias."},
                status=400)
        if origen == destino:
            return Response({"detail": "Las familias deben ser distintas."}, status=400)

        marca_ids = [str(x) for x in (data.get("marca_ids") or []) if str(x).strip()]
        tipos     = [str(x) for x in (data.get("tipos") or []) if str(x).strip()]

        fuente = Talla.objects.filter(is_active=True,
                                      familias__contains=[origen])
        creadas = []
        for original in fuente:
            copia = Talla.objects.create(
                is_active=True,
                tipo_producto=original.tipo_producto,
                talla_base=original.talla_base,
                nombre=original.nombre,
                descripcion=original.descripcion,
                marca_ids=marca_ids or list(original.marca_ids or []),
                tipos=tipos or list(original.tipos or []),
                familias=[destino],
                **{f: getattr(original, f) for f in Talla.EQUIVALENCE_FIELDS},
                **{f: getattr(original, f) for f in Talla.DIMENSION_FIELDS},
                metadata=dict(original.metadata or {}),
            )
            creadas.append(copia)
        return Response(
            {"created": len(creadas),
             "tallas": TallaListSerializer(creadas, many=True).data},
            status=status.HTTP_201_CREATED)


class TipoProductoCatViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset           = TipoProductoCat.objects.filter(is_active=True).order_by("orden", "codigo")
    serializer_class   = TipoProductoCatSerializer
    lookup_field       = "codigo"


class MedidaSistemaCatViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset           = MedidaSistemaCat.objects.filter(is_active=True).order_by("orden", "codigo")
    serializer_class   = MedidaSistemaCatSerializer
    lookup_field       = "codigo"


# ─────────────────────────────────────────────────────────────────────
# Endpoint compuesto: /api/sizing/options/
# Devuelve TODO lo que el FE necesita para pintar los selects sin
# datos hardcoded.
# ─────────────────────────────────────────────────────────────────────
class SizingOptionsView(APIView):
    """
    Respuesta:
    ```
    {
      "tipos_producto": [ { codigo, label, requiere_dimensiones, ... }, ... ],
      "sistemas_medida": [ { codigo, label, region, grupo, ... }, ... ],
      "equivalence_fields":   ["eu","us_men", ...],
      "dimension_fields": [
         { "key": "grosor_antepie_mm", "label": "Grosor antepié (mm)", "unit": "mm",
           "step": 0.1, "min": 0 },
         ...
      ],
      "draft_allowed": true
    }
    ```
    """
    permission_classes = [IsAuthenticated]

    DIMENSION_META = (
        {"key": "grosor_antepie_mm", "label": "Grosor antepié (mm)",
         "unit": "mm", "step": 0.1, "min": 0, "max": 99.99},
        {"key": "grosor_talon_mm",   "label": "Grosor talón (mm)",
         "unit": "mm", "step": 0.1, "min": 0, "max": 99.99},
        {"key": "drop_mm",           "label": "Drop (mm)",
         "unit": "mm", "step": 0.1, "min": 0, "max": 99.99},
        {"key": "peso_g",            "label": "Peso referencial (g)",
         "unit": "g",  "step": 0.5, "min": 0, "max": 9999.99},
    )

    def get(self, request, *args, **kwargs):
        tipos = TipoProductoCat.objects.filter(is_active=True).order_by("orden", "codigo")
        sistemas = MedidaSistemaCat.objects.filter(is_active=True).order_by("orden", "codigo")

        # ── Sprint 2026-07-16 · catálogos para los clasificadores ──
        # marcas: brands.marca activas (multi-select del drawer de talla)
        # tipos_calzado: catálogo vivo productos.attr_opcion (key=tipo_calzado)
        # familias: valores distintos ya usados en ops.tallas.familias
        marcas, tipos_calzado, familias = [], [], []
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT id::text, nombre FROM brands.marca
                    WHERE is_active = TRUE ORDER BY nombre
                """)
                marcas = [{"id": r[0], "nombre": r[1]} for r in cur.fetchall()]
        except Exception:
            pass
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT value FROM productos.attr_opcion
                    WHERE key = 'tipo_calzado' AND is_active = TRUE
                    ORDER BY orden, value
                """)
                tipos_calzado = [r[0] for r in cur.fetchall()]
        except Exception:
            pass
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT upper(f.val)
                    FROM ops.tallas t,
                         jsonb_array_elements_text(
                             CASE WHEN jsonb_typeof(t.familias) = 'array'
                                  THEN t.familias ELSE '[]'::jsonb END) AS f(val)
                    WHERE t.is_active = TRUE AND trim(f.val) <> ''
                    ORDER BY 1
                """)
                familias = [r[0] for r in cur.fetchall()]
        except Exception:
            pass

        # ── Sprint 2026-07-21 · nuevos clasificadores del Motor de Tallas ──
        # capellada / tipo_puntera: catálogo vivo productos.attr_opcion.
        # Se excluye cualquier valor que matchee /dalupo/i (marca interna
        # que no debe ofrecerse como opción en el FE).
        capellada, tipo_puntera = [], []
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT value FROM productos.attr_opcion
                    WHERE key = 'capellada' AND is_active = TRUE
                      AND value !~* 'dalupo'
                    ORDER BY orden, value
                """)
                capellada = [r[0] for r in cur.fetchall()]
        except Exception:
            pass
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT value FROM productos.attr_opcion
                    WHERE key = 'tipo_puntera' AND is_active = TRUE
                      AND value !~* 'dalupo'
                    ORDER BY orden, value
                """)
                tipo_puntera = [r[0] for r in cur.fetchall()]
        except Exception:
            pass

        payload = {
            "tipos_producto":      TipoProductoCatSerializer(tipos, many=True).data,
            "sistemas_medida":     MedidaSistemaCatSerializer(sistemas, many=True).data,
            "equivalence_fields":  list(Talla.EQUIVALENCE_FIELDS),
            "dimension_fields":    list(self.DIMENSION_META),
            "marcas":              marcas,
            "tipos_calzado":       tipos_calzado,
            "familias":            familias,
            "capellada":           capellada,
            "tipo_puntera":        tipo_puntera,
            "draft_allowed":       True,
            "version":             "sizing-engine-v2",
        }
        return Response(payload, status=status.HTTP_200_OK)
