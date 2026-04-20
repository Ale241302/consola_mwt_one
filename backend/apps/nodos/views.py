"""
apps.nodos.views — CRUD + endpoints de select_* para el FE.
"""
import uuid
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Nodo, TipoCat
from .serializers import NodoSerializer, NodoListSerializer


class NodoViewSet(viewsets.ViewSet):
    """
    GET     /api/nodos/                         → list   (q, tipo, pais)
    POST    /api/nodos/                         → create
    GET     /api/nodos/{id}/                    → retrieve
    PATCH   /api/nodos/{id}/                    → update parcial
    DELETE  /api/nodos/{id}/                    → soft-delete (is_active=FALSE)
    GET     /api/nodos/select_tipos/            → catálogo de tipos
    GET     /api/nodos/select_paises/           → catálogo de países (core.pais_cat)
    GET     /api/nodos/select_responsables/     → usuarios activos
    """

    # ── List ──────────────────────────────────────────
    def list(self, request):
        qs = Nodo.objects.filter(is_active=True).order_by("codigo")
        tipo = request.query_params.get("tipo")
        pais = request.query_params.get("pais")
        q    = request.query_params.get("q")
        if tipo: qs = qs.filter(tipo=tipo)
        if pais: qs = qs.filter(pais_iso2=pais.upper())
        if q:    qs = qs.filter(nombre__icontains=q)
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
        data = {**request.data, "id": str(uuid.uuid4())}
        s = NodoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
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
