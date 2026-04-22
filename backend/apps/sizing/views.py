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

    # ── Soft delete: nunca borramos físicamente ────────────────
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
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
            **{f: getattr(original, f) for f in Talla.EQUIVALENCE_FIELDS},
            **{f: getattr(original, f) for f in Talla.DIMENSION_FIELDS},
            metadata=dict(original.metadata or {}),
        )
        return Response(TallaSerializer(copia).data, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────────────────────────────────
# Catálogos (read-only)
# ─────────────────────────────────────────────────────────────────────
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

        payload = {
            "tipos_producto":      TipoProductoCatSerializer(tipos, many=True).data,
            "sistemas_medida":     MedidaSistemaCatSerializer(sistemas, many=True).data,
            "equivalence_fields":  list(Talla.EQUIVALENCE_FIELDS),
            "dimension_fields":    list(self.DIMENSION_META),
            "draft_allowed":       True,
            "version":             "sizing-engine-v1",
        }
        return Response(payload, status=status.HTTP_200_OK)
