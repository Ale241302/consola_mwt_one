"""
apps.nodos.views — CRUD + endpoints de select_* y jerarquía para el FE.
"""
import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Nodo, TipoCat, StatusCat, NodoJerarquia
from .serializers import (
    NodoSerializer, NodoListSerializer, NodoJerarquiaSerializer,
)


class NodoViewSet(viewsets.ViewSet):
    """
    GET     /api/nodos/                         → list   (q, tipo, pais, status)
    POST    /api/nodos/                         → create
    GET     /api/nodos/{id}/                    → retrieve
    PATCH   /api/nodos/{id}/                    → update parcial
    DELETE  /api/nodos/{id}/                    → soft-delete (is_active=FALSE)
    GET     /api/nodos/select_tipos/            → catálogo de tipos
    GET     /api/nodos/select_status/           → catálogo de status (ACTIVE/INACTIVE/SETUP/RETIRED)
    GET     /api/nodos/select_paises/           → catálogo de países (core.pais_cat)
    GET     /api/nodos/select_responsables/     → usuarios activos
    GET     /api/nodos/select_capabilities/     → set canónico de capacidades
    GET     /api/nodos/jerarquia/               → árbol completo (sólo raíces con hijos)
    GET     /api/nodos/{id}/descendientes/      → subtree a partir del nodo
    """

    # Set canónico de capacidades — fuente única; el FE no debería hardcodearlas.
    CAPABILITIES_CANON = [
        {"codigo": "receive",          "label": "Recibir"},
        {"codigo": "store",            "label": "Almacenar"},
        {"codigo": "prepare",          "label": "Preparar"},
        {"codigo": "dispatch",         "label": "Despachar"},
        {"codigo": "report_sales",     "label": "Reportar ventas"},
        {"codigo": "report_inventory", "label": "Reportar inventario"},
    ]

    # ── List ──────────────────────────────────────────
    def list(self, request):
        qs = Nodo.objects.filter(is_active=True).order_by("codigo")
        tipo   = request.query_params.get("tipo")
        pais   = request.query_params.get("pais")
        status = request.query_params.get("status")
        q      = request.query_params.get("q")
        if tipo:   qs = qs.filter(tipo=tipo)
        if pais:   qs = qs.filter(pais_iso2=pais.upper())
        if status: qs = qs.filter(status=status)
        if q:      qs = qs.filter(nombre__icontains=q)
        return Response(NodoListSerializer(qs, many=True).data)

    # ── Retrieve ──────────────────────────────────────
    def retrieve(self, request, pk=None):
        try:
            n = Nodo.objects.get(pk=pk, is_active=True)
        except Nodo.DoesNotExist:
            return Response({"detail": "Nodo no existe"}, status=404)
        return Response(NodoSerializer(n).data)

    # ── Create ────────────────────────────────────────
    def create(self, request):
        # Defaults: status=ACTIVE si no viene; capabilities=[] si no viene.
        data = {**request.data}
        data.setdefault("status", "ACTIVE")
        data.setdefault("capabilities", [])
        s = NodoSerializer(data=data)
        s.is_valid(raise_exception=True)
        # ── id explícito vía save(**kwargs) ──
        # El modelo `Nodo.id` es UUIDField sin default; el SQL tiene
        # DEFAULT gen_random_uuid() pero Django manda el INSERT con la
        # columna id presente (=NULL) y rompe el PK NOT NULL.
        # Como `id` está en read_only_fields, no podemos pasarlo dentro
        # de `data` — DRF lo descartaría. La forma canónica es inyectarlo
        # como kwarg de save(): se mergea a validated_data antes de create().
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    # ── Update (full + partial) ───────────────────────
    def update(self, request, pk=None):
        try:
            n = Nodo.objects.get(pk=pk)
        except Nodo.DoesNotExist:
            return Response({"detail": "Nodo no existe"}, status=404)
        s = NodoSerializer(n, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    # ── Destroy (soft) ────────────────────────────────
    def destroy(self, request, pk=None):
        Nodo.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects (el FE los consume sin hardcodear nada) ──
    @action(detail=False, methods=["get"])
    def select_tipos(self, request):
        return Response(
            [{"codigo": t.codigo, "label": t.label, "color": t.color}
             for t in TipoCat.objects.all()]
        )

    @action(detail=False, methods=["get"])
    def select_status(self, request):
        return Response(
            [{"codigo": s.codigo, "label": s.label,
              "color": s.color, "descripcion": s.descripcion}
             for s in StatusCat.objects.filter(is_active=True).order_by("orden")]
        )

    @action(detail=False, methods=["get"])
    def select_capabilities(self, request):
        return Response(self.CAPABILITIES_CANON)

    @action(detail=False, methods=["get"])
    def select_paises(self, request):
        with connection.cursor() as c:
            c.execute("""
                SELECT iso2, label FROM core.pais_cat
                WHERE is_active = TRUE
                ORDER BY orden, label
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

    # ── Jerarquía (árbol padre-hijo) ──────────────────
    @action(detail=False, methods=["get"])
    def jerarquia(self, request):
        """
        Devuelve todas las relaciones activas del árbol, indexadas por nivel.
        El FE reconstruye el árbol localmente — el BE solo provee las aristas.
        """
        rels = NodoJerarquia.objects.filter(is_active=True).order_by("nivel", "created_at")
        return Response(NodoJerarquiaSerializer(rels, many=True).data)

    @action(detail=True, methods=["get"])
    def descendientes(self, request, pk=None):
        """Relaciones en cuyo path_uuid aparezca este nodo."""
        rels = NodoJerarquia.objects.filter(
            is_active=True, path_uuid__icontains=str(pk)
        ).order_by("nivel", "created_at")
        return Response(NodoJerarquiaSerializer(rels, many=True).data)
